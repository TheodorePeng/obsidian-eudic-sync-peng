import type { App, TFile } from "obsidian";
import { FRONTMATTER_KEYS } from "./constants";
import {
  resolveManagedReferencePaths,
  stringArraysEqual,
  toStoredReferenceRefs,
} from "./reference-links";
import { createEudicLinkId, readEudicLinkId } from "./eudic-link";
import {
  getFrontmatter,
  isWordSyncDisabledFrontmatter,
  readNullableString,
  readStringArray,
} from "./note-metadata";
import type { ManagedFileRegistry } from "./managed-file-registry";
import type { PathScope } from "./path-scope";
import type { FrontmatterMutator, ReferenceMetadataWriteMode } from "./types";

interface ReferenceIndexServiceOptions {
  app: App;
  pathScope: PathScope;
  managedFiles: ManagedFileRegistry;
  writeFrontmatter: (file: TFile, mutate: FrontmatterMutator) => Promise<void>;
  getReferenceMetadataWriteMode?: () => ReferenceMetadataWriteMode;
}

function normalizeGraphPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

export interface ReferenceGraphUpdate {
  wordPath: string;
  referencePaths: string[];
  storedReferencePaths: string[];
  affectedReferencePaths: string[];
  disabled: boolean;
}

export type WordReferenceUpdateResult = ReferenceGraphUpdate;

export interface ReferenceLookupResult {
  wordPaths: string[];
  affectedReferencePaths: string[];
  scannedWordCount: number;
}

export interface LegacyReferenceMetadataRebuildResult {
  wordMetadataUpdated: number;
  referenceMetadataUpdated: number;
  affectedWordPaths: string[];
  affectedReferencePaths: string[];
  scannedWordCount: number;
}

export interface ReferenceMetadataRepairResult extends LegacyReferenceMetadataRebuildResult {
  wordPaths: string[];
}

export interface ReferenceMetadataRepairOptions {
  write?: boolean;
  forceFreshScan?: boolean;
}

export interface ReferenceScanResult {
  referencePath: string;
  wordPaths: string[];
  affectedReferencePaths: string[];
  scannedWordCount: number;
}

export function formatUsageUpdatedAt(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(absoluteOffsetMinutes / 60));
  const offsetRemainderMinutes = pad(absoluteOffsetMinutes % 60);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${offsetHours}:${offsetRemainderMinutes}`;
}

function buildWikiLink(file: TFile, displayText = file.basename): string {
  return `[[${file.path}|${displayText}]]`;
}

function cloneSet(input: Iterable<string>): Set<string> {
  return new Set(input);
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readYamlBoolean(markdown: string, key: string): boolean | null {
  const yamlMatch = markdown.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  const yaml = yamlMatch?.[1];
  if (!yaml) {
    return null;
  }

  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(.+?)\\s*$`);
  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(keyPattern);
    if (!match) {
      continue;
    }

    const value = (match[1] ?? "").replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "").toLowerCase();
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return null;
  }

  return null;
}

function isWordSyncDisabledForIndex(app: App, file: TFile, markdown: string): boolean {
  const syncEnabled = readYamlBoolean(markdown, FRONTMATTER_KEYS.syncEudicEnabled);
  if (syncEnabled !== null) {
    return !syncEnabled;
  }

  const legacyEnabled = readYamlBoolean(markdown, FRONTMATTER_KEYS.eudicSync);
  if (legacyEnabled !== null) {
    return legacyEnabled === false;
  }

  const frontmatter = getFrontmatter(app, file);
  return isWordSyncDisabledFrontmatter(frontmatter);
}

function sortedStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function usageNeedsRewrite(frontmatter: Record<string, unknown>, referenceId: string, referencedBy: TFile[]): boolean {
  const referencedByPaths = referencedBy.map((file) => file.path);
  const referencedByLinks = referencedBy.map((file) => buildWikiLink(file));

  return (
    readEudicLinkId(frontmatter) !== referenceId ||
    readNumber(frontmatter[FRONTMATTER_KEYS.refCount]) !== referencedBy.length ||
    !stringArraysEqual(readStringArray(frontmatter[FRONTMATTER_KEYS.referencedBy]), referencedByPaths) ||
    !stringArraysEqual(readStringArray(frontmatter[FRONTMATTER_KEYS.referencedByLinks]), referencedByLinks) ||
    readNullableString(frontmatter[FRONTMATTER_KEYS.usageUpdatedAt]) === null
  );
}

