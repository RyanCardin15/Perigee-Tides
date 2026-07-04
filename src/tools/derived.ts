/**
 * Derived Product API tools: sea level trends & rise projections, extreme
 * water levels, top-ten/peak water levels, high tide flooding.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getExtremeWaterLevels,
  getHighTideFlooding,
  getSeaLevelRiseProjections,
  getSeaLevelTrends,
  getTopTenWaterLevels,
  type HtfReport,
} from "../services/dpapi.js";
import {
  READ_ONLY_ANNOTATIONS,
  ResponseFormatSchema,
  StationIdSchema,
  UnitsSchema,
} from "../schemas/common.js";
import { markdownTable, respond, respondError } from "../format/respond.js";

type Row = Record<string, unknown>;

function firstArray(payload: Record<string, unknown>): {
  key?: string;
  rows: Row[];
} {
  for (const [key, value] of Object.entries(payload)) {
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "object"
    ) {
      return { key, rows: value as Row[] };
    }
  }
  return { rows: [] };
}

/** Render whatever record array a DPAPI endpoint returned as a table. */
function genericMarkdown(
  title: string,
  payload: Record<string, unknown>,
  note?: string,
): string {
  const { rows } = firstArray(payload);
  const lines = [`# ${title}`, ""];
  if (note) lines.push(note, "");
  if (rows.length === 0) {
    lines.push(
      "_No records returned. This station may not have this derived product._",
    );
  } else {
    const headers = Object.keys(rows[0]);
    const cell = (value: unknown): string | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    };
    lines.push(
      `**Records**: ${rows.length}`,
      "",
      markdownTable(
        headers,
        rows.map((r) => headers.map((h) => cell(r[h]))),
      ),
    );
  }
  return lines.join("\n");
}

