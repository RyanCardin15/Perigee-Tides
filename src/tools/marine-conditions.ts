/**
 * Open-Meteo Marine model forecast tool — wave/swell/SST/surface currents for
 * ANY ocean coordinate ("virtual buoy"), where NWS gridpoints stop at US
 * waters and NDBC only covers real buoys. Model output, not observations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  getMarineForecast,
  MarineHourlySample,
} from "../services/open-meteo.js";
import {
  LatitudeSchema,
  LongitudeSchema,
  READ_ONLY_ANNOTATIONS,
  ResponseFormatSchema,
  UnitsSchema,
} from "../schemas/common.js";
import { markdownTable, respond, respondError } from "../format/respond.js";
import { CHARTS_UI_URI } from "../ui/app-resource.js";

const M_TO_FT = 3.28084;
const KMH_TO_KNOTS = 0.539957;
const KMH_TO_CMS = 27.77778;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

interface DisplaySample {
  time: string;
  wave_height: number | null;
  wave_direction_deg: number | null;
  wave_period_s: number | null;
  wind_wave_height: number | null;
  swell_height: number | null;
  swell_direction_deg: number | null;
  swell_period_s: number | null;
  sea_surface_temp: number | null;
  current_speed: number | null;
  current_direction_deg: number | null;
}

/** Convert Open-Meteo native units (m, °C, km/h) to the display system. */
export function toDisplaySample(
  s: MarineHourlySample,
  units: "english" | "metric",
): DisplaySample {
  const english = units === "english";
  const length = (v: number | null) =>
    v === null ? null : round1(english ? v * M_TO_FT : v);
  const temp = (v: number | null) =>
    v === null ? null : round1(english ? (v * 9) / 5 + 32 : v);
  // Repo convention: currents are knots (english) or cm/s (metric).
  const current = (v: number | null) =>
    v === null ? null : round1(english ? v * KMH_TO_KNOTS : v * KMH_TO_CMS);
  return {
    time: s.time,
    wave_height: length(s.wave_height_m),
    wave_direction_deg: s.wave_direction_deg,
    wave_period_s: s.wave_period_s,
    wind_wave_height: length(s.wind_wave_height_m),
    swell_height: length(s.swell_wave_height_m),
    swell_direction_deg: s.swell_wave_direction_deg,
    swell_period_s: s.swell_wave_period_s,
    sea_surface_temp: temp(s.sea_surface_temp_c),
    current_speed: current(s.current_velocity_kmh),
    current_direction_deg: s.current_direction_deg,
  };
}

export function registerMarineConditionsTools(server: McpServer): void {
  registerAppTool(
    server,
    "openmeteo_get_marine_forecast",
    {
      title: "Get Marine Model Forecast (Waves, Swell, SST, Currents)",
      description: `Hourly MODEL forecast for any ocean coordinate worldwide — a "virtual buoy": combined significant wave height/direction/period, wind-wave vs swell components (separately), sea surface temperature, and surface current speed/direction. Up to 10 days.

Data is Open-Meteo's blend of wave models (GFS-Wave, ECMWF WAM, ICON-Wave) — model output, NOT observations; cross-check a nearby real buoy with ndbc_get_buoy_observations when one exists. Coastal points snap to the nearest ocean model cell; inland points error. Attribution: open-meteo.com (CC BY 4.0, non-commercial tier).

Fishing context: long-period swell (>10s) with low wind-wave means clean conditions; SST breaks concentrate bait and pelagics.`,
      inputSchema: {
        latitude: LatitudeSchema,
        longitude: LongitudeSchema,
        days: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(3)
          .describe("Forecast length in days (hourly resolution)."),
        units: UnitsSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { ui: { resourceUri: CHARTS_UI_URI } },
    },
    async (params) => {
      try {
        const forecast = await getMarineForecast(
          params.latitude,
          params.longitude,
          params.days,
        );
        const display = forecast.samples.map((s) =>
          toDisplaySample(s, params.units),
        );
        const english = params.units === "english";
        const lengthUnit = english ? "ft" : "m";
        const tempUnit = english ? "°F" : "°C";
        const currentUnit = english ? "kt" : "cm/s";
        const structured = {
          viz: { kind: "marine_forecast" },
          latitude: forecast.latitude,
          longitude: forecast.longitude,
          source: "Open-Meteo Marine (model blend; not observations)",
          units: params.units,
          unit_labels: {
            waves: lengthUnit,
            temperature: tempUnit,
            currents: currentUnit,
            period: "s",
          },
          count: display.length,
          hourly: display,
        };
        // Markdown shows every 3rd hour to stay readable; JSON carries all.
        const rows = display.filter((_, i) => i % 3 === 0);
        const markdown = [
          `# Marine Model Forecast (${forecast.latitude}, ${forecast.longitude})`,
          "",
          `**Source**: Open-Meteo wave-model blend (forecast, not observations) · **Units**: waves ${lengthUnit}, temps ${tempUnit}, currents ${currentUnit} · **Records**: ${display.length} hourly (table shows every 3rd)`,
          "",
          markdownTable(
            [
              "Time (UTC)",
              `Waves (${lengthUnit})`,
              "Dir",
              "Period (s)",
              `Swell (${lengthUnit})`,
              "Swell period (s)",
              `SST (${tempUnit})`,
              `Current (${currentUnit})`,
            ],
            rows.map((s) => [
              s.time.slice(0, 16).replace("T", " "),
              s.wave_height,
              s.wave_direction_deg === null
                ? null
                : `${Math.round(s.wave_direction_deg)}°`,
              s.wave_period_s,
              s.swell_height,
              s.swell_period_s,
              s.sea_surface_temp,
              s.current_speed,
            ]),
          ),
          "",
          "_Directions: waves/swell FROM, currents TOWARD (degrees true). Weather data by Open-Meteo.com (CC BY 4.0)._",
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
