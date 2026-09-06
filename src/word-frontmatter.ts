import { parseYaml, type App, type TFile } from "obsidian";
import { FRONTMATTER_KEYS } from "./constants";
import { createEudicLinkId, readEudicLinkId } from "./eudic-link";
import { getExpectedEudicUri } from "./eudic-url";
import {
  getConfiguredWord,
  isWordSyncDisabledFrontmatter,
  normalizeAliasesValue,
  readNullableString,
} from "./note-metadata";
import { isStudylistSyncStatusNormalized, normalizeStudylistSyncStatus } from "./studylist-sync-status";
import type { EudicStudylistCategory, FrontmatterMutator } from "./types";
import {
  applyWordSyncFrontmatterToObject,
  setWordSyncFrontmatterInMarkdown,
  type WordSyncFrontmatterPatchData,
} from "./word-sync-frontmatter-patch";

export type ManagedWordReconcileTrigger = "create" | "touch" | "startup";

export interface EnsureWordFrontmatterResult {
  skipped: boolean;
  changed: boolean;
  markdown: string;
  lang: string | null;
  eudicLinkId: string | null;
  eudicUri: string | null;
}

interface EnsureWordFrontmatterOptions {
  app: App;
  file: TFile;
  writeFrontmatter: (file: TFile, mutate: FrontmatterMutator) => Promise<void>;
  ensureEudicUri?: boolean;
  trigger?: ManagedWordReconcileTrigger;
  defaultStudylists?: EudicStudylistCategory[];
  studylistCatalog?: EudicStudylistCategory[];
}

interface ReconcileManagedWordMarkdownOptions {
  file: TFile;
  markdown: string;
  ensureEudicUri?: boolean;
  trigger?: ManagedWordReconcileTrigger;
  defaultStudylists?: EudicStudylistCategory[];
  studylistCatalog?: EudicStudylistCategory[];
}

export interface ReconcileManagedWordMarkdownResult extends EnsureWordFrontmatterResult {
  patchData: WordSyncFrontmatterPatchData;
}

