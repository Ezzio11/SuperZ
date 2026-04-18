import { Command } from "commander";
import { runInit } from "./cli/commands/init.js";
import { runDoctor } from "./cli/commands/doctor.js";
import { runStats } from "./cli/commands/stats.js";
import { runAdd, runList, runRemove } from "./cli/commands/add-remove.js";
import { runServe } from "./cli/commands/serve.js";
import { logger } from "./util/logger.js";

const program = new Command();

program
  .name("superz")
  .description("SuperZ — universal installer, MCP server, and CLI for the Prompt Compressor")
  .version("2.0.0");

program
  .command("init")
  .description("Detect installed MCP-compatible clients and register prompt-compressor in each")
  .option("-y, --yes", "Accept all default selections without prompting")
  .option("-a, --all", "Install into every detected client without prompting")
  .option("--dry-run", "Show what would be written without touching the filesystem")
  .option("--only <ids...>", "Install into only the listed client IDs (space-separated)")
  .action(async (opts) => {
    await runInit(opts);
  });

program
  .command("doctor")
  .description("Ping every configured provider and verify every client config references prompt-compressor")
  .action(async () => {
    await runDoctor();
  });

program
  .command("stats")
  .description("Print cumulative compression metrics (latency, win-rate, tokens saved)")
  .option(
    "--from <source>",
    "Source of stats: 'metrics' (default, cumulative process metrics) or 'usage-log' (real-world JSONL log)",
    "metrics",
  )
  .option("--window <duration>", "Only used with --from=usage-log. Example: 7d, 24h, 30m")
  .option("--path <path>", "Override usage log path (defaults to <SUPERZ_HOME>/usage.log.jsonl)")
  .action((opts: { from?: string; window?: string; path?: string }) => {
    const source = opts.from === "usage-log" ? "usage-log" : "metrics";
    runStats({ source, window: opts.window, path: opts.path });
  });

program
  .command("list")
  .alias("ls")
  .description("List all supported clients and show which are detected")
  .action(() => {
    runList();
  });

program
  .command("add <client>")
  .description("Install prompt-compressor into a single client (e.g. `superz add cursor`)")
  .option("--dry-run", "Show what would be written without touching the filesystem")
  .action((client: string, opts: { dryRun?: boolean }) => {
    runAdd(client, Boolean(opts.dryRun));
  });

program
  .command("remove <client>")
  .description("Remove prompt-compressor from a single client")
  .option("--dry-run", "Show what would be written without touching the filesystem")
  .action((client: string, opts: { dryRun?: boolean }) => {
    runRemove(client, Boolean(opts.dryRun));
  });

program
  .command("serve")
  .description("Run the MCP server directly (default: stdio; use --http for HTTP/SSE + REST)")
  .option("--http", "Run the HTTP+SSE transport plus the REST /v1/compress endpoint")
  .option("--host <host>", "Host to bind", "127.0.0.1")
  .option("--port <port>", "Port to bind", (v) => Number(v), 7420)
  .option("--cors", "Enable permissive CORS (HTTP mode only)")
  .option("--token <token>", "Require a bearer token on HTTP endpoints")
  .action(async (opts: { http?: boolean; host?: string; port?: number; cors?: boolean; token?: string }) => {
    await runServe(opts);
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error(err);
  process.exit(1);
});
