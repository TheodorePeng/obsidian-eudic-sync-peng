import assert from "node:assert/strict";
import {
  AUTHORED_GAP_COUNT_ATTRIBUTE,
  AUTHORED_GAP_MARKER_ATTRIBUTE,
  annotateAuthoredBlankLines,
} from "../src/authored-blank-lines";
import { buildNoteOutputBlocks } from "../src/note-output/dom-parser";
import { buildFinalNoteHtml } from "../src/note-output";
import { serializeNoteOutputBlocks } from "../src/note-output/serializer";
import type { NoteOutputBlock } from "../src/note-output/model";
import { transformMarkdownForEudicRender } from "../src/html-renderer";
import type { App, TFile } from "obsidian";

const markerId = "render-123";
const gapMarker = (count: number, id = markerId): string =>
  `<div ${AUTHORED_GAP_MARKER_ATTRIBUTE}="${id}" ${AUTHORED_GAP_COUNT_ATTRIBUTE}="${count}"></div>`;

assert.equal(annotateAuthoredBlankLines("A\nB", markerId), "A\nB");
assert.equal(
  annotateAuthoredBlankLines("A\n\nB", markerId),
  `A\n\n${gapMarker(1)}\n\nB`,
);
assert.equal(
  annotateAuthoredBlankLines("A\n\n\nB", markerId),
  `A\n\n${gapMarker(2)}\n\nB`,
);

for (const separator of ["---", "***", "___", "- - -", "  * * *  "]) {
  assert.equal(
    annotateAuthoredBlankLines(`A\n\n${separator}`, markerId),
    `A\n\n${separator}`,
  );
  assert.equal(
    annotateAuthoredBlankLines(`A\n\n\n${separator}`, markerId),
    `A\n\n${gapMarker(1)}\n\n${separator}`,
  );
}

assert.equal(
  annotateAuthoredBlankLines("---\n\n***", markerId),
  "---\n\n***",
);
assert.equal(
  annotateAuthoredBlankLines("---\n\n\n***", markerId),
  `---\n\n${gapMarker(1)}\n\n***`,
);
assert.equal(
  annotateAuthoredBlankLines("    ---\n\nB", markerId),
  `    ---\n\n${gapMarker(1)}\n\nB`,
);

assert.equal(
  annotateAuthoredBlankLines("``` eudic-block kind=Cog.\n\nbody\n```", markerId),
  "``` eudic-block kind=Cog.\n\nbody\n```",
);
assert.equal(
  annotateAuthoredBlankLines("``` eudic-block kind=Cog.\n\n\nbody\n```", markerId),
  `\`\`\` eudic-block kind=Cog.\n\n${gapMarker(1)}\n\nbody\n\`\`\``,
);
assert.equal(
  annotateAuthoredBlankLines("``` eudic-block kind=Cog.\nbody\n```\n\nnext", markerId),
  "``` eudic-block kind=Cog.\nbody\n```\n\nnext",
);
assert.equal(
  annotateAuthoredBlankLines("```js\ncode\n```\n\nnext", markerId),
  `\`\`\`js\ncode\n\`\`\`\n\n${gapMarker(1)}\n\nnext`,
);

assert.equal(
  annotateAuthoredBlankLines("A\n\n![[References/ref#^main]]", markerId),
  "A\n\n![[References/ref#^main]]",
);
assert.equal(
  annotateAuthoredBlankLines("A\n\n\n![[References/ref#^main]]", markerId),
  `A\n\n${gapMarker(1)}\n\n![[References/ref#^main]]`,
);
assert.equal(
  annotateAuthoredBlankLines("A\n\n![[ref]] suffix", markerId),
  `A\n\n${gapMarker(1)}\n\n![[ref]] suffix`,
);

assert.equal(
  annotateAuthoredBlankLines("\n \t\nA\nB\n\t\n", markerId),
  "A\nB",
);
assert.equal(
  annotateAuthoredBlankLines("A\r\n\r\nB", markerId),
  `A\n\n${gapMarker(1)}\n\nB`,
);
assert.equal(
  annotateAuthoredBlankLines("A\n \t \nB", markerId),
  `A\n\n${gapMarker(1)}\n\nB`,
);

assert.equal(
  annotateAuthoredBlankLines("A\n\nB", `id\"&<>`),
  `A\n\n${gapMarker(1, "id&quot;&amp;&lt;&gt;")}\n\nB`,
);
assert.equal(annotateAuthoredBlankLines("", markerId), "");
assert.equal(annotateAuthoredBlankLines("\n\n", markerId), "");

const paragraph = (text: string): NoteOutputBlock => ({
  type: "paragraph",
  inlines: [{ type: "text", text }],
});

