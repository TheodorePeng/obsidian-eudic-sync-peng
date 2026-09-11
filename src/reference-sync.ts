import type { TFile } from "obsidian";

export interface ReferenceSyncTargetSelection {
  referenced: number;
  runnableFiles: TFile[];
  unavailable: number;
  alreadySyncing: number;
}

interface SelectReferenceSyncTargetsOptions {
  resolveFile: (path: string) => TFile | null;
  canSyncFile: (file: TFile) => boolean;
  isSyncInFlight: (file: TFile) => boolean;
}

export function selectReferenceSyncTargets(
  wordPaths: Iterable<string>,
  options: SelectReferenceSyncTargetsOptions,
): ReferenceSyncTargetSelection {
  const paths = Array.from(new Set(wordPaths)).sort((left, right) => left.localeCompare(right));
  const runnableFiles: TFile[] = [];
  let unavailable = 0;
  let alreadySyncing = 0;

  for (const path of paths) {
    const file = options.resolveFile(path);
    if (!file || !options.canSyncFile(file)) {
      unavailable += 1;
      continue;
    }
    if (options.isSyncInFlight(file)) {
      alreadySyncing += 1;
      continue;
    }
    runnableFiles.push(file);
  }

  return {
    referenced: paths.length,
    runnableFiles,
    unavailable,
    alreadySyncing,
  };
}

export interface ReferenceSyncCompletionSummary {
  checked: number;
  uploaded: number;
  unchanged: number;
  failed: number;
  unavailable: number;
  alreadySyncing: number;
}

export function getReferenceSyncCompletionNotice(summary: ReferenceSyncCompletionSummary): string {
  return [
    `Eudic Sync: checked ${summary.checked}`,
    `uploaded ${summary.uploaded}`,
    `unchanged ${summary.unchanged}`,
    `failed ${summary.failed}`,
    `unavailable ${summary.unavailable}`,
    `already syncing ${summary.alreadySyncing}.`,
  ].join(", ");
}
