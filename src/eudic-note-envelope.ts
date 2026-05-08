const META_FILES_PREFIX = "<!--meta files ";
const META_FILES_SUFFIX = " -->";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeRemoteNote(note: string): string {
  return note.replace(/^\uFEFF/, "");
}

function findMetaJsonEnd(note: string): number {
  let index = META_FILES_PREFIX.length;
  while (index < note.length && /\s/.test(note[index] ?? "")) {
    index += 1;
  }

  if (note[index] !== "{") {
    throw new Error("Malformed Eudic note metadata envelope.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let cursor = index; cursor < note.length; cursor += 1) {
    const char = note[cursor];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char !== "}") {
      continue;
    }

    depth -= 1;
    if (depth < 0) {
      throw new Error("Malformed Eudic note metadata envelope.");
    }

    if (depth === 0) {
      const jsonEnd = cursor + 1;
      if (note.slice(jsonEnd, jsonEnd + META_FILES_SUFFIX.length) !== META_FILES_SUFFIX) {
        throw new Error("Malformed Eudic note metadata envelope.");
      }
      return jsonEnd;
    }
  }

  throw new Error("Malformed Eudic note metadata envelope.");
}

function stringifyMetaForHtmlComment(meta: Record<string, unknown>): string {
  const serialized = JSON.stringify(meta)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/--/g, "\\u002d\\u002d");

  if (serialized.includes("--")) {
    throw new Error("Serialized Eudic note metadata still contains an unsafe '--' sequence.");
  }

  return serialized;
}

export interface ParsedEudicMetaFilesEnvelope {
  meta: Record<string, unknown>;
  body: string;
}

function hasEudicAttachmentMetadata(meta: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(meta)) {
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }

    const normalizedKey = key.toLocaleLowerCase();
    if (
      normalizedKey === "image_list" ||
      normalizedKey === "voice_list" ||
      normalizedKey === "audio_list" ||
      normalizedKey === "file_list" ||
      normalizedKey.endsWith("_file_list")
    ) {
      return true;
    }

    if (
      value.some(
        (item) =>
          isRecord(item) &&
          typeof item.type === "string" &&
          /^(image|audio|voice|file)$/i.test(item.type),
      )
    ) {
      return true;
    }
  }

  return false;
}

export function parseEudicMetaFilesEnvelope(note: string): ParsedEudicMetaFilesEnvelope | null {
  const normalizedNote = normalizeRemoteNote(note);
  if (!normalizedNote.startsWith(META_FILES_PREFIX)) {
    return null;
  }

  const jsonEnd = findMetaJsonEnd(normalizedNote);
  const rawJson = normalizedNote.slice(META_FILES_PREFIX.length, jsonEnd);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(
      error instanceof Error ? `Failed to parse Eudic note metadata JSON: ${error.message}` : "Failed to parse Eudic note metadata JSON.",
    );
  }

  if (!isRecord(parsedJson)) {
    throw new Error("Eudic note metadata envelope must contain a JSON object.");
  }

  return {
    meta: parsedJson,
    body: normalizedNote.slice(jsonEnd + META_FILES_SUFFIX.length),
  };
}

export function serializeEudicMetaFilesEnvelope(meta: Record<string, unknown>, body: string): string {
  return `${META_FILES_PREFIX}${stringifyMetaForHtmlComment(meta)}${META_FILES_SUFFIX}${body}`;
}

export function unwrapEudicMetaFilesBody(note: string): string {
  let body = normalizeRemoteNote(note);
  for (let depth = 0; depth < 5; depth += 1) {
    const parsedEnvelope = parseEudicMetaFilesEnvelope(body);
    if (!parsedEnvelope) {
      return body;
    }
    body = parsedEnvelope.body;
  }

  return body;
}

export function buildAttachmentPreservingNotePayload(remoteNote: string | null | undefined, nextBodyHtml: string): string {
  const normalizedNextBodyHtml = unwrapEudicMetaFilesBody(nextBodyHtml);
  if (!remoteNote?.trim()) {
    return normalizedNextBodyHtml;
  }

  let body = normalizeRemoteNote(remoteNote);
  for (let depth = 0; depth < 5; depth += 1) {
    const parsedEnvelope = parseEudicMetaFilesEnvelope(body);
    if (!parsedEnvelope) {
      return normalizedNextBodyHtml;
    }

    if (hasEudicAttachmentMetadata(parsedEnvelope.meta)) {
      throw new Error(
        "Existing Eudic note contains image/audio/file attachments. The Eudic OpenAPI overwrites attachments when updating text, so sync was aborted to protect them.",
      );
    }

    body = parsedEnvelope.body;
  }

  return normalizedNextBodyHtml;
}
