import type { App, ObsidianProtocolData, TFile } from "obsidian";
import { FRONTMATTER_KEYS } from "./constants";
import { getConfiguredWord, getFrontmatter, readNullableString } from "./note-metadata";
import type { PathScope } from "./path-scope";
import type { EudicLinkKind } from "./types";

export const EUDIC_PROTOCOL_ACTION = "eudic-sync";
export type ScopedFilesResolver = (kind: EudicLinkKind) => TFile[];

function normalizeLookupKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
}

function fallbackRandomUuid(): string {
  const randomHex = (): string => Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0");

  return [
    `${randomHex()}${randomHex()}`,
    randomHex(),
    randomHex(),
    randomHex(),
    `${randomHex()}${randomHex()}${randomHex()}`,
  ].join("-");
}

function encodeQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function dedupeFilesByPath(files: Iterable<TFile>): TFile[] {
  const filesByPath = new Map<string, TFile>();
  for (const file of files) {
    const normalizedPath = normalizePath(file.path);
    if (!filesByPath.has(normalizedPath)) {
      filesByPath.set(normalizedPath, file);
    }
  }

  return Array.from(filesByPath.values());
}

function getVaultScopedFiles(app: App, pathScope: PathScope, kind: EudicLinkKind): TFile[] {
  return app.vault
    .getMarkdownFiles()
    .filter((file) => (kind === "word" ? pathScope.isWordPath(file.path) : pathScope.isReferencePath(file.path)));
}

function getScopedFiles(
  app: App,
  pathScope: PathScope,
  kind: EudicLinkKind,
  scopedFiles?: ScopedFilesResolver,
): TFile[] {
  if (scopedFiles) {
    return dedupeFilesByPath([...scopedFiles(kind), ...getVaultScopedFiles(app, pathScope, kind)]);
  }

  return getVaultScopedFiles(app, pathScope, kind);
}

function resolveWordFileByDirectPath(app: App, pathScope: PathScope, word: string): TFile | null {
  const trimmedWord = word.trim().replace(/\.md$/i, "");
  if (!trimmedWord || /[\\/]/.test(trimmedWord)) {
    return null;
  }

  const wordFolderPath = pathScope.getWordFolderPath();
  if (!wordFolderPath) {
    return null;
  }

  const candidatePath = normalizePath(`${wordFolderPath}/${trimmedWord}.md`);
  if (!pathScope.isWordPath(candidatePath)) {
    return null;
  }

  const file = app.vault.getFileByPath(candidatePath);
  if (!file || file.extension !== "md") {
    return null;
  }

  return file;
}

export function createEudicLinkId(kind: EudicLinkKind): string {
  const prefix = kind === "word" ? "w" : "r";
  const uuid = globalThis.crypto?.randomUUID?.() ?? fallbackRandomUuid();
  return `${prefix}-${uuid}`;
}

export function readEudicLinkId(frontmatter: Record<string, unknown>): string | null {
  return readNullableString(frontmatter[FRONTMATTER_KEYS.eudicLinkId]);
}

export function getScopedLinkKind(pathScope: PathScope, path: string): EudicLinkKind | null {
  if (pathScope.isWordPath(path)) {
    return "word";
  }

  if (pathScope.isReferencePath(path)) {
    return "reference";
  }

  return null;
}

export function buildEudicProtocolUrl(
  app: App,
  kind: EudicLinkKind,
  id: string,
  fallbackName?: string,
): string {
  const params: Record<string, string> = {
    vault: app.vault.getName(),
    kind,
    id,
  };

  if (fallbackName) {
    params[kind === "word" ? "word" : "name"] = fallbackName;
  }

  return `obsidian://${EUDIC_PROTOCOL_ACTION}?${encodeQuery(params)}`;
}

export function findScopedFilesByLinkId(
  app: App,
  pathScope: PathScope,
  kind: EudicLinkKind,
  id: string,
  scopedFiles?: ScopedFilesResolver,
): TFile[] {
  return getScopedFiles(app, pathScope, kind, scopedFiles).filter((file) => {
    const frontmatter = getFrontmatter(app, file);
    return readEudicLinkId(frontmatter) === id;
  });
}

