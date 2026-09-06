import type { EudicStudylistCategory } from "./types";

export interface StudylistSelectionItem {
  key: string;
  category: EudicStudylistCategory;
  selected: boolean;
  available: boolean;
}

export interface StudylistSelectionGroup {
  key: string;
  label: string;
  unavailable: boolean;
  items: StudylistSelectionItem[];
}

export function getStudylistCategoryKey(category: EudicStudylistCategory): string {
  return `${category.language.trim().toLocaleLowerCase()}\u0000${category.id.trim()}`;
}

function matchesQuery(category: EudicStudylistCategory, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [category.name, category.language, category.id]
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

function compareItems(left: StudylistSelectionItem, right: StudylistSelectionItem): number {
  if (left.selected !== right.selected) {
    return left.selected ? -1 : 1;
  }
  return left.category.name.localeCompare(right.category.name);
}

export function buildStudylistSelectionGroups(
  cached: EudicStudylistCategory[],
  selected: EudicStudylistCategory[],
  query: string,
): StudylistSelectionGroup[] {
  const selectedKeys = new Set(selected.map(getStudylistCategoryKey));
  const cachedKeys = new Set(cached.map(getStudylistCategoryKey));
  const availableGroups = new Map<string, StudylistSelectionItem[]>();

  for (const category of cached) {
    if (!matchesQuery(category, query)) {
      continue;
    }
    const language = category.language.trim().toLocaleLowerCase();
    const items = availableGroups.get(language) ?? [];
    items.push({
      key: getStudylistCategoryKey(category),
      category: { ...category },
      selected: selectedKeys.has(getStudylistCategoryKey(category)),
      available: true,
    });
    availableGroups.set(language, items);
  }

  const groups = Array.from(availableGroups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([language, items]) => ({
      key: `language:${language}`,
      label: language,
      unavailable: false,
      items: items.sort(compareItems),
    }));

  const unavailableItems = selected
    .filter((category) => !cachedKeys.has(getStudylistCategoryKey(category)) && matchesQuery(category, query))
    .map((category) => ({
      key: getStudylistCategoryKey(category),
      category: { ...category },
      selected: true,
      available: false,
    }))
    .sort(compareItems);

  if (unavailableItems.length > 0) {
    groups.push({
      key: "unavailable",
      label: "Unavailable in Eudic",
      unavailable: true,
      items: unavailableItems,
    });
  }

  return groups;
}

export function getStudylistSelectionSummary(selected: EudicStudylistCategory[]): string {
  if (selected.length === 0) {
    return "None selected";
  }

  const visibleNames = selected.slice(0, 2).map((category) => category.name);
  const remaining = selected.length - visibleNames.length;
  return `${selected.length} selected: ${visibleNames.join(", ")}${remaining > 0 ? ` +${remaining} more` : ""}`;
}

