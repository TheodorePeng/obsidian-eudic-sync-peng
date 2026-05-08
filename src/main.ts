import {
  MarkdownRenderChild,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  type Editor,
  type ObsidianProtocolData,
  normalizePath,
} from "obsidian";
import { createAutoBoldMarkersExtension } from "./auto-bold-markers-extension";
import { EudicSyncCommandController } from "./command-controller";
import { DEFAULT_SETTINGS, FRONTMATTER_KEYS, NOTE_OUTPUT_FORMAT_VERSION, PLUGIN_NAME, SUPPRESSED_WRITE_TTL_MS } from "./constants";
import {
  confirmEudicAction,
  confirmDeleteEudicNote,
  promptDeleteTypedWordNote,
} from "./delete-note-modal";
import {
  buildManagedFileProtocolUrl,
  createEudicLinkId,
  EUDIC_PROTOCOL_ACTION,
  readEudicLinkId,
  resolveManagedFileFromProtocol,
} from "./eudic-link";
import {
  buildEudicBlock,
  DEFAULT_EUDIC_BLOCK_KIND,
  EUDIC_BLOCK_LANGUAGE,
  extractLeadingPresetKindFromList,
  findEudicBlockFenceForBody,
  renderEudicBlockToMarkdown,
} from "./eudic-block";
import { ReferenceNoteService, hasPendingReferenceBlocks } from "./reference-note-service";
import { formatBoldMarkersInMarkdown } from "./markdown-bold-markers";
import { ManagedFileRegistry } from "./managed-file-registry";
import { getFrontmatter } from "./note-metadata";
import { PathScope } from "./path-scope";
import { PerformanceMonitor } from "./performance-monitor";
import { ReferenceGraphService } from "./reference-index-service";
import { resolveManagedReferencePaths } from "./reference-links";
import { SemanticBlockAutomationResolver } from "./semantic-block-automation-resolver";
import type { SemanticBlockTransformOptions } from "./semantic-block-transform";
import { EudicSyncSettingTab } from "./settings";
import { migrateLoadedSettings } from "./settings-data";
import { EudicSyncSaveHookController } from "./save-hook-controller";
import { StudylistService } from "./studylist-service";
import { applySyncStatusPatchToEditor, buildSyncStatusPatch } from "./sync-status-frontmatter-patch";
import {
  applyWordSyncFrontmatterPatchToEditor,
  applyWordSyncFrontmatterToObject,
  setWordSyncFrontmatterInMarkdown,
  type WordSyncFrontmatterPatchData,
} from "./word-sync-frontmatter-patch";
import { SyncService } from "./sync-service";
import {
  getDeleteNoteNoticeText,
  getResyncAliasesNoticeText,
  getStudylistPushNoticeText,
  getStudylistRefreshNoticeText,
} from "./sync-notice-text";
import { SyncOrchestrator, type SyncFileOptions } from "./sync-orchestrator";
import type {
  EudicStudylistCache,
  EudicSyncSettings,
  EudicSyncStatus,
  FrontmatterMutator,
  WordNoteContext,
} from "./types";
import { EudicSyncUiController } from "./ui-controller";
import { EudicSyncVaultEventController } from "./vault-event-controller";
import { resolveWordDirtySignatureDecision } from "./word-dirty-signature-state";
import { ensureManagedWordProperties } from "./word-frontmatter";
import { getWordSyncSignature } from "./word-sync-signature";
import { WordStatusOverrideStore } from "./word-status";

interface SuppressedWriteEntry {
  expiresAt: number;
}

interface PendingOpenWordStatusWrite {
  bodyDirty?: boolean;
  bodyError?: string | null;
}

const AUTO_SYNC_AFTER_LEAVE_DELAY_MS = 2000;
const EDITOR_CHANGE_DEBOUNCE_MS = 150;

interface BoldMarkerNoteFormatResult {
  changed: boolean;
  replacements: number;
}

function isMarkdownFile(file: TAbstractFile | null | undefined): file is TFile {
  return file instanceof TFile && file.extension === "md";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function hasYamlFrontmatter(markdown: string): boolean {
  return /^---\s*\n[\s\S]*?\n---(?:\s*\n|$)/.test(markdown);
}

function prependReferenceFrontmatter(markdown: string, linkId: string): string {
  const body = markdown.replace(/^\uFEFF/, "");
  const frontmatterBlock = [
    "---",
    `${FRONTMATTER_KEYS.eudicLinkId}: ${linkId}`,
    "---",
  ].join("\n");
  if (body.trim().length === 0) {
    return `${frontmatterBlock}\n`;
  }

  return `${frontmatterBlock}\n\n${body}`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Clipboard copy failed.");
    }
  } finally {
    textarea.remove();
  }
}

export default class EudicSyncPlugin extends Plugin {
  settings: EudicSyncSettings = DEFAULT_SETTINGS;

  private readonly pathScope = new PathScope(DEFAULT_SETTINGS);
  private readonly managedFiles = new ManagedFileRegistry(this.app, this.pathScope);
  private readonly perf = new PerformanceMonitor();
  private readonly referenceIndex = new ReferenceGraphService({
    app: this.app,
    pathScope: this.pathScope,
    managedFiles: this.managedFiles,
    writeFrontmatter: async (file, mutate) => {
      await this.writeFrontmatter(file, mutate);
    },
    getReferenceMetadataWriteMode: () => this.settings.referenceMetadataWriteMode,
  });
  private readonly semanticBlockAutomation = new SemanticBlockAutomationResolver({
    app: this.app,
    pathScope: this.pathScope,
    managedFiles: this.managedFiles,
    referenceIndex: this.referenceIndex,
    getSettings: () => this.settings,
  });
  private readonly suppressedWrites = new Map<string, SuppressedWriteEntry>();
  private readonly inFlightDeletePaths = new Set<string>();
  private typedDeleteInFlight = false;
  private readonly leaveAutoSyncTimers = new Map<string, number>();
  private readonly wordStatusOverrides = new WordStatusOverrideStore();
  private readonly wordSyncSignatures = new Map<string, string>();
  private readonly wordCleanSyncSignatures = new Map<string, string>();
  private readonly pendingOpenWordStatusWrites = new Map<string, PendingOpenWordStatusWrite>();
  private readonly flushingOpenWordStatusWritePaths = new Set<string>();
  private readonly editorChangeTimers = new Map<string, number>();
  private readonly autoBodyDirtyPaths = new Set<string>();
  private readonly restorableEditorBodyDirtyPaths = new Set<string>();
  private readonly nonRestorableBodyDirtyPaths = new Set<string>();
  private readonly syncingEditorWordStatusPatchSignatures = new Map<string, string>();
  private readonly startupKnownPaths = new Set<string>();
  private readonly startupNotices: string[] = [];
  private lastActiveWordPath: string | null = null;
  private startupKnownPathClearTimer: number | null = null;
  private isUnloaded = false;
  private referenceNoteService!: ReferenceNoteService;
  private syncService!: SyncService;
  private studylistService!: StudylistService;
  private commandController!: EudicSyncCommandController;
  private saveHookController!: EudicSyncSaveHookController;
  private syncOrchestrator!: SyncOrchestrator;
  private uiController!: EudicSyncUiController;
  private vaultEventController!: EudicSyncVaultEventController;

  async onload(): Promise<void> {
    this.isUnloaded = false;
    await this.loadSettings();
    this.managedFiles.rebuild();
    this.captureStartupKnownPaths();

    this.referenceNoteService = new ReferenceNoteService(this.app, this.pathScope);
    this.syncService = new SyncService({
      app: this.app,
      pathScope: this.pathScope,
      managedFiles: this.managedFiles,
      getSettings: () => this.settings,
      referenceIndex: this.referenceIndex,
      ensureWordLinkId: async (file) => this.ensureWordManagedFrontmatterForSync(file),
      writeSyncFrontmatter: async (file, data) => {
        await this.writeWordSyncFrontmatter(file, data);
      },
    });
    this.studylistService = new StudylistService({
      app: this.app,
      pathScope: this.pathScope,
      managedFiles: this.managedFiles,
      getAuthorizationToken: () => this.settings.authorizationToken,
      getStudylistCache: () => this.settings.studylistCache,
      setStudylistCache: async (cache) => {
        await this.setStudylistCache(cache);
      },
      writeFrontmatter: async (file, mutate) => {
        await this.writeStudylistFrontmatter(file, mutate);
      },
    });
    this.syncOrchestrator = new SyncOrchestrator({
      syncService: this.syncService,
      studylistService: this.studylistService,
      saveActiveViewForFile: async (file) => this.saveActiveViewForFile(file),
      getDisplayWordContext: (file) => this.getDisplayWordContext(file),
      setWordStatusOverride: (file, status, lastError, bodyStatus, studylistStatus) => {
        this.setWordStatusOverride(file, status, lastError, bodyStatus, studylistStatus);
      },
      refreshUi: () => this.refreshUi(),
    });
    this.saveHookController = new EudicSyncSaveHookController({
      app: this.app,
      getSettings: () => this.settings,
      canSyncFile: (file) => this.syncService.canSyncFile(file),
      canFormatBoldMarkers: (file) => this.canFormatBoldMarkers(file),
      getSemanticBlockKindPresets: () => this.getSemanticBlockKindPresets(),
      extractPendingReferences: (view) => this.referenceNoteService.extractPendingReferences(view),
      toErrorMessage,
    });
    this.uiController = new EudicSyncUiController({
      app: this.app,
      getSettings: () => this.settings,
      getActiveMarkdownFile: () => this.getActiveMarkdownFile(),
      getDisplayWordContext: (file) => this.getDisplayWordContext(file),
      isSyncInFlight: (file) => this.isSyncInFlight(file),
      syncCurrentWord: () => this.syncCurrentWord(),
    });
    this.vaultEventController = new EudicSyncVaultEventController({
      app: this.app,
      plugin: this,
      isUnloaded: () => this.isUnloaded,
      onLayoutReady: () => {
        this.lastActiveWordPath = this.getActiveWordPath();
        this.scheduleStartupKnownPathClear();
      },
      onEditorChange: (file, markdown, editor) => this.handleEditorChange(file, markdown, editor),
      onModify: (file) => this.handleModify(file),
      onCreate: (file) => this.handleCreate(file),
      onDelete: (file) => this.handleDelete(file),
      onRename: (file, oldPath) => this.handleRename(file, oldPath),
      onMetadataChanged: (file) => this.handleMetadataCacheChanged(file),
      flushUi: () => this.flushUi(),
      refreshReferenceUsage: (referencePaths) => this.refreshReferenceUsage(referencePaths),
      toErrorMessage,
    });
    this.commandController = new EudicSyncCommandController({
      plugin: this,
      app: this.app,
      syncService: this.syncService,
      getDisplayWordContext: (file) => this.getDisplayWordContext(file),
      actions: {
        syncCurrentWord: () => this.syncCurrentWord(),
        syncAllDirtyWords: () => this.syncAllDirtyWords(),
        resyncAliasesForCurrentWord: () => this.resyncAliasesForCurrentWord(),
        deleteCurrentWordNoteInEudic: () => this.deleteCurrentWordNoteInEudic(),
        deleteTypedWordNoteInEudic: () => this.deleteTypedWordNoteInEudic(),
        rebuildReferenceIndexManually: () => this.rebuildReferenceIndexManually(),
        rebuildLegacyReferenceMetadata: () => this.rebuildLegacyReferenceMetadata(),
        repairCurrentReferenceMetadata: () => this.repairCurrentReferenceMetadata(),
        refreshEudicStudylists: () => this.refreshEudicStudylists(),
        pullStudylistAssignmentsFromEudic: () => this.pullStudylistAssignmentsFromEudic(),
        pullCurrentWordStudylistAssignmentFromEudic: () => this.pullCurrentWordStudylistAssignmentFromEudic(),
        pushAllDirtyStudylistAssignmentsToEudic: () => this.pushAllDirtyStudylistAssignmentsToEudic(),
        pushCurrentWordStudylistAssignmentToEudic: () => this.pushCurrentWordStudylistAssignmentToEudic(),
        rebuildLocalStudylistMetadata: () => this.rebuildLocalStudylistMetadata(),
        repairStudylistNamesIdsForAllWordNotes: () => this.repairStudylistNamesIdsForAllWordNotes(),
        copyManagedUrlForCurrentNote: () => this.copyManagedUrlForCurrentNote(),
        formatCurrentEudicNoteBoldMarkers: () => this.formatCurrentEudicNoteBoldMarkers(),
        formatAllEudicNoteBoldMarkers: () => this.formatAllEudicNoteBoldMarkers(),
        createReferenceFromSelection: () => this.createReferenceFromSelection(),
        createReferenceFromCurrentParagraph: () => this.createReferenceFromCurrentParagraph(),
        extractPendingReferencesInCurrentWord: () => this.extractPendingReferencesInCurrentWord(),
        extractCurrentEudicBlockToReference: () => this.extractCurrentEudicBlockToReference(),
        wrapSelectionAsEudicBlock: () => this.wrapSelectionAsEudicBlock(),
        insertEudicBlock: () => this.insertEudicBlock(),
        syncFile: (file, options) => this.syncFile(file, options),
      },
    });

    this.addSettingTab(new EudicSyncSettingTab(this.app, this));
    this.registerEditorExtension(createAutoBoldMarkersExtension({
      pathScope: this.pathScope,
      getSettings: () => this.settings,
    }));
    this.registerMarkdownProcessors();
    this.uiController.initialize(this.addStatusBarItem());
    this.commandController.registerCommands();
    this.registerWorkspaceEvents();
    this.commandController.registerFileMenuAction();
    this.registerProtocolHandler();

    await this.perf.measure("startup.ensureReferenceFrontmatter", () => this.ensureAllReferenceManagedFrontmatter());
    await this.perf.measure("startup.ensureWordFrontmatter", () => this.ensureAllWordManagedFrontmatter());
    await this.perf.measure("startup.ensureStudylistFrontmatter", () => this.studylistService.ensureAllWordStudylistFrontmatter());
    this.perf.measure("startup.captureStudylistSnapshots", () => this.studylistService.captureAllLocalSnapshots());
    await this.perf.measure("startup.ensureNoteOutputFormatVersion", () => this.ensureCurrentNoteOutputFormatVersion());
    await this.perf.measure("startup.captureWordSyncSignatures", () => this.captureWordSyncSignatures());
    await this.perf.measure("startup.rebuildReferenceIndex", () => this.rebuildReferenceIndex());
    this.lastActiveWordPath = this.getActiveWordPath();
    this.refreshUi();
    this.registerVaultEventsOnLayoutReady();

    for (const message of this.startupNotices) {
      new Notice(message, 8000);
    }
  }

