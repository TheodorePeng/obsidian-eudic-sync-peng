import { normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, NOTE_OUTPUT_FORMAT_VERSION, PLUGIN_ID, PLUGIN_NAME } from "./constants";
import type { EudicNoteOutputMode, EudicStudylistCache, EudicSyncSettings, ReferenceMetadataWriteMode } from "./types";

const LEGACY_AUTO_EXTRACT_PENDING_REFERENCES_SETTING = "enableAutoExtractPending" + "ExamplesOnSave";
const SETTINGS_BACKUP_TYPE = "settings-backup";
const SETTINGS_BACKUP_VERSION = 1;
const IMPORTABLE_SETTINGS_KEYS = [
  "wordFolder",
  "referenceFolder",
  "authorizationToken",
  "noteOutputMode",
  "enableAutoBoldMarkersOnEdit",
  "boldMarkers",
  "enableSemanticBlockWordBold",
  "semanticBlockWordBoldKinds",
  "enableSemanticBlockMarkerBold",
  "enableSemanticBlockWordLinks",
  "semanticBlockWordLinkKinds",
  "semanticBlockKindPresets",
  "enableAutoExtractPendingReferencesOnSave",
  "enableAutoSyncWordOnLeave",
  "referenceMetadataWriteMode",
  "enableHeaderSyncButton",
  "enableStatusBarSyncButton",
] as const satisfies readonly (keyof EudicSyncSettings)[];

type ImportableSettingsKey = (typeof IMPORTABLE_SETTINGS_KEYS)[number];

export type EudicSyncImportableSettings = Pick<EudicSyncSettings, ImportableSettingsKey>;

export interface EudicSyncSettingsBackupPayload {
  plugin: string;
  type: string;
  version: number;
  exportedAt: string;
  settings: EudicSyncImportableSettings;
}

export interface SettingsLoadResult {
  settings: EudicSyncSettings;
  changed: boolean;
  notices: string[];
}

export interface ImportedSettingsPayloadResult {
  settings: EudicSyncImportableSettings;
  notices: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeFolderPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return normalizePath(trimmed).replace(/^\/+|\/+$/g, "");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => normalizeFolderPath(entry))
    .filter(Boolean);
}

function readLiteralStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const marker = entry.trim();
    if (!marker || seen.has(marker)) {
      continue;
    }

    seen.add(marker);
    result.push(marker);
  }

  return result;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function joinNormalizedPath(parent: string, child: string): string {
  if (!parent) {
    return child;
  }

  if (!child) {
    return parent;
  }

  return normalizeFolderPath(`${parent}/${child}`);
}

function rewriteLegacyExamplesFolderToReferences(path: string): string {
  const normalizedPath = normalizeFolderPath(path);
  if (!normalizedPath) {
    return "";
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments[segments.length - 1] !== "Examples") {
    return normalizedPath;
  }

  segments[segments.length - 1] = "References";
  return segments.join("/");
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readStudylistCache(value: unknown): EudicStudylistCache {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS.studylistCache;
  }

  const categories = Array.isArray(value.categories)
    ? value.categories
        .filter(isRecord)
        .map((category) => ({
          id: readString(category.id) ?? "",
          language: readString(category.language) ?? "",
          name: readString(category.name) ?? "",
        }))
        .filter((category) => category.id && category.language && category.name)
    : [];

  return {
    categories,
    refreshedAt: readString(value.refreshedAt),
  };
}

function readNoteOutputMode(value: unknown): EudicNoteOutputMode {
  return value === "compatible" ? "compatible" : "minimal";
}

function readReferenceMetadataWriteMode(value: unknown, rawNoteOutputFormatVersion: number): ReferenceMetadataWriteMode {
  if (value === "manual") {
    return "manual";
  }

  if (value === "off") {
    return rawNoteOutputFormatVersion < 7 ? "auto" : "off";
  }

  return "auto";
}

function pickImportableSettings(settings: EudicSyncSettings): EudicSyncImportableSettings {
  const result = {} as Record<ImportableSettingsKey, EudicSyncImportableSettings[ImportableSettingsKey]>;

  for (const key of IMPORTABLE_SETTINGS_KEYS) {
    const value = settings[key];
    result[key] = (Array.isArray(value) ? [...value] : value) as EudicSyncImportableSettings[typeof key];
  }

  return result as EudicSyncImportableSettings;
}

