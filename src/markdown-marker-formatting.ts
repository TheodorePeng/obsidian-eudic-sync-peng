export interface BoldMarkerFormatResult {
  markdown: string;
  changed: boolean;
  replacements: number;
}

export interface ProtectedRange {
  from: number;
  to: number;
}

export interface BoldMarkerProtectionOptions {
  protectYamlFrontmatter?: boolean;
  protectEudicBlockFences?: boolean;
  protectMarkdownEmphasis?: boolean;
}

const URL_PATTERN = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>()]+/g;
const EUDIC_BLOCK_OPENING_FENCE_PATTERN = /^(\s*)(`{3,}|~{3,})\s*eudic-block(?:\s+(.*?))?\s*$/;

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseEudicBlockFenceToken(line: string): string | null {
  const match = line.match(EUDIC_BLOCK_OPENING_FENCE_PATTERN);
  if (!match) {
    return null;
  }

  const args = (match[3] ?? "").trim();
  if (!/\bkind=/.test(args)) {
    return null;
  }

  return match[2] ?? null;
}

function isClosingEudicBlockFenceLine(line: string, fenceToken: string): boolean {
  const escapedMarker = escapeForRegex(fenceToken[0] ?? "`");
  return new RegExp(`^\\s*${escapedMarker}{${fenceToken.length},}\\s*$`).test(line);
}

export function normalizeBoldMarkers(markers: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const marker of markers) {
    const trimmed = marker.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized.sort((left, right) => right.length - left.length);
}

export function isWordCharacter(value: string): boolean {
  return /[A-Za-z0-9_]/.test(value);
}

export function rangeOverlaps(ranges: ProtectedRange[], from: number, to: number): boolean {
  return ranges.some((range) => from < range.to && to > range.from);
}

export function findContainingRange(ranges: ProtectedRange[], index: number): ProtectedRange | null {
  return ranges.find((range) => index >= range.from && index < range.to) ?? null;
}

function collectYamlFrontmatterRange(markdown: string, ranges: ProtectedRange[]): void {
  const match = markdown.match(/^---\s*\n[\s\S]*?\n---(?:\s*\n|$)/);
  if (!match) {
    return;
  }

  ranges.push({ from: 0, to: match[0].length });
}

function collectInlineRegexRanges(markdown: string, pattern: RegExp, ranges: ProtectedRange[]): void {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(markdown); match; match = pattern.exec(markdown)) {
    ranges.push({
      from: match.index,
      to: match.index + match[0].length,
    });
  }
}

function collectFencedCodeRanges(
  markdown: string,
  ranges: ProtectedRange[],
  options: Required<BoldMarkerProtectionOptions>,
): void {
  const lines = markdown.split(/(\n)/);
  let offset = 0;
  let genericFenceStart: number | null = null;
  let genericFenceMarker: string | null = null;
  let eudicBlockFenceToken: string | null = null;

  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index] ?? "";
    const newline = lines[index + 1] ?? "";
    const lineWithNewline = `${line}${newline}`;
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);

    if (genericFenceStart !== null) {
      if (fenceMatch && genericFenceMarker === fenceMatch[1]![0]) {
        ranges.push({ from: genericFenceStart, to: offset + lineWithNewline.length });
        genericFenceStart = null;
        genericFenceMarker = null;
      }

      offset += lineWithNewline.length;
      continue;
    }

    if (eudicBlockFenceToken !== null) {
      if (isClosingEudicBlockFenceLine(line, eudicBlockFenceToken)) {
        ranges.push({ from: offset, to: offset + lineWithNewline.length });
        eudicBlockFenceToken = null;
      }

      offset += lineWithNewline.length;
      continue;
    }

    if (options.protectEudicBlockFences) {
      const eudicFenceToken = parseEudicBlockFenceToken(line);
      if (eudicFenceToken) {
        ranges.push({ from: offset, to: offset + lineWithNewline.length });
        eudicBlockFenceToken = eudicFenceToken;
        offset += lineWithNewline.length;
        continue;
      }
    }

    if (fenceMatch) {
      genericFenceStart = offset;
      genericFenceMarker = fenceMatch[1]![0];
    }

    offset += lineWithNewline.length;
  }

  if (genericFenceStart !== null) {
    ranges.push({ from: genericFenceStart, to: markdown.length });
  }
}

