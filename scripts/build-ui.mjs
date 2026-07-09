/**
 * Build the Perigee Charts MCP-app template: bundle ui/src/main.ts with
 * esbuild (App SDK + chart core inlined, minified, IIFE) and inject it into
 * the shell page, emitting a single self-contained dist/ui/perigee-charts.html
 * that the server serves as the ui://perigee/charts.html resource.
 */

import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = await build({
  entryPoints: [resolve(root, "ui/src/main.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false,
  legalComments: "none",
});

const js = result.outputFiles[0].text;
const shell = await readFile(resolve(root, "ui/src/shell.html"), "utf-8");
// The bundle is inlined verbatim; guard against "</script>" inside strings.
const safeJs = js.replace(/<\/script>/gi, "<\\/script>");
const html = shell.replace("/*__BUNDLE__*/", () => safeJs);

const outPath = resolve(root, "dist/ui/perigee-charts.html");
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, html);
console.error(
  `built ${outPath} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`,
);
