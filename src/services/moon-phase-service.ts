import SunCalc from "suncalc";
import {
  MoonPhaseParams,
  MoonPhasesRangeParams,
  NextMoonPhaseParams,
} from "../interfaces/moon.js";
import { MoonPhaseName, MoonPhaseInfo } from "../types/moon.js";

/**
 * Service for moon phase calculations
 */
export class MoonPhaseService {
  /**
   * Get the moon phase for a specific date
   * @param params Parameters for the request
   * @returns Moon phase information
   */
  getMoonPhase(params: MoonPhaseParams): MoonPhaseInfo {
    const date = params.date ? new Date(params.date) : new Date();

    // Get moon illumination data
    const illuminationData = SunCalc.getMoonIllumination(date);

    // Get moon position data (requires location)
    const latitude = params.latitude ?? 0;
    const longitude = params.longitude ?? 0;
    const positionData = SunCalc.getMoonPosition(date, latitude, longitude);

    // Calculate moon phase name
    const phaseName = this.getMoonPhaseName(illuminationData.phase);

    // Calculate if the moon is waxing (increasing illumination)
    const isWaxing = illuminationData.phase < 0.5;

    // Calculate approximate moon age (0-29.53 days)
    const lunarMonth = 29.53; // days
    const age = illuminationData.phase * lunarMonth;

    // Calculate apparent diameter (in degrees)
    const diameter = 0.5181 * (384400 / positionData.distance);

    return {
      date: date.toISOString().split("T")[0],
      phase: illuminationData.phase,
      phaseName,
      illumination: illuminationData.fraction,
      age,
      distance: positionData.distance,
      diameter,
      isWaxing,
    };
  }

  /**
   * Get moon phases for a date range
   * @param params Parameters for the request
   * @returns Array of moon phase information
   */
  getMoonPhasesRange(params: MoonPhasesRangeParams): MoonPhaseInfo[] {
    const startDate = new Date(params.start_date);
    const endDate = new Date(params.end_date);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error("Invalid date format. Please use YYYY-MM-DD format.");
    }

    if (startDate > endDate) {
      throw new Error("Start date must be before end date.");
    }

    const result: MoonPhaseInfo[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      result.push(
        this.getMoonPhase({
          date: currentDate.toISOString().split("T")[0],
          latitude: params.latitude,
          longitude: params.longitude,
        }),
      );

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  }

  /**
   * Get the next occurrence(s) of a specific moon phase
   * @param params Parameters for the request
   * @returns Array of dates for the next occurrences of the specified phase
   */
  getNextMoonPhase(
    params: NextMoonPhaseParams,
  ): { date: string; phase: string }[] {
    const startDate = params.date ? new Date(params.date) : new Date();
    const count = params.count || 1;
    const targetPhase = params.phase;

    // Map phase names to their approximate values
    const phaseValues: Record<string, number> = {
      [MoonPhaseName.NEW_MOON]: 0,
      [MoonPhaseName.FIRST_QUARTER]: 0.25,
      [MoonPhaseName.FULL_MOON]: 0.5,
      [MoonPhaseName.LAST_QUARTER]: 0.75,
    };

    const targetPhaseValue = phaseValues[targetPhase];
    const results: { date: string; phase: string }[] = [];
    let currentDate = new Date(startDate);

    // Signed circular offset of a phase from the target, in [-0.5, 0.5).
    // The lunar phase is cyclic (0 and 1 are both new moon), so plain
    // |phase - target| breaks at the wraparound.
    const signedDelta = (phase: number): number =>
      ((phase - targetPhaseValue + 1.5) % 1) - 0.5;

    // The phase advances ~0.034/day, so the target is hit on the day where
    // the signed offset crosses from negative to non-negative.
    while (results.length < count) {
      const prevDate = new Date(currentDate);
      prevDate.setDate(prevDate.getDate() - 1);
      const prev = signedDelta(SunCalc.getMoonIllumination(prevDate).phase);
      const curr = signedDelta(SunCalc.getMoonIllumination(currentDate).phase);

      if (prev < 0 && curr >= 0) {
        results.push({
          date: currentDate.toISOString().split("T")[0],
          phase: targetPhase,
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);

      if (
        currentDate.getTime() - startDate.getTime() >
        (count + 1) * 31 * 24 * 60 * 60 * 1000
      ) {
        throw new Error(
          "Could not find the specified moon phase within the expected window.",
        );
      }
    }

    return results;
  }

  /**
   * Get the moon phase name based on the phase value (0-1)
   * @param phase Phase value (0-1)
   * @returns Moon phase name
   */
  private getMoonPhaseName(phase: number): MoonPhaseName {
    // Normalize phase to 0-1 range
    const normalizedPhase =
      phase < 0 ? phase + 1 : phase > 1 ? phase - 1 : phase;

    // Determine moon phase based on the value
    if (normalizedPhase < 0.0625 || normalizedPhase >= 0.9375) {
      return MoonPhaseName.NEW_MOON;
    } else if (normalizedPhase < 0.1875) {
      return MoonPhaseName.WAXING_CRESCENT;
    } else if (normalizedPhase < 0.3125) {
      return MoonPhaseName.FIRST_QUARTER;
    } else if (normalizedPhase < 0.4375) {
      return MoonPhaseName.WAXING_GIBBOUS;
    } else if (normalizedPhase < 0.5625) {
      return MoonPhaseName.FULL_MOON;
    } else if (normalizedPhase < 0.6875) {
      return MoonPhaseName.WANING_GIBBOUS;
    } else if (normalizedPhase < 0.8125) {
      return MoonPhaseName.LAST_QUARTER;
    } else {
      return MoonPhaseName.WANING_CRESCENT;
    }
  }
}
