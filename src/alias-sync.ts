import type { App, TFile } from "obsidian";
import { normalizePath } from "obsidian";
import { FRONTMATTER_KEYS } from "./constants";
import { EudicApiClient } from "./eudic-api";
import { sha256Hex } from "./hash";
import { getConfiguredWord, getFrontmatter, getNormalizedAliases, isWordSyncDisabledFrontmatter } from "./note-metadata";
import { buildLinkedWordHtml, buildManagedObsidianUrl } from "./note-output/obsidian-edit-link";
import type { ManagedFileRegistry } from "./managed-file-registry";
import type { PathScope } from "./path-scope";

export interface AliasSyncResult {
  hash: string | null;
  uploaded: boolean;
  skipped: boolean;
  aliasCount: number;
  normalizedAliases: string[];
  error?: string;
}

export interface AliasHashResult {
  hash: string | null;
  aliasCount: number;
  error?: string;
}

interface AliasSyncServiceOptions {
  app: App;
  pathScope: PathScope;
  managedFiles: ManagedFileRegistry;
  getAuthorizationToken: () => string;
}

interface SyncAliasesOptions {
  force?: boolean;
  wordLinkId?: string;
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function compareAliasNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function buildAliasRedirectNoteHtml(app: App, pathScope: PathScope, file: TFile, mainWord: string, wordLinkId: string): string {
  const href = buildManagedObsidianUrl(app, pathScope, file, wordLinkId);
  return `See main entry: ${buildLinkedWordHtml(mainWord, href)}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class AliasSyncService {
  private readonly apiClient: EudicApiClient;

  constructor(private readonly options: AliasSyncServiceOptions) {
    this.apiClient = new EudicApiClient(options.getAuthorizationToken);
  }

  async syncAliasesForWord(
    file: TFile,
    language: string,
    storedAliasHash: string | null,
    options: SyncAliasesOptions = {},
  ): Promise<AliasSyncResult> {
    const frontmatter = getFrontmatter(this.options.app, file);
    const mainWord = getConfiguredWord(frontmatter, file);
    const normalizedAliases = getNormalizedAliases(frontmatter, file);
    if (normalizedAliases.length === 0) {
      return {
        hash: null,
        uploaded: false,
        skipped: storedAliasHash === null,
        aliasCount: 0,
        normalizedAliases,
      };
    }

    const conflict = this.findConflict(file, normalizedAliases);
    if (conflict) {
      return {
        hash: null,
        uploaded: false,
        skipped: false,
        aliasCount: normalizedAliases.length,
        normalizedAliases,
        error: conflict,
      };
    }

    if (!options.wordLinkId) {
      return {
        hash: null,
        uploaded: false,
        skipped: false,
        aliasCount: normalizedAliases.length,
        normalizedAliases,
        error: `Missing '${FRONTMATTER_KEYS.eudicLinkId}' for ${file.path}.`,
      };
    }

    const noteHtml = buildAliasRedirectNoteHtml(
      this.options.app,
      this.options.pathScope,
      file,
      mainWord,
      options.wordLinkId,
    );
    const currentHash = await sha256Hex(this.buildAliasBundleHashInput(language, normalizedAliases, noteHtml));
    if (!options.force && storedAliasHash === currentHash) {
      return {
        hash: currentHash,
        uploaded: false,
        skipped: true,
        aliasCount: normalizedAliases.length,
        normalizedAliases,
      };
    }

    try {
      for (const alias of normalizedAliases) {
        await this.apiClient.overwriteNotePreservingAttachments({
          word: alias,
          language,
          note: noteHtml,
        });
      }
    } catch (error) {
      return {
        hash: null,
        uploaded: false,
        skipped: false,
        aliasCount: normalizedAliases.length,
        normalizedAliases,
        error: toErrorMessage(error),
      };
    }

    return {
      hash: currentHash,
      uploaded: true,
      skipped: false,
      aliasCount: normalizedAliases.length,
      normalizedAliases,
    };
  }

  async getCurrentAliasHash(file: TFile, language: string, wordLinkId: string): Promise<AliasHashResult> {
    const frontmatter = getFrontmatter(this.options.app, file);
    const mainWord = getConfiguredWord(frontmatter, file);
    const normalizedAliases = getNormalizedAliases(frontmatter, file);
    if (normalizedAliases.length === 0) {
      return {
        hash: null,
        aliasCount: 0,
      };
    }

    const conflict = this.findConflict(file, normalizedAliases);
    if (conflict) {
      return {
        hash: null,
        aliasCount: normalizedAliases.length,
        error: conflict,
      };
    }

    const noteHtml = buildAliasRedirectNoteHtml(
      this.options.app,
      this.options.pathScope,
      file,
      mainWord,
      wordLinkId,
    );

    return {
      hash: await sha256Hex(this.buildAliasBundleHashInput(language, normalizedAliases, noteHtml)),
      aliasCount: normalizedAliases.length,
    };
  }

  private buildAliasBundleHashInput(language: string, aliases: string[], noteHtml: string): string {
    const sortedAliases = [...aliases].sort(compareAliasNames);
    return JSON.stringify({
      language,
      aliases: sortedAliases,
      note: noteHtml,
    });
  }

  private findConflict(currentFile: TFile, aliases: string[]): string | null {
    const currentPath = normalizePath(currentFile.path);
    const normalizedAliases = aliases.map((alias) => ({
      original: alias,
      key: normalizeKey(alias),
    }));

    for (const file of this.options.managedFiles.getWordFiles()) {
      const frontmatter = getFrontmatter(this.options.app, file);
      if (isWordSyncDisabledFrontmatter(frontmatter)) {
        continue;
      }

      const filePath = normalizePath(file.path);
      const fileMainWord = getConfiguredWord(frontmatter, file);
      const fileMainWordKey = normalizeKey(fileMainWord);

      if (filePath === currentPath) {
        continue;
      }

      const primaryConflict = normalizedAliases.find((alias) => alias.key === fileMainWordKey);
      if (primaryConflict) {
        return `Alias "${primaryConflict.original}" conflicts with enabled main entry "${fileMainWord}" in ${file.path}.`;
      }

      for (const fileAlias of getNormalizedAliases(frontmatter, file)) {
        const aliasConflict = normalizedAliases.find((alias) => alias.key === normalizeKey(fileAlias));
        if (!aliasConflict) {
          continue;
        }

        return `Alias "${aliasConflict.original}" is already claimed by enabled word note ${file.path}.`;
      }
    }

    return null;
  }
}
