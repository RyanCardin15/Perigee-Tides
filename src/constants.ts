/**
 * Shared constants for the NOAA Tides and Currents MCP server.
 */

/** NOAA CO-OPS Data Retrieval API (observations, predictions, currents, met). */
export const DATA_API_BASE_URL =
  "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

/** NOAA CO-OPS Metadata API (station metadata, datums, harmonic constituents...). */
export const METADATA_API_BASE_URL =
  "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi";

/** NOAA CO-OPS Derived Product API (sea level trends, high tide flooding...). */
export const DPAPI_BASE_URL =
  "https://api.tidesandcurrents.noaa.gov/dpapi/prod";

/** NWS Weather API (point/gridpoint forecasts, marine zone text products). */
export const NWS_API_BASE_URL = "https://api.weather.gov";

/**
 * NOAA NDBC — National Data Buoy Center. Realtime observations are plain
 * fixed-format text files (no JSON API): /data/realtime2/{ID}.txt, and the
 * active-station directory is /activestations.xml.
 */
export const NDBC_BASE_URL = "https://www.ndbc.noaa.gov";

/**
 * Open-Meteo Marine API — keyless JSON wave/swell/SST/current model forecasts
 * (GFS-Wave, ECMWF WAM, ICON-Wave blends). Free for non-commercial use with
 * attribution; data is model output, not observations.
 */
export const OPEN_METEO_MARINE_BASE_URL =
  "https://marine-api.open-meteo.com/v1/marine";

/**
 * NWS requires a descriptive User-Agent identifying the application and a
 * contact point (their abuse-mitigation mechanism; the API has no keys).
 */
export const NWS_USER_AGENT =
  "noaa-tides-currents-mcp-server (perigeetides.com, ryandcardin@gmail.com)";

/**
 * Sent as the `application` parameter on every Data API call so NOAA can
 * attribute traffic in their logs (not an API key; the API is open).
 */
export const APPLICATION_NAME = "noaa-tides-currents-mcp-server";

export const SERVER_NAME = "noaa-tides-currents-mcp-server";

/** Maximum characters returned by a single tool response before truncation. */
export const CHARACTER_LIMIT = 25_000;

/** HTTP request timeout in milliseconds. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Number of retries for transient failures (network errors, 5xx, 429). */
export const MAX_RETRIES = 2;

/** Cache TTLs (milliseconds). */
export const CACHE_TTL = {
  /** Full station directory listings change rarely. */
  stationList: 6 * 60 * 60 * 1000,
  /** Individual station metadata (datums, sensors, harcon...). */
  stationResource: 60 * 60 * 1000,
  /** Lat/lon → NWS gridpoint resolution (grid assignments drift rarely, but do drift). */
  nwsPoint: 6 * 60 * 60 * 1000,
  /** NWS forecasts and marine text products update roughly hourly. */
  nwsForecast: 30 * 60 * 1000,
  /** NDBC active-station directory (updated daily upstream). */
  ndbcStations: 6 * 60 * 60 * 1000,
  /** NDBC realtime observations post roughly every 10 minutes to hourly. */
  ndbcObservations: 10 * 60 * 1000,
} as const;
