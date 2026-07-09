/**
 * Station scientific metadata tools: datums, harmonic constituents,
 * prediction offsets.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { extractList, getStationResource } from "../services/metadata-api.js";
import {
  READ_ONLY_ANNOTATIONS,
  ResponseFormatSchema,
  StationIdSchema,
  UnitsSchema,
} from "../schemas/common.js";
import { markdownTable, respond, respondError } from "../format/respond.js";
import { unitLabel } from "../format/units.js";

export function registerStationMetadataTools(server: McpServer): void {
  server.registerTool(
    "noaa_get_station_datums",
    {
      title: "Get Station Datums",
      description: `Get the accepted tidal datum values for a station: the elevations of MHHW, MHW, MTL, MSL, DTL, MLW, MLLW, STND, NAVD88 (where computed), plus GT (great diurnal range), MN (mean range), LAT/HAT (lowest/highest astronomical tide), and the station's historical extreme min/max water levels with dates.

epoch "current" returns the present National Tidal Datum Epoch (1983–2001) values; "superseded" returns the prior epoch's values (useful for historical comparisons — not all stations have one).

All values share one reference zero (the station datum), so datum-to-datum conversion is subtraction: height_above_MLLW = height_above_MSL + (MSL − MLLW). Use this tool to (1) check which datums a station supports before requesting data, and (2) convert heights between datums.`,
      inputSchema: {
        station: StationIdSchema,
        epoch: z
          .enum(["current", "superseded"])
          .default("current")
          .describe(
            '"current" = present NTDE (1983–2001); "superseded" = prior epoch values.',
          ),
        units: UnitsSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const resource =
          params.epoch === "superseded" ? "supersededdatums" : "datums";
        const payload = await getStationResource(params.station, resource, {
          units: params.units,
        });
        const datums = extractList<{
          name: string;
          description: string;
          value: number;
        }>(payload, "datums", "datumList");
        const heightUnits = unitLabel("water_level", params.units);
        const structured = {
          station: params.station,
          epoch_requested: params.epoch,
          epoch: payload.epoch,
          units_label: heightUnits,
          orthometric_datum: payload.OrthometricDatum,
          datums,
          LAT: payload.LAT,
          HAT: payload.HAT,
          historic_min: payload.min,
          historic_min_date: payload.mindate,
          historic_max: payload.max,
          historic_max_date: payload.maxdate,
        };
        const lines = [
          `# Tidal Datums — Station ${params.station}`,
          "",
          `**Epoch**: ${String(payload.epoch ?? "n/a")} (${params.epoch}) · **Units**: ${heightUnits} above station datum`,
          "",
          datums.length === 0
            ? "_No datums published for this station and epoch._"
            : markdownTable(
                ["Datum", "Description", `Value (${heightUnits})`],
                datums.map((d) => [d.name, d.description, d.value]),
              ),
          "",
          `- **HAT** (highest astronomical tide): ${String(payload.HAT ?? "—")} · **LAT**: ${String(payload.LAT ?? "—")}`,
          `- **Historic max**: ${String(payload.max ?? "—")} on ${String(payload.maxdate ?? "—")} · **Historic min**: ${String(payload.min ?? "—")} on ${String(payload.mindate ?? "—")}`,
        ];
        return respond(params.response_format, structured, lines.join("\n"));
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_harmonic_constituents",
    {
      title: "Get Harmonic Constituents",
      description: `Get the harmonic constituents NOAA uses to compute tide or current predictions at a station — the amplitude, phase, and angular speed of each tidal constituent (M2, S2, N2, K1, O1, ...).

For water-level stations: amplitude (feet/meters), phase_GMT and phase_local (degrees), speed (degrees/hour). For current stations (alphanumeric IDs) constituents are current ellipses (major/minor amplitudes and phases per depth bin — pass bin to filter).

Use for: building custom tide computations, checking a station's dominant constituents (M2 amplitude indicates semidiurnal range), verifying whether a station is harmonically predicted at all. Only reference (R) stations have constituents — subordinate stations use offsets (noaa_get_prediction_offsets).`,
      inputSchema: {
        station: StationIdSchema,
        bin: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("For current stations: restrict to one depth bin."),
        units: UnitsSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const payload = await getStationResource(params.station, "harcon", {
          units: params.units,
          bin: params.bin,
        });
        const constituents = extractList<Record<string, unknown>>(
          payload,
          "HarmonicConstituents",
          "harmonicConstituents",
          "harconList",
        );
        const isCurrentStation = constituents[0]?.majorAmplitude !== undefined;
        // Water-level harcon amplitudes are heights (feet/meters). Current
        // harcon reports a compound units string like "meters, centimeters/second"
        // (bin depth, amplitude) — prefer NOAA's own label when present.
        const amplitudeUnits =
          typeof payload.units === "string" && payload.units
            ? payload.units
            : unitLabel(
                isCurrentStation ? "currents" : "water_level",
                params.units,
              );
        const structured = {
          station: params.station,
          bin: params.bin,
          amplitude_units: amplitudeUnits,
          count: constituents.length,
          constituents,
        };
        const markdown = [
          `# Harmonic Constituents — Station ${params.station}${params.bin ? ` (bin ${params.bin})` : ""}`,
          "",
          `**Count**: ${constituents.length} · **Amplitude units**: ${amplitudeUnits} · phases in degrees, speed in degrees/hour`,
          "",
          constituents.length === 0
            ? "_No harmonic constituents published — this may be a subordinate station (see noaa_get_prediction_offsets)._"
            : isCurrentStation
              ? markdownTable(
                  [
                    "#",
                    "Name",
                    "Major amp",
                    "Major phase (GMT)",
                    "Minor amp",
                    "Speed",
                    "Bin",
                  ],
                  constituents.map((c) => [
                    String(c.constNum ?? c.number ?? ""),
                    String(c.constituentName ?? c.name ?? ""),
                    String(c.majorAmplitude ?? ""),
                    String(c.majorPhaseGMT ?? ""),
                    String(c.minorAmplitude ?? ""),
                    String(c.majorMeanSpeed ?? ""),
                    String(c.binNbr ?? ""),
                  ]),
                )
              : markdownTable(
                  [
                    "#",
                    "Name",
                    "Description",
                    `Amplitude (${amplitudeUnits})`,
                    "Phase GMT (°)",
                    "Phase local (°)",
                    "Speed (°/hr)",
                  ],
                  constituents.map((c) => [
                    String(c.number ?? ""),
                    String(c.name ?? ""),
                    String(c.description ?? ""),
                    String(c.amplitude ?? ""),
                    String(c.phase_GMT ?? ""),
                    String(c.phase_local ?? ""),
                    String(c.speed ?? ""),
                  ]),
                ),
        ].join("\n");
        return respond(params.response_format, structured, markdown);
      } catch (error) {
        return respondError(error);
      }
    },
  );

  server.registerTool(
    "noaa_get_prediction_offsets",
    {
      title: "Get Prediction Offsets (Subordinate Stations)",
      description: `Get the offsets a subordinate (type "S") prediction station applies to its reference station's predictions.

kind "tide": returns refStationId, time offsets for high/low tide (minutes), height offsets for high/low tide, and whether the height adjustment is a ratio (multiplied) or fixed value — this is how NOAA derives subordinate-station tide times from the reference harmonic station.

kind "current": returns refStationId/bin, mean flood/ebb directions, and time adjustments (minutes) for max flood, slack-before-ebb, max ebb, slack-before-flood plus amplitude ratios. Note: current prediction offsets are indexed per bin — pass the station_bin_suffix ID form (e.g. "ACT0091_1") if the plain ID returns nothing.

Reference (R) stations return empty/null offsets — they don't need any.`,
      inputSchema: {
        station: StationIdSchema,
        kind: z
          .enum(["tide", "current"])
          .default("tide")
          .describe(
            '"tide" = tidepredoffsets; "current" = currentpredictionoffsets.',
          ),
        response_format: ResponseFormatSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const resource =
          params.kind === "tide"
            ? "tidepredoffsets"
            : "currentpredictionoffsets";
        const payload = await getStationResource(params.station, resource);
        const structured = {
          station: params.station,
          kind: params.kind,
          offsets: payload,
        };
        const lines: string[] = [
          `# Prediction Offsets (${params.kind}) — Station ${params.station}`,
          "",
        ];
        if (params.kind === "tide") {
          const p = payload as Record<string, unknown>;
          if (!p.refStationId) {
            lines.push(
              "_No offsets — this is likely a reference (R) station with its own harmonic constituents, or has no published offsets._",
            );
          } else {
            lines.push(
              `- **Reference station**: ${String(p.refStationId)}`,
              `- **High tide**: time offset ${String(p.timeOffsetHighTide ?? "—")} min, height offset ${String(p.heightOffsetHighTide ?? "—")}`,
              `- **Low tide**: time offset ${String(p.timeOffsetLowTide ?? "—")} min, height offset ${String(p.heightOffsetLowTide ?? "—")}`,
              `- **Height adjustment type**: ${String(p.heightAdjustedType ?? "—")} (R = ratio/multiplier, F = fixed additive)`,
            );
          }
        } else {
          lines.push("```json", JSON.stringify(payload, null, 2), "```");
        }
        return respond(params.response_format, structured, lines.join("\n"));
      } catch (error) {
        return respondError(error);
      }
    },
  );
}
