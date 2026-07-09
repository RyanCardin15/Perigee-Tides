/**
 * Planner tools: derived, decision-ready products computed locally from
 * tide predictions + astronomy (the engine behind activity scores, king
 * tide outlooks, and calendar feeds in the Perigee roadmap — FEATURES.md).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTidePredictions } from "../services/data-api.js";
import { getStationInfo, extractList } from "../services/metadata-api.js";
import {
  ACTIVITIES,
  assertValidTimezone,
  computeActivityPlan,
  detectKingTides,
  parseHiloEvents,
  renderTideCalendarIcs,
} from "../services/planner.js";
import {
  DatumSchema,
  READ_ONLY_ANNOTATIONS,
  ResponseFormatSchema,
  StationIdSchema,
  UnitsSchema,
} from "../schemas/common.js";
import { markdownTable, respond, respondError } from "../format/respond.js";
import { unitLabel } from "../format/units.js";

const BeginDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format.")
  .describe("First day of the span (YYYY-MM-DD). Defaults to today (UTC).");

const TimezoneSchema = z
  .string()
  .optional()
  .describe(
    'IANA timezone for day grouping and displayed times (e.g. "America/New_York"). Strongly recommended — defaults to UTC, which can shift events to the wrong calendar day for US stations.',
  );

interface StationLocation {
  latitude: number;
  longitude: number;
  name?: string;
}

/** Resolve a station's coordinates (and name) from the cached MDAPI record. */
async function stationLocation(stationId: string): Promise<StationLocation> {
  const payload = await getStationInfo(stationId, undefined, "english");
  const record = extractList<Record<string, unknown>>(payload, "stations")[0];
  const latitude = Number(record?.lat);
  const longitude = Number(record?.lng);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new Error(
      `Could not resolve coordinates for station ${stationId} — sun times need the station location.`,
    );
  }
  return {
    latitude,
    longitude,
    name: typeof record?.name === "string" ? record.name : undefined,
  };
}

function spanDates(
  begin: string | undefined,
  days: number,
): {
  begin_date: string;
  end_date: string;
} {
  const start = begin ?? new Date().toISOString().slice(0, 10);
  const startDate = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error(`Invalid begin_date "${begin}". Use YYYY-MM-DD.`);
  }
  const endDate = new Date(startDate.getTime() + (days - 1) * 86_400_000);
  return {
    begin_date: start,
    end_date: endDate.toISOString().slice(0, 10),
  };
}

