import { describe, expect, it } from "vitest";
import {
  assertSpanWithinLimit,
  normalizeDate,
  parseNoaaDate,
  resolveDateParams,
} from "../src/validation/dates.js";

describe("normalizeDate", () => {
  it("passes NOAA-native formats through", () => {
    expect(normalizeDate("20260704", "begin_date")).toBe("20260704");
    expect(normalizeDate("20260704 13:30", "begin_date")).toBe(
      "20260704 13:30",
    );
    expect(normalizeDate("07/04/2026", "begin_date")).toBe("07/04/2026");
    expect(normalizeDate("07/04/2026 13:30", "begin_date")).toBe(
      "07/04/2026 13:30",
    );
  });

  it("normalizes ISO dates to NOAA format", () => {
    expect(normalizeDate("2026-07-04", "begin_date")).toBe("20260704");
    expect(normalizeDate("2026-07-04T13:30", "begin_date")).toBe(
      "20260704 13:30",
    );
    expect(normalizeDate("2026-07-04 13:30", "begin_date")).toBe(
      "20260704 13:30",
    );
  });

  it("rejects garbage with the accepted format list", () => {
    expect(() => normalizeDate("July 4th", "begin_date")).toThrow(
      /Accepted formats/,
    );
  });
});

describe("parseNoaaDate", () => {
  it("parses yyyyMMdd and MM/dd/yyyy consistently", () => {
    expect(parseNoaaDate("20260704").toISOString()).toBe(
      "2026-07-04T00:00:00.000Z",
    );
    expect(parseNoaaDate("07/04/2026 06:30").toISOString()).toBe(
      "2026-07-04T06:30:00.000Z",
    );
  });
});

describe("resolveDateParams", () => {
  it("accepts each of the five legal combinations", () => {
    expect(resolveDateParams({ date: "today" })).toMatchObject({
      date: "today",
    });
    expect(resolveDateParams({ date: "LATEST" })).toMatchObject({
      date: "latest",
    });
    expect(
      resolveDateParams({ begin_date: "2026-07-01", end_date: "2026-07-04" }),
    ).toMatchObject({
      begin_date: "20260701",
      end_date: "20260704",
      spanDays: 3,
    });
    expect(
      resolveDateParams({ begin_date: "20260701", range: 48 }),
    ).toMatchObject({
      begin_date: "20260701",
      range: 48,
      spanDays: 2,
    });
    expect(
      resolveDateParams({ end_date: "20260704", range: 24 }),
    ).toMatchObject({
      end_date: "20260704",
      range: 24,
    });
    expect(resolveDateParams({ range: 12 })).toMatchObject({
      range: 12,
      spanDays: 0.5,
    });
  });

  it("rejects illegal combinations with actionable messages", () => {
    expect(() => resolveDateParams({})).toThrow(/Missing date parameters/);
    expect(() => resolveDateParams({ begin_date: "20260701" })).toThrow(
      /Incomplete/,
    );
    expect(() => resolveDateParams({ date: "today", range: 5 })).toThrow(
      /not both/,
    );
    expect(() =>
      resolveDateParams({
        begin_date: "20260701",
        end_date: "20260704",
        range: 4,
      }),
    ).toThrow(/not all three/);
    expect(() => resolveDateParams({ date: "2026-07-04" })).toThrow(
      /today, latest/,
    );
    expect(() =>
      resolveDateParams({ begin_date: "20260704", end_date: "20260701" }),
    ).toThrow(/after begin_date/);
  });
});

describe("assertSpanWithinLimit", () => {
  it("enforces per-product maxima", () => {
    expect(() =>
      assertSpanWithinLimit(32, "water_level", "6-minute water levels"),
    ).toThrow(/31-day maximum/);
    expect(() =>
      assertSpanWithinLimit(30, "water_level", "6-minute water levels"),
    ).not.toThrow();
    expect(() =>
      assertSpanWithinLimit(5, "one_minute_water_level", "1-minute"),
    ).toThrow(/4-day maximum/);
    expect(() =>
      assertSpanWithinLimit(400, "predictions:hilo", "hilo"),
    ).not.toThrow();
    expect(() => assertSpanWithinLimit(400, "predictions", "series")).toThrow(
      /366-day/,
    );
    expect(() => assertSpanWithinLimit(8, "currents", "currents")).toThrow(
      /7-day/,
    );
  });

  it("ignores unknown products and undefined spans", () => {
    expect(() =>
      assertSpanWithinLimit(undefined, "water_level", "x"),
    ).not.toThrow();
    expect(() =>
      assertSpanWithinLimit(999, "unknown_product", "x"),
    ).not.toThrow();
  });
});
