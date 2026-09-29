import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, it } from "vitest";
import { registerAllTools } from "../src/tools/index.js";
import {
  providerDeadline,
  withProviderDeadline,
} from "../src/client/deadline.js";

it("advertises output contracts for every raw tool and delivers versioned complete astronomy results", async () => {
  const server = new McpServer({ name: "contract-test", version: "2.1.0" });
  registerAllTools(server);
  const client = new Client({ name: "contract-client", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(25);
    for (const tool of tools) expect(tool.outputSchema?.type).toBe("object");
    const result = await client.callTool({
      name: "astro_get_moon_phase",
      arguments: { date: "2026-09-29", response_format: "json" },
    });
    expect(result.structuredContent).toMatchObject({
      _response: { contractVersion: "2026-09-29.1", status: "complete" },
    });
    expect(
      JSON.parse((result.content as Array<{ text: string }>)[0].text),
    ).toEqual(result.structuredContent);
  } finally {
    await client.close();
    await server.close();
  }
});
it("propagates cancellation into nested provider operations without affecting a parallel operation", async () => {
  const wait = () =>
    new Promise<void>((resolve) =>
      providerDeadline()!.signal.addEventListener("abort", () => resolve(), {
        once: true,
      }),
    );
  await Promise.all([
    withProviderDeadline(async () => {
      const outer = providerDeadline()!;
      await withProviderDeadline(wait, 500);
      expect(outer.signal.aborted).toBe(true);
    }, 20),
    withProviderDeadline(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(providerDeadline()!.signal.aborted).toBe(false);
    }, 500),
  ]);
  expect(providerDeadline()).toBeUndefined();
});
