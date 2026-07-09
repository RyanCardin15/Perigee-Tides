# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run build` - Compile TypeScript to `dist/`, typecheck the chart UI (`tsconfig.ui.json`), and bundle the MCP Apps template to `dist/ui/perigee-charts.html` (`scripts/build-ui.mjs`, esbuild)
- `npm test` - Run vitest unit tests (validation, formatting, cache, astronomy)
- `npm run test:live` - End-to-end smoke test: spins up the built server over stdio and exercises every tool against the live NOAA API (`scripts/smoke-live.mjs`)
- `npm run inspector` - MCP Inspector against `dist/index.js`
- `npm run dev` - Run from source with tsx
- `npm run format` - Prettier

Always `npm run build` before `npm run test:live` — the smoke test runs `dist/index.js`.

## Architecture

MCP server built on the official `@modelcontextprotocol/sdk` (`McpServer` + `registerTool`/`registerResource`/`registerPrompt`). Entry point `src/index.ts` runs stdio by default; `--http [--port N]` starts a stateless streamable-HTTP endpoint at `/mcp`.

**CRITICAL: never write to stdout.** In stdio mode stdout is the JSON-RPC channel; all logging must use `console.error`.

Layers (dependencies point downward):

- `src/tools/*` — 30 tool registrations grouped by domain (water, currents, met, stations, station-metadata, derived, astronomy, solunar, buoys, marine-forecast, marine-conditions, reference). Each tool: Zod input schema with nuance-carrying `.describe()` texts, read-only annotations, markdown+json `response_format`, `structuredContent` attached, errors returned via `respondError` (never thrown to the protocol layer).
- `src/services/*` — one module per API surface (`data-api.ts`, `metadata-api.ts`, `dpapi.ts`, `nws-api.ts`, `ndbc.ts`, `open-meteo.ts`) plus local `moon-phase-service.ts` / `sun-service.ts` / `solunar-service.ts` (suncalc).
- `src/ui/app-resource.ts` + `ui/src/*` — MCP Apps (SEP-1865) interactive charts. One self-contained template (`ui://perigee/charts.html`, mimeType `text/html;profile=mcp-app`) dispatches on `structuredContent.viz.kind` (`tide_curve`, `solunar`, `buoy_obs`, `marine_forecast`). Tools opt in via `registerAppTool` + `_meta.ui.resourceUri`. The template declares no CSP, so it runs in the zero-network sandbox — all chart code is hand-rolled SVG inlined by esbuild; data arrives only via `ui/notifications/tool-result`. Hosts without Apps support ignore `_meta.ui` and get markdown/JSON — keep that fallback complete.
- `src/client/http.ts` — shared axios layer: 30s timeout, 2 retries with backoff on network/5xx/429, and error mapping that appends actionable hints. The three NOAA APIs fail differently: the Data API and DPAPI return HTTP 200 or 4xx with `{"error":{"message"}}` bodies; the Metadata API returns bare 404s with no body.
- `src/client/cache.ts` — in-memory TTL cache (station directory 6h, station resources 1h). Nearest-station search is client-side Haversine over the cached directory because MDAPI ignores lat/lon/radius on its list endpoint (verified live).
- `src/validation/dates.ts` — normalizes ISO dates to NOAA formats, enforces the five legal date-param combinations, and pre-validates per-product maximum request spans (see `MAX_SPAN_DAYS`).
- `src/format/*` — unit labels per measurement (`units.ts`), flag legends, markdown table/series rendering, `CHARACTER_LIMIT` truncation.
- `src/reference/content.ts` — curated reference topics served by both the `noaa_get_reference_guide` tool and `noaa://reference/{topic}` resources.

## NOAA Domain Rules Encoded in This Codebase

Do not "simplify" these away; they mirror NOAA API behavior verified against the live API:

- Units: metric current speed is **cm/s** (wind is m/s); pressure always millibars; salinity always PSU.
- Datums: required for water-level products; IGLD/LWD are Great Lakes-only; Great Lakes stations have no tide predictions.
- `daily_mean` is Great Lakes-only and requires `time_zone=lst` (the service forces it).
- Max request spans per product/interval are enforced client-side (`MAX_SPAN_DAYS` in validation/dates.ts).
- Station IDs: 7-digit numeric (water level/met) vs alphanumeric (currents, e.g. `cb0102`).
- Subordinate (type S) prediction stations support only `interval=hilo`; offsets come from `tidepredoffsets`.
- `bin=0` on currents returns all bins but is capped at 7 days.
- MDAPI response array keys differ from NOAA's docs (`datums`, `HarmonicConstituents`, `sensors`, `bins`, `notices`, `products`) — `extractList()` parses defensively.
- DPAPI endpoint paths were verified live (e.g. `/webapi/product/sealvltrends.json`, `/webapi/product.json?name=toptenwaterlevels`, `/webapi/htf/htf_annual.json`). HTF `range` only works together with `year`; the service translates a bare `range` into "last N years".
- The Data API `application` parameter is set on every call for NOAA traffic attribution.
- NDBC has no JSON API: `/activestations.xml` (regex-parsed, flat self-closing tags) and `/data/realtime2/{ID}.txt` (two `#` header lines, columns resolved by NAME not position, `MM` = missing, rows NEWEST first, fixed metric units — conversion happens at the tool layer). NDBC IDs are a separate namespace from CO-OPS station IDs.
- Open-Meteo Marine is MODEL output (not observations), free non-commercial with attribution; `cell_selection=sea` snaps coastal points to ocean cells; error bodies are `{"error":true,"reason":...}`; native units m/°C/km-h (currents display as knots english / cm/s metric per repo convention).
- Solunar is computed locally: majors = lunar transits found by scanning `SunCalc.getMoonPosition` altitude extrema at 1-min steps (suncalc has no transit function; a calendar day can lack one), minors = moonrise/set. Day boundaries use the IANA zone when given, else a longitude-derived fixed offset.

## Conventions

- Tool names: `noaa_*` for CO-OPS-backed tools, `nws_*` for NWS Weather API forecasts, `astro_*` for local astronomy (incl. solunar), `ndbc_*` for NDBC buoys, `openmeteo_*` for Open-Meteo marine models.
- New tools follow the existing pattern: schema in the register call, try/catch returning `respond()`/`respondError()`, units labeled in output, README + reference content updated.
- Transport stays stdio-first for MCP client integration; the HTTP mode is stateless (fresh server+transport per request).
