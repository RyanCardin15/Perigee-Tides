/**
 * NDBC buoy tools: find offshore buoys near a point and read their realtime
 * observations — observed waves, water temperature, wind, and the 3-hour
 * pressure tendency anglers use to time fronts. Complements CO-OPS coastal
 * stations (which rarely carry wave or offshore water-temp sensors).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { CHARTS_UI_URI } from "../ui/app-resource.js";
import {
  findNearestBuoys,
  getBuoyObservations,
  NdbcObservation,
} from "../services/ndbc.js";
import {
  LatitudeSchema,
  LongitudeSchema,
  READ_ONLY_ANNOTATIONS,
  ResponseFormatSchema,
  UnitsSchema,
} from "../schemas/common.js";
import { markdownTable, respond, respondError } from "../format/respond.js";
import { seriesMarkdown } from "../format/series.js";

const BuoyIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9]{4,6}$/,
    'NDBC IDs are 5-digit numbers for moored buoys (e.g. "41013") or alphanumeric codes for coastal/C-MAN stations (e.g. "BUZM3").',
  )
  .describe(
    'NDBC station ID (e.g. "41013", "BUZM3") — distinct from CO-OPS station IDs. Find one with ndbc_find_nearest_buoys.',
  );

const MS_TO_KNOTS = 1.9438444924;
const M_TO_FT = 3.28084;

function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

interface DisplayObservation {
  time: string;
  wind_dir_deg: number | null;
  wind_speed: number | null;
  wind_gust: number | null;
  wave_height: number | null;
  dominant_period_s: number | null;
  average_period_s: number | null;
  mean_wave_dir_deg: number | null;
  pressure_mb: number | null;
  pressure_tendency_mb: number | null;
  air_temp: number | null;
  water_temp: number | null;
  dewpoint: number | null;
}

/** Convert NDBC's fixed metric units to the requested display system. */
export function toDisplayUnits(
  obs: NdbcObservation,
  units: "english" | "metric",
): DisplayObservation {
  const english = units === "english";
  const speed = (v: number | null) =>
    v === null ? null : round1(english ? v * MS_TO_KNOTS : v);
  const length = (v: number | null) =>
    v === null ? null : round1(english ? v * M_TO_FT : v);
  const temp = (v: number | null) =>
    v === null ? null : round1(english ? cToF(v) : v);
  return {
    time: obs.time,
    wind_dir_deg: obs.wind_dir_deg,
    wind_speed: speed(obs.wind_speed_ms),
    wind_gust: speed(obs.wind_gust_ms),
    wave_height: length(obs.wave_height_m),
    dominant_period_s: obs.dominant_period_s,
    average_period_s: obs.average_period_s,
    mean_wave_dir_deg: obs.mean_wave_dir_deg,
    pressure_mb: obs.pressure_hpa,
    pressure_tendency_mb: obs.pressure_tendency_hpa,
    air_temp: temp(obs.air_temp_c),
    water_temp: temp(obs.water_temp_c),
    dewpoint: temp(obs.dewpoint_c),
  };
}

