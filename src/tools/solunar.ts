/**
 * Solunar bite-time forecast tool (computed locally — no network).
 * The angler-facing composite the big fishing apps lead with: major/minor
 * feeding windows, a 0-100 day rating with its factors spelled out, and a
 * half-hourly activity curve suitable for charting.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { CHARTS_UI_URI } from "../ui/app-resource.js";
import { SolunarService, SolunarDay } from "../services/solunar-service.js";
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

const SPARK_BLOCKS = "▁▂▃▄▅▆▇█";

/** Compact unicode sparkline of the 48-sample activity curve. */
export function activitySparkline(day: SolunarDay): string {
  return day.hourly_activity
    .map((s) => {
      const idx = Math.min(
        SPARK_BLOCKS.length - 1,
        Math.floor((s.activity / 100) * SPARK_BLOCKS.length),
      );
      return SPARK_BLOCKS[idx];
    })
    .join("");
}

function formatLocalHm(iso: string | null, timezone?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (timezone) {
    try {
      return date.toLocaleTimeString("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      // fall through to UTC
    }
  }
  return `${iso.slice(11, 16)}Z`;
}

export function registerSolunarTools(server: McpServer): void {
  const service = new SolunarService();

  registerAppTool(
    server,
    "astro_get_solunar_forecast",
    {
      title: "Get Solunar Fishing Forecast",
      description: `Solunar bite-time forecast for a location and date (or range up to 14 days): MAJOR feeding periods (~2h, centered on the moon crossing overhead/underfoot) and MINOR periods (~1.5h, centered on moonrise/moonset), plus a 0-100 day rating built from moon phase (new/full is best and also drives spring tides), moon-perigee distance, dawn/dusk overlap, and period count — each factor reported separately.

Also returns a 48-point half-hourly activity curve (0-100) for charting. Computed locally from lunar/solar geometry (classic Knight solunar theory — a planning heuristic, not physics). Combine with real conditions: tides (noaa_get_tide_predictions), wind (nws_get_wind_forecast), and pressure trend.`,
      inputSchema: {
        latitude: LatitudeSchema,
        longitude: LongitudeSchema,
        date: IsoDateSchema.optional(),
        end_date: IsoDateSchema.optional().describe(
          "Optional range end (max 14 days from date): one forecast per day.",
        ),
        timezone: z
          .string()
          .optional()
          .describe(
            'IANA timezone (e.g. "America/New_York") for day boundaries and local times. Defaults to a fixed offset estimated from longitude.',
          ),
        response_format: ResponseFormatSchema,
      },
      annotations: LOCAL_COMPUTE_ANNOTATIONS,
      _meta: { ui: { resourceUri: CHARTS_UI_URI } },
    },
    async (params) => {
      try {
        const days = params.end_date
          ? service.getSolunarRange({
              start_date: params.date ?? new Date().toISOString().split("T")[0],
              end_date: params.end_date,
              latitude: params.latitude,
              longitude: params.longitude,
              timezone: params.timezone,
            })
          : [
              service.getSolunarDay({
                date: params.date,
                latitude: params.latitude,
                longitude: params.longitude,
                timezone: params.timezone,
              }),
            ];
        const structured = {
          viz: { kind: "solunar", timezone: params.timezone },
          count: days.length,
          days,
        };

        const lines: string[] = [
          `# Solunar Fishing Forecast (${params.latitude}, ${params.longitude})`,
          "",
          `**Time basis**: ${days[0].time_basis} · times shown ${params.timezone ? `in ${params.timezone}` : "as UTC (HH:MMZ)"}`,
        ];
        for (const day of days) {
          lines.push(
            "",
            `## ${day.date} — ${day.rating}/100 (${day.rating_label})`,
            "",
            `**Moon**: ${day.moon_phase}, ${(day.moon_illumination * 100).toFixed(0)}% lit, ${day.moon_distance_km.toLocaleString()} km · **Sun**: rise ${formatLocalHm(day.sunrise, params.timezone)}, set ${formatLocalHm(day.sunset, params.timezone)}`,
            "",
            markdownTable(
              ["Period", "Event", "Start", "Peak", "End", "Dawn/dusk overlap"],
              day.periods.map((p) => [
                p.kind === "major" ? "MAJOR" : "minor",
                p.event.replace(/_/g, " "),
                formatLocalHm(p.start, params.timezone),
                formatLocalHm(p.peak, params.timezone),
                formatLocalHm(p.end, params.timezone),
                p.overlaps_twilight ? "yes ✳" : "no",
              ]),
            ),
            "",
            `Activity (00→24h): \`${activitySparkline(day)}\``,
            "",
            day.rating_factors
              .map(
                (f) =>
                  `- ${f.factor}: ${f.points}/${f.max_points} — ${f.detail}`,
              )
              .join("\n"),
          );
        }
        lines.push(
          "",
          "_Solunar theory is a planning heuristic — weigh it against tide stage, wind, and barometric trend._",
        );
        return respond(params.response_format, structured, lines.join("\n"));
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
