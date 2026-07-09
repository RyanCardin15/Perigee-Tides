/**
 * NOAA NDBC (National Data Buoy Center) — realtime buoy observations.
 *
 * NDBC has no JSON API; it publishes fixed-format text files:
 *  - /activestations.xml — the active-station directory (id, lat/lon, name,
 *    type, and per-sensor "y/n" flags), refreshed daily.
 *  - /data/realtime2/{ID}.txt — last ~45 days of standard meteorological
 *    observations. Two "#"-prefixed header lines carry column names then
 *    units; "MM" marks missing values; rows are NEWEST FIRST. Column ORDER
 *    is stable but parsed by header NAME here anyway, defensively.
 *
 * NDBC units are fixed (m/s wind, meters, hPa, °C, nmi) regardless of any
 * user preference — conversion to english units happens at the tool layer.
 */

import { cache } from "../client/cache.js";
import { fetchNdbcText, NoaaApiError } from "../client/http.js";
import { CACHE_TTL } from "../constants.js";
import { haversineKm } from "./metadata-api.js";

// ---------------------------------------------------------------------------
// Active station directory
// ---------------------------------------------------------------------------

export interface NdbcStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** e.g. "buoy", "fixed", "dart", "oilrig", "usv". */
  type: string;
  owner?: string;
  program?: string;
  /** Reports standard meteorology (wind/pressure/temps). */
  has_met: boolean;
  /** Reports currents. */
  has_currents: boolean;
  /** Reports water quality. */
  has_water_quality: boolean;
}

/**
 * Parse activestations.xml. The file is flat, one self-closing <station …/>
 * per line, so attribute-level regex parsing is safe and avoids an XML
 * dependency. Stations missing id/lat/lon are skipped.
 */
