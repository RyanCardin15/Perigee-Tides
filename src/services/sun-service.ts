import SunCalc from "suncalc";
import {
  SunTimesParams,
  SunTimesRangeParams,
  SunPositionParams,
  NextSunEventParams,
} from "../interfaces/sun.js";
import { SunTimesInfo, SunPositionInfo, SunEventType } from "../types/sun.js";

/**
 * Service for sun calculations
 */
export class SunService {
  /**
   * Get sun times for a specific date and location
   * @param params Parameters for the request
   * @returns Sun times information
   */
  getSunTimes(params: SunTimesParams): SunTimesInfo {
    const date = params.date ? new Date(params.date) : new Date();
    const { latitude, longitude } = params;

    // Get sun times data
    const sunTimes = SunCalc.getTimes(date, latitude, longitude);

    // Format times or return null if not available
    const formatTime = (time: Date | null): string | null => {
      if (!time || isNaN(time.getTime())) return null;

      if (params.timezone) {
        try {
          return time.toLocaleTimeString("en-US", {
            timeZone: params.timezone,
          });
        } catch (error) {
          // If timezone is invalid, fall back to ISO string
          console.warn(`Invalid timezone: ${params.timezone}. Using UTC.`);
        }
      }

      return time.toISOString();
    };

    // Calculate day length in minutes
    const sunrise = sunTimes.sunrise;
    const sunset = sunTimes.sunset;
    let dayLength = 0;

    if (
      sunrise &&
      sunset &&
      !isNaN(sunrise.getTime()) &&
      !isNaN(sunset.getTime())
    ) {
      dayLength = (sunset.getTime() - sunrise.getTime()) / (60 * 1000);
    }

    return {
      date: date.toISOString().split("T")[0],
      sunrise: formatTime(sunTimes.sunrise),
      sunset: formatTime(sunTimes.sunset),
      solarNoon: formatTime(sunTimes.solarNoon),
      dawn: formatTime(sunTimes.dawn),
      dusk: formatTime(sunTimes.dusk),
      nightStart: formatTime(sunTimes.night),
      nightEnd: formatTime(sunTimes.nightEnd),
      goldenHourStart: formatTime(sunTimes.goldenHour),
      goldenHourEnd: formatTime(sunTimes.goldenHourEnd),
      nauticalDawn: formatTime(sunTimes.nauticalDawn),
      nauticalDusk: formatTime(sunTimes.nauticalDusk),
      // suncalc has no astronomicalDawn/Dusk keys: astronomical dawn is
      // nightEnd and astronomical dusk is night (start of astronomical night)
      astronomicalDawn: formatTime(sunTimes.nightEnd),
      astronomicalDusk: formatTime(sunTimes.night),
      dayLength,
    };
  }

  /**
   * Get sun times for a date range
   * @param params Parameters for the request
   * @returns Array of sun times information
   */
  getSunTimesRange(params: SunTimesRangeParams): SunTimesInfo[] {
    const startDate = new Date(params.start_date);
    const endDate = new Date(params.end_date);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error("Invalid date format. Please use YYYY-MM-DD format.");
    }

    if (startDate > endDate) {
      throw new Error("Start date must be before end date.");
    }

    const result: SunTimesInfo[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      result.push(
        this.getSunTimes({
          date: currentDate.toISOString().split("T")[0],
          latitude: params.latitude,
          longitude: params.longitude,
          timezone: params.timezone,
        }),
      );

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  }

  /**
   * Get sun position for a specific date, time, and location
   * @param params Parameters for the request
   * @returns Sun position information
   */
  getSunPosition(params: SunPositionParams): SunPositionInfo {
    const date = params.date ? new Date(params.date) : new Date();
    const time = params.time;
    const { latitude, longitude } = params;

    // Set the time if provided
    if (time) {
      const [hours, minutes, seconds] = time.split(":").map(Number);

      if (!isNaN(hours) && !isNaN(minutes) && (!seconds || !isNaN(seconds))) {
        date.setHours(hours, minutes, seconds || 0, 0);
      } else {
        throw new Error("Invalid time format. Please use HH:MM:SS format.");
      }
    }

    // Get sun position data
    const position = SunCalc.getPosition(date, latitude, longitude);

    // Calculate right ascension and declination (approximate values)
    // Note: These are approximate calculations and may not be precise
    const equatorialCoords = this.calculateEquatorialCoordinates(
      date,
      position.azimuth,
      position.altitude,
      latitude,
      longitude,
    );

    return {
      date: date.toISOString().split("T")[0],
      time: date.toISOString().split("T")[1].split(".")[0],
      azimuth: position.azimuth * (180 / Math.PI),
      altitude: position.altitude * (180 / Math.PI),
      declination: equatorialCoords.declination,
      rightAscension: equatorialCoords.rightAscension,
    };
  }

