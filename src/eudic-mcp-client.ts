import { requestUrl } from "obsidian";
import { parseMcpSseJsonMessages, parseMcpToolJsonResult } from "./eudic-mcp-response";
import { withRetry } from "./retry";

const EUDIC_MCP_API_BASE_URL = "https://api.frdic.com";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_REQUEST_TIMEOUT_MS = 20000;
const MCP_RETRY_ATTEMPTS = 3;
const MCP_RETRY_INITIAL_DELAY_MS = 500;
const MCP_RETRY_MAX_DELAY_MS = 2000;

export class EudicMcpHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "EudicMcpHttpError";
  }
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
  constructor(private readonly getAuthorizationToken: () => string) {}

  async callTool(toolName: string, args: Record<string, unknown>, language: string): Promise<unknown> {
    return withRetry(
      () => this.callToolOnce(toolName, args, language),
      {
        attempts: MCP_RETRY_ATTEMPTS,
        initialDelayMs: MCP_RETRY_INITIAL_DELAY_MS,
        maxDelayMs: MCP_RETRY_MAX_DELAY_MS,
        shouldRetry: (error) => {
          if (error instanceof EudicMcpHttpError) {
            return error.status >= 500;
          }

          return error instanceof EudicMcpNetworkError;
        },
      },
    );
  }

  private async callToolOnce(toolName: string, args: Record<string, unknown>, language: string): Promise<unknown> {
    const token = this.getAuthorizationToken().trim();
    if (!token) {
      throw new Error("Missing Eudic Authorization token. Set it in Eudic Sync settings.");
    }

    const normalizedLanguage = language.trim() || "en";
    const url = `${EUDIC_MCP_API_BASE_URL}/${encodeURIComponent(normalizedLanguage)}/mcp`;

    let response;
    try {
      response = await withTimeout(
        requestUrl({
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
        }),
        MCP_REQUEST_TIMEOUT_MS,
        `Eudic MCP request timed out after ${MCP_REQUEST_TIMEOUT_MS}ms.`,
      );
    } catch (error) {
      throw new EudicMcpNetworkError(`Eudic MCP request failed: ${toErrorMessage(error)}`);
    }

    if (response.status >= 400) {
      const detail = response.text.trim() ? `: ${response.text.trim()}` : ".";
      throw new EudicMcpHttpError(`Eudic MCP error (${response.status})${detail}`, response.status);
    }

    const messages = parseMcpSseJsonMessages(response.text);
    if (messages.length === 0) {
      return null;
    }

    return parseMcpToolJsonResult(messages[messages.length - 1]);
  }
}
