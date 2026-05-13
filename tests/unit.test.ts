import assert from "node:assert/strict";
import {
  EMPTY_EUDIC_BLOCK_OPENING_LINE,
  buildEmptyEudicBlockInsertion,
  extractLeadingPresetKindFromList,
  normalizeEudicBlockKindsFromBody,
  transformEudicBlocksToMarkdown,
} from "../src/eudic-block";
import { DEFAULT_SETTINGS, NOTE_OUTPUT_FORMAT_VERSION } from "../src/constants";
import { ManagedFileRegistry } from "../src/managed-file-registry";
import { protectLeadingThematicBreakFromFrontmatter } from "../src/render-markdown-frontmatter";
import { SemanticBlockAutomationResolver } from "../src/semantic-block-automation-resolver";
import { ReferenceGraphService } from "../src/reference-index-service";
import {
  buildReferenceSemanticBlockTransformOptions,
  buildSemanticBlockTransformOptions,
  mergeSemanticBlockLinkTargets,
} from "../src/semantic-block-transform";
import { serializeNoteOutputBlocks } from "../src/note-output/serializer";
import { buildNoteOutputBlocks, isAllowedNoteOutputImageSrc, resolveManagedInternalLinkHref } from "../src/note-output/dom-parser";
import { resolveManagedReferencePath } from "../src/reference-links";
import {
  collectReferenceUsageWordPaths,
  storedReferenceRefMatchesPath,
} from "../src/reference-usage-resolver";
import {
  LEGACY_STUDYLIST_DIRTY_KEY,
  isStudylistSyncStatusNormalized,
  normalizeStudylistSyncStatus,
  readStudylistSyncStatus,
} from "../src/studylist-sync-status";
import { getEffectiveWordStatus, WordStatusOverrideStore } from "../src/word-status";
import {
  buildAttachmentPreservingNotePayload,
  parseEudicMetaFilesEnvelope,
  serializeEudicMetaFilesEnvelope,
  unwrapEudicMetaFilesBody,
} from "../src/eudic-note-envelope";
import { resolveManagedFileFromProtocol } from "../src/eudic-link";
import { parseMcpSseJsonMessages, parseMcpToolJsonResult } from "../src/eudic-mcp-response";
import { StudylistCatalogResolver } from "../src/studylist-catalog-resolver";
import { StudylistService } from "../src/studylist-service";
import { analyzeStudylistWordModify } from "../src/studylist-word-modify-analysis";
import {
  applyStudylistFrontmatterPatchToEditor,
  buildStudylistFrontmatterPatch,
  setStudylistFrontmatterInMarkdown,
} from "../src/studylist-frontmatter-patch";
import { buildSyncStatusPatch, setSyncStatusInMarkdown } from "../src/sync-status-frontmatter-patch";
import {
  applyWordSyncFrontmatterPatchToEditor,
  buildWordSyncFrontmatterPatch,
  setWordSyncFrontmatterInMarkdown,
} from "../src/word-sync-frontmatter-patch";
import { transformMarkdownForEudicRender } from "../src/html-renderer";
import { resolveWordDirtySignatureDecision } from "../src/word-dirty-signature-state";
import { getWordSyncSignature } from "../src/word-sync-signature";
import type { EudicStudylistCache } from "../src/types";
import type { NoteOutputBlock } from "../src/note-output/model";
import type { App, Editor, EditorPosition, TAbstractFile, TFile } from "obsidian";

const presets = ["Syn.", "Syn./Cog.", "a.", "Cog."];

assert.equal(DEFAULT_SETTINGS.enableAutoBoldMarkersOnEdit, false);
assert.equal(DEFAULT_SETTINGS.enableSemanticBlockMarkerBold, false);
assert.equal(NOTE_OUTPUT_FORMAT_VERSION, 7);
assert.equal(DEFAULT_SETTINGS.referenceMetadataWriteMode, "auto");

const syncedWordMarkdown = [
  "---",
  "word: absent",
  "lang: en",
  "aliases:",
  "  - absence",
  "eudic_link_id: word-123",
  "sync_eudic_enabled: true",
  "sync_status: synced",
  "last_synced_hash: abc",
  "reference_paths:",
  "  - References/ref-1",
  "---",
  "",
  "Main body line",
  '![[References/ref-1#^ref-1-main]]',
].join("\n");

assert.equal(
  getWordSyncSignature(syncedWordMarkdown),
  getWordSyncSignature(syncedWordMarkdown.replace("sync_status: synced", "sync_status: dirty")),
);
assert.notEqual(
  getWordSyncSignature(syncedWordMarkdown),
  getWordSyncSignature(syncedWordMarkdown.replace("Main body line", "Updated body line")),
);
assert.notEqual(
  getWordSyncSignature(syncedWordMarkdown),
  getWordSyncSignature(syncedWordMarkdown.replace("#^ref-1-main", "#^ref-1-alt")),
);

assert.equal(
  setSyncStatusInMarkdown(syncedWordMarkdown, "dirty"),
  syncedWordMarkdown.replace("sync_status: synced", "sync_status: dirty"),
);
assert.equal(
  setSyncStatusInMarkdown(
    [
      "---",
      "word: absent",
      "studylist_sync_status: synced",
      "---",
      "",
      "Body",
    ].join("\n"),
    "dirty",
  ),
  [
    "---",
    "word: absent",
    "studylist_sync_status: synced",
    "sync_status: dirty",
    "---",
    "",
    "Body",
  ].join("\n"),
);
assert.equal(
  setSyncStatusInMarkdown(
    [
      "---",
      "word: absent",
      "sync_status: synced",
      "studylist_sync_status: synced",
      "---",
      "",
      "Body",
    ].join("\n"),
    "dirty",
  ).includes("studylist_sync_status: dirty"),
  false,
);
assert.equal(
  setSyncStatusInMarkdown("Body without properties", "dirty"),
  ["---", "sync_status: dirty", "---", "", "Body without properties"].join("\n"),
);
assert.deepEqual(buildSyncStatusPatch(syncedWordMarkdown.replace("sync_status: synced", "sync_status: dirty"), "dirty").changed, false);

const syncedWordWithStudylist = [
  "---",
  "word: absent",
  "eudic_link_id: word-123",
  "sync_status: dirty",
  "studylist_sync_status: dirty",
  "last_synced_hash: old-hash",
  "last_error: stale error",
  "---",
  "",
  "Main body line",
].join("\n");
assert.equal(
  setWordSyncFrontmatterInMarkdown(syncedWordWithStudylist, {
    syncStatus: "synced",
    syncedAt: "2026-05-08T12:00:00+08:00",
    lastSyncedHash: "new-hash",
    lastSyncedAliasesHash: null,
    lastError: null,
  }),
  [
    "---",
    "word: absent",
    "eudic_link_id: word-123",
    "sync_status: synced",
    "studylist_sync_status: dirty",
    "last_synced_hash: new-hash",
    "synced_at: 2026-05-08T12:00:00+08:00",
    "---",
    "",
    "Main body line",
  ].join("\n"),
);
assert.equal(
  setWordSyncFrontmatterInMarkdown(syncedWordWithStudylist, { syncStatus: "dirty" }).includes("eudic_link_id: word-123"),
  true,
);
assert.equal(
  setWordSyncFrontmatterInMarkdown(syncedWordWithStudylist, { syncStatus: "dirty" }).includes("last_synced_hash: old-hash"),
  true,
);
assert.equal(
  setWordSyncFrontmatterInMarkdown(
    [
      "---",
      "word: absent",
      "sync_status: synced",
      "studylist_sync_status: synced",
      "---",
      "",
      "Body",
    ].join("\n"),
    { eudicLinkId: "word-new" },
  ),
  [
    "---",
    "word: absent",
    "sync_status: synced",
    "studylist_sync_status: synced",
    "eudic_link_id: word-new",
    "---",
    "",
    "Body",
  ].join("\n"),
);
assert.deepEqual(buildWordSyncFrontmatterPatch(syncedWordWithStudylist, {}).changed, false);

let editorWordSyncMarkdown = syncedWordWithStudylist;
const wordSyncEditor = {
  getValue: () => editorWordSyncMarkdown,
  replaceRange: (replacement: string, from: EditorPosition, to?: EditorPosition) => {
    const lines = editorWordSyncMarkdown.split("\n");
    if (!to) {
      const before = lines.slice(0, from.line).join("\n");
      const after = lines.slice(from.line).join("\n");
      editorWordSyncMarkdown = `${before}${before ? "\n" : ""}${replacement}${after}`;
      return;
    }

    const replacementLines = replacement.endsWith("\n")
      ? replacement.slice(0, -1).split("\n")
      : replacement.split("\n");
    editorWordSyncMarkdown = [
      ...lines.slice(0, from.line),
      ...replacementLines,
      ...lines.slice(to.line),
    ].join("\n");
  },
} as unknown as Editor;
assert.equal(
  applyWordSyncFrontmatterPatchToEditor(wordSyncEditor, {
    syncStatus: "synced",
    lastSyncedHash: "editor-hash",
    lastError: null,
  }),
  true,
);
assert.equal(editorWordSyncMarkdown.includes("sync_status: synced"), true);
assert.equal(editorWordSyncMarkdown.includes("last_synced_hash: editor-hash"), true);
assert.equal(editorWordSyncMarkdown.includes("studylist_sync_status: dirty"), true);
assert.equal(editorWordSyncMarkdown.includes("last_error:"), false);

const cleanWordSignature = getWordSyncSignature(syncedWordMarkdown);
const editedWordSignature = getWordSyncSignature(syncedWordMarkdown.replace("Main body line", "Updated body line"));
assert.equal(
  resolveWordDirtySignatureDecision({
    cleanSignature: cleanWordSignature,
    previousSignature: editedWordSignature,
    nextSignature: cleanWordSignature,
  }),
  "clean",
);
assert.equal(
  resolveWordDirtySignatureDecision({
    cleanSignature: cleanWordSignature,
    previousSignature: cleanWordSignature,
    nextSignature: editedWordSignature,
  }),
  "dirty",
);
assert.equal(
  resolveWordDirtySignatureDecision({
    previousSignature: editedWordSignature,
    nextSignature: editedWordSignature,
  }),
  "unchanged",
);

assert.equal(
  protectLeadingThematicBreakFromFrontmatter(
    [
      "---",
      "**n./a.** be **ridiculous** or that it does not make sense 荒谬；",
      "**e.g.** Their request is **absurd**. 他们的要求是荒谬的。",
    ].join("\n"),
  ),
  [
    "<hr>",
    "",
    "**n./a.** be **ridiculous** or that it does not make sense 荒谬；",
    "**e.g.** Their request is **absurd**. 他们的要求是荒谬的。",
  ].join("\n"),
);

assert.equal(
  protectLeadingThematicBreakFromFrontmatter("**n.** ordinary first paragraph\n---\n**P.S.** keep separator"),
  "**n.** ordinary first paragraph\n---\n**P.S.** keep separator",
);

assert.equal(
  protectLeadingThematicBreakFromFrontmatter("**n.** first\n\n---\n\n**P.S.** middle separator"),
  "**n.** first\n\n---\n\n**P.S.** middle separator",
);

assert.deepEqual(
  extractLeadingPresetKindFromList("**Syn./Cog.** absent vs presence", presets),
  { kind: "Syn./Cog.", markdown: "absent vs presence" },
);

assert.deepEqual(
  extractLeadingPresetKindFromList("<b>a.</b> 心不在焉的；", presets),
  { kind: "a.", markdown: "心不在焉的；" },
);

const normalizedBlock = normalizeEudicBlockKindsFromBody(
  [
    "```eudic-block kind=v.",
    "**a.** 充满；大量存在；",
    "```",
  ].join("\n"),
  presets,
);
assert.equal(normalizedBlock.changed, true);
assert.equal(
  normalizedBlock.markdown,
  [
    "``` eudic-block kind=a.",
    "充满；大量存在；",
    "```",
  ].join("\n"),
);

const emptyBlockCursorCh = EMPTY_EUDIC_BLOCK_OPENING_LINE.length;
assert.deepEqual(
  buildEmptyEudicBlockInsertion({ line: 3, ch: 2 }, "   "),
  {
    insertText: ["``` eudic-block kind=", "```"].join("\n"),
    from: { line: 3, ch: 0 },
    to: { line: 3, ch: 3 },
    cursor: { line: 3, ch: emptyBlockCursorCh },
  },
);
assert.deepEqual(
  buildEmptyEudicBlockInsertion({ line: 1, ch: 5 }, "alpha beta"),
  {
    insertText: ["", "``` eudic-block kind=", "```", ""].join("\n"),
    from: { line: 1, ch: 5 },
    to: { line: 1, ch: 5 },
    cursor: { line: 2, ch: emptyBlockCursorCh },
  },
);
assert.deepEqual(
  buildEmptyEudicBlockInsertion({ line: 1, ch: 10 }, "alpha beta"),
  {
    insertText: ["", "``` eudic-block kind=", "```"].join("\n"),
    from: { line: 1, ch: 10 },
    to: { line: 1, ch: 10 },
    cursor: { line: 2, ch: emptyBlockCursorCh },
  },
);

const semanticMarkerOptions = buildSemanticBlockTransformOptions(
  {
    enableSemanticBlockWordBold: false,
    semanticBlockWordBoldKinds: [],
    enableSemanticBlockMarkerBold: true,
    boldMarkers: ["v.", "e.g.", "Syn.", "P.S."],
    enableSemanticBlockWordLinks: false,
    semanticBlockWordLinkKinds: [],
  },
  "",
  null,
);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Cog.",
      "access v. / e.g. demo / [Syn.](https://example.com) / `P.S.`",
      "```",
    ].join("\n"),
    semanticMarkerOptions,
  ),
  [
    "**Cog.** access **v.** / **e.g.** demo / [Syn.](https://example.com) / `P.S.`",
  ].join("\n"),
);

assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Phr.",
      "phrase v.",
      "```",
    ].join("\n"),
    semanticMarkerOptions,
  ),
  "**Phr.** phrase **v.**",
);

const semanticWordAutomationOptions = buildSemanticBlockTransformOptions(
  {
    enableSemanticBlockWordBold: true,
    semanticBlockWordBoldKinds: ["Syn."],
    enableSemanticBlockMarkerBold: true,
    boldMarkers: ["v."],
    enableSemanticBlockWordLinks: true,
    semanticBlockWordLinkKinds: ["Syn."],
  },
  "absent",
  "obsidian://eudic-sync?vault=Test&kind=word&id=w-absent&word=absent",
);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Syn.",
      "absent absently absence v. [absent](https://example.com) **absent** ab**sen**t `absent` [[absent]] <a href=\"https://example.com\">absent</a>",
      "```",
    ].join("\n"),
    semanticWordAutomationOptions,
  ),
  [
    '**Syn.** [**absent**](obsidian://eudic-sync?vault=Test&kind=word&id=w-absent&word=absent) **absently** absence **v.** [absent](https://example.com) [**absent**](obsidian://eudic-sync?vault=Test&kind=word&id=w-absent&word=absent) [ab**sen**t](obsidian://eudic-sync?vault=Test&kind=word&id=w-absent&word=absent) `absent` [[absent]] <a href="https://example.com">absent</a>',
  ].join("\n"),
);

const semanticAboundAutomationOptions = buildSemanticBlockTransformOptions(
  {
    enableSemanticBlockWordBold: true,
    semanticBlockWordBoldKinds: ["Cog."],
    enableSemanticBlockMarkerBold: true,
    boldMarkers: ["v.", "adv."],
    enableSemanticBlockWordLinks: true,
    semanticBlockWordLinkKinds: ["Cog."],
  },
  "abound",
  "obsidian://target/abound",
);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Cog.",
      "abound v. **→** abundantly **adv.** 大量的；丰富的；",
      "**abound** v.",
      "ab**oun**d v.",
      "- abound **v.** **→** abundantly **adv.** 大量的；丰富的；",
      "\t- ab**oun**d nested",
      "- abundantly abounds aboundness **abounds** ab**ound**s [abound](https://example.com) [[abound]] `abound` <a href=\"https://example.com\">abound</a>",
      "```",
    ].join("\n"),
    semanticAboundAutomationOptions,
  ),
  [
    "**Cog.** [**abound**](obsidian://target/abound) **v.** **→** abundantly **adv.** 大量的；丰富的；",
    "[**abound**](obsidian://target/abound) **v.**",
    "[ab**oun**d](obsidian://target/abound) **v.**",
    "",
    "- [**abound**](obsidian://target/abound) **v.** **→** abundantly **adv.** 大量的；丰富的；",
    "\t- [ab**oun**d](obsidian://target/abound) nested",
    "- abundantly **abounds** **aboundness** **abounds** ab**ound**s [abound](https://example.com) [[abound]] `abound` <a href=\"https://example.com\">abound</a>",
  ].join("\n"),
);

const semanticReferenceLinkOptions = buildSemanticBlockTransformOptions(
  {
    enableSemanticBlockWordBold: false,
    semanticBlockWordBoldKinds: [],
    enableSemanticBlockMarkerBold: false,
    boldMarkers: [],
    enableSemanticBlockWordLinks: true,
    semanticBlockWordLinkKinds: ["Cog."],
  },
  "",
  null,
  [
    { word: "access", linkUrl: "obsidian://target/access" },
    { word: "accessory", linkUrl: "obsidian://target/accessory" },
  ],
);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Cog.",
      "accessory access accessible",
      "```",
    ].join("\n"),
    semanticReferenceLinkOptions,
  ),
  "**Cog.** [accessory](obsidian://target/accessory) [access](obsidian://target/access) accessible",
);

const semanticReferenceCurrentWordOptions = buildReferenceSemanticBlockTransformOptions(
  {
    enableSemanticBlockWordBold: true,
    semanticBlockWordBoldKinds: ["Cog."],
    enableSemanticBlockMarkerBold: false,
    boldMarkers: [],
    enableSemanticBlockWordLinks: true,
    semanticBlockWordLinkKinds: ["Cog."],
  },
  "abound",
  mergeSemanticBlockLinkTargets({ word: "abound", linkUrl: "obsidian://target/abound" }, [
    { word: "abound", linkUrl: "obsidian://stale/abound" },
    { word: "access", linkUrl: "obsidian://target/access" },
  ]),
);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Cog.",
      "abound access abounds **abound** ab**oun**d",
      "```",
    ].join("\n"),
    semanticReferenceCurrentWordOptions,
  ),
  "**Cog.** [**abound**](obsidian://target/abound) [access](obsidian://target/access) **abounds** [**abound**](obsidian://target/abound) [ab**oun**d](obsidian://target/abound)",
);

const semanticReferenceFallbackCurrentWordOptions = buildReferenceSemanticBlockTransformOptions(
  {
    enableSemanticBlockWordBold: true,
    semanticBlockWordBoldKinds: ["Cog."],
    enableSemanticBlockMarkerBold: false,
    boldMarkers: [],
    enableSemanticBlockWordLinks: true,
    semanticBlockWordLinkKinds: ["Cog."],
  },
  "abound",
  mergeSemanticBlockLinkTargets({ word: "abound", linkUrl: "obsidian://target/abound" }, []),
);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Cog.",
      "abound abounds",
      "```",
    ].join("\n"),
    semanticReferenceFallbackCurrentWordOptions,
  ),
  "**Cog.** [**abound**](obsidian://target/abound) **abounds**",
);

const semanticReferenceStandaloneOptions = buildReferenceSemanticBlockTransformOptions(
  {
    enableSemanticBlockWordBold: true,
    semanticBlockWordBoldKinds: ["Cog."],
    enableSemanticBlockMarkerBold: false,
    boldMarkers: [],
    enableSemanticBlockWordLinks: true,
    semanticBlockWordLinkKinds: ["Cog."],
  },
  null,
  [{ word: "abound", linkUrl: "obsidian://target/abound" }],
);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Cog.",
      "abound abounds",
      "```",
    ].join("\n"),
    semanticReferenceStandaloneOptions,
  ),
  "**Cog.** [abound](obsidian://target/abound) abounds",
);

const semanticReferenceEmptyStandaloneOptions = buildReferenceSemanticBlockTransformOptions(
  {
    enableSemanticBlockWordBold: true,
    semanticBlockWordBoldKinds: ["Cog."],
    enableSemanticBlockMarkerBold: false,
    boldMarkers: [],
    enableSemanticBlockWordLinks: true,
    semanticBlockWordLinkKinds: ["Cog."],
  },
  null,
  [],
);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Cog.",
      "abound abounds",
      "```",
    ].join("\n"),
    semanticReferenceEmptyStandaloneOptions,
  ),
  "**Cog.** abound abounds",
);

const legacyDirtyFrontmatter: Record<string, unknown> = {
  [LEGACY_STUDYLIST_DIRTY_KEY]: true,
};
assert.equal(readStudylistSyncStatus(legacyDirtyFrontmatter), "dirty");
assert.equal(normalizeStudylistSyncStatus(legacyDirtyFrontmatter), "dirty");
assert.deepEqual(legacyDirtyFrontmatter, { studylist_sync_status: "dirty" });
assert.equal(isStudylistSyncStatusNormalized(legacyDirtyFrontmatter), true);

assert.equal(getEffectiveWordStatus("synced", "dirty"), "dirty");
assert.equal(getEffectiveWordStatus("dirty", "synced"), "dirty");
assert.equal(getEffectiveWordStatus("synced", "synced"), "synced");

