import { z } from "zod";
import { SunEventType } from "../types/sun.js";

/**
 * Parameters for getting sun times
 */
export const SunTimesParamsSchema = z.object({
  date: z
    .string()
    .optional()
    .describe(
      "Date to get sun times for (YYYY-MM-DD format). Defaults to current date.",
    ),
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .describe("Latitude for location-specific calculations"),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .describe("Longitude for location-specific calculations"),
  format: z
    .enum(["json", "text"])
    .optional()
    .describe("Output format (json or text)"),
  timezone: z
    .string()
    .optional()
    .describe("Timezone for the results. Defaults to UTC."),
});

export type SunTimesParams = z.infer<typeof SunTimesParamsSchema>;

/**
 * Parameters for getting sun times for a date range
 */
export const SunTimesRangeParamsSchema = z.object({
  start_date: z.string().describe("Start date (YYYY-MM-DD format)"),
  end_date: z.string().describe("End date (YYYY-MM-DD format)"),
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .describe("Latitude for location-specific calculations"),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .describe("Longitude for location-specific calculations"),
  format: z
    .enum(["json", "text"])
    .optional()
    .describe("Output format (json or text)"),
  timezone: z
    .string()
    .optional()
    .describe("Timezone for the results. Defaults to UTC."),
});

export type SunTimesRangeParams = z.infer<typeof SunTimesRangeParamsSchema>;

/**
 * Parameters for getting sun position
 */
export const SunPositionParamsSchema = z.object({
  date: z
    .string()
    .optional()
    .describe(
      "Date to get sun position for (YYYY-MM-DD format). Defaults to current date.",
    ),
  time: z
    .string()
    .optional()
    .describe(
      "Time to get sun position for (HH:MM:SS format). Defaults to current time.",
    ),
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .describe("Latitude for location-specific calculations"),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .describe("Longitude for location-specific calculations"),
  format: z
    .enum(["json", "text"])
    .optional()
    .describe("Output format (json or text)"),
});

export type SunPositionParams = z.infer<typeof SunPositionParamsSchema>;

/**
 * Parameters for finding the next sun event
 */
export const NextSunEventParamsSchema = z.object({
  event: z.nativeEnum(SunEventType).describe("Sun event to find"),
  date: z
    .string()
    .optional()
    .describe("Starting date (YYYY-MM-DD format). Defaults to current date."),
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .describe("Latitude for location-specific calculations"),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .describe("Longitude for location-specific calculations"),
  count: z
    .number()
    .positive()
    .optional()
    .describe("Number of occurrences to return. Defaults to 1."),
  format: z
    .enum(["json", "text"])
    .optional()
    .describe("Output format (json or text)"),
  timezone: z
    .string()
    .optional()
    .describe("Timezone for the results. Defaults to UTC."),
});

export type NextSunEventParams = z.infer<typeof NextSunEventParamsSchema>;
