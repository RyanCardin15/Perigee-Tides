/**
 * Shared HTTP layer for all three NOAA CO-OPS API surfaces.
 *
 * Responsibilities:
 *  - one axios instance with a sane timeout and identifying User-Agent
 *  - retry with backoff on transient failures (network, 5xx, 429)
 *  - mapping upstream errors to actionable, agent-friendly messages
 *    (the Data API returns structured `{error:{message}}` bodies; the
 *    Metadata API returns bare 404s with no body — they are handled
 *    differently on purpose)
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import {
  APPLICATION_NAME,
  DATA_API_BASE_URL,
  DPAPI_BASE_URL,
  MAX_RETRIES,
  METADATA_API_BASE_URL,
  REQUEST_TIMEOUT_MS,
} from "../constants.js";

/** Error thrown for any NOAA API failure, with a message safe to show the agent. */
export class NoaaApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "NoaaApiError";
  }
}

const http: AxiosInstance = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    Accept: "application/json",
    "User-Agent": `${APPLICATION_NAME}/2.0`,
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (!error.response) return true; // network error / timeout
  const status = error.response.status;
  return status === 429 || status >= 500;
}

/** Strip undefined/null/empty-string params so URLs stay clean. */
export function cleanParams(
  params: Record<string, string | number | boolean | undefined | null>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

async function getWithRetry<T>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await http.get<T>(url, { params });
      return response.data;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES && isRetryable(error)) {
        await sleep(500 * Math.pow(3, attempt)); // 500ms, 1.5s
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/** Shape of Data API / DPAPI error bodies: {"error": {"message": "..."}} */
function extractUpstreamMessage(data: unknown): string | undefined {
  if (data && typeof data === "object") {
    const err = (data as { error?: { message?: string } }).error;
    if (err && typeof err.message === "string") return err.message.trim();
  }
  if (typeof data === "string" && data.includes("<error>")) {
    const match = data.match(/<error>([\s\S]*?)<\/error>/);
    if (match) return match[1].trim();
  }
  return undefined;
}

/** Add a helpful next step based on common NOAA error message patterns. */
function adviceFor(message: string): string {
  const lower = message.toLowerCase();
  // Check "no data" before "station": NOAA's no-data message mentions the
  // word "station" too, and the availability hint is the useful one.
  if (lower.includes("no data")) {
    return ' The station may not collect this product, or the requested window may pre-date its record (recent current-meter deployments come and go). Check availability with noaa_get_station_info, or try date="recent".';
  }
  if (lower.includes("datum")) {
    return " Use noaa_get_station_datums to see which datums this station supports (Great Lakes stations use IGLD/LWD; coastal stations use MLLW/MSL/etc.).";
  }
  if (lower.includes("date") || lower.includes("range")) {
    return ' Accepted date formats: yyyyMMdd, "yyyyMMdd HH:mm", MM/dd/yyyy, or ISO yyyy-MM-dd. Check the per-product maximum span with noaa_get_reference_guide (topic "data_limits").';
  }
  if (lower.includes("station")) {
    return ' Verify the station ID with noaa_search_stations or noaa_find_nearest_stations (water-level stations use 7-digit numeric IDs; current stations use alphanumeric IDs like "cb0102").';
  }
  if (lower.includes("prediction")) {
    return ' Note: Great Lakes stations have no tide predictions, and subordinate (type "S") stations only support interval=hilo.';
  }
  return "";
}

function toNoaaError(error: unknown, apiLabel: string): NoaaApiError {
  if (axios.isAxiosError(error)) {
    const axErr = error as AxiosError;
    if (axErr.response) {
      const status = axErr.response.status;
      const upstream = extractUpstreamMessage(axErr.response.data);
      if (upstream) {
        return new NoaaApiError(
          `NOAA ${apiLabel} error: ${upstream}${adviceFor(upstream)}`,
          status,
        );
      }
      if (status === 404) {
        return new NoaaApiError(
          `NOAA ${apiLabel} error: not found (404). The station ID may be wrong or this station does not have the requested resource. Verify with noaa_search_stations.`,
          status,
        );
      }
      if (status === 429) {
        return new NoaaApiError(
          `NOAA ${apiLabel} error: rate limited (429). NOAA throttles heavy query volume — wait a moment and retry, and request narrower date ranges.`,
          status,
        );
      }
      return new NoaaApiError(
        `NOAA ${apiLabel} error: HTTP ${status}.`,
        status,
      );
    }
    if (axErr.code === "ECONNABORTED") {
      return new NoaaApiError(
        `NOAA ${apiLabel} error: request timed out after ${REQUEST_TIMEOUT_MS / 1000}s. Try a narrower date range or retry.`,
      );
    }
    return new NoaaApiError(
      `NOAA ${apiLabel} error: network failure (${axErr.code ?? "unknown"}).`,
    );
  }
  return new NoaaApiError(
    `NOAA ${apiLabel} error: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * Data API GET. Always requests JSON and tags the query with our application
 * name. The Data API can return HTTP 200 with an error body, so both paths
 * are checked.
 */
export async function fetchDataApi<T = Record<string, unknown>>(
  params: Record<string, string | number | boolean | undefined | null>,
): Promise<T> {
  const query = cleanParams({
    ...params,
    application: APPLICATION_NAME,
    format: "json",
  });
  try {
    const data = await getWithRetry<T>(DATA_API_BASE_URL, query);
    const upstream = extractUpstreamMessage(data);
    if (upstream) {
      throw new NoaaApiError(
        `NOAA Data API error: ${upstream}${adviceFor(upstream)}`,
      );
    }
    return data;
  } catch (error) {
    if (error instanceof NoaaApiError) throw error;
    throw toNoaaError(error, "Data API");
  }
}

/** Metadata API GET: path like "/stations.json" or "/stations/8454000/datums.json". */
export async function fetchMetadataApi<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): Promise<T> {
  try {
    return await getWithRetry<T>(
      `${METADATA_API_BASE_URL}${path}`,
      cleanParams(params),
    );
  } catch (error) {
    throw toNoaaError(error, "Metadata API");
  }
}

/** Derived Product API GET: path like "/htf/htf_annual.json". */
export async function fetchDpapi<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): Promise<T> {
  try {
    const data = await getWithRetry<T>(
      `${DPAPI_BASE_URL}${path}`,
      cleanParams(params),
    );
    const upstream = extractUpstreamMessage(data);
    if (upstream) {
      throw new NoaaApiError(
        `NOAA Derived Product API error: ${upstream}${adviceFor(upstream)}`,
      );
    }
    return data;
  } catch (error) {
    if (error instanceof NoaaApiError) throw error;
    throw toNoaaError(error, "Derived Product API");
  }
}