  onunload(): void {
    this.isUnloaded = true;
    this.clearStartupKnownPathTimer();
    this.clearAutoSyncTimers();
    this.clearEditorChangeTimers();
    this.vaultEventController.clear();
    this.uiController.clearHeaderActions();
    this.saveHookController.restore();
  }

  async updateSettings(partial: Partial<EudicSyncSettings>): Promise<void> {
    const previousSettings = this.settings;
    this.settings = Object.assign({}, this.settings, partial);
    this.pathScope.updateSettings(this.settings);
    this.managedFiles.rebuild();
    this.invalidateSemanticReferenceCaches();
    await this.saveData(this.settings);
    await this.rebuildReferenceIndex();
    await this.ensureAllWordManagedFrontmatter();
    await this.studylistService.ensureAllWordStudylistFrontmatter();
    this.studylistService.captureAllLocalSnapshots();

    if (previousSettings.enableAutoSyncWordOnLeave && !this.settings.enableAutoSyncWordOnLeave) {
      this.clearAutoSyncTimers();
    }

    if (previousSettings.noteOutputMode !== this.settings.noteOutputMode) {
      const markedCount = await this.markAllSyncWordsDirty();
      new Notice(
        `${PLUGIN_NAME}: note output mode changed to ${this.settings.noteOutputMode}. Marked ${markedCount} word(s) dirty.`,
      );
    }

    this.refreshUi();
  }

  private registerMarkdownProcessors(): void {
    this.registerMarkdownCodeBlockProcessor(EUDIC_BLOCK_LANGUAGE, async (source, el, ctx) => {
      const sectionText = ctx.getSectionInfo(el)?.text ?? "";
      const openingFence = findEudicBlockFenceForBody(sectionText, source);
      const embedContainer = el.closest(".markdown-embed, .internal-embed");

      if (!openingFence) {
        this.renderInvalidEudicBlockPreview(el, source);
        return;
      }

      el.empty();
      el.addClass("eudic-sync-block-preview");
      embedContainer?.classList.add("eudic-sync-block-embed");
      const child = new MarkdownRenderChild(el);
      ctx.addChild(child);
      const semanticOptions = await this.getSemanticBlockTransformOptionsForSourcePath(
        ctx.sourcePath,
        this.getActiveWordFileForSemanticPreview(),
      );
      await MarkdownRenderer.render(
        this.app,
        renderEudicBlockToMarkdown(
          openingFence.kind,
          source,
          semanticOptions,
        ),
        el,
        ctx.sourcePath,
        child,
      );
    });
  }

  private renderInvalidEudicBlockPreview(el: HTMLElement, text: string): void {
    el.empty();
    const pre = el.createEl("pre");
    pre.createEl("code", { text });
  }

