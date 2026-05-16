import type { App, CachedMetadata, EventRef, TFile } from "obsidian";
import { getFrontmatter, readNullableString } from "./note-metadata";

interface WaitForCachedFrontmatterStringOptions {
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 1200;
const DEFAULT_INTERVAL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function hasFrontmatterStringValue(
  frontmatter: Record<string, unknown> | undefined,
  key: string,
  expectedValue: string,
): boolean {
  return readNullableString(frontmatter?.[key]) === expectedValue;
}

function hasCachedStringValue(app: App, file: TFile, key: string, expectedValue: string): boolean {
  return hasFrontmatterStringValue(getFrontmatter(app, file), key, expectedValue);
}

function hasChangedMetadataStringValue(cache: CachedMetadata, key: string, expectedValue: string): boolean {
  return hasFrontmatterStringValue(cache.frontmatter as Record<string, unknown> | undefined, key, expectedValue);
}

function sameFile(left: TFile, right: TFile): boolean {
  return left.path === right.path;
}

export async function waitForCachedFrontmatterString(
  app: App,
  file: TFile,
  key: string,
  expectedValue: string,
  options: WaitForCachedFrontmatterStringOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;
  const deadline = now() + timeoutMs;
  let settled = hasCachedStringValue(app, file, key, expectedValue);
  let wakeListener: (() => void) | null = null;
  let eventRef: EventRef | null = null;

  if (settled) {
    return true;
  }

  const wake = () => {
    const listener = wakeListener;
    wakeListener = null;
    listener?.();
  };

  eventRef = app.metadataCache.on("changed", (changedFile, _data, cache) => {
    if (!sameFile(changedFile, file)) {
      return;
    }

    if (hasChangedMetadataStringValue(cache, key, expectedValue)) {
      settled = true;
      wake();
    }
  });

  try {
    while (true) {
      if (settled || hasCachedStringValue(app, file, key, expectedValue)) {
        return true;
      }

      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        return false;
      }

      await Promise.race([
        wait(Math.min(intervalMs, remainingMs)),
        new Promise<void>((resolve) => {
          wakeListener = resolve;
        }),
      ]);
    }
  } finally {
    if (wakeListener) {
      wake();
    }
    if (eventRef) {
      app.metadataCache.offref(eventRef);
    }
  }
}
