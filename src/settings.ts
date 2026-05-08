import { App, Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import { PLUGIN_NAME } from "./constants";
import { FolderInputSuggest } from "./folder-suggest";
import { buildExportSettingsPayload, normalizeFolderPath, readImportedSettingsPayload } from "./settings-data";
import type EudicSyncPlugin from "./main";

function normalizePathInput(value: string): string {
  const normalized = normalizeFolderPath(value);
  return normalized ? normalizePath(normalized) : "";
}

function createSection(containerEl: HTMLElement, title: string, description: string): HTMLElement {
  const sectionEl = containerEl.createDiv({ cls: "eudic-sync-settings-section" });
  sectionEl.createEl("h3", { text: title });
  sectionEl.createDiv({ cls: "eudic-sync-settings-section-description", text: description });
  return sectionEl;
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function configureTextarea(text: { inputEl: HTMLTextAreaElement }, rows: number): void {
  text.inputEl.rows = rows;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function padTimestampPart(value: number): string {
  return String(value).padStart(2, "0");
}

function formatBackupFilenameTimestamp(date: Date): string {
  return `${date.getFullYear()}${padTimestampPart(date.getMonth() + 1)}${padTimestampPart(date.getDate())}-${padTimestampPart(date.getHours())}${padTimestampPart(date.getMinutes())}${padTimestampPart(date.getSeconds())}`;
}

function downloadJsonFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export class EudicSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: EudicSyncPlugin) {
    super(app, plugin);
  }

  private exportSettingsBackup(): void {
    const payload = buildExportSettingsPayload(this.plugin.settings);
    const filename = `eudic-sync-settings-${formatBackupFilenameTimestamp(new Date())}.json`;
    downloadJsonFile(filename, `${JSON.stringify(payload, null, 2)}\n`);
    new Notice(`${PLUGIN_NAME}: exported plugin settings backup.`, 5000);
  }

  private openImportSettingsPicker(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    const cleanup = (): void => {
      input.remove();
    };
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        cleanup();
        if (!file) {
          return;
        }

        void this.importSettingsBackup(file);
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
    window.setTimeout(() => {
      window.addEventListener(
        "focus",
        () => {
          if (!input.files?.length) {
            cleanup();
          }
        },
        { once: true },
      );
    }, 0);
  }

  private async importSettingsBackup(file: File): Promise<void> {
    try {
      const rawContent = await file.text();
      const parsed = JSON.parse(rawContent) as unknown;
      const result = readImportedSettingsPayload(parsed);
      await this.plugin.updateSettings(result.settings);
      this.display();

      const suffix = result.notices.length > 0 ? ` ${result.notices.join(" ")}` : "";
      new Notice(`${PLUGIN_NAME}: imported plugin settings backup.${suffix}`, 8000);
    } catch (error) {
      if (error instanceof SyntaxError) {
        new Notice(`${PLUGIN_NAME}: invalid JSON in settings backup file.`, 8000);
        return;
      }

      new Notice(toErrorMessage(error), 8000);
    }
  }

  display(): void {
    const { containerEl } = this;
    const { settings } = this.plugin;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Eudic Sync" });
    containerEl.createDiv({
      cls: "eudic-sync-settings-intro",
      text: "Configure folders and Eudic connection first, then tune writing helpers and semantic block behavior.",
    });

    const basicSection = createSection(
      containerEl,
      "Basic setup",
      "先确认插件管理哪些笔记，以及如何连接欧路词典 OpenAPI。",
    );

    new Setting(basicSection)
      .setName("Word notes folder")
      .setDesc("Vault-relative path for word notes. Any vault-relative path can be used.")
      .addText((text) => {
        new FolderInputSuggest(this.app, text.inputEl, async (value) => {
          const normalizedValue = normalizePathInput(value) || "Eudic/Words";
          text.setValue(normalizedValue);
          await this.plugin.updateSettings({ wordFolder: normalizedValue });
        });

        text
          .setPlaceholder("Eudic/Words")
          .setValue(settings.wordFolder)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ wordFolder: normalizePathInput(value) || "Eudic/Words" });
          });
      });

    new Setting(basicSection)
      .setName("Reference notes folder")
      .setDesc("Vault-relative path for reference notes. Any vault-relative path can be used.")
      .addText((text) => {
        new FolderInputSuggest(this.app, text.inputEl, async (value) => {
          const normalizedValue = normalizePathInput(value) || "Eudic/References";
          text.setValue(normalizedValue);
          await this.plugin.updateSettings({ referenceFolder: normalizedValue });
        });

        text
          .setPlaceholder("Eudic/References")
          .setValue(settings.referenceFolder)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ referenceFolder: normalizePathInput(value) || "Eudic/References" });
          });
      });

    new Setting(basicSection)
      .setName("Eudic Authorization")
      .setDesc("Authorization header value for the Eudic OpenAPI.")
      .addText((text) => {
        text
          .setPlaceholder("NIS xxxx")
          .setValue(settings.authorizationToken)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ authorizationToken: value.trim() });
          });
        text.inputEl.type = "password";
      });

    const syncOutputSection = createSection(
      containerEl,
      "Sync output",
      "控制同步到欧路词典端时的最终输出方式，以及离开词条时是否自动同步。",
    );

    new Setting(syncOutputSection)
      .setName("Final note output mode")
      .setDesc("Choose how the final synced note HTML is generated for Eudic.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("minimal", "Minimal")
          .addOption("compatible", "Compatible")
          .setValue(settings.noteOutputMode)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ noteOutputMode: value === "compatible" ? "compatible" : "minimal" });
          });
      });

    new Setting(syncOutputSection)
      .setName("Auto-sync when leaving word")
      .setDesc("When enabled, leaving a dirty word note schedules an automatic sync for that word.")
      .addToggle((toggle) => {
        toggle
          .setValue(settings.enableAutoSyncWordOnLeave)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ enableAutoSyncWordOnLeave: value });
          });
      });

    new Setting(syncOutputSection)
      .setName("Studylist category authority")
      .setDesc(
        "Obsidian chooses which existing Eudic studylists a word belongs to. Create, rename, and delete studylist categories in Eudic cloud first, then refresh them back into Obsidian. Empty studylist fields are safe by default: they are pushed only when the word is explicitly dirty.",
      );

    new Setting(syncOutputSection)
      .setName("Reference metadata writeback")
      .setDesc("Reference relationships are inferred from word-note embeds and written into visible reference properties for stable linking and repair.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("auto", "Auto")
          .addOption("manual", "Manual command only")
          .addOption("off", "Off")
          .setValue(settings.referenceMetadataWriteMode)
          .onChange(async (value) => {
            await this.plugin.updateSettings({
              referenceMetadataWriteMode: value === "manual" || value === "off" ? value : "auto",
            });
          });
      });

    const writingHelpersSection = createSection(
      containerEl,
      "Writing helpers",
      "这些设置影响你在 Obsidian 中写笔记时的自动格式化和 reference 提取体验。",
    );

    new Setting(writingHelpersSection)
      .setName("Auto bold markers while editing")
      .setDesc("Automatically write Markdown bold syntax around configured markers while editing managed word or reference notes.")
      .addToggle((toggle) => {
        toggle
          .setValue(settings.enableAutoBoldMarkersOnEdit)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ enableAutoBoldMarkersOnEdit: value });
          });
      });

    new Setting(writingHelpersSection)
      .setName("Bold markers")
      .setDesc("Literal markers to bold in managed notes. Enter one marker per line; regular expressions are not supported.")
      .addTextArea((text) => {
        text
          .setPlaceholder("n.\ne.g.\nSyn.\nCog.\nP.S.")
          .setValue(settings.boldMarkers.join("\n"))
          .onChange(async (value) => {
            await this.plugin.updateSettings({ boldMarkers: parseLines(value) });
          });
        configureTextarea(text, 6);
      });

    new Setting(writingHelpersSection)
      .setName("Auto-extract pending references on save")
      .setDesc(
        "When enabled, saving a word note converts ```eudic-reference``` blocks into shared reference notes before the note is written. Legacy ```eudic-example``` blocks are still recognized.",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(settings.enableAutoExtractPendingReferencesOnSave)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ enableAutoExtractPendingReferencesOnSave: value });
          });
      });

    const semanticBlockSection = createSection(
      containerEl,
      "Semantic blocks",
      "配置语义块类型识别，以及在预览和同步输出时如何自动处理当前词条。",
    );

    new Setting(semanticBlockSection)
      .setName("Semantic block kind presets")
      .setDesc(
        "Enter one semantic block kind per line. These presets are used by Insert Eudic block, Wrap selection as Eudic block, and save/sync kind auto-detection.",
      )
      .addTextArea((text) => {
        text
          .setPlaceholder("n.\nv.\na.\nCog.\nSyn.\nSyn./Cog.\nAnt.\nP.S.")
          .setValue(settings.semanticBlockKindPresets.join("\n"))
          .onChange(async (value) => {
            await this.plugin.updateSettings({ semanticBlockKindPresets: parseLines(value) });
          });
        configureTextarea(text, 8);
      });

    new Setting(semanticBlockSection)
      .setName("Auto-bold word in semantic blocks")
      .setDesc(
        "Automatically bold the current word inside matching semantic block kinds during preview and sync rendering. Can combine with auto-link as a bold link; manually bolded word text keeps its source styling.",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(settings.enableSemanticBlockWordBold)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ enableSemanticBlockWordBold: value });
          });
      });

    new Setting(semanticBlockSection)
      .setName("Render bold markers in semantic blocks")
      .setDesc(
        "Use Writing helpers > Bold markers during semantic block preview and sync rendering without modifying the source Markdown.",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(settings.enableSemanticBlockMarkerBold)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ enableSemanticBlockMarkerBold: value });
          });
      });

    new Setting(semanticBlockSection)
      .setName("Semantic block kinds for word bolding")
      .setDesc("Enter one semantic block kind per line. Matching kinds bold the whole word when it starts with the current word, such as absent -> **absently**.")
      .addTextArea((text) => {
        text
          .setPlaceholder("n.\nv.\na.\nadj.\nadv.")
          .setValue(settings.semanticBlockWordBoldKinds.join("\n"))
          .onChange(async (value) => {
            await this.plugin.updateSettings({ semanticBlockWordBoldKinds: parseLines(value) });
          });
        configureTextarea(text, 6);
      });

    new Setting(semanticBlockSection)
      .setName("Auto-link word in semantic blocks")
      .setDesc(
        "Automatically add managed Obsidian URL Scheme links inside matching semantic block kinds. Manually bolded words can still be linked, and partial bold styling is preserved. Word-note blocks link the current word; reference blocks link all words that reference that note.",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(settings.enableSemanticBlockWordLinks)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ enableSemanticBlockWordLinks: value });
          });
      });

    new Setting(semanticBlockSection)
      .setName("Semantic block kinds for word links")
      .setDesc("Enter one semantic block kind per line. Matching kinds link only full current-word occurrences, such as absent but not absence.")
      .addTextArea((text) => {
        text
          .setPlaceholder("Cog.\nSyn.\nSyn./Cog.\nAnt.")
          .setValue(settings.semanticBlockWordLinkKinds.join("\n"))
          .onChange(async (value) => {
            await this.plugin.updateSettings({ semanticBlockWordLinkKinds: parseLines(value) });
          });
        configureTextarea(text, 6);
      });

    const obsidianUiSection = createSection(
      containerEl,
      "Obsidian UI",
      "控制插件在 Obsidian 界面中显示哪些同步入口和状态提示。",
    );

    new Setting(obsidianUiSection)
      .setName("Enable note header sync button")
      .setDesc("Show a sync action in the current Markdown note header.")
      .addToggle((toggle) => {
        toggle
          .setValue(settings.enableHeaderSyncButton)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ enableHeaderSyncButton: value });
          });
      });

    new Setting(obsidianUiSection)
      .setName("Enable status bar sync button")
      .setDesc("Show sync status and a clickable sync action in the status bar.")
      .addToggle((toggle) => {
        toggle
          .setValue(settings.enableStatusBarSyncButton)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ enableStatusBarSyncButton: value });
          });
      });

    const backupSection = createSection(
      containerEl,
      "Settings backup",
      "备份、迁移或恢复插件设置。导出的 JSON 默认包含 Eudic Authorization Token，请按敏感信息保管。",
    );

    new Setting(backupSection)
      .setName("Import and export")
      .setDesc("Export a portable JSON backup, or import a previously exported settings file into this vault.")
      .addButton((button) => {
        button.setButtonText("Export settings").onClick(() => {
          this.exportSettingsBackup();
        });
      })
      .addButton((button) => {
        button.setButtonText("Import settings").setCta().onClick(() => {
          this.openImportSettingsPicker();
        });
      });
  }
}
