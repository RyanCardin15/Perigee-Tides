/**
 * Solunar (bite-time) forecasting, computed locally from moon and sun
 * geometry — the same theory the big fishing apps implement:
 *
 *  - MAJOR periods (~2h): centered on lunar transit — the moon crossing the
 *    observer's meridian overhead ("moon overhead") or the antimeridian
 *    beneath the observer ("moon underfoot").
 *  - MINOR periods (~1.5h): centered on moonrise and moonset.
 *  - Day rating: strongest near new/full moon (syzygy — also spring tides),
 *    boosted when the moon is near perigee and when a solunar period
 *    overlaps dawn or dusk.
 *
 * Transits are found by scanning the moon's altitude at one-minute steps
 * across the local day: a local maximum is the overhead transit, a local
 * minimum the underfoot transit. suncalc has no transit function, and the
 * lunar day is ~24h50m, so a calendar day can lack one (or both) transits.
 *
 * This is folklore-grade forecasting, not physics: the output encodes the
 * conventional solunar tables, and the rating explains its own factors so
 * agents can weigh them against real conditions (weather, tide, pressure).
 */

import SunCalc from "suncalc";

export interface SolunarPeriod {
  /** "major" = lunar transit window (~2h), "minor" = moonrise/set window (~1.5h). */
  kind: "major" | "minor";
  /** Which lunar event anchors the window. */
  event: "moon_overhead" | "moon_underfoot" | "moonrise" | "moonset";
  /** Window start, ISO UTC. */
  start: string;
  /** Event instant (window center), ISO UTC. */
  peak: string;
  /** Window end, ISO UTC. */
  end: string;
  /** True when the window overlaps dawn (sunrise ±30m) or dusk (sunset ±30m). */
  overlaps_twilight: boolean;
}

export interface SolunarRatingFactor {
  factor: string;
  points: number;
  max_points: number;
  detail: string;
}

export interface SolunarDay {
  /** Local calendar date the forecast covers. */
  date: string;
  latitude: number;
  longitude: number;
  /** IANA zone used for the day boundaries, or a fixed UTC offset derived from longitude. */
  time_basis: string;
  moon_phase: string;
  moon_illumination: number;
  /** Days since new moon within the 29.53-day cycle. */
  moon_age_days: number;
  moon_distance_km: number;
  moonrise: string | null;
  moonset: string | null;
  moon_overhead: string | null;
  moon_underfoot: string | null;
  sunrise: string | null;
  sunset: string | null;
  periods: SolunarPeriod[];
  /** 0–100 composite day quality. */
  rating: number;
  rating_label: "Poor" | "Fair" | "Good" | "Very Good" | "Excellent";
  rating_factors: SolunarRatingFactor[];
  /**
   * Predicted feeding-activity curve across the local day: 48 half-hour
   * samples, each 0–100. Sum of bumps centered on each period peak (majors
   * weighted over minors), scaled by the day rating.
   */
  hourly_activity: Array<{ time: string; activity: number }>;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LUNAR_MONTH_DAYS = 29.530588;

/** Major window: peak ±60 min. Minor window: peak ±45 min. */
const MAJOR_HALF_MS = 60 * MINUTE_MS;
const MINOR_HALF_MS = 45 * MINUTE_MS;
/** Twilight overlap window: sunrise/sunset ±30 min. */
const TWILIGHT_HALF_MS = 30 * MINUTE_MS;

const MOON_PHASE_NAMES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
] as const;

function moonPhaseName(phase: number): string {
  const normalized = ((phase % 1) + 1) % 1;
  const index = Math.round(normalized * 8) % 8;
  return MOON_PHASE_NAMES[index];
}

/** Offset of `timeZone` from UTC at `date`, in minutes (east positive). */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) parts[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / MINUTE_MS);
}

/**
 * UTC instant of local midnight opening the given calendar date.
 * With an IANA zone the offset is resolved exactly (two passes handle DST
 * transitions); without one the offset is approximated from longitude
 * (15° per hour) — the convention printed solunar tables use.
 */
export function localDayStart(
  date: string,
  longitude: number,
  timeZone?: string,
): { startMs: number; basis: string } {
  const naiveUtcMidnight = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(naiveUtcMidnight)) {
    throw new Error(`Invalid date "${date}". Use YYYY-MM-DD format.`);
  }
  if (timeZone) {
    let offset = tzOffsetMinutes(new Date(naiveUtcMidnight), timeZone);
    let startMs = naiveUtcMidnight - offset * MINUTE_MS;
    // Re-resolve once in case midnight sits across a DST transition.
    offset = tzOffsetMinutes(new Date(startMs), timeZone);
    startMs = naiveUtcMidnight - offset * MINUTE_MS;
    return { startMs, basis: timeZone };
  }
  const offsetHours = Math.round(longitude / 15);
  return {
    startMs: naiveUtcMidnight - offsetHours * HOUR_MS,
    basis: `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours} (from longitude)`,
  };
}

/**
 * Lunar transits within [startMs, startMs + 24h): scan altitude at 1-minute
 * steps and keep interior local extrema. One-minute resolution is well within
 * the precision solunar windows carry.
 */
