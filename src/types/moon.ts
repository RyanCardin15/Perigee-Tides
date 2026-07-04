/**
 * Moon phase names and their approximate ranges
 */
export enum MoonPhaseName {
  NEW_MOON = "New Moon",
  WAXING_CRESCENT = "Waxing Crescent",
  FIRST_QUARTER = "First Quarter",
  WAXING_GIBBOUS = "Waxing Gibbous",
  FULL_MOON = "Full Moon",
  WANING_GIBBOUS = "Waning Gibbous",
  LAST_QUARTER = "Last Quarter",
  WANING_CRESCENT = "Waning Crescent",
}

/**
 * Moon phase information
 */
export interface MoonPhaseInfo {
  date: string;
  phase: number;
  phaseName: MoonPhaseName;
  illumination: number;
  age: number;
  distance: number;
  diameter: number;
  isWaxing: boolean;
}
