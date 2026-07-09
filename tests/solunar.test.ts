import { describe, expect, it } from "vitest";
import {
  findMoonTransits,
  localDayStart,
  SolunarService,
  tzOffsetMinutes,
} from "../src/services/solunar-service.js";
import { activitySparkline } from "../src/tools/solunar.js";

const CAPE_COD = { latitude: 41.67, longitude: -70.2 };

describe("localDayStart", () => {
  it("resolves IANA-zone midnight to the right UTC instant (EDT)", () => {
    const { startMs, basis } = localDayStart(
      "2026-07-09",
      CAPE_COD.longitude,
      "America/New_York",
    );
    // 2026-07-09 is in daylight time: midnight local = 04:00Z.
    expect(new Date(startMs).toISOString()).toBe("2026-07-09T04:00:00.000Z");
    expect(basis).toBe("America/New_York");
  });

  it("falls back to a longitude-derived fixed offset", () => {
    const { startMs, basis } = localDayStart("2026-07-09", -70.2);
    // -70.2° / 15 ≈ -5 → midnight local = 05:00Z.
    expect(new Date(startMs).toISOString()).toBe("2026-07-09T05:00:00.000Z");
    expect(basis).toContain("UTC-5");
  });

  it("rejects malformed dates", () => {
    expect(() => localDayStart("07/09/2026", 0)).toThrow(/Invalid date/);
  });
});

describe("tzOffsetMinutes", () => {
  it("matches known offsets across DST", () => {
    expect(
      tzOffsetMinutes(new Date("2026-07-09T12:00:00Z"), "America/New_York"),
    ).toBe(-240);
    expect(
      tzOffsetMinutes(new Date("2026-01-09T12:00:00Z"), "America/New_York"),
    ).toBe(-300);
  });
});

describe("findMoonTransits", () => {
  it("finds an overhead and underfoot transit ~12.4h apart", () => {
    const dayStart = Date.parse("2026-07-09T04:00:00Z");
    const { overhead, underfoot } = findMoonTransits(
      dayStart,
      CAPE_COD.latitude,
      CAPE_COD.longitude,
    );
    // Both usually exist on any given day; require at least one and check
    // spacing when both are present.
    expect(overhead ?? underfoot).not.toBeNull();
    if (overhead && underfoot) {
      const gapHours =
        Math.abs(overhead.getTime() - underfoot.getTime()) / 3_600_000;
      expect(gapHours).toBeGreaterThan(10.5);
      expect(gapHours).toBeLessThan(14.5);
    }
  });
});

describe("SolunarService", () => {
  const service = new SolunarService();

  it("produces a complete, internally consistent day forecast", () => {
    const day = service.getSolunarDay({
      date: "2026-07-09",
      ...CAPE_COD,
      timezone: "America/New_York",
    });
    expect(day.date).toBe("2026-07-09");
    expect(day.rating).toBeGreaterThanOrEqual(0);
    expect(day.rating).toBeLessThanOrEqual(100);
    expect(day.hourly_activity).toHaveLength(48);
    for (const sample of day.hourly_activity) {
      expect(sample.activity).toBeGreaterThanOrEqual(0);
      expect(sample.activity).toBeLessThanOrEqual(100);
    }
    // Rating factors add up to the rating (within rounding).
    const sum = day.rating_factors.reduce((acc, f) => acc + f.points, 0);
    expect(Math.abs(sum - day.rating)).toBeLessThanOrEqual(2);
    // Periods are sorted and majors span 2h, minors 1.5h.
    const peaks = day.periods.map((p) => p.peak);
    expect([...peaks].sort()).toEqual(peaks);
    for (const p of day.periods) {
      const span = Date.parse(p.end) - Date.parse(p.start);
      expect(span).toBe(p.kind === "major" ? 2 * 3_600_000 : 1.5 * 3_600_000);
      const mid = (Date.parse(p.end) + Date.parse(p.start)) / 2;
      expect(Math.abs(mid - Date.parse(p.peak))).toBeLessThan(1000);
    }
    // Every period peak falls inside the local day.
    const dayStart = Date.parse("2026-07-09T04:00:00Z");
    for (const p of day.periods) {
      expect(Date.parse(p.peak)).toBeGreaterThanOrEqual(dayStart);
      expect(Date.parse(p.peak)).toBeLessThan(dayStart + 24 * 3_600_000);
    }
  });

  it("rates syzygy days above quarter-moon days", () => {
    // 2026-06-24 ≈ full moon; 2026-07-01 ≈ first/last quarter week.
    // Use phase distance directly: find within July 2026 the best and worst
    // days and assert ordering is driven by the phase factor.
    const range = service.getSolunarRange({
      start_date: "2026-06-20",
      end_date: "2026-07-03",
      ...CAPE_COD,
    });
    const phasePoints = (d: (typeof range)[number]) =>
      d.rating_factors.find((f) => f.factor === "moon_phase")!.points;
    const newOrFull = range.filter(
      (d) => d.moon_phase === "Full Moon" || d.moon_phase === "New Moon",
    );
    const quarters = range.filter(
      (d) =>
        d.moon_phase === "First Quarter" || d.moon_phase === "Last Quarter",
    );
    expect(newOrFull.length).toBeGreaterThan(0);
    expect(quarters.length).toBeGreaterThan(0);
    const minSyzygy = Math.min(...newOrFull.map(phasePoints));
    const maxQuarter = Math.max(...quarters.map(phasePoints));
    expect(minSyzygy).toBeGreaterThan(maxQuarter);
  });

  it("caps ranges at 14 days and validates order", () => {
    expect(() =>
      service.getSolunarRange({
        start_date: "2026-07-01",
        end_date: "2026-07-31",
        ...CAPE_COD,
      }),
    ).toThrow(/14 days/);
    expect(() =>
      service.getSolunarRange({
        start_date: "2026-07-09",
        end_date: "2026-07-01",
        ...CAPE_COD,
      }),
    ).toThrow(/before/);
  });
});

describe("activitySparkline", () => {
  it("renders one block per half-hour sample", () => {
    const service = new SolunarService();
    const day = service.getSolunarDay({ date: "2026-07-09", ...CAPE_COD });
    const spark = activitySparkline(day);
    expect([...spark]).toHaveLength(48);
  });
});
