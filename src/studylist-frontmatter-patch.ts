import type { Editor, EditorPosition } from "obsidian";
import { FRONTMATTER_KEYS } from "./constants";
import type { EudicSyncStatus } from "./types";

export interface StudylistFrontmatterPatchData {
  ids: string[];
  names: string[];
  status: EudicSyncStatus;
  lastError: string | null;
  syncedAt?: string | null;
}

export interface StudylistFrontmatterPatch {
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

function escapeYamlString(value: string): string {
  return JSON.stringify(value);
}

function buildArrayField(key: string, values: string[]): string[] {
  if (values.length === 0) {
    return [`${key}: []`];
  }

  return [`${key}:`, ...values.map((value) => `  - ${escapeYamlString(value)}`)];
}

function buildStudylistLines(data: StudylistFrontmatterPatchData): string[] {
  const lines = [
    ...buildArrayField(FRONTMATTER_KEYS.studylistIds, data.ids),
    ...buildArrayField(FRONTMATTER_KEYS.studylistNames, data.names),
    `${FRONTMATTER_KEYS.studylistSyncStatus}: ${data.status}`,
  ];
  if (data.syncedAt) {
    lines.push(`${FRONTMATTER_KEYS.studylistSyncedAt}: ${escapeYamlString(data.syncedAt)}`);
  }
  if (data.lastError) {
    lines.push(`${FRONTMATTER_KEYS.studylistLastError}: ${escapeYamlString(data.lastError)}`);
  }
  return lines;
}

function isStudylistKeyLine(line: string): boolean {
  const key = line.match(/^(\s*)([^:#]+)\s*:/)?.[2]?.trim();
  return (
    key === FRONTMATTER_KEYS.studylistIds ||
    key === FRONTMATTER_KEYS.studylistNames ||
    key === FRONTMATTER_KEYS.studylistSyncStatus ||
    key === FRONTMATTER_KEYS.studylistSyncedAt ||
    key === FRONTMATTER_KEYS.studylistLastError
  );
}

function findStudylistFieldRanges(lines: string[], frontmatterEndLine: number): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 1; index < frontmatterEndLine; index += 1) {
    const line = stripTrailingCarriageReturn(lines[index] ?? "");
    if (!isStudylistKeyLine(line)) {
      continue;
    }

    let end = index + 1;
    while (end < frontmatterEndLine) {
      const nextLine = stripTrailingCarriageReturn(lines[end] ?? "");
      if (/^\S/.test(nextLine) && nextLine.includes(":")) {
        break;
      }
      end += 1;
    }
    ranges.push({ start: index, end });
    index = end - 1;
  }
  return ranges;
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

function buildPatchedFrontmatterLines(
  lines: string[],
  frontmatterEndLine: number,
  replacementLines: string[],
): string[] {
  const ranges = findStudylistFieldRanges(lines, frontmatterEndLine);
  const nextLines: string[] = [];

  if (ranges.length === 0) {
    return [
      ...lines.slice(1, frontmatterEndLine).map(stripTrailingCarriageReturn),
      ...replacementLines,
    ];
  }

  let cursor = 1;
  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
    const range = ranges[rangeIndex];
    nextLines.push(...lines.slice(cursor, range.start).map(stripTrailingCarriageReturn));
    if (rangeIndex === 0) {
      nextLines.push(...replacementLines);
    }
    cursor = range.end;
  }

  nextLines.push(...lines.slice(cursor, frontmatterEndLine).map(stripTrailingCarriageReturn));
  return nextLines;
}

function applyPatch(markdown: string, patch: StudylistFrontmatterPatch): string {
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

export function buildStudylistFrontmatterPatch(
  markdown: string,
  data: StudylistFrontmatterPatchData,
): StudylistFrontmatterPatch {
  const lines = markdown.split("\n");
  const frontmatterEndLine = findYamlFrontmatterEndLine(lines);
  const lineBreak = getLineBreak(markdown);
  const replacementLines = buildStudylistLines(data);

  if (frontmatterEndLine === null) {
    return {
      changed: true,
      from: { line: 0, ch: 0 },
      replacement: ["---", ...replacementLines, "---", ""].join(lineBreak) + lineBreak,
    };
  }

  const currentFrontmatterLines = lines.slice(1, frontmatterEndLine).map(stripTrailingCarriageReturn);
  const nextFrontmatterLines = buildPatchedFrontmatterLines(lines, frontmatterEndLine, replacementLines);
  const replacement = nextFrontmatterLines.length > 0 ? nextFrontmatterLines.join(lineBreak) + lineBreak : "";

  return {
    changed: !arraysEqual(currentFrontmatterLines, nextFrontmatterLines),
    from: { line: 1, ch: 0 },
    to: { line: frontmatterEndLine, ch: 0 },
    replacement,
  };
}

export function setStudylistFrontmatterInMarkdown(markdown: string, data: StudylistFrontmatterPatchData): string {
  return applyPatch(markdown, buildStudylistFrontmatterPatch(markdown, data));
}

export function applyStudylistFrontmatterPatchToEditor(editor: Editor, data: StudylistFrontmatterPatchData): boolean {
  const patch = buildStudylistFrontmatterPatch(editor.getValue(), data);
  if (!patch.changed) {
    return false;
  }

  editor.replaceRange(patch.replacement, patch.from, patch.to, "eudic-sync");
  return true;
}
