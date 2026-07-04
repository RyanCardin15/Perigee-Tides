import { describe, expect, it } from "vitest";
import { MoonPhaseService } from "../src/services/moon-phase-service.js";
import { SunService } from "../src/services/sun-service.js";
import { MoonPhaseName } from "../src/types/moon.js";
import { SunEventType } from "../src/types/sun.js";

describe("MoonPhaseService.getNextMoonPhase", () => {
  const service = new MoonPhaseService();

  it("finds consecutive full moons roughly one synodic month apart", () => {
    const results = service.getNextMoonPhase({
      phase: MoonPhaseName.FULL_MOON,
      date: "2026-01-01",
      count: 3,
    });
    expect(results).toHaveLength(3);
    const days = results.map((r) => new Date(r.date).getTime());
    for (let i = 1; i < days.length; i++) {
      const gap = (days[i] - days[i - 1]) / 86_400_000;
      expect(gap).toBeGreaterThan(28);
      expect(gap).toBeLessThan(31);
    }
  });

  it("handles the new-moon phase wraparound (phase ~1.0 -> 0.0)", () => {
    const results = service.getNextMoonPhase({
      phase: MoonPhaseName.NEW_MOON,
      date: "2026-01-01",
      count: 2,
    });
    expect(results).toHaveLength(2);
    const gap =
      (new Date(results[1].date).getTime() -
        new Date(results[0].date).getTime()) /
      86_400_000;
    expect(gap).toBeGreaterThan(28);
    expect(gap).toBeLessThan(31);
  });
});

describe("SunService", () => {
  const service = new SunService();

  it("returns astronomical dawn/dusk (suncalc nightEnd/night keys)", () => {
    const times = service.getSunTimes({
      date: "2026-03-15",
      latitude: 41.8,
      longitude: -71.4,
    });
    expect(times.astronomicalDawn).not.toBeNull();
    expect(times.astronomicalDusk).not.toBeNull();
  });

  it("finds the next golden hour start (regression: key mismatch bug)", () => {
    const results = service.getNextSunEvent({
      event: SunEventType.GOLDEN_HOUR_START,
      latitude: 41.8,
      longitude: -71.4,
      date: "2026-07-04",
      count: 2,
    });
    expect(results).toHaveLength(2);
    expect(results[0].date).toBeTruthy();
  });
});
