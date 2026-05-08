import { FRONTMATTER_KEYS } from "./constants";
import type { EudicSyncStatus } from "./types";

export interface StudylistWordModifyState {
  language: string;
  ids: string[];
  names: string[];
  status: EudicSyncStatus;
  disabled: boolean;
  lastError: string | null;
}

export interface StudylistAssignmentSnapshot {
  ids: string[];
  names: string[];
}

export interface StudylistAssignmentIntent {
  preferredSource: "names" | "ids";
  sourceIds: string[];
  sourceNames: string[];
}

export interface StudylistWordModifyAnalysis {
  disabled: boolean;
  language: string;
  ids: string[];
  names: string[];
  preferredSource: "names" | "ids";
  sourceIds: string[];
  sourceNames: string[];
  isResolved: boolean;
  shouldDirty: boolean;
  shouldWrite: boolean;
  nextStatus: EudicSyncStatus;
  nextLastError: string | null;
}

interface AnalyzeStudylistWordModifyOptions {
  state: StudylistWordModifyState;
  previousSnapshot?: StudylistAssignmentSnapshot;
  previousRawSnapshot?: StudylistAssignmentSnapshot;
  expectedCanonicalAssignment?: StudylistAssignmentSnapshot;
  activeIntent?: StudylistAssignmentIntent;
  markdown: string;
  refreshOnUnknown?: boolean;
  resolveAssignment: (
    language: string,
    assignment: { ids: string[]; names: string[]; preferredSource: "names" | "ids" },
    options?: { refreshOnUnknown?: boolean },
  ) => Promise<{ ids: string[]; names: string[]; unknownNames: string[]; unknownIds: string[] }>;
}

function normalizeId(value: string): string {
  return value.trim();
}

