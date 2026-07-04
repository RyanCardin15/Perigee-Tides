declare module "suncalc" {
  export interface MoonIllumination {
    /** fraction of moon's visible disk that is illuminated */
    fraction: number;
    /** moon phase (0.0-1.0) */
    phase: number;
    /** midpoint angle in radians of the illuminated limb of the moon reckoned eastward from the north point of the disk */
    angle: number;
  }

  export interface MoonPosition {
    /** moon azimuth in radians */
    azimuth: number;
    /** moon altitude above the horizon in radians */
    altitude: number;
    /** distance to moon in kilometers */
    distance: number;
    /** parallactic angle of the moon in radians */
    parallacticAngle: number;
  }

  export interface SunPosition {
    /** sun azimuth in radians (direction along the horizon, measured from south to west) */
    azimuth: number;
    /** sun altitude above the horizon in radians */
    altitude: number;
  }

  export interface SunTimes {
    /** sunrise (top edge of the sun appears on the horizon) */
    sunrise: Date;
    /** sunrise ends (bottom edge of the sun touches the horizon) */
    sunriseEnd: Date;
    /** morning golden hour (soft light, best time for photography) starts */
    goldenHourEnd: Date;
    /** solar noon (sun is in the highest position) */
    solarNoon: Date;
    /** evening golden hour starts */
    goldenHour: Date;
    /** sunset starts (bottom edge of the sun touches the horizon) */
    sunsetStart: Date;
    /** sunset (sun disappears below the horizon, evening civil twilight starts) */
    sunset: Date;
    /** dusk (evening nautical twilight starts) */
    dusk: Date;
    /** nautical dusk (evening astronomical twilight starts) */
    nauticalDusk: Date;
    /** astronomical dusk (evening astronomical twilight starts) */
    astronomicalDusk: Date;
    /** night starts (dark enough for astronomical observations) */
    night: Date;
    /** nadir (darkest moment of the night, sun is in the lowest position) */
    nadir: Date;
    /** night ends (morning astronomical twilight starts) */
    nightEnd: Date;
    /** astronomical dawn (morning astronomical twilight starts) */
    astronomicalDawn: Date;
    /** nautical dawn (morning nautical twilight starts) */
    nauticalDawn: Date;
    /** dawn (morning nautical twilight ends, morning civil twilight starts) */
    dawn: Date;
  }

  export interface MoonTimes {
    /** moonrise time as Date */
    rise: Date | null;
    /** moonset time as Date */
    set: Date | null;
    /** true if the moon never rises/sets and is always above the horizon during the day */
    alwaysUp: boolean;
    /** true if the moon is always below the horizon */
    alwaysDown: boolean;
  }

  /**
   * Calculates sun position for a given date and latitude/longitude
   */
  export function getPosition(
    date: Date | number,
    lat: number,
    lng: number,
  ): SunPosition;

  /**
   * Calculates sun times for a given date, latitude/longitude, and, optionally, the observer height (in meters) relative to the horizon
   */
  export function getTimes(
    date: Date | number,
    lat: number,
    lng: number,
    height?: number,
  ): SunTimes;

  /**
   * Returns an object with the following properties:
   * altitude: moon altitude above the horizon in radians
   * azimuth: moon azimuth in radians
   * distance: distance to moon in kilometers
   * parallacticAngle: parallactic angle of the moon in radians
   */
  export function getMoonPosition(
    date: Date | number,
    lat: number,
    lng: number,
  ): MoonPosition;

  /**
   * Returns an object with the following properties:
   * fraction: illuminated fraction of the moon; varies from 0.0 (new moon) to 1.0 (full moon)
   * phase: moon phase; varies from 0.0 to 1.0, described below
   * angle: midpoint angle in radians of the illuminated limb of the moon reckoned eastward from the north point of the disk
   */
  export function getMoonIllumination(date: Date | number): MoonIllumination;

  /**
   * Returns an object with the following properties:
   * rise: moonrise time as Date
   * set: moonset time as Date
   * alwaysUp: true if the moon never rises/sets and is always above the horizon during the day
   * alwaysDown: true if the moon is always below the horizon
   */
  export function getMoonTimes(
    date: Date | number,
    lat: number,
    lng: number,
    inUTC?: boolean,
  ): MoonTimes;
}