function readReferencedByWordPaths(frontmatter: Record<string, unknown>): string[] {
  return readStringArray(frontmatter[FRONTMATTER_KEYS.referencedBy]);
}

function isMarkdownFilePath(path: string): boolean {
  return path.toLocaleLowerCase().endsWith(".md");
}

export class ReferenceGraphService {
  private readonly wordToReferences = new Map<string, Set<string>>();
  private readonly referenceToWords = new Map<string, Set<string>>();
  private readonly scannedReferencePaths = new Set<string>();
  private isIndexBuilt = false;

  constructor(private readonly options: ReferenceIndexServiceOptions) {}

  async rebuildAll(): Promise<void> {
    this.isIndexBuilt = false;
    this.wordToReferences.clear();
    this.referenceToWords.clear();
    this.scannedReferencePaths.clear();

    for (const file of await this.getManagedWordFilesForScan()) {
      await this.updateWord(file);
    }

    this.isIndexBuilt = true;
  }

  async updateWord(file: TFile, markdown?: string): Promise<ReferenceGraphUpdate> {
    const wordPath = normalizeGraphPath(file.path);
    if (!this.options.pathScope.isWordPath(wordPath)) {
      return {
        wordPath,
        referencePaths: [],
        storedReferencePaths: [],
        affectedReferencePaths: this.removeWord(wordPath),
        disabled: true,
      };
    }

    const sourceMarkdown = markdown ?? (await this.options.app.vault.cachedRead(file));
    if (isWordSyncDisabledForIndex(this.options.app, file, sourceMarkdown)) {
      return {
        wordPath,
        referencePaths: [],
        storedReferencePaths: [],
        affectedReferencePaths: this.removeWord(wordPath),
        disabled: true,
      };
    }

    const referencePaths = resolveManagedReferencePaths(this.options.app, this.options.pathScope, file, sourceMarkdown);
    const affectedReferencePaths = this.setWordReferences(wordPath, new Set(referencePaths));
    const storedReferencePaths = toStoredReferenceRefs(this.options.pathScope, referencePaths);

    return {
      wordPath,
      referencePaths,
      storedReferencePaths,
      affectedReferencePaths,
      disabled: false,
    };
  }

  removeWord(path: string): string[] {
    const normalizedPath = normalizeGraphPath(path);
    const previousReferences = this.wordToReferences.get(normalizedPath) ?? new Set<string>();
    for (const referencePath of previousReferences) {
      this.scannedReferencePaths.delete(referencePath);
      const wordPaths = this.referenceToWords.get(referencePath);
      wordPaths?.delete(normalizedPath);
      if (wordPaths?.size === 0) {
        this.referenceToWords.delete(referencePath);
      }
    }

    this.wordToReferences.delete(normalizedPath);
    return sortedStrings(previousReferences);
  }

  findWordsReferencing(referencePath: string): string[] {
    return sortedStrings(this.referenceToWords.get(normalizeGraphPath(referencePath)) ?? []);
  }

  async findWordsReferencingWithFallback(
    referencePath: string,
    options: { forceScan?: boolean } = {},
  ): Promise<ReferenceLookupResult> {
    const normalizedReferencePath = normalizeGraphPath(referencePath);
    if (options.forceScan) {
      return this.scanWordsReferencingReference(normalizedReferencePath);
    }

    const wordPaths = new Set(this.findWordsReferencing(normalizedReferencePath));
    const affectedReferencePaths = new Set<string>();
    affectedReferencePaths.add(normalizedReferencePath);

    if (this.isIndexBuilt) {
      return {
        wordPaths: sortedStrings(wordPaths),
        affectedReferencePaths: sortedStrings(affectedReferencePaths),
        scannedWordCount: 0,
      };
    }

    return this.scanWordsReferencingReference(normalizedReferencePath);
  }

