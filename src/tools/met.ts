/**
 * Meteorological and ancillary sensor data tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getMeteorologicalData,
  type MetProduct,
} from "../services/data-api.js";
import {
  dateFields,
  READ_ONLY_ANNOTATIONS,
  ResponseFormatSchema,
  StationIdSchema,
  TimeZoneSchema,
  UnitsSchema,
} from "../schemas/common.js";
import { respond, respondError } from "../format/respond.js";
import { seriesMarkdown, timeZoneLabel } from "../format/series.js";
import { FLAG_LEGENDS, MeasurementKind, unitLabel } from "../format/units.js";

const MET_KIND: Record<MetProduct, MeasurementKind> = {
  air_temperature: "air_temperature",
  water_temperature: "water_temperature",
  wind: "wind",
  air_pressure: "air_pressure",
  air_gap: "air_gap",
  conductivity: "conductivity",
  visibility: "visibility",
  humidity: "humidity",
  salinity: "salinity",
};

/**
 * Classify a 3-hour pressure delta (mb) into the angler-meaningful states
 * bite-forecast apps use. Thresholds follow the common meteorological
 * convention: ±0.5 mb/3h ≈ steady, ±2 mb/3h ≈ rapid.
 */
export function classifyPressureTrend(rate: number | null): {
  state: string;
  interpretation: string;
} {
  if (rate === null) {
    return {
      state: "unknown",
      interpretation:
        "Too little recent data to classify the trend — widen the window or try another station.",
    };
  }
  if (rate <= -2) {
    return {
      state: "falling rapidly",
      interpretation:
        "Sharp fall — a front or low is approaching. Classic pre-frontal window: fish often feed aggressively before it arrives, then shut down as it passes.",
    };
  }
  if (rate <= -0.5) {
    return {
      state: "falling",
      interpretation:
        "Falling barometer — deteriorating weather ahead. Feeding activity often picks up while the fall continues.",
    };
  }
  if (rate < 0.5) {
    return {
      state: "steady",
      interpretation:
        "Steady pressure — stable conditions and predictable patterns. After ~2-3 stable days, expect normal feeding around tide changes and solunar windows.",
    };
  }
  if (rate < 2) {
    return {
      state: "rising",
      interpretation:
        "Rising barometer — clearing weather. The first day after a front is often slow; fishing typically improves as the rise levels off.",
    };
  }
  return {
    state: "rising rapidly",
    interpretation:
      "Sharp post-frontal rise — bluebird high-pressure conditions. Often the toughest bite; fish deeper, slower, and around structure.",
  };
}

