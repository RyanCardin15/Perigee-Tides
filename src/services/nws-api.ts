/**
 * NWS Weather API (api.weather.gov) — wind and marine FORECASTS.
 *
 * This is a different NOAA service from CO-OPS with different shapes:
 *  - /points/{lat},{lon} resolves a coordinate to a forecast office gridpoint
 *    (gridX/gridY assignments drift over re-gridding, so cache with a TTL and
 *    never hardcode them).
 *  - /gridpoints/{office}/{x},{y} returns NUMERIC time series (the friendlier
 *    /forecast/hourly endpoint returns display strings like "10 to 15 mph"
 *    and is deliberately not used). Each series value carries a validTime of
 *    the form "2026-07-05T18:00:00+00:00/PT3H" — an ISO instant plus an ISO
 *    duration the value holds for — which we expand into hourly samples.
 *  - Marine zone TEXT forecasts are NOT served by /zones/forecast/{id}/forecast
 *    (that 404s with "Marine Forecast Not Supported"); the working path is the
 *    Products API: latest CWF product for the issuing office, then extracting
 *    the segment for the zone from the multi-zone bulletin.
 */

import { cache } from "../client/cache.js";
import { fetchNwsApi } from "../client/http.js";
import { NoaaApiError } from "../client/http.js";
import { CACHE_TTL } from "../constants.js";

// ---------------------------------------------------------------------------
// Point → gridpoint resolution
// ---------------------------------------------------------------------------

export interface NwsPoint {
  gridId: string;
  gridX: number;
  gridY: number;
  /** Issuing forecast office, e.g. "HGX". */
  cwa: string;
  /** IANA time zone for the point, e.g. "America/Chicago". */
  timeZone: string;
  /** "land" or "marine" — how NWS classifies the coordinate. */
  pointType?: string;
  /** Nearest named place, e.g. "Sargent, TX". */
  place?: string;
}

interface PointsResponse {
  properties?: {
    gridId?: string;
    gridX?: number;
    gridY?: number;
    cwa?: string;
    timeZone?: string;
    type?: string;
    relativeLocation?: {
      properties?: { city?: string; state?: string };
    };
  };
}

function pointKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