  async scanWordsReferencingReference(referencePath: string): Promise<ReferenceScanResult> {
    const normalizedReferencePath = normalizeGraphPath(referencePath);
    const wordPaths = new Set<string>();
    const affectedReferencePaths = new Set<string>([normalizedReferencePath]);
    let scannedWordCount = 0;

    for (const file of await this.getManagedWordFilesForScan()) {
      scannedWordCount += 1;
      const markdown = await this.options.app.vault.cachedRead(file);
      const result = await this.updateWord(file, markdown);
      for (const affectedPath of result.affectedReferencePaths) {
        affectedReferencePaths.add(affectedPath);
      }
      if (result.disabled) {
        continue;
      }

      if (result.referencePaths.includes(normalizedReferencePath)) {
        wordPaths.add(file.path);
      }
    }
    this.scannedReferencePaths.add(normalizedReferencePath);
    this.isIndexBuilt = true;

    return {
      referencePath: normalizedReferencePath,
      wordPaths: sortedStrings(wordPaths),
      affectedReferencePaths: sortedStrings(affectedReferencePaths),
      scannedWordCount,
    };
  }

  async refreshReferenceUsage(referencePaths?: Iterable<string>): Promise<ReferenceMetadataRepairResult> {
    if (!referencePaths) {
      return this.emptyRepairResult();
    }

    return this.repairReferenceMetadata(referencePaths, {
      write: this.getReferenceMetadataWriteMode() === "auto",
      forceFreshScan: true,
    });
  }

  async rebuildLegacyReferenceMetadata(): Promise<LegacyReferenceMetadataRebuildResult> {
    return this.repairAllReferenceMetadata({ write: true });
  }

  async repairAllReferenceMetadata(options: ReferenceMetadataRepairOptions = {}): Promise<ReferenceMetadataRepairResult> {
    return this.repairReferenceMetadata(undefined, {
      write: options.write ?? true,
      forceFreshScan: true,
    });
  }

  async repairReferenceMetadataForReference(
    referencePath: string,
    options: ReferenceMetadataRepairOptions = {},
  ): Promise<ReferenceMetadataRepairResult> {
    return this.repairReferenceMetadata([referencePath], {
      write: options.write ?? (this.getReferenceMetadataWriteMode() === "auto"),
      forceFreshScan: options.forceFreshScan ?? true,
    });
  }

  async repairReferenceMetadata(
    referencePaths?: Iterable<string>,
    options: ReferenceMetadataRepairOptions = {},
  ): Promise<ReferenceMetadataRepairResult> {
    const shouldWrite = options.write === true;
    const forceFreshScan = options.forceFreshScan === true;
    const affectedWordPaths = new Set<string>();
    const affectedReferencePaths = new Set<string>();
    const repairedWordPaths = new Set<string>();
    let scannedWordCount = 0;
    let targetReferencePaths: string[];

    if (referencePaths) {
      targetReferencePaths = sortedStrings(referencePaths).filter((referencePath) =>
        this.options.pathScope.isReferencePath(referencePath),
      );
      for (const referencePath of targetReferencePaths) {
        const existingReferencedBy = this.readReferencePropertyWordPaths(referencePath);
        for (const wordPath of existingReferencedBy) {
          affectedWordPaths.add(wordPath);
        }
        const lookup = forceFreshScan
          ? await this.scanWordsReferencingReference(referencePath)
          : await this.findWordsReferencingWithFallback(referencePath, { forceScan: true });
        scannedWordCount += lookup.scannedWordCount;
        for (const wordPath of lookup.wordPaths) {
          repairedWordPaths.add(wordPath);
          affectedWordPaths.add(wordPath);
        }
        for (const affectedReferencePath of lookup.affectedReferencePaths) {
          affectedReferencePaths.add(affectedReferencePath);
        }
        affectedReferencePaths.add(referencePath);
      }
    } else {
      await this.rebuildAll();
      scannedWordCount += (await this.getManagedWordFilesForScan()).length;
      targetReferencePaths = await this.getAllReferencePaths();
      for (const referencePath of targetReferencePaths) {
        affectedReferencePaths.add(referencePath);
        for (const wordPath of this.findWordsReferencing(referencePath)) {
          repairedWordPaths.add(wordPath);
          affectedWordPaths.add(wordPath);
        }
        for (const wordPath of this.readReferencePropertyWordPaths(referencePath)) {
          affectedWordPaths.add(wordPath);
        }
      }
    }

    let wordMetadataUpdated = 0;
    let referenceMetadataUpdated = 0;

    if (shouldWrite) {
      const wordFilesToRepair = referencePaths
        ? sortedStrings(affectedWordPaths)
          .map((wordPath) => this.getMarkdownFileByPath(wordPath))
          .filter((file): file is TFile => !!file && file.extension === "md" && this.options.pathScope.isWordPath(file.path))
        : await this.getManagedWordFilesForScan();

      for (const wordFile of wordFilesToRepair) {
        const references = this.findReferencesForWord(wordFile.path);
        const storedReferencePaths = toStoredReferenceRefs(this.options.pathScope, references);
        if (await this.writeWordLegacyReferencePathsIfNeeded(wordFile, storedReferencePaths)) {
          wordMetadataUpdated += 1;
          affectedWordPaths.add(wordFile.path);
        }
      }

      for (const referencePath of targetReferencePaths) {
        const file = this.options.managedFiles.getFile(referencePath) ?? this.options.app.vault.getFileByPath(referencePath);
        if (!file || file.extension !== "md" || !this.options.pathScope.isReferencePath(file.path)) {
          continue;
        }

        if (await this.writeReferenceLegacyUsageIfNeeded(file)) {
          referenceMetadataUpdated += 1;
          affectedReferencePaths.add(file.path);
          for (const wordPath of this.findWordsReferencing(file.path)) {
            affectedWordPaths.add(wordPath);
          }
        }
      }
    }

    return {
      wordMetadataUpdated,
      referenceMetadataUpdated,
      affectedWordPaths: sortedStrings(affectedWordPaths),
      affectedReferencePaths: sortedStrings(affectedReferencePaths),
      wordPaths: sortedStrings(repairedWordPaths),
      scannedWordCount,
    };
  }

