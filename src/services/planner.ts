/**
 * Local planning computations over tide predictions and astronomy:
 * daily activity scores with plain-English reasons, best-window detection,
 * king tide (perigean spring tide) detection, and iCalendar rendering.
 *
 * Everything here is pure computation over already-fetched data — no network.
 * Tide event times must be UTC (fetch predictions with time_zone=gmt); an
 * optional IANA timezone controls day grouping and displayed times.
 */

import SunCalc from "suncalc";
import { MoonPhaseService } from "./moon-phase-service.js";
import type { MoonPhaseInfo } from "../types/moon.js";
import type { DataApiResponse } from "./data-api.js";

export interface TideEvent {
  /** Event time (UTC). */
  time: Date;
  /** "H" for high, "L" for low. */
  type: "H" | "L";
  /** Height in the requested units above the requested datum. */
  height: number;
}

const moonService = new MoonPhaseService();

/** Parse hilo predictions fetched with time_zone=gmt into UTC tide events. */
export function parseHiloEvents(response: DataApiResponse): TideEvent[] {
  const records = response.predictions ?? [];
  const events: TideEvent[] = [];
  for (const record of records) {
    const t = record.t;
    const v = record.v;
    // NOAA labels the event kind "type" or "ty" depending on the endpoint.
    const raw =
      (record as Record<string, string | undefined>).type ?? record.ty;
    const type = raw?.trim().charAt(0).toUpperCase();
    if (!t || !v || (type !== "H" && type !== "L")) continue;
    const time = new Date(`${t.replace(" ", "T")}:00Z`);
    const height = Number(v);
    if (Number.isNaN(time.getTime()) || Number.isNaN(height)) continue;
    events.push({ time, type, height });
  }
  return events.sort((a, b) => a.time.getTime() - b.time.getTime());
}

/** YYYY-MM-DD for a UTC instant in an IANA timezone (UTC when omitted). */
export function localDateKey(time: Date, timezone?: string): string {
  if (!timezone) return time.toISOString().slice(0, 10);
  return time.toLocaleDateString("en-CA", { timeZone: timezone });
}

