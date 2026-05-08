export const EMPTY_WORD_BODY_SYNC_ERROR =
  "Word body is empty; skipped sync to avoid overwriting the Eudic note.";

export function stripYamlFrontmatter(markdown: string): string {
  const body = markdown.replace(/^\uFEFF/, "");
  if (!body.startsWith("---")) {
    return body;
  }

  return body.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
}

function splitLines(markdown: string): string[] {
  return markdown.replace(/\r\n?/g, "\n").split("\n");
}

function isVisualBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

export function trimBoundaryBlankLines(markdownBody: string): string {
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

export function prepareSyncBodyMarkdown(rawMarkdown: string): string {
  return trimBoundaryBlankLines(stripYamlFrontmatter(rawMarkdown));
}
