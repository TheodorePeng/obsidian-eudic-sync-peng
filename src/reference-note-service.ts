import type { App, EditorPosition, MarkdownView, TAbstractFile } from "obsidian";
import { normalizePath, TFile } from "obsidian";
import { findEudicBlockAtLine, isClosingEudicBlockFenceLine, parseEudicBlockFenceLine } from "./eudic-block";
import { buildReferenceAnchorName, buildReferenceEmbed } from "./reference-links";
import type { PathScope } from "./path-scope";

const GENERATED_REFERENCE_PREFIX = "ref";
const GENERATED_REFERENCE_SUFFIX_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const GENERATED_REFERENCE_SUFFIX_SPACE =
  GENERATED_REFERENCE_SUFFIX_ALPHABET.length * GENERATED_REFERENCE_SUFFIX_ALPHABET.length;
const PENDING_REFERENCE_FENCES = new Set(["```eudic-reference", "```eudic-example"]);

interface PendingReferenceBlock {
  content: string;
  from: EditorPosition;
  to: EditorPosition;
}

export interface ReferenceMutationResult {
  changed: boolean;
  createdCount: number;
  createdRefs: string[];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatTimestampStem(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function randomReferenceSuffix(): string {
  const alphabet = GENERATED_REFERENCE_SUFFIX_ALPHABET;
  return alphabet[Math.floor(Math.random() * alphabet.length)]! + alphabet[Math.floor(Math.random() * alphabet.length)]!;
}

function normalizeReferenceText(rawText: string): string {
  return rawText.replace(/\r\n?/g, "\n").trim();
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function isFenceLine(line: string): boolean {
  return /^\s*(?:`{3,}|~{3,})/.test(line);
}

function isPendingReferenceFence(line: string): boolean {
  return PENDING_REFERENCE_FENCES.has(line.trim());
}

function getTouchedEndLine(from: EditorPosition, to: EditorPosition): number {
  if (to.ch === 0 && to.line > from.line) {
    return to.line - 1;
  }

  return to.line;
}

function getFrontmatterEndLine(lines: string[]): number | null {
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

function getFenceRanges(lines: string[]): Array<{ start: number; end: number }> {
  const fenceRanges: Array<{ start: number; end: number }> = [];
  let activeGenericFenceStart: number | null = null;
  let activeGenericFenceMarker: string | null = null;
  let activeEudicBlockFence: { openingLine: number; fenceToken: string } | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const fenceMatch = currentLine.match(/^\s*(```+|~~~+)/);

    if (activeGenericFenceStart !== null) {
      if (fenceMatch && activeGenericFenceMarker === fenceMatch[1]![0]) {
        fenceRanges.push({ start: activeGenericFenceStart, end: lineIndex });
        activeGenericFenceStart = null;
        activeGenericFenceMarker = null;
      }
      continue;
    }

    if (activeEudicBlockFence) {
      if (isClosingEudicBlockFenceLine(currentLine, activeEudicBlockFence.fenceToken)) {
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
        fenceToken: eudicBlockFence.fenceToken,
      };
      continue;
    }

    if (!fenceMatch) {
      continue;
    }

    activeGenericFenceStart = lineIndex;
    activeGenericFenceMarker = fenceMatch[1]![0];
  }

  if (activeGenericFenceStart !== null) {
    fenceRanges.push({ start: activeGenericFenceStart, end: lines.length - 1 });
  }

  if (activeEudicBlockFence) {
    fenceRanges.push({ start: activeEudicBlockFence.openingLine, end: activeEudicBlockFence.openingLine });
  }

  return fenceRanges;
}

function rangeTouchesAnyLine(lineStart: number, lineEnd: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((range) => lineStart <= range.end && lineEnd >= range.start);
}

function getStandaloneFencedBlockClosingLine(lines: string[], lastContentLine: number): number | null {
  const openingMatch = (lines[0] ?? "").match(/^\s*(`{3,}|~{3,})/);
  if (!openingMatch) {
    return null;
  }

  const fenceToken = openingMatch[1]!;
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

function createReferenceFileContent(rawText: string, stem: string): string {
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
    return `${lines.join("\n")}\n`;
  }

  lines[lastContentLine] = `${lines[lastContentLine]!.replace(/\s+$/, "")} ^${anchorName}`;
  return `${lines.join("\n")}\n`;
}

function getPendingReferenceBlocks(markdown: string): PendingReferenceBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: PendingReferenceBlock[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (!isPendingReferenceFence(lines[lineIndex] ?? "")) {
      continue;
    }

    let closingLineIndex: number | null = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if ((lines[candidateIndex] ?? "").trim() === "```") {
        closingLineIndex = candidateIndex;
        break;
      }
    }

    if (closingLineIndex === null) {
      continue;
    }

    const to: EditorPosition =
      closingLineIndex < lines.length - 1
        ? { line: closingLineIndex + 1, ch: 0 }
        : { line: closingLineIndex, ch: (lines[closingLineIndex] ?? "").length };

    blocks.push({
      content: lines.slice(lineIndex + 1, closingLineIndex).join("\n"),
      from: { line: lineIndex, ch: 0 },
      to,
    });

    lineIndex = closingLineIndex;
  }

