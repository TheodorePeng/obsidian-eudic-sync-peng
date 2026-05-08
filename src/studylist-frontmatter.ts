import type { EudicStudylistSource } from "./types";

export function readStudylistSource(
  value: unknown,
  fallback: EudicStudylistSource = "eudic",
): EudicStudylistSource {
  if (value === true) {
    return "obsidian";
  }

  if (value === false) {
    return "eudic";
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase();
    if (normalized === "eudic" || normalized === "false" || normalized === "no") {
      return "eudic";
    }
    if (normalized === "obsidian" || normalized === "true" || normalized === "yes") {
      return "obsidian";
    }
  }

  return fallback;
}

export function toStudylistSourcePropertyValue(source: EudicStudylistSource): boolean {
  return source === "obsidian";
}
