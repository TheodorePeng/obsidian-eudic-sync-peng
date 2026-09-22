import type { App, TFile } from "obsidian";
import { AliasSyncService } from "./alias-sync";
import { FRONTMATTER_KEYS } from "./constants";
import { EudicApiClient } from "./eudic-api";
import { buildEudicProtocolUrl, readEudicLinkId } from "./eudic-link";
import { buildEudicQueryUrl, shouldFillEudicUrlBeforeFirstSync } from "./eudic-url";
import { normalizeEudicBlockKindsFromBody } from "./eudic-block";
import { sha256Hex } from "./hash";
import { HtmlRenderer } from "./html-renderer";
import type { ManagedFileRegistry } from "./managed-file-registry";
import { buildFinalNoteHtml, buildFinalWordNoteHtml } from "./note-output";
import {
  getConfiguredWord,
  getFrontmatter,
  getNormalizedAliases,
  getWordNoteContext,
  readNullableString,
} from "./note-metadata";
import type { PathScope } from "./path-scope";
import { SemanticBlockAutomationResolver, type ReferenceWordIndex } from "./semantic-block-automation-resolver";
import type { SemanticBlockTransformOptions } from "./semantic-block-transform";
import { getSemanticSettingsSignature, SyncRenderCache } from "./sync-render-cache";
import type {
  DeleteEudicNoteResult,
  EudicSyncSettings,
  EudicSyncStatus,
  ResyncAliasesResult,
  SyncBatchResult,
  SyncWordResult,
  WordNoteContext,
} from "./types";
import { EMPTY_WORD_BODY_SYNC_ERROR, prepareSyncBodyMarkdown } from "./word-body";
import { getWordSyncSignature } from "./word-sync-signature";
import type { WordSyncFrontmatterPatchData } from "./word-sync-frontmatter-patch";

interface SyncServiceOptions {
  app: App;
  pathScope: PathScope;
  managedFiles: ManagedFileRegistry;
  getSettings: () => EudicSyncSettings;
  referenceIndex?: ReferenceWordIndex;
  ensureWordLinkId: (file: TFile) => Promise<string>;
  writeSyncFrontmatter: (file: TFile, data: WordSyncFrontmatterPatchData) => Promise<void>;
}

interface SyncWordOptions {
  force?: boolean;
}

export interface PreparedWordSync {
  file: TFile;
  word: string;
  language: string;
  wordLinkId: string;
  localContentSignature: string;
  finalNoteHtml: string;
  currentHash: string;
  storedAliasHash: string | null;
  shouldUpload: boolean;
  force: boolean;
}

