/**
 * Perigee Charts — the iframe side of the MCP app.
 *
 * One template serves every visualization-bearing tool: the host delivers the
 * tool's CallToolResult via ui/notifications/tool-result, and this module
 * dispatches on `structuredContent.viz.kind`:
 *   tide_curve       noaa_get_tide_predictions
 *   solunar          astro_get_solunar_forecast
 *   buoy_obs         ndbc_get_buoy_observations
 *   marine_forecast  openmeteo_get_marine_forecast
 *
 * Time handling: series that arrive in station-local time (tides) or a
 * chosen display zone (solunar) are mapped to "display epochs" — the wall
 * time re-labeled as UTC — so all axis math runs on plain numbers and labels
 * are formatted with UTC accessors. Truly-UTC series (buoy, marine) stay UTC.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { Chart, Panel, Pt, formatTick } from "./chart.js";

interface VizMeta {
  kind: string;
  timezone?: string;
}

type Structured = Record<string, unknown> & { viz?: VizMeta };

const rootEl = (): HTMLElement => {
  const node = document.getElementById("app");
  if (!node) throw new Error("missing #app");
  return node;
};

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** Offset of an IANA zone from UTC at `date`, in ms. */
function tzOffsetMs(date: Date, timeZone: string): number {
  try {
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
    for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
    return asUtc - date.getTime();
  } catch {
    return 0;
  }
}

function fmtHm(x: number): string {
  const d = new Date(x);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

function fmtDay(x: number): string {
  const d = new Date(x);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function makeFmtX(domain: [number, number]): (x: number) => string {
  return (x) => (domain[1] - domain[0] > 36 * HOUR ? fmtDay(x) : fmtHm(x));
}

function fmtXLong(x: number): string {
  return `${fmtDay(x)} ${fmtHm(x)}`;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function div(className: string, text?: string): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function header(title: string, subtitle?: string): HTMLElement {
  const head = div("pt-header");
  head.appendChild(div("pt-title", title));
  if (subtitle) head.appendChild(div("pt-subtitle", subtitle));
  return head;
}

interface Tile {
  label: string;
  value: string;
  delta?: { text: string; dir: "up" | "down" | "flat" };
}

function tileRow(tiles: Tile[]): HTMLElement {
  const row = div("pt-tiles");
  for (const t of tiles) {
    const tile = div("pt-tile");
    tile.appendChild(div("pt-tile-label", t.label));
    tile.appendChild(div("pt-tile-value", t.value));
    if (t.delta) {
      const delta = div(
        `pt-tile-delta pt-delta-${t.delta.dir}`,
        `${t.delta.dir === "up" ? "▲" : t.delta.dir === "down" ? "▼" : "◆"} ${t.delta.text}`,
      );
      tile.appendChild(delta);
    }
    row.appendChild(tile);
  }
  return row;
}

/** Filter-chip row; returns the container. `onPick` re-renders content. */
function chipRow<T>(
  options: Array<{ label: string; value: T }>,
  initial: number,
  onPick: (value: T) => void,
): HTMLElement {
  const row = div("pt-chips");
  const buttons: HTMLButtonElement[] = [];
  options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "pt-chip";
    btn.type = "button";
    btn.textContent = opt.label;
    if (i === initial) btn.classList.add("pt-chip-active");
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("pt-chip-active"));
      btn.classList.add("pt-chip-active");
      onPick(opt.value);
    });
    buttons.push(btn);
    row.appendChild(btn);
  });
  return row;
}

function noteEl(text: string): HTMLElement {
  return div("pt-note", text);
}

