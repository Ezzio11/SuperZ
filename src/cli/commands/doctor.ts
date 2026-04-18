import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "../../config/load.js";
import { callOpenAICompatible } from "../../providers/base.js";
import { SYSTEM_PROMPT } from "../../engine/system-prompt.js";
import { allWriters } from "../clients/registry.js";
import { logger } from "../../util/logger.js";

const OK = "\x1b[32m✓\x1b[0m";
const WARN = "\x1b[33m!\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";

export async function runDoctor(): Promise<void> {
  logger.log("\n\x1b[1mSuperZ Doctor\x1b[0m");
  logger.log("Running health checks against your configuration...\n");

  logger.log("Providers:");
  const config = loadConfig();
  const testPrompt =
    "This is a connectivity test. Compress this sentence without changing its meaning.";
  for (const provider of config.providers) {
    if (!provider.apiKey) {
      logger.log(`  ${WARN} ${provider.name.padEnd(14)} no API key set`);
      continue;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), provider.timeoutMs);
    try {
      const result = await callOpenAICompatible(provider, SYSTEM_PROMPT, testPrompt, abort.signal);
      logger.log(`  ${OK} ${provider.name.padEnd(14)} ok (${result.latencyMs}ms)`);
    } catch (err) {
      logger.log(
        `  ${FAIL} ${provider.name.padEnd(14)} ${(err as Error).message.slice(0, 80)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  logger.log("\nClients:");
  for (const writer of allWriters()) {
    const info = writer.info();
    const detection = writer.detect();
    if (!detection.detected) {
      logger.log(`  ${WARN} ${info.name.padEnd(22)} not installed`);
      continue;
    }
    if (!existsSync(info.configPath)) {
      logger.log(`  ${WARN} ${info.name.padEnd(22)} no config at ${info.configPath}`);
      continue;
    }
    try {
      const body = readFileSync(info.configPath, "utf8");
      if (body.includes("prompt-compressor")) {
        logger.log(`  ${OK} ${info.name.padEnd(22)} configured`);
      } else {
        logger.log(`  ${WARN} ${info.name.padEnd(22)} config exists but missing prompt-compressor`);
      }
    } catch (err) {
      logger.log(`  ${FAIL} ${info.name.padEnd(22)} unreadable (${(err as Error).message})`);
    }
  }

  logger.log("");
}
