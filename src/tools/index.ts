/**
 * Central registration for all tools.
 */

import { withProviderDeadline } from "../client/deadline.js";
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
  // Keep a provider deadline across chained reads within one tool invocation.
  // The facade preserves registration state on the real SDK server.
  server = new Proxy(server, {
    get(target, key, receiver) {
      if (key !== "registerTool") return Reflect.get(target, key, receiver);
      return (
        name: string,
        config: Parameters<McpServer["registerTool"]>[1],
        callback: (...args: unknown[]) => Promise<unknown>,
      ) =>
        target.registerTool(name, config, ((...args: unknown[]) =>
          withProviderDeadline(() => callback(...args), 45_000)) as Parameters<
          McpServer["registerTool"]
        >[2]);
    },
  });
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
