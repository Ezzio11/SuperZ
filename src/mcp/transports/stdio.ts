import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../../config/load.js";
import { CompressionEngine } from "../../engine/compress.js";
import { tagged } from "../../util/logger.js";
import { createServer, registerTools } from "../tools.js";

const log = tagged("mcp-stdio");

export async function runStdio(): Promise<void> {
  const config = loadConfig();
  const engine = new CompressionEngine(config);
  const server = createServer();
  registerTools(server, engine);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server running on stdio");
}
