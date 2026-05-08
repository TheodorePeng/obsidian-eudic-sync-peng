import type { App, TAbstractFile, TFile } from "obsidian";
import type { PathScope } from "./path-scope";

function normalizeRegistryPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return typeof (file as TFile).path === "string" && (file as TFile).extension === "md";
}

function sortFiles(files: Iterable<TFile>): TFile[] {
  return Array.from(files).sort((left, right) => left.path.localeCompare(right.path));
}

export class ManagedFileRegistry {
  private readonly filesByPath = new Map<string, TFile>();
  private readonly wordPaths = new Set<string>();
  private readonly referencePaths = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly pathScope: PathScope,
  ) {}

  rebuild(): void {
    this.filesByPath.clear();
    this.wordPaths.clear();
    this.referencePaths.clear();

    for (const file of this.app.vault.getMarkdownFiles()) {
      this.trackFile(file);
    }
  }

  update(file: TAbstractFile): void {
    this.remove(file.path);
    if (isMarkdownFile(file)) {
      this.trackFile(file);
    }
  }

  rename(file: TAbstractFile, oldPath: string): void {
    this.remove(oldPath);
    this.update(file);
  }

  remove(path: string): void {
    const normalizedPath = normalizeRegistryPath(path);
    this.filesByPath.delete(normalizedPath);
    this.wordPaths.delete(normalizedPath);
    this.referencePaths.delete(normalizedPath);
  }

  getFile(path: string): TFile | null {
    return this.filesByPath.get(normalizeRegistryPath(path)) ?? null;
  }

  getWordFiles(): TFile[] {
    return this.getFilesByPathSet(this.wordPaths);
  }

  getReferenceFiles(): TFile[] {
    return this.getFilesByPathSet(this.referencePaths);
  }

  getReferencePaths(): string[] {
    return Array.from(this.referencePaths).sort((left, right) => left.localeCompare(right));
  }

  private trackFile(file: TFile): void {
    const normalizedPath = normalizeRegistryPath(file.path);
    this.filesByPath.set(normalizedPath, file);

    if (this.pathScope.isWordPath(normalizedPath)) {
      this.wordPaths.add(normalizedPath);
      this.referencePaths.delete(normalizedPath);
      return;
    }

    if (this.pathScope.isReferencePath(normalizedPath)) {
      this.referencePaths.add(normalizedPath);
      this.wordPaths.delete(normalizedPath);
      return;
    }

    this.wordPaths.delete(normalizedPath);
    this.referencePaths.delete(normalizedPath);
  }

  private getFilesByPathSet(paths: Set<string>): TFile[] {
    return sortFiles(
      Array.from(paths)
        .map((path) => this.filesByPath.get(path))
        .filter((file): file is TFile => !!file),
    );
  }
}
