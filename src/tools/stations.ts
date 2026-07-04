/**
 * Station discovery and overview tools (Metadata API).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  findNearestStations,
  getStationInfo,
  searchStations,
  STATION_TYPES,
  type StationSummary,
} from "../services/metadata-api.js";
import {
  LatitudeSchema,
  LongitudeSchema,
  READ_ONLY_ANNOTATIONS,
  ResponseFormatSchema,
  StationIdSchema,
  UnitsSchema,
} from "../schemas/common.js";
import { markdownTable, respond, respondError } from "../format/respond.js";

const StationTypeSchema = z
  .enum(STATION_TYPES)
  .describe(
    'Station capability filter. Common: "waterlevels" (active water level), "tidepredictions", "currents" (observed currents), "currentpredictions", "met" (weather sensors). Full list via noaa_get_reference_guide topic "station_types".',
  );

function summarize(s: StationSummary): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    state: s.state ?? undefined,
    lat: s.lat,
    lng: s.lng,
    tide_type: s.tideType || undefined,
    great_lakes: s.greatlakes || undefined,
    prediction_type:
      s.type === "R"
        ? "reference (harmonic)"
        : s.type === "S"
          ? "subordinate (offsets)"
          : undefined,
    reference_id: s.reference_id || undefined,
    ports_code: s.portscode || undefined,
  };
}

export function registerStationTools(server: McpServer): void {
  server.registerTool(
    "noaa_search_stations",
    {
      title: "Search NOAA Stations",
      description: `Search the NOAA CO-OPS station directory by capability type, name, and/or state.

Filter with:
- type: what the station does (waterlevels, tidepredictions, currents, currentpredictions, met, ...) — pick the type matching the data you plan to request.
- name: case-insensitive substring ("San Francisco", "Boston").
- state: two-letter code ("CA", "MA").

Returns id, name, location, tide type, Great Lakes flag, and for prediction stations whether they are reference (R, harmonic) or subordinate (S, offset-based — hilo predictions only). Results are paginated (limit/offset). For proximity search by coordinates use noaa_find_nearest_stations instead.`,
      inputSchema: {
        type: StationTypeSchema.optional(),
        name: z
          .string()
          .min(1)
          .optional()
          .describe("Case-insensitive substring of the station name."),
        state: z
          .string()
          .length(2)
          .optional()
          .describe('Two-letter US state/territory code, e.g. "CA".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe("Maximum stations to return."),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Pagination offset."),
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const matches = await searchStations({
          type: params.type,
          name: params.name,
          state: params.state,
          units: "english",
        });
        const page = matches.slice(params.offset, params.offset + params.limit);
        const hasMore = params.offset + page.length < matches.length;
        const structured = {
          total: matches.length,
          count: page.length,
          offset: params.offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: params.offset + page.length } : {}),
          stations: page.map(summarize),
        };
        const filterDesc = [
          params.type && `type=${params.type}`,
          params.name && `name~"${params.name}"`,
          params.state && `state=${params.state}`,
        ]
          .filter(Boolean)
          .join(", ");
        const markdown = [
          `# Station Search${filterDesc ? ` (${filterDesc})` : ""}`,
          "",
          `${matches.length} match(es); showing ${page.length} from offset ${params.offset}.${hasMore ? ` More available — call again with offset=${params.offset + page.length}.` : ""}`,
          "",
          markdownTable(
            ["ID", "Name", "State", "Lat", "Lon", "Tide type", "Notes"],
            page.map((s) => [
              s.id,
              s.name,
              s.state,
              s.lat,
              s.lng,
              s.tideType,
              [
                s.greatlakes ? "Great Lakes" : null,
                s.type === "S"
                  ? `subordinate of ${s.reference_id ?? "?"}`
                  : null,
                s.type === "R" ? "reference" : null,
              ]
                .filter(Boolean)
                .join("; "),
            ]),
          ),
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_find_nearest_stations",
    {
      title: "Find Nearest NOAA Stations",
      description: `Find the NOAA stations closest to a latitude/longitude point, sorted by distance.

Use this to answer "what's the tide station near <place>?" — geocode the place to coordinates first, then call this. Filter by type to match the data you need (e.g. type "tidepredictions" before calling noaa_get_tide_predictions, "currents" before noaa_get_currents — current stations have different IDs than water-level stations).

Distance is computed great-circle (Haversine) and reported in both km and miles. (NOAA's API has no native coordinate search; this tool maintains a cached station directory.)`,
      inputSchema: {
        latitude: LatitudeSchema,
        longitude: LongitudeSchema,
        type: StationTypeSchema.optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Number of stations to return."),
        max_distance_km: z
          .number()
          .positive()
          .optional()
          .describe("Optional cutoff radius in kilometers."),
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const nearest = await findNearestStations(
          params.latitude,
          params.longitude,
          params.type,
          params.limit,
          params.max_distance_km,
        );
        const structured = {
          origin: { latitude: params.latitude, longitude: params.longitude },
          type: params.type,
          count: nearest.length,
          stations: nearest.map((s) => ({
            ...summarize(s),
            distance_km: Number(s.distance_km.toFixed(2)),
            distance_mi: Number(s.distance_mi.toFixed(2)),
          })),
        };
        const markdown = [
          `# Nearest Stations to (${params.latitude}, ${params.longitude})${params.type ? ` — type ${params.type}` : ""}`,
          "",
          nearest.length === 0
            ? "_No stations found within the given constraints. Try removing max_distance_km or the type filter._"
            : markdownTable(
                [
                  "ID",
                  "Name",
                  "State",
                  "Distance (km)",
                  "Distance (mi)",
                  "Tide type",
                  "Notes",
                ],
                nearest.map((s) => [
                  s.id,
                  s.name,
                  s.state,
                  s.distance_km.toFixed(1),
                  s.distance_mi.toFixed(1),
                  s.tideType,
                  s.type === "S"
                    ? `subordinate of ${s.reference_id ?? "?"}`
                    : s.greatlakes
                      ? "Great Lakes"
                      : "",
                ]),
              ),
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_station_info",
    {
      title: "Get Station Info",
      description: `Get a NOAA station's full metadata record: location, state, time zone, tide type, Great Lakes flag, capability flags, and links to available sub-resources.

Optionally expand sub-resources inline via the "expand" list:
- details (established/removed dates), sensors (installed instruments + elevations), floodlevels (NOS/NWS minor/moderate/major flood thresholds), benchmarks, products (available data page links), notices, disclaimers — for water-level stations
- bins (ADCP depth bins), deployments — for current stations (alphanumeric IDs)

Use this before requesting data to confirm what the station actually collects. For datum values use noaa_get_station_datums; for harmonic constituents use noaa_get_harmonic_constituents.`,
      inputSchema: {
        station: StationIdSchema,
        expand: z
          .array(
            z.enum([
              "details",
              "sensors",
              "floodlevels",
              "benchmarks",
              "products",
              "notices",
              "disclaimers",
              "bins",
              "deployments",
            ]),
          )
          .optional()
          .describe(
            "Sub-resources to embed inline (availability varies by station type).",
          ),
        units: UnitsSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const payload = await getStationInfo(
          params.station,
          params.expand,
          params.units,
        );
        const stations = (
          payload as { stations?: Array<Record<string, unknown>> }
        ).stations;
        const info = stations?.[0] ?? payload;
        const structured = {
          station: params.station,
          units: params.units,
          info,
        };
        const lines: string[] = [
          `# Station ${params.station} — ${String(info.name ?? "")}`,
          "",
        ];
        const fact = (label: string, value: unknown) => {
          if (value !== undefined && value !== null && value !== "") {
            lines.push(`- **${label}**: ${String(value)}`);
          }
        };
        fact("Location", `${info.lat}, ${info.lng}`);
        fact("State", info.state);
        fact("Time zone", info.timezone);
        fact("Tide type", info.tideType);
        fact("Tidal", info.tidal);
        fact("Great Lakes", info.greatlakes);
        fact("Affiliations", info.affiliations);
        fact("PORTS code", info.portscode);
        fact("Storm surge station", info.stormsurge);
        fact("High-tide-flooding history available", info.HTFhistorical);
        if (typeof info.expand === "string" && info.expand) {
          fact("Expandable sub-resources", info.expand);
        }
        if (params.expand?.length) {
          lines.push(
            "",
            `Expanded sub-resources (${params.expand.join(", ")}) are included in the JSON payload.`,
          );
        }
        lines.push("", '_Use response_format "json" for the complete record._');
        return respond(params.response_format, structured, lines.join("\n"));
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
