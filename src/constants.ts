import type { EudicSyncSettings, EudicSyncStatus } from "./types";

export const PLUGIN_ID = "eudic-sync";
export const PLUGIN_NAME = "Eudic Sync";
export const SUPPRESSED_WRITE_TTL_MS = 1500;
export const EUDIC_NOTE_API_URL = "https://api.frdic.com/api/open/v1/studylist/note";
export const EUDIC_STUDYLIST_CATEGORY_API_URL = "https://api.frdic.com/api/open/v1/studylist/category";
export const EUDIC_STUDYLIST_WORDS_API_URL = "https://api.frdic.com/api/open/v1/studylist/words";
export const EUDIC_STUDYLIST_WORD_API_URL = "https://api.frdic.com/api/open/v1/studylist/word";
export const NOTE_OUTPUT_FORMAT_VERSION = 7;
export const DEFAULT_SEMANTIC_BLOCK_WORD_BOLD_KINDS = ["n.", "v.", "a.", "adj.", "adv.", "vt.", "vi."] as const;
export const DEFAULT_SEMANTIC_BLOCK_WORD_LINK_KINDS = ["Cog.", "Syn.", "Syn./Cog.", "Ant."] as const;
export const DEFAULT_SEMANTIC_BLOCK_KIND_PRESETS = [
  "n.",
  "v.",
  "a.",
  "adj.",
  "adv.",
  "vt.",
  "vi.",
  "Cog.",
  "Syn.",
  "Syn./Cog.",
  "Ant.",
  "P.S.",
] as const;

export const SYNC_STATUSES = new Set<EudicSyncStatus>([
  "dirty",
  "synced",
]);

export const DEFAULT_SETTINGS: EudicSyncSettings = {
  wordFolder: "Eudic/Words",
  referenceFolder: "Eudic/References",
  authorizationToken: "",
  studylistCache: {
    categories: [],
    refreshedAt: null,
  },
  noteOutputMode: "minimal",
  noteOutputFormatVersion: NOTE_OUTPUT_FORMAT_VERSION,
  enableAutoBoldMarkersOnEdit: false,
  boldMarkers: ["n.", "e.g.", "Syn.", "Cog.", "P.S."],
  enableSemanticBlockWordBold: false,
  semanticBlockWordBoldKinds: [...DEFAULT_SEMANTIC_BLOCK_WORD_BOLD_KINDS],
  enableSemanticBlockMarkerBold: false,
  enableSemanticBlockWordLinks: false,
  semanticBlockWordLinkKinds: [...DEFAULT_SEMANTIC_BLOCK_WORD_LINK_KINDS],
  semanticBlockKindPresets: [...DEFAULT_SEMANTIC_BLOCK_KIND_PRESETS],
  enableAutoExtractPendingReferencesOnSave: false,
  enableAutoSyncWordOnLeave: false,
  referenceMetadataWriteMode: "auto",
  enableHeaderSyncButton: true,
  enableStatusBarSyncButton: true,
};

export const FRONTMATTER_KEYS = {
  word: "word",
  lang: "lang",
  aliases: "aliases",
  eudicUrl: "eudic_url",
  eudicLinkId: "eudic_link_id",
  syncEudicEnabled: "sync_eudic_enabled",
  eudicSync: "eudic_sync",
  syncStatus: "sync_status",
  syncedAt: "synced_at",
  lastSyncedHash: "last_synced_hash",
  lastSyncedAliasesHash: "last_synced_aliases_hash",
  lastError: "last_error",
  studylistIds: "eudic_studylist_ids",
  studylistNames: "eudic_studylist_names",
  studylistSyncStatus: "studylist_sync_status",
  studylistSyncedAt: "eudic_studylist_synced_at",
  studylistLastError: "eudic_studylist_last_error",
  referencePaths: "reference_paths",
  legacyReferenceRefs: "example_refs",
  refCount: "ref_count",
  referencedBy: "referenced_by",
  referencedByLinks: "referenced_by_links",
  usageUpdatedAt: "usage_updated_at",
} as const;
