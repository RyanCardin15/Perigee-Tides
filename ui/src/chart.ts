/**
 * Minimal SVG chart core for the Perigee Charts MCP app.
 *
 * Hand-rolled instead of a chart library so the whole template stays a small
 * self-contained file that renders inside the locked-down (no-network) MCP
 * Apps sandbox. Follows the dataviz mark specs: 2px round-join lines, ~10%
 * opacity area washes, hairline solid gridlines, recessive muted axis text,
 * crosshair + single tooltip listing every series at the hovered X, markers
 * with a surface ring. One y-axis per panel — multiple measures become
 * stacked panels (small multiples) that share a crosshair.
 */

export interface Pt {
  x: number;
  y: number | null;
}

export interface Series {
  label: string;
  /** CSS variable name, e.g. "--s1". */
  color: string;
  points: Pt[];
  /** Draw a ~10%-opacity wash under the line down to the panel floor. */
  area?: boolean;
  dashed?: boolean;
  /** Format a value for tooltip/labels. */
  fmt?: (v: number) => string;
}

export interface Band {
  x0: number;
  x1: number;
  color: string;
  label?: string;
}

export interface Marker {
  x: number;
  y: number;
  color: string;
  label?: string;
  /** Optional second label line under the main one (e.g. a time). */
  sub?: string;
}

export interface Panel {
  title?: string;
  unit?: string;
  series: Series[];
  bands?: Band[];
  markers?: Marker[];
  height?: number;
  /** Fix the y domain (e.g. 0-100 for activity). */
  yDomain?: [number, number];
  /** Pad y domain to include zero baseline. */
  includeZero?: boolean;
}

export interface ChartOptions {
  /** Shared x domain (epoch ms). */
  xDomain: [number, number];
  panels: Panel[];
  /** Format an x value for axis ticks. */
  fmtX: (x: number) => string;
  /** Format an x value for the tooltip header (more verbose). */
  fmtXLong: (x: number) => string;
  /** Draw a vertical "now" reference line at this x. */
  now?: number;
}

const MARGIN = { top: 8, right: 12, bottom: 22, left: 46 };

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function div(className: string): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

/** Clean tick values for a numeric domain (1/2/5 steps). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  const step = candidates.find((s) => span / s <= count + 0.5) ?? 10 * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

/**
 * Time ticks at clean hour/day boundaries for a UTC-ms domain. Domains over
 * 36h get day-level labels (see makeFmtX in main.ts), so their step is
 * forced to whole days to avoid repeating the same label.
 */
export function timeTicks(x0: number, x1: number, maxCount = 6): number[] {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const spans =
    x1 - x0 > 36 * HOUR
      ? [DAY, 2 * DAY, 7 * DAY, 14 * DAY]
      : [HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY];
  const step =
    spans.find((s) => (x1 - x0) / s <= maxCount) ?? spans[spans.length - 1];
  const start = Math.ceil(x0 / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= x1; t += step) ticks.push(t);
  return ticks;
}

interface PanelLayout {
  panel: Panel;
  svg: SVGSVGElement;
  plotX: (x: number) => number;
  plotY: (y: number) => number;
  hoverLayer: SVGGElement;
  width: number;
  height: number;
}

export class Chart {
  private layouts: PanelLayout[] = [];
  private tooltip: HTMLDivElement;
  private allX: number[] = [];

  constructor(
    private root: HTMLElement,
    private opts: ChartOptions,
  ) {
    this.tooltip = div("pt-tooltip");
    this.tooltip.style.display = "none";
    this.render();
  }

  private render(): void {
    this.root.textContent = "";
    this.root.appendChild(this.tooltip);
    this.layouts = [];

    // Collect the union of x positions for crosshair snapping.
    const xs = new Set<number>();
    for (const panel of this.opts.panels) {
      for (const s of panel.series) {
        for (const p of s.points) xs.add(p.x);
      }
    }
    this.allX = [...xs].sort((a, b) => a - b);

    for (const panel of this.opts.panels) {
      this.renderPanel(panel);
    }

    this.root.addEventListener("pointermove", (e) => this.onPointer(e));
    this.root.addEventListener("pointerleave", () => this.clearHover());
  }

