const LEADING_HYPHEN_THEMATIC_BREAK_PATTERN = /^[ \t]{0,3}-{3,}[ \t]*$/;

export function protectLeadingThematicBreakFromFrontmatter(markdown: string): string {
  const normalizedMarkdown = markdown.replace(/\r\n?/g, "\n");
  const firstLineBreakIndex = normalizedMarkdown.indexOf("\n");
  const firstLine =
    firstLineBreakIndex === -1 ? normalizedMarkdown : normalizedMarkdown.slice(0, firstLineBreakIndex);

  if (!LEADING_HYPHEN_THEMATIC_BREAK_PATTERN.test(firstLine)) {
    return normalizedMarkdown;
  }

  const remainingMarkdown = firstLineBreakIndex === -1 ? "" : normalizedMarkdown.slice(firstLineBreakIndex + 1);
  const nextMarkdownBlock = remainingMarkdown.replace(/^(?:[ \t]*\n)+/, "");
  return nextMarkdownBlock ? `<hr>\n\n${nextMarkdownBlock}` : "<hr>";
}
