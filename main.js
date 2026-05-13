"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => EudicSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian16 = require("obsidian");

// src/auto-bold-markers-extension.ts
var import_view = require("@codemirror/view");
var import_obsidian = require("obsidian");

// src/markdown-marker-formatting.ts
var URL_PATTERN = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>()]+/g;
var EUDIC_BLOCK_OPENING_FENCE_PATTERN = /^(\s*)(`{3,}|~{3,})\s*eudic-block(?:\s+(.*?))?\s*$/;
function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function parseEudicBlockFenceToken(line) {
  const match = line.match(EUDIC_BLOCK_OPENING_FENCE_PATTERN);
  if (!match) {
    return null;
  }
  const args = (match[3] ?? "").trim();
  if (!/\bkind=/.test(args)) {
    return null;
  }
  return match[2] ?? null;
}
function isClosingEudicBlockFenceLine(line, fenceToken) {
  const escapedMarker = escapeForRegex(fenceToken[0] ?? "`");
  return new RegExp(`^\\s*${escapedMarker}{${fenceToken.length},}\\s*$`).test(line);
}
function normalizeBoldMarkers(markers) {
  const seen = /* @__PURE__ */ new Set();
  const normalized = [];
  for (const marker of markers) {
    const trimmed = marker.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized.sort((left, right) => right.length - left.length);
}
function isWordCharacter(value) {
  return /[A-Za-z0-9_]/.test(value);
}
function rangeOverlaps(ranges, from, to) {
  return ranges.some((range) => from < range.to && to > range.from);
}
function findContainingRange(ranges, index) {
  return ranges.find((range) => index >= range.from && index < range.to) ?? null;
}
function collectYamlFrontmatterRange(markdown, ranges) {
  const match = markdown.match(/^---\s*\n[\s\S]*?\n---(?:\s*\n|$)/);
  if (!match) {
    return;
  }
  ranges.push({ from: 0, to: match[0].length });
}
function collectInlineRegexRanges(markdown, pattern, ranges) {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(markdown); match; match = pattern.exec(markdown)) {
    ranges.push({
      from: match.index,
      to: match.index + match[0].length
    });
  }
}
function collectFencedCodeRanges(markdown, ranges, options) {
  const lines = markdown.split(/(\n)/);
  let offset = 0;
  let genericFenceStart = null;
  let genericFenceMarker = null;
  let eudicBlockFenceToken = null;
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index] ?? "";
    const newline = lines[index + 1] ?? "";
    const lineWithNewline = `${line}${newline}`;
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (genericFenceStart !== null) {
      if (fenceMatch && genericFenceMarker === fenceMatch[1][0]) {
        ranges.push({ from: genericFenceStart, to: offset + lineWithNewline.length });
        genericFenceStart = null;
        genericFenceMarker = null;
      }
      offset += lineWithNewline.length;
      continue;
    }
    if (eudicBlockFenceToken !== null) {
      if (isClosingEudicBlockFenceLine(line, eudicBlockFenceToken)) {
        ranges.push({ from: offset, to: offset + lineWithNewline.length });
        eudicBlockFenceToken = null;
      }
      offset += lineWithNewline.length;
      continue;
    }
    if (options.protectEudicBlockFences) {
      const eudicFenceToken = parseEudicBlockFenceToken(line);
      if (eudicFenceToken) {
        ranges.push({ from: offset, to: offset + lineWithNewline.length });
        eudicBlockFenceToken = eudicFenceToken;
        offset += lineWithNewline.length;
        continue;
      }
    }
    if (fenceMatch) {
      genericFenceStart = offset;
      genericFenceMarker = fenceMatch[1][0];
    }
    offset += lineWithNewline.length;
  }
  if (genericFenceStart !== null) {
    ranges.push({ from: genericFenceStart, to: markdown.length });
  }
}
function mergeRanges(ranges) {
  const sorted = ranges.filter((range) => range.to > range.from).sort((left, right) => left.from - right.from || left.to - right.to);
  const merged = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.from > previous.to) {
      merged.push({ ...range });
      continue;
    }
    previous.to = Math.max(previous.to, range.to);
  }
  return merged;
}
function getProtectedRanges(markdown, options = {}) {
  const resolved = {
    protectYamlFrontmatter: options.protectYamlFrontmatter ?? true,
    protectEudicBlockFences: options.protectEudicBlockFences ?? true,
    protectMarkdownEmphasis: options.protectMarkdownEmphasis ?? true
  };
  const ranges = [];
  if (resolved.protectYamlFrontmatter) {
    collectYamlFrontmatterRange(markdown, ranges);
  }
  collectFencedCodeRanges(markdown, ranges, resolved);
  collectInlineRegexRanges(markdown, /`[^`\n]+`/g, ranges);
  if (resolved.protectMarkdownEmphasis) {
    collectInlineRegexRanges(markdown, /\*\*[\s\S]*?\*\*/g, ranges);
    collectInlineRegexRanges(markdown, /__[\s\S]*?__/g, ranges);
  }
  collectInlineRegexRanges(markdown, /<\s*(?:b|strong)\b[^>]*>[\s\S]*?<\s*\/\s*(?:b|strong)\s*>/gi, ranges);
  collectInlineRegexRanges(markdown, /<\s*a\b[^>]*>[\s\S]*?<\s*\/\s*a\s*>/gi, ranges);
  collectInlineRegexRanges(markdown, /!?\[[^\]\n]*\]\([^) \n]*(?: [^)\n]*)?\)/g, ranges);
  collectInlineRegexRanges(markdown, /\[\[[^\]\n]+\]\]/g, ranges);
  collectInlineRegexRanges(markdown, /<\/?[A-Za-z][^>\n]*>/g, ranges);
  collectInlineRegexRanges(markdown, URL_PATTERN, ranges);
  return mergeRanges(ranges);
}
function isMarkerMatch(markdown, index, marker, protectedRanges) {
  const end = index + marker.length;
  if (!markdown.startsWith(marker, index)) {
    return false;
  }
  if (rangeOverlaps(protectedRanges, index, end)) {
    return false;
  }
  const previous = index > 0 ? markdown[index - 1] ?? "" : "";
  const next = end < markdown.length ? markdown[end] ?? "" : "";
  if (isWordCharacter(previous) || isWordCharacter(next)) {
    return false;
  }
  return true;
}
function formatBoldMarkersInMarkdownWithOptions(markdown, markers, options = {}) {
  const normalizedMarkers = normalizeBoldMarkers(markers);
  if (normalizedMarkers.length === 0 || markdown.length === 0) {
    return {
      markdown,
      changed: false,
      replacements: 0
    };
  }
  const protectedRanges = getProtectedRanges(markdown, options);
  let output = "";
  let replacements = 0;
  let index = 0;
  while (index < markdown.length) {
    const protectedRange = findContainingRange(protectedRanges, index);
    if (protectedRange) {
      output += markdown.slice(index, protectedRange.to);
      index = protectedRange.to;
      continue;
    }
    const marker = normalizedMarkers.find(
      (candidate) => isMarkerMatch(markdown, index, candidate, protectedRanges)
    );
    if (marker) {
      output += `**${marker}**`;
      index += marker.length;
      replacements += 1;
      continue;
    }
    output += markdown[index] ?? "";
    index += 1;
  }
  return {
    markdown: output,
    changed: replacements > 0,
    replacements
  };
}

// src/markdown-bold-markers.ts
function formatBoldMarkersInMarkdown(markdown, markers) {
  return formatBoldMarkersInMarkdownWithOptions(markdown, markers, {
    protectYamlFrontmatter: true,
    protectEudicBlockFences: true
  });
}
function findAutoBoldMarkerEdit(input) {
  const { markdown, from, to, insertedText } = input;
  const markers = normalizeBoldMarkers(input.markers);
  if (markers.length === 0 || insertedText.length === 0) {
    return null;
  }
  if (from === to && insertedText.length === 1 && !/\r|\n/.test(insertedText)) {
    const singleCharacterEdit = findSingleCharacterAutoBoldEdit(markdown, from, to, insertedText, markers);
    if (singleCharacterEdit) {
      return singleCharacterEdit;
    }
  }
  return findInsertedRangeAutoBoldEdit(markdown, from, to, insertedText, markers);
}
function findSingleCharacterAutoBoldEdit(markdown, from, to, insertedText, markers) {
  const nextMarkdown = `${markdown.slice(0, from)}${insertedText}${markdown.slice(to)}`;
  const cursor = from + insertedText.length;
  const protectedRanges = getProtectedRanges(nextMarkdown, {
    protectYamlFrontmatter: true,
    protectEudicBlockFences: true
  });
  for (const marker of markers) {
    const markerStart = cursor - marker.length;
    if (markerStart < 0 || markerStart > from) {
      continue;
    }
    const candidate = `${markdown.slice(markerStart, from)}${insertedText}`;
    if (candidate !== marker) {
      continue;
    }
    if (!isMarkerMatch(nextMarkdown, markerStart, marker, protectedRanges)) {
      continue;
    }
    return {
      from: markerStart,
      to,
      text: `**${marker}**`,
      replacements: 1
    };
  }
  return null;
}
function findInsertedRangeAutoBoldEdit(markdown, from, to, insertedText, markers) {
  const nextMarkdown = `${markdown.slice(0, from)}${insertedText}${markdown.slice(to)}`;
  const insertedFrom = from;
  const insertedTo = from + insertedText.length;
  const maxMarkerLength = markers[0]?.length ?? 0;
  const replaceFrom = Math.max(0, insertedFrom - Math.max(0, maxMarkerLength - 1));
  const replaceTo = Math.min(nextMarkdown.length, insertedTo + Math.max(0, maxMarkerLength - 1));
  const protectedRanges = getProtectedRanges(nextMarkdown, {
    protectYamlFrontmatter: true,
    protectEudicBlockFences: true
  });
  let output = "";
  let replacements = 0;
  let index = replaceFrom;
  while (index < replaceTo) {
    const protectedRange = findContainingRange(protectedRanges, index);
    if (protectedRange) {
      const protectedTo = Math.min(protectedRange.to, replaceTo);
      output += nextMarkdown.slice(index, protectedTo);
      index = protectedTo;
      continue;
    }
    const marker = markers.find(
      (candidate) => isMarkerMatch(nextMarkdown, index, candidate, protectedRanges) && rangesIntersect(index, index + candidate.length, insertedFrom, insertedTo)
    );
    if (marker) {
      output += `**${marker}**`;
      index += marker.length;
      replacements += 1;
      continue;
    }
    output += nextMarkdown[index] ?? "";
    index += 1;
  }
  if (replacements === 0) {
    return null;
  }
  const finalMarkdown = `${nextMarkdown.slice(0, replaceFrom)}${output}${nextMarkdown.slice(replaceTo)}`;
  return createMinimalDocumentEdit(markdown, finalMarkdown, replacements);
}
function createMinimalDocumentEdit(originalMarkdown, nextMarkdown, replacements) {
  if (originalMarkdown === nextMarkdown) {
    return null;
  }
  let prefixLength = 0;
  const maxPrefixLength = Math.min(originalMarkdown.length, nextMarkdown.length);
  while (prefixLength < maxPrefixLength && originalMarkdown[prefixLength] === nextMarkdown[prefixLength]) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  const maxSuffixLength = Math.min(originalMarkdown.length - prefixLength, nextMarkdown.length - prefixLength);
  while (suffixLength < maxSuffixLength && originalMarkdown[originalMarkdown.length - 1 - suffixLength] === nextMarkdown[nextMarkdown.length - 1 - suffixLength]) {
    suffixLength += 1;
  }
  return {
    from: prefixLength,
    to: originalMarkdown.length - suffixLength,
    text: nextMarkdown.slice(prefixLength, nextMarkdown.length - suffixLength),
    replacements
  };
}
function rangesIntersect(leftFrom, leftTo, rightFrom, rightTo) {
  return leftFrom < rightTo && leftTo > rightFrom;
}

// src/auto-bold-markers-extension.ts
function createAutoBoldMarkersExtension(options) {
  return import_view.EditorView.inputHandler.of((view, from, to, text) => {
    const settings = options.getSettings();
    if (!settings.enableAutoBoldMarkersOnEdit || settings.boldMarkers.length === 0) {
      return false;
    }
    const info = view.state.field(import_obsidian.editorInfoField, false);
    const file = info?.file;
    if (!file || file.extension !== "md") {
      return false;
    }
    if (!options.pathScope.isWordPath(file.path) && !options.pathScope.isReferencePath(file.path)) {
      return false;
    }
    const edit = findAutoBoldMarkerEdit({
      markdown: view.state.doc.toString(),
      from,
      to,
      insertedText: text,
      markers: settings.boldMarkers
    });
    if (!edit) {
      return false;
    }
    const userEvent = text.length > 1 || /\r|\n/.test(text) || from !== to ? "input.paste" : "input.type";
    view.dispatch({
      changes: {
        from: edit.from,
        to: edit.to,
        insert: edit.text
      },
      selection: {
        anchor: edit.from + edit.text.length
      },
      userEvent
    });
    return true;
  });
}

// src/command-controller.ts
var import_obsidian2 = require("obsidian");

// src/word-status.ts
function getEffectiveWordStatus(bodyStatus, studylistStatus) {
  return bodyStatus === "dirty" || studylistStatus === "dirty" ? "dirty" : "synced";
}
function getStatusIcon(status) {
  switch (status) {
    case "dirty":
      return "cloud-alert";
    case "synced":
      return "cloud-check";
  }
}
function normalizeOverridePath(path) {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}
function applyWordStatusOverride(context, override) {
  const bodyStatus = override.bodyStatus ?? context.bodyStatus;
  const studylistStatus = override.studylistStatus ?? context.studylistStatus;
  return {
    ...context,
    bodyStatus,
    studylistStatus,
    effectiveStatus: getEffectiveWordStatus(bodyStatus, studylistStatus),
    lastError: override.bodyError ?? override.studylistError ?? context.lastError
  };
}
function hasOverrideValue(override) {
  return override.bodyStatus !== void 0 || override.studylistStatus !== void 0 || override.bodyError !== void 0 || override.studylistError !== void 0;
}
var WordStatusOverrideStore = class {
  constructor() {
    this.overrides = /* @__PURE__ */ new Map();
  }
  setBody(file, status, lastError) {
    const path = normalizeOverridePath(file.path);
    const override = this.overrides.get(path) ?? {};
    override.bodyStatus = status;
    override.bodyError = lastError;
    this.overrides.set(path, override);
  }
  setStudylist(file, status, lastError) {
    const path = normalizeOverridePath(file.path);
    const override = this.overrides.get(path) ?? {};
    override.studylistStatus = status;
    override.studylistError = lastError;
    this.overrides.set(path, override);
  }
  get(path) {
    return this.overrides.get(normalizeOverridePath(path)) ?? null;
  }
  clearBody(path) {
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
  clearStudylist(path) {
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
  clear(path) {
    this.overrides.delete(normalizeOverridePath(path));
  }
  getDisplayContext(file, context) {
    if (!context) {
      return null;
    }
    const override = this.overrides.get(normalizeOverridePath(file.path));
    return override ? applyWordStatusOverride(context, override) : context;
  }
};

// src/command-controller.ts
function isMarkdownFile(file) {
  return file instanceof import_obsidian2.TFile && file.extension === "md";
}
var EudicSyncCommandController = class {
  constructor(options) {
    this.options = options;
  }
  registerCommands() {
    this.options.plugin.addCommand({
      id: "sync-current-word",
      name: "Sync current word",
      callback: () => {
        void this.options.actions.syncCurrentWord();
      }
    });
    this.options.plugin.addCommand({
      id: "sync-all-dirty-words",
      name: "Sync all dirty words",
      callback: () => {
        void this.options.actions.syncAllDirtyWords();
      }
    });
    this.options.plugin.addCommand({
      id: "resync-aliases-for-current-word",
      name: "Resync aliases for current word",
      callback: () => {
        void this.options.actions.resyncAliasesForCurrentWord();
      }
    });
    this.options.plugin.addCommand({
      id: "delete-current-word-note-in-eudic",
      name: "Delete current word note in Eudic",
      callback: () => {
        void this.options.actions.deleteCurrentWordNoteInEudic();
      }
    });
    this.options.plugin.addCommand({
      id: "delete-typed-word-note-in-eudic",
      name: "Delete typed word note in Eudic",
      callback: () => {
        void this.options.actions.deleteTypedWordNoteInEudic();
      }
    });
    this.options.plugin.addCommand({
      id: "rebuild-reference-index",
      name: "Rebuild reference graph",
      callback: () => {
        void this.options.actions.rebuildReferenceIndexManually();
      }
    });
    this.options.plugin.addCommand({
      id: "repair-reference-metadata",
      name: "Repair All reference metadata",
      callback: () => {
        void this.options.actions.rebuildLegacyReferenceMetadata();
      }
    });
    this.options.plugin.addCommand({
      id: "repair-current-reference-metadata",
      name: "Repair current reference metadata",
      callback: () => {
        void this.options.actions.repairCurrentReferenceMetadata();
      }
    });
    this.options.plugin.addCommand({
      id: "refresh-eudic-studylists",
      name: "Refresh Eudic studylists",
      callback: () => {
        void this.options.actions.refreshEudicStudylists();
      }
    });
    this.options.plugin.addCommand({
      id: "pull-studylist-assignments-from-eudic",
      name: "Pull studylist assignments from Eudic",
      callback: () => {
        void this.options.actions.pullStudylistAssignmentsFromEudic();
      }
    });
    this.options.plugin.addCommand({
      id: "pull-current-word-studylist-assignment-from-eudic",
      name: "Pull current word studylist assignment from Eudic",
      callback: () => {
        void this.options.actions.pullCurrentWordStudylistAssignmentFromEudic();
      }
    });
    this.options.plugin.addCommand({
      id: "push-all-dirty-studylist-assignments-to-eudic",
      name: "Push all dirty studylist assignments to Eudic",
      callback: () => {
        void this.options.actions.pushAllDirtyStudylistAssignmentsToEudic();
      }
    });
    this.options.plugin.addCommand({
      id: "push-current-word-studylist-assignment-to-eudic",
      name: "Push current word studylist assignment to Eudic",
      callback: () => {
        void this.options.actions.pushCurrentWordStudylistAssignmentToEudic();
      }
    });
    this.options.plugin.addCommand({
      id: "rebuild-local-studylist-metadata",
      name: "Rebuild local studylist metadata",
      callback: () => {
        void this.options.actions.rebuildLocalStudylistMetadata();
      }
    });
    this.options.plugin.addCommand({
      id: "repair-studylist-names-ids-for-all-word-notes",
      name: "Repair studylist names/ids for all word notes",
      callback: () => {
        void this.options.actions.repairStudylistNamesIdsForAllWordNotes();
      }
    });
    this.options.plugin.addCommand({
      id: "copy-managed-url-for-current-note",
      name: "Copy managed URL for current note",
      callback: () => {
        void this.options.actions.copyManagedUrlForCurrentNote();
      }
    });
    this.options.plugin.addCommand({
      id: "format-current-eudic-note-bold-markers",
      name: "Format current Eudic note bold markers",
      callback: () => {
        void this.options.actions.formatCurrentEudicNoteBoldMarkers();
      }
    });
    this.options.plugin.addCommand({
      id: "format-all-eudic-note-bold-markers",
      name: "Format all Eudic word and reference notes bold markers",
      callback: () => {
        void this.options.actions.formatAllEudicNoteBoldMarkers();
      }
    });
    this.options.plugin.addCommand({
      id: "create-reference-from-selection",
      name: "Create reference from selection",
      callback: () => {
        void this.options.actions.createReferenceFromSelection();
      }
    });
    this.options.plugin.addCommand({
      id: "create-reference-from-current-paragraph",
      name: "Create reference from current paragraph",
      callback: () => {
        void this.options.actions.createReferenceFromCurrentParagraph();
      }
    });
    this.options.plugin.addCommand({
      id: "extract-pending-references-in-current-word",
      name: "Extract pending references in current word",
      callback: () => {
        void this.options.actions.extractPendingReferencesInCurrentWord();
      }
    });
    this.options.plugin.addCommand({
      id: "extract-current-eudic-block-to-reference",
      name: "Extract current Eudic block to reference",
      callback: () => {
        void this.options.actions.extractCurrentEudicBlockToReference();
      }
    });
    this.options.plugin.addCommand({
      id: "wrap-selection-as-eudic-block",
      name: "Wrap selection as Eudic block",
      callback: () => {
        void this.options.actions.wrapSelectionAsEudicBlock();
      }
    });
    this.options.plugin.addCommand({
      id: "insert-eudic-block",
      name: "Insert Eudic block",
      callback: () => {
        void this.options.actions.insertEudicBlock();
      }
    });
  }
  registerFileMenuAction() {
    this.options.plugin.registerEvent(
      this.options.app.workspace.on("file-menu", (menu, file) => {
        if (!isMarkdownFile(file)) {
          return;
        }
        if (!this.options.syncService.canSyncFile(file)) {
          return;
        }
        menu.addItem((item) => {
          const context = this.options.getDisplayWordContext(file);
          item.setTitle("Sync current word").setIcon(getStatusIcon(context?.effectiveStatus ?? "dirty")).onClick(() => {
            void this.options.actions.syncFile(file, { force: true, source: "manual" });
          });
        });
      })
    );
  }
};

// src/constants.ts
var PLUGIN_ID = "eudic-sync";
var PLUGIN_NAME = "Eudic Sync";
var SUPPRESSED_WRITE_TTL_MS = 1500;
var NOTE_OUTPUT_FORMAT_VERSION = 7;
var DEFAULT_SEMANTIC_BLOCK_WORD_BOLD_KINDS = ["n.", "v.", "a.", "adj.", "adv.", "vt.", "vi."];
var DEFAULT_SEMANTIC_BLOCK_WORD_LINK_KINDS = ["Cog.", "Syn.", "Syn./Cog.", "Ant."];
var DEFAULT_SEMANTIC_BLOCK_KIND_PRESETS = [
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
  "P.S."
];
var SYNC_STATUSES = /* @__PURE__ */ new Set([
  "dirty",
  "synced"
]);
var DEFAULT_SETTINGS = {
  wordFolder: "Eudic/Words",
  referenceFolder: "Eudic/References",
  authorizationToken: "",
  studylistCache: {
    categories: [],
    refreshedAt: null
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
  enableStatusBarSyncButton: true
};
var FRONTMATTER_KEYS = {
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
  usageUpdatedAt: "usage_updated_at"
};

// src/delete-note-modal.ts
var import_obsidian3 = require("obsidian");
var ConfirmDeleteEudicNoteModal = class extends import_obsidian3.Modal {
  constructor(app, title, messageLines, onResolve, confirmLabel) {
    super(app);
    this.title = title;
    this.messageLines = messageLines;
    this.onResolve = onResolve;
    this.confirmLabel = confirmLabel;
    this.resolved = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });
    for (const line of this.messageLines) {
      contentEl.createEl("p", { text: line });
    }
    new import_obsidian3.Setting(contentEl).addButton(
      (button) => button.setButtonText("Cancel").onClick(() => {
        this.resolve(false);
        this.close();
      })
    ).addButton(
      (button) => button.setButtonText(this.confirmLabel).setWarning().onClick(() => {
        this.resolve(true);
        this.close();
      })
    );
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolve(false);
    }
  }
  resolve(confirmed) {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.onResolve(confirmed);
  }
};
var DeleteTypedWordNoteModal = class extends import_obsidian3.Modal {
  constructor(app, languages, onResolve) {
    super(app);
    this.languages = languages;
    this.onResolve = onResolve;
    this.resolved = false;
    this.word = "";
    this.language = languages[0] ?? "en";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Delete typed word note in Eudic" });
    new import_obsidian3.Setting(contentEl).setName("Word").setDesc("Delete the Eudic note for this word.").addText((text) => {
      text.setPlaceholder("played").onChange((value) => {
        this.word = value;
        submitButton.disabled = !this.canSubmit();
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    new import_obsidian3.Setting(contentEl).setName("Language").setDesc("Choose the language used for the Eudic note lookup.").addDropdown((dropdown) => {
      for (const language of this.languages) {
        dropdown.addOption(language, language);
      }
      dropdown.setValue(this.language);
      dropdown.onChange((value) => {
        this.language = value;
      });
    });
    let submitButton;
    new import_obsidian3.Setting(contentEl).addButton(
      (button) => button.setButtonText("Cancel").onClick(() => {
        this.resolve(null);
        this.close();
      })
    ).addButton((button) => {
      button.setButtonText("Continue").setCta().onClick(() => {
        if (!this.canSubmit()) {
          return;
        }
        this.resolve({
          word: this.word.trim(),
          language: this.language
        });
        this.close();
      });
      submitButton = button.buttonEl;
      submitButton.disabled = true;
    });
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolve(null);
    }
  }
  canSubmit() {
    return this.word.trim().length > 0;
  }
  resolve(result) {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.onResolve(result);
  }
};
function confirmDeleteEudicNote(app, title, messageLines, confirmLabel = "Delete") {
  return new Promise((resolve) => {
    const modal = new ConfirmDeleteEudicNoteModal(app, title, messageLines, resolve, confirmLabel);
    modal.open();
  });
}
function confirmEudicAction(app, title, messageLines, confirmLabel = "Continue") {
  return new Promise((resolve) => {
    const modal = new ConfirmDeleteEudicNoteModal(app, title, messageLines, resolve, confirmLabel);
    modal.open();
  });
}
function promptDeleteTypedWordNote(app, languages) {
  return new Promise((resolve) => {
    const modal = new DeleteTypedWordNoteModal(app, languages, resolve);
    modal.open();
  });
}

// src/studylist-sync-status.ts
var LEGACY_STUDYLIST_DIRTY_KEY = "eudic_studylist_dirty";
function readSyncStatusValue(value, fallback) {
  return value === "dirty" || value === "synced" ? value : fallback;
}
function readStudylistSyncStatus(frontmatter) {
  const explicitStatus = readSyncStatusValue(frontmatter[FRONTMATTER_KEYS.studylistSyncStatus], "synced");
  if (frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] === "dirty" || frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] === "synced") {
    return explicitStatus;
  }
  return frontmatter[LEGACY_STUDYLIST_DIRTY_KEY] === true ? "dirty" : "synced";
}
function normalizeStudylistSyncStatus(frontmatter) {
  const status = readStudylistSyncStatus(frontmatter);
  frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = status;
  delete frontmatter[LEGACY_STUDYLIST_DIRTY_KEY];
  return status;
}
function isStudylistSyncStatusNormalized(frontmatter) {
  const status = frontmatter[FRONTMATTER_KEYS.studylistSyncStatus];
  return (status === "dirty" || status === "synced") && !(LEGACY_STUDYLIST_DIRTY_KEY in frontmatter);
}
function shouldSkipEmptySyncedStudylistAssignment(ids, names, status) {
  return status === "synced" && ids.length === 0 && names.length === 0;
}

// src/word-body.ts
var EMPTY_WORD_BODY_SYNC_ERROR = "Word body is empty; skipped sync to avoid overwriting the Eudic note.";
function stripYamlFrontmatter(markdown) {
  const body = markdown.replace(/^\uFEFF/, "");
  if (!body.startsWith("---")) {
    return body;
  }
  return body.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
}
function splitLines(markdown) {
  return markdown.replace(/\r\n?/g, "\n").split("\n");
}
function isVisualBlankLine(line) {
  return line.trim().length === 0;
}
function trimBoundaryBlankLines(markdownBody) {
  const lines = splitLines(markdownBody);
  let startIndex = 0;
  let endIndex = lines.length - 1;
  while (startIndex <= endIndex && isVisualBlankLine(lines[startIndex] ?? "")) {
    startIndex += 1;
  }
  while (endIndex >= startIndex && isVisualBlankLine(lines[endIndex] ?? "")) {
    endIndex -= 1;
  }
  if (startIndex > endIndex) {
    return "";
  }
  return lines.slice(startIndex, endIndex + 1).join("\n");
}
function prepareSyncBodyMarkdown(rawMarkdown) {
  return trimBoundaryBlankLines(stripYamlFrontmatter(rawMarkdown));
}

// src/note-metadata.ts
function getFrontmatter(app, file) {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter || typeof frontmatter !== "object") {
    return {};
  }
  return frontmatter;
}
function isWordSyncDisabledFrontmatter(frontmatter) {
  const syncEnabled = frontmatter[FRONTMATTER_KEYS.syncEudicEnabled];
  if (typeof syncEnabled === "boolean") {
    return !syncEnabled;
  }
  return frontmatter[FRONTMATTER_KEYS.eudicSync] === false;
}
function readNullableString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function readStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}
function stringArraysEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
function getConfiguredWord(frontmatter, file) {
  return readNullableString(frontmatter[FRONTMATTER_KEYS.word]) ?? file.basename;
}
function normalizeAliasesValue(value, mainWord) {
  const rawAliases = typeof value === "string" ? [value] : readStringArray(value);
  const normalizedAliases = [];
  const seen = /* @__PURE__ */ new Set();
  const normalizedMainWord = mainWord.trim().toLocaleLowerCase();
  for (const alias of rawAliases) {
    const trimmedAlias = alias.trim();
    if (!trimmedAlias) {
      continue;
    }
    const dedupeKey = trimmedAlias.toLocaleLowerCase();
    if (!dedupeKey || dedupeKey === normalizedMainWord || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalizedAliases.push(trimmedAlias);
  }
  return normalizedAliases;
}
function getNormalizedAliases(frontmatter, file) {
  return normalizeAliasesValue(frontmatter[FRONTMATTER_KEYS.aliases], getConfiguredWord(frontmatter, file));
}
function aliasesNeedRewrite(frontmatter, file) {
  const rawAliases = frontmatter[FRONTMATTER_KEYS.aliases];
  if (!Array.isArray(rawAliases)) {
    return true;
  }
  const normalizedAliases = getNormalizedAliases(frontmatter, file);
  const currentAliases = rawAliases.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
  return !stringArraysEqual(currentAliases, normalizedAliases);
}
function readBodyStatus(frontmatter) {
  const rawStatus = readNullableString(frontmatter[FRONTMATTER_KEYS.syncStatus]);
  if (rawStatus === "synced") {
    return "synced";
  }
  if (rawStatus === "dirty" || rawStatus === "draft" || rawStatus === "syncing" || rawStatus === "error") {
    return "dirty";
  }
  if (rawStatus && SYNC_STATUSES.has(rawStatus)) {
    return rawStatus;
  }
  if (readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedHash])) {
    return "synced";
  }
  return "dirty";
}
function readEffectiveStatus(frontmatter) {
  return readBodyStatus(frontmatter) === "dirty" || readStudylistSyncStatus(frontmatter) === "dirty" ? "dirty" : "synced";
}
function getWordNoteContext(app, pathScope, file) {
  if (!pathScope.isWordPath(file.path)) {
    return null;
  }
  const frontmatter = getFrontmatter(app, file);
  if (isWordSyncDisabledFrontmatter(frontmatter)) {
    return null;
  }
  const explicitLang = readNullableString(frontmatter[FRONTMATTER_KEYS.lang]);
  const storedStatus = readNullableString(frontmatter[FRONTMATTER_KEYS.syncStatus]);
  return {
    file,
    word: getConfiguredWord(frontmatter, file),
    lang: explicitLang,
    storedStatus,
    bodyStatus: readBodyStatus(frontmatter),
    studylistStatus: readStudylistSyncStatus(frontmatter),
    effectiveStatus: readEffectiveStatus(frontmatter),
    lastSyncedHash: readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedHash]),
    syncedAt: readNullableString(frontmatter[FRONTMATTER_KEYS.syncedAt]),
    lastError: readNullableString(frontmatter[FRONTMATTER_KEYS.lastError])
  };
}

// src/eudic-link.ts
var EUDIC_PROTOCOL_ACTION = "eudic-sync";
function normalizeLookupKey(value) {
  return value.trim().toLocaleLowerCase();
}
function normalizePath(path) {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
}
function fallbackRandomUuid() {
  const randomHex = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, "0");
  return [
    `${randomHex()}${randomHex()}`,
    randomHex(),
    randomHex(),
    randomHex(),
    `${randomHex()}${randomHex()}${randomHex()}`
  ].join("-");
}
function encodeQuery(params) {
  return Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}
function dedupeFilesByPath(files) {
  const filesByPath = /* @__PURE__ */ new Map();
  for (const file of files) {
    const normalizedPath = normalizePath(file.path);
    if (!filesByPath.has(normalizedPath)) {
      filesByPath.set(normalizedPath, file);
    }
  }
  return Array.from(filesByPath.values());
}
function getVaultScopedFiles(app, pathScope, kind) {
  return app.vault.getMarkdownFiles().filter((file) => kind === "word" ? pathScope.isWordPath(file.path) : pathScope.isReferencePath(file.path));
}
function getScopedFiles(app, pathScope, kind, scopedFiles) {
  if (scopedFiles) {
    return dedupeFilesByPath([...scopedFiles(kind), ...getVaultScopedFiles(app, pathScope, kind)]);
  }
  return getVaultScopedFiles(app, pathScope, kind);
}
function resolveWordFileByDirectPath(app, pathScope, word) {
  const trimmedWord = word.trim().replace(/\.md$/i, "");
  if (!trimmedWord || /[\\/]/.test(trimmedWord)) {
    return null;
  }
  const wordFolderPath = pathScope.getWordFolderPath();
  if (!wordFolderPath) {
    return null;
  }
  const candidatePath = normalizePath(`${wordFolderPath}/${trimmedWord}.md`);
  if (!pathScope.isWordPath(candidatePath)) {
    return null;
  }
  const file = app.vault.getFileByPath(candidatePath);
  if (!file || file.extension !== "md") {
    return null;
  }
  return file;
}
function createEudicLinkId(kind) {
  const prefix = kind === "word" ? "w" : "r";
  const uuid = globalThis.crypto?.randomUUID?.() ?? fallbackRandomUuid();
  return `${prefix}-${uuid}`;
}
function readEudicLinkId(frontmatter) {
  return readNullableString(frontmatter[FRONTMATTER_KEYS.eudicLinkId]);
}
function getScopedLinkKind(pathScope, path) {
  if (pathScope.isWordPath(path)) {
    return "word";
  }
  if (pathScope.isReferencePath(path)) {
    return "reference";
  }
  return null;
}
function buildEudicProtocolUrl(app, kind, id, fallbackName) {
  const params = {
    vault: app.vault.getName(),
    kind,
    id
  };
  if (fallbackName) {
    params[kind === "word" ? "word" : "name"] = fallbackName;
  }
  return `obsidian://${EUDIC_PROTOCOL_ACTION}?${encodeQuery(params)}`;
}
function findScopedFilesByLinkId(app, pathScope, kind, id, scopedFiles) {
  return getScopedFiles(app, pathScope, kind, scopedFiles).filter((file) => {
    const frontmatter = getFrontmatter(app, file);
    return readEudicLinkId(frontmatter) === id;
  });
}
function findScopedFilesByFallbackName(app, pathScope, kind, name, scopedFiles) {
  const targetKey = normalizeLookupKey(name);
  if (!targetKey) {
    return [];
  }
  return getScopedFiles(app, pathScope, kind, scopedFiles).filter((file) => {
    const frontmatter = getFrontmatter(app, file);
    const candidate = kind === "word" ? getConfiguredWord(frontmatter, file) : normalizePath(file.path).split("/").pop() ?? file.basename;
    const candidateName = kind === "reference" ? candidate.replace(/\.md$/i, "") : candidate;
    return normalizeLookupKey(candidateName) === targetKey;
  });
}
function assertUniqueScopedLinkId(app, pathScope, file, id, scopedFiles) {
  const kind = getScopedLinkKind(pathScope, file.path);
  if (!kind) {
    throw new Error(`File is outside the managed Word/Reference folders: ${file.path}`);
  }
  const matches = findScopedFilesByLinkId(app, pathScope, kind, id, scopedFiles);
  if (matches.length > 1) {
    throw new Error(`Duplicate eudic_link_id "${id}" found in ${kind} folder.`);
  }
  if (matches.length === 1 && normalizePath(matches[0].path) !== normalizePath(file.path)) {
    throw new Error(`eudic_link_id "${id}" in ${file.path} points to a different ${kind} note.`);
  }
  return kind;
}
function buildManagedFileProtocolUrl(app, pathScope, file, linkId, scopedFiles) {
  const kind = assertUniqueScopedLinkId(app, pathScope, file, linkId, scopedFiles);
  const frontmatter = getFrontmatter(app, file);
  const fallbackName = kind === "word" ? getConfiguredWord(frontmatter, file) : file.basename;
  return buildEudicProtocolUrl(app, kind, linkId, fallbackName);
}
function resolveManagedFileFromProtocol(app, pathScope, params, scopedFiles) {
  const requestedVault = readNullableString(params.vault);
  if (requestedVault && requestedVault !== app.vault.getName()) {
    return {
      file: null,
      error: `Vault mismatch: expected "${app.vault.getName()}", got "${requestedVault}".`
    };
  }
  const kindParam = readNullableString(params.kind);
  if (kindParam !== "word" && kindParam !== "reference") {
    return {
      file: null,
      error: "Invalid or missing managed link kind."
    };
  }
  const id = readNullableString(params.id);
  if (!id) {
    return {
      file: null,
      error: "Missing managed link id."
    };
  }
  const matches = findScopedFilesByLinkId(app, pathScope, kindParam, id, scopedFiles);
  if (matches.length === 1) {
    return { file: matches[0], error: null };
  }
  if (matches.length > 1) {
    return {
      file: null,
      error: `Duplicate eudic_link_id "${id}" found in ${kindParam} folder.`
    };
  }
  const fallbackName = kindParam === "word" ? readNullableString(params.word) : readNullableString(params.name);
  if (fallbackName) {
    const fallbackMatches = findScopedFilesByFallbackName(app, pathScope, kindParam, fallbackName, scopedFiles);
    if (fallbackMatches.length === 1) {
      return { file: fallbackMatches[0], error: null };
    }
    if (fallbackMatches.length > 1) {
      return {
        file: null,
        error: `Fallback lookup for "${fallbackName}" matched multiple ${kindParam} notes.`
      };
    }
    if (kindParam === "word") {
      const directFile = resolveWordFileByDirectPath(app, pathScope, fallbackName);
      if (directFile) {
        return { file: directFile, error: null };
      }
    }
  }
  return {
    file: null,
    error: fallbackName ? `No ${kindParam} note found for eudic_link_id "${id}" or fallback name "${fallbackName}".` : `No ${kindParam} note found for eudic_link_id "${id}".`
  };
}

// src/semantic-block-transform.ts
function normalizeLiteralStrings(values) {
  const seen = /* @__PURE__ */ new Set();
  const normalized = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}
function normalizeWordKey(value) {
  return value.trim().toLocaleLowerCase();
}
function normalizeLinkTargets(targets) {
  const seen = /* @__PURE__ */ new Set();
  const normalized = [];
  for (const target of targets) {
    const normalizedWord = normalizeWordKey(target.word);
    const linkUrl = target.linkUrl.trim();
    if (!normalizedWord || !linkUrl || seen.has(normalizedWord)) {
      continue;
    }
    seen.add(normalizedWord);
    normalized.push({
      word: target.word,
      linkUrl,
      normalizedWord
    });
  }
  return normalized.sort((left, right) => right.normalizedWord.length - left.normalizedWord.length);
}
function matchesWordAt(markdown, index, normalizedWord) {
  const end = index + normalizedWord.length;
  return markdown.slice(index, end).toLocaleLowerCase() === normalizedWord;
}
function isPrefixWordMatch(markdown, index, normalizedWord, protectedRanges) {
  const end = index + normalizedWord.length;
  if (!matchesWordAt(markdown, index, normalizedWord)) {
    return false;
  }
  if (rangeOverlaps(protectedRanges, index, end)) {
    return false;
  }
  const previous = index > 0 ? markdown[index - 1] ?? "" : "";
  return !isWordCharacter(previous);
}
function findWordEnd(markdown, start) {
  let end = start;
  while (end < markdown.length && isWordCharacter(markdown[end] ?? "")) {
    end += 1;
  }
  return end;
}
function readMarkdownEmphasisMarker(markdown, index) {
  if (markdown.startsWith("**", index) || markdown.startsWith("__", index)) {
    return markdown.slice(index, index + 2);
  }
  return null;
}
function findPreviousRenderedCharacter(markdown, beforeIndex) {
  let cursor = beforeIndex - 1;
  while (cursor >= 0) {
    if (cursor > 0 && readMarkdownEmphasisMarker(markdown, cursor - 1)) {
      cursor -= 2;
      continue;
    }
    return markdown[cursor] ?? "";
  }
  return "";
}
function findNextRenderedCharacter(markdown, fromIndex) {
  let cursor = fromIndex;
  while (cursor < markdown.length) {
    const marker = readMarkdownEmphasisMarker(markdown, cursor);
    if (marker) {
      cursor += marker.length;
      continue;
    }
    return markdown[cursor] ?? "";
  }
  return "";
}
function hasMarkdownEmphasisMarker(markdown) {
  return markdown.includes("**") || markdown.includes("__");
}
function findTextAwareWholeWordMatch(markdown, index, normalizedWord, protectedRanges) {
  let cursor = index;
  let wordIndex = 0;
  let firstWordCharacterIndex = null;
  while (wordIndex < normalizedWord.length) {
    if (findContainingRange(protectedRanges, cursor)) {
      return null;
    }
    const marker = readMarkdownEmphasisMarker(markdown, cursor);
    if (marker) {
      cursor += marker.length;
      continue;
    }
    const current = markdown[cursor] ?? "";
    if (!current || current.toLocaleLowerCase() !== normalizedWord[wordIndex]) {
      return null;
    }
    firstWordCharacterIndex ??= cursor;
    cursor += 1;
    wordIndex += 1;
  }
  if (firstWordCharacterIndex === null) {
    return null;
  }
  while (cursor < markdown.length) {
    if (findContainingRange(protectedRanges, cursor)) {
      return null;
    }
    const marker = readMarkdownEmphasisMarker(markdown, cursor);
    if (!marker) {
      break;
    }
    cursor += marker.length;
  }
  const previous = findPreviousRenderedCharacter(markdown, index);
  const next = findNextRenderedCharacter(markdown, cursor);
  if (isWordCharacter(previous) || isWordCharacter(next)) {
    return null;
  }
  return {
    to: cursor,
    label: markdown.slice(index, cursor)
  };
}
function transformWordAutomation(markdown, linkTargets, normalizedWord, shouldLink, shouldBold) {
  if (!shouldLink && !shouldBold) {
    return markdown;
  }
  const protectedRanges = getProtectedRanges(markdown, {
    protectYamlFrontmatter: false,
    protectEudicBlockFences: false,
    protectMarkdownEmphasis: false
  });
  const boldProtectedRanges = getProtectedRanges(markdown, {
    protectYamlFrontmatter: false,
    protectEudicBlockFences: false,
    protectMarkdownEmphasis: true
  });
  let output = "";
  let index = 0;
  while (index < markdown.length) {
    const protectedRange = findContainingRange(protectedRanges, index);
    if (protectedRange) {
      output += markdown.slice(index, protectedRange.to);
      index = protectedRange.to;
      continue;
    }
    const matchedTarget = shouldLink ? linkTargets.map((target) => ({
      target,
      match: findTextAwareWholeWordMatch(markdown, index, target.normalizedWord, protectedRanges)
    })).find((candidate) => candidate.match) : void 0;
    if (matchedTarget) {
      const match = matchedTarget.match;
      const shouldBoldLabel = shouldBold && matchedTarget.target.normalizedWord === normalizedWord && !hasMarkdownEmphasisMarker(match.label);
      const label = shouldBoldLabel ? `**${match.label}**` : match.label;
      output += `[${label}](${matchedTarget.target.linkUrl})`;
      index = match.to;
      continue;
    }
    if (shouldBold && isPrefixWordMatch(markdown, index, normalizedWord, boldProtectedRanges)) {
      const wordEnd = findWordEnd(markdown, index + normalizedWord.length);
      const matchedText = markdown.slice(index, wordEnd);
      output += `**${matchedText}**`;
      index = wordEnd;
      continue;
    }
    output += markdown[index] ?? "";
    index += 1;
  }
  return output;
}
function transformMarkerBold(markdown, markers) {
  return formatBoldMarkersInMarkdownWithOptions(markdown, markers, {
    protectYamlFrontmatter: false,
    protectEudicBlockFences: false
  }).markdown;
}
function buildSemanticBlockTransformOptions(settings, boldWord, linkUrl, linkTargets) {
  const trimmedLinkUrl = linkUrl?.trim() ?? "";
  const normalizedLinkTargets = linkTargets ? normalizeLinkTargets(linkTargets) : trimmedLinkUrl ? normalizeLinkTargets([{ word: boldWord, linkUrl: trimmedLinkUrl }]) : [];
  return {
    boldWord,
    linkTargets: normalizedLinkTargets.map((target) => ({
      word: target.word,
      linkUrl: target.linkUrl
    })),
    enableWordBold: settings.enableSemanticBlockWordBold,
    wordBoldKinds: settings.semanticBlockWordBoldKinds,
    enableMarkerBold: settings.enableSemanticBlockMarkerBold,
    boldMarkers: settings.boldMarkers,
    enableWordLinks: settings.enableSemanticBlockWordLinks,
    wordLinkKinds: settings.semanticBlockWordLinkKinds
  };
}
function mergeSemanticBlockLinkTargets(primaryTarget, linkTargets) {
  const merged = [];
  if (primaryTarget?.linkUrl) {
    merged.push({
      word: primaryTarget.word,
      linkUrl: primaryTarget.linkUrl
    });
  }
  merged.push(...linkTargets);
  return normalizeLinkTargets(merged).map((target) => ({
    word: target.word,
    linkUrl: target.linkUrl
  }));
}
function buildWordSemanticBlockTransformOptions(settings, currentWordTarget) {
  return buildSemanticBlockTransformOptions(
    settings,
    currentWordTarget?.word ?? "",
    currentWordTarget?.linkUrl ?? null
  );
}
function buildReferenceSemanticBlockTransformOptions(settings, boldWord, linkTargets) {
  return buildSemanticBlockTransformOptions(settings, boldWord ?? "", null, linkTargets);
}
function transformSemanticBlockBody(kind, rawBody, options) {
  if (!options) {
    return rawBody;
  }
  const normalizedWord = normalizeWordKey(options.boldWord);
  const linkTargets = normalizeLinkTargets(options.linkTargets);
  const normalizedKind = kind.trim();
  const linkKinds = normalizeLiteralStrings(options.wordLinkKinds);
  const boldKinds = normalizeLiteralStrings(options.wordBoldKinds);
  const shouldLink = options.enableWordLinks && linkTargets.length > 0 && linkKinds.includes(normalizedKind);
  const shouldBold = options.enableWordBold && !!normalizedWord && boldKinds.includes(normalizedKind);
  let transformedBody = transformWordAutomation(rawBody, linkTargets, normalizedWord, shouldLink, shouldBold);
  if (options.enableMarkerBold && options.boldMarkers.length > 0) {
    transformedBody = transformMarkerBold(transformedBody, options.boldMarkers);
  }
  return transformedBody;
}

// src/eudic-block.ts
var EUDIC_BLOCK_LANGUAGE = "eudic-block";
var DEFAULT_EUDIC_BLOCK_KIND = "Cog.";
var EUDIC_BLOCK_KIND_PRESETS = [...DEFAULT_SEMANTIC_BLOCK_KIND_PRESETS];
var EMPTY_EUDIC_BLOCK_OPENING_LINE = `\`\`\` ${EUDIC_BLOCK_LANGUAGE} kind=`;
var EMPTY_EUDIC_BLOCK_MARKDOWN = `${EMPTY_EUDIC_BLOCK_OPENING_LINE}
\`\`\``;
function normalizeMarkdown(markdown) {
  return markdown.replace(/\r\n?/g, "\n");
}
function hasLeadingBlankLine(markdown) {
  const normalized = normalizeMarkdown(markdown);
  const firstLine = normalized.split("\n")[0] ?? "";
  return firstLine.trim().length === 0;
}
function escapeForRegex2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stripOptionalQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"' || first === "'" && last === "'") {
      return value.slice(1, -1).trim();
    }
  }
  return value;
}
function getLineKindRemainder(line, kind) {
  const trimmed = line.trimStart();
  const markdownPrefix = `**${kind}**`;
  if (trimmed.toLowerCase().startsWith(markdownPrefix.toLowerCase())) {
    return trimmed.slice(markdownPrefix.length).replace(/^\s+/, "");
  }
  const htmlMatch = trimmed.match(
    new RegExp(`^<(?:b|strong)\\b[^>]*>${escapeForRegex2(kind)}<\\/(?:b|strong)>(?:\\s+|$)`, "i")
  );
  if (htmlMatch) {
    return trimmed.slice(htmlMatch[0].length);
  }
  if (trimmed.toLowerCase() === kind.toLowerCase()) {
    return "";
  }
  const plainMatch = trimmed.match(new RegExp(`^${escapeForRegex2(kind)}(?:\\s+|$)`, "i"));
  if (plainMatch) {
    return trimmed.slice(plainMatch[0].length);
  }
  return null;
}
function isListLine(line) {
  return /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);
}
function separateListBlocksFromParagraphs(markdown) {
  const lines = normalizeMarkdown(markdown).split("\n");
  const output = [];
  for (const line of lines) {
    const previousLine = output[output.length - 1] ?? "";
    if (isListLine(line) && previousLine.trim() && !isListLine(previousLine)) {
      output.push("");
    }
    output.push(line);
  }
  return output.join("\n");
}
function buildOpeningFenceLine(fence) {
  return `${fence.indent}${fence.fenceToken} ${EUDIC_BLOCK_LANGUAGE} kind=${fence.kind}`;
}
function parseEudicBlockFenceLine(line) {
  const match = line.match(/^(\s*)(`{3,}|~{3,})\s*eudic-block(?:\s+(.*?))?\s*$/);
  if (!match) {
    return null;
  }
  const args = (match[3] ?? "").trim();
  const kindIndex = args.indexOf("kind=");
  if (kindIndex < 0) {
    return null;
  }
  const rawKind = stripOptionalQuotes(args.slice(kindIndex + 5).trim());
  if (!rawKind) {
    return null;
  }
  return {
    indent: match[1] ?? "",
    fenceToken: match[2] ?? "```",
    kind: rawKind
  };
}
function isClosingEudicBlockFenceLine2(line, fenceToken) {
  const escapedMarker = escapeForRegex2(fenceToken[0] ?? "`");
  const minimumLength = fenceToken.length;
  return new RegExp(`^\\s*${escapedMarker}{${minimumLength},}\\s*$`).test(line);
}
function renderEudicBlockToMarkdown(kind, rawBody, semanticOptions) {
  const transformedBody = semanticOptions ? transformSemanticBlockBody(kind, rawBody, semanticOptions) : rawBody;
  const stackedLayout = hasLeadingBlankLine(transformedBody);
  const normalizedBody = trimBoundaryBlankLines(normalizeMarkdown(transformedBody));
  if (!normalizedBody) {
    return `**${kind}**`;
  }
  const lines = normalizedBody.split("\n");
  const firstLine = lines[0] ?? "";
  const remainder = getLineKindRemainder(firstLine, kind);
  if (remainder !== null) {
    if (remainder.length === 0) {
      lines.shift();
    } else {
      lines[0] = remainder;
    }
  }
  const body = trimBoundaryBlankLines(lines.join("\n"));
  if (!body) {
    return `**${kind}**`;
  }
  const bodyLines = body.split("\n");
  if (stackedLayout || isListLine(bodyLines[0] ?? "")) {
    return separateListBlocksFromParagraphs(`**${kind}**
${body}`);
  }
  bodyLines[0] = `**${kind}** ${bodyLines[0] ?? ""}`;
  return separateListBlocksFromParagraphs(bodyLines.join("\n"));
}
function transformEudicBlocksToMarkdown(markdown, semanticOptions) {
  const normalizedMarkdown = normalizeMarkdown(markdown);
  if (!normalizedMarkdown.includes(EUDIC_BLOCK_LANGUAGE)) {
    return normalizedMarkdown;
  }
  const lines = normalizedMarkdown.split("\n");
  const output = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const openingFence = parseEudicBlockFenceLine(currentLine);
    if (!openingFence) {
      output.push(currentLine);
      continue;
    }
    let closingLineIndex = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if (isClosingEudicBlockFenceLine2(lines[candidateIndex] ?? "", openingFence.fenceToken)) {
        closingLineIndex = candidateIndex;
        break;
      }
    }
    if (closingLineIndex === null) {
      output.push(currentLine);
      continue;
    }
    const body = lines.slice(lineIndex + 1, closingLineIndex).join("\n");
    output.push(renderEudicBlockToMarkdown(openingFence.kind, body, semanticOptions));
    lineIndex = closingLineIndex;
  }
  return output.join("\n");
}
function findEudicBlockFenceForBody(markdown, rawBody) {
  const normalizedTargetBody = normalizeMarkdown(rawBody);
  const targetBody = trimBoundaryBlankLines(normalizeMarkdown(rawBody));
  const blocks = findEudicBlockMatches(markdown);
  for (const block of blocks) {
    if (normalizeMarkdown(block.body) === normalizedTargetBody) {
      return block;
    }
  }
  for (const block of blocks) {
    if (trimBoundaryBlankLines(block.body) === targetBody) {
      return block;
    }
  }
  return blocks.length === 1 ? blocks[0] : null;
}
function buildEudicBlock(kind, body, fenceToken = "```") {
  const normalizedBody = normalizeMarkdown(body);
  const openingLine = buildOpeningFenceLine({
    indent: "",
    fenceToken,
    kind
  });
  const closingLine = fenceToken;
  if (!normalizedBody) {
    return `${openingLine}
${closingLine}`;
  }
  return `${openingLine}
${normalizedBody}${normalizedBody.endsWith("\n") ? "" : "\n"}${closingLine}`;
}
function buildEmptyEudicBlockInsertion(cursor, currentLine) {
  let from = cursor;
  let to = cursor;
  let insertText = EMPTY_EUDIC_BLOCK_MARKDOWN;
  let openingLine = cursor.line;
  if (currentLine.trim().length === 0) {
    from = { line: cursor.line, ch: 0 };
    to = { line: cursor.line, ch: currentLine.length };
  } else {
    const beforeCursor = currentLine.slice(0, cursor.ch);
    const afterCursor = currentLine.slice(cursor.ch);
    const needsLeadingNewline = beforeCursor.trim().length > 0;
    const needsTrailingNewline = afterCursor.trim().length > 0;
    insertText = `${needsLeadingNewline ? "\n" : ""}${EMPTY_EUDIC_BLOCK_MARKDOWN}${needsTrailingNewline ? "\n" : ""}`;
    openingLine = cursor.line + (needsLeadingNewline ? 1 : 0);
  }
  return {
    insertText,
    from,
    to,
    cursor: { line: openingLine, ch: EMPTY_EUDIC_BLOCK_OPENING_LINE.length }
  };
}
function findEudicBlockAtLine(markdown, targetLine) {
  const lines = normalizeMarkdown(markdown).split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const openingFence = parseEudicBlockFenceLine(currentLine);
    if (!openingFence) {
      continue;
    }
    let closingLine = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if (isClosingEudicBlockFenceLine2(lines[candidateIndex] ?? "", openingFence.fenceToken)) {
        closingLine = candidateIndex;
        break;
      }
    }
    const blockEndLine = closingLine ?? lines.length - 1;
    if (targetLine >= lineIndex && targetLine <= blockEndLine) {
      return {
        ...openingFence,
        openingLine: lineIndex,
        closingLine
      };
    }
    lineIndex = blockEndLine;
  }
  return null;
}
function findEudicBlockMatches(markdown) {
  const lines = normalizeMarkdown(markdown).split("\n");
  const blocks = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const openingFence = parseEudicBlockFenceLine(currentLine);
    if (!openingFence) {
      continue;
    }
    let closingLineIndex = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if (isClosingEudicBlockFenceLine2(lines[candidateIndex] ?? "", openingFence.fenceToken)) {
        closingLineIndex = candidateIndex;
        break;
      }
    }
    if (closingLineIndex === null) {
      continue;
    }
    blocks.push({
      ...openingFence,
      openingLine: lineIndex,
      closingLine: closingLineIndex,
      body: lines.slice(lineIndex + 1, closingLineIndex).join("\n")
    });
    lineIndex = closingLineIndex;
  }
  return blocks;
}
function replaceEudicBlockKindInFenceLine(line, nextKind) {
  const parsed = parseEudicBlockFenceLine(line);
  if (!parsed) {
    return line;
  }
  return buildOpeningFenceLine({
    indent: parsed.indent,
    fenceToken: parsed.fenceToken,
    kind: nextKind
  });
}
function extractLeadingPresetKindFromBody(body, presetKinds) {
  const lines = normalizeMarkdown(body).split("\n");
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLineIndex < 0) {
    return {
      kind: null,
      body
    };
  }
  const firstContentLine = lines[firstContentLineIndex] ?? "";
  for (const presetKind of normalizePresetKinds(presetKinds)) {
    const remainder = getLineKindRemainder(firstContentLine, presetKind);
    if (remainder === null) {
      continue;
    }
    if (remainder.length === 0) {
      lines.splice(firstContentLineIndex, 1);
    } else {
      lines[firstContentLineIndex] = `${firstContentLine.match(/^\s*/)?.[0] ?? ""}${remainder}`;
    }
    return {
      kind: presetKind,
      body: lines.join("\n")
    };
  }
  return {
    kind: null,
    body
  };
}
function normalizeEudicBlockKindsFromBody(markdown, presetKinds) {
  const normalizedMarkdown = normalizeMarkdown(markdown);
  if (!normalizedMarkdown.includes(EUDIC_BLOCK_LANGUAGE)) {
    return {
      markdown,
      changed: false,
      normalizedCount: 0
    };
  }
  const lines = normalizedMarkdown.split("\n");
  const output = [];
  let changed = false;
  let normalizedCount = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const openingFence = parseEudicBlockFenceLine(currentLine);
    if (!openingFence) {
      output.push(currentLine);
      continue;
    }
    let closingLineIndex = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if (isClosingEudicBlockFenceLine2(lines[candidateIndex] ?? "", openingFence.fenceToken)) {
        closingLineIndex = candidateIndex;
        break;
      }
    }
    if (closingLineIndex === null) {
      output.push(currentLine);
      continue;
    }
    const rawBody = lines.slice(lineIndex + 1, closingLineIndex).join("\n");
    const extracted = extractLeadingPresetKindFromBody(rawBody, presetKinds);
    if (!extracted.kind) {
      output.push(currentLine, ...lines.slice(lineIndex + 1, closingLineIndex + 1));
      lineIndex = closingLineIndex;
      continue;
    }
    const nextOpeningLine = replaceEudicBlockKindInFenceLine(currentLine, extracted.kind);
    const nextBodyLines = extracted.body.length > 0 ? extracted.body.split("\n") : [];
    output.push(nextOpeningLine, ...nextBodyLines, lines[closingLineIndex] ?? "");
    if (nextOpeningLine !== currentLine || extracted.body !== rawBody) {
      changed = true;
      normalizedCount += 1;
    }
    lineIndex = closingLineIndex;
  }
  return {
    markdown: output.join("\n"),
    changed,
    normalizedCount
  };
}
function normalizePresetKinds(presetKinds) {
  const seen = /* @__PURE__ */ new Set();
  const normalized = [];
  for (const presetKind of presetKinds) {
    const trimmed = presetKind.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized.sort((left, right) => right.length - left.length || left.localeCompare(right));
}
function extractLeadingPresetKindFromList(markdown, presetKinds) {
  const normalized = trimBoundaryBlankLines(normalizeMarkdown(markdown));
  if (!normalized) {
    return {
      kind: null,
      markdown: ""
    };
  }
  const lines = normalized.split("\n");
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLineIndex < 0) {
    return {
      kind: null,
      markdown: normalized
    };
  }
  const firstContentLine = lines[firstContentLineIndex] ?? "";
  for (const presetKind of normalizePresetKinds(presetKinds)) {
    const remainder = getLineKindRemainder(firstContentLine, presetKind);
    if (remainder === null) {
      continue;
    }
    if (remainder.length === 0) {
      lines.splice(firstContentLineIndex, 1);
    } else {
      lines[firstContentLineIndex] = remainder;
    }
    return {
      kind: presetKind,
      markdown: trimBoundaryBlankLines(lines.join("\n"))
    };
  }
  return {
    kind: null,
    markdown: normalized
  };
}

// src/reference-note-service.ts
var import_obsidian4 = require("obsidian");

// src/reference-links.ts
var EMBED_PATTERN = /!\[\[([^[\]]+)\]\]/g;
function uniquePreservingOrder(values) {
  const seen = /* @__PURE__ */ new Set();
  const ordered = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}
function normalizeReferenceLinkPath(path) {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}
function extractLinkpath(reference) {
  const trimmed = reference.trim();
  const wikiMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
  const inner = wikiMatch ? wikiMatch[1] : trimmed;
  const beforeAlias = inner.split("|")[0]?.trim() ?? inner;
  const beforeSubpath = beforeAlias.split("#")[0]?.trim() ?? beforeAlias;
  return beforeSubpath;
}
function resolveManagedReferencePath(app, pathScope, sourcePath, linkpath) {
  if (!linkpath) {
    return null;
  }
  const destination = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  if (destination?.extension === "md" && pathScope.isReferencePath(destination.path)) {
    return destination.path;
  }
  const normalizedStem = linkpath.replace(/\.md$/i, "").replace(/^\/+|\/+$/g, "");
  const referenceFolderPath = pathScope.getPrimaryReferenceFolderPath();
  if (referenceFolderPath && normalizedStem && !normalizedStem.includes("/")) {
    const basenameCandidate = normalizeReferenceLinkPath(`${referenceFolderPath}/${normalizedStem}.md`);
    const basenameCandidateFile = app.vault.getFileByPath(basenameCandidate);
    if (basenameCandidateFile?.extension === "md" && pathScope.isReferencePath(basenameCandidateFile.path)) {
      return basenameCandidateFile.path;
    }
    const basenameMatches = app.vault.getMarkdownFiles().filter((file) => pathScope.isReferencePath(file.path) && file.basename === normalizedStem);
    if (basenameMatches.length === 1) {
      return basenameMatches[0]?.path ?? null;
    }
  }
  const fallbackStemPath = pathScope.resolveStoredReferenceStemToVaultPath(linkpath);
  if (!fallbackStemPath) {
    return null;
  }
  const fallbackFile = app.vault.getFileByPath(`${fallbackStemPath}.md`);
  if (!fallbackFile || !pathScope.isReferencePath(fallbackFile.path)) {
    return null;
  }
  return fallbackFile.path;
}
function resolveManagedReferencePaths(app, pathScope, file, markdown) {
  const resolvedPaths = [];
  for (const { linkpath } of extractReferenceEmbedReferences(markdown)) {
    const resolvedPath = resolveManagedReferencePath(app, pathScope, file.path, linkpath);
    if (!resolvedPath) {
      continue;
    }
    resolvedPaths.push(resolvedPath);
  }
  return uniquePreservingOrder(resolvedPaths);
}
function extractReferenceEmbedReferences(markdown) {
  const body = stripYamlFrontmatter(markdown);
  const refs = [];
  for (const match of body.matchAll(EMBED_PATTERN)) {
    const rawTarget = match[1] ?? "";
    refs.push({
      rawTarget,
      linkpath: extractLinkpath(rawTarget)
    });
  }
  return refs;
}
function toStoredReferenceRef(pathScope, referencePath) {
  return pathScope.toStoredReferenceMarkdownStem(referencePath);
}
function toStoredReferenceRefs(pathScope, referencePaths) {
  const storedRefs = [];
  for (const referencePath of referencePaths) {
    const storedRef = toStoredReferenceRef(pathScope, referencePath);
    if (!storedRef) {
      continue;
    }
    storedRefs.push(storedRef);
  }
  return uniquePreservingOrder(storedRefs);
}
function buildReferenceAnchorName(stem) {
  return `${stem}-main`;
}
function buildReferenceBlockAnchor(stem) {
  return `^${buildReferenceAnchorName(stem)}`;
}
function buildReferenceEmbed(storedRef) {
  const stem = storedRef.split("/").pop() ?? storedRef;
  return `![[${storedRef}#${buildReferenceBlockAnchor(stem)}]]`;
}
function stringArraysEqual2(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

// src/reference-note-service.ts
var GENERATED_REFERENCE_PREFIX = "ref";
var GENERATED_REFERENCE_SUFFIX_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
var GENERATED_REFERENCE_SUFFIX_SPACE = GENERATED_REFERENCE_SUFFIX_ALPHABET.length * GENERATED_REFERENCE_SUFFIX_ALPHABET.length;
var PENDING_REFERENCE_FENCES = /* @__PURE__ */ new Set(["```eudic-reference", "```eudic-example"]);
function pad2(value) {
  return String(value).padStart(2, "0");
}
function formatTimestampStem(date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}
function randomReferenceSuffix() {
  const alphabet = GENERATED_REFERENCE_SUFFIX_ALPHABET;
  return alphabet[Math.floor(Math.random() * alphabet.length)] + alphabet[Math.floor(Math.random() * alphabet.length)];
}
function normalizeReferenceText(rawText) {
  return rawText.replace(/\r\n?/g, "\n").trim();
}
function isBlankLine(line) {
  return line.trim().length === 0;
}
function isFenceLine(line) {
  return /^\s*(?:`{3,}|~{3,})/.test(line);
}
function isPendingReferenceFence(line) {
  return PENDING_REFERENCE_FENCES.has(line.trim());
}
function getTouchedEndLine(from, to) {
  if (to.ch === 0 && to.line > from.line) {
    return to.line - 1;
  }
  return to.line;
}
function getFrontmatterEndLine(lines) {
  if (lines[0]?.trim() !== "---") {
    return null;
  }
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    if (lines[lineIndex]?.trim() === "---") {
      return lineIndex;
    }
  }
  return lines.length - 1;
}
function getFenceRanges(lines) {
  const fenceRanges = [];
  let activeGenericFenceStart = null;
  let activeGenericFenceMarker = null;
  let activeEudicBlockFence = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const fenceMatch = currentLine.match(/^\s*(```+|~~~+)/);
    if (activeGenericFenceStart !== null) {
      if (fenceMatch && activeGenericFenceMarker === fenceMatch[1][0]) {
        fenceRanges.push({ start: activeGenericFenceStart, end: lineIndex });
        activeGenericFenceStart = null;
        activeGenericFenceMarker = null;
      }
      continue;
    }
    if (activeEudicBlockFence) {
      if (isClosingEudicBlockFenceLine2(currentLine, activeEudicBlockFence.fenceToken)) {
        fenceRanges.push({ start: lineIndex, end: lineIndex });
        activeEudicBlockFence = null;
      }
      continue;
    }
    const eudicBlockFence = parseEudicBlockFenceLine(currentLine);
    if (eudicBlockFence) {
      fenceRanges.push({ start: lineIndex, end: lineIndex });
      activeEudicBlockFence = {
        openingLine: lineIndex,
        fenceToken: eudicBlockFence.fenceToken
      };
      continue;
    }
    if (!fenceMatch) {
      continue;
    }
    activeGenericFenceStart = lineIndex;
    activeGenericFenceMarker = fenceMatch[1][0];
  }
  if (activeGenericFenceStart !== null) {
    fenceRanges.push({ start: activeGenericFenceStart, end: lines.length - 1 });
  }
  if (activeEudicBlockFence) {
    fenceRanges.push({ start: activeEudicBlockFence.openingLine, end: activeEudicBlockFence.openingLine });
  }
  return fenceRanges;
}
function rangeTouchesAnyLine(lineStart, lineEnd, ranges) {
  return ranges.some((range) => lineStart <= range.end && lineEnd >= range.start);
}
function getStandaloneFencedBlockClosingLine(lines, lastContentLine) {
  const openingMatch = (lines[0] ?? "").match(/^\s*(`{3,}|~{3,})/);
  if (!openingMatch) {
    return null;
  }
  const fenceToken = openingMatch[1];
  const fenceCharacter = fenceToken[0] ?? "`";
  const closingPattern = new RegExp(`^\\s*${fenceCharacter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}{${fenceToken.length},}\\s*$`);
  for (let lineIndex = 1; lineIndex <= lastContentLine; lineIndex += 1) {
    if (!closingPattern.test(lines[lineIndex] ?? "")) {
      continue;
    }
    return lineIndex === lastContentLine ? lineIndex : null;
  }
  return null;
}
function createReferenceFileContent(rawText, stem) {
  const normalizedText = normalizeReferenceText(rawText);
  if (!normalizedText) {
    throw new Error("Reference text is empty.");
  }
  const lines = normalizedText.split("\n");
  let lastContentLine = lines.length - 1;
  while (lastContentLine >= 0 && !lines[lastContentLine]?.trim()) {
    lastContentLine -= 1;
  }
  if (lastContentLine < 0) {
    throw new Error("Reference text is empty.");
  }
  const anchorName = buildReferenceAnchorName(stem);
  const standaloneFenceClosingLine = getStandaloneFencedBlockClosingLine(lines, lastContentLine);
  if (standaloneFenceClosingLine !== null) {
    lines.splice(standaloneFenceClosingLine + 1, 0, `^${anchorName}`);
    return `${lines.join("\n")}
`;
  }
  lines[lastContentLine] = `${lines[lastContentLine].replace(/\s+$/, "")} ^${anchorName}`;
  return `${lines.join("\n")}
`;
}
function getPendingReferenceBlocks(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (!isPendingReferenceFence(lines[lineIndex] ?? "")) {
      continue;
    }
    let closingLineIndex = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if ((lines[candidateIndex] ?? "").trim() === "```") {
        closingLineIndex = candidateIndex;
        break;
      }
    }
    if (closingLineIndex === null) {
      continue;
    }
    const to = closingLineIndex < lines.length - 1 ? { line: closingLineIndex + 1, ch: 0 } : { line: closingLineIndex, ch: (lines[closingLineIndex] ?? "").length };
    blocks.push({
      content: lines.slice(lineIndex + 1, closingLineIndex).join("\n"),
      from: { line: lineIndex, ch: 0 },
      to
    });
    lineIndex = closingLineIndex;
  }
  return blocks;
}
function hasPendingReferenceBlocks(markdown) {
  return getPendingReferenceBlocks(markdown).length > 0;
}
var ReferenceNoteService = class {
  constructor(app, pathScope) {
    this.app = app;
    this.pathScope = pathScope;
  }
  async createReferenceFromSelection(view) {
    this.requireMarkdownFile(view.file);
    const editor = view.editor;
    if (!editor.somethingSelected()) {
      throw new Error("Select reference text first.");
    }
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const selectedText = editor.getSelection();
    this.assertReplaceRangeAllowed(editor.getValue(), from, to);
    const createdReference = await this.createReference(selectedText);
    editor.replaceRange(createdReference.embed, from, to, "eudic-sync");
    editor.focus();
    return {
      changed: true,
      createdCount: 1,
      createdRefs: [createdReference.storedRef]
    };
  }
  async createReferenceFromCurrentParagraph(view) {
    this.requireMarkdownFile(view.file);
    const editor = view.editor;
    const markdown = editor.getValue();
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const cursor = editor.getCursor();
    this.assertSingleCursorAllowed(lines, cursor.line);
    const paragraphRange = this.getParagraphRange(lines, cursor.line);
    const paragraphText = editor.getRange(paragraphRange.from, paragraphRange.to);
    const createdReference = await this.createReference(paragraphText);
    editor.replaceRange(createdReference.embed, paragraphRange.from, paragraphRange.to, "eudic-sync");
    editor.focus();
    return {
      changed: true,
      createdCount: 1,
      createdRefs: [createdReference.storedRef]
    };
  }
  async extractPendingReferences(view) {
    this.requireMarkdownFile(view.file);
    const editor = view.editor;
    const pendingBlocks = getPendingReferenceBlocks(editor.getValue());
    if (pendingBlocks.length === 0) {
      return {
        changed: false,
        createdCount: 0,
        createdRefs: []
      };
    }
    const createdRefs = [];
    for (let blockIndex = pendingBlocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = pendingBlocks[blockIndex];
      const createdReference = await this.createReference(block.content);
      editor.replaceRange(createdReference.embed, block.from, block.to, "eudic-sync");
      createdRefs.unshift(createdReference.storedRef);
    }
    editor.focus();
    return {
      changed: true,
      createdCount: createdRefs.length,
      createdRefs
    };
  }
  async extractCurrentEudicBlockToReference(view) {
    this.requireMarkdownFile(view.file);
    const editor = view.editor;
    const block = findEudicBlockAtLine(editor.getValue(), editor.getCursor().line);
    if (!block) {
      throw new Error("Place the cursor inside an eudic-block first.");
    }
    if (block.closingLine === null) {
      throw new Error("Complete the current eudic-block closing fence first.");
    }
    const from = { line: block.openingLine, ch: 0 };
    const to = { line: block.closingLine, ch: editor.getLine(block.closingLine).length };
    const blockMarkdown = editor.getRange(from, to);
    const createdReference = await this.createReference(blockMarkdown);
    editor.replaceRange(createdReference.embed, from, to, "eudic-sync");
    editor.focus();
    return {
      changed: true,
      createdCount: 1,
      createdRefs: [createdReference.storedRef]
    };
  }
  requireMarkdownFile(file) {
    if (!(file instanceof import_obsidian4.TFile) || file.extension !== "md") {
      throw new Error("Open a Markdown word note first.");
    }
    return file;
  }
  assertReplaceRangeAllowed(markdown, from, to) {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const touchedEndLine = getTouchedEndLine(from, to);
    const frontmatterEndLine = getFrontmatterEndLine(lines);
    if (frontmatterEndLine !== null && from.line <= frontmatterEndLine) {
      throw new Error("Do not create references from frontmatter.");
    }
    const fenceRanges = getFenceRanges(lines);
    if (rangeTouchesAnyLine(from.line, touchedEndLine, fenceRanges)) {
      throw new Error("Do not create references from inside an existing code fence.");
    }
    if (!editorRangeHasMeaningfulText(lines, from, to)) {
      throw new Error("The selected reference text is empty.");
    }
  }
  assertSingleCursorAllowed(lines, lineIndex) {
    const frontmatterEndLine = getFrontmatterEndLine(lines);
    if (frontmatterEndLine !== null && lineIndex <= frontmatterEndLine) {
      throw new Error("Move the cursor out of frontmatter first.");
    }
    const fenceRanges = getFenceRanges(lines);
    if (rangeTouchesAnyLine(lineIndex, lineIndex, fenceRanges)) {
      throw new Error("Move the cursor out of an existing code fence first.");
    }
  }
  getParagraphRange(lines, lineIndex) {
    const currentLine = lines[lineIndex] ?? "";
    if (isBlankLine(currentLine)) {
      throw new Error("Place the cursor on a non-empty reference paragraph first.");
    }
    let startLine = lineIndex;
    while (startLine > 0) {
      const previousLine = lines[startLine - 1] ?? "";
      if (isBlankLine(previousLine) || isFenceLine(previousLine)) {
        break;
      }
      startLine -= 1;
    }
    let endLine = lineIndex;
    while (endLine < lines.length - 1) {
      const nextLine = lines[endLine + 1] ?? "";
      if (isBlankLine(nextLine) || isFenceLine(nextLine)) {
        break;
      }
      endLine += 1;
    }
    return {
      from: { line: startLine, ch: 0 },
      to: { line: endLine, ch: (lines[endLine] ?? "").length }
    };
  }
  async createReference(rawText) {
    const referenceFolderPath = this.pathScope.getPrimaryReferenceFolderPath();
    if (!referenceFolderPath) {
      throw new Error("No reference folder is configured.");
    }
    await this.ensureFolderPath(referenceFolderPath);
    let stem = "";
    let referenceFilePath = "";
    for (; ; ) {
      const timestamp = formatTimestampStem(/* @__PURE__ */ new Date());
      const triedSuffixes = /* @__PURE__ */ new Set();
      while (triedSuffixes.size < GENERATED_REFERENCE_SUFFIX_SPACE) {
        const suffix = randomReferenceSuffix();
        if (triedSuffixes.has(suffix)) {
          continue;
        }
        triedSuffixes.add(suffix);
        const candidateStem = `${GENERATED_REFERENCE_PREFIX}-${timestamp}-${suffix}`;
        const candidatePath = (0, import_obsidian4.normalizePath)(`${referenceFolderPath}/${candidateStem}.md`);
        if (this.app.vault.getAbstractFileByPath(candidatePath)) {
          continue;
        }
        stem = candidateStem;
        referenceFilePath = candidatePath;
        break;
      }
      if (stem && referenceFilePath) {
        break;
      }
    }
    const fileContent = createReferenceFileContent(rawText, stem);
    await this.app.vault.create(referenceFilePath, fileContent);
    const storedRef = this.pathScope.toStoredReferenceMarkdownStem(referenceFilePath);
    if (!storedRef) {
      throw new Error(`Failed to resolve the created reference path: ${referenceFilePath}`);
    }
    return {
      storedRef,
      embed: buildReferenceEmbed(storedRef)
    };
  }
  async ensureFolderPath(folderPath) {
    const normalizedFolderPath = (0, import_obsidian4.normalizePath)(folderPath);
    const existing = this.app.vault.getAbstractFileByPath(normalizedFolderPath);
    if (existing) {
      return;
    }
    const parts = normalizedFolderPath.split("/").filter(Boolean);
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (this.app.vault.getAbstractFileByPath(currentPath)) {
        continue;
      }
      await this.app.vault.createFolder(currentPath);
    }
  }
};
function editorRangeHasMeaningfulText(lines, from, to) {
  if (from.line === to.line) {
    const currentLine = lines[from.line] ?? "";
    return currentLine.slice(from.ch, to.ch).trim().length > 0;
  }
  const touchedEndLine = getTouchedEndLine(from, to);
  for (let lineIndex = from.line; lineIndex <= touchedEndLine; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    let lineText = currentLine;
    if (lineIndex === from.line) {
      lineText = lineText.slice(from.ch);
    }
    if (lineIndex === to.line) {
      lineText = lineText.slice(0, to.ch);
    }
    if (lineText.trim().length > 0) {
      return true;
    }
  }
  return false;
}

// src/managed-file-registry.ts
function normalizeRegistryPath(path) {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}
function isMarkdownFile2(file) {
  return typeof file.path === "string" && file.extension === "md";
}
function sortFiles(files) {
  return Array.from(files).sort((left, right) => left.path.localeCompare(right.path));
}
var ManagedFileRegistry = class {
  constructor(app, pathScope) {
    this.app = app;
    this.pathScope = pathScope;
    this.filesByPath = /* @__PURE__ */ new Map();
    this.wordPaths = /* @__PURE__ */ new Set();
    this.referencePaths = /* @__PURE__ */ new Set();
  }
  rebuild() {
    this.filesByPath.clear();
    this.wordPaths.clear();
    this.referencePaths.clear();
    for (const file of this.app.vault.getMarkdownFiles()) {
      this.trackFile(file);
    }
  }
  update(file) {
    this.remove(file.path);
    if (isMarkdownFile2(file)) {
      this.trackFile(file);
    }
  }
  rename(file, oldPath) {
    this.remove(oldPath);
    this.update(file);
  }
  remove(path) {
    const normalizedPath = normalizeRegistryPath(path);
    this.filesByPath.delete(normalizedPath);
    this.wordPaths.delete(normalizedPath);
    this.referencePaths.delete(normalizedPath);
  }
  getFile(path) {
    return this.filesByPath.get(normalizeRegistryPath(path)) ?? null;
  }
  getWordFiles() {
    return this.getFilesByPathSet(this.wordPaths);
  }
  getReferenceFiles() {
    return this.getFilesByPathSet(this.referencePaths);
  }
  getReferencePaths() {
    return Array.from(this.referencePaths).sort((left, right) => left.localeCompare(right));
  }
  trackFile(file) {
    const normalizedPath = normalizeRegistryPath(file.path);
    this.filesByPath.set(normalizedPath, file);
    if (this.pathScope.isWordPath(normalizedPath)) {
      this.wordPaths.add(normalizedPath);
      this.referencePaths.delete(normalizedPath);
      return;
    }
    if (this.pathScope.isReferencePath(normalizedPath)) {
      this.referencePaths.add(normalizedPath);
      this.wordPaths.delete(normalizedPath);
      return;
    }
    this.wordPaths.delete(normalizedPath);
    this.referencePaths.delete(normalizedPath);
  }
  getFilesByPathSet(paths) {
    return sortFiles(
      Array.from(paths).map((path) => this.filesByPath.get(path)).filter((file) => !!file)
    );
  }
};

// src/path-scope.ts
var import_obsidian5 = require("obsidian");
function normalizeSegment(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = (0, import_obsidian5.normalizePath)(trimmed);
  return normalized.replace(/^\/+|\/+$/g, "");
}
function stripMarkdownExtension(path) {
  return path.replace(/\.md$/i, "");
}
function matchesPrefix(path, folderPath) {
  return path === folderPath || path.startsWith(`${folderPath}/`);
}
function splitSegments(path) {
  return normalizeSegment(path).split("/").map((segment) => segment.trim()).filter(Boolean);
}
var PathScope = class {
  constructor(settings) {
    this.settings = settings;
  }
  updateSettings(settings) {
    this.settings = settings;
  }
  normalizeVaultPath(path) {
    return (0, import_obsidian5.normalizePath)(path);
  }
  getWordFolderPath() {
    return normalizeSegment(this.settings.wordFolder);
  }
  getReferenceFolderPath() {
    return normalizeSegment(this.settings.referenceFolder);
  }
  getReferenceFolderName() {
    const segments = splitSegments(this.getReferenceFolderPath());
    return segments[segments.length - 1] ?? "";
  }
  getReferenceFolderParentPath() {
    const segments = splitSegments(this.getReferenceFolderPath());
    if (segments.length <= 1) {
      return "";
    }
    return segments.slice(0, -1).join("/");
  }
  getPrimaryReferenceFolderPath() {
    const referenceFolderPath = this.getReferenceFolderPath();
    return referenceFolderPath || null;
  }
  toStoredReferenceMarkdownStem(path) {
    const normalizedPath = stripMarkdownExtension(this.normalizeVaultPath(path));
    const referenceFolderPath = this.getReferenceFolderPath();
    if (!referenceFolderPath || !matchesPrefix(normalizedPath, referenceFolderPath)) {
      return null;
    }
    const parentPath = this.getReferenceFolderParentPath();
    if (!parentPath) {
      return normalizedPath;
    }
    if (!normalizedPath.startsWith(`${parentPath}/`)) {
      return null;
    }
    return normalizedPath.slice(parentPath.length + 1);
  }
  normalizeStoredReferenceStem(storedRef) {
    const normalizedStoredRef = normalizeSegment(stripMarkdownExtension(storedRef));
    if (!normalizedStoredRef) {
      return "";
    }
    const referenceFolderName = this.getReferenceFolderName();
    if (!referenceFolderName) {
      return normalizedStoredRef;
    }
    if (normalizedStoredRef === "Examples") {
      return referenceFolderName;
    }
    if (normalizedStoredRef.startsWith("Examples/")) {
      return `${referenceFolderName}/${normalizedStoredRef.slice("Examples/".length)}`;
    }
    return normalizedStoredRef;
  }
  resolveStoredReferenceStemToVaultPath(storedRef) {
    const normalizedStoredRef = this.normalizeStoredReferenceStem(storedRef);
    if (!normalizedStoredRef) {
      return null;
    }
    const parentPath = this.getReferenceFolderParentPath();
    const candidatePath = parentPath ? (0, import_obsidian5.normalizePath)(`${parentPath}/${normalizedStoredRef}`) : normalizedStoredRef;
    const referenceFolderPath = this.getReferenceFolderPath();
    if (!referenceFolderPath || !matchesPrefix(candidatePath, referenceFolderPath)) {
      return null;
    }
    return candidatePath;
  }
  classifyPath(path) {
    const normalizedPath = this.normalizeVaultPath(path);
    const wordFolderPath = this.getWordFolderPath();
    if (wordFolderPath && matchesPrefix(normalizedPath, wordFolderPath)) {
      return "word";
    }
    const referenceFolderPath = this.getReferenceFolderPath();
    if (referenceFolderPath && matchesPrefix(normalizedPath, referenceFolderPath)) {
      return "reference";
    }
    return "other";
  }
  isWordPath(path) {
    return this.classifyPath(path) === "word";
  }
  isReferencePath(path) {
    return this.classifyPath(path) === "reference";
  }
};

// src/performance-monitor.ts
var STORAGE_KEY = "eudic-sync:perf";
function isEnabled() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}
var PerformanceMonitor = class {
  measure(label, callback) {
    if (!isEnabled()) {
      return callback();
    }
    const startedAt = now();
    try {
      const result = callback();
      if (result instanceof Promise) {
        return result.finally(() => this.log(label, startedAt));
      }
      this.log(label, startedAt);
      return result;
    } catch (error) {
      this.log(label, startedAt);
      throw error;
    }
  }
  log(label, startedAt) {
    if (!isEnabled()) {
      return;
    }
    const elapsedMs = Math.round((now() - startedAt) * 10) / 10;
    console.debug(`[eudic-sync:perf] ${label}: ${elapsedMs}ms`);
  }
};

// src/reference-index-service.ts
function normalizeGraphPath(path) {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}
function formatUsageUpdatedAt(date = /* @__PURE__ */ new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(absoluteOffsetMinutes / 60));
  const offsetRemainderMinutes = pad(absoluteOffsetMinutes % 60);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${offsetHours}:${offsetRemainderMinutes}`;
}
function buildWikiLink(file, displayText = file.basename) {
  return `[[${file.path}|${displayText}]]`;
}
function cloneSet(input) {
  return new Set(input);
}
function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function readYamlBoolean(markdown, key) {
  const yamlMatch = markdown.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  const yaml = yamlMatch?.[1];
  if (!yaml) {
    return null;
  }
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(.+?)\\s*$`);
  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(keyPattern);
    if (!match) {
      continue;
    }
    const value = (match[1] ?? "").replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "").toLowerCase();
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return null;
  }
  return null;
}
function isWordSyncDisabledForIndex(app, file, markdown) {
  const syncEnabled = readYamlBoolean(markdown, FRONTMATTER_KEYS.syncEudicEnabled);
  if (syncEnabled !== null) {
    return !syncEnabled;
  }
  const legacyEnabled = readYamlBoolean(markdown, FRONTMATTER_KEYS.eudicSync);
  if (legacyEnabled !== null) {
    return legacyEnabled === false;
  }
  const frontmatter = getFrontmatter(app, file);
  return isWordSyncDisabledFrontmatter(frontmatter);
}
function sortedStrings(values) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
function setsEqual(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
function usageNeedsRewrite(frontmatter, referenceId, referencedBy) {
  const referencedByPaths = referencedBy.map((file) => file.path);
  const referencedByLinks = referencedBy.map((file) => buildWikiLink(file));
  return readEudicLinkId(frontmatter) !== referenceId || readNumber(frontmatter[FRONTMATTER_KEYS.refCount]) !== referencedBy.length || !stringArraysEqual2(readStringArray(frontmatter[FRONTMATTER_KEYS.referencedBy]), referencedByPaths) || !stringArraysEqual2(readStringArray(frontmatter[FRONTMATTER_KEYS.referencedByLinks]), referencedByLinks) || readNullableString(frontmatter[FRONTMATTER_KEYS.usageUpdatedAt]) === null;
}
function readReferencedByWordPaths(frontmatter) {
  return readStringArray(frontmatter[FRONTMATTER_KEYS.referencedBy]);
}
function isMarkdownFilePath(path) {
  return path.toLocaleLowerCase().endsWith(".md");
}
var ReferenceGraphService = class {
  constructor(options) {
    this.options = options;
    this.wordToReferences = /* @__PURE__ */ new Map();
    this.referenceToWords = /* @__PURE__ */ new Map();
    this.scannedReferencePaths = /* @__PURE__ */ new Set();
    this.isIndexBuilt = false;
  }
  async rebuildAll() {
    this.isIndexBuilt = false;
    this.wordToReferences.clear();
    this.referenceToWords.clear();
    this.scannedReferencePaths.clear();
    for (const file of await this.getManagedWordFilesForScan()) {
      await this.updateWord(file);
    }
    this.isIndexBuilt = true;
  }
  async updateWord(file, markdown) {
    const wordPath = normalizeGraphPath(file.path);
    if (!this.options.pathScope.isWordPath(wordPath)) {
      return {
        wordPath,
        referencePaths: [],
        storedReferencePaths: [],
        affectedReferencePaths: this.removeWord(wordPath),
        disabled: true
      };
    }
    const sourceMarkdown = markdown ?? await this.options.app.vault.cachedRead(file);
    if (isWordSyncDisabledForIndex(this.options.app, file, sourceMarkdown)) {
      return {
        wordPath,
        referencePaths: [],
        storedReferencePaths: [],
        affectedReferencePaths: this.removeWord(wordPath),
        disabled: true
      };
    }
    const referencePaths = resolveManagedReferencePaths(this.options.app, this.options.pathScope, file, sourceMarkdown);
    const affectedReferencePaths = this.setWordReferences(wordPath, new Set(referencePaths));
    const storedReferencePaths = toStoredReferenceRefs(this.options.pathScope, referencePaths);
    return {
      wordPath,
      referencePaths,
      storedReferencePaths,
      affectedReferencePaths,
      disabled: false
    };
  }
  removeWord(path) {
    const normalizedPath = normalizeGraphPath(path);
    const previousReferences = this.wordToReferences.get(normalizedPath) ?? /* @__PURE__ */ new Set();
    for (const referencePath of previousReferences) {
      this.scannedReferencePaths.delete(referencePath);
      const wordPaths = this.referenceToWords.get(referencePath);
      wordPaths?.delete(normalizedPath);
      if (wordPaths?.size === 0) {
        this.referenceToWords.delete(referencePath);
      }
    }
    this.wordToReferences.delete(normalizedPath);
    return sortedStrings(previousReferences);
  }
  findWordsReferencing(referencePath) {
    return sortedStrings(this.referenceToWords.get(normalizeGraphPath(referencePath)) ?? []);
  }
  async findWordsReferencingWithFallback(referencePath, options = {}) {
    const normalizedReferencePath = normalizeGraphPath(referencePath);
    if (options.forceScan) {
      return this.scanWordsReferencingReference(normalizedReferencePath);
    }
    const wordPaths = new Set(this.findWordsReferencing(normalizedReferencePath));
    const affectedReferencePaths = /* @__PURE__ */ new Set();
    affectedReferencePaths.add(normalizedReferencePath);
    if (this.isIndexBuilt) {
      return {
        wordPaths: sortedStrings(wordPaths),
        affectedReferencePaths: sortedStrings(affectedReferencePaths),
        scannedWordCount: 0
      };
    }
    return this.scanWordsReferencingReference(normalizedReferencePath);
  }
  async scanWordsReferencingReference(referencePath) {
    const normalizedReferencePath = normalizeGraphPath(referencePath);
    const wordPaths = /* @__PURE__ */ new Set();
    const affectedReferencePaths = /* @__PURE__ */ new Set([normalizedReferencePath]);
    let scannedWordCount = 0;
    for (const file of await this.getManagedWordFilesForScan()) {
      scannedWordCount += 1;
      const markdown = await this.options.app.vault.cachedRead(file);
      const result = await this.updateWord(file, markdown);
      for (const affectedPath of result.affectedReferencePaths) {
        affectedReferencePaths.add(affectedPath);
      }
      if (result.disabled) {
        continue;
      }
      if (result.referencePaths.includes(normalizedReferencePath)) {
        wordPaths.add(file.path);
      }
    }
    this.scannedReferencePaths.add(normalizedReferencePath);
    this.isIndexBuilt = true;
    return {
      referencePath: normalizedReferencePath,
      wordPaths: sortedStrings(wordPaths),
      affectedReferencePaths: sortedStrings(affectedReferencePaths),
      scannedWordCount
    };
  }
  async refreshReferenceUsage(referencePaths) {
    if (!referencePaths) {
      return this.emptyRepairResult();
    }
    return this.repairReferenceMetadata(referencePaths, {
      write: this.getReferenceMetadataWriteMode() === "auto",
      forceFreshScan: true
    });
  }
  async rebuildLegacyReferenceMetadata() {
    return this.repairAllReferenceMetadata({ write: true });
  }
  async repairAllReferenceMetadata(options = {}) {
    return this.repairReferenceMetadata(void 0, {
      write: options.write ?? true,
      forceFreshScan: true
    });
  }
  async repairReferenceMetadataForReference(referencePath, options = {}) {
    return this.repairReferenceMetadata([referencePath], {
      write: options.write ?? this.getReferenceMetadataWriteMode() === "auto",
      forceFreshScan: options.forceFreshScan ?? true
    });
  }
  async repairReferenceMetadata(referencePaths, options = {}) {
    const shouldWrite = options.write === true;
    const forceFreshScan = options.forceFreshScan === true;
    const affectedWordPaths = /* @__PURE__ */ new Set();
    const affectedReferencePaths = /* @__PURE__ */ new Set();
    const repairedWordPaths = /* @__PURE__ */ new Set();
    let scannedWordCount = 0;
    let targetReferencePaths;
    if (referencePaths) {
      targetReferencePaths = sortedStrings(referencePaths).filter(
        (referencePath) => this.options.pathScope.isReferencePath(referencePath)
      );
      for (const referencePath of targetReferencePaths) {
        const existingReferencedBy = this.readReferencePropertyWordPaths(referencePath);
        for (const wordPath of existingReferencedBy) {
          affectedWordPaths.add(wordPath);
        }
        const lookup = forceFreshScan ? await this.scanWordsReferencingReference(referencePath) : await this.findWordsReferencingWithFallback(referencePath, { forceScan: true });
        scannedWordCount += lookup.scannedWordCount;
        for (const wordPath of lookup.wordPaths) {
          repairedWordPaths.add(wordPath);
          affectedWordPaths.add(wordPath);
        }
        for (const affectedReferencePath of lookup.affectedReferencePaths) {
          affectedReferencePaths.add(affectedReferencePath);
        }
        affectedReferencePaths.add(referencePath);
      }
    } else {
      await this.rebuildAll();
      scannedWordCount += (await this.getManagedWordFilesForScan()).length;
      targetReferencePaths = await this.getAllReferencePaths();
      for (const referencePath of targetReferencePaths) {
        affectedReferencePaths.add(referencePath);
        for (const wordPath of this.findWordsReferencing(referencePath)) {
          repairedWordPaths.add(wordPath);
          affectedWordPaths.add(wordPath);
        }
        for (const wordPath of this.readReferencePropertyWordPaths(referencePath)) {
          affectedWordPaths.add(wordPath);
        }
      }
    }
    let wordMetadataUpdated = 0;
    let referenceMetadataUpdated = 0;
    if (shouldWrite) {
      const wordFilesToRepair = referencePaths ? sortedStrings(affectedWordPaths).map((wordPath) => this.getMarkdownFileByPath(wordPath)).filter((file) => !!file && file.extension === "md" && this.options.pathScope.isWordPath(file.path)) : await this.getManagedWordFilesForScan();
      for (const wordFile of wordFilesToRepair) {
        const references = this.findReferencesForWord(wordFile.path);
        const storedReferencePaths = toStoredReferenceRefs(this.options.pathScope, references);
        if (await this.writeWordLegacyReferencePathsIfNeeded(wordFile, storedReferencePaths)) {
          wordMetadataUpdated += 1;
          affectedWordPaths.add(wordFile.path);
        }
      }
      for (const referencePath of targetReferencePaths) {
        const file = this.options.managedFiles.getFile(referencePath) ?? this.options.app.vault.getFileByPath(referencePath);
        if (!file || file.extension !== "md" || !this.options.pathScope.isReferencePath(file.path)) {
          continue;
        }
        if (await this.writeReferenceLegacyUsageIfNeeded(file)) {
          referenceMetadataUpdated += 1;
          affectedReferencePaths.add(file.path);
          for (const wordPath of this.findWordsReferencing(file.path)) {
            affectedWordPaths.add(wordPath);
          }
        }
      }
    }
    return {
      wordMetadataUpdated,
      referenceMetadataUpdated,
      affectedWordPaths: sortedStrings(affectedWordPaths),
      affectedReferencePaths: sortedStrings(affectedReferencePaths),
      wordPaths: sortedStrings(repairedWordPaths),
      scannedWordCount
    };
  }
  emptyRepairResult() {
    return {
      wordMetadataUpdated: 0,
      referenceMetadataUpdated: 0,
      affectedWordPaths: [],
      affectedReferencePaths: [],
      wordPaths: [],
      scannedWordCount: 0
    };
  }
  findReferencesForWord(wordPath) {
    return sortedStrings(this.wordToReferences.get(normalizeGraphPath(wordPath)) ?? []);
  }
  readReferencePropertyWordPaths(referencePath) {
    const normalizedPath = normalizeGraphPath(referencePath);
    const file = this.getMarkdownFileByPath(normalizedPath);
    if (!file || file.extension !== "md" || !this.options.pathScope.isReferencePath(file.path)) {
      return [];
    }
    return readReferencedByWordPaths(getFrontmatter(this.options.app, file)).map(normalizeGraphPath).filter((wordPath) => this.options.pathScope.isWordPath(wordPath));
  }
  invalidate(paths) {
    if (!paths) {
      this.isIndexBuilt = false;
      this.wordToReferences.clear();
      this.referenceToWords.clear();
      this.scannedReferencePaths.clear();
      return;
    }
    for (const path of paths) {
      const normalizedPath = normalizeGraphPath(path);
      if (this.options.pathScope.isWordPath(normalizedPath)) {
        this.removeWord(normalizedPath);
      }
      if (this.options.pathScope.isReferencePath(normalizedPath)) {
        this.scannedReferencePaths.delete(normalizedPath);
        const wordPaths = this.referenceToWords.get(normalizedPath) ?? /* @__PURE__ */ new Set();
        for (const wordPath of wordPaths) {
          this.wordToReferences.get(wordPath)?.delete(normalizedPath);
        }
        this.referenceToWords.delete(normalizedPath);
      }
    }
  }
  async writeWordLegacyReferencePathsIfNeeded(file, storedReferencePaths) {
    const currentStoredReferenceRefs = readStringArray(getFrontmatter(this.options.app, file)[FRONTMATTER_KEYS.referencePaths]);
    const frontmatter = getFrontmatter(this.options.app, file);
    const hasStableReferencePaths = Array.isArray(frontmatter[FRONTMATTER_KEYS.referencePaths]);
    const hasLegacyReferenceRefs = FRONTMATTER_KEYS.legacyReferenceRefs in frontmatter;
    if (stringArraysEqual2(currentStoredReferenceRefs, storedReferencePaths) && hasStableReferencePaths && !hasLegacyReferenceRefs) {
      return false;
    }
    await this.options.writeFrontmatter(file, (nextFrontmatter) => {
      nextFrontmatter[FRONTMATTER_KEYS.referencePaths] = storedReferencePaths;
      delete nextFrontmatter[FRONTMATTER_KEYS.legacyReferenceRefs];
    });
    return true;
  }
  getReferenceMetadataWriteMode() {
    return this.options.getReferenceMetadataWriteMode?.() ?? "off";
  }
  setWordReferences(wordPath, nextReferences) {
    const normalizedWordPath = normalizeGraphPath(wordPath);
    const previousReferences = this.wordToReferences.get(normalizedWordPath) ?? /* @__PURE__ */ new Set();
    if (setsEqual(previousReferences, nextReferences)) {
      return [];
    }
    const affectedReferencePaths = /* @__PURE__ */ new Set([...previousReferences, ...nextReferences]);
    for (const referencePath of affectedReferencePaths) {
      this.scannedReferencePaths.delete(referencePath);
    }
    for (const referencePath of previousReferences) {
      const wordPaths = this.referenceToWords.get(referencePath);
      wordPaths?.delete(normalizedWordPath);
      if (wordPaths?.size === 0) {
        this.referenceToWords.delete(referencePath);
      }
    }
    if (nextReferences.size === 0) {
      this.wordToReferences.delete(normalizedWordPath);
      return sortedStrings(affectedReferencePaths);
    }
    const clonedReferences = cloneSet(nextReferences);
    this.wordToReferences.set(normalizedWordPath, clonedReferences);
    for (const referencePath of clonedReferences) {
      let wordPaths = this.referenceToWords.get(referencePath);
      if (!wordPaths) {
        wordPaths = /* @__PURE__ */ new Set();
        this.referenceToWords.set(referencePath, wordPaths);
      }
      wordPaths.add(normalizedWordPath);
    }
    return sortedStrings(affectedReferencePaths);
  }
  async writeReferenceLegacyUsageIfNeeded(referenceFile) {
    const frontmatter = getFrontmatter(this.options.app, referenceFile);
    const referenceId = readEudicLinkId(frontmatter) ?? createEudicLinkId("reference");
    const referencedByPaths = this.findWordsReferencing(referenceFile.path);
    const referencedBy = referencedByPaths.map((wordPath) => this.getMarkdownFileByPath(wordPath)).filter((file) => !!file && file.extension === "md").filter((file) => !isWordSyncDisabledFrontmatter(getFrontmatter(this.options.app, file))).sort((left, right) => left.path.localeCompare(right.path));
    for (const wordFile of referencedBy) {
      this.ensureWordReferencesInclude(wordFile.path, referenceFile.path);
    }
    if (!usageNeedsRewrite(frontmatter, referenceId, referencedBy)) {
      return false;
    }
    const nextReferencedByPaths = referencedBy.map((file) => file.path);
    const referencedByLinks = referencedBy.map((file) => buildWikiLink(file));
    await this.options.writeFrontmatter(referenceFile, (nextFrontmatter) => {
      nextFrontmatter[FRONTMATTER_KEYS.eudicLinkId] = referenceId;
      nextFrontmatter[FRONTMATTER_KEYS.refCount] = referencedBy.length;
      nextFrontmatter[FRONTMATTER_KEYS.referencedBy] = nextReferencedByPaths;
      nextFrontmatter[FRONTMATTER_KEYS.referencedByLinks] = referencedByLinks;
      nextFrontmatter[FRONTMATTER_KEYS.usageUpdatedAt] = formatUsageUpdatedAt();
    });
    return true;
  }
  ensureWordReferencesInclude(wordPath, referencePath) {
    const normalizedWordPath = normalizeGraphPath(wordPath);
    const normalizedReferencePath = normalizeGraphPath(referencePath);
    let references = this.wordToReferences.get(normalizedWordPath);
    if (!references) {
      references = /* @__PURE__ */ new Set();
      this.wordToReferences.set(normalizedWordPath, references);
    }
    references.add(normalizedReferencePath);
    let wordPaths = this.referenceToWords.get(normalizedReferencePath);
    if (!wordPaths) {
      wordPaths = /* @__PURE__ */ new Set();
      this.referenceToWords.set(normalizedReferencePath, wordPaths);
    }
    wordPaths.add(normalizedWordPath);
  }
  getMarkdownFileByPath(path) {
    const normalizedPath = normalizeGraphPath(path);
    const registryFile = this.options.managedFiles.getFile(normalizedPath);
    if (registryFile?.extension === "md") {
      return registryFile;
    }
    const vaultFile = this.options.app.vault.getFileByPath(normalizedPath);
    if (vaultFile?.extension === "md") {
      return vaultFile;
    }
    const abstractFile = this.options.app.vault.getAbstractFileByPath?.(normalizedPath);
    if (abstractFile && "extension" in abstractFile && abstractFile.extension === "md") {
      return abstractFile;
    }
    return null;
  }
  async getAllReferencePaths() {
    return (await this.getManagedReferenceFilesForScan()).map((file) => file.path);
  }
  async getManagedWordFilesForScan() {
    return this.getManagedFilesForScan("word");
  }
  async getManagedReferenceFilesForScan() {
    return this.getManagedFilesForScan("reference");
  }
  async getManagedFilesForScan(kind) {
    const filesByPath = /* @__PURE__ */ new Map();
    const addFile = (file) => {
      if (!file || file.extension !== "md") {
        return;
      }
      const normalizedPath = normalizeGraphPath(file.path);
      const matchesScope = kind === "word" ? this.options.pathScope.isWordPath(normalizedPath) : this.options.pathScope.isReferencePath(normalizedPath);
      if (matchesScope) {
        filesByPath.set(normalizedPath, file);
      }
    };
    const registryFiles = kind === "word" ? this.options.managedFiles.getWordFiles() : this.options.managedFiles.getReferenceFiles();
    for (const file of registryFiles) {
      addFile(file);
    }
    for (const file of this.options.app.vault.getMarkdownFiles()) {
      addFile(file);
    }
    const folderPath = kind === "word" ? this.getWordFolderPath() : this.getReferenceFolderPath();
    if (folderPath) {
      for (const file of await this.listMarkdownFilesFromFolder(folderPath)) {
        addFile(file);
      }
    }
    return Array.from(filesByPath.values()).sort((left, right) => left.path.localeCompare(right.path));
  }
  getWordFolderPath() {
    return this.options.pathScope.getWordFolderPath?.() ?? "";
  }
  getReferenceFolderPath() {
    return this.options.pathScope.getReferenceFolderPath?.() ?? "";
  }
  async listMarkdownFilesFromFolder(folderPath) {
    const adapter = this.options.app.vault.adapter;
    if (!adapter?.list) {
      return [];
    }
    const files = [];
    const seenFolders = /* @__PURE__ */ new Set();
    const visit = async (folder) => {
      const normalizedFolder = normalizeGraphPath(folder).replace(/^\/+|\/+$/g, "");
      if (!normalizedFolder || seenFolders.has(normalizedFolder)) {
        return;
      }
      seenFolders.add(normalizedFolder);
      let listed;
      try {
        listed = await adapter.list(normalizedFolder);
      } catch {
        return;
      }
      for (const path of listed.files) {
        const normalizedPath = normalizeGraphPath(path);
        if (!isMarkdownFilePath(normalizedPath)) {
          continue;
        }
        const file = this.getMarkdownFileByPath(normalizedPath);
        if (file) {
          files.push(file);
        }
      }
      for (const childFolder of listed.folders) {
        await visit(childFolder);
      }
    };
    await visit(folderPath);
    return files;
  }
};

// src/semantic-block-automation-resolver.ts
function normalizeResolverPath(path) {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}
function encodeQuery2(params) {
  return Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}
function buildWordProtocolUrl(app, id, word) {
  return `obsidian://eudic-sync?${encodeQuery2({
    vault: app.vault.getName(),
    kind: "word",
    id,
    word
  })}`;
}
var SemanticBlockAutomationResolver = class {
  constructor(options) {
    this.options = options;
    this.referenceTargetsByPath = /* @__PURE__ */ new Map();
  }
  invalidateReferenceLinkTargets(referencePaths) {
    if (!referencePaths) {
      this.referenceTargetsByPath.clear();
      return;
    }
    for (const referencePath of referencePaths) {
      this.referenceTargetsByPath.delete(normalizeResolverPath(referencePath));
    }
  }
  async getTransformOptionsForSourcePath(resolveOptions) {
    const sourcePath = normalizeResolverPath(resolveOptions.sourcePath ?? "");
    const sourceFile = this.options.managedFiles.getFile(sourcePath) ?? this.options.app.vault.getFileByPath(sourcePath);
    if (!sourceFile || sourceFile.extension !== "md") {
      return null;
    }
    const settings = this.options.getSettings();
    if (this.options.pathScope.isWordPath(sourceFile.path)) {
      const wordTarget = this.getWordTarget(sourceFile, resolveOptions);
      return wordTarget ? buildWordSemanticBlockTransformOptions(settings, wordTarget) : null;
    }
    if (this.options.pathScope.isReferencePath(sourceFile.path)) {
      const currentWordTarget = resolveOptions.currentWordFile ? this.getWordTarget(resolveOptions.currentWordFile, resolveOptions) : null;
      const referenceTargets = await this.getReferenceSemanticTargets(sourceFile, resolveOptions);
      return buildReferenceSemanticBlockTransformOptions(
        settings,
        currentWordTarget?.word ?? referenceTargets.currentWordTarget?.word ?? null,
        referenceTargets.linkTargets
      );
    }
    return null;
  }
  getReferenceSemanticTargets(referenceFile, resolveOptions) {
    if (resolveOptions.currentWordFile || resolveOptions.currentWord || resolveOptions.currentWordLinkId || resolveOptions.embeddedFromPath) {
      return this.resolveReferenceSemanticTargets(referenceFile, resolveOptions);
    }
    const normalizedPath = normalizeResolverPath(referenceFile.path);
    const cached = this.referenceTargetsByPath.get(normalizedPath);
    if (cached) {
      return Promise.resolve(cached.targets);
    }
    return this.resolveReferenceSemanticTargets(referenceFile, resolveOptions).then((targets) => {
      this.referenceTargetsByPath.set(normalizedPath, {
        referencePath: normalizedPath,
        targets
      });
      return targets;
    });
  }
  async resolveReferenceSemanticTargets(referenceFile, resolveOptions) {
    const propertyWordPaths = this.getReferencePropertyWordPaths(referenceFile);
    const graphWordPaths = this.options.referenceIndex?.findWordsReferencing(referenceFile.path) ?? [];
    const wordPaths = new Set(propertyWordPaths);
    for (const wordPath of graphWordPaths) {
      wordPaths.add(wordPath);
    }
    if ((propertyWordPaths.length === 0 || propertyWordPaths.length > 0 && graphWordPaths.length === 0) && this.options.referenceIndex?.repairReferenceMetadataForReference) {
      const lookup = await this.options.referenceIndex.repairReferenceMetadataForReference(referenceFile.path, {
        forceFreshScan: true
      });
      for (const wordPath of lookup.wordPaths) {
        wordPaths.add(wordPath);
      }
      for (const wordPath of this.getReferencePropertyWordPaths(referenceFile)) {
        wordPaths.add(wordPath);
      }
    }
    const currentWordFile = resolveOptions.currentWordFile ?? null;
    const currentWordReferences = currentWordFile ? this.currentWordReferencesReference(wordPaths, currentWordFile, resolveOptions) : false;
    const currentWordTarget = currentWordReferences && currentWordFile ? this.getWordTarget(currentWordFile, resolveOptions) : null;
    if (currentWordReferences && currentWordFile) {
      wordPaths.add(currentWordFile.path);
    }
    const targets = [];
    for (const wordPath of Array.from(wordPaths).sort((left, right) => left.localeCompare(right))) {
      const wordFile = this.options.managedFiles.getFile(wordPath) ?? this.options.app.vault.getFileByPath(wordPath);
      if (!wordFile || wordFile.extension !== "md" || !this.options.pathScope.isWordPath(wordFile.path)) {
        continue;
      }
      const wordTarget = this.getWordTarget(wordFile, {});
      if (wordTarget?.linkUrl) {
        targets.push({
          word: wordTarget.word,
          linkUrl: wordTarget.linkUrl
        });
      }
    }
    return {
      currentWordTarget,
      linkTargets: mergeSemanticBlockLinkTargets(currentWordTarget, targets)
    };
  }
  currentWordReferencesReference(referenceWordPaths, currentWordFile, resolveOptions) {
    if (resolveOptions.embeddedFromPath && normalizeResolverPath(resolveOptions.embeddedFromPath) === normalizeResolverPath(currentWordFile.path)) {
      return true;
    }
    return Array.from(referenceWordPaths).map(normalizeResolverPath).includes(normalizeResolverPath(currentWordFile.path));
  }
  getReferencePropertyWordPaths(referenceFile) {
    const fromIndex = this.options.referenceIndex?.readReferencePropertyWordPaths?.(referenceFile.path);
    if (fromIndex) {
      return fromIndex;
    }
    return readStringArray(getFrontmatter(this.options.app, referenceFile)[FRONTMATTER_KEYS.referencedBy]).map(normalizeResolverPath).filter((wordPath) => this.options.pathScope.isWordPath(wordPath));
  }
  getWordTarget(wordFile, resolveOptions) {
    const context = getWordNoteContext(this.options.app, this.options.pathScope, wordFile);
    if (!context) {
      return null;
    }
    if (resolveOptions.currentWordFile && normalizeResolverPath(wordFile.path) === normalizeResolverPath(resolveOptions.currentWordFile.path) && resolveOptions.currentWord && resolveOptions.currentWordLinkId) {
      return {
        word: resolveOptions.currentWord,
        linkUrl: buildWordProtocolUrl(this.options.app, resolveOptions.currentWordLinkId, resolveOptions.currentWord)
      };
    }
    const frontmatter = getFrontmatter(this.options.app, wordFile);
    const linkId = readNullableString(frontmatter[FRONTMATTER_KEYS.eudicLinkId]);
    return {
      word: context.word,
      linkUrl: linkId ? buildWordProtocolUrl(this.options.app, linkId, context.word) : null
    };
  }
};

// src/settings.ts
var import_obsidian8 = require("obsidian");

// src/folder-suggest.ts
var import_obsidian6 = require("obsidian");
function normalizeFolderPath(value) {
  return (0, import_obsidian6.normalizePath)(value.trim()).replace(/^\/+|\/+$/g, "");
}
function uniqueOrdered(values) {
  const seen = /* @__PURE__ */ new Set();
  const ordered = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}
var FolderInputSuggest = class extends import_obsidian6.AbstractInputSuggest {
  constructor(app, textInputEl, onChoose) {
    super(app, textInputEl);
    this.onChoose = onChoose;
  }
  getSuggestions(query) {
    const normalizedQuery = normalizeFolderPath(query).toLowerCase();
    const folderPaths = uniqueOrdered(
      this.app.vault.getAllLoadedFiles().filter((entry) => entry instanceof import_obsidian6.TFolder).map((folder) => normalizeFolderPath(folder.path)).filter(Boolean)
    ).sort((left, right) => left.localeCompare(right));
    if (!normalizedQuery) {
      return folderPaths;
    }
    return folderPaths.filter((folderPath) => folderPath.toLowerCase().includes(normalizedQuery));
  }
  renderSuggestion(value, el) {
    el.createDiv({ text: value });
  }
  selectSuggestion(value, _evt) {
    this.setValue(value);
    void this.onChoose(value);
    this.close();
  }
};

// src/settings-data.ts
var import_obsidian7 = require("obsidian");
var LEGACY_AUTO_EXTRACT_PENDING_REFERENCES_SETTING = "enableAutoExtractPendingExamplesOnSave";
var SETTINGS_BACKUP_TYPE = "settings-backup";
var SETTINGS_BACKUP_VERSION = 1;
var IMPORTABLE_SETTINGS_KEYS = [
  "wordFolder",
  "referenceFolder",
  "authorizationToken",
  "noteOutputMode",
  "enableAutoBoldMarkersOnEdit",
  "boldMarkers",
  "enableSemanticBlockWordBold",
  "semanticBlockWordBoldKinds",
  "enableSemanticBlockMarkerBold",
  "enableSemanticBlockWordLinks",
  "semanticBlockWordLinkKinds",
  "semanticBlockKindPresets",
  "enableAutoExtractPendingReferencesOnSave",
  "enableAutoSyncWordOnLeave",
  "referenceMetadataWriteMode",
  "enableHeaderSyncButton",
  "enableStatusBarSyncButton"
];
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function normalizeFolderPath2(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return (0, import_obsidian7.normalizePath)(trimmed).replace(/^\/+|\/+$/g, "");
}
function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function readStringArray2(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string").map((entry) => normalizeFolderPath2(entry)).filter(Boolean);
}
function readLiteralStringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const marker = entry.trim();
    if (!marker || seen.has(marker)) {
      continue;
    }
    seen.add(marker);
    result.push(marker);
  }
  return result;
}
function readNumber2(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function joinNormalizedPath(parent, child) {
  if (!parent) {
    return child;
  }
  if (!child) {
    return parent;
  }
  return normalizeFolderPath2(`${parent}/${child}`);
}
function rewriteLegacyExamplesFolderToReferences(path) {
  const normalizedPath = normalizeFolderPath2(path);
  if (!normalizedPath) {
    return "";
  }
  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments[segments.length - 1] !== "Examples") {
    return normalizedPath;
  }
  segments[segments.length - 1] = "References";
  return segments.join("/");
}
function readBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function readStudylistCache(value) {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS.studylistCache;
  }
  const categories = Array.isArray(value.categories) ? value.categories.filter(isRecord).map((category) => ({
    id: readString(category.id) ?? "",
    language: readString(category.language) ?? "",
    name: readString(category.name) ?? ""
  })).filter((category) => category.id && category.language && category.name) : [];
  return {
    categories,
    refreshedAt: readString(value.refreshedAt)
  };
}
function readNoteOutputMode(value) {
  return value === "compatible" ? "compatible" : "minimal";
}
function readReferenceMetadataWriteMode(value, rawNoteOutputFormatVersion) {
  if (value === "manual") {
    return "manual";
  }
  if (value === "off") {
    return rawNoteOutputFormatVersion < 7 ? "auto" : "off";
  }
  return "auto";
}
function pickImportableSettings(settings) {
  const result = {};
  for (const key of IMPORTABLE_SETTINGS_KEYS) {
    const value = settings[key];
    result[key] = Array.isArray(value) ? [...value] : value;
  }
  return result;
}
function buildExportSettingsPayload(settings) {
  return {
    plugin: PLUGIN_ID,
    type: SETTINGS_BACKUP_TYPE,
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    settings: pickImportableSettings(settings)
  };
}
function readImportedSettingsPayload(rawData) {
  if (!isRecord(rawData)) {
    throw new Error(`${PLUGIN_NAME}: invalid settings backup file.`);
  }
  if (readString(rawData.plugin) !== PLUGIN_ID) {
    throw new Error(`${PLUGIN_NAME}: this file is not an eudic-sync settings backup.`);
  }
  if (readString(rawData.type) !== SETTINGS_BACKUP_TYPE) {
    throw new Error(`${PLUGIN_NAME}: unsupported settings backup type.`);
  }
  if (readNumber2(rawData.version) !== SETTINGS_BACKUP_VERSION) {
    throw new Error(`${PLUGIN_NAME}: unsupported settings backup version.`);
  }
  if (!isRecord(rawData.settings)) {
    throw new Error(`${PLUGIN_NAME}: settings backup is missing a valid settings object.`);
  }
  const loadResult = migrateLoadedSettings(rawData.settings);
  return {
    settings: pickImportableSettings(loadResult.settings),
    notices: loadResult.notices
  };
}
function migrateLoadedSettings(rawData) {
  const raw = isRecord(rawData) ? rawData : {};
  const notices = [];
  const rawNoteOutputFormatVersion = readNumber2(raw.noteOutputFormatVersion) ?? 1;
  const hasLegacyPathKeys = "libraryRoot" in raw || "syncFolders" in raw || "watchOnlyFolders" in raw || "excludeFolders" in raw;
  const hasLegacyAutoSyncOnSave = "enableAutoSyncWordOnSave" in raw;
  const legacyLibraryRoot = normalizeFolderPath2(readString(raw.libraryRoot) ?? DEFAULT_SETTINGS.wordFolder.split("/")[0] ?? "");
  const legacySyncFolders = readStringArray2(raw.syncFolders);
  const legacyWatchFolders = readStringArray2(raw.watchOnlyFolders);
  if (legacySyncFolders.length > 1) {
    notices.push(`${PLUGIN_NAME}: multiple legacy sync folders were found. Only the first folder was kept.`);
  }
  if (legacyWatchFolders.length > 1) {
    notices.push(`${PLUGIN_NAME}: multiple legacy watch-only folders were found. Only the first folder was kept.`);
  }
  const derivedLegacyWordFolder = joinNormalizedPath(legacyLibraryRoot, legacySyncFolders[0] ?? "Words");
  const derivedLegacyReferenceFolder = rewriteLegacyExamplesFolderToReferences(
    joinNormalizedPath(legacyLibraryRoot, legacyWatchFolders[0] ?? "Examples")
  );
  const normalizedWordFolder = normalizeFolderPath2(readString(raw.wordFolder) ?? "") || derivedLegacyWordFolder || DEFAULT_SETTINGS.wordFolder;
  const normalizedReferenceFolder = rewriteLegacyExamplesFolderToReferences(readString(raw.referenceFolder) ?? "") || derivedLegacyReferenceFolder || DEFAULT_SETTINGS.referenceFolder;
  const settings = {
    wordFolder: normalizedWordFolder,
    referenceFolder: normalizedReferenceFolder,
    authorizationToken: readString(raw.authorizationToken) ?? DEFAULT_SETTINGS.authorizationToken,
    studylistCache: readStudylistCache(raw.studylistCache),
    noteOutputMode: readNoteOutputMode(raw.noteOutputMode),
    noteOutputFormatVersion: isRecord(rawData) ? rawNoteOutputFormatVersion : NOTE_OUTPUT_FORMAT_VERSION,
    enableAutoBoldMarkersOnEdit: readBoolean(
      raw.enableAutoBoldMarkersOnEdit,
      DEFAULT_SETTINGS.enableAutoBoldMarkersOnEdit
    ),
    boldMarkers: readLiteralStringArray(raw.boldMarkers, DEFAULT_SETTINGS.boldMarkers),
    enableSemanticBlockWordBold: readBoolean(
      raw.enableSemanticBlockWordBold,
      DEFAULT_SETTINGS.enableSemanticBlockWordBold
    ),
    semanticBlockWordBoldKinds: readLiteralStringArray(
      raw.semanticBlockWordBoldKinds,
      DEFAULT_SETTINGS.semanticBlockWordBoldKinds
    ),
    enableSemanticBlockMarkerBold: readBoolean(
      raw.enableSemanticBlockMarkerBold,
      DEFAULT_SETTINGS.enableSemanticBlockMarkerBold
    ),
    enableSemanticBlockWordLinks: readBoolean(
      raw.enableSemanticBlockWordLinks,
      DEFAULT_SETTINGS.enableSemanticBlockWordLinks
    ),
    semanticBlockWordLinkKinds: readLiteralStringArray(
      raw.semanticBlockWordLinkKinds,
      DEFAULT_SETTINGS.semanticBlockWordLinkKinds
    ),
    semanticBlockKindPresets: readLiteralStringArray(
      raw.semanticBlockKindPresets,
      DEFAULT_SETTINGS.semanticBlockKindPresets
    ),
    enableAutoExtractPendingReferencesOnSave: readBoolean(
      raw.enableAutoExtractPendingReferencesOnSave,
      readBoolean(
        raw[LEGACY_AUTO_EXTRACT_PENDING_REFERENCES_SETTING],
        DEFAULT_SETTINGS.enableAutoExtractPendingReferencesOnSave
      )
    ),
    enableAutoSyncWordOnLeave: readBoolean(
      raw.enableAutoSyncWordOnLeave,
      readBoolean(raw.enableAutoSyncWordOnSave, DEFAULT_SETTINGS.enableAutoSyncWordOnLeave)
    ),
    referenceMetadataWriteMode: readReferenceMetadataWriteMode(raw.referenceMetadataWriteMode, rawNoteOutputFormatVersion),
    enableHeaderSyncButton: readBoolean(raw.enableHeaderSyncButton, DEFAULT_SETTINGS.enableHeaderSyncButton),
    enableStatusBarSyncButton: readBoolean(raw.enableStatusBarSyncButton, DEFAULT_SETTINGS.enableStatusBarSyncButton)
  };
  const changed = hasLegacyPathKeys || !isRecord(rawData) || readString(raw.wordFolder) !== settings.wordFolder || readString(raw.referenceFolder) !== settings.referenceFolder || hasLegacyAutoSyncOnSave || !("wordFolder" in raw) || !("referenceFolder" in raw) || !("studylistCache" in raw) || "defaultStudylistSource" in raw || !("noteOutputFormatVersion" in raw) || !("enableAutoBoldMarkersOnEdit" in raw) || !("boldMarkers" in raw) || !("enableSemanticBlockWordBold" in raw) || !("semanticBlockWordBoldKinds" in raw) || !("enableSemanticBlockMarkerBold" in raw) || !("enableSemanticBlockWordLinks" in raw) || !("semanticBlockWordLinkKinds" in raw) || !("semanticBlockKindPresets" in raw) || !("enableAutoExtractPendingReferencesOnSave" in raw) || LEGACY_AUTO_EXTRACT_PENDING_REFERENCES_SETTING in raw || !("enableAutoSyncWordOnLeave" in raw) || !("referenceMetadataWriteMode" in raw) || raw.referenceMetadataWriteMode !== settings.referenceMetadataWriteMode;
  return {
    settings,
    changed,
    notices
  };
}

// src/settings.ts
function normalizePathInput(value) {
  const normalized = normalizeFolderPath2(value);
  return normalized ? (0, import_obsidian8.normalizePath)(normalized) : "";
}
function createSection(containerEl, title, description) {
  const sectionEl = containerEl.createDiv({ cls: "eudic-sync-settings-section" });
  sectionEl.createEl("h3", { text: title });
  sectionEl.createDiv({ cls: "eudic-sync-settings-section-description", text: description });
  return sectionEl;
}
function parseLines(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function configureTextarea(text, rows) {
  text.inputEl.rows = rows;
}
function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
function padTimestampPart(value) {
  return String(value).padStart(2, "0");
}
function formatBackupFilenameTimestamp(date) {
  return `${date.getFullYear()}${padTimestampPart(date.getMonth() + 1)}${padTimestampPart(date.getDate())}-${padTimestampPart(date.getHours())}${padTimestampPart(date.getMinutes())}${padTimestampPart(date.getSeconds())}`;
}
function downloadJsonFile(filename, content) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
var EudicSyncSettingTab = class extends import_obsidian8.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  exportSettingsBackup() {
    const payload = buildExportSettingsPayload(this.plugin.settings);
    const filename = `eudic-sync-settings-${formatBackupFilenameTimestamp(/* @__PURE__ */ new Date())}.json`;
    downloadJsonFile(filename, `${JSON.stringify(payload, null, 2)}
`);
    new import_obsidian8.Notice(`${PLUGIN_NAME}: exported plugin settings backup.`, 5e3);
  }
  openImportSettingsPicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    const cleanup = () => {
      input.remove();
    };
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        cleanup();
        if (!file) {
          return;
        }
        void this.importSettingsBackup(file);
      },
      { once: true }
    );
    document.body.appendChild(input);
    input.click();
    window.setTimeout(() => {
      window.addEventListener(
        "focus",
        () => {
          if (!input.files?.length) {
            cleanup();
          }
        },
        { once: true }
      );
    }, 0);
  }
  async importSettingsBackup(file) {
    try {
      const rawContent = await file.text();
      const parsed = JSON.parse(rawContent);
      const result = readImportedSettingsPayload(parsed);
      await this.plugin.updateSettings(result.settings);
      this.display();
      const suffix = result.notices.length > 0 ? ` ${result.notices.join(" ")}` : "";
      new import_obsidian8.Notice(`${PLUGIN_NAME}: imported plugin settings backup.${suffix}`, 8e3);
    } catch (error) {
      if (error instanceof SyntaxError) {
        new import_obsidian8.Notice(`${PLUGIN_NAME}: invalid JSON in settings backup file.`, 8e3);
        return;
      }
      new import_obsidian8.Notice(toErrorMessage(error), 8e3);
    }
  }
  display() {
    const { containerEl } = this;
    const { settings } = this.plugin;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Eudic Sync" });
    containerEl.createDiv({
      cls: "eudic-sync-settings-intro",
      text: "Configure folders and Eudic connection first, then tune writing helpers and semantic block behavior."
    });
    const basicSection = createSection(
      containerEl,
      "Basic setup",
      "\u5148\u786E\u8BA4\u63D2\u4EF6\u7BA1\u7406\u54EA\u4E9B\u7B14\u8BB0\uFF0C\u4EE5\u53CA\u5982\u4F55\u8FDE\u63A5\u6B27\u8DEF\u8BCD\u5178 OpenAPI\u3002"
    );
    new import_obsidian8.Setting(basicSection).setName("Word notes folder").setDesc("Vault-relative path for word notes. Any vault-relative path can be used.").addText((text) => {
      new FolderInputSuggest(this.app, text.inputEl, async (value) => {
        const normalizedValue = normalizePathInput(value) || "Eudic/Words";
        text.setValue(normalizedValue);
        await this.plugin.updateSettings({ wordFolder: normalizedValue });
      });
      text.setPlaceholder("Eudic/Words").setValue(settings.wordFolder).onChange(async (value) => {
        await this.plugin.updateSettings({ wordFolder: normalizePathInput(value) || "Eudic/Words" });
      });
    });
    new import_obsidian8.Setting(basicSection).setName("Reference notes folder").setDesc("Vault-relative path for reference notes. Any vault-relative path can be used.").addText((text) => {
      new FolderInputSuggest(this.app, text.inputEl, async (value) => {
        const normalizedValue = normalizePathInput(value) || "Eudic/References";
        text.setValue(normalizedValue);
        await this.plugin.updateSettings({ referenceFolder: normalizedValue });
      });
      text.setPlaceholder("Eudic/References").setValue(settings.referenceFolder).onChange(async (value) => {
        await this.plugin.updateSettings({ referenceFolder: normalizePathInput(value) || "Eudic/References" });
      });
    });
    new import_obsidian8.Setting(basicSection).setName("Eudic Authorization").setDesc("Authorization header value for the Eudic OpenAPI.").addText((text) => {
      text.setPlaceholder("NIS xxxx").setValue(settings.authorizationToken).onChange(async (value) => {
        await this.plugin.updateSettings({ authorizationToken: value.trim() });
      });
      text.inputEl.type = "password";
    });
    const syncOutputSection = createSection(
      containerEl,
      "Sync output",
      "\u63A7\u5236\u540C\u6B65\u5230\u6B27\u8DEF\u8BCD\u5178\u7AEF\u65F6\u7684\u6700\u7EC8\u8F93\u51FA\u65B9\u5F0F\uFF0C\u4EE5\u53CA\u79BB\u5F00\u8BCD\u6761\u65F6\u662F\u5426\u81EA\u52A8\u540C\u6B65\u3002"
    );
    new import_obsidian8.Setting(syncOutputSection).setName("Final note output mode").setDesc("Choose how the final synced note HTML is generated for Eudic.").addDropdown((dropdown) => {
      dropdown.addOption("minimal", "Minimal").addOption("compatible", "Compatible").setValue(settings.noteOutputMode).onChange(async (value) => {
        await this.plugin.updateSettings({ noteOutputMode: value === "compatible" ? "compatible" : "minimal" });
      });
    });
    new import_obsidian8.Setting(syncOutputSection).setName("Auto-sync when leaving word").setDesc("When enabled, leaving a dirty word note schedules an automatic sync for that word.").addToggle((toggle) => {
      toggle.setValue(settings.enableAutoSyncWordOnLeave).onChange(async (value) => {
        await this.plugin.updateSettings({ enableAutoSyncWordOnLeave: value });
      });
    });
    new import_obsidian8.Setting(syncOutputSection).setName("Studylist category authority").setDesc(
      "Obsidian chooses which existing Eudic studylists a word belongs to. Create, rename, and delete studylist categories in Eudic cloud first, then refresh them back into Obsidian. Empty studylist fields are safe by default: they are pushed only when the word is explicitly dirty."
    );
    new import_obsidian8.Setting(syncOutputSection).setName("Reference metadata writeback").setDesc("Reference relationships are inferred from word-note embeds and written into visible reference properties for stable linking and repair.").addDropdown((dropdown) => {
      dropdown.addOption("auto", "Auto").addOption("manual", "Manual command only").addOption("off", "Off").setValue(settings.referenceMetadataWriteMode).onChange(async (value) => {
        await this.plugin.updateSettings({
          referenceMetadataWriteMode: value === "manual" || value === "off" ? value : "auto"
        });
      });
    });
    const writingHelpersSection = createSection(
      containerEl,
      "Writing helpers",
      "\u8FD9\u4E9B\u8BBE\u7F6E\u5F71\u54CD\u4F60\u5728 Obsidian \u4E2D\u5199\u7B14\u8BB0\u65F6\u7684\u81EA\u52A8\u683C\u5F0F\u5316\u548C reference \u63D0\u53D6\u4F53\u9A8C\u3002"
    );
    new import_obsidian8.Setting(writingHelpersSection).setName("Auto bold markers while editing").setDesc("Automatically write Markdown bold syntax around configured markers while editing managed word or reference notes.").addToggle((toggle) => {
      toggle.setValue(settings.enableAutoBoldMarkersOnEdit).onChange(async (value) => {
        await this.plugin.updateSettings({ enableAutoBoldMarkersOnEdit: value });
      });
    });
    new import_obsidian8.Setting(writingHelpersSection).setName("Bold markers").setDesc("Literal markers to bold in managed notes. Enter one marker per line; regular expressions are not supported.").addTextArea((text) => {
      text.setPlaceholder("n.\ne.g.\nSyn.\nCog.\nP.S.").setValue(settings.boldMarkers.join("\n")).onChange(async (value) => {
        await this.plugin.updateSettings({ boldMarkers: parseLines(value) });
      });
      configureTextarea(text, 6);
    });
    new import_obsidian8.Setting(writingHelpersSection).setName("Auto-extract pending references on save").setDesc(
      "When enabled, saving a word note converts ```eudic-reference``` blocks into shared reference notes before the note is written. Legacy ```eudic-example``` blocks are still recognized."
    ).addToggle((toggle) => {
      toggle.setValue(settings.enableAutoExtractPendingReferencesOnSave).onChange(async (value) => {
        await this.plugin.updateSettings({ enableAutoExtractPendingReferencesOnSave: value });
      });
    });
    const semanticBlockSection = createSection(
      containerEl,
      "Semantic blocks",
      "\u914D\u7F6E\u8BED\u4E49\u5757\u7C7B\u578B\u8BC6\u522B\uFF0C\u4EE5\u53CA\u5728\u9884\u89C8\u548C\u540C\u6B65\u8F93\u51FA\u65F6\u5982\u4F55\u81EA\u52A8\u5904\u7406\u5F53\u524D\u8BCD\u6761\u3002"
    );
    new import_obsidian8.Setting(semanticBlockSection).setName("Semantic block kind presets").setDesc(
      "Enter one semantic block kind per line. These presets are used by Insert Eudic block, Wrap selection as Eudic block, and save/sync kind auto-detection."
    ).addTextArea((text) => {
      text.setPlaceholder("n.\nv.\na.\nCog.\nSyn.\nSyn./Cog.\nAnt.\nP.S.").setValue(settings.semanticBlockKindPresets.join("\n")).onChange(async (value) => {
        await this.plugin.updateSettings({ semanticBlockKindPresets: parseLines(value) });
      });
      configureTextarea(text, 8);
    });
    new import_obsidian8.Setting(semanticBlockSection).setName("Auto-bold word in semantic blocks").setDesc(
      "Automatically bold the current word inside matching semantic block kinds during preview and sync rendering. Can combine with auto-link as a bold link; manually bolded word text keeps its source styling."
    ).addToggle((toggle) => {
      toggle.setValue(settings.enableSemanticBlockWordBold).onChange(async (value) => {
        await this.plugin.updateSettings({ enableSemanticBlockWordBold: value });
      });
    });
    new import_obsidian8.Setting(semanticBlockSection).setName("Render bold markers in semantic blocks").setDesc(
      "Use Writing helpers > Bold markers during semantic block preview and sync rendering without modifying the source Markdown."
    ).addToggle((toggle) => {
      toggle.setValue(settings.enableSemanticBlockMarkerBold).onChange(async (value) => {
        await this.plugin.updateSettings({ enableSemanticBlockMarkerBold: value });
      });
    });
    new import_obsidian8.Setting(semanticBlockSection).setName("Semantic block kinds for word bolding").setDesc("Enter one semantic block kind per line. Matching kinds bold the whole word when it starts with the current word, such as absent -> **absently**.").addTextArea((text) => {
      text.setPlaceholder("n.\nv.\na.\nadj.\nadv.").setValue(settings.semanticBlockWordBoldKinds.join("\n")).onChange(async (value) => {
        await this.plugin.updateSettings({ semanticBlockWordBoldKinds: parseLines(value) });
      });
      configureTextarea(text, 6);
    });
    new import_obsidian8.Setting(semanticBlockSection).setName("Auto-link word in semantic blocks").setDesc(
      "Automatically add managed Obsidian URL Scheme links inside matching semantic block kinds. Manually bolded words can still be linked, and partial bold styling is preserved. Word-note blocks link the current word; reference blocks link all words that reference that note."
    ).addToggle((toggle) => {
      toggle.setValue(settings.enableSemanticBlockWordLinks).onChange(async (value) => {
        await this.plugin.updateSettings({ enableSemanticBlockWordLinks: value });
      });
    });
    new import_obsidian8.Setting(semanticBlockSection).setName("Semantic block kinds for word links").setDesc("Enter one semantic block kind per line. Matching kinds link only full current-word occurrences, such as absent but not absence.").addTextArea((text) => {
      text.setPlaceholder("Cog.\nSyn.\nSyn./Cog.\nAnt.").setValue(settings.semanticBlockWordLinkKinds.join("\n")).onChange(async (value) => {
        await this.plugin.updateSettings({ semanticBlockWordLinkKinds: parseLines(value) });
      });
      configureTextarea(text, 6);
    });
    const obsidianUiSection = createSection(
      containerEl,
      "Obsidian UI",
      "\u63A7\u5236\u63D2\u4EF6\u5728 Obsidian \u754C\u9762\u4E2D\u663E\u793A\u54EA\u4E9B\u540C\u6B65\u5165\u53E3\u548C\u72B6\u6001\u63D0\u793A\u3002"
    );
    new import_obsidian8.Setting(obsidianUiSection).setName("Enable note header sync button").setDesc("Show a sync action in the current Markdown note header.").addToggle((toggle) => {
      toggle.setValue(settings.enableHeaderSyncButton).onChange(async (value) => {
        await this.plugin.updateSettings({ enableHeaderSyncButton: value });
      });
    });
    new import_obsidian8.Setting(obsidianUiSection).setName("Enable status bar sync button").setDesc("Show sync status and a clickable sync action in the status bar.").addToggle((toggle) => {
      toggle.setValue(settings.enableStatusBarSyncButton).onChange(async (value) => {
        await this.plugin.updateSettings({ enableStatusBarSyncButton: value });
      });
    });
    const backupSection = createSection(
      containerEl,
      "Settings backup",
      "\u5907\u4EFD\u3001\u8FC1\u79FB\u6216\u6062\u590D\u63D2\u4EF6\u8BBE\u7F6E\u3002\u5BFC\u51FA\u7684 JSON \u9ED8\u8BA4\u5305\u542B Eudic Authorization Token\uFF0C\u8BF7\u6309\u654F\u611F\u4FE1\u606F\u4FDD\u7BA1\u3002"
    );
    new import_obsidian8.Setting(backupSection).setName("Import and export").setDesc("Export a portable JSON backup, or import a previously exported settings file into this vault.").addButton((button) => {
      button.setButtonText("Export settings").onClick(() => {
        this.exportSettingsBackup();
      });
    }).addButton((button) => {
      button.setButtonText("Import settings").setCta().onClick(() => {
        this.openImportSettingsPicker();
      });
    });
  }
};

// src/save-hook-controller.ts
var import_obsidian9 = require("obsidian");
var EudicSyncSaveHookController = class {
  constructor(options) {
    this.options = options;
    this.originalViewSaves = /* @__PURE__ */ new WeakMap();
  }
  refresh() {
    const markdownLeaves = this.options.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (!(view instanceof import_obsidian9.MarkdownView)) {
        continue;
      }
      this.installSaveHook(view);
    }
  }
  restore() {
    const markdownLeaves = this.options.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (!(view instanceof import_obsidian9.MarkdownView)) {
        continue;
      }
      const originalSave = this.originalViewSaves.get(view);
      if (!originalSave) {
        continue;
      }
      view.save = originalSave;
      this.originalViewSaves.delete(view);
    }
  }
  installSaveHook(view) {
    if (this.originalViewSaves.has(view)) {
      return;
    }
    const originalSave = view.save.bind(view);
    this.originalViewSaves.set(view, originalSave);
    view.save = async (clear) => {
      if (view.file && this.options.canFormatBoldMarkers(view.file)) {
        this.normalizeEudicBlockKindsBeforeSave(view);
      }
      if (this.options.getSettings().enableAutoExtractPendingReferencesOnSave && view.file && this.options.canSyncFile(view.file)) {
        try {
          await this.options.extractPendingReferences(view);
        } catch (error) {
          new import_obsidian9.Notice(
            `${PLUGIN_NAME}: failed to auto-extract pending references: ${this.options.toErrorMessage(error)}`
          );
        }
      }
      return originalSave(clear);
    };
  }
  normalizeEudicBlockKindsBeforeSave(view) {
    const currentMarkdown = view.editor.getValue();
    if (!currentMarkdown.includes(EUDIC_BLOCK_LANGUAGE)) {
      return;
    }
    const result = normalizeEudicBlockKindsFromBody(currentMarkdown, this.options.getSemanticBlockKindPresets());
    if (!result.changed) {
      return;
    }
    view.editor.setValue(result.markdown);
  }
};

// src/eudic-mcp-client.ts
var import_obsidian10 = require("obsidian");

// src/eudic-mcp-response.ts
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
function isJsonRpcFailure(value) {
  return isRecord2(value) && isRecord2(value.error);
}
function isJsonRpcSuccess(value) {
  return isRecord2(value) && "result" in value;
}
function toErrorMessage2(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
function quoteUnsafeJsonIntegers(jsonText) {
  let result = "";
  let index = 0;
  let inString = false;
  let escaped = false;
  while (index < jsonText.length) {
    const char = jsonText[index] ?? "";
    if (escaped) {
      result += char;
      escaped = false;
      index += 1;
      continue;
    }
    if (inString) {
      result += char;
      if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }
    if (char === '"') {
      result += char;
      inString = true;
      index += 1;
      continue;
    }
    if (!/[0-9-]/.test(char)) {
      result += char;
      index += 1;
      continue;
    }
    const numberMatch = jsonText.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!numberMatch) {
      result += char;
      index += 1;
      continue;
    }
    const token = numberMatch[0];
    const digitCount = token.replace(/^-/, "").length;
    const isInteger = !/[.eE]/.test(token);
    result += isInteger && digitCount >= 16 ? `"${token}"` : token;
    index += token.length;
  }
  return result;
}
function parseMcpSseJsonMessages(text) {
  const messages = [];
  const normalizedText = text.replace(/\r\n/g, "\n");
  const eventBlocks = normalizedText.split(/\n\n+/);
  for (const block of eventBlocks) {
    const dataLines = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) {
      continue;
    }
    const dataText = dataLines.join("\n").trim();
    if (!dataText) {
      continue;
    }
    try {
      messages.push(JSON.parse(dataText));
    } catch (error) {
      throw new Error(`Failed to parse Eudic MCP SSE message: ${toErrorMessage2(error)}`);
    }
  }
  if (messages.length > 0) {
    return messages;
  }
  const trimmedText = text.trim();
  if (!trimmedText) {
    return [];
  }
  try {
    return [JSON.parse(trimmedText)];
  } catch (error) {
    throw new Error(`Failed to parse Eudic MCP response: ${toErrorMessage2(error)}`);
  }
}
function readMcpToolTextResult(jsonRpcMessage) {
  if (isJsonRpcFailure(jsonRpcMessage)) {
    const message = typeof jsonRpcMessage.error.message === "string" ? jsonRpcMessage.error.message : "Unknown MCP tool error.";
    const code = typeof jsonRpcMessage.error.code === "number" || typeof jsonRpcMessage.error.code === "string" ? ` (${jsonRpcMessage.error.code})` : "";
    throw new Error(`Eudic MCP error${code}: ${message}`);
  }
  if (!isJsonRpcSuccess(jsonRpcMessage) || !isRecord2(jsonRpcMessage.result)) {
    return null;
  }
  const content = jsonRpcMessage.result.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const textPart = content.find(
    (part) => isRecord2(part) && part.type === "text" && typeof part.text === "string"
  );
  return textPart?.text ?? null;
}
function parseMcpToolJsonResult(jsonRpcMessage) {
  const text = readMcpToolTextResult(jsonRpcMessage);
  if (text === null || !text.trim()) {
    return null;
  }
  try {
    return JSON.parse(quoteUnsafeJsonIntegers(text));
  } catch (error) {
    throw new Error(`Failed to parse Eudic MCP tool JSON result: ${toErrorMessage2(error)}`);
  }
}

// src/retry.ts
function delay(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
async function withRetry(run, options) {
  let attempt = 0;
  let delayMs = options.initialDelayMs;
  for (; ; ) {
    attempt += 1;
    try {
      return await run();
    } catch (error) {
      if (attempt >= options.attempts || !options.shouldRetry(error, attempt)) {
        throw error;
      }
      await delay(delayMs);
      delayMs = Math.min(options.maxDelayMs, delayMs * 2);
    }
  }
}

// src/eudic-mcp-client.ts
var EUDIC_MCP_API_BASE_URL = "https://api.frdic.com";
var MCP_PROTOCOL_VERSION = "2025-06-18";
var MCP_REQUEST_TIMEOUT_MS = 2e4;
var MCP_RETRY_ATTEMPTS = 3;
var MCP_RETRY_INITIAL_DELAY_MS = 500;
var MCP_RETRY_MAX_DELAY_MS = 2e3;
var EudicMcpHttpError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "EudicMcpHttpError";
  }
};
var EudicMcpNetworkError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "EudicMcpNetworkError";
  }
};
function toErrorMessage3(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
async function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
    }
  }
}
var EudicMcpClient = class {
  constructor(getAuthorizationToken) {
    this.getAuthorizationToken = getAuthorizationToken;
  }
  async callTool(toolName, args, language) {
    return withRetry(
      () => this.callToolOnce(toolName, args, language),
      {
        attempts: MCP_RETRY_ATTEMPTS,
        initialDelayMs: MCP_RETRY_INITIAL_DELAY_MS,
        maxDelayMs: MCP_RETRY_MAX_DELAY_MS,
        shouldRetry: (error) => {
          if (error instanceof EudicMcpHttpError) {
            return error.status >= 500;
          }
          return error instanceof EudicMcpNetworkError;
        }
      }
    );
  }
  async callToolOnce(toolName, args, language) {
    const token = this.getAuthorizationToken().trim();
    if (!token) {
      throw new Error("Missing Eudic Authorization token. Set it in Eudic Sync settings.");
    }
    const normalizedLanguage = language.trim() || "en";
    const url = `${EUDIC_MCP_API_BASE_URL}/${encodeURIComponent(normalizedLanguage)}/mcp`;
    let response;
    try {
      response = await withTimeout(
        (0, import_obsidian10.requestUrl)({
          url,
          method: "POST",
          contentType: "application/json",
          headers: {
            Authorization: token,
            language: normalizedLanguage,
            Accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": MCP_PROTOCOL_VERSION
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: {
              name: toolName,
              arguments: args
            }
          }),
          throw: false
        }),
        MCP_REQUEST_TIMEOUT_MS,
        `Eudic MCP request timed out after ${MCP_REQUEST_TIMEOUT_MS}ms.`
      );
    } catch (error) {
      throw new EudicMcpNetworkError(`Eudic MCP request failed: ${toErrorMessage3(error)}`);
    }
    if (response.status >= 400) {
      const detail = response.text.trim() ? `: ${response.text.trim()}` : ".";
      throw new EudicMcpHttpError(`Eudic MCP error (${response.status})${detail}`, response.status);
    }
    const messages = parseMcpSseJsonMessages(response.text);
    if (messages.length === 0) {
      return null;
    }
    return parseMcpToolJsonResult(messages[messages.length - 1]);
  }
};

// src/eudic-note-envelope.ts
var META_FILES_PREFIX = "<!--meta files ";
var META_FILES_SUFFIX = " -->";
function isRecord3(value) {
  return typeof value === "object" && value !== null;
}
function normalizeRemoteNote(note) {
  return note.replace(/^\uFEFF/, "");
}
function findMetaJsonEnd(note) {
  let index = META_FILES_PREFIX.length;
  while (index < note.length && /\s/.test(note[index] ?? "")) {
    index += 1;
  }
  if (note[index] !== "{") {
    throw new Error("Malformed Eudic note metadata envelope.");
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let cursor = index; cursor < note.length; cursor += 1) {
    const char = note[cursor];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char !== "}") {
      continue;
    }
    depth -= 1;
    if (depth < 0) {
      throw new Error("Malformed Eudic note metadata envelope.");
    }
    if (depth === 0) {
      const jsonEnd = cursor + 1;
      if (note.slice(jsonEnd, jsonEnd + META_FILES_SUFFIX.length) !== META_FILES_SUFFIX) {
        throw new Error("Malformed Eudic note metadata envelope.");
      }
      return jsonEnd;
    }
  }
  throw new Error("Malformed Eudic note metadata envelope.");
}
function hasEudicAttachmentMetadata(meta) {
  for (const [key, value] of Object.entries(meta)) {
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }
    const normalizedKey = key.toLocaleLowerCase();
    if (normalizedKey === "image_list" || normalizedKey === "voice_list" || normalizedKey === "audio_list" || normalizedKey === "file_list" || normalizedKey.endsWith("_file_list")) {
      return true;
    }
    if (value.some(
      (item) => isRecord3(item) && typeof item.type === "string" && /^(image|audio|voice|file)$/i.test(item.type)
    )) {
      return true;
    }
  }
  return false;
}
function parseEudicMetaFilesEnvelope(note) {
  const normalizedNote = normalizeRemoteNote(note);
  if (!normalizedNote.startsWith(META_FILES_PREFIX)) {
    return null;
  }
  const jsonEnd = findMetaJsonEnd(normalizedNote);
  const rawJson = normalizedNote.slice(META_FILES_PREFIX.length, jsonEnd);
  let parsedJson;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(
      error instanceof Error ? `Failed to parse Eudic note metadata JSON: ${error.message}` : "Failed to parse Eudic note metadata JSON."
    );
  }
  if (!isRecord3(parsedJson)) {
    throw new Error("Eudic note metadata envelope must contain a JSON object.");
  }
  return {
    meta: parsedJson,
    body: normalizedNote.slice(jsonEnd + META_FILES_SUFFIX.length)
  };
}
function unwrapEudicMetaFilesBody(note) {
  let body = normalizeRemoteNote(note);
  for (let depth = 0; depth < 5; depth += 1) {
    const parsedEnvelope = parseEudicMetaFilesEnvelope(body);
    if (!parsedEnvelope) {
      return body;
    }
    body = parsedEnvelope.body;
  }
  return body;
}
function buildAttachmentPreservingNotePayload(remoteNote, nextBodyHtml) {
  const normalizedNextBodyHtml = unwrapEudicMetaFilesBody(nextBodyHtml);
  if (!remoteNote?.trim()) {
    return normalizedNextBodyHtml;
  }
  let body = normalizeRemoteNote(remoteNote);
  for (let depth = 0; depth < 5; depth += 1) {
    const parsedEnvelope = parseEudicMetaFilesEnvelope(body);
    if (!parsedEnvelope) {
      return normalizedNextBodyHtml;
    }
    if (hasEudicAttachmentMetadata(parsedEnvelope.meta)) {
      throw new Error(
        "Existing Eudic note contains image/audio/file attachments. The Eudic OpenAPI overwrites attachments when updating text, so sync was aborted to protect them."
      );
    }
    body = parsedEnvelope.body;
  }
  return normalizedNextBodyHtml;
}

// src/eudic-api.ts
var EudicApiError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "EudicApiError";
  }
};
function toErrorMessage4(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
var EudicApiClient = class {
  constructor(getAuthorizationToken) {
    this.mcpClient = new EudicMcpClient(getAuthorizationToken);
  }
  async overwriteNote(payload) {
    await this.callMcpTool("add_note", {
      word: payload.word,
      note: payload.note
    }, payload.language);
  }
  async getNote(query) {
    const json = await this.callMcpTool("get_note", { word: query.word }, query.language);
    const data = readDataObject(json);
    if (!data) {
      return null;
    }
    return {
      word: readRequiredString(data.word) || query.word,
      language: readOptionalString(data.language) ?? query.language,
      note: readOptionalString(data.note) ?? null,
      add_time: readOptionalString(data.add_time)
    };
  }
  async overwriteNotePreservingAttachments(payload) {
    let remoteNote = null;
    try {
      remoteNote = await this.getNote({
        word: payload.word,
        language: payload.language
      });
    } catch (error) {
      const status = error instanceof EudicApiError ? error.status : void 0;
      throw new EudicApiError(
        `Failed to read existing Eudic note before preserving attachments: ${toErrorMessage4(error)}`,
        status
      );
    }
    let mergedNote;
    try {
      mergedNote = buildAttachmentPreservingNotePayload(remoteNote?.note ?? null, payload.note);
    } catch (error) {
      throw new EudicApiError(
        `Failed to preserve existing Eudic attachments for "${payload.word}": ${toErrorMessage4(error)}`
      );
    }
    await this.overwriteNote({
      ...payload,
      note: mergedNote
    });
  }
  async deleteNote(payload) {
    await this.callMcpTool("delete_note", { word: payload.word }, payload.language);
  }
  async getStudylistCategories(language) {
    const json = await this.callMcpTool("get_category", {}, language);
    const data = readDataArray(json);
    return data.map((entry) => ({
      id: readRequiredString(entry.id),
      language: readRequiredString(entry.language),
      name: readRequiredString(entry.name)
    })).filter((category) => category.id && category.language && category.name);
  }
  async getStudylistWords(payload) {
    const json = await this.callMcpTool("get_words", {
      id: payload.categoryId,
      page: payload.page,
      page_size: payload.pageSize
    }, payload.language);
    return readDataArray(json).map((entry) => ({
      word: readRequiredString(entry.word),
      category_ids: [],
      exp: readOptionalString(entry.exp),
      add_time: readOptionalString(entry.add_time),
      context_line: readOptionalString(entry.context_line),
      star: typeof entry.star === "number" ? entry.star : void 0
    })).filter((wordInfo) => wordInfo.word);
  }
  async getStudylistWord(query) {
    const json = await this.callMcpTool("get_word", { word: query.word }, query.language);
    const data = readDataObject(json);
    if (!data) {
      return null;
    }
    return {
      word: readRequiredString(data.word) || query.word,
      language: readOptionalString(data.language) ?? query.language,
      category_ids: readStringIds(data.category_ids),
      exp: readOptionalString(data.exp),
      add_time: readOptionalString(data.add_time),
      context_line: readOptionalString(data.context_line),
      star: typeof data.star === "number" ? data.star : void 0
    };
  }
  async addWordsToStudylist(payload) {
    await this.callMcpTool("add_words", {
      category_id: payload.category_id,
      words: payload.words
    }, payload.language);
  }
  async deleteWordsFromStudylist(payload) {
    await this.callMcpTool("delete_words", {
      category_id: payload.category_id,
      language: payload.language,
      words: payload.words
    }, payload.language);
  }
  async callMcpTool(toolName, args, language) {
    try {
      return await this.mcpClient.callTool(toolName, args, language);
    } catch (error) {
      throw new EudicApiError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
};
function isRecord4(value) {
  return typeof value === "object" && value !== null;
}
function readDataArray(json) {
  if (!isRecord4(json)) {
    return [];
  }
  return Array.isArray(json.data) ? json.data.filter(isRecord4) : [];
}
function readDataObject(json) {
  if (!isRecord4(json)) {
    return null;
  }
  if (isRecord4(json.data)) {
    return json.data;
  }
  return json;
}
function readRequiredString(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" ? value.trim() : "";
}
function readOptionalString(value) {
  const valueAsString = readRequiredString(value);
  return valueAsString || void 0;
}
function readStringIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(readRequiredString).filter(Boolean).filter((entry, index, array) => array.indexOf(entry) === index);
}

// src/studylist-catalog-resolver.ts
function pad22(value) {
  return String(value).padStart(2, "0");
}
function nowLocalIsoString(date = /* @__PURE__ */ new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad22(date.getMonth() + 1)}-${pad22(date.getDate())}T${pad22(date.getHours())}:${pad22(date.getMinutes())}:${pad22(date.getSeconds())}${sign}${pad22(Math.floor(absoluteOffsetMinutes / 60))}:${pad22(absoluteOffsetMinutes % 60)}`;
}
function normalizeId(value) {
  return value.trim();
}
function normalizeLanguage(value) {
  return value.trim().toLocaleLowerCase();
}
function normalizeCategoryName(value) {
  return value.trim().toLocaleLowerCase();
}
function uniqueNormalized(values) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
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
function updateStudylistCacheForLanguage(cache, language, categories) {
  const normalizedLanguage = normalizeLanguage(language);
  const categoriesForOtherLanguages = cache.categories.filter(
    (category) => normalizeLanguage(category.language) !== normalizedLanguage
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
    refreshedAt: nowLocalIsoString()
  };
}
var StudylistCatalogResolver = class {
  constructor(options) {
    this.options = options;
  }
  async refreshLanguage(language) {
    const categories = await this.options.fetchCategories(language);
    const nextCache = updateStudylistCacheForLanguage(this.options.getCache(), language, categories);
    await this.options.setCache(nextCache);
    return nextCache;
  }
  async resolveIdsFromNames(language, names, refreshOnUnknown = true) {
    const resolved = this.resolveIdsFromNamesUsingCache(language, names, this.options.getCache(), false);
    if (resolved.unknownNames.length === 0 || !refreshOnUnknown) {
      return resolved;
    }
    const refreshedCache = await this.refreshLanguage(language);
    return this.resolveIdsFromNamesUsingCache(language, names, refreshedCache, true);
  }
  async resolveAssignment(language, input, options = {}) {
    const ids = uniqueNormalized(input.ids);
    const names = uniqueNormalized(input.names);
    const preferredSource = input.preferredSource ?? (names.length > 0 ? "names" : "ids");
    const refreshOnUnknown = options.refreshOnUnknown ?? true;
    if (preferredSource === "names") {
      const resolved2 = await this.resolveIdsFromNames(language, names, refreshOnUnknown);
      return {
        ids: resolved2.unknownNames.length === 0 ? resolved2.ids : ids,
        names: resolved2.names,
        unknownNames: resolved2.unknownNames,
        unknownIds: [],
        refreshed: resolved2.refreshed,
        preferredSource: "names"
      };
    }
    const resolved = await this.resolveNamesFromIds(language, ids, refreshOnUnknown);
    return {
      ids: resolved.ids,
      names: resolved.unknownIds.length === 0 ? resolved.names : names.length > 0 ? names : resolved.names,
      unknownNames: [],
      unknownIds: resolved.unknownIds,
      refreshed: resolved.refreshed,
      preferredSource: "ids"
    };
  }
  async getNamesForIds(language, ids, refreshMissingIds = false) {
    return (await this.resolveNamesFromIds(language, ids, refreshMissingIds)).names;
  }
  getNamesForIdsFromCache(language, ids, cache = this.options.getCache()) {
    return this.getNamesForIdsUsingCache(language, uniqueNormalized(ids), cache);
  }
  async resolveNamesFromIds(language, ids, refreshMissingIds) {
    const resolved = this.resolveNamesFromIdsUsingCache(language, ids, this.options.getCache(), false);
    if (resolved.unknownIds.length === 0 || !refreshMissingIds) {
      return resolved;
    }
    const refreshedCache = await this.refreshLanguage(language);
    return this.resolveNamesFromIdsUsingCache(language, ids, refreshedCache, true);
  }
  resolveIdsFromNamesUsingCache(language, names, cache, refreshed) {
    const categories = this.getCategoriesForLanguage(language, cache);
    const categoriesByName = new Map(categories.map((category) => [normalizeCategoryName(category.name), category]));
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const ids = [];
    const unknownNames = [];
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
      refreshed
    };
  }
  resolveNamesFromIdsUsingCache(language, ids, cache, refreshed) {
    const normalizedIds = uniqueNormalized(ids);
    const categoriesById = new Map(this.getCategoriesForLanguage(language, cache).map((category) => [category.id, category.name]));
    const names = [];
    const unknownIds = [];
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
      refreshed
    };
  }
  getNamesForIdsUsingCache(language, ids, cache) {
    const categoriesById = new Map(this.getCategoriesForLanguage(language, cache).map((category) => [category.id, category.name]));
    return ids.map((id) => categoriesById.get(id) ?? id);
  }
  getCategoriesForLanguage(language, cache) {
    const normalizedLanguage = normalizeLanguage(language);
    return cache.categories.filter((category) => normalizeLanguage(category.language) === normalizedLanguage);
  }
};

// src/studylist-word-modify-analysis.ts
function normalizeId2(value) {
  return value.trim();
}
function uniqueNormalized2(values) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rawValue of values) {
    const value = normalizeId2(rawValue);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
function arraysEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
function getDiff(left, right) {
  const rightSet = new Set(right);
  return left.filter((entry) => !rightSet.has(entry));
}
function getAssignmentDelta(previous, current) {
  return {
    idsChanged: !arraysEqual(previous.ids, current.ids),
    namesChanged: !arraysEqual(previous.names, current.names),
    addedIds: getDiff(current.ids, previous.ids),
    removedIds: getDiff(previous.ids, current.ids),
    addedNames: getDiff(current.names, previous.names),
    removedNames: getDiff(previous.names, current.names)
  };
}
function mapPairedNamesById(snapshot) {
  const result = /* @__PURE__ */ new Map();
  for (let index = 0; index < snapshot.ids.length; index += 1) {
    const id = snapshot.ids[index];
    const name = snapshot.names[index];
    if (id && name && !result.has(id)) {
      result.set(id, name);
    }
  }
  return result;
}
function mapPairedIdsByName(snapshot) {
  const result = /* @__PURE__ */ new Map();
  for (let index = 0; index < snapshot.names.length; index += 1) {
    const name = snapshot.names[index];
    const id = snapshot.ids[index];
    if (name && id && !result.has(name)) {
      result.set(name, id);
    }
  }
  return result;
}
function applyPairDeletionDelta(current, previous) {
  if (!previous) {
    return { ids: current.ids, names: current.names };
  }
  const delta = getAssignmentDelta(previous, current);
  if (delta.removedIds.length === 0 && delta.removedNames.length === 0) {
    return { ids: current.ids, names: current.names };
  }
  let ids = current.ids;
  let names = current.names;
  if (delta.removedIds.length > 0) {
    const namesById = mapPairedNamesById(previous);
    const staleNames = new Set(delta.removedIds.map((id) => namesById.get(id)).filter((name) => !!name));
    if (staleNames.size > 0) {
      names = names.filter((name) => !staleNames.has(name));
    }
  }
  if (delta.removedNames.length > 0) {
    const idsByName = mapPairedIdsByName(previous);
    const staleIds = new Set(delta.removedNames.map((name) => idsByName.get(name)).filter((id) => !!id));
    if (staleIds.size > 0) {
      ids = ids.filter((id) => !staleIds.has(id));
    }
  }
  if (delta.removedIds.length > 0 && delta.removedNames.length === 0) {
    return { ids, names, preferredSource: "ids" };
  }
  if (delta.removedNames.length > 0 && delta.removedIds.length === 0) {
    return { ids, names, preferredSource: "names" };
  }
  return {
    ids,
    names,
    preferredSource: delta.idsChanged && !delta.namesChanged ? "ids" : "names"
  };
}
function getPreferredSourceFromDelta(delta) {
  if (!delta.idsChanged && !delta.namesChanged) {
    return null;
  }
  if (delta.idsChanged && !delta.namesChanged) {
    return "ids";
  }
  if (delta.namesChanged && !delta.idsChanged) {
    return "names";
  }
  if (delta.removedIds.length > 0 && delta.removedNames.length === 0) {
    return "ids";
  }
  if (delta.removedNames.length > 0 && delta.removedIds.length === 0) {
    return "names";
  }
  if (delta.addedIds.length > 0 && delta.addedNames.length === 0) {
    return "ids";
  }
  if (delta.addedNames.length > 0 && delta.addedIds.length === 0) {
    return "names";
  }
  return null;
}
function getPreferredSource(ids, names, previousSnapshot) {
  const currentSnapshot = { ids, names };
  if (!previousSnapshot) {
    return names.length > 0 ? "names" : "ids";
  }
  const namesChanged = !arraysEqual(previousSnapshot.names, names);
  const idsChanged = !arraysEqual(previousSnapshot.ids, ids);
  const preferredSourceFromCanonicalDelta = getPreferredSourceFromDelta(getAssignmentDelta(previousSnapshot, currentSnapshot));
  if (preferredSourceFromCanonicalDelta) {
    return preferredSourceFromCanonicalDelta;
  }
  if (idsChanged && !namesChanged) {
    return "ids";
  }
  if (namesChanged && !idsChanged) {
    return "names";
  }
  if (idsChanged && namesChanged) {
    return "names";
  }
  return names.length > 0 ? "names" : "ids";
}
function readYamlFrontmatter(markdown) {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  return match?.[1] ?? null;
}
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stripYamlQuotes(value) {
  return value.trim().replace(/^["']|["']$/g, "");
}
function readYamlStringArray(markdown, key) {
  const yaml = readYamlFrontmatter(markdown);
  if (!yaml) {
    return null;
  }
  const lines = yaml.split(/\r?\n/);
  const keyPattern = new RegExp(`^\\s*${escapeRegExp2(key)}\\s*:\\s*(.*?)\\s*$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(keyPattern);
    if (!match) {
      continue;
    }
    const rawValue = (match[1] ?? "").trim();
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1).trim();
      if (!inner) {
        return [];
      }
      return uniqueNormalized2(inner.split(",").map((entry) => stripYamlQuotes(entry)));
    }
    if (rawValue) {
      return uniqueNormalized2([stripYamlQuotes(rawValue)]);
    }
    const values = [];
    for (let nestedIndex = index + 1; nestedIndex < lines.length; nestedIndex += 1) {
      const nestedLine = lines[nestedIndex] ?? "";
      const nestedMatch = nestedLine.match(/^\s*-\s*(.*?)\s*$/);
      if (!nestedMatch) {
        if (/^\S/.test(nestedLine)) {
          break;
        }
        continue;
      }
      values.push(stripYamlQuotes(nestedMatch[1] ?? ""));
    }
    return uniqueNormalized2(values);
  }
  return null;
}
function readYamlStringValue(markdown, key) {
  const yaml = readYamlFrontmatter(markdown);
  if (!yaml) {
    return void 0;
  }
  const keyPattern = new RegExp(`^\\s*${escapeRegExp2(key)}\\s*:\\s*(.*?)\\s*$`);
  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(keyPattern);
    if (match) {
      return stripYamlQuotes(match[1] ?? "").trim();
    }
  }
  return void 0;
}
function readStudylistStatusFromMarkdown(markdown, fallback) {
  const value = readYamlStringValue(markdown, FRONTMATTER_KEYS.studylistSyncStatus);
  return value === "dirty" || value === "synced" ? value : fallback;
}
function getUnknownNamesError(names) {
  return `Unknown Eudic studylist name(s): ${names.join(", ")} after refreshing Eudic studylists. Create the category in Eudic first or choose an existing category name.`;
}
function getUnknownIdsError(ids) {
  return `Unknown Eudic studylist id(s): ${ids.join(", ")} after refreshing Eudic studylists. Refresh Eudic studylists or pull the word assignment from Eudic.`;
}
function getAssignmentError(unknownNames, unknownIds) {
  const messages = [];
  if (unknownNames.length > 0) {
    messages.push(getUnknownNamesError(unknownNames));
  }
  if (unknownIds.length > 0) {
    messages.push(getUnknownIdsError(unknownIds));
  }
  return messages.length > 0 ? messages.join(" ") : null;
}
async function analyzeStudylistWordModify(options) {
  const {
    state,
    previousSnapshot,
    markdown,
    refreshOnUnknown = true
  } = options;
  if (state.disabled) {
    return {
      disabled: true,
      language: state.language,
      ids: [],
      names: [],
      preferredSource: "names",
      isResolved: true,
      shouldDirty: false,
      shouldWrite: false,
      nextStatus: "synced",
      nextLastError: null
    };
  }
  const idsFromMarkdown = readYamlStringArray(markdown, FRONTMATTER_KEYS.studylistIds);
  const namesFromMarkdown = readYamlStringArray(markdown, FRONTMATTER_KEYS.studylistNames);
  const idsFromCurrentMarkdown = uniqueNormalized2(idsFromMarkdown ?? state.ids);
  const namesFromCurrentMarkdown = uniqueNormalized2(namesFromMarkdown ?? state.names);
  const deletionAdjustedAssignment = applyPairDeletionDelta(
    { ids: idsFromCurrentMarkdown, names: namesFromCurrentMarkdown },
    previousSnapshot
  );
  const idsForResolution = deletionAdjustedAssignment.ids;
  const namesForResolution = deletionAdjustedAssignment.names;
  const statusFromCurrentMarkdown = readStudylistStatusFromMarkdown(markdown, state.status);
  const lastErrorFromMarkdown = readYamlStringValue(markdown, FRONTMATTER_KEYS.studylistLastError);
  const lastErrorFromCurrentMarkdown = lastErrorFromMarkdown === void 0 ? null : lastErrorFromMarkdown || null;
  const preferredSource = deletionAdjustedAssignment.preferredSource ?? getPreferredSource(
    idsForResolution,
    namesForResolution,
    previousSnapshot
  );
  const resolved = await options.resolveAssignment(
    state.language,
    {
      ids: idsForResolution,
      names: namesForResolution,
      preferredSource
    },
    { refreshOnUnknown }
  );
  const normalizedIds = resolved.ids;
  const names = resolved.names;
  const nextLastError = getAssignmentError(resolved.unknownNames, resolved.unknownIds);
  const isResolved = nextLastError === null;
  const idsChanged = previousSnapshot === void 0 ? !arraysEqual(state.ids, normalizedIds) : !arraysEqual(previousSnapshot.ids, normalizedIds);
  const shouldDirty = statusFromCurrentMarkdown === "dirty" || idsChanged || nextLastError !== null;
  const nextStatus = shouldDirty ? "dirty" : "synced";
  const shouldWrite = !arraysEqual(idsFromCurrentMarkdown, normalizedIds) || !arraysEqual(namesFromCurrentMarkdown, names) || !arraysEqual(state.ids, normalizedIds) || !arraysEqual(state.names, names) || statusFromCurrentMarkdown !== nextStatus || lastErrorFromCurrentMarkdown !== nextLastError;
  return {
    disabled: false,
    language: state.language,
    ids: normalizedIds,
    names,
    preferredSource,
    isResolved,
    shouldDirty,
    shouldWrite,
    nextStatus,
    nextLastError
  };
}

// src/studylist-service.ts
var STUDYLIST_PAGE_SIZE = 100;
var STUDYLIST_MAX_PAGE = 50;
function pad23(value) {
  return String(value).padStart(2, "0");
}
function nowLocalIsoString2(date = /* @__PURE__ */ new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad23(date.getMonth() + 1)}-${pad23(date.getDate())}T${pad23(date.getHours())}:${pad23(date.getMinutes())}:${pad23(date.getSeconds())}${sign}${pad23(Math.floor(absoluteOffsetMinutes / 60))}:${pad23(absoluteOffsetMinutes % 60)}`;
}
function normalizeId3(value) {
  return value.trim();
}
function uniqueNormalized3(values) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rawValue of values) {
    const value = normalizeId3(rawValue);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
function arraysEqual2(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
function normalizeWordKey2(word, language) {
  return `${language.trim().toLocaleLowerCase()}\0${word.trim().toLocaleLowerCase()}`;
}
function readIdArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueNormalized3(
    value.map((entry) => {
      if (typeof entry === "number" && Number.isFinite(entry)) {
        return String(entry);
      }
      return typeof entry === "string" ? entry : "";
    })
  );
}
function readNameArray(value) {
  if (typeof value === "string") {
    return uniqueNormalized3([value]);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueNormalized3(value.map((entry) => typeof entry === "string" ? entry : ""));
}
function getDiff2(left, right) {
  const rightSet = new Set(right);
  return left.filter((entry) => !rightSet.has(entry));
}
function getUnknownNamesError2(names) {
  return `Unknown Eudic studylist name(s): ${names.join(", ")} after refreshing Eudic studylists. Create the category in Eudic first or choose an existing category name.`;
}
function getUnknownIdsError2(ids) {
  return `Unknown Eudic studylist id(s): ${ids.join(", ")} after refreshing Eudic studylists. Refresh Eudic studylists or pull the word assignment from Eudic.`;
}
function getAssignmentError2(unknownNames, unknownIds) {
  const messages = [];
  if (unknownNames.length > 0) {
    messages.push(getUnknownNamesError2(unknownNames));
  }
  if (unknownIds.length > 0) {
    messages.push(getUnknownIdsError2(unknownIds));
  }
  return messages.length > 0 ? messages.join(" ") : null;
}
function readStateFromFrontmatter(app, pathScope, file) {
  if (!pathScope.isWordPath(file.path) || file.extension !== "md") {
    return null;
  }
  const frontmatter = getFrontmatter(app, file);
  const disabled = isWordSyncDisabledFrontmatter(frontmatter);
  const language = readNullableString(frontmatter[FRONTMATTER_KEYS.lang]) ?? "en";
  return {
    file,
    word: getConfiguredWord(frontmatter, file),
    language,
    ids: readIdArray(frontmatter[FRONTMATTER_KEYS.studylistIds]),
    names: readNameArray(frontmatter[FRONTMATTER_KEYS.studylistNames]),
    status: readStudylistSyncStatus(frontmatter),
    disabled,
    lastError: readNullableString(frontmatter[FRONTMATTER_KEYS.studylistLastError])
  };
}
var StudylistService = class {
  constructor(options) {
    this.options = options;
    this.localAssignmentSnapshots = /* @__PURE__ */ new Map();
    this.apiClient = new EudicApiClient(() => this.options.getAuthorizationToken());
    this.catalog = new StudylistCatalogResolver({
      getCache: () => this.options.getStudylistCache(),
      setCache: (cache) => this.options.setStudylistCache(cache),
      fetchCategories: (language) => this.apiClient.getStudylistCategories(language)
    });
  }
  async ensureAllWordStudylistFrontmatter() {
    for (const file of this.getManagedWordFiles()) {
      await this.ensureWordStudylistFrontmatter(file);
    }
  }
  captureAllLocalSnapshots() {
    this.localAssignmentSnapshots.clear();
    for (const file of this.getManagedWordFiles()) {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled || state.lastError) {
        continue;
      }
      this.localAssignmentSnapshots.set(file.path, { ids: state.ids, names: state.names });
    }
  }
  removeWord(path) {
    this.localAssignmentSnapshots.delete(path);
  }
  async handleWordModify(file, markdown) {
    await this.reconcileWordAssignment(file, markdown);
  }
  async reconcileWordAssignment(file, markdown) {
    if (!this.options.pathScope.isWordPath(file.path)) {
      return null;
    }
    await this.ensureWordStudylistFrontmatter(file);
    const analysis = await this.analyzeWordModify(file, markdown);
    if (!analysis || analysis.disabled) {
      return analysis;
    }
    await this.applyWordModifyAnalysis(file, analysis);
    return analysis;
  }
  async analyzeWordModify(file, markdown, options = {}) {
    if (!this.options.pathScope.isWordPath(file.path)) {
      return null;
    }
    const frontmatterState = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    if (!frontmatterState || frontmatterState.disabled) {
      this.localAssignmentSnapshots.delete(file.path);
      return {
        disabled: true,
        language: frontmatterState?.language ?? "en",
        ids: [],
        names: [],
        preferredSource: "names",
        isResolved: true,
        shouldDirty: false,
        shouldWrite: false,
        nextStatus: "synced",
        nextLastError: null
      };
    }
    const previousSnapshot = this.localAssignmentSnapshots.get(file.path);
    return analyzeStudylistWordModify({
      state: frontmatterState,
      previousSnapshot,
      markdown,
      refreshOnUnknown: options.refreshOnUnknown,
      resolveAssignment: (language, assignment, resolveOptions) => this.catalog.resolveAssignment(language, assignment, resolveOptions)
    });
  }
  async refreshStudylistCatalogForLanguage(language) {
    await this.catalog.refreshLanguage(language);
  }
  applyWordModifyAnalysisToFrontmatter(frontmatter, analysis) {
    frontmatter[FRONTMATTER_KEYS.studylistIds] = analysis.ids;
    frontmatter[FRONTMATTER_KEYS.studylistNames] = analysis.names;
    frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = analysis.nextStatus;
    if (analysis.nextLastError) {
      frontmatter[FRONTMATTER_KEYS.studylistLastError] = analysis.nextLastError;
    } else {
      delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
    }
  }
  captureWordModifyAnalysisSnapshot(file, analysis) {
    if (analysis.disabled) {
      this.localAssignmentSnapshots.delete(file.path);
      return;
    }
    if (analysis.nextLastError) {
      return;
    }
    this.localAssignmentSnapshots.set(file.path, { ids: analysis.ids, names: analysis.names });
  }
  async applyWordModifyAnalysis(file, analysis) {
    if (analysis.disabled) {
      this.localAssignmentSnapshots.delete(file.path);
      return;
    }
    if (analysis.shouldWrite) {
      await this.options.writeFrontmatter(file, (frontmatter) => {
        this.applyWordModifyAnalysisToFrontmatter(frontmatter, analysis);
      });
    }
    this.captureWordModifyAnalysisSnapshot(file, analysis);
  }
  async refreshFromEudic() {
    const cloudSnapshot = await this.fetchCloudStudylistSnapshot();
    await this.options.setStudylistCache(cloudSnapshot.cache);
    const updatedFiles = await this.applyCloudAssignmentsToLocalWords(cloudSnapshot);
    this.captureAllLocalSnapshots();
    return {
      categories: cloudSnapshot.cache.categories.length,
      words: cloudSnapshot.wordCount,
      updatedWords: updatedFiles.length,
      updatedFiles
    };
  }
  async pullAssignmentsFromEudic() {
    return this.refreshFromEudic();
  }
  async pullCurrentWordAssignmentFromEudic(file, overwriteDirty = false) {
    await this.ensureWordStudylistFrontmatter(file);
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    if (!state || state.disabled) {
      throw new Error(`File is not an eligible Eudic word note: ${file.path}`);
    }
    if (state.status === "dirty" && !overwriteDirty) {
      throw new Error(`Current word "${state.word}" has local dirty studylist changes.`);
    }
    const nextCache = await this.catalog.refreshLanguage(state.language);
    const wordInfo = await this.apiClient.getStudylistWord({
      word: state.word,
      language: state.language
    });
    const ids = uniqueNormalized3(wordInfo?.category_ids ?? []);
    const names = this.catalog.getNamesForIdsFromCache(state.language, ids, nextCache);
    const updated = !arraysEqual2(state.ids, ids) || !arraysEqual2(state.names, names) || state.status !== "synced" || !!state.lastError;
    if (updated) {
      await this.options.writeFrontmatter(file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistIds] = ids;
        frontmatter[FRONTMATTER_KEYS.studylistNames] = names;
        frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "synced";
        frontmatter[FRONTMATTER_KEYS.studylistSyncedAt] = nowLocalIsoString2();
        delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
      });
    }
    this.localAssignmentSnapshots.set(file.path, { ids, names });
    return {
      file,
      word: state.word,
      language: state.language,
      ids,
      names,
      updated,
      wasDirty: state.status === "dirty"
    };
  }
  async rebuildLocalMetadata() {
    return (await this.rebuildLocalMetadataInternal()).updated;
  }
  async repairNamesIdsForAllWords() {
    return this.rebuildLocalMetadataInternal();
  }
  async rebuildLocalMetadataInternal() {
    let updated = 0;
    let unresolved = 0;
    for (const file of this.getManagedWordFiles()) {
      const changed = await this.ensureWordStudylistFrontmatter(file);
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled) {
        continue;
      }
      const resolved = await this.catalog.resolveAssignment(state.language, {
        ids: state.ids,
        names: state.names,
        preferredSource: state.names.length > 0 ? "names" : "ids"
      });
      const nextLastError = getAssignmentError2(resolved.unknownNames, resolved.unknownIds);
      if (nextLastError) {
        unresolved += 1;
      }
      const idsChanged = !arraysEqual2(state.ids, resolved.ids);
      const nextStatus = state.status === "dirty" || idsChanged || nextLastError ? "dirty" : "synced";
      if (!arraysEqual2(state.ids, resolved.ids) || !arraysEqual2(state.names, resolved.names) || state.status !== nextStatus || state.lastError !== nextLastError) {
        await this.options.writeFrontmatter(file, (frontmatter) => {
          if (nextLastError) {
            frontmatter[FRONTMATTER_KEYS.studylistLastError] = nextLastError;
          } else {
            frontmatter[FRONTMATTER_KEYS.studylistIds] = resolved.ids;
            frontmatter[FRONTMATTER_KEYS.studylistNames] = resolved.names;
            delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
          }
          frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = nextStatus;
        });
        updated += 1;
      } else if (changed) {
        updated += 1;
      }
      if (!nextLastError) {
        this.localAssignmentSnapshots.set(file.path, { ids: resolved.ids, names: resolved.names });
      }
    }
    return { updated, unresolved };
  }
  collectDirtyStudylistWords() {
    return this.getManagedWordFiles().filter((file) => {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      return !!state && !state.disabled && state.status === "dirty";
    });
  }
  getCurrentWordForPush(file) {
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    if (!state || state.disabled) {
      return null;
    }
    return file;
  }
  getCurrentWordStudylistLastError(file) {
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    return state?.lastError ?? null;
  }
  getCurrentWordStudylistStatus(file) {
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    return state?.status ?? null;
  }
  getCurrentDirtyWordForPush(file) {
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    if (!state || state.disabled || state.status !== "dirty") {
      return null;
    }
    return file;
  }
  async previewPush(files) {
    let added = 0;
    let removed = 0;
    const pushableFiles = [];
    for (const file of files) {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled) {
        continue;
      }
      if (shouldSkipEmptySyncedStudylistAssignment(state.ids, state.names, state.status)) {
        continue;
      }
      const prepared = await this.prepareStateForPush(state);
      if (prepared.error) {
        continue;
      }
      const cloudIds = await this.getCloudCategoryIds(prepared.state);
      added += getDiff2(prepared.state.ids, cloudIds).length;
      removed += getDiff2(cloudIds, prepared.state.ids).length;
      pushableFiles.push(file);
    }
    return {
      total: pushableFiles.length,
      added,
      removed,
      files: pushableFiles
    };
  }
  async pushAssignments(files) {
    const results = [];
    for (const file of files) {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled) {
        continue;
      }
      if (shouldSkipEmptySyncedStudylistAssignment(state.ids, state.names, state.status)) {
        continue;
      }
      const prepared = await this.prepareStateForPush(state);
      if (prepared.error) {
        results.push({
          file: state.file,
          word: state.word,
          language: state.language,
          added: 0,
          removed: 0,
          changed: false,
          error: prepared.error
        });
        continue;
      }
      results.push(await this.pushWordAssignment(prepared.state));
    }
    return {
      total: results.length,
      succeeded: results.filter((result) => !result.error).length,
      failed: results.filter((result) => result.error).length,
      added: results.reduce((sum, result) => sum + result.added, 0),
      removed: results.reduce((sum, result) => sum + result.removed, 0),
      results
    };
  }
  async ensureWordStudylistFrontmatter(file) {
    const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
    if (!state) {
      return false;
    }
    const frontmatter = getFrontmatter(this.options.app, file);
    const shouldNormalizeStudylistStatus = !isStudylistSyncStatusNormalized(frontmatter);
    const shouldWrite = shouldNormalizeStudylistStatus || !Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistIds]) || !Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistNames]);
    if (!shouldWrite) {
      return false;
    }
    await this.options.writeFrontmatter(file, (frontmatter2) => {
      normalizeStudylistSyncStatus(frontmatter2);
      if (!Array.isArray(frontmatter2[FRONTMATTER_KEYS.studylistIds])) {
        frontmatter2[FRONTMATTER_KEYS.studylistIds] = [];
      }
      if (!Array.isArray(frontmatter2[FRONTMATTER_KEYS.studylistNames])) {
        frontmatter2[FRONTMATTER_KEYS.studylistNames] = [];
      }
    });
    return true;
  }
  async fetchCloudStudylistSnapshot() {
    const languages = this.getManagedLanguages();
    const categories = [];
    const assignments = /* @__PURE__ */ new Map();
    let wordCount = 0;
    for (const language of languages) {
      const languageCategories = await this.apiClient.getStudylistCategories(language);
      categories.push(...languageCategories);
      for (const category of languageCategories) {
        for (let page = 0; page <= STUDYLIST_MAX_PAGE; page += 1) {
          const words = await this.apiClient.getStudylistWords({
            language,
            categoryId: category.id,
            page,
            pageSize: STUDYLIST_PAGE_SIZE
          });
          if (words.length === 0) {
            break;
          }
          wordCount += words.length;
          for (const wordInfo of words) {
            const key = normalizeWordKey2(wordInfo.word, language);
            assignments.set(key, uniqueNormalized3([...assignments.get(key) ?? [], category.id]));
          }
          if (words.length < STUDYLIST_PAGE_SIZE) {
            break;
          }
        }
      }
    }
    return {
      cache: {
        categories,
        refreshedAt: nowLocalIsoString2()
      },
      assignments,
      wordCount
    };
  }
  async applyCloudAssignmentsToLocalWords(snapshot) {
    const updatedFiles = [];
    for (const file of this.getManagedWordFiles()) {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled || state.status === "dirty") {
        continue;
      }
      const ids = snapshot.assignments.get(normalizeWordKey2(state.word, state.language)) ?? [];
      const names = this.catalog.getNamesForIdsFromCache(state.language, ids, snapshot.cache);
      if (arraysEqual2(state.ids, ids) && arraysEqual2(state.names, names) && state.status === "synced" && readNullableString(getFrontmatter(this.options.app, file)[FRONTMATTER_KEYS.studylistLastError]) === null) {
        continue;
      }
      await this.options.writeFrontmatter(file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistIds] = ids;
        frontmatter[FRONTMATTER_KEYS.studylistNames] = names;
        frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "synced";
        frontmatter[FRONTMATTER_KEYS.studylistSyncedAt] = nowLocalIsoString2();
        delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
      });
      updatedFiles.push(file);
    }
    return updatedFiles;
  }
  async prepareStateForPush(state) {
    const resolved = await this.catalog.resolveAssignment(state.language, {
      ids: state.ids,
      names: state.names,
      preferredSource: state.names.length > 0 ? "names" : "ids"
    });
    const error = getAssignmentError2(resolved.unknownNames, resolved.unknownIds) ?? void 0;
    if (error) {
      await this.options.writeFrontmatter(state.file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "dirty";
        frontmatter[FRONTMATTER_KEYS.studylistLastError] = error;
      });
      return { state, error };
    }
    const nextState = {
      ...state,
      ids: resolved.ids,
      names: resolved.names,
      lastError: null
    };
    const idsChanged = !arraysEqual2(state.ids, nextState.ids);
    if (idsChanged || !arraysEqual2(state.names, nextState.names) || state.lastError) {
      await this.options.writeFrontmatter(state.file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistIds] = nextState.ids;
        frontmatter[FRONTMATTER_KEYS.studylistNames] = nextState.names;
        delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
        if (idsChanged) {
          frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "dirty";
        }
      });
    }
    this.localAssignmentSnapshots.set(state.file.path, { ids: nextState.ids, names: nextState.names });
    return { state: nextState };
  }
  async pushWordAssignment(state) {
    try {
      const cloudIds = await this.getCloudCategoryIds(state);
      const idsToAdd = getDiff2(state.ids, cloudIds);
      const idsToRemove = getDiff2(cloudIds, state.ids);
      for (const categoryId of idsToAdd) {
        await this.apiClient.addWordsToStudylist({
          language: state.language,
          category_id: categoryId,
          words: [state.word]
        });
      }
      for (const categoryId of idsToRemove) {
        await this.apiClient.deleteWordsFromStudylist({
          language: state.language,
          category_id: categoryId,
          words: [state.word]
        });
      }
      await this.options.writeFrontmatter(state.file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistIds] = state.ids;
        frontmatter[FRONTMATTER_KEYS.studylistNames] = state.names;
        frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "synced";
        frontmatter[FRONTMATTER_KEYS.studylistSyncedAt] = nowLocalIsoString2();
        delete frontmatter[FRONTMATTER_KEYS.studylistLastError];
      });
      this.localAssignmentSnapshots.set(state.file.path, { ids: state.ids, names: state.names });
      return {
        file: state.file,
        word: state.word,
        language: state.language,
        added: idsToAdd.length,
        removed: idsToRemove.length,
        changed: idsToAdd.length > 0 || idsToRemove.length > 0
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.options.writeFrontmatter(state.file, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "dirty";
        frontmatter[FRONTMATTER_KEYS.studylistLastError] = message;
      });
      return {
        file: state.file,
        word: state.word,
        language: state.language,
        added: 0,
        removed: 0,
        changed: false,
        error: message
      };
    }
  }
  async getCloudCategoryIds(state) {
    const wordInfo = await this.apiClient.getStudylistWord({
      word: state.word,
      language: state.language
    });
    return uniqueNormalized3(wordInfo?.category_ids ?? []);
  }
  getManagedWordFiles() {
    return this.options.managedFiles.getWordFiles();
  }
  getManagedLanguages() {
    const languages = /* @__PURE__ */ new Set(["en"]);
    for (const file of this.getManagedWordFiles()) {
      const state = readStateFromFrontmatter(this.options.app, this.options.pathScope, file);
      if (!state || state.disabled) {
        continue;
      }
      languages.add(state.language);
    }
    return Array.from(languages).sort((left, right) => {
      if (left === "en") return -1;
      if (right === "en") return 1;
      return left.localeCompare(right);
    });
  }
};

// src/startup-coordinator.ts
function yieldToUi() {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}
var StartupCoordinator = class {
  constructor(options) {
    this.options = options;
    this.running = false;
    this.completed = false;
  }
  async run(tasks) {
    if (this.running || this.completed || this.options.isUnloaded()) {
      return;
    }
    this.running = true;
    try {
      for (const task of tasks) {
        if (this.options.isUnloaded()) {
          return;
        }
        try {
          await this.options.measure(task.label, () => task.run());
        } catch (error) {
          this.options.onError(task.label, error);
        } finally {
          this.options.afterTask?.();
        }
        await yieldToUi();
      }
      this.completed = true;
    } finally {
      this.running = false;
    }
  }
};

// src/sync-status-frontmatter-patch.ts
function getLineBreak(markdown) {
  return markdown.includes("\r\n") ? "\r\n" : "\n";
}
function stripTrailingCarriageReturn(line) {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
function isFrontmatterFence(line) {
  return stripTrailingCarriageReturn(line).trim() === "---";
}
function findYamlFrontmatterEndLine(lines) {
  if (!isFrontmatterFence(lines[0] ?? "")) {
    return null;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (isFrontmatterFence(lines[index] ?? "")) {
      return index;
    }
  }
  return null;
}
function buildSyncStatusLine(status, indent = "") {
  return `${indent}${FRONTMATTER_KEYS.syncStatus}: ${status}`;
}
function buildSyncStatusPatch(markdown, status) {
  const lines = markdown.split("\n");
  const frontmatterEndLine = findYamlFrontmatterEndLine(lines);
  const lineBreak = getLineBreak(markdown);
  if (frontmatterEndLine === null) {
    return {
      changed: true,
      from: { line: 0, ch: 0 },
      replacement: ["---", buildSyncStatusLine(status), "---", ""].join(lineBreak) + lineBreak
    };
  }
  const syncStatusPattern = new RegExp(`^(\\s*)${FRONTMATTER_KEYS.syncStatus}\\s*:\\s*(.*?)\\s*$`);
  for (let lineIndex = 1; lineIndex < frontmatterEndLine; lineIndex += 1) {
    const line = stripTrailingCarriageReturn(lines[lineIndex] ?? "");
    const match = line.match(syncStatusPattern);
    if (!match) {
      continue;
    }
    const indent = match[1] ?? "";
    const replacement = buildSyncStatusLine(status, indent);
    return {
      changed: line !== replacement,
      from: { line: lineIndex, ch: 0 },
      to: { line: lineIndex, ch: line.length },
      replacement
    };
  }
  return {
    changed: true,
    from: { line: frontmatterEndLine, ch: 0 },
    replacement: `${buildSyncStatusLine(status)}${lineBreak}`
  };
}
function applySyncStatusPatchToEditor(editor, status) {
  const patch = buildSyncStatusPatch(editor.getValue(), status);
  if (!patch.changed) {
    return true;
  }
  editor.replaceRange(patch.replacement, patch.from, patch.to, "eudic-sync");
  return true;
}

// src/word-sync-frontmatter-patch.ts
function getLineBreak2(markdown) {
  return markdown.includes("\r\n") ? "\r\n" : "\n";
}
function stripTrailingCarriageReturn2(line) {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
function isFrontmatterFence2(line) {
  return stripTrailingCarriageReturn2(line).trim() === "---";
}
function findYamlFrontmatterEndLine2(lines) {
  if (!isFrontmatterFence2(lines[0] ?? "")) {
    return null;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (isFrontmatterFence2(lines[index] ?? "")) {
      return index;
    }
  }
  return null;
}
function arraysEqual3(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
function getTopLevelKey(line) {
  const normalized = stripTrailingCarriageReturn2(line);
  if (/^\s/.test(normalized)) {
    return null;
  }
  return normalized.match(/^([^:#]+)\s*:/)?.[1]?.trim() ?? null;
}
function formatYamlScalar(value, bare = false) {
  if (bare || /^[A-Za-z0-9._:/+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
function buildFields(data) {
  return [
    { key: FRONTMATTER_KEYS.eudicLinkId, value: data.eudicLinkId },
    { key: FRONTMATTER_KEYS.syncStatus, value: data.syncStatus, bare: true },
    { key: FRONTMATTER_KEYS.syncedAt, value: data.syncedAt },
    { key: FRONTMATTER_KEYS.lastSyncedHash, value: data.lastSyncedHash },
    { key: FRONTMATTER_KEYS.lastSyncedAliasesHash, value: data.lastSyncedAliasesHash },
    { key: FRONTMATTER_KEYS.lastError, value: data.lastError }
  ];
}
function buildReplacementLines(data) {
  return buildFields(data).filter((field) => field.value !== void 0 && field.value !== null).map(buildFieldLine);
}
function buildFieldLine(field) {
  return `${field.key}: ${formatYamlScalar(field.value, field.bare)}`;
}
function buildPatchedFrontmatterLines(lines, frontmatterEndLine, data) {
  const providedFields = buildFields(data).filter((field) => field.value !== void 0);
  const fieldByKey = new Map(providedFields.map((field) => [field.key, field]));
  const writtenKeys = /* @__PURE__ */ new Set();
  const nextLines = [];
  for (let index = 1; index < frontmatterEndLine; index += 1) {
    const line = stripTrailingCarriageReturn2(lines[index] ?? "");
    const key = getTopLevelKey(line);
    const field = key ? fieldByKey.get(key) : void 0;
    if (!field) {
      nextLines.push(line);
      continue;
    }
    writtenKeys.add(field.key);
    let rangeEnd = index + 1;
    while (rangeEnd < frontmatterEndLine && getTopLevelKey(lines[rangeEnd] ?? "") === null) {
      rangeEnd += 1;
    }
    if (field.value !== null) {
      nextLines.push(buildFieldLine(field));
    }
    index = rangeEnd - 1;
  }
  for (const field of providedFields) {
    if (!writtenKeys.has(field.key) && field.value !== null) {
      nextLines.push(buildFieldLine(field));
    }
  }
  return nextLines;
}
function applyPatch(markdown, patch) {
  if (!patch.changed) {
    return markdown;
  }
  const lines = markdown.split("\n");
  if (!patch.to) {
    const prefix = lines.slice(0, patch.from.line).join("\n");
    const suffix = lines.slice(patch.from.line).join("\n");
    return `${prefix}${prefix ? "\n" : ""}${patch.replacement}${suffix}`;
  }
  const before = lines.slice(0, patch.from.line);
  const after = lines.slice(patch.to.line);
  const replacementLines = patch.replacement.endsWith("\n") ? patch.replacement.slice(0, -1).split("\n") : patch.replacement.split("\n");
  return [...before, ...replacementLines, ...after].join("\n");
}
function applyWordSyncFrontmatterToObject(frontmatter, data) {
  const fields = buildFields(data);
  for (const field of fields) {
    if (field.value === void 0) {
      continue;
    }
    if (field.value === null) {
      delete frontmatter[field.key];
    } else {
      frontmatter[field.key] = field.value;
    }
  }
}
function buildWordSyncFrontmatterPatch(markdown, data) {
  const lines = markdown.split("\n");
  const frontmatterEndLine = findYamlFrontmatterEndLine2(lines);
  const lineBreak = getLineBreak2(markdown);
  const replacementLines = buildReplacementLines(data);
  const hasWritableFields = buildFields(data).some((field) => field.value !== void 0 && field.value !== null);
  if (frontmatterEndLine === null) {
    if (!hasWritableFields) {
      return {
        changed: false,
        from: { line: 0, ch: 0 },
        replacement: ""
      };
    }
    return {
      changed: true,
      from: { line: 0, ch: 0 },
      replacement: ["---", ...replacementLines, "---", ""].join(lineBreak) + lineBreak
    };
  }
  const currentFrontmatterLines = lines.slice(1, frontmatterEndLine).map(stripTrailingCarriageReturn2);
  const nextFrontmatterLines = buildPatchedFrontmatterLines(lines, frontmatterEndLine, data);
  const replacement = nextFrontmatterLines.length > 0 ? nextFrontmatterLines.join(lineBreak) + lineBreak : "";
  return {
    changed: !arraysEqual3(currentFrontmatterLines, nextFrontmatterLines),
    from: { line: 1, ch: 0 },
    to: { line: frontmatterEndLine, ch: 0 },
    replacement
  };
}
function setWordSyncFrontmatterInMarkdown(markdown, data) {
  return applyPatch(markdown, buildWordSyncFrontmatterPatch(markdown, data));
}
function applyWordSyncFrontmatterPatchToEditor(editor, data) {
  const patch = buildWordSyncFrontmatterPatch(editor.getValue(), data);
  if (!patch.changed) {
    return false;
  }
  editor.replaceRange(patch.replacement, patch.from, patch.to, "eudic-sync");
  return true;
}

// src/alias-sync.ts
var import_obsidian11 = require("obsidian");

// src/hash.ts
function bytesToHex(bytes) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(content) {
  const data = new TextEncoder().encode(content);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(digest));
  }
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(content).digest("hex");
}

// src/note-output/obsidian-edit-link.ts
function escapeText(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttribute(value) {
  return escapeText(value).replace(/"/g, "&quot;");
}
function buildManagedObsidianUrl(app, pathScope, file, linkId) {
  return buildManagedFileProtocolUrl(app, pathScope, file, linkId);
}
function buildLinkedWordHtml(word, href) {
  return `<a href="${escapeAttribute(href)}"><b>${escapeText(word)}</b></a>`;
}

// src/alias-sync.ts
function normalizeKey(value) {
  return value.trim().toLocaleLowerCase();
}
function compareAliasNames(left, right) {
  return left.localeCompare(right, void 0, { sensitivity: "base" });
}
function buildAliasRedirectNoteHtml(app, pathScope, file, mainWord, wordLinkId) {
  const href = buildManagedObsidianUrl(app, pathScope, file, wordLinkId);
  return `See detail: ${buildLinkedWordHtml(mainWord, href)}`;
}
function toErrorMessage5(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
var AliasSyncService = class {
  constructor(options) {
    this.options = options;
    this.apiClient = new EudicApiClient(options.getAuthorizationToken);
  }
  async syncAliasesForWord(file, language, storedAliasHash, options = {}) {
    const frontmatter = getFrontmatter(this.options.app, file);
    const mainWord = getConfiguredWord(frontmatter, file);
    const normalizedAliases = getNormalizedAliases(frontmatter, file);
    if (normalizedAliases.length === 0) {
      return {
        hash: null,
        uploaded: false,
        skipped: storedAliasHash === null,
        aliasCount: 0,
        normalizedAliases
      };
    }
    const conflict = this.findConflict(file, normalizedAliases);
    if (conflict) {
      return {
        hash: null,
        uploaded: false,
        skipped: false,
        aliasCount: normalizedAliases.length,
        normalizedAliases,
        error: conflict
      };
    }
    if (!options.wordLinkId) {
      return {
        hash: null,
        uploaded: false,
        skipped: false,
        aliasCount: normalizedAliases.length,
        normalizedAliases,
        error: `Missing '${FRONTMATTER_KEYS.eudicLinkId}' for ${file.path}.`
      };
    }
    const noteHtml = buildAliasRedirectNoteHtml(
      this.options.app,
      this.options.pathScope,
      file,
      mainWord,
      options.wordLinkId
    );
    const currentHash = await sha256Hex(this.buildAliasBundleHashInput(language, normalizedAliases, noteHtml));
    if (!options.force && storedAliasHash === currentHash) {
      return {
        hash: currentHash,
        uploaded: false,
        skipped: true,
        aliasCount: normalizedAliases.length,
        normalizedAliases
      };
    }
    try {
      for (const alias of normalizedAliases) {
        await this.apiClient.overwriteNotePreservingAttachments({
          word: alias,
          language,
          note: noteHtml
        });
      }
    } catch (error) {
      return {
        hash: null,
        uploaded: false,
        skipped: false,
        aliasCount: normalizedAliases.length,
        normalizedAliases,
        error: toErrorMessage5(error)
      };
    }
    return {
      hash: currentHash,
      uploaded: true,
      skipped: false,
      aliasCount: normalizedAliases.length,
      normalizedAliases
    };
  }
  async getCurrentAliasHash(file, language, wordLinkId) {
    const frontmatter = getFrontmatter(this.options.app, file);
    const mainWord = getConfiguredWord(frontmatter, file);
    const normalizedAliases = getNormalizedAliases(frontmatter, file);
    if (normalizedAliases.length === 0) {
      return {
        hash: null,
        aliasCount: 0
      };
    }
    const conflict = this.findConflict(file, normalizedAliases);
    if (conflict) {
      return {
        hash: null,
        aliasCount: normalizedAliases.length,
        error: conflict
      };
    }
    const noteHtml = buildAliasRedirectNoteHtml(
      this.options.app,
      this.options.pathScope,
      file,
      mainWord,
      wordLinkId
    );
    return {
      hash: await sha256Hex(this.buildAliasBundleHashInput(language, normalizedAliases, noteHtml)),
      aliasCount: normalizedAliases.length
    };
  }
  buildAliasBundleHashInput(language, aliases, noteHtml) {
    const sortedAliases = [...aliases].sort(compareAliasNames);
    return JSON.stringify({
      language,
      aliases: sortedAliases,
      note: noteHtml
    });
  }
  findConflict(currentFile, aliases) {
    const currentPath = (0, import_obsidian11.normalizePath)(currentFile.path);
    const normalizedAliases = aliases.map((alias) => ({
      original: alias,
      key: normalizeKey(alias)
    }));
    for (const file of this.options.managedFiles.getWordFiles()) {
      const frontmatter = getFrontmatter(this.options.app, file);
      if (isWordSyncDisabledFrontmatter(frontmatter)) {
        continue;
      }
      const filePath = (0, import_obsidian11.normalizePath)(file.path);
      const fileMainWord = getConfiguredWord(frontmatter, file);
      const fileMainWordKey = normalizeKey(fileMainWord);
      if (filePath === currentPath) {
        continue;
      }
      const primaryConflict = normalizedAliases.find((alias) => alias.key === fileMainWordKey);
      if (primaryConflict) {
        return `Alias "${primaryConflict.original}" conflicts with enabled main entry "${fileMainWord}" in ${file.path}.`;
      }
      for (const fileAlias of getNormalizedAliases(frontmatter, file)) {
        const aliasConflict = normalizedAliases.find((alias) => alias.key === normalizeKey(fileAlias));
        if (!aliasConflict) {
          continue;
        }
        return `Alias "${aliasConflict.original}" is already claimed by enabled word note ${file.path}.`;
      }
    }
    return null;
  }
};

// src/html-renderer.ts
var import_obsidian12 = require("obsidian");

// src/reference-embed-expander.ts
var EMBED_PATTERN2 = /!\[\[([^[\]\n]+)\]\]/g;
var MAX_REFERENCE_EMBED_DEPTH = 4;
function normalizeMarkdown2(markdown) {
  return markdown.replace(/\r\n?/g, "\n");
}
function escapeForRegex3(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stripAlias(rawTarget) {
  return rawTarget.split("|")[0]?.trim() ?? rawTarget.trim();
}
function parseReferenceEmbedTarget(rawTarget) {
  const targetWithoutAlias = stripAlias(rawTarget);
  const hashIndex = targetWithoutAlias.indexOf("#");
  const linkpath = (hashIndex >= 0 ? targetWithoutAlias.slice(0, hashIndex) : targetWithoutAlias).trim();
  const subpath = hashIndex >= 0 ? targetWithoutAlias.slice(hashIndex + 1).trim() : "";
  return {
    linkpath,
    blockId: subpath.startsWith("^") ? subpath.slice(1).trim() || null : null
  };
}
function isStandaloneBlockAnchorLine(line, blockId) {
  return new RegExp(`^\\s*\\^${escapeForRegex3(blockId)}\\s*$`).test(line);
}
function stripInlineBlockAnchor(line, blockId) {
  const pattern = new RegExp(`^(.*?)(?:\\s+)\\^${escapeForRegex3(blockId)}\\s*$`);
  const match = line.match(pattern);
  if (!match) {
    return null;
  }
  return (match[1] ?? "").replace(/\s+$/, "");
}
function stripAnyInlineBlockAnchor(line) {
  return line.replace(/\s+\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/, "");
}
function stripReferenceBlockAnchors(markdown) {
  const lines = normalizeMarkdown2(markdown).split("\n");
  const output = [];
  for (const line of lines) {
    if (/^\s*\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/.test(line)) {
      continue;
    }
    output.push(stripAnyInlineBlockAnchor(line));
  }
  return trimBoundaryBlankLines(output.join("\n"));
}
function findOpeningFenceLine(lines, closingLineIndex) {
  const closingLine = lines[closingLineIndex] ?? "";
  const closingMatch = closingLine.match(/^\s*(`{3,}|~{3,})\s*$/);
  if (!closingMatch) {
    return null;
  }
  const fenceToken = closingMatch[1] ?? "";
  const fenceCharacter = fenceToken[0] ?? "`";
  const minimumLength = fenceToken.length;
  const fencePattern = new RegExp(`^\\s*${escapeForRegex3(fenceCharacter)}{${minimumLength},}`);
  for (let lineIndex = closingLineIndex - 1; lineIndex >= 0; lineIndex -= 1) {
    if (fencePattern.test(lines[lineIndex] ?? "")) {
      return lineIndex;
    }
  }
  return null;
}
function findPreviousContentLine(lines, anchorLineIndex) {
  for (let lineIndex = anchorLineIndex - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = lines[lineIndex] ?? "";
    if (line.trim().length > 0) {
      return lineIndex;
    }
  }
  return null;
}
function findContiguousBlockStart(lines, endLineIndex) {
  let startLineIndex = endLineIndex;
  while (startLineIndex > 0) {
    const previousLine = lines[startLineIndex - 1] ?? "";
    if (!previousLine.trim() || /^\s*\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/.test(previousLine)) {
      break;
    }
    startLineIndex -= 1;
  }
  return startLineIndex;
}
function findContiguousBlockEnd(lines, startLineIndex) {
  let endLineIndex = startLineIndex;
  while (endLineIndex < lines.length - 1) {
    const nextLine = lines[endLineIndex + 1] ?? "";
    if (!nextLine.trim() || /^\s*\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/.test(nextLine)) {
      break;
    }
    endLineIndex += 1;
  }
  return endLineIndex;
}
function extractReferenceMarkdownByBlockId(markdown, blockId) {
  const body = stripYamlFrontmatter(normalizeMarkdown2(markdown));
  const lines = body.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (!isStandaloneBlockAnchorLine(lines[lineIndex] ?? "", blockId)) {
      continue;
    }
    const contentLineIndex = findPreviousContentLine(lines, lineIndex);
    if (contentLineIndex === null) {
      return null;
    }
    const openingFenceLine = findOpeningFenceLine(lines, contentLineIndex);
    if (openingFenceLine !== null) {
      return trimBoundaryBlankLines(lines.slice(openingFenceLine, contentLineIndex + 1).join("\n"));
    }
    const blockStart = findContiguousBlockStart(lines, contentLineIndex);
    return trimBoundaryBlankLines(lines.slice(blockStart, contentLineIndex + 1).join("\n"));
  }
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const strippedLine = stripInlineBlockAnchor(lines[lineIndex] ?? "", blockId);
    if (strippedLine === null) {
      continue;
    }
    const blockStart = findContiguousBlockStart(lines, lineIndex);
    const blockEnd = findContiguousBlockEnd(lines, lineIndex);
    const blockLines = lines.slice(blockStart, blockEnd + 1);
    blockLines[lineIndex - blockStart] = strippedLine;
    return trimBoundaryBlankLines(blockLines.join("\n"));
  }
  return null;
}
async function readExpandedReferenceMarkdownSegments(app, pathScope, referenceFile, blockId, visited, depth, embeddedFromPath) {
  const visitKey = `${referenceFile.path}#${blockId ?? ""}`;
  if (visited.has(visitKey)) {
    return null;
  }
  const rawMarkdown = await app.vault.cachedRead(referenceFile);
  const referenceMarkdown = blockId ? extractReferenceMarkdownByBlockId(rawMarkdown, blockId) : stripReferenceBlockAnchors(stripYamlFrontmatter(rawMarkdown));
  if (!referenceMarkdown) {
    return null;
  }
  const nextVisited = new Set(visited);
  nextVisited.add(visitKey);
  return expandManagedReferenceEmbedsInMarkdownSegments(
    app,
    pathScope,
    referenceMarkdown,
    referenceFile.path,
    nextVisited,
    depth + 1,
    embeddedFromPath
  );
}
function pushSegment(segments, segment) {
  if (!segment.markdown) {
    return;
  }
  const previous = segments[segments.length - 1];
  if (previous && previous.sourcePath === segment.sourcePath && previous.embeddedFromPath === segment.embeddedFromPath) {
    previous.markdown += segment.markdown;
    return;
  }
  segments.push({ ...segment });
}
async function expandManagedReferenceEmbedsInMarkdownSegments(app, pathScope, markdown, sourcePath, visited = /* @__PURE__ */ new Set(), depth = 0, embeddedFromPath) {
  if (depth >= MAX_REFERENCE_EMBED_DEPTH || !markdown.includes("![[") || !markdown.includes("]]")) {
    return [{ markdown, sourcePath, embeddedFromPath }];
  }
  const normalizedMarkdown = normalizeMarkdown2(markdown);
  const output = [];
  let cursor = 0;
  for (const match of normalizedMarkdown.matchAll(EMBED_PATTERN2)) {
    const index = match.index ?? 0;
    const rawTarget = match[1] ?? "";
    const parsedTarget = parseReferenceEmbedTarget(rawTarget);
    const referencePath = resolveManagedReferencePath(app, pathScope, sourcePath, parsedTarget.linkpath);
    const referenceFile = referencePath ? app.vault.getFileByPath(referencePath) : null;
    pushSegment(output, {
      markdown: normalizedMarkdown.slice(cursor, index),
      sourcePath,
      embeddedFromPath
    });
    cursor = index + match[0].length;
    if (!referenceFile) {
      pushSegment(output, {
        markdown: match[0],
        sourcePath,
        embeddedFromPath
      });
      continue;
    }
    const expandedSegments = await readExpandedReferenceMarkdownSegments(
      app,
      pathScope,
      referenceFile,
      parsedTarget.blockId,
      visited,
      depth,
      sourcePath
    );
    if (!expandedSegments) {
      pushSegment(output, {
        markdown: match[0],
        sourcePath,
        embeddedFromPath
      });
      continue;
    }
    for (const segment of expandedSegments) {
      pushSegment(output, segment);
    }
  }
  pushSegment(output, {
    markdown: normalizedMarkdown.slice(cursor),
    sourcePath,
    embeddedFromPath
  });
  return output.length > 0 ? output : [{ markdown, sourcePath, embeddedFromPath }];
}

// src/render-markdown-frontmatter.ts
var LEADING_HYPHEN_THEMATIC_BREAK_PATTERN = /^[ \t]{0,3}-{3,}[ \t]*$/;
function protectLeadingThematicBreakFromFrontmatter(markdown) {
  const normalizedMarkdown = markdown.replace(/\r\n?/g, "\n");
  const firstLineBreakIndex = normalizedMarkdown.indexOf("\n");
  const firstLine = firstLineBreakIndex === -1 ? normalizedMarkdown : normalizedMarkdown.slice(0, firstLineBreakIndex);
  if (!LEADING_HYPHEN_THEMATIC_BREAK_PATTERN.test(firstLine)) {
    return normalizedMarkdown;
  }
  const remainingMarkdown = firstLineBreakIndex === -1 ? "" : normalizedMarkdown.slice(firstLineBreakIndex + 1);
  const nextMarkdownBlock = remainingMarkdown.replace(/^(?:[ \t]*\n)+/, "");
  return nextMarkdownBlock ? `<hr>

${nextMarkdownBlock}` : "<hr>";
}

// src/html-renderer.ts
function waitForFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
function normalizeMarkdown3(markdown) {
  return markdown.replace(/\r\n?/g, "\n");
}
function resolveSemanticOptions(source, sourcePath, embeddedFromPath) {
  if (!source) {
    return null;
  }
  return typeof source === "function" ? source(sourcePath, embeddedFromPath) : source;
}
async function expandReferenceSegments(app, pathScope, markdown, sourcePath, embeddedFromPath) {
  return pathScope ? expandManagedReferenceEmbedsInMarkdownSegments(app, pathScope, markdown, sourcePath, /* @__PURE__ */ new Set(), 0, embeddedFromPath) : [{ markdown, sourcePath, embeddedFromPath }];
}
async function transformRegularMarkdownForEudicRender(app, pathScope, markdown, sourcePath, semanticOptions, embeddedFromPath) {
  const segments = await expandReferenceSegments(app, pathScope, markdown, sourcePath, embeddedFromPath);
  const transformedMarkdownSegments = [];
  for (const segment of segments) {
    transformedMarkdownSegments.push(
      transformEudicBlocksToMarkdown(
        segment.markdown,
        await resolveSemanticOptions(semanticOptions, segment.sourcePath, segment.embeddedFromPath)
      )
    );
  }
  return transformedMarkdownSegments.join("");
}
async function transformEudicBlockForRender(app, pathScope, kind, body, sourcePath, semanticOptions) {
  const bodySegments = await expandReferenceSegments(app, pathScope, body, sourcePath);
  const transformedBodySegments = [];
  for (const segment of bodySegments) {
    const resolvedOptions = await resolveSemanticOptions(semanticOptions, segment.sourcePath, segment.embeddedFromPath);
    transformedBodySegments.push(
      resolvedOptions ? transformSemanticBlockBody(kind, segment.markdown, resolvedOptions) : segment.markdown
    );
  }
  return renderEudicBlockToMarkdown(kind, transformedBodySegments.join(""), null);
}
async function transformMarkdownForEudicRender(app, pathScope, markdown, sourcePath, semanticOptions) {
  const normalizedMarkdown = normalizeMarkdown3(markdown);
  const lines = normalizedMarkdown.split("\n");
  const output = [];
  let regularLines = [];
  const flushRegularLines = async () => {
    if (regularLines.length === 0) {
      return;
    }
    output.push(
      await transformRegularMarkdownForEudicRender(
        app,
        pathScope,
        regularLines.join("\n"),
        sourcePath,
        semanticOptions
      )
    );
    regularLines = [];
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const openingFence = parseEudicBlockFenceLine(currentLine);
    if (!openingFence) {
      regularLines.push(currentLine);
      continue;
    }
    let closingLineIndex = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if (isClosingEudicBlockFenceLine2(lines[candidateIndex] ?? "", openingFence.fenceToken)) {
        closingLineIndex = candidateIndex;
        break;
      }
    }
    if (closingLineIndex === null) {
      regularLines.push(currentLine);
      continue;
    }
    await flushRegularLines();
    output.push(
      await transformEudicBlockForRender(
        app,
        pathScope,
        openingFence.kind,
        lines.slice(lineIndex + 1, closingLineIndex).join("\n"),
        sourcePath,
        semanticOptions
      )
    );
    lineIndex = closingLineIndex;
  }
  await flushRegularLines();
  return output.join("\n");
}
var HtmlRenderer = class {
  constructor(app, pathScope) {
    this.app = app;
    this.pathScope = pathScope;
  }
  async renderFile(file) {
    const rawMarkdown = await this.app.vault.cachedRead(file);
    const markdown = stripYamlFrontmatter(rawMarkdown);
    return this.renderMarkdown(markdown, file.path);
  }
  async renderMarkdown(markdown, sourcePath, semanticOptions) {
    const container = document.createElement("div");
    const component = new import_obsidian12.Component();
    component.load();
    const transformedMarkdown = await transformMarkdownForEudicRender(
      this.app,
      this.pathScope,
      markdown,
      sourcePath,
      semanticOptions
    );
    const renderableMarkdown = protectLeadingThematicBreakFromFrontmatter(transformedMarkdown);
    try {
      await import_obsidian12.MarkdownRenderer.render(this.app, renderableMarkdown, container, sourcePath, component);
      await waitForFrame();
      return container.innerHTML;
    } finally {
      component.unload();
    }
  }
};

// src/note-output/dom-parser.ts
var BLOCK_TAGS = /* @__PURE__ */ new Set([
  "article",
  "blockquote",
  "body",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "main",
  "ol",
  "p",
  "section",
  "table",
  "tbody",
  "thead",
  "tr",
  "ul"
]);
var PARAGRAPH_TAGS = /* @__PURE__ */ new Set(["blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "p", "pre"]);
var INLINE_TAGS = /* @__PURE__ */ new Set([
  "a",
  "abbr",
  "b",
  "br",
  "cite",
  "code",
  "em",
  "i",
  "img",
  "kbd",
  "mark",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u"
]);
var STRIP_TAGS = /* @__PURE__ */ new Set(["script", "style"]);
var STRIP_CLASSES = /* @__PURE__ */ new Set([
  "copy-code-button",
  "embed-title",
  "embedded-backlinks",
  "frontmatter",
  "markdown-embed-title",
  "metadata-container",
  "mod-header",
  "mod-footer",
  "snw-block-preview",
  "snw-reference"
]);
function normalizeText(value) {
  return value.replace(/\s+/g, " ");
}
function hasStripClass(element) {
  return Array.from(element.classList).some((className) => STRIP_CLASSES.has(className));
}
function shouldStripElement(element) {
  const tagName = element.tagName.toLowerCase();
  if (STRIP_TAGS.has(tagName)) {
    return true;
  }
  if (hasStripClass(element)) {
    return true;
  }
  if (element.hasAttribute("data-snw-type") || element.hasAttribute("data-snw-key") || element.hasAttribute("data-snw-filepath")) {
    return true;
  }
  if (tagName === "span" && element.hasAttribute("src")) {
    const hasEmbeddedContent = element.childElementCount > 0 || normalizeText(element.textContent ?? "").trim().length > 0;
    return !hasEmbeddedContent;
  }
  return false;
}
var BLOCKED_HREF_SCHEMES = /* @__PURE__ */ new Set(["data", "javascript", "vbscript"]);
var ALLOWED_IMAGE_SCHEMES = /* @__PURE__ */ new Set(["http", "https"]);
function getHrefScheme(href) {
  const match = href.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  return match?.[1]?.toLowerCase() ?? null;
}
function isAllowedHref(href) {
  if (typeof href !== "string") {
    return false;
  }
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.startsWith("#")) {
    return false;
  }
  const scheme = getHrefScheme(trimmedHref);
  if (!scheme || BLOCKED_HREF_SCHEMES.has(scheme)) {
    return false;
  }
  return true;
}
function normalizeInternalTarget(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue.startsWith("#") || getHrefScheme(trimmedValue)) {
    return null;
  }
  const hashIndex = trimmedValue.indexOf("#");
  const withoutSubpath = hashIndex >= 0 ? trimmedValue.slice(0, hashIndex) : trimmedValue;
  const withoutMarkdownExtension = withoutSubpath.replace(/\.md$/i, "");
  try {
    return decodeURIComponent(withoutMarkdownExtension).trim() || null;
  } catch {
    return null;
  }
}
function getInternalLinkTarget(element) {
  const dataHrefTarget = normalizeInternalTarget(element.getAttribute("data-href"));
  if (element.classList.contains("internal-link") || dataHrefTarget) {
    return dataHrefTarget ?? normalizeInternalTarget(element.getAttribute("href"));
  }
  return normalizeInternalTarget(element.getAttribute("href"));
}
function resolveManagedInternalLinkHref(target, linkResolver) {
  if (!linkResolver) {
    return null;
  }
  const normalizedTarget = normalizeInternalTarget(target);
  if (!normalizedTarget) {
    return null;
  }
  try {
    const file = linkResolver.app.metadataCache.getFirstLinkpathDest(normalizedTarget, linkResolver.sourcePath);
    if (!file || file.extension !== "md") {
      return null;
    }
    const kind = linkResolver.pathScope.isWordPath(file.path) ? "word" : linkResolver.pathScope.isReferencePath(file.path) ? "reference" : null;
    if (!kind) {
      return null;
    }
    const frontmatter = getFrontmatter(linkResolver.app, file);
    if (kind === "word" && isWordSyncDisabledFrontmatter(frontmatter)) {
      return null;
    }
    const linkId = readNullableString(frontmatter[FRONTMATTER_KEYS.eudicLinkId]);
    if (!linkId) {
      return null;
    }
    return buildManagedFileProtocolUrl(linkResolver.app, linkResolver.pathScope, file, linkId);
  } catch {
    return null;
  }
}
function buildManagedInternalLinkHref(element, context) {
  const resolver = context.linkResolver;
  if (!resolver) {
    return null;
  }
  const target = getInternalLinkTarget(element);
  return resolveManagedInternalLinkHref(target, resolver);
}
function isAllowedNoteOutputImageSrc(src) {
  if (typeof src !== "string") {
    return false;
  }
  const trimmedSrc = src.trim();
  if (!trimmedSrc) {
    return false;
  }
  const scheme = getHrefScheme(trimmedSrc);
  return !!scheme && ALLOWED_IMAGE_SCHEMES.has(scheme);
}
function createImageInline(element, hrefOverride) {
  const src = element.getAttribute("src");
  if (!isAllowedNoteOutputImageSrc(src)) {
    return null;
  }
  const trimmedSrc = src.trim();
  const hrefCandidate = hrefOverride ?? null;
  const trimmedHref = isAllowedHref(hrefCandidate) ? hrefCandidate.trim() : trimmedSrc;
  return {
    type: "image",
    src: trimmedSrc,
    href: trimmedHref,
    alt: normalizeText(element.getAttribute("alt") ?? "").trim()
  };
}
function hasDirectBlockChildren(element) {
  return Array.from(element.childNodes).some((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const childElement = child;
    if (shouldStripElement(childElement)) {
      return false;
    }
    const tagName = childElement.tagName.toLowerCase();
    return tagName === "hr" || BLOCK_TAGS.has(tagName);
  });
}
function isBlockChildElement(element) {
  const tagName = element.tagName.toLowerCase();
  return tagName === "hr" || !INLINE_TAGS.has(tagName) && BLOCK_TAGS.has(tagName);
}
function hasMeaningfulInline(inlines) {
  return inlines.some((inline) => {
    if (inline.type === "lineBreak") {
      return true;
    }
    if (inline.type === "text") {
      return inline.text.trim().length > 0;
    }
    if (inline.type === "image") {
      return true;
    }
    return hasMeaningfulInline(inline.children);
  });
}
function collectInlineFromChildren(childNodes, context) {
  const parts = [];
  for (const child of Array.from(childNodes)) {
    parts.push(...collectInlineFromNode(child, context));
  }
  return parts;
}
function collectInlineFromNode(node, context) {
  if (node.nodeType === Node.COMMENT_NODE) {
    return [];
  }
  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeText(node.textContent ?? "");
    return text.length > 0 ? [{ type: "text", text }] : [];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }
  const element = node;
  if (shouldStripElement(element)) {
    return [];
  }
  const tagName = element.tagName.toLowerCase();
  if (tagName === "br") {
    return [{ type: "lineBreak" }];
  }
  if (tagName === "strong" || tagName === "b") {
    const children = collectInlineFromChildren(element.childNodes, context);
    return hasMeaningfulInline(children) ? [{ type: "bold", children }] : [];
  }
  if (tagName === "a") {
    const href = element.getAttribute("href");
    const managedInternalHref = buildManagedInternalLinkHref(element, context);
    const directImageChildren = Array.from(element.childNodes).filter((child) => child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "img");
    if (managedInternalHref || isAllowedHref(href)) {
      const resolvedHref = managedInternalHref ?? href.trim();
      const imageChildren = directImageChildren.flatMap((imageElement) => createImageInline(imageElement, resolvedHref)).filter((inline) => !!inline);
      if (imageChildren.length > 0) {
        const nonImageChildren = Array.from(element.childNodes).filter((child) => !directImageChildren.includes(child));
        return [...imageChildren, ...collectInlineFromChildren(nonImageChildren, context)];
      }
      const children2 = collectInlineFromChildren(element.childNodes, context);
      return [{ type: "link", href: resolvedHref, children: children2 }];
    }
    const children = collectInlineFromChildren(element.childNodes, context);
    return children;
  }
  if (tagName === "img") {
    const image = createImageInline(element);
    return image ? [image] : [];
  }
  return collectInlineFromChildren(element.childNodes, context);
}
function createTextInline(text) {
  return { type: "text", text };
}
function createParagraph(inlines, prefixInlines = []) {
  const nextInlines = prefixInlines.length > 0 ? [...prefixInlines, ...inlines] : inlines;
  return hasMeaningfulInline(nextInlines) ? [{ type: "paragraph", inlines: nextInlines }] : [];
}
function createOrderedListPrefixInlines(index) {
  return [
    {
      type: "bold",
      children: [createTextInline(`${index}.`)]
    },
    createTextInline(" ")
  ];
}
function prependPrefixToFirstParagraphBlock(blocks, prefixInlines) {
  if (prefixInlines.length === 0) {
    return blocks;
  }
  const prefixedBlocks = [...blocks];
  for (let index = 0; index < prefixedBlocks.length; index += 1) {
    const block = prefixedBlocks[index];
    if (block?.type !== "paragraph") {
      continue;
    }
    prefixedBlocks[index] = {
      type: "paragraph",
      inlines: [...prefixInlines, ...block.inlines]
    };
    return prefixedBlocks;
  }
  return prefixedBlocks;
}
function collectPrefixedBlocksFromListItem(element, prefixInlines, context) {
  const blocks = [];
  let pendingInlineNodes = [];
  let hasPrefixedParagraph = false;
  const flushPendingInlineNodes = () => {
    const paragraphBlocks = createParagraph(collectInlineFromChildren(pendingInlineNodes, context), hasPrefixedParagraph ? [] : prefixInlines);
    pendingInlineNodes = [];
    if (paragraphBlocks.length === 0) {
      return;
    }
    hasPrefixedParagraph = true;
    blocks.push(...paragraphBlocks);
  };
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      pendingInlineNodes.push(child);
      continue;
    }
    const childElement = child;
    if (shouldStripElement(childElement)) {
      continue;
    }
    const tagName = childElement.tagName.toLowerCase();
    if (tagName !== "hr" && !BLOCK_TAGS.has(tagName)) {
      pendingInlineNodes.push(child);
      continue;
    }
    flushPendingInlineNodes();
    let childBlocks = collectBlocksFromNode(child, context);
    if (!hasPrefixedParagraph) {
      childBlocks = prependPrefixToFirstParagraphBlock(childBlocks, prefixInlines);
      hasPrefixedParagraph = childBlocks.some((block) => block.type === "paragraph");
    }
    blocks.push(...childBlocks);
  }
  flushPendingInlineNodes();
  return blocks;
}
function collectStructuredListItem(element, context) {
  const blocks = [];
  let pendingInlineNodes = [];
  const flushPendingInlineNodes = () => {
    const paragraphBlocks = createParagraph(collectInlineFromChildren(pendingInlineNodes, context));
    pendingInlineNodes = [];
    if (paragraphBlocks.length === 0) {
      return;
    }
    blocks.push(...paragraphBlocks);
  };
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      pendingInlineNodes.push(child);
      continue;
    }
    const childElement = child;
    if (shouldStripElement(childElement)) {
      continue;
    }
    const tagName = childElement.tagName.toLowerCase();
    if (tagName !== "hr" && !BLOCK_TAGS.has(tagName)) {
      pendingInlineNodes.push(child);
      continue;
    }
    flushPendingInlineNodes();
    blocks.push(...collectBlocksFromNode(child, context));
  }
  flushPendingInlineNodes();
  const normalizedBlocks = normalizeBlocks(blocks);
  if (normalizedBlocks.length === 0) {
    return null;
  }
  return { blocks: normalizedBlocks };
}
function readIntegerAttribute(element, attributeName) {
  const rawValue = element.getAttribute(attributeName);
  if (typeof rawValue !== "string") {
    return null;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
function collectOrderedListBlocks(element, context) {
  const blocks = [];
  let nextIndex = readIntegerAttribute(element, "start") ?? 1;
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      blocks.push(...collectBlocksFromNode(child, context));
      continue;
    }
    const childElement = child;
    if (shouldStripElement(childElement)) {
      continue;
    }
    if (childElement.tagName.toLowerCase() !== "li") {
      blocks.push(...collectBlocksFromNode(child, context));
      continue;
    }
    const explicitIndex = readIntegerAttribute(childElement, "value");
    const currentIndex = explicitIndex ?? nextIndex;
    blocks.push(...collectPrefixedBlocksFromListItem(childElement, createOrderedListPrefixInlines(currentIndex), context));
    nextIndex = currentIndex + 1;
  }
  return blocks;
}
function collectUnorderedListBlocks(element, context) {
  const blocks = [];
  const items = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      const textBlocks = collectBlocksFromNode(child, context);
      if (textBlocks.length > 0) {
        if (items.length > 0) {
          blocks.push({ type: "unorderedList", items: [...items] });
          items.length = 0;
        }
        blocks.push(...textBlocks);
      }
      continue;
    }
    const childElement = child;
    if (shouldStripElement(childElement)) {
      continue;
    }
    if (childElement.tagName.toLowerCase() !== "li") {
      if (items.length > 0) {
        blocks.push({ type: "unorderedList", items: [...items] });
        items.length = 0;
      }
      blocks.push(...collectBlocksFromNode(child, context));
      continue;
    }
    const item = collectStructuredListItem(childElement, context);
    if (item) {
      items.push(item);
    }
  }
  if (items.length > 0) {
    blocks.push({ type: "unorderedList", items });
  }
  return blocks;
}
function collectBlocksFromChildren(childNodes, context) {
  const blocks = [];
  let pendingInlineNodes = [];
  const flushPendingInlineNodes = () => {
    if (pendingInlineNodes.length === 0) {
      return;
    }
    blocks.push(...createParagraph(collectInlineFromChildren(pendingInlineNodes, context)));
    pendingInlineNodes = [];
  };
  for (const child of Array.from(childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      pendingInlineNodes.push(child);
      continue;
    }
    const childElement = child;
    if (shouldStripElement(childElement)) {
      continue;
    }
    if (!isBlockChildElement(childElement)) {
      pendingInlineNodes.push(child);
      continue;
    }
    flushPendingInlineNodes();
    blocks.push(...collectBlocksFromNode(child, context));
  }
  flushPendingInlineNodes();
  return blocks;
}
function collectBlocksFromNode(node, context) {
  if (node.nodeType === Node.COMMENT_NODE) {
    return [];
  }
  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeText(node.textContent ?? "");
    return text.trim() ? [{ type: "paragraph", inlines: [{ type: "text", text }] }] : [];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }
  const element = node;
  if (shouldStripElement(element)) {
    return [];
  }
  const tagName = element.tagName.toLowerCase();
  if (tagName === "hr") {
    return [{ type: "separator" }];
  }
  if (tagName === "ol") {
    return collectOrderedListBlocks(element, context);
  }
  if (tagName === "ul") {
    return collectUnorderedListBlocks(element, context);
  }
  if (PARAGRAPH_TAGS.has(tagName)) {
    return createParagraph(collectInlineFromChildren(element.childNodes, context));
  }
  if (tagName === "li") {
    const item = collectStructuredListItem(element, context);
    return item ? item.blocks : [];
  }
  if (hasDirectBlockChildren(element)) {
    return collectBlocksFromChildren(element.childNodes, context);
  }
  return createParagraph(collectInlineFromChildren(element.childNodes, context));
}
function normalizeBlocks(blocks) {
  const normalized = [];
  for (const block of blocks) {
    if (block.type === "paragraph" && !hasMeaningfulInline(block.inlines)) {
      continue;
    }
    if (block.type === "unorderedList" && block.items.length === 0) {
      continue;
    }
    if (block.type === "separator" && normalized.at(-1)?.type === "separator") {
      continue;
    }
    normalized.push(block);
  }
  return normalized;
}
function buildNoteOutputBlocks(renderedHtml, linkResolver) {
  const documentRoot = new DOMParser().parseFromString(`<html><body>${renderedHtml}</body></html>`, "text/html");
  return normalizeBlocks(collectBlocksFromChildren(documentRoot.body.childNodes, { linkResolver }));
}

// src/note-output/serializer.ts
function escapeText2(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttribute2(value) {
  return escapeText2(value).replace(/"/g, "&quot;");
}
function normalizeInlineOutput(output, mode) {
  const collapsedSpaces = output.replace(/[ \t\f\r\v]+/g, " ");
  if (mode === "minimal") {
    return collapsedSpaces.replace(/ *\n */g, "\n").trim();
  }
  return collapsedSpaces.replace(/\s*<br>\s*/g, "<br>").trim();
}
function renderInline(inline, mode) {
  switch (inline.type) {
    case "text":
      return escapeText2(inline.text);
    case "lineBreak":
      return mode === "minimal" ? "\n" : "<br>";
    case "bold": {
      const children = renderInlines(inline.children, mode);
      return children ? `<b>${children}</b>` : "";
    }
    case "link": {
      const children = renderInlines(inline.children, mode) || escapeText2(inline.href);
      return `<a href="${escapeAttribute2(inline.href)}">${children}</a>`;
    }
    case "image": {
      const alt = inline.alt ? ` alt="${escapeAttribute2(inline.alt)}"` : "";
      return `<a href="${escapeAttribute2(inline.href)}" target="_blank" style="float:right;margin:0 0 2px 2px;"><img src="${escapeAttribute2(inline.src)}" width="100"${alt}></a>`;
    }
  }
}
function renderInlines(inlines, mode) {
  const rendered = inlines.map((inline) => renderInline(inline, mode)).join("");
  return normalizeInlineOutput(rendered, mode);
}
function getPlainInlineText(inline) {
  switch (inline.type) {
    case "text":
      return inline.text;
    case "bold": {
      let text = "";
      for (const child of inline.children) {
        const childText = getPlainInlineText(child);
        if (childText === null) {
          return null;
        }
        text += childText;
      }
      return text;
    }
    case "lineBreak":
    case "link":
    case "image":
      return null;
  }
}
function isOrderedListMarkerParagraph(block) {
  if (block.type !== "paragraph") {
    return false;
  }
  let text = "";
  let hasBoldMarker = false;
  for (const inline of block.inlines) {
    const inlineText = getPlainInlineText(inline);
    if (inlineText === null) {
      return false;
    }
    text += inlineText;
    hasBoldMarker ||= inline.type === "bold";
  }
  return hasBoldMarker && /^\d+\.$/.test(text.trim());
}
function getUnorderedListPadding(depth) {
  return depth === 0 ? "1.1em" : "1em";
}
function getUnorderedListMarkerType(depth) {
  return depth === 0 ? "disc" : "circle";
}
function renderUnorderedList(list, mode, depth) {
  const items = list.items.map((item) => renderListItem(item, mode, depth)).filter((rendered) => rendered.length > 0).join("");
  if (!items) {
    return "";
  }
  const markerType = getUnorderedListMarkerType(depth);
  return `<ul type="${markerType}" style="margin:0;padding-left:${getUnorderedListPadding(depth)};list-style-type:${markerType};list-style-position:outside">${items}</ul>`;
}
function renderListItem(item, mode, depth) {
  const rendered = renderBlocks(item.blocks, mode, "list-item", depth + 1);
  return rendered ? `<li style="margin:0;display:list-item;list-style-type:inherit;list-style-position:outside">${rendered}</li>` : "";
}
function renderBlock(block, mode, depth) {
  switch (block.type) {
    case "separator":
      return "<hr>";
    case "paragraph":
      return renderInlines(block.inlines, mode);
    case "unorderedList":
      return renderUnorderedList(block, mode, depth);
  }
}
function getBlockJoiner(previous, next, mode) {
  if (isOrderedListMarkerParagraph(previous) && next.type === "paragraph") {
    return " ";
  }
  if (mode === "minimal") {
    return "\n";
  }
  if (previous.type === "separator" || next.type === "separator" || previous.type === "unorderedList" || next.type === "unorderedList") {
    return "";
  }
  return "<br>";
}
function renderBlocks(blocks, mode, _context, depth) {
  const meaningfulBlocks = blocks.map((block) => ({ block, rendered: renderBlock(block, mode, depth) })).filter(({ rendered }) => rendered.length > 0);
  if (meaningfulBlocks.length === 0) {
    return "";
  }
  let output = meaningfulBlocks[0].rendered;
  for (let index = 1; index < meaningfulBlocks.length; index += 1) {
    const previous = meaningfulBlocks[index - 1];
    const current = meaningfulBlocks[index];
    output += getBlockJoiner(previous.block, current.block, mode) + current.rendered;
  }
  return output.trim();
}
function serializeNoteOutputBlocks(blocks, mode) {
  return renderBlocks(blocks, mode, "top-level", 0);
}

// src/note-output/index.ts
function buildFinalNoteHtml(renderedHtml, mode, linkResolver) {
  const blocks = buildNoteOutputBlocks(renderedHtml, linkResolver);
  return serializeNoteOutputBlocks(blocks, mode);
}
function createTextInline2(text) {
  return { type: "text", text };
}
function buildLinkedWordHeadingBlock(word, href) {
  return {
    type: "paragraph",
    inlines: [
      {
        type: "link",
        href,
        children: [
          {
            type: "bold",
            children: [createTextInline2(word)]
          }
        ]
      }
    ]
  };
}
function buildFinalWordNoteHtml(renderedHtml, mode, word, href, linkResolver) {
  const blocks = buildNoteOutputBlocks(renderedHtml, linkResolver);
  return serializeNoteOutputBlocks([buildLinkedWordHeadingBlock(word, href), ...blocks], mode);
}

// src/sync-render-cache.ts
function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function getSemanticSettingsSignature(settings) {
  return stableJson({
    boldMarkers: settings.boldMarkers,
    enableSemanticBlockMarkerBold: settings.enableSemanticBlockMarkerBold,
    enableSemanticBlockWordBold: settings.enableSemanticBlockWordBold,
    enableSemanticBlockWordLinks: settings.enableSemanticBlockWordLinks,
    semanticBlockKindPresets: settings.semanticBlockKindPresets,
    semanticBlockWordBoldKinds: settings.semanticBlockWordBoldKinds,
    semanticBlockWordLinkKinds: settings.semanticBlockWordLinkKinds
  });
}
function keysEqual(left, right) {
  return left.wordPath === right.wordPath && left.wordSignature === right.wordSignature && left.noteOutputMode === right.noteOutputMode && left.semanticSettingsSignature === right.semanticSettingsSignature && left.referenceDependencySignature === right.referenceDependencySignature;
}
var SyncRenderCache = class {
  constructor() {
    this.entries = /* @__PURE__ */ new Map();
  }
  get(key) {
    const entry = this.entries.get(key.wordPath);
    if (!entry || !keysEqual(entry.key, key)) {
      return null;
    }
    return entry.finalNoteHtml;
  }
  set(key, finalNoteHtml) {
    this.entries.set(key.wordPath, {
      key: { ...key },
      finalNoteHtml
    });
  }
  invalidateWord(path) {
    this.entries.delete(path);
  }
  invalidateAll() {
    this.entries.clear();
  }
};

// src/word-sync-signature.ts
function readYamlBlock(markdown) {
  return markdown.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/)?.[1] ?? "";
}
function readYamlFieldSource(markdown, key) {
  const lines = readYamlBlock(markdown).split(/\r?\n/);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyPattern = new RegExp(`^\\s*${escapedKey}\\s*:\\s*(.*?)\\s*$`);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(keyPattern);
    if (!match) {
      continue;
    }
    const collected = [line.trim()];
    for (let nestedIndex = index + 1; nestedIndex < lines.length; nestedIndex += 1) {
      const nestedLine = lines[nestedIndex] ?? "";
      if (/^\S/.test(nestedLine)) {
        break;
      }
      if (nestedLine.trim()) {
        collected.push(nestedLine.trim());
      }
    }
    return collected.join("\n");
  }
  return "";
}
function getWordSyncSignature(markdown) {
  const syncRelevantFrontmatter = [
    FRONTMATTER_KEYS.word,
    FRONTMATTER_KEYS.lang,
    FRONTMATTER_KEYS.aliases,
    FRONTMATTER_KEYS.eudicLinkId,
    FRONTMATTER_KEYS.syncEudicEnabled
  ].map((key) => `${key}:${readYamlFieldSource(markdown, key)}`).join("\n");
  return `${syncRelevantFrontmatter}
---body---
${stripYamlFrontmatter(markdown)}`;
}

// src/sync-service.ts
function pad24(value) {
  return String(value).padStart(2, "0");
}
function formatLocalOffsetIso(date) {
  const year = date.getFullYear();
  const month = pad24(date.getMonth() + 1);
  const day = pad24(date.getDate());
  const hours = pad24(date.getHours());
  const minutes = pad24(date.getMinutes());
  const seconds = pad24(date.getSeconds());
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = pad24(Math.floor(absoluteOffsetMinutes / 60));
  const offsetRemainderMinutes = pad24(absoluteOffsetMinutes % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainderMinutes}`;
}
function nowIsoString() {
  return formatLocalOffsetIso(/* @__PURE__ */ new Date());
}
function toErrorMessage6(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
function normalizeWordKey3(value) {
  return value.trim().toLocaleLowerCase();
}
function normalizeLanguageKey(value) {
  return value.trim().toLocaleLowerCase();
}
var SyncService = class {
  constructor(options) {
    this.options = options;
    this.renderCache = new SyncRenderCache();
    this.renderer = new HtmlRenderer(options.app, options.pathScope);
    this.apiClient = new EudicApiClient(() => this.options.getSettings().authorizationToken);
    this.semanticBlockAutomation = new SemanticBlockAutomationResolver({
      app: options.app,
      pathScope: options.pathScope,
      managedFiles: options.managedFiles,
      referenceIndex: options.referenceIndex,
      getSettings: options.getSettings
    });
    this.aliasSyncService = new AliasSyncService({
      app: options.app,
      pathScope: options.pathScope,
      managedFiles: options.managedFiles,
      getAuthorizationToken: () => this.options.getSettings().authorizationToken
    });
  }
  getWordContext(file) {
    return getWordNoteContext(this.options.app, this.options.pathScope, file);
  }
  canSyncFile(file) {
    if (!file) return false;
    if (file.extension !== "md") return false;
    return this.getWordContext(file) !== null;
  }
  getSemanticBlockTransformOptionsForSourcePath(sourcePath, embeddedFromPath, currentFile, currentWord, currentWordLinkId) {
    return this.semanticBlockAutomation.getTransformOptionsForSourcePath({
      sourcePath,
      embeddedFromPath,
      currentWordFile: currentFile,
      currentWord,
      currentWordLinkId
    });
  }
  invalidateSemanticBlockReferenceCache(referencePaths) {
    this.semanticBlockAutomation.invalidateReferenceLinkTargets(referencePaths);
    this.renderCache.invalidateAll();
  }
  async collectDirtyWords() {
    const dirtyWords = [];
    for (const file of this.options.managedFiles.getWordFiles()) {
      const context = this.getWordContext(file);
      if (!context) continue;
      if (context.bodyStatus !== "dirty") continue;
      dirtyWords.push(file);
    }
    return dirtyWords;
  }
  /**
   * Dirty is intentionally a cheap "needs confirmation" marker.
   * Do not render Markdown or compute the final Eudic HTML hash here; that work belongs in syncWord().
   */
  async markWordDirty(file, reason) {
    const context = this.getWordContext(file);
    if (!context) {
      return false;
    }
    if (context.bodyStatus === "dirty" && !context.lastError) {
      return false;
    }
    await this.options.writeSyncFrontmatter(file, {
      syncStatus: "dirty",
      lastError: reason ?? null
    });
    return true;
  }
  /**
   * This is the single sync gate: rebuild final Eudic HTML, hash that exact string,
   * and only upload when it differs from last_synced_hash.
   */
  async syncWord(file, options = {}) {
    const wordLinkId = await this.options.ensureWordLinkId(file);
    const context = this.getWordContext(file);
    if (!context) {
      throw new Error(`File is not an eligible Eudic word note: ${file.path}`);
    }
    try {
      if (!context.lang) {
        throw new Error(`Missing '${FRONTMATTER_KEYS.lang}' in ${file.path}.`);
      }
      const frontmatter = getFrontmatter(this.options.app, file);
      const storedAliasHash = readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedAliasesHash]);
      const settings = this.options.getSettings();
      const rawMarkdown = await this.options.app.vault.cachedRead(file);
      const { finalNoteHtml } = await this.renderFinalWordNoteHtml(file, context, wordLinkId, settings, rawMarkdown);
      const currentHash = await sha256Hex(finalNoteHtml);
      let uploaded = false;
      if (options.force || context.lastSyncedHash !== currentHash) {
        await this.apiClient.overwriteNotePreservingAttachments({
          word: context.word,
          language: context.lang,
          note: finalNoteHtml
        });
        uploaded = true;
      }
      const aliasResult = await this.aliasSyncService.syncAliasesForWord(file, context.lang, storedAliasHash, {
        force: options.force,
        wordLinkId
      });
      if (aliasResult.error) {
        await this.writeDirtyStateAfterMainConfirmation(file, currentHash, aliasResult.error);
        return {
          file,
          word: context.word,
          status: "dirty",
          uploaded,
          skipped: false,
          aliasCount: aliasResult.aliasCount,
          aliasUploaded: 0,
          aliasSkipped: false,
          aliasError: aliasResult.error,
          error: aliasResult.error
        };
      }
      const status = await this.writeSyncedState(file, currentHash, aliasResult.hash);
      return {
        file,
        word: context.word,
        status,
        uploaded: uploaded || aliasResult.uploaded,
        skipped: !uploaded && !aliasResult.uploaded && aliasResult.skipped,
        aliasCount: aliasResult.aliasCount,
        aliasUploaded: aliasResult.uploaded ? aliasResult.aliasCount : 0,
        aliasSkipped: aliasResult.skipped || aliasResult.aliasCount === 0
      };
    } catch (error) {
      const message = toErrorMessage6(error);
      try {
        await this.options.writeSyncFrontmatter(file, {
          syncStatus: "dirty",
          lastError: message
        });
      } catch {
      }
      return {
        file,
        word: context.word,
        status: "dirty",
        uploaded: false,
        skipped: false,
        aliasCount: 0,
        aliasUploaded: 0,
        aliasSkipped: false,
        error: message
      };
    }
  }
  async reconcileWordSyncStatus(file) {
    let wordContentSynced = false;
    try {
      wordContentSynced = await this.isWordContentSynced(file);
    } catch {
      wordContentSynced = false;
    }
    let nextStatus = "dirty";
    nextStatus = wordContentSynced ? "synced" : "dirty";
    await this.options.writeSyncFrontmatter(file, {
      syncStatus: nextStatus,
      lastError: nextStatus === "synced" ? null : void 0
    });
    return nextStatus;
  }
  async resyncAliases(file) {
    const context = this.getWordContext(file);
    if (!context) {
      throw new Error(`File is not an eligible Eudic word note: ${file.path}`);
    }
    if (!context.lang) {
      throw new Error(`Missing '${FRONTMATTER_KEYS.lang}' in ${file.path}.`);
    }
    const frontmatter = getFrontmatter(this.options.app, file);
    const storedAliasHash = readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedAliasesHash]);
    const wordLinkId = await this.options.ensureWordLinkId(file);
    const aliasResult = await this.aliasSyncService.syncAliasesForWord(file, context.lang, storedAliasHash, {
      force: true,
      wordLinkId
    });
    if (aliasResult.aliasCount === 0) {
      return {
        file,
        word: context.word,
        status: context.effectiveStatus,
        aliasCount: 0,
        aliasUploaded: 0,
        aliasSkipped: true,
        noAliases: true
      };
    }
    if (aliasResult.error) {
      await this.options.writeSyncFrontmatter(file, {
        lastError: aliasResult.error
      });
      return {
        file,
        word: context.word,
        status: context.effectiveStatus,
        aliasCount: aliasResult.aliasCount,
        aliasUploaded: 0,
        aliasSkipped: false,
        noAliases: false,
        error: aliasResult.error
      };
    }
    await this.options.writeSyncFrontmatter(file, {
      lastSyncedAliasesHash: aliasResult.hash,
      lastError: null
    });
    return {
      file,
      word: context.word,
      status: context.effectiveStatus,
      aliasCount: aliasResult.aliasCount,
      aliasUploaded: aliasResult.aliasCount,
      aliasSkipped: false,
      noAliases: false
    };
  }
  async deleteCurrentWordNote(file) {
    const context = this.getWordContext(file);
    if (!context) {
      throw new Error(`File is not an eligible Eudic word note: ${file.path}`);
    }
    if (!context.lang) {
      throw new Error(`Missing '${FRONTMATTER_KEYS.lang}' in ${file.path}.`);
    }
    await this.apiClient.deleteNote({
      word: context.word,
      language: context.lang
    });
    await this.invalidateMainWordAfterDelete(file);
    return {
      word: context.word,
      language: context.lang,
      matchedMainFiles: [file],
      matchedAliasOwnerFiles: []
    };
  }
  async deleteTypedWordNote(word, language) {
    const trimmedWord = word.trim();
    const trimmedLanguage = language.trim();
    if (!trimmedWord) {
      throw new Error("Word is required.");
    }
    if (!trimmedLanguage) {
      throw new Error("Language is required.");
    }
    await this.apiClient.deleteNote({
      word: trimmedWord,
      language: trimmedLanguage
    });
    const matchedMainFiles = this.findMatchingMainWordFiles(trimmedWord, trimmedLanguage);
    const matchedAliasOwnerFiles = this.findMatchingAliasOwnerFiles(trimmedWord, trimmedLanguage, matchedMainFiles);
    for (const file of matchedMainFiles) {
      await this.invalidateMainWordAfterDelete(file);
    }
    for (const file of matchedAliasOwnerFiles) {
      await this.invalidateAliasOwnerAfterDelete(file);
    }
    return {
      word: trimmedWord,
      language: trimmedLanguage,
      matchedMainFiles,
      matchedAliasOwnerFiles
    };
  }
  async syncWords(files) {
    const results = [];
    for (const file of files) {
      results.push(await this.syncWord(file));
    }
    return {
      total: results.length,
      uploaded: results.filter((result) => result.uploaded).length,
      skipped: results.filter((result) => result.skipped).length,
      failed: results.filter((result) => result.error).length,
      aliasUploaded: results.reduce((sum, result) => sum + result.aliasUploaded, 0),
      results
    };
  }
  getAvailableWordLanguages() {
    const languages = /* @__PURE__ */ new Set(["en"]);
    for (const file of this.options.managedFiles.getWordFiles()) {
      const context = this.getWordContext(file);
      if (!context?.lang) {
        continue;
      }
      languages.add(context.lang);
    }
    return Array.from(languages).sort((left, right) => {
      if (left === "en") return -1;
      if (right === "en") return 1;
      return left.localeCompare(right);
    });
  }
  getReferenceDependencySignature(file) {
    const references = this.options.referenceIndex?.findReferencesForWord?.(file.path) ?? [];
    return references.join("\0");
  }
  async renderFinalWordNoteHtml(file, context, wordLinkId, settings, rawMarkdown) {
    const sourceMarkdown = rawMarkdown ?? await this.options.app.vault.cachedRead(file);
    const wordSignature = getWordSyncSignature(sourceMarkdown);
    const cacheKey = {
      wordPath: file.path,
      wordSignature,
      noteOutputMode: settings.noteOutputMode,
      semanticSettingsSignature: getSemanticSettingsSignature(settings),
      referenceDependencySignature: this.getReferenceDependencySignature(file)
    };
    const cachedFinalNoteHtml = this.renderCache.get(cacheKey);
    if (cachedFinalNoteHtml !== null) {
      return { finalNoteHtml: cachedFinalNoteHtml };
    }
    const normalizedMarkdown = normalizeEudicBlockKindsFromBody(sourceMarkdown, settings.semanticBlockKindPresets);
    const syncBodyMarkdown = prepareSyncBodyMarkdown(normalizedMarkdown.markdown);
    if (!syncBodyMarkdown) {
      throw new Error(EMPTY_WORD_BODY_SYNC_ERROR);
    }
    const renderedHtml = await this.renderer.renderMarkdown(
      syncBodyMarkdown,
      file.path,
      (sourcePath, embeddedFromPath) => this.getSemanticBlockTransformOptionsForSourcePath(sourcePath, embeddedFromPath, file, context.word, wordLinkId)
    );
    const linkResolver = {
      app: this.options.app,
      pathScope: this.options.pathScope,
      sourcePath: file.path
    };
    const finalNoteBodyHtml = buildFinalNoteHtml(renderedHtml, settings.noteOutputMode, linkResolver);
    if (!finalNoteBodyHtml.trim()) {
      throw new Error(EMPTY_WORD_BODY_SYNC_ERROR);
    }
    const finalNoteHtml = buildFinalWordNoteHtml(
      renderedHtml,
      settings.noteOutputMode,
      context.word,
      buildEudicProtocolUrl(this.options.app, "word", wordLinkId, context.word),
      linkResolver
    );
    this.renderCache.set(cacheKey, finalNoteHtml);
    return { finalNoteHtml };
  }
  async isWordContentSynced(file) {
    const context = this.getWordContext(file);
    if (!context?.lang) {
      return false;
    }
    const frontmatter = getFrontmatter(this.options.app, file);
    const wordLinkId = readEudicLinkId(frontmatter);
    if (!wordLinkId) {
      return false;
    }
    const { finalNoteHtml } = await this.renderFinalWordNoteHtml(
      file,
      context,
      wordLinkId,
      this.options.getSettings()
    );
    const currentHash = await sha256Hex(finalNoteHtml);
    if (context.lastSyncedHash !== currentHash) {
      return false;
    }
    const storedAliasHash = readNullableString(frontmatter[FRONTMATTER_KEYS.lastSyncedAliasesHash]);
    const aliasHash = await this.aliasSyncService.getCurrentAliasHash(file, context.lang, wordLinkId);
    return !aliasHash.error && aliasHash.hash === storedAliasHash;
  }
  async writeDirtyStateAfterMainConfirmation(file, hash, error) {
    await this.options.writeSyncFrontmatter(file, {
      syncStatus: "dirty",
      syncedAt: nowIsoString(),
      lastSyncedHash: hash,
      lastError: error
    });
  }
  async writeSyncedState(file, hash, aliasesHash) {
    await this.options.writeSyncFrontmatter(file, {
      syncStatus: "synced",
      syncedAt: nowIsoString(),
      lastSyncedHash: hash,
      lastSyncedAliasesHash: aliasesHash,
      lastError: null
    });
    return "synced";
  }
  async invalidateMainWordAfterDelete(file) {
    await this.options.writeSyncFrontmatter(file, {
      syncStatus: "dirty",
      lastSyncedHash: null,
      syncedAt: null,
      lastError: null
    });
  }
  async invalidateAliasOwnerAfterDelete(file) {
    await this.options.writeSyncFrontmatter(file, {
      syncStatus: "dirty",
      lastSyncedAliasesHash: null,
      lastError: null
    });
  }
  findMatchingMainWordFiles(word, language) {
    const targetWordKey = normalizeWordKey3(word);
    const targetLanguageKey = normalizeLanguageKey(language);
    const matches = [];
    for (const file of this.options.managedFiles.getWordFiles()) {
      const context = this.getWordContext(file);
      if (!context?.lang) {
        continue;
      }
      if (normalizeLanguageKey(context.lang) !== targetLanguageKey) {
        continue;
      }
      if (normalizeWordKey3(context.word) !== targetWordKey) {
        continue;
      }
      matches.push(file);
    }
    return matches;
  }
  findMatchingAliasOwnerFiles(word, language, matchedMainFiles) {
    const targetWordKey = normalizeWordKey3(word);
    const targetLanguageKey = normalizeLanguageKey(language);
    const matchedMainPaths = new Set(matchedMainFiles.map((file) => file.path));
    const matches = [];
    for (const file of this.options.managedFiles.getWordFiles()) {
      if (matchedMainPaths.has(file.path)) {
        continue;
      }
      const context = this.getWordContext(file);
      if (!context?.lang) {
        continue;
      }
      if (normalizeLanguageKey(context.lang) !== targetLanguageKey) {
        continue;
      }
      const frontmatter = getFrontmatter(this.options.app, file);
      const mainWord = getConfiguredWord(frontmatter, file);
      if (normalizeWordKey3(mainWord) === targetWordKey) {
        continue;
      }
      const aliases = getNormalizedAliases(frontmatter, file);
      if (!aliases.some((alias) => normalizeWordKey3(alias) === targetWordKey)) {
        continue;
      }
      matches.push(file);
    }
    return matches;
  }
};

// src/sync-notice-text.ts
function getAliasNoticeSummary(aliasCount, aliasUploaded, aliasSkipped) {
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
function getSyncWordNoticeText(result) {
  if (result.error) {
    return `${PLUGIN_NAME}: failed to sync "${result.word}": ${result.error ?? "Unknown error."}`;
  }
  const aliasSummary = getAliasNoticeSummary(result.aliasCount, result.aliasUploaded, result.aliasSkipped);
  if (result.skipped) {
    return `${PLUGIN_NAME}: "${result.word}" is already up to date.${aliasSummary}`;
  }
  return `${PLUGIN_NAME}: synced "${result.word}".${aliasSummary}`;
}
function getResyncAliasesNoticeText(result) {
  if (result.error) {
    return `${PLUGIN_NAME}: failed to resync aliases for "${result.word}": ${result.error}`;
  }
  if (result.noAliases) {
    return `${PLUGIN_NAME}: "${result.word}" has no aliases to sync.`;
  }
  return `${PLUGIN_NAME}: resynced ${result.aliasUploaded} alias(es) for "${result.word}".`;
}
function getDeleteNoteNoticeText(result) {
  const parts = [`${PLUGIN_NAME}: deleted the Eudic note for "${result.word}" (${result.language}).`];
  if (result.matchedMainFiles.length > 0) {
    parts.push(`Marked ${result.matchedMainFiles.length} local main word(s) dirty.`);
  }
  if (result.matchedAliasOwnerFiles.length > 0) {
    parts.push(`Marked ${result.matchedAliasOwnerFiles.length} alias owner word(s) dirty.`);
  }
  return parts.join(" ");
}
function getStudylistRefreshNoticeText(result) {
  return `${PLUGIN_NAME}: refreshed ${result.categories} Eudic studylist(s), scanned ${result.words} cloud word assignment(s), updated ${result.updatedWords} local word(s).`;
}
function getStudylistPushNoticeText(result) {
  return `${PLUGIN_NAME}: pushed ${result.succeeded}/${result.total} studylist assignment(s), added ${result.added}, removed ${result.removed}, failed ${result.failed}.`;
}

// src/sync-orchestrator.ts
var import_obsidian13 = require("obsidian");
var SyncOrchestrator = class {
  constructor(options) {
    this.options = options;
    this.inFlightSyncPaths = /* @__PURE__ */ new Set();
  }
  isSyncInFlight(file) {
    return this.inFlightSyncPaths.has((0, import_obsidian13.normalizePath)(file.path));
  }
  beginSync(file) {
    const normalizedPath = (0, import_obsidian13.normalizePath)(file.path);
    if (this.inFlightSyncPaths.has(normalizedPath)) {
      return false;
    }
    this.inFlightSyncPaths.add(normalizedPath);
    this.options.refreshUi();
    return true;
  }
  endSync(file) {
    this.inFlightSyncPaths.delete((0, import_obsidian13.normalizePath)(file.path));
    this.options.refreshUi();
  }
  async syncFile(file, options = {}) {
    if (!this.beginSync(file)) {
      if (!options.silentIfAlreadySyncing) {
        new import_obsidian13.Notice(`${PLUGIN_NAME}: "${file.basename}" is already syncing.`);
      }
      return;
    }
    try {
      const initialContext = this.options.getDisplayWordContext(file);
      await this.options.saveActiveViewForFile(file);
      const result = await this.options.syncService.syncWord(file, { force: options.force });
      const studylistResult = options.source === "manual" && !result.error ? await this.pushCurrentDirtyStudylistAssignmentAfterWordSync(file) : null;
      if (result.error) {
        const nextStudylistStatus = initialContext?.studylistStatus ?? "synced";
        this.options.setWordStatusOverride(
          file,
          getEffectiveWordStatus("dirty", nextStudylistStatus),
          result.error,
          "dirty",
          nextStudylistStatus
        );
      } else {
        const bodyStatus = result.status;
        const studylistStatus = studylistResult === null ? initialContext?.studylistStatus ?? "synced" : studylistResult.failed > 0 ? "dirty" : "synced";
        const studylistEntry = studylistResult?.results.find((entry) => entry.file.path === file.path);
        const studylistError = studylistResult === null ? this.options.studylistService.getCurrentWordStudylistLastError(file) : studylistEntry?.error ?? null;
        this.options.setWordStatusOverride(
          file,
          getEffectiveWordStatus(bodyStatus, studylistStatus),
          studylistError,
          bodyStatus,
          studylistStatus
        );
      }
      if (options.source === "auto" && result.uploaded && !result.error) {
        new import_obsidian13.Notice(`${PLUGIN_NAME}: auto-synced "${result.word}".`);
      } else if (options.source !== "auto") {
        const studylistSummary = studylistResult ? ` ${getStudylistPushNoticeText(studylistResult).replace(`${PLUGIN_NAME}: `, "")}` : "";
        new import_obsidian13.Notice(`${getSyncWordNoticeText(result)}${studylistSummary}`, 8e3);
      }
    } finally {
      this.endSync(file);
    }
  }
  async pushCurrentDirtyStudylistAssignmentAfterWordSync(file) {
    const pushFile = this.options.studylistService.getCurrentDirtyWordForPush(file);
    if (!pushFile) {
      return null;
    }
    const result = await this.options.studylistService.pushAssignments([pushFile]);
    return result.total > 0 ? result : null;
  }
};

// src/ui-controller.ts
var import_obsidian14 = require("obsidian");
var EudicSyncUiController = class {
  constructor(options) {
    this.options = options;
    this.headerActions = /* @__PURE__ */ new WeakMap();
    this.headerActionFilePaths = /* @__PURE__ */ new WeakMap();
    this.statusBarEl = null;
  }
  initialize(statusBarEl) {
    this.statusBarEl = statusBarEl;
    this.statusBarEl.addClass("eudic-sync-status-bar");
  }
  refresh() {
    this.refreshStatusBar();
    this.refreshHeaderActions();
  }
  clearHeaderActions() {
    const markdownLeaves = this.options.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (view instanceof import_obsidian14.MarkdownView) {
        this.removeHeaderAction(view);
      }
    }
  }
  refreshStatusBar() {
    if (!this.statusBarEl) {
      return;
    }
    this.statusBarEl.empty();
    this.statusBarEl.removeClass("is-hidden");
    delete this.statusBarEl.dataset.status;
    this.statusBarEl.onclick = null;
    if (!this.options.getSettings().enableStatusBarSyncButton) {
      this.statusBarEl.addClass("is-hidden");
      return;
    }
    const file = this.options.getActiveMarkdownFile();
    if (!file) {
      this.statusBarEl.addClass("is-hidden");
      return;
    }
    const context = this.options.getDisplayWordContext(file);
    if (!context) {
      this.statusBarEl.addClass("is-hidden");
      return;
    }
    const isSyncing = this.options.isSyncInFlight(file);
    this.statusBarEl.dataset.status = context.effectiveStatus;
    if (!isSyncing) {
      this.statusBarEl.onclick = () => {
        void this.options.syncCurrentWord();
      };
    }
    const statusLabel = `Eudic: ${context.effectiveStatus}`;
    const titleParts = [
      `${PLUGIN_NAME}: ${context.word} is ${context.effectiveStatus}.`,
      `Body: ${context.bodyStatus}.`,
      `Studylist: ${context.studylistStatus}.`
    ];
    if (isSyncing) {
      titleParts.push("Syncing...");
    } else {
      titleParts.push("Click to sync the current word.");
    }
    if (context.lastError) {
      titleParts.push(`Last error: ${context.lastError}`);
    }
    this.statusBarEl.setAttribute("aria-label", titleParts.join(" "));
    const iconEl = this.statusBarEl.createSpan({ cls: "eudic-sync-status-bar-icon" });
    (0, import_obsidian14.setIcon)(iconEl, getStatusIcon(context.effectiveStatus));
    this.statusBarEl.createSpan({ text: statusLabel });
  }
  refreshHeaderActions() {
    if (!this.options.getSettings().enableHeaderSyncButton) {
      this.clearHeaderActions();
      return;
    }
    const activeView = this.options.app.workspace.getActiveViewOfType(import_obsidian14.MarkdownView);
    const file = activeView?.file;
    if (!activeView || !file) {
      this.clearHeaderActions();
      return;
    }
    const context = this.options.getDisplayWordContext(file);
    if (!context) {
      this.clearHeaderActions();
      return;
    }
    this.removeInactiveHeaderActions(activeView);
    const isSyncing = this.options.isSyncInFlight(file);
    const titleParts = [
      `Eudic Sync: ${context.effectiveStatus}`,
      `Body: ${context.bodyStatus}`,
      `Studylist: ${context.studylistStatus}`
    ];
    if (isSyncing) {
      titleParts.push("Syncing...");
    }
    if (context.lastError) {
      titleParts.push(`Last error: ${context.lastError}`);
    }
    const title = titleParts.join(" | ");
    const icon = getStatusIcon(context.effectiveStatus);
    const existingAction = this.headerActions.get(activeView);
    const existingFilePath = this.headerActionFilePaths.get(activeView);
    if (existingAction && existingFilePath === file.path) {
      (0, import_obsidian14.setIcon)(existingAction, icon);
      existingAction.dataset.status = context.effectiveStatus;
      existingAction.setAttribute("aria-label", title);
      existingAction.setAttribute("title", title);
      return;
    }
    this.removeHeaderAction(activeView);
    const action = activeView.addAction(icon, title, () => {
      if (this.options.isSyncInFlight(file)) {
        new import_obsidian14.Notice(`${PLUGIN_NAME}: "${file.basename}" is already syncing.`);
        return;
      }
      void this.options.syncCurrentWord();
    });
    action.addClass("eudic-sync-header-action");
    action.dataset.status = context.effectiveStatus;
    this.headerActions.set(activeView, action);
    this.headerActionFilePaths.set(activeView, file.path);
  }
  removeInactiveHeaderActions(activeView) {
    const markdownLeaves = this.options.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (view instanceof import_obsidian14.MarkdownView && view !== activeView) {
        this.removeHeaderAction(view);
      }
    }
  }
  removeHeaderAction(view) {
    const existingAction = this.headerActions.get(view);
    if (!existingAction) {
      return;
    }
    existingAction.remove();
    this.headerActions.delete(view);
    this.headerActionFilePaths.delete(view);
  }
};

// src/vault-event-controller.ts
var import_obsidian15 = require("obsidian");
var EudicSyncVaultEventController = class {
  constructor(options) {
    this.options = options;
    this.vaultEventsRegistered = false;
    this.uiRefreshTimer = null;
    this.referenceUsageRefreshTimer = null;
    this.pendingReferenceUsagePaths = /* @__PURE__ */ new Set();
  }
  registerOnLayoutReady() {
    this.options.app.workspace.onLayoutReady(() => {
      if (this.options.isUnloaded()) {
        return;
      }
      this.registerVaultEvents();
      this.options.onLayoutReady();
      this.refreshUi();
    });
  }
  refreshUi() {
    if (this.options.isUnloaded() || this.uiRefreshTimer !== null) {
      return;
    }
    this.uiRefreshTimer = window.setTimeout(() => {
      this.uiRefreshTimer = null;
      if (!this.options.isUnloaded()) {
        this.options.flushUi();
      }
    }, 0);
  }
  scheduleReferenceUsageRefresh(referencePaths) {
    for (const referencePath of referencePaths) {
      const normalizedPath = (0, import_obsidian15.normalizePath)(referencePath);
      if (normalizedPath) {
        this.pendingReferenceUsagePaths.add(normalizedPath);
      }
    }
    if (this.options.isUnloaded() || this.referenceUsageRefreshTimer !== null || this.pendingReferenceUsagePaths.size === 0) {
      return;
    }
    this.referenceUsageRefreshTimer = window.setTimeout(() => {
      this.referenceUsageRefreshTimer = null;
      void this.flushReferenceUsageRefresh();
    }, 150);
  }
  clear() {
    if (this.uiRefreshTimer !== null) {
      window.clearTimeout(this.uiRefreshTimer);
      this.uiRefreshTimer = null;
    }
    if (this.referenceUsageRefreshTimer !== null) {
      window.clearTimeout(this.referenceUsageRefreshTimer);
      this.referenceUsageRefreshTimer = null;
    }
    this.pendingReferenceUsagePaths.clear();
  }
  registerVaultEvents() {
    if (this.vaultEventsRegistered) {
      return;
    }
    this.vaultEventsRegistered = true;
    this.options.plugin.registerEvent(
      this.options.app.vault.on("modify", (file) => {
        void this.options.onModify(file);
      })
    );
    this.options.plugin.registerEvent(
      this.options.app.workspace.on("editor-change", (editor, info) => {
        const file = info.file;
        if (!(file instanceof import_obsidian15.TFile) || file.extension !== "md") {
          return;
        }
        void this.options.onEditorChange(file, editor.getValue(), editor);
      })
    );
    this.options.plugin.registerEvent(
      this.options.app.vault.on("create", (file) => {
        void this.options.onCreate(file);
      })
    );
    this.options.plugin.registerEvent(
      this.options.app.vault.on("delete", (file) => {
        void this.options.onDelete(file);
      })
    );
    this.options.plugin.registerEvent(
      this.options.app.vault.on("rename", (file, oldPath) => {
        void this.options.onRename(file, oldPath);
      })
    );
    this.options.plugin.registerEvent(
      this.options.app.metadataCache.on("changed", (file) => {
        this.options.onMetadataChanged(file);
      })
    );
  }
  async flushReferenceUsageRefresh() {
    if (this.options.isUnloaded() || this.pendingReferenceUsagePaths.size === 0) {
      return;
    }
    const referencePaths = Array.from(this.pendingReferenceUsagePaths);
    this.pendingReferenceUsagePaths.clear();
    try {
      await this.options.refreshReferenceUsage(referencePaths);
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to refresh Reference usage`, error);
      new import_obsidian15.Notice(`${PLUGIN_NAME}: failed to refresh Reference usage: ${this.options.toErrorMessage(error)}`, 8e3);
    } finally {
      this.refreshUi();
    }
  }
};

// src/word-dirty-signature-state.ts
function resolveWordDirtySignatureDecision(state) {
  if (state.cleanSignature !== void 0) {
    return state.nextSignature === state.cleanSignature ? "clean" : "dirty";
  }
  if (state.previousSignature === void 0) {
    return "dirty";
  }
  return state.nextSignature === state.previousSignature ? "unchanged" : "dirty";
}

// src/eudic-url.ts
var EUDIC_DICT_BASE_URL = "https://dict.eudic.net/dicts";
function buildEudicQueryUrl(word, lang) {
  const normalizedLang = lang?.trim() || "en";
  return `${EUDIC_DICT_BASE_URL}/${encodeURIComponent(normalizedLang)}/${encodeURIComponent(word)}`;
}
function getExpectedEudicUrl(frontmatter, file) {
  const word = getConfiguredWord(frontmatter, file);
  const lang = readNullableString(frontmatter[FRONTMATTER_KEYS.lang]) ?? "en";
  return buildEudicQueryUrl(word, lang);
}

// src/word-frontmatter.ts
function hasYamlFrontmatter(markdown) {
  return /^---\s*\n[\s\S]*?\n---(?:\s*\n|$)/.test(markdown);
}
function writeDefaultWordFrontmatter(frontmatter, file) {
  frontmatter[FRONTMATTER_KEYS.syncEudicEnabled] = true;
  frontmatter[FRONTMATTER_KEYS.lang] = "en";
  frontmatter[FRONTMATTER_KEYS.aliases] = [];
  frontmatter[FRONTMATTER_KEYS.eudicLinkId] = createEudicLinkId("word");
  frontmatter[FRONTMATTER_KEYS.eudicUrl] = buildEudicQueryUrl(file.basename, "en");
  frontmatter[FRONTMATTER_KEYS.syncStatus] = "dirty";
  frontmatter[FRONTMATTER_KEYS.studylistIds] = [];
  frontmatter[FRONTMATTER_KEYS.studylistNames] = [];
  frontmatter[FRONTMATTER_KEYS.studylistSyncStatus] = "synced";
}
function readSyncEudicEnabled(frontmatter) {
  const value = frontmatter[FRONTMATTER_KEYS.syncEudicEnabled];
  return typeof value === "boolean" ? value : null;
}
function getDefaultSyncEudicEnabled(frontmatter) {
  return frontmatter[FRONTMATTER_KEYS.eudicSync] === false ? false : true;
}
async function ensureManagedWordProperties(options) {
  const { app, file, writeFrontmatter } = options;
  const markdown = await app.vault.cachedRead(file);
  if (!hasYamlFrontmatter(markdown)) {
    await writeFrontmatter(file, (frontmatter2) => {
      writeDefaultWordFrontmatter(frontmatter2, file);
    });
    return {
      skipped: false,
      changed: true,
      markdown: await app.vault.cachedRead(file)
    };
  }
  const frontmatter = getFrontmatter(app, file);
  const syncEudicEnabled = readSyncEudicEnabled(frontmatter);
  const defaultSyncEudicEnabled = getDefaultSyncEudicEnabled(frontmatter);
  const shouldAddSyncEudicEnabled = syncEudicEnabled === null;
  const nextSyncEudicEnabled = syncEudicEnabled ?? defaultSyncEudicEnabled;
  const isDisabled = isWordSyncDisabledFrontmatter({
    ...frontmatter,
    [FRONTMATTER_KEYS.syncEudicEnabled]: nextSyncEudicEnabled
  });
  const normalizedAliases = getNormalizedAliases(frontmatter, file);
  const shouldUpdateAliases = aliasesNeedRewrite(frontmatter, file);
  const shouldAddEudicLinkId = readEudicLinkId(frontmatter) === null;
  const shouldAddLang = readNullableString(frontmatter[FRONTMATTER_KEYS.lang]) === null;
  const expectedEudicUrl = getExpectedEudicUrl(frontmatter, file);
  const shouldUpdateEudicUrl = readNullableString(frontmatter[FRONTMATTER_KEYS.eudicUrl]) !== expectedEudicUrl;
  const shouldAddSyncStatus = readNullableString(frontmatter[FRONTMATTER_KEYS.syncStatus]) === null;
  const shouldNormalizeStudylistStatus = !isStudylistSyncStatusNormalized(frontmatter);
  const shouldAddStudylistIds = !Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistIds]);
  const shouldAddStudylistNames = !Array.isArray(frontmatter[FRONTMATTER_KEYS.studylistNames]);
  const shouldAddSyncableFields = !isDisabled;
  if (!shouldAddSyncEudicEnabled && !shouldUpdateAliases && !shouldAddEudicLinkId && !shouldUpdateEudicUrl && !shouldNormalizeStudylistStatus && !shouldAddStudylistIds && !shouldAddStudylistNames && (!shouldAddSyncableFields || !shouldAddLang && !shouldAddSyncStatus)) {
    return {
      skipped: isDisabled,
      changed: false,
      markdown
    };
  }
  await writeFrontmatter(file, (nextFrontmatter) => {
    if (shouldAddSyncEudicEnabled) {
      nextFrontmatter[FRONTMATTER_KEYS.syncEudicEnabled] = defaultSyncEudicEnabled;
    }
    if (shouldUpdateAliases) {
      nextFrontmatter[FRONTMATTER_KEYS.aliases] = normalizedAliases;
    }
    if (shouldAddEudicLinkId) {
      nextFrontmatter[FRONTMATTER_KEYS.eudicLinkId] = createEudicLinkId("word");
    }
    if (shouldUpdateEudicUrl) {
      nextFrontmatter[FRONTMATTER_KEYS.eudicUrl] = expectedEudicUrl;
    }
    if (shouldNormalizeStudylistStatus) {
      normalizeStudylistSyncStatus(nextFrontmatter);
    }
    if (shouldAddStudylistIds) {
      nextFrontmatter[FRONTMATTER_KEYS.studylistIds] = [];
    }
    if (shouldAddStudylistNames) {
      nextFrontmatter[FRONTMATTER_KEYS.studylistNames] = [];
    }
    if (shouldAddSyncableFields && shouldAddLang) {
      nextFrontmatter[FRONTMATTER_KEYS.lang] = "en";
    }
    if (shouldAddSyncableFields && shouldAddSyncStatus) {
      nextFrontmatter[FRONTMATTER_KEYS.syncStatus] = "dirty";
    }
  });
  return {
    skipped: isDisabled,
    changed: true,
    markdown: await app.vault.cachedRead(file)
  };
}

// src/main.ts
var AUTO_SYNC_AFTER_LEAVE_DELAY_MS = 2e3;
var EDITOR_CHANGE_DEBOUNCE_MS = 150;
function isMarkdownFile3(file) {
  return file instanceof import_obsidian16.TFile && file.extension === "md";
}
function toErrorMessage7(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
function hasYamlFrontmatter2(markdown) {
  return /^---\s*\n[\s\S]*?\n---(?:\s*\n|$)/.test(markdown);
}
function prependReferenceFrontmatter(markdown, linkId) {
  const body = markdown.replace(/^\uFEFF/, "");
  const frontmatterBlock = [
    "---",
    `${FRONTMATTER_KEYS.eudicLinkId}: ${linkId}`,
    "---"
  ].join("\n");
  if (body.trim().length === 0) {
    return `${frontmatterBlock}
`;
  }
  return `${frontmatterBlock}

${body}`;
}
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Clipboard copy failed.");
    }
  } finally {
    textarea.remove();
  }
}
var EudicSyncPlugin = class extends import_obsidian16.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.pathScope = new PathScope(DEFAULT_SETTINGS);
    this.managedFiles = new ManagedFileRegistry(this.app, this.pathScope);
    this.perf = new PerformanceMonitor();
    this.referenceIndex = new ReferenceGraphService({
      app: this.app,
      pathScope: this.pathScope,
      managedFiles: this.managedFiles,
      writeFrontmatter: async (file, mutate) => {
        await this.writeFrontmatter(file, mutate);
      },
      getReferenceMetadataWriteMode: () => this.settings.referenceMetadataWriteMode
    });
    this.startupCoordinator = new StartupCoordinator({
      isUnloaded: () => this.isUnloaded,
      measure: (label, callback) => this.perf.measure(label, callback),
      onError: (label, error) => this.handleStartupTaskError(label, error),
      afterTask: () => this.refreshUi()
    });
    this.semanticBlockAutomation = new SemanticBlockAutomationResolver({
      app: this.app,
      pathScope: this.pathScope,
      managedFiles: this.managedFiles,
      referenceIndex: this.referenceIndex,
      getSettings: () => this.settings
    });
    this.suppressedWrites = /* @__PURE__ */ new Map();
    this.inFlightDeletePaths = /* @__PURE__ */ new Set();
    this.typedDeleteInFlight = false;
    this.leaveAutoSyncTimers = /* @__PURE__ */ new Map();
    this.wordStatusOverrides = new WordStatusOverrideStore();
    this.wordSyncSignatures = /* @__PURE__ */ new Map();
    this.wordCleanSyncSignatures = /* @__PURE__ */ new Map();
    this.pendingOpenWordStatusWrites = /* @__PURE__ */ new Map();
    this.flushingOpenWordStatusWritePaths = /* @__PURE__ */ new Set();
    this.editorChangeTimers = /* @__PURE__ */ new Map();
    this.autoBodyDirtyPaths = /* @__PURE__ */ new Set();
    this.restorableEditorBodyDirtyPaths = /* @__PURE__ */ new Set();
    this.nonRestorableBodyDirtyPaths = /* @__PURE__ */ new Set();
    this.syncingEditorWordStatusPatchSignatures = /* @__PURE__ */ new Map();
    this.startupKnownPaths = /* @__PURE__ */ new Set();
    this.startupNotices = [];
    this.lastActiveWordPath = null;
    this.startupKnownPathClearTimer = null;
    this.isUnloaded = false;
  }
  async onload() {
    this.isUnloaded = false;
    await this.loadSettings();
    this.managedFiles.rebuild();
    this.captureStartupKnownPaths();
    this.referenceNoteService = new ReferenceNoteService(this.app, this.pathScope);
    this.syncService = new SyncService({
      app: this.app,
      pathScope: this.pathScope,
      managedFiles: this.managedFiles,
      getSettings: () => this.settings,
      referenceIndex: this.referenceIndex,
      ensureWordLinkId: async (file) => this.ensureWordManagedFrontmatterForSync(file),
      writeSyncFrontmatter: async (file, data) => {
        await this.writeWordSyncFrontmatter(file, data);
      }
    });
    this.studylistService = new StudylistService({
      app: this.app,
      pathScope: this.pathScope,
      managedFiles: this.managedFiles,
      getAuthorizationToken: () => this.settings.authorizationToken,
      getStudylistCache: () => this.settings.studylistCache,
      setStudylistCache: async (cache) => {
        await this.setStudylistCache(cache);
      },
      writeFrontmatter: async (file, mutate) => {
        await this.writeStudylistFrontmatter(file, mutate);
      }
    });
    this.syncOrchestrator = new SyncOrchestrator({
      syncService: this.syncService,
      studylistService: this.studylistService,
      saveActiveViewForFile: async (file) => this.saveActiveViewForFile(file),
      getDisplayWordContext: (file) => this.getDisplayWordContext(file),
      setWordStatusOverride: (file, status, lastError, bodyStatus, studylistStatus) => {
        this.setWordStatusOverride(file, status, lastError, bodyStatus, studylistStatus);
      },
      refreshUi: () => this.refreshUi()
    });
    this.saveHookController = new EudicSyncSaveHookController({
      app: this.app,
      getSettings: () => this.settings,
      canSyncFile: (file) => this.syncService.canSyncFile(file),
      canFormatBoldMarkers: (file) => this.canFormatBoldMarkers(file),
      getSemanticBlockKindPresets: () => this.getSemanticBlockKindPresets(),
      extractPendingReferences: (view) => this.referenceNoteService.extractPendingReferences(view),
      toErrorMessage: toErrorMessage7
    });
    this.uiController = new EudicSyncUiController({
      app: this.app,
      getSettings: () => this.settings,
      getActiveMarkdownFile: () => this.getActiveMarkdownFile(),
      getDisplayWordContext: (file) => this.getDisplayWordContext(file),
      isSyncInFlight: (file) => this.isSyncInFlight(file),
      syncCurrentWord: () => this.syncCurrentWord()
    });
    this.vaultEventController = new EudicSyncVaultEventController({
      app: this.app,
      plugin: this,
      isUnloaded: () => this.isUnloaded,
      onLayoutReady: () => {
        this.lastActiveWordPath = this.getActiveWordPath();
        this.scheduleStartupKnownPathClear();
        this.runStartupTasks();
      },
      onEditorChange: (file, markdown, editor) => this.handleEditorChange(file, markdown, editor),
      onModify: (file) => this.handleModify(file),
      onCreate: (file) => this.handleCreate(file),
      onDelete: (file) => this.handleDelete(file),
      onRename: (file, oldPath) => this.handleRename(file, oldPath),
      onMetadataChanged: (file) => this.handleMetadataCacheChanged(file),
      flushUi: () => this.flushUi(),
      refreshReferenceUsage: (referencePaths) => this.refreshReferenceUsage(referencePaths),
      toErrorMessage: toErrorMessage7
    });
    this.commandController = new EudicSyncCommandController({
      plugin: this,
      app: this.app,
      syncService: this.syncService,
      getDisplayWordContext: (file) => this.getDisplayWordContext(file),
      actions: {
        syncCurrentWord: () => this.syncCurrentWord(),
        syncAllDirtyWords: () => this.syncAllDirtyWords(),
        resyncAliasesForCurrentWord: () => this.resyncAliasesForCurrentWord(),
        deleteCurrentWordNoteInEudic: () => this.deleteCurrentWordNoteInEudic(),
        deleteTypedWordNoteInEudic: () => this.deleteTypedWordNoteInEudic(),
        rebuildReferenceIndexManually: () => this.rebuildReferenceIndexManually(),
        rebuildLegacyReferenceMetadata: () => this.rebuildLegacyReferenceMetadata(),
        repairCurrentReferenceMetadata: () => this.repairCurrentReferenceMetadata(),
        refreshEudicStudylists: () => this.refreshEudicStudylists(),
        pullStudylistAssignmentsFromEudic: () => this.pullStudylistAssignmentsFromEudic(),
        pullCurrentWordStudylistAssignmentFromEudic: () => this.pullCurrentWordStudylistAssignmentFromEudic(),
        pushAllDirtyStudylistAssignmentsToEudic: () => this.pushAllDirtyStudylistAssignmentsToEudic(),
        pushCurrentWordStudylistAssignmentToEudic: () => this.pushCurrentWordStudylistAssignmentToEudic(),
        rebuildLocalStudylistMetadata: () => this.rebuildLocalStudylistMetadata(),
        repairStudylistNamesIdsForAllWordNotes: () => this.repairStudylistNamesIdsForAllWordNotes(),
        copyManagedUrlForCurrentNote: () => this.copyManagedUrlForCurrentNote(),
        formatCurrentEudicNoteBoldMarkers: () => this.formatCurrentEudicNoteBoldMarkers(),
        formatAllEudicNoteBoldMarkers: () => this.formatAllEudicNoteBoldMarkers(),
        createReferenceFromSelection: () => this.createReferenceFromSelection(),
        createReferenceFromCurrentParagraph: () => this.createReferenceFromCurrentParagraph(),
        extractPendingReferencesInCurrentWord: () => this.extractPendingReferencesInCurrentWord(),
        extractCurrentEudicBlockToReference: () => this.extractCurrentEudicBlockToReference(),
        wrapSelectionAsEudicBlock: () => this.wrapSelectionAsEudicBlock(),
        insertEudicBlock: () => this.insertEudicBlock(),
        syncFile: (file, options) => this.syncFile(file, options)
      }
    });
    this.addSettingTab(new EudicSyncSettingTab(this.app, this));
    this.registerEditorExtension(createAutoBoldMarkersExtension({
      pathScope: this.pathScope,
      getSettings: () => this.settings
    }));
    this.registerMarkdownProcessors();
    this.uiController.initialize(this.addStatusBarItem());
    this.commandController.registerCommands();
    this.registerWorkspaceEvents();
    this.commandController.registerFileMenuAction();
    this.registerProtocolHandler();
    this.lastActiveWordPath = this.getActiveWordPath();
    this.refreshUi();
    this.registerVaultEventsOnLayoutReady();
    for (const message of this.startupNotices) {
      new import_obsidian16.Notice(message, 8e3);
    }
  }
  onunload() {
    this.isUnloaded = true;
    this.clearStartupKnownPathTimer();
    this.clearAutoSyncTimers();
    this.clearEditorChangeTimers();
    this.vaultEventController.clear();
    this.uiController.clearHeaderActions();
    this.saveHookController.restore();
  }
  async updateSettings(partial) {
    const previousSettings = this.settings;
    this.settings = Object.assign({}, this.settings, partial);
    this.pathScope.updateSettings(this.settings);
    this.managedFiles.rebuild();
    this.invalidateSemanticReferenceCaches();
    await this.saveData(this.settings);
    await this.rebuildReferenceIndex();
    await this.ensureAllWordManagedFrontmatter();
    await this.studylistService.ensureAllWordStudylistFrontmatter();
    this.studylistService.captureAllLocalSnapshots();
    if (previousSettings.enableAutoSyncWordOnLeave && !this.settings.enableAutoSyncWordOnLeave) {
      this.clearAutoSyncTimers();
    }
    if (previousSettings.noteOutputMode !== this.settings.noteOutputMode) {
      const markedCount = await this.markAllSyncWordsDirty();
      new import_obsidian16.Notice(
        `${PLUGIN_NAME}: note output mode changed to ${this.settings.noteOutputMode}. Marked ${markedCount} word(s) dirty.`
      );
    }
    this.refreshUi();
  }
  registerMarkdownProcessors() {
    this.registerMarkdownCodeBlockProcessor(EUDIC_BLOCK_LANGUAGE, async (source, el, ctx) => {
      const sectionText = ctx.getSectionInfo(el)?.text ?? "";
      const openingFence = findEudicBlockFenceForBody(sectionText, source);
      const embedContainer = el.closest(".markdown-embed, .internal-embed");
      if (!openingFence) {
        this.renderInvalidEudicBlockPreview(el, source);
        return;
      }
      el.empty();
      el.addClass("eudic-sync-block-preview");
      embedContainer?.classList.add("eudic-sync-block-embed");
      const child = new import_obsidian16.MarkdownRenderChild(el);
      ctx.addChild(child);
      const semanticOptions = await this.getSemanticBlockTransformOptionsForSourcePath(
        ctx.sourcePath,
        this.getActiveWordFileForSemanticPreview()
      );
      await import_obsidian16.MarkdownRenderer.render(
        this.app,
        renderEudicBlockToMarkdown(
          openingFence.kind,
          source,
          semanticOptions
        ),
        el,
        ctx.sourcePath,
        child
      );
    });
  }
  renderInvalidEudicBlockPreview(el, text) {
    el.empty();
    const pre = el.createEl("pre");
    pre.createEl("code", { text });
  }
  getActiveWordFileForSemanticPreview() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof import_obsidian16.TFile) || activeFile.extension !== "md" || !this.pathScope.isWordPath(activeFile.path)) {
      return null;
    }
    return activeFile;
  }
  getSemanticBlockTransformOptionsForSourcePath(sourcePath, currentWordFile = null, embeddedFromPath) {
    return this.semanticBlockAutomation.getTransformOptionsForSourcePath({
      sourcePath,
      embeddedFromPath,
      currentWordFile
    });
  }
  registerProtocolHandler() {
    this.registerObsidianProtocolHandler(EUDIC_PROTOCOL_ACTION, (params) => {
      void this.handleManagedObsidianProtocol(params);
    });
  }
  registerVaultEventsOnLayoutReady() {
    this.vaultEventController.registerOnLayoutReady();
  }
  runStartupTasks() {
    void this.startupCoordinator.run(this.getStartupTasks()).then(() => {
      if (this.isUnloaded) {
        return;
      }
      this.lastActiveWordPath = this.getActiveWordPath();
      this.refreshUi();
    });
  }
  getStartupTasks() {
    return [
      {
        label: "startup.ensureReferenceFrontmatter",
        run: () => this.ensureAllReferenceManagedFrontmatter()
      },
      {
        label: "startup.ensureWordFrontmatter",
        run: () => this.ensureAllWordManagedFrontmatter()
      },
      {
        label: "startup.ensureStudylistFrontmatter",
        run: () => this.studylistService.ensureAllWordStudylistFrontmatter()
      },
      {
        label: "startup.captureStudylistSnapshots",
        run: () => this.studylistService.captureAllLocalSnapshots()
      },
      {
        label: "startup.ensureNoteOutputFormatVersion",
        run: () => this.ensureCurrentNoteOutputFormatVersion()
      },
      {
        label: "startup.captureWordSyncSignatures",
        run: () => this.captureWordSyncSignatures()
      },
      {
        label: "startup.rebuildReferenceIndex",
        run: () => this.rebuildReferenceIndex()
      }
    ];
  }
  handleStartupTaskError(label, error) {
    console.error(`${PLUGIN_NAME}: startup task failed (${label})`, error);
    new import_obsidian16.Notice(`${PLUGIN_NAME}: startup task failed (${label}): ${toErrorMessage7(error)}`, 8e3);
  }
  captureStartupKnownPaths() {
    this.startupKnownPaths.clear();
    for (const file of [...this.managedFiles.getWordFiles(), ...this.managedFiles.getReferenceFiles()]) {
      this.startupKnownPaths.add((0, import_obsidian16.normalizePath)(file.path));
    }
  }
  scheduleStartupKnownPathClear() {
    this.clearStartupKnownPathTimer();
    this.startupKnownPathClearTimer = window.setTimeout(() => {
      this.startupKnownPathClearTimer = null;
      this.startupKnownPaths.clear();
    }, 5e3);
  }
  clearStartupKnownPathTimer() {
    if (this.startupKnownPathClearTimer === null) {
      return;
    }
    window.clearTimeout(this.startupKnownPathClearTimer);
    this.startupKnownPathClearTimer = null;
  }
  async rebuildReferenceIndex() {
    try {
      this.invalidateSemanticReferenceCaches();
      await this.perf.measure("reference.rebuildAll", () => this.referenceIndex.rebuildAll());
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to rebuild reference index`, error);
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to rebuild Reference index: ${toErrorMessage7(error)}`, 8e3);
    }
  }
  async rebuildReferenceIndexManually() {
    try {
      this.invalidateSemanticReferenceCaches();
      await this.perf.measure("reference.rebuildAll.manual", () => this.referenceIndex.rebuildAll());
      new import_obsidian16.Notice(`${PLUGIN_NAME}: rebuilt Reference graph.`);
      this.refreshUi();
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to rebuild reference index`, error);
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to rebuild Reference index: ${toErrorMessage7(error)}`, 8e3);
    }
  }
  async rebuildLegacyReferenceMetadata() {
    try {
      this.invalidateSemanticReferenceCaches();
      new import_obsidian16.Notice(`${PLUGIN_NAME}: repairing All Reference metadata...`);
      const result = await this.perf.measure(
        "reference.repairMetadata.manual",
        () => this.referenceIndex.repairAllReferenceMetadata({ write: true })
      );
      await this.markWordsDirtyByPaths(result.affectedWordPaths);
      new import_obsidian16.Notice(
        `${PLUGIN_NAME}: repaired All Reference metadata (${result.scannedWordCount} word note(s) scanned, ${result.wordMetadataUpdated} word note(s), ${result.referenceMetadataUpdated} reference note(s) updated).`
      );
      this.refreshUi();
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to repair reference metadata`, error);
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to repair Reference metadata: ${toErrorMessage7(error)}`, 8e3);
    }
  }
  async repairCurrentReferenceMetadata() {
    const file = this.getActiveMarkdownFile();
    if (!file || !this.pathScope.isReferencePath(file.path)) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: open a reference note in the configured References folder first.`);
      return;
    }
    try {
      this.invalidateSemanticReferenceCaches([file.path]);
      new import_obsidian16.Notice(`${PLUGIN_NAME}: repairing Reference metadata for "${file.basename}"...`);
      await this.ensureReferenceManagedFrontmatter(file);
      const result = await this.perf.measure(
        "reference.repairMetadata.current",
        () => this.referenceIndex.repairReferenceMetadataForReference(file.path, {
          write: true,
          forceFreshScan: true
        })
      );
      await this.markWordsDirtyByPaths(result.affectedWordPaths);
      new import_obsidian16.Notice(
        `${PLUGIN_NAME}: repaired "${file.basename}" (${result.scannedWordCount} word note(s) scanned, ${result.wordPaths.length} referring word note(s), ${result.referenceMetadataUpdated} reference note updated).`
      );
      this.refreshUi();
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to repair current reference metadata`, error);
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to repair current Reference metadata: ${toErrorMessage7(error)}`, 8e3);
    }
  }
  registerWorkspaceEvents() {
    const handleActiveContextChange = () => {
      this.handleActiveWordChanged();
      this.refreshUi();
    };
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", handleActiveContextChange)
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", handleActiveContextChange)
    );
    this.registerEvent(
      this.app.workspace.on("file-open", handleActiveContextChange)
    );
  }
  async loadSettings() {
    const loadResult = migrateLoadedSettings(await this.loadData());
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadResult.settings);
    this.startupNotices.push(...loadResult.notices);
    this.pathScope.updateSettings(this.settings);
    if (loadResult.changed) {
      await this.saveData(this.settings);
    }
  }
  async setStudylistCache(cache) {
    this.settings = Object.assign({}, this.settings, { studylistCache: cache });
    await this.saveData(this.settings);
  }
  async ensureCurrentNoteOutputFormatVersion() {
    if (this.settings.noteOutputFormatVersion >= NOTE_OUTPUT_FORMAT_VERSION) {
      return;
    }
    const markedCount = await this.markAllSyncWordsDirty();
    this.settings = Object.assign({}, this.settings, {
      noteOutputFormatVersion: NOTE_OUTPUT_FORMAT_VERSION
    });
    await this.saveData(this.settings);
    this.startupNotices.push(
      `${PLUGIN_NAME}: final note output format upgraded to v${NOTE_OUTPUT_FORMAT_VERSION}. Marked ${markedCount} word(s) dirty.`
    );
  }
  async captureWordSyncSignatures() {
    this.wordSyncSignatures.clear();
    this.wordCleanSyncSignatures.clear();
    for (const file of this.managedFiles.getWordFiles()) {
      const markdown = await this.app.vault.cachedRead(file);
      const signature = getWordSyncSignature(markdown);
      const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
      this.wordSyncSignatures.set(normalizedPath, signature);
      if (this.syncService.getWordContext(file)?.bodyStatus === "synced") {
        this.wordCleanSyncSignatures.set(normalizedPath, signature);
      }
    }
  }
  async captureWordCleanSignatureIfSynced(file) {
    if (!this.pathScope.isWordPath(file.path)) {
      return;
    }
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    const context = this.getDisplayWordContext(file);
    if (context?.bodyStatus !== "synced") {
      return;
    }
    const view = this.getOpenMarkdownViewForFile(file);
    const markdown = view?.editor.getValue() ?? await this.app.vault.cachedRead(file);
    const signature = getWordSyncSignature(markdown);
    this.wordSyncSignatures.set(normalizedPath, signature);
    this.wordCleanSyncSignatures.set(normalizedPath, signature);
    this.clearPendingOpenWordBodyWrite(normalizedPath);
    this.autoBodyDirtyPaths.delete(normalizedPath);
    this.restorableEditorBodyDirtyPaths.delete(normalizedPath);
    this.nonRestorableBodyDirtyPaths.delete(normalizedPath);
  }
  recordWordBodySyncedFromMarkdown(file, markdown) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    const signature = getWordSyncSignature(markdown);
    this.wordSyncSignatures.set(normalizedPath, signature);
    this.wordCleanSyncSignatures.set(normalizedPath, signature);
    this.clearPendingOpenWordBodyWrite(normalizedPath);
    this.autoBodyDirtyPaths.delete(normalizedPath);
    this.restorableEditorBodyDirtyPaths.delete(normalizedPath);
    this.nonRestorableBodyDirtyPaths.delete(normalizedPath);
    this.setWordBodyStatusOverride(file, "synced", null);
  }
  handleEditorChange(file, _markdown, editor) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    const existingTimer = this.editorChangeTimers.get(normalizedPath);
    if (existingTimer !== void 0) {
      window.clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
      this.editorChangeTimers.delete(normalizedPath);
      void this.perf.measure("event.editorChange", () => this.handleEditorChangeInternal(file, editor.getValue(), editor));
    }, EDITOR_CHANGE_DEBOUNCE_MS);
    this.editorChangeTimers.set(normalizedPath, timer);
  }
  async handleEditorChangeInternal(file, markdown, editor) {
    if (file.extension !== "md") {
      return;
    }
    if (this.pathScope.isWordPath(file.path)) {
      await this.handleWordEditorChange(file, markdown, editor);
      return;
    }
    if (this.pathScope.isReferencePath(file.path)) {
      await this.handleReferenceEditorChange(file);
    }
  }
  async handleWordEditorChange(file, markdown, editor) {
    if (!this.syncService.canSyncFile(file)) {
      return;
    }
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    const nextSignature = getWordSyncSignature(markdown);
    const expectedSyncPatchSignature = this.syncingEditorWordStatusPatchSignatures.get(normalizedPath);
    if (expectedSyncPatchSignature) {
      if (expectedSyncPatchSignature === nextSignature) {
        this.syncingEditorWordStatusPatchSignatures.delete(normalizedPath);
        this.wordSyncSignatures.set(normalizedPath, nextSignature);
        if (this.getDisplayWordContext(file)?.bodyStatus === "synced") {
          this.wordCleanSyncSignatures.set(normalizedPath, nextSignature);
        }
        this.refreshUi();
        return;
      }
      this.syncingEditorWordStatusPatchSignatures.delete(normalizedPath);
    }
    const decision = this.getWordDirtySignatureDecision(normalizedPath, nextSignature);
    if (decision === "clean") {
      this.clearAutoWordBodyDirty(file, editor);
    } else if (decision === "dirty") {
      this.markOpenEditorWordBodyDirty(file, editor, null, { restorable: true });
    }
  }
  async handleReferenceEditorChange(file) {
    for (const wordPath of this.referenceIndex.findWordsReferencing(file.path)) {
      const wordFile = this.managedFiles.getFile(wordPath) ?? this.app.vault.getFileByPath(wordPath);
      if (!wordFile || !this.syncService.canSyncFile(wordFile)) {
        continue;
      }
      await this.markWordDirtyWithAutomaticDeferral(wordFile);
    }
  }
  setWordBodyDirtyFast(file, lastError) {
    const context = this.getDisplayWordContext(file);
    if (!context) {
      return;
    }
    if (context.bodyStatus === "dirty" && context.lastError === lastError) {
      return;
    }
    this.setWordBodyStatusOverride(file, "dirty", lastError);
  }
  async handleManagedObsidianProtocol(params) {
    this.managedFiles.rebuild();
    const resolved = resolveManagedFileFromProtocol(
      this.app,
      this.pathScope,
      params,
      (kind) => kind === "word" ? this.managedFiles.getWordFiles() : this.managedFiles.getReferenceFiles()
    );
    if (resolved.error || !resolved.file) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: ${resolved.error ?? "Failed to resolve the managed Obsidian link."}`);
      return;
    }
    const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);
    await leaf.openFile(resolved.file);
  }
  async handleModify(file) {
    await this.perf.measure("event.modify", () => this.handleModifyInternal(file));
  }
  async handleModifyInternal(file) {
    if (!isMarkdownFile3(file)) {
      return;
    }
    this.managedFiles.update(file);
    if (this.consumeSuppressedWrite(file.path)) {
      this.refreshUi();
      return;
    }
    if (this.pathScope.isWordPath(file.path)) {
      const markdown = await this.app.vault.cachedRead(file);
      const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
      const isOpenWord = this.isMarkdownFileOpen(file);
      const nextWordSyncSignature = getWordSyncSignature(markdown);
      await this.studylistService.handleWordModify(file, markdown);
      const result = await this.referenceIndex.updateWord(file, markdown);
      this.scheduleReferenceUsageRefresh(result.affectedReferencePaths);
      if (result.disabled) {
        this.clearPendingOpenWordStatusWrite(file.path);
        this.clearWordStatusOverride(file.path);
        this.cancelAutoSyncTimer(file.path);
        this.refreshUi();
        return;
      }
      const dirtyDecision = this.getWordDirtySignatureDecision(normalizedPath, nextWordSyncSignature);
      if (isOpenWord) {
        this.updateOpenWordBodyDirtyState(file, dirtyDecision);
        this.wordSyncSignatures.set(normalizedPath, nextWordSyncSignature);
        this.refreshUi();
        return;
      }
      if (dirtyDecision === "clean") {
        this.clearAutoWordBodyDirty(file);
      } else if (dirtyDecision === "dirty" || this.hasPendingOpenWordBodyWrite(normalizedPath)) {
        await this.markWordDirtyWithAutomaticDeferral(file);
      }
      this.wordSyncSignatures.set(normalizedPath, nextWordSyncSignature);
      this.refreshUi();
      return;
    }
    if (this.pathScope.isReferencePath(file.path)) {
      const isOpenReference = this.isMarkdownFileOpen(file);
      if (!isOpenReference) {
        await this.ensureReferenceManagedFrontmatter(file);
      }
      const lookup = await this.referenceIndex.findWordsReferencingWithFallback(file.path, { forceScan: true });
      await this.markWordsDirtyByPaths(lookup.wordPaths);
      this.invalidateSemanticReferenceCaches(lookup.affectedReferencePaths);
      this.refreshUi();
    }
  }
  handleMetadataCacheChanged(file) {
    if (file.extension !== "md") {
      return;
    }
    if (this.pathScope.isWordPath(file.path)) {
      this.releaseWordStatusOverridesIfMetadataCaughtUp(file);
      this.refreshUi();
      return;
    }
    if (this.pathScope.isReferencePath(file.path)) {
      this.refreshUi();
    }
  }
  async handleCreate(file) {
    await this.perf.measure("event.create", () => this.handleCreateInternal(file));
  }
  async handleCreateInternal(file) {
    if (!isMarkdownFile3(file)) {
      return;
    }
    this.managedFiles.update(file);
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    if (this.startupKnownPaths.delete(normalizedPath)) {
      this.refreshUi();
      return;
    }
    if (this.pathScope.isWordPath(file.path)) {
      const ensured = await this.ensureManagedWordProperties(file);
      if (ensured.skipped) {
        const affectedReferencePaths = this.referenceIndex.removeWord(file.path);
        this.scheduleReferenceUsageRefresh(affectedReferencePaths);
        this.refreshUi();
        return;
      }
      const result = await this.referenceIndex.updateWord(file, ensured.markdown);
      await this.studylistService.handleWordModify(file, ensured.markdown);
      this.scheduleReferenceUsageRefresh(result.affectedReferencePaths);
      await this.syncService.markWordDirty(file);
      this.setWordBodyDirtyOverride(file, null);
      this.wordSyncSignatures.set((0, import_obsidian16.normalizePath)(file.path), getWordSyncSignature(ensured.markdown));
      this.refreshUi();
      return;
    }
    if (this.pathScope.isReferencePath(file.path)) {
      await this.ensureReferenceManagedFrontmatter(file);
      const lookup = await this.referenceIndex.findWordsReferencingWithFallback(file.path, { forceScan: true });
      await this.markWordsDirtyByPaths(lookup.wordPaths);
      this.invalidateSemanticReferenceCaches(lookup.affectedReferencePaths);
      this.refreshUi();
    }
  }
  async handleDelete(file) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    await this.perf.measure("event.delete", () => this.handleDeleteInternal(normalizedPath));
  }
  async handleDeleteInternal(normalizedPath) {
    this.managedFiles.remove(normalizedPath);
    this.startupKnownPaths.delete(normalizedPath);
    this.cancelAutoSyncTimer(normalizedPath);
    this.studylistService.removeWord(normalizedPath);
    this.wordSyncSignatures.delete(normalizedPath);
    this.wordCleanSyncSignatures.delete(normalizedPath);
    this.clearPendingOpenWordStatusWrite(normalizedPath);
    if (this.pathScope.isReferencePath(normalizedPath)) {
      const lookup = await this.referenceIndex.findWordsReferencingWithFallback(normalizedPath);
      await this.markWordsDirtyByPaths(lookup.wordPaths);
      this.referenceIndex.invalidate([normalizedPath]);
      this.invalidateSemanticReferenceCaches(lookup.affectedReferencePaths);
      this.clearWordStatusOverride(normalizedPath);
      this.refreshUi();
      return;
    }
    if (this.pathScope.isWordPath(normalizedPath)) {
      const affectedReferencePaths = this.referenceIndex.removeWord(normalizedPath);
      await this.refreshReferenceUsage(affectedReferencePaths);
      this.clearWordStatusOverride(normalizedPath);
      if (this.lastActiveWordPath === normalizedPath) {
        this.lastActiveWordPath = null;
      }
      this.refreshUi();
    }
  }
  async handleRename(file, oldPath) {
    await this.perf.measure("event.rename", () => this.handleRenameInternal(file, oldPath));
  }
  async handleRenameInternal(file, oldPath) {
    const normalizedOldPath = (0, import_obsidian16.normalizePath)(oldPath);
    const normalizedNewPath = (0, import_obsidian16.normalizePath)(file.path);
    this.managedFiles.rename(file, normalizedOldPath);
    this.startupKnownPaths.delete(normalizedOldPath);
    this.startupKnownPaths.delete(normalizedNewPath);
    const impactedWordPaths = /* @__PURE__ */ new Set();
    const affectedReferencePaths = /* @__PURE__ */ new Set();
    let shouldRepairAffectedReferenceMetadata = false;
    if (this.pathScope.isReferencePath(normalizedOldPath)) {
      const lookup = await this.referenceIndex.findWordsReferencingWithFallback(normalizedOldPath);
      for (const wordPath of lookup.wordPaths) {
        impactedWordPaths.add(wordPath);
      }
      for (const referencePath of lookup.affectedReferencePaths) {
        affectedReferencePaths.add(referencePath);
      }
    }
    if (this.pathScope.isWordPath(normalizedOldPath)) {
      for (const referencePath of this.referenceIndex.removeWord(normalizedOldPath)) {
        affectedReferencePaths.add(referencePath);
      }
      shouldRepairAffectedReferenceMetadata = true;
    }
    this.clearWordStatusOverride(normalizedOldPath);
    this.cancelAutoSyncTimer(normalizedOldPath);
    this.studylistService.removeWord(normalizedOldPath);
    this.wordSyncSignatures.delete(normalizedOldPath);
    this.wordCleanSyncSignatures.delete(normalizedOldPath);
    this.clearPendingOpenWordStatusWrite(normalizedOldPath);
    if (isMarkdownFile3(file) && this.pathScope.isWordPath(normalizedNewPath)) {
      const ensured = await this.ensureManagedWordProperties(file);
      if (!ensured.skipped) {
        const result = await this.referenceIndex.updateWord(file, ensured.markdown);
        await this.studylistService.handleWordModify(file, ensured.markdown);
        for (const referencePath of result.affectedReferencePaths) {
          affectedReferencePaths.add(referencePath);
        }
        shouldRepairAffectedReferenceMetadata = true;
        await this.syncService.markWordDirty(file);
        this.setWordBodyDirtyOverride(file, null);
        this.wordSyncSignatures.set((0, import_obsidian16.normalizePath)(file.path), getWordSyncSignature(ensured.markdown));
      } else {
        for (const referencePath of this.referenceIndex.removeWord(normalizedNewPath)) {
          affectedReferencePaths.add(referencePath);
        }
        shouldRepairAffectedReferenceMetadata = true;
      }
    }
    if (this.lastActiveWordPath === normalizedOldPath) {
      this.lastActiveWordPath = isMarkdownFile3(file) && this.pathScope.isWordPath(normalizedNewPath) ? normalizedNewPath : null;
    }
    if (this.pathScope.isReferencePath(normalizedNewPath)) {
      await this.ensureReferenceManagedFrontmatter(file);
      const lookup = await this.referenceIndex.findWordsReferencingWithFallback(normalizedNewPath, { forceScan: true });
      for (const wordPath of lookup.wordPaths) {
        impactedWordPaths.add(wordPath);
      }
      for (const referencePath of lookup.affectedReferencePaths) {
        affectedReferencePaths.add(referencePath);
      }
      affectedReferencePaths.add(normalizedNewPath);
    }
    await this.markWordsDirtyByPaths(Array.from(impactedWordPaths));
    if (shouldRepairAffectedReferenceMetadata && affectedReferencePaths.size > 0) {
      await this.refreshReferenceUsage(affectedReferencePaths);
    } else if (affectedReferencePaths.size > 0) {
      this.invalidateSemanticReferenceCaches(affectedReferencePaths);
    }
    this.refreshUi();
  }
  async markWordsDirtyByPaths(paths) {
    for (const path of paths) {
      const file = this.managedFiles.getFile(path) ?? this.app.vault.getFileByPath(path);
      if (!file || file.extension !== "md") {
        continue;
      }
      await this.markWordDirtyWithAutomaticDeferral(file);
    }
  }
  async markAllSyncWordsDirty() {
    let markedCount = 0;
    for (const file of this.managedFiles.getWordFiles()) {
      await this.ensureWordManagedFrontmatter(file);
      if (!this.syncService.canSyncFile(file)) {
        continue;
      }
      if (await this.syncService.markWordDirty(file)) {
        this.setWordBodyDirtyOverride(file, null);
        markedCount += 1;
      }
    }
    return markedCount;
  }
  async syncCurrentWord() {
    const file = this.getActiveMarkdownFile();
    if (!file || !this.pathScope.isWordPath(file.path)) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: open a word note in the configured word notes folder first.`);
      return;
    }
    if (!this.syncService.canSyncFile(file)) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: this word note is disabled for Eudic sync.`);
      return;
    }
    await this.syncFile(file, { force: true, source: "manual" });
  }
  async syncFile(file, options = {}) {
    if (options.source === "manual") {
      await this.saveActiveViewForFile(file);
      if (!this.isMarkdownFileOpen(file)) {
        await this.flushPendingWordStatusWrite(file);
      }
    }
    await this.syncOrchestrator.syncFile(file, options);
    await this.captureWordCleanSignatureIfSynced(file);
  }
  async saveActiveViewForFile(file) {
    const view = this.getActiveMarkdownView();
    if (!view?.file || (0, import_obsidian16.normalizePath)(view.file.path) !== (0, import_obsidian16.normalizePath)(file.path)) {
      return;
    }
    await view.save();
  }
  async resyncAliasesForCurrentWord() {
    const file = this.getActiveMarkdownFile();
    if (!file || !this.syncService.canSyncFile(file)) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: open a word note in the configured word notes folder first.`);
      return;
    }
    if (this.syncOrchestrator.isSyncInFlight(file)) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: "${file.basename}" is already syncing.`);
      return;
    }
    this.syncOrchestrator.beginSync(file);
    try {
      const result = await this.syncService.resyncAliases(file);
      this.setWordStatusOverride(file, result.status, result.error ?? null);
      new import_obsidian16.Notice(getResyncAliasesNoticeText(result));
    } catch (error) {
      const message = toErrorMessage7(error);
      const context = this.getDisplayWordContext(file);
      this.setWordStatusOverride(file, context?.effectiveStatus ?? "dirty", message);
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to resync aliases for "${file.basename}": ${message}`);
    } finally {
      this.syncOrchestrator.endSync(file);
    }
  }
  async deleteCurrentWordNoteInEudic() {
    const file = this.getActiveMarkdownFile();
    if (!file || !this.syncService.canSyncFile(file)) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: open a word note in the configured word notes folder first.`);
      return;
    }
    const context = this.getDisplayWordContext(file);
    if (!context?.lang) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: missing '${FRONTMATTER_KEYS.lang}' in "${file.basename}".`);
      return;
    }
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    if (this.syncOrchestrator.isSyncInFlight(file) || this.inFlightDeletePaths.has(normalizedPath)) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: "${file.basename}" is busy.`);
      return;
    }
    const confirmed = await confirmDeleteEudicNote(
      this.app,
      `Delete Eudic note for "${context.word}"?`,
      [
        "This deletes only the Eudic cloud note.",
        "It does not delete the Obsidian local word note.",
        "A future sync will write the note back to Eudic."
      ],
      "Delete from Eudic"
    );
    if (!confirmed) {
      return;
    }
    this.inFlightDeletePaths.add(normalizedPath);
    try {
      const result = await this.syncService.deleteCurrentWordNote(file);
      this.setWordBodyDirtyOverride(file, null);
      this.refreshUi();
      new import_obsidian16.Notice(getDeleteNoteNoticeText(result));
    } catch (error) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to delete the Eudic note: ${toErrorMessage7(error)}`);
    } finally {
      this.inFlightDeletePaths.delete(normalizedPath);
      this.refreshUi();
    }
  }
  async deleteTypedWordNoteInEudic() {
    if (this.typedDeleteInFlight) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: a typed Eudic note deletion is already in progress.`);
      return;
    }
    const selection = await promptDeleteTypedWordNote(this.app, this.syncService.getAvailableWordLanguages());
    if (!selection) {
      return;
    }
    const confirmed = await confirmDeleteEudicNote(
      this.app,
      `Delete Eudic note for "${selection.word}" (${selection.language})?`,
      [
        "This deletes only the Eudic cloud note.",
        "It does not delete any Obsidian local note.",
        "A future sync will write the note back to Eudic if a local word owns it."
      ],
      "Delete from Eudic"
    );
    if (!confirmed) {
      return;
    }
    this.typedDeleteInFlight = true;
    try {
      const result = await this.syncService.deleteTypedWordNote(selection.word, selection.language);
      for (const file of result.matchedMainFiles) {
        this.setWordBodyDirtyOverride(file, null);
      }
      for (const file of result.matchedAliasOwnerFiles) {
        this.setWordBodyDirtyOverride(file, null);
      }
      this.refreshUi();
      new import_obsidian16.Notice(getDeleteNoteNoticeText(result));
    } catch (error) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to delete the Eudic note: ${toErrorMessage7(error)}`);
    } finally {
      this.typedDeleteInFlight = false;
    }
  }
  async refreshEudicStudylists() {
    try {
      await this.ensureAllWordManagedFrontmatter();
      const result = await this.perf.measure("studylist.refreshFromEudic", () => this.studylistService.refreshFromEudic());
      await this.reconcileWordSyncStatuses(result.updatedFiles);
      new import_obsidian16.Notice(getStudylistRefreshNoticeText(result), 8e3);
    } catch (error) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to refresh Eudic studylists: ${toErrorMessage7(error)}`, 8e3);
    }
  }
  async pullStudylistAssignmentsFromEudic() {
    try {
      await this.ensureAllWordManagedFrontmatter();
      const result = await this.perf.measure("studylist.pullAssignmentsFromEudic", () => this.studylistService.pullAssignmentsFromEudic());
      await this.reconcileWordSyncStatuses(result.updatedFiles);
      new import_obsidian16.Notice(getStudylistRefreshNoticeText(result), 8e3);
    } catch (error) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to pull studylist assignments from Eudic: ${toErrorMessage7(error)}`, 8e3);
    }
  }
  async pullCurrentWordStudylistAssignmentFromEudic() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: open a word note first.`);
      return;
    }
    try {
      await this.ensureWordManagedFrontmatter(file);
      const status = this.studylistService.getCurrentWordStudylistStatus(file);
      if (status === "dirty") {
        const confirmed = await confirmEudicAction(
          this.app,
          `Pull studylist assignment for "${file.basename}" from Eudic?`,
          [
            "This will replace local studylist properties with the Eudic cloud assignment.",
            "Your local dirty studylist edits for this word will be discarded.",
            "The word note content will not be changed."
          ],
          "Pull from Eudic"
        );
        if (!confirmed) {
          return;
        }
      }
      const result = await this.studylistService.pullCurrentWordAssignmentFromEudic(file, status === "dirty");
      await this.reconcileWordSyncStatuses([file]);
      new import_obsidian16.Notice(
        `${PLUGIN_NAME}: pulled studylist assignment for "${result.word}" (${result.names.length} list(s), ${result.updated ? "updated" : "unchanged"}).`,
        8e3
      );
    } catch (error) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to pull current word studylist assignment from Eudic: ${toErrorMessage7(error)}`, 8e3);
    }
  }
  async pushAllDirtyStudylistAssignmentsToEudic() {
    await this.ensureAllWordManagedFrontmatter();
    const dirtyFiles = this.studylistService.collectDirtyStudylistWords();
    if (dirtyFiles.length === 0) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: no dirty studylist assignments to push.`);
      return;
    }
    await this.pushStudylistAssignmentsWithConfirmation(dirtyFiles, "Push all dirty studylist assignments?");
  }
  async pushCurrentWordStudylistAssignmentToEudic() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: open a word note first.`);
      return;
    }
    await this.ensureWordManagedFrontmatter(file);
    const pushFile = this.studylistService.getCurrentWordForPush(file);
    if (!pushFile) {
      const lastError = this.studylistService.getCurrentWordStudylistLastError(file);
      if (lastError) {
        new import_obsidian16.Notice(`${PLUGIN_NAME}: cannot push studylist assignment: ${lastError}`, 8e3);
        return;
      }
      new import_obsidian16.Notice(`${PLUGIN_NAME}: current word has no pushable studylist assignment.`);
      return;
    }
    await this.pushStudylistAssignmentsWithConfirmation([pushFile], `Push studylist assignment for "${pushFile.basename}"?`);
  }
  async pushStudylistAssignmentsWithConfirmation(files, title) {
    try {
      const preview = await this.studylistService.previewPush(files);
      if (preview.total === 0) {
        new import_obsidian16.Notice(`${PLUGIN_NAME}: no pushable studylist assignments.`);
        return;
      }
      if (preview.added + preview.removed > 0) {
        const confirmed = await confirmEudicAction(
          this.app,
          title,
          [
            `Words: ${preview.total}`,
            `Assignments to add: ${preview.added}`,
            `Assignments to remove: ${preview.removed}`,
            "This changes Eudic cloud studylist membership, but does not modify note content."
          ],
          "Push to Eudic"
        );
        if (!confirmed) {
          return;
        }
      }
      const result = await this.studylistService.pushAssignments(preview.files);
      await this.reconcileWordSyncStatuses(preview.files);
      new import_obsidian16.Notice(getStudylistPushNoticeText(result), 8e3);
    } catch (error) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to push studylist assignments: ${toErrorMessage7(error)}`, 8e3);
    }
  }
  async reconcileWordSyncStatuses(files) {
    for (const file of files) {
      const bodyStatus = await this.syncService.reconcileWordSyncStatus(file);
      const context = this.getDisplayWordContext(file) ?? this.syncService.getWordContext(file);
      this.setWordBodyStatusOverride(file, bodyStatus, bodyStatus === "dirty" ? context?.lastError ?? null : null);
      if (context?.studylistStatus) {
        this.setWordStudylistStatusOverride(
          file,
          context.studylistStatus,
          this.studylistService.getCurrentWordStudylistLastError(file)
        );
      }
      await this.captureWordCleanSignatureIfSynced(file);
    }
  }
  async rebuildLocalStudylistMetadata() {
    try {
      await this.ensureAllWordManagedFrontmatter();
      const updatedWords = await this.perf.measure("studylist.rebuildLocalMetadata", () => this.studylistService.rebuildLocalMetadata());
      new import_obsidian16.Notice(`${PLUGIN_NAME}: repaired word properties and rebuilt local studylist metadata for ${updatedWords} word(s).`);
    } catch (error) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to rebuild local studylist metadata: ${toErrorMessage7(error)}`, 8e3);
    }
  }
  async repairStudylistNamesIdsForAllWordNotes() {
    try {
      await this.ensureAllWordManagedFrontmatter();
      const result = await this.perf.measure("studylist.repairNamesIds", () => this.studylistService.repairNamesIdsForAllWords());
      new import_obsidian16.Notice(
        `${PLUGIN_NAME}: Studylist names/ids repair complete: ${result.updated} updated, ${result.unresolved} unresolved. No Eudic cloud changes were made.`,
        8e3
      );
      this.refreshUi();
    } catch (error) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to repair studylist names/ids: ${toErrorMessage7(error)}`, 8e3);
    }
  }
  async copyManagedUrlForCurrentNote() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: open a managed word or reference note first.`);
      return;
    }
    try {
      const url = await this.getManagedUrlForFile(file);
      if (!url) {
        new import_obsidian16.Notice(`${PLUGIN_NAME}: open a managed word or reference note first.`);
        return;
      }
      await copyTextToClipboard(url);
      new import_obsidian16.Notice(`${PLUGIN_NAME}: copied managed URL for "${file.basename}".`);
    } catch (error) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: failed to copy managed URL: ${toErrorMessage7(error)}`);
    }
  }
  async formatCurrentEudicNoteBoldMarkers() {
    const view = this.getActiveMarkdownView();
    const file = view?.file ?? null;
    if (!view || !file || !this.canFormatBoldMarkers(file)) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: open a managed word or reference note first.`);
      return;
    }
    if (this.settings.boldMarkers.length === 0) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: no bold markers are configured.`);
      return;
    }
    let changedNotes = 0;
    let referenceNotesChanged = 0;
    let replacements = 0;
    const currentMarkdown = view.editor.getValue();
    const currentResult = formatBoldMarkersInMarkdown(currentMarkdown, this.settings.boldMarkers);
    const nextCurrentMarkdown = currentResult.markdown;
    if (currentResult.changed) {
      view.editor.setValue(nextCurrentMarkdown);
      await view.save();
      changedNotes += 1;
      replacements += currentResult.replacements;
    }
    if (this.pathScope.isWordPath(file.path)) {
      const referenceFiles = this.getManagedReferenceFilesForWord(file, nextCurrentMarkdown);
      for (const referenceFile of referenceFiles) {
        const referenceResult = await this.formatBoldMarkersInMarkdownFile(referenceFile);
        if (!referenceResult.changed) {
          continue;
        }
        changedNotes += 1;
        referenceNotesChanged += 1;
        replacements += referenceResult.replacements;
      }
    }
    if (changedNotes === 0) {
      const noChangeTarget = this.pathScope.isWordPath(file.path) ? `"${file.basename}" or its linked references` : `"${file.basename}"`;
      new import_obsidian16.Notice(`${PLUGIN_NAME}: no bold markers to format in ${noChangeTarget}.`);
      return;
    }
    const referenceSummary = this.pathScope.isWordPath(file.path) ? `, including ${referenceNotesChanged} linked reference note(s)` : "";
    new import_obsidian16.Notice(
      `${PLUGIN_NAME}: formatted ${replacements} bold marker(s) in ${changedNotes} note(s)${referenceSummary}.`,
      8e3
    );
    this.refreshUi();
  }
  async formatAllEudicNoteBoldMarkers() {
    if (this.settings.boldMarkers.length === 0) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: no bold markers are configured.`);
      return;
    }
    let changed = 0;
    let skipped = 0;
    let replacements = 0;
    for (const file of [...this.managedFiles.getWordFiles(), ...this.managedFiles.getReferenceFiles()]) {
      if (!this.canFormatBoldMarkers(file)) {
        continue;
      }
      const markdown = await this.app.vault.cachedRead(file);
      const result = formatBoldMarkersInMarkdown(markdown, this.settings.boldMarkers);
      if (!result.changed) {
        skipped += 1;
        continue;
      }
      await this.app.vault.modify(file, result.markdown);
      changed += 1;
      replacements += result.replacements;
    }
    new import_obsidian16.Notice(
      `${PLUGIN_NAME}: formatted ${replacements} bold marker(s) in ${changed} note(s), skipped ${skipped} unchanged note(s).`,
      8e3
    );
    this.refreshUi();
  }
  canFormatBoldMarkers(file) {
    if (!file || file.extension !== "md") {
      return false;
    }
    return this.pathScope.isWordPath(file.path) || this.pathScope.isReferencePath(file.path);
  }
  async formatBoldMarkersInMarkdownFile(file) {
    const markdown = await this.app.vault.cachedRead(file);
    const result = formatBoldMarkersInMarkdown(markdown, this.settings.boldMarkers);
    if (!result.changed) {
      return {
        changed: false,
        replacements: 0
      };
    }
    await this.app.vault.modify(file, result.markdown);
    return {
      changed: true,
      replacements: result.replacements
    };
  }
  getManagedReferenceFilesForWord(file, markdown) {
    const referencePaths = new Set(resolveManagedReferencePaths(this.app, this.pathScope, file, markdown));
    return Array.from(referencePaths).map((referencePath) => this.managedFiles.getFile(referencePath) ?? this.app.vault.getFileByPath(referencePath)).filter((referenceFile) => !!referenceFile && this.pathScope.isReferencePath(referenceFile.path)).sort((left, right) => left.path.localeCompare(right.path));
  }
  async syncAllDirtyWords() {
    await this.ensureAllWordManagedFrontmatter();
    const collectedDirtyWords = await this.syncService.collectDirtyWords();
    const dirtyWords = collectedDirtyWords.filter((file) => !this.syncOrchestrator.isSyncInFlight(file));
    if (collectedDirtyWords.length === 0) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: no dirty words to sync.`);
      return;
    }
    if (dirtyWords.length === 0) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: all dirty words are already syncing.`);
      return;
    }
    const batchFiles = [];
    for (const file of dirtyWords) {
      if (this.syncOrchestrator.beginSync(file)) {
        batchFiles.push(file);
      }
    }
    if (batchFiles.length === 0) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: all dirty words are already syncing.`);
      return;
    }
    this.refreshUi();
    try {
      const batchResult = await this.perf.measure("sync.allDirtyWords", () => this.syncService.syncWords(batchFiles));
      for (const result of batchResult.results) {
        if (result.error) {
          this.setWordBodyDirtyOverride(result.file, result.error);
        } else {
          this.setWordStatusOverride(result.file, "synced", null);
          await this.captureWordCleanSignatureIfSynced(result.file);
        }
      }
      const aliasSummary = batchResult.aliasUploaded > 0 ? ` aliases updated ${batchResult.aliasUploaded}.` : " aliases unchanged.";
      const summary = `${PLUGIN_NAME}: processed ${batchResult.total} dirty word(s), uploaded ${batchResult.uploaded}, unchanged ${batchResult.skipped}, failed ${batchResult.failed}.${aliasSummary}`;
      new import_obsidian16.Notice(summary, 8e3);
    } finally {
      for (const file of batchFiles) {
        this.syncOrchestrator.endSync(file);
      }
      this.refreshUi();
    }
  }
  async createReferenceFromSelection() {
    await this.withActiveWordView(async (view) => {
      const result = await this.referenceNoteService.createReferenceFromSelection(view);
      await view.save();
      new import_obsidian16.Notice(`${PLUGIN_NAME}: created ${result.createdCount} reference from the current selection.`);
      this.refreshUi();
    });
  }
  async createReferenceFromCurrentParagraph() {
    await this.withActiveWordView(async (view) => {
      const result = await this.referenceNoteService.createReferenceFromCurrentParagraph(view);
      await view.save();
      new import_obsidian16.Notice(`${PLUGIN_NAME}: created ${result.createdCount} reference from the current paragraph.`);
      this.refreshUi();
    });
  }
  async extractPendingReferencesInCurrentWord() {
    await this.withActiveWordView(async (view) => {
      const result = await this.referenceNoteService.extractPendingReferences(view);
      if (!result.changed) {
        new import_obsidian16.Notice(`${PLUGIN_NAME}: no pending reference blocks found.`);
        return;
      }
      await view.save();
      new import_obsidian16.Notice(`${PLUGIN_NAME}: extracted ${result.createdCount} pending reference(s).`);
      this.refreshUi();
    });
  }
  async extractCurrentEudicBlockToReference() {
    await this.withActiveWordView(async (view) => {
      const result = await this.referenceNoteService.extractCurrentEudicBlockToReference(view);
      await view.save();
      new import_obsidian16.Notice(`${PLUGIN_NAME}: extracted ${result.createdCount} Eudic block reference.`);
      this.refreshUi();
    });
  }
  async wrapSelectionAsEudicBlock() {
    await this.withActiveManagedNoteView(async (view) => {
      if (!view.editor.somethingSelected()) {
        throw new Error("Select the block content you want to wrap first.");
      }
      const selection = view.editor.getSelection();
      const extracted = extractLeadingPresetKindFromList(selection, this.getSemanticBlockKindPresets());
      const kind = extracted.kind ?? DEFAULT_EUDIC_BLOCK_KIND;
      const body = extracted.markdown;
      if (!body) {
        throw new Error("The selected Eudic block content is empty.");
      }
      view.editor.replaceSelection(buildEudicBlock(kind, body), "eudic-sync");
      await view.save();
      new import_obsidian16.Notice(`${PLUGIN_NAME}: wrapped the current selection as an "${kind}" Eudic block.`);
      this.refreshUi();
    });
  }
  async insertEudicBlock() {
    await this.withActiveManagedNoteView(async (view) => {
      if (view.editor.somethingSelected()) {
        throw new Error('Clear the selection first, or use "Wrap selection as Eudic block".');
      }
      const editor = view.editor;
      const cursor = editor.getCursor();
      const currentLine = editor.getLine(cursor.line);
      const insertion = buildEmptyEudicBlockInsertion(cursor, currentLine);
      editor.replaceRange(insertion.insertText, insertion.from, insertion.to, "eudic-sync");
      editor.setCursor(insertion.cursor);
      editor.focus();
      new import_obsidian16.Notice(`${PLUGIN_NAME}: inserted a new Eudic block. Type the Eudic block kind after kind=.`);
      this.refreshUi();
    });
  }
  getSemanticBlockKindPresets() {
    const seen = /* @__PURE__ */ new Set();
    const presets = [];
    for (const presetKind of this.settings.semanticBlockKindPresets) {
      const trimmed = presetKind.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      presets.push(trimmed);
    }
    return presets;
  }
  async withActiveManagedNoteView(run) {
    const view = this.getActiveMarkdownView();
    const file = view?.file ?? null;
    if (!view || !file || !this.canFormatBoldMarkers(file)) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: open a managed word or reference note first.`);
      return;
    }
    try {
      await run(view, file);
    } catch (error) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: ${toErrorMessage7(error)}`);
    }
  }
  async withActiveWordView(run) {
    const view = this.getActiveMarkdownView();
    const file = view?.file ?? null;
    if (!view || !file || !this.syncService.canSyncFile(file)) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: open a word note in the configured word notes folder first.`);
      return;
    }
    try {
      await run(view, file);
    } catch (error) {
      new import_obsidian16.Notice(`${PLUGIN_NAME}: ${toErrorMessage7(error)}`);
    }
  }
  getActiveMarkdownView() {
    return this.app.workspace.getActiveViewOfType(import_obsidian16.MarkdownView);
  }
  getActiveMarkdownFile() {
    const view = this.getActiveMarkdownView();
    return view?.file ?? null;
  }
  getActiveWordPath() {
    const file = this.getActiveMarkdownFile();
    if (!file || !this.syncService.canSyncFile(file)) {
      return null;
    }
    return (0, import_obsidian16.normalizePath)(file.path);
  }
  handleActiveWordChanged() {
    const nextActiveWordPath = this.getActiveWordPath();
    if (nextActiveWordPath) {
      this.cancelAutoSyncTimer(nextActiveWordPath);
    }
    if (this.lastActiveWordPath && this.lastActiveWordPath !== nextActiveWordPath) {
      const previousActiveWordPath = this.lastActiveWordPath;
      void this.flushPendingWordStatusWriteByPath(previousActiveWordPath).finally(() => {
        this.scheduleAutoSyncAfterLeavingWord(previousActiveWordPath);
      });
    }
    this.lastActiveWordPath = nextActiveWordPath;
    void this.flushPendingOpenWordStatusWrites();
  }
  getOpenMarkdownFilePaths() {
    const paths = /* @__PURE__ */ new Set();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof import_obsidian16.MarkdownView && view.file) {
        paths.add((0, import_obsidian16.normalizePath)(view.file.path));
      }
    }
    return paths;
  }
  getOpenMarkdownViewForFile(file) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof import_obsidian16.MarkdownView && view.file && (0, import_obsidian16.normalizePath)(view.file.path) === normalizedPath) {
        return view;
      }
    }
    return null;
  }
  isMarkdownFileOpen(file) {
    return this.getOpenMarkdownFilePaths().has((0, import_obsidian16.normalizePath)(file.path));
  }
  refreshUi() {
    this.vaultEventController.refreshUi();
  }
  flushUi() {
    if (this.isUnloaded) {
      return;
    }
    this.saveHookController.refresh();
    this.uiController.refresh();
  }
  isSyncInFlight(file) {
    return this.syncOrchestrator.isSyncInFlight(file);
  }
  getDisplayWordContext(file) {
    return this.wordStatusOverrides.getDisplayContext(file, this.syncService.getWordContext(file));
  }
  setWordStatusOverride(file, status, lastError, bodyStatus, studylistStatus) {
    if (bodyStatus === void 0 && studylistStatus === void 0) {
      this.setWordBodyStatusOverride(file, status, lastError);
      return;
    }
    if (bodyStatus !== void 0) {
      const bodyError = bodyStatus === "dirty" ? lastError : null;
      this.wordStatusOverrides.setBody(file, bodyStatus, bodyError);
    }
    if (studylistStatus !== void 0) {
      const studylistError = bodyStatus === "dirty" && lastError ? null : lastError;
      this.wordStatusOverrides.setStudylist(file, studylistStatus, studylistError);
    }
    this.refreshUi();
  }
  setWordBodyStatusOverride(file, status, lastError) {
    this.wordStatusOverrides.setBody(file, status, lastError);
    this.refreshUi();
  }
  setWordStudylistStatusOverride(file, status, lastError) {
    this.wordStatusOverrides.setStudylist(file, status, lastError);
    this.refreshUi();
  }
  setWordBodyDirtyOverride(file, lastError) {
    this.setWordBodyStatusOverride(file, "dirty", lastError);
  }
  getWordDirtySignatureDecision(path, nextSignature) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(path);
    return resolveWordDirtySignatureDecision({
      cleanSignature: this.wordCleanSyncSignatures.get(normalizedPath),
      previousSignature: this.wordSyncSignatures.get(normalizedPath),
      nextSignature
    });
  }
  markOpenEditorWordBodyDirty(file, editor, lastError, options = {}) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    const patch = buildSyncStatusPatch(editor.getValue(), "dirty");
    try {
      applySyncStatusPatchToEditor(editor, "dirty");
    } catch (error) {
      console.error(`${PLUGIN_NAME}: failed to patch sync_status in the open editor`, error);
      return false;
    }
    this.autoBodyDirtyPaths.add(normalizedPath);
    if (options.restorable) {
      if (patch.changed) {
        this.restorableEditorBodyDirtyPaths.add(normalizedPath);
      }
    } else {
      this.nonRestorableBodyDirtyPaths.add(normalizedPath);
    }
    this.clearPendingOpenWordBodyWrite(normalizedPath);
    this.setWordBodyDirtyFast(file, lastError);
    return true;
  }
  markOpenWordBodyDirty(file, lastError, options = {}) {
    const view = this.getOpenMarkdownViewForFile(file);
    return view ? this.markOpenEditorWordBodyDirty(file, view.editor, lastError, options) : false;
  }
  updateOpenWordBodyDirtyState(file, decision) {
    if (decision === "clean") {
      this.clearAutoWordBodyDirty(file);
      return;
    }
    if (decision === "dirty") {
      this.markOpenWordBodyDirty(file, null, { restorable: true });
    }
  }
  clearAutoWordBodyDirty(file, editor) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    this.clearPendingOpenWordBodyWrite(normalizedPath);
    if (this.restorableEditorBodyDirtyPaths.has(normalizedPath)) {
      if (this.nonRestorableBodyDirtyPaths.has(normalizedPath)) {
        this.restorableEditorBodyDirtyPaths.delete(normalizedPath);
        this.setWordBodyDirtyFast(file, null);
        return;
      }
      const targetEditor = editor ?? this.getOpenMarkdownViewForFile(file)?.editor;
      if (targetEditor) {
        try {
          applySyncStatusPatchToEditor(targetEditor, "synced");
          this.autoBodyDirtyPaths.delete(normalizedPath);
          this.restorableEditorBodyDirtyPaths.delete(normalizedPath);
          this.setWordBodyStatusOverride(file, "synced", null);
          return;
        } catch (error) {
          console.error(`${PLUGIN_NAME}: failed to restore sync_status in the open editor`, error);
        }
      }
    }
    const context = this.syncService.getWordContext(file);
    if (context?.bodyStatus === "synced" && !context.lastError) {
      this.wordStatusOverrides.clearBody(normalizedPath);
    }
    this.refreshUi();
  }
  releaseWordStatusOverridesIfMetadataCaughtUp(file) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    const override = this.wordStatusOverrides.get(normalizedPath);
    const context = this.syncService.getWordContext(file);
    if (!override || !context) {
      return;
    }
    if (override.bodyStatus !== void 0 && !this.hasPendingOpenWordBodyWrite(normalizedPath) && context.bodyStatus === override.bodyStatus) {
      this.wordStatusOverrides.clearBody(normalizedPath);
    }
    if (override.studylistStatus !== void 0 && context.studylistStatus === override.studylistStatus) {
      this.wordStatusOverrides.clearStudylist(normalizedPath);
    }
  }
  clearWordStatusOverride(path) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(path);
    this.autoBodyDirtyPaths.delete(normalizedPath);
    this.restorableEditorBodyDirtyPaths.delete(normalizedPath);
    this.nonRestorableBodyDirtyPaths.delete(normalizedPath);
    this.wordStatusOverrides.clear(normalizedPath);
  }
  async markWordDirtyWithAutomaticDeferral(file) {
    if (this.pathScope.isWordPath(file.path) && this.isMarkdownFileOpen(file)) {
      return this.markOpenWordBodyDirty(file, null);
    }
    const changed = await this.syncService.markWordDirty(file);
    if (changed) {
      this.setWordBodyDirtyOverride(file, null);
    }
    return changed;
  }
  trimPendingOpenWordStatusWrite(path) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(path);
    const pending = this.pendingOpenWordStatusWrites.get(normalizedPath);
    if (!pending) {
      return;
    }
    if (!pending.bodyDirty) {
      this.pendingOpenWordStatusWrites.delete(normalizedPath);
    }
  }
  clearPendingOpenWordBodyWrite(path) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(path);
    const pending = this.pendingOpenWordStatusWrites.get(normalizedPath);
    if (!pending) {
      return;
    }
    delete pending.bodyDirty;
    delete pending.bodyError;
    this.trimPendingOpenWordStatusWrite(normalizedPath);
  }
  clearPendingOpenWordStatusWrite(path) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(path);
    this.pendingOpenWordStatusWrites.delete(normalizedPath);
    this.flushingOpenWordStatusWritePaths.delete(normalizedPath);
  }
  hasPendingOpenWordBodyWrite(path) {
    return this.pendingOpenWordStatusWrites.get((0, import_obsidian16.normalizePath)(path))?.bodyDirty === true;
  }
  clearEditorChangeTimers() {
    for (const timer of this.editorChangeTimers.values()) {
      window.clearTimeout(timer);
    }
    this.editorChangeTimers.clear();
  }
  async flushPendingOpenWordStatusWrites() {
    const openPaths = this.getOpenMarkdownFilePaths();
    for (const path of Array.from(this.pendingOpenWordStatusWrites.keys())) {
      if (!openPaths.has(path)) {
        await this.flushPendingWordStatusWriteByPath(path);
      }
    }
  }
  async flushPendingWordStatusWriteByPath(path) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(path);
    const file = this.managedFiles.getFile(normalizedPath) ?? this.app.vault.getFileByPath(normalizedPath);
    if (!file) {
      this.clearPendingOpenWordStatusWrite(normalizedPath);
      return;
    }
    await this.flushPendingWordStatusWrite(file);
  }
  async flushPendingWordStatusWrite(file) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
    const pending = this.pendingOpenWordStatusWrites.get(normalizedPath);
    if (!pending) {
      return;
    }
    if (this.getOpenMarkdownFilePaths().has(normalizedPath)) {
      return;
    }
    if (this.flushingOpenWordStatusWritePaths.has(normalizedPath)) {
      return;
    }
    if (!file || !this.syncService.canSyncFile(file)) {
      this.clearPendingOpenWordStatusWrite(normalizedPath);
      return;
    }
    this.flushingOpenWordStatusWritePaths.add(normalizedPath);
    try {
      const markdown = await this.app.vault.cachedRead(file);
      const result = await this.referenceIndex.updateWord(file, markdown);
      this.scheduleReferenceUsageRefresh(result.affectedReferencePaths);
      if (result.disabled) {
        this.clearPendingOpenWordStatusWrite(normalizedPath);
        this.clearWordStatusOverride(normalizedPath);
        this.cancelAutoSyncTimer(normalizedPath);
        return;
      }
      const nextSignature = getWordSyncSignature(markdown);
      const decision = this.getWordDirtySignatureDecision(normalizedPath, nextSignature);
      const shouldWriteBodyDirty = pending.bodyDirty && decision !== "clean";
      if (shouldWriteBodyDirty) {
        await this.writeWordSyncFrontmatter(file, {
          syncStatus: "dirty",
          lastError: pending.bodyError ?? null
        });
      }
      if (decision === "clean") {
        this.clearAutoWordBodyDirty(file);
      } else if (shouldWriteBodyDirty) {
        this.setWordBodyDirtyOverride(file, pending.bodyError ?? null);
      }
      this.clearPendingOpenWordStatusWrite(normalizedPath);
      this.wordSyncSignatures.set(normalizedPath, nextSignature);
    } finally {
      this.flushingOpenWordStatusWritePaths.delete(normalizedPath);
      this.refreshUi();
    }
  }
  scheduleAutoSyncAfterLeavingWord(path) {
    if (!this.settings.enableAutoSyncWordOnLeave) {
      return;
    }
    const normalizedPath = (0, import_obsidian16.normalizePath)(path);
    const file = this.managedFiles.getFile(normalizedPath) ?? this.app.vault.getFileByPath(normalizedPath);
    if (!file || !this.syncService.canSyncFile(file)) {
      return;
    }
    const context = this.getDisplayWordContext(file);
    if (!context || context.bodyStatus !== "dirty") {
      return;
    }
    this.cancelAutoSyncTimer(normalizedPath);
    const timer = window.setTimeout(() => {
      this.leaveAutoSyncTimers.delete(normalizedPath);
      void this.runAutoSyncForLeftWord(normalizedPath);
    }, AUTO_SYNC_AFTER_LEAVE_DELAY_MS);
    this.leaveAutoSyncTimers.set(normalizedPath, timer);
  }
  async runAutoSyncForLeftWord(path) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(path);
    if (!this.settings.enableAutoSyncWordOnLeave || this.getActiveWordPath() === normalizedPath) {
      return;
    }
    const file = this.managedFiles.getFile(normalizedPath) ?? this.app.vault.getFileByPath(normalizedPath);
    if (!file || !this.syncService.canSyncFile(file) || this.isSyncInFlight(file)) {
      return;
    }
    if (this.isMarkdownFileOpen(file)) {
      return;
    }
    const context = this.getDisplayWordContext(file);
    if (!context || context.bodyStatus !== "dirty") {
      return;
    }
    try {
      const markdown = await this.app.vault.cachedRead(file);
      if (hasPendingReferenceBlocks(markdown)) {
        const message = "Pending reference blocks must be extracted before sync.";
        if (context.lastError !== message) {
          await this.writeWordSyncFrontmatter(file, {
            syncStatus: "dirty",
            lastError: message
          });
        }
        this.setWordBodyDirtyOverride(file, message);
        this.refreshUi();
        return;
      }
      const result = await this.referenceIndex.updateWord(file, markdown);
      await this.refreshReferenceUsage(result.affectedReferencePaths);
      await this.syncService.markWordDirty(file);
      this.setWordBodyDirtyOverride(file, null);
      await this.syncFile(file, { silentIfAlreadySyncing: true, source: "auto" });
    } catch (error) {
      const message = toErrorMessage7(error);
      try {
        await this.writeWordSyncFrontmatter(file, {
          syncStatus: "dirty",
          lastError: message
        });
      } catch {
      }
      this.setWordBodyDirtyOverride(file, message);
      this.refreshUi();
    }
  }
  cancelAutoSyncTimer(path) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(path);
    const timer = this.leaveAutoSyncTimers.get(normalizedPath);
    if (timer === void 0) {
      return;
    }
    window.clearTimeout(timer);
    this.leaveAutoSyncTimers.delete(normalizedPath);
  }
  clearAutoSyncTimers() {
    for (const timer of this.leaveAutoSyncTimers.values()) {
      window.clearTimeout(timer);
    }
    this.leaveAutoSyncTimers.clear();
  }
  scheduleReferenceUsageRefresh(referencePaths) {
    const paths = Array.from(referencePaths);
    this.invalidateSemanticReferenceCaches(paths);
    this.vaultEventController.scheduleReferenceUsageRefresh(paths);
  }
  invalidateSemanticReferenceCaches(referencePaths) {
    const paths = referencePaths ? Array.from(referencePaths) : void 0;
    this.semanticBlockAutomation.invalidateReferenceLinkTargets(paths);
    this.syncService?.invalidateSemanticBlockReferenceCache(paths);
  }
  async refreshReferenceUsage(referencePaths) {
    const openPaths = this.getOpenMarkdownFilePaths();
    const paths = referencePaths ? Array.from(referencePaths).filter((path) => !openPaths.has((0, import_obsidian16.normalizePath)(path))) : void 0;
    if (paths && paths.length === 0) {
      return;
    }
    this.invalidateSemanticReferenceCaches(paths);
    await this.referenceIndex.refreshReferenceUsage(paths);
  }
  async ensureWordManagedFrontmatterForSync(file) {
    if (!this.isMarkdownFileOpen(file)) {
      return this.ensureWordManagedFrontmatter(file);
    }
    const existingLinkId = readEudicLinkId(getFrontmatter(this.app, file));
    if (existingLinkId) {
      return existingLinkId;
    }
    const nextLinkId = createEudicLinkId("word");
    await this.writeWordSyncFrontmatter(file, { eudicLinkId: nextLinkId });
    return nextLinkId;
  }
  async writeWordSyncFrontmatter(file, data) {
    const view = this.getOpenMarkdownViewForFile(file);
    if (view) {
      const normalizedPath = (0, import_obsidian16.normalizePath)(file.path);
      const currentMarkdown = view.editor.getValue();
      const nextMarkdown = setWordSyncFrontmatterInMarkdown(currentMarkdown, data);
      const nextSignature = getWordSyncSignature(nextMarkdown);
      if (nextMarkdown !== currentMarkdown) {
        this.syncingEditorWordStatusPatchSignatures.set(normalizedPath, nextSignature);
        window.setTimeout(() => {
          if (this.syncingEditorWordStatusPatchSignatures.get(normalizedPath) === nextSignature) {
            this.syncingEditorWordStatusPatchSignatures.delete(normalizedPath);
          }
        }, SUPPRESSED_WRITE_TTL_MS);
        this.suppressPath(file.path);
        try {
          applyWordSyncFrontmatterPatchToEditor(view.editor, data);
          await view.save();
        } catch (error) {
          this.clearSuppression(file.path);
          this.syncingEditorWordStatusPatchSignatures.delete(normalizedPath);
          throw error;
        }
      }
      if (data.syncStatus === "synced") {
        this.recordWordBodySyncedFromMarkdown(file, nextMarkdown);
      } else if (data.syncStatus === "dirty") {
        this.setWordBodyStatusOverride(file, "dirty", data.lastError ?? null);
      }
      this.refreshUi();
      return;
    }
    await this.writeFrontmatter(file, (frontmatter) => {
      applyWordSyncFrontmatterToObject(frontmatter, data);
    });
    if (data.syncStatus === "dirty") {
      this.setWordBodyStatusOverride(file, "dirty", data.lastError ?? null);
    } else if (data.syncStatus === "synced") {
      this.setWordBodyStatusOverride(file, "synced", null);
    }
  }
  async writeStudylistFrontmatter(file, mutate) {
    await this.writeFrontmatter(file, mutate);
  }
  async ensureManagedWordProperties(file) {
    const openView = this.getOpenMarkdownViewForFile(file);
    if (openView) {
      return {
        skipped: this.syncService?.getWordContext(file) === null,
        changed: false,
        markdown: openView.editor.getValue()
      };
    }
    return ensureManagedWordProperties({
      app: this.app,
      file,
      writeFrontmatter: async (targetFile, mutate) => {
        await this.writeFrontmatter(targetFile, mutate);
      }
    });
  }
  async ensureAllWordManagedFrontmatter() {
    const openPaths = this.getOpenMarkdownFilePaths();
    for (const file of this.managedFiles.getWordFiles()) {
      if (openPaths.has((0, import_obsidian16.normalizePath)(file.path))) {
        continue;
      }
      await this.ensureWordManagedFrontmatter(file);
    }
  }
  async ensureWordManagedFrontmatter(file) {
    if (this.isMarkdownFileOpen(file)) {
      return this.ensureWordManagedFrontmatterForSync(file);
    }
    await this.ensureManagedWordProperties(file);
    const linkId = readEudicLinkId(getFrontmatter(this.app, file));
    if (linkId) {
      return linkId;
    }
    const nextLinkId = createEudicLinkId("word");
    await this.writeFrontmatter(file, (frontmatter) => {
      frontmatter[FRONTMATTER_KEYS.eudicLinkId] = nextLinkId;
    });
    return nextLinkId;
  }
  async ensureReferenceManagedFrontmatter(file) {
    if (!isMarkdownFile3(file) || !this.pathScope.isReferencePath(file.path)) {
      return null;
    }
    const frontmatter = getFrontmatter(this.app, file);
    const existingLinkId = readEudicLinkId(frontmatter);
    const nextLinkId = existingLinkId ?? createEudicLinkId("reference");
    const markdown = await this.app.vault.cachedRead(file);
    if (hasYamlFrontmatter2(markdown)) {
      if (existingLinkId === nextLinkId) {
        return nextLinkId;
      }
      await this.writeFrontmatter(file, (nextFrontmatter) => {
        nextFrontmatter[FRONTMATTER_KEYS.eudicLinkId] = nextLinkId;
      });
      return nextLinkId;
    }
    await this.writeMarkdown(file, prependReferenceFrontmatter(markdown, nextLinkId));
    return nextLinkId;
  }
  async ensureAllReferenceManagedFrontmatter() {
    const openPaths = this.getOpenMarkdownFilePaths();
    for (const file of this.managedFiles.getReferenceFiles()) {
      if (openPaths.has((0, import_obsidian16.normalizePath)(file.path))) {
        continue;
      }
      await this.ensureReferenceManagedFrontmatter(file);
    }
  }
  async getManagedUrlForFile(file) {
    if (this.pathScope.isWordPath(file.path)) {
      const linkId = await this.ensureWordManagedFrontmatter(file);
      return buildManagedFileProtocolUrl(
        this.app,
        this.pathScope,
        file,
        linkId,
        (kind) => kind === "word" ? this.managedFiles.getWordFiles() : this.managedFiles.getReferenceFiles()
      );
    }
    if (this.pathScope.isReferencePath(file.path)) {
      const linkId = await this.ensureReferenceManagedFrontmatter(file);
      if (!linkId) {
        return null;
      }
      return buildManagedFileProtocolUrl(
        this.app,
        this.pathScope,
        file,
        linkId,
        (kind) => kind === "word" ? this.managedFiles.getWordFiles() : this.managedFiles.getReferenceFiles()
      );
    }
    return null;
  }
  async writeMarkdown(file, markdown) {
    this.suppressPath(file.path);
    try {
      await this.app.vault.modify(file, markdown);
      this.refreshUi();
    } catch (error) {
      this.clearSuppression(file.path);
      throw error;
    }
  }
  async writeFrontmatter(file, mutate) {
    this.suppressPath(file.path);
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        mutate(frontmatter);
      });
      this.refreshUi();
    } catch (error) {
      this.clearSuppression(file.path);
      throw error;
    }
  }
  suppressPath(path) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(path);
    this.suppressedWrites.set(normalizedPath, {
      expiresAt: Date.now() + SUPPRESSED_WRITE_TTL_MS
    });
  }
  clearSuppression(path) {
    this.suppressedWrites.delete((0, import_obsidian16.normalizePath)(path));
  }
  consumeSuppressedWrite(path) {
    const normalizedPath = (0, import_obsidian16.normalizePath)(path);
    const entry = this.suppressedWrites.get(normalizedPath);
    if (!entry) {
      return false;
    }
    if (entry.expiresAt < Date.now()) {
      this.suppressedWrites.delete(normalizedPath);
      return false;
    }
    this.suppressedWrites.delete(normalizedPath);
    return true;
  }
};