export function parseActiveStations(xml: string): NdbcStation[] {
  const stations: NdbcStation[] = [];
  const tags = xml.match(/<station\b[^>]*\/>/g) ?? [];
  for (const tag of tags) {
    const attr = (name: string): string | undefined => {
      const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
      return match?.[1];
    };
    const id = attr("id");
    const lat = Number(attr("lat"));
    const lon = Number(attr("lon"));
    if (!id || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    stations.push({
      id: id.toUpperCase(),
      name: decodeXmlEntities(attr("name") ?? id),
      lat,
      lon,
      type: attr("type") ?? "unknown",
      owner: attr("owner") ? decodeXmlEntities(attr("owner")!) : undefined,
      program: attr("pgm") ? decodeXmlEntities(attr("pgm")!) : undefined,
      has_met: attr("met") === "y",
      has_currents: attr("currents") === "y",
      has_water_quality: attr("waterquality") === "y",
    });
  }
  return stations;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export async function listActiveStations(): Promise<NdbcStation[]> {
  return cache.getOrLoad(
    "ndbc:activestations",
    CACHE_TTL.ndbcStations,
    async () => {
      const xml = await fetchNdbcText("/activestations.xml");
      const stations = parseActiveStations(xml);
      if (stations.length === 0) {
        throw new NoaaApiError(
          "NOAA NDBC error: the active-station directory came back empty or in an unexpected format.",
        );
      }
      return stations;
    },
  );
}

export interface NdbcStationWithDistance extends NdbcStation {
  distance_km: number;
  distance_mi: number;
}

export async function findNearestBuoys(
  latitude: number,
  longitude: number,
  limit: number,
  options: { requireMet?: boolean; maxDistanceKm?: number } = {},
): Promise<NdbcStationWithDistance[]> {
  const stations = await listActiveStations();
  return stations
    .filter((s) => !options.requireMet || s.has_met)
    .map((s) => {
      const distance_km = haversineKm(latitude, longitude, s.lat, s.lon);
      return { ...s, distance_km, distance_mi: distance_km * 0.621371 };
    })
    .filter(
      (s) =>
        options.maxDistanceKm === undefined ||
        s.distance_km <= options.maxDistanceKm,
    )
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Realtime standard meteorological observations (…/realtime2/{ID}.txt)
// ---------------------------------------------------------------------------

export interface NdbcObservation {
  /** UTC observation instant, ISO 8601. */
  time: string;
  /** Direction the wind blows FROM, degrees true. */
  wind_dir_deg: number | null;
  /** m/s. */
  wind_speed_ms: number | null;
  /** m/s. */
  wind_gust_ms: number | null;
  /** Significant wave height, meters. */
  wave_height_m: number | null;
  /** Dominant (peak) wave period, seconds. */
  dominant_period_s: number | null;
  /** Average wave period, seconds. */
  average_period_s: number | null;
  /** Direction dominant-period waves come FROM, degrees true. */
  mean_wave_dir_deg: number | null;
  /** Sea-level pressure, hPa (= millibars). */
  pressure_hpa: number | null;
  /** hPa change over the last 3 hours (negative = falling). */
  pressure_tendency_hpa: number | null;
  air_temp_c: number | null;
  water_temp_c: number | null;
  dewpoint_c: number | null;
  /** Nautical miles. */
  visibility_nmi: number | null;
  /** Water level above/below MLLW, feet (rarely reported). */
  tide_ft: number | null;
}

/** Map realtime2 column names to NdbcObservation fields. */
const REALTIME2_COLUMNS: Record<string, keyof NdbcObservation> = {
  WDIR: "wind_dir_deg",
  WSPD: "wind_speed_ms",
  GST: "wind_gust_ms",
  WVHT: "wave_height_m",
  DPD: "dominant_period_s",
  APD: "average_period_s",
  MWD: "mean_wave_dir_deg",
  PRES: "pressure_hpa",
  PTDY: "pressure_tendency_hpa",
  ATMP: "air_temp_c",
  WTMP: "water_temp_c",
  DEWP: "dewpoint_c",
  VIS: "visibility_nmi",
  TIDE: "tide_ft",
};

/**
 * Parse a realtime2 standard-met file. Columns are resolved from the first
 * header line by name; "MM" (and blank) cells become null. Rows arrive
 * newest-first and are returned that way.
 */
export function parseRealtime2(text: string): NdbcObservation[] {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2 || !lines[0].startsWith("#")) {
    throw new NoaaApiError(
      "NOAA NDBC error: unexpected realtime2 file format (missing header). The station may not publish standard meteorological data.",
    );
  }
  const headers = lines[0].replace(/^#/, "").trim().split(/\s+/);
  const observations: NdbcObservation[] = [];
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const cells = line.trim().split(/\s+/);
    if (cells.length < 5) continue;
    // First five columns are always YY MM DD hh mm (4-digit year).
    const [year, month, day, hour, minute] = cells.map(Number);
    if ([year, month, day, hour, minute].some(Number.isNaN)) continue;
    const obs: NdbcObservation = {
      time: new Date(
        Date.UTC(year, month - 1, day, hour, minute),
      ).toISOString(),
      wind_dir_deg: null,
      wind_speed_ms: null,
      wind_gust_ms: null,
      wave_height_m: null,
      dominant_period_s: null,
      average_period_s: null,
      mean_wave_dir_deg: null,
      pressure_hpa: null,
      pressure_tendency_hpa: null,
      air_temp_c: null,
      water_temp_c: null,
      dewpoint_c: null,
      visibility_nmi: null,
      tide_ft: null,
    };
    for (let i = 5; i < headers.length && i < cells.length; i++) {
      const field = REALTIME2_COLUMNS[headers[i]];
      if (!field) continue;
      const raw = cells[i];
      if (raw === "MM" || raw === "") continue;
      const value = Number(raw);
      if (!Number.isNaN(value)) {
        (obs as unknown as Record<string, number>)[field] = value;
      }
    }
    observations.push(obs);
  }
  return observations;
}

export interface BuoyObservations {
  station_id: string;
  station?: NdbcStation;
  observations: NdbcObservation[];
}

/**
 * Latest realtime observations for a buoy, newest first, trimmed to the
 * requested window. Station metadata is attached when the directory knows
 * the ID (realtime2 also serves some non-directory stations; that's fine).
 */
export async function getBuoyObservations(
  stationId: string,
  hoursBack: number,
): Promise<BuoyObservations> {
  const id = stationId.trim().toUpperCase();
  const text = await cache.getOrLoad(
    `ndbc:realtime2:${id}`,
    CACHE_TTL.ndbcObservations,
    () => fetchNdbcText(`/data/realtime2/${id}.txt`),
  );
  const all = parseRealtime2(text);
  const cutoff = Date.now() - hoursBack * 3_600_000;
  const observations = all.filter((o) => Date.parse(o.time) >= cutoff);
  let station: NdbcStation | undefined;
  try {
    station = (await listActiveStations()).find((s) => s.id === id);
  } catch {
    // Directory lookup is best-effort decoration; observations still stand.
  }
  return { station_id: id, station, observations };
}