function pickLatest<T>(
  rows: T[],
  get: (row: T) => number | null,
): number | null {
  for (const row of rows) {
    const v = get(row);
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

interface TidePrediction {
  t: string;
  v: string | number;
  type?: string;
  ty?: string;
}

/** Station-local "YYYY-MM-DD HH:mm[:ss]" → display epoch (wall time as UTC). */
function parseLocal(t: string): number {
  const iso = t.replace(" ", "T");
  return Date.parse(iso.length === 16 ? `${iso}:00Z` : `${iso}Z`);
}

function renderTide(container: HTMLElement, s: Structured): void {
  const predictions = (s.predictions as TidePrediction[]) ?? [];
  const isHilo = s.interval === "hilo";
  const events = predictions
    .map((p) => ({
      x: parseLocal(p.t),
      y: Number(p.v),
      type: (p.type ?? p.ty ?? "").trim().toUpperCase(),
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
  if (events.length === 0) {
    container.appendChild(noteEl("No predictions to chart."));
    return;
  }

  // hilo mode: reconstruct the curve with cosine interpolation between
  // consecutive extremes (the standard rendering of tide tables).
  let curve: Pt[];
  if (isHilo && events.length >= 2) {
    curve = [];
    for (let i = 0; i < events.length - 1; i++) {
      const a = events[i];
      const b = events[i + 1];
      const steps = Math.max(2, Math.round((b.x - a.x) / (10 * MINUTE)));
      for (let k = 0; k < steps; k++) {
        const f = k / steps;
        curve.push({
          x: a.x + (b.x - a.x) * f,
          y: a.y + ((b.y - a.y) * (1 - Math.cos(Math.PI * f))) / 2,
        });
      }
    }
    curve.push({
      x: events[events.length - 1].x,
      y: events[events.length - 1].y,
    });
  } else {
    curve = events.map((e) => ({ x: e.x, y: e.y }));
  }

  const unitsLabel = String(s.units_label ?? "");
  const stationName = s.station_name ? ` — ${s.station_name}` : "";
  container.appendChild(
    header(
      `Tide Predictions · Station ${String(s.station ?? "")}${stationName}`,
      `${unitsLabel} · ${String(s.time_zone ?? "")} · astronomical predictions only (no weather effects)`,
    ),
  );

  const fullDomain: [number, number] = [curve[0].x, curve[curve.length - 1].x];
  const spanHours = (fullDomain[1] - fullDomain[0]) / HOUR;
  const chartHost = div("pt-chart-host");

  const draw = (domain: [number, number]) => {
    chartHost.textContent = "";
    new Chart(chartHost, {
      xDomain: domain,
      fmtX: makeFmtX(domain),
      fmtXLong,
      now: s.time_zone === "gmt" ? Date.now() : undefined,
      panels: [
        {
          unit: unitsLabel,
          series: [
            {
              label: "Predicted height",
              color: "--s1",
              points: curve,
              area: true,
            },
          ],
          markers: isHilo
            ? events
                .filter((e) => e.x >= domain[0] && e.x <= domain[1])
                .map((e) => ({
                  x: e.x,
                  y: e.y,
                  color: e.type.startsWith("H") ? "--s1" : "--s2",
                  label: `${e.type.startsWith("H") ? "High" : "Low"} ${formatTick(e.y)}`,
                  sub: fmtHm(e.x),
                }))
            : undefined,
          height: 240,
          includeZero: true,
        },
      ],
    });
  };

  if (spanHours > 30) {
    const allPresets: Array<{ label: string; value: [number, number] }> = [
      { label: "24h", value: [fullDomain[0], fullDomain[0] + 24 * HOUR] },
      { label: "3d", value: [fullDomain[0], fullDomain[0] + 72 * HOUR] },
      { label: "All", value: fullDomain },
    ];
    const presets = allPresets.filter(
      (p) => p.value[1] <= fullDomain[1] + 12 * HOUR,
    );
    container.appendChild(
      chipRow(presets, presets.length - 1, (domain) => draw(domain)),
    );
  }
  container.appendChild(chartHost);
  draw(fullDomain);
}

// --- Solunar ----------------------------------------------------------------

interface SolunarPeriodJson {
  kind: "major" | "minor";
  event: string;
  start: string;
  peak: string;
  end: string;
  overlaps_twilight: boolean;
}

interface SolunarDayJson {
  date: string;
  time_basis: string;
  moon_phase: string;
  moon_illumination: number;
  sunrise: string | null;
  sunset: string | null;
  moonrise: string | null;
  moonset: string | null;
  rating: number;
  rating_label: string;
  periods: SolunarPeriodJson[];
  hourly_activity: Array<{ time: string; activity: number }>;
}

function renderSolunar(container: HTMLElement, s: Structured): void {
  const days = (s.days as SolunarDayJson[]) ?? [];
  if (days.length === 0) {
    container.appendChild(noteEl("No solunar data to chart."));
    return;
  }
  const timezone = s.viz?.timezone;
  const basis = days[0].time_basis;
  // Display epoch: wall time in the display zone, re-labeled as UTC.
  const fixedOffsetMatch = basis.match(/^UTC([+-]\d+)/);
  const toDisplay = (iso: string): number => {
    const t = Date.parse(iso);
    if (timezone) return t + tzOffsetMs(new Date(t), timezone);
    if (fixedOffsetMatch) return t + Number(fixedOffsetMatch[1]) * HOUR;
    return t;
  };
  const nowDisplay = () =>
    timezone
      ? Date.now() + tzOffsetMs(new Date(), timezone)
      : fixedOffsetMatch
        ? Date.now() + Number(fixedOffsetMatch[1]) * HOUR
        : Date.now();

  container.appendChild(
    header(
      "Solunar Fishing Forecast",
      `${String(s.count ?? days.length)} day(s) · times in ${timezone ?? basis} · heuristic — weigh against tide, wind, and pressure`,
    ),
  );

  const body = div("pt-solunar-body");

  const drawDay = (day: SolunarDayJson) => {
    body.textContent = "";
    body.appendChild(
      tileRow([
        { label: "Day rating", value: `${day.rating}/100` },
        { label: "Outlook", value: day.rating_label },
        {
          label: "Moon",
          value: `${day.moon_phase}`,
        },
        {
          label: "Illumination",
          value: `${Math.round(day.moon_illumination * 100)}%`,
        },
      ]),
    );

    const activity: Pt[] = day.hourly_activity.map((a) => ({
      x: toDisplay(a.time),
      y: a.activity,
    }));
    if (activity.length === 0) return;
    const domain: [number, number] = [
      activity[0].x,
      activity[activity.length - 1].x,
    ];

    const markers = [];
    if (day.sunrise)
      markers.push({
        x: toDisplay(day.sunrise),
        y: 6,
        color: "--s3",
        label: "Sunrise",
        sub: fmtHm(toDisplay(day.sunrise)),
      });
    if (day.sunset)
      markers.push({
        x: toDisplay(day.sunset),
        y: 6,
        color: "--s3",
        label: "Sunset",
        sub: fmtHm(toDisplay(day.sunset)),
      });

    const chartHost = div("pt-chart-host");
    body.appendChild(chartHost);
    new Chart(chartHost, {
      xDomain: domain,
      fmtX: fmtHm,
      fmtXLong,
      now: nowDisplay(),
      panels: [
        {
          title: `Predicted feeding activity — ${day.date}`,
          unit: "0-100",
          series: [
            {
              label: "Activity",
              color: "--s1",
              points: activity,
              area: true,
              fmt: (v) => String(Math.round(v)),
            },
          ],
          bands: day.periods.map((p) => ({
            x0: toDisplay(p.start),
            x1: toDisplay(p.end),
            color: p.kind === "major" ? "--s1" : "--s2",
          })),
          markers,
          yDomain: [0, 108],
          height: 200,
        },
      ],
    });

    const legend = div("pt-band-legend");
    for (const [color, label] of [
      ["--s1", "major period (moon overhead/underfoot)"],
      ["--s2", "minor period (moonrise/moonset)"],
    ] as const) {
      const item = div("pt-legend-item");
      const key = document.createElement("span");
      key.className = "pt-legend-key pt-legend-band";
      key.style.background = `var(${color})`;
      item.appendChild(key);
      item.appendChild(document.createTextNode(label));
      legend.appendChild(item);
    }
    body.appendChild(legend);

    const list = div("pt-period-list");
    for (const p of day.periods) {
      const row = div("pt-period-row");
      row.appendChild(
        div(
          `pt-period-kind pt-period-${p.kind}`,
          p.kind === "major" ? "MAJOR" : "minor",
        ),
      );
      row.appendChild(
        div(
          "pt-period-time",
          `${fmtHm(toDisplay(p.start))} – ${fmtHm(toDisplay(p.end))}`,
        ),
      );
      row.appendChild(
        div(
          "pt-period-event",
          p.event.replace(/_/g, " ") +
            (p.overlaps_twilight ? " · overlaps dawn/dusk ✳" : ""),
        ),
      );
      list.appendChild(row);
    }
    body.appendChild(list);
  };

  if (days.length > 1) {
    container.appendChild(
      chipRow(
        days.map((d) => ({ label: d.date.slice(5), value: d })),
        0,
        drawDay,
      ),
    );
  }
  container.appendChild(body);
  drawDay(days[0]);
}

// --- Buoy observations -------------------------------------------------------

interface BuoyObsJson {
  time: string;
  wind_dir_deg: number | null;
  wind_speed: number | null;
  wind_gust: number | null;
  wave_height: number | null;
  dominant_period_s: number | null;
  pressure_mb: number | null;
  pressure_tendency_mb: number | null;
  air_temp: number | null;
  water_temp: number | null;
}

function renderBuoy(container: HTMLElement, s: Structured): void {
  const obs = ((s.observations as BuoyObsJson[]) ?? []).slice().reverse(); // newest-first → chronological
  if (obs.length === 0) {
    container.appendChild(noteEl("No observations to chart."));
    return;
  }
  const labels = (s.unit_labels ?? {}) as Record<string, string>;
  const station = s.station as { name?: string } | undefined;
  container.appendChild(
    header(
      `Buoy ${String(s.station_id ?? "")}${station?.name ? ` — ${station.name}` : ""}`,
      `NDBC realtime observations · times UTC`,
    ),
  );

  const latest = obs[obs.length - 1];
  const newestFirst = [...obs].reverse();
  const tendency = pickLatest(newestFirst, (o) => o.pressure_tendency_mb);
  container.appendChild(
    tileRow([
      {
        label: `Wind (${labels.wind ?? ""})`,
        value: `${pickLatest(newestFirst, (o) => o.wind_speed) ?? "—"}`,
      },
      {
        label: `Waves (${labels.waves ?? ""})`,
        value: `${pickLatest(newestFirst, (o) => o.wave_height) ?? "—"}`,
      },
      {
        label: `Water (${labels.temperature ?? ""})`,
        value: `${pickLatest(newestFirst, (o) => o.water_temp) ?? "—"}`,
      },
      {
        label: "Pressure (mb)",
        value: `${pickLatest(newestFirst, (o) => o.pressure_mb) ?? "—"}`,
        delta:
          tendency === null
            ? undefined
            : {
                text: `${tendency > 0 ? "+" : ""}${tendency} mb/3h`,
                dir: tendency > 0.5 ? "up" : tendency < -0.5 ? "down" : "flat",
              },
      },
    ]),
  );

  const toPoints = (get: (o: BuoyObsJson) => number | null): Pt[] =>
    obs.map((o) => ({ x: Date.parse(o.time), y: get(o) }));

  const fullDomain: [number, number] = [
    Date.parse(obs[0].time),
    Date.parse(latest.time),
  ];

  const chartHost = div("pt-chart-host");
  const draw = (domain: [number, number]) => {
    chartHost.textContent = "";
    const panels: Panel[] = [];
    const windSpeed = toPoints((o) => o.wind_speed);
    const windGust = toPoints((o) => o.wind_gust);
    if (windSpeed.some((p) => p.y !== null)) {
      panels.push({
        title: "Wind",
        unit: labels.wind,
        series: [
          { label: "Speed", color: "--s1", points: windSpeed, area: true },
          { label: "Gust", color: "--s2", points: windGust, dashed: true },
        ],
        includeZero: true,
      });
    }
    const waves = toPoints((o) => o.wave_height);
    if (waves.some((p) => p.y !== null)) {
      panels.push({
        title: "Significant wave height",
        unit: labels.waves,
        series: [{ label: "Waves", color: "--s1", points: waves, area: true }],
        includeZero: true,
      });
    }
    const pressure = toPoints((o) => o.pressure_mb);
    if (pressure.some((p) => p.y !== null)) {
      panels.push({
        title: "Sea-level pressure",
        unit: "mb",
        series: [{ label: "Pressure", color: "--s5", points: pressure }],
      });
    }
    const water = toPoints((o) => o.water_temp);
    const air = toPoints((o) => o.air_temp);
    if (water.some((p) => p.y !== null) || air.some((p) => p.y !== null)) {
      panels.push({
        title: "Temperature",
        unit: labels.temperature,
        series: [
          { label: "Water", color: "--s1", points: water },
          { label: "Air", color: "--s6", points: air },
        ],
      });
    }
    if (panels.length === 0) {
      chartHost.appendChild(
        noteEl("This station reports no chartable sensors in this window."),
      );
      return;
    }
    new Chart(chartHost, {
      xDomain: domain,
      fmtX: makeFmtX(domain),
      fmtXLong,
      now: Date.now(),
      panels,
    });
  };

  const spanHours = (fullDomain[1] - fullDomain[0]) / HOUR;
  if (spanHours > 30) {
    const allPresets: Array<{ label: string; value: [number, number] }> = [
      { label: "24h", value: [fullDomain[1] - 24 * HOUR, fullDomain[1]] },
      { label: "3d", value: [fullDomain[1] - 72 * HOUR, fullDomain[1]] },
      { label: "All", value: fullDomain },
    ];
    const presets = allPresets.filter(
      (p) => p.value[0] >= fullDomain[0] - 12 * HOUR,
    );
    container.appendChild(chipRow(presets, 0, draw));
    container.appendChild(chartHost);
    draw(presets[0].value);
  } else {
    container.appendChild(chartHost);
    draw(fullDomain);
  }
}

// --- Marine model forecast ----------------------------------------------------

interface MarineHourJson {
  time: string;
  wave_height: number | null;
  wave_period_s: number | null;
  wind_wave_height: number | null;
  swell_height: number | null;
  swell_period_s: number | null;
  sea_surface_temp: number | null;
  current_speed: number | null;
}

function renderMarine(container: HTMLElement, s: Structured): void {
  const hours = (s.hourly as MarineHourJson[]) ?? [];
  if (hours.length === 0) {
    container.appendChild(noteEl("No forecast data to chart."));
    return;
  }
  const labels = (s.unit_labels ?? {}) as Record<string, string>;
  container.appendChild(
    header(
      `Marine Model Forecast · (${String(s.latitude)}, ${String(s.longitude)})`,
      "Open-Meteo wave-model blend · forecast, not observations · times UTC",
    ),
  );

  const toPoints = (get: (h: MarineHourJson) => number | null): Pt[] =>
    hours.map((h) => ({ x: Date.parse(h.time), y: get(h) }));
  const fullDomain: [number, number] = [
    Date.parse(hours[0].time),
    Date.parse(hours[hours.length - 1].time),
  ];

  const chartHost = div("pt-chart-host");
  const draw = (domain: [number, number]) => {
    chartHost.textContent = "";
    const panels: Panel[] = [
      {
        title: "Wave height",
        unit: labels.waves,
        series: [
          {
            label: "Combined",
            color: "--s1",
            points: toPoints((h) => h.wave_height),
            area: true,
          },
          {
            label: "Swell",
            color: "--s2",
            points: toPoints((h) => h.swell_height),
          },
          {
            label: "Wind wave",
            color: "--s3",
            points: toPoints((h) => h.wind_wave_height),
          },
        ],
        includeZero: true,
      },
      {
        title: "Period",
        unit: "s",
        series: [
          {
            label: "Combined",
            color: "--s1",
            points: toPoints((h) => h.wave_period_s),
          },
          {
            label: "Swell",
            color: "--s2",
            points: toPoints((h) => h.swell_period_s),
          },
        ],
        includeZero: true,
      },
    ];
    const sst = toPoints((h) => h.sea_surface_temp);
    if (sst.some((p) => p.y !== null)) {
      panels.push({
        title: "Sea surface temperature",
        unit: labels.temperature,
        series: [{ label: "SST", color: "--s6", points: sst }],
      });
    }
    const current = toPoints((h) => h.current_speed);
    if (current.some((p) => p.y !== null)) {
      panels.push({
        title: "Surface current",
        unit: labels.currents,
        series: [
          { label: "Current", color: "--s5", points: current, area: true },
        ],
        includeZero: true,
      });
    }
    new Chart(chartHost, {
      xDomain: domain,
      fmtX: makeFmtX(domain),
      fmtXLong,
      now: Date.now(),
      panels,
    });
  };

  const spanHours = (fullDomain[1] - fullDomain[0]) / HOUR;
  if (spanHours > 30) {
    const allPresets: Array<{ label: string; value: [number, number] }> = [
      { label: "24h", value: [fullDomain[0], fullDomain[0] + 24 * HOUR] },
      { label: "3d", value: [fullDomain[0], fullDomain[0] + 72 * HOUR] },
      { label: "All", value: fullDomain },
    ];
    const presets = allPresets.filter(
      (p) => p.value[1] <= fullDomain[1] + 12 * HOUR,
    );
    container.appendChild(chipRow(presets, presets.length - 1, draw));
    container.appendChild(chartHost);
    draw(fullDomain);
  } else {
    container.appendChild(chartHost);
    draw(fullDomain);
  }
}

// ---------------------------------------------------------------------------
// App wiring
// ---------------------------------------------------------------------------

function renderResult(result: {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): void {
  const container = rootEl();
  container.textContent = "";
  if (result.isError) {
    const text =
      result.content?.find((c) => c.type === "text")?.text ?? "Tool error.";
    container.appendChild(noteEl(text));
    return;
  }
  const s = (result.structuredContent ?? {}) as Structured;
  try {
    switch (s.viz?.kind) {
      case "tide_curve":
        renderTide(container, s);
        break;
      case "solunar":
        renderSolunar(container, s);
        break;
      case "buoy_obs":
        renderBuoy(container, s);
        break;
      case "marine_forecast":
        renderMarine(container, s);
        break;
      default:
        container.appendChild(
          noteEl("No chart is defined for this tool result."),
        );
    }
  } catch (error) {
    container.appendChild(
      noteEl(
        `Chart rendering failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}

function applyTheme(theme: unknown): void {
  if (theme === "dark" || theme === "light") {
    document.documentElement.dataset.theme = theme;
  }
}

async function main(): Promise<void> {
  const app = new App(
    { name: "Perigee Charts", version: "1.0.0" },
    {},
    { autoResize: true },
  );
  app.ontoolresult = (result) => renderResult(result);
  app.onhostcontextchanged = (ctx) =>
    applyTheme((ctx as { theme?: string })?.theme);
  await app.connect();
  const ctx = (
    app as unknown as { getHostContext?: () => { theme?: string } | undefined }
  ).getHostContext?.();
  applyTheme(ctx?.theme);
}

main().catch((error) => {
  rootEl().appendChild(
    noteEl(
      `Failed to connect to host: ${error instanceof Error ? error.message : String(error)}`,
    ),
  );
});
