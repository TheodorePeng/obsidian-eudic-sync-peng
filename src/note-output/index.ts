import type { EudicNoteOutputMode } from "../types";
import { buildNoteOutputBlocks, type NoteOutputLinkResolverContext } from "./dom-parser";
import type { NoteOutputBlock, NoteOutputInline } from "./model";
import { serializeNoteOutputBlocks } from "./serializer";

export function buildFinalNoteHtml(
  renderedHtml: string,
  mode: EudicNoteOutputMode,
  linkResolver?: NoteOutputLinkResolverContext,
): string {
  const blocks = buildNoteOutputBlocks(renderedHtml, linkResolver);
  return serializeNoteOutputBlocks(blocks, mode);
}

function createTextInline(text: string): NoteOutputInline {
  return { type: "text", text };
}

function buildLinkedWordHeadingBlock(word: string, href: string): NoteOutputBlock {
  return {
    type: "paragraph",
    inlines: [
      {
        type: "link",
        href,
        children: [
          {
            type: "bold",
            children: [createTextInline(word)],
          },
        ],
      },
    ],
  };
}

export function buildFinalWordNoteHtml(
  renderedHtml: string,
  mode: EudicNoteOutputMode,
  word: string,
  href: string,
  linkResolver?: NoteOutputLinkResolverContext,
): string {
  const blocks = buildNoteOutputBlocks(renderedHtml, linkResolver);
  return serializeNoteOutputBlocks([buildLinkedWordHeadingBlock(word, href), ...blocks], mode);
}