  private renderPanel(panel: Panel): void {
    const card = div("pt-panel");
    const width = Math.max(280, this.root.clientWidth || 640);
    const height = panel.height ?? 150;

    if (panel.title) {
      const head = div("pt-panel-head");
      const title = document.createElement("span");
      title.className = "pt-panel-title";
      title.textContent = panel.title;
      head.appendChild(title);
      if (panel.unit) {
        const unit = document.createElement("span");
        unit.className = "pt-panel-unit";
        unit.textContent = panel.unit;
        head.appendChild(unit);
      }
      if (panel.series.length > 1) {
        const legend = div("pt-legend");
        for (const s of panel.series) {
          const item = div("pt-legend-item");
          const key = document.createElement("span");
          key.className = "pt-legend-key";
          key.style.background = `var(${s.color})`;
          item.appendChild(key);
          const label = document.createElement("span");
          label.textContent = s.label;
          item.appendChild(label);
          legend.appendChild(item);
        }
        head.appendChild(legend);
      }
      card.appendChild(head);
    }

    const svg = el("svg", {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      class: "pt-svg",
    });
    card.appendChild(svg);
    this.root.appendChild(card);

    const [x0, x1] = this.opts.xDomain;
    let yMin = Infinity;
    let yMax = -Infinity;
    if (panel.yDomain) {
      [yMin, yMax] = panel.yDomain;
    } else {
      for (const s of panel.series) {
        for (const p of s.points) {
          if (p.y === null || p.x < x0 || p.x > x1) continue;
          if (p.y < yMin) yMin = p.y;
          if (p.y > yMax) yMax = p.y;
        }
      }
      for (const m of panel.markers ?? []) {
        if (m.x < x0 || m.x > x1) continue;
        if (m.y < yMin) yMin = m.y;
        if (m.y > yMax) yMax = m.y;
      }
      if (!Number.isFinite(yMin)) {
        yMin = 0;
        yMax = 1;
      }
      if (panel.includeZero) yMin = Math.min(0, yMin);
      const pad = (yMax - yMin || 1) * 0.12;
      yMin -= pad;
      yMax += pad;
      if (panel.includeZero && yMin < 0 && yMin > -pad - 1e-9) yMin = 0;
    }

    const iw = width - MARGIN.left - MARGIN.right;
    const ih = height - MARGIN.top - MARGIN.bottom;
    const plotX = (x: number) => MARGIN.left + ((x - x0) / (x1 - x0)) * iw;
    const plotY = (y: number) =>
      MARGIN.top + ih - ((y - yMin) / (yMax - yMin || 1)) * ih;

    // Bands first (under everything).
    for (const band of panel.bands ?? []) {
      const bx0 = Math.max(x0, band.x0);
      const bx1 = Math.min(x1, band.x1);
      if (bx1 <= bx0) continue;
      svg.appendChild(
        el("rect", {
          x: plotX(bx0),
          y: MARGIN.top,
          width: plotX(bx1) - plotX(bx0),
          height: ih,
          fill: `var(${band.color})`,
          opacity: 0.14,
          rx: 2,
        }),
      );
    }

    // Gridlines + y ticks.
    for (const tick of niceTicks(yMin, yMax)) {
      const y = plotY(tick);
      svg.appendChild(
        el("line", {
          x1: MARGIN.left,
          x2: width - MARGIN.right,
          y1: y,
          y2: y,
          class: "pt-grid",
        }),
      );
      const label = el("text", {
        x: MARGIN.left - 6,
        y: y + 3,
        class: "pt-tick pt-tick-y",
        "text-anchor": "end",
      });
      label.textContent = formatTick(tick);
      svg.appendChild(label);
    }

    // X ticks.
    for (const tick of timeTicks(x0, x1)) {
      const x = plotX(tick);
      svg.appendChild(
        el("line", {
          x1: x,
          x2: x,
          y1: MARGIN.top + ih,
          y2: MARGIN.top + ih + 3,
          class: "pt-axis",
        }),
      );
      const label = el("text", {
        x,
        y: height - 6,
        class: "pt-tick",
        "text-anchor": "middle",
      });
      label.textContent = this.opts.fmtX(tick);
      svg.appendChild(label);
    }

    // Baseline.
    svg.appendChild(
      el("line", {
        x1: MARGIN.left,
        x2: width - MARGIN.right,
        y1: MARGIN.top + ih,
        y2: MARGIN.top + ih,
        class: "pt-axis",
      }),
    );

    // "Now" line.
    if (
      this.opts.now !== undefined &&
      this.opts.now >= x0 &&
      this.opts.now <= x1
    ) {
      const x = plotX(this.opts.now);
      svg.appendChild(
        el("line", {
          x1: x,
          x2: x,
          y1: MARGIN.top,
          y2: MARGIN.top + ih,
          class: "pt-nowline",
        }),
      );
    }

    // Series: area washes, then lines.
    for (const s of panel.series) {
      const visible = s.points.filter((p) => p.x >= x0 && p.x <= x1);
      const segments = splitSegments(visible);
      if (s.area) {
        for (const seg of segments) {
          if (seg.length < 2) continue;
          const dLine = seg
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"}${plotX(p.x).toFixed(1)},${plotY(p.y as number).toFixed(1)}`,
            )
            .join("");
          const floor = MARGIN.top + ih;
          const d = `${dLine}L${plotX(seg[seg.length - 1].x).toFixed(1)},${floor}L${plotX(seg[0].x).toFixed(1)},${floor}Z`;
          svg.appendChild(
            el("path", { d, fill: `var(${s.color})`, opacity: 0.1 }),
          );
        }
      }
      for (const seg of segments) {
        if (seg.length === 0) continue;
        if (seg.length === 1) {
          svg.appendChild(
            el("circle", {
              cx: plotX(seg[0].x),
              cy: plotY(seg[0].y as number),
              r: 2.5,
              fill: `var(${s.color})`,
            }),
          );
          continue;
        }
        const d = seg
          .map(
            (p, i) =>
              `${i === 0 ? "M" : "L"}${plotX(p.x).toFixed(1)},${plotY(p.y as number).toFixed(1)}`,
          )
          .join("");
        const path = el("path", {
          d,
          fill: "none",
          stroke: `var(${s.color})`,
          "stroke-width": 2,
          "stroke-linejoin": "round",
          "stroke-linecap": "round",
        });
        if (s.dashed) path.setAttribute("stroke-dasharray", "5 4");
        svg.appendChild(path);
      }
    }

