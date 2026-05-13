import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { DOMParser, Node } from "linkedom";

const root = fileURLToPath(new URL("../", import.meta.url));
const tempDir = await mkdtemp(join(tmpdir(), "eudic-sync-tests-"));
const entrypoint = join(tempDir, "all-tests.mjs");
const outfile = join(tempDir, "unit-tests.mjs");

globalThis.DOMParser = DOMParser;
globalThis.Node = Node;

try {
  const testFiles = (await readdir(join(root, "tests")))
    .filter((file) => file.endsWith(".test.ts"))
    .sort();
  await writeFile(
    entrypoint,
    testFiles.map((file) => `import ${JSON.stringify(join(root, "tests", file))};`).join("\n"),
  );

  const obsidianStub = join(tempDir, "obsidian-stub.mjs");
  await writeFile(
    obsidianStub,
    [
      "export class TFile { constructor(path = '') { this.path = path; this.extension = path.split('.').pop() ?? ''; this.basename = path.split('/').pop()?.replace(/\\.md$/i, '') ?? path; } }",
      "export class TAbstractFile {}",
      "export class TFolder extends TAbstractFile {}",
      "export class MarkdownView {}",
      "export class Component {}",
      "export class Notice { constructor() {} }",
      "export class Menu {}",
      "export class Plugin {}",
      "export class App {}",
      "export class AbstractInputSuggest {}",
      "export const MarkdownRenderer = { render: async () => {} };",
      "export const editorInfoField = {};",
      "export const requestUrl = async () => { throw new Error('requestUrl is not available in unit tests.'); };",
      "export function normalizePath(path) { return String(path).replace(/\\\\/g, '/').replace(/\\/+/g, '/'); }",
    ].join("\n"),
  );

  await esbuild.build({
    entryPoints: [entrypoint],
    bundle: true,
    outfile,
    platform: "node",
    format: "esm",
    sourcemap: "inline",
    alias: {
      obsidian: obsidianStub,
    },
  });

  await import(pathToFileURL(outfile).href);
  await writeFile(join(tempDir, "ok"), "ok\n");
  console.log("Unit tests passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