const renderedGap = (count: string, id = markerId, content = ""): string =>
  `<div ${AUTHORED_GAP_MARKER_ATTRIBUTE}="${id}" ${AUTHORED_GAP_COUNT_ATTRIBUTE}="${count}">${content}</div>`;

const parsedGapBlocks = buildNoteOutputBlocks(
  `<p>A</p>${renderedGap("1")}<p>B</p>`,
  undefined,
  markerId,
);
assert.deepEqual(parsedGapBlocks, [
  paragraph("A"),
  { type: "authoredGap", blankLines: 1 },
  paragraph("B"),
]);
assert.equal(serializeNoteOutputBlocks(parsedGapBlocks, "minimal"), "A\n\nB");
assert.equal(serializeNoteOutputBlocks(parsedGapBlocks, "compatible"), "A<br><br>B");

const mergedGapBlocks = buildNoteOutputBlocks(
  `${renderedGap("7")}<p>A</p>${renderedGap("1")}${renderedGap("2")}<p>B</p>${renderedGap("9")}`,
  undefined,
  markerId,
);
assert.deepEqual(mergedGapBlocks, [
  paragraph("A"),
  { type: "authoredGap", blankLines: 3 },
  paragraph("B"),
]);
assert.equal(serializeNoteOutputBlocks(mergedGapBlocks, "minimal"), "A\n\n\n\nB");
assert.equal(serializeNoteOutputBlocks(mergedGapBlocks, "compatible"), "A<br><br><br><br>B");

for (const invalidCount of ["0", "-1", "1.5", "NaN", "9007199254740992"]) {
  assert.equal(
    serializeNoteOutputBlocks(
      buildNoteOutputBlocks(
        `<p>A</p>${renderedGap(invalidCount, markerId, "Visible")}<p>B</p>`,
        undefined,
        markerId,
      ),
      "minimal",
    ),
    "A\nVisible\nB",
  );
}

assert.equal(
  serializeNoteOutputBlocks(
    buildNoteOutputBlocks(
      `<p>A</p>${renderedGap("2", "different-render", "Visible")}<p>B</p>`,
      undefined,
      markerId,
    ),
    "minimal",
  ),
  "A\nVisible\nB",
);

for (const markerLikeHtml of [
  `<span ${AUTHORED_GAP_MARKER_ATTRIBUTE}="${markerId}" ${AUTHORED_GAP_COUNT_ATTRIBUTE}="2">Visible</span>`,
  renderedGap("2", markerId, "Visible"),
]) {
  assert.equal(
    serializeNoteOutputBlocks(
      buildNoteOutputBlocks(`<p>A</p>${markerLikeHtml}<p>B</p>`, undefined, markerId),
      "minimal",
    ),
    "A\nVisible\nB",
  );
}

const listWithGap = buildNoteOutputBlocks(
  `<ul><li><p>A</p>${renderedGap("1")}<p>B</p></li></ul>`,
  undefined,
  markerId,
);
assert.equal(
  serializeNoteOutputBlocks(listWithGap, "minimal"),
  '<ul type="disc" style="margin:0;padding-left:1.1em;list-style-type:disc;list-style-position:outside"><li style="margin:0;display:list-item;list-style-type:inherit;list-style-position:outside">A\n\nB</li></ul>',
);

const transformApp = {} as App;
const dismissLikeMarkdown = [
  "``` eudic-block kind=v.",
  "辞退/解雇；",
  "```",
  "",
  "![[References/ref-syn#^main]]",
  "",
  "",
  "``` eudic-block kind=Cog.",
  "dismiss v. → dismissal n.",
  "```",
  "",
  "---",
  "``` eudic-block kind=Phr.",
  "1. first",
  "",
  "2. second",
  "```",
].join("\n");
const transformedDismissLikeMarkdown = await transformMarkdownForEudicRender(
  transformApp,
  undefined,
  dismissLikeMarkdown,
  "Words/dismiss.md",
  undefined,
  markerId,
);
assert.equal(
  transformedDismissLikeMarkdown.match(new RegExp(AUTHORED_GAP_MARKER_ATTRIBUTE, "g"))?.length,
  2,
);
assert.equal(transformedDismissLikeMarkdown.includes(gapMarker(2)), false);

const transformedSyntheticListGap = await transformMarkdownForEudicRender(
  transformApp,
  undefined,
  ["``` eudic-block kind=Syn.", "intro", "- item", "```"].join("\n"),
  "Words/list.md",
  undefined,
  markerId,
);
assert.equal(transformedSyntheticListGap.includes(AUTHORED_GAP_MARKER_ATTRIBUTE), false);