function mergeRanges(ranges: ProtectedRange[]): ProtectedRange[] {
  const sorted = ranges
    .filter((range) => range.to > range.from)
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: ProtectedRange[] = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.from > previous.to) {
      merged.push({ ...range });
      continue;
    }

    previous.to = Math.max(previous.to, range.to);
  }

  return merged;
}

export function getProtectedRanges(
  markdown: string,
  options: BoldMarkerProtectionOptions = {},
): ProtectedRange[] {
  const resolved: Required<BoldMarkerProtectionOptions> = {
    protectYamlFrontmatter: options.protectYamlFrontmatter ?? true,
    protectEudicBlockFences: options.protectEudicBlockFences ?? true,
    protectMarkdownEmphasis: options.protectMarkdownEmphasis ?? true,
  };
  const ranges: ProtectedRange[] = [];

  if (resolved.protectYamlFrontmatter) {
    collectYamlFrontmatterRange(markdown, ranges);
  }

  collectFencedCodeRanges(markdown, ranges, resolved);
  collectInlineRegexRanges(markdown, /`[^`\n]+`/g, ranges);
  if (resolved.protectMarkdownEmphasis) {
    collectInlineRegexRanges(markdown, /\*\*[\s\S]*?\*\*/g, ranges);
    collectInlineRegexRanges(markdown, /__[\s\S]*?__/g, ranges);
  }
  collectInlineRegexRanges(markdown, /<\s*(?:b|strong)\b[^>]*>[\s\S]*?<\s*\/\s*(?:b|strong)\s*>/gi, ranges);
  collectInlineRegexRanges(markdown, /<\s*a\b[^>]*>[\s\S]*?<\s*\/\s*a\s*>/gi, ranges);
  collectInlineRegexRanges(markdown, /!?\[[^\]\n]*\]\([^) \n]*(?: [^)\n]*)?\)/g, ranges);
  collectInlineRegexRanges(markdown, /\[\[[^\]\n]+\]\]/g, ranges);
  collectInlineRegexRanges(markdown, /<\/?[A-Za-z][^>\n]*>/g, ranges);
  collectInlineRegexRanges(markdown, URL_PATTERN, ranges);

  return mergeRanges(ranges);
}

export function isMarkerMatch(markdown: string, index: number, marker: string, protectedRanges: ProtectedRange[]): boolean {
  const end = index + marker.length;
  if (!markdown.startsWith(marker, index)) {
    return false;
  }

  if (rangeOverlaps(protectedRanges, index, end)) {
    return false;
  }

  const previous = index > 0 ? markdown[index - 1] ?? "" : "";
  const next = end < markdown.length ? markdown[end] ?? "" : "";
  if (isWordCharacter(previous) || isWordCharacter(next)) {
    return false;
  }

  return true;
}

export function formatBoldMarkersInMarkdownWithOptions(
  markdown: string,
  markers: string[],
  options: BoldMarkerProtectionOptions = {},
): BoldMarkerFormatResult {
  const normalizedMarkers = normalizeBoldMarkers(markers);
  if (normalizedMarkers.length === 0 || markdown.length === 0) {
    return {
      markdown,
      changed: false,
      replacements: 0,
    };
  }

  const protectedRanges = getProtectedRanges(markdown, options);
  let output = "";
  let replacements = 0;
  let index = 0;

  while (index < markdown.length) {
    const protectedRange = findContainingRange(protectedRanges, index);
    if (protectedRange) {
      output += markdown.slice(index, protectedRange.to);
      index = protectedRange.to;
      continue;
    }

    const marker = normalizedMarkers.find((candidate) =>
      isMarkerMatch(markdown, index, candidate, protectedRanges),
    );
    if (marker) {
      output += `**${marker}**`;
      index += marker.length;
      replacements += 1;
      continue;
    }

    output += markdown[index] ?? "";
    index += 1;
  }

  return {
    markdown: output,
    changed: replacements > 0,
    replacements,
  };
}
