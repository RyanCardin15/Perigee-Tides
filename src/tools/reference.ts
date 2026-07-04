/**
 * Reference guide tool — curated NOAA parameter documentation so agents can
 * self-serve the nuances (datums, units, limits) without web searching.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  REFERENCE_CONTENT,
  REFERENCE_SUMMARIES,
  REFERENCE_TOPICS,
} from "../reference/content.js";
import { respondError } from "../format/respond.js";
import { LOCAL_COMPUTE_ANNOTATIONS } from "../schemas/common.js";

export function registerReferenceTools(server: McpServer): void {
  server.registerTool(
    "noaa_get_reference_guide",
    {
      title: "Get NOAA API Reference Guide",
      description: `Get curated reference documentation for NOAA CO-OPS concepts and parameters. Topics:

${REFERENCE_TOPICS.map((t) => `- ${t}: ${REFERENCE_SUMMARIES[t]}`).join("\n")}

Consult this before constructing unusual requests — especially "datums" (which vertical reference to use and station applicability), "units" (english/metric asymmetries like cm/s current speeds), and "data_limits" (maximum date spans per product).`,
      inputSchema: {
        topic: z
          .enum(REFERENCE_TOPICS)
          .describe("Reference topic to retrieve."),
      },
      annotations: LOCAL_COMPUTE_ANNOTATIONS,
    },
    async ({ topic }) => {
      try {
        return {
          content: [{ type: "text" as const, text: REFERENCE_CONTENT[topic] }],
        };
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
