/**
 * Response shaping shared by every tool.
 *
 * Each tool supports `response_format`: "markdown" (default, human-readable
 * tables with units spelled out) or "json" (complete structured payload).
 * Structured content is attached in both modes so MCP clients that support
 * it can consume typed output. Responses longer than CHARACTER_LIMIT are
 * rejected with narrowing guidance, including their structured payload.
 */

import { z } from "zod";
import { CHARACTER_LIMIT } from "../constants.js";

/** Stable delivery contract; provider/domain fields remain additive. */
export const RawToolOutputSchema = z
  .object({
    _response: z
      .object({
        contractVersion: z.literal("2026-09-29.1"),
        status: z.literal("complete"),
      })
      .strict(),
  })
  .passthrough();

export type ResponseFormat = "markdown" | "json";

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Build a successful tool response in the requested format. */
export function respond(
  format: ResponseFormat,
  structured: Record<string, unknown>,
  markdown: string,
): ToolResult {
  const payload = {
    ...structured,
    _response: { contractVersion: "2026-09-29.1", status: "complete" },
  };
  const json = JSON.stringify(payload);
  const text = format === "json" ? json : markdown;
  if (json.length > CHARACTER_LIMIT || text.length > CHARACTER_LIMIT) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "The complete response exceeds the delivery limit. Narrow the date range, lower the limit, or request fewer fields; no partial result is presented as complete.",
        },
      ],
      _meta: {
        error: {
          code: "response_too_large",
          retryable: false,
          limitCharacters: CHARACTER_LIMIT,
        },
      },
    };
  }
  return { content: [{ type: "text", text }], structuredContent: payload };
}

/** Build an error tool response (kept inside the result per MCP guidance). */
export function respondError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    _meta: {
      error: {
        code: "provider_error",
        retryable:
          (error as { status?: number })?.status === undefined ||
          (error as { status?: number }).status === 429 ||
          ((error as { status?: number }).status ?? 0) >= 500,
      },
    },
    content: [{ type: "text", text: `Error: ${message}` }],
  };
}

/** Render an array of records as a compact GitHub-flavored markdown table. */
export function markdownTable(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map(
      (row) =>
        `| ${row.map((cell) => (cell === null || cell === undefined || cell === "" ? "—" : String(cell))).join(" | ")} |`,
    ),
  ];
  return lines.join("\n");
}