export function findMoonTransits(
  startMs: number,
  latitude: number,
  longitude: number,
): { overhead: Date | null; underfoot: Date | null } {
  const steps = DAY_MS / MINUTE_MS;
  let prev = SunCalc.getMoonPosition(
    new Date(startMs - MINUTE_MS),
    latitude,
    longitude,
  ).altitude;
  let curr = SunCalc.getMoonPosition(
    new Date(startMs),
    latitude,
    longitude,
  ).altitude;
  let overhead: Date | null = null;
  let underfoot: Date | null = null;
  for (let i = 0; i < steps; i++) {
    const tNext = startMs + (i + 1) * MINUTE_MS;
    const next = SunCalc.getMoonPosition(
      new Date(tNext),
      latitude,
      longitude,
    ).altitude;
    if (curr > prev && curr >= next && overhead === null) {
      overhead = new Date(startMs + i * MINUTE_MS);
    } else if (curr < prev && curr <= next && underfoot === null) {
      underfoot = new Date(startMs + i * MINUTE_MS);
    }
    prev = curr;
    curr = next;
  }
  return { overhead, underfoot };
}

function within(t: number, center: number, halfWidth: number): boolean {
  return Math.abs(t - center) <= halfWidth;
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function ratingLabel(rating: number): SolunarDay["rating_label"] {
  if (rating >= 80) return "Excellent";
  if (rating >= 60) return "Very Good";
  if (rating >= 40) return "Good";
  if (rating >= 20) return "Fair";
  return "Poor";
}

export interface SolunarParams {
  date?: string;
  latitude: number;
  longitude: number;
  /** IANA zone for day boundaries and local rendering; else derived from longitude. */
  timezone?: string;
}

export class SolunarService {
  getSolunarDay(params: SolunarParams): SolunarDay {
    const date = params.date ?? new Date().toISOString().split("T")[0];
    const { latitude, longitude } = params;
    const { startMs, basis } = localDayStart(date, longitude, params.timezone);
    const endMs = startMs + DAY_MS;
    const noon = new Date(startMs + DAY_MS / 2);

    // --- Lunar events for the local day -----------------------------------
    const { overhead, underfoot } = findMoonTransits(
      startMs,
      latitude,
      longitude,
    );
    // suncalc's getMoonTimes works on the UTC day of the passed date when
    // inUTC=true; pass the local day start so rise/set land inside our day.
    const moonTimes = SunCalc.getMoonTimes(
      new Date(startMs),
      latitude,
      longitude,
      true,
    );
    const inDay = (d: Date | null | undefined): Date | null =>
      d &&
      !Number.isNaN(d.getTime()) &&
      d.getTime() >= startMs &&
      d.getTime() < endMs
        ? d
        : null;
    const moonrise = inDay(moonTimes.rise);
    const moonset = inDay(moonTimes.set);

    const sunTimes = SunCalc.getTimes(noon, latitude, longitude);
    const sunrise =
      sunTimes.sunrise && !Number.isNaN(sunTimes.sunrise.getTime())
        ? sunTimes.sunrise
        : null;
    const sunset =
      sunTimes.sunset && !Number.isNaN(sunTimes.sunset.getTime())
        ? sunTimes.sunset
        : null;

    const illumination = SunCalc.getMoonIllumination(noon);
    const moonPosition = SunCalc.getMoonPosition(noon, latitude, longitude);

    // --- Periods -----------------------------------------------------------
    const twilights: Array<[number, number]> = [];
    if (sunrise)
      twilights.push([
        sunrise.getTime() - TWILIGHT_HALF_MS,
        sunrise.getTime() + TWILIGHT_HALF_MS,
      ]);
    if (sunset)
      twilights.push([
        sunset.getTime() - TWILIGHT_HALF_MS,
        sunset.getTime() + TWILIGHT_HALF_MS,
      ]);

    const buildPeriod = (
      kind: SolunarPeriod["kind"],
      event: SolunarPeriod["event"],
      peak: Date | null,
    ): SolunarPeriod | null => {
      if (!peak) return null;
      const half = kind === "major" ? MAJOR_HALF_MS : MINOR_HALF_MS;
      const startT = peak.getTime() - half;
      const endT = peak.getTime() + half;
      return {
        kind,
        event,
        start: new Date(startT).toISOString(),
        peak: peak.toISOString(),
        end: new Date(endT).toISOString(),
        overlaps_twilight: twilights.some(([a, b]) =>
          overlaps(startT, endT, a, b),
        ),
      };
    };

    const periods = [
      buildPeriod("major", "moon_overhead", overhead),
      buildPeriod("major", "moon_underfoot", underfoot),
      buildPeriod("minor", "moonrise", moonrise),
      buildPeriod("minor", "moonset", moonset),
    ]
      .filter((p): p is SolunarPeriod => p !== null)
      .sort((a, b) => a.peak.localeCompare(b.peak));

    // --- Day rating --------------------------------------------------------
    const factors: SolunarRatingFactor[] = [];

    // Moon phase: distance (in days) to the nearest syzygy (new or full).
    const age = illumination.phase * LUNAR_MONTH_DAYS;
    const daysFromSyzygy = Math.min(
      Math.abs(illumination.phase - 0) * LUNAR_MONTH_DAYS,
      Math.abs(illumination.phase - 0.5) * LUNAR_MONTH_DAYS,
      Math.abs(illumination.phase - 1) * LUNAR_MONTH_DAYS,
    );
    const phasePoints = Math.round(40 * Math.max(0, 1 - daysFromSyzygy / 5));
    factors.push({
      factor: "moon_phase",
      points: phasePoints,
      max_points: 40,
      detail: `${moonPhaseName(illumination.phase)} — ${daysFromSyzygy.toFixed(1)} days from new/full moon (closer is better; syzygy also drives spring tides).`,
    });

    // Moon distance: perigee (~356,500 km) scores full, apogee (~406,700 km) zero.
    const distancePoints = Math.round(
      20 *
        Math.min(
          1,
          Math.max(0, (406_700 - moonPosition.distance) / (406_700 - 356_500)),
        ),
    );
    factors.push({
      factor: "moon_distance",
      points: distancePoints,
      max_points: 20,
      detail: `${Math.round(moonPosition.distance).toLocaleString()} km — nearer perigee means stronger tidal pull.`,
    });

    // Twilight overlap: any solunar window touching dawn or dusk.
    const overlapCount = periods.filter((p) => p.overlaps_twilight).length;
    const overlapPoints = Math.min(25, overlapCount * 13);
    factors.push({
      factor: "twilight_overlap",
      points: overlapPoints,
      max_points: 25,
      detail:
        overlapCount > 0
          ? `${overlapCount} solunar period(s) overlap dawn/dusk — stacked feeding triggers.`
          : "No solunar period overlaps dawn or dusk today.",
    });

    // Period completeness: both transits and both rise/set present.
    const majorCount = periods.filter((p) => p.kind === "major").length;
    const minorCount = periods.length - majorCount;
    const completenessPoints = majorCount * 5 + minorCount * 2.5;
    factors.push({
      factor: "period_count",
      points: Math.round(completenessPoints),
      max_points: 15,
      detail: `${majorCount} major and ${minorCount} minor period(s) fall within this day.`,
    });

    const rating = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          phasePoints + distancePoints + overlapPoints + completenessPoints,
        ),
      ),
    );

    // --- Activity curve (48 half-hour samples) -----------------------------
    // Cosine bumps centered on each peak; majors carry twice the weight of
    // minors; scaled so a strong day fills more of the 0-100 range.
    const dayScale = 0.5 + rating / 200; // 0.5–1.0
    const hourly_activity: SolunarDay["hourly_activity"] = [];
    for (let i = 0; i < 48; i++) {
      const t = startMs + i * 30 * MINUTE_MS;
      let activity = 0;
      for (const p of periods) {
        const half = p.kind === "major" ? MAJOR_HALF_MS : MINOR_HALF_MS;
        const weight = p.kind === "major" ? 100 : 55;
        const dt = Math.abs(t - Date.parse(p.peak));
        if (dt <= half) {
          activity += weight * (0.5 + 0.5 * Math.cos((Math.PI * dt) / half));
        }
      }
      for (const [a, b] of twilights) {
        const center = (a + b) / 2;
        if (within(t, center, HOUR_MS)) {
          activity +=
            20 * (0.5 + 0.5 * Math.cos((Math.PI * (t - center)) / HOUR_MS));
        }
      }
      hourly_activity.push({
        time: new Date(t).toISOString(),
        activity: Math.round(Math.min(100, activity * dayScale)),
      });
    }

    const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

    return {
      date,
      latitude,
      longitude,
      time_basis: basis,
      moon_phase: moonPhaseName(illumination.phase),
      moon_illumination: Math.round(illumination.fraction * 1000) / 1000,
      moon_age_days: Math.round(age * 10) / 10,
      moon_distance_km: Math.round(moonPosition.distance),
      moonrise: iso(moonrise),
      moonset: iso(moonset),
      moon_overhead: iso(overhead),
      moon_underfoot: iso(underfoot),
      sunrise: iso(sunrise),
      sunset: iso(sunset),
      periods,
      rating,
      rating_label: ratingLabel(rating),
      rating_factors: factors,
      hourly_activity,
    };
  }

  getSolunarRange(
    params: SolunarParams & { start_date: string; end_date: string },
  ): SolunarDay[] {
    const start = Date.parse(`${params.start_date}T00:00:00Z`);
    const end = Date.parse(`${params.end_date}T00:00:00Z`);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new Error("Invalid date format. Please use YYYY-MM-DD format.");
    }
    if (start > end) {
      throw new Error("Start date must be before end date.");
    }
    const days = Math.round((end - start) / DAY_MS) + 1;
    if (days > 14) {
      throw new Error(
        "Solunar range is limited to 14 days per request — narrow the window.",
      );
    }
    const out: SolunarDay[] = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(start + i * DAY_MS).toISOString().split("T")[0];
      out.push(
        this.getSolunarDay({
          date,
          latitude: params.latitude,
          longitude: params.longitude,
          timezone: params.timezone,
        }),
      );
    }
    return out;
  }
}
