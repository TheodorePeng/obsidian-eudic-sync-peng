import type { NoteOutputBlock, NoteOutputInline, NoteOutputListItem } from "./model";

const BLOCK_TAGS = new Set([
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
  "ul",
]);

const PARAGRAPH_TAGS = new Set(["blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "p", "pre"]);
const STRIP_TAGS = new Set(["script", "style"]);
const STRIP_CLASSES = new Set([
  "copy-code-button",
  "embed-title",
  "embedded-backlinks",
  "frontmatter",
  "markdown-embed-title",
  "metadata-container",
  "mod-header",
  "mod-footer",
  "snw-block-preview",
  "snw-reference",
]);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ");
}

function hasStripClass(element: Element): boolean {
  return Array.from(element.classList).some((className) => STRIP_CLASSES.has(className));
}

function shouldStripElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();

  if (STRIP_TAGS.has(tagName)) {
    return true;
  }

  if (hasStripClass(element)) {
    return true;
  }

  if (
    element.hasAttribute("data-snw-type")
    || element.hasAttribute("data-snw-key")
    || element.hasAttribute("data-snw-filepath")
  ) {
    return true;
  }

  if (tagName === "span" && element.hasAttribute("src")) {
    const hasEmbeddedContent = element.childElementCount > 0 || normalizeText(element.textContent ?? "").trim().length > 0;
    return !hasEmbeddedContent;
  }

  return false;
}

const BLOCKED_HREF_SCHEMES = new Set(["data", "javascript", "vbscript"]);
const ALLOWED_IMAGE_SCHEMES = new Set(["http", "https"]);

function getHrefScheme(href: string): string | null {
  const match = href.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  return match?.[1]?.toLowerCase() ?? null;
}

function isAllowedHref(href: string | null): href is string {
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

export function isAllowedNoteOutputImageSrc(src: string | null): src is string {
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

function createImageInline(element: Element, hrefOverride?: string): NoteOutputInline | null {
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
    alt: normalizeText(element.getAttribute("alt") ?? "").trim(),
  };
}

function hasDirectBlockChildren(element: Element): boolean {
  return Array.from(element.childNodes).some((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const childElement = child as Element;
    if (shouldStripElement(childElement)) {
      return false;
    }

    const tagName = childElement.tagName.toLowerCase();
    return tagName === "hr" || BLOCK_TAGS.has(tagName);
  });
}

function hasMeaningfulInline(inlines: NoteOutputInline[]): boolean {
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

function collectInlineFromChildren(childNodes: NodeListOf<ChildNode> | ChildNode[]): NoteOutputInline[] {
  const parts: NoteOutputInline[] = [];

  for (const child of Array.from(childNodes)) {
    parts.push(...collectInlineFromNode(child));
  }

  return parts;
}

function collectInlineFromNode(node: ChildNode): NoteOutputInline[] {
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

  const element = node as Element;
  if (shouldStripElement(element)) {
    return [];
  }

  const tagName = element.tagName.toLowerCase();

  if (tagName === "br") {
    return [{ type: "lineBreak" }];
  }

  if (tagName === "strong" || tagName === "b") {
    const children = collectInlineFromChildren(element.childNodes);
    return hasMeaningfulInline(children) ? [{ type: "bold", children }] : [];
  }

  if (tagName === "a") {
    const href = element.getAttribute("href");
    const directImageChildren = Array.from(element.childNodes)
      .filter((child): child is Element => child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === "img");

    if (isAllowedHref(href)) {
      const imageChildren = directImageChildren
        .flatMap((imageElement) => createImageInline(imageElement, href.trim()))
        .filter((inline): inline is NoteOutputInline => !!inline);
      if (imageChildren.length > 0) {
        const nonImageChildren = Array.from(element.childNodes)
          .filter((child) => !directImageChildren.includes(child as Element));
        return [...imageChildren, ...collectInlineFromChildren(nonImageChildren)];
      }

      const children = collectInlineFromChildren(element.childNodes);
      return [{ type: "link", href: href.trim(), children }];
    }

    const children = collectInlineFromChildren(element.childNodes);
    return children;
  }

  if (tagName === "img") {
    const image = createImageInline(element);
    return image ? [image] : [];
  }

  return collectInlineFromChildren(element.childNodes);
}

function createTextInline(text: string): NoteOutputInline {
  return { type: "text", text };
}

function createParagraph(inlines: NoteOutputInline[], prefixInlines: NoteOutputInline[] = []): NoteOutputBlock[] {
  const nextInlines = prefixInlines.length > 0 ? [...prefixInlines, ...inlines] : inlines;
  return hasMeaningfulInline(nextInlines) ? [{ type: "paragraph", inlines: nextInlines }] : [];
}

function createOrderedListPrefixInlines(index: number): NoteOutputInline[] {
  return [
    {
      type: "bold",
      children: [createTextInline(`${index}.`)],
    },
    createTextInline(" "),
  ];
}

function prependPrefixToFirstParagraphBlock(blocks: NoteOutputBlock[], prefixInlines: NoteOutputInline[]): NoteOutputBlock[] {
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
      inlines: [...prefixInlines, ...block.inlines],
    };
    return prefixedBlocks;
  }

  return prefixedBlocks;
}

