import type { EudicSyncSettings } from "./types";
import {
  findContainingRange,
  formatBoldMarkersInMarkdownWithOptions,
  getProtectedRanges,
  isWordCharacter,
  rangeOverlaps,
  type ProtectedRange,
} from "./markdown-marker-formatting";

export interface SemanticBlockTransformOptions {
  boldWord: string;
  linkTargets: SemanticBlockLinkTarget[];
  enableWordBold: boolean;
  wordBoldKinds: string[];
  enableMarkerBold: boolean;
  boldMarkers: string[];
  enableWordLinks: boolean;
  wordLinkKinds: string[];
}

export interface SemanticBlockLinkTarget {
  word: string;
  linkUrl: string;
}

export interface SemanticBlockWordTarget {
  word: string;
  linkUrl: string | null;
}

interface NormalizedSemanticBlockLinkTarget extends SemanticBlockLinkTarget {
  normalizedWord: string;
}

interface TextAwareWordMatch {
  to: number;
  label: string;
}

function normalizeLiteralStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function normalizeWordKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeLinkTargets(targets: SemanticBlockLinkTarget[]): NormalizedSemanticBlockLinkTarget[] {
  const seen = new Set<string>();
  const normalized: NormalizedSemanticBlockLinkTarget[] = [];

  for (const target of targets) {
    const normalizedWord = normalizeWordKey(target.word);
    const linkUrl = target.linkUrl.trim();
    if (!normalizedWord || !linkUrl || seen.has(normalizedWord)) {
      continue;
    }

    seen.add(normalizedWord);
    normalized.push({
      word: target.word,
      linkUrl,
      normalizedWord,
    });
  }

  return normalized.sort((left, right) => right.normalizedWord.length - left.normalizedWord.length);
}

function matchesWordAt(markdown: string, index: number, normalizedWord: string): boolean {
  const end = index + normalizedWord.length;
  return markdown.slice(index, end).toLocaleLowerCase() === normalizedWord;
}

function isPrefixWordMatch(markdown: string, index: number, normalizedWord: string, protectedRanges: ProtectedRange[]): boolean {
  const end = index + normalizedWord.length;
  if (!matchesWordAt(markdown, index, normalizedWord)) {
    return false;
  }

  if (rangeOverlaps(protectedRanges, index, end)) {
    return false;
  }

  const previous = index > 0 ? markdown[index - 1] ?? "" : "";
  return !isWordCharacter(previous);
}

function findWordEnd(markdown: string, start: number): number {
  let end = start;
  while (end < markdown.length && isWordCharacter(markdown[end] ?? "")) {
    end += 1;
  }

  return end;
}

function readMarkdownEmphasisMarker(markdown: string, index: number): string | null {
  if (markdown.startsWith("**", index) || markdown.startsWith("__", index)) {
    return markdown.slice(index, index + 2);
  }

  return null;
}

function findPreviousRenderedCharacter(markdown: string, beforeIndex: number): string {
  let cursor = beforeIndex - 1;
  while (cursor >= 0) {
    if (cursor > 0 && readMarkdownEmphasisMarker(markdown, cursor - 1)) {
      cursor -= 2;
      continue;
    }

    return markdown[cursor] ?? "";
  }

  return "";
}

function findNextRenderedCharacter(markdown: string, fromIndex: number): string {
  let cursor = fromIndex;
  while (cursor < markdown.length) {
    const marker = readMarkdownEmphasisMarker(markdown, cursor);
    if (marker) {
      cursor += marker.length;
      continue;
    }

    return markdown[cursor] ?? "";
  }

  return "";
}

function hasMarkdownEmphasisMarker(markdown: string): boolean {
  return markdown.includes("**") || markdown.includes("__");
}

