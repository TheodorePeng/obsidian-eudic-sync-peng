import type { App, TFile } from "obsidian";
import { FRONTMATTER_KEYS } from "./constants";
import type { ManagedFileRegistry } from "./managed-file-registry";
import {
  getFrontmatter,
  getWordNoteContext,
  readNullableString,
  readStringArray,
} from "./note-metadata";
import type { PathScope } from "./path-scope";
import {
  buildReferenceSemanticBlockTransformOptions,
  buildWordSemanticBlockTransformOptions,
  mergeSemanticBlockLinkTargets,
  type SemanticBlockLinkTarget,
  type SemanticBlockTransformOptions,
  type SemanticBlockWordTarget,
} from "./semantic-block-transform";
import type { EudicSyncSettings } from "./types";

export interface ReferenceWordIndex {
  findWordsReferencing(referencePath: string): string[];
  findReferencesForWord?(wordPath: string): string[];
  readReferencePropertyWordPaths?(referencePath: string): string[];
  repairReferenceMetadataForReference?(
    referencePath: string,
    options?: { write?: boolean; forceFreshScan?: boolean },
  ): Promise<{ wordPaths: string[]; affectedReferencePaths: string[]; affectedWordPaths: string[] }>;
  findWordsReferencingWithFallback?(
    referencePath: string,
    options?: { forceScan?: boolean },
  ): Promise<{ wordPaths: string[]; affectedReferencePaths: string[] }>;
}

interface SemanticBlockAutomationResolverOptions {
  app: App;
  pathScope: PathScope;
  managedFiles: ManagedFileRegistry;
  referenceIndex?: ReferenceWordIndex;
  getSettings: () => EudicSyncSettings;
}

interface SemanticBlockResolveOptions {
  sourcePath?: string;
  embeddedFromPath?: string;
  currentWordFile?: TFile | null;
  currentWord?: string;
  currentWordLinkId?: string;
}

interface ReferenceSemanticTargets {
  currentWordTarget: SemanticBlockWordTarget | null;
  linkTargets: SemanticBlockLinkTarget[];
}

interface ReferenceSemanticTargetsCacheEntry {
  referencePath: string;
  targets: ReferenceSemanticTargets;
}

function normalizeResolverPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function encodeQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function buildWordProtocolUrl(app: App, id: string, word: string): string {
  return `obsidian://eudic-sync?${encodeQuery({
    vault: app.vault.getName(),
    kind: "word",
    id,
    word,
  })}`;
}

export class SemanticBlockAutomationResolver {
  private readonly referenceTargetsByPath = new Map<string, ReferenceSemanticTargetsCacheEntry>();

  constructor(private readonly options: SemanticBlockAutomationResolverOptions) {}

  invalidateReferenceLinkTargets(referencePaths?: Iterable<string>): void {
    if (!referencePaths) {
      this.referenceTargetsByPath.clear();
      return;
    }

    for (const referencePath of referencePaths) {
      this.referenceTargetsByPath.delete(normalizeResolverPath(referencePath));
    }
  }

  async getTransformOptionsForSourcePath(resolveOptions: SemanticBlockResolveOptions): Promise<SemanticBlockTransformOptions | null> {
    const sourcePath = normalizeResolverPath(resolveOptions.sourcePath ?? "");
    const sourceFile = this.options.managedFiles.getFile(sourcePath) ?? this.options.app.vault.getFileByPath(sourcePath);
    if (!sourceFile || sourceFile.extension !== "md") {
      return null;
    }

    const settings = this.options.getSettings();
    if (this.options.pathScope.isWordPath(sourceFile.path)) {
      const wordTarget = this.getWordTarget(sourceFile, resolveOptions);
      return wordTarget ? buildWordSemanticBlockTransformOptions(settings, wordTarget) : null;
    }

    if (this.options.pathScope.isReferencePath(sourceFile.path)) {
      const currentWordTarget = resolveOptions.currentWordFile
        ? this.getWordTarget(resolveOptions.currentWordFile, resolveOptions)
        : null;
      const referenceTargets = await this.getReferenceSemanticTargets(sourceFile, resolveOptions);
      return buildReferenceSemanticBlockTransformOptions(
        settings,
        currentWordTarget?.word ?? referenceTargets.currentWordTarget?.word ?? null,
        referenceTargets.linkTargets,
      );
    }

    return null;
  }

  private getReferenceSemanticTargets(
    referenceFile: TFile,
    resolveOptions: SemanticBlockResolveOptions,
  ): Promise<ReferenceSemanticTargets> {
    if (resolveOptions.currentWordFile || resolveOptions.currentWord || resolveOptions.currentWordLinkId || resolveOptions.embeddedFromPath) {
      return this.resolveReferenceSemanticTargets(referenceFile, resolveOptions);
    }

    const normalizedPath = normalizeResolverPath(referenceFile.path);
    const cached = this.referenceTargetsByPath.get(normalizedPath);
    if (cached) {
      return Promise.resolve(cached.targets);
    }

    return this.resolveReferenceSemanticTargets(referenceFile, resolveOptions).then((targets) => {
      this.referenceTargetsByPath.set(normalizedPath, {
        referencePath: normalizedPath,
        targets,
      });
      return targets;
    });
  }

