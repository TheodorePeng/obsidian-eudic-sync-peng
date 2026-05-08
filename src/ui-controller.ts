import { App, MarkdownView, Notice, setIcon, type TFile } from "obsidian";
import { PLUGIN_NAME } from "./constants";
import type { EudicSyncSettings, WordNoteContext } from "./types";
import { getStatusIcon } from "./word-status";

interface UiControllerOptions {
  app: App;
  getSettings: () => EudicSyncSettings;
  getActiveMarkdownFile: () => TFile | null;
  getDisplayWordContext: (file: TFile) => WordNoteContext | null;
  isSyncInFlight: (file: TFile) => boolean;
  syncCurrentWord: () => Promise<void>;
}

export class EudicSyncUiController {
  private readonly headerActions = new WeakMap<MarkdownView, HTMLElement>();
  private readonly headerActionFilePaths = new WeakMap<MarkdownView, string>();
  private statusBarEl: HTMLElement | null = null;

  constructor(private readonly options: UiControllerOptions) {}

  initialize(statusBarEl: HTMLElement): void {
    this.statusBarEl = statusBarEl;
    this.statusBarEl.addClass("eudic-sync-status-bar");
  }

  refresh(): void {
    this.refreshStatusBar();
    this.refreshHeaderActions();
  }

  clearHeaderActions(): void {
    const markdownLeaves = this.options.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        this.removeHeaderAction(view);
      }
    }
  }

  private refreshStatusBar(): void {
    if (!this.statusBarEl) {
      return;
    }

    this.statusBarEl.empty();
    this.statusBarEl.removeClass("is-hidden");
    delete this.statusBarEl.dataset.status;
    this.statusBarEl.onclick = null;

    if (!this.options.getSettings().enableStatusBarSyncButton) {
      this.statusBarEl.addClass("is-hidden");
      return;
    }

    const file = this.options.getActiveMarkdownFile();
    if (!file) {
      this.statusBarEl.addClass("is-hidden");
      return;
    }

    const context = this.options.getDisplayWordContext(file);
    if (!context) {
      this.statusBarEl.addClass("is-hidden");
      return;
    }

    const isSyncing = this.options.isSyncInFlight(file);
    this.statusBarEl.dataset.status = context.effectiveStatus;
    if (!isSyncing) {
      this.statusBarEl.onclick = () => {
        void this.options.syncCurrentWord();
      };
    }

    const statusLabel = `Eudic: ${context.effectiveStatus}`;
    const titleParts = [
      `${PLUGIN_NAME}: ${context.word} is ${context.effectiveStatus}.`,
      `Body: ${context.bodyStatus}.`,
      `Studylist: ${context.studylistStatus}.`,
    ];
    if (isSyncing) {
      titleParts.push("Syncing...");
    } else {
      titleParts.push("Click to sync the current word.");
    }
    if (context.lastError) {
      titleParts.push(`Last error: ${context.lastError}`);
    }

    this.statusBarEl.setAttribute("aria-label", titleParts.join(" "));

    const iconEl = this.statusBarEl.createSpan({ cls: "eudic-sync-status-bar-icon" });
    setIcon(iconEl, getStatusIcon(context.effectiveStatus));
    this.statusBarEl.createSpan({ text: statusLabel });
  }

  private refreshHeaderActions(): void {
    if (!this.options.getSettings().enableHeaderSyncButton) {
      this.clearHeaderActions();
      return;
    }

    const activeView = this.options.app.workspace.getActiveViewOfType(MarkdownView);
    const file = activeView?.file;
    if (!activeView || !file) {
      this.clearHeaderActions();
      return;
    }

    const context = this.options.getDisplayWordContext(file);
    if (!context) {
      this.clearHeaderActions();
      return;
    }

    this.removeInactiveHeaderActions(activeView);

    const isSyncing = this.options.isSyncInFlight(file);
    const titleParts = [
      `Eudic Sync: ${context.effectiveStatus}`,
      `Body: ${context.bodyStatus}`,
      `Studylist: ${context.studylistStatus}`,
    ];
    if (isSyncing) {
      titleParts.push("Syncing...");
    }
    if (context.lastError) {
      titleParts.push(`Last error: ${context.lastError}`);
    }
    const title = titleParts.join(" | ");
    const icon = getStatusIcon(context.effectiveStatus);
    const existingAction = this.headerActions.get(activeView);
    const existingFilePath = this.headerActionFilePaths.get(activeView);

    if (existingAction && existingFilePath === file.path) {
      setIcon(existingAction, icon);
      existingAction.dataset.status = context.effectiveStatus;
      existingAction.setAttribute("aria-label", title);
      existingAction.setAttribute("title", title);
      return;
    }

    this.removeHeaderAction(activeView);

    const action = activeView.addAction(icon, title, () => {
      if (this.options.isSyncInFlight(file)) {
        new Notice(`${PLUGIN_NAME}: "${file.basename}" is already syncing.`);
        return;
      }

      void this.options.syncCurrentWord();
    });
    action.addClass("eudic-sync-header-action");
    action.dataset.status = context.effectiveStatus;
    this.headerActions.set(activeView, action);
    this.headerActionFilePaths.set(activeView, file.path);
  }

  private removeInactiveHeaderActions(activeView: MarkdownView): void {
    const markdownLeaves = this.options.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view !== activeView) {
        this.removeHeaderAction(view);
      }
    }
  }

  private removeHeaderAction(view: MarkdownView): void {
    const existingAction = this.headerActions.get(view);
    if (!existingAction) {
      return;
    }

    existingAction.remove();
    this.headerActions.delete(view);
    this.headerActionFilePaths.delete(view);
  }
}
