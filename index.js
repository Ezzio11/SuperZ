#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server, loadEnv } from "./src/index.js";
import { dirname } from "path";
import { fileURLToPath } from "url";

// Load environment variables from the same directory as this script
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv(__dirname);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Prompt Compressor MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
