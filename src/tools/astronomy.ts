/**
 * Sun and moon calculation tools (computed locally with suncalc — no network).
 * Useful companions to tide data for boating, fishing, and photography:
 * spring tides follow new/full moons, and slack/golden-hour timing matters.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoonPhaseService } from "../services/moon-phase-service.js";
import { SunService } from "../services/sun-service.js";
import { MoonPhaseName } from "../types/moon.js";
import { SunEventType } from "../types/sun.js";
import {
  LatitudeSchema,
  LOCAL_COMPUTE_ANNOTATIONS,
  LongitudeSchema,
  ResponseFormatSchema,
} from "../schemas/common.js";
import { markdownTable, respond, respondError } from "../format/respond.js";

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format.")
  .describe("Date in YYYY-MM-DD format. Defaults to today.");

const TimezoneSchema = z
  .string()
  .optional()
  .describe(
    'IANA timezone for output times (e.g. "America/New_York"). Defaults to UTC ISO timestamps.',
  );

export function registerAstronomyTools(server: McpServer): void {
  const moonService = new MoonPhaseService();
  const sunService = new SunService();

  server.registerTool(
    "astro_get_moon_phase",
    {
      title: "Get Moon Phase",
      description: `Get the moon phase for a date (or each day of a date range if end_date is given): phase name (New Moon, Waxing Crescent, ...), illuminated fraction, age in days within the 29.53-day cycle, distance (km), apparent diameter (degrees), and waxing/waning.

Tide context: spring tides (largest range) occur just after new and full moons; neap tides after quarter moons. Computed locally — no NOAA data involved.`,
      inputSchema: {
        date: IsoDateSchema.optional(),
        end_date: IsoDateSchema.optional().describe(
          "Optional range end (YYYY-MM-DD): returns one entry per day from date through end_date.",
        ),
        latitude: LatitudeSchema.optional().describe(
          "Optional latitude for distance/diameter precision.",
        ),
        longitude: LongitudeSchema.optional(),
        response_format: ResponseFormatSchema,
      },
      annotations: LOCAL_COMPUTE_ANNOTATIONS,
    },
    async (params) => {
      try {
        const phases = params.end_date
          ? moonService.getMoonPhasesRange({
              start_date: params.date ?? new Date().toISOString().split("T")[0],
              end_date: params.end_date,
              latitude: params.latitude,
              longitude: params.longitude,
            })
          : [
              moonService.getMoonPhase({
                date: params.date,
                latitude: params.latitude,
                longitude: params.longitude,
              }),
            ];
        const structured = { count: phases.length, phases };
        const markdown = [
          "# Moon Phase",
          "",
          markdownTable(
            [
              "Date",
              "Phase",
              "Illumination",
              "Age (days)",
              "Distance (km)",
              "Waxing?",
            ],
            phases.map((p) => [
              p.date,
              p.phaseName,
              `${(p.illumination * 100).toFixed(1)}%`,
              p.age.toFixed(1),
              Math.round(p.distance).toLocaleString(),
              p.isWaxing ? "yes" : "no",
            ]),
          ),
          "",
          "_Spring tides (largest range) follow new/full moons; neap tides follow quarters._",
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "astro_get_next_moon_phase",
    {
      title: "Get Next Moon Phase Occurrence",
      description: `Find the date(s) of the next occurrence(s) of a principal moon phase (New Moon, First Quarter, Full Moon, Last Quarter) from a starting date.

Use for: "when is the next full moon?", planning around spring tides (which follow new/full moons by 1–2 days).`,
      inputSchema: {
        phase: z
          .enum([
            MoonPhaseName.NEW_MOON,
            MoonPhaseName.FIRST_QUARTER,
            MoonPhaseName.FULL_MOON,
            MoonPhaseName.LAST_QUARTER,
          ])
          .describe("Which principal phase to find."),
        date: IsoDateSchema.optional().describe(
          "Search start date (YYYY-MM-DD). Defaults to today.",
        ),
        count: z
          .number()
          .int()
          .min(1)
          .max(24)
          .default(1)
          .describe("How many occurrences to return."),
        response_format: ResponseFormatSchema,
      },
      annotations: LOCAL_COMPUTE_ANNOTATIONS,
    },
    async (params) => {
      try {
        const occurrences = moonService.getNextMoonPhase({
          phase: params.phase,
          date: params.date,
          count: params.count,
        });
        const structured = { phase: params.phase, occurrences };
        const markdown = [
          `# Next ${params.phase}`,
          "",
          ...occurrences.map((o, i) => `${i + 1}. ${o.date}`),
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "astro_get_sun_times",
    {
      title: "Get Sun Times",
      description: `Get sunrise, sunset, solar noon, dawn/dusk (civil), nautical dawn/dusk, astronomical dawn/dusk, golden hour, and day length for a location and date (or each day of a range if end_date is given).

Times are ISO UTC unless an IANA timezone is provided. At high latitudes some events may be null (e.g. no astronomical night in summer). Computed locally.`,
      inputSchema: {
        latitude: LatitudeSchema,
        longitude: LongitudeSchema,
        date: IsoDateSchema.optional(),
        end_date: IsoDateSchema.optional().describe(
          "Optional range end: one entry per day.",
        ),
        timezone: TimezoneSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: LOCAL_COMPUTE_ANNOTATIONS,
    },
    async (params) => {
      try {
        const times = params.end_date
          ? sunService.getSunTimesRange({
              start_date: params.date ?? new Date().toISOString().split("T")[0],
              end_date: params.end_date,
              latitude: params.latitude,
              longitude: params.longitude,
              timezone: params.timezone,
            })
          : [
              sunService.getSunTimes({
                date: params.date,
                latitude: params.latitude,
                longitude: params.longitude,
                timezone: params.timezone,
              }),
            ];
        const structured = { count: times.length, sun_times: times };
        const markdown = [
          `# Sun Times (${params.latitude}, ${params.longitude})${params.timezone ? ` — ${params.timezone}` : " — UTC"}`,
          "",
          markdownTable(
            [
              "Date",
              "Dawn",
              "Sunrise",
              "Solar noon",
              "Sunset",
              "Dusk",
              "Day length",
            ],
            times.map((t) => [
              t.date,
              t.dawn,
              t.sunrise,
              t.solarNoon,
              t.sunset,
              t.dusk,
              `${Math.floor(t.dayLength / 60)}h ${Math.round(t.dayLength % 60)}m`,
            ]),
          ),
          "",
          "_Golden hour, nautical and astronomical twilight times are in the JSON payload._",
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "astro_get_sun_position",
    {
      title: "Get Sun Position",
      description: `Get the sun's position for a date, time, and location: azimuth (degrees clockwise from north as rendered here), altitude above the horizon (degrees), plus approximate declination and right ascension.

Use for: shadow/lighting analysis, solar exposure. Computed locally with suncalc; declination/RA are approximate.`,
      inputSchema: {
        latitude: LatitudeSchema,
        longitude: LongitudeSchema,
        date: IsoDateSchema.optional(),
        time: z
          .string()
          .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM or HH:MM:SS.")
          .optional()
          .describe(
            "Time of day (HH:MM[:SS], interpreted in the local runtime timezone). Defaults to now.",
          ),
        response_format: ResponseFormatSchema,
      },
      annotations: LOCAL_COMPUTE_ANNOTATIONS,
    },
    async (params) => {
      try {
        const position = sunService.getSunPosition({
          date: params.date,
          time: params.time,
          latitude: params.latitude,
          longitude: params.longitude,
        });
        const structured = { position };
        const markdown = [
          `# Sun Position (${params.latitude}, ${params.longitude}) at ${position.date} ${position.time} UTC`,
          "",
          `- **Azimuth**: ${position.azimuth.toFixed(2)}°`,
          `- **Altitude**: ${position.altitude.toFixed(2)}° ${position.altitude > 0 ? "(above horizon)" : "(below horizon)"}`,
          `- **Declination**: ${position.declination.toFixed(2)}° (approx.)`,
          `- **Right ascension**: ${position.rightAscension.toFixed(2)}h (approx.)`,
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "astro_get_next_sun_event",
    {
      title: "Get Next Sun Event",
      description: `Find the next occurrence(s) of a sun event (sunrise, sunset, dawn, dusk, solarNoon, night, nightEnd, goldenHourStart, goldenHourEnd, nauticalDawn, nauticalDusk, astronomicalDawn, astronomicalDusk) at a location from a starting date.

Use for: "when is sunset today?", planning golden-hour photography or dawn fishing around tide windows.`,
      inputSchema: {
        event: z.nativeEnum(SunEventType).describe("Sun event to find."),
        latitude: LatitudeSchema,
        longitude: LongitudeSchema,
        date: IsoDateSchema.optional().describe(
          "Search start date. Defaults to today.",
        ),
        count: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(1)
          .describe("How many occurrences to return."),
        timezone: TimezoneSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: LOCAL_COMPUTE_ANNOTATIONS,
    },
    async (params) => {
      try {
        const occurrences = sunService.getNextSunEvent({
          event: params.event,
          latitude: params.latitude,
          longitude: params.longitude,
          date: params.date,
          count: params.count,
          timezone: params.timezone,
        });
        const structured = { event: params.event, occurrences };
        const markdown = [
          `# Next ${params.event} at (${params.latitude}, ${params.longitude})`,
          "",
          ...occurrences.map(
            (o, i) =>
              `${i + 1}. ${o.date} at ${o.time}${params.timezone ? ` (${params.timezone})` : ""}`,
          ),
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
