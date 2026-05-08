import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const tempDir = await mkdtemp(join(tmpdir(), "eudic-sync-benchmark-"));
const outfile = join(tempDir, "benchmark.mjs");

try {
  await esbuild.build({
    entryPoints: [join(root, "tests/benchmark.ts")],
    bundle: true,
    outfile,
    platform: "node",
    format: "esm",
    external: ["obsidian"],
  });

  await import(pathToFileURL(outfile).href);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