  private emptyRepairResult(): ReferenceMetadataRepairResult {
    return {
      wordMetadataUpdated: 0,
      referenceMetadataUpdated: 0,
      affectedWordPaths: [],
      affectedReferencePaths: [],
      wordPaths: [],
      scannedWordCount: 0,
    };
  }

  findReferencesForWord(wordPath: string): string[] {
    return sortedStrings(this.wordToReferences.get(normalizeGraphPath(wordPath)) ?? []);
  }

  readReferencePropertyWordPaths(referencePath: string): string[] {
    const normalizedPath = normalizeGraphPath(referencePath);
    const file = this.getMarkdownFileByPath(normalizedPath);
    if (!file || file.extension !== "md" || !this.options.pathScope.isReferencePath(file.path)) {
      return [];
    }

    return readReferencedByWordPaths(getFrontmatter(this.options.app, file))
      .map(normalizeGraphPath)
      .filter((wordPath) => this.options.pathScope.isWordPath(wordPath));
  }

  invalidate(paths?: Iterable<string>): void {
    if (!paths) {
      this.isIndexBuilt = false;
      this.wordToReferences.clear();
      this.referenceToWords.clear();
      this.scannedReferencePaths.clear();
      return;
    }

    for (const path of paths) {
      const normalizedPath = normalizeGraphPath(path);
      if (this.options.pathScope.isWordPath(normalizedPath)) {
        this.removeWord(normalizedPath);
      }
      if (this.options.pathScope.isReferencePath(normalizedPath)) {
        this.scannedReferencePaths.delete(normalizedPath);
        const wordPaths = this.referenceToWords.get(normalizedPath) ?? new Set<string>();
        for (const wordPath of wordPaths) {
          this.wordToReferences.get(wordPath)?.delete(normalizedPath);
        }
        this.referenceToWords.delete(normalizedPath);
      }
    }
  }

