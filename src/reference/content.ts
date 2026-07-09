/**
 * Curated NOAA CO-OPS reference content, compiled from the official API
 * documentation (api.tidesandcurrents.noaa.gov). Served both by the
 * noaa_get_reference_guide tool and as noaa://reference/{topic} resources.
 */

export const REFERENCE_TOPICS = [
  "products",
  "datums",
  "units",
  "time_zones",
  "intervals",
  "station_types",
  "data_limits",
  "quality_flags",
  "date_formats",
  "marine_forecast",
  "fishing",
] as const;

export type ReferenceTopic = (typeof REFERENCE_TOPICS)[number];

export const REFERENCE_CONTENT: Record<ReferenceTopic, string> = {
  products: `# NOAA CO-OPS Data Products

## Water level / tide products (all require a datum)
| Product | Description | Tool |
|---|---|---|
| water_level | 6-minute preliminary or verified observations | noaa_get_water_levels (interval "6") |
| one_minute_water_level | 1-minute preliminary observations | noaa_get_water_levels (interval "1") |
| hourly_height | Verified hourly heights | noaa_get_water_levels (interval "hourly") |
| high_low | Verified daily highs/lows (HH/H/L/LL) | noaa_get_water_level_summaries |
| daily_mean | Verified daily means — GREAT LAKES ONLY, requires lst time zone | noaa_get_water_level_summaries |
| daily_max_min | Daily maxima/minima with completeness % | noaa_get_water_level_summaries |
| monthly_mean | Verified monthly datum means (MHHW, MSL, ... columns) | noaa_get_water_level_summaries |
| predictions | Harmonic tide predictions (heights or high/low events) | noaa_get_tide_predictions |
| air_gap | Bridge clearance (structure to water surface) | noaa_get_meteorological_data |

## Meteorological products (no datum)
air_temperature, water_temperature, wind (speed/gust/direction), air_pressure,
conductivity, visibility, humidity, salinity — via noaa_get_meteorological_data.

## Currents
| Product | Description | Tool |
|---|---|---|
| currents | Observed current speed/direction by depth bin | noaa_get_currents |
| currents_predictions | Predicted currents incl. max flood/ebb and slack | noaa_get_current_predictions |

## Derived products (DPAPI)
Sea level trends, sea level rise projections, extreme water levels,
top-ten/peak water levels, high tide flooding — via noaa_get_sea_level_trends,
noaa_get_extreme_water_levels, noaa_get_top_ten_water_levels, noaa_get_high_tide_flooding.

Notes:
- Great Lakes stations have NO tide predictions.
- Subordinate ("S" type) prediction stations only support interval=hilo.`,

  datums: `# Vertical Datums

A datum is the zero reference for water heights. The same water level reads
differently against different datums — always report which datum was used.

| Datum | Meaning | Applies to |
|---|---|---|
| MLLW | Mean Lower Low Water — standard US nautical chart datum | Coastal/tidal stations (default choice) |
| MLW | Mean Low Water | Coastal |
| MSL | Mean Sea Level | Coastal |
| MTL | Mean Tide Level | Coastal |
| MHW | Mean High Water | Coastal |
| MHHW | Mean Higher High Water (flood analyses often use this) | Coastal |
| STND | Station datum (arbitrary fixed zero, always available) | All stations |
| NAVD | North American Vertical Datum 1988 | Only stations where computed |
| CRD | Columbia River Datum | Columbia River stations only |
| IGLD | International Great Lakes Datum 1985 | Great Lakes ONLY |
| LWD | Low Water Datum (Great Lakes chart datum) | Great Lakes ONLY |

- Datum values come from the current National Tidal Datum Epoch (1983–2001).
- Requesting a datum a station does not support returns an error; check
  supported datums first with noaa_get_station_datums.
- Datum applies to water-level products and tide predictions; it does not
  apply to meteorological or current data.`,

  units: `# Unit Systems

The \`units\` parameter is english (default) or metric. Units differ per
measurement — note the two asymmetric cases (wind vs currents in metric):

| Measurement | english | metric |
|---|---|---|
| Water level / air gap | feet | meters |
| Air & water temperature | °F | °C |
| Wind speed & gust | knots | m/s |
| **Current speed** | **knots** | **cm/s (NOT m/s)** |
| Visibility | nautical miles | kilometers |
| Air pressure | millibars | millibars (unchanged) |
| Salinity | PSU | PSU (unchanged) |
| Conductivity | mS/cm | mS/cm (unchanged) |`,

  time_zones: `# Time Zones

| Value | Meaning |
|---|---|
| gmt | Greenwich Mean Time (UTC) |
| lst | Station's Local Standard Time — never shifts for DST |
| lst_ldt | Station's local time honoring daylight saving |

- daily_mean data REQUIRES lst (the server enforces this automatically).
- Predictions and observations may be requested in any of the three.
- When comparing NOAA timestamps with other data sources, prefer gmt.`,

  intervals: `# Interval Parameter

| Tool / product | Valid intervals |
|---|---|
| Tide predictions | hilo (high/low events), h (hourly), 1, 5, 6, 10, 15, 30, 60 (minutes) |
| Water levels | chosen via interval param: "1" (1-min), "6" (6-min, standard), "hourly" |
| Meteorological | 6 (default) or h (hourly) |
| Observed currents | 6-minute (default) or h |
| Current predictions | max_slack (max flood/ebb + slack events), h, 1, 6, 10, 30, 60 |

- interval=hilo returns the four daily tide events instead of a time series —
  this is what you want for "when is high tide?".
- interval=max_slack is the currents analog: max flood, max ebb, slack times.`,

  station_types: `# Station Types (noaa_search_stations \`type\` values)

| Type | Stations that... |
|---|---|
| waterlevels | actively observe water levels |
| historicwl | historically observed water levels |
| met | have meteorological sensors |
| waterlevelsandmet | have both |
| tidepredictions | have tide predictions (R=reference, S=subordinate) |
| currents | actively observe currents (alphanumeric IDs like cb0102) |
| historiccurrents / surveycurrents | historical/survey current observations |
| currentpredictions | have current predictions |
| harcon | have harmonic constituents |
| datums / supersededdatums | have (superseded) tidal datums |
| benchmarks / supersededbenchmarks | have leveling benchmarks |
| cond / watertemp / airgap / visibility | conductivity / water temp / air gap / visibility sensors |
| physocean | physical oceanography (PORTS) |
| tcoon | Texas Coastal Ocean Observation Network |
| 1minute | report 1-minute water levels |
| highwater / lowwater | high/low water marks |

Station ID formats: 7-digit numeric for water-level/met (e.g. 9414290);
alphanumeric for current stations (e.g. cb0102). Tide-prediction subordinate
(S) stations derive predictions from a reference (R) station via offsets.`,

  data_limits: `# Maximum Request Spans (enforced before calling NOAA)

| Product | Max span per request |
|---|---|
| 1-minute water levels | 4 days |
| 6-minute water levels | 31 days |
| Hourly heights | 1 year |
| High/low observations | 1 year |
| Daily means / daily max-min | 10 years |
| Monthly means | 200 years |
| Tide predictions, interval=hilo | 10 years |
| Tide predictions, other intervals | 1 year |
| Observed currents (any bin, incl. bin=0) | 7 days |
| Current predictions, interval=max_slack | 1 year |
| Current predictions, other intervals | 31 days |
| Meteorological products | 31 days |

For longer periods, make multiple chunked requests. NOAA throttles heavy
query volume (no published numeric limit) — request only what you need.`,

  quality_flags: `# Data Quality Fields & Flags

Water level responses include:
- v — value; s — sigma (standard deviation of the 1-second samples)
- q — quality: p = preliminary (recent, unverified), v = verified
- f — comma-separated flag counts/indicators:
  - Preliminary water levels: O=outliers beyond 3-sigma, F=flat tolerance
    exceeded, R=rate-of-change exceeded, L=max/min limit exceeded
  - Verified water levels: I=inferred, F=flat, R=rate-of-change, T=max/min
  - Hourly heights & high_low: I=inferred, L=limit exceeded
  - Met products: X=max exceeded, N=min exceeded, R=rate-of-change
  - Wind: X=max speed exceeded, R=rate-of-change
  - Air gap: O, F, R, A=max/min limit

high_low \`ty\` values: HH=higher high, H=high, L=low, LL=lower low
(mixed-tide coasts have two unequal highs and lows per day).

Verified data replaces preliminary data after NOAA QC (typically days to
weeks later); recent observations are almost always preliminary.`,

  date_formats: `# Date Parameters

Formats accepted: yyyyMMdd, "yyyyMMdd HH:mm", MM/dd/yyyy, "MM/dd/yyyy HH:mm",
and ISO yyyy-MM-dd or yyyy-MM-ddTHH:mm (normalized automatically).

Exactly ONE of these combinations per request:
1. begin_date + end_date — explicit window
2. begin_date + range — N hours forward from begin
3. end_date + range — N hours back from end
4. date=today | latest | recent — today (midnight→now), latest (single most
   recent reading, ~18 min window), recent (last 72 hours)
5. range alone — N hours back from now

Timestamps in responses are in the requested time_zone (gmt | lst | lst_ldt).`,

  marine_forecast: `# Wind & Marine Forecasts (NWS)

Forecasts come from the NWS Weather API (api.weather.gov) — a different NOAA
service from CO-OPS. CO-OPS observes and predicts tides; NWS forecasts weather.

| Need | Tool |
|---|---|
| Hourly wind forecast (numeric speed/gust/direction) at a lat/lon | nws_get_wind_forecast |
| Official marine narrative (Coastal Waters Forecast, advisories) | nws_get_marine_forecast |
| OBSERVED wind right now at a NOAA station | noaa_get_meteorological_data (product "wind") |

How it works:
- A lat/lon resolves to a forecast-office gridpoint (points → gridpoints);
  values are numeric NDFD series with up to a ~7-day (156 h) horizon.
- Wave height appears on marine/nearshore gridpoints; swell period/direction
  are generally only populated for open-ocean grids, not bays.
- Marine text forecasts are per-ZONE (e.g. GMZ350 "Freeport to Matagorda Ship
  Channel out 20 NM"); one office bulletin covers many zones and the tool
  extracts the matching segment. Winds in the narrative are in KNOTS.
- Coverage: US and territories only. No API key; forecasts update ~hourly.
- Forecast wind direction is where the wind blows FROM, degrees true — same
  convention as CO-OPS wind observations.`,

  fishing: `# Fishing Conditions Toolkit

The data layers the major fishing apps combine, and which tool serves each:

| Layer | Tool | Source |
|---|---|---|
| Solunar bite times (majors/minors, day rating, activity curve) | astro_get_solunar_forecast | computed locally (lunar transit/rise/set) |
| Tide stage & high/low times | noaa_get_tide_predictions | NOAA CO-OPS harmonics |
| Observed waves, water temp, offshore wind | ndbc_get_buoy_observations (find IDs with ndbc_find_nearest_buoys) | NOAA NDBC realtime |
| Barometric pressure trend (pre/post-frontal bite logic) | noaa_get_pressure_trend | derived from CO-OPS air_pressure |
| Wave/swell/SST/current FORECAST anywhere at sea | openmeteo_get_marine_forecast | Open-Meteo wave-model blend |
| Wind forecast | nws_get_wind_forecast | NWS gridpoints (US only) |
| Marine narrative & advisories | nws_get_marine_forecast | NWS Coastal Waters Forecast |
| Moon phase / spring-neap context | astro_get_moon_phase | computed locally |

How anglers combine them:
- SOLUNAR sets the day's candidate windows (majors > minors; windows that
  overlap dawn/dusk are strongest). It is a heuristic — conditions rule.
- PRESSURE TREND modulates expectations: falling = feed window ahead of a
  front; sharp post-frontal rise = tough bite (fish deeper/slower).
- TIDE STAGE picks the spot: moving water (mid-tide, or the hour around a
  high/low turn) beats slack at most inshore spots.
- WIND/WAVES decide safety and water clarity; SST breaks concentrate bait.

ID namespaces differ: CO-OPS stations ("8454000", "cb0102") vs NDBC buoys
("44018", "BUZM3") — never mix them across tools.

Solunar, tide-prediction, buoy-observation, and marine-forecast results
render interactive charts in MCP hosts that support MCP Apps (Claude,
ChatGPT, VS Code, ...); other hosts get the same data as markdown + JSON.`,
};

/** One-line summaries used in resource listings and the guide index. */
export const REFERENCE_SUMMARIES: Record<ReferenceTopic, string> = {
  products: "Every NOAA CO-OPS data product and which tool serves it",
  datums: "Vertical datums (MLLW, MSL, IGLD...) and station applicability",
  units: "What english vs metric means per measurement (incl. cm/s currents)",
  time_zones: "gmt / lst / lst_ldt semantics and restrictions",
  intervals: "Valid interval values per product family",
  station_types: "Station type filters and station ID formats",
  data_limits: "Maximum date-range span per product",
  quality_flags: "Data quality fields (v/s/f/q), flag letters, HH/H/L/LL",
  date_formats: "Accepted date formats and parameter combinations",
  marine_forecast: "NWS wind & marine forecast tools vs CO-OPS observations",
  fishing:
    "Combining solunar, tide, buoy, pressure-trend, and marine-model tools for bite planning",
};
