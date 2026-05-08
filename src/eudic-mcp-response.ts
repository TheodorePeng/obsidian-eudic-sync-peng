interface JsonRpcSuccess {
  result: unknown;
}

interface JsonRpcFailure {
  error: {
    message?: unknown;
    code?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJsonRpcFailure(value: unknown): value is JsonRpcFailure {
  return isRecord(value) && isRecord(value.error);
}

function isJsonRpcSuccess(value: unknown): value is JsonRpcSuccess {
  return isRecord(value) && "result" in value;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function quoteUnsafeJsonIntegers(jsonText: string): string {
  let result = "";
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < jsonText.length) {
    const char = jsonText[index] ?? "";

    if (escaped) {
      result += char;
      escaped = false;
      index += 1;
      continue;
    }

    if (inString) {
      result += char;
      if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === "\"") {
      result += char;
      inString = true;
      index += 1;
      continue;
    }

    if (!/[0-9-]/.test(char)) {
      result += char;
      index += 1;
      continue;
    }

    const numberMatch = jsonText.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!numberMatch) {
      result += char;
      index += 1;
      continue;
    }

    const token = numberMatch[0];
    const digitCount = token.replace(/^-/, "").length;
    const isInteger = !/[.eE]/.test(token);
    result += isInteger && digitCount >= 16 ? `"${token}"` : token;
    index += token.length;
  }

  return result;
}

export function parseMcpSseJsonMessages(text: string): unknown[] {
  const messages: unknown[] = [];
  const normalizedText = text.replace(/\r\n/g, "\n");
  const eventBlocks = normalizedText.split(/\n\n+/);

  for (const block of eventBlocks) {
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());

    if (dataLines.length === 0) {
      continue;
    }

    const dataText = dataLines.join("\n").trim();
    if (!dataText) {
      continue;
    }

    try {
      messages.push(JSON.parse(dataText));
    } catch (error) {
      throw new Error(`Failed to parse Eudic MCP SSE message: ${toErrorMessage(error)}`);
    }
  }

  if (messages.length > 0) {
    return messages;
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return [];
  }

  try {
    return [JSON.parse(trimmedText)];
  } catch (error) {
    throw new Error(`Failed to parse Eudic MCP response: ${toErrorMessage(error)}`);
  }
}

export function readMcpToolTextResult(jsonRpcMessage: unknown): string | null {
  if (isJsonRpcFailure(jsonRpcMessage)) {
    const message = typeof jsonRpcMessage.error.message === "string" ? jsonRpcMessage.error.message : "Unknown MCP tool error.";
    const code = typeof jsonRpcMessage.error.code === "number" || typeof jsonRpcMessage.error.code === "string"
      ? ` (${jsonRpcMessage.error.code})`
      : "";
    throw new Error(`Eudic MCP error${code}: ${message}`);
  }

  if (!isJsonRpcSuccess(jsonRpcMessage) || !isRecord(jsonRpcMessage.result)) {
    return null;
  }

  const content = jsonRpcMessage.result.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const textPart = content.find((part): part is { type: string; text: string } =>
    isRecord(part) && part.type === "text" && typeof part.text === "string",
  );

  return textPart?.text ?? null;
}

export function parseMcpToolJsonResult(jsonRpcMessage: unknown): unknown {
  const text = readMcpToolTextResult(jsonRpcMessage);
  if (text === null || !text.trim()) {
    return null;
  }

  try {
    return JSON.parse(quoteUnsafeJsonIntegers(text));
  } catch (error) {
    throw new Error(`Failed to parse Eudic MCP tool JSON result: ${toErrorMessage(error)}`);
  }
}