function uniqueNormalized(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    const value = normalizeId(rawValue);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
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

function getDiff(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((entry) => !rightSet.has(entry));
}

interface StudylistAssignmentDelta {
  idsChanged: boolean;
  namesChanged: boolean;
  addedIds: string[];
  removedIds: string[];
  addedNames: string[];
  removedNames: string[];
}

function getAssignmentDelta(previous: StudylistAssignmentSnapshot, current: StudylistAssignmentSnapshot): StudylistAssignmentDelta {
  return {
    idsChanged: !arraysEqual(previous.ids, current.ids),
    namesChanged: !arraysEqual(previous.names, current.names),
    addedIds: getDiff(current.ids, previous.ids),
    removedIds: getDiff(previous.ids, current.ids),
    addedNames: getDiff(current.names, previous.names),
    removedNames: getDiff(previous.names, current.names),
  };
}

function getPreferredSourceFromDelta(delta: StudylistAssignmentDelta): "names" | "ids" | null {
  if (!delta.idsChanged && !delta.namesChanged) {
    return null;
  }

  if (delta.idsChanged && !delta.namesChanged) {
    return "ids";
  }
  if (delta.namesChanged && !delta.idsChanged) {
    return "names";
  }

  if (delta.removedIds.length > 0 && delta.removedNames.length === 0) {
    return "ids";
  }
  if (delta.removedNames.length > 0 && delta.removedIds.length === 0) {
    return "names";
  }
  if (delta.addedIds.length > 0 && delta.addedNames.length === 0) {
    return "ids";
  }
  if (delta.addedNames.length > 0 && delta.addedIds.length === 0) {
    return "names";
  }

  return null;
}

function getPreferredSource(
  ids: string[],
  names: string[],
  previousSnapshot: StudylistAssignmentSnapshot | undefined,
  previousRawSnapshot: StudylistAssignmentSnapshot | undefined,
  expectedCanonicalAssignment: StudylistAssignmentSnapshot | undefined,
  activeIntent: StudylistAssignmentIntent | undefined,
): "names" | "ids" {
  const currentSnapshot = { ids, names };
  if (previousRawSnapshot) {
    const preferredSourceFromRawDelta = getPreferredSourceFromDelta(getAssignmentDelta(previousRawSnapshot, currentSnapshot));
    if (preferredSourceFromRawDelta) {
      return preferredSourceFromRawDelta;
    }
  }

  if (
    expectedCanonicalAssignment &&
    activeIntent &&
    arraysEqual(expectedCanonicalAssignment.ids, ids) &&
    arraysEqual(expectedCanonicalAssignment.names, names)
  ) {
    return activeIntent.preferredSource;
  }

  if (
    activeIntent &&
    arraysEqual(activeIntent.sourceIds, ids) &&
    arraysEqual(activeIntent.sourceNames, names)
  ) {
    return activeIntent.preferredSource;
  }

  if (!previousSnapshot) {
    return names.length > 0 ? "names" : "ids";
  }

  const namesChanged = !arraysEqual(previousSnapshot.names, names);
  const idsChanged = !arraysEqual(previousSnapshot.ids, ids);
  const preferredSourceFromCanonicalDelta = getPreferredSourceFromDelta(getAssignmentDelta(previousSnapshot, currentSnapshot));

  if (preferredSourceFromCanonicalDelta) {
    return preferredSourceFromCanonicalDelta;
  }
  if (idsChanged && !namesChanged) {
    return "ids";
  }
  if (namesChanged && !idsChanged) {
    return "names";
  }
  if (idsChanged && namesChanged) {
    return "names";
  }

  return names.length > 0 ? "names" : "ids";
}

function readYamlFrontmatter(markdown: string): string | null {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  return match?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripYamlQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function readYamlStringArray(markdown: string, key: string): string[] | null {
  const yaml = readYamlFrontmatter(markdown);
  if (!yaml) {
    return null;
  }

  const lines = yaml.split(/\r?\n/);
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(.*?)\\s*$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(keyPattern);
    if (!match) {
      continue;
    }

    const rawValue = (match[1] ?? "").trim();
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1).trim();
      if (!inner) {
        return [];
      }

      return uniqueNormalized(inner.split(",").map((entry) => stripYamlQuotes(entry)));
    }

    if (rawValue) {
      return uniqueNormalized([stripYamlQuotes(rawValue)]);
    }

    const values: string[] = [];
    for (let nestedIndex = index + 1; nestedIndex < lines.length; nestedIndex += 1) {
      const nestedLine = lines[nestedIndex] ?? "";
      const nestedMatch = nestedLine.match(/^\s*-\s*(.*?)\s*$/);
      if (!nestedMatch) {
        if (/^\S/.test(nestedLine)) {
          break;
        }
        continue;
      }

      values.push(stripYamlQuotes(nestedMatch[1] ?? ""));
    }

    return uniqueNormalized(values);
  }

  return null;
}

export function readStudylistAssignmentFromMarkdown(markdown: string): StudylistAssignmentSnapshot {
  return {
    ids: uniqueNormalized(readYamlStringArray(markdown, FRONTMATTER_KEYS.studylistIds) ?? []),
    names: uniqueNormalized(readYamlStringArray(markdown, FRONTMATTER_KEYS.studylistNames) ?? []),
  };
}

