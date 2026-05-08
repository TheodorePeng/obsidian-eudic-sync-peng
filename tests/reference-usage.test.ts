import assert from "node:assert/strict";
import { resolveManagedReferencePath } from "../src/reference-links";
import {
  ReferenceUsageResolver,
  storedReferenceRefMatchesPath,
} from "../src/reference-usage-resolver";
import type { App, TFile } from "obsidian";

function mockFile(path: string): TFile {
  return {
    path,
    name: path.split("/").pop() ?? path,
    basename: (path.split("/").pop() ?? path).replace(/\.md$/i, ""),
    extension: "md",
  } as TFile;
}

const referencePath = "Eudic/References/ref-20260425171733-0f.md";
const aboundPath = "Eudic/Words/abound.md";
const abundantlyPath = "Eudic/Words/abundantly.md";
const pathScope = {
  isReferencePath: (path: string) => path.startsWith("Eudic/References/"),
  getPrimaryReferenceFolderPath: () => "Eudic/References",
  resolveStoredReferenceStemToVaultPath: (storedRef: string) => {
    const normalized = storedRef.replace(/\.md$/i, "");
    if (normalized.startsWith("References/")) {
      return `Eudic/${normalized}`;
    }
    if (normalized.startsWith("Eudic/References/")) {
      return normalized;
    }
    return null;
  },
} as never;

assert.equal(storedReferenceRefMatchesPath(pathScope, "ref-20260425171733-0f", referencePath), true);
assert.equal(storedReferenceRefMatchesPath(pathScope, "References/ref-20260425171733-0f", referencePath), true);
assert.equal(storedReferenceRefMatchesPath(pathScope, "References/other", referencePath), false);

const usageResolver = new ReferenceUsageResolver(pathScope);
assert.deepEqual(
  usageResolver.buildSnapshot(referencePath, {
    referencedByPaths: ["Eudic/Words/stale.md"],
    wordReferenceRefs: [
      {
        wordPath: aboundPath,
        storedRefs: ["References/ref-20260425171733-0f"],
      },
      {
        wordPath: abundantlyPath,
        storedRefs: [],
        textRefs: ["ref-20260425171733-0f"],
      },
      {
        wordPath: "Eudic/Words/disabled.md",
        storedRefs: ["References/ref-20260425171733-0f"],
        syncDisabled: true,
      },
    ],
  }),
  {
    referencePath,
    wordPaths: [aboundPath, abundantlyPath],
    refCount: 2,
  },
);

assert.deepEqual(
  usageResolver.buildSnapshot(referencePath, {
    mode: "render",
    referencedByPaths: [abundantlyPath],
    wordReferenceRefs: [
      {
        wordPath: aboundPath,
        storedRefs: ["References/ref-20260425171733-0f"],
      },
    ],
  }),
  {
    referencePath,
    wordPaths: [aboundPath, abundantlyPath],
    refCount: 2,
  },
);

assert.deepEqual(
  usageResolver.buildSnapshot(referencePath, {
    referencedByPaths: [abundantlyPath],
    wordReferenceRefs: [],
  }),
  {
    referencePath,
    wordPaths: [],
    refCount: 0,
  },
);

const bareReferenceFile = mockFile("Eudic/References/ref-bare.md");
const bareReferenceApp = {
  vault: {
    getFileByPath: (path: string) => (path === bareReferenceFile.path ? bareReferenceFile : null),
    getMarkdownFiles: () => [bareReferenceFile],
  },
  metadataCache: {
    getFirstLinkpathDest: () => null,
  },
} as unknown as App;
assert.equal(
  resolveManagedReferencePath(bareReferenceApp, pathScope, "Eudic/Words/abound.md", "ref-bare"),
  bareReferenceFile.path,
);
