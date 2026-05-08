import type { Editor, EditorPosition } from "obsidian";
import { FRONTMATTER_KEYS } from "./constants";
import type { EudicSyncStatus } from "./types";

export interface WordSyncFrontmatterPatchData {
  syncStatus?: EudicSyncStatus;
  syncedAt?: string | null;
  lastSyncedHash?: string | null;
  lastSyncedAliasesHash?: string | null;
  lastError?: string | null;
  eudicLinkId?: string | null;
}

interface WordSyncField {
  key: string;
  value: string | null | undefined;
  bare?: boolean;
}

export interface WordSyncFrontmatterPatch {
  changed: boolean;
  from: EditorPosition;
  to?: EditorPosition;
  replacement: string;
}

function getLineBreak(markdown: string): string {
  return markdown.includes("\r\n") ? "\r\n" : "\n";
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function isFrontmatterFence(line: string): boolean {
  return stripTrailingCarriageReturn(line).trim() === "---";
}

function findYamlFrontmatterEndLine(lines: string[]): number | null {
  if (!isFrontmatterFence(lines[0] ?? "")) {
    return null;
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (isFrontmatterFence(lines[index] ?? "")) {
      return index;
    }
  }

  return null;
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function getTopLevelKey(line: string): string | null {
  const normalized = stripTrailingCarriageReturn(line);
  if (/^\s/.test(normalized)) {
    return null;
  }

  return normalized.match(/^([^:#]+)\s*:/)?.[1]?.trim() ?? null;
}

function formatYamlScalar(value: string, bare = false): string {
  if (bare || /^[A-Za-z0-9._:/+-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function buildFields(data: WordSyncFrontmatterPatchData): WordSyncField[] {
  return [
    { key: FRONTMATTER_KEYS.eudicLinkId, value: data.eudicLinkId },
    { key: FRONTMATTER_KEYS.syncStatus, value: data.syncStatus, bare: true },
    { key: FRONTMATTER_KEYS.syncedAt, value: data.syncedAt },
    { key: FRONTMATTER_KEYS.lastSyncedHash, value: data.lastSyncedHash },
    { key: FRONTMATTER_KEYS.lastSyncedAliasesHash, value: data.lastSyncedAliasesHash },
    { key: FRONTMATTER_KEYS.lastError, value: data.lastError },
  ];
}

function buildReplacementLines(data: WordSyncFrontmatterPatchData): string[] {
  return buildFields(data)
    .filter((field) => field.value !== undefined && field.value !== null)
    .map(buildFieldLine);
}

function buildFieldLine(field: WordSyncField): string {
  return `${field.key}: ${formatYamlScalar(field.value as string, field.bare)}`;
}

function buildPatchedFrontmatterLines(
  lines: string[],
  frontmatterEndLine: number,
  data: WordSyncFrontmatterPatchData,
): string[] {
  const providedFields = buildFields(data).filter((field) => field.value !== undefined);
  const fieldByKey = new Map(providedFields.map((field) => [field.key, field]));
  const writtenKeys = new Set<string>();
  const nextLines: string[] = [];

  for (let index = 1; index < frontmatterEndLine; index += 1) {
    const line = stripTrailingCarriageReturn(lines[index] ?? "");
    const key = getTopLevelKey(line);
    const field = key ? fieldByKey.get(key) : undefined;

    if (!field) {
      nextLines.push(line);
      continue;
    }

    writtenKeys.add(field.key);
    let rangeEnd = index + 1;
    while (rangeEnd < frontmatterEndLine && getTopLevelKey(lines[rangeEnd] ?? "") === null) {
      rangeEnd += 1;
    }

    if (field.value !== null) {
      nextLines.push(buildFieldLine(field));
    }
    index = rangeEnd - 1;
  }

  for (const field of providedFields) {
    if (!writtenKeys.has(field.key) && field.value !== null) {
      nextLines.push(buildFieldLine(field));
    }
  }

  return nextLines;
}

function applyPatch(markdown: string, patch: WordSyncFrontmatterPatch): string {
  if (!patch.changed) {
    return markdown;
  }

  const lines = markdown.split("\n");
  if (!patch.to) {
    const prefix = lines.slice(0, patch.from.line).join("\n");
    const suffix = lines.slice(patch.from.line).join("\n");
    return `${prefix}${prefix ? "\n" : ""}${patch.replacement}${suffix}`;
  }

  const before = lines.slice(0, patch.from.line);
  const after = lines.slice(patch.to.line);
  const replacementLines = patch.replacement.endsWith("\n")
    ? patch.replacement.slice(0, -1).split("\n")
    : patch.replacement.split("\n");
  return [...before, ...replacementLines, ...after].join("\n");
}

export function applyWordSyncFrontmatterToObject(
  frontmatter: Record<string, unknown>,
  data: WordSyncFrontmatterPatchData,
): void {
  const fields = buildFields(data);
  for (const field of fields) {
    if (field.value === undefined) {
      continue;
    }
    if (field.value === null) {
      delete frontmatter[field.key];
    } else {
      frontmatter[field.key] = field.value;
    }
  }
}

export function buildWordSyncFrontmatterPatch(
  markdown: string,
  data: WordSyncFrontmatterPatchData,
): WordSyncFrontmatterPatch {
  const lines = markdown.split("\n");
  const frontmatterEndLine = findYamlFrontmatterEndLine(lines);
  const lineBreak = getLineBreak(markdown);
  const replacementLines = buildReplacementLines(data);
  const hasWritableFields = buildFields(data).some((field) => field.value !== undefined && field.value !== null);

  if (frontmatterEndLine === null) {
    if (!hasWritableFields) {
      return {
        changed: false,
        from: { line: 0, ch: 0 },
        replacement: "",
      };
    }

    return {
      changed: true,
      from: { line: 0, ch: 0 },
      replacement: ["---", ...replacementLines, "---", ""].join(lineBreak) + lineBreak,
    };
  }

  const currentFrontmatterLines = lines.slice(1, frontmatterEndLine).map(stripTrailingCarriageReturn);
  const nextFrontmatterLines = buildPatchedFrontmatterLines(lines, frontmatterEndLine, data);
  const replacement = nextFrontmatterLines.length > 0 ? nextFrontmatterLines.join(lineBreak) + lineBreak : "";

  return {
    changed: !arraysEqual(currentFrontmatterLines, nextFrontmatterLines),
    from: { line: 1, ch: 0 },
    to: { line: frontmatterEndLine, ch: 0 },
    replacement,
  };
}

export function setWordSyncFrontmatterInMarkdown(markdown: string, data: WordSyncFrontmatterPatchData): string {
  return applyPatch(markdown, buildWordSyncFrontmatterPatch(markdown, data));
}

export function applyWordSyncFrontmatterPatchToEditor(
  editor: Editor,
  data: WordSyncFrontmatterPatchData,
): boolean {
  const patch = buildWordSyncFrontmatterPatch(editor.getValue(), data);
  if (!patch.changed) {
    return false;
  }

  editor.replaceRange(patch.replacement, patch.from, patch.to, "eudic-sync");
  return true;
}