  private async writeWordLegacyReferencePathsIfNeeded(file: TFile, storedReferencePaths: string[]): Promise<boolean> {
    const currentStoredReferenceRefs = readStringArray(getFrontmatter(this.options.app, file)[FRONTMATTER_KEYS.referencePaths]);
    const frontmatter = getFrontmatter(this.options.app, file);
    const hasStableReferencePaths = Array.isArray(frontmatter[FRONTMATTER_KEYS.referencePaths]);
    const hasLegacyReferenceRefs = FRONTMATTER_KEYS.legacyReferenceRefs in frontmatter;
    if (stringArraysEqual(currentStoredReferenceRefs, storedReferencePaths) && hasStableReferencePaths && !hasLegacyReferenceRefs) {
      return false;
    }

    await this.options.writeFrontmatter(file, (nextFrontmatter) => {
      nextFrontmatter[FRONTMATTER_KEYS.referencePaths] = storedReferencePaths;
      delete nextFrontmatter[FRONTMATTER_KEYS.legacyReferenceRefs];
    });
    return true;
  }

  private getReferenceMetadataWriteMode(): ReferenceMetadataWriteMode {
    return this.options.getReferenceMetadataWriteMode?.() ?? "off";
  }

  private setWordReferences(wordPath: string, nextReferences: Set<string>): string[] {
    const normalizedWordPath = normalizeGraphPath(wordPath);
    const previousReferences = this.wordToReferences.get(normalizedWordPath) ?? new Set<string>();
    if (setsEqual(previousReferences, nextReferences)) {
      return [];
    }

    const affectedReferencePaths = new Set<string>([...previousReferences, ...nextReferences]);
    for (const referencePath of affectedReferencePaths) {
      this.scannedReferencePaths.delete(referencePath);
    }

    for (const referencePath of previousReferences) {
      const wordPaths = this.referenceToWords.get(referencePath);
      wordPaths?.delete(normalizedWordPath);
      if (wordPaths?.size === 0) {
        this.referenceToWords.delete(referencePath);
      }
    }

    if (nextReferences.size === 0) {
      this.wordToReferences.delete(normalizedWordPath);
      return sortedStrings(affectedReferencePaths);
    }

    const clonedReferences = cloneSet(nextReferences);
    this.wordToReferences.set(normalizedWordPath, clonedReferences);
    for (const referencePath of clonedReferences) {
      let wordPaths = this.referenceToWords.get(referencePath);
      if (!wordPaths) {
        wordPaths = new Set<string>();
        this.referenceToWords.set(referencePath, wordPaths);
      }
      wordPaths.add(normalizedWordPath);
    }

    return sortedStrings(affectedReferencePaths);
  }

  private async writeReferenceLegacyUsageIfNeeded(referenceFile: TFile): Promise<boolean> {
    const frontmatter = getFrontmatter(this.options.app, referenceFile);
    const referenceId = readEudicLinkId(frontmatter) ?? createEudicLinkId("reference");
    const referencedByPaths = this.findWordsReferencing(referenceFile.path);
    const referencedBy = referencedByPaths
      .map((wordPath) => this.getMarkdownFileByPath(wordPath))
      .filter((file): file is TFile => !!file && file.extension === "md")
      .filter((file) => !isWordSyncDisabledFrontmatter(getFrontmatter(this.options.app, file)))
      .sort((left, right) => left.path.localeCompare(right.path));
    for (const wordFile of referencedBy) {
      this.ensureWordReferencesInclude(wordFile.path, referenceFile.path);
    }

    if (!usageNeedsRewrite(frontmatter, referenceId, referencedBy)) {
      return false;
    }

    const nextReferencedByPaths = referencedBy.map((file) => file.path);
    const referencedByLinks = referencedBy.map((file) => buildWikiLink(file));
    await this.options.writeFrontmatter(referenceFile, (nextFrontmatter) => {
      nextFrontmatter[FRONTMATTER_KEYS.eudicLinkId] = referenceId;
      nextFrontmatter[FRONTMATTER_KEYS.refCount] = referencedBy.length;
      nextFrontmatter[FRONTMATTER_KEYS.referencedBy] = nextReferencedByPaths;
      nextFrontmatter[FRONTMATTER_KEYS.referencedByLinks] = referencedByLinks;
      nextFrontmatter[FRONTMATTER_KEYS.usageUpdatedAt] = formatUsageUpdatedAt();
    });
    return true;
  }

