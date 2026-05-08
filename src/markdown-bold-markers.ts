import {
  findContainingRange,
  formatBoldMarkersInMarkdownWithOptions,
  getProtectedRanges,
  isMarkerMatch,
  normalizeBoldMarkers,
  type BoldMarkerFormatResult,
} from "./markdown-marker-formatting";

export interface AutoBoldMarkerEdit {
  from: number;
  to: number;
  text: string;
  replacements: number;
}

interface AutoBoldMarkerInput {
  markdown: string;
  from: number;
  to: number;
  insertedText: string;
  markers: string[];
}

export function formatBoldMarkersInMarkdown(markdown: string, markers: string[]): BoldMarkerFormatResult {
  return formatBoldMarkersInMarkdownWithOptions(markdown, markers, {
    protectYamlFrontmatter: true,
    protectEudicBlockFences: true,
  });
}

export function findAutoBoldMarkerEdit(input: AutoBoldMarkerInput): AutoBoldMarkerEdit | null {
  const { markdown, from, to, insertedText } = input;
  const markers = normalizeBoldMarkers(input.markers);
  if (markers.length === 0 || insertedText.length === 0) {
    return null;
  }

  if (from === to && insertedText.length === 1 && !/\r|\n/.test(insertedText)) {
    const singleCharacterEdit = findSingleCharacterAutoBoldEdit(markdown, from, to, insertedText, markers);
    if (singleCharacterEdit) {
      return singleCharacterEdit;
    }
  }

  return findInsertedRangeAutoBoldEdit(markdown, from, to, insertedText, markers);
}

function findSingleCharacterAutoBoldEdit(
  markdown: string,
  from: number,
  to: number,
  insertedText: string,
  markers: string[],
): AutoBoldMarkerEdit | null {
  const nextMarkdown = `${markdown.slice(0, from)}${insertedText}${markdown.slice(to)}`;
  const cursor = from + insertedText.length;
  const protectedRanges = getProtectedRanges(nextMarkdown, {
    protectYamlFrontmatter: true,
    protectEudicBlockFences: true,
  });

  for (const marker of markers) {
    const markerStart = cursor - marker.length;
    if (markerStart < 0 || markerStart > from) {
      continue;
    }

    const candidate = `${markdown.slice(markerStart, from)}${insertedText}`;
    if (candidate !== marker) {
      continue;
    }

    if (!isMarkerMatch(nextMarkdown, markerStart, marker, protectedRanges)) {
      continue;
    }

    return {
      from: markerStart,
      to,
      text: `**${marker}**`,
      replacements: 1,
    };
  }

  return null;
}

function findInsertedRangeAutoBoldEdit(
  markdown: string,
  from: number,
  to: number,
  insertedText: string,
  markers: string[],
): AutoBoldMarkerEdit | null {
  const nextMarkdown = `${markdown.slice(0, from)}${insertedText}${markdown.slice(to)}`;
  const insertedFrom = from;
  const insertedTo = from + insertedText.length;
  const maxMarkerLength = markers[0]?.length ?? 0;
  const replaceFrom = Math.max(0, insertedFrom - Math.max(0, maxMarkerLength - 1));
  const replaceTo = Math.min(nextMarkdown.length, insertedTo + Math.max(0, maxMarkerLength - 1));
  const protectedRanges = getProtectedRanges(nextMarkdown, {
    protectYamlFrontmatter: true,
    protectEudicBlockFences: true,
  });
  let output = "";
  let replacements = 0;
  let index = replaceFrom;

  while (index < replaceTo) {
    const protectedRange = findContainingRange(protectedRanges, index);
    if (protectedRange) {
      const protectedTo = Math.min(protectedRange.to, replaceTo);
      output += nextMarkdown.slice(index, protectedTo);
      index = protectedTo;
      continue;
    }

    const marker = markers.find((candidate) =>
      isMarkerMatch(nextMarkdown, index, candidate, protectedRanges) &&
      rangesIntersect(index, index + candidate.length, insertedFrom, insertedTo),
    );
    if (marker) {
      output += `**${marker}**`;
      index += marker.length;
      replacements += 1;
      continue;
    }

    output += nextMarkdown[index] ?? "";
    index += 1;
  }

  if (replacements === 0) {
    return null;
  }

  const finalMarkdown = `${nextMarkdown.slice(0, replaceFrom)}${output}${nextMarkdown.slice(replaceTo)}`;
  return createMinimalDocumentEdit(markdown, finalMarkdown, replacements);
}

function createMinimalDocumentEdit(
  originalMarkdown: string,
  nextMarkdown: string,
  replacements: number,
): AutoBoldMarkerEdit | null {
  if (originalMarkdown === nextMarkdown) {
    return null;
  }

  let prefixLength = 0;
  const maxPrefixLength = Math.min(originalMarkdown.length, nextMarkdown.length);
  while (prefixLength < maxPrefixLength && originalMarkdown[prefixLength] === nextMarkdown[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffixLength = Math.min(originalMarkdown.length - prefixLength, nextMarkdown.length - prefixLength);
  while (
    suffixLength < maxSuffixLength &&
    originalMarkdown[originalMarkdown.length - 1 - suffixLength] === nextMarkdown[nextMarkdown.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    from: prefixLength,
    to: originalMarkdown.length - suffixLength,
    text: nextMarkdown.slice(prefixLength, nextMarkdown.length - suffixLength),
    replacements,
  };
}

function rangesIntersect(leftFrom: number, leftTo: number, rightFrom: number, rightTo: number): boolean {
  return leftFrom < rightTo && leftTo > rightFrom;
}
