import { PLUGIN_NAME } from "./constants";
import type {
  DeleteEudicNoteResult,
  ResyncAliasesResult,
  StudylistPushSummary,
  StudylistRefreshSummary,
  SyncWordResult,
} from "./types";

function getAliasNoticeSummary(aliasCount: number, aliasUploaded: number, aliasSkipped: boolean): string {
  if (aliasCount === 0) {
    return "";
  }

  if (aliasUploaded > 0) {
    return ` Aliases updated ${aliasUploaded}.`;
  }

  if (aliasSkipped) {
    return " Aliases unchanged.";
  }

  return "";
}

export function getSyncWordNoticeText(result: SyncWordResult): string {
  if (result.error) {
    return `${PLUGIN_NAME}: failed to sync "${result.word}": ${result.error ?? "Unknown error."}`;
  }

  const aliasSummary = getAliasNoticeSummary(result.aliasCount, result.aliasUploaded, result.aliasSkipped);
  if (result.skipped) {
    return `${PLUGIN_NAME}: "${result.word}" is already up to date.${aliasSummary}`;
  }

  return `${PLUGIN_NAME}: synced "${result.word}".${aliasSummary}`;
}

export function getResyncAliasesNoticeText(result: ResyncAliasesResult): string {
  if (result.error) {
    return `${PLUGIN_NAME}: failed to resync aliases for "${result.word}": ${result.error}`;
  }

  if (result.noAliases) {
    return `${PLUGIN_NAME}: "${result.word}" has no aliases to sync.`;
  }

  return `${PLUGIN_NAME}: resynced ${result.aliasUploaded} alias(es) for "${result.word}".`;
}

export function getDeleteNoteNoticeText(result: DeleteEudicNoteResult): string {
  const parts = [`${PLUGIN_NAME}: deleted the Eudic note for "${result.word}" (${result.language}).`];

  if (result.matchedMainFiles.length > 0) {
    parts.push(`Marked ${result.matchedMainFiles.length} local main word(s) dirty.`);
  }

  if (result.matchedAliasOwnerFiles.length > 0) {
    parts.push(`Marked ${result.matchedAliasOwnerFiles.length} alias owner word(s) dirty.`);
  }

  return parts.join(" ");
}

export function getStudylistRefreshNoticeText(result: StudylistRefreshSummary): string {
  return `${PLUGIN_NAME}: refreshed ${result.categories} Eudic studylist(s), scanned ${result.words} cloud word assignment(s), updated ${result.updatedWords} local word(s).`;
}

export function getStudylistPushNoticeText(result: StudylistPushSummary): string {
  return `${PLUGIN_NAME}: pushed ${result.succeeded}/${result.total} studylist assignment(s), added ${result.added}, removed ${result.removed}, failed ${result.failed}.`;
}