const listBlocks: NoteOutputBlock[] = [
  {
    type: "unorderedList",
    items: [
      {
        blocks: [
          {
            type: "paragraph",
            inlines: [{ type: "text", text: "A" }],
          },
          {
            type: "unorderedList",
            items: [
              {
                blocks: [
                  {
                    type: "paragraph",
                    inlines: [{ type: "text", text: "B" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

assert.equal(
  serializeNoteOutputBlocks(listBlocks, "minimal"),
  '<ul type="disc" style="margin:0;padding-left:1.1em;list-style-type:disc;list-style-position:outside"><li style="margin:0;display:list-item;list-style-type:inherit;list-style-position:outside">A\n<ul type="circle" style="margin:0;padding-left:1em;list-style-type:circle;list-style-position:outside"><li style="margin:0;display:list-item;list-style-type:inherit;list-style-position:outside">B</li></ul></li></ul>',
);

assert.equal(
  serializeNoteOutputBlocks(
    [
      {
        type: "paragraph",
        inlines: [
          {
            type: "bold",
            children: [{ type: "text", text: "1." }],
          },
        ],
      },
      {
        type: "paragraph",
        inlines: [
          {
            type: "bold",
            children: [{ type: "text", text: "aged" }],
          },
          { type: "text", text: " a. 年迈的；" },
        ],
      },
      {
        type: "paragraph",
        inlines: [
          {
            type: "bold",
            children: [{ type: "text", text: "2." }],
          },
          { type: "text", text: " " },
        ],
      },
      {
        type: "paragraph",
        inlines: [{ type: "text", text: "aging a. 老化的；" }],
      },
    ],
    "minimal",
  ),
  "<b>1.</b> <b>aged</b> a. 年迈的；\n<b>2.</b> aging a. 老化的；",
);

const managedLinkWordFile = mockFile("Words/whisper.md");
const managedLinkPeerFile = mockFile("Words/peer.md");
const managedLinkDisabledFile = mockFile("Words/disabled.md");
const managedLinkMissingIdFile = mockFile("Words/missing-id.md");
const managedLinkReferenceFile = mockFile("References/ref-render.md");
const managedLinkMaterialFile = mockFile("Material/2012 Text 1.md");
const managedLinkFiles = [
  managedLinkWordFile,
  managedLinkPeerFile,
  managedLinkDisabledFile,
  managedLinkMissingIdFile,
  managedLinkReferenceFile,
  managedLinkMaterialFile,
];
const managedLinkFrontmatterByPath = new Map<string, Record<string, unknown>>([
  [
    managedLinkWordFile.path,
    {
      sync_eudic_enabled: true,
      eudic_link_id: "w-whisper",
    },
  ],
  [
    managedLinkPeerFile.path,
    {
      sync_eudic_enabled: true,
      eudic_link_id: "w-peer",
    },
  ],
  [
    managedLinkDisabledFile.path,
    {
      sync_eudic_enabled: false,
      eudic_link_id: "w-disabled",
    },
  ],
  [
    managedLinkMissingIdFile.path,
    {
      sync_eudic_enabled: true,
    },
  ],
  [
    managedLinkReferenceFile.path,
    {
      eudic_link_id: "r-render",
    },
  ],
  [
    managedLinkMaterialFile.path,
    {
      eudic_link_id: "r-material",
    },
  ],
]);
const managedLinkApp = {
  vault: {
    getName: () => "English Peng",
    getMarkdownFiles: () => managedLinkFiles,
    getFileByPath: (path: string) => managedLinkFiles.find((file) => file.path === path) ?? null,
  },
  metadataCache: {
    getFileCache: (file: TFile) => ({ frontmatter: managedLinkFrontmatterByPath.get(file.path) ?? {} }),
    getFirstLinkpathDest: (linkpath: string) => {
      const normalized = linkpath.replace(/\.md$/i, "").replace(/^\/+/, "");
      if (normalized === "whisper" || normalized === "Words/whisper") {
        return managedLinkWordFile;
      }
      if (normalized === "peer" || normalized === "Words/peer") {
        return managedLinkPeerFile;
      }
      if (normalized === "disabled") {
        return managedLinkDisabledFile;
      }
      if (normalized === "missing-id") {
        return managedLinkMissingIdFile;
      }
      if (normalized === "ref-render" || normalized === "References/ref-render") {
        return managedLinkReferenceFile;
      }
      if (normalized === "2012 Text 1" || normalized === "Material/2012 Text 1") {
        return managedLinkMaterialFile;
      }
      return null;
    },
  },
} as unknown as App;
const managedLinkPathScope = {
  isWordPath: (path: string) => path.startsWith("Words/"),
  isReferencePath: (path: string) => path.startsWith("References/"),
} as never;
const managedLinkResolver = {
  app: managedLinkApp,
  pathScope: managedLinkPathScope,
  sourcePath: managedLinkWordFile.path,
};
assert.equal(
  resolveManagedInternalLinkHref("whisper", managedLinkResolver),
  "obsidian://eudic-sync?vault=English%20Peng&kind=word&id=w-whisper&word=whisper",
);
assert.equal(
  resolveManagedInternalLinkHref("peer", managedLinkResolver),
  "obsidian://eudic-sync?vault=English%20Peng&kind=word&id=w-peer&word=peer",
);
assert.equal(
  resolveManagedInternalLinkHref("Words/peer.md#meaning", managedLinkResolver),
  "obsidian://eudic-sync?vault=English%20Peng&kind=word&id=w-peer&word=peer",
);
assert.equal(
  resolveManagedInternalLinkHref("References/ref-render", managedLinkResolver),
  "obsidian://eudic-sync?vault=English%20Peng&kind=reference&id=r-render&name=ref-render",
);
assert.equal(
  resolveManagedInternalLinkHref("peer", managedLinkResolver) && serializeNoteOutputBlocks(
    [
      {
        type: "paragraph",
        inlines: [
          {
            type: "link",
            href: resolveManagedInternalLinkHref("peer", managedLinkResolver) ?? "",
            children: [{ type: "text", text: "classmate" }],
          },
        ],
      },
    ],
    "minimal",
  ),
  '<a href="obsidian://eudic-sync?vault=English%20Peng&amp;kind=word&amp;id=w-peer&amp;word=peer">classmate</a>',
);
assert.equal(resolveManagedInternalLinkHref("missing", managedLinkResolver), null);
assert.equal(resolveManagedInternalLinkHref("disabled", managedLinkResolver), null);
assert.equal(resolveManagedInternalLinkHref("missing-id", managedLinkResolver), null);
assert.equal(resolveManagedInternalLinkHref("Material/2012 Text 1", managedLinkResolver), null);
assert.equal(resolveManagedInternalLinkHref("https://example.com", managedLinkResolver), null);
assert.equal(resolveManagedInternalLinkHref("%E0%A4%A", managedLinkResolver), null);

const eudicWebUrl = "https://cn.eudic.net/ting/openArticle?id=b8e3892d-353d-11eb-9e86-00505686c5e6&timestamp=00:58.06";
const embedExternalLinkHtml = [
  '<p dir="auto">',
  '<span alt="2020-Text2-KY2 > ^3uck1t" src="2020-Text2-KY2#^3uck1t" class="internal-embed markdown-embed inline-embed is-loaded"></span>',
  '<div class="embed-title markdown-embed-title"></div>',
  '<div class="markdown-embed-content">',
  '<div class="markdown-preview-view markdown-rendered show-indentation-guide">',
  '<p dir="auto">',
  "e.g. The efforts of America's highest-earning 1% have been one of the more ",
  '<a data-href="dynamic" href="dynamic" class="internal-link" target="_blank" rel="noopener nofollow">dynamic</a>',
  '<div class="snw-link-preview"><div class="snw-reference snw-link snw-liveupdate" data-snw-type="link">2</div></div>',
  " elements of the global economy. 美国收入最高的 1% 的人的努力一直是全球经济中比较活跃的因素之一。 @",
  `<a data-tooltip-position="top" aria-label="${eudicWebUrl.replace(/&/g, "&amp;")}" rel="noopener nofollow" class="external-link" href="${eudicWebUrl.replace(/&/g, "&amp;")}" target="_blank">2020-Text2-KY2</a>`,
  "</p>",
  "</div>",
  "</div>",
  '<div class="snw-embed-preview"><div class="snw-reference snw-embed snw-liveupdate" data-snw-type="embed">1</div></div>',
  "</p>",
].join("");
assert.equal(
  serializeNoteOutputBlocks(buildNoteOutputBlocks(embedExternalLinkHtml, managedLinkResolver), "minimal").includes(
    `<a href="${eudicWebUrl.replace(/&/g, "&amp;")}">2020-Text2-KY2</a>`,
  ),
  true,
);
assert.equal(
  serializeNoteOutputBlocks(buildNoteOutputBlocks(embedExternalLinkHtml, managedLinkResolver), "minimal").includes("snw-link-preview"),
  false,
);
assert.equal(
  serializeNoteOutputBlocks(
    buildNoteOutputBlocks(
      '<div><a class="external-link" href="https://example.com/path?x=1&amp;y=2">Example</a><p>tail</p></div>',
    ),
    "minimal",
  ),
  '<a href="https://example.com/path?x=1&amp;y=2">Example</a>\ntail',
);
assert.equal(
  serializeNoteOutputBlocks(
    buildNoteOutputBlocks('<div><a class="external-link" href="javascript:alert(1)">Unsafe</a></div>'),
    "minimal",
  ),
  "Unsafe",
);

assert.equal(
  serializeNoteOutputBlocks(
    [
      {
        type: "paragraph",
        inlines: [
          {
            type: "image",
            src: "https://cdn.jsdelivr.net/gh/TheodorePeng/myimage@main/img/20260504112642050.PNG",
            href: "https://cdn.jsdelivr.net/gh/TheodorePeng/myimage@main/img/20260504112642050.PNG",
            alt: "",
          },
        ],
      },
    ],
    "minimal",
  ),
  '<a href="https://cdn.jsdelivr.net/gh/TheodorePeng/myimage@main/img/20260504112642050.PNG" target="_blank" style="float:right;margin:0 0 2px 2px;"><img src="https://cdn.jsdelivr.net/gh/TheodorePeng/myimage@main/img/20260504112642050.PNG" width="100"></a>',
);

assert.equal(
  serializeNoteOutputBlocks(
    [
      {
        type: "paragraph",
        inlines: [
          {
            type: "image",
            src: "https://example.com/thumb.png",
            href: "https://example.com/original.png",
            alt: "示意图",
          },
        ],
      },
    ],
    "minimal",
  ),
  '<a href="https://example.com/original.png" target="_blank" style="float:right;margin:0 0 2px 2px;"><img src="https://example.com/thumb.png" width="100" alt="示意图"></a>',
);

assert.equal(isAllowedNoteOutputImageSrc("https://example.com/image.png"), true);
assert.equal(isAllowedNoteOutputImageSrc("http://example.com/image.png"), true);
assert.equal(isAllowedNoteOutputImageSrc("data:image/png;base64,abc"), false);
assert.equal(isAllowedNoteOutputImageSrc("javascript:alert(1)"), false);
assert.equal(isAllowedNoteOutputImageSrc("Pasted image 20260504112642050.png"), false);

function mockFile(path: string): TFile {
  return {
    path,
    name: path.split("/").pop() ?? path,
    basename: (path.split("/").pop() ?? path).replace(/\.md$/i, ""),
    extension: "md",
  } as TFile;
}

const renderWordFile = mockFile("Eudic/Words/affair.md");
const renderReferenceFile = mockFile("Eudic/References/ref-render.md");
const renderFiles = [renderWordFile, renderReferenceFile];
const renderFrontmatterByPath = new Map<string, Record<string, unknown>>([
  [
    renderWordFile.path,
    {
      word: "affair",
      eudic_link_id: "w-affair",
      sync_eudic_enabled: true,
      reference_paths: ["References/ref-render"],
    },
  ],
  [
    renderReferenceFile.path,
    {
      referenced_by: [renderWordFile.path],
    },
  ],
]);
const renderMarkdownByPath = new Map<string, string>([
  [
    renderReferenceFile.path,
    [
      "---",
      "eudic_link_id: r-render",
      "---",
      "",
      "e.g. His affair with a slave **stained** his **prestige**. 他与奴隶的婚外情玷污了他的声望。@2008-Text 4-KY #题目",
      "^ref-render-main",
    ].join("\n"),
  ],
]);
const renderApp = {
  vault: {
    getName: () => "English Peng",
    getMarkdownFiles: () => renderFiles,
    getFileByPath: (path: string) => renderFiles.find((file) => file.path === path) ?? null,
    cachedRead: async (file: TFile) => renderMarkdownByPath.get(file.path) ?? "",
  },
  metadataCache: {
    getFileCache: (file: TFile) => ({ frontmatter: renderFrontmatterByPath.get(file.path) ?? {} }),
    getFirstLinkpathDest: (linkpath: string) => (linkpath.includes("ref-render") ? renderReferenceFile : null),
  },
} as unknown as App;
const renderPathScope = {
  isWordPath: (path: string) => path.startsWith("Eudic/Words/"),
  isReferencePath: (path: string) => path.startsWith("Eudic/References/"),
  getPrimaryReferenceFolderPath: () => "Eudic/References",
  resolveStoredReferenceStemToVaultPath: (storedRef: string) => {
    const normalized = storedRef.replace(/\.md$/i, "");
    if (normalized.startsWith("References/")) {
      return `Eudic/${normalized}`;
    }
    if (normalized.startsWith("Eudic/References/")) {
      return normalized;
    }
    return null;
  },
} as never;
const renderManagedFiles = new ManagedFileRegistry(renderApp, renderPathScope);
renderManagedFiles.rebuild();
const renderSemanticSettings = {
  ...DEFAULT_SETTINGS,
  enableSemanticBlockWordBold: true,
  semanticBlockWordBoldKinds: ["n."],
  enableSemanticBlockMarkerBold: false,
  enableSemanticBlockWordLinks: false,
};
const renderSemanticResolver = new SemanticBlockAutomationResolver({
  app: renderApp,
  pathScope: renderPathScope,
  managedFiles: renderManagedFiles,
  getSettings: () => renderSemanticSettings,
});
const renderResolverCalls: Array<{ sourcePath: string; embeddedFromPath?: string }> = [];
const eudicBlockWithReferenceEmbed = await transformMarkdownForEudicRender(
  renderApp,
  renderPathScope,
  [
    "``` eudic-block kind=n.",
    "婚外情；",
    "![[References/ref-render#^ref-render-main]]",
    "```",
  ].join("\n"),
  renderWordFile.path,
  (sourcePath, embeddedFromPath) => {
    renderResolverCalls.push({ sourcePath, embeddedFromPath });
    return renderSemanticResolver.getTransformOptionsForSourcePath({
      sourcePath,
      embeddedFromPath,
      currentWordFile: renderWordFile,
      currentWord: "affair",
      currentWordLinkId: "w-affair",
    });
  },
);
assert.equal(
  eudicBlockWithReferenceEmbed,
  [
    "**n.** 婚外情；",
    "e.g. His **affair** with a slave **stained** his **prestige**. 他与奴隶的婚外情玷污了他的声望。@2008-Text 4-KY #题目",
  ].join("\n"),
);
assert.equal(eudicBlockWithReferenceEmbed.includes("![[References/ref-render"), false);
assert.equal(eudicBlockWithReferenceEmbed.includes("```"), false);
assert.equal(eudicBlockWithReferenceEmbed.includes("^ref-render-main"), false);
assert.equal(
  renderResolverCalls.some(
    (call) => call.sourcePath === renderReferenceFile.path && call.embeddedFromPath === renderWordFile.path,
  ),
  true,
);

renderSemanticSettings.enableSemanticBlockWordBold = false;
assert.equal(
  await transformMarkdownForEudicRender(
    renderApp,
    renderPathScope,
    [
      "``` eudic-block kind=n.",
      "婚外情；",
      "![[References/ref-render#^ref-render-main]]",
      "```",
    ].join("\n"),
    renderWordFile.path,
    (sourcePath, embeddedFromPath) =>
      renderSemanticResolver.getTransformOptionsForSourcePath({
        sourcePath,
        embeddedFromPath,
        currentWordFile: renderWordFile,
        currentWord: "affair",
        currentWordLinkId: "w-affair",
      }),
  ),
  [
    "**n.** 婚外情；",
    "e.g. His affair with a slave **stained** his **prestige**. 他与奴隶的婚外情玷污了他的声望。@2008-Text 4-KY #题目",
  ].join("\n"),
);
renderSemanticSettings.enableSemanticBlockWordBold = true;

assert.equal(
  await transformMarkdownForEudicRender(
    renderApp,
    renderPathScope,
    ["``` eudic-block kind=n.", "事情/事件；事务；", "```"].join("\n"),
    renderWordFile.path,
  ),
  "**n.** 事情/事件；事务；",
);
assert.equal(
  await transformMarkdownForEudicRender(
    renderApp,
    renderPathScope,
    ["Before", "![[References/ref-render#^ref-render-main]]", "After"].join("\n"),
    renderWordFile.path,
  ),
  [
    "Before",
    "e.g. His affair with a slave **stained** his **prestige**. 他与奴隶的婚外情玷污了他的声望。@2008-Text 4-KY #题目",
    "After",
  ].join("\n"),
);
assert.equal(
  await transformMarkdownForEudicRender(
    renderApp,
    renderPathScope,
    ["``` eudic-block kind=n.", "![[References/missing#^missing-main]]", "```"].join("\n"),
    renderWordFile.path,
  ),
  "**n.** ![[References/missing#^missing-main]]",
);

const overrideFile = mockFile("Eudic/Words/assemble.md");
const overrideStore = new WordStatusOverrideStore();
const fullySyncedContext = {
  file: overrideFile,
  word: "assemble",
  lang: "en",
  storedStatus: "synced",
  bodyStatus: "synced",
  studylistStatus: "synced",
  effectiveStatus: "synced",
  lastSyncedHash: "hash",
  syncedAt: "2026-05-03T00:00:00+08:00",
  lastError: null,
} as const;
const syncedContext = {
  file: overrideFile,
  word: "assemble",
  lang: "en",
  storedStatus: "synced",
  bodyStatus: "synced",
  studylistStatus: "dirty",
  effectiveStatus: "dirty",
  lastSyncedHash: "hash",
  syncedAt: "2026-05-03T00:00:00+08:00",
  lastError: null,
} as const;

overrideStore.setBody(overrideFile, "dirty", null);
const immediateDirtyContext = overrideStore.getDisplayContext(overrideFile, fullySyncedContext);
assert.equal(immediateDirtyContext?.bodyStatus, "dirty");
assert.equal(immediateDirtyContext?.studylistStatus, "synced");
assert.equal(immediateDirtyContext?.effectiveStatus, "dirty");

overrideStore.clear(overrideFile.path);
overrideStore.setBody(overrideFile, "synced", null);
const dirtyDisplayContext = overrideStore.getDisplayContext(overrideFile, syncedContext);
assert.equal(dirtyDisplayContext?.bodyStatus, "synced");
assert.equal(dirtyDisplayContext?.studylistStatus, "dirty");
assert.equal(dirtyDisplayContext?.effectiveStatus, "dirty");

overrideStore.setStudylist(overrideFile, "synced", null);
const syncedDisplayContext = overrideStore.getDisplayContext(overrideFile, {
  ...syncedContext,
  bodyStatus: "dirty",
  studylistStatus: "dirty",
  effectiveStatus: "dirty",
  storedStatus: "dirty",
});
assert.equal(syncedDisplayContext?.bodyStatus, "synced");
assert.equal(syncedDisplayContext?.studylistStatus, "synced");
assert.equal(syncedDisplayContext?.effectiveStatus, "synced");

overrideStore.setBody(overrideFile, "dirty", null);
overrideStore.setStudylist(overrideFile, "dirty", "studylist error");
overrideStore.clearBody(overrideFile.path);
const studylistOnlyDirtyContext = overrideStore.getDisplayContext(overrideFile, fullySyncedContext);
assert.equal(studylistOnlyDirtyContext?.bodyStatus, "synced");
assert.equal(studylistOnlyDirtyContext?.studylistStatus, "dirty");
assert.equal(studylistOnlyDirtyContext?.effectiveStatus, "dirty");
assert.equal(studylistOnlyDirtyContext?.lastError, "studylist error");

overrideStore.clearStudylist(overrideFile.path);
const clearedOverrideContext = overrideStore.getDisplayContext(overrideFile, fullySyncedContext);
assert.equal(clearedOverrideContext?.bodyStatus, "synced");
assert.equal(clearedOverrideContext?.studylistStatus, "synced");
assert.equal(clearedOverrideContext?.effectiveStatus, "synced");

const studylistNamesById = new Map([
  ["0", "略｜我的生词本"],
  ["1", "Alpha"],
  ["2", "Beta"],
  ["134223429171042864", "Obsidian Sync"],
]);
const analyzeStudylist = (
  markdown: string,
  stateOverrides: Partial<Parameters<typeof analyzeStudylistWordModify>[0]["state"]> = {},
  previousSnapshot = { ids: ["1"], names: ["Alpha"] },
) =>
  analyzeStudylistWordModify({
    state: {
      language: "en",
      ids: ["1"],
      names: ["Alpha"],
      status: "synced",
      disabled: false,
      lastError: null,
      ...stateOverrides,
    },
    previousSnapshot,
    markdown,
    resolveAssignment: async (_language, assignment) => {
      const idsByName = new Map(Array.from(studylistNamesById.entries()).map(([id, name]) => [name, id]));
      if (assignment.preferredSource === "names") {
        const ids = assignment.names.map((name) => idsByName.get(name) ?? "").filter(Boolean);
        const unknownNames = assignment.names.filter((name) => !idsByName.has(name));
        const names = unknownNames.length > 0 ? assignment.names : ids.map((id) => studylistNamesById.get(id) ?? id);
        return {
          ids: unknownNames.length > 0 ? assignment.ids : ids,
          names,
          unknownNames,
          unknownIds: [],
        };
      }

      const unknownIds = assignment.ids.filter((id) => !studylistNamesById.has(id));
      return {
        ids: assignment.ids,
        names: unknownIds.length > 0 ? assignment.names : assignment.ids.map((id) => studylistNamesById.get(id) ?? id),
        unknownNames: [],
        unknownIds,
      };
    },
  });

const bodyOnlyStudylistAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 1",
    "eudic_studylist_names:",
    "  - Alpha",
    "---",
    "",
    "Only the body changed.",
  ].join("\n"),
);
assert.equal(bodyOnlyStudylistAnalysis.shouldDirty, false);
assert.equal(bodyOnlyStudylistAnalysis.shouldWrite, false);

const dirtyStudylistAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 2",
    "eudic_studylist_names:",
    "  - Beta",
    "---",
    "",
    "Only studylist changed.",
  ].join("\n"),
);
assert.equal(dirtyStudylistAnalysis.shouldDirty, true);
assert.equal(dirtyStudylistAnalysis.nextStatus, "dirty");
assert.equal(dirtyStudylistAnalysis.shouldWrite, true);

const revertedStudylistAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 1",
    "eudic_studylist_names:",
    "  - Alpha",
    "---",
    "",
    "Studylist reverted.",
  ].join("\n"),
  {
    ids: ["2"],
    names: ["Beta"],
    status: "dirty",
  },
);
assert.equal(revertedStudylistAnalysis.shouldDirty, true);
assert.equal(revertedStudylistAnalysis.nextStatus, "dirty");
assert.equal(revertedStudylistAnalysis.shouldWrite, true);

const namesPrimaryStudylistAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids: []",
    "eudic_studylist_names:",
    "  - Obsidian Sync",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Names are the human-editable source.",
  ].join("\n"),
  {
    ids: [],
    names: ["Obsidian Sync"],
    status: "dirty",
  },
);
assert.deepEqual(namesPrimaryStudylistAnalysis.ids, ["134223429171042864"]);
assert.deepEqual(namesPrimaryStudylistAnalysis.names, ["Obsidian Sync"]);
assert.equal(namesPrimaryStudylistAnalysis.nextStatus, "dirty");
assert.equal(namesPrimaryStudylistAnalysis.nextLastError, null);

const defaultNameStudylistAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids: []",
    "eudic_studylist_names:",
    "  - 略｜我的生词本",
    "---",
    "",
    "Default list should map to id 0.",
  ].join("\n"),
);
assert.deepEqual(defaultNameStudylistAnalysis.ids, ["0"]);
assert.deepEqual(defaultNameStudylistAnalysis.names, ["略｜我的生词本"]);

const conflictingStudylistAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 2",
    "eudic_studylist_names:",
    "  - Alpha",
    "---",
    "",
    "Names win over stale ids.",
  ].join("\n"),
  {},
  { ids: ["2"], names: ["Beta"] },
);
assert.deepEqual(conflictingStudylistAnalysis.ids, ["1"]);
assert.deepEqual(conflictingStudylistAnalysis.names, ["Alpha"]);
assert.equal(conflictingStudylistAnalysis.nextStatus, "dirty");
assert.equal(conflictingStudylistAnalysis.shouldWrite, true);

const idsOnlyStudylistAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 2",
    "eudic_studylist_names:",
    "  - Alpha",
    "---",
    "",
    "Ids can repair names when ids changed and names stayed the same.",
  ].join("\n"),
);
assert.deepEqual(idsOnlyStudylistAnalysis.ids, ["2"]);
assert.deepEqual(idsOnlyStudylistAnalysis.names, ["Beta"]);

const removedNameStudylistAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 1",
    "  - 2",
    "eudic_studylist_names:",
    "  - Alpha",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Removing a name removes the derived id.",
  ].join("\n"),
  {
    ids: ["1", "2"],
    names: ["Alpha"],
    status: "dirty",
  },
  { ids: ["1", "2"], names: ["Alpha", "Beta"] },
);
assert.deepEqual(removedNameStudylistAnalysis.ids, ["1"]);
assert.deepEqual(removedNameStudylistAnalysis.names, ["Alpha"]);
assert.equal(removedNameStudylistAnalysis.nextStatus, "dirty");

const removedIdStudylistAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 1",
    "eudic_studylist_names:",
    "  - Alpha",
    "  - Beta",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Removing an id removes the derived name when names did not change.",
  ].join("\n"),
  {
    ids: ["1"],
    names: ["Alpha", "Beta"],
    status: "dirty",
  },
  { ids: ["1", "2"], names: ["Alpha", "Beta"] },
);
assert.deepEqual(removedIdStudylistAnalysis.ids, ["1"]);
assert.deepEqual(removedIdStudylistAnalysis.names, ["Alpha"]);
assert.equal(removedIdStudylistAnalysis.nextStatus, "dirty");

const removedIdAfterNameIntentAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 134223429171042864",
    "eudic_studylist_names:",
    "  - 略｜我的生词本",
    "  - Obsidian Sync",
    "studylist_sync_status: dirty",
    "---",
    "",
    "A later id deletion should supersede an earlier names intent.",
  ].join("\n"),
  {
    ids: ["134223429171042864"],
    names: ["略｜我的生词本", "Obsidian Sync"],
    status: "dirty",
  },
  { ids: ["0", "134223429171042864"], names: ["略｜我的生词本", "Obsidian Sync"] },
);
assert.equal(removedIdAfterNameIntentAnalysis.preferredSource, "ids");
assert.deepEqual(removedIdAfterNameIntentAnalysis.ids, ["134223429171042864"]);
assert.deepEqual(removedIdAfterNameIntentAnalysis.names, ["Obsidian Sync"]);

const removedIdFromNamesPatchEchoAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 0",
    "eudic_studylist_names:",
    "  - 略｜我的生词本",
    "  - Obsidian Sync",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Deleting an id must override a stale names-side echo intent.",
  ].join("\n"),
  {
    ids: ["0"],
    names: ["略｜我的生词本", "Obsidian Sync"],
    status: "dirty",
  },
  { ids: ["0", "134223429171042864"], names: ["略｜我的生词本", "Obsidian Sync"] },
);
assert.equal(removedIdFromNamesPatchEchoAnalysis.preferredSource, "ids");
assert.deepEqual(removedIdFromNamesPatchEchoAnalysis.ids, ["0"]);
assert.deepEqual(removedIdFromNamesPatchEchoAnalysis.names, ["略｜我的生词本"]);

const removedNameFromIdsPatchEchoAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 0",
    "  - 134223429171042864",
    "eudic_studylist_names:",
    "  - 略｜我的生词本",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Deleting a name must override a stale ids-side echo intent.",
  ].join("\n"),
  {
    ids: ["0", "134223429171042864"],
    names: ["略｜我的生词本"],
    status: "dirty",
  },
  { ids: ["0", "134223429171042864"], names: ["略｜我的生词本", "Obsidian Sync"] },
);
assert.equal(removedNameFromIdsPatchEchoAnalysis.preferredSource, "names");
assert.deepEqual(removedNameFromIdsPatchEchoAnalysis.ids, ["0"]);
assert.deepEqual(removedNameFromIdsPatchEchoAnalysis.names, ["略｜我的生词本"]);

const removedDefaultIdAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 134223429171042864",
    "eudic_studylist_names:",
    "  - 略｜我的生词本",
    "  - Obsidian Sync",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Deleting default id removes the default name.",
  ].join("\n"),
  {
    ids: ["134223429171042864"],
    names: ["略｜我的生词本", "Obsidian Sync"],
    status: "dirty",
  },
  { ids: ["0", "134223429171042864"], names: ["略｜我的生词本", "Obsidian Sync"] },
);
assert.equal(removedDefaultIdAnalysis.preferredSource, "ids");
assert.deepEqual(removedDefaultIdAnalysis.ids, ["134223429171042864"]);
assert.deepEqual(removedDefaultIdAnalysis.names, ["Obsidian Sync"]);

const removedDefaultNameAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 0",
    "  - 134223429171042864",
    "eudic_studylist_names:",
    "  - Obsidian Sync",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Deleting default name removes the default id.",
  ].join("\n"),
  {
    ids: ["0", "134223429171042864"],
    names: ["Obsidian Sync"],
    status: "dirty",
  },
  { ids: ["0", "134223429171042864"], names: ["略｜我的生词本", "Obsidian Sync"] },
);
assert.equal(removedDefaultNameAnalysis.preferredSource, "names");
assert.deepEqual(removedDefaultNameAnalysis.ids, ["134223429171042864"]);
assert.deepEqual(removedDefaultNameAnalysis.names, ["Obsidian Sync"]);

const removedOnlyObsidianIdFromRawPairAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids: []",
    "eudic_studylist_names:",
    "  - Obsidian Sync",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Deleting the only id must remove the mirrored name.",
  ].join("\n"),
  {
    ids: ["134223429171042864"],
    names: ["Obsidian Sync"],
    status: "dirty",
  },
  { ids: ["134223429171042864"], names: ["Obsidian Sync"] },
);
assert.equal(removedOnlyObsidianIdFromRawPairAnalysis.preferredSource, "ids");
assert.deepEqual(removedOnlyObsidianIdFromRawPairAnalysis.ids, []);
assert.deepEqual(removedOnlyObsidianIdFromRawPairAnalysis.names, []);

const removedOnlyObsidianNameFromRawPairAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 134223429171042864",
    "eudic_studylist_names: []",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Deleting the only name must remove the mirrored id.",
  ].join("\n"),
  {
    ids: ["134223429171042864"],
    names: ["Obsidian Sync"],
    status: "dirty",
  },
  { ids: ["134223429171042864"], names: ["Obsidian Sync"] },
);
assert.equal(removedOnlyObsidianNameFromRawPairAnalysis.preferredSource, "names");
assert.deepEqual(removedOnlyObsidianNameFromRawPairAnalysis.ids, []);
assert.deepEqual(removedOnlyObsidianNameFromRawPairAnalysis.names, []);

const abdicateInconsistentDeleteIdAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids: []",
    "eudic_studylist_names:",
    "  - Obsidian Sync",
    "  - 略｜我的生词本",
    "studylist_sync_status: dirty",
    "---",
    "",
    "The raw id deletion should discard stale names.",
  ].join("\n"),
  {
    ids: ["134223429171042864"],
    names: ["Obsidian Sync", "略｜我的生词本"],
    status: "dirty",
  },
  { ids: ["134223429171042864"], names: ["Obsidian Sync", "略｜我的生词本"] },
);
assert.equal(abdicateInconsistentDeleteIdAnalysis.preferredSource, "ids");
assert.deepEqual(abdicateInconsistentDeleteIdAnalysis.ids, []);
assert.deepEqual(abdicateInconsistentDeleteIdAnalysis.names, []);

const abdicateInconsistentDeleteNameAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 134223429171042864",
    "eudic_studylist_names:",
    "  - 略｜我的生词本",
    "studylist_sync_status: dirty",
    "---",
    "",
    "The raw name deletion should discard the stale id.",
  ].join("\n"),
  {
    ids: ["134223429171042864"],
    names: ["Obsidian Sync", "略｜我的生词本"],
    status: "dirty",
  },
  { ids: ["134223429171042864"], names: ["Obsidian Sync", "略｜我的生词本"] },
);
assert.equal(abdicateInconsistentDeleteNameAnalysis.preferredSource, "names");
assert.deepEqual(abdicateInconsistentDeleteNameAnalysis.ids, ["0"]);
assert.deepEqual(abdicateInconsistentDeleteNameAnalysis.names, ["略｜我的生词本"]);

const rapidNextNameEditAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - 134223429171042864",
    "eudic_studylist_names:",
    "  - 略｜我的生词本",
    "  - Obsidian Sync",
    "studylist_sync_status: dirty",
    "---",
    "",
    "A later names edit should supersede the previous active intent.",
  ].join("\n"),
  {
    ids: ["134223429171042864"],
    names: ["略｜我的生词本", "Obsidian Sync"],
    status: "dirty",
  },
  { ids: ["134223429171042864"], names: ["Obsidian Sync"] },
);
assert.equal(rapidNextNameEditAnalysis.preferredSource, "names");
assert.deepEqual(rapidNextNameEditAnalysis.ids, ["0", "134223429171042864"]);
assert.deepEqual(rapidNextNameEditAnalysis.names, ["略｜我的生词本", "Obsidian Sync"]);

const unknownNameStudylistAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids: []",
    "eudic_studylist_names:",
    "  - Missing List",
    "---",
    "",
    "Unknown list names should not become new remote categories.",
  ].join("\n"),
);
assert.equal(unknownNameStudylistAnalysis.nextStatus, "dirty");
assert.match(unknownNameStudylistAnalysis.nextLastError ?? "", /Unknown Eudic studylist name\(s\): Missing List/);

const unknownIdStudylistAnalysis = await analyzeStudylist(
  [
    "---",
    "eudic_studylist_ids:",
    "  - missing-id",
    "eudic_studylist_names:",
    "  - Alpha",
    "---",
    "",
    "Unknown ids should block push when ids are the edited side.",
  ].join("\n"),
);
assert.equal(unknownIdStudylistAnalysis.nextStatus, "dirty");
assert.match(unknownIdStudylistAnalysis.nextLastError ?? "", /Unknown Eudic studylist id\(s\): missing-id/);

const patchedStudylistMarkdown = setStudylistFrontmatterInMarkdown(
  [
    "---",
    "lang: en",
    "eudic_studylist_ids:",
    "  - stale",
    "eudic_studylist_names:",
    "  - Old",
    "studylist_sync_status: synced",
    "eudic_studylist_last_error: old error",
    "sync_status: synced",
    "---",
    "",
    "Body stays here.",
  ].join("\n"),
  {
    ids: ["0"],
    names: ["略｜我的生词本"],
    status: "dirty",
    lastError: null,
  },
);
assert.equal(
  patchedStudylistMarkdown,
  [
    "---",
    "lang: en",
    "eudic_studylist_ids:",
    '  - "0"',
    "eudic_studylist_names:",
    '  - "略｜我的生词本"',
    "studylist_sync_status: dirty",
    "sync_status: synced",
    "---",
    "",
    "Body stays here.",
  ].join("\n"),
);
assert.equal(
  buildStudylistFrontmatterPatch(patchedStudylistMarkdown, {
    ids: ["0"],
    names: ["略｜我的生词本"],
    status: "dirty",
    lastError: null,
  }).changed,
  false,
);

assert.equal(
  setStudylistFrontmatterInMarkdown(
    [
      "---",
      "word: abdicate",
      "eudic_studylist_ids:",
      "  - stale",
      "sync_status: synced",
      "eudic_studylist_names:",
      "  - Old",
      "studylist_sync_status: synced",
      "---",
      "",
      "Body stays here.",
    ].join("\n"),
    {
      ids: ["0"],
      names: ["略｜我的生词本"],
      status: "dirty",
      lastError: null,
    },
  ),
  [
    "---",
    "word: abdicate",
    "eudic_studylist_ids:",
    '  - "0"',
    "eudic_studylist_names:",
    '  - "略｜我的生词本"',
    "studylist_sync_status: dirty",
    "sync_status: synced",
    "---",
    "",
    "Body stays here.",
  ].join("\n"),
);

assert.equal(
  setStudylistFrontmatterInMarkdown(
    [
      "---",
      "word: abdicate",
      "sync_status: synced",
      "---",
      "",
      "Body stays here.",
    ].join("\n"),
    {
      ids: ["134223429171042864"],
      names: ["Obsidian Sync"],
      status: "dirty",
      lastError: null,
    },
  ),
  [
    "---",
    "word: abdicate",
    "sync_status: synced",
    "eudic_studylist_ids:",
    '  - "134223429171042864"',
    "eudic_studylist_names:",
    '  - "Obsidian Sync"',
    "studylist_sync_status: dirty",
    "---",
    "",
    "Body stays here.",
  ].join("\n"),
);

assert.equal(
  setStudylistFrontmatterInMarkdown("Body without properties.", {
    ids: ["0"],
    names: ["略｜我的生词本"],
    status: "dirty",
    lastError: null,
  }),
  [
    "---",
    "eudic_studylist_ids:",
    '  - "0"',
    "eudic_studylist_names:",
    '  - "略｜我的生词本"',
    "studylist_sync_status: dirty",
    "---",
    "",
    "Body without properties.",
  ].join("\n"),
);

let editorStudylistMarkdown = [
  "---",
  "word: abdicate",
  "eudic_studylist_ids:",
  "  - 134223429171042864",
  "sync_status: dirty",
  "eudic_studylist_names:",
  "  - Obsidian Sync",
  "  - 略｜我的生词本",
  "studylist_sync_status: dirty",
  "---",
  "",
  "Body stays here.",
].join("\n");
const studylistEditor = {
  getValue: () => editorStudylistMarkdown,
  replaceRange: (replacement: string, from: EditorPosition, to?: EditorPosition) => {
    const lines = editorStudylistMarkdown.split("\n");
    if (!to) {
      const before = lines.slice(0, from.line).join("\n");
      const after = lines.slice(from.line).join("\n");
      editorStudylistMarkdown = `${before}${before ? "\n" : ""}${replacement}${after}`;
      return;
    }

    const replacementLines = replacement.endsWith("\n")
      ? replacement.slice(0, -1).split("\n")
      : replacement.split("\n");
    editorStudylistMarkdown = [
      ...lines.slice(0, from.line),
      ...replacementLines,
      ...lines.slice(to.line),
    ].join("\n");
  },
} as unknown as Editor;
assert.equal(
  applyStudylistFrontmatterPatchToEditor(studylistEditor, {
    ids: [],
    names: [],
    status: "dirty",
    lastError: null,
  }),
  true,
);
assert.equal(
  editorStudylistMarkdown,
  [
    "---",
    "word: abdicate",
    "eudic_studylist_ids: []",
    "eudic_studylist_names: []",
    "studylist_sync_status: dirty",
    "sync_status: dirty",
    "---",
    "",
    "Body stays here.",
  ].join("\n"),
);

const studylistServiceFile = mockFile("Eudic/Words/abdicate.md");
const studylistServiceFrontmatterByPath = new Map<string, Record<string, unknown>>([
  [
    studylistServiceFile.path,
    {
      word: "abdicate",
      lang: "en",
      eudic_studylist_ids: [],
      eudic_studylist_names: ["Obsidian Sync"],
      studylist_sync_status: "dirty",
    },
  ],
]);
const studylistServiceMarkdownByPath = new Map<string, string>([
  [
    studylistServiceFile.path,
    [
      "---",
      "word: abdicate",
      "lang: en",
      "eudic_studylist_ids: []",
      "eudic_studylist_names:",
      "  - Obsidian Sync",
      "studylist_sync_status: dirty",
      "---",
      "",
      "Body.",
    ].join("\n"),
  ],
]);
const studylistServiceApp = {
  vault: {
    getMarkdownFiles: () => [studylistServiceFile],
    cachedRead: async (file: TFile) => studylistServiceMarkdownByPath.get(file.path) ?? "",
  },
  metadataCache: {
    getFileCache: (file: TFile) => ({ frontmatter: studylistServiceFrontmatterByPath.get(file.path) ?? {} }),
  },
} as unknown as App;
const studylistServiceManagedFiles = { getWordFiles: () => [studylistServiceFile] } as never;
const studylistServicePathScope = { isWordPath: (path: string) => path === studylistServiceFile.path } as never;
let studylistServiceCache: EudicStudylistCache = {
  categories: [
    { id: "0", language: "en", name: "略｜我的生词本" },
    { id: "134223429171042864", language: "en", name: "Obsidian Sync" },
  ],
  refreshedAt: "2026-05-08T00:00:00+08:00",
};
let studylistServiceWriteCount = 0;
const studylistService = new StudylistService({
  app: studylistServiceApp,
  pathScope: studylistServicePathScope,
  managedFiles: studylistServiceManagedFiles,
  getAuthorizationToken: () => "token",
  getStudylistCache: () => studylistServiceCache,
  setStudylistCache: async (cache) => {
    studylistServiceCache = cache;
  },
  writeFrontmatter: async (file, mutate) => {
    const nextFrontmatter = {
      ...(studylistServiceFrontmatterByPath.get(file.path) ?? {}),
    };
    mutate(nextFrontmatter);
    studylistServiceFrontmatterByPath.set(file.path, nextFrontmatter);
    studylistServiceWriteCount += 1;
  },
});
const propertyPanelNameReconcile = await studylistService.reconcileWordAssignment(
  studylistServiceFile,
  studylistServiceMarkdownByPath.get(studylistServiceFile.path) ?? "",
);
assert.deepEqual(propertyPanelNameReconcile?.ids, ["134223429171042864"]);
assert.equal(studylistServiceWriteCount, 1);
assert.deepEqual(studylistServiceFrontmatterByPath.get(studylistServiceFile.path)?.eudic_studylist_ids, [
  "134223429171042864",
]);
assert.equal(studylistServiceFrontmatterByPath.get(studylistServiceFile.path)?.studylist_sync_status, "dirty");

studylistServiceFrontmatterByPath.set(studylistServiceFile.path, {
  ...(studylistServiceFrontmatterByPath.get(studylistServiceFile.path) ?? {}),
  eudic_studylist_ids: ["0", "134223429171042864"],
  eudic_studylist_names: ["Obsidian Sync"],
  studylist_sync_status: "dirty",
});
studylistServiceMarkdownByPath.set(
  studylistServiceFile.path,
  [
    "---",
    "word: abdicate",
    "lang: en",
    "eudic_studylist_ids:",
    "  - 0",
    "  - 134223429171042864",
    "eudic_studylist_names:",
    "  - Obsidian Sync",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Body.",
  ].join("\n"),
);
const directIdServiceReconcile = await studylistService.reconcileWordAssignment(
  studylistServiceFile,
  studylistServiceMarkdownByPath.get(studylistServiceFile.path) ?? "",
);
assert.equal(directIdServiceReconcile?.preferredSource, "ids");
assert.deepEqual(studylistServiceFrontmatterByPath.get(studylistServiceFile.path)?.eudic_studylist_ids, [
  "0",
  "134223429171042864",
]);
assert.deepEqual(studylistServiceFrontmatterByPath.get(studylistServiceFile.path)?.eudic_studylist_names, [
  "略｜我的生词本",
  "Obsidian Sync",
]);

studylistServiceFrontmatterByPath.set(studylistServiceFile.path, {
  ...(studylistServiceFrontmatterByPath.get(studylistServiceFile.path) ?? {}),
  eudic_studylist_ids: ["134223429171042864"],
  eudic_studylist_names: ["Obsidian Sync"],
  studylist_sync_status: "dirty",
});
studylistService.captureAllLocalSnapshots();
studylistServiceFrontmatterByPath.set(studylistServiceFile.path, {
  ...(studylistServiceFrontmatterByPath.get(studylistServiceFile.path) ?? {}),
  eudic_studylist_ids: ["0"],
  eudic_studylist_names: ["Obsidian Sync"],
  studylist_sync_status: "dirty",
});
studylistServiceMarkdownByPath.set(
  studylistServiceFile.path,
  [
    "---",
    "word: abdicate",
    "lang: en",
    "eudic_studylist_ids:",
    "  - 0",
    "eudic_studylist_names:",
    "  - Obsidian Sync",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Body.",
  ].join("\n"),
);
await studylistService.reconcileWordAssignment(
  studylistServiceFile,
  studylistServiceMarkdownByPath.get(studylistServiceFile.path) ?? "",
);
assert.deepEqual(studylistServiceFrontmatterByPath.get(studylistServiceFile.path)?.eudic_studylist_ids, ["0"]);
assert.deepEqual(studylistServiceFrontmatterByPath.get(studylistServiceFile.path)?.eudic_studylist_names, [
  "略｜我的生词本",
]);

