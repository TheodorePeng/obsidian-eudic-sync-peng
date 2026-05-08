import type { PathScope } from "./path-scope";

export interface StoredWordReferenceUsage {
  wordPath: string;
  storedRefs: string[];
  textRefs?: string[];
  syncDisabled?: boolean;
}

export interface ReferenceUsageSources {
  indexedWordPaths?: Iterable<string>;
  referencedByPaths?: Iterable<string>;
  wordReferenceRefs?: Iterable<StoredWordReferenceUsage>;
  mode?: "render" | "write";
}

export interface ReferenceUsageSnapshot {
  referencePath: string;
  wordPaths: string[];
  refCount: number;
}

function normalizeUsagePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function stripMarkdownExtension(path: string): string {
  return normalizeUsagePath(path).replace(/\.md$/i, "");
}

function basename(path: string): string {
  const segments = stripMarkdownExtension(path).split("/");
  return segments[segments.length - 1] ?? "";
}

function sortedUniquePaths(paths: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(paths).map(normalizeUsagePath).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
}

export function storedReferenceRefMatchesPath(
  pathScope: PathScope,
  storedRef: string,
  referencePath: string,
): boolean {
  const referenceStem = stripMarkdownExtension(referencePath);
  const resolvedStem = pathScope.resolveStoredReferenceStemToVaultPath(storedRef);
  if (resolvedStem && stripMarkdownExtension(resolvedStem) === referenceStem) {
    return true;
  }

  const storedStem = stripMarkdownExtension(storedRef);
  if (!storedStem.includes("/") && basename(storedStem) === basename(referenceStem)) {
    return true;
  }

  return storedStem === referenceStem;
}

export function wordReferenceRefsMatchReference(
  pathScope: PathScope,
  storedRefs: string[],
  referencePath: string,
): boolean {
  return storedRefs.some((storedRef) => storedReferenceRefMatchesPath(pathScope, storedRef, referencePath));
}

export function collectReferenceUsageWordPaths(
  pathScope: PathScope,
  referencePath: string,
  sources: ReferenceUsageSources,
): string[] {
  return new ReferenceUsageResolver(pathScope).collectWordPaths(referencePath, sources);
}

export class ReferenceUsageResolver {
  constructor(private readonly pathScope: PathScope) {}

  collectWordPaths(referencePath: string, sources: ReferenceUsageSources): string[] {
    const wordPaths = new Set<string>();
    const mode = sources.mode ?? "write";

    for (const wordPath of sources.indexedWordPaths ?? []) {
      wordPaths.add(normalizeUsagePath(wordPath));
    }

    if (mode === "render") {
      for (const wordPath of sources.referencedByPaths ?? []) {
        wordPaths.add(normalizeUsagePath(wordPath));
      }
    }

    for (const usage of sources.wordReferenceRefs ?? []) {
      if (usage.syncDisabled) {
        continue;
      }

      if (
        wordReferenceRefsMatchReference(this.pathScope, usage.storedRefs, referencePath) ||
        wordReferenceRefsMatchReference(this.pathScope, usage.textRefs ?? [], referencePath)
      ) {
        wordPaths.add(normalizeUsagePath(usage.wordPath));
      }
    }

    return sortedUniquePaths(wordPaths);
  }

  buildSnapshot(referencePath: string, sources: ReferenceUsageSources): ReferenceUsageSnapshot {
    const wordPaths = this.collectWordPaths(referencePath, sources);
    return {
      referencePath: normalizeUsagePath(referencePath),
      wordPaths,
      refCount: wordPaths.length,
    };
  }
}