export async function resolvePoint(
  latitude: number,
  longitude: number,
): Promise<NwsPoint> {
  const key = pointKey(latitude, longitude);
  return cache.getOrLoad(`nws:point:${key}`, CACHE_TTL.nwsPoint, async () => {
    const data = await fetchNwsApi<PointsResponse>(`/points/${key}`);
    const p = data.properties;
    if (!p?.gridId || p.gridX === undefined || p.gridY === undefined) {
      throw new NoaaApiError(
        "NWS API error: the point resolved to no forecast gridpoint. NWS forecasts cover the US and its territories only.",
      );
    }
    const loc = p.relativeLocation?.properties;
    return {
      gridId: p.gridId,
      gridX: p.gridX,
      gridY: p.gridY,
      cwa: p.cwa ?? p.gridId,
      timeZone: p.timeZone ?? "UTC",
      pointType: p.type,
      place: loc?.city && loc?.state ? `${loc.city}, ${loc.state}` : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Gridpoint numeric series
// ---------------------------------------------------------------------------

export interface GridSeries {
  uom?: string;
  values?: Array<{ validTime: string; value: number | null }>;
}

interface GridpointResponse {
  properties?: {
    updateTime?: string;
    windSpeed?: GridSeries;
    windGust?: GridSeries;
    windDirection?: GridSeries;
    waveHeight?: GridSeries;
  };
}

const HOUR_MS = 3_600_000;

/** Parse an ISO 8601 duration like "PT3H", "P1D", "PT1H30M" to milliseconds. */
export function parseIsoDurationMs(duration: string): number {
  const match = duration.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (!match) return HOUR_MS;
  const [, days, hours, minutes, seconds] = match;
  return (
    (Number(days ?? 0) * 24 + Number(hours ?? 0)) * HOUR_MS +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1_000
  );
}

/**
 * Expand a gridpoint series (start-instant + hold-duration values) into a map
 * of epoch-ms-per-hour → value.
 */
export function expandGridSeries(
  series: GridSeries | undefined,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const entry of series?.values ?? []) {
    if (entry.value === null || entry.value === undefined) continue;
    const [startStr, durationStr] = entry.validTime.split("/");
    const start = Date.parse(startStr);
    if (Number.isNaN(start)) continue;
    const startHour = Math.floor(start / HOUR_MS) * HOUR_MS;
    const hours = Math.max(
      1,
      Math.round(parseIsoDurationMs(durationStr ?? "PT1H") / HOUR_MS),
    );
    for (let i = 0; i < hours; i++) {
      const key = startHour + i * HOUR_MS;
      if (!out.has(key)) out.set(key, entry.value);
    }
  }
  return out;
}

/** Convert a gridpoint speed value to knots based on its declared unit. */
export function speedToKnots(value: number, uom: string | undefined): number {
  if (uom?.includes("km_h")) return value / 1.852;
  if (uom?.includes("m_s")) return value * 1.9438444924;
  if (uom?.includes("kn")) return value;
  if (uom?.includes("mi_h")) return value * 0.8689762419;
  // NWS gridpoint wind defaults to km/h; assume that when the unit is missing.
  return value / 1.852;
}

export function knotsToMs(knots: number): number {
  return knots * 0.5144444444;
}

/** Convert a gridpoint length value to meters based on its declared unit. */
export function lengthToMeters(value: number, uom: string | undefined): number {
  if (uom?.includes("ft")) return value * 0.3048;
  return value; // wmoUnit:m
}

export function metersToFeet(meters: number): number {
  return meters / 0.3048;
}

const COMPASS_POINTS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

export function toCompass(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(normalized / 22.5) % 16];
}

export interface HourlyWindSample {
  /** UTC instant, ISO 8601. */
  time: string;
  /** Wind speed in knots (converted from the gridpoint's declared unit). */
  speed_knots: number | null;
  /** Wind gust in knots. */
  gust_knots: number | null;
  /** Direction the wind blows FROM, degrees true. */
  direction_deg: number | null;
  /** 16-point compass rendering of direction_deg. */
  compass: string | null;
  /** Significant wave height in meters (marine gridpoints only, often absent). */
  wave_height_m: number | null;
}

export interface WindForecast {
  point: NwsPoint;
  updated?: string;
  samples: HourlyWindSample[];
}

/**
 * Hourly numeric wind forecast (plus wave height when the grid carries it)
 * for a coordinate, starting at the current hour.
 */
export async function getWindForecast(
  latitude: number,
  longitude: number,
  hours: number,
): Promise<WindForecast> {
  const point = await resolvePoint(latitude, longitude);
  const gridPath = `/gridpoints/${point.gridId}/${point.gridX},${point.gridY}`;
  const grid = await cache.getOrLoad(
    `nws:grid:${gridPath}`,
    CACHE_TTL.nwsForecast,
    () => fetchNwsApi<GridpointResponse>(gridPath),
  );
  const p = grid.properties ?? {};
  const speeds = expandGridSeries(p.windSpeed);
  const gusts = expandGridSeries(p.windGust);
  const directions = expandGridSeries(p.windDirection);
  const waves = expandGridSeries(p.waveHeight);

  const startHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
  const samples: HourlyWindSample[] = [];
  for (let i = 0; i < hours; i++) {
    const t = startHour + i * HOUR_MS;
    const speed = speeds.get(t);
    const gust = gusts.get(t);
    const direction = directions.get(t);
    const wave = waves.get(t);
    if (
      speed === undefined &&
      gust === undefined &&
      direction === undefined &&
      wave === undefined
    ) {
      continue; // past the end of the forecast grid
    }
    samples.push({
      time: new Date(t).toISOString(),
      speed_knots:
        speed === undefined
          ? null
          : round1(speedToKnots(speed, p.windSpeed?.uom)),
      gust_knots:
        gust === undefined ? null : round1(speedToKnots(gust, p.windGust?.uom)),
      direction_deg: direction === undefined ? null : Math.round(direction),
      compass: direction === undefined ? null : toCompass(direction),
      wave_height_m:
        wave === undefined
          ? null
          : round1(lengthToMeters(wave, p.waveHeight?.uom)),
    });
  }
  return { point, updated: p.updateTime, samples };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// ---------------------------------------------------------------------------
// Marine zone text forecast (Coastal Waters Forecast, CWF)
// ---------------------------------------------------------------------------

export interface MarineZone {
  id: string;
  name: string;
  cwa: string;
}

interface ZonesResponse {
  features?: Array<{
    properties?: { id?: string; name?: string; cwa?: string[] };
  }>;
}

/** Resolve the NWS coastal marine zone covering a coordinate (e.g. GMZ350). */
export async function findCoastalZone(
  latitude: number,
  longitude: number,
): Promise<MarineZone> {
  const key = pointKey(latitude, longitude);
  return cache.getOrLoad(`nws:zone:${key}`, CACHE_TTL.nwsPoint, async () => {
    const data = await fetchNwsApi<ZonesResponse>("/zones", {
      type: "coastal",
      point: key,
      include_geometry: false,
    });
    const zone = data.features?.[0]?.properties;
    if (!zone?.id) {
      throw new NoaaApiError(
        "NWS API error: no coastal marine zone covers this point. Coastal Waters Forecasts exist only for US coastal waters (roughly out to 20-60 NM); for a land point, use nws_get_wind_forecast instead.",
      );
    }
    return {
      id: zone.id,
      name: zone.name ?? zone.id,
      cwa: zone.cwa?.[0] ?? "",
    };
  });
}

/**
 * True when a CWF bulletin segment's UGC header covers the given zone.
 * Headers look like "GMZ330-335-350-061015-" (list) or "GMZ350>355-061015-"
 * (range), always ending in a 6-digit expiry.
 */
export function segmentCoversZone(segment: string, zoneId: string): boolean {
  const prefix = zoneId.slice(0, 3);
  const target = Number(zoneId.slice(3));
  const ugcLines = segment.match(/^[A-Z]{2}Z[0-9>-]+/gm) ?? [];
  for (const line of ugcLines) {
    if (!line.startsWith(prefix)) continue;
    const body = line.slice(3).replace(/-\d{6}-?$/, "");
    for (const part of body.split("-")) {
      if (!part) continue;
      if (part.includes(">")) {
        const [lo, hi] = part.split(">").map(Number);
        if (target >= lo && target <= hi) return true;
      } else if (Number(part) === target) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Extract the segment of a multi-zone CWF bulletin covering one zone.
 * Bulletins are segmented by "$$" terminators; each segment opens with a UGC
 * zone-list header. Returns undefined when no segment matches.
 */
export function extractZoneSegment(
  productText: string,
  zoneId: string,
): string | undefined {
  const segments = productText.split(/^\s*\$\$\s*$/m);
  const match = segments.find((s) => segmentCoversZone(s, zoneId));
  return match?.trim();
}

/**
 * Extract the office-wide synopsis block, when the bulletin carries one.
 * Offices vary the header casing (".SYNOPSIS...", ".Synopsis For ...").
 */
export function extractSynopsis(productText: string): string | undefined {
  const match = productText.match(
    /^\.synopsis[\s\S]*?(?=^\s*\$\$\s*$|^\.\w)/im,
  );
  return match?.[0]?.trim();
}

interface ProductListResponse {
  "@graph"?: Array<{ id?: string; issuanceTime?: string }>;
}

interface ProductResponse {
  productText?: string;
  issuanceTime?: string;
  id?: string;
}

export interface MarineTextForecast {
  zone: MarineZone;
  productId?: string;
  issuanceTime?: string;
  /** The bulletin segment for the zone (day-part narrative, winds in knots). */
  segment?: string;
  /** The office-wide marine synopsis, when present. */
  synopsis?: string;
}

/**
 * Latest Coastal Waters Forecast text for the marine zone covering a point.
 * CWF products are keyed by issuing office (not zone) and cover every zone
 * that office serves in one bulletin, so the zone's segment is extracted here.
 */
export async function getMarineTextForecast(
  latitude: number,
  longitude: number,
): Promise<MarineTextForecast> {
  const zone = await findCoastalZone(latitude, longitude);
  if (!zone.cwa) {
    throw new NoaaApiError(
      `NWS API error: marine zone ${zone.id} has no issuing office on record; cannot locate its Coastal Waters Forecast.`,
    );
  }
  const result = await cache.getOrLoad(
    `nws:cwf:${zone.cwa}`,
    CACHE_TTL.nwsForecast,
    async () => {
      const list = await fetchNwsApi<ProductListResponse>(
        `/products/types/CWF/locations/${zone.cwa}`,
      );
      const latest = list["@graph"]?.[0];
      if (!latest?.id) {
        throw new NoaaApiError(
          `NWS API error: no recent Coastal Waters Forecast found for office ${zone.cwa}.`,
        );
      }
      const product = await fetchNwsApi<ProductResponse>(
        `/products/${latest.id}`,
      );
      return {
        productId: latest.id,
        issuanceTime: product.issuanceTime ?? latest.issuanceTime,
        text: product.productText ?? "",
      };
    },
  );
  return {
    zone,
    productId: result.productId,
    issuanceTime: result.issuanceTime,
    segment: extractZoneSegment(result.text, zone.id),
    synopsis: extractSynopsis(result.text),
  };
}
