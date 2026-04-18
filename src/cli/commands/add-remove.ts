import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { allWriters, writerById } from "../clients/registry.js";
import { logger } from "../../util/logger.js";
import { WriteOperation } from "../clients/base.js";

function apply(ops: WriteOperation[], dryRun: boolean): void {
  for (const op of ops) {
    if (op.contents === null) continue;
    const label = relative(process.cwd(), op.path) || op.path;
    if (dryRun) {
      logger.log(`  \x1b[36m◦\x1b[0m ${label}  \x1b[90m${op.description}\x1b[0m`);
      continue;
    }
    mkdirSync(dirname(op.path), { recursive: true });
    writeFileSync(op.path, op.contents, "utf8");
    logger.log(`  \x1b[32m✓\x1b[0m ${label}`);
  }
}

export function runAdd(clientId: string, dryRun = false): void {
  const writer = writerById(clientId);
  if (!writer) {
    logger.error(`Unknown client '${clientId}'. Available: ${allWriters().map((w) => w.info().id).join(", ")}`);
    process.exit(1);
  }
  apply(writer.planInstall(), dryRun);
}

export function runRemove(clientId: string, dryRun = false): void {
  const writer = writerById(clientId);
  if (!writer) {
    logger.error(`Unknown client '${clientId}'. Available: ${allWriters().map((w) => w.info().id).join(", ")}`);
    process.exit(1);
  }
  const ops = writer.planUninstall();
  if (ops.length === 0) {
    logger.info(`${writer.info().name} is not currently configured.`);
    return;
  }
  apply(ops, dryRun);
}

export function runList(): void {
  logger.log("\n\x1b[1mAvailable clients:\x1b[0m");
  for (const writer of allWriters()) {
    const detect = writer.detect();
    const marker = detect.detected ? "\x1b[32m✓\x1b[0m" : "\x1b[90m·\x1b[0m";
    const info = writer.info();
    logger.log(
      `  ${marker} ${info.id.padEnd(18)} ${info.name.padEnd(24)} ${existsSync(info.configPath) ? "" : "\x1b[90m(not installed)\x1b[0m"}`,
    );
  }
  logger.log("");
}
