/**
 * Open-Meteo Marine API — model wave/swell/SST/surface-current forecasts for
 * any ocean coordinate (the "virtual buoy" concept commercial apps sell).
 *
 * Mechanics verified against the public docs: hourly arrays come back as
 * parallel columns under `hourly` with units in `hourly_units`; timestamps
 * are "YYYY-MM-DDTHH:mm" in the requested timezone (UTC here, so a "Z" is
 * appended); missing cells are null. Values are MODEL OUTPUT (GFS-Wave /
 * ECMWF WAM / ICON blends), not observations — cross-check against a real
 * NDBC buoy when one is nearby. Free tier is non-commercial with attribution.
 */

import { cache } from "../client/cache.js";
import { fetchOpenMeteoMarine } from "../client/http.js";
import { CACHE_TTL } from "../constants.js";

export interface MarineHourlySample {
  /** UTC instant, ISO 8601. */
  time: string;
  /** Combined significant wave height, meters. */
  wave_height_m: number | null;
  /** Direction combined waves come FROM, degrees true. */
  wave_direction_deg: number | null;
  /** Combined wave period, seconds. */
  wave_period_s: number | null;
  /** Wind-wave (local sea) component height, meters. */
  wind_wave_height_m: number | null;
  wind_wave_period_s: number | null;
  /** Primary swell component height, meters. */
  swell_wave_height_m: number | null;
  swell_wave_direction_deg: number | null;
  swell_wave_period_s: number | null;
  /** Sea surface temperature, °C. */
  sea_surface_temp_c: number | null;
  /** Surface current speed, km/h (Open-Meteo's native unit). */
  current_velocity_kmh: number | null;
  /** Direction the current flows TOWARD, degrees true. */
  current_direction_deg: number | null;
}

export interface MarineForecast {
  latitude: number;
  longitude: number;
  samples: MarineHourlySample[];
}

interface OpenMeteoMarineResponse {
  latitude: number;
  longitude: number;
  hourly?: {
    time?: string[];
    wave_height?: Array<number | null>;
    wave_direction?: Array<number | null>;
    wave_period?: Array<number | null>;
    wind_wave_height?: Array<number | null>;
    wind_wave_period?: Array<number | null>;
    swell_wave_height?: Array<number | null>;
    swell_wave_direction?: Array<number | null>;
    swell_wave_period?: Array<number | null>;
    sea_surface_temperature?: Array<number | null>;
    ocean_current_velocity?: Array<number | null>;
    ocean_current_direction?: Array<number | null>;
  };
}

const HOURLY_VARS = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "wind_wave_height",
  "wind_wave_period",
  "swell_wave_height",
  "swell_wave_direction",
  "swell_wave_period",
  "sea_surface_temperature",
  "ocean_current_velocity",
  "ocean_current_direction",
].join(",");

export async function getMarineForecast(
  latitude: number,
  longitude: number,
  days: number,
): Promise<MarineForecast> {
  const key = `openmeteo:marine:${latitude.toFixed(3)},${longitude.toFixed(3)}:${days}`;
  return cache.getOrLoad(key, CACHE_TTL.nwsForecast, async () => {
    const data = await fetchOpenMeteoMarine<OpenMeteoMarineResponse>({
      latitude,
      longitude,
      forecast_days: days,
      timezone: "UTC",
      // "sea" makes Open-Meteo snap coastal coordinates to the nearest
      // ocean model cell instead of returning all-null land cells.
      cell_selection: "sea",
      hourly: HOURLY_VARS,
    });
    const h = data.hourly ?? {};
    const times = h.time ?? [];
    const at = (
      column: Array<number | null> | undefined,
      i: number,
    ): number | null => {
      const v = column?.[i];
      return v === undefined || v === null || Number.isNaN(v) ? null : v;
    };
    const samples: MarineHourlySample[] = times.map((t, i) => ({
      // "2026-07-09T14:00" (UTC, no zone suffix) → full ISO instant.
      time: t.length === 16 ? `${t}:00Z` : `${t}Z`,
      wave_height_m: at(h.wave_height, i),
      wave_direction_deg: at(h.wave_direction, i),
      wave_period_s: at(h.wave_period, i),
      wind_wave_height_m: at(h.wind_wave_height, i),
      wind_wave_period_s: at(h.wind_wave_period, i),
      swell_wave_height_m: at(h.swell_wave_height, i),
      swell_wave_direction_deg: at(h.swell_wave_direction, i),
      swell_wave_period_s: at(h.swell_wave_period, i),
      sea_surface_temp_c: at(h.sea_surface_temperature, i),
      current_velocity_kmh: at(h.ocean_current_velocity, i),
      current_direction_deg: at(h.ocean_current_direction, i),
    }));
    return { latitude: data.latitude, longitude: data.longitude, samples };
  });
}
