import { z } from "zod";
import { MoonPhaseName } from "../types/moon.js";

/**
 * Parameters for getting moon phase
 */
export const MoonPhaseParamsSchema = z.object({
  date: z
    .string()
    .optional()
    .describe(
      "Date to get moon phase for (YYYY-MM-DD format). Defaults to current date.",
    ),
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe("Latitude for location-specific calculations"),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .optional()
    .describe("Longitude for location-specific calculations"),
  format: z
    .enum(["json", "text"])
    .optional()
    .describe("Output format (json or text)"),
});

export type MoonPhaseParams = z.infer<typeof MoonPhaseParamsSchema>;

/**
 * Parameters for getting moon phases for a date range
 */
export const MoonPhasesRangeParamsSchema = z.object({
  start_date: z.string().describe("Start date (YYYY-MM-DD format)"),
  end_date: z.string().describe("End date (YYYY-MM-DD format)"),
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe("Latitude for location-specific calculations"),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .optional()
    .describe("Longitude for location-specific calculations"),
  format: z
    .enum(["json", "text"])
    .optional()
    .describe("Output format (json or text)"),
});

export type MoonPhasesRangeParams = z.infer<typeof MoonPhasesRangeParamsSchema>;

/**
 * Parameters for getting next moon phase
 */
export const NextMoonPhaseParamsSchema = z.object({
  phase: z
    .enum([
      MoonPhaseName.NEW_MOON,
      MoonPhaseName.FIRST_QUARTER,
      MoonPhaseName.FULL_MOON,
      MoonPhaseName.LAST_QUARTER,
    ])
    .describe("Moon phase to find"),
  date: z
    .string()
    .optional()
    .describe("Starting date (YYYY-MM-DD format). Defaults to current date."),
  count: z
    .number()
    .positive()
    .optional()
    .describe("Number of occurrences to return. Defaults to 1."),
  format: z
    .enum(["json", "text"])
    .optional()
    .describe("Output format (json or text)"),
});

export type NextMoonPhaseParams = z.infer<typeof NextMoonPhaseParamsSchema>;
