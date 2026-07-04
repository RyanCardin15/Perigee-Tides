/**
 * Markdown rendering for time-series tool responses: a metadata header
 * (station, units, datum, time zone, count) followed by a data table and an
 * optional flag legend, so units and quality semantics are always visible.
 */

import { markdownTable } from "./respond.js";

export interface SeriesMeta {
  title: string;
  station: string;
  stationName?: string;
  unitsLabel?: string;
  datum?: string;
  timeZone?: string;
  extra?: string[];
}

export function seriesMarkdown(
  meta: SeriesMeta,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
  legend?: string,
): string {
  const lines: string[] = [`# ${meta.title}`, ""];
  const facts: string[] = [
    `**Station**: ${meta.station}${meta.stationName ? ` (${meta.stationName})` : ""}`,
  ];
  if (meta.unitsLabel) facts.push(`**Units**: ${meta.unitsLabel}`);
  if (meta.datum) facts.push(`**Datum**: ${meta.datum}`);
  if (meta.timeZone) facts.push(`**Time zone**: ${meta.timeZone}`);
  facts.push(`**Records**: ${rows.length}`);
  lines.push(facts.join(" · "));
  if (meta.extra?.length) {
    lines.push("", ...meta.extra);
  }
  lines.push("");
  if (rows.length === 0) {
    lines.push(
      "_No data returned for this request. The station may not collect this product, or the window may fall outside its record — check noaa_get_station_info._",
    );
  } else {
    lines.push(markdownTable(headers, rows));
  }
  if (legend && rows.length > 0) {
    lines.push("", `_${legend}_`);
  }
  return lines.join("\n");
}

const TIME_ZONE_LABELS: Record<string, string> = {
  gmt: "GMT (UTC)",
  lst: "local standard time (no DST)",
  lst_ldt: "local time (DST-aware)",
};

export function timeZoneLabel(tz: string): string {
  return TIME_ZONE_LABELS[tz] ?? tz;
}
