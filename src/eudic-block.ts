import { DEFAULT_SEMANTIC_BLOCK_KIND_PRESETS } from "./constants";
import type { SemanticBlockTransformOptions } from "./semantic-block-transform";
import { transformSemanticBlockBody } from "./semantic-block-transform";
import { trimBoundaryBlankLines } from "./word-body";

export const EUDIC_BLOCK_LANGUAGE = "eudic-block";
export const DEFAULT_EUDIC_BLOCK_KIND = "Cog.";
export const EUDIC_BLOCK_KIND_PRESETS = [...DEFAULT_SEMANTIC_BLOCK_KIND_PRESETS] as const;

export interface ParsedEudicBlockFence {
  indent: string;
  fenceToken: string;
  kind: string;
}

export interface EudicBlockAtLine extends ParsedEudicBlockFence {
  openingLine: number;
  closingLine: number | null;
}

export interface EudicBlockMatch extends ParsedEudicBlockFence {
  body: string;
  openingLine: number;
  closingLine: number;
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function hasLeadingBlankLine(markdown: string): boolean {
  const normalized = normalizeMarkdown(markdown);
  const firstLine = normalized.split("\n")[0] ?? "";
  return firstLine.trim().length === 0;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripOptionalQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return value.slice(1, -1).trim();
    }
  }

  return value;
}

function getLineKindRemainder(line: string, kind: string): string | null {
  const trimmed = line.trimStart();
  const markdownPrefix = `**${kind}**`;
  if (trimmed.toLowerCase().startsWith(markdownPrefix.toLowerCase())) {
    return trimmed.slice(markdownPrefix.length).replace(/^\s+/, "");
  }

  const htmlMatch = trimmed.match(
    new RegExp(`^<(?:b|strong)\\b[^>]*>${escapeForRegex(kind)}<\\/(?:b|strong)>(?:\\s+|$)`, "i"),
  );
  if (htmlMatch) {
    return trimmed.slice(htmlMatch[0].length);
  }

  if (trimmed.toLowerCase() === kind.toLowerCase()) {
    return "";
  }

  const plainMatch = trimmed.match(new RegExp(`^${escapeForRegex(kind)}(?:\\s+|$)`, "i"));
  if (plainMatch) {
    return trimmed.slice(plainMatch[0].length);
  }

  return null;
}

function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);
}

function separateListBlocksFromParagraphs(markdown: string): string {
  const lines = normalizeMarkdown(markdown).split("\n");
  const output: string[] = [];

  for (const line of lines) {
    const previousLine = output[output.length - 1] ?? "";
    if (isListLine(line) && previousLine.trim() && !isListLine(previousLine)) {
      output.push("");
    }

    output.push(line);
  }

  return output.join("\n");
}

function buildOpeningFenceLine(fence: ParsedEudicBlockFence): string {
  return `${fence.indent}${fence.fenceToken} ${EUDIC_BLOCK_LANGUAGE} kind=${fence.kind}`;
}

