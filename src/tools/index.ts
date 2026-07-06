/**
 * Central registration for all tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWaterTools } from "./water.js";
import { registerCurrentTools } from "./currents.js";
import { registerMetTools } from "./met.js";
import { registerStationTools } from "./stations.js";
import { registerStationMetadataTools } from "./station-metadata.js";
import { registerDerivedProductTools } from "./derived.js";
import { registerAstronomyTools } from "./astronomy.js";
import { registerMarineForecastTools } from "./marine-forecast.js";
import { registerReferenceTools } from "./reference.js";

export function registerAllTools(server: McpServer): void {
  registerWaterTools(server);
  registerCurrentTools(server);
  registerMetTools(server);
  registerStationTools(server);
  registerStationMetadataTools(server);
  registerDerivedProductTools(server);
  registerAstronomyTools(server);
  registerMarineForecastTools(server);
  registerReferenceTools(server);
}
