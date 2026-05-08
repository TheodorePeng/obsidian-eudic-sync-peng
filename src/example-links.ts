import type { App, TFile } from "obsidian";
import type { PathScope } from "./path-scope";
import { getWordReferenceRefs, stripYamlFrontmatter } from "./note-metadata";

const EMBED_PATTERN = /!\[\[([^[\]]+)\]\]/g;

export interface ExampleEmbedReference {
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

export function extractLinkpath(reference: string): string {
  const trimmed = reference.trim();
  const wikiMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
  const inner = wikiMatch ? wikiMatch[1] : trimmed;
  const beforeAlias = inner.split("|")[0]?.trim() ?? inner;
  const beforeSubpath = beforeAlias.split("#")[0]?.trim() ?? beforeAlias;
  return beforeSubpath;
}

function resolveManagedExamplePath(app: App, pathScope: PathScope, file: TFile, linkpath: string): string | null {
  if (!linkpath) {
    return null;
  }

  const destination = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
  if (destination?.extension === "md" && pathScope.isReferencePath(destination.path)) {
    return destination.path;
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

export function resolveManagedExamplePaths(app: App, pathScope: PathScope, file: TFile, markdown: string): string[] {
  const resolvedPaths: string[] = [];

  for (const { linkpath } of extractExampleEmbedReferences(markdown)) {
    const resolvedPath = resolveManagedExamplePath(app, pathScope, file, linkpath);
    if (!resolvedPath) {
      continue;
    }

    resolvedPaths.push(resolvedPath);
  }

  return uniquePreservingOrder(resolvedPaths);
}

export function extractExampleEmbedReferences(markdown: string): ExampleEmbedReference[] {
  const body = stripYamlFrontmatter(markdown);
  const refs: ExampleEmbedReference[] = [];

  for (const match of body.matchAll(EMBED_PATTERN)) {
    const rawTarget = match[1] ?? "";
    refs.push({
      rawTarget,
      linkpath: extractLinkpath(rawTarget),
    });
  }

  return refs;
}

export function toStoredExampleRef(pathScope: PathScope, examplePath: string): string | null {
  return pathScope.toStoredReferenceMarkdownStem(examplePath);
}

export function toStoredExampleRefs(pathScope: PathScope, examplePaths: string[]): string[] {
  const storedRefs: string[] = [];

  for (const examplePath of examplePaths) {
    const storedRef = toStoredExampleRef(pathScope, examplePath);
    if (!storedRef) {
      continue;
    }

    storedRefs.push(storedRef);
  }

  return uniquePreservingOrder(storedRefs);
}

export function getStoredExampleRefsRaw(app: App, file: TFile): string[] {
  return getWordReferenceRefs(app, file);
}

export function buildExampleAnchorName(stem: string): string {
  return `${stem}-main`;
}

export function buildExampleBlockAnchor(stem: string): string {
  return `^${buildExampleAnchorName(stem)}`;
}

export function buildExampleEmbed(storedRef: string): string {
  const stem = storedRef.split("/").pop() ?? storedRef;
  return `![[${storedRef}#${buildExampleBlockAnchor(stem)}]]`;
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
