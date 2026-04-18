import { getMetrics } from "../../util/metrics.js";
import { logger } from "../../util/logger.js";
import { summarizeUsageLog } from "../../util/usage-log.js";

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms === 0) return "   -";
  if (ms < 1000) return `${ms.toFixed(0).padStart(4)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function p(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * quantile));
  return sorted[idx] ?? 0;
}

export interface StatsOptions {
  source?: "metrics" | "usage-log";
  window?: string;
  path?: string;
}

export function runStats(options: StatsOptions = {}): void {
  if (options.source === "usage-log") {
    renderUsageLogStats(options);
    return;
  }
  renderCumulativeMetrics();
}

function renderCumulativeMetrics(): void {
  const snap = getMetrics().snapshotRead();
  logger.log("\n\x1b[1mSuperZ Metrics\x1b[0m");
  logger.log(`  Since:              ${new Date(snap.startedAt).toISOString()}`);
  logger.log(`  Total requests:     ${snap.totalRequests}`);
  logger.log(`  Bypassed:           ${snap.totalBypassed}`);
  logger.log(`  Cache hits:         ${snap.totalCacheHits}`);
  logger.log(`  Tokens saved:       ${snap.totalTokensSaved.toLocaleString()}`);
  logger.log(`  Tokens in:          ${snap.totalOriginalTokens.toLocaleString()}`);
  logger.log(`  Tokens out:         ${snap.totalCompressedTokens.toLocaleString()}`);
  const compression =
    snap.totalOriginalTokens > 0
      ? (((snap.totalOriginalTokens - snap.totalCompressedTokens) / snap.totalOriginalTokens) * 100).toFixed(1)
      : "0.0";
  logger.log(`  Avg reduction:      ${compression}%`);

  logger.log("\n  Provider              Attempts   Wins   Fails   p50       p95");
  logger.log("  " + "─".repeat(63));
  const names = Object.keys(snap.providers).sort();
  for (const name of names) {
    const s = snap.providers[name];
    if (!s) continue;
    logger.log(
      `  ${name.padEnd(22)}${String(s.attempts).padStart(8)}${String(s.wins).padStart(7)}${String(s.failures).padStart(8)}   ${formatMs(p(s.latencySamples, 0.5))}   ${formatMs(p(s.latencySamples, 0.95))}`,
    );
  }
  logger.log("");
}

function renderUsageLogStats(options: StatsOptions): void {
  const summary = summarizeUsageLog({ window: options.window, path: options.path });
  logger.log("\n\x1b[1mSuperZ Usage Log\x1b[0m");
  logger.log(`  Source file:        ${summary.path}`);
  logger.log(`  Window:             ${options.window ?? "all"}`);
  logger.log(`  Range:              ${summary.windowStart ?? "-"}  to  ${summary.windowEnd ?? "-"}`);
  logger.log(`  Total entries:      ${summary.totalEntries}`);
  if (summary.totalEntries === 0) {
    logger.log(
      `\n  (empty) Enable logging with: SUPERZ_USAGE_LOG=1 before running compressions.\n`,
    );
    return;
  }
  logger.log(`  Compressed:         ${summary.compressed}`);
  logger.log(`  Bypassed:           ${summary.bypassed}`);
  logger.log(`  Cache hits:         ${summary.cacheHits}`);
  logger.log(`  Tokens saved:       ${summary.savedTokensTotal.toLocaleString()}`);
  logger.log(`  Tokens in:          ${summary.inputTokensTotal.toLocaleString()}`);
  logger.log(`  Tokens out:         ${summary.outputTokensTotal.toLocaleString()}`);
  logger.log(`  Mean reduction:     ${(summary.meanReduction * 100).toFixed(2)}%`);
  logger.log(
    `  Constraint failure: ${(summary.constraintFailureRate * 100).toFixed(2)}%`,
  );

  logger.log("\n  Tier        Count   Saved tok   Mean reduction");
  logger.log("  " + "─".repeat(50));
  for (const [tier, bucket] of Object.entries(summary.byTier)) {
    logger.log(
      `  ${tier.padEnd(10)}  ${String(bucket.count).padStart(5)}   ${String(bucket.savedTokens).padStart(9)}   ${(bucket.meanReduction * 100).toFixed(2)}%`,
    );
  }

  logger.log("\n  Provider                 Count   Saved tokens");
  logger.log("  " + "─".repeat(50));
  for (const [name, bucket] of Object.entries(summary.byProvider)) {
    logger.log(
      `  ${name.padEnd(24)} ${String(bucket.count).padStart(5)}   ${String(bucket.savedTokens).padStart(9)}`,
    );
  }
  logger.log("");
}
