import type { EudicSyncSettings } from "./types";

export interface SyncRenderCacheKey {
  wordPath: string;
  wordSignature: string;
  noteOutputMode: string;
  noteOutputFormatVersion: number;
  semanticSettingsSignature: string;
  referenceDependencySignature: string;
}

interface SyncRenderCacheEntry {
  key: SyncRenderCacheKey;
  finalNoteHtml: string;
}

export interface SyncRenderCacheLimits {
  maxEntries?: number;
  maxCharacters?: number;
}

export interface SyncRenderCacheDiagnostics {
  entryCount: number;
  totalCharacters: number;
  maxEntries: number;
  maxCharacters: number;
}

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_CHARACTERS = 5_000_000;

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
    && left.noteOutputFormatVersion === right.noteOutputFormatVersion
    && left.semanticSettingsSignature === right.semanticSettingsSignature
    && left.referenceDependencySignature === right.referenceDependencySignature;
}

export class SyncRenderCache {
  private readonly entries = new Map<string, SyncRenderCacheEntry>();
  private readonly maxEntries: number;
  private readonly maxCharacters: number;
  private totalCharacters = 0;

  constructor(limits: SyncRenderCacheLimits = {}) {
    this.maxEntries = Math.max(0, Math.floor(limits.maxEntries ?? DEFAULT_MAX_ENTRIES));
    this.maxCharacters = Math.max(0, Math.floor(limits.maxCharacters ?? DEFAULT_MAX_CHARACTERS));
  }

  get(key: SyncRenderCacheKey): string | null {
    const entry = this.entries.get(key.wordPath);
    if (!entry || !keysEqual(entry.key, key)) {
      return null;
    }

    this.entries.delete(key.wordPath);
    this.entries.set(key.wordPath, entry);
    return entry.finalNoteHtml;
  }

  set(key: SyncRenderCacheKey, finalNoteHtml: string): void {
    this.removeEntry(key.wordPath);
    if (finalNoteHtml.length > this.maxCharacters || this.maxEntries === 0) {
      return;
    }

    this.entries.set(key.wordPath, {
      key: { ...key },
      finalNoteHtml,
    });
    this.totalCharacters += finalNoteHtml.length;
    this.evictOverLimits();
  }

  invalidateWord(path: string): void {
    this.removeEntry(path);
  }

  invalidateAll(): void {
    this.entries.clear();
    this.totalCharacters = 0;
  }

  getDiagnostics(): SyncRenderCacheDiagnostics {
    return {
      entryCount: this.entries.size,
      totalCharacters: this.totalCharacters,
      maxEntries: this.maxEntries,
      maxCharacters: this.maxCharacters,
    };
  }

  private removeEntry(path: string): void {
    const entry = this.entries.get(path);
    if (!entry) {
      return;
    }
    this.entries.delete(path);
    this.totalCharacters -= entry.finalNoteHtml.length;
  }

  private evictOverLimits(): void {
    while (this.entries.size > this.maxEntries || this.totalCharacters > this.maxCharacters) {
      const oldestPath = this.entries.keys().next().value as string | undefined;
      if (oldestPath === undefined) {
        return;
      }
      this.removeEntry(oldestPath);
    }
  }
}
