import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CompressionEngine } from "../engine/compress.js";

/**
 * Register the `compress_prompt` tool on an MCP server instance.
 * Kept separate from server construction so we can reuse it across
 * stdio and HTTP transports without duplicating logic.
 */
export function registerTools(server: McpServer, engine: CompressionEngine): void {
  server.tool(
    "compress_prompt",
    "Compresses a verbose prompt to minimize token usage while preserving full intent. Uses parallel provider racing with safety validation of negative constraints.",
    {
      prompt: z.string().describe("The original prompt to compress"),
      force: z
        .boolean()
        .optional()
        .describe("Skip the length/conversational bypass heuristic and always compress"),
    },
    async ({ prompt, force }) => {
      const result = await engine.compress(prompt, { force });

      const statsBits = [
        result.bypassed ? "Bypass" : result.provider,
        `~${result.savedTokens} tokens saved`,
        `${result.percentSaved}% smaller`,
      ];
      if (result.cacheHit) statsBits.push("cache-hit");
      const stats = `[${statsBits.join(" | ")}]`;
      const log = result.errors.length
        ? `\n*(Log: ${result.errors.join(" ")})*`
        : "";

      return {
        content: [
          {
            type: "text",
            text: `${result.compressed}\n\n${stats}${log}`,
          },
        ],
      };
    },
  );

  server.tool(
    "prompt_compressor_stats",
    "Returns cumulative compression metrics for the current SuperZ instance.",
    {},
    async () => {
      const snapshot = (await import("../util/metrics.js")).getMetrics().snapshotRead();
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
      };
    },
  );
}

export function createServer(): McpServer {
  return new McpServer({
    name: "prompt-compressor",
    version: "2.0.0",
  });
}
