# 🌊 NOAA Tides & Currents MCP Server

<div align="center">

[![npm version](https://img.shields.io/npm/v/@ryancardin/noaa-tides-currents-mcp-server?style=for-the-badge&logo=npm&color=blue)](https://www.npmjs.com/package/@ryancardin/noaa-tides-currents-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Model_Context_Protocol-green?style=for-the-badge)](https://modelcontextprotocol.io/)

**A Model Context Protocol server for NOAA CO-OPS Tides and Currents data**

Built by [Cardin Labs](https://cardinlabs.com) · Hosted at [Perigee](https://perigee-two.vercel.app)

Water levels · tide predictions · currents · marine weather · station metadata ·
tidal datums · harmonic constituents · sea level trends & projections ·
high tide flooding · sun & moon calculations

</div>

---

## Quick Start

```bash
# Run immediately with npx
npx @ryancardin/noaa-tides-currents-mcp-server

# Or the short alias
npx noaa-mcp
```

### Claude Desktop / Claude Code configuration

```json
{
  "mcpServers": {
    "noaa": {
      "command": "npx",
      "args": ["-y", "@ryancardin/noaa-tides-currents-mcp-server"]
    }
  }
}
```

Claude Code one-liner:

```bash
claude mcp add noaa -- npx -y @ryancardin/noaa-tides-currents-mcp-server
```

### HTTP mode (optional)

```bash
npx noaa-mcp --http --port 3000   # stateless streamable HTTP at http://localhost:3000/mcp
```

No API key is required — NOAA's CO-OPS APIs are open.

---

## Tools (28)

### Observations & Predictions (Data API)

| Tool                             | What it does                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `noaa_get_water_levels`          | Observed water levels: 1-minute, 6-minute, or hourly series, preliminary/verified quality flags decoded         |
| `noaa_get_water_level_summaries` | high_low (HH/H/L/LL daily extremes), daily_mean (Great Lakes), daily_max_min, monthly_mean datum tables         |
| `noaa_get_tide_predictions`      | Harmonic tide predictions — `hilo` high/low events (up to 10 years) or interval series                          |
| `noaa_get_currents`              | Observed current speed/direction by depth bin (ADCP), optional beam diagnostics                                 |
| `noaa_get_current_predictions`   | Predicted currents — `max_slack` flood/ebb/slack events or interval series                                      |
| `noaa_get_meteorological_data`   | Wind, air/water temperature, pressure, air gap (bridge clearance), conductivity, visibility, humidity, salinity |

### Station Discovery & Metadata (Metadata API)

| Tool                             | What it does                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `noaa_search_stations`           | Search the station directory by capability type, name substring, state — paginated                           |
| `noaa_find_nearest_stations`     | Nearest stations to any lat/lon (great-circle, cached directory), filterable by type                         |
| `noaa_get_station_info`          | Full station record with expandable sensors, flood levels, benchmarks, bins, deployments...                  |
| `noaa_get_station_datums`        | Tidal datum elevations (MLLW, MSL, MHHW, NAVD88...), HAT/LAT, historic extremes, current or superseded epoch |
| `noaa_get_harmonic_constituents` | The M2/S2/K1/... constituents behind a station's predictions (water level or current ellipse form)           |
| `noaa_get_prediction_offsets`    | Subordinate-station time/height offsets from their reference stations (tide or current)                      |

### Climate & Derived Products (DPAPI)

| Tool                                  | What it does                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `noaa_get_sea_level_trends`           | Long-term relative sea level trend with error bars and observation period                        |
| `noaa_get_sea_level_rise_projections` | 2022 Interagency SLR scenario projections per decade through 2150                                |
| `noaa_get_extreme_water_levels`       | Annual exceedance probability levels (e.g. the "100-year" water level)                           |
| `noaa_get_top_ten_water_levels`       | Highest water levels ever recorded, with causal events (hurricanes, nor'easters)                 |
| `noaa_get_high_tide_flooding`         | HTF flood-day counts (daily/monthly/seasonal/annual), outlooks, decadal projections, likelihoods |

### Planner (derived locally from predictions + astronomy)

| Tool                        | What it does                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `noaa_get_activity_windows` | Scores each day 0–100 for fishing, boating, surf/paddle, beachcombing, photography, or general shore time — tide events × sunrise/sunset × moon phase, with plain-English reasons and a suggested best window |
| `noaa_get_king_tides`       | Finds upcoming king tide days (top-percentile predicted highs) with the lunar mechanics behind them: perigee proximity and new/full moon alignment                                                            |
| `noaa_get_tide_calendar`    | Renders high/low predictions (plus optional sunrise/sunset and new/full moon markers) as an iCalendar (ICS) feed for Google/Apple Calendar or Outlook                                                         |

### Astronomy (computed locally)

| Tool                        | What it does                                                                      |
| --------------------------- | --------------------------------------------------------------------------------- |
| `astro_get_moon_phase`      | Phase, illumination, age, distance for a date or range (spring/neap tide context) |
| `astro_get_next_moon_phase` | Next new/full/quarter moon date(s)                                                |
| `astro_get_sun_times`       | Sunrise/sunset, twilights, golden hour, day length for any location/date          |
| `astro_get_sun_position`    | Azimuth/altitude (+ approximate declination/RA)                                   |
| `astro_get_next_sun_event`  | Next occurrence(s) of any sun event                                               |

### Wind & Marine Forecasts (NWS Weather API)

| Tool                      | What it does                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `nws_get_wind_forecast`   | Hourly numeric wind forecast (speed/gust/direction, wave height where gridded) for any US lat/lon, up to ~7 days |
| `nws_get_marine_forecast` | Official Coastal Waters Forecast narrative for the marine zone covering a lat/lon, incl. Small Craft Advisories  |

### Reference

| Tool                       | What it does                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `noaa_get_reference_guide` | Curated NOAA reference: products, datums, units, time zones, intervals, station types, data limits, quality flags, date formats, marine forecasts |

Every tool supports `response_format: "markdown"` (readable tables with units spelled out — the default) or `"json"` (complete structured payload), and attaches structured content for MCP clients that consume it.

## Resources

- `noaa://guide/getting-started` — workflow recipes and common pitfalls
- `noaa://reference/{topic}` — the ten reference topics above as pinnable resources

## Prompts

- `tide_report` — tide report for a place/station and date
- `boating_conditions` — pre-departure briefing: tides, currents, wind, daylight
- `station_flood_risk` — flood risk profile: HTF history, extremes, trends, projections
- `station_overview` — everything a station offers

---

## The Nuances (handled for you)

These are the things that make NOAA's API tricky — this server encodes them:

- **Datums matter.** Heights are meaningless without a vertical reference. MLLW (chart datum) is the default; stations differ in which datums they support (Great Lakes use IGLD/LWD and have **no tide predictions**). `noaa_get_station_datums` gives the conversion table.
- **Units are asymmetric.** `metric` means m/s for wind but **cm/s for currents**; air pressure is millibars and salinity PSU in _both_ systems. Every response labels its units.
- **Per-product request-span limits** (4 days for 1-minute data, 31 days for 6-minute, 1 year hourly, 10 years for hilo predictions...) are validated client-side with actionable messages before hitting NOAA.
- **Two station ID schemes.** Water-level/met stations are 7-digit numeric (`9414290`); current stations are alphanumeric (`cb0102`).
- **Reference vs subordinate stations.** Subordinate (S) prediction stations only support `hilo` predictions, derived by offsets from a reference (R) station.
- **`daily_mean` requires local standard time** and only exists for Great Lakes stations — enforced automatically.
- **Quality flags decoded.** Preliminary vs verified data, sigma, flag alphabets (which differ between preliminary and verified!), and HH/H/L/LL tide types are explained inline.
- **Predictions are astronomical** — storm surge is not included; compare with observed water levels.
- **Station directory is cached** (6 h) so nearest-station searches don't refetch thousands of records.

---

## Usage Examples

> "When is high tide in Boston tomorrow?"

1. `noaa_find_nearest_stations` (type `tidepredictions`) → `8443970 BOSTON`
2. `noaa_get_tide_predictions` (interval `hilo`) → high/low times & heights above MLLW

> "How strong will the current be in the Cape Cod Canal this afternoon?"

1. `noaa_find_nearest_stations` (type `currentpredictions`)
2. `noaa_get_current_predictions` (interval `max_slack`) → max flood/ebb (knots) and slack times

> "How often does Providence flood now vs 20 years ago, and what's projected for 2050?"

1. `noaa_get_high_tide_flooding` (report `annual`, range 25)
2. `noaa_get_high_tide_flooding` (report `projections`, decade 2050)
3. `noaa_get_sea_level_trends` + `noaa_get_sea_level_rise_projections`

---

## Development

```bash
npm install
npm run build        # tsc → dist/
npm test             # vitest unit tests (validation, formatting, astronomy)
npm run test:live    # end-to-end smoke test against the live NOAA API
npm run inspector    # MCP Inspector against dist/index.js
npm run dev          # tsx src/index.ts
```

### Architecture

```
src/
├── index.ts            # entry point: stdio (default) or --http streamable HTTP
├── constants.ts        # API base URLs, timeouts, cache TTLs, response limits
├── client/             # shared HTTP layer (retry/backoff, error mapping) + TTL cache
├── validation/         # date normalization + per-product span limit enforcement
├── format/             # unit labeling, flag legends, markdown/json response shaping
├── schemas/            # shared Zod field schemas with nuance-carrying descriptions
├── services/           # Data API, Metadata API, DPAPI, moon & sun services
├── tools/              # 28 tool registrations grouped by domain
├── resources/          # noaa:// reference resources
├── prompts/            # workflow prompt templates
└── reference/          # curated NOAA reference content
```

Data sources:

- **Data API** — `api.tidesandcurrents.noaa.gov/api/prod/datagetter`
- **Metadata API** — `api.tidesandcurrents.noaa.gov/mdapi/prod/webapi`
- **Derived Product API** — `api.tidesandcurrents.noaa.gov/dpapi/prod/webapi`
- **Astronomy** — [suncalc](https://github.com/mourner/suncalc), computed locally

## License

MIT © [Cardin LLC](https://cardinlabs.com) (Cardin Labs)

NOAA data is provided by the NOAA Center for Operational Oceanographic Products and Services (CO-OPS). This project is not affiliated with or endorsed by NOAA.
