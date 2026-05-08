import { App, Menu, Plugin, TAbstractFile, TFile } from "obsidian";
import { getStatusIcon } from "./word-status";
import type { SyncFileOptions } from "./sync-orchestrator";
import type { SyncService } from "./sync-service";
import type { WordNoteContext } from "./types";

interface CommandControllerActions {
  syncCurrentWord: () => Promise<void>;
  syncAllDirtyWords: () => Promise<void>;
  resyncAliasesForCurrentWord: () => Promise<void>;
  deleteCurrentWordNoteInEudic: () => Promise<void>;
  deleteTypedWordNoteInEudic: () => Promise<void>;
  rebuildReferenceIndexManually: () => Promise<void>;
  rebuildLegacyReferenceMetadata: () => Promise<void>;
  repairCurrentReferenceMetadata: () => Promise<void>;
  refreshEudicStudylists: () => Promise<void>;
  pullStudylistAssignmentsFromEudic: () => Promise<void>;
  pullCurrentWordStudylistAssignmentFromEudic: () => Promise<void>;
  pushAllDirtyStudylistAssignmentsToEudic: () => Promise<void>;
  pushCurrentWordStudylistAssignmentToEudic: () => Promise<void>;
  rebuildLocalStudylistMetadata: () => Promise<void>;
  repairStudylistNamesIdsForAllWordNotes: () => Promise<void>;
  copyManagedUrlForCurrentNote: () => Promise<void>;
  formatCurrentEudicNoteBoldMarkers: () => Promise<void>;
  formatAllEudicNoteBoldMarkers: () => Promise<void>;
  createReferenceFromSelection: () => Promise<void>;
  createReferenceFromCurrentParagraph: () => Promise<void>;
  extractPendingReferencesInCurrentWord: () => Promise<void>;
  extractCurrentEudicBlockToReference: () => Promise<void>;
  wrapSelectionAsEudicBlock: () => Promise<void>;
  insertEudicBlock: () => Promise<void>;
  syncFile: (file: TFile, options?: SyncFileOptions) => Promise<void>;
}

interface CommandControllerOptions {
  plugin: Plugin;
  app: App;
  syncService: Pick<SyncService, "canSyncFile">;
  getDisplayWordContext: (file: TFile) => WordNoteContext | null;
  actions: CommandControllerActions;
}

function isMarkdownFile(file: TAbstractFile | null | undefined): file is TFile {
  return file instanceof TFile && file.extension === "md";
}

export class EudicSyncCommandController {
  constructor(private readonly options: CommandControllerOptions) {}

