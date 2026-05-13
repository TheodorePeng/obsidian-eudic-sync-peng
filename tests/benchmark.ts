import { performance } from "node:perf_hooks";
import { ManagedFileRegistry } from "../src/managed-file-registry";
import { ReferenceGraphService } from "../src/reference-index-service";
import { StartupCoordinator } from "../src/startup-coordinator";
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
const markdownByPath = new Map<string, string>();
const frontmatterByPath = new Map<string, Record<string, unknown>>();
for (let index = 0; index < 4000; index += 1) {
  const file = mockFile(`Eudic/Words/word-${String(index).padStart(4, "0")}.md`);
  const referenceIndex = index % 400;
  files.push(file);
  markdownByPath.set(file.path, `![[References/ref-${String(referenceIndex).padStart(4, "0")}#^main]]\n\nBody ${index}`);
  frontmatterByPath.set(file.path, {
    sync_eudic_enabled: true,
    eudic_link_id: `w-${index}`,
  });
}
for (let index = 0; index < 400; index += 1) {
  const file = mockFile(`Eudic/References/ref-${String(index).padStart(4, "0")}.md`);
  files.push(file);
  markdownByPath.set(file.path, `Reference ${index} ^main`);
  frontmatterByPath.set(file.path, {
    eudic_link_id: `r-${index}`,
  });
}
for (let index = 0; index < 1000; index += 1) {
  files.push(mockFile(`Other/note-${String(index).padStart(4, "0")}.md`));
}

const benchmarkApp = {
    vault: {
      getMarkdownFiles: () => files,
      getFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
      cachedRead: async (file: TFile) => markdownByPath.get(file.path) ?? "",
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: frontmatterByPath.get(file.path) ?? {} }),
      getFirstLinkpathDest: (linkpath: string) => {
        const normalized = linkpath.replace(/\.md$/i, "");
        return files.find((file) => file.path.replace(/^Eudic\//, "").replace(/\.md$/i, "") === normalized) ?? null;
      },
    },
  } as unknown as App;
const benchmarkPathScope = {
    isWordPath: (path: string) => path.startsWith("Eudic/Words/"),
    isReferencePath: (path: string) => path.startsWith("Eudic/References/"),
    getPrimaryReferenceFolderPath: () => "Eudic/References",
    toStoredReferenceMarkdownStem: (path: string) => path.replace(/^Eudic\//, "").replace(/\.md$/i, ""),
    resolveStoredReferenceStemToVaultPath: (storedRef: string) => `Eudic/${storedRef.replace(/\.md$/i, "")}`,
  } as never;
const registry = new ManagedFileRegistry(benchmarkApp, benchmarkPathScope);

const startedAt = performance.now();
registry.rebuild();
const rebuildMs = Math.round((performance.now() - startedAt) * 10) / 10;

const lookupStartedAt = performance.now();
const wordCount = registry.getWordFiles().length;
const referenceCount = registry.getReferenceFiles().length;
const lookupMs = Math.round((performance.now() - lookupStartedAt) * 10) / 10;

console.log(`Synthetic benchmark: registry rebuild ${rebuildMs}ms, lookup ${lookupMs}ms, words ${wordCount}, references ${referenceCount}.`);

const referenceGraph = new ReferenceGraphService({
  app: benchmarkApp,
  pathScope: benchmarkPathScope,
  managedFiles: registry,
  writeFrontmatter: async () => {},
});
const referenceStartedAt = performance.now();
await referenceGraph.rebuildAll();
const referenceRebuildMs = Math.round((performance.now() - referenceStartedAt) * 10) / 10;

const startupStartedAt = performance.now();
const startupCoordinator = new StartupCoordinator({
  isUnloaded: () => false,
  measure: (_label, callback) => callback(),
  onError: () => {},
});
await startupCoordinator.run([
  { label: "registry.rebuild", run: () => registry.rebuild() },
  { label: "reference.rebuildAll", run: () => referenceGraph.rebuildAll() },
  { label: "registry.lookup", run: () => { registry.getWordFiles(); registry.getReferenceFiles(); } },
]);
const startupMs = Math.round((performance.now() - startupStartedAt) * 10) / 10;

console.log(`Synthetic benchmark: reference rebuild ${referenceRebuildMs}ms, startup coordinator ${startupMs}ms.`);
