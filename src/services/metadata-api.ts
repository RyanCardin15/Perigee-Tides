/**
 * NOAA CO-OPS Metadata API (MDAPI) service.
 *
 * Notes from live verification of the API (2026-07):
 *  - The stations list endpoint IGNORES lat/lon/radius query params, so
 *    "find stations near a point" is implemented client-side with a cached
 *    station directory and Haversine distance.
 *  - Response array keys differ from NOAA's own docs prose (e.g. datums not
 *    datumList, HarmonicConstituents not harconList) — parse defensively.
 *  - 404s are bare (no JSON body), unlike the Data API's structured errors.
 */

import { fetchMetadataApi } from "../client/http.js";
import { cache } from "../client/cache.js";
import { CACHE_TTL } from "../constants.js";
import type { UnitSystem } from "../format/units.js";

export const STATION_TYPES = [
  "waterlevels",
  "historicwl",
  "met",
  "waterlevelsandmet",
  "tidepredictions",
  "harcon",
  "datums",
  "supersededdatums",
  "benchmarks",
  "supersededbenchmarks",
  "currents",
  "historiccurrents",
  "surveycurrents",
  "currentpredictions",
  "cond",
  "watertemp",
  "physocean",
  "tcoon",
  "1minute",
  "airgap",
  "visibility",
  "highwater",
  "lowwater",
] as const;

export type StationType = (typeof STATION_TYPES)[number];

export interface StationSummary {
  id: string;
  name: string;
  lat: number;
  lng: number;
  state?: string;
  affiliations?: string;
  portscode?: string | null;
  tideType?: string;
  tidal?: boolean;
  greatlakes?: boolean;
  type?: string; // R (reference) or S (subordinate) for prediction stations
  reference_id?: string;
  [key: string]: unknown;
}

interface StationListResponse {
  count: number;
  units: string | null;
  stations: StationSummary[];
}

/** Cached fetch of the full station directory for one station type. */
export async function listStations(
  type: StationType | undefined,
  units: UnitSystem,
): Promise<StationListResponse> {
  const key = `stations:${type ?? "all"}:${units}`;
  return cache.getOrLoad(key, CACHE_TTL.stationList, () =>
    fetchMetadataApi<StationListResponse>("/stations.json", { type, units }),
  );
}

export interface StationSearchFilters {
  type?: StationType;
  name?: string;
  state?: string;
  units: UnitSystem;
}

/** Client-side filtered station search over the cached directory. */
export async function searchStations(
  filters: StationSearchFilters,
): Promise<StationSummary[]> {
  const { stations } = await listStations(filters.type, filters.units);
  const nameNeedle = filters.name?.toLowerCase();
  const stateNeedle = filters.state?.toLowerCase();
  return stations.filter((s) => {
    if (nameNeedle && !s.name?.toLowerCase().includes(nameNeedle)) return false;
    if (stateNeedle && (s.state ?? "").toLowerCase() !== stateNeedle)
      return false;
    return true;
  });
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export interface NearbyStation extends StationSummary {
  distance_km: number;
  distance_mi: number;
}

/** Nearest stations to an arbitrary point (MDAPI has no native lat/lon search). */
export async function findNearestStations(
  lat: number,
  lon: number,
  type: StationType | undefined,
  limit: number,
  maxDistanceKm?: number,
): Promise<NearbyStation[]> {
  const { stations } = await listStations(type, "english");
  const ranked = stations
    .filter((s) => typeof s.lat === "number" && typeof s.lng === "number")
    .map((s) => {
      const distance_km = haversineKm(lat, lon, s.lat, s.lng);
      return { ...s, distance_km, distance_mi: distance_km * 0.621371 };
    })
    .filter(
      (s) => maxDistanceKm === undefined || s.distance_km <= maxDistanceKm,
    )
    .sort((a, b) => a.distance_km - b.distance_km);
  return ranked.slice(0, limit);
}

/** Single-station overview, optionally expanding sub-resources inline. */
export async function getStationInfo(
  stationId: string,
  expand: string[] | undefined,
  units: UnitSystem,
): Promise<Record<string, unknown>> {
  const key = `station:${stationId}:${units}:${expand?.slice().sort().join(",") ?? ""}`;
  return cache.getOrLoad(key, CACHE_TTL.stationResource, () =>
    fetchMetadataApi<Record<string, unknown>>(
      `/stations/${encodeURIComponent(stationId)}.json`,
      {
        units,
        expand: expand?.length ? expand.join(",") : undefined,
      },
    ),
  );
}

/** Generic station sub-resource fetch (datums, harcon, tidepredoffsets, ...). */
export async function getStationResource<T = Record<string, unknown>>(
  stationId: string,
  resource: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const key = `resource:${stationId}:${resource}:${JSON.stringify(params)}`;
  return cache.getOrLoad(key, CACHE_TTL.stationResource, () =>
    fetchMetadataApi<T>(
      `/stations/${encodeURIComponent(stationId)}/${resource}.json`,
      params,
    ),
  );
}

/**
 * Defensive array extraction: MDAPI's real key names differ from its docs
 * (observed live: `datums`, `HarmonicConstituents`, `sensors`, `bins`,
 * `notices`, `products` — docs claim `datumList`, `harconList`, ...).
 */
export function extractList<T = Record<string, unknown>>(
  payload: Record<string, unknown>,
  ...candidateKeys: string[]
): T[] {
  for (const key of candidateKeys) {
    const value = payload[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}