export function parseEudicBlockFenceLine(line: string): ParsedEudicBlockFence | null {
  const match = line.match(/^(\s*)(`{3,}|~{3,})\s*eudic-block(?:\s+(.*?))?\s*$/);
  if (!match) {
    return null;
  }

  const args = (match[3] ?? "").trim();
  const kindIndex = args.indexOf("kind=");
  if (kindIndex < 0) {
    return null;
  }

  const rawKind = stripOptionalQuotes(args.slice(kindIndex + 5).trim());
  if (!rawKind) {
    return null;
  }

  return {
    indent: match[1] ?? "",
    fenceToken: match[2] ?? "```",
    kind: rawKind,
  };
}

export function isClosingEudicBlockFenceLine(line: string, fenceToken: string): boolean {
  const escapedMarker = escapeForRegex(fenceToken[0] ?? "`");
  const minimumLength = fenceToken.length;
  return new RegExp(`^\\s*${escapedMarker}{${minimumLength},}\\s*$`).test(line);
}

export function renderEudicBlockToMarkdown(
  kind: string,
  rawBody: string,
  semanticOptions?: SemanticBlockTransformOptions | null,
): string {
  const transformedBody = semanticOptions ? transformSemanticBlockBody(kind, rawBody, semanticOptions) : rawBody;
  const stackedLayout = hasLeadingBlankLine(transformedBody);
  const normalizedBody = trimBoundaryBlankLines(normalizeMarkdown(transformedBody));
  if (!normalizedBody) {
    return `**${kind}**`;
  }

  const lines = normalizedBody.split("\n");
  const firstLine = lines[0] ?? "";
  const remainder = getLineKindRemainder(firstLine, kind);
  if (remainder !== null) {
    if (remainder.length === 0) {
      lines.shift();
    } else {
      lines[0] = remainder;
    }
  }

  const body = trimBoundaryBlankLines(lines.join("\n"));
  if (!body) {
    return `**${kind}**`;
  }

  const bodyLines = body.split("\n");
  if (stackedLayout || isListLine(bodyLines[0] ?? "")) {
    return separateListBlocksFromParagraphs(`**${kind}**\n${body}`);
  }

  bodyLines[0] = `**${kind}** ${bodyLines[0] ?? ""}`;
  return separateListBlocksFromParagraphs(bodyLines.join("\n"));
}

export function transformEudicBlocksToMarkdown(
  markdown: string,
  semanticOptions?: SemanticBlockTransformOptions | null,
): string {
  const normalizedMarkdown = normalizeMarkdown(markdown);
  if (!normalizedMarkdown.includes(EUDIC_BLOCK_LANGUAGE)) {
    return normalizedMarkdown;
  }

  const lines = normalizedMarkdown.split("\n");
  const output: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const openingFence = parseEudicBlockFenceLine(currentLine);
    if (!openingFence) {
      output.push(currentLine);
      continue;
    }

    let closingLineIndex: number | null = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if (isClosingEudicBlockFenceLine(lines[candidateIndex] ?? "", openingFence.fenceToken)) {
        closingLineIndex = candidateIndex;
        break;
      }
    }

    if (closingLineIndex === null) {
      output.push(currentLine);
      continue;
    }

    const body = lines.slice(lineIndex + 1, closingLineIndex).join("\n");
    output.push(renderEudicBlockToMarkdown(openingFence.kind, body, semanticOptions));
    lineIndex = closingLineIndex;
  }

  return output.join("\n");
}

export function findEudicBlockFenceForBody(markdown: string, rawBody: string): ParsedEudicBlockFence | null {
  const normalizedTargetBody = normalizeMarkdown(rawBody);
  const targetBody = trimBoundaryBlankLines(normalizeMarkdown(rawBody));
  const blocks = findEudicBlockMatches(markdown);

  for (const block of blocks) {
    if (normalizeMarkdown(block.body) === normalizedTargetBody) {
      return block;
    }
  }

  for (const block of blocks) {
    if (trimBoundaryBlankLines(block.body) === targetBody) {
      return block;
    }
  }

  return blocks.length === 1 ? blocks[0]! : null;
}

export function buildEudicBlock(kind: string, body: string, fenceToken = "```"): string {
  const normalizedBody = normalizeMarkdown(body);
  const openingLine = buildOpeningFenceLine({
    indent: "",
    fenceToken,
    kind,
  });
  const closingLine = fenceToken;

  if (!normalizedBody) {
    return `${openingLine}\n${closingLine}`;
  }

  return `${openingLine}\n${normalizedBody}${normalizedBody.endsWith("\n") ? "" : "\n"}${closingLine}`;
}

export function findEudicBlockAtLine(markdown: string, targetLine: number): EudicBlockAtLine | null {
  const lines = normalizeMarkdown(markdown).split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const openingFence = parseEudicBlockFenceLine(currentLine);
    if (!openingFence) {
      continue;
    }

    let closingLine: number | null = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if (isClosingEudicBlockFenceLine(lines[candidateIndex] ?? "", openingFence.fenceToken)) {
        closingLine = candidateIndex;
        break;
      }
    }

    const blockEndLine = closingLine ?? lines.length - 1;
    if (targetLine >= lineIndex && targetLine <= blockEndLine) {
      return {
        ...openingFence,
        openingLine: lineIndex,
        closingLine,
      };
    }

    lineIndex = blockEndLine;
  }

  return null;
}

function findEudicBlockMatches(markdown: string): EudicBlockMatch[] {
  const lines = normalizeMarkdown(markdown).split("\n");
  const blocks: EudicBlockMatch[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const openingFence = parseEudicBlockFenceLine(currentLine);
    if (!openingFence) {
      continue;
    }

    let closingLineIndex: number | null = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if (isClosingEudicBlockFenceLine(lines[candidateIndex] ?? "", openingFence.fenceToken)) {
        closingLineIndex = candidateIndex;
        break;
      }
    }

    if (closingLineIndex === null) {
      continue;
    }

    blocks.push({
      ...openingFence,
      openingLine: lineIndex,
      closingLine: closingLineIndex,
      body: lines.slice(lineIndex + 1, closingLineIndex).join("\n"),
    });
    lineIndex = closingLineIndex;
  }

  return blocks;
}

