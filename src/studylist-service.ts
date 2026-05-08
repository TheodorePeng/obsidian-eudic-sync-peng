import type { App, TFile } from "obsidian";
import { FRONTMATTER_KEYS } from "./constants";
import { EudicApiClient } from "./eudic-api";
import {
  getConfiguredWord,
  getFrontmatter,
  isWordSyncDisabledFrontmatter,
  readNullableString,
} from "./note-metadata";
import type { ManagedFileRegistry } from "./managed-file-registry";
import type { PathScope } from "./path-scope";
import { StudylistCatalogResolver } from "./studylist-catalog-resolver";
import {
  isStudylistSyncStatusNormalized,
  normalizeStudylistSyncStatus,
  readStudylistSyncStatus,
  shouldSkipEmptySyncedStudylistAssignment,
} from "./studylist-sync-status";
import {
  analyzeStudylistWordModify,
  type StudylistAssignmentIntent,
  type StudylistAssignmentSnapshot,
  type StudylistWordModifyAnalysis,
} from "./studylist-word-modify-analysis";
import type {
  EudicStudylistCache,
  EudicStudylistCategory,
  EudicSyncStatus,
  FrontmatterMutator,
  StudylistPullWordResult,
  StudylistPushSummary,
  StudylistPushWordResult,
  StudylistRefreshSummary,
} from "./types";

const STUDYLIST_PAGE_SIZE = 100;
const STUDYLIST_MAX_PAGE = 50;

interface StudylistServiceOptions {
  app: App;
  pathScope: PathScope;
  managedFiles: ManagedFileRegistry;
  getAuthorizationToken: () => string;
  getStudylistCache: () => EudicStudylistCache;
  setStudylistCache: (cache: EudicStudylistCache) => Promise<void>;
  writeFrontmatter: (file: TFile, mutate: FrontmatterMutator) => Promise<void>;
}

export interface StudylistPushPreview {
  total: number;
  added: number;
  removed: number;
  files: TFile[];
}

export interface StudylistRepairSummary {
  updated: number;
  unresolved: number;
}

export type { StudylistWordModifyAnalysis } from "./studylist-word-modify-analysis";

export type { StudylistAssignmentIntent } from "./studylist-word-modify-analysis";

interface WordStudylistState {
  file: TFile;
  word: string;
  language: string;
  ids: string[];
  names: string[];
  status: EudicSyncStatus;
  disabled: boolean;
  lastError: string | null;
}

