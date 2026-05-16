import type { App, TFile } from "obsidian";
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

function hasCachedStringValue(app: App, file: TFile, key: string, expectedValue: string): boolean {
  return readNullableString(getFrontmatter(app, file)[key]) === expectedValue;
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

  while (true) {
    if (hasCachedStringValue(app, file, key, expectedValue)) {
      return true;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      return false;
    }

    await wait(Math.min(intervalMs, remainingMs));
  }
}
