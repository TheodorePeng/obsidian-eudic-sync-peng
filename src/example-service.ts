import type { App, EditorPosition, MarkdownView, TAbstractFile } from "obsidian";
import { normalizePath, TFile } from "obsidian";
import { buildExampleAnchorName, buildExampleEmbed } from "./example-links";
import type { PathScope } from "./path-scope";

const GENERATED_REFERENCE_PREFIX = "ref";
const GENERATED_REFERENCE_SUFFIX_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const GENERATED_REFERENCE_SUFFIX_SPACE =
  GENERATED_REFERENCE_SUFFIX_ALPHABET.length * GENERATED_REFERENCE_SUFFIX_ALPHABET.length;

interface PendingExampleBlock {
  content: string;
  from: EditorPosition;
  to: EditorPosition;
}

export interface ExampleMutationResult {
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

function normalizeExampleText(rawText: string): string {
  return rawText.replace(/\r\n?/g, "\n").trim();
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function isFenceLine(line: string): boolean {
  return /^\s*```/.test(line);
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
  let activeFenceStart: number | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (!isFenceLine(lines[lineIndex] ?? "")) {
      continue;
    }

    if (activeFenceStart === null) {
      activeFenceStart = lineIndex;
      continue;
    }

    fenceRanges.push({ start: activeFenceStart, end: lineIndex });
    activeFenceStart = null;
  }

  if (activeFenceStart !== null) {
    fenceRanges.push({ start: activeFenceStart, end: lines.length - 1 });
  }

  return fenceRanges;
}

function rangeTouchesAnyLine(lineStart: number, lineEnd: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((range) => lineStart <= range.end && lineEnd >= range.start);
}

function createExampleFileContent(rawText: string, stem: string): string {
  const normalizedText = normalizeExampleText(rawText);
  if (!normalizedText) {
    throw new Error("Example text is empty.");
  }

  const lines = normalizedText.split("\n");
  let lastContentLine = lines.length - 1;

  while (lastContentLine >= 0 && !lines[lastContentLine]?.trim()) {
    lastContentLine -= 1;
  }

  if (lastContentLine < 0) {
    throw new Error("Example text is empty.");
  }

  const anchorName = buildExampleAnchorName(stem);
  lines[lastContentLine] = `${lines[lastContentLine]!.replace(/\s+$/, "")} ^${anchorName}`;
  return `${lines.join("\n")}\n`;
}

function getPendingExampleBlocks(markdown: string): PendingExampleBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: PendingExampleBlock[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if ((lines[lineIndex] ?? "").trim() !== "```eudic-example") {
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

export function hasPendingExampleBlocks(markdown: string): boolean {
  return getPendingExampleBlocks(markdown).length > 0;
}

export class ExampleService {
  constructor(private readonly app: App, private readonly pathScope: PathScope) {}

  async createExampleFromSelection(view: MarkdownView): Promise<ExampleMutationResult> {
    this.requireMarkdownFile(view.file);
    const editor = view.editor;

    if (!editor.somethingSelected()) {
      throw new Error("Select example text first.");
    }

    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const selectedText = editor.getSelection();
    this.assertReplaceRangeAllowed(editor.getValue(), from, to);

    const createdExample = await this.createExample(selectedText);
    editor.replaceRange(createdExample.embed, from, to, "eudic-sync");
    editor.focus();

    return {
      changed: true,
      createdCount: 1,
      createdRefs: [createdExample.storedRef],
    };
  }

  async createExampleFromCurrentParagraph(view: MarkdownView): Promise<ExampleMutationResult> {
    this.requireMarkdownFile(view.file);
    const editor = view.editor;
    const markdown = editor.getValue();
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const cursor = editor.getCursor();
    this.assertSingleCursorAllowed(lines, cursor.line);

    const paragraphRange = this.getParagraphRange(lines, cursor.line);
    const paragraphText = editor.getRange(paragraphRange.from, paragraphRange.to);
    const createdExample = await this.createExample(paragraphText);
    editor.replaceRange(createdExample.embed, paragraphRange.from, paragraphRange.to, "eudic-sync");
    editor.focus();

    return {
      changed: true,
      createdCount: 1,
      createdRefs: [createdExample.storedRef],
    };
  }

  async extractPendingExamples(view: MarkdownView): Promise<ExampleMutationResult> {
    this.requireMarkdownFile(view.file);
    const editor = view.editor;
    const pendingBlocks = getPendingExampleBlocks(editor.getValue());

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
      const createdExample = await this.createExample(block.content);
      editor.replaceRange(createdExample.embed, block.from, block.to, "eudic-sync");
      createdRefs.unshift(createdExample.storedRef);
    }

    editor.focus();

    return {
      changed: true,
      createdCount: createdRefs.length,
      createdRefs,
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
      throw new Error("Do not create examples from frontmatter.");
    }

    const fenceRanges = getFenceRanges(lines);
    if (rangeTouchesAnyLine(from.line, touchedEndLine, fenceRanges)) {
      throw new Error("Do not create examples from inside an existing code fence.");
    }

    if (!editorRangeHasMeaningfulText(lines, from, to)) {
      throw new Error("The selected example text is empty.");
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
      throw new Error("Place the cursor on a non-empty example paragraph first.");
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

  private async createExample(rawText: string): Promise<{ storedRef: string; embed: string }> {
    const exampleFolderPath = this.pathScope.getPrimaryReferenceFolderPath();
    if (!exampleFolderPath) {
      throw new Error("No reference folder is configured.");
    }

    await this.ensureFolderPath(exampleFolderPath);

    let stem = "";
    let exampleFilePath = "";

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
        const candidatePath = normalizePath(`${exampleFolderPath}/${candidateStem}.md`);
        if (this.app.vault.getAbstractFileByPath(candidatePath)) {
          continue;
        }

        stem = candidateStem;
        exampleFilePath = candidatePath;
        break;
      }

      if (stem && exampleFilePath) {
        break;
      }
    }

    const fileContent = createExampleFileContent(rawText, stem);
    await this.app.vault.create(exampleFilePath, fileContent);

    const storedRef = this.pathScope.toStoredReferenceMarkdownStem(exampleFilePath);
    if (!storedRef) {
      throw new Error(`Failed to resolve the created reference path: ${exampleFilePath}`);
    }

    return {
      storedRef,
      embed: buildExampleEmbed(storedRef),
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