studylistServiceFrontmatterByPath.set(studylistServiceFile.path, {
  word: "abdicate",
  lang: "en",
  eudic_studylist_ids: ["0", "134223429171042864"],
  eudic_studylist_names: ["略｜我的生词本", "Obsidian Sync"],
  studylist_sync_status: "dirty",
});
studylistService.captureAllLocalSnapshots();
studylistServiceMarkdownByPath.set(
  studylistServiceFile.path,
  [
    "---",
    "word: abdicate",
    "lang: en",
    "eudic_studylist_ids:",
    "  - 0",
    "eudic_studylist_names:",
    "  - 略｜我的生词本",
    "  - Obsidian Sync",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Body.",
  ].join("\n"),
);
const propertyPanelIdDeleteReconcile = await studylistService.reconcileWordAssignment(
  studylistServiceFile,
  studylistServiceMarkdownByPath.get(studylistServiceFile.path) ?? "",
);
assert.equal(propertyPanelIdDeleteReconcile?.preferredSource, "ids");
assert.deepEqual(studylistServiceFrontmatterByPath.get(studylistServiceFile.path)?.eudic_studylist_ids, ["0"]);
assert.deepEqual(studylistServiceFrontmatterByPath.get(studylistServiceFile.path)?.eudic_studylist_names, [
  "略｜我的生词本",
]);

studylistServiceFrontmatterByPath.set(studylistServiceFile.path, {
  word: "abdicate",
  lang: "en",
  eudic_studylist_ids: ["0", "134223429171042864"],
  eudic_studylist_names: ["略｜我的生词本", "Obsidian Sync"],
  studylist_sync_status: "dirty",
});
studylistService.captureAllLocalSnapshots();
studylistServiceMarkdownByPath.set(
  studylistServiceFile.path,
  [
    "---",
    "word: abdicate",
    "lang: en",
    "eudic_studylist_ids:",
    "  - 0",
    "  - 134223429171042864",
    "eudic_studylist_names:",
    "  - 略｜我的生词本",
    "studylist_sync_status: dirty",
    "---",
    "",
    "Body.",
  ].join("\n"),
);
const propertyPanelNameDeleteReconcile = await studylistService.reconcileWordAssignment(
  studylistServiceFile,
  studylistServiceMarkdownByPath.get(studylistServiceFile.path) ?? "",
);
assert.equal(propertyPanelNameDeleteReconcile?.preferredSource, "names");
assert.deepEqual(studylistServiceFrontmatterByPath.get(studylistServiceFile.path)?.eudic_studylist_ids, ["0"]);
assert.deepEqual(studylistServiceFrontmatterByPath.get(studylistServiceFile.path)?.eudic_studylist_names, [
  "略｜我的生词本",
]);

const registryFiles = [
  mockFile("Eudic/Words/abound.md"),
  mockFile("Eudic/References/ref-1.md"),
  mockFile("Other/ignored.md"),
];
const registry = new ManagedFileRegistry(
  {
    vault: {
      getMarkdownFiles: () => registryFiles,
    },
  } as unknown as App,
  {
    isWordPath: (path: string) => path.startsWith("Eudic/Words/"),
    isReferencePath: (path: string) => path.startsWith("Eudic/References/"),
  } as never,
);

registry.rebuild();
assert.deepEqual(registry.getWordFiles().map((file) => file.path), ["Eudic/Words/abound.md"]);
assert.deepEqual(registry.getReferencePaths(), ["Eudic/References/ref-1.md"]);

registry.rename(mockFile("Eudic/Words/absence.md") as unknown as TAbstractFile, "Eudic/Words/abound.md");
assert.deepEqual(registry.getWordFiles().map((file) => file.path), ["Eudic/Words/absence.md"]);

registry.remove("Eudic/References/ref-1.md");
assert.deepEqual(registry.getReferenceFiles(), []);

const protocolIdFile = mockFile("Words/abandon.md");
const protocolFallbackFile = mockFile("Words/abdicate.md");
const protocolDuplicateFile = mockFile("Words/abdicate duplicate.md");
const protocolFrontmatterByPath = new Map<string, Record<string, unknown>>([
  [protocolIdFile.path, { eudic_link_id: "w-abandon", word: "abandon" }],
  [protocolFallbackFile.path, {}],
  [protocolDuplicateFile.path, { word: "abdicate" }],
]);
const protocolFiles = [protocolIdFile, protocolFallbackFile];
const protocolPathScope = {
  isWordPath: (path: string) => path.startsWith("Words/"),
  isReferencePath: (path: string) => path.startsWith("References/"),
  getWordFolderPath: () => "Words",
} as never;
const protocolApp = {
  vault: {
    getName: () => "English Peng",
    getMarkdownFiles: () => protocolFiles,
    getFileByPath: (path: string) => protocolFiles.find((file) => file.path === path) ?? null,
  },
  metadataCache: {
    getFileCache: (file: TFile) => ({ frontmatter: protocolFrontmatterByPath.get(file.path) ?? {} }),
  },
} as unknown as App;

assert.equal(
  resolveManagedFileFromProtocol(
    protocolApp,
    protocolPathScope,
    { vault: "English Peng", kind: "word", id: "w-abandon", word: "abdicate" },
    () => [],
  ).file,
  protocolIdFile,
);

assert.equal(
  resolveManagedFileFromProtocol(
    protocolApp,
    protocolPathScope,
    { vault: "English Peng", kind: "word", id: "w-missing", word: "abdicate" },
    () => [],
  ).file,
  protocolFallbackFile,
);

const directPathProtocolApp = {
  vault: {
    getName: () => "English Peng",
    getMarkdownFiles: () => [],
    getFileByPath: (path: string) => (path === protocolFallbackFile.path ? protocolFallbackFile : null),
  },
  metadataCache: {
    getFileCache: () => null,
  },
} as unknown as App;
assert.equal(
  resolveManagedFileFromProtocol(
    directPathProtocolApp,
    protocolPathScope,
    { vault: "English Peng", kind: "word", id: "w-missing", word: "abdicate" },
    () => [],
  ).file,
  protocolFallbackFile,
);

const duplicateProtocolApp = {
  vault: {
    getName: () => "English Peng",
    getMarkdownFiles: () => [protocolFallbackFile, protocolDuplicateFile],
    getFileByPath: (path: string) => [protocolFallbackFile, protocolDuplicateFile].find((file) => file.path === path) ?? null,
  },
  metadataCache: {
    getFileCache: (file: TFile) => ({ frontmatter: protocolFrontmatterByPath.get(file.path) ?? {} }),
  },
} as unknown as App;
assert.match(
  resolveManagedFileFromProtocol(
    duplicateProtocolApp,
    protocolPathScope,
    { vault: "English Peng", kind: "word", id: "w-missing", word: "abdicate" },
    () => [protocolFallbackFile],
  ).error ?? "",
  /matched multiple word notes/,
);

assert.match(
  resolveManagedFileFromProtocol(
    protocolApp,
    protocolPathScope,
    { vault: "Other Vault", kind: "word", id: "w-abandon", word: "abdicate" },
  ).error ?? "",
  /Vault mismatch/,
);
assert.equal(
  resolveManagedFileFromProtocol(protocolApp, protocolPathScope, { vault: "English Peng", kind: "book", id: "w-abandon" })
    .error,
  "Invalid or missing managed link kind.",
);
assert.equal(
  resolveManagedFileFromProtocol(protocolApp, protocolPathScope, { vault: "English Peng", kind: "word" }).error,
  "Missing managed link id.",
);

const semanticResolverSettings = {
  ...DEFAULT_SETTINGS,
  wordFolder: "Eudic/Words",
  referenceFolder: "Eudic/References",
  enableSemanticBlockWordBold: true,
  semanticBlockWordBoldKinds: ["Cog.", "Syn."],
  enableSemanticBlockMarkerBold: true,
  boldMarkers: ["v.", "adv.", "a.", "=", "→"],
  enableSemanticBlockWordLinks: true,
  semanticBlockWordLinkKinds: ["Cog.", "Syn."],
};
const semanticReferenceFile = mockFile("Eudic/References/ref-20260425171733-0f.md");
const semanticLateReferenceFile = mockFile("Eudic/References/ref-late.md");
const semanticAboundFile = mockFile("Eudic/Words/abound.md");
const semanticAbundantlyFile = mockFile("Eudic/Words/abundantly.md");
const semanticDisabledFile = mockFile("Eudic/Words/disabled.md");
const semanticFiles = [semanticReferenceFile, semanticAboundFile, semanticAbundantlyFile, semanticDisabledFile];
const semanticFrontmatterByPath = new Map<string, Record<string, unknown>>([
  [
    semanticReferenceFile.path,
    {
      referenced_by: [semanticAboundFile.path],
    },
  ],
  [
    semanticAboundFile.path,
    {
      sync_eudic_enabled: true,
      eudic_link_id: "w-abound",
      reference_paths: ["References/ref-20260425171733-0f"],
    },
  ],
  [
    semanticAbundantlyFile.path,
    {
      sync_eudic_enabled: true,
      eudic_link_id: "w-abundantly",
      reference_paths: [],
    },
  ],
  [
    semanticDisabledFile.path,
    {
      sync_eudic_enabled: false,
      eudic_link_id: "w-disabled",
      reference_paths: ["References/ref-20260425171733-0f"],
    },
  ],
]);
const semanticMarkdownByPath = new Map<string, string>([
  [semanticReferenceFile.path, ""],
  [semanticAboundFile.path, "![[References/ref-20260425171733-0f#^ref-20260425171733-0f-main]]"],
  [semanticAbundantlyFile.path, "![[References/ref-20260425171733-0f#^ref-20260425171733-0f-main]]"],
  [semanticDisabledFile.path, "![[References/ref-20260425171733-0f#^ref-20260425171733-0f-main]]"],
]);
const semanticApp = {
  vault: {
    getName: () => "Test Vault",
    getMarkdownFiles: () => semanticFiles,
    getFileByPath: (path: string) => semanticFiles.find((file) => file.path === path) ?? null,
    cachedRead: async (file: TFile) => semanticMarkdownByPath.get(file.path) ?? "",
  },
  metadataCache: {
    getFileCache: (file: TFile) => ({ frontmatter: semanticFrontmatterByPath.get(file.path) ?? {} }),
    getFirstLinkpathDest: (linkpath: string) => {
      const normalized = linkpath.replace(/\.md$/i, "");
      if (normalized.endsWith("ref-20260425171733-0f")) {
        return semanticReferenceFile;
      }
      if (normalized.endsWith("ref-late") && semanticFiles.includes(semanticLateReferenceFile)) {
        return semanticLateReferenceFile;
      }
      return null;
    },
  },
} as unknown as App;
const semanticPathScope = {
  isWordPath: (path: string) => path.startsWith("Eudic/Words/"),
  isReferencePath: (path: string) => path.startsWith("Eudic/References/"),
  getPrimaryReferenceFolderPath: () => "Eudic/References",
  toStoredReferenceMarkdownStem: (path: string) => path.replace(/^Eudic\//, "").replace(/\.md$/i, ""),
  resolveStoredReferenceStemToVaultPath: (storedRef: string) => {
    const normalized = storedRef.replace(/\.md$/i, "");
    if (normalized.startsWith("References/")) {
      return `Eudic/${normalized}`;
    }
    if (normalized.startsWith("Eudic/References/")) {
      return normalized;
    }
    return null;
  },
} as never;
assert.equal(
  storedReferenceRefMatchesPath(
    semanticPathScope,
    "ref-20260425171733-0f",
    "Eudic/References/ref-20260425171733-0f.md",
  ),
  true,
);
assert.equal(
  storedReferenceRefMatchesPath(
    semanticPathScope,
    "References/ref-20260425171733-0f",
    "Eudic/References/ref-20260425171733-0f.md",
  ),
  true,
);
assert.equal(
  storedReferenceRefMatchesPath(
    semanticPathScope,
    "Eudic/References/ref-20260425171733-0f.md",
    "Eudic/References/ref-20260425171733-0f",
  ),
  true,
);
assert.deepEqual(
  collectReferenceUsageWordPaths(semanticPathScope, semanticReferenceFile.path, {
    indexedWordPaths: [semanticAboundFile.path],
    referencedByPaths: [semanticAbundantlyFile.path],
    wordReferenceRefs: [
      {
        wordPath: semanticAboundFile.path,
        storedRefs: ["References/ref-20260425171733-0f"],
      },
      {
        wordPath: semanticAbundantlyFile.path,
        storedRefs: ["References/ref-20260425171733-0f"],
      },
      {
        wordPath: "Eudic/Words/disabled.md",
        storedRefs: ["References/ref-20260425171733-0f"],
        syncDisabled: true,
      },
    ],
  }),
  [semanticAboundFile.path, semanticAbundantlyFile.path],
);
assert.deepEqual(
  collectReferenceUsageWordPaths(semanticPathScope, semanticReferenceFile.path, {
    referencedByPaths: ["Eudic/Words/stale.md"],
    wordReferenceRefs: [],
  }),
  [],
);
assert.deepEqual(
  collectReferenceUsageWordPaths(semanticPathScope, semanticReferenceFile.path, {
    mode: "render",
    referencedByPaths: [semanticAbundantlyFile.path],
    wordReferenceRefs: [],
  }),
  [semanticAbundantlyFile.path],
);
assert.deepEqual(
  collectReferenceUsageWordPaths(semanticPathScope, semanticReferenceFile.path, {
    wordReferenceRefs: [
      {
        wordPath: semanticAboundFile.path,
        storedRefs: [],
        textRefs: ["ref-20260425171733-0f"],
      },
    ],
  }),
  [semanticAboundFile.path],
);
const bareReferenceScope = {
  isReferencePath: (path: string) => path.startsWith("Eudic/References/"),
  getPrimaryReferenceFolderPath: () => "Eudic/References",
  resolveStoredReferenceStemToVaultPath: () => null,
} as never;
const bareReferenceFile = mockFile("Eudic/References/ref-bare.md");
const bareReferenceApp = {
  vault: {
    getFileByPath: (path: string) => (path === bareReferenceFile.path ? bareReferenceFile : null),
    getMarkdownFiles: () => [bareReferenceFile],
  },
  metadataCache: {
    getFirstLinkpathDest: () => null,
  },
} as unknown as App;
assert.equal(
  resolveManagedReferencePath(bareReferenceApp, bareReferenceScope, "Eudic/Words/abound.md", "ref-bare"),
  bareReferenceFile.path,
);
const semanticRegistry = new ManagedFileRegistry(semanticApp, semanticPathScope);
semanticRegistry.rebuild();
const semanticReferenceGraph = new ReferenceGraphService({
  app: semanticApp,
  pathScope: semanticPathScope,
  managedFiles: semanticRegistry,
  writeFrontmatter: async () => {
    throw new Error("Reference graph rebuild must not write legacy metadata.");
  },
});
const semanticColdResolver = new SemanticBlockAutomationResolver({
  app: semanticApp,
  pathScope: semanticPathScope,
  managedFiles: semanticRegistry,
  referenceIndex: semanticReferenceGraph,
  getSettings: () => semanticResolverSettings,
});
const semanticColdReferenceOptions = await semanticColdResolver.getTransformOptionsForSourcePath({
  sourcePath: semanticReferenceFile.path,
});
assert.ok(semanticColdReferenceOptions);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Cog.",
      "abound abundantly",
      "```",
    ].join("\n"),
    semanticColdReferenceOptions,
  ),
  "**Cog.** [abound](obsidian://eudic-sync?vault=Test%20Vault&kind=word&id=w-abound&word=abound) [abundantly](obsidian://eudic-sync?vault=Test%20Vault&kind=word&id=w-abundantly&word=abundantly)",
);
await semanticReferenceGraph.rebuildAll();
assert.deepEqual(
  semanticReferenceGraph.findWordsReferencing(semanticReferenceFile.path),
  [semanticAboundFile.path, semanticAbundantlyFile.path],
);
const semanticResolver = new SemanticBlockAutomationResolver({
  app: semanticApp,
  pathScope: semanticPathScope,
  managedFiles: semanticRegistry,
  referenceIndex: semanticReferenceGraph,
  getSettings: () => semanticResolverSettings,
});
const semanticResolvedReferenceOptions = await semanticResolver.getTransformOptionsForSourcePath({
  sourcePath: semanticReferenceFile.path,
  currentWordFile: semanticAboundFile,
});
assert.ok(semanticResolvedReferenceOptions);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Cog.",
      "abound v. **→** abundantly **adv.** 大量的；丰富的；",
      "- **abo**und **v.** **→** abundantly **adv.**",
      "\t- 大厦款斗篷看破开ab**ound**",
      "```",
    ].join("\n"),
    semanticResolvedReferenceOptions,
  ),
  [
    "**Cog.** [**abound**](obsidian://eudic-sync?vault=Test%20Vault&kind=word&id=w-abound&word=abound) **v.** **→** [abundantly](obsidian://eudic-sync?vault=Test%20Vault&kind=word&id=w-abundantly&word=abundantly) **adv.** 大量的；丰富的；",
    "",
    "- [**abo**und](obsidian://eudic-sync?vault=Test%20Vault&kind=word&id=w-abound&word=abound) **v.** **→** [abundantly](obsidian://eudic-sync?vault=Test%20Vault&kind=word&id=w-abundantly&word=abundantly) **adv.**",
    "\t- 大厦款斗篷看破开[ab**ound**](obsidian://eudic-sync?vault=Test%20Vault&kind=word&id=w-abound&word=abound)",
  ].join("\n"),
);
const semanticStandaloneReferenceOptions = await semanticResolver.getTransformOptionsForSourcePath({
  sourcePath: semanticReferenceFile.path,
});
assert.ok(semanticStandaloneReferenceOptions);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Cog.",
      "abound abundantly",
      "```",
    ].join("\n"),
    semanticStandaloneReferenceOptions,
  ),
  "**Cog.** [abound](obsidian://eudic-sync?vault=Test%20Vault&kind=word&id=w-abound&word=abound) [abundantly](obsidian://eudic-sync?vault=Test%20Vault&kind=word&id=w-abundantly&word=abundantly)",
);

