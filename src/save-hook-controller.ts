import { App, MarkdownView, Notice, type TFile } from "obsidian";
import { EUDIC_BLOCK_LANGUAGE, normalizeEudicBlockKindsFromBody } from "./eudic-block";
import { PLUGIN_NAME } from "./constants";
import type { EudicSyncSettings } from "./types";

type MarkdownViewSave = (clear?: boolean) => Promise<void>;

interface SaveHookControllerOptions {
  app: App;
  getSettings: () => EudicSyncSettings;
  canSyncFile: (file: TFile | null | undefined) => file is TFile;
  canFormatBoldMarkers: (file: TFile | null | undefined) => file is TFile;
  getSemanticBlockKindPresets: () => string[];
  extractPendingReferences: (view: MarkdownView) => Promise<unknown>;
  toErrorMessage: (error: unknown) => string;
}

export class EudicSyncSaveHookController {
  private readonly originalViewSaves = new WeakMap<MarkdownView, MarkdownViewSave>();

  constructor(private readonly options: SaveHookControllerOptions) {}

  refresh(): void {
    const markdownLeaves = this.options.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) {
        continue;
      }

      this.installSaveHook(view);
    }
  }

  restore(): void {
    const markdownLeaves = this.options.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) {
        continue;
      }

      const originalSave = this.originalViewSaves.get(view);
      if (!originalSave) {
        continue;
      }

      view.save = originalSave;
      this.originalViewSaves.delete(view);
    }
  }

  private installSaveHook(view: MarkdownView): void {
    if (this.originalViewSaves.has(view)) {
      return;
    }

    const originalSave = view.save.bind(view) as MarkdownViewSave;
    this.originalViewSaves.set(view, originalSave);

    view.save = async (clear?: boolean): Promise<void> => {
      if (view.file && this.options.canFormatBoldMarkers(view.file)) {
        this.normalizeEudicBlockKindsBeforeSave(view);
      }

      if (
        this.options.getSettings().enableAutoExtractPendingReferencesOnSave &&
        view.file &&
        this.options.canSyncFile(view.file)
      ) {
        try {
          await this.options.extractPendingReferences(view);
        } catch (error) {
          new Notice(
            `${PLUGIN_NAME}: failed to auto-extract pending references: ${this.options.toErrorMessage(error)}`,
          );
        }
      }

      return originalSave(clear);
    };
  }

  private normalizeEudicBlockKindsBeforeSave(view: MarkdownView): void {
    const currentMarkdown = view.editor.getValue();
    if (!currentMarkdown.includes(EUDIC_BLOCK_LANGUAGE)) {
      return;
    }

    const result = normalizeEudicBlockKindsFromBody(currentMarkdown, this.options.getSemanticBlockKindPresets());
    if (!result.changed) {
      return;
    }

    view.editor.setValue(result.markdown);
  }
}
