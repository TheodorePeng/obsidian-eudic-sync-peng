import type { App, TFile } from "obsidian";
import { FRONTMATTER_KEYS } from "./constants";
import { createEudicLinkId, readEudicLinkId } from "./eudic-link";
import {
  aliasesNeedRewrite,
  getFrontmatter,
  getNormalizedAliases,
  isWordSyncDisabledFrontmatter,
  readNullableString,
} from "./note-metadata";
import { isStudylistSyncStatusNormalized, normalizeStudylistSyncStatus } from "./studylist-sync-status";
import type { FrontmatterMutator } from "./types";

export interface EnsureWordFrontmatterResult {
  skipped: boolean;
  changed: boolean;
  markdown: string;
}

interface EnsureWordFrontmatterOptions {
  app: App;
  file: TFile;
  writeFrontmatter: (file: TFile, mutate: FrontmatterMutator) => Promise<void>;
}

function hasYamlFrontmatter(markdown: string): boolean {
  return /^---\s*\n[\s\S]*?\n---(?:\s*\n|$)/.test(markdown);
}

function writeDefaultWordFrontmatter(frontmatter: Record<string, unknown>): void {
  frontmatter[FRONTMATTER_KEYS.syncEudicEnabled] = true;
  frontmatter[FRONTMATTER_KEYS.lang] = "en";
  frontmatter[FRONTMATTER_KEYS.aliases] = [];
  frontmatter[FRONTMATTER_KEYS.eudicLinkId] = createEudicLinkId("word");
  frontmatter[FRONTMATTER_KEYS.eudicUrl] = "";
  frontmatter[FRONTMATTER_KEYS.syncStatus] = "dirty";
  frontmatter[FRONTMATTER_KEYS.studylistIds] = [];
  frontmatter[FRONTMATTER_KEYS.studylistNames] = [];
  frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "synced";
}

function readSyncEudicEnabled(frontmatter: Record<string, unknown>): boolean | null {
  const value = frontmatter[FRONTMATTER_KEYS.syncEudicEnabled];
  return typeof value === "boolean" ? value : null;
}

function getDefaultSyncEudicEnabled(frontmatter: Record<string, unknown>): boolean {
  return frontmatter[FRONTMATTER_KEYS.eudicSync] === false ? false : true;
}

export async function ensureManagedWordProperties(
  options: EnsureWordFrontmatterOptions,
): Promise<EnsureWordFrontmatterResult> {
  const { app, file, writeFrontmatter } = options;
  const markdown = await app.vault.cachedRead(file);

  if (!hasYamlFrontmatter(markdown)) {
    await writeFrontmatter(file, (frontmatter) => {
      writeDefaultWordFrontmatter(frontmatter);
    });
    return {
      skipped: false,
      changed: true,
      markdown: await app.vault.cachedRead(file),
    };
  }

  const frontmatter = getFrontmatter(app, file);
  const syncEudicEnabled = readSyncEudicEnabled(frontmatter);
  const defaultSyncEudicEnabled = getDefaultSyncEudicEnabled(frontmatter);
  const shouldAddSyncEudicEnabled = syncEudicEnabled === null;
  const nextSyncEudicEnabled = syncEudicEnabled ?? defaultSyncEudicEnabled;
  const isDisabled = isWordSyncDisabledFrontmatter({
    ...frontmatter,
    [FRONTMATTER_KEYS.syncEudicEnabled]: nextSyncEudicEnabled,
  });
  const normalizedAliases = getNormalizedAliases(frontmatter, file);
  const shouldUpdateAliases = aliasesNeedRewrite(frontmatter, file);
  const shouldAddEudicLinkId = readEudicLinkId(frontmatter) === null;
  const shouldAddLang = readNullableString(frontmatter[FRONTMATTER_KEYS.lang]) === null;
  const shouldAddEudicUrl = !(FRONTMATTER_KEYS.eudicUrl in frontmatter);
  const shouldAddSyncStatus = readNullableString(frontmatter[FRONTMATTER_KEYS.syncStatus]) === null;
  const shouldNormalizeStudylistStatus = !isStudylistSyncStatusNormalized(frontmatter);
  const shouldAddStudylistIds = !Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistIds]);
  const shouldAddStudylistNames = !Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistNames]);
  const shouldAddSyncableFields = !isDisabled;

  if (
    !shouldAddSyncEudicEnabled &&
    !shouldUpdateAliases &&
    !shouldAddEudicLinkId &&
    !shouldAddEudicUrl &&
    !shouldNormalizeStudylistStatus &&
    !shouldAddStudylistIds &&
    !shouldAddStudylistNames &&
    (!shouldAddSyncableFields || (!shouldAddLang && !shouldAddSyncStatus))
  ) {
    return {
      skipped: isDisabled,
      changed: false,
      markdown,
    };
  }

  await writeFrontmatter(file, (nextFrontmatter) => {
    if (shouldAddSyncEudicEnabled) {
      nextFrontmatter[FRONTMATTER_KEYS.syncEudicEnabled] = defaultSyncEudicEnabled;
    }

    if (shouldUpdateAliases) {
      nextFrontmatter[FRONTMATTER_KEYS.aliases] = normalizedAliases;
    }

    if (shouldAddEudicLinkId) {
      nextFrontmatter[FRONTMATTER_KEYS.eudicLinkId] = createEudicLinkId("word");
    }

    if (shouldAddEudicUrl) {
      nextFrontmatter[FRONTMATTER_KEYS.eudicUrl] = "";
    }

    if (shouldNormalizeStudylistStatus) {
      normalizeStudylistSyncStatus(nextFrontmatter);
    }

    if (shouldAddStudylistIds) {
      nextFrontmatter[FRONTMATTER_KEYS.studylistIds] = [];
    }

    if (shouldAddStudylistNames) {
      nextFrontmatter[FRONTMATTER_KEYS.studylistNames] = [];
    }

    if (shouldAddSyncableFields && shouldAddLang) {
      nextFrontmatter[FRONTMATTER_KEYS.lang] = "en";
    }

    if (shouldAddSyncableFields && shouldAddSyncStatus) {
      nextFrontmatter[FRONTMATTER_KEYS.syncStatus] = "dirty";
    }

  });

  return {
    skipped: isDisabled,
    changed: true,
    markdown: await app.vault.cachedRead(file),
  };
}

export const ensureMinimumWordFrontmatter = ensureManagedWordProperties;