function parseFrontmatterFromMarkdown(markdown: string, file: TFile): Record<string, unknown> {
  const lines = markdown.replace(/^\uFEFF/, "").split("\n");
  if ((lines[0] ?? "").replace(/\r$/, "").trim() !== "---") {
    return {};
  }

  let endLine = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").replace(/\r$/, "").trim() === "---") {
      endLine = index;
      break;
    }
  }
  if (endLine < 0) {
    throw new Error(`Malformed YAML frontmatter in ${file.path}: missing closing fence.`);
  }

  try {
    const parsed = parseYaml(lines.slice(1, endLine).map((line) => line.replace(/\r$/, "")).join("\n"));
    if (parsed === null || parsed === undefined) {
      return {};
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("frontmatter root must be a mapping");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Malformed YAML frontmatter in ${file.path}: ${message}`);
  }
}

function readSyncEudicEnabled(frontmatter: Record<string, unknown>): boolean | null {
  const value = frontmatter[FRONTMATTER_KEYS.syncEudicEnabled];
  return typeof value === "boolean" ? value : null;
}

function getDefaultSyncEudicEnabled(frontmatter: Record<string, unknown>): boolean {
  return frontmatter[FRONTMATTER_KEYS.eudicSync] === false ? false : true;
}

function hasMissingCreationField(frontmatter: Record<string, unknown>): boolean {
  return (
    typeof frontmatter[FRONTMATTER_KEYS.syncEudicEnabled] !== "boolean" ||
    !Array.isArray(frontmatter[FRONTMATTER_KEYS.aliases]) ||
    typeof frontmatter[FRONTMATTER_KEYS.eudicUrl] !== "string" ||
    !Array.isArray(frontmatter[FRONTMATTER_KEYS.referencePaths])
  );
}

function isIncompleteCreationShell(frontmatter: Record<string, unknown>): boolean {
  return (
    readNullableString(frontmatter[FRONTMATTER_KEYS.lang]) === null &&
    hasMissingCreationField(frontmatter) &&
    readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedHash]) === null &&
    readNullableString(frontmatter[FRONTMATTER_KEYS.syncedAt]) === null &&
    readLooseStringArray(frontmatter[FRONTMATTER_KEYS.studylistIds], true).length === 0 &&
    readLooseStringArray(frontmatter[FRONTMATTER_KEYS.studylistNames]).length === 0
  );
}

function getDefaultStudylistPairs(
  categories: EudicStudylistCategory[],
  language: string,
): { ids: string[]; names: string[] } {
  const normalizedLanguage = language.trim().toLocaleLowerCase();
  const seen = new Set<string>();
  const ids: string[] = [];
  const names: string[] = [];
  for (const category of categories) {
    const id = category.id.trim();
    const name = category.name.trim();
    if (!id || !name || category.language.trim().toLocaleLowerCase() !== normalizedLanguage || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
    names.push(name);
  }
  return { ids, names };
}

function readLooseStringArray(value: unknown, allowNumbers = false): string[] {
  const values = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of values) {
    const normalized = typeof entry === "string"
      ? entry.trim()
      : allowNumbers && typeof entry === "number" && Number.isFinite(entry)
        ? String(entry)
        : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function repairStudylistPair(
  frontmatter: Record<string, unknown>,
  language: string,
  catalog: EudicStudylistCategory[],
): { ids: string[]; names: string[] } | null {
  const rawIds = frontmatter[FRONTMATTER_KEYS.studylistIds];
  const rawNames = frontmatter[FRONTMATTER_KEYS.studylistNames];
  const ids = readLooseStringArray(rawIds, true);
  const names = readLooseStringArray(rawNames);
  if (ids.length === 0 && names.length === 0) {
    return null;
  }
  if (Array.isArray(rawIds) && Array.isArray(rawNames) && ids.length === names.length && ids.length > 0) {
    return null;
  }

  const normalizedLanguage = language.trim().toLocaleLowerCase();
  const available = catalog.filter(
    (category) => category.language.trim().toLocaleLowerCase() === normalizedLanguage,
  );
  const byId = new Map(available.map((category) => [category.id.trim(), category]));
  const byName = new Map(available.map((category) => [category.name.trim(), category]));
  if (ids.length > 0) {
    const categories = ids.map((id) => byId.get(id));
    if (categories.every((category): category is EudicStudylistCategory => category !== undefined)) {
      return { ids, names: categories.map((category) => category.name.trim()) };
    }
  }
  if (names.length > 0) {
    const categories = names.map((name) => byName.get(name));
    if (categories.every((category): category is EudicStudylistCategory => category !== undefined)) {
      return { ids: categories.map((category) => category.id.trim()), names };
    }
  }
  return null;
}

function isGeneratedMissingLangError(value: unknown): boolean {
  const error = readNullableString(value);
  return error !== null && /^Missing 'lang' in .+\.$/.test(error);
}

function getNormalizedStudylistStatus(frontmatter: Record<string, unknown>): "dirty" | "synced" {
  const copy = { ...frontmatter };
  normalizeStudylistSyncStatus(copy);
  return copy[FRONTMATTER_KEYS.studylistSyncStatus] === "dirty" ? "dirty" : "synced";
}

export function reconcileManagedWordMarkdown(
  options: ReconcileManagedWordMarkdownOptions,
): ReconcileManagedWordMarkdownResult {
  const {
    file,
    markdown,
    ensureEudicUri = true,
    trigger = "touch",
    defaultStudylists = [],
    studylistCatalog = [],
  } = options;
  const frontmatter = parseFrontmatterFromMarkdown(markdown, file);
  const existingSyncEnabled = readSyncEudicEnabled(frontmatter);
  const nextSyncEnabled = existingSyncEnabled ?? getDefaultSyncEudicEnabled(frontmatter);
  const isDisabled = isWordSyncDisabledFrontmatter({
    ...frontmatter,
    [FRONTMATTER_KEYS.syncEudicEnabled]: nextSyncEnabled,
  });
  if (trigger === "startup") {
    return {
      skipped: isDisabled,
      changed: false,
      markdown,
      patchData: {},
      lang: readNullableString(frontmatter[FRONTMATTER_KEYS.lang]),
      eudicLinkId: readEudicLinkId(frontmatter),
      eudicUri: readNullableString(frontmatter[FRONTMATTER_KEYS.eudicUri]),
    };
  }
  const missingLang = readNullableString(frontmatter[FRONTMATTER_KEYS.lang]) === null;
  const language = readNullableString(frontmatter[FRONTMATTER_KEYS.lang]) ?? "en";
  const hasExistingAssignment =
    readLooseStringArray(frontmatter[FRONTMATTER_KEYS.studylistIds], true).length > 0 ||
    readLooseStringArray(frontmatter[FRONTMATTER_KEYS.studylistNames]).length > 0;
  const shouldSeedDefaultStudylists =
    !isDisabled &&
    !hasExistingAssignment &&
    (trigger === "create" || (trigger === "touch" && isIncompleteCreationShell(frontmatter)));
  const defaultPairs = getDefaultStudylistPairs(defaultStudylists, language);
  const patchData: WordSyncFrontmatterPatchData = {};

  if (existingSyncEnabled === null) {
    patchData.syncEudicEnabled = nextSyncEnabled;
  }
  if (!Array.isArray(frontmatter[FRONTMATTER_KEYS.aliases])) {
    patchData.aliases = normalizeAliasesValue(frontmatter[FRONTMATTER_KEYS.aliases], getConfiguredWord(frontmatter, file));
  }
  if (readEudicLinkId(frontmatter) === null) {
    patchData.eudicLinkId = createEudicLinkId("word");
  }
  if (typeof frontmatter[FRONTMATTER_KEYS.eudicUrl] !== "string") {
    patchData.eudicUrl = "";
  }
  if (ensureEudicUri) {
    const expectedUri = getExpectedEudicUri(frontmatter, file);
    if (readNullableString(frontmatter[FRONTMATTER_KEYS.eudicUri]) !== expectedUri) {
      patchData.eudicUri = expectedUri;
    }
  }
  if (!Array.isArray(frontmatter[FRONTMATTER_KEYS.referencePaths])) {
    patchData.referencePaths = [];
  }
  if (!isDisabled && missingLang) {
    patchData.lang = "en";
    if (isGeneratedMissingLangError(frontmatter[FRONTMATTER_KEYS.lastError])) {
      patchData.lastError = null;
    }
  }
  if (!isDisabled && readNullableString(frontmatter[FRONTMATTER_KEYS.syncStatus]) === null) {
    patchData.syncStatus = "dirty";
  }

  if (shouldSeedDefaultStudylists) {
    patchData.studylistIds = defaultPairs.ids;
    patchData.studylistNames = defaultPairs.names;
    patchData.studylistSyncStatus = defaultPairs.ids.length > 0 ? "dirty" : "synced";
  } else {
    const repairedPair = repairStudylistPair(frontmatter, language, studylistCatalog);
    if (repairedPair) {
      patchData.studylistIds = repairedPair.ids;
      patchData.studylistNames = repairedPair.names;
      patchData.studylistSyncStatus = "dirty";
    } else if (!hasExistingAssignment) {
      if (!Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistIds])) {
        patchData.studylistIds = [];
      }
      if (!Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistNames])) {
        patchData.studylistNames = [];
      }
    }
    if (patchData.studylistSyncStatus === undefined && !isStudylistSyncStatusNormalized(frontmatter)) {
      patchData.studylistSyncStatus = getNormalizedStudylistStatus(frontmatter);
    }
  }

  const nextMarkdown = setWordSyncFrontmatterInMarkdown(markdown, patchData);
  const nextFrontmatter = { ...frontmatter };
  applyWordSyncFrontmatterToObject(nextFrontmatter, patchData);
  return {
    skipped: isDisabled,
    changed: nextMarkdown !== markdown,
    markdown: nextMarkdown,
    patchData,
    lang: readNullableString(nextFrontmatter[FRONTMATTER_KEYS.lang]),
    eudicLinkId: readEudicLinkId(nextFrontmatter),
    eudicUri: readNullableString(nextFrontmatter[FRONTMATTER_KEYS.eudicUri]),
  };
}

export async function ensureManagedWordProperties(
  options: EnsureWordFrontmatterOptions,
): Promise<EnsureWordFrontmatterResult> {
  const { app, file, writeFrontmatter } = options;
  const reconciled = reconcileManagedWordMarkdown({
    file,
    markdown: await app.vault.cachedRead(file),
    ensureEudicUri: options.ensureEudicUri,
    trigger: options.trigger,
    defaultStudylists: options.defaultStudylists,
    studylistCatalog: options.studylistCatalog,
  });
  if (!reconciled.changed) {
    return reconciled;
  }

  await writeFrontmatter(file, (frontmatter) => {
    applyWordSyncFrontmatterToObject(frontmatter, reconciled.patchData);
  });
  return {
    skipped: reconciled.skipped,
    changed: true,
    markdown: await app.vault.cachedRead(file),
    lang: reconciled.lang,
    eudicLinkId: reconciled.eudicLinkId,
    eudicUri: reconciled.eudicUri,
  };
}

export const ensureMinimumWordFrontmatter = ensureManagedWordProperties;
