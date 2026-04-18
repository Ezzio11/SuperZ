/**
 * Library entrypoint. Re-exports the core engine and config types so
 * third-party Node projects can embed the compressor directly
 * (`import { CompressionEngine, loadConfig } from "prompt-compressor"`).
 */

export * from "./engine/index.js";
export * from "./config/index.js";
export { getMetrics, MetricsStore } from "./util/metrics.js";
export type { MetricsSnapshot, ProviderStats } from "./util/metrics.js";
export { CompressionCache } from "./util/cache.js";
