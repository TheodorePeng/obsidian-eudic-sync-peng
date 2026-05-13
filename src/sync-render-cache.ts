import type { EudicSyncSettings } from "./types";

export interface SyncRenderCacheKey {
  wordPath: string;
  wordSignature: string;
  noteOutputMode: string;
  semanticSettingsSignature: string;
  referenceDependencySignature: string;
}

interface SyncRenderCacheEntry {
  key: SyncRenderCacheKey;
  finalNoteHtml: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

export function getSemanticSettingsSignature(settings: EudicSyncSettings): string {
  return stableJson({
    boldMarkers: settings.boldMarkers,
    enableSemanticBlockMarkerBold: settings.enableSemanticBlockMarkerBold,
    enableSemanticBlockWordBold: settings.enableSemanticBlockWordBold,
    enableSemanticBlockWordLinks: settings.enableSemanticBlockWordLinks,
    semanticBlockKindPresets: settings.semanticBlockKindPresets,
    semanticBlockWordBoldKinds: settings.semanticBlockWordBoldKinds,
    semanticBlockWordLinkKinds: settings.semanticBlockWordLinkKinds,
  });
}

function keysEqual(left: SyncRenderCacheKey, right: SyncRenderCacheKey): boolean {
  return left.wordPath === right.wordPath
    && left.wordSignature === right.wordSignature
    && left.noteOutputMode === right.noteOutputMode
    && left.semanticSettingsSignature === right.semanticSettingsSignature
    && left.referenceDependencySignature === right.referenceDependencySignature;
}

export class SyncRenderCache {
  private readonly entries = new Map<string, SyncRenderCacheEntry>();

  get(key: SyncRenderCacheKey): string | null {
    const entry = this.entries.get(key.wordPath);
    if (!entry || !keysEqual(entry.key, key)) {
      return null;
    }

    return entry.finalNoteHtml;
  }

  set(key: SyncRenderCacheKey, finalNoteHtml: string): void {
    this.entries.set(key.wordPath, {
      key: { ...key },
      finalNoteHtml,
    });
  }

  invalidateWord(path: string): void {
    this.entries.delete(path);
  }

  invalidateAll(): void {
    this.entries.clear();
  }
}