export function findScopedFilesByFallbackName(
  app: App,
  pathScope: PathScope,
  kind: EudicLinkKind,
  name: string,
  scopedFiles?: ScopedFilesResolver,
): TFile[] {
  const targetKey = normalizeLookupKey(name);
  if (!targetKey) {
    return [];
  }

  return getScopedFiles(app, pathScope, kind, scopedFiles).filter((file) => {
    const frontmatter = getFrontmatter(app, file);
    const candidate =
      kind === "word" ? getConfiguredWord(frontmatter, file) : normalizePath(file.path).split("/").pop() ?? file.basename;

    const candidateName = kind === "reference" ? candidate.replace(/\.md$/i, "") : candidate;
    return normalizeLookupKey(candidateName) === targetKey;
  });
}

export function assertUniqueScopedLinkId(
  app: App,
  pathScope: PathScope,
  file: TFile,
  id: string,
  scopedFiles?: ScopedFilesResolver,
): EudicLinkKind {
  const kind = getScopedLinkKind(pathScope, file.path);
  if (!kind) {
    throw new Error(`File is outside the managed Word/Reference folders: ${file.path}`);
  }

  const matches = findScopedFilesByLinkId(app, pathScope, kind, id, scopedFiles);
  if (matches.length > 1) {
    throw new Error(`Duplicate eudic_link_id "${id}" found in ${kind} folder.`);
  }

  if (matches.length === 1 && normalizePath(matches[0]!.path) !== normalizePath(file.path)) {
    throw new Error(`eudic_link_id "${id}" in ${file.path} points to a different ${kind} note.`);
  }

  return kind;
}

export function buildManagedFileProtocolUrl(
  app: App,
  pathScope: PathScope,
  file: TFile,
  linkId: string,
  scopedFiles?: ScopedFilesResolver,
): string {
  const kind = assertUniqueScopedLinkId(app, pathScope, file, linkId, scopedFiles);
  const frontmatter = getFrontmatter(app, file);
  const fallbackName = kind === "word" ? getConfiguredWord(frontmatter, file) : file.basename;
  return buildEudicProtocolUrl(app, kind, linkId, fallbackName);
}

export function resolveManagedFileFromProtocol(
  app: App,
  pathScope: PathScope,
  params: ObsidianProtocolData,
  scopedFiles?: ScopedFilesResolver,
): { file: TFile | null; error: string | null } {
  const requestedVault = readNullableString(params.vault);
  if (requestedVault && requestedVault !== app.vault.getName()) {
    return {
      file: null,
      error: `Vault mismatch: expected "${app.vault.getName()}", got "${requestedVault}".`,
    };
  }

  const kindParam = readNullableString(params.kind);
  if (kindParam !== "word" && kindParam !== "reference") {
    return {
      file: null,
      error: "Invalid or missing managed link kind.",
    };
  }

  const id = readNullableString(params.id);
  if (!id) {
    return {
      file: null,
      error: "Missing managed link id.",
    };
  }

  const matches = findScopedFilesByLinkId(app, pathScope, kindParam, id, scopedFiles);
  if (matches.length === 1) {
    return { file: matches[0]!, error: null };
  }

  if (matches.length > 1) {
    return {
      file: null,
      error: `Duplicate eudic_link_id "${id}" found in ${kindParam} folder.`,
    };
  }

  const fallbackName = kindParam === "word" ? readNullableString(params.word) : readNullableString(params.name);
  if (fallbackName) {
    const fallbackMatches = findScopedFilesByFallbackName(app, pathScope, kindParam, fallbackName, scopedFiles);
    if (fallbackMatches.length === 1) {
      return { file: fallbackMatches[0]!, error: null };
    }

    if (fallbackMatches.length > 1) {
      return {
        file: null,
        error: `Fallback lookup for "${fallbackName}" matched multiple ${kindParam} notes.`,
      };
    }

    if (kindParam === "word") {
      const directFile = resolveWordFileByDirectPath(app, pathScope, fallbackName);
      if (directFile) {
        return { file: directFile, error: null };
      }
    }
  }

  return {
    file: null,
    error: fallbackName
      ? `No ${kindParam} note found for eudic_link_id "${id}" or fallback name "${fallbackName}".`
      : `No ${kindParam} note found for eudic_link_id "${id}".`,
  };
}
