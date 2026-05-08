import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { transformEudicBlocksToMarkdown } from "./eudic-block";
import type { PathScope } from "./path-scope";
import { expandManagedReferenceEmbedsInMarkdownSegments } from "./reference-embed-expander";
import { protectLeadingThematicBreakFromFrontmatter } from "./render-markdown-frontmatter";
import type { SemanticBlockTransformOptions } from "./semantic-block-transform";
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
    const segments = this.pathScope
      ? await expandManagedReferenceEmbedsInMarkdownSegments(this.app, this.pathScope, markdown, sourcePath)
      : [{ markdown, sourcePath }];
    const transformedMarkdownSegments: string[] = [];
    for (const segment of segments) {
      transformedMarkdownSegments.push(
        transformEudicBlocksToMarkdown(
          segment.markdown,
          await resolveSemanticOptions(semanticOptions, segment.sourcePath, segment.embeddedFromPath),
        ),
      );
    }
    const transformedMarkdown = transformedMarkdownSegments.join("");
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
