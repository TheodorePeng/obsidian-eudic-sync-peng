import { normalizePath } from "obsidian";
import type { EudicSyncSettings, ScopedPathKind } from "./types";

function normalizeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = normalizePath(trimmed);
  return normalized.replace(/^\/+|\/+$/g, "");
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.md$/i, "");
}

function matchesPrefix(path: string, folderPath: string): boolean {
  return path === folderPath || path.startsWith(`${folderPath}/`);
}

function splitSegments(path: string): string[] {
  return normalizeSegment(path)
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export class PathScope {
  private settings: EudicSyncSettings;

  constructor(settings: EudicSyncSettings) {
    this.settings = settings;
  }

  updateSettings(settings: EudicSyncSettings): void {
    this.settings = settings;
  }

  normalizeVaultPath(path: string): string {
    return normalizePath(path);
  }

  getWordFolderPath(): string {
    return normalizeSegment(this.settings.wordFolder);
  }

  getReferenceFolderPath(): string {
    return normalizeSegment(this.settings.referenceFolder);
  }

  getReferenceFolderName(): string {
    const segments = splitSegments(this.getReferenceFolderPath());
    return segments[segments.length - 1] ?? "";
  }

  getReferenceFolderParentPath(): string {
    const segments = splitSegments(this.getReferenceFolderPath());
    if (segments.length <= 1) {
      return "";
    }

    return segments.slice(0, -1).join("/");
  }

  getPrimaryReferenceFolderPath(): string | null {
    const referenceFolderPath = this.getReferenceFolderPath();
    return referenceFolderPath || null;
  }

  toStoredReferenceMarkdownStem(path: string): string | null {
    const normalizedPath = stripMarkdownExtension(this.normalizeVaultPath(path));
    const referenceFolderPath = this.getReferenceFolderPath();
    if (!referenceFolderPath || !matchesPrefix(normalizedPath, referenceFolderPath)) {
      return null;
    }

    const parentPath = this.getReferenceFolderParentPath();
    if (!parentPath) {
      return normalizedPath;
    }

    if (!normalizedPath.startsWith(`${parentPath}/`)) {
      return null;
    }

    return normalizedPath.slice(parentPath.length + 1);
  }

  normalizeStoredReferenceStem(storedRef: string): string {
    const normalizedStoredRef = normalizeSegment(stripMarkdownExtension(storedRef));
    if (!normalizedStoredRef) {
      return "";
    }

    const referenceFolderName = this.getReferenceFolderName();
    if (!referenceFolderName) {
      return normalizedStoredRef;
    }

    if (normalizedStoredRef === "Examples") {
      return referenceFolderName;
    }

    if (normalizedStoredRef.startsWith("Examples/")) {
      return `${referenceFolderName}/${normalizedStoredRef.slice("Examples/".length)}`;
    }

    return normalizedStoredRef;
  }

  resolveStoredReferenceStemToVaultPath(storedRef: string): string | null {
    const normalizedStoredRef = this.normalizeStoredReferenceStem(storedRef);
    if (!normalizedStoredRef) {
      return null;
    }

    const parentPath = this.getReferenceFolderParentPath();
    const candidatePath = parentPath ? normalizePath(`${parentPath}/${normalizedStoredRef}`) : normalizedStoredRef;
    const referenceFolderPath = this.getReferenceFolderPath();
    if (!referenceFolderPath || !matchesPrefix(candidatePath, referenceFolderPath)) {
      return null;
    }

    return candidatePath;
  }

  classifyPath(path: string): ScopedPathKind {
    const normalizedPath = this.normalizeVaultPath(path);

    const wordFolderPath = this.getWordFolderPath();
    if (wordFolderPath && matchesPrefix(normalizedPath, wordFolderPath)) {
      return "word";
    }

    const referenceFolderPath = this.getReferenceFolderPath();
    if (referenceFolderPath && matchesPrefix(normalizedPath, referenceFolderPath)) {
      return "reference";
    }

    return "other";
  }

  isWordPath(path: string): boolean {
    return this.classifyPath(path) === "word";
  }

  isReferencePath(path: string): boolean {
    return this.classifyPath(path) === "reference";
  }
}
