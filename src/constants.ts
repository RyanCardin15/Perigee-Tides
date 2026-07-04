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
} as const;
