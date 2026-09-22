import { requestUrl } from "obsidian";
import { parseMcpSseJsonMessages, parseMcpToolJsonResult } from "./eudic-mcp-response";
import { withRetry } from "./retry";

const EUDIC_MCP_API_BASE_URL = "https://api.frdic.com";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_REQUEST_TIMEOUT_MS = 20000;
const MCP_RETRY_ATTEMPTS = 3;
const MCP_RETRY_INITIAL_DELAY_MS = 500;
const MCP_RETRY_MAX_DELAY_MS = 2000;

interface EudicMcpClientOptions {
  request?: typeof requestUrl;
  timeoutMs?: number;
  retryAttempts?: number;
  retryInitialDelayMs?: number;
  retryMaxDelayMs?: number;
  retryJitterRatio?: number;
}

export class EudicMcpHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs: number | null = null) {
    super(message);
    this.name = "EudicMcpHttpError";
  }
}

export function isEudicMcpReadTool(toolName: string): boolean {
  return toolName.startsWith("get_");
}

function readRetryAfterMs(headers: unknown): number | null {
  if (!headers || typeof headers !== "object") {
    return null;
  }
  const record = headers as Record<string, unknown>;
  const rawValue = record["retry-after"] ?? record["Retry-After"];
  if (typeof rawValue !== "string") {
    return null;
  }
  const seconds = Number(rawValue.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const retryAt = Date.parse(rawValue);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
}

export class EudicMcpNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EudicMcpNetworkError";
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
    }
  }
}

export class EudicMcpClient {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly getAuthorizationToken: () => string,
    private readonly options: EudicMcpClientOptions = {},
  ) {}

  async callTool(toolName: string, args: Record<string, unknown>, language: string): Promise<unknown> {
    if (!isEudicMcpReadTool(toolName)) {
      return this.callMutationTool(toolName, args, language);
    }

    return withRetry(
      () => this.callToolOnce(toolName, args, language),
      {
        attempts: this.options.retryAttempts ?? MCP_RETRY_ATTEMPTS,
        initialDelayMs: this.options.retryInitialDelayMs ?? MCP_RETRY_INITIAL_DELAY_MS,
        maxDelayMs: this.options.retryMaxDelayMs ?? MCP_RETRY_MAX_DELAY_MS,
        jitterRatio: this.options.retryJitterRatio ?? 0.1,
        getDelayMs: (error) => error instanceof EudicMcpHttpError ? error.retryAfterMs : null,
        shouldRetry: (error) => {
          if (error instanceof EudicMcpHttpError) {
            return error.status === 429 || error.status >= 500;
          }

          return error instanceof EudicMcpNetworkError;
        },
      },
    );
  }

  private callMutationTool(toolName: string, args: Record<string, unknown>, language: string): Promise<unknown> {
    const previousMutation = this.mutationTail;
    let resolveVisible!: (value: unknown) => void;
    let rejectVisible!: (error: unknown) => void;
    const visibleResult = new Promise<unknown>((resolve, reject) => {
      resolveVisible = resolve;
      rejectVisible = reject;
    });

    this.mutationTail = previousMutation.then(async () => {
      let underlyingRequestSettled: Promise<void> = Promise.resolve();
      try {
        const result = await this.callToolOnce(toolName, args, language, (request) => {
          underlyingRequestSettled = request.then(() => undefined, () => undefined);
        });
        resolveVisible(result);
      } catch (error) {
        rejectVisible(error);
      } finally {
        await underlyingRequestSettled;
      }
    }).catch(() => undefined);

    return visibleResult;
  }

  private async callToolOnce(
    toolName: string,
    args: Record<string, unknown>,
    language: string,
    trackUnderlyingRequest?: (request: Promise<unknown>) => void,
  ): Promise<unknown> {
    const token = this.getAuthorizationToken().trim();
    if (!token) {
      throw new Error("Missing Eudic Authorization token. Set it in Eudic Sync settings.");
    }

    const normalizedLanguage = language.trim() || "en";
    const url = `${EUDIC_MCP_API_BASE_URL}/${encodeURIComponent(normalizedLanguage)}/mcp`;

    let response;
    try {
      const request = (this.options.request ?? requestUrl)({
        url,
        method: "POST",
        contentType: "application/json",
        headers: {
          Authorization: token,
          language: normalizedLanguage,
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: {
            name: toolName,
            arguments: args,
          },
        }),
        throw: false,
      });
      trackUnderlyingRequest?.(request);
      response = await withTimeout(
        request,
        this.options.timeoutMs ?? MCP_REQUEST_TIMEOUT_MS,
        `Eudic MCP request timed out after ${this.options.timeoutMs ?? MCP_REQUEST_TIMEOUT_MS}ms.`,
      );
    } catch (error) {
      const message = toErrorMessage(error);
      throw new EudicMcpNetworkError(
        /timed out/i.test(message) ? message : "Eudic MCP request failed.",
      );
    }

    if (response.status >= 400) {
      throw new EudicMcpHttpError(
        `Eudic MCP request returned HTTP ${response.status}.`,
        response.status,
        readRetryAfterMs(response.headers),
      );
    }

    const messages = parseMcpSseJsonMessages(response.text);
    if (messages.length === 0) {
      return null;
    }

    return parseMcpToolJsonResult(messages[messages.length - 1]);
  }
}
