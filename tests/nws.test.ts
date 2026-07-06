import { describe, expect, it } from "vitest";
import {
  expandGridSeries,
  extractSynopsis,
  extractZoneSegment,
  lengthToMeters,
  parseIsoDurationMs,
  segmentCoversZone,
  speedToKnots,
  toCompass,
} from "../src/services/nws-api.js";

const HOUR = 3_600_000;

describe("parseIsoDurationMs", () => {
  it("parses hour, day, and mixed durations", () => {
    expect(parseIsoDurationMs("PT1H")).toBe(HOUR);
    expect(parseIsoDurationMs("PT3H")).toBe(3 * HOUR);
    expect(parseIsoDurationMs("P1D")).toBe(24 * HOUR);
    expect(parseIsoDurationMs("P1DT6H")).toBe(30 * HOUR);
    expect(parseIsoDurationMs("PT1H30M")).toBe(HOUR + 30 * 60_000);
  });

  it("falls back to one hour on garbage", () => {
    expect(parseIsoDurationMs("bogus")).toBe(HOUR);
  });
});

describe("expandGridSeries", () => {
  it("expands a multi-hour hold into one entry per hour", () => {
    const map = expandGridSeries({
      uom: "wmoUnit:km_h-1",
      values: [
        { validTime: "2026-07-05T18:00:00+00:00/PT3H", value: 20 },
        { validTime: "2026-07-05T21:00:00+00:00/PT1H", value: 28 },
      ],
    });
    const t0 = Date.parse("2026-07-05T18:00:00Z");
    expect(map.get(t0)).toBe(20);
    expect(map.get(t0 + HOUR)).toBe(20);
    expect(map.get(t0 + 2 * HOUR)).toBe(20);
    expect(map.get(t0 + 3 * HOUR)).toBe(28);
    expect(map.size).toBe(4);
  });

  it("skips null values and tolerates missing series", () => {
    expect(
      expandGridSeries({
        values: [{ validTime: "2026-07-05T18:00:00+00:00/PT2H", value: null }],
      }).size,
    ).toBe(0);
    expect(expandGridSeries(undefined).size).toBe(0);
  });
});

describe("unit conversions", () => {
  it("converts gridpoint speeds to knots by declared unit", () => {
    expect(speedToKnots(18.52, "wmoUnit:km_h-1")).toBeCloseTo(10, 5);
    expect(speedToKnots(5, "wmoUnit:m_s-1")).toBeCloseTo(9.719, 3);
    expect(speedToKnots(10, "wmoUnit:kn")).toBe(10);
    expect(speedToKnots(18.52, undefined)).toBeCloseTo(10, 5); // km/h default
  });

  it("converts lengths to meters", () => {
    expect(lengthToMeters(0.9144, "wmoUnit:m")).toBeCloseTo(0.9144);
    expect(lengthToMeters(3, "wmoUnit:ft")).toBeCloseTo(0.9144);
  });
});

describe("toCompass", () => {
  it("maps degrees to 16-point compass", () => {
    expect(toCompass(0)).toBe("N");
    expect(toCompass(90)).toBe("E");
    expect(toCompass(180)).toBe("S");
    expect(toCompass(202.5)).toBe("SSW");
    expect(toCompass(359)).toBe("N");
    expect(toCompass(-90)).toBe("W");
  });
});

// Trimmed shape of a real HGX Coastal Waters Forecast bulletin.
const CWF = `000
FZUS54 KHGX 052030
CWFHGX

Coastal Waters Forecast
National Weather Service Houston/Galveston TX

GMZ300-060900-
.SYNOPSIS...Moderate onshore flow continues through Monday.

$$

GMZ335-060900-
Galveston Bay-

.TONIGHT...South winds 10 to 15 knots. Bay waters choppy.

$$

GMZ330-350-060900-
Matagorda Bay-Coastal waters from Freeport to Matagorda Ship Channel-

.TONIGHT...Southeast winds 10 to 15 knots. Seas 2 to 3 feet.
.MONDAY...South winds 15 to 20 knots. Small craft should exercise caution.

$$

GMZ370>375-060900-
Offshore waters-

.TONIGHT...Southeast winds 15 knots. Seas 3 to 5 feet.

$$
`;

describe("segmentCoversZone", () => {
  it("matches direct zone lists and ignores the expiry token", () => {
    expect(segmentCoversZone("GMZ330-350-060900-\ntext", "GMZ350")).toBe(true);
    expect(segmentCoversZone("GMZ330-350-060900-\ntext", "GMZ335")).toBe(false);
    // 060900 expiry must not be treated as a zone number
    expect(segmentCoversZone("GMZ330-060900-\ntext", "GMZ609")).toBe(false);
  });

  it("matches UGC ranges", () => {
    expect(segmentCoversZone("GMZ370>375-060900-\ntext", "GMZ372")).toBe(true);
    expect(segmentCoversZone("GMZ370>375-060900-\ntext", "GMZ376")).toBe(false);
  });

  it("requires a matching state/format prefix", () => {
    expect(segmentCoversZone("ANZ350-060900-\ntext", "GMZ350")).toBe(false);
  });
});

describe("extractZoneSegment / extractSynopsis", () => {
  it("pulls the right segment out of a multi-zone bulletin", () => {
    const segment = extractZoneSegment(CWF, "GMZ350");
    expect(segment).toContain("Matagorda Bay");
    expect(segment).toContain("Small craft should exercise caution");
    expect(segment).not.toContain("Galveston Bay");
  });

  it("resolves zones covered by a range header", () => {
    expect(extractZoneSegment(CWF, "GMZ373")).toContain("Offshore waters");
  });

  it("returns undefined for an uncovered zone", () => {
    expect(extractZoneSegment(CWF, "GMZ999")).toBeUndefined();
  });

  it("extracts the synopsis block", () => {
    expect(extractSynopsis(CWF)).toContain("Moderate onshore flow");
  });

  it("matches mixed-case synopsis headers with body paragraphs", () => {
    const text =
      "GMZ300-061415-\n\n.Synopsis For High Island to Matagorda.\n\nLight onshore flow will persist.\n\n$$\n";
    const synopsis = extractSynopsis(text);
    expect(synopsis).toContain("Light onshore flow");
  });
});
