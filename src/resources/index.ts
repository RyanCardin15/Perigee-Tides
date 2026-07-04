/**
 * MCP resources: the reference guide topics exposed as noaa://reference/{topic}
 * plus a getting-started guide. Clients that support resources can pin these
 * into context without a tool round-trip.
 */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  REFERENCE_CONTENT,
  REFERENCE_SUMMARIES,
  REFERENCE_TOPICS,
  type ReferenceTopic,
} from "../reference/content.js";

const GETTING_STARTED = `# NOAA Tides & Currents MCP Server — Getting Started

Typical workflows:

## "When is high tide near <place>?"
1. Geocode the place to lat/lon (outside this server).
2. noaa_find_nearest_stations (type "tidepredictions") → pick a station ID.
3. noaa_get_tide_predictions with interval "hilo" and a date window.

## "What are conditions right now at <station>?"
- noaa_get_water_levels (date "latest") for water level
- noaa_get_meteorological_data (product "wind"/"air_temperature", date "latest")
- noaa_get_currents (date "latest") at a current station (different ID scheme!)

## "How often does <station> flood, and what's projected?"
- noaa_get_high_tide_flooding (report "annual", range 15)
- noaa_get_sea_level_trends, noaa_get_sea_level_rise_projections
- noaa_get_extreme_water_levels for exceedance probabilities

## Things that trip people up
- Datum matters: heights above MLLW differ from MSL by several feet at many
  stations. MLLW is the chart default. See noaa://reference/datums.
- Units: metric current speed is cm/s, not m/s. See noaa://reference/units.
- Water-level and current stations have DIFFERENT ID schemes (7-digit vs
  alphanumeric like "cb0102").
- Predictions are astronomical — storms are not included.
- Per-product maximum date spans apply. See noaa://reference/data_limits.
- Great Lakes stations: no tide predictions; datums IGLD/LWD; daily_mean.
`;

export function registerResources(server: McpServer): void {
  server.registerResource(
    "getting-started",
    "noaa://guide/getting-started",
    {
      title: "Getting Started with NOAA Tides & Currents",
      description: "Workflow recipes and common pitfalls for this server.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "text/markdown", text: GETTING_STARTED },
      ],
    }),
  );

  server.registerResource(
    "reference",
    new ResourceTemplate("noaa://reference/{topic}", {
      list: async () => ({
        resources: REFERENCE_TOPICS.map((topic) => ({
          uri: `noaa://reference/${topic}`,
          name: `NOAA reference: ${topic}`,
          description: REFERENCE_SUMMARIES[topic],
          mimeType: "text/markdown",
        })),
      }),
      complete: {
        topic: async (value) =>
          REFERENCE_TOPICS.filter((t) => t.startsWith(value ?? "")).map(String),
      },
    }),
    {
      title: "NOAA CO-OPS Reference",
      description:
        "Curated NOAA API reference topics (datums, units, limits, flags...).",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const topic = String(variables.topic) as ReferenceTopic;
      const content = REFERENCE_CONTENT[topic];
      if (!content) {
        throw new Error(
          `Unknown reference topic "${topic}". Valid topics: ${REFERENCE_TOPICS.join(", ")}.`,
        );
      }
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }],
      };
    },
  );
}