const semanticUnrelatedWordFile = mockFile("Eudic/Words/unrelated.md");
semanticFiles.push(semanticUnrelatedWordFile);
semanticFrontmatterByPath.set(semanticUnrelatedWordFile.path, {
  sync_eudic_enabled: true,
  eudic_link_id: "w-unrelated",
  reference_paths: [],
});
semanticMarkdownByPath.set(semanticUnrelatedWordFile.path, "");
semanticRegistry.update(semanticUnrelatedWordFile);
await semanticReferenceGraph.updateWord(semanticUnrelatedWordFile);
const semanticUnrelatedReferenceOptions = await semanticResolver.getTransformOptionsForSourcePath({
  sourcePath: semanticReferenceFile.path,
  currentWordFile: semanticUnrelatedWordFile,
});
assert.ok(semanticUnrelatedReferenceOptions);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Cog.",
      "unrelated abound abundantly",
      "```",
    ].join("\n"),
    semanticUnrelatedReferenceOptions,
  ),
  "**Cog.** **unrelated** [abound](obsidian://eudic-sync?vault=Test%20Vault&kind=word&id=w-abound&word=abound) [abundantly](obsidian://eudic-sync?vault=Test%20Vault&kind=word&id=w-abundantly&word=abundantly)",
);

semanticFiles.push(semanticLateReferenceFile);
semanticFrontmatterByPath.set(semanticLateReferenceFile.path, {});
semanticMarkdownByPath.set(semanticUnrelatedWordFile.path, "![[References/ref-late#^ref-late-main]]");
semanticRegistry.update(semanticLateReferenceFile);
const semanticLateLookup = await semanticReferenceGraph.findWordsReferencingWithFallback(
  semanticLateReferenceFile.path,
  { forceScan: true },
);
assert.deepEqual(semanticLateLookup.wordPaths, [semanticUnrelatedWordFile.path]);
assert.deepEqual(
  semanticReferenceGraph.findWordsReferencing(semanticLateReferenceFile.path),
  [semanticUnrelatedWordFile.path],
);

const absurdReferenceFile = mockFile("Eudic/References/ref-20260506172233-zz.md");
const absurdWordFile = mockFile("Eudic/Words/absurd.md");
const ridiculousWordFile = mockFile("Eudic/Words/ridiculous.md");
const ludicrousWordFile = mockFile("Eudic/Words/ludicrous.md");
const absurdFiles = [absurdReferenceFile, absurdWordFile, ridiculousWordFile, ludicrousWordFile];
const absurdFrontmatterByPath = new Map<string, Record<string, unknown>>([
  [
    absurdReferenceFile.path,
    {
      ref_count: 0,
      referenced_by: [],
      referenced_by_links: [],
    },
  ],
  [
    absurdWordFile.path,
    {
      sync_eudic_enabled: true,
      eudic_link_id: "w-absurd",
      reference_paths: ["References/stale-ref"],
    },
  ],
  [
    ridiculousWordFile.path,
    {
      sync_eudic_enabled: true,
      eudic_link_id: "w-ridiculous",
    },
  ],
  [
    ludicrousWordFile.path,
    {
      sync_eudic_enabled: true,
      eudic_link_id: "w-ludicrous",
    },
  ],
]);
const absurdMarkdownByPath = new Map<string, string>([
  [absurdWordFile.path, "![[References/ref-20260506172233-zz#^ref-20260506172233-zz-main]]"],
  [ridiculousWordFile.path, "![[References/ref-20260506172233-zz#^ref-20260506172233-zz-main]]"],
  [ludicrousWordFile.path, "![[References/ref-20260506172233-zz#^ref-20260506172233-zz-main]]"],
]);
const absurdApp = {
  vault: {
    getName: () => "English Peng",
    getMarkdownFiles: () => absurdFiles,
    getFileByPath: (path: string) => absurdFiles.find((file) => file.path === path) ?? null,
    cachedRead: async (file: TFile) => absurdMarkdownByPath.get(file.path) ?? "",
  },
  metadataCache: {
    getFileCache: (file: TFile) => ({ frontmatter: absurdFrontmatterByPath.get(file.path) ?? {} }),
    getFirstLinkpathDest: (linkpath: string) =>
      linkpath.includes("ref-20260506172233-zz") ? absurdReferenceFile : null,
  },
} as unknown as App;
const absurdPathScope = {
  isWordPath: (path: string) => path.startsWith("Eudic/Words/"),
  isReferencePath: (path: string) => path.startsWith("Eudic/References/"),
  getPrimaryReferenceFolderPath: () => "Eudic/References",
  toStoredReferenceMarkdownStem: (path: string) => path.replace(/^Eudic\//, "").replace(/\.md$/i, ""),
  resolveStoredReferenceStemToVaultPath: (storedRef: string) => {
    const normalized = storedRef.replace(/\.md$/i, "");
    if (normalized.startsWith("References/")) {
      return `Eudic/${normalized}`;
    }
    if (normalized.startsWith("Eudic/References/")) {
      return normalized;
    }
    return null;
  },
} as never;
const absurdRegistry = new ManagedFileRegistry(absurdApp, absurdPathScope);
absurdRegistry.rebuild();
const expectedAbsurdSynMarkdown =
  "**Syn.** [**absurd**](obsidian://eudic-sync?vault=English%20Peng&kind=word&id=w-absurd&word=absurd) **=** [ridiculous](obsidian://eudic-sync?vault=English%20Peng&kind=word&id=w-ridiculous&word=ridiculous) **=** [ludicrous](obsidian://eudic-sync?vault=English%20Peng&kind=word&id=w-ludicrous&word=ludicrous) **a.** 荒谬的";
const absurdPartialReferenceGraph = new ReferenceGraphService({
  app: absurdApp,
  pathScope: absurdPathScope,
  managedFiles: absurdRegistry,
  writeFrontmatter: async () => {
    throw new Error("Reference graph render fallback must not write legacy metadata.");
  },
});
await absurdPartialReferenceGraph.updateWord(absurdWordFile);
assert.deepEqual(
  absurdPartialReferenceGraph.findWordsReferencing(absurdReferenceFile.path),
  [absurdWordFile.path],
);
const absurdPartialResolver = new SemanticBlockAutomationResolver({
  app: absurdApp,
  pathScope: absurdPathScope,
  managedFiles: absurdRegistry,
  referenceIndex: absurdPartialReferenceGraph,
  getSettings: () => semanticResolverSettings,
});
const absurdPartialReferenceOptions = await absurdPartialResolver.getTransformOptionsForSourcePath({
  sourcePath: absurdReferenceFile.path,
  currentWordFile: absurdWordFile,
  currentWord: "absurd",
  currentWordLinkId: "w-absurd",
});
assert.ok(absurdPartialReferenceOptions);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Syn.",
      "absurd = ridiculous = ludicrous a. 荒谬的",
      "```",
    ].join("\n"),
    absurdPartialReferenceOptions,
  ),
  expectedAbsurdSynMarkdown,
);
assert.deepEqual(
  absurdPartialReferenceGraph.findWordsReferencing(absurdReferenceFile.path),
  [absurdWordFile.path, ludicrousWordFile.path, ridiculousWordFile.path],
);
absurdFrontmatterByPath.set(absurdReferenceFile.path, {
  ref_count: 1,
  referenced_by: [absurdWordFile.path],
  referenced_by_links: ["[[Eudic/Words/absurd.md|absurd]]"],
});
const absurdRepairReferenceGraph = new ReferenceGraphService({
  app: absurdApp,
  pathScope: absurdPathScope,
  managedFiles: absurdRegistry,
  writeFrontmatter: async (file, mutate) => {
    const frontmatter = {
      ...(absurdFrontmatterByPath.get(file.path) ?? {}),
    };
    mutate(frontmatter);
    absurdFrontmatterByPath.set(file.path, frontmatter);
  },
  getReferenceMetadataWriteMode: () => "auto",
});
const absurdRepairResult = await absurdRepairReferenceGraph.repairReferenceMetadataForReference(absurdReferenceFile.path);
assert.equal(absurdRepairResult.scannedWordCount, 3);
assert.deepEqual(absurdRepairResult.wordPaths, [
  absurdWordFile.path,
  ludicrousWordFile.path,
  ridiculousWordFile.path,
]);
assert.deepEqual(absurdRepairResult.affectedWordPaths, [
  absurdWordFile.path,
  ludicrousWordFile.path,
  ridiculousWordFile.path,
]);
assert.equal(absurdRepairResult.wordMetadataUpdated, 3);
assert.equal(absurdRepairResult.referenceMetadataUpdated, 1);
assert.deepEqual(absurdFrontmatterByPath.get(absurdReferenceFile.path)?.referenced_by, [
  absurdWordFile.path,
  ludicrousWordFile.path,
  ridiculousWordFile.path,
]);
assert.deepEqual(absurdFrontmatterByPath.get(absurdReferenceFile.path)?.referenced_by_links, [
  "[[Eudic/Words/absurd.md|absurd]]",
  "[[Eudic/Words/ludicrous.md|ludicrous]]",
  "[[Eudic/Words/ridiculous.md|ridiculous]]",
]);
assert.equal(absurdFrontmatterByPath.get(absurdReferenceFile.path)?.ref_count, 3);
assert.deepEqual(absurdFrontmatterByPath.get(absurdWordFile.path)?.reference_paths, [
  "References/ref-20260506172233-zz",
]);
assert.deepEqual(absurdFrontmatterByPath.get(ridiculousWordFile.path)?.reference_paths, [
  "References/ref-20260506172233-zz",
]);
assert.deepEqual(absurdFrontmatterByPath.get(ludicrousWordFile.path)?.reference_paths, [
  "References/ref-20260506172233-zz",
]);
let unexpectedReferenceRefreshWrites = 0;
const absurdNoopRefreshGraph = new ReferenceGraphService({
  app: absurdApp,
  pathScope: absurdPathScope,
  managedFiles: absurdRegistry,
  writeFrontmatter: async () => {
    unexpectedReferenceRefreshWrites += 1;
  },
  getReferenceMetadataWriteMode: () => "auto",
});
const absurdNoopRefreshResult = await absurdNoopRefreshGraph.refreshReferenceUsage();
assert.equal(unexpectedReferenceRefreshWrites, 0);
assert.equal(absurdNoopRefreshResult.scannedWordCount, 0);
assert.equal(absurdNoopRefreshResult.referenceMetadataUpdated, 0);
const absurdAdapterFrontmatterByPath = new Map<string, Record<string, unknown>>(
  Array.from(absurdFrontmatterByPath.entries()).map(([path, frontmatter]) => [path, { ...frontmatter }]),
);
absurdAdapterFrontmatterByPath.set(absurdReferenceFile.path, {
  ref_count: 0,
  referenced_by: [],
  referenced_by_links: [],
});
const absurdAdapterLimitedApp = {
  vault: {
    getName: () => "English Peng",
    getMarkdownFiles: () => [absurdReferenceFile, absurdWordFile],
    getFileByPath: (path: string) => absurdFiles.find((file) => file.path === path) ?? null,
    getAbstractFileByPath: (path: string) => absurdFiles.find((file) => file.path === path) ?? null,
    cachedRead: async (file: TFile) => absurdMarkdownByPath.get(file.path) ?? "",
    adapter: {
      list: async (folder: string) => {
        if (folder === "Eudic/Words") {
          return {
            files: [absurdWordFile.path, ridiculousWordFile.path, ludicrousWordFile.path],
            folders: [],
          };
        }
        return { files: [], folders: [] };
      },
    },
  },
  metadataCache: {
    getFileCache: (file: TFile) => ({ frontmatter: absurdAdapterFrontmatterByPath.get(file.path) ?? {} }),
    getFirstLinkpathDest: (linkpath: string) =>
      linkpath.includes("ref-20260506172233-zz") ? absurdReferenceFile : null,
  },
} as unknown as App;
const absurdAdapterPathScope = {
  ...absurdPathScope,
  getWordFolderPath: () => "Eudic/Words",
  getReferenceFolderPath: () => "Eudic/References",
} as never;
const absurdAdapterLimitedRegistry = new ManagedFileRegistry(absurdAdapterLimitedApp, absurdAdapterPathScope);
absurdAdapterLimitedRegistry.rebuild();
assert.equal(absurdAdapterLimitedRegistry.getWordFiles().length, 1);
const absurdAdapterRepairGraph = new ReferenceGraphService({
  app: absurdAdapterLimitedApp,
  pathScope: absurdAdapterPathScope,
  managedFiles: absurdAdapterLimitedRegistry,
  writeFrontmatter: async (file, mutate) => {
    const frontmatter = {
      ...(absurdAdapterFrontmatterByPath.get(file.path) ?? {}),
    };
    mutate(frontmatter);
    absurdAdapterFrontmatterByPath.set(file.path, frontmatter);
  },
  getReferenceMetadataWriteMode: () => "auto",
});
const absurdAdapterRepairResult = await absurdAdapterRepairGraph.repairReferenceMetadataForReference(
  absurdReferenceFile.path,
);
assert.equal(absurdAdapterRepairResult.scannedWordCount, 3);
assert.deepEqual(absurdAdapterRepairResult.wordPaths, [
  absurdWordFile.path,
  ludicrousWordFile.path,
  ridiculousWordFile.path,
]);
assert.equal(absurdAdapterRepairResult.referenceMetadataUpdated, 1);
assert.deepEqual(absurdAdapterFrontmatterByPath.get(absurdReferenceFile.path)?.referenced_by, [
  absurdWordFile.path,
  ludicrousWordFile.path,
  ridiculousWordFile.path,
]);
const absurdReferenceGraph = new ReferenceGraphService({
  app: absurdApp,
  pathScope: absurdPathScope,
  managedFiles: absurdRegistry,
  writeFrontmatter: async () => {
    throw new Error("Reference graph rebuild must not write legacy metadata.");
  },
});
await absurdReferenceGraph.rebuildAll();
assert.deepEqual(
  absurdReferenceGraph.findWordsReferencing(absurdReferenceFile.path),
  [absurdWordFile.path, ludicrousWordFile.path, ridiculousWordFile.path],
);
const absurdResolver = new SemanticBlockAutomationResolver({
  app: absurdApp,
  pathScope: absurdPathScope,
  managedFiles: absurdRegistry,
  referenceIndex: absurdReferenceGraph,
  getSettings: () => semanticResolverSettings,
});
const absurdReferenceOptions = await absurdResolver.getTransformOptionsForSourcePath({
  sourcePath: absurdReferenceFile.path,
  currentWordFile: absurdWordFile,
  currentWord: "absurd",
  currentWordLinkId: "w-absurd",
});
assert.ok(absurdReferenceOptions);
assert.equal(
  transformEudicBlocksToMarkdown(
    [
      "```eudic-block kind=Syn.",
      "absurd = ridiculous = ludicrous a. 荒谬的",
      "```",
    ].join("\n"),
    absurdReferenceOptions,
  ),
  expectedAbsurdSynMarkdown,
);