  private async resolveReferenceSemanticTargets(
    referenceFile: TFile,
    resolveOptions: SemanticBlockResolveOptions,
  ): Promise<ReferenceSemanticTargets> {
    const propertyWordPaths = this.getReferencePropertyWordPaths(referenceFile);
    const graphWordPaths = this.options.referenceIndex?.findWordsReferencing(referenceFile.path) ?? [];
    const wordPaths = new Set<string>(propertyWordPaths);
    for (const wordPath of graphWordPaths) {
      wordPaths.add(wordPath);
    }

    if (
      (propertyWordPaths.length === 0 || (propertyWordPaths.length > 0 && graphWordPaths.length === 0)) &&
      this.options.referenceIndex?.repairReferenceMetadataForReference
    ) {
      const lookup = await this.options.referenceIndex.repairReferenceMetadataForReference(referenceFile.path, {
        forceFreshScan: true,
      });
      for (const wordPath of lookup.wordPaths) {
        wordPaths.add(wordPath);
      }
      for (const wordPath of this.getReferencePropertyWordPaths(referenceFile)) {
        wordPaths.add(wordPath);
      }
    }

    const currentWordFile = resolveOptions.currentWordFile ?? null;
    const currentWordReferences = currentWordFile ? this.currentWordReferencesReference(wordPaths, currentWordFile, resolveOptions) : false;
    const currentWordTarget = currentWordReferences && currentWordFile ? this.getWordTarget(currentWordFile, resolveOptions) : null;
    if (currentWordReferences && currentWordFile) {
      wordPaths.add(currentWordFile.path);
    }

    const targets: SemanticBlockLinkTarget[] = [];
    for (const wordPath of Array.from(wordPaths).sort((left, right) => left.localeCompare(right))) {
      const wordFile = this.options.managedFiles.getFile(wordPath) ?? this.options.app.vault.getFileByPath(wordPath);
      if (!wordFile || wordFile.extension !== "md" || !this.options.pathScope.isWordPath(wordFile.path)) {
        continue;
      }

      const wordTarget = this.getWordTarget(wordFile, {});
      if (wordTarget?.linkUrl) {
        targets.push({
          word: wordTarget.word,
          linkUrl: wordTarget.linkUrl,
        });
      }
    }

    return {
      currentWordTarget,
      linkTargets: mergeSemanticBlockLinkTargets(currentWordTarget, targets),
    };
  }

  private currentWordReferencesReference(
    referenceWordPaths: Set<string>,
    currentWordFile: TFile,
    resolveOptions: SemanticBlockResolveOptions,
  ): boolean {
    if (
      resolveOptions.embeddedFromPath &&
      normalizeResolverPath(resolveOptions.embeddedFromPath) === normalizeResolverPath(currentWordFile.path)
    ) {
      return true;
    }

    return Array.from(referenceWordPaths)
      .map(normalizeResolverPath)
      .includes(normalizeResolverPath(currentWordFile.path));
  }

  private getReferencePropertyWordPaths(referenceFile: TFile): string[] {
    const fromIndex = this.options.referenceIndex?.readReferencePropertyWordPaths?.(referenceFile.path);
    if (fromIndex) {
      return fromIndex;
    }

    return readStringArray(getFrontmatter(this.options.app, referenceFile)[FRONTMATTER_KEYS.referencedBy])
      .map(normalizeResolverPath)
      .filter((wordPath) => this.options.pathScope.isWordPath(wordPath));
  }

  private getWordTarget(wordFile: TFile, resolveOptions: SemanticBlockResolveOptions): SemanticBlockWordTarget | null {
    const context = getWordNoteContext(this.options.app, this.options.pathScope, wordFile);
    if (!context) {
      return null;
    }

    if (
      resolveOptions.currentWordFile &&
      normalizeResolverPath(wordFile.path) === normalizeResolverPath(resolveOptions.currentWordFile.path) &&
      resolveOptions.currentWord &&
      resolveOptions.currentWordLinkId
    ) {
      return {
        word: resolveOptions.currentWord,
        linkUrl: buildWordProtocolUrl(this.options.app, resolveOptions.currentWordLinkId, resolveOptions.currentWord),
      };
    }

    const frontmatter = getFrontmatter(this.options.app, wordFile);
    const linkId = readNullableString(frontmatter[FRONTMATTER_KEYS.eudicLinkId]);
    return {
      word: context.word,
      linkUrl: linkId ? buildWordProtocolUrl(this.options.app, linkId, context.word) : null,
    };
  }
}
