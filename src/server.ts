import { runStdio } from "./mcp/transports/stdio.js";
import { tagged } from "./util/logger.js";

const log = tagged("server");

runStdio().catch((err) => {
  log.error("MCP server failed to start:", err);
  process.exit(1);
});
