/**
 * Water level observation and tide prediction tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getWaterLevels,
  getWaterLevelSummaries,
  getTidePredictions,
  type DataApiResponse,
} from "../services/data-api.js";
import {
  dateFields,
  DatumSchema,
  READ_ONLY_ANNOTATIONS,
  ResponseFormatSchema,
  StationIdSchema,
  TimeZoneSchema,
  UnitsSchema,
} from "../schemas/common.js";
import { respond, respondError } from "../format/respond.js";
import { seriesMarkdown, timeZoneLabel } from "../format/series.js";
import { FLAG_LEGENDS, unitLabel } from "../format/units.js";

function metadataName(response: DataApiResponse): string | undefined {
  return response.metadata?.name;
}

export function registerWaterTools(server: McpServer): void {
  server.registerTool(
    "noaa_get_water_levels",
    {
      title: "Get Observed Water Levels",
      description: `Get observed water levels from a NOAA tide station as a time series.

Choose the interval: "6" = standard 6-minute observations (preliminary or verified, max 31 days per request), "1" = 1-minute preliminary data (max 4 days), "hourly" = verified hourly heights (max 1 year). Heights are relative to the requested datum (MLLW by default — the US nautical chart zero).

Returns per record: t (timestamp in requested time zone), v (height), s (sigma), f (quality flags, decoded in output), q (p=preliminary, v=verified). Recent data is preliminary; verification takes days to weeks.

Use for: "what is the water level right now" (date=latest), storm surge analysis, comparing observed vs predicted tide. Do NOT use for future tides — use noaa_get_tide_predictions.`,
      inputSchema: {
        station: StationIdSchema,
        interval: z
          .enum(["1", "6", "hourly"])
          .default("6")
          .describe(
            'Observation interval: "6" = 6-minute (standard, 31-day max), "1" = 1-minute preliminary (4-day max), "hourly" = verified hourly heights (1-year max).',
          ),
        datum: DatumSchema.default("MLLW"),
        units: UnitsSchema,
        time_zone: TimeZoneSchema,
        ...dateFields,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const { product, response } = await getWaterLevels(params);
        const data = response.data ?? [];
        const unitsLabel = `${unitLabel("water_level", params.units)} above ${params.datum}`;
        const structured = {
          station: params.station,
          station_name: metadataName(response),
          product,
          datum: params.datum,
          units: params.units,
          units_label: unitsLabel,
          time_zone: params.time_zone,
          count: data.length,
          data,
        };
        const anyVerified = data.some((d) => d.q === "v");
        const anyPreliminary = data.some((d) => d.q === "p");
        const legend =
          params.interval === "hourly"
            ? FLAG_LEGENDS.hourly_height
            : anyPreliminary && !anyVerified
              ? FLAG_LEGENDS.water_level_preliminary
              : FLAG_LEGENDS.water_level_verified;
        const markdown = seriesMarkdown(
          {
            title: "Observed Water Levels",
            station: params.station,
            stationName: metadataName(response),
            unitsLabel,
            datum: params.datum,
            timeZone: timeZoneLabel(params.time_zone),
          },
          [
            "Time",
            `Height (${unitLabel("water_level", params.units)})`,
            "Sigma",
            "Quality",
            "Flags",
          ],
          data.map((d) => [
            d.t,
            d.v,
            d.s,
            d.q === "v" ? "verified" : d.q === "p" ? "preliminary" : d.q,
            d.f,
          ]),
          legend,
        );
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_water_level_summaries",
    {
      title: "Get Water Level Summaries (High/Low, Daily, Monthly)",
      description: `Get verified summary water-level products from a NOAA station:

- high_low: each day's observed highs/lows with ty = HH (higher high), H, L, LL (lower low). Max 1 year per request.
- daily_mean: daily mean levels — GREAT LAKES STATIONS ONLY; NOAA requires local standard time, which this tool applies automatically. Max 10 years.
- daily_max_min: daily maxima/minima from hourly and 6-minute data with completeness percentages. Max 10 years.
- monthly_mean: monthly tidal datum means (columns MHHW, MHW, MSL, MTL, MLW, MLLW, DTL, GT, MN, DHQ, DLQ, HWI, LWI, highest, lowest). Max 200 years — ideal for long-term climatology.

Use for: historical extremes, mixed-tide analysis (HH vs H), long-term averages. For raw time series use noaa_get_water_levels; for future tides use noaa_get_tide_predictions.`,
      inputSchema: {
        station: StationIdSchema,
        product: z
          .enum(["high_low", "daily_mean", "daily_max_min", "monthly_mean"])
          .describe(
            "Summary product: high_low (daily tide extremes, 1yr max), daily_mean (Great Lakes only, 10yr), daily_max_min (10yr), monthly_mean (datum means, 200yr).",
          ),
        datum: DatumSchema.default("MLLW"),
        units: UnitsSchema,
        time_zone: TimeZoneSchema,
        ...dateFields,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const { response, timeZoneForced } =
          await getWaterLevelSummaries(params);
        const data = response.data ?? [];
        const unitsLabel = `${unitLabel("water_level", params.units)} above ${params.datum}`;
        const structured = {
          station: params.station,
          station_name: metadataName(response),
          product: params.product,
          datum: params.datum,
          units: params.units,
          units_label: unitsLabel,
          time_zone: timeZoneForced ? "lst" : params.time_zone,
          time_zone_forced_to_lst: timeZoneForced || undefined,
          count: data.length,
          data,
        };

        let headers: string[];
        let rows: Array<Array<string | number | null | undefined>>;
        let legend: string | undefined;
        if (params.product === "high_low") {
          headers = [
            "Time",
            `Height (${unitLabel("water_level", params.units)})`,
            "Type",
            "Flags",
          ];
          const tyLabels: Record<string, string> = {
            HH: "higher high",
            H: "high",
            L: "low",
            LL: "lower low",
          };
          rows = data.map((d) => {
            const ty = (d.ty ?? "").trim();
            return [d.t, d.v, ty ? `${ty} (${tyLabels[ty] ?? "?"})` : "", d.f];
          });
          legend = FLAG_LEGENDS.high_low;
        } else if (params.product === "monthly_mean") {
          headers = [
            "Year",
            "Month",
            "Highest",
            "MHHW",
            "MSL",
            "MLLW",
            "Lowest",
          ];
          rows = data.map((d) => {
            const rec = d as Record<string, string | undefined>;
            return [
              rec.year,
              rec.month,
              rec.highest,
              rec.MHHW,
              rec.MSL,
              rec.MLLW,
              rec.lowest,
            ];
          });
          legend =
            'Full datum columns (MHW, MTL, MLW, DTL, GT, MN, DHQ, DLQ, HWI, LWI, inferred) are in the JSON payload (response_format "json").';
        } else {
          headers = [
            "Date",
            `Value (${unitLabel("water_level", params.units)})`,
            "Flags",
          ];
          rows = data.map((d) => [d.t, d.v, d.f]);
          legend = FLAG_LEGENDS.hourly_height;
        }

        const extra: string[] = [];
        if (timeZoneForced) {
          extra.push(
            "_Note: daily_mean requires local standard time — time_zone was set to lst._",
          );
        }
        const markdown = seriesMarkdown(
          {
            title: `Water Level Summary — ${params.product}`,
            station: params.station,
            stationName: metadataName(response),
            unitsLabel,
            datum: params.datum,
            timeZone: timeZoneForced
              ? timeZoneLabel("lst")
              : timeZoneLabel(params.time_zone),
            extra,
          },
          headers,
          rows,
          legend,
        );
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_tide_predictions",
    {
      title: "Get Tide Predictions",
      description: `Get NOAA harmonic tide predictions (future or past) for a station.

interval="hilo" (recommended for "when is high/low tide") returns the daily tide events with type H/L — up to 10 years per request. Other intervals (h, 1, 5, 6, 10, 15, 30, 60 minutes) return a height time series — up to 1 year per request.

Heights are relative to the requested datum (MLLW default). Notes:
- Great Lakes stations have NO tide predictions (lake levels are not tidal).
- Subordinate stations (type "S") only support interval=hilo; use the station's reference (R) station for interval series.
- Predictions are astronomical only — they exclude weather effects (storm surge, wind setup). Compare with noaa_get_water_levels for actual conditions.`,
      inputSchema: {
        station: StationIdSchema,
        interval: z
          .enum(["hilo", "h", "1", "5", "6", "10", "15", "30", "60"])
          .default("hilo")
          .describe(
            '"hilo" = high/low tide events only (max 10-year span). "h" = hourly, or 1/5/6/10/15/30/60-minute series (max 1-year span).',
          ),
        datum: DatumSchema.default("MLLW"),
        units: UnitsSchema,
        time_zone: TimeZoneSchema,
        ...dateFields,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const response = await getTidePredictions(params);
        const data = response.predictions ?? [];
        const unitsLabel = `${unitLabel("water_level", params.units)} above ${params.datum}`;
        const structured = {
          station: params.station,
          product: "predictions",
          interval: params.interval,
          datum: params.datum,
          units: params.units,
          units_label: unitsLabel,
          time_zone: params.time_zone,
          count: data.length,
          predictions: data,
        };
        const isHilo = params.interval === "hilo";
        const markdown = seriesMarkdown(
          {
            title: isHilo
              ? "Tide Predictions — High/Low Events"
              : "Tide Predictions",
            station: params.station,
            unitsLabel,
            datum: params.datum,
            timeZone: timeZoneLabel(params.time_zone),
            extra: [
              "_Astronomical predictions only — actual levels also depend on weather (surge, wind)._",
            ],
          },
          isHilo
            ? [
                "Time",
                `Height (${unitLabel("water_level", params.units)})`,
                "Tide",
              ]
            : ["Time", `Height (${unitLabel("water_level", params.units)})`],
          data.map((d) => {
            const type = (d as Record<string, string | undefined>).type ?? d.ty;
            return isHilo
              ? [d.t, d.v, type === "H" ? "High" : type === "L" ? "Low" : type]
              : [d.t, d.v];
          }),
        );
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
