/**
 * Unit labeling for NOAA CO-OPS measurements.
 *
 * The `units` request parameter (english|metric) changes the physical units
 * per measurement type — and NOT uniformly:
 *   - wind speed:    english = knots, metric = m/s
 *   - current speed: english = knots, metric = cm/s   (NOT m/s!)
 *   - air pressure:  millibars in BOTH systems
 *   - salinity:      PSU in BOTH systems
 * Every tool response labels its values so the agent never has to guess.
 */

export type UnitSystem = "english" | "metric";

export type MeasurementKind =
  | "water_level"
  | "air_temperature"
  | "water_temperature"
  | "wind"
  | "air_pressure"
  | "air_gap"
  | "conductivity"
  | "visibility"
  | "humidity"
  | "salinity"
  | "currents";

const UNIT_LABELS: Record<MeasurementKind, Record<UnitSystem, string>> = {
  water_level: { english: "feet", metric: "meters" },
  air_temperature: { english: "°F", metric: "°C" },
  water_temperature: { english: "°F", metric: "°C" },
  wind: { english: "knots", metric: "m/s" },
  air_pressure: { english: "millibars", metric: "millibars" },
  air_gap: { english: "feet", metric: "meters" },
  conductivity: { english: "mS/cm", metric: "mS/cm" },
  visibility: { english: "nautical miles", metric: "kilometers" },
  humidity: { english: "%", metric: "%" },
  salinity: { english: "PSU", metric: "PSU" },
  currents: { english: "knots", metric: "cm/s" },
};

export function unitLabel(kind: MeasurementKind, units: UnitSystem): string {
  return UNIT_LABELS[kind][units];
}

/** Quality/data flags per product family, decoded for humans. */
export const FLAG_LEGENDS: Record<string, string> = {
  water_level_preliminary:
    "f flags (count of 1-sec samples flagged): O=outside 3-sigma band, F=flat tolerance exceeded, R=rate-of-change limit exceeded, L=max/min limit exceeded",
  water_level_verified:
    "f flags: I=inferred value, F=flat tolerance exceeded, R=rate-of-change limit exceeded, T=max/min limit exceeded",
  hourly_height: "f flags: I=inferred, L=max/min limit exceeded",
  high_low:
    "f flags: I=inferred, L=max/min limit exceeded; ty: HH=higher high, H=high, L=low, LL=lower low",
  met: "f flags: X=max limit exceeded, N=min limit exceeded, R=rate-of-change limit exceeded",
  wind: "f flags: X=max wind speed exceeded, R=rate-of-change limit exceeded",
  air_gap:
    "f flags: O=outside 3-sigma band, F=flat tolerance exceeded, R=rate-of-change exceeded, A=max/min limit exceeded",
};
