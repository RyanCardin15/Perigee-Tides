/**
 * NOAA CO-OPS Data Retrieval API service.
 *
 * Encodes the per-product rules discovered from the official docs:
 *  - which products need a datum
 *  - per-product/interval maximum request spans (validated before calling)
 *  - product-specific restrictions (daily_mean is Great Lakes-only and
 *    requires time_zone=lst; bin=0 caps currents at 7 days; etc.)
 */

import { fetchDataApi } from "../client/http.js";
import {
  assertSpanWithinLimit,
  DateParams,
  NormalizedDateParams,
  resolveDateParams,
} from "../validation/dates.js";
import type { UnitSystem } from "../format/units.js";

export type NoaaTimeZone = "gmt" | "lst" | "lst_ldt";

export interface DataApiBaseParams extends DateParams {
  station: string;
  units: UnitSystem;
  time_zone: NoaaTimeZone;
}

interface DataObservation {
  t: string;
  v?: string;
  s?: string;
  f?: string;
  q?: string;
  ty?: string;
  d?: string;
  dr?: string;
  g?: string;
  b?: string;
  [key: string]: string | undefined;
}

export interface DataApiResponse {
  metadata?: { id: string; name: string; lat: string; lon: string };
  data?: DataObservation[];
  predictions?: DataObservation[];
  current_predictions?: { cp: DataObservation[] } | DataObservation[];
  [key: string]: unknown;
}

function dateQuery(
  resolved: NormalizedDateParams,
): Record<string, string | number | undefined> {
  return {
    date: resolved.date,
    begin_date: resolved.begin_date,
    end_date: resolved.end_date,
    range: resolved.range,
  };
}

export type WaterLevelInterval = "1" | "6" | "hourly";

const WATER_LEVEL_PRODUCTS: Record<WaterLevelInterval, string> = {
  "1": "one_minute_water_level",
  "6": "water_level",
  hourly: "hourly_height",
};

export async function getWaterLevels(
  params: DataApiBaseParams & { interval: WaterLevelInterval; datum: string },
): Promise<{ product: string; response: DataApiResponse }> {
  const product = WATER_LEVEL_PRODUCTS[params.interval];
  const resolved = resolveDateParams(params);
  assertSpanWithinLimit(
    resolved.spanDays,
    product,
    `${params.interval}-minute-interval water levels`,
  );
  const response = await fetchDataApi<DataApiResponse>({
    product,
    station: params.station,
    datum: params.datum,
    units: params.units,
    time_zone: params.time_zone,
    ...dateQuery(resolved),
  });
  return { product, response };
}

export type SummaryProduct =
  | "high_low"
  | "daily_mean"
  | "daily_max_min"
  | "monthly_mean";

export async function getWaterLevelSummaries(
  params: DataApiBaseParams & { product: SummaryProduct; datum: string },
): Promise<{ response: DataApiResponse; timeZoneForced: boolean }> {
  const resolved = resolveDateParams(params);
  assertSpanWithinLimit(resolved.spanDays, params.product, params.product);

  // daily_mean is only computed for Great Lakes stations and NOAA requires
  // time_zone=lst for it — force it rather than surface a cryptic upstream error.
  let timeZone = params.time_zone;
  let timeZoneForced = false;
  if (params.product === "daily_mean" && timeZone !== "lst") {
    timeZone = "lst";
    timeZoneForced = true;
  }

  const response = await fetchDataApi<DataApiResponse>({
    product: params.product,
    station: params.station,
    datum: params.datum,
    units: params.units,
    time_zone: timeZone,
    ...dateQuery(resolved),
  });
  return { response, timeZoneForced };
}

export type PredictionInterval =
  | "hilo"
  | "h"
  | "1"
  | "5"
  | "6"
  | "10"
  | "15"
  | "30"
  | "60";

export async function getTidePredictions(
  params: DataApiBaseParams & { interval: PredictionInterval; datum: string },
): Promise<DataApiResponse> {
  const resolved = resolveDateParams(params);
  const limitKey =
    params.interval === "hilo" ? "predictions:hilo" : "predictions";
  assertSpanWithinLimit(
    resolved.spanDays,
    limitKey,
    params.interval === "hilo"
      ? "high/low tide predictions"
      : "interval tide predictions",
  );
  return fetchDataApi<DataApiResponse>({
    product: "predictions",
    station: params.station,
    datum: params.datum,
    units: params.units,
    time_zone: params.time_zone,
    interval: params.interval,
    ...dateQuery(resolved),
  });
}

export async function getCurrents(
  params: DataApiBaseParams & { bin?: number; expand_detailed?: boolean },
): Promise<DataApiResponse> {
  const resolved = resolveDateParams(params);
  assertSpanWithinLimit(resolved.spanDays, "currents", "observed currents");
  return fetchDataApi<DataApiResponse>({
    product: "currents",
    station: params.station,
    units: params.units,
    time_zone: params.time_zone,
    bin: params.bin,
    expand: params.expand_detailed ? "detailed" : undefined,
    ...dateQuery(resolved),
  });
}

export type CurrentPredictionInterval =
  | "max_slack"
  | "h"
  | "1"
  | "6"
  | "10"
  | "30"
  | "60";

export async function getCurrentPredictions(
  params: DataApiBaseParams & {
    bin?: number;
    interval: CurrentPredictionInterval;
    vel_type?: "default" | "speed_dir";
  },
): Promise<DataApiResponse> {
  const resolved = resolveDateParams(params);
  const limitKey =
    params.interval === "max_slack"
      ? "currents_predictions:max_slack"
      : "currents_predictions";
  assertSpanWithinLimit(resolved.spanDays, limitKey, "current predictions");
  return fetchDataApi<DataApiResponse>({
    product: "currents_predictions",
    station: params.station,
    units: params.units,
    time_zone: params.time_zone,
    bin: params.bin,
    interval: params.interval,
    vel_type: params.vel_type === "speed_dir" ? "speed_dir" : undefined,
    ...dateQuery(resolved),
  });
}

export type MetProduct =
  | "air_temperature"
  | "water_temperature"
  | "wind"
  | "air_pressure"
  | "air_gap"
  | "conductivity"
  | "visibility"
  | "humidity"
  | "salinity";

export async function getMeteorologicalData(
  params: DataApiBaseParams & { product: MetProduct; interval?: "6" | "h" },
): Promise<DataApiResponse> {
  const resolved = resolveDateParams(params);
  assertSpanWithinLimit(
    resolved.spanDays,
    params.product === "air_gap" ? "air_gap" : "met",
    params.product,
  );
  return fetchDataApi<DataApiResponse>({
    product: params.product,
    station: params.station,
    units: params.units,
    time_zone: params.time_zone,
    interval: params.interval === "h" ? "h" : undefined,
    ...dateQuery(resolved),
  });
}
