import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { superzHome } from "./paths.js";
import { tagged } from "./logger.js";

const log = tagged("usage-log");

export interface UsageLogEntry {
  ts: string;
  inputTokens: number;
  outputTokens: number;
  saved: number;
  reductionRatio: number;
  provider: string;
  tier?: string;
  bypassed: boolean;
  cacheHit: boolean;
  constraintOk: boolean;
  fallbackReason?: string;
}

function usageLogPath(): string {
  const envPath = process.env.SUPERZ_USAGE_LOG_PATH;
  if (envPath && envPath.trim().length > 0) return envPath;
  return join(superzHome(), "usage.log.jsonl");
}

export function usageLogEnabled(): boolean {
  const flag = process.env.SUPERZ_USAGE_LOG;
  if (!flag) return false;
  return /^(1|true|yes|on)$/i.test(flag);
}

export function appendUsage(entry: UsageLogEntry): void {
  if (!usageLogEnabled()) return;
  try {
    const path = usageLogPath();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (err) {
    log.debug("failed to append usage entry", err);
  }
}

export interface UsageSummary {
  path: string;
  totalEntries: number;
  bypassed: number;
  compressed: number;
  cacheHits: number;
  inputTokensTotal: number;
  outputTokensTotal: number;
  savedTokensTotal: number;
  meanReduction: number;
  constraintFailureRate: number;
  byTier: Record<string, {
    count: number;
    savedTokens: number;
    meanReduction: number;
  }>;
  byProvider: Record<string, { count: number; savedTokens: number }>;
  windowStart: string | null;
  windowEnd: string | null;
}

/**
 * Parse durations like "7d", "24h", "30m". Returns milliseconds.
 * Undefined or empty returns Infinity (no window filter).
 */
function parseWindowMs(window: string | undefined): number {
  if (!window) return Number.POSITIVE_INFINITY;
  const match = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(window.trim());
  if (!match) return Number.POSITIVE_INFINITY;
  const n = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  switch (unit) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

export function summarizeUsageLog(options: { window?: string; path?: string } = {}): UsageSummary {
  const path = options.path ?? usageLogPath();
  const summary: UsageSummary = {
    path,
    totalEntries: 0,
    bypassed: 0,
    compressed: 0,
    cacheHits: 0,
    inputTokensTotal: 0,
    outputTokensTotal: 0,
    savedTokensTotal: 0,
    meanReduction: 0,
    constraintFailureRate: 0,
    byTier: {},
    byProvider: {},
    windowStart: null,
    windowEnd: null,
  };
  if (!existsSync(path)) return summary;

  const cutoff = Date.now() - parseWindowMs(options.window);
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

  const reductions: number[] = [];
  let constraintFailures = 0;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as UsageLogEntry;
      const ts = Date.parse(entry.ts);
      if (Number.isNaN(ts) || ts < cutoff) continue;

      summary.totalEntries += 1;
      if (entry.bypassed) summary.bypassed += 1;
      else summary.compressed += 1;
      if (entry.cacheHit) summary.cacheHits += 1;
      summary.inputTokensTotal += entry.inputTokens;
      summary.outputTokensTotal += entry.outputTokens;
      summary.savedTokensTotal += Math.max(0, entry.saved);
      reductions.push(entry.reductionRatio ?? 0);
      if (!entry.constraintOk) constraintFailures += 1;

      const tier = entry.tier ?? "unknown";
      const tierBucket =
        summary.byTier[tier] ?? { count: 0, savedTokens: 0, meanReduction: 0 };
      tierBucket.count += 1;
      tierBucket.savedTokens += Math.max(0, entry.saved);
      tierBucket.meanReduction += entry.reductionRatio ?? 0;
      summary.byTier[tier] = tierBucket;

      const prov = entry.provider || "unknown";
      const provBucket = summary.byProvider[prov] ?? { count: 0, savedTokens: 0 };
      provBucket.count += 1;
      provBucket.savedTokens += Math.max(0, entry.saved);
      summary.byProvider[prov] = provBucket;

      if (!summary.windowStart || entry.ts < summary.windowStart) {
        summary.windowStart = entry.ts;
      }
      if (!summary.windowEnd || entry.ts > summary.windowEnd) {
        summary.windowEnd = entry.ts;
      }
    } catch (err) {
      log.debug("skipping malformed usage line", err);
    }
  }

  summary.meanReduction =
    reductions.length > 0 ? reductions.reduce((a, b) => a + b, 0) / reductions.length : 0;
  summary.constraintFailureRate =
    summary.totalEntries > 0 ? constraintFailures / summary.totalEntries : 0;
  for (const tier of Object.keys(summary.byTier)) {
    const bucket = summary.byTier[tier];
    if (bucket && bucket.count > 0) {
      bucket.meanReduction = bucket.meanReduction / bucket.count;
    }
  }
  return summary;
}
