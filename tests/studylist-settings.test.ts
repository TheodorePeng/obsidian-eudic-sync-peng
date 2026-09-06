import assert from "node:assert/strict";
import {
  buildStudylistSelectionGroups,
  getStudylistSelectionSummary,
} from "../src/studylist-settings-model";
import { EudicApiClient } from "../src/eudic-api";
import { StudylistService } from "../src/studylist-service";
import { getStudylistCatalogRefreshNoticeText } from "../src/sync-notice-text";
import type { EudicStudylistCache } from "../src/types";

const cached = [
  { id: "a", language: "en", name: "Alpha" },
  { id: "b", language: "en", name: "Beta" },
  { id: "c", language: "de", name: "Gamma" },
];
const selected = [
  { id: "b", language: "en", name: "Old beta name" },
  { id: "missing", language: "en", name: "Removed list" },
];

assert.equal(getStudylistSelectionSummary([]), "None selected");
assert.equal(getStudylistSelectionSummary(selected), "2 selected: Old beta name, Removed list");
assert.equal(
  getStudylistSelectionSummary([...selected, { id: "c", language: "de", name: "Gamma" }]),
  "3 selected: Old beta name, Removed list +1 more",
);

const groups = buildStudylistSelectionGroups(cached, selected, "");
assert.deepEqual(groups.map((group) => group.label), ["de", "en", "Unavailable in Eudic"]);
assert.deepEqual(groups[1]?.items.map((item) => item.category.name), ["Beta", "Alpha"]);
assert.equal(groups[1]?.items[0]?.selected, true);
assert.equal(groups[1]?.items[0]?.available, true);
assert.deepEqual(groups[2]?.items.map((item) => item.category.name), ["Removed list"]);
assert.equal(groups[2]?.items[0]?.selected, true);
assert.equal(groups[2]?.items[0]?.available, false);

assert.deepEqual(
  buildStudylistSelectionGroups(cached, selected, "GAMMA").flatMap((group) => group.items.map((item) => item.category.id)),
  ["c"],
);
assert.deepEqual(
  buildStudylistSelectionGroups(cached, selected, "EN").flatMap((group) => group.items.map((item) => item.category.id)),
  ["b", "a", "missing"],
);
assert.deepEqual(
  buildStudylistSelectionGroups(cached, selected, "missing").flatMap((group) => group.items.map((item) => item.category.id)),
  ["missing"],
);

const originalGetStudylistCategories = EudicApiClient.prototype.getStudylistCategories;
const originalGetStudylistWords = EudicApiClient.prototype.getStudylistWords;
let categoryRequests = 0;
let wordRequests = 0;
let frontmatterWrites = 0;
let cache: EudicStudylistCache = { categories: [], refreshedAt: null };

try {
  EudicApiClient.prototype.getStudylistCategories = async function (language) {
    categoryRequests += 1;
    return [{ id: "fresh", language, name: "Fresh list" }];
  };
  EudicApiClient.prototype.getStudylistWords = async function () {
    wordRequests += 1;
    return [];
  };

  const service = new StudylistService({
    app: {} as never,
    pathScope: {} as never,
    managedFiles: { getWordFiles: () => [] } as never,
    getAuthorizationToken: () => "placeholder",
    getStudylistCache: () => cache,
    setStudylistCache: async (nextCache) => {
      cache = nextCache;
    },
    writeFrontmatter: async () => {
      frontmatterWrites += 1;
    },
  });

  const result = await service.refreshCatalogFromEudic();
  assert.equal(categoryRequests, 1);
  assert.equal(wordRequests, 0);
  assert.equal(frontmatterWrites, 0);
  assert.equal(result.categories, 1);
  assert.deepEqual(result.languages, ["en"]);
  assert.deepEqual(cache.categories, [{ id: "fresh", language: "en", name: "Fresh list" }]);
  assert.ok(cache.refreshedAt);
} finally {
  EudicApiClient.prototype.getStudylistCategories = originalGetStudylistCategories;
  EudicApiClient.prototype.getStudylistWords = originalGetStudylistWords;
}

const unchangedCache: EudicStudylistCache = {
  categories: [{ id: "old", language: "en", name: "Existing cache" }],
  refreshedAt: "2026-09-01T12:00:00+08:00",
};
cache = unchangedCache;
let cacheWrites = 0;
try {
  EudicApiClient.prototype.getStudylistCategories = async function (language) {
    if (language === "de") {
      throw new Error("catalog unavailable");
    }
    return [{ id: "new", language, name: "Fetched before failure" }];
  };

  const service = new StudylistService({
    app: {
      metadataCache: {
        getFileCache: () => ({ frontmatter: { lang: "de", sync_eudic_enabled: true } }),
      },
    } as never,
    pathScope: { isWordPath: () => true } as never,
    managedFiles: {
      getWordFiles: () => [{ path: "Words/hallo.md", extension: "md", basename: "hallo" }],
    } as never,
    getAuthorizationToken: () => "placeholder",
    getStudylistCache: () => cache,
    setStudylistCache: async (nextCache) => {
      cacheWrites += 1;
      cache = nextCache;
    },
    writeFrontmatter: async () => {
      frontmatterWrites += 1;
    },
  });

  await assert.rejects(() => service.refreshCatalogFromEudic(), /catalog unavailable/);
  assert.equal(cacheWrites, 0);
  assert.deepEqual(cache, unchangedCache);
} finally {
  EudicApiClient.prototype.getStudylistCategories = originalGetStudylistCategories;
}

assert.equal(
  getStudylistCatalogRefreshNoticeText({
    categories: 3,
    languages: ["en", "de"],
    cache: { categories: cached, refreshedAt: "2026-09-06T12:00:00+08:00" },
  }),
  "Eudic Sync: refreshed 3 Eudic studylist(s) for 2 language(s).",
);