  private ensureWordReferencesInclude(wordPath: string, referencePath: string): void {
    const normalizedWordPath = normalizeGraphPath(wordPath);
    const normalizedReferencePath = normalizeGraphPath(referencePath);
    let references = this.wordToReferences.get(normalizedWordPath);
    if (!references) {
      references = new Set<string>();
      this.wordToReferences.set(normalizedWordPath, references);
    }
    references.add(normalizedReferencePath);

    let wordPaths = this.referenceToWords.get(normalizedReferencePath);
    if (!wordPaths) {
      wordPaths = new Set<string>();
      this.referenceToWords.set(normalizedReferencePath, wordPaths);
    }
    wordPaths.add(normalizedWordPath);
  }

  private getMarkdownFileByPath(path: string): TFile | null {
    const normalizedPath = normalizeGraphPath(path);
    const registryFile = this.options.managedFiles.getFile(normalizedPath);
    if (registryFile?.extension === "md") {
      return registryFile;
    }

    const vaultFile = this.options.app.vault.getFileByPath(normalizedPath);
    if (vaultFile?.extension === "md") {
      return vaultFile;
    }

    const abstractFile = this.options.app.vault.getAbstractFileByPath?.(normalizedPath);
    if (abstractFile && "extension" in abstractFile && (abstractFile as TFile).extension === "md") {
      return abstractFile as TFile;
    }

    return null;
  }

  private async getAllReferencePaths(): Promise<string[]> {
    return (await this.getManagedReferenceFilesForScan()).map((file) => file.path);
  }

  private async getManagedWordFilesForScan(): Promise<TFile[]> {
    return this.getManagedFilesForScan("word");
  }

  private async getManagedReferenceFilesForScan(): Promise<TFile[]> {
    return this.getManagedFilesForScan("reference");
  }

  private async getManagedFilesForScan(kind: "word" | "reference"): Promise<TFile[]> {
    const filesByPath = new Map<string, TFile>();
    const addFile = (file: TFile | null | undefined) => {
      if (!file || file.extension !== "md") {
        return;
      }
      const normalizedPath = normalizeGraphPath(file.path);
      const matchesScope = kind === "word"
        ? this.options.pathScope.isWordPath(normalizedPath)
        : this.options.pathScope.isReferencePath(normalizedPath);
      if (matchesScope) {
        filesByPath.set(normalizedPath, file);
      }
    };

    const registryFiles = kind === "word"
      ? this.options.managedFiles.getWordFiles()
      : this.options.managedFiles.getReferenceFiles();
    for (const file of registryFiles) {
      addFile(file);
    }

    for (const file of this.options.app.vault.getMarkdownFiles()) {
      addFile(file);
    }

    const folderPath = kind === "word" ? this.getWordFolderPath() : this.getReferenceFolderPath();
    if (folderPath) {
      for (const file of await this.listMarkdownFilesFromFolder(folderPath)) {
        addFile(file);
      }
    }

    return Array.from(filesByPath.values()).sort((left, right) => left.path.localeCompare(right.path));
  }

  private getWordFolderPath(): string {
    return (this.options.pathScope as { getWordFolderPath?: () => string }).getWordFolderPath?.() ?? "";
  }

  private getReferenceFolderPath(): string {
    return (this.options.pathScope as { getReferenceFolderPath?: () => string }).getReferenceFolderPath?.() ?? "";
  }

  private async listMarkdownFilesFromFolder(folderPath: string): Promise<TFile[]> {
    const adapter = this.options.app.vault.adapter;
    if (!adapter?.list) {
      return [];
    }

    const files: TFile[] = [];
    const seenFolders = new Set<string>();
    const visit = async (folder: string): Promise<void> => {
      const normalizedFolder = normalizeGraphPath(folder).replace(/^\/+|\/+$/g, "");
      if (!normalizedFolder || seenFolders.has(normalizedFolder)) {
        return;
      }
      seenFolders.add(normalizedFolder);

      let listed;
      try {
        listed = await adapter.list(normalizedFolder);
      } catch {
        return;
      }

      for (const path of listed.files) {
        const normalizedPath = normalizeGraphPath(path);
        if (!isMarkdownFilePath(normalizedPath)) {
          continue;
        }
        const file = this.getMarkdownFileByPath(normalizedPath);
        if (file) {
          files.push(file);
        }
      }

      for (const childFolder of listed.folders) {
        await visit(childFolder);
      }
    };

    await visit(folderPath);
    return files;
  }
}

export { ReferenceGraphService as ReferenceIndexService };