export function buildExportSettingsPayload(settings: EudicSyncSettings): EudicSyncSettingsBackupPayload {
  return {
    plugin: PLUGIN_ID,
    type: SETTINGS_BACKUP_TYPE,
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: pickImportableSettings(settings),
  };
}

export function readImportedSettingsPayload(rawData: unknown): ImportedSettingsPayloadResult {
  if (!isRecord(rawData)) {
    throw new Error(`${PLUGIN_NAME}: invalid settings backup file.`);
  }

  if (readString(rawData.plugin) !== PLUGIN_ID) {
    throw new Error(`${PLUGIN_NAME}: this file is not an eudic-sync settings backup.`);
  }

  if (readString(rawData.type) !== SETTINGS_BACKUP_TYPE) {
    throw new Error(`${PLUGIN_NAME}: unsupported settings backup type.`);
  }

  if (readNumber(rawData.version) !== SETTINGS_BACKUP_VERSION) {
    throw new Error(`${PLUGIN_NAME}: unsupported settings backup version.`);
  }

  if (!isRecord(rawData.settings)) {
    throw new Error(`${PLUGIN_NAME}: settings backup is missing a valid settings object.`);
  }

  const loadResult = migrateLoadedSettings(rawData.settings);
  return {
    settings: pickImportableSettings(loadResult.settings),
    notices: loadResult.notices,
  };
}