export function replaceEudicBlockKindInFenceLine(line: string, nextKind: string): string {
  const parsed = parseEudicBlockFenceLine(line);
  if (!parsed) {
    return line;
  }

  return buildOpeningFenceLine({
    indent: parsed.indent,
    fenceToken: parsed.fenceToken,
    kind: nextKind,
  });
}

function extractLeadingPresetKindFromBody(
  body: string,
  presetKinds: readonly string[],
): { kind: string | null; body: string } {
  const lines = normalizeMarkdown(body).split("\n");
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLineIndex < 0) {
    return {
      kind: null,
      body,
    };
  }

  const firstContentLine = lines[firstContentLineIndex] ?? "";
  for (const presetKind of normalizePresetKinds(presetKinds)) {
    const remainder = getLineKindRemainder(firstContentLine, presetKind);
    if (remainder === null) {
      continue;
    }

    if (remainder.length === 0) {
      lines.splice(firstContentLineIndex, 1);
    } else {
      lines[firstContentLineIndex] = `${firstContentLine.match(/^\s*/)?.[0] ?? ""}${remainder}`;
    }

    return {
      kind: presetKind,
      body: lines.join("\n"),
    };
  }

  return {
    kind: null,
    body,
  };
}

export function normalizeEudicBlockKindsFromBody(
  markdown: string,
  presetKinds: readonly string[],
): { markdown: string; changed: boolean; normalizedCount: number } {
  const normalizedMarkdown = normalizeMarkdown(markdown);
  if (!normalizedMarkdown.includes(EUDIC_BLOCK_LANGUAGE)) {
    return {
      markdown,
      changed: false,
      normalizedCount: 0,
    };
  }

  const lines = normalizedMarkdown.split("\n");
  const output: string[] = [];
  let changed = false;
  let normalizedCount = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const openingFence = parseEudicBlockFenceLine(currentLine);
    if (!openingFence) {
      output.push(currentLine);
      continue;
    }

    let closingLineIndex: number | null = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if (isClosingEudicBlockFenceLine(lines[candidateIndex] ?? "", openingFence.fenceToken)) {
        closingLineIndex = candidateIndex;
        break;
      }
    }

    if (closingLineIndex === null) {
      output.push(currentLine);
      continue;
    }

    const rawBody = lines.slice(lineIndex + 1, closingLineIndex).join("\n");
    const extracted = extractLeadingPresetKindFromBody(rawBody, presetKinds);
    if (!extracted.kind) {
      output.push(currentLine, ...lines.slice(lineIndex + 1, closingLineIndex + 1));
      lineIndex = closingLineIndex;
      continue;
    }

    const nextOpeningLine = replaceEudicBlockKindInFenceLine(currentLine, extracted.kind);
    const nextBodyLines = extracted.body.length > 0 ? extracted.body.split("\n") : [];
    output.push(nextOpeningLine, ...nextBodyLines, lines[closingLineIndex] ?? "");
    if (nextOpeningLine !== currentLine || extracted.body !== rawBody) {
      changed = true;
      normalizedCount += 1;
    }
    lineIndex = closingLineIndex;
  }

  return {
    markdown: output.join("\n"),
    changed,
    normalizedCount,
  };
}

export function extractLeadingPresetKind(markdown: string): { kind: string | null; markdown: string } {
  return extractLeadingPresetKindFromList(markdown, EUDIC_BLOCK_KIND_PRESETS);
}

function normalizePresetKinds(presetKinds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const presetKind of presetKinds) {
    const trimmed = presetKind.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized.sort((left, right) => right.length - left.length || left.localeCompare(right));
}

export function extractLeadingPresetKindFromList(
  markdown: string,
  presetKinds: readonly string[],
): { kind: string | null; markdown: string } {
  const normalized = trimBoundaryBlankLines(normalizeMarkdown(markdown));
  if (!normalized) {
    return {
      kind: null,
      markdown: "",
    };
  }

  const lines = normalized.split("\n");
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLineIndex < 0) {
    return {
      kind: null,
      markdown: normalized,
    };
  }

  const firstContentLine = lines[firstContentLineIndex] ?? "";
  for (const presetKind of normalizePresetKinds(presetKinds)) {
    const remainder = getLineKindRemainder(firstContentLine, presetKind);
    if (remainder === null) {
      continue;
    }

    if (remainder.length === 0) {
      lines.splice(firstContentLineIndex, 1);
    } else {
      lines[firstContentLineIndex] = remainder;
    }

    return {
      kind: presetKind,
      markdown: trimBoundaryBlankLines(lines.join("\n")),
    };
  }

  return {
    kind: null,
    markdown: normalized,
  };
}
