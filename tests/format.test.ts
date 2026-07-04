import { describe, expect, it } from "vitest";
import { markdownTable, respond, respondError } from "../src/format/respond.js";
import { unitLabel } from "../src/format/units.js";
import { CHARACTER_LIMIT } from "../src/constants.js";

describe("unitLabel", () => {
  it("handles the asymmetric metric cases", () => {
    expect(unitLabel("wind", "english")).toBe("knots");
    expect(unitLabel("wind", "metric")).toBe("m/s");
    expect(unitLabel("currents", "english")).toBe("knots");
    expect(unitLabel("currents", "metric")).toBe("cm/s");
    expect(unitLabel("air_pressure", "metric")).toBe("millibars");
    expect(unitLabel("salinity", "metric")).toBe("PSU");
    expect(unitLabel("water_level", "metric")).toBe("meters");
    expect(unitLabel("visibility", "english")).toBe("nautical miles");
  });
});

describe("markdownTable", () => {
  it("renders rows and dashes for empty cells", () => {
    const table = markdownTable(
      ["A", "B"],
      [
        ["x", null],
        [1, "y"],
      ],
    );
    expect(table).toContain("| A | B |");
    expect(table).toContain("| x | — |");
    expect(table).toContain("| 1 | y |");
  });
});

describe("respond", () => {
  it("returns markdown text with structured content attached", () => {
    const result = respond("markdown", { a: 1 }, "# Hello");
    expect(result.content[0].text).toBe("# Hello");
    expect(result.structuredContent).toEqual({ a: 1 });
    expect(result.isError).toBeUndefined();
  });

  it("returns pretty JSON in json mode", () => {
    const result = respond("json", { a: 1 }, "# ignored");
    expect(JSON.parse(result.content[0].text)).toEqual({ a: 1 });
  });

  it("truncates oversized responses with guidance", () => {
    const huge = "x".repeat(CHARACTER_LIMIT + 500);
    const result = respond("markdown", {}, huge);
    expect(result.content[0].text.length).toBeLessThan(CHARACTER_LIMIT + 200);
    expect(result.content[0].text).toContain("truncated");
  });
});

describe("respondError", () => {
  it("flags errors and preserves the message", () => {
    const result = respondError(new Error("boom"));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: boom");
  });
});