  private getActiveWordFileForSemanticPreview(): TFile | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile) || activeFile.extension !== "md" || !this.pathScope.isWordPath(activeFile.path)) {
      return null;
    }

    return activeFile;
  }

  private getSemanticBlockTransformOptionsForSourcePath(
    sourcePath: string,
    currentWordFile: TFile | null = null,
    embeddedFromPath?: string,
  ): Promise<SemanticBlockTransformOptions | null> {
    return this.semanticBlockAutomation.getTransformOptionsForSourcePath({
      sourcePath,
      embeddedFromPath,
      currentWordFile,
    });
  }

  private registerProtocolHandler(): void {
    this.registerObsidianProtocolHandler(EUDIC_PROTOCOL_ACTION, (params: ObsidianProtocolData) => {
      void this.handleManagedObsidianProtocol(params);
    });
  }

  private registerVaultEventsOnLayoutReady(): void {
    this.vaultEventController.registerOnLayoutReady();
  }

  private captureStartupKnownPaths(): void {
    this.startupKnownPaths.clear();
    for (const file of [...this.managedFiles.getWordFiles(), ...this.managedFiles.getReferenceFiles()]) {
      this.startupKnownPaths.add(normalizePath(file.path));
    }
  }

  private scheduleStartupKnownPathClear(): void {
    this.clearStartupKnownPathTimer();
    this.startupKnownPathClearTimer = window.setTimeout(() => {
      this.startupKnownPathClearTimer = null;
      this.startupKnownPaths.clear();
    }, 5000);
  }

  private clearStartupKnownPathTimer(): void {
    if (this.startupKnownPathClearTimer === null) {
      return;
    }

    window.clearTimeout(this.startupKnownPathClearTimer);
    this.startupKnownPathClearTimer = null;
  }

  private async rebuildReferenceIndex(): Promise<void> {
    try {
      this.invalidateSemanticReferenceCaches();
      await this.perf.measure("reference.rebuildAll", () => this.referenceIndex.rebuildAll());
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to rebuild reference index`, error);
      new Notice(`${PLUGIN_NAME}: failed to rebuild Reference index: ${toErrorMessage(error)}`, 8000);
    }
  }

  private async rebuildReferenceIndexManually(): Promise<void> {
    try {
      this.invalidateSemanticReferenceCaches();
      await this.perf.measure("reference.rebuildAll.manual", () => this.referenceIndex.rebuildAll());
      new Notice(`${PLUGIN_NAME}: rebuilt Reference graph.`);
      this.refreshUi();
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to rebuild reference index`, error);
      new Notice(`${PLUGIN_NAME}: failed to rebuild Reference index: ${toErrorMessage(error)}`, 8000);
    }
  }

  private async rebuildLegacyReferenceMetadata(): Promise<void> {
    try {
      this.invalidateSemanticReferenceCaches();
      new Notice(`${PLUGIN_NAME}: repairing All Reference metadata...`);
      const result = await this.perf.measure(
        "reference.repairMetadata.manual",
        () => this.referenceIndex.repairAllReferenceMetadata({ write: true }),
      );
      await this.markWordsDirtyByPaths(result.affectedWordPaths);
      new Notice(
        `${PLUGIN_NAME}: repaired All Reference metadata (${result.scannedWordCount} word note(s) scanned, ${result.wordMetadataUpdated} word note(s), ${result.referenceMetadataUpdated} reference note(s) updated).`,
      );
      this.refreshUi();
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to repair reference metadata`, error);
      new Notice(`${PLUGIN_NAME}: failed to repair Reference metadata: ${toErrorMessage(error)}`, 8000);
    }
  }

  private async repairCurrentReferenceMetadata(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file || !this.pathScope.isReferencePath(file.path)) {
      new Notice(`${PLUGIN_NAME}: open a reference note in the configured References folder first.`);
      return;
    }

    try {
      this.invalidateSemanticReferenceCaches([file.path]);
      new Notice(`${PLUGIN_NAME}: repairing Reference metadata for "${file.basename}"...`);
      await this.ensureReferenceManagedFrontmatter(file);
      const result = await this.perf.measure(
        "reference.repairMetadata.current",
        () => this.referenceIndex.repairReferenceMetadataForReference(file.path, {
          write: true,
          forceFreshScan: true,
        }),
      );
      await this.markWordsDirtyByPaths(result.affectedWordPaths);
      new Notice(
        `${PLUGIN_NAME}: repaired "${file.basename}" (${result.scannedWordCount} word note(s) scanned, ${result.wordPaths.length} referring word note(s), ${result.referenceMetadataUpdated} reference note updated).`,
      );
      this.refreshUi();
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to repair current reference metadata`, error);
      new Notice(`${PLUGIN_NAME}: failed to repair current Reference metadata: ${toErrorMessage(error)}`, 8000);
    }
  }

  private registerWorkspaceEvents(): void {
    const handleActiveContextChange = () => {
      this.handleActiveWordChanged();
      this.refreshUi();
    };

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", handleActiveContextChange),
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", handleActiveContextChange),
    );

    this.registerEvent(
      this.app.workspace.on("file-open", handleActiveContextChange),
    );
  }

  private async loadSettings(): Promise<void> {
    const loadResult = migrateLoadedSettings(await this.loadData());
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadResult.settings);
    this.startupNotices.push(...loadResult.notices);
    this.pathScope.updateSettings(this.settings);

    if (loadResult.changed) {
      await this.saveData(this.settings);
    }
  }

  private async setStudylistCache(cache: EudicStudylistCache): Promise<void> {
    this.settings = Object.assign({}, this.settings, { studylistCache: cache });
    await this.saveData(this.settings);
  }

  private async ensureCurrentNoteOutputFormatVersion(): Promise<void> {
    if (this.settings.noteOutputFormatVersion >= NOTE_OUTPUT_FORMAT_VERSION) {
      return;
    }

    const markedCount = await this.markAllSyncWordsDirty();
    this.settings = Object.assign({}, this.settings, {
      noteOutputFormatVersion: NOTE_OUTPUT_FORMAT_VERSION,
    });
    await this.saveData(this.settings);
    this.startupNotices.push(
      `${PLUGIN_NAME}: final note output format upgraded to v${NOTE_OUTPUT_FORMAT_VERSION}. Marked ${markedCount} word(s) dirty.`,
    );
  }

  private async captureWordSyncSignatures(): Promise<void> {
    this.wordSyncSignatures.clear();
    this.wordCleanSyncSignatures.clear();
    for (const file of this.managedFiles.getWordFiles()) {
      const markdown = await this.app.vault.cachedRead(file);
      const signature = getWordSyncSignature(markdown);
      const normalizedPath = normalizePath(file.path);
      this.wordSyncSignatures.set(normalizedPath, signature);
      if (this.syncService.getWordContext(file)?.bodyStatus === "synced") {
        this.wordCleanSyncSignatures.set(normalizedPath, signature);
      }
    }
  }

  private async captureWordCleanSignatureIfSynced(file: TFile): Promise<void> {
    if (!this.pathScope.isWordPath(file.path)) {
      return;
    }

    const normalizedPath = normalizePath(file.path);
    const context = this.getDisplayWordContext(file);
    if (context?.bodyStatus !== "synced") {
      return;
    }

    const view = this.getOpenMarkdownViewForFile(file);
    const markdown = view?.editor.getValue() ?? await this.app.vault.cachedRead(file);
    const signature = getWordSyncSignature(markdown);
    this.wordSyncSignatures.set(normalizedPath, signature);
    this.wordCleanSyncSignatures.set(normalizedPath, signature);
    this.clearPendingOpenWordBodyWrite(normalizedPath);
    this.autoBodyDirtyPaths.delete(normalizedPath);
    this.restorableEditorBodyDirtyPaths.delete(normalizedPath);
    this.nonRestorableBodyDirtyPaths.delete(normalizedPath);
  }

  private recordWordBodySyncedFromMarkdown(file: TFile, markdown: string): void {
    const normalizedPath = normalizePath(file.path);
    const signature = getWordSyncSignature(markdown);
    this.wordSyncSignatures.set(normalizedPath, signature);
    this.wordCleanSyncSignatures.set(normalizedPath, signature);
    this.clearPendingOpenWordBodyWrite(normalizedPath);
    this.autoBodyDirtyPaths.delete(normalizedPath);
    this.restorableEditorBodyDirtyPaths.delete(normalizedPath);
    this.nonRestorableBodyDirtyPaths.delete(normalizedPath);
    this.setWordBodyStatusOverride(file, "synced", null);
  }

  private handleEditorChange(file: TFile, _markdown: string, editor: Editor): void {
    const normalizedPath = normalizePath(file.path);
    const existingTimer = this.editorChangeTimers.get(normalizedPath);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      this.editorChangeTimers.delete(normalizedPath);
      void this.perf.measure("event.editorChange", () => this.handleEditorChangeInternal(file, editor.getValue(), editor));
    }, EDITOR_CHANGE_DEBOUNCE_MS);
    this.editorChangeTimers.set(normalizedPath, timer);
  }

  private async handleEditorChangeInternal(file: TFile, markdown: string, editor: Editor): Promise<void> {
    if (file.extension !== "md") {
      return;
    }

    if (this.pathScope.isWordPath(file.path)) {
      await this.handleWordEditorChange(file, markdown, editor);
      return;
    }

    if (this.pathScope.isReferencePath(file.path)) {
      await this.handleReferenceEditorChange(file);
    }
  }

  private async handleWordEditorChange(file: TFile, markdown: string, editor: Editor): Promise<void> {
    if (!this.syncService.canSyncFile(file)) {
      return;
    }

    const normalizedPath = normalizePath(file.path);
    const nextSignature = getWordSyncSignature(markdown);
    const expectedSyncPatchSignature = this.syncingEditorWordStatusPatchSignatures.get(normalizedPath);
    if (expectedSyncPatchSignature) {
      if (expectedSyncPatchSignature === nextSignature) {
        this.syncingEditorWordStatusPatchSignatures.delete(normalizedPath);
        this.wordSyncSignatures.set(normalizedPath, nextSignature);
        if (this.getDisplayWordContext(file)?.bodyStatus === "synced") {
          this.wordCleanSyncSignatures.set(normalizedPath, nextSignature);
        }
        this.refreshUi();
        return;
      }

      this.syncingEditorWordStatusPatchSignatures.delete(normalizedPath);
    }

    const decision = this.getWordDirtySignatureDecision(normalizedPath, nextSignature);

    if (decision === "clean") {
      this.clearAutoWordBodyDirty(file, editor);
    } else if (decision === "dirty") {
      this.markOpenEditorWordBodyDirty(file, editor, null, { restorable: true });
    }
  }

  private async handleReferenceEditorChange(file: TFile): Promise<void> {
    for (const wordPath of this.referenceIndex.findWordsReferencing(file.path)) {
      const wordFile = this.managedFiles.getFile(wordPath) ?? this.app.vault.getFileByPath(wordPath);
      if (!wordFile || !this.syncService.canSyncFile(wordFile)) {
        continue;
      }

      await this.markWordDirtyWithAutomaticDeferral(wordFile);
    }
  }

  private setWordBodyDirtyFast(file: TFile, lastError: string | null): void {
    const context = this.getDisplayWordContext(file);
    if (!context) {
      return;
    }

    if (context.bodyStatus === "dirty" && context.lastError === lastError) {
      return;
    }

    this.setWordBodyStatusOverride(file, "dirty", lastError);
  }

  private async handleManagedObsidianProtocol(params: ObsidianProtocolData): Promise<void> {
    this.managedFiles.rebuild();
    const resolved = resolveManagedFileFromProtocol(this.app, this.pathScope, params, (kind) =>
      kind === "word" ? this.managedFiles.getWordFiles() : this.managedFiles.getReferenceFiles(),
    );
    if (resolved.error || !resolved.file) {
      new Notice(`${PLUGIN_NAME}: ${resolved.error ?? "Failed to resolve the managed Obsidian link."}`);
      return;
    }

    const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);
    await leaf.openFile(resolved.file);
  }

  private async handleModify(file: TAbstractFile): Promise<void> {
    await this.perf.measure("event.modify", () => this.handleModifyInternal(file));
  }

  private async handleModifyInternal(file: TAbstractFile): Promise<void> {
    if (!isMarkdownFile(file)) {
      return;
    }

    this.managedFiles.update(file);

    if (this.consumeSuppressedWrite(file.path)) {
      this.refreshUi();
      return;
    }

    if (this.pathScope.isWordPath(file.path)) {
      const markdown = await this.app.vault.cachedRead(file);
      const normalizedPath = normalizePath(file.path);
      const isOpenWord = this.isMarkdownFileOpen(file);
      const nextWordSyncSignature = getWordSyncSignature(markdown);
      await this.studylistService.handleWordModify(file, markdown);
      const result = await this.referenceIndex.updateWord(file, markdown);
      this.scheduleReferenceUsageRefresh(result.affectedReferencePaths);

      if (result.disabled) {
        this.clearPendingOpenWordStatusWrite(file.path);
        this.clearWordStatusOverride(file.path);
        this.cancelAutoSyncTimer(file.path);
        this.refreshUi();
        return;
      }

      const dirtyDecision = this.getWordDirtySignatureDecision(normalizedPath, nextWordSyncSignature);

      if (isOpenWord) {
        this.updateOpenWordBodyDirtyState(file, dirtyDecision);
        this.wordSyncSignatures.set(normalizedPath, nextWordSyncSignature);
        this.refreshUi();
        return;
      }

      if (dirtyDecision === "clean") {
        this.clearAutoWordBodyDirty(file);
      } else if (dirtyDecision === "dirty" || this.hasPendingOpenWordBodyWrite(normalizedPath)) {
        // Marking dirty stays lightweight; final HTML hash confirmation happens only during sync.
        await this.markWordDirtyWithAutomaticDeferral(file);
      }
      this.wordSyncSignatures.set(normalizedPath, nextWordSyncSignature);
      this.refreshUi();
      return;
    }

    if (this.pathScope.isReferencePath(file.path)) {
      const isOpenReference = this.isMarkdownFileOpen(file);
      if (!isOpenReference) {
        await this.ensureReferenceManagedFrontmatter(file);
      }
      const lookup = await this.referenceIndex.findWordsReferencingWithFallback(file.path, { forceScan: true });
      await this.markWordsDirtyByPaths(lookup.wordPaths);
      this.invalidateSemanticReferenceCaches(lookup.affectedReferencePaths);
      this.refreshUi();
    }
  }

  private handleMetadataCacheChanged(file: TFile): void {
    if (file.extension !== "md") {
      return;
    }

    if (this.pathScope.isWordPath(file.path)) {
      this.releaseWordStatusOverridesIfMetadataCaughtUp(file);
      this.refreshUi();
      return;
    }

    if (this.pathScope.isReferencePath(file.path)) {
      this.refreshUi();
    }
  }

  private async handleCreate(file: TAbstractFile): Promise<void> {
    await this.perf.measure("event.create", () => this.handleCreateInternal(file));
  }

  private async handleCreateInternal(file: TAbstractFile): Promise<void> {
    if (!isMarkdownFile(file)) {
      return;
    }

    this.managedFiles.update(file);
    const normalizedPath = normalizePath(file.path);
    if (this.startupKnownPaths.delete(normalizedPath)) {
      this.refreshUi();
      return;
    }

    if (this.pathScope.isWordPath(file.path)) {
      const ensured = await this.ensureManagedWordProperties(file);

      if (ensured.skipped) {
        const affectedReferencePaths = this.referenceIndex.removeWord(file.path);
        this.scheduleReferenceUsageRefresh(affectedReferencePaths);
        this.refreshUi();
        return;
      }

      const result = await this.referenceIndex.updateWord(file, ensured.markdown);
      await this.studylistService.handleWordModify(file, ensured.markdown);
      this.scheduleReferenceUsageRefresh(result.affectedReferencePaths);
      await this.syncService.markWordDirty(file);
      this.setWordBodyDirtyOverride(file, null);
      this.wordSyncSignatures.set(normalizePath(file.path), getWordSyncSignature(ensured.markdown));
      this.refreshUi();
      return;
    }

    if (this.pathScope.isReferencePath(file.path)) {
      await this.ensureReferenceManagedFrontmatter(file);
      const lookup = await this.referenceIndex.findWordsReferencingWithFallback(file.path, { forceScan: true });
      await this.markWordsDirtyByPaths(lookup.wordPaths);
      this.invalidateSemanticReferenceCaches(lookup.affectedReferencePaths);
      this.refreshUi();
    }
  }

  private async handleDelete(file: TAbstractFile): Promise<void> {
    const normalizedPath = normalizePath(file.path);
    await this.perf.measure("event.delete", () => this.handleDeleteInternal(normalizedPath));
  }

  private async handleDeleteInternal(normalizedPath: string): Promise<void> {
    this.managedFiles.remove(normalizedPath);
    this.startupKnownPaths.delete(normalizedPath);
    this.cancelAutoSyncTimer(normalizedPath);
    this.studylistService.removeWord(normalizedPath);
    this.wordSyncSignatures.delete(normalizedPath);
    this.wordCleanSyncSignatures.delete(normalizedPath);
    this.clearPendingOpenWordStatusWrite(normalizedPath);

    if (this.pathScope.isReferencePath(normalizedPath)) {
      const lookup = await this.referenceIndex.findWordsReferencingWithFallback(normalizedPath);
      await this.markWordsDirtyByPaths(lookup.wordPaths);
      this.referenceIndex.invalidate([normalizedPath]);
      this.invalidateSemanticReferenceCaches(lookup.affectedReferencePaths);
      this.clearWordStatusOverride(normalizedPath);
      this.refreshUi();
      return;
    }

    if (this.pathScope.isWordPath(normalizedPath)) {
      const affectedReferencePaths = this.referenceIndex.removeWord(normalizedPath);
      await this.refreshReferenceUsage(affectedReferencePaths);
      this.clearWordStatusOverride(normalizedPath);
      if (this.lastActiveWordPath === normalizedPath) {
        this.lastActiveWordPath = null;
      }
      this.refreshUi();
    }
  }

  private async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    await this.perf.measure("event.rename", () => this.handleRenameInternal(file, oldPath));
  }

  private async handleRenameInternal(file: TAbstractFile, oldPath: string): Promise<void> {
    const normalizedOldPath = normalizePath(oldPath);
    const normalizedNewPath = normalizePath(file.path);
    this.managedFiles.rename(file, normalizedOldPath);
    this.startupKnownPaths.delete(normalizedOldPath);
    this.startupKnownPaths.delete(normalizedNewPath);

    const impactedWordPaths = new Set<string>();
    const affectedReferencePaths = new Set<string>();
    let shouldRepairAffectedReferenceMetadata = false;

    if (this.pathScope.isReferencePath(normalizedOldPath)) {
      const lookup = await this.referenceIndex.findWordsReferencingWithFallback(normalizedOldPath);
      for (const wordPath of lookup.wordPaths) {
        impactedWordPaths.add(wordPath);
      }
      for (const referencePath of lookup.affectedReferencePaths) {
        affectedReferencePaths.add(referencePath);
      }
    }

    if (this.pathScope.isWordPath(normalizedOldPath)) {
      for (const referencePath of this.referenceIndex.removeWord(normalizedOldPath)) {
        affectedReferencePaths.add(referencePath);
      }
      shouldRepairAffectedReferenceMetadata = true;
    }

    this.clearWordStatusOverride(normalizedOldPath);
    this.cancelAutoSyncTimer(normalizedOldPath);
    this.studylistService.removeWord(normalizedOldPath);
    this.wordSyncSignatures.delete(normalizedOldPath);
    this.wordCleanSyncSignatures.delete(normalizedOldPath);
    this.clearPendingOpenWordStatusWrite(normalizedOldPath);

    if (isMarkdownFile(file) && this.pathScope.isWordPath(normalizedNewPath)) {
      const ensured = await this.ensureManagedWordProperties(file);

      if (!ensured.skipped) {
        const result = await this.referenceIndex.updateWord(file, ensured.markdown);
        await this.studylistService.handleWordModify(file, ensured.markdown);
        for (const referencePath of result.affectedReferencePaths) {
          affectedReferencePaths.add(referencePath);
        }
        shouldRepairAffectedReferenceMetadata = true;
        await this.syncService.markWordDirty(file);
        this.setWordBodyDirtyOverride(file, null);
        this.wordSyncSignatures.set(normalizePath(file.path), getWordSyncSignature(ensured.markdown));
      } else {
        for (const referencePath of this.referenceIndex.removeWord(normalizedNewPath)) {
          affectedReferencePaths.add(referencePath);
        }
        shouldRepairAffectedReferenceMetadata = true;
      }
    }

    if (this.lastActiveWordPath === normalizedOldPath) {
      this.lastActiveWordPath =
        isMarkdownFile(file) && this.pathScope.isWordPath(normalizedNewPath) ? normalizedNewPath : null;
    }

    if (this.pathScope.isReferencePath(normalizedNewPath)) {
      await this.ensureReferenceManagedFrontmatter(file);
      const lookup = await this.referenceIndex.findWordsReferencingWithFallback(normalizedNewPath, { forceScan: true });
      for (const wordPath of lookup.wordPaths) {
        impactedWordPaths.add(wordPath);
      }
      for (const referencePath of lookup.affectedReferencePaths) {
        affectedReferencePaths.add(referencePath);
      }
      affectedReferencePaths.add(normalizedNewPath);
    }

    await this.markWordsDirtyByPaths(Array.from(impactedWordPaths));
    if (shouldRepairAffectedReferenceMetadata && affectedReferencePaths.size > 0) {
      await this.refreshReferenceUsage(affectedReferencePaths);
    } else if (affectedReferencePaths.size > 0) {
      this.invalidateSemanticReferenceCaches(affectedReferencePaths);
    }
    this.refreshUi();
  }

  private async markWordsDirtyByPaths(paths: string[]): Promise<void> {
    for (const path of paths) {
      const file = this.managedFiles.getFile(path) ?? this.app.vault.getFileByPath(path);
      if (!file || file.extension !== "md") {
        continue;
      }
      await this.markWordDirtyWithAutomaticDeferral(file);
    }
  }

  private async markAllSyncWordsDirty(): Promise<number> {
    let markedCount = 0;

    for (const file of this.managedFiles.getWordFiles()) {
      await this.ensureWordManagedFrontmatter(file);
      if (!this.syncService.canSyncFile(file)) {
        continue;
      }

      if (await this.syncService.markWordDirty(file)) {
        this.setWordBodyDirtyOverride(file, null);
        markedCount += 1;
      }
    }

    return markedCount;
  }

  private async syncCurrentWord(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file || !this.pathScope.isWordPath(file.path)) {
      new Notice(`${PLUGIN_NAME}: open a word note in the configured word notes folder first.`);
      return;
    }

    if (!this.syncService.canSyncFile(file)) {
      new Notice(`${PLUGIN_NAME}: this word note is disabled for Eudic sync.`);
      return;
    }

    await this.syncFile(file, { force: true, source: "manual" });
  }

  private async syncFile(file: TFile, options: SyncFileOptions = {}): Promise<void> {
    if (options.source === "manual") {
      await this.saveActiveViewForFile(file);
      if (!this.isMarkdownFileOpen(file)) {
        await this.flushPendingWordStatusWrite(file);
      }
    }
    await this.syncOrchestrator.syncFile(file, options);
    await this.captureWordCleanSignatureIfSynced(file);
  }

  private async saveActiveViewForFile(file: TFile): Promise<void> {
    const view = this.getActiveMarkdownView();
    if (!view?.file || normalizePath(view.file.path) !== normalizePath(file.path)) {
      return;
    }

    await view.save();
  }

  private async resyncAliasesForCurrentWord(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file || !this.syncService.canSyncFile(file)) {
      new Notice(`${PLUGIN_NAME}: open a word note in the configured word notes folder first.`);
      return;
    }

    if (this.syncOrchestrator.isSyncInFlight(file)) {
      new Notice(`${PLUGIN_NAME}: "${file.basename}" is already syncing.`);
      return;
    }

    this.syncOrchestrator.beginSync(file);

    try {
      const result = await this.syncService.resyncAliases(file);
      this.setWordStatusOverride(file, result.status, result.error ?? null);
      new Notice(getResyncAliasesNoticeText(result));
    } catch (error) {
      const message = toErrorMessage(error);
      const context = this.getDisplayWordContext(file);
      this.setWordStatusOverride(file, context?.effectiveStatus ?? "dirty", message);
      new Notice(`${PLUGIN_NAME}: failed to resync aliases for "${file.basename}": ${message}`);
    } finally {
      this.syncOrchestrator.endSync(file);
    }
  }

  private async deleteCurrentWordNoteInEudic(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file || !this.syncService.canSyncFile(file)) {
      new Notice(`${PLUGIN_NAME}: open a word note in the configured word notes folder first.`);
      return;
    }

    const context = this.getDisplayWordContext(file);
    if (!context?.lang) {
      new Notice(`${PLUGIN_NAME}: missing '${FRONTMATTER_KEYS.lang}' in "${file.basename}".`);
      return;
    }

    const normalizedPath = normalizePath(file.path);
    if (this.syncOrchestrator.isSyncInFlight(file) || this.inFlightDeletePaths.has(normalizedPath)) {
      new Notice(`${PLUGIN_NAME}: "${file.basename}" is busy.`);
      return;
    }

    const confirmed = await confirmDeleteEudicNote(
      this.app,
      `Delete Eudic note for "${context.word}"?`,
      [
        "This deletes only the Eudic cloud note.",
        "It does not delete the Obsidian local word note.",
        "A future sync will write the note back to Eudic.",
      ],
      "Delete from Eudic",
    );
    if (!confirmed) {
      return;
    }

    this.inFlightDeletePaths.add(normalizedPath);
    try {
      const result = await this.syncService.deleteCurrentWordNote(file);
      this.setWordBodyDirtyOverride(file, null);
      this.refreshUi();
      new Notice(getDeleteNoteNoticeText(result));
    } catch (error) {
      new Notice(`${PLUGIN_NAME}: failed to delete the Eudic note: ${toErrorMessage(error)}`);
    } finally {
      this.inFlightDeletePaths.delete(normalizedPath);
      this.refreshUi();
    }
  }

  private async deleteTypedWordNoteInEudic(): Promise<void> {
    if (this.typedDeleteInFlight) {
      new Notice(`${PLUGIN_NAME}: a typed Eudic note deletion is already in progress.`);
      return;
    }

    const selection = await promptDeleteTypedWordNote(this.app, this.syncService.getAvailableWordLanguages());
    if (!selection) {
      return;
    }

    const confirmed = await confirmDeleteEudicNote(
      this.app,
      `Delete Eudic note for "${selection.word}" (${selection.language})?`,
      [
        "This deletes only the Eudic cloud note.",
        "It does not delete any Obsidian local note.",
        "A future sync will write the note back to Eudic if a local word owns it.",
      ],
      "Delete from Eudic",
    );
    if (!confirmed) {
      return;
    }

    this.typedDeleteInFlight = true;
    try {
      const result = await this.syncService.deleteTypedWordNote(selection.word, selection.language);
      for (const file of result.matchedMainFiles) {
        this.setWordBodyDirtyOverride(file, null);
      }
      for (const file of result.matchedAliasOwnerFiles) {
        this.setWordBodyDirtyOverride(file, null);
      }
      this.refreshUi();
      new Notice(getDeleteNoteNoticeText(result));
    } catch (error) {
      new Notice(`${PLUGIN_NAME}: failed to delete the Eudic note: ${toErrorMessage(error)}`);
    } finally {
      this.typedDeleteInFlight = false;
    }
  }

  private async refreshEudicStudylists(): Promise<void> {
    try {
      await this.ensureAllWordManagedFrontmatter();
      const result = await this.perf.measure("studylist.refreshFromEudic", () => this.studylistService.refreshFromEudic());
      await this.reconcileWordSyncStatuses(result.updatedFiles);
      new Notice(getStudylistRefreshNoticeText(result), 8000);
    } catch (error) {
      new Notice(`${PLUGIN_NAME}: failed to refresh Eudic studylists: ${toErrorMessage(error)}`, 8000);
    }
  }

  private async pullStudylistAssignmentsFromEudic(): Promise<void> {
    try {
      await this.ensureAllWordManagedFrontmatter();
      const result = await this.perf.measure("studylist.pullAssignmentsFromEudic", () => this.studylistService.pullAssignmentsFromEudic());
      await this.reconcileWordSyncStatuses(result.updatedFiles);
      new Notice(getStudylistRefreshNoticeText(result), 8000);
    } catch (error) {
      new Notice(`${PLUGIN_NAME}: failed to pull studylist assignments from Eudic: ${toErrorMessage(error)}`, 8000);
    }
  }

  private async pullCurrentWordStudylistAssignmentFromEudic(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice(`${PLUGIN_NAME}: open a word note first.`);
      return;
    }

    try {
      await this.ensureWordManagedFrontmatter(file);
      const status = this.studylistService.getCurrentWordStudylistStatus(file);
      if (status === "dirty") {
        const confirmed = await confirmEudicAction(
          this.app,
          `Pull studylist assignment for "${file.basename}" from Eudic?`,
          [
            "This will replace local studylist properties with the Eudic cloud assignment.",
            "Your local dirty studylist edits for this word will be discarded.",
            "The word note content will not be changed.",
          ],
          "Pull from Eudic",
        );
        if (!confirmed) {
          return;
        }
      }

      const result = await this.studylistService.pullCurrentWordAssignmentFromEudic(file, status === "dirty");
      await this.reconcileWordSyncStatuses([file]);
      new Notice(
        `${PLUGIN_NAME}: pulled studylist assignment for "${result.word}" (${result.names.length} list(s), ${result.updated ? "updated" : "unchanged"}).`,
        8000,
      );
    } catch (error) {
      new Notice(`${PLUGIN_NAME}: failed to pull current word studylist assignment from Eudic: ${toErrorMessage(error)}`, 8000);
    }
  }

  private async pushAllDirtyStudylistAssignmentsToEudic(): Promise<void> {
    await this.ensureAllWordManagedFrontmatter();
    const dirtyFiles = this.studylistService.collectDirtyStudylistWords();
    if (dirtyFiles.length === 0) {
      new Notice(`${PLUGIN_NAME}: no dirty studylist assignments to push.`);
      return;
    }

    await this.pushStudylistAssignmentsWithConfirmation(dirtyFiles, "Push all dirty studylist assignments?");
  }

  private async pushCurrentWordStudylistAssignmentToEudic(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice(`${PLUGIN_NAME}: open a word note first.`);
      return;
    }

    await this.ensureWordManagedFrontmatter(file);
    const pushFile = this.studylistService.getCurrentWordForPush(file);
    if (!pushFile) {
      const lastError = this.studylistService.getCurrentWordStudylistLastError(file);
      if (lastError) {
        new Notice(`${PLUGIN_NAME}: cannot push studylist assignment: ${lastError}`, 8000);
        return;
      }
      new Notice(`${PLUGIN_NAME}: current word has no pushable studylist assignment.`);
      return;
    }

    await this.pushStudylistAssignmentsWithConfirmation([pushFile], `Push studylist assignment for "${pushFile.basename}"?`);
  }

  private async pushStudylistAssignmentsWithConfirmation(files: TFile[], title: string): Promise<void> {
    try {
      const preview = await this.studylistService.previewPush(files);
      if (preview.total === 0) {
        new Notice(`${PLUGIN_NAME}: no pushable studylist assignments.`);
        return;
      }

      if (preview.added + preview.removed > 0) {
        const confirmed = await confirmEudicAction(
          this.app,
          title,
          [
            `Words: ${preview.total}`,
            `Assignments to add: ${preview.added}`,
            `Assignments to remove: ${preview.removed}`,
            "This changes Eudic cloud studylist membership, but does not modify note content.",
          ],
          "Push to Eudic",
        );
        if (!confirmed) {
          return;
        }
      }

      const result = await this.studylistService.pushAssignments(preview.files);
      await this.reconcileWordSyncStatuses(preview.files);
      new Notice(getStudylistPushNoticeText(result), 8000);
    } catch (error) {
      new Notice(`${PLUGIN_NAME}: failed to push studylist assignments: ${toErrorMessage(error)}`, 8000);
    }
  }

  private async reconcileWordSyncStatuses(files: TFile[]): Promise<void> {
    for (const file of files) {
      const bodyStatus = await this.syncService.reconcileWordSyncStatus(file);
      const context = this.getDisplayWordContext(file) ?? this.syncService.getWordContext(file);
      this.setWordBodyStatusOverride(file, bodyStatus, bodyStatus === "dirty" ? context?.lastError ?? null : null);
      if (context?.studylistStatus) {
        this.setWordStudylistStatusOverride(
          file,
          context.studylistStatus,
          this.studylistService.getCurrentWordStudylistLastError(file),
        );
      }
      await this.captureWordCleanSignatureIfSynced(file);
    }
  }

  private async rebuildLocalStudylistMetadata(): Promise<void> {
    try {
      await this.ensureAllWordManagedFrontmatter();
      const updatedWords = await this.perf.measure("studylist.rebuildLocalMetadata", () => this.studylistService.rebuildLocalMetadata());
      new Notice(`${PLUGIN_NAME}: repaired word properties and rebuilt local studylist metadata for ${updatedWords} word(s).`);
    } catch (error) {
      new Notice(`${PLUGIN_NAME}: failed to rebuild local studylist metadata: ${toErrorMessage(error)}`, 8000);
    }
  }

  private async repairStudylistNamesIdsForAllWordNotes(): Promise<void> {
    try {
      await this.ensureAllWordManagedFrontmatter();
      const result = await this.perf.measure("studylist.repairNamesIds", () => this.studylistService.repairNamesIdsForAllWords());
      new Notice(
        `${PLUGIN_NAME}: Studylist names/ids repair complete: ${result.updated} updated, ${result.unresolved} unresolved. No Eudic cloud changes were made.`,
        8000,
      );
      this.refreshUi();
    } catch (error) {
      new Notice(`${PLUGIN_NAME}: failed to repair studylist names/ids: ${toErrorMessage(error)}`, 8000);
    }
  }

  private async copyManagedUrlForCurrentNote(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice(`${PLUGIN_NAME}: open a managed word or reference note first.`);
      return;
    }

    try {
      const url = await this.getManagedUrlForFile(file);
      if (!url) {
        new Notice(`${PLUGIN_NAME}: open a managed word or reference note first.`);
        return;
      }

      await copyTextToClipboard(url);
      new Notice(`${PLUGIN_NAME}: copied managed URL for "${file.basename}".`);
    } catch (error) {
      new Notice(`${PLUGIN_NAME}: failed to copy managed URL: ${toErrorMessage(error)}`);
    }
  }

  private async formatCurrentEudicNoteBoldMarkers(): Promise<void> {
    const view = this.getActiveMarkdownView();
    const file = view?.file ?? null;
    if (!view || !file || !this.canFormatBoldMarkers(file)) {
      new Notice(`${PLUGIN_NAME}: open a managed word or reference note first.`);
      return;
    }

    if (this.settings.boldMarkers.length === 0) {
      new Notice(`${PLUGIN_NAME}: no bold markers are configured.`);
      return;
    }

    let changedNotes = 0;
    let referenceNotesChanged = 0;
    let replacements = 0;
    const currentMarkdown = view.editor.getValue();
    const currentResult = formatBoldMarkersInMarkdown(currentMarkdown, this.settings.boldMarkers);
    const nextCurrentMarkdown = currentResult.markdown;

    if (currentResult.changed) {
      view.editor.setValue(nextCurrentMarkdown);
      await view.save();
      changedNotes += 1;
      replacements += currentResult.replacements;
    }

    if (this.pathScope.isWordPath(file.path)) {
      const referenceFiles = this.getManagedReferenceFilesForWord(file, nextCurrentMarkdown);
      for (const referenceFile of referenceFiles) {
        const referenceResult = await this.formatBoldMarkersInMarkdownFile(referenceFile);
        if (!referenceResult.changed) {
          continue;
        }

        changedNotes += 1;
        referenceNotesChanged += 1;
        replacements += referenceResult.replacements;
      }
    }

    if (changedNotes === 0) {
      const noChangeTarget = this.pathScope.isWordPath(file.path)
        ? `"${file.basename}" or its linked references`
        : `"${file.basename}"`;
      new Notice(`${PLUGIN_NAME}: no bold markers to format in ${noChangeTarget}.`);
      return;
    }

    const referenceSummary =
      this.pathScope.isWordPath(file.path) ? `, including ${referenceNotesChanged} linked reference note(s)` : "";
    new Notice(
      `${PLUGIN_NAME}: formatted ${replacements} bold marker(s) in ${changedNotes} note(s)${referenceSummary}.`,
      8000,
    );
    this.refreshUi();
  }

  private async formatAllEudicNoteBoldMarkers(): Promise<void> {
    if (this.settings.boldMarkers.length === 0) {
      new Notice(`${PLUGIN_NAME}: no bold markers are configured.`);
      return;
    }

    let changed = 0;
    let skipped = 0;
    let replacements = 0;

    for (const file of [...this.managedFiles.getWordFiles(), ...this.managedFiles.getReferenceFiles()]) {
      if (!this.canFormatBoldMarkers(file)) {
        continue;
      }

      const markdown = await this.app.vault.cachedRead(file);
      const result = formatBoldMarkersInMarkdown(markdown, this.settings.boldMarkers);
      if (!result.changed) {
        skipped += 1;
        continue;
      }

      await this.app.vault.modify(file, result.markdown);
      changed += 1;
      replacements += result.replacements;
    }

    new Notice(
      `${PLUGIN_NAME}: formatted ${replacements} bold marker(s) in ${changed} note(s), skipped ${skipped} unchanged note(s).`,
      8000,
    );
    this.refreshUi();
  }

  private canFormatBoldMarkers(file: TFile | null | undefined): file is TFile {
    if (!file || file.extension !== "md") {
      return false;
    }

    return this.pathScope.isWordPath(file.path) || this.pathScope.isReferencePath(file.path);
  }

  private async formatBoldMarkersInMarkdownFile(file: TFile): Promise<BoldMarkerNoteFormatResult> {
    const markdown = await this.app.vault.cachedRead(file);
    const result = formatBoldMarkersInMarkdown(markdown, this.settings.boldMarkers);
    if (!result.changed) {
      return {
        changed: false,
        replacements: 0,
      };
    }

    await this.app.vault.modify(file, result.markdown);
    return {
      changed: true,
      replacements: result.replacements,
    };
  }

  private getManagedReferenceFilesForWord(file: TFile, markdown: string): TFile[] {
    const referencePaths = new Set(resolveManagedReferencePaths(this.app, this.pathScope, file, markdown));

    return Array.from(referencePaths)
      .map((referencePath) => this.managedFiles.getFile(referencePath) ?? this.app.vault.getFileByPath(referencePath))
      .filter((referenceFile): referenceFile is TFile => !!referenceFile && this.pathScope.isReferencePath(referenceFile.path))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private async syncAllDirtyWords(): Promise<void> {
    await this.ensureAllWordManagedFrontmatter();
    const collectedDirtyWords = await this.syncService.collectDirtyWords();
    const dirtyWords = collectedDirtyWords.filter((file) => !this.syncOrchestrator.isSyncInFlight(file));
    if (collectedDirtyWords.length === 0) {
      new Notice(`${PLUGIN_NAME}: no dirty words to sync.`);
      return;
    }

    if (dirtyWords.length === 0) {
      new Notice(`${PLUGIN_NAME}: all dirty words are already syncing.`);
      return;
    }

    const batchFiles: TFile[] = [];
    for (const file of dirtyWords) {
      if (this.syncOrchestrator.beginSync(file)) {
        batchFiles.push(file);
      }
    }
    if (batchFiles.length === 0) {
      new Notice(`${PLUGIN_NAME}: all dirty words are already syncing.`);
      return;
    }
    this.refreshUi();

    try {
      const batchResult = await this.perf.measure("sync.allDirtyWords", () => this.syncService.syncWords(batchFiles));
      for (const result of batchResult.results) {
        if (result.error) {
          this.setWordBodyDirtyOverride(result.file, result.error);
        } else {
          this.setWordStatusOverride(result.file, "synced", null);
          await this.captureWordCleanSignatureIfSynced(result.file);
        }
      }

      const aliasSummary =
        batchResult.aliasUploaded > 0 ? ` aliases updated ${batchResult.aliasUploaded}.` : " aliases unchanged.";
      const summary = `${PLUGIN_NAME}: processed ${batchResult.total} dirty word(s), uploaded ${batchResult.uploaded}, unchanged ${batchResult.skipped}, failed ${batchResult.failed}.${aliasSummary}`;
      new Notice(summary, 8000);
    } finally {
      for (const file of batchFiles) {
        this.syncOrchestrator.endSync(file);
      }
      this.refreshUi();
    }
  }

  private async createReferenceFromSelection(): Promise<void> {
    await this.withActiveWordView(async (view) => {
      const result = await this.referenceNoteService.createReferenceFromSelection(view);
      await view.save();
      new Notice(`${PLUGIN_NAME}: created ${result.createdCount} reference from the current selection.`);
      this.refreshUi();
    });
  }

  private async createReferenceFromCurrentParagraph(): Promise<void> {
    await this.withActiveWordView(async (view) => {
      const result = await this.referenceNoteService.createReferenceFromCurrentParagraph(view);
      await view.save();
      new Notice(`${PLUGIN_NAME}: created ${result.createdCount} reference from the current paragraph.`);
      this.refreshUi();
    });
  }

  private async extractPendingReferencesInCurrentWord(): Promise<void> {
    await this.withActiveWordView(async (view) => {
      const result = await this.referenceNoteService.extractPendingReferences(view);
      if (!result.changed) {
        new Notice(`${PLUGIN_NAME}: no pending reference blocks found.`);
        return;
      }

      await view.save();
      new Notice(`${PLUGIN_NAME}: extracted ${result.createdCount} pending reference(s).`);
      this.refreshUi();
    });
  }

  private async extractCurrentEudicBlockToReference(): Promise<void> {
    await this.withActiveWordView(async (view) => {
      const result = await this.referenceNoteService.extractCurrentEudicBlockToReference(view);
      await view.save();
      new Notice(`${PLUGIN_NAME}: extracted ${result.createdCount} Eudic block reference.`);
      this.refreshUi();
    });
  }

  private async wrapSelectionAsEudicBlock(): Promise<void> {
    await this.withActiveManagedNoteView(async (view) => {
      if (!view.editor.somethingSelected()) {
        throw new Error("Select the block content you want to wrap first.");
      }

      const selection = view.editor.getSelection();
      const extracted = extractLeadingPresetKindFromList(selection, this.getSemanticBlockKindPresets());
      const kind = extracted.kind ?? DEFAULT_EUDIC_BLOCK_KIND;
      const body = extracted.markdown;
      if (!body) {
        throw new Error("The selected Eudic block content is empty.");
      }

      view.editor.replaceSelection(buildEudicBlock(kind, body), "eudic-sync");
      await view.save();
      new Notice(`${PLUGIN_NAME}: wrapped the current selection as an "${kind}" Eudic block.`);
      this.refreshUi();
    });
  }

  private async insertEudicBlock(): Promise<void> {
    await this.withActiveManagedNoteView(async (view) => {
      if (view.editor.somethingSelected()) {
        throw new Error('Clear the selection first, or use "Wrap selection as Eudic block".');
      }

      const editor = view.editor;
      const cursor = editor.getCursor();
      const currentLine = editor.getLine(cursor.line);
      const bodyPrefix = `${DEFAULT_EUDIC_BLOCK_KIND} `;
      const blockMarkdown = buildEudicBlock(DEFAULT_EUDIC_BLOCK_KIND, bodyPrefix);

      let from = cursor;
      let to = cursor;
      let insertText = blockMarkdown;
      let openingLine = cursor.line;

      if (currentLine.trim().length === 0) {
        from = { line: cursor.line, ch: 0 };
        to = { line: cursor.line, ch: currentLine.length };
      } else {
        const beforeCursor = currentLine.slice(0, cursor.ch);
        const afterCursor = currentLine.slice(cursor.ch);
        const needsLeadingNewline = beforeCursor.trim().length > 0;
        const needsTrailingNewline = afterCursor.trim().length > 0;
        insertText = `${needsLeadingNewline ? "\n" : ""}${blockMarkdown}${needsTrailingNewline ? "\n" : ""}`;
        openingLine = cursor.line + (needsLeadingNewline ? 1 : 0);
      }

      editor.replaceRange(insertText, from, to, "eudic-sync");
      editor.setSelection(
        { line: openingLine + 1, ch: 0 },
        { line: openingLine + 1, ch: DEFAULT_EUDIC_BLOCK_KIND.length },
      );
      editor.focus();
      new Notice(`${PLUGIN_NAME}: inserted a new Eudic block. Type the kind in the first line to change it.`);
      this.refreshUi();
    });
  }

  private getSemanticBlockKindPresets(): string[] {
    const seen = new Set<string>();
    const presets: string[] = [];

    for (const presetKind of this.settings.semanticBlockKindPresets) {
      const trimmed = presetKind.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }

      seen.add(trimmed);
      presets.push(trimmed);
    }

    return presets;
  }

  private async withActiveManagedNoteView(run: (view: MarkdownView, file: TFile) => Promise<void>): Promise<void> {
    const view = this.getActiveMarkdownView();
    const file = view?.file ?? null;
    if (!view || !file || !this.canFormatBoldMarkers(file)) {
      new Notice(`${PLUGIN_NAME}: open a managed word or reference note first.`);
      return;
    }

    try {
      await run(view, file);
    } catch (error) {
      new Notice(`${PLUGIN_NAME}: ${toErrorMessage(error)}`);
    }
  }

  private async withActiveWordView(run: (view: MarkdownView, file: TFile) => Promise<void>): Promise<void> {
    const view = this.getActiveMarkdownView();
    const file = view?.file ?? null;
    if (!view || !file || !this.syncService.canSyncFile(file)) {
      new Notice(`${PLUGIN_NAME}: open a word note in the configured word notes folder first.`);
      return;
    }

    try {
      await run(view, file);
    } catch (error) {
      new Notice(`${PLUGIN_NAME}: ${toErrorMessage(error)}`);
    }
  }

  private getActiveMarkdownView(): MarkdownView | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView);
  }

  private getActiveMarkdownFile(): TFile | null {
    const view = this.getActiveMarkdownView();
    return view?.file ?? null;
  }

  private getActiveWordPath(): string | null {
    const file = this.getActiveMarkdownFile();
    if (!file || !this.syncService.canSyncFile(file)) {
      return null;
    }

    return normalizePath(file.path);
  }

  private handleActiveWordChanged(): void {
    const nextActiveWordPath = this.getActiveWordPath();
    if (nextActiveWordPath) {
      this.cancelAutoSyncTimer(nextActiveWordPath);
    }

    if (this.lastActiveWordPath && this.lastActiveWordPath !== nextActiveWordPath) {
      const previousActiveWordPath = this.lastActiveWordPath;
      void this.flushPendingWordStatusWriteByPath(previousActiveWordPath).finally(() => {
        this.scheduleAutoSyncAfterLeavingWord(previousActiveWordPath);
      });
    }

    this.lastActiveWordPath = nextActiveWordPath;
    void this.flushPendingOpenWordStatusWrites();
  }

  private getOpenMarkdownFilePaths(): Set<string> {
    const paths = new Set<string>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file) {
        paths.add(normalizePath(view.file.path));
      }
    }
    return paths;
  }

  private getOpenMarkdownViewForFile(file: TFile): MarkdownView | null {
    const normalizedPath = normalizePath(file.path);
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file && normalizePath(view.file.path) === normalizedPath) {
        return view;
      }
    }

    return null;
  }

  private isMarkdownFileOpen(file: TFile): boolean {
    return this.getOpenMarkdownFilePaths().has(normalizePath(file.path));
  }

  private refreshUi(): void {
    this.vaultEventController.refreshUi();
  }

  private flushUi(): void {
    if (this.isUnloaded) {
      return;
    }

    this.saveHookController.refresh();
    this.uiController.refresh();
  }

  private isSyncInFlight(file: TFile): boolean {
    return this.syncOrchestrator.isSyncInFlight(file);
  }

  private getDisplayWordContext(file: TFile): WordNoteContext | null {
    return this.wordStatusOverrides.getDisplayContext(file, this.syncService.getWordContext(file));
  }

  private setWordStatusOverride(
    file: TFile,
    status: EudicSyncStatus,
    lastError: string | null,
    bodyStatus?: EudicSyncStatus,
    studylistStatus?: EudicSyncStatus,
  ): void {
    if (bodyStatus === undefined && studylistStatus === undefined) {
      this.setWordBodyStatusOverride(file, status, lastError);
      return;
    }

    if (bodyStatus !== undefined) {
      const bodyError = bodyStatus === "dirty" ? lastError : null;
      this.wordStatusOverrides.setBody(file, bodyStatus, bodyError);
    }
    if (studylistStatus !== undefined) {
      const studylistError = bodyStatus === "dirty" && lastError ? null : lastError;
      this.wordStatusOverrides.setStudylist(file, studylistStatus, studylistError);
    }
    this.refreshUi();
  }

  private setWordBodyStatusOverride(file: TFile, status: EudicSyncStatus, lastError: string | null): void {
    this.wordStatusOverrides.setBody(file, status, lastError);
    this.refreshUi();
  }

  private setWordStudylistStatusOverride(file: TFile, status: EudicSyncStatus, lastError: string | null): void {
    this.wordStatusOverrides.setStudylist(file, status, lastError);
    this.refreshUi();
  }

  private setWordBodyDirtyOverride(file: TFile, lastError: string | null): void {
    this.setWordBodyStatusOverride(file, "dirty", lastError);
  }

  private getWordDirtySignatureDecision(path: string, nextSignature: string) {
    const normalizedPath = normalizePath(path);
    return resolveWordDirtySignatureDecision({
      cleanSignature: this.wordCleanSyncSignatures.get(normalizedPath),
      previousSignature: this.wordSyncSignatures.get(normalizedPath),
      nextSignature,
    });
  }

  private markOpenEditorWordBodyDirty(
    file: TFile,
    editor: Editor,
    lastError: string | null,
    options: { restorable?: boolean } = {},
  ): boolean {
    const normalizedPath = normalizePath(file.path);
    const patch = buildSyncStatusPatch(editor.getValue(), "dirty");
    try {
      applySyncStatusPatchToEditor(editor, "dirty");
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to patch sync_status in the open editor`, error);
      return false;
    }

    this.autoBodyDirtyPaths.add(normalizedPath);
    if (options.restorable) {
      if (patch.changed) {
        this.restorableEditorBodyDirtyPaths.add(normalizedPath);
      }
    } else {
      this.nonRestorableBodyDirtyPaths.add(normalizedPath);
    }
    this.clearPendingOpenWordBodyWrite(normalizedPath);
    this.setWordBodyDirtyFast(file, lastError);
    return true;
  }

  private markOpenWordBodyDirty(
    file: TFile,
    lastError: string | null,
    options: { restorable?: boolean } = {},
  ): boolean {
    const view = this.getOpenMarkdownViewForFile(file);
    return view ? this.markOpenEditorWordBodyDirty(file, view.editor, lastError, options) : false;
  }

  private updateOpenWordBodyDirtyState(file: TFile, decision: "clean" | "dirty" | "unchanged"): void {
    if (decision === "clean") {
      this.clearAutoWordBodyDirty(file);
      return;
    }

    if (decision === "dirty") {
      this.markOpenWordBodyDirty(file, null, { restorable: true });
    }
  }

  private clearAutoWordBodyDirty(file: TFile, editor?: Editor): void {
    const normalizedPath = normalizePath(file.path);
    this.clearPendingOpenWordBodyWrite(normalizedPath);

    if (this.restorableEditorBodyDirtyPaths.has(normalizedPath)) {
      if (this.nonRestorableBodyDirtyPaths.has(normalizedPath)) {
        this.restorableEditorBodyDirtyPaths.delete(normalizedPath);
        this.setWordBodyDirtyFast(file, null);
        return;
      }

      const targetEditor = editor ?? this.getOpenMarkdownViewForFile(file)?.editor;
      if (targetEditor) {
        try {
          applySyncStatusPatchToEditor(targetEditor, "synced");
          this.autoBodyDirtyPaths.delete(normalizedPath);
          this.restorableEditorBodyDirtyPaths.delete(normalizedPath);
          this.setWordBodyStatusOverride(file, "synced", null);
          return;
        } catch (error) {
          console.error(`${PLUGIN_NAME}: failed to restore sync_status in the open editor`, error);
        }
      }
    }

    const context = this.syncService.getWordContext(file);
    if (context?.bodyStatus === "synced" && !context.lastError) {
      this.wordStatusOverrides.clearBody(normalizedPath);
    }
    this.refreshUi();
  }

  private releaseWordStatusOverridesIfMetadataCaughtUp(file: TFile): void {
    const normalizedPath = normalizePath(file.path);
    const override = this.wordStatusOverrides.get(normalizedPath);
    const context = this.syncService.getWordContext(file);
    if (!override || !context) {
      return;
    }

    if (
      override.bodyStatus !== undefined &&
      !this.hasPendingOpenWordBodyWrite(normalizedPath) &&
      context.bodyStatus === override.bodyStatus
    ) {
      this.wordStatusOverrides.clearBody(normalizedPath);
    }
    if (
      override.studylistStatus !== undefined &&
      context.studylistStatus === override.studylistStatus
    ) {
      this.wordStatusOverrides.clearStudylist(normalizedPath);
    }
  }

  private clearWordStatusOverride(path: string): void {
    const normalizedPath = normalizePath(path);
    this.autoBodyDirtyPaths.delete(normalizedPath);
    this.restorableEditorBodyDirtyPaths.delete(normalizedPath);
    this.nonRestorableBodyDirtyPaths.delete(normalizedPath);
    this.wordStatusOverrides.clear(normalizedPath);
  }

  private async markWordDirtyWithAutomaticDeferral(file: TFile): Promise<boolean> {
    if (this.pathScope.isWordPath(file.path) && this.isMarkdownFileOpen(file)) {
      return this.markOpenWordBodyDirty(file, null);
    }

    const changed = await this.syncService.markWordDirty(file);
    if (changed) {
      this.setWordBodyDirtyOverride(file, null);
    }
    return changed;
  }

  private trimPendingOpenWordStatusWrite(path: string): void {
    const normalizedPath = normalizePath(path);
    const pending = this.pendingOpenWordStatusWrites.get(normalizedPath);
    if (!pending) {
      return;
    }
    if (!pending.bodyDirty) {
      this.pendingOpenWordStatusWrites.delete(normalizedPath);
    }
  }

  private clearPendingOpenWordBodyWrite(path: string): void {
    const normalizedPath = normalizePath(path);
    const pending = this.pendingOpenWordStatusWrites.get(normalizedPath);
    if (!pending) {
      return;
    }
    delete pending.bodyDirty;
    delete pending.bodyError;
    this.trimPendingOpenWordStatusWrite(normalizedPath);
  }

  private clearPendingOpenWordStatusWrite(path: string): void {
    const normalizedPath = normalizePath(path);
    this.pendingOpenWordStatusWrites.delete(normalizedPath);
    this.flushingOpenWordStatusWritePaths.delete(normalizedPath);
  }

  private hasPendingOpenWordBodyWrite(path: string): boolean {
    return this.pendingOpenWordStatusWrites.get(normalizePath(path))?.bodyDirty === true;
  }

  private clearEditorChangeTimers(): void {
    for (const timer of this.editorChangeTimers.values()) {
      window.clearTimeout(timer);
    }
    this.editorChangeTimers.clear();
  }

  private async flushPendingOpenWordStatusWrites(): Promise<void> {
    const openPaths = this.getOpenMarkdownFilePaths();
    for (const path of Array.from(this.pendingOpenWordStatusWrites.keys())) {
      if (!openPaths.has(path)) {
        await this.flushPendingWordStatusWriteByPath(path);
      }
    }
  }

  private async flushPendingWordStatusWriteByPath(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    const file = this.managedFiles.getFile(normalizedPath) ?? this.app.vault.getFileByPath(normalizedPath);
    if (!file) {
      this.clearPendingOpenWordStatusWrite(normalizedPath);
      return;
    }

    await this.flushPendingWordStatusWrite(file);
  }

  private async flushPendingWordStatusWrite(file: TFile): Promise<void> {
    const normalizedPath = normalizePath(file.path);
    const pending = this.pendingOpenWordStatusWrites.get(normalizedPath);
    if (!pending) {
      return;
    }
    if (this.getOpenMarkdownFilePaths().has(normalizedPath)) {
      return;
    }
    if (this.flushingOpenWordStatusWritePaths.has(normalizedPath)) {
      return;
    }

    if (!file || !this.syncService.canSyncFile(file)) {
      this.clearPendingOpenWordStatusWrite(normalizedPath);
      return;
    }

    this.flushingOpenWordStatusWritePaths.add(normalizedPath);
    try {
      const markdown = await this.app.vault.cachedRead(file);
      const result = await this.referenceIndex.updateWord(file, markdown);
      this.scheduleReferenceUsageRefresh(result.affectedReferencePaths);

      if (result.disabled) {
        this.clearPendingOpenWordStatusWrite(normalizedPath);
        this.clearWordStatusOverride(normalizedPath);
        this.cancelAutoSyncTimer(normalizedPath);
        return;
      }

      const nextSignature = getWordSyncSignature(markdown);
      const decision = this.getWordDirtySignatureDecision(normalizedPath, nextSignature);
      const shouldWriteBodyDirty = pending.bodyDirty && decision !== "clean";
      if (shouldWriteBodyDirty) {
        await this.writeWordSyncFrontmatter(file, {
          syncStatus: "dirty",
          lastError: pending.bodyError ?? null,
        });
      }
      if (decision === "clean") {
        this.clearAutoWordBodyDirty(file);
      } else if (shouldWriteBodyDirty) {
        this.setWordBodyDirtyOverride(file, pending.bodyError ?? null);
      }
      this.clearPendingOpenWordStatusWrite(normalizedPath);
      this.wordSyncSignatures.set(normalizedPath, nextSignature);
    } finally {
      this.flushingOpenWordStatusWritePaths.delete(normalizedPath);
      this.refreshUi();
    }
  }

  private scheduleAutoSyncAfterLeavingWord(path: string): void {
    if (!this.settings.enableAutoSyncWordOnLeave) {
      return;
    }

    const normalizedPath = normalizePath(path);
    const file = this.managedFiles.getFile(normalizedPath) ?? this.app.vault.getFileByPath(normalizedPath);
    if (!file || !this.syncService.canSyncFile(file)) {
      return;
    }

    const context = this.getDisplayWordContext(file);
    if (!context || context.bodyStatus !== "dirty") {
      return;
    }

    this.cancelAutoSyncTimer(normalizedPath);
    const timer = window.setTimeout(() => {
      this.leaveAutoSyncTimers.delete(normalizedPath);
      void this.runAutoSyncForLeftWord(normalizedPath);
    }, AUTO_SYNC_AFTER_LEAVE_DELAY_MS);

    this.leaveAutoSyncTimers.set(normalizedPath, timer);
  }

  private async runAutoSyncForLeftWord(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    if (!this.settings.enableAutoSyncWordOnLeave || this.getActiveWordPath() === normalizedPath) {
      return;
    }

    const file = this.managedFiles.getFile(normalizedPath) ?? this.app.vault.getFileByPath(normalizedPath);
    if (!file || !this.syncService.canSyncFile(file) || this.isSyncInFlight(file)) {
      return;
    }
    if (this.isMarkdownFileOpen(file)) {
      return;
    }

    const context = this.getDisplayWordContext(file);
    if (!context || context.bodyStatus !== "dirty") {
      return;
    }

    try {
      const markdown = await this.app.vault.cachedRead(file);
      if (hasPendingReferenceBlocks(markdown)) {
        const message = "Pending reference blocks must be extracted before sync.";
        if (context.lastError !== message) {
          await this.writeWordSyncFrontmatter(file, {
            syncStatus: "dirty",
            lastError: message,
          });
        }
        this.setWordBodyDirtyOverride(file, message);
        this.refreshUi();
        return;
      }

      const result = await this.referenceIndex.updateWord(file, markdown);
      await this.refreshReferenceUsage(result.affectedReferencePaths);
      // Auto-sync is only an automatic confirmation opportunity; syncWord() still decides whether to upload.
      await this.syncService.markWordDirty(file);
      this.setWordBodyDirtyOverride(file, null);
      await this.syncFile(file, { silentIfAlreadySyncing: true, source: "auto" });
    } catch (error) {
      const message = toErrorMessage(error);
      try {
        await this.writeWordSyncFrontmatter(file, {
          syncStatus: "dirty",
          lastError: message,
        });
      } catch {
        // Best effort: keep auto-sync failures quiet, but surface the latest reason in the UI if possible.
      }
      this.setWordBodyDirtyOverride(file, message);
      this.refreshUi();
    }
  }

  private cancelAutoSyncTimer(path: string): void {
    const normalizedPath = normalizePath(path);
    const timer = this.leaveAutoSyncTimers.get(normalizedPath);
    if (timer === undefined) {
      return;
    }

    window.clearTimeout(timer);
    this.leaveAutoSyncTimers.delete(normalizedPath);
  }

  private clearAutoSyncTimers(): void {
    for (const timer of this.leaveAutoSyncTimers.values()) {
      window.clearTimeout(timer);
    }
    this.leaveAutoSyncTimers.clear();
  }

  private scheduleReferenceUsageRefresh(referencePaths: Iterable<string>): void {
    const paths = Array.from(referencePaths);
    this.invalidateSemanticReferenceCaches(paths);
    this.vaultEventController.scheduleReferenceUsageRefresh(paths);
  }

  private invalidateSemanticReferenceCaches(referencePaths?: Iterable<string>): void {
    const paths = referencePaths ? Array.from(referencePaths) : undefined;
    this.semanticBlockAutomation.invalidateReferenceLinkTargets(paths);
    this.syncService?.invalidateSemanticBlockReferenceCache(paths);
  }

  private async refreshReferenceUsage(referencePaths?: Iterable<string>): Promise<void> {
    const openPaths = this.getOpenMarkdownFilePaths();
    const paths = referencePaths
      ? Array.from(referencePaths).filter((path) => !openPaths.has(normalizePath(path)))
      : undefined;
    if (paths && paths.length === 0) {
      return;
    }
    this.invalidateSemanticReferenceCaches(paths);
    await this.referenceIndex.refreshReferenceUsage(paths);
  }

  private async ensureWordManagedFrontmatterForSync(file: TFile): Promise<string> {
    if (!this.isMarkdownFileOpen(file)) {
      return this.ensureWordManagedFrontmatter(file);
    }

    const existingLinkId = readEudicLinkId(getFrontmatter(this.app, file));
    if (existingLinkId) {
      return existingLinkId;
    }

    const nextLinkId = createEudicLinkId("word");
    await this.writeWordSyncFrontmatter(file, { eudicLinkId: nextLinkId });
    return nextLinkId;
  }

  private async writeWordSyncFrontmatter(file: TFile, data: WordSyncFrontmatterPatchData): Promise<void> {
    const view = this.getOpenMarkdownViewForFile(file);
    if (view) {
      const normalizedPath = normalizePath(file.path);
      const currentMarkdown = view.editor.getValue();
      const nextMarkdown = setWordSyncFrontmatterInMarkdown(currentMarkdown, data);
      const nextSignature = getWordSyncSignature(nextMarkdown);

      if (nextMarkdown !== currentMarkdown) {
        this.syncingEditorWordStatusPatchSignatures.set(normalizedPath, nextSignature);
        window.setTimeout(() => {
          if (this.syncingEditorWordStatusPatchSignatures.get(normalizedPath) === nextSignature) {
            this.syncingEditorWordStatusPatchSignatures.delete(normalizedPath);
          }
        }, SUPPRESSED_WRITE_TTL_MS);

        this.suppressPath(file.path);
        try {
          applyWordSyncFrontmatterPatchToEditor(view.editor, data);
          await view.save();
        } catch (error) {
          this.clearSuppression(file.path);
          this.syncingEditorWordStatusPatchSignatures.delete(normalizedPath);
          throw error;
        }
      }

      if (data.syncStatus === "synced") {
        this.recordWordBodySyncedFromMarkdown(file, nextMarkdown);
      } else if (data.syncStatus === "dirty") {
        this.setWordBodyStatusOverride(file, "dirty", data.lastError ?? null);
      }
      this.refreshUi();
      return;
    }

    await this.writeFrontmatter(file, (frontmatter) => {
      applyWordSyncFrontmatterToObject(frontmatter, data);
    });

    if (data.syncStatus === "dirty") {
      this.setWordBodyStatusOverride(file, "dirty", data.lastError ?? null);
    } else if (data.syncStatus === "synced") {
      this.setWordBodyStatusOverride(file, "synced", null);
    }
  }

  private async writeStudylistFrontmatter(file: TFile, mutate: FrontmatterMutator): Promise<void> {
    await this.writeFrontmatter(file, mutate);
  }

  private async ensureManagedWordProperties(file: TFile) {
    const openView = this.getOpenMarkdownViewForFile(file);
    if (openView) {
      return {
        skipped: this.syncService?.getWordContext(file) === null,
        changed: false,
        markdown: openView.editor.getValue(),
      };
    }

    return ensureManagedWordProperties({
      app: this.app,
      file,
      writeFrontmatter: async (targetFile, mutate) => {
        await this.writeFrontmatter(targetFile, mutate);
      },
    });
  }

  private async ensureAllWordManagedFrontmatter(): Promise<void> {
    const openPaths = this.getOpenMarkdownFilePaths();
    for (const file of this.managedFiles.getWordFiles()) {
      if (openPaths.has(normalizePath(file.path))) {
        continue;
      }
      await this.ensureWordManagedFrontmatter(file);
    }
  }

  private async ensureWordManagedFrontmatter(file: TFile): Promise<string> {
    if (this.isMarkdownFileOpen(file)) {
      return this.ensureWordManagedFrontmatterForSync(file);
    }

    await this.ensureManagedWordProperties(file);
    const linkId = readEudicLinkId(getFrontmatter(this.app, file));
    if (linkId) {
      return linkId;
    }

    const nextLinkId = createEudicLinkId("word");
    await this.writeFrontmatter(file, (frontmatter) => {
      frontmatter[FRONTMATTER_KEYS.eudicLinkId] = nextLinkId;
    });
    return nextLinkId;
  }

  private async ensureReferenceManagedFrontmatter(file: TAbstractFile): Promise<string | null> {
    if (!isMarkdownFile(file) || !this.pathScope.isReferencePath(file.path)) {
      return null;
    }

    const frontmatter = getFrontmatter(this.app, file);
    const existingLinkId = readEudicLinkId(frontmatter);
    const nextLinkId = existingLinkId ?? createEudicLinkId("reference");
    const markdown = await this.app.vault.cachedRead(file);
    if (hasYamlFrontmatter(markdown)) {
      if (existingLinkId === nextLinkId) {
        return nextLinkId;
      }

      await this.writeFrontmatter(file, (nextFrontmatter) => {
        nextFrontmatter[FRONTMATTER_KEYS.eudicLinkId] = nextLinkId;
      });
      return nextLinkId;
    }

    await this.writeMarkdown(file, prependReferenceFrontmatter(markdown, nextLinkId));
    return nextLinkId;
  }

  private async ensureAllReferenceManagedFrontmatter(): Promise<void> {
    const openPaths = this.getOpenMarkdownFilePaths();
    for (const file of this.managedFiles.getReferenceFiles()) {
      if (openPaths.has(normalizePath(file.path))) {
        continue;
      }
      await this.ensureReferenceManagedFrontmatter(file);
    }
  }

  private async getManagedUrlForFile(file: TFile): Promise<string | null> {
    if (this.pathScope.isWordPath(file.path)) {
      const linkId = await this.ensureWordManagedFrontmatter(file);
      return buildManagedFileProtocolUrl(this.app, this.pathScope, file, linkId, (kind) =>
        kind === "word" ? this.managedFiles.getWordFiles() : this.managedFiles.getReferenceFiles(),
      );
    }

    if (this.pathScope.isReferencePath(file.path)) {
      const linkId = await this.ensureReferenceManagedFrontmatter(file);
      if (!linkId) {
        return null;
      }
      return buildManagedFileProtocolUrl(this.app, this.pathScope, file, linkId, (kind) =>
        kind === "word" ? this.managedFiles.getWordFiles() : this.managedFiles.getReferenceFiles(),
      );
    }

    return null;
  }

  private async writeMarkdown(file: TFile, markdown: string): Promise<void> {
    this.suppressPath(file.path);

    try {
      await this.app.vault.modify(file, markdown);
      this.refreshUi();
    } catch (error) {
      this.clearSuppression(file.path);
      throw error;
    }
  }

  private async writeFrontmatter(file: TFile, mutate: FrontmatterMutator): Promise<void> {
    this.suppressPath(file.path);

    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        mutate(frontmatter as Record<string, unknown>);
      });
      this.refreshUi();
    } catch (error) {
      this.clearSuppression(file.path);
      throw error;
    }
  }

  private suppressPath(path: string): void {
    const normalizedPath = normalizePath(path);
    this.suppressedWrites.set(normalizedPath, {
      expiresAt: Date.now() + SUPPRESSED_WRITE_TTL_MS,
    });
  }

  private clearSuppression(path: string): void {
    this.suppressedWrites.delete(normalizePath(path));
  }

  private consumeSuppressedWrite(path: string): boolean {
    const normalizedPath = normalizePath(path);
    const entry = this.suppressedWrites.get(normalizedPath);
    if (!entry) {
      return false;
    }

    if (entry.expiresAt < Date.now()) {
      this.suppressedWrites.delete(normalizedPath);
      return false;
    }

    this.suppressedWrites.delete(normalizedPath);
    return true;
  }
}