    // Markers (with surface ring) + selective labels.
    for (const m of panel.markers ?? []) {
      if (m.x < x0 || m.x > x1) continue;
      const cx = plotX(m.x);
      const cy = plotY(m.y);
      svg.appendChild(el("circle", { cx, cy, r: 6, class: "pt-marker-ring" }));
      svg.appendChild(el("circle", { cx, cy, r: 4, fill: `var(${m.color})` }));
      if (m.label) {
        const above = cy > MARGIN.top + 26;
        // Keep labels inside the plot area near the edges.
        const lx = Math.min(
          width - MARGIN.right - 24,
          Math.max(MARGIN.left + 24, cx),
        );
        const label = el("text", {
          x: lx,
          y: above ? cy - 10 : cy + 16,
          class: "pt-marker-label",
          "text-anchor": "middle",
        });
        label.textContent = m.label;
        svg.appendChild(label);
        if (m.sub) {
          const sub = el("text", {
            x: lx,
            y: above ? cy - 10 + 11 : cy + 16 + 11,
            class: "pt-marker-sub",
            "text-anchor": "middle",
          });
          // Sub-label sits between the main label and the dot when above.
          if (above) {
            label.setAttribute("y", String(cy - 21));
            sub.setAttribute("y", String(cy - 10));
          }
          sub.textContent = m.sub;
          svg.appendChild(sub);
        }
      }
    }

