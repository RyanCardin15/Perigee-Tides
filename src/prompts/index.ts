/**
 * MCP prompts: reusable workflow templates that orchestrate the server's
 * tools for the most common NOAA questions.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function userPrompt(text: string) {
  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "tide_report",
    {
      title: "Tide Report",
      description:
        "Produce a tide report (high/low times, current level, context) for a place or station and date.",
      argsSchema: {
        location: z
          .string()
          .describe("Place name, coordinates, or a 7-digit NOAA station ID."),
        date: z
          .string()
          .optional()
          .describe("Date (YYYY-MM-DD). Defaults to today."),
      },
    },
    ({ location, date }) =>
      userPrompt(`Create a tide report for ${location}${date ? ` on ${date}` : " for today"}.

Steps:
1. If "${location}" is not already a NOAA station ID, resolve it to coordinates and use noaa_find_nearest_stations (type "tidepredictions") to pick the closest station; state which station you chose and how far away it is.
2. Get high/low tide times with noaa_get_tide_predictions (interval "hilo"${date ? `, begin_date "${date}", end_date "${date}"` : ', date "today"'}).
3. If the station observes water levels, compare the current observed level (noaa_get_water_levels, date "latest") against the predictions and note any surge (observed minus predicted).
4. Report: station used, each high/low with time and height (state the datum — MLLW — and units), current conditions if available, and the moon phase (astro_get_moon_phase) with a note on spring/neap tides.`),
  );

  server.registerPrompt(
    "boating_conditions",
    {
      title: "Boating & On-the-Water Conditions",
      description:
        "Assemble tides, currents, wind, weather, and daylight for a location and date — a pre-departure briefing.",
      argsSchema: {
        location: z
          .string()
          .describe("Place name or coordinates of the launch/operating area."),
        date: z
          .string()
          .optional()
          .describe("Date (YYYY-MM-DD). Defaults to today."),
      },
    },
    ({ location, date }) =>
      userPrompt(`Prepare an on-the-water conditions briefing for ${location}${date ? ` on ${date}` : " today"}.

Gather (resolve ${location} to coordinates first):
1. Tides: nearest tide-prediction station (noaa_find_nearest_stations type "tidepredictions") → noaa_get_tide_predictions interval "hilo".
2. Currents: nearest current-prediction station (type "currentpredictions") → noaa_get_current_predictions interval "max_slack" — report max flood/ebb speeds (note units!) and slack times, best transit windows.
3. Weather: nearest met station (type "met") → noaa_get_meteorological_data for wind (latest and/or recent trend) and air/water temperature.
4. Daylight: astro_get_sun_times for sunrise/sunset/twilight.

Present as a briefing: daylight window, tide events, slack-water windows, current strength warnings, wind conditions, and water temperature. Flag any station that is far (>25 km) from the requested location.`),
  );

  server.registerPrompt(
    "station_flood_risk",
    {
      title: "Station Flood Risk Profile",
      description:
        "Synthesize high-tide-flooding history, extremes, sea level trend, and projections into a flood risk profile for a station.",
      argsSchema: {
        station: z
          .string()
          .describe('7-digit NOAA water-level station ID (e.g. "8454000").'),
      },
    },
    ({ station }) =>
      userPrompt(`Build a flood risk profile for NOAA station ${station}.

Gather:
1. noaa_get_station_info (expand ["floodlevels"]) — station identity and NOS/NWS flood thresholds.
2. noaa_get_high_tide_flooding report "annual" with range 20 — historical flood-day trend.
3. noaa_get_high_tide_flooding report "annual_outlook" — next-year outlook, and report "projections" — decadal projections.
4. noaa_get_sea_level_trends — long-term relative sea level trend.
5. noaa_get_top_ten_water_levels — worst historical events.
6. noaa_get_extreme_water_levels — exceedance probability levels.

Synthesize: how often the station floods now vs 20 years ago, the driving sea-level trend, projected flooding by 2050, historical worst cases, and the water levels associated with 1%-annual-chance events. State datums and units explicitly.`),
  );

  server.registerPrompt(
    "station_overview",
    {
      title: "Station Capabilities Overview",
      description:
        "Summarize everything a NOAA station offers: sensors, datums, products, data availability.",
      argsSchema: {
        station: z
          .string()
          .describe(
            "NOAA station ID (7-digit or alphanumeric current station).",
          ),
      },
    },
    ({ station }) =>
      userPrompt(`Summarize NOAA station ${station}: what it is, where it is, and what data it offers.

Use noaa_get_station_info (expand ["details", "sensors", "products"]), noaa_get_station_datums, and if it is a prediction station check whether it is reference (R) or subordinate (S) via noaa_search_stations / noaa_get_prediction_offsets.

Report: location/state/established date, tide type, installed sensors, supported datums (with MLLW–MSL offset), available data products and the right tool for each, and any caveats (Great Lakes, subordinate hilo-only predictions, historic-only status).`),
  );
}
