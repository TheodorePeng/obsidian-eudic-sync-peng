import type { Editor, EditorPosition } from "obsidian";
import { FRONTMATTER_KEYS } from "./constants";
import type { EudicSyncStatus } from "./types";

export interface SyncStatusPatch {
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

function buildSyncStatusLine(status: EudicSyncStatus, indent = ""): string {
  return `${indent}${FRONTMATTER_KEYS.syncStatus}: ${status}`;
}

export function buildSyncStatusPatch(markdown: string, status: EudicSyncStatus): SyncStatusPatch {
  const lines = markdown.split("\n");
  const frontmatterEndLine = findYamlFrontmatterEndLine(lines);
  const lineBreak = getLineBreak(markdown);

  if (frontmatterEndLine === null) {
    return {
      changed: true,
      from: { line: 0, ch: 0 },
      replacement: ["---", buildSyncStatusLine(status), "---", ""].join(lineBreak) + lineBreak,
    };
  }

  const syncStatusPattern = new RegExp(`^(\\s*)${FRONTMATTER_KEYS.syncStatus}\\s*:\\s*(.*?)\\s*$`);
  for (let lineIndex = 1; lineIndex < frontmatterEndLine; lineIndex += 1) {
    const line = stripTrailingCarriageReturn(lines[lineIndex] ?? "");
    const match = line.match(syncStatusPattern);
    if (!match) {
      continue;
    }

    const indent = match[1] ?? "";
    const replacement = buildSyncStatusLine(status, indent);
    return {
      changed: line !== replacement,
      from: { line: lineIndex, ch: 0 },
      to: { line: lineIndex, ch: line.length },
      replacement,
    };
  }

  return {
    changed: true,
    from: { line: frontmatterEndLine, ch: 0 },
    replacement: `${buildSyncStatusLine(status)}${lineBreak}`,
  };
}

export function setSyncStatusInMarkdown(markdown: string, status: EudicSyncStatus): string {
  const patch = buildSyncStatusPatch(markdown, status);
  if (!patch.changed) {
    return markdown;
  }

  const lines = markdown.split("\n");
  if (!patch.to) {
    const prefix = lines.slice(0, patch.from.line).join("\n");
    const suffix = lines.slice(patch.from.line).join("\n");
    return `${prefix}${prefix ? "\n" : ""}${patch.replacement}${suffix}`;
  }

  lines[patch.from.line] = patch.replacement;
  return lines.join("\n");
}

export function applySyncStatusPatchToEditor(editor: Editor, status: EudicSyncStatus): boolean {
  const patch = buildSyncStatusPatch(editor.getValue(), status);
  if (!patch.changed) {
    return true;
  }

  editor.replaceRange(patch.replacement, patch.from, patch.to, "eudic-sync");
  return true;
}
