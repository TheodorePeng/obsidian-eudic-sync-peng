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
      "export function parseYaml(source) { const result = {}; let activeArray = null; const scalar = (raw) => { const value = raw.trim(); if (value === 'true') return true; if (value === 'false') return false; if (value === 'null' || value === '~') return null; if (value === '[]') return []; if (!value) return null; if ((value.startsWith('\\\"') && value.endsWith('\\\"')) || (value.startsWith(\"'\") && value.endsWith(\"'\"))) { try { return value.startsWith('\\\"') ? JSON.parse(value) : value.slice(1, -1).replace(/''/g, \"'\"); } catch {} } return value; }; for (const rawLine of String(source).split(/\\r?\\n/)) { if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue; const item = rawLine.match(/^\\s+-\\s+(.*)$/); if (item && activeArray) { result[activeArray].push(scalar(item[1])); continue; } const property = rawLine.match(/^([^:#]+):(?:\\s*(.*))?$/); if (!property || /^\\s/.test(rawLine)) throw new Error('unsupported YAML in unit-test stub'); const key = property[1].trim(); const rawValue = property[2] ?? ''; if (!rawValue.trim()) { result[key] = []; activeArray = key; } else { result[key] = scalar(rawValue); activeArray = null; } } return result; }",
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
