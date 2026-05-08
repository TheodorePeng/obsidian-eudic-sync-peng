import { Notice, type TFile, normalizePath } from "obsidian";
import { PLUGIN_NAME } from "./constants";
import { getStudylistPushNoticeText, getSyncWordNoticeText } from "./sync-notice-text";
import type { StudylistService } from "./studylist-service";
import type { SyncService } from "./sync-service";
import type { EudicSyncStatus, StudylistPushSummary, WordNoteContext } from "./types";
import { getEffectiveWordStatus } from "./word-status";

export interface SyncFileOptions {
  silentIfAlreadySyncing?: boolean;
  force?: boolean;
  source?: "manual" | "auto";
}

interface SyncOrchestratorOptions {
  syncService: SyncService;
  studylistService: StudylistService;
  saveActiveViewForFile: (file: TFile) => Promise<void>;
  getDisplayWordContext: (file: TFile) => WordNoteContext | null;
  setWordStatusOverride: (
    file: TFile,
    status: EudicSyncStatus,
    lastError: string | null,
    bodyStatus?: EudicSyncStatus,
    studylistStatus?: EudicSyncStatus,
  ) => void;
  refreshUi: () => void;
}

export class SyncOrchestrator {
  private readonly inFlightSyncPaths = new Set<string>();

  constructor(private readonly options: SyncOrchestratorOptions) {}

  isSyncInFlight(file: TFile): boolean {
    return this.inFlightSyncPaths.has(normalizePath(file.path));
  }

  beginSync(file: TFile): boolean {
    const normalizedPath = normalizePath(file.path);
    if (this.inFlightSyncPaths.has(normalizedPath)) {
      return false;
    }

    this.inFlightSyncPaths.add(normalizedPath);
    this.options.refreshUi();
    return true;
  }

  endSync(file: TFile): void {
    this.inFlightSyncPaths.delete(normalizePath(file.path));
    this.options.refreshUi();
  }

  async syncFile(file: TFile, options: SyncFileOptions = {}): Promise<void> {
    if (!this.beginSync(file)) {
      if (!options.silentIfAlreadySyncing) {
        new Notice(`${PLUGIN_NAME}: "${file.basename}" is already syncing.`);
      }
      return;
    }

    try {
      const initialContext = this.options.getDisplayWordContext(file);
      await this.options.saveActiveViewForFile(file);
      const result = await this.options.syncService.syncWord(file, { force: options.force });
      const studylistResult =
        options.source === "manual" && !result.error ? await this.pushCurrentDirtyStudylistAssignmentAfterWordSync(file) : null;
      if (result.error) {
        const nextStudylistStatus = initialContext?.studylistStatus ?? "synced";
        this.options.setWordStatusOverride(
          file,
          getEffectiveWordStatus("dirty", nextStudylistStatus),
          result.error,
          "dirty",
          nextStudylistStatus,
        );
      } else {
        const bodyStatus = result.status;
        const studylistStatus =
          studylistResult === null
            ? initialContext?.studylistStatus ?? "synced"
            : studylistResult.failed > 0
              ? "dirty"
              : "synced";
        const studylistEntry = studylistResult?.results.find((entry) => entry.file.path === file.path);
        const studylistError =
          studylistResult === null
            ? this.options.studylistService.getCurrentWordStudylistLastError(file)
            : studylistEntry?.error ?? null;
        this.options.setWordStatusOverride(
          file,
          getEffectiveWordStatus(bodyStatus, studylistStatus),
          studylistError,
          bodyStatus,
          studylistStatus,
        );
      }

      if (options.source === "auto" && result.uploaded && !result.error) {
        new Notice(`${PLUGIN_NAME}: auto-synced "${result.word}".`);
      } else if (options.source !== "auto") {
        const studylistSummary = studylistResult
          ? ` ${getStudylistPushNoticeText(studylistResult).replace(`${PLUGIN_NAME}: `, "")}`
          : "";
        new Notice(`${getSyncWordNoticeText(result)}${studylistSummary}`, 8000);
      }
    } finally {
      this.endSync(file);
    }
  }

  private async pushCurrentDirtyStudylistAssignmentAfterWordSync(file: TFile): Promise<StudylistPushSummary | null> {
    const pushFile = this.options.studylistService.getCurrentDirtyWordForPush(file);
    if (!pushFile) {
      return null;
    }

    const result = await this.options.studylistService.pushAssignments([pushFile]);
    return result.total > 0 ? result : null;
  }
}
