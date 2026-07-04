/**
 * NOAA CO-OPS Derived Product API (DPAPI) service.
 *
 * Endpoint paths verified live (2026-07):
 *   /webapi/product/sealvltrends.json          — relative sea level trends
 *   /webapi/product.json?name=extremewaterlevels
 *   /webapi/product.json?name=toptenwaterlevels|peakwaterlevels
 *   /webapi/product/slr_projections.json       — sea level rise projections
 *   /webapi/htf/htf_daily|htf_monthly|htf_seasonal|htf_annual|
 *          htf_met_year_annual|htf_met_year_annual_outlook|
 *          htf_projection_decadal|htf_record|htf_likely_decadal_scenarios .json
 *   /webapi/htb.json                           — HTF daily likelihoods
 */

import { fetchDpapi } from "../client/http.js";
import type { UnitSystem } from "../format/units.js";

export async function getSeaLevelTrends(params: {
  station?: string;
  affil?: "Global" | "US";
}): Promise<Record<string, unknown>> {
  return fetchDpapi("/webapi/product/sealvltrends.json", params);
}

export async function getExtremeWaterLevels(params: {
  station: string;
  units: UnitSystem;
  extremeType?: "annuals" | "monthlies";
  levelType?: "high" | "low";
  datum?: string;
}): Promise<Record<string, unknown>> {
  return fetchDpapi("/webapi/product.json", {
    name: "extremewaterlevels",
    ...params,
  });
}

export async function getTopTenWaterLevels(params: {
  station: string;
  analysis: "toptenwaterlevels" | "peakwaterlevels";
  units: UnitSystem;
  datum?: string;
  year?: number;
}): Promise<Record<string, unknown>> {
  const { analysis, ...rest } = params;
  return fetchDpapi("/webapi/product.json", { name: analysis, ...rest });
}

export async function getSeaLevelRiseProjections(params: {
  station?: string;
  scenario?: string;
  projection_year?: number;
  report_year?: number;
  units?: UnitSystem;
}): Promise<Record<string, unknown>> {
  return fetchDpapi("/webapi/product/slr_projections.json", params);
}

export type HtfReport =
  | "daily"
  | "monthly"
  | "seasonal"
  | "annual"
  | "met_year_annual"
  | "annual_outlook"
  | "projections"
  | "record_days"
  | "likely_scenarios"
  | "daily_likelihoods";

const HTF_PATHS: Record<HtfReport, string> = {
  daily: "/webapi/htf/htf_daily.json",
  monthly: "/webapi/htf/htf_monthly.json",
  seasonal: "/webapi/htf/htf_seasonal.json",
  annual: "/webapi/htf/htf_annual.json",
  met_year_annual: "/webapi/htf/htf_met_year_annual.json",
  annual_outlook: "/webapi/htf/htf_met_year_annual_outlook.json",
  projections: "/webapi/htf/htf_projection_decadal.json",
  record_days: "/webapi/htf/htf_record.json",
  likely_scenarios: "/webapi/htf/htf_likely_decadal_scenarios.json",
  daily_likelihoods: "/webapi/htb.json",
};

export interface HtfParams {
  station: string;
  start_date?: string;
  end_date?: string;
  year?: number;
  month?: number;
  range?: number;
  season_months?: "DJF" | "MAM" | "JJA" | "SON";
  met_year?: number;
  decade?: number;
  flood_threshold?: "minor" | "moderate" | "major";
  units?: UnitSystem;
  datum?: string;
}

export async function getHighTideFlooding(
  report: HtfReport,
  params: HtfParams,
): Promise<Record<string, unknown>> {
  if (report === "daily" && (!params.start_date || !params.end_date)) {
    throw new Error(
      "The daily high-tide-flooding report requires both start_date and end_date (YYYYMMDD).",
    );
  }
  const query: HtfParams = { ...params };
  // NOAA's `range` only takes effect alongside a starting year (year..year+range).
  // A bare range reads most naturally as "the last N years" — translate it.
  if (query.range !== undefined) {
    const startYear = new Date().getUTCFullYear() - query.range;
    if (report === "met_year_annual" || report === "annual_outlook") {
      query.met_year = query.met_year ?? startYear;
    } else if (query.year === undefined) {
      query.year = startYear;
    }
  }
  return fetchDpapi(HTF_PATHS[report], { ...query });
}