export function registerMetTools(server: McpServer): void {
  server.registerTool(
    "noaa_get_meteorological_data",
    {
      title: "Get Meteorological & Sensor Data",
      description: `Get observed meteorological/oceanographic sensor data from a NOAA station.

Products: air_temperature, water_temperature, wind (speed/gust/direction), air_pressure, air_gap (bridge clearance to water surface), conductivity, visibility, humidity, salinity.

Units by system: temps °F/°C; wind knots (english) or m/s (metric); air_gap feet/meters; visibility nautical miles/kilometers; air_pressure always millibars; salinity always PSU. Max span ~31 days per request; interval "6" (6-minute, default) or "h" (hourly).

Not every station has every sensor — check with noaa_get_station_info (expand ["sensors"]). Water-level data is served by noaa_get_water_levels, not this tool.`,
      inputSchema: {
        station: StationIdSchema,
        product: z
          .enum([
            "air_temperature",
            "water_temperature",
            "wind",
            "air_pressure",
            "air_gap",
            "conductivity",
            "visibility",
            "humidity",
            "salinity",
          ])
          .describe("Sensor product to retrieve."),
        interval: z
          .enum(["6", "h"])
          .default("6")
          .describe('"6" = 6-minute observations (default), "h" = hourly.'),
        units: UnitsSchema,
        time_zone: TimeZoneSchema,
        ...dateFields,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const response = await getMeteorologicalData(params);
        const data = response.data ?? [];
        const kind = MET_KIND[params.product];
        const valueLabel = unitLabel(kind, params.units);
        const structured = {
          station: params.station,
          product: params.product,
          units: params.units,
          units_label: valueLabel,
          time_zone: params.time_zone,
          count: data.length,
          data,
        };

        let headers: string[];
        let rows: Array<Array<string | number | null | undefined>>;
        let legend: string | undefined;
        if (params.product === "wind") {
          headers = [
            "Time",
            `Speed (${valueLabel})`,
            `Gust (${valueLabel})`,
            "Direction (°T)",
            "Compass",
            "Flags",
          ];
          rows = data.map((d) => [d.t, d.s, d.g, d.d, d.dr, d.f]);
          legend = FLAG_LEGENDS.wind;
        } else if (params.product === "salinity") {
          headers = ["Time", "Salinity (PSU)", "Specific gravity"];
          rows = data.map((d) => [d.t, d.s, d.g]);
        } else {
          headers = ["Time", `Value (${valueLabel})`, "Flags"];
          rows = data.map((d) => [d.t, d.v, d.f]);
          legend =
            params.product === "air_gap"
              ? FLAG_LEGENDS.air_gap
              : FLAG_LEGENDS.met;
        }
        const markdown = seriesMarkdown(
          {
            title: `Meteorological Data — ${params.product}`,
            station: params.station,
            unitsLabel: valueLabel,
            timeZone: timeZoneLabel(params.time_zone),
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
    "noaa_get_pressure_trend",
    {
      title: "Get Barometric Pressure Trend (Fishing Conditions)",
      description: `Classify the barometric pressure trajectory at a NOAA station into the angler-meaningful states the bite-forecast apps use: falling rapidly / falling / steady / rising / rising rapidly, from observed air_pressure over the last 6-72 hours.

Returns the latest pressure plus 3h/6h/24h deltas (millibars) and a fishing interpretation: a falling barometer ahead of a front often triggers aggressive pre-frontal feeding; a sharp rise into a post-frontal high commonly shuts fishing down; long steady pressure means stable, predictable patterns.

Requires a station with a barometric sensor (check noaa_get_station_info, expand ["sensors"]); offshore alternatives report PTDY via ndbc_get_buoy_observations.`,
      inputSchema: {
        station: StationIdSchema,
        hours: z
          .number()
          .int()
          .min(6)
          .max(72)
          .default(30)
          .describe("Observation window ending now (hours back)."),
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const response = await getMeteorologicalData({
          station: params.station,
          product: "air_pressure",
          interval: "6",
          units: "metric", // pressure is millibars in both systems
          time_zone: "gmt",
          range: params.hours,
        });
        const samples = (response.data ?? [])
          .map((d) => ({
            t: d.t as string,
            v: Number(d.v),
          }))
          .filter((d) => Number.isFinite(d.v));
        if (samples.length < 2) {
          throw new Error(
            `Not enough air_pressure data at station ${params.station} in the last ${params.hours}h to compute a trend. The station may lack a barometric sensor — check noaa_get_station_info (expand ["sensors"]).`,
          );
        }
        const latest = samples[samples.length - 1];
        const latestMs = Date.parse(`${latest.t.replace(" ", "T")}Z`);
        const deltaOver = (hoursBack: number): number | null => {
          const target = latestMs - hoursBack * 3_600_000;
          let best: { t: string; v: number } | undefined;
          let bestDist = Infinity;
          for (const s of samples) {
            const dist = Math.abs(
              Date.parse(`${s.t.replace(" ", "T")}Z`) - target,
            );
            if (dist < bestDist) {
              bestDist = dist;
              best = s;
            }
          }
          // Reject when the nearest sample is over an hour off target.
          if (!best || bestDist > 3_600_000) return null;
          return Math.round((latest.v - best.v) * 10) / 10;
        };
        const d3 = deltaOver(3);
        const d6 = deltaOver(6);
        const d24 = params.hours >= 24 ? deltaOver(24) : null;

        // Classification keys off the 3-hour delta.
        const { state, interpretation } = classifyPressureTrend(d3);

        const structured = {
          station: params.station,
          window_hours: params.hours,
          latest_pressure_mb: latest.v,
          latest_time_utc: latest.t,
          delta_3h_mb: d3,
          delta_6h_mb: d6,
          delta_24h_mb: d24,
          trend: state,
          interpretation,
          sample_count: samples.length,
        };
        const markdown = [
          `# Barometric Pressure Trend — Station ${params.station}`,
          "",
          `**Latest**: ${latest.v} mb at ${latest.t} UTC`,
          "",
          `- **3h change**: ${d3 === null ? "—" : `${d3 > 0 ? "+" : ""}${d3} mb`}`,
          `- **6h change**: ${d6 === null ? "—" : `${d6 > 0 ? "+" : ""}${d6} mb`}`,
          `- **24h change**: ${d24 === null ? "—" : `${d24 > 0 ? "+" : ""}${d24} mb`}`,
          "",
          `**Trend**: ${state.toUpperCase()}`,
          "",
          interpretation,
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
