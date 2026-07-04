/**
 * Observed and predicted current tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCurrents, getCurrentPredictions } from "../services/data-api.js";
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
import { unitLabel } from "../format/units.js";

const BinSchema = z
  .number()
  .int()
  .min(0)
  .describe(
    'Depth bin number (current meters measure at multiple depths). Find valid bins with noaa_get_station_info (expand ["bins"]). bin=0 returns ALL bins but caps the request at 7 days. Omit at single-bin stations.',
  );

export function registerCurrentTools(server: McpServer): void {
  server.registerTool(
    "noaa_get_currents",
    {
      title: "Get Observed Currents",
      description: `Get observed current speed and direction from a NOAA current meter station.

Current stations use alphanumeric IDs (e.g. "cb0102" Chesapeake, "bh0101" Boston Harbor) — NOT the 7-digit water-level station IDs. Find them with noaa_search_stations (type "currents") or noaa_find_nearest_stations.

UNITS WARNING: english = knots, but metric = cm/s (centimeters/second, not m/s).

Returns per record: t (time), s (speed), d (direction, degrees true), b (bin number). Max 7 days per request. Set expand_detailed=true to include per-beam echo intensity and correlation diagnostics.`,
      inputSchema: {
        station: StationIdSchema,
        bin: BinSchema.optional(),
        expand_detailed: z
          .boolean()
          .default(false)
          .describe(
            "Include ADCP beam diagnostics (echo1-4, corr1-4) per record.",
          ),
        units: UnitsSchema,
        time_zone: TimeZoneSchema,
        ...dateFields,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const response = await getCurrents(params);
        const data = response.data ?? [];
        const speedLabel = unitLabel("currents", params.units);
        const structured = {
          station: params.station,
          product: "currents",
          bin: params.bin,
          units: params.units,
          speed_units: speedLabel,
          direction_units: "degrees true",
          time_zone: params.time_zone,
          count: data.length,
          data,
        };
        const markdown = seriesMarkdown(
          {
            title: "Observed Currents",
            station: params.station,
            unitsLabel: `speed in ${speedLabel}, direction in degrees true`,
            timeZone: timeZoneLabel(params.time_zone),
          },
          ["Time", `Speed (${speedLabel})`, "Direction (°T)", "Bin"],
          data.map((d) => [d.t, d.s, d.d, d.b]),
        );
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_current_predictions",
    {
      title: "Get Current Predictions",
      description: `Get predicted tidal currents for a NOAA current prediction station.

interval="max_slack" (recommended for navigation) returns the tidal-current events — maximum flood, maximum ebb, and slack water times — up to 1 year per request. Other intervals (h, 1, 6, 10, 30, 60 minutes) return a velocity time series — up to 31 days.

UNITS WARNING: english = knots; metric = cm/s.

vel_type="speed_dir" returns Speed/Direction pairs; "default" returns velocities projected on the flood/ebb axis (Velocity_Major: positive = flood direction, negative = ebb) with meanFloodDir/meanEbbDir. Subordinate (type "S") prediction stations derive from a reference station — see noaa_get_prediction_offsets.`,
      inputSchema: {
        station: StationIdSchema,
        bin: BinSchema.optional(),
        interval: z
          .enum(["max_slack", "h", "1", "6", "10", "30", "60"])
          .default("max_slack")
          .describe(
            '"max_slack" = max flood/ebb + slack events (1-year max span); h/1/6/10/30/60 = time series (31-day max span).',
          ),
        vel_type: z
          .enum(["default", "speed_dir"])
          .default("default")
          .describe(
            '"default" = flood/ebb-axis velocity (Velocity_Major signed: + flood, - ebb); "speed_dir" = speed and compass direction.',
          ),
        units: UnitsSchema,
        time_zone: TimeZoneSchema,
        ...dateFields,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const response = await getCurrentPredictions(params);
        const raw = response.current_predictions;
        const data: Array<Record<string, string | number | undefined>> =
          Array.isArray(raw) ? raw : (raw?.cp ?? []);
        const speedLabel = unitLabel("currents", params.units);
        const structured = {
          station: params.station,
          product: "currents_predictions",
          interval: params.interval,
          vel_type: params.vel_type,
          bin: params.bin,
          units: params.units,
          speed_units: speedLabel,
          time_zone: params.time_zone,
          count: data.length,
          predictions: data,
        };

        let headers: string[];
        let rows: Array<Array<string | number | null | undefined>>;
        if (params.vel_type === "speed_dir") {
          headers = [
            "Time",
            `Speed (${speedLabel})`,
            "Direction (°T)",
            "Depth",
            "Bin",
          ];
          rows = data.map((d) => [
            d.Time,
            d.Speed,
            d.Direction,
            d.Depth,
            d.Bin,
          ]);
        } else {
          headers = [
            "Time",
            `Velocity along flood/ebb axis (${speedLabel})`,
            "Type",
            "Depth",
            "Bin",
          ];
          rows = data.map((d) => {
            const velocity = Number(d.Velocity_Major);
            const type =
              (d as Record<string, unknown>).Type ??
              (isNaN(velocity)
                ? ""
                : Math.abs(velocity) < 0.05
                  ? "slack"
                  : velocity > 0
                    ? "flood"
                    : "ebb");
            return [d.Time, d.Velocity_Major, String(type), d.Depth, d.Bin];
          });
        }
        const markdown = seriesMarkdown(
          {
            title:
              params.interval === "max_slack"
                ? "Current Predictions — Max Flood/Ebb & Slack"
                : "Current Predictions",
            station: params.station,
            unitsLabel: `speed in ${speedLabel}`,
            timeZone: timeZoneLabel(params.time_zone),
            extra:
              params.vel_type === "default"
                ? [
                    "_Velocity sign: positive = flood direction, negative = ebb direction._",
                  ]
                : undefined,
          },
          headers,
          rows,
        );
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