/** HH:MM (24h) for a UTC instant in an IANA timezone (UTC when omitted). */
export function localTimeLabel(time: Date, timezone?: string): string {
  if (!timezone) return time.toISOString().slice(11, 16);
  return time.toLocaleTimeString("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function assertValidTimezone(timezone: string): void {
  try {
    new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  } catch {
    throw new Error(
      `Invalid timezone "${timezone}". Use an IANA name like "America/New_York".`,
    );
  }
}

/** Linear-interpolated percentile (0–100) of a numeric sample. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    throw new Error("Cannot compute a percentile of an empty sample.");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.min(Math.max(p, 0), 100) / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

export const ACTIVITIES = [
  "fishing",
  "boating",
  "surf_paddle",
  "beachcombing",
  "photography",
  "general",
] as const;

export type Activity = (typeof ACTIVITIES)[number];

export interface DayWindow {
  start: string;
  end: string;
  label: string;
}

export interface DayPlan {
  date: string;
  score: number;
  rating: "excellent" | "good" | "fair" | "slow";
  reasons: string[];
  best_window: DayWindow | null;
  sunrise: string | null;
  sunset: string | null;
  moon_phase: string;
  moon_illumination: number;
  events: Array<{ time: string; type: "H" | "L"; height: number }>;
}

interface DayContext {
  date: string;
  events: TideEvent[];
  sunrise: Date | null;
  sunset: Date | null;
  moon: MoonPhaseInfo;
}

const LUNAR_MONTH = 29.53;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Days from the nearest syzygy (new or full moon); 0 = spring-tide territory. */
export function daysFromSyzygy(moonAge: number): number {
  const fromNew = Math.min(moonAge, LUNAR_MONTH - moonAge);
  const fromFull = Math.abs(moonAge - LUNAR_MONTH / 2);
  return Math.min(fromNew, fromFull);
}

function within(time: Date, start: Date | null, end: Date | null): boolean {
  return !!start && !!end && time >= start && time <= end;
}

function hoursToNearestEvent(time: Date, events: TideEvent[]): number | null {
  if (events.length === 0) return null;
  return Math.min(
    ...events.map((e) => Math.abs(e.time.getTime() - time.getTime()) / HOUR_MS),
  );
}

function windowAround(
  center: Date,
  beforeMin: number,
  afterMin: number,
  label: string,
  timezone?: string,
): DayWindow {
  return {
    start: localTimeLabel(
      new Date(center.getTime() - beforeMin * MINUTE_MS),
      timezone,
    ),
    end: localTimeLabel(
      new Date(center.getTime() + afterMin * MINUTE_MS),
      timezone,
    ),
    label,
  };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function rating(score: number): DayPlan["rating"] {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "slow";
}

/**
 * Score one day for one activity. The scoring is deliberately transparent:
 * every contribution appends a human-readable reason, so callers can show
 * WHY a day scored the way it did.
 */
function scoreDay(
  activity: Activity,
  ctx: DayContext,
  timezone?: string,
): { score: number; reasons: string[]; best_window: DayWindow | null } {
  const reasons: string[] = [];
  let score = 50;
  let bestWindow: DayWindow | null = null;

  const { events, sunrise, sunset, moon } = ctx;
  const daylightLows = events.filter(
    (e) => e.type === "L" && within(e.time, sunrise, sunset),
  );
  const daylightHighs = events.filter(
    (e) => e.type === "H" && within(e.time, sunrise, sunset),
  );
  const syzygyDays = daysFromSyzygy(moon.age);
  const highs = events.filter((e) => e.type === "H");
  const lows = events.filter((e) => e.type === "L");
  const range =
    highs.length && lows.length
      ? Math.max(...highs.map((e) => e.height)) -
        Math.min(...lows.map((e) => e.height))
      : null;

  // Moving water: fastest flow is midway between a high and a low (~2–4 h
  // from the nearest event on a semidiurnal coast).
  const movingAt = (time: Date | null): boolean => {
    if (!time) return false;
    const h = hoursToNearestEvent(time, events);
    return h !== null && h >= 1.5 && h <= 4.5;
  };

  switch (activity) {
    case "fishing": {
      if (movingAt(sunrise)) {
        score += 20;
        reasons.push("Water is moving through dawn — prime feeding window.");
        if (sunrise)
          bestWindow = windowAround(sunrise, 60, 120, "dawn bite", timezone);
      }
      if (movingAt(sunset)) {
        score += 15;
        reasons.push("Water is moving through dusk.");
        if (!bestWindow && sunset)
          bestWindow = windowAround(sunset, 120, 60, "dusk bite", timezone);
      }
      if (syzygyDays <= 2) {
        score += 15;
        reasons.push(
          `${moon.phaseName} — spring tides mean stronger flow and active feeding.`,
        );
      } else if (syzygyDays >= 5.5) {
        score -= 10;
        reasons.push("Neap-side moon — weaker tidal flow.");
      }
      if (!movingAt(sunrise) && !movingAt(sunset)) {
        score -= 15;
        reasons.push("Slack water around both dawn and dusk.");
      }
      break;
    }
    case "boating": {
      if (daylightHighs.length > 0) {
        score += 20;
        const best = daylightHighs.reduce((a, b) =>
          a.height >= b.height ? a : b,
        );
        reasons.push(
          `Daylight high tide (${best.height.toFixed(1)}) — best water under the keel for departure/return.`,
        );
        bestWindow = windowAround(
          best.time,
          90,
          90,
          "around daylight high",
          timezone,
        );
      } else {
        score -= 10;
        reasons.push("No daylight high tide — plan around mid-tide depths.");
      }
      if (syzygyDays >= 5.5) {
        score += 10;
        reasons.push("Neap tides — gentler currents in channels and inlets.");
      }
      break;
    }
    case "surf_paddle": {
      const daylightEvents = events.filter((e) =>
        within(e.time, sunrise, sunset),
      );
      if (daylightEvents.length >= 2) {
        score += 15;
        reasons.push(
          "Multiple daylight tide changes — pick your preferred stage.",
        );
      }
      if (range !== null && range >= 0) {
        // A moderate range moves water without ripping it.
        if (syzygyDays <= 2) {
          score += 5;
          reasons.push("Spring tides — bigger push, faster stage changes.");
        }
      }
      const midMorning =
        sunrise && new Date(sunrise.getTime() + 2 * 60 * MINUTE_MS);
      if (midMorning && movingAt(midMorning)) {
        score += 10;
        reasons.push("Tide is filling/draining through the morning session.");
        bestWindow = windowAround(
          midMorning,
          60,
          90,
          "morning tide push",
          timezone,
        );
      }
      break;
    }
    case "beachcombing": {
      if (daylightLows.length > 0) {
        const best = daylightLows.reduce((a, b) =>
          a.height <= b.height ? a : b,
        );
        score += 20;
        reasons.push(
          `Daylight low tide (${best.height.toFixed(1)}) exposes the flats.`,
        );
        if (best.height <= 0) {
          score += 20;
          reasons.push(
            "Negative low — tidepools and bars that rarely see air.",
          );
        }
        bestWindow = windowAround(
          best.time,
          90,
          60,
          "falling water into the low",
          timezone,
        );
      } else {
        score -= 25;
        reasons.push(
          "No daylight low tide — the water never gets out of the way.",
        );
      }
      if (syzygyDays <= 2) {
        score += 10;
        reasons.push("Spring tides — lower lows than average this week.");
      }
      break;
    }
    case "photography": {
      const goldenEvents = events.filter((e) => {
        const nearSunrise =
          sunrise &&
          Math.abs(e.time.getTime() - sunrise.getTime()) <= 1.5 * HOUR_MS;
        const nearSunset =
          sunset &&
          Math.abs(e.time.getTime() - sunset.getTime()) <= 1.5 * HOUR_MS;
        return nearSunrise || nearSunset;
      });
      if (goldenEvents.length > 0) {
        score += 20;
        const e = goldenEvents[0];
        reasons.push(
          e.type === "L"
            ? "Low tide lands in golden hour — wet sand, reflections, exposed structure."
            : "High tide lands in golden hour — clean waterlines and wave action.",
        );
        bestWindow = windowAround(e.time, 60, 60, "golden-hour tide", timezone);
      }
      if (moon.illumination >= 0.9) {
        score += 10;
        reasons.push("Near-full moon for night shots over the water.");
      }
      break;
    }
    case "general": {
      if (daylightLows.length > 0) {
        score += 15;
        reasons.push("Daylight low tide for shore access.");
        bestWindow = windowAround(
          daylightLows[0].time,
          90,
          60,
          "daylight low",
          timezone,
        );
      }
      if (daylightHighs.length > 0) {
        score += 10;
        reasons.push("Daylight high tide for on-the-water time.");
      }
      if (syzygyDays <= 2) {
        score += 5;
        reasons.push(
          `${moon.phaseName} — the most dramatic tides of the cycle.`,
        );
      }
      break;
    }
  }

  if (events.length === 0) {
    score = 0;
    reasons.push("No tide predictions for this day.");
  }

  return { score: clampScore(score), reasons, best_window: bestWindow };
}

export interface ActivityPlanParams {
  activity: Activity;
  events: TideEvent[];
  latitude: number;
  longitude: number;
  timezone?: string;
}

/** Group events into local days and score each one for the activity. */
export function computeActivityPlan(params: ActivityPlanParams): DayPlan[] {
  const { activity, events, latitude, longitude, timezone } = params;
  const byDay = new Map<string, TideEvent[]>();
  for (const event of events) {
    const key = localDateKey(event.time, timezone);
    const list = byDay.get(key) ?? [];
    list.push(event);
    byDay.set(key, list);
  }

  const plans: DayPlan[] = [];
  for (const [date, dayEvents] of [...byDay.entries()].sort()) {
    // Noon UTC of the calendar date keeps SunCalc on the right solar day
    // for all US longitudes.
    const noon = new Date(`${date}T12:00:00Z`);
    const sun = SunCalc.getTimes(noon, latitude, longitude);
    const sunrise =
      sun.sunrise && !Number.isNaN(sun.sunrise.getTime()) ? sun.sunrise : null;
    const sunset =
      sun.sunset && !Number.isNaN(sun.sunset.getTime()) ? sun.sunset : null;
    const moon = moonService.getMoonPhase({ date });
    const ctx: DayContext = { date, events: dayEvents, sunrise, sunset, moon };
    const { score, reasons, best_window } = scoreDay(activity, ctx, timezone);
    plans.push({
      date,
      score,
      rating: rating(score),
      reasons,
      best_window,
      sunrise: sunrise ? localTimeLabel(sunrise, timezone) : null,
      sunset: sunset ? localTimeLabel(sunset, timezone) : null,
      moon_phase: moon.phaseName,
      moon_illumination: Number(moon.illumination.toFixed(2)),
      events: dayEvents.map((e) => ({
        time: localTimeLabel(e.time, timezone),
        type: e.type,
        height: e.height,
      })),
    });
  }
  return plans;
}

export interface KingTideDay {
  date: string;
  highest: number;
  events: Array<{ time: string; height: number }>;
  moon_phase: string;
  moon_distance_km: number;
  perigean: boolean;
  near_syzygy: boolean;
}

export interface KingTideReport {
  threshold: number;
  percentile_used: number;
  high_count: number;
  days: KingTideDay[];
}

/** Moon closer than this is conventionally "at perigee" territory. */
const PERIGEE_DISTANCE_KM = 370_000;

/**
 * King tide detection: flag days whose predicted highs sit in the top
 * percentile of the requested span, annotated with the lunar context that
 * causes them (perigee + new/full moon = perigean spring tide).
 */
export function detectKingTides(
  events: TideEvent[],
  percentileThreshold: number,
  timezone?: string,
): KingTideReport {
  const highs = events.filter((e) => e.type === "H");
  if (highs.length === 0) {
    throw new Error(
      "No predicted high tides in the requested span — cannot detect king tides.",
    );
  }
  const threshold = percentile(
    highs.map((e) => e.height),
    percentileThreshold,
  );
  const qualifying = highs.filter((e) => e.height >= threshold);

  const byDay = new Map<string, TideEvent[]>();
  for (const event of qualifying) {
    const key = localDateKey(event.time, timezone);
    const list = byDay.get(key) ?? [];
    list.push(event);
    byDay.set(key, list);
  }

  const days: KingTideDay[] = [...byDay.entries()]
    .sort()
    .map(([date, list]) => {
      const moon = moonService.getMoonPhase({ date });
      return {
        date,
        highest: Math.max(...list.map((e) => e.height)),
        events: list.map((e) => ({
          time: localTimeLabel(e.time, timezone),
          height: e.height,
        })),
        moon_phase: moon.phaseName,
        moon_distance_km: Math.round(moon.distance),
        perigean: moon.distance <= PERIGEE_DISTANCE_KM,
        near_syzygy: daysFromSyzygy(moon.age) <= 2,
      };
    });

  return {
    threshold,
    percentile_used: percentileThreshold,
    high_count: highs.length,
    days,
  };
}

// ---------------------------------------------------------------------------
// iCalendar rendering
// ---------------------------------------------------------------------------

/** Escape per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold lines longer than 75 octets per RFC 5545 §3.1. */
export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length > 0) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

function icsUtcStamp(time: Date): string {
  return time
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export interface TideCalendarParams {
  stationId: string;
  stationName?: string;
  events: TideEvent[];
  unitsLabel: string;
  datum: string;
  includeSun?: { latitude: number; longitude: number };
  includeMoonPhases?: boolean;
  now?: Date;
}

/**
 * Render high/low tide predictions (plus optional sunrise/sunset and
 * principal moon phases) as an iCalendar feed. All times are UTC-stamped;
 * calendar clients display them in the viewer's local timezone.
 */
export function renderTideCalendarIcs(params: TideCalendarParams): string {
  const {
    stationId,
    stationName,
    events,
    unitsLabel,
    datum,
    includeSun,
    includeMoonPhases,
  } = params;
  const stamp = icsUtcStamp(params.now ?? new Date());
  const placeName = stationName ?? `Station ${stationId}`;
  const calName = `Tides — ${placeName}`;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Perigee//NOAA Tide Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    `X-WR-CALDESC:${escapeIcsText(
      `Predicted high and low tides at ${placeName} (NOAA station ${stationId}). Heights in ${unitsLabel} above ${datum}. Not for navigation.`,
    )}`,
  ];

  const pushEvent = (
    uid: string,
    start: string,
    summary: string,
    description: string,
    allDay = false,
  ): void => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@perigeetides.com`,
      `DTSTAMP:${stamp}`,
      allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      "END:VEVENT",
    );
  };

  for (const event of events) {
    const kind = event.type === "H" ? "High" : "Low";
    const arrow = event.type === "H" ? "▲" : "▼";
    const height = `${event.height.toFixed(1)} ${unitsLabel}`;
    pushEvent(
      `${stationId}-${icsUtcStamp(event.time)}-${event.type}`,
      icsUtcStamp(event.time),
      `${arrow} ${kind} tide ${height}`,
      `Predicted ${kind.toLowerCase()} tide at ${placeName}: ${height} above ${datum}. Source: NOAA CO-OPS predictions via Perigee. Not for navigation.`,
    );
  }

  if (includeSun) {
    const seen = new Set<string>();
    for (const event of events) {
      const date = event.time.toISOString().slice(0, 10);
      if (seen.has(date)) continue;
      seen.add(date);
      const sun = SunCalc.getTimes(
        new Date(`${date}T12:00:00Z`),
        includeSun.latitude,
        includeSun.longitude,
      );
      for (const [key, label] of [
        ["sunrise", "Sunrise"],
        ["sunset", "Sunset"],
      ] as const) {
        const time = sun[key];
        if (!time || Number.isNaN(time.getTime())) continue;
        pushEvent(
          `${stationId}-${icsUtcStamp(time)}-${key}`,
          icsUtcStamp(time),
          `☀ ${label}`,
          `${label} at ${placeName}.`,
        );
      }
    }
  }

  if (includeMoonPhases) {
    const seen = new Set<string>();
    for (const event of events) {
      const date = event.time.toISOString().slice(0, 10);
      if (seen.has(date)) continue;
      seen.add(date);
      const moon = moonService.getMoonPhase({ date });
      if (daysFromSyzygy(moon.age) > 0.5) continue;
      const isNew = Math.min(moon.age, LUNAR_MONTH - moon.age) <= 0.5;
      pushEvent(
        `${stationId}-${date}-moon`,
        date.replace(/-/g, ""),
        isNew ? "● New moon (spring tides)" : "○ Full moon (spring tides)",
        `${moon.phaseName}. Expect larger tide ranges (spring tides) for the next few days.`,
        true,
      );
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
