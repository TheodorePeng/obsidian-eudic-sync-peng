import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import {
  isClosingEudicBlockFenceLine,
  parseEudicBlockFenceLine,
  renderEudicBlockToMarkdown,
  transformEudicBlocksToMarkdown,
} from "./eudic-block";
import type { PathScope } from "./path-scope";
import {
  expandManagedReferenceEmbedsInMarkdownSegments,
  type ExpandedReferenceMarkdownSegment,
} from "./reference-embed-expander";
import { protectLeadingThematicBreakFromFrontmatter } from "./render-markdown-frontmatter";
import {
  transformSemanticBlockBody,
  type SemanticBlockTransformOptions,
} from "./semantic-block-transform";
import { stripYamlFrontmatter } from "./word-body";

export type SemanticBlockTransformOptionsResolver = (
  sourcePath: string,
  embeddedFromPath?: string,
) => SemanticBlockTransformOptions | null | Promise<SemanticBlockTransformOptions | null>;
export type SemanticBlockTransformOptionsSource =
  | SemanticBlockTransformOptions
  | SemanticBlockTransformOptionsResolver
  | null;

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function resolveSemanticOptions(
  source: SemanticBlockTransformOptionsSource | undefined,
  sourcePath: string,
  embeddedFromPath?: string,
): SemanticBlockTransformOptions | null | Promise<SemanticBlockTransformOptions | null> {
  if (!source) {
    return null;
  }

  return typeof source === "function" ? source(sourcePath, embeddedFromPath) : source;
}

async function expandReferenceSegments(
  app: App,
  pathScope: PathScope | undefined,
  markdown: string,
  sourcePath: string,
  embeddedFromPath?: string,
): Promise<ExpandedReferenceMarkdownSegment[]> {
  return pathScope
    ? expandManagedReferenceEmbedsInMarkdownSegments(app, pathScope, markdown, sourcePath, new Set<string>(), 0, embeddedFromPath)
    : [{ markdown, sourcePath, embeddedFromPath }];
}

async function transformRegularMarkdownForEudicRender(
  app: App,
  pathScope: PathScope | undefined,
  markdown: string,
  sourcePath: string,
  semanticOptions?: SemanticBlockTransformOptionsSource,
  embeddedFromPath?: string,
): Promise<string> {
  const segments = await expandReferenceSegments(app, pathScope, markdown, sourcePath, embeddedFromPath);
  const transformedMarkdownSegments: string[] = [];

  for (const segment of segments) {
    transformedMarkdownSegments.push(
      transformEudicBlocksToMarkdown(
        segment.markdown,
        await resolveSemanticOptions(semanticOptions, segment.sourcePath, segment.embeddedFromPath),
      ),
    );
  }

  return transformedMarkdownSegments.join("");
}

async function transformEudicBlockForRender(
  app: App,
  pathScope: PathScope | undefined,
  kind: string,
  body: string,
  sourcePath: string,
  semanticOptions?: SemanticBlockTransformOptionsSource,
): Promise<string> {
  const bodySegments = await expandReferenceSegments(app, pathScope, body, sourcePath);
  const transformedBodySegments: string[] = [];

  for (const segment of bodySegments) {
    const resolvedOptions = await resolveSemanticOptions(semanticOptions, segment.sourcePath, segment.embeddedFromPath);
    transformedBodySegments.push(
      resolvedOptions ? transformSemanticBlockBody(kind, segment.markdown, resolvedOptions) : segment.markdown,
    );
  }

  return renderEudicBlockToMarkdown(kind, transformedBodySegments.join(""), null);
}

export async function transformMarkdownForEudicRender(
  app: App,
  pathScope: PathScope | undefined,
  markdown: string,
  sourcePath: string,
  semanticOptions?: SemanticBlockTransformOptionsSource,
): Promise<string> {
  const normalizedMarkdown = normalizeMarkdown(markdown);
  const lines = normalizedMarkdown.split("\n");
  const output: string[] = [];
  let regularLines: string[] = [];

  const flushRegularLines = async (): Promise<void> => {
    if (regularLines.length === 0) {
      return;
    }

    output.push(
      await transformRegularMarkdownForEudicRender(
        app,
        pathScope,
        regularLines.join("\n"),
        sourcePath,
        semanticOptions,
      ),
    );
    regularLines = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = lines[lineIndex] ?? "";
    const openingFence = parseEudicBlockFenceLine(currentLine);
    if (!openingFence) {
      regularLines.push(currentLine);
      continue;
    }

    let closingLineIndex: number | null = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      if (isClosingEudicBlockFenceLine(lines[candidateIndex] ?? "", openingFence.fenceToken)) {
        closingLineIndex = candidateIndex;
        break;
      }
    }

    if (closingLineIndex === null) {
      regularLines.push(currentLine);
      continue;
    }

    await flushRegularLines();
    output.push(
      await transformEudicBlockForRender(
        app,
        pathScope,
        openingFence.kind,
        lines.slice(lineIndex + 1, closingLineIndex).join("\n"),
        sourcePath,
        semanticOptions,
      ),
    );
    lineIndex = closingLineIndex;
  }

  await flushRegularLines();
  return output.join("\n");
}

export class HtmlRenderer {
  constructor(
    private readonly app: App,
    private readonly pathScope?: PathScope,
  ) {}

  async renderFile(file: TFile): Promise<string> {
    const rawMarkdown = await this.app.vault.cachedRead(file);
    const markdown = stripYamlFrontmatter(rawMarkdown);
    return this.renderMarkdown(markdown, file.path);
  }

  async renderMarkdown(
    markdown: string,
    sourcePath: string,
    semanticOptions?: SemanticBlockTransformOptionsSource,
  ): Promise<string> {
    const container = document.createElement("div");
    const component = new Component();
    component.load();
    const transformedMarkdown = await transformMarkdownForEudicRender(
      this.app,
      this.pathScope,
      markdown,
      sourcePath,
      semanticOptions,
    );
    const renderableMarkdown = protectLeadingThematicBreakFromFrontmatter(transformedMarkdown);

    try {
      await MarkdownRenderer.render(this.app, renderableMarkdown, container, sourcePath, component);
      await waitForFrame();
      return container.innerHTML;
    } finally {
      component.unload();
    }
  }
}
