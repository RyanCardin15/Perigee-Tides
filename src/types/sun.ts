/**
 * Sun event types
 */
export enum SunEventType {
  SUNRISE = "sunrise",
  SUNSET = "sunset",
  DAWN = "dawn",
  DUSK = "dusk",
  SOLAR_NOON = "solarNoon",
  NIGHT_START = "night",
  NIGHT_END = "nightEnd",
  GOLDEN_HOUR_START = "goldenHourStart",
  GOLDEN_HOUR_END = "goldenHourEnd",
  NAUTICAL_DAWN = "nauticalDawn",
  NAUTICAL_DUSK = "nauticalDusk",
  ASTRONOMICAL_DAWN = "astronomicalDawn",
  ASTRONOMICAL_DUSK = "astronomicalDusk",
}

/**
 * Sun times information
 */
export interface SunTimesInfo {
  date: string;
  sunrise: string | null;
  sunset: string | null;
  solarNoon: string | null;
  dawn: string | null;
  dusk: string | null;
  nightStart: string | null;
  nightEnd: string | null;
  goldenHourStart: string | null;
  goldenHourEnd: string | null;
  nauticalDawn: string | null;
  nauticalDusk: string | null;
  astronomicalDawn: string | null;
  astronomicalDusk: string | null;
  dayLength: number; // in minutes
}

/**
 * Sun position information
 */
export interface SunPositionInfo {
  date: string;
  time: string;
  azimuth: number;
  altitude: number;
  declination: number;
  rightAscension: number;
}
