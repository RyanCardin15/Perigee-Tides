#!/usr/bin/env node
/**
 * NOAA Tides and Currents MCP server.
 *
 * Exposes NOAA CO-OPS data (water levels, tide predictions, currents,
 * meteorology), station metadata (datums, harmonic constituents, offsets),
 * derived products (sea level trends/projections, extreme water levels,
 * high tide flooding), and local sun/moon calculations.
 *
 * Transport: stdio by default (for MCP client integration); pass --http
 * [--port N] for a stateless streamable-HTTP endpoint at /mcp.
 *
 * IMPORTANT: never write to stdout in stdio mode — it is the JSON-RPC
 * channel. All logging goes to stderr.
 */

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { SERVER_NAME } from "./constants.js";
import { registerAllTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version });
  registerAllTools(server);
  registerResources(server);
  registerPrompts(server);
  return server;
}

async function runStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${version} running on stdio`);
}

async function runHttp(port: number): Promise<void> {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    // Stateless: a fresh server+transport per request avoids request-ID
    // collisions across clients.
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(port, () => {
    console.error(
      `${SERVER_NAME} v${version} running at http://localhost:${port}/mcp`,
    );
  });
}

const args = process.argv.slice(2);
if (args.includes("--http")) {
  const portIndex = args.indexOf("--port");
  const portRaw = portIndex !== -1 ? Number(args[portIndex + 1]) : 3000;
  const port =
    Number.isInteger(portRaw) && portRaw > 0 && portRaw < 65536
      ? portRaw
      : 3000;
  runHttp(port).catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