function readYamlStringValue(markdown: string, key: string): string | undefined {
  const yaml = readYamlFrontmatter(markdown);
  if (!yaml) {
    return undefined;
  }

  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(.*?)\\s*$`);
  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(keyPattern);
    if (match) {
      return stripYamlQuotes(match[1] ?? "").trim();
    }
  }

  return undefined;
}

function readStudylistStatusFromMarkdown(markdown: string, fallback: EudicSyncStatus): EudicSyncStatus {
  const value = readYamlStringValue(markdown, FRONTMATTER_KEYS.studylistSyncStatus);
  return value === "dirty" || value === "synced" ? value : fallback;
}

function getUnknownNamesError(names: string[]): string {
  return `Unknown Eudic studylist name(s): ${names.join(", ")} after refreshing Eudic studylists. Create the category in Eudic first or choose an existing category name.`;
}

function getUnknownIdsError(ids: string[]): string {
  return `Unknown Eudic studylist id(s): ${ids.join(", ")} after refreshing Eudic studylists. Refresh Eudic studylists or pull the word assignment from Eudic.`;
}

function getAssignmentError(unknownNames: string[], unknownIds: string[]): string | null {
  const messages: string[] = [];
  if (unknownNames.length > 0) {
    messages.push(getUnknownNamesError(unknownNames));
  }
  if (unknownIds.length > 0) {
    messages.push(getUnknownIdsError(unknownIds));
  }
  return messages.length > 0 ? messages.join(" ") : null;
}

export async function analyzeStudylistWordModify(
  options: AnalyzeStudylistWordModifyOptions,
): Promise<StudylistWordModifyAnalysis> {
  const {
    state,
    previousSnapshot,
    previousRawSnapshot,
    expectedCanonicalAssignment,
    activeIntent,
    markdown,
    refreshOnUnknown = true,
  } = options;
  if (state.disabled) {
    return {
      disabled: true,
      language: state.language,
      ids: [],
      names: [],
      preferredSource: "names",
      sourceIds: [],
      sourceNames: [],
      isResolved: true,
      shouldDirty: false,
      shouldWrite: false,
      nextStatus: "synced",
      nextLastError: null,
    };
  }

  const idsFromMarkdown = readYamlStringArray(markdown, FRONTMATTER_KEYS.studylistIds);
  const namesFromMarkdown = readYamlStringArray(markdown, FRONTMATTER_KEYS.studylistNames);
  const idsFromCurrentMarkdown = uniqueNormalized(idsFromMarkdown ?? state.ids);
  const namesFromCurrentMarkdown = uniqueNormalized(namesFromMarkdown ?? state.names);
  const statusFromCurrentMarkdown = readStudylistStatusFromMarkdown(markdown, state.status);
  const lastErrorFromMarkdown = readYamlStringValue(markdown, FRONTMATTER_KEYS.studylistLastError);
  const lastErrorFromCurrentMarkdown = lastErrorFromMarkdown === undefined ? null : lastErrorFromMarkdown || null;
  const preferredSource = getPreferredSource(
    idsFromCurrentMarkdown,
    namesFromCurrentMarkdown,
    previousSnapshot,
    previousRawSnapshot,
    expectedCanonicalAssignment,
    activeIntent,
  );
  const resolved = await options.resolveAssignment(
    state.language,
    {
      ids: idsFromCurrentMarkdown,
      names: namesFromCurrentMarkdown,
      preferredSource,
    },
    { refreshOnUnknown },
  );
  const normalizedIds = resolved.ids;
  const names = resolved.names;
  const nextLastError = getAssignmentError(resolved.unknownNames, resolved.unknownIds);
  const isResolved = nextLastError === null;

  const idsChanged =
    previousSnapshot === undefined ? !arraysEqual(state.ids, normalizedIds) : !arraysEqual(previousSnapshot.ids, normalizedIds);
  const shouldDirty = statusFromCurrentMarkdown === "dirty" || idsChanged || nextLastError !== null;
  const nextStatus: EudicSyncStatus = shouldDirty ? "dirty" : "synced";
  const shouldWrite =
    !arraysEqual(idsFromCurrentMarkdown, normalizedIds) ||
    !arraysEqual(namesFromCurrentMarkdown, names) ||
    !arraysEqual(state.ids, normalizedIds) ||
    !arraysEqual(state.names, names) ||
    statusFromCurrentMarkdown !== nextStatus ||
    lastErrorFromCurrentMarkdown !== nextLastError;

  return {
    disabled: false,
    language: state.language,
    ids: normalizedIds,
    names,
    preferredSource,
    sourceIds: idsFromCurrentMarkdown,
    sourceNames: namesFromCurrentMarkdown,
    isResolved,
    shouldDirty,
    shouldWrite,
    nextStatus,
    nextLastError,
  };
}
