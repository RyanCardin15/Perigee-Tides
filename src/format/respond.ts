/**
 * Response shaping shared by every tool.
 *
 * Each tool supports `response_format`: "markdown" (default, human-readable
 * tables with units spelled out) or "json" (complete structured payload).
 * Structured content is attached in both modes so MCP clients that support
 * it can consume typed output. Responses longer than CHARACTER_LIMIT are
 * truncated with guidance rather than flooding the agent's context.
 */

import { CHARACTER_LIMIT } from "../constants.js";

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
  let text = format === "json" ? JSON.stringify(structured, null, 2) : markdown;
  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT) +
      "\n\n…[truncated: response exceeded the size limit. Narrow the date range, lower the limit parameter, or request fewer fields.]";
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
  };
}

/** Build an error tool response (kept inside the result per MCP guidance). */
export function respondError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
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
