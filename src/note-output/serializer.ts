import type { EudicNoteOutputMode } from "../types";
import type { NoteOutputBlock, NoteOutputInline, NoteOutputListItem, NoteOutputUnorderedList } from "./model";

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function normalizeInlineOutput(output: string, mode: EudicNoteOutputMode): string {
  const collapsedSpaces = output.replace(/[ \t\f\r\v]+/g, " ");

  if (mode === "minimal") {
    return collapsedSpaces
      .replace(/ *\n */g, "\n")
      .trim();
  }

  return collapsedSpaces
    .replace(/\s*<br>\s*/g, "<br>")
    .trim();
}

function renderInline(inline: NoteOutputInline, mode: EudicNoteOutputMode): string {
  switch (inline.type) {
    case "text":
      return escapeText(inline.text);
    case "lineBreak":
      return mode === "minimal" ? "\n" : "<br>";
    case "bold": {
      const children = renderInlines(inline.children, mode);
      return children ? `<b>${children}</b>` : "";
    }
    case "link": {
      const children = renderInlines(inline.children, mode) || escapeText(inline.href);
      return `<a href="${escapeAttribute(inline.href)}">${children}</a>`;
    }
    case "image": {
      const alt = inline.alt ? ` alt="${escapeAttribute(inline.alt)}"` : "";
      return `<a href="${escapeAttribute(inline.href)}" target="_blank" style="float:right;margin:0 0 2px 2px;"><img src="${escapeAttribute(inline.src)}" width="100"${alt}></a>`;
    }
  }
}

function renderInlines(inlines: NoteOutputInline[], mode: EudicNoteOutputMode): string {
  const rendered = inlines
    .map((inline) => renderInline(inline, mode))
    .join("");

  return normalizeInlineOutput(rendered, mode);
}

function getUnorderedListPadding(depth: number): string {
  return depth === 0 ? "1.1em" : "1em";
}

function getUnorderedListMarkerType(depth: number): string {
  return depth === 0 ? "disc" : "circle";
}

function renderUnorderedList(list: NoteOutputUnorderedList, mode: EudicNoteOutputMode, depth: number): string {
  const items = list.items
    .map((item) => renderListItem(item, mode, depth))
    .filter((rendered) => rendered.length > 0)
    .join("");

  if (!items) {
    return "";
  }

  const markerType = getUnorderedListMarkerType(depth);
  return `<ul type="${markerType}" style="margin:0;padding-left:${getUnorderedListPadding(depth)};list-style-type:${markerType};list-style-position:outside">${items}</ul>`;
}

function renderListItem(item: NoteOutputListItem, mode: EudicNoteOutputMode, depth: number): string {
  const rendered = renderBlocks(item.blocks, mode, "list-item", depth + 1);
  return rendered ? `<li style="margin:0;display:list-item;list-style-type:inherit;list-style-position:outside">${rendered}</li>` : "";
}

function renderBlock(block: NoteOutputBlock, mode: EudicNoteOutputMode, depth: number): string {
  switch (block.type) {
    case "separator":
      return "<hr>";
    case "paragraph":
      return renderInlines(block.inlines, mode);
    case "unorderedList":
      return renderUnorderedList(block, mode, depth);
  }
}

function getBlockJoiner(previous: NoteOutputBlock, next: NoteOutputBlock, mode: EudicNoteOutputMode): string {
  if (mode === "minimal") {
    return "\n";
  }

  if (
    previous.type === "separator"
    || next.type === "separator"
    || previous.type === "unorderedList"
    || next.type === "unorderedList"
  ) {
    return "";
  }

  return "<br>";
}

function renderBlocks(
  blocks: NoteOutputBlock[],
  mode: EudicNoteOutputMode,
  _context: "top-level" | "list-item",
  depth: number,
): string {
  const meaningfulBlocks = blocks
    .map((block) => ({ block, rendered: renderBlock(block, mode, depth) }))
    .filter(({ rendered }) => rendered.length > 0);

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

export function serializeNoteOutputBlocks(blocks: NoteOutputBlock[], mode: EudicNoteOutputMode): string {
  return renderBlocks(blocks, mode, "top-level", 0);
}
