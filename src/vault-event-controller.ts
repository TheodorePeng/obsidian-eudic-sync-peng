import { Notice, Plugin, TAbstractFile, TFile, type App, type Editor, normalizePath } from "obsidian";
import { PLUGIN_NAME } from "./constants";

interface VaultEventControllerOptions {
  app: App;
  plugin: Plugin;
  isUnloaded: () => boolean;
  onLayoutReady: () => void;
  onEditorChange: (file: TFile, markdown: string, editor: Editor) => void | Promise<void>;
  onModify: (file: TAbstractFile) => void | Promise<void>;
  onCreate: (file: TAbstractFile) => void | Promise<void>;
  onDelete: (file: TAbstractFile) => void | Promise<void>;
  onRename: (file: TAbstractFile, oldPath: string) => void | Promise<void>;
  onMetadataChanged: (file: TFile) => void;
  flushUi: () => void;
  refreshReferenceUsage: (referencePaths: string[]) => Promise<void>;
  toErrorMessage: (error: unknown) => string;
}

export class EudicSyncVaultEventController {
  private vaultEventsRegistered = false;
  private uiRefreshTimer: number | null = null;
  private referenceUsageRefreshTimer: number | null = null;
  private readonly pendingReferenceUsagePaths = new Set<string>();

  constructor(private readonly options: VaultEventControllerOptions) {}

  registerOnLayoutReady(): void {
    this.options.app.workspace.onLayoutReady(() => {
      if (this.options.isUnloaded()) {
        return;
      }

      this.registerVaultEvents();
      this.options.onLayoutReady();
      this.refreshUi();
    });
  }

  refreshUi(): void {
    if (this.options.isUnloaded() || this.uiRefreshTimer !== null) {
      return;
    }

    this.uiRefreshTimer = window.setTimeout(() => {
      this.uiRefreshTimer = null;
      if (!this.options.isUnloaded()) {
        this.options.flushUi();
      }
    }, 0);
  }

  scheduleReferenceUsageRefresh(referencePaths: Iterable<string>): void {
    for (const referencePath of referencePaths) {
      const normalizedPath = normalizePath(referencePath);
      if (normalizedPath) {
        this.pendingReferenceUsagePaths.add(normalizedPath);
      }
    }

    if (
      this.options.isUnloaded() ||
      this.referenceUsageRefreshTimer !== null ||
      this.pendingReferenceUsagePaths.size === 0
    ) {
      return;
    }

    this.referenceUsageRefreshTimer = window.setTimeout(() => {
      this.referenceUsageRefreshTimer = null;
      void this.flushReferenceUsageRefresh();
    }, 150);
  }

  clear(): void {
    if (this.uiRefreshTimer !== null) {
      window.clearTimeout(this.uiRefreshTimer);
      this.uiRefreshTimer = null;
    }

    if (this.referenceUsageRefreshTimer !== null) {
      window.clearTimeout(this.referenceUsageRefreshTimer);
      this.referenceUsageRefreshTimer = null;
    }

    this.pendingReferenceUsagePaths.clear();
  }

  private registerVaultEvents(): void {
    if (this.vaultEventsRegistered) {
      return;
    }

    this.vaultEventsRegistered = true;
    this.options.plugin.registerEvent(
      this.options.app.vault.on("modify", (file) => {
        void this.options.onModify(file);
      }),
    );

    this.options.plugin.registerEvent(
      this.options.app.workspace.on("editor-change", (editor, info) => {
        const file = info.file;
        if (!(file instanceof TFile) || file.extension !== "md") {
          return;
        }

        void this.options.onEditorChange(file, editor.getValue(), editor);
      }),
    );

    this.options.plugin.registerEvent(
      this.options.app.vault.on("create", (file) => {
        void this.options.onCreate(file);
      }),
    );

    this.options.plugin.registerEvent(
      this.options.app.vault.on("delete", (file) => {
        void this.options.onDelete(file);
      }),
    );

    this.options.plugin.registerEvent(
      this.options.app.vault.on("rename", (file, oldPath) => {
        void this.options.onRename(file, oldPath);
      }),
    );

    this.options.plugin.registerEvent(
      this.options.app.metadataCache.on("changed", (file) => {
        this.options.onMetadataChanged(file);
      }),
    );
  }

  private async flushReferenceUsageRefresh(): Promise<void> {
    if (this.options.isUnloaded() || this.pendingReferenceUsagePaths.size === 0) {
      return;
    }

    const referencePaths = Array.from(this.pendingReferenceUsagePaths);
    this.pendingReferenceUsagePaths.clear();

    try {
      await this.options.refreshReferenceUsage(referencePaths);
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to refresh Reference usage`, error);
      new Notice(`${PLUGIN_NAME}: failed to refresh Reference usage: ${this.options.toErrorMessage(error)}`, 8000);
    } finally {
      this.refreshUi();
    }
  }
}