function findTextAwareWholeWordMatch(
  markdown: string,
  index: number,
  normalizedWord: string,
  protectedRanges: ProtectedRange[],
): TextAwareWordMatch | null {
  let cursor = index;
  let wordIndex = 0;
  let firstWordCharacterIndex: number | null = null;

  while (wordIndex < normalizedWord.length) {
    if (findContainingRange(protectedRanges, cursor)) {
      return null;
    }

    const marker = readMarkdownEmphasisMarker(markdown, cursor);
    if (marker) {
      cursor += marker.length;
      continue;
    }

    const current = markdown[cursor] ?? "";
    if (!current || current.toLocaleLowerCase() !== normalizedWord[wordIndex]) {
      return null;
    }

    firstWordCharacterIndex ??= cursor;
    cursor += 1;
    wordIndex += 1;
  }

  if (firstWordCharacterIndex === null) {
    return null;
  }

  while (cursor < markdown.length) {
    if (findContainingRange(protectedRanges, cursor)) {
      return null;
    }

    const marker = readMarkdownEmphasisMarker(markdown, cursor);
    if (!marker) {
      break;
    }

    cursor += marker.length;
  }

  const previous = findPreviousRenderedCharacter(markdown, index);
  const next = findNextRenderedCharacter(markdown, cursor);
  if (isWordCharacter(previous) || isWordCharacter(next)) {
    return null;
  }

  return {
    to: cursor,
    label: markdown.slice(index, cursor),
  };
}

function transformWordAutomation(
  markdown: string,
  linkTargets: NormalizedSemanticBlockLinkTarget[],
  normalizedWord: string,
  shouldLink: boolean,
  shouldBold: boolean,
): string {
  if (!shouldLink && !shouldBold) {
    return markdown;
  }

  const protectedRanges = getProtectedRanges(markdown, {
    protectYamlFrontmatter: false,
    protectEudicBlockFences: false,
    protectMarkdownEmphasis: false,
  });
  const boldProtectedRanges = getProtectedRanges(markdown, {
    protectYamlFrontmatter: false,
    protectEudicBlockFences: false,
    protectMarkdownEmphasis: true,
  });
  let output = "";
  let index = 0;

  while (index < markdown.length) {
    const protectedRange = findContainingRange(protectedRanges, index);
    if (protectedRange) {
      output += markdown.slice(index, protectedRange.to);
      index = protectedRange.to;
      continue;
    }

    const matchedTarget = shouldLink
      ? linkTargets
          .map((target) => ({
            target,
            match: findTextAwareWholeWordMatch(markdown, index, target.normalizedWord, protectedRanges),
          }))
          .find((candidate) => candidate.match)
      : undefined;
    if (matchedTarget) {
      const match = matchedTarget.match!;
      const shouldBoldLabel =
        shouldBold && matchedTarget.target.normalizedWord === normalizedWord && !hasMarkdownEmphasisMarker(match.label);
      const label = shouldBoldLabel ? `**${match.label}**` : match.label;
      output += `[${label}](${matchedTarget.target.linkUrl})`;
      index = match.to;
      continue;
    }

    if (shouldBold && isPrefixWordMatch(markdown, index, normalizedWord, boldProtectedRanges)) {
      const wordEnd = findWordEnd(markdown, index + normalizedWord.length);
      const matchedText = markdown.slice(index, wordEnd);
      output += `**${matchedText}**`;
      index = wordEnd;
      continue;
    }

    output += markdown[index] ?? "";
    index += 1;
  }

  return output;
}

function transformMarkerBold(markdown: string, markers: string[]): string {
  return formatBoldMarkersInMarkdownWithOptions(markdown, markers, {
    protectYamlFrontmatter: false,
    protectEudicBlockFences: false,
  }).markdown;
}