export function migrateLoadedSettings(rawData: unknown): SettingsLoadResult {
  const raw = isRecord(rawData) ? rawData : {};
  const notices: string[] = [];
  const rawNoteOutputFormatVersion = readNumber(raw.noteOutputFormatVersion) ?? 1;

  const hasLegacyPathKeys =
    "libraryRoot" in raw || "syncFolders" in raw || "watchOnlyFolders" in raw || "excludeFolders" in raw;
  const hasLegacyAutoSyncOnSave = "enableAutoSyncWordOnSave" in raw;

  const legacyLibraryRoot = normalizeFolderPath(readString(raw.libraryRoot) ?? DEFAULT_SETTINGS.wordFolder.split("/")[0] ?? "");
  const legacySyncFolders = readStringArray(raw.syncFolders);
  const legacyWatchFolders = readStringArray(raw.watchOnlyFolders);

  if (legacySyncFolders.length > 1) {
    notices.push(`${PLUGIN_NAME}: multiple legacy sync folders were found. Only the first folder was kept.`);
  }

  if (legacyWatchFolders.length > 1) {
    notices.push(`${PLUGIN_NAME}: multiple legacy watch-only folders were found. Only the first folder was kept.`);
  }

  const derivedLegacyWordFolder = joinNormalizedPath(legacyLibraryRoot, legacySyncFolders[0] ?? "Words");
  const derivedLegacyReferenceFolder = rewriteLegacyExamplesFolderToReferences(
    joinNormalizedPath(legacyLibraryRoot, legacyWatchFolders[0] ?? "Examples"),
  );

  const normalizedWordFolder =
    normalizeFolderPath(readString(raw.wordFolder) ?? "") || derivedLegacyWordFolder || DEFAULT_SETTINGS.wordFolder;
  const normalizedReferenceFolder =
    rewriteLegacyExamplesFolderToReferences(readString(raw.referenceFolder) ?? "") ||
    derivedLegacyReferenceFolder ||
    DEFAULT_SETTINGS.referenceFolder;

  const settings: EudicSyncSettings = {
    wordFolder: normalizedWordFolder,
    referenceFolder: normalizedReferenceFolder,
    authorizationToken: readString(raw.authorizationToken) ?? DEFAULT_SETTINGS.authorizationToken,
    studylistCache: readStudylistCache(raw.studylistCache),
    noteOutputMode: readNoteOutputMode(raw.noteOutputMode),
    noteOutputFormatVersion: isRecord(rawData)
      ? rawNoteOutputFormatVersion
      : NOTE_OUTPUT_FORMAT_VERSION,
    enableAutoBoldMarkersOnEdit: readBoolean(
      raw.enableAutoBoldMarkersOnEdit,
      DEFAULT_SETTINGS.enableAutoBoldMarkersOnEdit,
    ),
    boldMarkers: readLiteralStringArray(raw.boldMarkers, DEFAULT_SETTINGS.boldMarkers),
    enableSemanticBlockWordBold: readBoolean(
      raw.enableSemanticBlockWordBold,
      DEFAULT_SETTINGS.enableSemanticBlockWordBold,
    ),
    semanticBlockWordBoldKinds: readLiteralStringArray(
      raw.semanticBlockWordBoldKinds,
      DEFAULT_SETTINGS.semanticBlockWordBoldKinds,
    ),
    enableSemanticBlockMarkerBold: readBoolean(
      raw.enableSemanticBlockMarkerBold,
      DEFAULT_SETTINGS.enableSemanticBlockMarkerBold,
    ),
    enableSemanticBlockWordLinks: readBoolean(
      raw.enableSemanticBlockWordLinks,
      DEFAULT_SETTINGS.enableSemanticBlockWordLinks,
    ),
    semanticBlockWordLinkKinds: readLiteralStringArray(
      raw.semanticBlockWordLinkKinds,
      DEFAULT_SETTINGS.semanticBlockWordLinkKinds,
    ),
    semanticBlockKindPresets: readLiteralStringArray(
      raw.semanticBlockKindPresets,
      DEFAULT_SETTINGS.semanticBlockKindPresets,
    ),
    enableAutoExtractPendingReferencesOnSave: readBoolean(
      raw.enableAutoExtractPendingReferencesOnSave,
      readBoolean(
        raw[LEGACY_AUTO_EXTRACT_PENDING_REFERENCES_SETTING],
        DEFAULT_SETTINGS.enableAutoExtractPendingReferencesOnSave,
      ),
    ),
    enableAutoSyncWordOnLeave: readBoolean(
      raw.enableAutoSyncWordOnLeave,
      readBoolean(raw.enableAutoSyncWordOnSave, DEFAULT_SETTINGS.enableAutoSyncWordOnLeave),
    ),
    referenceMetadataWriteMode: readReferenceMetadataWriteMode(raw.referenceMetadataWriteMode, rawNoteOutputFormatVersion),
    enableHeaderSyncButton: readBoolean(raw.enableHeaderSyncButton, DEFAULT_SETTINGS.enableHeaderSyncButton),
    enableStatusBarSyncButton: readBoolean(raw.enableStatusBarSyncButton, DEFAULT_SETTINGS.enableStatusBarSyncButton),
  };

  const changed =
    hasLegacyPathKeys ||
    !isRecord(rawData) ||
    readString(raw.wordFolder) !== settings.wordFolder ||
    readString(raw.referenceFolder) !== settings.referenceFolder ||
    hasLegacyAutoSyncOnSave ||
    !("wordFolder" in raw) ||
    !("referenceFolder" in raw) ||
    !("studylistCache" in raw) ||
    "defaultStudylistSource" in raw ||
    !("noteOutputFormatVersion" in raw) ||
    !("enableAutoBoldMarkersOnEdit" in raw) ||
    !("boldMarkers" in raw) ||
    !("enableSemanticBlockWordBold" in raw) ||
    !("semanticBlockWordBoldKinds" in raw) ||
    !("enableSemanticBlockMarkerBold" in raw) ||
    !("enableSemanticBlockWordLinks" in raw) ||
    !("semanticBlockWordLinkKinds" in raw) ||
    !("semanticBlockKindPresets" in raw) ||
    !("enableAutoExtractPendingReferencesOnSave" in raw) ||
    LEGACY_AUTO_EXTRACT_PENDING_REFERENCES_SETTING in raw ||
    !("enableAutoSyncWordOnLeave" in raw) ||
    !("referenceMetadataWriteMode" in raw) ||
    raw.referenceMetadataWriteMode !== settings.referenceMetadataWriteMode;

  return {
    settings,
    changed,
    notices,
  };
}
