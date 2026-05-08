import type { EudicStudylistCache, EudicStudylistCategory } from "./types";

interface StudylistCatalogResolverOptions {
  getCache: () => EudicStudylistCache;
  setCache: (cache: EudicStudylistCache) => Promise<void>;
  fetchCategories: (language: string) => Promise<EudicStudylistCategory[]>;
}

export interface StudylistResolvedNames {
  ids: string[];
  names: string[];
  unknownNames: string[];
  refreshed: boolean;
}

export type StudylistAssignmentPreferredSource = "names" | "ids";

export interface StudylistAssignmentInput {
  ids: string[];
  names: string[];
  preferredSource?: StudylistAssignmentPreferredSource;
}

export interface StudylistResolvedIds {
  ids: string[];
  names: string[];
  unknownIds: string[];
  refreshed: boolean;
}

export interface StudylistResolvedAssignment {
  ids: string[];
  names: string[];
  unknownNames: string[];
  unknownIds: string[];
  refreshed: boolean;
  preferredSource: StudylistAssignmentPreferredSource;
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

function normalizeLanguage(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeCategoryName(value: string): string {
  return value.trim().toLocaleLowerCase();
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

export function updateStudylistCacheForLanguage(
  cache: EudicStudylistCache,
  language: string,
  categories: EudicStudylistCategory[],
): EudicStudylistCache {
  const normalizedLanguage = normalizeLanguage(language);
  const categoriesForOtherLanguages = cache.categories.filter(
    (category) => normalizeLanguage(category.language) !== normalizedLanguage,
  );

  return {
    categories: [...categoriesForOtherLanguages, ...categories].sort((left, right) => {
      const leftLanguage = normalizeLanguage(left.language);
      const rightLanguage = normalizeLanguage(right.language);
      if (leftLanguage !== rightLanguage) {
        return leftLanguage.localeCompare(rightLanguage);
      }
      return left.name.localeCompare(right.name);
    }),
    refreshedAt: nowLocalIsoString(),
  };
}

export class StudylistCatalogResolver {
  constructor(private readonly options: StudylistCatalogResolverOptions) {}

  async refreshLanguage(language: string): Promise<EudicStudylistCache> {
    const categories = await this.options.fetchCategories(language);
    const nextCache = updateStudylistCacheForLanguage(this.options.getCache(), language, categories);
    await this.options.setCache(nextCache);
    return nextCache;
  }

  async resolveIdsFromNames(language: string, names: string[], refreshOnUnknown = true): Promise<StudylistResolvedNames> {
    const resolved = this.resolveIdsFromNamesUsingCache(language, names, this.options.getCache(), false);
    if (resolved.unknownNames.length === 0 || !refreshOnUnknown) {
      return resolved;
    }

    const refreshedCache = await this.refreshLanguage(language);
    return this.resolveIdsFromNamesUsingCache(language, names, refreshedCache, true);
  }

  async resolveAssignment(
    language: string,
    input: StudylistAssignmentInput,
    options: { refreshOnUnknown?: boolean } = {},
  ): Promise<StudylistResolvedAssignment> {
    const ids = uniqueNormalized(input.ids);
    const names = uniqueNormalized(input.names);
    const preferredSource = input.preferredSource ?? (names.length > 0 ? "names" : "ids");
    const refreshOnUnknown = options.refreshOnUnknown ?? true;

    if (preferredSource === "names") {
      const resolved = await this.resolveIdsFromNames(language, names, refreshOnUnknown);
      return {
        ids: resolved.unknownNames.length === 0 ? resolved.ids : ids,
        names: resolved.names,
        unknownNames: resolved.unknownNames,
        unknownIds: [],
        refreshed: resolved.refreshed,
        preferredSource: "names",
      };
    }

    const resolved = await this.resolveNamesFromIds(language, ids, refreshOnUnknown);
    return {
      ids: resolved.ids,
      names: resolved.unknownIds.length === 0 ? resolved.names : names.length > 0 ? names : resolved.names,
      unknownNames: [],
      unknownIds: resolved.unknownIds,
      refreshed: resolved.refreshed,
      preferredSource: "ids",
    };
  }

  async getNamesForIds(language: string, ids: string[], refreshMissingIds = false): Promise<string[]> {
    return (await this.resolveNamesFromIds(language, ids, refreshMissingIds)).names;
  }

  getNamesForIdsFromCache(language: string, ids: string[], cache = this.options.getCache()): string[] {
    return this.getNamesForIdsUsingCache(language, uniqueNormalized(ids), cache);
  }

  private async resolveNamesFromIds(language: string, ids: string[], refreshMissingIds: boolean): Promise<StudylistResolvedIds> {
    const resolved = this.resolveNamesFromIdsUsingCache(language, ids, this.options.getCache(), false);
    if (resolved.unknownIds.length === 0 || !refreshMissingIds) {
      return resolved;
    }

    const refreshedCache = await this.refreshLanguage(language);
    return this.resolveNamesFromIdsUsingCache(language, ids, refreshedCache, true);
  }

  private resolveIdsFromNamesUsingCache(
    language: string,
    names: string[],
    cache: EudicStudylistCache,
    refreshed: boolean,
  ): StudylistResolvedNames {
    const categories = this.getCategoriesForLanguage(language, cache);
    const categoriesByName = new Map(categories.map((category) => [normalizeCategoryName(category.name), category]));
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const ids: string[] = [];
    const unknownNames: string[] = [];

    for (const name of uniqueNormalized(names)) {
      const idMatch = categoriesById.get(name);
      if (idMatch) {
        ids.push(idMatch.id);
        continue;
      }

      const nameMatch = categoriesByName.get(normalizeCategoryName(name));
      if (nameMatch) {
        ids.push(nameMatch.id);
        continue;
      }

      unknownNames.push(name);
    }

    const normalizedIds = uniqueNormalized(ids);
    return {
      ids: normalizedIds,
      names: unknownNames.length === 0 ? this.getNamesForIdsUsingCache(language, normalizedIds, cache) : uniqueNormalized(names),
      unknownNames,
      refreshed,
    };
  }

  private resolveNamesFromIdsUsingCache(
    language: string,
    ids: string[],
    cache: EudicStudylistCache,
    refreshed: boolean,
  ): StudylistResolvedIds {
    const normalizedIds = uniqueNormalized(ids);
    const categoriesById = new Map(this.getCategoriesForLanguage(language, cache).map((category) => [category.id, category.name]));
    const names: string[] = [];
    const unknownIds: string[] = [];

    for (const id of normalizedIds) {
      const name = categoriesById.get(id);
      if (name) {
        names.push(name);
      } else {
        unknownIds.push(id);
        names.push(id);
      }
    }

    return {
      ids: normalizedIds,
      names,
      unknownIds,
      refreshed,
    };
  }

  private getNamesForIdsUsingCache(language: string, ids: string[], cache: EudicStudylistCache): string[] {
    const categoriesById = new Map(this.getCategoriesForLanguage(language, cache).map((category) => [category.id, category.name]));
    return ids.map((id) => categoriesById.get(id) ?? id);
  }

  private getCategoriesForLanguage(language: string, cache: EudicStudylistCache): EudicStudylistCategory[] {
    const normalizedLanguage = normalizeLanguage(language);
    return cache.categories.filter((category) => normalizeLanguage(category.language) === normalizedLanguage);
  }
}
