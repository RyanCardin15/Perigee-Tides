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
import { registerSolunarTools } from "./solunar.js";
import { registerBuoyTools } from "./buoys.js";
import { registerMarineConditionsTools } from "./marine-conditions.js";
import { registerChartsUiResource } from "../ui/app-resource.js";

export function registerAllTools(server: McpServer): void {
  // The shared MCP-app template must exist before app tools reference it.
  registerChartsUiResource(server);
  registerWaterTools(server);
  registerCurrentTools(server);
  registerMetTools(server);
  registerStationTools(server);
  registerStationMetadataTools(server);
  registerDerivedProductTools(server);
  registerAstronomyTools(server);
  registerSolunarTools(server);
  registerBuoyTools(server);
  registerMarineForecastTools(server);
  registerMarineConditionsTools(server);
  registerReferenceTools(server);
}