export interface SyncWordsOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalOffsetIso(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = pad2(Math.floor(absoluteOffsetMinutes / 60));
  const offsetRemainderMinutes = pad2(absoluteOffsetMinutes % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainderMinutes}`;
}

function nowIsoString(): string {
  return formatLocalOffsetIso(new Date());
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeWordKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeLanguageKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export class SyncService {
  private readonly renderer: HtmlRenderer;
  private readonly apiClient: EudicApiClient;
  private readonly aliasSyncService: AliasSyncService;
  private readonly semanticBlockAutomation: SemanticBlockAutomationResolver;
  private readonly renderCache = new SyncRenderCache();

  constructor(private readonly options: SyncServiceOptions) {
    this.renderer = new HtmlRenderer(options.app, options.pathScope);
    this.apiClient = new EudicApiClient(() => this.options.getSettings().authorizationToken);
    this.semanticBlockAutomation = new SemanticBlockAutomationResolver({
      app: options.app,
      pathScope: options.pathScope,
      managedFiles: options.managedFiles,
      referenceIndex: options.referenceIndex,
      getSettings: options.getSettings,
    });
    this.aliasSyncService = new AliasSyncService({
      app: options.app,
      pathScope: options.pathScope,
      managedFiles: options.managedFiles,
      getAuthorizationToken: () => this.options.getSettings().authorizationToken,
    });
  }

  getWordContext(file: TFile): WordNoteContext | null {
    return getWordNoteContext(this.options.app, this.options.pathScope, file);
  }

  canSyncFile(file: TFile | null | undefined): file is TFile {
    if (!file) return false;
    if (file.extension !== "md") return false;
    return this.getWordContext(file) !== null;
  }

  private getSemanticBlockTransformOptionsForSourcePath(
    sourcePath: string,
    embeddedFromPath: string | undefined,
    currentFile: TFile,
    currentWord: string,
    currentWordLinkId: string,
  ): Promise<SemanticBlockTransformOptions | null> {
    return this.semanticBlockAutomation.getTransformOptionsForSourcePath({
      sourcePath,
      embeddedFromPath,
      currentWordFile: currentFile,
      currentWord,
      currentWordLinkId,
    });
  }

  invalidateSemanticBlockReferenceCache(referencePaths?: Iterable<string>): void {
    this.semanticBlockAutomation.invalidateReferenceLinkTargets(referencePaths);
    const referenceIndex = this.options.referenceIndex;
    if (!referencePaths || !referenceIndex) {
      this.renderCache.invalidateAll();
      return;
    }

    for (const referencePath of referencePaths) {
      for (const wordPath of referenceIndex.findWordsReferencing(referencePath)) {
        this.renderCache.invalidateWord(wordPath);
      }
    }
  }

  invalidateWordRenderCache(path: string): void {
    this.renderCache.invalidateWord(path);
  }

  getRenderCacheDiagnostics(): ReturnType<SyncRenderCache["getDiagnostics"]> {
    return this.renderCache.getDiagnostics();
  }

  async collectDirtyWords(): Promise<TFile[]> {
    const dirtyWords: TFile[] = [];

    for (const file of this.options.managedFiles.getWordFiles()) {
      const context = this.getWordContext(file);
      if (!context) continue;
      if (context.bodyStatus !== "dirty") continue;
      dirtyWords.push(file);
    }

    return dirtyWords;
  }

  /**
   * Dirty is intentionally a cheap "needs confirmation" marker.
   * Do not render Markdown or compute the final Eudic HTML hash here; that work belongs in syncWord().
   */
  async markWordDirty(file: TFile, reason?: string): Promise<boolean> {
    const context = this.getWordContext(file);
    if (!context) {
      return false;
    }

    if (context.bodyStatus === "dirty" && !context.lastError) {
      return false;
    }

    await this.options.writeSyncFrontmatter(file, {
      syncStatus: "dirty",
      lastError: reason ?? null,
    });

    return true;
  }

  /**
   * This is the single sync gate: rebuild final Eudic HTML, hash that exact string,
   * and only upload when it differs from last_synced_hash.
   */
  async syncWord(file: TFile, options: SyncWordOptions = {}): Promise<SyncWordResult> {
    const context = this.getWordContext(file);
    if (!context) {
      throw new Error(`File is not an eligible Eudic word note: ${file.path}`);
    }

    try {
      const prepared = await this.prepareWordSync(file, options);
      return await this.commitPreparedWordSync(prepared);
    } catch (error) {
      return this.writeFailedSyncResult(file, context.word, error);
    }
  }

  async prepareWordSync(file: TFile, options: SyncWordOptions = {}): Promise<PreparedWordSync> {
    const wordLinkId = await this.options.ensureWordLinkId(file);
    const context = this.getWordContext(file);
    if (!context) {
      throw new Error(`File is not an eligible Eudic word note: ${file.path}`);
    }

    if (!context.lang) {
      throw new Error(`Missing '${FRONTMATTER_KEYS.lang}' in ${file.path}.`);
    }

    await this.ensureEudicUrlBeforeFirstSync(file, context);

    const frontmatter = getFrontmatter(this.options.app, file);
    const storedAliasHash = readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedAliasesHash]);
    const settings = this.options.getSettings();
    const rawMarkdown = await this.options.app.vault.cachedRead(file);
    const localContentSignature = getWordSyncSignature(rawMarkdown);
    const { finalNoteHtml } = await this.renderFinalWordNoteHtml(file, context, wordLinkId, settings, rawMarkdown);
    const currentHash = await sha256Hex(finalNoteHtml);

    return {
      file,
      word: context.word,
      language: context.lang,
      wordLinkId,
      localContentSignature,
      finalNoteHtml,
      currentHash,
      storedAliasHash,
      shouldUpload: options.force === true || context.lastSyncedHash !== currentHash,
      force: options.force === true,
    };
  }

  async commitPreparedWordSync(prepared: PreparedWordSync): Promise<SyncWordResult> {
    const latestMarkdown = await this.options.app.vault.cachedRead(prepared.file);
    if (getWordSyncSignature(latestMarkdown) !== prepared.localContentSignature) {
      throw new Error(`Word note changed during sync preparation; upload skipped for ${prepared.file.path}.`);
    }

    let uploaded = false;
    if (prepared.shouldUpload) {
      await this.apiClient.overwriteNotePreservingAttachments({
        word: prepared.word,
        language: prepared.language,
        note: prepared.finalNoteHtml,
      });
      uploaded = true;
    }

    const aliasResult = await this.aliasSyncService.syncAliasesForWord(
      prepared.file,
      prepared.language,
      prepared.storedAliasHash,
      {
        force: prepared.force,
        wordLinkId: prepared.wordLinkId,
      },
    );
    if (aliasResult.error) {
      await this.writeDirtyStateAfterMainConfirmation(prepared.file, prepared.currentHash, aliasResult.error);
      return {
        file: prepared.file,
        word: prepared.word,
        status: "dirty",
        uploaded,
        skipped: false,
        aliasCount: aliasResult.aliasCount,
        aliasUploaded: 0,
        aliasSkipped: false,
        aliasError: aliasResult.error,
        error: aliasResult.error,
      };
    }

    const status = await this.writeSyncedState(prepared.file, prepared.currentHash, aliasResult.hash);
    return {
      file: prepared.file,
      word: prepared.word,
      status,
      uploaded: uploaded || aliasResult.uploaded,
      skipped: !uploaded && !aliasResult.uploaded && aliasResult.skipped,
      aliasCount: aliasResult.aliasCount,
      aliasUploaded: aliasResult.uploaded ? aliasResult.aliasCount : 0,
      aliasSkipped: aliasResult.skipped || aliasResult.aliasCount === 0,
    };
  }

  private async ensureEudicUrlBeforeFirstSync(file: TFile, context: WordNoteContext): Promise<void> {
    const frontmatter = getFrontmatter(this.options.app, file);
    if (!shouldFillEudicUrlBeforeFirstSync(frontmatter)) {
      return;
    }

    await this.options.writeSyncFrontmatter(file, {
      eudicUrl: buildEudicQueryUrl(context.word, context.lang),
    });
  }

  async reconcileWordSyncStatus(file: TFile): Promise<EudicSyncStatus> {
    let wordContentSynced = false;
    try {
      wordContentSynced = await this.isWordContentSynced(file);
    } catch {
      wordContentSynced = false;
    }

    let nextStatus: EudicSyncStatus = "dirty";
    nextStatus = wordContentSynced ? "synced" : "dirty";
    await this.options.writeSyncFrontmatter(file, {
      syncStatus: nextStatus,
      lastError: nextStatus === "synced" ? null : undefined,
    });

    return nextStatus;
  }

  async resyncAliases(file: TFile): Promise<ResyncAliasesResult> {
    const context = this.getWordContext(file);
    if (!context) {
      throw new Error(`File is not an eligible Eudic word note: ${file.path}`);
    }

    if (!context.lang) {
      throw new Error(`Missing '${FRONTMATTER_KEYS.lang}' in ${file.path}.`);
    }

    const frontmatter = getFrontmatter(this.options.app, file);
    const storedAliasHash = readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedAliasesHash]);
    const wordLinkId = await this.options.ensureWordLinkId(file);
    const aliasResult = await this.aliasSyncService.syncAliasesForWord(file, context.lang, storedAliasHash, {
      force: true,
      wordLinkId,
    });

    if (aliasResult.aliasCount === 0) {
      return {
        file,
        word: context.word,
        status: context.effectiveStatus,
        aliasCount: 0,
        aliasUploaded: 0,
        aliasSkipped: true,
        noAliases: true,
      };
    }

    if (aliasResult.error) {
      await this.options.writeSyncFrontmatter(file, {
        lastError: aliasResult.error,
      });

      return {
        file,
        word: context.word,
        status: context.effectiveStatus,
        aliasCount: aliasResult.aliasCount,
        aliasUploaded: 0,
        aliasSkipped: false,
        noAliases: false,
        error: aliasResult.error,
      };
    }

    await this.options.writeSyncFrontmatter(file, {
      lastSyncedAliasesHash: aliasResult.hash,
      lastError: null,
    });

    return {
      file,
      word: context.word,
      status: context.effectiveStatus,
      aliasCount: aliasResult.aliasCount,
      aliasUploaded: aliasResult.aliasCount,
      aliasSkipped: false,
      noAliases: false,
    };
  }

  async deleteCurrentWordNote(file: TFile): Promise<DeleteEudicNoteResult> {
    const context = this.getWordContext(file);
    if (!context) {
      throw new Error(`File is not an eligible Eudic word note: ${file.path}`);
    }

    if (!context.lang) {
      throw new Error(`Missing '${FRONTMATTER_KEYS.lang}' in ${file.path}.`);
    }

    await this.apiClient.deleteNote({
      word: context.word,
      language: context.lang,
    });

    await this.invalidateMainWordAfterDelete(file);

    return {
      word: context.word,
      language: context.lang,
      matchedMainFiles: [file],
      matchedAliasOwnerFiles: [],
    };
  }

  async deleteTypedWordNote(word: string, language: string): Promise<DeleteEudicNoteResult> {
    const trimmedWord = word.trim();
    const trimmedLanguage = language.trim();
    if (!trimmedWord) {
      throw new Error("Word is required.");
    }

    if (!trimmedLanguage) {
      throw new Error("Language is required.");
    }

    await this.apiClient.deleteNote({
      word: trimmedWord,
      language: trimmedLanguage,
    });

    const matchedMainFiles = this.findMatchingMainWordFiles(trimmedWord, trimmedLanguage);
    const matchedAliasOwnerFiles = this.findMatchingAliasOwnerFiles(trimmedWord, trimmedLanguage, matchedMainFiles);

    for (const file of matchedMainFiles) {
      await this.invalidateMainWordAfterDelete(file);
    }

    for (const file of matchedAliasOwnerFiles) {
      await this.invalidateAliasOwnerAfterDelete(file);
    }

    return {
      word: trimmedWord,
      language: trimmedLanguage,
      matchedMainFiles,
      matchedAliasOwnerFiles,
    };
  }

  async syncWords(files: TFile[], options: SyncWordsOptions = {}): Promise<SyncBatchResult> {
    const results: SyncWordResult[] = [];

    for (let index = 0; index < files.length; index += 2) {
      if (options.signal?.aborted) {
        break;
      }
      const chunk = files.slice(index, index + 2);
      const preparedChunk = await Promise.all(chunk.map(async (file) => {
        const context = this.getWordContext(file);
        if (!context) {
          return {
            result: await this.writeFailedSyncResult(
              file,
              file.basename,
              new Error(`File is not an eligible Eudic word note: ${file.path}`),
            ),
          };
        }
        try {
          return { prepared: await this.prepareWordSync(file) };
        } catch (error) {
          return { result: await this.writeFailedSyncResult(file, context.word, error) };
        }
      }));

      for (const item of preparedChunk) {
        if (options.signal?.aborted) {
          break;
        }
        if (item.result) {
          results.push(item.result);
          options.onProgress?.(results.length, files.length);
          continue;
        }
        try {
          results.push(await this.commitPreparedWordSync(item.prepared));
        } catch (error) {
          results.push(await this.writeFailedSyncResult(item.prepared.file, item.prepared.word, error));
        }
        options.onProgress?.(results.length, files.length);
      }
    }

    return {
      total: results.length,
      uploaded: results.filter((result) => result.uploaded).length,
      skipped: results.filter((result) => result.skipped).length,
      failed: results.filter((result) => result.error).length,
      aliasUploaded: results.reduce((sum, result) => sum + result.aliasUploaded, 0),
      results,
      canceled: files.length - results.length,
    };
  }

  getAvailableWordLanguages(): string[] {
    const languages = new Set<string>(["en"]);

    for (const file of this.options.managedFiles.getWordFiles()) {
      const context = this.getWordContext(file);
      if (!context?.lang) {
        continue;
      }

      languages.add(context.lang);
    }

    return Array.from(languages).sort((left, right) => {
      if (left === "en") return -1;
      if (right === "en") return 1;
      return left.localeCompare(right);
    });
  }

  private getReferenceDependencySignature(file: TFile): string {
    const references = this.options.referenceIndex?.findReferencesForWord?.(file.path) ?? [];
    return references.join("\u0000");
  }

  private async renderFinalWordNoteHtml(
    file: TFile,
    context: WordNoteContext,
    wordLinkId: string,
    settings: EudicSyncSettings,
    rawMarkdown?: string,
  ): Promise<{ finalNoteHtml: string }> {
    const sourceMarkdown = rawMarkdown ?? await this.options.app.vault.cachedRead(file);
    const wordSignature = getWordSyncSignature(sourceMarkdown);
    const cacheKey = {
      wordPath: file.path,
      wordSignature,
      noteOutputMode: settings.noteOutputMode,
      noteOutputFormatVersion: settings.noteOutputFormatVersion,
      semanticSettingsSignature: getSemanticSettingsSignature(settings),
      referenceDependencySignature: this.getReferenceDependencySignature(file),
    };
    const cachedFinalNoteHtml = this.renderCache.get(cacheKey);
    if (cachedFinalNoteHtml !== null) {
      return { finalNoteHtml: cachedFinalNoteHtml };
    }

    const normalizedMarkdown = normalizeEudicBlockKindsFromBody(sourceMarkdown, settings.semanticBlockKindPresets);

    const syncBodyMarkdown = prepareSyncBodyMarkdown(normalizedMarkdown.markdown);
    if (!syncBodyMarkdown) {
      throw new Error(EMPTY_WORD_BODY_SYNC_ERROR);
    }

    const rendered = await this.renderer.renderMarkdown(syncBodyMarkdown, file.path, (sourcePath, embeddedFromPath) =>
      this.getSemanticBlockTransformOptionsForSourcePath(sourcePath, embeddedFromPath, file, context.word, wordLinkId),
    );
    const linkResolver = {
      app: this.options.app,
      pathScope: this.options.pathScope,
      sourcePath: file.path,
    };
    const finalNoteBodyHtml = buildFinalNoteHtml(rendered, settings.noteOutputMode, linkResolver);
    if (!finalNoteBodyHtml.trim()) {
      throw new Error(EMPTY_WORD_BODY_SYNC_ERROR);
    }

    const finalNoteHtml = buildFinalWordNoteHtml(
      rendered,
      settings.noteOutputMode,
      context.word,
      buildEudicProtocolUrl(this.options.app, "word", wordLinkId, context.word),
      linkResolver,
    );
    this.renderCache.set(cacheKey, finalNoteHtml);
    return { finalNoteHtml };
  }

  private async isWordContentSynced(file: TFile): Promise<boolean> {
    const context = this.getWordContext(file);
    if (!context?.lang) {
      return false;
    }

    const frontmatter = getFrontmatter(this.options.app, file);
    const wordLinkId = readEudicLinkId(frontmatter);
    if (!wordLinkId) {
      return false;
    }

    const { finalNoteHtml } = await this.renderFinalWordNoteHtml(
      file,
      context,
      wordLinkId,
      this.options.getSettings(),
    );
    const currentHash = await sha256Hex(finalNoteHtml);
    if (context.lastSyncedHash !== currentHash) {
      return false;
    }

    const storedAliasHash = readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedAliasesHash]);
    const aliasHash = await this.aliasSyncService.getCurrentAliasHash(file, context.lang, wordLinkId);
    return !aliasHash.error && aliasHash.hash === storedAliasHash;
  }

  private async writeDirtyStateAfterMainConfirmation(file: TFile, hash: string, error: string): Promise<void> {
    await this.options.writeSyncFrontmatter(file, {
      syncStatus: "dirty",
      syncedAt: nowIsoString(),
      lastSyncedHash: hash,
      lastError: error,
    });
  }

  private async writeFailedSyncResult(file: TFile, word: string, error: unknown): Promise<SyncWordResult> {
    const message = toErrorMessage(error);
    try {
      await this.options.writeSyncFrontmatter(file, {
        syncStatus: "dirty",
        lastError: message,
      });
    } catch {
      // Best effort: keep the original failure reason even if the error state writeback fails.
    }

    return {
      file,
      word,
      status: "dirty",
      uploaded: false,
      skipped: false,
      aliasCount: 0,
      aliasUploaded: 0,
      aliasSkipped: false,
      error: message,
    };
  }

  private async writeSyncedState(file: TFile, hash: string, aliasesHash: string | null): Promise<EudicSyncStatus> {
    await this.options.writeSyncFrontmatter(file, {
      syncStatus: "synced",
      syncedAt: nowIsoString(),
      lastSyncedHash: hash,
      lastSyncedAliasesHash: aliasesHash,
      lastError: null,
    });
    return "synced";
  }

  private async invalidateMainWordAfterDelete(file: TFile): Promise<void> {
    await this.options.writeSyncFrontmatter(file, {
      syncStatus: "dirty",
      lastSyncedHash: null,
      syncedAt: null,
      lastError: null,
    });
  }

  private async invalidateAliasOwnerAfterDelete(file: TFile): Promise<void> {
    await this.options.writeSyncFrontmatter(file, {
      syncStatus: "dirty",
      lastSyncedAliasesHash: null,
      lastError: null,
    });
  }

  private findMatchingMainWordFiles(word: string, language: string): TFile[] {
    const targetWordKey = normalizeWordKey(word);
    const targetLanguageKey = normalizeLanguageKey(language);
    const matches: TFile[] = [];

    for (const file of this.options.managedFiles.getWordFiles()) {
      const context = this.getWordContext(file);
      if (!context?.lang) {
        continue;
      }

      if (normalizeLanguageKey(context.lang) !== targetLanguageKey) {
        continue;
      }

      if (normalizeWordKey(context.word) !== targetWordKey) {
        continue;
      }

      matches.push(file);
    }

    return matches;
  }

  private findMatchingAliasOwnerFiles(word: string, language: string, matchedMainFiles: TFile[]): TFile[] {
    const targetWordKey = normalizeWordKey(word);
    const targetLanguageKey = normalizeLanguageKey(language);
    const matchedMainPaths = new Set(matchedMainFiles.map((file) => file.path));
    const matches: TFile[] = [];

    for (const file of this.options.managedFiles.getWordFiles()) {
      if (matchedMainPaths.has(file.path)) {
        continue;
      }

      const context = this.getWordContext(file);
      if (!context?.lang) {
        continue;
      }

      if (normalizeLanguageKey(context.lang) !== targetLanguageKey) {
        continue;
      }

      const frontmatter = getFrontmatter(this.options.app, file);
      const mainWord = getConfiguredWord(frontmatter, file);
      if (normalizeWordKey(mainWord) === targetWordKey) {
        continue;
      }

      const aliases = getNormalizedAliases(frontmatter, file);
      if (!aliases.some((alias) => normalizeWordKey(alias) === targetWordKey)) {
        continue;
      }

      matches.push(file);
    }

    return matches;
  }
}
