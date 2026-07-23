import { describe, expect, it } from "vitest";
import { parseActiveStations, parseRealtime2 } from "../src/services/ndbc.js";
import { toDisplayUnits } from "../src/tools/buoys.js";
import { toDisplaySample } from "../src/tools/marine-conditions.js";
import { classifyPressureTrend } from "../src/tools/met.js";

const ACTIVESTATIONS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<stations created="2026-07-09T09:10:00UTC" count="3">
<station id="41013" lat="33.441" lon="-77.764" elev="0" name="Frying Pan Shoals, NC" owner="NDBC" pgm="NDBC Meteorological/Ocean" type="buoy" met="y" currents="n" waterquality="n" dart="n"/>
<station id="buzm3" lat="41.397" lon="-71.033" name="Buzzards Bay, MA &amp; environs" owner="NDBC" pgm="NDBC Meteorological/Ocean" type="fixed" met="y" currents="y" waterquality="n" dart="n"/>
<station id="badrow" name="No coordinates" type="buoy"/>
</stations>`;

const REALTIME2_TEXT = `#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 07 09 14 50 140  5.0  6.5   1.2     7   5.4 145 1015.2  28.1  29.0  24.2   MM -1.6    MM
2026 07 09 14 40 145  4.8   MM    MM    MM    MM  MM 1015.4  28.0  29.0    MM   MM   MM    MM
`;

describe("parseActiveStations", () => {
  it("parses attributes, uppercases IDs, decodes entities, skips bad rows", () => {
    const stations = parseActiveStations(ACTIVESTATIONS_XML);
    expect(stations).toHaveLength(2);
    const [buoy, cman] = stations;
    expect(buoy.id).toBe("41013");
    expect(buoy.lat).toBeCloseTo(33.441);
    expect(buoy.type).toBe("buoy");
    expect(buoy.has_met).toBe(true);
    expect(buoy.has_currents).toBe(false);
    expect(cman.id).toBe("BUZM3");
    expect(cman.name).toBe("Buzzards Bay, MA & environs");
    expect(cman.has_currents).toBe(true);
  });
});

describe("parseRealtime2", () => {
  it("maps columns by header name, nulls MM, keeps newest-first order", () => {
    const obs = parseRealtime2(REALTIME2_TEXT);
    expect(obs).toHaveLength(2);
    const [newest, older] = obs;
    expect(newest.time).toBe("2026-07-09T14:50:00.000Z");
    expect(newest.wind_dir_deg).toBe(140);
    expect(newest.wind_speed_ms).toBe(5);
    expect(newest.wind_gust_ms).toBe(6.5);
    expect(newest.wave_height_m).toBe(1.2);
    expect(newest.dominant_period_s).toBe(7);
    expect(newest.pressure_hpa).toBe(1015.2);
    expect(newest.pressure_tendency_hpa).toBe(-1.6);
    expect(newest.water_temp_c).toBe(29);
    expect(newest.visibility_nmi).toBeNull();
    expect(newest.tide_ft).toBeNull();
    expect(older.wind_gust_ms).toBeNull();
    expect(older.wave_height_m).toBeNull();
  });

  it("rejects files without a header", () => {
    expect(() => parseRealtime2("not a realtime2 file")).toThrow(
      /unexpected realtime2/,
    );
  });
});

describe("toDisplayUnits (NDBC)", () => {
  const obs = parseRealtime2(REALTIME2_TEXT)[0];

  it("converts to english units", () => {
    const d = toDisplayUnits(obs, "english");
    expect(d.wind_speed).toBeCloseTo(9.7, 1); // 5 m/s → kt
    expect(d.wave_height).toBeCloseTo(3.9, 1); // 1.2 m → ft
    expect(d.water_temp).toBeCloseTo(84.2, 1); // 29 °C → °F
    expect(d.pressure_mb).toBe(1015.2); // millibars in both systems
  });

  it("passes metric through unchanged", () => {
    const d = toDisplayUnits(obs, "metric");
    expect(d.wind_speed).toBe(5);
    expect(d.wave_height).toBe(1.2);
    expect(d.water_temp).toBe(29);
  });
});

describe("toDisplaySample (Open-Meteo)", () => {
  const sample = {
    time: "2026-07-09T14:00:00Z",
    wave_height_m: 1.5,
    wave_direction_deg: 120,
    wave_period_s: 8.2,
    wind_wave_height_m: 0.4,
    wind_wave_period_s: 3.1,
    swell_wave_height_m: 1.4,
    swell_wave_direction_deg: 110,
    swell_wave_period_s: 11,
    sea_surface_temp_c: 26,
    current_velocity_kmh: 1.8,
    current_direction_deg: 45,
  };

  it("converts to english units (currents in knots)", () => {
    const d = toDisplaySample(sample, "english");
    expect(d.wave_height).toBeCloseTo(4.9, 1);
    expect(d.sea_surface_temp).toBeCloseTo(78.8, 1);
    expect(d.current_speed).toBeCloseTo(1, 1); // 1.8 km/h ≈ 0.97 kt
  });

  it("converts metric currents to cm/s (repo convention)", () => {
    const d = toDisplaySample(sample, "metric");
    expect(d.wave_height).toBe(1.5);
    expect(d.current_speed).toBeCloseTo(50, 0); // 1.8 km/h = 50 cm/s
  });
});

describe("classifyPressureTrend", () => {
  it("classifies each band", () => {
    expect(classifyPressureTrend(null).state).toBe("unknown");
    expect(classifyPressureTrend(-3).state).toBe("falling rapidly");
    expect(classifyPressureTrend(-1).state).toBe("falling");
    expect(classifyPressureTrend(0).state).toBe("steady");
    expect(classifyPressureTrend(1).state).toBe("rising");
    expect(classifyPressureTrend(2.5).state).toBe("rising rapidly");
  });
});
