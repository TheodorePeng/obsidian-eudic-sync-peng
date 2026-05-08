import type { App, TFile } from "obsidian";
import type { PathScope } from "./path-scope";
import { getWordReferenceRefs, stripYamlFrontmatter } from "./note-metadata";

const EMBED_PATTERN = /!\[\[([^[\]]+)\]\]/g;

export interface ReferenceEmbedReference {
  rawTarget: string;
  linkpath: string;
}

function uniquePreservingOrder(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    ordered.push(value);
  }

  return ordered;
}

function normalizeReferenceLinkPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function extractLinkpath(reference: string): string {
  const trimmed = reference.trim();
  const wikiMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
  const inner = wikiMatch ? wikiMatch[1] : trimmed;
  const beforeAlias = inner.split("|")[0]?.trim() ?? inner;
  const beforeSubpath = beforeAlias.split("#")[0]?.trim() ?? beforeAlias;
  return beforeSubpath;
}

export function resolveManagedReferencePath(
  app: App,
  pathScope: PathScope,
  sourcePath: string,
  linkpath: string,
): string | null {
  if (!linkpath) {
    return null;
  }

  const destination = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  if (destination?.extension === "md" && pathScope.isReferencePath(destination.path)) {
    return destination.path;
  }

  const normalizedStem = linkpath.replace(/\.md$/i, "").replace(/^\/+|\/+$/g, "");
  const referenceFolderPath = pathScope.getPrimaryReferenceFolderPath();
  if (referenceFolderPath && normalizedStem && !normalizedStem.includes("/")) {
    const basenameCandidate = normalizeReferenceLinkPath(`${referenceFolderPath}/${normalizedStem}.md`);
    const basenameCandidateFile = app.vault.getFileByPath(basenameCandidate);
    if (basenameCandidateFile?.extension === "md" && pathScope.isReferencePath(basenameCandidateFile.path)) {
      return basenameCandidateFile.path;
    }

    const basenameMatches = app.vault
      .getMarkdownFiles()
      .filter((file) => pathScope.isReferencePath(file.path) && file.basename === normalizedStem);
    if (basenameMatches.length === 1) {
      return basenameMatches[0]?.path ?? null;
    }
  }

  const fallbackStemPath = pathScope.resolveStoredReferenceStemToVaultPath(linkpath);
  if (!fallbackStemPath) {
    return null;
  }

  const fallbackFile = app.vault.getFileByPath(`${fallbackStemPath}.md`);
  if (!fallbackFile || !pathScope.isReferencePath(fallbackFile.path)) {
    return null;
  }

  return fallbackFile.path;
}

export function resolveManagedReferencePaths(app: App, pathScope: PathScope, file: TFile, markdown: string): string[] {
  const resolvedPaths: string[] = [];

  for (const { linkpath } of extractReferenceEmbedReferences(markdown)) {
    const resolvedPath = resolveManagedReferencePath(app, pathScope, file.path, linkpath);
    if (!resolvedPath) {
      continue;
    }

    resolvedPaths.push(resolvedPath);
  }

  return uniquePreservingOrder(resolvedPaths);
}

export function extractReferenceEmbedReferences(markdown: string): ReferenceEmbedReference[] {
  const body = stripYamlFrontmatter(markdown);
  const refs: ReferenceEmbedReference[] = [];

  for (const match of body.matchAll(EMBED_PATTERN)) {
    const rawTarget = match[1] ?? "";
    refs.push({
      rawTarget,
      linkpath: extractLinkpath(rawTarget),
    });
  }

  return refs;
}

export function toStoredReferenceRef(pathScope: PathScope, referencePath: string): string | null {
  return pathScope.toStoredReferenceMarkdownStem(referencePath);
}

export function toStoredReferenceRefs(pathScope: PathScope, referencePaths: string[]): string[] {
  const storedRefs: string[] = [];

  for (const referencePath of referencePaths) {
    const storedRef = toStoredReferenceRef(pathScope, referencePath);
    if (!storedRef) {
      continue;
    }

    storedRefs.push(storedRef);
  }

  return uniquePreservingOrder(storedRefs);
}

export function getStoredReferenceRefsRaw(app: App, file: TFile): string[] {
  return getWordReferenceRefs(app, file);
}

export function buildReferenceAnchorName(stem: string): string {
  return `${stem}-main`;
}

export function buildReferenceBlockAnchor(stem: string): string {
  return `^${buildReferenceAnchorName(stem)}`;
}

export function buildReferenceEmbed(storedRef: string): string {
  const stem = storedRef.split("/").pop() ?? storedRef;
  return `![[${storedRef}#${buildReferenceBlockAnchor(stem)}]]`;
}

export function stringArraysEqual(left: string[], right: string[]): boolean {
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
