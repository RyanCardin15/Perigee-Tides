# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Development Commands

- `npm run build` - Compile TypeScript to `dist/`
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

- `src/tools/*` — 25 tool registrations grouped by domain (water, currents, met, stations, station-metadata, derived, astronomy, marine-forecast, reference). Each tool: Zod input schema with nuance-carrying `.describe()` texts, read-only annotations, markdown+json `response_format`, `structuredContent` attached, errors returned via `respondError` (never thrown to the protocol layer).
- `src/services/*` — one module per NOAA API surface (`data-api.ts`, `metadata-api.ts`, `dpapi.ts`) plus local `moon-phase-service.ts` / `sun-service.ts` (suncalc).
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

## Conventions

- Tool names: `noaa_*` for CO-OPS-backed tools, `nws_*` for NWS Weather API forecasts, `astro_*` for local astronomy.
- New tools follow the existing pattern: schema in the register call, try/catch returning `respond()`/`respondError()`, units labeled in output, README + reference content updated.
- Transport stays stdio-first for MCP client integration; the HTTP mode is stateless (fresh server+transport per request).
