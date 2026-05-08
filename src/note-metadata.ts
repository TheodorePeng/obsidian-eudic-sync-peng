import type { App, TFile } from "obsidian";
import { FRONTMATTER_KEYS, SYNC_STATUSES } from "./constants";
import type { EudicSyncStatus, WordNoteContext } from "./types";
import type { PathScope } from "./path-scope";
import { readStudylistSyncStatus } from "./studylist-sync-status";
export { stripYamlFrontmatter } from "./word-body";

export function getFrontmatter(app: App, file: TFile): Record<string, unknown> {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter || typeof frontmatter !== "object") {
    return {};
  }
  return frontmatter as Record<string, unknown>;
}

export function isWordSyncExplicitlyDisabled(app: App, file: TFile): boolean {
  const frontmatter = getFrontmatter(app, file);
  return isWordSyncDisabledFrontmatter(frontmatter);
}

export function isWordSyncDisabledFrontmatter(frontmatter: Record<string, unknown>): boolean {
  const syncEnabled = frontmatter[FRONTMATTER_KEYS.syncEudicEnabled];
  if (typeof syncEnabled === "boolean") {
    return !syncEnabled;
  }

  return frontmatter[FRONTMATTER_KEYS.eudicSync] === false;
}

export function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function stringArraysEqual(left: string[], right: string[]): boolean {
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

export function getConfiguredWord(frontmatter: Record<string, unknown>, file: TFile): string {
  return readNullableString(frontmatter[FRONTMATTER_KEYS.word]) ?? file.basename;
}

export function normalizeAliasesValue(value: unknown, mainWord: string): string[] {
  const rawAliases = typeof value === "string" ? [value] : readStringArray(value);
  const normalizedAliases: string[] = [];
  const seen = new Set<string>();
  const normalizedMainWord = mainWord.trim().toLocaleLowerCase();

  for (const alias of rawAliases) {
    const trimmedAlias = alias.trim();
    if (!trimmedAlias) {
      continue;
    }

    const dedupeKey = trimmedAlias.toLocaleLowerCase();
    if (!dedupeKey || dedupeKey === normalizedMainWord || seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalizedAliases.push(trimmedAlias);
  }

  return normalizedAliases;
}

export function getNormalizedAliases(frontmatter: Record<string, unknown>, file: TFile): string[] {
  return normalizeAliasesValue(frontmatter[FRONTMATTER_KEYS.aliases], getConfiguredWord(frontmatter, file));
}

export function aliasesNeedRewrite(frontmatter: Record<string, unknown>, file: TFile): boolean {
  const rawAliases = frontmatter[FRONTMATTER_KEYS.aliases];
  if (!Array.isArray(rawAliases)) {
    return true;
  }

  const normalizedAliases = getNormalizedAliases(frontmatter, file);
  const currentAliases = rawAliases
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return !stringArraysEqual(currentAliases, normalizedAliases);
}

function readBodyStatus(frontmatter: Record<string, unknown>): EudicSyncStatus {
  const rawStatus = readNullableString(frontmatter[FRONTMATTER_KEYS.syncStatus]);

  if (rawStatus === "synced") {
    return "synced";
  }

  if (rawStatus === "dirty" || rawStatus === "draft" || rawStatus === "syncing" || rawStatus === "error") {
    return "dirty";
  }

  if (rawStatus && SYNC_STATUSES.has(rawStatus as EudicSyncStatus)) {
    return rawStatus as EudicSyncStatus;
  }

  if (readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedHash])) {
    return "synced";
  }

  return "dirty";
}

function readEffectiveStatus(frontmatter: Record<string, unknown>): EudicSyncStatus {
  return readBodyStatus(frontmatter) === "dirty" || readStudylistSyncStatus(frontmatter) === "dirty"
    ? "dirty"
    : "synced";
}

export function getWordNoteContext(app: App, pathScope: PathScope, file: TFile): WordNoteContext | null {
  if (!pathScope.isWordPath(file.path)) {
    return null;
  }

  const frontmatter = getFrontmatter(app, file);
  if (isWordSyncDisabledFrontmatter(frontmatter)) {
    return null;
  }

  const explicitLang = readNullableString(frontmatter[FRONTMATTER_KEYS.lang]);
  const storedStatus = readNullableString(frontmatter[FRONTMATTER_KEYS.syncStatus]);

  return {
    file,
    word: getConfiguredWord(frontmatter, file),
    lang: explicitLang,
    storedStatus,
    bodyStatus: readBodyStatus(frontmatter),
    studylistStatus: readStudylistSyncStatus(frontmatter),
    effectiveStatus: readEffectiveStatus(frontmatter),
    lastSyncedHash: readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedHash]),
    syncedAt: readNullableString(frontmatter[FRONTMATTER_KEYS.syncedAt]),
    lastError: readNullableString(frontmatter[FRONTMATTER_KEYS.lastError]),
  };
}

export function getWordReferenceRefs(app: App, file: TFile): string[] {
  const frontmatter = getFrontmatter(app, file);
  const referencePaths = readStringArray(frontmatter[FRONTMATTER_KEYS.referencePaths]);
  if (referencePaths.length > 0) {
    return referencePaths;
  }

  return readStringArray(frontmatter[FRONTMATTER_KEYS.legacyReferenceRefs]);
}