function collectPrefixedBlocksFromListItem(element: Element, prefixInlines: NoteOutputInline[]): NoteOutputBlock[] {
  const blocks: NoteOutputBlock[] = [];
  let pendingInlineNodes: ChildNode[] = [];
  let hasPrefixedParagraph = false;

  const flushPendingInlineNodes = (): void => {
    const paragraphBlocks = createParagraph(collectInlineFromChildren(pendingInlineNodes), hasPrefixedParagraph ? [] : prefixInlines);
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

    const childElement = child as Element;
    if (shouldStripElement(childElement)) {
      continue;
    }

    const tagName = childElement.tagName.toLowerCase();
    if (tagName !== "hr" && !BLOCK_TAGS.has(tagName)) {
      pendingInlineNodes.push(child);
      continue;
    }

    flushPendingInlineNodes();

    let childBlocks = collectBlocksFromNode(child);
    if (!hasPrefixedParagraph) {
      childBlocks = prependPrefixToFirstParagraphBlock(childBlocks, prefixInlines);
      hasPrefixedParagraph = childBlocks.some((block) => block.type === "paragraph");
    }

    blocks.push(...childBlocks);
  }

  flushPendingInlineNodes();
  return blocks;
}

function collectStructuredListItem(element: Element): NoteOutputListItem | null {
  const blocks: NoteOutputBlock[] = [];
  let pendingInlineNodes: ChildNode[] = [];

  const flushPendingInlineNodes = (): void => {
    const paragraphBlocks = createParagraph(collectInlineFromChildren(pendingInlineNodes));
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

    const childElement = child as Element;
    if (shouldStripElement(childElement)) {
      continue;
    }

    const tagName = childElement.tagName.toLowerCase();
    if (tagName !== "hr" && !BLOCK_TAGS.has(tagName)) {
      pendingInlineNodes.push(child);
      continue;
    }

    flushPendingInlineNodes();
    blocks.push(...collectBlocksFromNode(child));
  }

  flushPendingInlineNodes();
  const normalizedBlocks = normalizeBlocks(blocks);
  if (normalizedBlocks.length === 0) {
    return null;
  }

  return { blocks: normalizedBlocks };
}

function readIntegerAttribute(element: Element, attributeName: string): number | null {
  const rawValue = element.getAttribute(attributeName);
  if (typeof rawValue !== "string") {
    return null;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectOrderedListBlocks(element: Element): NoteOutputBlock[] {
  const blocks: NoteOutputBlock[] = [];
  let nextIndex = readIntegerAttribute(element, "start") ?? 1;

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      blocks.push(...collectBlocksFromNode(child));
      continue;
    }

    const childElement = child as Element;
    if (shouldStripElement(childElement)) {
      continue;
    }

    if (childElement.tagName.toLowerCase() !== "li") {
      blocks.push(...collectBlocksFromNode(child));
      continue;
    }

    const explicitIndex = readIntegerAttribute(childElement, "value");
    const currentIndex = explicitIndex ?? nextIndex;
    blocks.push(...collectPrefixedBlocksFromListItem(childElement, createOrderedListPrefixInlines(currentIndex)));
    nextIndex = currentIndex + 1;
  }

  return blocks;
}

function collectUnorderedListBlocks(element: Element): NoteOutputBlock[] {
  const blocks: NoteOutputBlock[] = [];
  const items: NoteOutputListItem[] = [];

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      const textBlocks = collectBlocksFromNode(child);
      if (textBlocks.length > 0) {
        if (items.length > 0) {
          blocks.push({ type: "unorderedList", items: [...items] });
          items.length = 0;
        }
        blocks.push(...textBlocks);
      }
      continue;
    }

    const childElement = child as Element;
    if (shouldStripElement(childElement)) {
      continue;
    }

    if (childElement.tagName.toLowerCase() !== "li") {
      if (items.length > 0) {
        blocks.push({ type: "unorderedList", items: [...items] });
        items.length = 0;
      }
      blocks.push(...collectBlocksFromNode(child));
      continue;
    }

    const item = collectStructuredListItem(childElement);
    if (item) {
      items.push(item);
    }
  }

  if (items.length > 0) {
    blocks.push({ type: "unorderedList", items });
  }

  return blocks;
}

function collectBlocksFromChildren(childNodes: NodeListOf<ChildNode> | ChildNode[]): NoteOutputBlock[] {
  const blocks: NoteOutputBlock[] = [];

  for (const child of Array.from(childNodes)) {
    blocks.push(...collectBlocksFromNode(child));
  }

  return blocks;
}

function collectBlocksFromNode(node: ChildNode): NoteOutputBlock[] {
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

  const element = node as Element;
  if (shouldStripElement(element)) {
    return [];
  }

  const tagName = element.tagName.toLowerCase();

  if (tagName === "hr") {
    return [{ type: "separator" }];
  }

  if (tagName === "ol") {
    return collectOrderedListBlocks(element);
  }

  if (tagName === "ul") {
    return collectUnorderedListBlocks(element);
  }

  if (PARAGRAPH_TAGS.has(tagName)) {
    return createParagraph(collectInlineFromChildren(element.childNodes));
  }

  if (tagName === "li") {
    const item = collectStructuredListItem(element);
    return item ? item.blocks : [];
  }

  if (hasDirectBlockChildren(element)) {
    return collectBlocksFromChildren(element.childNodes);
  }

  return createParagraph(collectInlineFromChildren(element.childNodes));
}

function normalizeBlocks(blocks: NoteOutputBlock[]): NoteOutputBlock[] {
  const normalized: NoteOutputBlock[] = [];

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

export function buildNoteOutputBlocks(renderedHtml: string): NoteOutputBlock[] {
  const documentRoot = new DOMParser().parseFromString(`<body>${renderedHtml}</body>`, "text/html");
  return normalizeBlocks(collectBlocksFromChildren(documentRoot.body.childNodes));
}
