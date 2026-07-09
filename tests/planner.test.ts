import { describe, expect, it } from "vitest";
import {
  computeActivityPlan,
  daysFromSyzygy,
  detectKingTides,
  escapeIcsText,
  foldIcsLine,
  localDateKey,
  localTimeLabel,
  parseHiloEvents,
  percentile,
  renderTideCalendarIcs,
  type TideEvent,
} from "../src/services/planner.js";

function event(iso: string, type: "H" | "L", height: number): TideEvent {
  return { time: new Date(iso), type, height };
}

describe("parseHiloEvents", () => {
  it("parses gmt hilo predictions into sorted UTC events", () => {
    const events = parseHiloEvents({
      predictions: [
        { t: "2026-07-10 14:30", v: "5.20", type: "H" },
        { t: "2026-07-10 08:12", v: "0.31", type: "L" },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("L");
    expect(events[0].time.toISOString()).toBe("2026-07-10T08:12:00.000Z");
    expect(events[1].height).toBeCloseTo(5.2);
  });

  it('accepts the "ty" field variant NOAA uses on some endpoints', () => {
    const events = parseHiloEvents({
      predictions: [{ t: "2026-07-10 14:30", v: "5.20", ty: "HH" }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("H");
  });

  it("skips malformed records instead of throwing", () => {
    const events = parseHiloEvents({
      predictions: [
        { t: "2026-07-10 14:30", v: "not-a-number", type: "H" },
        { t: "2026-07-10 15:30", v: "4.1", type: "X" as "H" },
        { t: "2026-07-10 16:30", v: "4.1", type: "H" },
      ],
    });
    expect(events).toHaveLength(1);
  });
});

describe("timezone helpers", () => {
  const t = new Date("2026-07-10T03:30:00Z"); // 11:30 PM July 9 in New York

  it("groups by the local calendar day when a timezone is given", () => {
    expect(localDateKey(t)).toBe("2026-07-10");
    expect(localDateKey(t, "America/New_York")).toBe("2026-07-09");
  });

  it("formats local times", () => {
    expect(localTimeLabel(t)).toBe("03:30");
    expect(localTimeLabel(t, "America/New_York")).toBe("23:30");
  });
});

describe("percentile", () => {
  it("interpolates linearly", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5);
    expect(percentile([10], 98)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
  });

  it("throws on an empty sample", () => {
    expect(() => percentile([], 98)).toThrow(/empty/);
  });
});

describe("daysFromSyzygy", () => {
  it("is zero at new and full moon and maximal near quarters", () => {
    expect(daysFromSyzygy(0)).toBe(0);
    expect(daysFromSyzygy(29.53)).toBeCloseTo(0);
    expect(daysFromSyzygy(29.53 / 2)).toBeCloseTo(0);
    expect(daysFromSyzygy(29.53 / 4)).toBeCloseTo(29.53 / 4);
  });
});

describe("detectKingTides", () => {
  // 30 days of two highs/two lows; one perigean-spring day towers above.
  const events: TideEvent[] = [];
  for (let day = 1; day <= 30; day++) {
    const d = String(day).padStart(2, "0");
    const boost = day === 14 ? 1.5 : 0; // July 14 2026 ≈ new moon
    events.push(
      event(`2026-07-${d}T02:00:00Z`, "L", 0.4),
      event(`2026-07-${d}T08:00:00Z`, "H", 4.8 + boost),
      event(`2026-07-${d}T14:00:00Z`, "L", 0.9),
      event(`2026-07-${d}T20:30:00Z`, "H", 5.4 + boost),
    );
  }

  it("flags only the top-percentile high days and annotates the moon", () => {
    const report = detectKingTides(events, 98);
    expect(report.high_count).toBe(60);
    expect(report.days).toHaveLength(1);
    const day = report.days[0];
    expect(day.date).toBe("2026-07-14");
    expect(day.highest).toBeCloseTo(6.9);
    expect(day.near_syzygy).toBe(true);
    expect(day.moon_distance_km).toBeGreaterThan(300_000);
  });

  it("throws when there are no highs to rank", () => {
    expect(() =>
      detectKingTides([event("2026-07-10T02:00:00Z", "L", 0.2)], 98),
    ).toThrow(/high tides/);
  });
});

describe("computeActivityPlan", () => {
  // San Francisco (9414290): lat 37.806, lon -122.466. Mid-July sunrise
  // ≈ 13:00 UTC, sunset ≈ 03:30 UTC (next day).
  const lat = 37.806;
  const lon = -122.466;

  it("rewards beachcombing days with a daylight negative low", () => {
    const good = computeActivityPlan({
      activity: "beachcombing",
      events: [
        event("2026-07-10T16:00:00Z", "L", -0.4), // 9 AM local, daylight
        event("2026-07-10T22:30:00Z", "H", 5.1),
      ],
      latitude: lat,
      longitude: lon,
      timezone: "America/Los_Angeles",
    });
    const bad = computeActivityPlan({
      activity: "beachcombing",
      events: [
        event("2026-07-10T09:00:00Z", "L", 0.8), // 2 AM local, dark
        event("2026-07-10T22:30:00Z", "H", 5.1),
      ],
      latitude: lat,
      longitude: lon,
      timezone: "America/Los_Angeles",
    });
    expect(good[0].score).toBeGreaterThan(bad[0].score);
    expect(good[0].best_window).not.toBeNull();
    expect(good[0].reasons.join(" ")).toMatch(/Negative low/);
    expect(bad[0].reasons.join(" ")).toMatch(/No daylight low/);
  });

  it("groups events into local days and reports sun/moon context", () => {
    const plans = computeActivityPlan({
      activity: "general",
      events: [
        event("2026-07-10T16:00:00Z", "L", 0.5),
        event("2026-07-11T04:30:00Z", "H", 5.0), // 9:30 PM July 10 local
        event("2026-07-11T17:00:00Z", "L", 0.3),
      ],
      latitude: lat,
      longitude: lon,
      timezone: "America/Los_Angeles",
    });
    expect(plans.map((p) => p.date)).toEqual(["2026-07-10", "2026-07-11"]);
    expect(plans[0].events).toHaveLength(2);
    expect(plans[0].sunrise).toMatch(/^\d{2}:\d{2}$/);
    expect(plans[0].moon_phase).toBeTruthy();
    for (const plan of plans) {
      expect(plan.score).toBeGreaterThanOrEqual(0);
      expect(plan.score).toBeLessThanOrEqual(100);
      expect(["excellent", "good", "fair", "slow"]).toContain(plan.rating);
    }
  });

  it("scores a fishing day with dawn moving water above a slack dawn", () => {
    // Sunrise SF mid-July ≈ 12:55 UTC. Nearest event 3 h away = moving water.
    const moving = computeActivityPlan({
      activity: "fishing",
      events: [
        event("2026-07-10T10:00:00Z", "L", 0.5),
        event("2026-07-10T16:00:00Z", "H", 4.9),
      ],
      latitude: lat,
      longitude: lon,
    });
    // High tide right at sunrise = slack water at dawn.
    const slack = computeActivityPlan({
      activity: "fishing",
      events: [
        event("2026-07-10T12:55:00Z", "H", 4.9),
        event("2026-07-10T19:00:00Z", "L", 0.5),
      ],
      latitude: lat,
      longitude: lon,
    });
    expect(moving[0].score).toBeGreaterThan(slack[0].score);
    expect(moving[0].best_window?.label).toBe("dawn bite");
  });
});

describe("ICS rendering", () => {
  it("escapes RFC 5545 special characters", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("folds long lines at 75 octets with continuation spaces", () => {
    const folded = foldIcsLine(`SUMMARY:${"x".repeat(200)}`);
    const lines = folded.split("\r\n");
    expect(lines[0].length).toBe(75);
    for (const line of lines.slice(1)) {
      expect(line.startsWith(" ")).toBe(true);
      expect(line.length).toBeLessThanOrEqual(75);
    }
    expect(folded.split("\r\n ").join("")).toBe(`SUMMARY:${"x".repeat(200)}`);
  });

  it("renders a valid calendar with tide, sun, and moon events", () => {
    const ics = renderTideCalendarIcs({
      stationId: "9414290",
      stationName: "San Francisco",
      events: [
        event("2026-07-10T08:12:00Z", "L", 0.31),
        event("2026-07-10T14:30:00Z", "H", 5.2),
      ],
      unitsLabel: "feet",
      datum: "MLLW",
      includeSun: { latitude: 37.806, longitude: -122.466 },
      includeMoonPhases: true,
      now: new Date("2026-07-09T00:00:00Z"),
    });
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("DTSTART:20260710T143000Z");
    expect(ics).toContain("High tide 5.2 feet");
    expect(ics).toContain("UID:9414290-20260710T143000Z-H@perigeetides.com");
    expect(ics).toContain("☀ Sunrise");
    // Every content line stays within the 75-octet fold limit.
    for (const line of ics.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    // Balanced event blocks.
    const begins = ics.match(/BEGIN:VEVENT/g)?.length ?? 0;
    const ends = ics.match(/END:VEVENT/g)?.length ?? 0;
    expect(begins).toBe(ends);
    expect(begins).toBeGreaterThanOrEqual(4); // 2 tides + sunrise + sunset
  });

  it("emits all-day new/full moon markers only near syzygy", () => {
    // 2026-07-14 is a new moon; 2026-07-10 is not.
    const nearNew = renderTideCalendarIcs({
      stationId: "9414290",
      events: [event("2026-07-14T08:00:00Z", "H", 5.0)],
      unitsLabel: "feet",
      datum: "MLLW",
      includeMoonPhases: true,
      now: new Date("2026-07-01T00:00:00Z"),
    });
    const farFromNew = renderTideCalendarIcs({
      stationId: "9414290",
      events: [event("2026-07-10T08:00:00Z", "H", 5.0)],
      unitsLabel: "feet",
      datum: "MLLW",
      includeMoonPhases: true,
      now: new Date("2026-07-01T00:00:00Z"),
    });
    expect(nearNew).toContain("DTSTART;VALUE=DATE:20260714");
    expect(nearNew).toContain("New moon");
    expect(farFromNew).not.toContain("moon");
  });
});