const referenceFile = {
  path: "References/ref-gap.md",
  name: "ref-gap.md",
  basename: "ref-gap",
  extension: "md",
} as TFile;
const referenceMarkdown = [
  "---",
  "eudic_link_id: r-gap",
  "---",
  "",
  "``` eudic-block kind=Syn.",
  "A",
  "",
  "B",
  "```",
  "^main",
].join("\n");
const referenceApp = {
  vault: {
    cachedRead: async () => referenceMarkdown,
    getFileByPath: (path: string) => path === referenceFile.path ? referenceFile : null,
    getMarkdownFiles: () => [referenceFile],
  },
  metadataCache: {
    getFirstLinkpathDest: () => referenceFile,
  },
} as unknown as App;
const referencePathScope = {
  isReferencePath: (path: string) => path === referenceFile.path,
  getPrimaryReferenceFolderPath: () => "References",
  resolveStoredReferenceStemToVaultPath: () => null,
} as never;
const transformedReference = await transformMarkdownForEudicRender(
  referenceApp,
  referencePathScope,
  "![[References/ref-gap#^main]]",
  "Words/dismiss.md",
  undefined,
  markerId,
);
assert.equal(transformedReference.includes(gapMarker(1)), true);
assert.equal(transformedReference.includes("![["), false);
assert.equal(transformedReference.includes("```"), false);

const outerReferenceFile = {
  path: "References/outer.md",
  name: "outer.md",
  basename: "outer",
  extension: "md",
} as TFile;
const innerReferenceFile = {
  path: "References/inner.md",
  name: "inner.md",
  basename: "inner",
  extension: "md",
} as TFile;
const nestedReferenceMarkdown = new Map<string, string>([
  [outerReferenceFile.path, "![[References/inner#^main]]\n^main"],
  [
    innerReferenceFile.path,
    ["``` eudic-block kind=Syn.", "inner A", "", "inner B", "```", "^main"].join("\n"),
  ],
]);
const nestedReferenceApp = {
  vault: {
    cachedRead: async (file: TFile) => nestedReferenceMarkdown.get(file.path) ?? "",
    getFileByPath: (path: string) => [outerReferenceFile, innerReferenceFile].find((file) => file.path === path) ?? null,
    getMarkdownFiles: () => [outerReferenceFile, innerReferenceFile],
  },
  metadataCache: {
    getFirstLinkpathDest: (linkpath: string) => linkpath.includes("inner") ? innerReferenceFile : outerReferenceFile,
  },
} as unknown as App;
const nestedReferencePathScope = {
  isReferencePath: (path: string) => path.startsWith("References/"),
  getPrimaryReferenceFolderPath: () => "References",
  resolveStoredReferenceStemToVaultPath: () => null,
} as never;
const transformedNestedReference = await transformMarkdownForEudicRender(
  nestedReferenceApp,
  nestedReferencePathScope,
  "![[References/outer#^main]]",
  "Words/dismiss.md",
  undefined,
  markerId,
);
assert.equal(transformedNestedReference.includes(gapMarker(1)), true);
assert.equal(transformedNestedReference.includes("inner A"), true);
assert.equal(transformedNestedReference.includes("inner B"), true);
assert.equal(transformedNestedReference.includes("![["), false);

assert.equal(
  buildFinalNoteHtml(
    {
      html: `<p>A</p>${renderedGap("1")}<p>B</p>`,
      authoredGapMarkerId: markerId,
    },
    "minimal",
  ),
  "A\n\nB",
);

const dismissRenderedHtml = [
  "<p><strong>v.</strong> 辞退/解雇；</p>",
  "<p><strong>Syn.</strong> 辞职 vs. 解雇/辞退</p>",
  renderedGap("1"),
  "<p><strong>Cog.</strong> dismiss → dismissal</p>",
  "<hr>",
  "<p><strong>Phr.</strong> dismiss as</p>",
  "<p><strong>1.</strong> first</p>",
  renderedGap("1"),
  "<p><strong>2.</strong> second</p>",
].join("");
const dismissFinalHtml = buildFinalNoteHtml(
  { html: dismissRenderedHtml, authoredGapMarkerId: markerId },
  "minimal",
);
assert.equal(
  dismissFinalHtml,
  [
    "<b>v.</b> 辞退/解雇；",
    "<b>Syn.</b> 辞职 vs. 解雇/辞退",
    "",
    "<b>Cog.</b> dismiss → dismissal",
    "<hr>",
    "<b>Phr.</b> dismiss as",
    "<b>1.</b> first",
    "",
    "<b>2.</b> second",
  ].join("\n"),
);
assert.equal(dismissFinalHtml.includes(AUTHORED_GAP_MARKER_ATTRIBUTE), false);

const secondMarkerId = "render-456";
assert.equal(
  buildFinalNoteHtml(
    {
      html: `<p>A</p>${renderedGap("1", secondMarkerId)}<p>B</p>`,
      authoredGapMarkerId: secondMarkerId,
    },
    "minimal",
  ),
  "A\n\nB",
);
