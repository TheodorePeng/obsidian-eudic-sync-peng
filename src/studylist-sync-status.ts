import { FRONTMATTER_KEYS } from "./constants";
import type { EudicSyncStatus } from "./types";

export const LEGACY_STUDYLIST_DIRTY_KEY = "eudic_studylist_dirty";

export function readSyncStatusValue(value: unknown, fallback: EudicSyncStatus): EudicSyncStatus {
  return value === "dirty" || value === "synced" ? value : fallback;
}

export function readStudylistSyncStatus(frontmatter: Record<string, unknown>): EudicSyncStatus {
  const explicitStatus = readSyncStatusValue(frontmatter[FRONTMATTER_KEYS.studylistSyncStatus], "synced");
  if (frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] === "dirty" || frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] === "synced") {
    return explicitStatus;
  }

  return frontmatter[LEGACY_STUDYLIST_DIRTY_KEY] === true ? "dirty" : "synced";
}

export function normalizeStudylistSyncStatus(frontmatter: Record<string, unknown>): EudicSyncStatus {
  const status = readStudylistSyncStatus(frontmatter);
  frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = status;
  delete frontmatter[LEGACY_STUDYLIST_DIRTY_KEY];
  return status;
}

export function isStudylistSyncStatusNormalized(frontmatter: Record<string, unknown>): boolean {
  const status = frontmatter[FRONTMATTER_KEYS.studylistSyncStatus];
  return (status === "dirty" || status === "synced") && !(LEGACY_STUDYLIST_DIRTY_KEY in frontmatter);
}

export type StudylistSyncStateEvent = "local-change" | "push-success" | "push-failure" | "remote-pull" | "no-change";

export function getNextStudylistSyncStatus(
  currentStatus: EudicSyncStatus,
  event: StudylistSyncStateEvent,
): EudicSyncStatus {
  switch (event) {
    case "local-change":
    case "push-failure":
      return "dirty";
    case "push-success":
    case "remote-pull":
      return "synced";
    case "no-change":
      return currentStatus;
  }
}

export function shouldPushStudylistAssignment(status: EudicSyncStatus, lastError: string | null = null): boolean {
  return status === "dirty" && !lastError;
}

export function shouldSkipEmptySyncedStudylistAssignment(
  ids: string[],
  names: string[],
  status: EudicSyncStatus,
): boolean {
  return status === "synced" && ids.length === 0 && names.length === 0;
}