  return blocks;
}

export function hasPendingReferenceBlocks(markdown: string): boolean {
  return getPendingReferenceBlocks(markdown).length > 0;
}

export class ReferenceNoteService {
  constructor(private readonly app: App, private readonly pathScope: PathScope) {}

  async createReferenceFromSelection(view: MarkdownView): Promise<ReferenceMutationResult> {
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
      createdRefs: [createdReference.storedRef],
    };
  }

  async createReferenceFromCurrentParagraph(view: MarkdownView): Promise<ReferenceMutationResult> {
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
      createdRefs: [createdReference.storedRef],
    };
  }

  async extractPendingReferences(view: MarkdownView): Promise<ReferenceMutationResult> {
    this.requireMarkdownFile(view.file);
    const editor = view.editor;
    const pendingBlocks = getPendingReferenceBlocks(editor.getValue());

    if (pendingBlocks.length === 0) {
      return {
        changed: false,
        createdCount: 0,
        createdRefs: [],
      };
    }

    const createdRefs: string[] = [];

    for (let blockIndex = pendingBlocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = pendingBlocks[blockIndex]!;
      const createdReference = await this.createReference(block.content);
      editor.replaceRange(createdReference.embed, block.from, block.to, "eudic-sync");
      createdRefs.unshift(createdReference.storedRef);
    }

    editor.focus();

    return {
      changed: true,
      createdCount: createdRefs.length,
      createdRefs,
    };
  }

  async extractCurrentEudicBlockToReference(view: MarkdownView): Promise<ReferenceMutationResult> {
    this.requireMarkdownFile(view.file);
    const editor = view.editor;
    const block = findEudicBlockAtLine(editor.getValue(), editor.getCursor().line);
    if (!block) {
      throw new Error("Place the cursor inside an eudic-block first.");
    }

    if (block.closingLine === null) {
      throw new Error("Complete the current eudic-block closing fence first.");
    }

    const from: EditorPosition = { line: block.openingLine, ch: 0 };
    const to: EditorPosition = { line: block.closingLine, ch: editor.getLine(block.closingLine).length };
    const blockMarkdown = editor.getRange(from, to);
    const createdReference = await this.createReference(blockMarkdown);
    editor.replaceRange(createdReference.embed, from, to, "eudic-sync");
    editor.focus();

    return {
      changed: true,
      createdCount: 1,
      createdRefs: [createdReference.storedRef],
    };
  }

  private requireMarkdownFile(file: TAbstractFile | null): TFile {
    if (!(file instanceof TFile) || file.extension !== "md") {
      throw new Error("Open a Markdown word note first.");
    }

    return file;
  }

  private assertReplaceRangeAllowed(markdown: string, from: EditorPosition, to: EditorPosition): void {
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

  private assertSingleCursorAllowed(lines: string[], lineIndex: number): void {
    const frontmatterEndLine = getFrontmatterEndLine(lines);
    if (frontmatterEndLine !== null && lineIndex <= frontmatterEndLine) {
      throw new Error("Move the cursor out of frontmatter first.");
    }

    const fenceRanges = getFenceRanges(lines);
    if (rangeTouchesAnyLine(lineIndex, lineIndex, fenceRanges)) {
      throw new Error("Move the cursor out of an existing code fence first.");
    }
  }

  private getParagraphRange(lines: string[], lineIndex: number): { from: EditorPosition; to: EditorPosition } {
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
      to: { line: endLine, ch: (lines[endLine] ?? "").length },
    };
  }

  private async createReference(rawText: string): Promise<{ storedRef: string; embed: string }> {
    const referenceFolderPath = this.pathScope.getPrimaryReferenceFolderPath();
    if (!referenceFolderPath) {
      throw new Error("No reference folder is configured.");
    }

    await this.ensureFolderPath(referenceFolderPath);

    let stem = "";
    let referenceFilePath = "";

    for (;;) {
      const timestamp = formatTimestampStem(new Date());
      const triedSuffixes = new Set<string>();

      while (triedSuffixes.size < GENERATED_REFERENCE_SUFFIX_SPACE) {
        const suffix = randomReferenceSuffix();
        if (triedSuffixes.has(suffix)) {
          continue;
        }
        triedSuffixes.add(suffix);

        const candidateStem = `${GENERATED_REFERENCE_PREFIX}-${timestamp}-${suffix}`;
        const candidatePath = normalizePath(`${referenceFolderPath}/${candidateStem}.md`);
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
      embed: buildReferenceEmbed(storedRef),
    };
  }

  private async ensureFolderPath(folderPath: string): Promise<void> {
    const normalizedFolderPath = normalizePath(folderPath);
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
}

function editorRangeHasMeaningfulText(lines: string[], from: EditorPosition, to: EditorPosition): boolean {
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
