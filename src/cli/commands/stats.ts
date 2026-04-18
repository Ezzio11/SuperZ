import { getMetrics } from "../../util/metrics.js";
import { logger } from "../../util/logger.js";

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

export function runStats(): void {
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