    const hoverLayer = el("g");
    svg.appendChild(hoverLayer);
    this.layouts.push({ panel, svg, plotX, plotY, hoverLayer, width, height });
  }

  private onPointer(e: PointerEvent): void {
    if (this.allX.length === 0) return;
    const first = this.layouts[0];
    if (!first) return;
    const rect = (
      e.target instanceof Element
        ? (e.target.closest(".pt-panel svg") ?? first.svg)
        : first.svg
    ).getBoundingClientRect();
    const [x0, x1] = this.opts.xDomain;
    const frac =
      (e.clientX - rect.left - MARGIN.left) /
      (rect.width - MARGIN.left - MARGIN.right);
    const targetX = x0 + Math.min(1, Math.max(0, frac)) * (x1 - x0);
    const snapped = nearest(this.allX, targetX);
    this.drawHover(snapped, e);
  }

  private drawHover(x: number, e: PointerEvent): void {
    const rows: Array<{ label: string; value: string; color: string }> = [];
    for (const layout of this.layouts) {
      layout.hoverLayer.textContent = "";
      const { panel, plotX, plotY } = layout;
      const px = plotX(x);
      layout.hoverLayer.appendChild(
        el("line", {
          x1: px,
          x2: px,
          y1: MARGIN.top,
          y2: layout.height - MARGIN.bottom,
          class: "pt-crosshair",
        }),
      );
      for (const s of panel.series) {
        const pt = s.points.find((p) => p.x === x);
        if (!pt || pt.y === null) continue;
        layout.hoverLayer.appendChild(
          el("circle", {
            cx: px,
            cy: plotY(pt.y),
            r: 5,
            class: "pt-marker-ring",
          }),
        );
        layout.hoverLayer.appendChild(
          el("circle", {
            cx: px,
            cy: plotY(pt.y),
            r: 3.5,
            fill: `var(${s.color})`,
          }),
        );
        rows.push({
          label: s.label + (panel.unit ? ` (${panel.unit})` : ""),
          value: s.fmt ? s.fmt(pt.y) : formatTick(pt.y),
          color: s.color,
        });
      }
    }

    // Tooltip.
    this.tooltip.textContent = "";
    const head = div("pt-tooltip-head");
    head.textContent = this.opts.fmtXLong(x);
    this.tooltip.appendChild(head);
    for (const row of rows) {
      const line = div("pt-tooltip-row");
      const key = document.createElement("span");
      key.className = "pt-legend-key";
      key.style.background = `var(${row.color})`;
      line.appendChild(key);
      const value = document.createElement("strong");
      value.textContent = row.value;
      line.appendChild(value);
      const label = document.createElement("span");
      label.className = "pt-tooltip-label";
      label.textContent = row.label;
      line.appendChild(label);
      this.tooltip.appendChild(line);
    }
    this.tooltip.style.display = rows.length > 0 ? "block" : "none";
    const rootRect = this.root.getBoundingClientRect();
    const tipWidth = this.tooltip.offsetWidth || 140;
    let left = e.clientX - rootRect.left + 14;
    if (left + tipWidth > rootRect.width - 8) {
      left = e.clientX - rootRect.left - tipWidth - 14;
    }
    this.tooltip.style.left = `${Math.max(0, left)}px`;
    this.tooltip.style.top = `${e.clientY - rootRect.top + 12}px`;
  }

  private clearHover(): void {
    for (const layout of this.layouts) layout.hoverLayer.textContent = "";
    this.tooltip.style.display = "none";
  }
}

/** Split a point list into contiguous non-null segments (gaps stay gaps). */
function splitSegments(points: Pt[]): Array<Array<{ x: number; y: number }>> {
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  for (const p of points) {
    if (p.y === null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push({ x: p.x, y: p.y });
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function nearest(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid;
    else hi = mid;
  }
  return Math.abs(sorted[lo] - target) <= Math.abs(sorted[hi] - target)
    ? sorted[lo]
    : sorted[hi];
}

export function formatTick(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000)
    return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1).replace(/\.0$/, "");
  return v.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
}
