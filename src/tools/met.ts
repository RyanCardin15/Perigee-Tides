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
}