export function registerPlannerTools(server: McpServer): void {
  server.registerTool(
    "noaa_get_activity_windows",
    {
      title: "Get Activity Windows & Scores",
      description: `Score each day for a coastal activity by combining high/low tide predictions with sunrise/sunset and moon phase, computed locally per station. Returns per day: a 0–100 score with plain-English reasons, a suggested best time window, tide events, sun times, and moon phase.

Activities: fishing (moving water at dawn/dusk + spring-tide feeding), boating (daylight highs for departure depth), surf_paddle (daylight tide movement), beachcombing (daylight/negative lows for tidepooling and clamming), photography (tide events landing in golden hour, moonlight), general (daylight low/high "golden windows").

Scores rank days RELATIVE to tide/sun/moon geometry only — they do not include weather. Pair with nws_get_wind_forecast before committing to a plan. Requires a harmonic prediction station (7-digit ID). Not for navigation.`,
      inputSchema: {
        station: StationIdSchema,
        activity: z
          .enum(ACTIVITIES)
          .default("general")
          .describe("Activity to score each day for."),
        begin_date: BeginDateSchema.optional(),
        days: z
          .number()
          .int()
          .min(1)
          .max(31)
          .default(7)
          .describe("Number of days to plan (1–31)."),
        datum: DatumSchema.default("MLLW"),
        units: UnitsSchema,
        timezone: TimezoneSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        if (params.timezone) assertValidTimezone(params.timezone);
        const { begin_date, end_date } = spanDates(
          params.begin_date,
          params.days,
        );
        const [location, response] = await Promise.all([
          stationLocation(params.station),
          getTidePredictions({
            station: params.station,
            datum: params.datum,
            units: params.units,
            time_zone: "gmt",
            interval: "hilo",
            begin_date,
            end_date,
          }),
        ]);
        const events = parseHiloEvents(response);
        const plans = computeActivityPlan({
          activity: params.activity,
          events,
          latitude: location.latitude,
          longitude: location.longitude,
          timezone: params.timezone,
        });
        const heightLabel = `${unitLabel("water_level", params.units)} above ${params.datum}`;
        const structured = {
          station: params.station,
          station_name: location.name,
          activity: params.activity,
          begin_date,
          end_date,
          timezone: params.timezone ?? "UTC",
          units_label: heightLabel,
          count: plans.length,
          days: plans,
        };
        const markdown = [
          `# ${params.activity.replace("_", "/")} outlook — ${location.name ?? `Station ${params.station}`}`,
          "",
          `Times in ${params.timezone ?? "UTC"} · heights in ${heightLabel} · scores reflect tide/sun/moon geometry only (check wind separately).`,
          "",
          markdownTable(
            [
              "Date",
              "Score",
              "Rating",
              "Best window",
              "Sunrise",
              "Sunset",
              "Moon",
            ],
            plans.map((p) => [
              p.date,
              p.score,
              p.rating,
              p.best_window
                ? `${p.best_window.start}–${p.best_window.end} (${p.best_window.label})`
                : null,
              p.sunrise,
              p.sunset,
              p.moon_phase,
            ]),
          ),
          "",
          "## Why each day scored the way it did",
          ...plans.map(
            (p) =>
              `- **${p.date}** (${p.score}): ${p.reasons.join(" ") || "Nothing notable."}`,
          ),
          "",
          "_Not for navigation._",
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_king_tides",
    {
      title: "Get King Tide Outlook",
      description: `Find upcoming king tides at a station: the days whose predicted high tides sit in the top percentile of the requested span (default: top 2% over the next year), annotated with the lunar mechanics behind them — moon phase, moon distance, whether the moon is near perigee, and whether it is within ~2 days of new/full (syzygy). Perigee + syzygy = perigean spring tide, the classic king tide.

Use for: "when are the king tides in {place} {year}?", coastal flood awareness, planning king-tide photography. Heights are PREDICTED astronomical tides — storms and surge ride on top of them; pair with noaa_get_high_tide_flooding for flood-day likelihoods. Not for navigation.`,
      inputSchema: {
        station: StationIdSchema,
        begin_date: BeginDateSchema.optional(),
        days: z
          .number()
          .int()
          .min(28)
          .max(731)
          .default(365)
          .describe(
            "Span to scan in days (28–731). Percentiles need a meaningful sample; a full year captures both king-tide seasons.",
          ),
        threshold_percentile: z
          .number()
          .min(50)
          .max(99.9)
          .default(98)
          .describe(
            "Percentile of predicted highs that qualifies as a king tide (98 = top 2%).",
          ),
        datum: DatumSchema.default("MLLW"),
        units: UnitsSchema,
        timezone: TimezoneSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        if (params.timezone) assertValidTimezone(params.timezone);
        const { begin_date, end_date } = spanDates(
          params.begin_date,
          params.days,
        );
        const response = await getTidePredictions({
          station: params.station,
          datum: params.datum,
          units: params.units,
          time_zone: "gmt",
          interval: "hilo",
          begin_date,
          end_date,
        });
        const events = parseHiloEvents(response);
        const report = detectKingTides(
          events,
          params.threshold_percentile,
          params.timezone,
        );
        const heightLabel = `${unitLabel("water_level", params.units)} above ${params.datum}`;
        const structured = {
          station: params.station,
          begin_date,
          end_date,
          timezone: params.timezone ?? "UTC",
          units_label: heightLabel,
          ...report,
        };
        const markdown = [
          `# King tide outlook — Station ${params.station}`,
          "",
          `Scanned ${report.high_count} predicted highs from ${begin_date} to ${end_date}. Threshold (P${params.threshold_percentile}): **${report.threshold.toFixed(2)} ${heightLabel}**. King tide days: **${report.days.length}**.`,
          "",
          markdownTable(
            ["Date", "Highest", "Times", "Moon", "Perigean?", "New/Full ±2d?"],
            report.days.map((d) => [
              d.date,
              d.highest.toFixed(2),
              d.events.map((e) => e.time).join(", "),
              d.moon_phase,
              d.perigean ? "yes" : "no",
              d.near_syzygy ? "yes" : "no",
            ]),
          ),
          "",
          `_Times in ${params.timezone ?? "UTC"}. Predicted astronomical tides only — storm surge rides on top. Not for navigation._`,
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_tide_calendar",
    {
      title: "Get Tide Calendar (iCalendar/ICS)",
      description: `Render a station's predicted high/low tides as an iCalendar (ICS) feed that imports into Google Calendar, Apple Calendar, or Outlook. Each high/low becomes an event ("▲ High tide 5.2 feet"); optionally include sunrise/sunset events and new/full moon all-day markers (which flag spring-tide periods).

Event times are UTC-stamped (calendar apps display them in the viewer's local timezone automatically). Use response_format "json" to get the raw ICS string in the "ics" field for saving to a .ics file or serving as a webcal feed. Not for navigation.`,
      inputSchema: {
        station: StationIdSchema,
        begin_date: BeginDateSchema.optional(),
        days: z
          .number()
          .int()
          .min(1)
          .max(366)
          .default(30)
          .describe("Number of days of tides to include (1–366)."),
        datum: DatumSchema.default("MLLW"),
        units: UnitsSchema,
        include_sun_events: z
          .boolean()
          .default(false)
          .describe("Also add sunrise and sunset events for each day."),
        include_moon_phases: z
          .boolean()
          .default(true)
          .describe(
            "Add all-day markers on new/full moon days (spring-tide periods).",
          ),
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const { begin_date, end_date } = spanDates(
          params.begin_date,
          params.days,
        );
        const [location, response] = await Promise.all([
          stationLocation(params.station),
          getTidePredictions({
            station: params.station,
            datum: params.datum,
            units: params.units,
            time_zone: "gmt",
            interval: "hilo",
            begin_date,
            end_date,
          }),
        ]);
        const events = parseHiloEvents(response);
        if (events.length === 0) {
          throw new Error(
            `No tide predictions returned for station ${params.station} in ${begin_date}..${end_date}. Great Lakes stations have no tide predictions; subordinate stations must support hilo.`,
          );
        }
        const heightLabel = unitLabel("water_level", params.units);
        const ics = renderTideCalendarIcs({
          stationId: params.station,
          stationName: location.name,
          events,
          unitsLabel: heightLabel,
          datum: params.datum,
          includeSun: params.include_sun_events
            ? { latitude: location.latitude, longitude: location.longitude }
            : undefined,
          includeMoonPhases: params.include_moon_phases,
        });
        const structured = {
          station: params.station,
          station_name: location.name,
          begin_date,
          end_date,
          datum: params.datum,
          units_label: heightLabel,
          tide_event_count: events.length,
          ics,
        };
        const markdown = [
          `# Tide calendar — ${location.name ?? `Station ${params.station}`}`,
          "",
          `${events.length} tide events from ${begin_date} to ${end_date} (${heightLabel} above ${params.datum}). Save the block below as a \`.ics\` file and import it into any calendar app.`,
          "",
          "```ics",
          ics.trimEnd(),
          "```",
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