export function registerBuoyTools(server: McpServer): void {
  server.registerTool(
    "ndbc_find_nearest_buoys",
    {
      title: "Find Nearest NDBC Buoys",
      description: `Find active NOAA NDBC buoys and coastal (C-MAN) stations nearest a latitude/longitude, sorted by great-circle distance. NDBC stations report what CO-OPS tide stations usually don't: offshore wave height/period/direction, sea-surface temperature, and open-water wind.

NDBC IDs (e.g. "41013", "BUZM3") are a separate namespace from CO-OPS station IDs — use them only with ndbc_get_buoy_observations.`,
      inputSchema: {
        latitude: LatitudeSchema,
        longitude: LongitudeSchema,
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Maximum stations to return."),
        max_distance_km: z
          .number()
          .positive()
          .optional()
          .describe("Only include stations within this distance."),
        require_met: z
          .boolean()
          .default(false)
          .describe(
            "Only stations currently reporting standard meteorology (wind/pressure/temps). Note: some wave-only buoys report waves but not met.",
          ),
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const stations = await findNearestBuoys(
          params.latitude,
          params.longitude,
          params.limit,
          {
            requireMet: params.require_met,
            maxDistanceKm: params.max_distance_km,
          },
        );
        const structured = {
          count: stations.length,
          stations: stations.map((s) => ({
            ...s,
            distance_km: round1(s.distance_km),
            distance_mi: round1(s.distance_mi),
          })),
        };
        const markdown = [
          `# Nearest NDBC Buoys to (${params.latitude}, ${params.longitude})`,
          "",
          stations.length === 0
            ? "_No active NDBC stations matched. Try removing max_distance_km or require_met._"
            : markdownTable(
                [
                  "ID",
                  "Name",
                  "Type",
                  "Distance (km)",
                  "Distance (mi)",
                  "Met",
                  "Currents",
                ],
                stations.map((s) => [
                  s.id,
                  s.name,
                  s.type,
                  s.distance_km.toFixed(1),
                  s.distance_mi.toFixed(1),
                  s.has_met ? "yes" : "no",
                  s.has_currents ? "yes" : "no",
                ]),
              ),
          "",
          "_Read a station's data with ndbc_get_buoy_observations. Wave sensors are common on 5-digit moored buoys; C-MAN shore stations usually report met only._",
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  registerAppTool(
    server,
    "ndbc_get_buoy_observations",
    {
      title: "Get NDBC Buoy Observations",
      description: `Realtime observations from an NDBC buoy or C-MAN station, newest first: wind (direction/speed/gust), waves (significant height, dominant and average period, direction), sea-level pressure with 3-hour tendency (PTDY — falling pressure often precedes a feeding window, a sharp post-frontal rise often shuts fishing down), air/water temperature, and dewpoint.

NDBC publishes the last ~45 days at 10-60 minute cadence. Fields a station doesn't sense are null.`,
      inputSchema: {
        buoy_id: BuoyIdSchema,
        hours: z
          .number()
          .int()
          .min(1)
          .max(1080)
          .default(24)
          .describe("How many hours back from now to return (max 45 days)."),
        units: UnitsSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { ui: { resourceUri: CHARTS_UI_URI } },
    },
    async (params) => {
      try {
        const result = await getBuoyObservations(params.buoy_id, params.hours);
        const display = result.observations.map((o) =>
          toDisplayUnits(o, params.units),
        );
        const english = params.units === "english";
        const speedUnit = english ? "kt" : "m/s";
        const lengthUnit = english ? "ft" : "m";
        const tempUnit = english ? "°F" : "°C";
        const structured = {
          viz: { kind: "buoy_obs" },
          station_id: result.station_id,
          station: result.station,
          units: params.units,
          unit_labels: {
            wind: speedUnit,
            waves: lengthUnit,
            temperature: tempUnit,
            pressure: "mb",
            wave_period: "s",
          },
          count: display.length,
          observations: display,
        };
        // Keep the table readable: cap markdown rows, full series in JSON.
        const rows = display.slice(0, 48);
        const markdown = seriesMarkdown(
          {
            title: "NDBC Buoy Observations",
            station: result.station_id,
            stationName: result.station?.name,
            unitsLabel: `wind ${speedUnit} · waves ${lengthUnit} · temps ${tempUnit} · pressure mb`,
            timeZone: "UTC",
            extra:
              display.length > rows.length
                ? [
                    `_Showing newest ${rows.length} of ${display.length} records; the JSON payload carries all of them._`,
                  ]
                : undefined,
          },
          [
            "Time (UTC)",
            "Wind dir",
            `Wind (${speedUnit})`,
            `Gust (${speedUnit})`,
            `Waves (${lengthUnit})`,
            "Dom period (s)",
            `Water (${tempUnit})`,
            `Air (${tempUnit})`,
            "Pressure (mb)",
            "3h Δ (mb)",
          ],
          rows.map((o) => [
            o.time.replace(".000Z", "Z"),
            o.wind_dir_deg,
            o.wind_speed,
            o.wind_gust,
            o.wave_height,
            o.dominant_period_s,
            o.water_temp,
            o.air_temp,
            o.pressure_mb,
            o.pressure_tendency_mb,
          ]),
          "PTDY (3h Δ): falling = approaching low/front; rising = clearing high.",
        );
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
