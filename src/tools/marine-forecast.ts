/**
 * Wind & marine FORECAST tools backed by the NWS Weather API
 * (api.weather.gov) — a different NOAA service from CO-OPS, hence the
 * nws_* prefix (mirroring how astro_* marks non-CO-OPS tools).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getMarineTextForecast,
  getWindForecast,
  knotsToMs,
  metersToFeet,
} from "../services/nws-api.js";
import {
  LatitudeSchema,
  LongitudeSchema,
  READ_ONLY_ANNOTATIONS,
  ResponseFormatSchema,
  UnitsSchema,
} from "../schemas/common.js";
import { respond, respondError } from "../format/respond.js";
import { seriesMarkdown } from "../format/series.js";

/** "2026-07-06 09:00" in the gridpoint's IANA time zone. */
function formatLocal(isoUtc: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(isoUtc));
  } catch {
    return isoUtc;
  }
}

export function registerMarineForecastTools(server: McpServer): void {
  server.registerTool(
    "nws_get_wind_forecast",
    {
      title: "Get Wind Forecast (NWS)",
      description: `Get the NWS hourly wind FORECAST (speed, gust, direction — plus wave height where the grid carries it) for a latitude/longitude.

Data comes from the NWS forecast grid (api.weather.gov gridpoints — numeric NDFD values, not display strings). Horizon is up to ~7 days (156 hours), starting at the current hour. US and territories only. Wave height appears for marine/nearshore gridpoints; swell/period fields are typically only populated for open-ocean points.

Units: english = knots and feet (default), metric = m/s and meters. Direction is degrees true, the direction the wind blows FROM.

This is FORECAST data. For observed (measured) wind at a NOAA station right now, use noaa_get_meteorological_data (product "wind"). For the official marine text forecast (Coastal Waters Forecast narrative with small-craft advisories), use nws_get_marine_forecast.`,
      inputSchema: {
        latitude: LatitudeSchema,
        longitude: LongitudeSchema,
        hours: z
          .number()
          .int()
          .min(1)
          .max(156)
          .default(24)
          .describe(
            "Forecast hours to return, starting at the current hour (max 156 ≈ 7 days; the grid may end sooner).",
          ),
        units: UnitsSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const forecast = await getWindForecast(
          params.latitude,
          params.longitude,
          params.hours,
        );
        const metric = params.units === "metric";
        const speedLabel = metric ? "m/s" : "knots";
        const waveLabel = metric ? "meters" : "feet";
        const convertSpeed = (knots: number | null) =>
          knots === null ? null : metric ? round1(knotsToMs(knots)) : knots;
        const convertWave = (meters: number | null) =>
          meters === null ? null : metric ? meters : round1(metersToFeet(meters));

        const data = forecast.samples.map((s) => ({
          time_utc: s.time,
          time_local: formatLocal(s.time, forecast.point.timeZone),
          speed: convertSpeed(s.speed_knots),
          gust: convertSpeed(s.gust_knots),
          direction_deg: s.direction_deg,
          compass: s.compass,
          wave_height: convertWave(s.wave_height_m),
        }));
        const hasWaves = data.some((d) => d.wave_height !== null);
        const structured = {
          latitude: params.latitude,
          longitude: params.longitude,
          place: forecast.point.place,
          grid: {
            office: forecast.point.gridId,
            grid_x: forecast.point.gridX,
            grid_y: forecast.point.gridY,
            point_type: forecast.point.pointType,
          },
          time_zone: forecast.point.timeZone,
          units: params.units,
          speed_units_label: speedLabel,
          wave_units_label: waveLabel,
          forecast_updated: forecast.updated,
          count: data.length,
          data,
        };

        const headers = [
          `Time (${forecast.point.timeZone})`,
          `Speed (${speedLabel})`,
          `Gust (${speedLabel})`,
          "Direction (°T)",
          "Compass",
          ...(hasWaves ? [`Waves (${waveLabel})`] : []),
        ];
        const rows = data.map((d) => [
          d.time_local,
          d.speed,
          d.gust,
          d.direction_deg,
          d.compass,
          ...(hasWaves ? [d.wave_height] : []),
        ]);
        const markdown = seriesMarkdown(
          {
            title: "Wind Forecast (NWS)",
            station: `${params.latitude.toFixed(4)},${params.longitude.toFixed(4)}`,
            stationName: forecast.point.place,
            unitsLabel: speedLabel,
            timeZone: forecast.point.timeZone,
            extra: [
              `NWS grid ${forecast.point.gridId} ${forecast.point.gridX},${forecast.point.gridY}${forecast.updated ? ` · updated ${forecast.updated}` : ""}. Direction = where the wind blows FROM.`,
            ],
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

  server.registerTool(
    "nws_get_marine_forecast",
    {
      title: "Get Marine Text Forecast (NWS)",
      description: `Get the official NWS Coastal Waters Forecast (CWF) narrative for the marine zone covering a latitude/longitude — day-part wind/seas text ("SE winds 10 to 15 kt... Bay waters choppy"), including Small Craft Advisories.

The point must lie in (or very near) US coastal waters; CWF zones extend roughly 20-60 NM offshore. Returns the zone's segment from the latest bulletin plus the office-wide synopsis.

For numeric hourly wind values use nws_get_wind_forecast; for observed wind at a NOAA station use noaa_get_meteorological_data (product "wind").`,
      inputSchema: {
        latitude: LatitudeSchema,
        longitude: LongitudeSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const forecast = await getMarineTextForecast(
          params.latitude,
          params.longitude,
        );
        const structured = {
          latitude: params.latitude,
          longitude: params.longitude,
          zone_id: forecast.zone.id,
          zone_name: forecast.zone.name,
          issuing_office: forecast.zone.cwa,
          product_id: forecast.productId,
          issuance_time: forecast.issuanceTime,
          synopsis: forecast.synopsis ?? null,
          forecast: forecast.segment ?? null,
        };
        const lines = [
          `# Coastal Waters Forecast — ${forecast.zone.name}`,
          "",
          `**Zone**: ${forecast.zone.id} · **Office**: ${forecast.zone.cwa}${forecast.issuanceTime ? ` · **Issued**: ${forecast.issuanceTime}` : ""}`,
          "",
        ];
        if (forecast.synopsis) {
          lines.push("```", forecast.synopsis, "```", "");
        }
        if (forecast.segment) {
          lines.push("```", forecast.segment, "```");
        } else {
          lines.push(
            `_The latest ${forecast.zone.cwa} bulletin contains no segment for ${forecast.zone.id} — the zone may be covered under a combined header this parser missed, or the bulletin may be mid-update. Retry, or request response_format "json"._`,
          );
        }
        return respond(params.response_format, structured, lines.join("\n"));
      } catch (error) {
        return respondError(error);
      }
    },
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
