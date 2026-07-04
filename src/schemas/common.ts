/**
 * Shared Zod field schemas used across tool input schemas.
 * Field descriptions matter: MCP clients show them to the model, so they
 * carry the load-bearing NOAA nuances (units, datums, limits).
 */

import { z } from "zod";

/** 7-digit numeric (water level/met) or alphanumeric current-station IDs like "cb0102". */
export const StationIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_]{4,10}$/,
    'Station IDs are 7-digit numbers for water-level/met stations (e.g. "9414290") or alphanumeric codes for current stations (e.g. "cb0102").',
  )
  .describe(
    'Station ID. Water-level/met stations use 7-digit numeric IDs (e.g. "9414290" San Francisco); current stations use alphanumeric IDs (e.g. "cb0102"). Find stations with noaa_search_stations or noaa_find_nearest_stations.',
  );

export const DateAliasSchema = z
  .enum(["today", "latest", "recent"])
  .describe(
    'Shortcut window: "today" = midnight to now, "latest" = single most recent reading, "recent" = last 72 hours. Mutually exclusive with begin_date/end_date/range.',
  );

export const BeginDateSchema = z
  .string()
  .describe(
    'Start date/time. Formats: yyyyMMdd, "yyyyMMdd HH:mm", MM/dd/yyyy, or ISO yyyy-MM-dd[THH:mm].',
  );

export const EndDateSchema = z
  .string()
  .describe("End date/time. Same formats as begin_date.");

export const RangeSchema = z
  .number()
  .int()
  .positive()
  .describe(
    "Number of hours. With begin_date: hours forward. With end_date: hours back. Alone: hours back from now.",
  );

export const DatumSchema = z
  .enum([
    "MHHW",
    "MHW",
    "MTL",
    "MSL",
    "MLW",
    "MLLW",
    "NAVD",
    "STND",
    "IGLD",
    "LWD",
    "CRD",
  ])
  .describe(
    "Vertical reference datum for heights. MLLW is the standard chart datum for coastal stations. IGLD and LWD apply to Great Lakes stations ONLY; NAVD/CRD exist only at stations where computed. Check a station's supported datums with noaa_get_station_datums.",
  );

export const UnitsSchema = z
  .enum(["english", "metric"])
  .default("english")
  .describe(
    "Unit system. english: feet, °F, knots (wind AND currents), nautical miles. metric: meters, °C, m/s for wind but cm/s for currents, kilometers. Air pressure is millibars and salinity is PSU in BOTH systems.",
  );

export const TimeZoneSchema = z
  .enum(["gmt", "lst", "lst_ldt"])
  .default("lst_ldt")
  .describe(
    "Time zone for timestamps: gmt = UTC, lst = station local standard time (no DST), lst_ldt = station local time with DST. Note: daily_mean data requires lst.",
  );

export const ResponseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe(
    'Output format: "markdown" for a readable summary table, "json" for the complete structured payload.',
  );

/** Base date-selection fields shared by all Data API tools. */
export const dateFields = {
  date: DateAliasSchema.optional(),
  begin_date: BeginDateSchema.optional(),
  end_date: EndDateSchema.optional(),
  range: RangeSchema.optional(),
};

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** Astronomy tools compute locally — no external world interaction. */
export const LOCAL_COMPUTE_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const LatitudeSchema = z
  .number()
  .min(-90)
  .max(90)
  .describe("Latitude in decimal degrees (-90 to 90).");

export const LongitudeSchema = z
  .number()
  .min(-180)
  .max(180)
  .describe("Longitude in decimal degrees (-180 to 180).");