  registerCommands(): void {
    this.options.plugin.addCommand({
      id: "sync-current-word",
      name: "Sync current word",
      callback: () => {
        void this.options.actions.syncCurrentWord();
      },
    });

    this.options.plugin.addCommand({
      id: "sync-all-dirty-words",
      name: "Sync all dirty words",
      callback: () => {
        void this.options.actions.syncAllDirtyWords();
      },
    });

    this.options.plugin.addCommand({
      id: "resync-aliases-for-current-word",
      name: "Resync aliases for current word",
      callback: () => {
        void this.options.actions.resyncAliasesForCurrentWord();
      },
    });

    this.options.plugin.addCommand({
      id: "delete-current-word-note-in-eudic",
      name: "Delete current word note in Eudic",
      callback: () => {
        void this.options.actions.deleteCurrentWordNoteInEudic();
      },
    });

    this.options.plugin.addCommand({
      id: "delete-typed-word-note-in-eudic",
      name: "Delete typed word note in Eudic",
      callback: () => {
        void this.options.actions.deleteTypedWordNoteInEudic();
      },
    });

    this.options.plugin.addCommand({
      id: "rebuild-reference-index",
      name: "Rebuild reference graph",
      callback: () => {
        void this.options.actions.rebuildReferenceIndexManually();
      },
    });

    this.options.plugin.addCommand({
      id: "repair-reference-metadata",
      name: "Repair All reference metadata",
      callback: () => {
        void this.options.actions.rebuildLegacyReferenceMetadata();
      },
    });

    this.options.plugin.addCommand({
      id: "repair-current-reference-metadata",
      name: "Repair current reference metadata",
      callback: () => {
        void this.options.actions.repairCurrentReferenceMetadata();
      },
    });

    this.options.plugin.addCommand({
      id: "refresh-eudic-studylists",
      name: "Refresh Eudic studylists",
      callback: () => {
        void this.options.actions.refreshEudicStudylists();
      },
    });

    this.options.plugin.addCommand({
      id: "pull-studylist-assignments-from-eudic",
      name: "Pull studylist assignments from Eudic",
      callback: () => {
        void this.options.actions.pullStudylistAssignmentsFromEudic();
      },
    });

    this.options.plugin.addCommand({
      id: "pull-current-word-studylist-assignment-from-eudic",
      name: "Pull current word studylist assignment from Eudic",
      callback: () => {
        void this.options.actions.pullCurrentWordStudylistAssignmentFromEudic();
      },
    });

    this.options.plugin.addCommand({
      id: "push-all-dirty-studylist-assignments-to-eudic",
      name: "Push all dirty studylist assignments to Eudic",
      callback: () => {
        void this.options.actions.pushAllDirtyStudylistAssignmentsToEudic();
      },
    });

    this.options.plugin.addCommand({
      id: "push-current-word-studylist-assignment-to-eudic",
      name: "Push current word studylist assignment to Eudic",
      callback: () => {
        void this.options.actions.pushCurrentWordStudylistAssignmentToEudic();
      },
    });

    this.options.plugin.addCommand({
      id: "rebuild-local-studylist-metadata",
      name: "Rebuild local studylist metadata",
      callback: () => {
        void this.options.actions.rebuildLocalStudylistMetadata();
      },
    });

    this.options.plugin.addCommand({
      id: "repair-studylist-names-ids-for-all-word-notes",
      name: "Repair studylist names/ids for all word notes",
      callback: () => {
        void this.options.actions.repairStudylistNamesIdsForAllWordNotes();
      },
    });

    this.options.plugin.addCommand({
      id: "copy-managed-url-for-current-note",
      name: "Copy managed URL for current note",
      callback: () => {
        void this.options.actions.copyManagedUrlForCurrentNote();
      },
    });

    this.options.plugin.addCommand({
      id: "format-current-eudic-note-bold-markers",
      name: "Format current Eudic note bold markers",
      callback: () => {
        void this.options.actions.formatCurrentEudicNoteBoldMarkers();
      },
    });

    this.options.plugin.addCommand({
      id: "format-all-eudic-note-bold-markers",
      name: "Format all Eudic word and reference notes bold markers",
      callback: () => {
        void this.options.actions.formatAllEudicNoteBoldMarkers();
      },
    });

    this.options.plugin.addCommand({
      id: "create-reference-from-selection",
      name: "Create reference from selection",
      callback: () => {
        void this.options.actions.createReferenceFromSelection();
      },
    });

    this.options.plugin.addCommand({
      id: "create-reference-from-current-paragraph",
      name: "Create reference from current paragraph",
      callback: () => {
        void this.options.actions.createReferenceFromCurrentParagraph();
      },
    });

    this.options.plugin.addCommand({
      id: "extract-pending-references-in-current-word",
      name: "Extract pending references in current word",
      callback: () => {
        void this.options.actions.extractPendingReferencesInCurrentWord();
      },
    });

    this.options.plugin.addCommand({
      id: "extract-current-eudic-block-to-reference",
      name: "Extract current Eudic block to reference",
      callback: () => {
        void this.options.actions.extractCurrentEudicBlockToReference();
      },
    });

    this.options.plugin.addCommand({
      id: "wrap-selection-as-eudic-block",
      name: "Wrap selection as Eudic block",
      callback: () => {
        void this.options.actions.wrapSelectionAsEudicBlock();
      },
    });

    this.options.plugin.addCommand({
      id: "insert-eudic-block",
      name: "Insert Eudic block",
      callback: () => {
        void this.options.actions.insertEudicBlock();
      },
    });
  }

  registerFileMenuAction(): void {
    this.options.plugin.registerEvent(
      this.options.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (!isMarkdownFile(file)) {
          return;
        }

        if (!this.options.syncService.canSyncFile(file)) {
          return;
        }

        menu.addItem((item) => {
          const context = this.options.getDisplayWordContext(file);
          item
            .setTitle("Sync current word")
            .setIcon(getStatusIcon(context?.effectiveStatus ?? "dirty"))
            .onClick(() => {
              void this.options.actions.syncFile(file, { force: true, source: "manual" });
            });
        });
      }),
    );
  }
}