export function buildSemanticBlockTransformOptions(
  settings: Pick<
    EudicSyncSettings,
    | "enableSemanticBlockWordBold"
    | "semanticBlockWordBoldKinds"
    | "enableSemanticBlockMarkerBold"
    | "boldMarkers"
    | "enableSemanticBlockWordLinks"
    | "semanticBlockWordLinkKinds"
  >,
  boldWord: string,
  linkUrl: string | null,
  linkTargets?: SemanticBlockLinkTarget[],
): SemanticBlockTransformOptions {
  const trimmedLinkUrl = linkUrl?.trim() ?? "";
  const normalizedLinkTargets = linkTargets
    ? normalizeLinkTargets(linkTargets)
    : trimmedLinkUrl
      ? normalizeLinkTargets([{ word: boldWord, linkUrl: trimmedLinkUrl }])
      : [];

  return {
    boldWord,
    linkTargets: normalizedLinkTargets.map((target) => ({
      word: target.word,
      linkUrl: target.linkUrl,
    })),
    enableWordBold: settings.enableSemanticBlockWordBold,
    wordBoldKinds: settings.semanticBlockWordBoldKinds,
    enableMarkerBold: settings.enableSemanticBlockMarkerBold,
    boldMarkers: settings.boldMarkers,
    enableWordLinks: settings.enableSemanticBlockWordLinks,
    wordLinkKinds: settings.semanticBlockWordLinkKinds,
  };
}

export function mergeSemanticBlockLinkTargets(
  primaryTarget: SemanticBlockWordTarget | null,
  linkTargets: SemanticBlockLinkTarget[],
): SemanticBlockLinkTarget[] {
  const merged: SemanticBlockLinkTarget[] = [];
  if (primaryTarget?.linkUrl) {
    merged.push({
      word: primaryTarget.word,
      linkUrl: primaryTarget.linkUrl,
    });
  }

  merged.push(...linkTargets);
  return normalizeLinkTargets(merged).map((target) => ({
    word: target.word,
    linkUrl: target.linkUrl,
  }));
}

export function buildWordSemanticBlockTransformOptions(
  settings: Pick<
    EudicSyncSettings,
    | "enableSemanticBlockWordBold"
    | "semanticBlockWordBoldKinds"
    | "enableSemanticBlockMarkerBold"
    | "boldMarkers"
    | "enableSemanticBlockWordLinks"
    | "semanticBlockWordLinkKinds"
  >,
  currentWordTarget: SemanticBlockWordTarget | null,
): SemanticBlockTransformOptions {
  return buildSemanticBlockTransformOptions(
    settings,
    currentWordTarget?.word ?? "",
    currentWordTarget?.linkUrl ?? null,
  );
}

export function buildReferenceSemanticBlockTransformOptions(
  settings: Pick<
    EudicSyncSettings,
    | "enableSemanticBlockWordBold"
    | "semanticBlockWordBoldKinds"
    | "enableSemanticBlockMarkerBold"
    | "boldMarkers"
    | "enableSemanticBlockWordLinks"
    | "semanticBlockWordLinkKinds"
  >,
  boldWord: string | null,
  linkTargets: SemanticBlockLinkTarget[],
): SemanticBlockTransformOptions {
  return buildSemanticBlockTransformOptions(settings, boldWord ?? "", null, linkTargets);
}

export function transformSemanticBlockBody(
  kind: string,
  rawBody: string,
  options?: SemanticBlockTransformOptions | null,
): string {
  if (!options) {
    return rawBody;
  }

  const normalizedWord = normalizeWordKey(options.boldWord);
  const linkTargets = normalizeLinkTargets(options.linkTargets);
  const normalizedKind = kind.trim();
  const linkKinds = normalizeLiteralStrings(options.wordLinkKinds);
  const boldKinds = normalizeLiteralStrings(options.wordBoldKinds);
  const shouldLink = options.enableWordLinks && linkTargets.length > 0 && linkKinds.includes(normalizedKind);
  const shouldBold = options.enableWordBold && !!normalizedWord && boldKinds.includes(normalizedKind);
  let transformedBody = transformWordAutomation(rawBody, linkTargets, normalizedWord, shouldLink, shouldBold);

  if (options.enableMarkerBold && options.boldMarkers.length > 0) {
    transformedBody = transformMarkerBold(transformedBody, options.boldMarkers);
  }

  return transformedBody;
}
