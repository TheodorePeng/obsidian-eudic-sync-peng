import { requestUrl } from "obsidian";
import { parseMcpSseJsonMessages, parseMcpToolJsonResult } from "./eudic-mcp-response";

const EUDIC_MCP_API_BASE_URL = "https://api.frdic.com";
const MCP_PROTOCOL_VERSION = "2025-06-18";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class EudicMcpClient {
  constructor(private readonly getAuthorizationToken: () => string) {}

  async callTool(toolName: string, args: Record<string, unknown>, language: string): Promise<unknown> {
    const token = this.getAuthorizationToken().trim();
    if (!token) {
      throw new Error("Missing Eudic Authorization token. Set it in Eudic Sync settings.");
    }

    const normalizedLanguage = language.trim() || "en";
    const url = `${EUDIC_MCP_API_BASE_URL}/${encodeURIComponent(normalizedLanguage)}/mcp`;

    let response;
    try {
      response = await requestUrl({
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
    } catch (error) {
      throw new Error(`Eudic MCP request failed: ${toErrorMessage(error)}`);
    }

    if (response.status >= 400) {
      const detail = response.text.trim() ? `: ${response.text.trim()}` : ".";
      throw new Error(`Eudic MCP error (${response.status})${detail}`);
    }

    const messages = parseMcpSseJsonMessages(response.text);
    if (messages.length === 0) {
      return null;
    }

    return parseMcpToolJsonResult(messages[messages.length - 1]);
  }
}
