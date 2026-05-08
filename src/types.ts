import type { TFile } from "obsidian";

export type EudicSyncStatus = "dirty" | "synced";
export type EudicNoteOutputMode = "minimal" | "compatible";
export type ScopedPathKind = "word" | "reference" | "other";
export type EudicLinkKind = "word" | "reference";
export type EudicStudylistSource = "eudic" | "obsidian";
export type ReferenceMetadataWriteMode = "auto" | "manual" | "off";

export interface EudicStudylistCategory {
  id: string;
  language: string;
  name: string;
}

export interface EudicStudylistCache {
  categories: EudicStudylistCategory[];
  refreshedAt: string | null;
}

export interface EudicSyncSettings {
  wordFolder: string;
  referenceFolder: string;
  authorizationToken: string;
  studylistCache: EudicStudylistCache;
  noteOutputMode: EudicNoteOutputMode;
  noteOutputFormatVersion: number;
  enableAutoBoldMarkersOnEdit: boolean;
  boldMarkers: string[];
  enableSemanticBlockWordBold: boolean;
  semanticBlockWordBoldKinds: string[];
  enableSemanticBlockMarkerBold: boolean;
  enableSemanticBlockWordLinks: boolean;
  semanticBlockWordLinkKinds: string[];
  semanticBlockKindPresets: string[];
  enableAutoExtractPendingReferencesOnSave: boolean;
  enableAutoSyncWordOnLeave: boolean;
  referenceMetadataWriteMode: ReferenceMetadataWriteMode;
  enableHeaderSyncButton: boolean;
  enableStatusBarSyncButton: boolean;
}

export interface WordNoteContext {
  file: TFile;
  word: string;
  lang: string | null;
  storedStatus: string | null;
  bodyStatus: EudicSyncStatus;
  studylistStatus: EudicSyncStatus;
  effectiveStatus: EudicSyncStatus;
  lastSyncedHash: string | null;
  syncedAt: string | null;
  lastError: string | null;
}

export interface SyncWordResult {
  file: TFile;
  word: string;
  status: EudicSyncStatus;
  uploaded: boolean;
  skipped: boolean;
  aliasCount: number;
  aliasUploaded: number;
  aliasSkipped: boolean;
  aliasError?: string;
  error?: string;
}

export interface SyncBatchResult {
  total: number;
  uploaded: number;
  skipped: number;
  failed: number;
  aliasUploaded: number;
  results: SyncWordResult[];
}

export interface ResyncAliasesResult {
  file: TFile;
  word: string;
  status: EudicSyncStatus;
  aliasCount: number;
  aliasUploaded: number;
  aliasSkipped: boolean;
  noAliases: boolean;
  error?: string;
}

export interface EudicNotePayload {
  word: string;
  language: string;
  note: string;
}

export interface EudicNoteQuery {
  word: string;
  language: string;
}

export interface EudicRemoteNote {
  word: string;
  language: string;
  note: string | null;
  add_time?: string;
}

export interface DeleteEudicNotePayload {
  word: string;
  language: string;
}

export interface EudicStudylistWordsPayload {
  language: string;
  category_id: string;
  words: string[];
}

export interface EudicStudylistWordQuery {
  word: string;
  language: string;
}

export interface EudicStudylistWordInfo {
  word: string;
  language?: string;
  category_ids: string[];
  add_time?: string;
  star?: number;
  context_line?: string;
  exp?: string;
}

export interface DeleteEudicNoteResult {
  word: string;
  language: string;
  matchedMainFiles: TFile[];
  matchedAliasOwnerFiles: TFile[];
}

export interface StudylistPushWordResult {
  file: TFile;
  word: string;
  language: string;
  added: number;
  removed: number;
  changed: boolean;
  error?: string;
}

export interface StudylistPushSummary {
  total: number;
  succeeded: number;
  failed: number;
  added: number;
  removed: number;
  results: StudylistPushWordResult[];
}

export interface StudylistRefreshSummary {
  categories: number;
  words: number;
  updatedWords: number;
  updatedFiles: TFile[];
}

export interface StudylistPullWordResult {
  file: TFile;
  word: string;
  language: string;
  ids: string[];
  names: string[];
  updated: boolean;
  wasDirty: boolean;
}

export type FrontmatterMutator = (frontmatter: Record<string, unknown>) => void;
