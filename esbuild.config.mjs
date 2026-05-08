import esbuild from "esbuild";
import process from "node:process";

const watch = process.argv.includes("--watch");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  target: "es2021",
  platform: "node",
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view",
  ],
  sourcemap: false,
  logLevel: "info"
});

if (watch) {
  await context.watch();
  console.log("[eudic-sync] watching...");
} else {
  await context.rebuild();
  await context.dispose();
}
