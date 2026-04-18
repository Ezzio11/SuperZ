import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, superzHome } from "./paths.js";
import { tagged } from "./logger.js";

const log = tagged("metrics");

export interface ProviderStats {
  attempts: number;
  wins: number;
  failures: number;
  totalLatencyMs: number;
  latencySamples: number[];
}

export interface MetricsSnapshot {
  startedAt: number;
  totalRequests: number;
  totalBypassed: number;
  totalCacheHits: number;
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  totalTokensSaved: number;
  providers: Record<string, ProviderStats>;
}

const DEFAULT_SNAPSHOT: MetricsSnapshot = {
  startedAt: Date.now(),
  totalRequests: 0,
  totalBypassed: 0,
  totalCacheHits: 0,
  totalOriginalTokens: 0,
  totalCompressedTokens: 0,
  totalTokensSaved: 0,
  providers: {},
};

const MAX_LATENCY_SAMPLES = 256;

export class MetricsStore {
  private readonly path: string;
  private snapshot: MetricsSnapshot;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(customPath?: string) {
    ensureDir(superzHome());
    this.path = customPath ?? join(superzHome(), "metrics.json");
    this.snapshot = this.load();
  }

  private load(): MetricsSnapshot {
    if (!existsSync(this.path)) return { ...DEFAULT_SNAPSHOT, startedAt: Date.now() };
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as MetricsSnapshot;
      return { ...DEFAULT_SNAPSHOT, ...parsed };
    } catch (err) {
      log.warn("Could not read metrics file, resetting:", err);
      return { ...DEFAULT_SNAPSHOT, startedAt: Date.now() };
    }
  }

  private getProvider(name: string): ProviderStats {
    if (!this.snapshot.providers[name]) {
      this.snapshot.providers[name] = {
        attempts: 0,
        wins: 0,
        failures: 0,
        totalLatencyMs: 0,
        latencySamples: [],
      };
    }
    return this.snapshot.providers[name];
  }

  recordAttempt(provider: string): void {
    this.getProvider(provider).attempts += 1;
    this.scheduleFlush();
  }

  recordWin(provider: string, latencyMs: number): void {
    const p = this.getProvider(provider);
    p.wins += 1;
    p.totalLatencyMs += latencyMs;
    p.latencySamples.push(latencyMs);
    if (p.latencySamples.length > MAX_LATENCY_SAMPLES) {
      p.latencySamples.shift();
    }
    this.scheduleFlush();
  }

  recordFailure(provider: string): void {
    this.getProvider(provider).failures += 1;
    this.scheduleFlush();
  }

  recordRequest(params: {
    originalTokens: number;
    compressedTokens: number;
    bypassed?: boolean;
    cacheHit?: boolean;
  }): void {
    this.snapshot.totalRequests += 1;
    if (params.bypassed) this.snapshot.totalBypassed += 1;
    if (params.cacheHit) this.snapshot.totalCacheHits += 1;
    this.snapshot.totalOriginalTokens += params.originalTokens;
    this.snapshot.totalCompressedTokens += params.compressedTokens;
    this.snapshot.totalTokensSaved += Math.max(0, params.originalTokens - params.compressedTokens);
    this.scheduleFlush();
  }

  /**
   * Provider win-rate over recent history, used for adaptive racing.
   * Falls back to 0.5 when we have no data (cold start).
   */
  winRate(provider: string): number {
    const p = this.snapshot.providers[provider];
    if (!p || p.attempts === 0) return 0.5;
    return p.wins / p.attempts;
  }

  snapshotRead(): MetricsSnapshot {
    return JSON.parse(JSON.stringify(this.snapshot)) as MetricsSnapshot;
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 1500);
    this.flushTimer.unref?.();
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      writeFileSync(this.path, JSON.stringify(this.snapshot, null, 2), "utf8");
      this.dirty = false;
    } catch (err) {
      log.debug("Failed to flush metrics:", err);
    } finally {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
    }
  }
}

let globalMetrics: MetricsStore | null = null;

export function getMetrics(): MetricsStore {
  if (!globalMetrics) globalMetrics = new MetricsStore();
  return globalMetrics;
}
