/**
 * MCP Apps (SEP-1865) UI resource: a single self-contained HTML template,
 * "Perigee Charts", shared by every visualization-bearing tool. The template
 * dispatches on `structuredContent.viz.kind` delivered via the standard
 * ui/notifications/tool-result message, so one cached template serves every
 * chart — hosts fetch it once and reuse it.
 *
 * The HTML is built by `scripts/build-ui.mjs` (esbuild bundle inlined into a
 * shell page) into dist/ui/perigee-charts.html, next to this module's
 * compiled output. It declares NO CSP metadata, which gives it the
 * locked-down default sandbox (no network at all): all data arrives through
 * the tool result, and all chart code is inlined.
 *
 * Hosts without the Apps extension simply never read ui:// resources and
 * ignore `_meta.ui` on tools — the markdown + structuredContent responses
 * remain the universal fallback.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

export const CHARTS_UI_URI = "ui://perigee/charts.html";

let templateCache: string | undefined;

/**
 * Locate the built template. Compiled layout puts it beside this module
 * (dist/ui/); running from source with tsx falls back to dist/ui under cwd
 * (requires a prior `npm run build`).
 */
async function loadTemplate(): Promise<string> {
  if (templateCache) return templateCache;
  const candidates = [
    fileURLToPath(new URL("./perigee-charts.html", import.meta.url)),
    resolve(process.cwd(), "dist/ui/perigee-charts.html"),
  ];
  for (const path of candidates) {
    try {
      templateCache = await readFile(path, "utf-8");
      return templateCache;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    "Perigee Charts UI template not found (dist/ui/perigee-charts.html). Run `npm run build` first.",
  );
}

export function registerChartsUiResource(server: McpServer): void {
  registerAppResource(
    server,
    "Perigee Charts",
    CHARTS_UI_URI,
    {
      description:
        "Interactive charts for tide predictions, solunar forecasts, buoy observations, and marine model forecasts.",
      _meta: {
        ui: {
          // No csp entry: fully self-contained, zero-network sandbox.
          prefersBorder: true,
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: CHARTS_UI_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await loadTemplate(),
        },
      ],
    }),
  );
}