export function registerDerivedProductTools(server: McpServer): void {
  server.registerTool(
    "noaa_get_sea_level_trends",
    {
      title: "Get Relative Sea Level Trends",
      description: `Get the long-term relative sea level trend at a NOAA station: trend and error (reported by NOAA in mm/yr or inches/decade — the payload's trendUnits field says which), the observation period (startDate/endDate), and seasonal amplitude.

Relative sea level combines ocean rise AND local land movement (subsidence/uplift), so trends vary widely by station (e.g. strongly positive on the Gulf Coast, negative in Alaska). Requires a station with a long water-level record; omit station to list all (affil "US" or "Global" filters the network).`,
      inputSchema: {
        station: StationIdSchema.optional(),
        affil: z
          .enum(["US", "Global"])
          .optional()
          .describe("Network filter when listing multiple stations."),
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const payload = await getSeaLevelTrends({
          station: params.station,
          affil: params.affil,
        });
        return respond(
          params.response_format,
          {
            query: { station: params.station, affil: params.affil },
            ...payload,
          },
          genericMarkdown(
            `Sea Level Trends${params.station ? ` — Station ${params.station}` : ""}`,
            payload,
            "_Trend units are given per record (trendUnits). Relative sea level includes local land motion._",
          ),
        );
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_sea_level_rise_projections",
    {
      title: "Get Sea Level Rise Projections",
      description: `Get NOAA's Interagency Sea Level Rise Scenario projections for a station (from the 2022 technical report): projected relative sea level (meters or feet, see units field) per decade through 2150 under the chosen scenario.

Scenarios: low, intermediate-low, intermediate, intermediate-high, high, extreme, or all. Use for coastal planning questions ("how much sea level rise is projected at X by 2050?"). Pair with noaa_get_sea_level_trends (observed) and noaa_get_high_tide_flooding (flooding impact).`,
      inputSchema: {
        station: StationIdSchema.optional(),
        scenario: z
          .enum([
            "all",
            "low",
            "intermediate-low",
            "intermediate",
            "intermediate-high",
            "high",
            "extreme",
          ])
          .default("intermediate")
          .describe(
            "Emissions/rise scenario from the 2022 Interagency report.",
          ),
        projection_year: z
          .number()
          .int()
          .min(2000)
          .max(2150)
          .optional()
          .describe("Filter to a single decade year (e.g. 2050)."),
        units: UnitsSchema.optional(),
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const payload = await getSeaLevelRiseProjections({
          station: params.station,
          scenario: params.scenario,
          projection_year: params.projection_year,
          units: params.units,
        });
        return respond(
          params.response_format,
          {
            query: { station: params.station, scenario: params.scenario },
            ...payload,
          },
          genericMarkdown(
            `Sea Level Rise Projections${params.station ? ` — Station ${params.station}` : ""} (${params.scenario})`,
            payload,
          ),
        );
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_extreme_water_levels",
    {
      title: "Get Extreme Water Levels",
      description: `Get NOAA's extreme water level exceedance statistics for a station: the annual exceedance probability levels (e.g. the 1%-annual-chance "100-year" level) and historical extreme events, computed from the station's verified record.

Use for flood risk questions ("what water level has a 1% chance per year at X?"). Levels are relative to the station's datums for the 1983–2001 epoch. Only long-record stations have this product.`,
      inputSchema: {
        station: StationIdSchema,
        units: UnitsSchema,
        extremeType: z
          .enum(["annuals", "monthlies"])
          .optional()
          .describe(
            "Extreme statistics basis: annual (default) or monthly extremes.",
          ),
        levelType: z
          .enum(["high", "low"])
          .optional()
          .describe("High extremes (default) or low."),
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const payload = await getExtremeWaterLevels({
          station: params.station,
          units: params.units,
          extremeType: params.extremeType,
          levelType: params.levelType,
        });
        return respond(
          params.response_format,
          { query: { station: params.station }, ...payload },
          genericMarkdown(
            `Extreme Water Levels — Station ${params.station}`,
            payload,
            '_Nested exceedance/event details are in the JSON payload (response_format "json")._',
          ),
        );
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_top_ten_water_levels",
    {
      title: "Get Top Ten / Peak Water Levels",
      description: `Get a station's highest recorded water levels: analysis "toptenwaterlevels" returns the ten highest events on record (with date, height, causal event name like "Great New England Hurricane", and category); "peakwaterlevels" returns peak event records (optionally filtered by year).

Heights are relative to the requested datum (MHHW is typical for flood comparisons). Use for "what's the worst flooding ever recorded at X?".`,
      inputSchema: {
        station: StationIdSchema,
        analysis: z
          .enum(["toptenwaterlevels", "peakwaterlevels"])
          .default("toptenwaterlevels")
          .describe(
            '"toptenwaterlevels" = ten highest on record; "peakwaterlevels" = peak event records.',
          ),
        datum: z
          .enum([
            "STND",
            "MHHW",
            "MHW",
            "MSL",
            "MTL",
            "MLW",
            "MLLW",
            "NAVD",
            "IGLD",
            "LWD",
          ])
          .default("MHHW")
          .describe(
            "Reference datum for reported heights (MHHW is standard for flood context).",
          ),
        units: UnitsSchema,
        year: z
          .number()
          .int()
          .optional()
          .describe("For peakwaterlevels: filter to one year."),
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const payload = await getTopTenWaterLevels({
          station: params.station,
          analysis: params.analysis,
          units: params.units,
          datum: params.datum,
          year: params.year,
        });
        return respond(
          params.response_format,
          {
            query: {
              station: params.station,
              analysis: params.analysis,
              datum: params.datum,
            },
            ...payload,
          },
          genericMarkdown(
            `${params.analysis === "toptenwaterlevels" ? "Top Ten Water Levels" : "Peak Water Levels"} — Station ${params.station}`,
            payload,
            `_Heights relative to ${params.datum}._`,
          ),
        );
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_high_tide_flooding",
    {
      title: "Get High Tide Flooding Data",
      description: `Get NOAA high tide flooding (HTF, "nuisance"/"sunny day" flooding) statistics for a station. Reports:

- daily: flood occurrence per day (REQUIRES start_date and end_date, YYYYMMDD)
- monthly / seasonal / annual: counts of minor/moderate/major flood days per period (filter with year/month/season_months, or range = last N periods)
- met_year_annual: counts by meteorological year (May–April)
- annual_outlook: NOAA's projected flood-day outlook for the coming met year
- projections: decadal flood-day projections through 2100 (filter by decade, flood_threshold)
- record_days: record flood-day counts
- likely_scenarios: likely decadal flooding scenarios
- daily_likelihoods: day-by-day flood likelihood forecasts

Use for: "how often does X flood?", trends in nuisance flooding, future flooding projections. Not all stations have HTF products — check the HTFhistorical flag via noaa_get_station_info.`,
      inputSchema: {
        station: StationIdSchema,
        report: z
          .enum([
            "daily",
            "monthly",
            "seasonal",
            "annual",
            "met_year_annual",
            "annual_outlook",
            "projections",
            "record_days",
            "likely_scenarios",
            "daily_likelihoods",
          ])
          .default("annual")
          .describe("Which HTF report to retrieve (see tool description)."),
        start_date: z
          .string()
          .optional()
          .describe('YYYYMMDD — required for report "daily".'),
        end_date: z
          .string()
          .optional()
          .describe('YYYYMMDD — required for report "daily".'),
        year: z
          .number()
          .int()
          .optional()
          .describe(
            "Filter to a calendar year (monthly/seasonal/annual/record_days).",
          ),
        month: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("Filter to a month (monthly report)."),
        range: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Number of years to cover: with year (or met_year) set, returns year..year+range; without, returns the last N years.",
          ),
        season_months: z
          .enum(["DJF", "MAM", "JJA", "SON"])
          .optional()
          .describe(
            "Season for the seasonal report (Dec-Jan-Feb, Mar-Apr-May, ...).",
          ),
        met_year: z
          .number()
          .int()
          .optional()
          .describe("Meteorological year (met_year_annual / annual_outlook)."),
        decade: z
          .number()
          .int()
          .optional()
          .describe("Decade for projections/likely_scenarios (e.g. 2050)."),
        flood_threshold: z
          .enum(["minor", "moderate", "major"])
          .optional()
          .describe(
            "Flood severity threshold for projections/likely_scenarios.",
          ),
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const { report, response_format, ...rest } = params;
        const payload = await getHighTideFlooding(report as HtfReport, rest);
        return respond(
          response_format,
          { query: { station: params.station, report }, ...payload },
          genericMarkdown(
            `High Tide Flooding (${report}) — Station ${params.station}`,
            payload,
            "_Counts are flood DAYS exceeding the NOS minor/moderate/major thresholds (majCount/modCount/minCount); nanCount = days with missing data._",
          ),
        );
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
