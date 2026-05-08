import { FRONTMATTER_KEYS } from "./constants";
import { stripYamlFrontmatter } from "./word-body";

function readYamlBlock(markdown: string): string {
  return markdown.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/)?.[1] ?? "";
}

function readYamlFieldSource(markdown: string, key: string): string {
  const lines = readYamlBlock(markdown).split(/\r?\n/);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyPattern = new RegExp(`^\\s*${escapedKey}\\s*:\\s*(.*?)\\s*$`);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(keyPattern);
    if (!match) {
      continue;
    }

    const collected = [line.trim()];
    for (let nestedIndex = index + 1; nestedIndex < lines.length; nestedIndex += 1) {
      const nestedLine = lines[nestedIndex] ?? "";
      if (/^\S/.test(nestedLine)) {
        break;
      }
      if (nestedLine.trim()) {
        collected.push(nestedLine.trim());
      }
    }
    return collected.join("\n");
  }

  return "";
}

export function getWordSyncSignature(markdown: string): string {
  const syncRelevantFrontmatter = [
    FRONTMATTER_KEYS.word,
    FRONTMATTER_KEYS.lang,
    FRONTMATTER_KEYS.aliases,
    FRONTMATTER_KEYS.eudicLinkId,
    FRONTMATTER_KEYS.syncEudicEnabled,
  ]
    .map((key) => `${key}:${readYamlFieldSource(markdown, key)}`)
    .join("\n");

  return `${syncRelevantFrontmatter}\n---body---\n${stripYamlFrontmatter(markdown)}`;
}