const remoteMetaNote = serializeEudicMetaFilesEnvelope(
  {
    text: "",
    comment: "<b>old</b>",
    image_list: [{ id: "img-1", type: "image" }],
    voice_list: [{ id: "voice-1", type: "voice" }],
    custom_field: { keep: true },
  },
  "<b>old</b>",
);
const nextHtml = "<b>new -- body</b>";
const parsedRemoteMeta = parseEudicMetaFilesEnvelope(remoteMetaNote);
assert.ok(parsedRemoteMeta);
assert.throws(
  () => buildAttachmentPreservingNotePayload(remoteMetaNote, nextHtml),
  /contains image\/audio\/file attachments/,
);
assert.deepEqual(parsedRemoteMeta?.meta.image_list, [{ id: "img-1", type: "image" }]);
assert.deepEqual(parsedRemoteMeta?.meta.voice_list, [{ id: "voice-1", type: "voice" }]);
assert.deepEqual(parsedRemoteMeta?.meta.custom_field, { keep: true });
const serializedRemoteMeta = serializeEudicMetaFilesEnvelope(parsedRemoteMeta.meta, parsedRemoteMeta.body);
assert.ok(!serializedRemoteMeta.slice("<!--meta files ".length, serializedRemoteMeta.indexOf(" -->")).includes("--"));

assert.equal(buildAttachmentPreservingNotePayload(null, nextHtml), nextHtml);
assert.equal(buildAttachmentPreservingNotePayload("<b>plain</b>", nextHtml), nextHtml);
const remoteMetaNoteWithoutAttachments = serializeEudicMetaFilesEnvelope(
  {
    text: "",
    comment: "<b>old</b>",
    font_style: "normal",
    public_status: 0,
  },
  "<b>old</b>",
);
assert.equal(buildAttachmentPreservingNotePayload(remoteMetaNoteWithoutAttachments, nextHtml), nextHtml);
assert.throws(
  () => buildAttachmentPreservingNotePayload('<!--meta files {"comment":"oops"} <b>broken</b>', nextHtml),
  /Malformed Eudic note metadata envelope/,
);

const nestedRemoteMetaNote = serializeEudicMetaFilesEnvelope(
  {
    text: "",
    comment: remoteMetaNote,
    font_style: "normal",
    public_status: 0,
  },
  remoteMetaNote,
);
const parsedNestedRemoteMeta = parseEudicMetaFilesEnvelope(nestedRemoteMetaNote);
assert.ok(parsedNestedRemoteMeta);
assert.equal(parsedNestedRemoteMeta?.body, remoteMetaNote);
assert.throws(
  () => buildAttachmentPreservingNotePayload(nestedRemoteMetaNote, nextHtml),
  /contains image\/audio\/file attachments/,
);
assert.equal(unwrapEudicMetaFilesBody(nestedRemoteMetaNote), "<b>old</b>");

const accidentalEnvelopeHtml = serializeEudicMetaFilesEnvelope({ comment: "old" }, nextHtml);
assert.equal(buildAttachmentPreservingNotePayload(remoteMetaNoteWithoutAttachments, accidentalEnvelopeHtml), nextHtml);

const mcpMessages = parseMcpSseJsonMessages(
  [
    "event: message",
    'data: {"result":{"content":[{"type":"text","text":"{\\"category_ids\\":[0,\\"1649216757\\"],\\"word\\":\\"abound\\"}"}]},"id":1,"jsonrpc":"2.0"}',
    "",
  ].join("\n"),
);
assert.equal(mcpMessages.length, 1);
assert.deepEqual(parseMcpToolJsonResult(mcpMessages[0]), {
  category_ids: [0, "1649216757"],
  word: "abound",
});

const unsafeIntegerMcpMessages = parseMcpSseJsonMessages(
  [
    "event: message",
    'data: {"result":{"content":[{"type":"text","text":"{\\"category_ids\\":[0,134223429171042864],\\"word\\":\\"abide\\"}"}]},"id":1,"jsonrpc":"2.0"}',
    "",
  ].join("\n"),
);
assert.deepEqual(parseMcpToolJsonResult(unsafeIntegerMcpMessages[0]), {
  category_ids: [0, "134223429171042864"],
  word: "abide",
});

assert.deepEqual(
  parseMcpSseJsonMessages('{"result":{"content":[{"type":"text","text":"{\\"data\\":[]}"}]}}'),
  [
    {
      result: {
        content: [
          {
            type: "text",
            text: '{"data":[]}',
          },
        ],
      },
    },
  ],
);

assert.throws(
  () => parseMcpToolJsonResult({ error: { code: -32602, message: "bad arguments" } }),
  /Eudic MCP error \(-32602\): bad arguments/,
);

let studylistCache: EudicStudylistCache = {
  categories: [
    {
      id: "0",
      language: "en",
      name: "略｜我的生词本",
    },
  ],
  refreshedAt: "2026-04-27T01:06:44+08:00",
};
let categoryFetchCount = 0;
const catalogResolver = new StudylistCatalogResolver({
  getCache: () => studylistCache,
  setCache: async (cache) => {
    studylistCache = cache;
  },
  fetchCategories: async (language) => {
    categoryFetchCount += 1;
    return [
      {
        id: "0",
        language,
        name: "略｜我的生词本",
      },
      {
        id: "134223429171042864",
        language,
        name: "Obsidian Sync",
      },
    ];
  },
});

const resolvedObsidianSync = await catalogResolver.resolveIdsFromNames("en", [
  "Obsidian Sync",
  "略｜我的生词本",
]);
assert.equal(categoryFetchCount, 1);
assert.deepEqual(resolvedObsidianSync.ids, ["134223429171042864", "0"]);
assert.deepEqual(resolvedObsidianSync.names, ["Obsidian Sync", "略｜我的生词本"]);
assert.deepEqual(resolvedObsidianSync.unknownNames, []);
assert.equal(resolvedObsidianSync.refreshed, true);

const resolvedAssignmentFromNames = await catalogResolver.resolveAssignment("en", {
  ids: [],
  names: ["Obsidian Sync"],
});
assert.deepEqual(resolvedAssignmentFromNames.ids, ["134223429171042864"]);
assert.deepEqual(resolvedAssignmentFromNames.names, ["Obsidian Sync"]);
assert.deepEqual(resolvedAssignmentFromNames.unknownNames, []);
assert.deepEqual(resolvedAssignmentFromNames.unknownIds, []);

const resolvedConflictingAssignment = await catalogResolver.resolveAssignment("en", {
  ids: ["0"],
  names: ["Obsidian Sync"],
});
assert.deepEqual(resolvedConflictingAssignment.ids, ["134223429171042864"]);
assert.deepEqual(resolvedConflictingAssignment.names, ["Obsidian Sync"]);

const resolvedUnknownStudylist = await catalogResolver.resolveIdsFromNames("en", ["Missing List"]);
assert.deepEqual(resolvedUnknownStudylist.ids, []);
assert.deepEqual(resolvedUnknownStudylist.names, ["Missing List"]);
assert.deepEqual(resolvedUnknownStudylist.unknownNames, ["Missing List"]);

studylistCache = {
  categories: [
    {
      id: "0",
      language: "en",
      name: "略｜我的生词本",
    },
  ],
  refreshedAt: "2026-04-27T01:06:44+08:00",
};
const namesAfterRefresh = await catalogResolver.getNamesForIds("en", ["0", "134223429171042864"], true);
assert.deepEqual(namesAfterRefresh, ["略｜我的生词本", "Obsidian Sync"]);

const resolvedAssignmentFromIds = await catalogResolver.resolveAssignment("en", {
  ids: ["134223429171042864"],
  names: [],
});
assert.deepEqual(resolvedAssignmentFromIds.ids, ["134223429171042864"]);
assert.deepEqual(resolvedAssignmentFromIds.names, ["Obsidian Sync"]);
assert.deepEqual(resolvedAssignmentFromIds.unknownIds, []);

const resolvedUnknownIdAssignment = await catalogResolver.resolveAssignment("en", {
  ids: ["999999"],
  names: [],
});
assert.deepEqual(resolvedUnknownIdAssignment.ids, ["999999"]);
assert.deepEqual(resolvedUnknownIdAssignment.names, ["999999"]);
assert.deepEqual(resolvedUnknownIdAssignment.unknownIds, ["999999"]);