interface CloudStudylistSnapshot {
  cache: EudicStudylistCache;
  assignments: Map<string, string[]>;
  wordCount: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function nowLocalIsoString(date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}${sign}${pad2(Math.floor(absoluteOffsetMinutes / 60))}:${pad2(absoluteOffsetMinutes % 60)}`;
}

function normalizeId(value: string): string {
  return value.trim();
}

function uniqueNormalized(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    const value = normalizeId(rawValue);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function normalizeWordKey(word: string, language: string): string {
  return `${language.trim().toLocaleLowerCase()}\u0000${word.trim().toLocaleLowerCase()}`;
}

function readIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueNormalized(
    value.map((entry) => {
      if (typeof entry === "number" && Number.isFinite(entry)) {
        return String(entry);
      }
      return typeof entry === "string" ? entry : "";
    }),
  );
}

function readNameArray(value: unknown): string[] {
  if (typeof value === "string") {
    return uniqueNormalized([value]);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueNormalized(value.map((entry) => (typeof entry === "string" ? entry : "")));
}

function getDiff(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((entry) => !rightSet.has(entry));
}

function getUnknownNamesError(names: string[]): string {
  return `Unknown Eudic studylist name(s): ${names.join(", ")} after refreshing Eudic studylists. Create the category in Eudic first or choose an existing category name.`;
}

function getUnknownIdsError(ids: string[]): string {
  return `Unknown Eudic studylist id(s): ${ids.join(", ")} after refreshing Eudic studylists. Refresh Eudic studylists or pull the word assignment from Eudic.`;
}

function getAssignmentError(unknownNames: string[], unknownIds: string[]): string | null {
  const messages: string[] = [];
  if (unknownNames.length > 0) {
    messages.push(getUnknownNamesError(unknownNames));
  }
  if (unknownIds.length > 0) {
    messages.push(getUnknownIdsError(unknownIds));
  }
  return messages.length > 0 ? messages.join(" ") : null;
}

function readStateFromFrontmatter(
  app: App,
  pathScope: PathScope,
  file: TFile,
): WordStudylistState | null {
  if (!pathScope.isWordPath(file.path) || file.extension !== "md") {
    return null;
  }

  const frontmatter = getFrontmatter(app, file);
  const disabled = isWordSyncDisabledFrontmatter(frontmatter);
  const language = readNullableString(frontmatter[FRONTMATTER_KEYS.lang]) ?? "en";
  return {
    file,
    word: getConfiguredWord(frontmatter, file),
    language,
    ids: readIdArray(frontmatter[FRONTMATTER_KEYS.studylistIds]),
    names: readNameArray(frontmatter[FRONTMATTER_KEYS.studylistNames]),
    status: readStudylistSyncStatus(frontmatter),
    disabled,
    lastError: readNullableString(frontmatter[FRONTMATTER_KEYS.studylistLastError]),
  };
}

export class StudylistService {
  private readonly apiClient: EudicApiClient;
  private readonly catalog: StudylistCatalogResolver;
  private readonly localAssignmentSnapshots = new Map<string, StudylistAssignmentSnapshot>();

  constructor(private readonly options: StudylistServiceOptions) {
    this.apiClient = new EudicApiClient(() => this.options.getAuthorizationToken());
    this.catalog = new StudylistCatalogResolver({
      getCache: () => this.options.getStudylistCache(),
      setCache: (cache) => this.options.setStudylistCache(cache),
      fetchCategories: (language) => this.apiClient.getStudylistCategories(language),
    });
  }

  async ensureAllWordStudylistFrontmatter(): Promise<void> {
    for (const file of this.getManagedWordFiles()) {
      await this.ensureWordStudylistFrontmatter(file);
    }
  }

  captureAllLocalSnapshots(): void {
    this.localAssignmentSnapshots.clear();
    for (const file of this.getManagedWordFiles()) {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled || state.lastError) {
        continue;
      }

      this.localAssignmentSnapshots.set(file.path, { ids: state.ids, names: state.names });
    }
  }

  removeWord(path: string): void {
    this.localAssignmentSnapshots.delete(path);
  }

  async handleWordModify(file: TFile, markdown: string): Promise<void> {
    await this.reconcileWordAssignment(file, markdown);
  }

  async reconcileWordAssignment(
    file: TFile,
    markdown: string,
    options: {
      activeIntent?: StudylistAssignmentIntent;
      previousRawSnapshot?: StudylistAssignmentSnapshot;
      expectedCanonicalAssignment?: StudylistAssignmentSnapshot;
    } = {},
  ): Promise<StudylistWordModifyAnalysis | null> {
    if (!this.options.pathScope.isWordPath(file.path)) {
      return null;
    }

    await this.ensureWordStudylistFrontmatter(file);
    const analysis = await this.analyzeWordModify(file, markdown, options);
    if (!analysis || analysis.disabled) {
      return analysis;
    }

    await this.applyWordModifyAnalysis(file, analysis);
    return analysis;
  }

  async analyzeWordModify(
    file: TFile,
    markdown: string,
    options: {
      activeIntent?: StudylistAssignmentIntent;
      previousRawSnapshot?: StudylistAssignmentSnapshot;
      expectedCanonicalAssignment?: StudylistAssignmentSnapshot;
      refreshOnUnknown?: boolean;
    } = {},
  ): Promise<StudylistWordModifyAnalysis | null> {
    if (!this.options.pathScope.isWordPath(file.path)) {
      return null;
    }

    const frontmatterState = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    if (!frontmatterState || frontmatterState.disabled) {
      this.localAssignmentSnapshots.delete(file.path);
      return {
        disabled: true,
        language: frontmatterState?.language ?? "en",
        ids: [],
        names: [],
        preferredSource: "names",
        sourceIds: [],
        sourceNames: [],
        isResolved: true,
        shouldDirty: false,
        shouldWrite: false,
        nextStatus: "synced",
        nextLastError: null,
      };
    }

    const previousSnapshot = this.localAssignmentSnapshots.get(file.path);
    return analyzeStudylistWordModify({
      state: frontmatterState,
      previousSnapshot,
      previousRawSnapshot: options.previousRawSnapshot,
      expectedCanonicalAssignment: options.expectedCanonicalAssignment,
      activeIntent: options.activeIntent,
      markdown,
      refreshOnUnknown: options.refreshOnUnknown,
      resolveAssignment: (language, assignment, resolveOptions) =>
        this.catalog.resolveAssignment(language, assignment, resolveOptions),
    });
  }

  async refreshStudylistCatalogForLanguage(language: string): Promise<void> {
    await this.catalog.refreshLanguage(language);
  }

  applyWordModifyAnalysisToFrontmatter(
    frontmatter: Record<string, unknown>,
    analysis: StudylistWordModifyAnalysis,
  ): void {
    frontmatter[FRONTMATTER_KEYS.studylistIds] = analysis.ids;
    frontmatter[FRONTMATTER_KEYS.studylistNames] = analysis.names;
    frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = analysis.nextStatus;
    if (analysis.nextLastError) {
      frontmatter[FRONTMATTER_KEYS.studylistLastError] = analysis.nextLastError;
    } else {
      delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
    }
  }

  captureWordModifyAnalysisSnapshot(file: TFile, analysis: StudylistWordModifyAnalysis): void {
    if (analysis.disabled) {
      this.localAssignmentSnapshots.delete(file.path);
      return;
    }

    if (analysis.nextLastError) {
      return;
    }

    this.localAssignmentSnapshots.set(file.path, { ids: analysis.ids, names: analysis.names });
  }

  async applyWordModifyAnalysis(file: TFile, analysis: StudylistWordModifyAnalysis): Promise<void> {
    if (analysis.disabled) {
      this.localAssignmentSnapshots.delete(file.path);
      return;
    }

    if (analysis.shouldWrite) {
      await this.options.writeFrontmatter(file, (frontmatter) => {
        this.applyWordModifyAnalysisToFrontmatter(frontmatter, analysis);
      });
    }

    this.captureWordModifyAnalysisSnapshot(file, analysis);
  }

  async refreshFromEudic(): Promise<StudylistRefreshSummary> {
    const cloudSnapshot = await this.fetchCloudStudylistSnapshot();
    await this.options.setStudylistCache(cloudSnapshot.cache);
    const updatedFiles = await this.applyCloudAssignmentsToLocalWords(cloudSnapshot);
    this.captureAllLocalSnapshots();
    return {
      categories: cloudSnapshot.cache.categories.length,
      words: cloudSnapshot.wordCount,
      updatedWords: updatedFiles.length,
      updatedFiles,
    };
  }

  async pullAssignmentsFromEudic(): Promise<StudylistRefreshSummary> {
    return this.refreshFromEudic();
  }

  async pullCurrentWordAssignmentFromEudic(file: TFile, overwriteDirty = false): Promise<StudylistPullWordResult> {
    await this.ensureWordStudylistFrontmatter(file);
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    if (!state || state.disabled) {
      throw new Error(`File is not an eligible Eudic word note: ${file.path}`);
    }

    if (state.status === "dirty" && !overwriteDirty) {
      throw new Error(`Current word "${state.word}" has local dirty studylist changes.`);
    }

    const nextCache = await this.catalog.refreshLanguage(state.language);

    const wordInfo = await this.apiClient.getStudylistWord({
      word: state.word,
      language: state.language,
    });
    const ids = uniqueNormalized(wordInfo?.category_ids ?? []);
    const names = this.catalog.getNamesForIdsFromCache(state.language, ids, nextCache);
    const updated = !arraysEqual(state.ids, ids) || !arraysEqual(state.names, names) || state.status !== "synced" || !!state.lastError;

    if (updated) {
      await this.options.writeFrontmatter(file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistIds] = ids;
        frontmatter[FRONTMATTER_KEYS.studylistNames] = names;
        frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "synced";
        frontmatter[FRONTMATTER_KEYS.studylistSyncedAt] = nowLocalIsoString();
        delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
      });
    }

    this.localAssignmentSnapshots.set(file.path, { ids, names });

    return {
      file,
      word: state.word,
      language: state.language,
      ids,
      names,
      updated,
      wasDirty: state.status === "dirty",
    };
  }

  async rebuildLocalMetadata(): Promise<number> {
    return (await this.rebuildLocalMetadataInternal()).updated;
  }

  async repairNamesIdsForAllWords(): Promise<StudylistRepairSummary> {
    return this.rebuildLocalMetadataInternal();
  }

  private async rebuildLocalMetadataInternal(): Promise<StudylistRepairSummary> {
    let updated = 0;
    let unresolved = 0;
    for (const file of this.getManagedWordFiles()) {
      const changed = await this.ensureWordStudylistFrontmatter(file);
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled) {
        continue;
      }

      const resolved = await this.catalog.resolveAssignment(state.language, {
        ids: state.ids,
        names: state.names,
        preferredSource: state.names.length > 0 ? "names" : "ids",
      });
      const nextLastError = getAssignmentError(resolved.unknownNames, resolved.unknownIds);
      if (nextLastError) {
        unresolved += 1;
      }
      const idsChanged = !arraysEqual(state.ids, resolved.ids);
      const nextStatus: EudicSyncStatus = state.status === "dirty" || idsChanged || nextLastError ? "dirty" : "synced";
      if (
        !arraysEqual(state.ids, resolved.ids) ||
        !arraysEqual(state.names, resolved.names) ||
        state.status !== nextStatus ||
        state.lastError !== nextLastError
      ) {
        await this.options.writeFrontmatter(file, (frontmatter) => {
          if (nextLastError) {
            frontmatter[FRONTMATTER_KEYS.studylistLastError] = nextLastError;
          } else {
            frontmatter[FRONTMATTER_KEYS.studylistIds] = resolved.ids;
            frontmatter[FRONTMATTER_KEYS.studylistNames] = resolved.names;
            delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
          }
          frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = nextStatus;
        });
        updated += 1;
      } else if (changed) {
        updated += 1;
      }

      if (!nextLastError) {
        this.localAssignmentSnapshots.set(file.path, { ids: resolved.ids, names: resolved.names });
      }
    }

    return { updated, unresolved };
  }

  collectDirtyStudylistWords(): TFile[] {
    return this.getManagedWordFiles().filter((file) => {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      return !!state && !state.disabled && state.status === "dirty";
    });
  }

  getCurrentWordForPush(file: TFile): TFile | null {
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    if (!state || state.disabled) {
      return null;
    }

    return file;
  }

  getCurrentWordStudylistLastError(file: TFile): string | null {
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    return state?.lastError ?? null;
  }

  getCurrentWordStudylistStatus(file: TFile): EudicSyncStatus | null {
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    return state?.status ?? null;
  }

  getCurrentDirtyWordForPush(file: TFile): TFile | null {
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    if (!state || state.disabled || state.status !== "dirty") {
      return null;
    }

    return file;
  }

  async previewPush(files: TFile[]): Promise<StudylistPushPreview> {
    let added = 0;
    let removed = 0;
    const pushableFiles: TFile[] = [];

    for (const file of files) {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled) {
        continue;
      }
      if (shouldSkipEmptySyncedStudylistAssignment(state.ids, state.names, state.status)) {
        continue;
      }

      const prepared = await this.prepareStateForPush(state);
      if (prepared.error) {
        continue;
      }

      const cloudIds = await this.getCloudCategoryIds(prepared.state);
      added += getDiff(prepared.state.ids, cloudIds).length;
      removed += getDiff(cloudIds, prepared.state.ids).length;
      pushableFiles.push(file);
    }

    return {
      total: pushableFiles.length,
      added,
      removed,
      files: pushableFiles,
    };
  }

  async pushAssignments(files: TFile[]): Promise<StudylistPushSummary> {
    const results: StudylistPushWordResult[] = [];

    for (const file of files) {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled) {
        continue;
      }
      if (shouldSkipEmptySyncedStudylistAssignment(state.ids, state.names, state.status)) {
        continue;
      }

      const prepared = await this.prepareStateForPush(state);
      if (prepared.error) {
        results.push({
          file: state.file,
          word: state.word,
          language: state.language,
          added: 0,
          removed: 0,
          changed: false,
          error: prepared.error,
        });
        continue;
      }

      results.push(await this.pushWordAssignment(prepared.state));
    }

    return {
      total: results.length,
      succeeded: results.filter((result) => !result.error).length,
      failed: results.filter((result) => result.error).length,
      added: results.reduce((sum, result) => sum + result.added, 0),
      removed: results.reduce((sum, result) => sum + result.removed, 0),
      results,
    };
  }

  private async ensureWordStudylistFrontmatter(file: TFile): Promise<boolean> {
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    if (!state) {
      return false;
    }

    const frontmatter = getFrontmatter(this.options.app, file);
    const shouldNormalizeStudylistStatus = !isStudylistSyncStatusNormalized(frontmatter);
    const shouldWrite =
      shouldNormalizeStudylistStatus ||
      !Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistIds]) ||
      !Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistNames]);

    if (!shouldWrite) {
      return false;
    }

    await this.options.writeFrontmatter(file, (frontmatter) => {
      normalizeStudylistSyncStatus(frontmatter);
      if (!Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistIds])) {
        frontmatter[FRONTMATTER_KEYS.studylistIds] = [];
      }
      if (!Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistNames])) {
        frontmatter[FRONTMATTER_KEYS.studylistNames] = [];
      }
    });
    return true;
  }

  private async fetchCloudStudylistSnapshot(): Promise<CloudStudylistSnapshot> {
    const languages = this.getManagedLanguages();
    const categories: EudicStudylistCategory[] = [];
    const assignments = new Map<string, string[]>();
    let wordCount = 0;

    for (const language of languages) {
      const languageCategories = await this.apiClient.getStudylistCategories(language);
      categories.push(...languageCategories);

      for (const category of languageCategories) {
        for (let page = 0; page <= STUDYLIST_MAX_PAGE; page += 1) {
          const words = await this.apiClient.getStudylistWords({
            language,
            categoryId: category.id,
            page,
            pageSize: STUDYLIST_PAGE_SIZE,
          });
          if (words.length === 0) {
            break;
          }

          wordCount += words.length;
          for (const wordInfo of words) {
            const key = normalizeWordKey(wordInfo.word, language);
            assignments.set(key, uniqueNormalized([...(assignments.get(key) ?? []), category.id]));
          }

          if (words.length < STUDYLIST_PAGE_SIZE) {
            break;
          }
        }
      }
    }

    return {
      cache: {
        categories,
        refreshedAt: nowLocalIsoString(),
      },
      assignments,
      wordCount,
    };
  }

  private async applyCloudAssignmentsToLocalWords(snapshot: CloudStudylistSnapshot): Promise<TFile[]> {
    const updatedFiles: TFile[] = [];
    for (const file of this.getManagedWordFiles()) {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled || state.status === "dirty") {
        continue;
      }

      const ids = snapshot.assignments.get(normalizeWordKey(state.word, state.language)) ?? [];
      const names = this.catalog.getNamesForIdsFromCache(state.language, ids, snapshot.cache);
      if (
        arraysEqual(state.ids, ids) &&
        arraysEqual(state.names, names) &&
        state.status === "synced" &&
        readNullableString(getFrontmatter(this.options.app, file)[FRONTMATTER_KEYS.studylistLastError]) === null
      ) {
        continue;
      }

      await this.options.writeFrontmatter(file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistIds] = ids;
        frontmatter[FRONTMATTER_KEYS.studylistNames] = names;
        frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "synced";
        frontmatter[FRONTMATTER_KEYS.studylistSyncedAt] = nowLocalIsoString();
        delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
      });
      updatedFiles.push(file);
    }

    return updatedFiles;
  }

  private async prepareStateForPush(state: WordStudylistState): Promise<{ state: WordStudylistState; error?: string }> {
    const resolved = await this.catalog.resolveAssignment(state.language, {
      ids: state.ids,
      names: state.names,
      preferredSource: state.names.length > 0 ? "names" : "ids",
    });
    const error = getAssignmentError(resolved.unknownNames, resolved.unknownIds) ?? undefined;

    if (error) {
      await this.options.writeFrontmatter(state.file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "dirty";
        frontmatter[FRONTMATTER_KEYS.studylistLastError] = error;
      });
      return { state, error };
    }

    const nextState: WordStudylistState = {
      ...state,
      ids: resolved.ids,
      names: resolved.names,
      lastError: null,
    };
    const idsChanged = !arraysEqual(state.ids, nextState.ids);
    if (idsChanged || !arraysEqual(state.names, nextState.names) || state.lastError) {
      await this.options.writeFrontmatter(state.file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistIds] = nextState.ids;
        frontmatter[FRONTMATTER_KEYS.studylistNames] = nextState.names;
        delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
        if (idsChanged) {
          frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "dirty";
        }
      });
    }

    this.localAssignmentSnapshots.set(state.file.path, { ids: nextState.ids, names: nextState.names });
    return { state: nextState };
  }

  private async pushWordAssignment(state: WordStudylistState): Promise<StudylistPushWordResult> {
    try {
      const cloudIds = await this.getCloudCategoryIds(state);
      const idsToAdd = getDiff(state.ids, cloudIds);
      const idsToRemove = getDiff(cloudIds, state.ids);

      for (const categoryId of idsToAdd) {
        await this.apiClient.addWordsToStudylist({
          language: state.language,
          category_id: categoryId,
          words: [state.word],
        });
      }

      for (const categoryId of idsToRemove) {
        await this.apiClient.deleteWordsFromStudylist({
          language: state.language,
          category_id: categoryId,
          words: [state.word],
        });
      }

      await this.options.writeFrontmatter(state.file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistIds] = state.ids;
        frontmatter[FRONTMATTER_KEYS.studylistNames] = state.names;
        frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "synced";
        frontmatter[FRONTMATTER_KEYS.studylistSyncedAt] = nowLocalIsoString();
        delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
      });
      this.localAssignmentSnapshots.set(state.file.path, { ids: state.ids, names: state.names });

      return {
        file: state.file,
        word: state.word,
        language: state.language,
        added: idsToAdd.length,
        removed: idsToRemove.length,
        changed: idsToAdd.length > 0 || idsToRemove.length > 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.options.writeFrontmatter(state.file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "dirty";
        frontmatter[FRONTMATTER_KEYS.studylistLastError] = message;
      });

      return {
        file: state.file,
        word: state.word,
        language: state.language,
        added: 0,
        removed: 0,
        changed: false,
        error: message,
      };
    }
  }

  private async getCloudCategoryIds(state: WordStudylistState): Promise<string[]> {
    const wordInfo = await this.apiClient.getStudylistWord({
      word: state.word,
      language: state.language,
    });
    return uniqueNormalized(wordInfo?.category_ids ?? []);
  }

  private getManagedWordFiles(): TFile[] {
    return this.options.managedFiles.getWordFiles();
  }

  private getManagedLanguages(): string[] {
    const languages = new Set<string>(["en"]);
    for (const file of this.getManagedWordFiles()) {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled) {
        continue;
      }

      languages.add(state.language);
    }

    return Array.from(languages).sort((left, right) => {
      if (left === "en") return -1;
      if (right === "en") return 1;
      return left.localeCompare(right);
    });
  }

}
