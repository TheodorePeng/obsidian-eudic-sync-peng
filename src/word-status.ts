import type { TFile } from "obsidian";
import type { EudicSyncStatus, WordNoteContext } from "./types";

export interface WordStatusOverride {
  bodyStatus?: EudicSyncStatus;
  studylistStatus?: EudicSyncStatus;
  bodyError?: string | null;
  studylistError?: string | null;
}

export function getEffectiveWordStatus(
  bodyStatus: EudicSyncStatus,
  studylistStatus: EudicSyncStatus,
): EudicSyncStatus {
  return bodyStatus === "dirty" || studylistStatus === "dirty" ? "dirty" : "synced";
}

export function getStatusIcon(status: EudicSyncStatus): string {
  switch (status) {
    case "dirty":
      return "cloud-alert";
    case "synced":
      return "cloud-check";
  }
}

function normalizeOverridePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function applyWordStatusOverride(context: WordNoteContext, override: WordStatusOverride): WordNoteContext {
  const bodyStatus = override.bodyStatus ?? context.bodyStatus;
  const studylistStatus = override.studylistStatus ?? context.studylistStatus;
  return {
    ...context,
    bodyStatus,
    studylistStatus,
    effectiveStatus: getEffectiveWordStatus(bodyStatus, studylistStatus),
    lastError: override.bodyError ?? override.studylistError ?? context.lastError,
  };
}

function hasOverrideValue(override: WordStatusOverride): boolean {
  return (
    override.bodyStatus !== undefined ||
    override.studylistStatus !== undefined ||
    override.bodyError !== undefined ||
    override.studylistError !== undefined
  );
}

export class WordStatusOverrideStore {
  private readonly overrides = new Map<string, WordStatusOverride>();

  setBody(file: TFile, status: EudicSyncStatus, lastError: string | null): void {
    const path = normalizeOverridePath(file.path);
    const override = this.overrides.get(path) ?? {};
    override.bodyStatus = status;
    override.bodyError = lastError;
    this.overrides.set(path, override);
  }

  setStudylist(file: TFile, status: EudicSyncStatus, lastError: string | null): void {
    const path = normalizeOverridePath(file.path);
    const override = this.overrides.get(path) ?? {};
    override.studylistStatus = status;
    override.studylistError = lastError;
    this.overrides.set(path, override);
  }

  get(path: string): WordStatusOverride | null {
    return this.overrides.get(normalizeOverridePath(path)) ?? null;
  }

  clearBody(path: string): void {
    const normalizedPath = normalizeOverridePath(path);
    const override = this.overrides.get(normalizedPath);
    if (!override) {
      return;
    }

    delete override.bodyStatus;
    delete override.bodyError;
    if (hasOverrideValue(override)) {
      this.overrides.set(normalizedPath, override);
    } else {
      this.overrides.delete(normalizedPath);
    }
  }

  clearStudylist(path: string): void {
    const normalizedPath = normalizeOverridePath(path);
    const override = this.overrides.get(normalizedPath);
    if (!override) {
      return;
    }

    delete override.studylistStatus;
    delete override.studylistError;
    if (hasOverrideValue(override)) {
      this.overrides.set(normalizedPath, override);
    } else {
      this.overrides.delete(normalizedPath);
    }
  }

  clear(path: string): void {
    this.overrides.delete(normalizeOverridePath(path));
  }

  getDisplayContext(file: TFile, context: WordNoteContext | null): WordNoteContext | null {
    if (!context) {
      return null;
    }

    const override = this.overrides.get(normalizeOverridePath(file.path));
    return override ? applyWordStatusOverride(context, override) : context;
  }
}
