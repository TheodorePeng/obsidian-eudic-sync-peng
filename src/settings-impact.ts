import type { EudicSyncSettings } from "./types";

export interface SettingsImpact {
  changedKeys: Array<keyof EudicSyncSettings>;
  rebuildManagedIndex: boolean;
  invalidateRenderCache: boolean;
  markAllWordsDirty: boolean;
  refreshStudylistSnapshots: boolean;
  clearAutoSyncTimers: boolean;
  refreshUi: boolean;
}

const SCOPE_KEYS = new Set<keyof EudicSyncSettings>([
  "wordFolder",
  "referenceFolder",
]);

const RENDER_KEYS = new Set<keyof EudicSyncSettings>([
  "noteOutputMode",
  "noteOutputFormatVersion",
  "boldMarkers",
  "enableSemanticBlockMarkerBold",
  "enableSemanticBlockWordBold",
  "enableSemanticBlockWordLinks",
  "semanticBlockKindPresets",
  "semanticBlockWordBoldKinds",
  "semanticBlockWordLinkKinds",
]);

const UI_KEYS = new Set<keyof EudicSyncSettings>([
  "enableHeaderSyncButton",
  "enableStatusBarSyncButton",
  "newWordDefaultStudylists",
  "studylistCache",
]);

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

export function classifySettingsImpact(
  previous: EudicSyncSettings,
  next: EudicSyncSettings,
): SettingsImpact {
  const changedKeys = (Object.keys(next) as Array<keyof EudicSyncSettings>)
    .filter((key) => !valuesEqual(previous[key], next[key]));
  const has = (key: keyof EudicSyncSettings) => changedKeys.includes(key);

  return {
    changedKeys,
    rebuildManagedIndex: changedKeys.some((key) => SCOPE_KEYS.has(key)),
    invalidateRenderCache: changedKeys.some((key) => RENDER_KEYS.has(key)),
    markAllWordsDirty: has("noteOutputMode"),
    refreshStudylistSnapshots: changedKeys.some((key) => SCOPE_KEYS.has(key)),
    clearAutoSyncTimers: has("enableAutoSyncWordOnLeave")
      && previous.enableAutoSyncWordOnLeave
      && !next.enableAutoSyncWordOnLeave,
    refreshUi: changedKeys.some((key) => UI_KEYS.has(key)),
  };
}
