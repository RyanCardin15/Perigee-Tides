/**
 * Date-parameter handling for the NOAA Data API.
 *
 * The API accepts exactly one of five combinations:
 *   1. begin_date + end_date
 *   2. begin_date + range (hours forward)
 *   3. end_date + range (hours back)
 *   4. date=today | latest | recent
 *   5. range alone (hours back from now)
 *
 * NOAA date formats: yyyyMMdd, "yyyyMMdd HH:mm", MM/dd/yyyy, "MM/dd/yyyy HH:mm".
 * We additionally accept ISO (yyyy-MM-dd and yyyy-MM-ddTHH:mm) and normalize it,
 * since agents overwhelmingly produce ISO dates.
 *
 * Each product/interval also has a maximum span per request (e.g. 31 days for
 * 6-minute water levels). We enforce those limits *before* calling NOAA so the
 * agent gets an immediate, actionable error instead of an upstream failure.
 */

export interface DateParams {
  date?: string;
  begin_date?: string;
  end_date?: string;
  range?: number;
}

const SPECIAL_DATES = new Set(["today", "latest", "recent"]);

/** NOAA-native formats we pass through untouched. */
const NOAA_DATE_RE = /^(\d{8}|\d{2}\/\d{2}\/\d{4})( \d{2}:\d{2})?$/;
/** ISO formats we normalize to NOAA's "yyyyMMdd HH:mm". */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})([T ](\d{2}):(\d{2}))?/;

/**
 * Normalize a user-supplied date string to a NOAA-accepted format.
 * Throws with the list of accepted formats when unparseable.
 */
export function normalizeDate(input: string, paramName: string): string {
  const trimmed = input.trim();
  if (NOAA_DATE_RE.test(trimmed)) return trimmed;
  const iso = trimmed.match(ISO_DATE_RE);
  if (iso) {
    const base = `${iso[1]}${iso[2]}${iso[3]}`;
    return iso[4] ? `${base} ${iso[5]}:${iso[6]}` : base;
  }
  throw new Error(
    `Invalid ${paramName} "${input}". Accepted formats: yyyyMMdd, "yyyyMMdd HH:mm", MM/dd/yyyy, "MM/dd/yyyy HH:mm", or ISO yyyy-MM-dd[THH:mm].`,
  );
}

/** Parse a normalized NOAA date string into a Date (UTC interpretation). */
export function parseNoaaDate(normalized: string): Date {
  let year: number, month: number, day: number;
  let hour = 0,
    minute = 0;
  const timeMatch = normalized.match(/ (\d{2}):(\d{2})$/);
  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
  }
  const datePart = normalized.split(" ")[0];
  if (datePart.includes("/")) {
    const [mm, dd, yyyy] = datePart.split("/");
    year = Number(yyyy);
    month = Number(mm);
    day = Number(dd);
  } else {
    year = Number(datePart.slice(0, 4));
    month = Number(datePart.slice(4, 6));
    day = Number(datePart.slice(6, 8));
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date "${normalized}".`);
  }
  return date;
}

export interface NormalizedDateParams {
  date?: string;
  begin_date?: string;
  end_date?: string;
  range?: number;
  /** Span of the request in days, when computable. */
  spanDays?: number;
}

/**
 * Validate that exactly one legal date-parameter combination was supplied,
 * normalize formats, and compute the request span in days when possible.
 */
export function resolveDateParams(params: DateParams): NormalizedDateParams {
  const { date, begin_date, end_date, range } = params;

  if (date !== undefined) {
    if (begin_date || end_date || range !== undefined) {
      throw new Error(
        "Use either `date` (today/latest/recent) OR explicit begin_date/end_date/range — not both.",
      );
    }
    const lower = date.toLowerCase();
    if (!SPECIAL_DATES.has(lower)) {
      throw new Error(
        `Invalid date "${date}". The \`date\` parameter only accepts: today, latest (most recent single reading), recent (last 72 hours). For a specific day use begin_date and end_date.`,
      );
    }
    return { date: lower, spanDays: lower === "recent" ? 3 : 1 };
  }

  const begin =
    begin_date !== undefined
      ? normalizeDate(begin_date, "begin_date")
      : undefined;
  const end =
    end_date !== undefined ? normalizeDate(end_date, "end_date") : undefined;

  if (begin && end) {
    if (range !== undefined) {
      throw new Error(
        "Provide begin_date+end_date OR a range — not all three.",
      );
    }
    const beginDt = parseNoaaDate(begin);
    const endDt = parseNoaaDate(end);
    if (endDt <= beginDt) {
      throw new Error("end_date must be after begin_date.");
    }
    const spanDays = (endDt.getTime() - beginDt.getTime()) / 86_400_000;
    return { begin_date: begin, end_date: end, spanDays };
  }
  if (begin && range !== undefined) {
    return { begin_date: begin, range, spanDays: range / 24 };
  }
  if (end && range !== undefined) {
    return { end_date: end, range, spanDays: range / 24 };
  }
  if (range !== undefined) {
    return { range, spanDays: range / 24 };
  }
  if (begin || end) {
    throw new Error(
      "Incomplete date parameters: pair begin_date with end_date (or with range in hours), or pair end_date with range.",
    );
  }
  throw new Error(
    "Missing date parameters. Provide one of: begin_date+end_date, begin_date+range, end_date+range, range alone (hours back from now), or date=today|latest|recent.",
  );
}

/**
 * Per-product/interval maximum request spans (days), from NOAA CO-OPS docs.
 * Exceeding these returns an upstream error, so we fail fast with guidance.
 */
export const MAX_SPAN_DAYS: Record<string, number> = {
  one_minute_water_level: 4,
  water_level: 31,
  hourly_height: 366,
  high_low: 366,
  daily_mean: 3653,
  daily_max_min: 3653,
  monthly_mean: 73050,
  "predictions:hilo": 3653,
  predictions: 366,
  currents: 7,
  "currents_predictions:max_slack": 366,
  currents_predictions: 31,
  met: 31,
  air_gap: 31,
};

export function assertSpanWithinLimit(
  spanDays: number | undefined,
  limitKey: string,
  productLabel: string,
): void {
  if (spanDays === undefined) return;
  const limit = MAX_SPAN_DAYS[limitKey];
  if (limit !== undefined && spanDays > limit) {
    throw new Error(
      `Requested span of ~${Math.ceil(spanDays)} days exceeds NOAA's ${limit}-day maximum per request for ${productLabel}. Split the request into chunks of at most ${limit} days.`,
    );
  }
}
