import type { App, TFile } from "obsidian";
import type { PathScope } from "./path-scope";
import { resolveManagedReferencePath } from "./reference-links";
import { stripYamlFrontmatter, trimBoundaryBlankLines } from "./word-body";

const EMBED_PATTERN = /!\[\[([^[\]\n]+)\]\]/g;
const MAX_REFERENCE_EMBED_DEPTH = 4;

export interface ParsedReferenceEmbedTarget {
  linkpath: string;
  blockId: string | null;
}

export interface ExpandedReferenceMarkdownSegment {
  markdown: string;
  sourcePath: string;
  embeddedFromPath?: string;
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAlias(rawTarget: string): string {
  return rawTarget.split("|")[0]?.trim() ?? rawTarget.trim();
}

export function parseReferenceEmbedTarget(rawTarget: string): ParsedReferenceEmbedTarget {
  const targetWithoutAlias = stripAlias(rawTarget);
  const hashIndex = targetWithoutAlias.indexOf("#");
  const linkpath = (hashIndex >= 0 ? targetWithoutAlias.slice(0, hashIndex) : targetWithoutAlias).trim();
  const subpath = hashIndex >= 0 ? targetWithoutAlias.slice(hashIndex + 1).trim() : "";

  return {
    linkpath,
    blockId: subpath.startsWith("^") ? subpath.slice(1).trim() || null : null,
  };
}

function isStandaloneBlockAnchorLine(line: string, blockId: string): boolean {
  return new RegExp(`^\\s*\\^${escapeForRegex(blockId)}\\s*$`).test(line);
}

function stripInlineBlockAnchor(line: string, blockId: string): string | null {
  const pattern = new RegExp(`^(.*?)(?:\\s+)\\^${escapeForRegex(blockId)}\\s*$`);
  const match = line.match(pattern);
  if (!match) {
    return null;
  }

  return (match[1] ?? "").replace(/\s+$/, "");
}

function stripAnyInlineBlockAnchor(line: string): string {
  return line.replace(/\s+\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/, "");
}

export function stripReferenceBlockAnchors(markdown: string): string {
  const lines = normalizeMarkdown(markdown).split("\n");
  const output: string[] = [];

  for (const line of lines) {
    if (/^\s*\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/.test(line)) {
      continue;
    }

    output.push(stripAnyInlineBlockAnchor(line));
  }

  return trimBoundaryBlankLines(output.join("\n"));
}

function findOpeningFenceLine(lines: string[], closingLineIndex: number): number | null {
  const closingLine = lines[closingLineIndex] ?? "";
  const closingMatch = closingLine.match(/^\s*(`{3,}|~{3,})\s*$/);
  if (!closingMatch) {
    return null;
  }

  const fenceToken = closingMatch[1] ?? "";
  const fenceCharacter = fenceToken[0] ?? "`";
  const minimumLength = fenceToken.length;
  const fencePattern = new RegExp(`^\\s*${escapeForRegex(fenceCharacter)}{${minimumLength},}`);

  for (let lineIndex = closingLineIndex - 1; lineIndex >= 0; lineIndex -= 1) {
    if (fencePattern.test(lines[lineIndex] ?? "")) {
      return lineIndex;
    }
  }

  return null;
}

function findPreviousContentLine(lines: string[], anchorLineIndex: number): number | null {
  for (let lineIndex = anchorLineIndex - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = lines[lineIndex] ?? "";
    if (line.trim().length > 0) {
      return lineIndex;
    }
  }

  return null;
}

function findContiguousBlockStart(lines: string[], endLineIndex: number): number {
  let startLineIndex = endLineIndex;

  while (startLineIndex > 0) {
    const previousLine = lines[startLineIndex - 1] ?? "";
    if (!previousLine.trim() || /^\s*\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/.test(previousLine)) {
      break;
    }

    startLineIndex -= 1;
  }

  return startLineIndex;
}

function findContiguousBlockEnd(lines: string[], startLineIndex: number): number {
  let endLineIndex = startLineIndex;

  while (endLineIndex < lines.length - 1) {
    const nextLine = lines[endLineIndex + 1] ?? "";
    if (!nextLine.trim() || /^\s*\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/.test(nextLine)) {
      break;
    }

    endLineIndex += 1;
  }

  return endLineIndex;
}

export function extractReferenceMarkdownByBlockId(markdown: string, blockId: string): string | null {
  const body = stripYamlFrontmatter(normalizeMarkdown(markdown));
  const lines = body.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (!isStandaloneBlockAnchorLine(lines[lineIndex] ?? "", blockId)) {
      continue;
    }

    const contentLineIndex = findPreviousContentLine(lines, lineIndex);
    if (contentLineIndex === null) {
      return null;
    }

    const openingFenceLine = findOpeningFenceLine(lines, contentLineIndex);
    if (openingFenceLine !== null) {
      return trimBoundaryBlankLines(lines.slice(openingFenceLine, contentLineIndex + 1).join("\n"));
    }

    const blockStart = findContiguousBlockStart(lines, contentLineIndex);
    return trimBoundaryBlankLines(lines.slice(blockStart, contentLineIndex + 1).join("\n"));
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const strippedLine = stripInlineBlockAnchor(lines[lineIndex] ?? "", blockId);
    if (strippedLine === null) {
      continue;
    }

    const blockStart = findContiguousBlockStart(lines, lineIndex);
    const blockEnd = findContiguousBlockEnd(lines, lineIndex);
    const blockLines = lines.slice(blockStart, blockEnd + 1);
    blockLines[lineIndex - blockStart] = strippedLine;
    return trimBoundaryBlankLines(blockLines.join("\n"));
  }

  return null;
}

async function readExpandedReferenceMarkdown(
  app: App,
  pathScope: PathScope,
  referenceFile: TFile,
  blockId: string | null,
  visited: Set<string>,
  depth: number,
): Promise<string | null> {
  const visitKey = `${referenceFile.path}#${blockId ?? ""}`;
  if (visited.has(visitKey)) {
    return null;
  }

  const rawMarkdown = await app.vault.cachedRead(referenceFile);
  const referenceMarkdown = blockId
    ? extractReferenceMarkdownByBlockId(rawMarkdown, blockId)
    : stripReferenceBlockAnchors(stripYamlFrontmatter(rawMarkdown));

  if (!referenceMarkdown) {
    return null;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(visitKey);
  return expandManagedReferenceEmbedsInMarkdown(app, pathScope, referenceMarkdown, referenceFile.path, nextVisited, depth + 1);
}

async function readExpandedReferenceMarkdownSegments(
  app: App,
  pathScope: PathScope,
  referenceFile: TFile,
  blockId: string | null,
  visited: Set<string>,
  depth: number,
  embeddedFromPath: string,
): Promise<ExpandedReferenceMarkdownSegment[] | null> {
  const visitKey = `${referenceFile.path}#${blockId ?? ""}`;
  if (visited.has(visitKey)) {
    return null;
  }

  const rawMarkdown = await app.vault.cachedRead(referenceFile);
  const referenceMarkdown = blockId
    ? extractReferenceMarkdownByBlockId(rawMarkdown, blockId)
    : stripReferenceBlockAnchors(stripYamlFrontmatter(rawMarkdown));

  if (!referenceMarkdown) {
    return null;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(visitKey);
  return expandManagedReferenceEmbedsInMarkdownSegments(
    app,
    pathScope,
    referenceMarkdown,
    referenceFile.path,
    nextVisited,
    depth + 1,
    embeddedFromPath,
  );
}

function pushSegment(segments: ExpandedReferenceMarkdownSegment[], segment: ExpandedReferenceMarkdownSegment): void {
  if (!segment.markdown) {
    return;
  }

  const previous = segments[segments.length - 1];
  if (previous && previous.sourcePath === segment.sourcePath && previous.embeddedFromPath === segment.embeddedFromPath) {
    previous.markdown += segment.markdown;
    return;
  }

  segments.push({ ...segment });
}

export async function expandManagedReferenceEmbedsInMarkdownSegments(
  app: App,
  pathScope: PathScope,
  markdown: string,
  sourcePath: string,
  visited = new Set<string>(),
  depth = 0,
  embeddedFromPath?: string,
): Promise<ExpandedReferenceMarkdownSegment[]> {
  if (depth >= MAX_REFERENCE_EMBED_DEPTH || !markdown.includes("![[") || !markdown.includes("]]")) {
    return [{ markdown, sourcePath, embeddedFromPath }];
  }

  const normalizedMarkdown = normalizeMarkdown(markdown);
  const output: ExpandedReferenceMarkdownSegment[] = [];
  let cursor = 0;

  for (const match of normalizedMarkdown.matchAll(EMBED_PATTERN)) {
    const index = match.index ?? 0;
    const rawTarget = match[1] ?? "";
    const parsedTarget = parseReferenceEmbedTarget(rawTarget);
    const referencePath = resolveManagedReferencePath(app, pathScope, sourcePath, parsedTarget.linkpath);
    const referenceFile = referencePath ? app.vault.getFileByPath(referencePath) : null;

    pushSegment(output, {
      markdown: normalizedMarkdown.slice(cursor, index),
      sourcePath,
      embeddedFromPath,
    });
    cursor = index + match[0].length;

    if (!referenceFile) {
      pushSegment(output, {
        markdown: match[0],
        sourcePath,
        embeddedFromPath,
      });
      continue;
    }

    const expandedSegments = await readExpandedReferenceMarkdownSegments(
      app,
      pathScope,
      referenceFile,
      parsedTarget.blockId,
      visited,
      depth,
      sourcePath,
    );
    if (!expandedSegments) {
      pushSegment(output, {
        markdown: match[0],
        sourcePath,
        embeddedFromPath,
      });
      continue;
    }

    for (const segment of expandedSegments) {
      pushSegment(output, segment);
    }
  }

  pushSegment(output, {
    markdown: normalizedMarkdown.slice(cursor),
    sourcePath,
    embeddedFromPath,
  });
  return output.length > 0 ? output : [{ markdown, sourcePath, embeddedFromPath }];
}

export async function expandManagedReferenceEmbedsInMarkdown(
  app: App,
  pathScope: PathScope,
  markdown: string,
  sourcePath: string,
  visited = new Set<string>(),
  depth = 0,
): Promise<string> {
  if (depth >= MAX_REFERENCE_EMBED_DEPTH || !markdown.includes("![[") || !markdown.includes("]]")) {
    return markdown;
  }

  const normalizedMarkdown = normalizeMarkdown(markdown);
  let output = "";
  let cursor = 0;
  let changed = false;

  for (const match of normalizedMarkdown.matchAll(EMBED_PATTERN)) {
    const index = match.index ?? 0;
    const rawTarget = match[1] ?? "";
    const parsedTarget = parseReferenceEmbedTarget(rawTarget);
    const referencePath = resolveManagedReferencePath(app, pathScope, sourcePath, parsedTarget.linkpath);
    const referenceFile = referencePath ? app.vault.getFileByPath(referencePath) : null;

    output += normalizedMarkdown.slice(cursor, index);
    cursor = index + match[0].length;

    if (!referenceFile) {
      output += match[0];
      continue;
    }

    const expandedMarkdown = await readExpandedReferenceMarkdown(
      app,
      pathScope,
      referenceFile,
      parsedTarget.blockId,
      visited,
      depth,
    );
    if (!expandedMarkdown) {
      output += match[0];
      continue;
    }

    changed = true;
    output += expandedMarkdown;
  }

  output += normalizedMarkdown.slice(cursor);
  return changed ? output : markdown;
}
