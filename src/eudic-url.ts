import type { TFile } from "obsidian";
import { FRONTMATTER_KEYS } from "./constants";
import { getConfiguredWord, readNullableString } from "./note-metadata";

const EUDIC_DICT_BASE_URL = "https://dict.eudic.net/dicts";

export function buildEudicQueryUrl(word: string, lang: string | null): string {
  const normalizedLang = lang?.trim() || "en";
  return `${EUDIC_DICT_BASE_URL}/${encodeURIComponent(normalizedLang)}/${encodeURIComponent(word)}`;
}

export function getExpectedEudicUrl(frontmatter: Record<string, unknown>, file: TFile): string {
  const word = getConfiguredWord(frontmatter, file);
  const lang = readNullableString(frontmatter[FRONTMATTER_KEYS.lang]) ?? "en";
  return buildEudicQueryUrl(word, lang);
}

export function shouldFillEudicUrlBeforeFirstSync(frontmatter: Record<string, unknown>): boolean {
  const currentUrl = readNullableString(frontmatter[FRONTMATTER_KEYS.eudicUrl]);
  if (!currentUrl) {
    return true;
  }

  if (readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedHash])) {
    return false;
  }

  return currentUrl === buildEudicQueryUrl("Untitled", "en");
}
