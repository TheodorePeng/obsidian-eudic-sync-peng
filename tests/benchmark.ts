import { performance } from "node:perf_hooks";
import { ManagedFileRegistry } from "../src/managed-file-registry";
import type { App, TFile } from "obsidian";

function mockFile(path: string): TFile {
  return {
    path,
    name: path.split("/").pop() ?? path,
    basename: (path.split("/").pop() ?? path).replace(/\.md$/i, ""),
    extension: "md",
  } as TFile;
}

const files: TFile[] = [];
for (let index = 0; index < 4000; index += 1) {
  files.push(mockFile(`Eudic/Words/word-${String(index).padStart(4, "0")}.md`));
}
for (let index = 0; index < 400; index += 1) {
  files.push(mockFile(`Eudic/References/ref-${String(index).padStart(4, "0")}.md`));
}
for (let index = 0; index < 1000; index += 1) {
  files.push(mockFile(`Other/note-${String(index).padStart(4, "0")}.md`));
}

const registry = new ManagedFileRegistry(
  {
    vault: {
      getMarkdownFiles: () => files,
    },
  } as unknown as App,
  {
    isWordPath: (path: string) => path.startsWith("Eudic/Words/"),
    isReferencePath: (path: string) => path.startsWith("Eudic/References/"),
  } as never,
);

const startedAt = performance.now();
registry.rebuild();
const rebuildMs = Math.round((performance.now() - startedAt) * 10) / 10;

const lookupStartedAt = performance.now();
const wordCount = registry.getWordFiles().length;
const referenceCount = registry.getReferenceFiles().length;
const lookupMs = Math.round((performance.now() - lookupStartedAt) * 10) / 10;

console.log(`Synthetic benchmark: registry rebuild ${rebuildMs}ms, lookup ${lookupMs}ms, words ${wordCount}, references ${referenceCount}.`);
