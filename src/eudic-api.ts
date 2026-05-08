import { EudicMcpClient } from "./eudic-mcp-client";
import { buildAttachmentPreservingNotePayload } from "./eudic-note-envelope";
import type {
  DeleteEudicNotePayload,
  EudicNotePayload,
  EudicNoteQuery,
  EudicRemoteNote,
  EudicStudylistCategory,
  EudicStudylistWordInfo,
  EudicStudylistWordQuery,
  EudicStudylistWordsPayload,
} from "./types";

export class EudicApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "EudicApiError";
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class EudicApiClient {
  private readonly mcpClient: EudicMcpClient;

  constructor(getAuthorizationToken: () => string) {
    this.mcpClient = new EudicMcpClient(getAuthorizationToken);
  }

  async overwriteNote(payload: EudicNotePayload): Promise<void> {
    await this.callMcpTool("add_note", {
      word: payload.word,
      note: payload.note,
    }, payload.language);
  }

  async getNote(query: EudicNoteQuery): Promise<EudicRemoteNote | null> {
    const json = await this.callMcpTool("get_note", { word: query.word }, query.language);
    const data = readDataObject(json);
    if (!data) {
      return null;
    }

    return {
      word: readRequiredString(data.word) || query.word,
      language: readOptionalString(data.language) ?? query.language,
      note: readOptionalString(data.note) ?? null,
      add_time: readOptionalString(data.add_time),
    };
  }

  async overwriteNotePreservingAttachments(payload: EudicNotePayload): Promise<void> {
    let remoteNote: EudicRemoteNote | null = null;
    try {
      remoteNote = await this.getNote({
        word: payload.word,
        language: payload.language,
      });
    } catch (error) {
      const status = error instanceof EudicApiError ? error.status : undefined;
      throw new EudicApiError(
        `Failed to read existing Eudic note before preserving attachments: ${toErrorMessage(error)}`,
        status,
      );
    }

    let mergedNote: string;
    try {
      // The OpenAPI cannot safely patch only text when remote attachments exist; fail closed there.
      mergedNote = buildAttachmentPreservingNotePayload(remoteNote?.note ?? null, payload.note);
    } catch (error) {
      throw new EudicApiError(
        `Failed to preserve existing Eudic attachments for "${payload.word}": ${toErrorMessage(error)}`,
      );
    }

    await this.overwriteNote({
      ...payload,
      note: mergedNote,
    });
  }

  async deleteNote(payload: DeleteEudicNotePayload): Promise<void> {
    await this.callMcpTool("delete_note", { word: payload.word }, payload.language);
  }

  async getStudylistCategories(language: string): Promise<EudicStudylistCategory[]> {
    const json = await this.callMcpTool("get_category", {}, language);
    const data = readDataArray(json);
    return data
      .map((entry) => ({
        id: readRequiredString(entry.id),
        language: readRequiredString(entry.language),
        name: readRequiredString(entry.name),
      }))
      .filter((category) => category.id && category.language && category.name);
  }

  async getStudylistWords(payload: {
    language: string;
    categoryId: string;
    page: number;
    pageSize: number;
  }): Promise<EudicStudylistWordInfo[]> {
    const json = await this.callMcpTool("get_words", {
      id: payload.categoryId,
      page: payload.page,
      page_size: payload.pageSize,
    }, payload.language);

    return readDataArray(json).map((entry) => ({
      word: readRequiredString(entry.word),
      category_ids: [],
      exp: readOptionalString(entry.exp),
      add_time: readOptionalString(entry.add_time),
      context_line: readOptionalString(entry.context_line),
      star: typeof entry.star === "number" ? entry.star : undefined,
    })).filter((wordInfo) => wordInfo.word);
  }

  async getStudylistWord(query: EudicStudylistWordQuery): Promise<EudicStudylistWordInfo | null> {
    const json = await this.callMcpTool("get_word", { word: query.word }, query.language);
    const data = readDataObject(json);
    if (!data) {
      return null;
    }

    return {
      word: readRequiredString(data.word) || query.word,
      language: readOptionalString(data.language) ?? query.language,
      category_ids: readStringIds(data.category_ids),
      exp: readOptionalString(data.exp),
      add_time: readOptionalString(data.add_time),
      context_line: readOptionalString(data.context_line),
      star: typeof data.star === "number" ? data.star : undefined,
    };
  }

  async addWordsToStudylist(payload: EudicStudylistWordsPayload): Promise<void> {
    await this.callMcpTool("add_words", {
      category_id: payload.category_id,
      words: payload.words,
    }, payload.language);
  }

  async deleteWordsFromStudylist(payload: EudicStudylistWordsPayload): Promise<void> {
    await this.callMcpTool("delete_words", {
      category_id: payload.category_id,
      language: payload.language,
      words: payload.words,
    }, payload.language);
  }

  private async callMcpTool(toolName: string, args: Record<string, unknown>, language: string): Promise<unknown> {
    try {
      return await this.mcpClient.callTool(toolName, args, language);
    } catch (error) {
      throw new EudicApiError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readDataArray(json: unknown): Record<string, unknown>[] {
  if (!isRecord(json)) {
    return [];
  }

  return Array.isArray(json.data) ? json.data.filter(isRecord) : [];
}

function readDataObject(json: unknown): Record<string, unknown> | null {
  if (!isRecord(json)) {
    return null;
  }

  if (isRecord(json.data)) {
    return json.data;
  }

  return json;
}

function readRequiredString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown): string | undefined {
  const valueAsString = readRequiredString(value);
  return valueAsString || undefined;
}

function readStringIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readRequiredString)
    .filter(Boolean)
    .filter((entry, index, array) => array.indexOf(entry) === index);
}