  /**
   * Get the next occurrence(s) of a specific sun event
   * @param params Parameters for the request
   * @returns Array of dates for the next occurrences of the specified event
   */
  getNextSunEvent(
    params: NextSunEventParams,
  ): { date: string; time: string; event: string }[] {
    const startDate = params.date ? new Date(params.date) : new Date();
    const count = params.count !== undefined ? params.count : 1;
    const { latitude, longitude } = params;
    const timezone = params.timezone !== undefined ? params.timezone : "UTC";

    const results: { date: string; time: string; event: string }[] = [];
    let currentDate = new Date(startDate);

    // Map our event names to suncalc's keys where they differ.
    const suncalcKeyOverrides: Partial<Record<string, string>> = {
      goldenHourStart: "goldenHour",
      astronomicalDawn: "nightEnd",
      astronomicalDusk: "night",
    };
    const eventKey =
      suncalcKeyOverrides[params.event as string] ?? (params.event as string);

    // Find the next occurrences
    while (results.length < count) {
      const sunTimes = SunCalc.getTimes(currentDate, latitude, longitude);
      const eventTime = sunTimes[eventKey as keyof typeof sunTimes];

      if (eventTime && !isNaN(eventTime.getTime()) && eventTime > startDate) {
        let formattedTime: string;

        try {
          formattedTime = eventTime.toLocaleTimeString("en-US", {
            timeZone: timezone,
          });
        } catch (error) {
          // If timezone is invalid, fall back to ISO string
          console.warn(`Invalid timezone: ${timezone}. Using UTC.`);
          formattedTime = eventTime.toISOString().split("T")[1].split(".")[0];
        }

        results.push({
          date: eventTime.toISOString().split("T")[0],
          time: formattedTime,
          event: params.event as string,
        });

        // Move to next day to find the next occurrence
        currentDate.setDate(currentDate.getDate() + 1);
      } else {
        // Event not found for this day, try next day
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Safety check to prevent infinite loops
      if (
        results.length === 0 &&
        currentDate.getTime() - startDate.getTime() > 366 * 24 * 60 * 60 * 1000
      ) {
        throw new Error(
          "Could not find the specified sun event within a year.",
        );
      }
    }

    return results;
  }

  /**
   * Calculate approximate equatorial coordinates (right ascension and declination)
   * from horizontal coordinates (azimuth and altitude)
   * Note: This is a simplified calculation and may not be precise
   * @param date Date of observation
   * @param azimuth Azimuth in radians
   * @param altitude Altitude in radians
   * @param latitude Observer's latitude
   * @param longitude Observer's longitude
   * @returns Approximate equatorial coordinates
   */
  private calculateEquatorialCoordinates(
    date: Date,
    azimuth: number,
    altitude: number,
    latitude: number,
    longitude: number,
  ): { rightAscension: number; declination: number } {
    // Convert degrees to radians
    const lat = latitude * (Math.PI / 180);

    // Calculate hour angle and declination
    const sinDec =
      Math.sin(altitude) * Math.sin(lat) +
      Math.cos(altitude) * Math.cos(lat) * Math.cos(azimuth);
    const declination = Math.asin(sinDec) * (180 / Math.PI);

    const cosH =
      (Math.sin(altitude) - Math.sin(lat) * sinDec) /
      (Math.cos(lat) * Math.cos(declination * (Math.PI / 180)));
    const hourAngle = Math.acos(Math.max(-1, Math.min(1, cosH)));

    // Adjust hour angle based on azimuth
    const adjustedHourAngle =
      azimuth > 0 && azimuth < Math.PI ? 2 * Math.PI - hourAngle : hourAngle;

    // Calculate right ascension
    const localSiderealTime = this.calculateLocalSiderealTime(date, longitude);
    let rightAscension =
      (localSiderealTime - adjustedHourAngle) * (12 / Math.PI);

    // Normalize right ascension to 0-24 hours
    rightAscension = rightAscension % 24;
    if (rightAscension < 0) rightAscension += 24;

    return { rightAscension, declination };
  }

  /**
   * Calculate approximate local sidereal time
   * @param date Date of observation
   * @param longitude Observer's longitude
   * @returns Local sidereal time in radians
   */
  private calculateLocalSiderealTime(date: Date, longitude: number): number {
    // Calculate days since J2000.0
    const jd = this.calculateJulianDay(date);
    const d = jd - 2451545.0;

    // Calculate Greenwich Mean Sidereal Time
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;

    // Convert longitude to hours and calculate local sidereal time
    const longitudeHours = longitude / 15;
    let lst = gmst + longitudeHours;

    // Normalize to 0-24 hours
    lst = lst % 24;
    if (lst < 0) lst += 24;

    // Convert to radians
    return lst * (Math.PI / 12);
  }

  /**
   * Calculate Julian day from date
   * @param date Date to convert
   * @returns Julian day
   */
  private calculateJulianDay(date: Date): number {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();

    // Calculate Julian day
    const jd =
      367 * y -
      Math.floor((7 * (y + Math.floor((m + 9) / 12))) / 4) -
      Math.floor((3 * (Math.floor((y + (m - 9) / 7) / 100) + 1)) / 4) +
      Math.floor((275 * m) / 9) +
      d +
      1721028.5;

    // Add time of day
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const seconds = date.getUTCSeconds();
    const milliseconds = date.getUTCMilliseconds();

    return (
      jd + (hours + minutes / 60 + seconds / 3600 + milliseconds / 3600000) / 24
    );
  }
}
