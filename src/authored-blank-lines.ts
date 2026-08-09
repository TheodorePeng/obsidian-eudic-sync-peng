export const AUTHORED_GAP_MARKER_ATTRIBUTE = "data-eudic-authored-gap-id";
export const AUTHORED_GAP_COUNT_ATTRIBUTE = "data-eudic-authored-gap-count";

interface EudicFence {
  character: "`" | "~";
  minimumLength: number;
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function isThematicBreak(line: string): boolean {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
}

function isStandaloneEmbed(line: string): boolean {
  return /^!\[\[[^\]\n]+\]\]$/.test(line.trim());
}

function parseEudicOpeningFence(line: string): EudicFence | null {
  const match = line.match(/^\s*(`{3,}|~{3,})\s*eudic-block(?:\s+.*?)?\s*$/);
  if (!match) {
    return null;
  }

  const token = match[1] ?? "```";
  return {
    character: token[0] === "~" ? "~" : "`",
    minimumLength: token.length,
  };
}

function isMatchingEudicClosingFence(line: string, fence: EudicFence): boolean {
  const tokenPattern = fence.character === "`" ? "`" : "~";
  return new RegExp(`^\\s*${tokenPattern}{${fence.minimumLength},}\\s*$`).test(line);
}

function buildStructuralLineMask(lines: string[]): boolean[] {
  const structuralLines = lines.map(() => false);
  let activeEudicFence: EudicFence | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (activeEudicFence && isMatchingEudicClosingFence(line, activeEudicFence)) {
      structuralLines[index] = true;
      activeEudicFence = null;
      continue;
    }

    if (!activeEudicFence) {
      const openingFence = parseEudicOpeningFence(line);
      if (openingFence) {
        structuralLines[index] = true;
        activeEudicFence = openingFence;
        continue;
      }
    }

    structuralLines[index] = isThematicBreak(line) || isStandaloneEmbed(line);
  }

  return structuralLines;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildGapMarker(markerId: string, blankLines: number): string {
  return `<div ${AUTHORED_GAP_MARKER_ATTRIBUTE}="${escapeHtmlAttribute(markerId)}" ${AUTHORED_GAP_COUNT_ATTRIBUTE}="${blankLines}"></div>`;
}

export function annotateAuthoredBlankLines(markdown: string, markerId: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const structuralLines = buildStructuralLineMask(lines);
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!isBlankLine(line)) {
      output.push(line);
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < lines.length && isBlankLine(lines[index] ?? "")) {
      index += 1;
    }

    if (runStart === 0 || index === lines.length) {
      continue;
    }

    const runLength = index - runStart;
    const touchesStructuralLine = structuralLines[runStart - 1] || structuralLines[index];
    const authoredBlankLines = Math.max(0, runLength - (touchesStructuralLine ? 1 : 0));

    output.push("");
    if (authoredBlankLines > 0) {
      output.push(buildGapMarker(markerId, authoredBlankLines), "");
    }
  }

  return output.join("\n");
}
