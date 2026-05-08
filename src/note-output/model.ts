export interface NoteOutputText {
  type: "text";
  text: string;
}

export interface NoteOutputBold {
  type: "bold";
  children: NoteOutputInline[];
}

export interface NoteOutputLink {
  type: "link";
  href: string;
  children: NoteOutputInline[];
}

export interface NoteOutputLineBreak {
  type: "lineBreak";
}

export interface NoteOutputImage {
  type: "image";
  src: string;
  href: string;
  alt: string;
}

export type NoteOutputInline = NoteOutputText | NoteOutputBold | NoteOutputLink | NoteOutputLineBreak | NoteOutputImage;

export interface NoteOutputParagraph {
  type: "paragraph";
  inlines: NoteOutputInline[];
}

export interface NoteOutputSeparator {
  type: "separator";
}

export interface NoteOutputListItem {
  blocks: NoteOutputBlock[];
}

export interface NoteOutputUnorderedList {
  type: "unorderedList";
  items: NoteOutputListItem[];
}

export type NoteOutputBlock = NoteOutputParagraph | NoteOutputSeparator | NoteOutputUnorderedList;
