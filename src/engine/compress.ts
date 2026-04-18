import {
  AdvancedCompressorConfig,
  CompressionConfig,
  PROVIDER_SET_VERSION,
  ProviderConfig,
  SYSTEM_PROMPT_VERSION,
  SuperzConfig,
} from "../config/schema.js";
import { activeProviders, byTier, callOpenAICompatible, ProviderError } from "../providers/index.js";
import { CompressionCache } from "../util/cache.js";
import { MetricsStore, getMetrics } from "../util/metrics.js";
import { tagged } from "../util/logger.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { ruleBasedCompress } from "./rules.js";
import { adaptiveKeepRatio, PromptSizeTier, pruneBySalience } from "./salience.js";
import { sanitizeCompression } from "./sanitize.js";
import { ConstraintValidationReport, verifyConstraints } from "./validator.js";
import { computeDelta, countTokens, TokenDelta } from "./tokenizer.js";
import { callAdvancedCompressor } from "./advanced-compressor.js";

const log = tagged("engine");

const CONVERSATIONAL_PATTERN =
  /\b(what do you think|how should i|what else|brainstorm|advice on|opinion|recommendation|pros and cons|which is better|help me decide|what is the best way)\b/i;

export interface CompressOptions {
  /** Skip the bypass heuristic (used by the explicit CLI command). */
  force?: boolean;
  /** Skip cache reads (writes still occur). */
  bypassCache?: boolean;
}

export interface CompressionResult extends TokenDelta {
  compressed: string;
  provider: string;
  bypassed: boolean;
  cacheHit: boolean;
  /** Why regex fallback / keep-original was used (if applicable). */
  fallbackReason?:
    | "provider_failure"
    | "constraint_violation"
    | "no_improvement"
    | "fallback_expanded";
  errors: string[];
  constraintReport?: ConstraintValidationReport;
  providerUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedPromptTokens?: number;
  };
  promptTier?: PromptSizeTier;
}

export class CompressionEngine {
  private readonly providers: ProviderConfig[];
  private readonly compression: CompressionConfig;
  private readonly cache: CompressionCache | null;
  private readonly metrics: MetricsStore;
  private readonly advancedCompressor: AdvancedCompressorConfig;

  constructor(config: SuperzConfig, metrics: MetricsStore = getMetrics()) {
    this.providers = config.providers;
    this.compression = config.compression;
    this.metrics = metrics;
    this.advancedCompressor = config.advancedCompressor;
    this.cache = config.compression.cacheEnabled
      ? new CompressionCache({
          maxEntries: config.compression.cacheMaxEntries,
          ttlMs: config.compression.cacheTtlMs,
        })
      : null;
  }

  private shouldBypass(prompt: string): boolean {
    const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
    const promptTokens = countTokens(prompt);
    if (wordCount < this.compression.bypassMinWords) return true;
    if (promptTokens < this.compression.bypassMinTokens) return true;
    if (promptTokens <= this.compression.smallPromptMaxTokens) return true;
    if (CONVERSATIONAL_PATTERN.test(prompt)) return true;
    return false;
  }

  private tierForTokens(tokens: number): PromptSizeTier {
    if (tokens <= this.compression.smallPromptMaxTokens) return "small";
    if (tokens <= this.compression.mediumPromptMaxTokens) return "medium";
    return "large";
  }

  /**
   * Order fast-tier providers so the one with the best historical
   * win rate races first. Losing providers still race in parallel,
   * but the order influences log readability and priority when we
   * need to fall back deterministically.
   */
  private orderedFastTier(): ProviderConfig[] {
    const tier = byTier(activeProviders(this.providers), "fast");
    if (!this.compression.adaptiveRacing) return tier;
    return [...tier].sort(
      (a, b) => this.metrics.winRate(b.name) - this.metrics.winRate(a.name),
    );
  }

  private async raceFastTier(
    prompt: string,
    abort: AbortController,
  ): Promise<
    | {
        provider: string;
        compressed: string;
        usage?: CompressionResult["providerUsage"];
      }
    | null
  > {
    const fastTier = this.orderedFastTier();
    if (fastTier.length === 0) return null;

    const attempts = fastTier.map((provider) => {
      this.metrics.recordAttempt(provider.name);
      const providerAbort = new AbortController();
      abort.signal.addEventListener("abort", () => providerAbort.abort(), { once: true });
      const timeout = setTimeout(() => providerAbort.abort(), provider.timeoutMs);
      return callOpenAICompatible(provider, SYSTEM_PROMPT, prompt, providerAbort.signal)
        .then((result) => {
          clearTimeout(timeout);
          this.metrics.recordWin(provider.name, result.latencyMs);
          return result;
        })
        .catch((err: Error) => {
          clearTimeout(timeout);
          this.metrics.recordFailure(provider.name);
          throw err;
        });
    });

    try {
      const winner = await Promise.any(attempts);
      // Cancel losers so they don't keep consuming provider quota.
      abort.abort();
      return {
        provider: winner.provider,
        compressed: winner.compressed,
        usage: {
          promptTokens: winner.promptTokens,
          completionTokens: winner.completionTokens,
          totalTokens: winner.totalTokens,
          cachedPromptTokens: winner.cachedPromptTokens,
        },
      };
    } catch (err) {
      const errors = err instanceof AggregateError ? err.errors : [err];
      log.debug(
        "Fast tier failed:",
        errors.map((e) => (e instanceof Error ? e.message : String(e))).join("; "),
      );
      return null;
    }
  }

  private async runFallbackTier(
    prompt: string,
    errors: string[],
  ): Promise<
    | {
        provider: string;
        compressed: string;
        usage?: CompressionResult["providerUsage"];
      }
    | null
  > {
    for (const provider of byTier(activeProviders(this.providers), "fallback")) {
      this.metrics.recordAttempt(provider.name);
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), provider.timeoutMs);
      try {
        const result = await callOpenAICompatible(provider, SYSTEM_PROMPT, prompt, abort.signal);
        clearTimeout(timeout);
        this.metrics.recordWin(provider.name, result.latencyMs);
        return {
          provider: provider.name,
          compressed: result.compressed,
          usage: {
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            totalTokens: result.totalTokens,
            cachedPromptTokens: result.cachedPromptTokens,
          },
        };
      } catch (err) {
        clearTimeout(timeout);
        this.metrics.recordFailure(provider.name);
        const msg = err instanceof ProviderError ? err.message : (err as Error).message;
        errors.push(msg);
      }
    }
    return null;
  }

  private extractiveCompact(prompt: string, tier: PromptSizeTier): string {
    let out = prompt;
    if (this.compression.queryAwarePruning && tier !== "small") {
      out = pruneBySalience(out, adaptiveKeepRatio(out, tier), tier);
    }
    out = ruleBasedCompress(out);
    return sanitizeCompression(out);
  }

  private validateCandidate(
    original: string,
    candidate: string,
  ): { valid: boolean; report: ConstraintValidationReport } {
    const report = verifyConstraints(original, candidate, {
      strictNumeric: this.compression.strictNumericConstraints,
      strictNegation: this.compression.strictNegativeConstraints,
    });
    return { valid: report.preserved, report };
  }

  private withinExpansionBudget(originalTokens: number, candidateTokens: number): boolean {
    return candidateTokens <= originalTokens + this.compression.maxExpansionAllowed;
  }

  async compress(prompt: string, options: CompressOptions = {}): Promise<CompressionResult> {
    const promptTokens = countTokens(prompt);
    const promptTier = this.tierForTokens(promptTokens);
    if (!options.force && this.shouldBypass(prompt)) {
      const delta = computeDelta(prompt, prompt);
      this.metrics.recordRequest({
        originalTokens: delta.originalTokens,
        compressedTokens: delta.compressedTokens,
        bypassed: true,
      });
      return {
        compressed: prompt,
        provider: "bypass",
        bypassed: true,
        cacheHit: false,
        errors: [],
        promptTier,
        ...delta,
      };
    }

    const cacheKey = CompressionCache.key({
      prompt,
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
      providerSetVersion: PROVIDER_SET_VERSION,
    });

    if (this.cache && !options.bypassCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        const delta = computeDelta(prompt, cached.compressed);
        this.metrics.recordRequest({
          originalTokens: delta.originalTokens,
          compressedTokens: delta.compressedTokens,
          cacheHit: true,
        });
        return {
          compressed: cached.compressed,
          provider: `${cached.provider} (cached)`,
          bypassed: false,
          cacheHit: true,
          errors: [],
          ...delta,
        };
      }
    }

    const errors: string[] = [];
    const originalTokenCount = promptTokens;
    const originalValidation = this.validateCandidate(prompt, prompt).report;

    let compressed = prompt;
    let provider = "keep-original";
    let fallbackReason: CompressionResult["fallbackReason"];
    let constraintReport: CompressionResult["constraintReport"] = originalValidation;
    let providerUsage: CompressionResult["providerUsage"];

    // Stage B: deterministic extractive compaction.
    const extractive = this.extractiveCompact(prompt, promptTier);
    const extractiveTokens = countTokens(extractive);
    const extractiveValidation = this.validateCandidate(prompt, extractive);
    if (!extractiveValidation.valid) {
      errors.push(
        `extractive candidate dropped constraints (${extractiveValidation.report.missing.join("; ")}).`,
      );
      fallbackReason = "constraint_violation";
    } else if (
      this.withinExpansionBudget(originalTokenCount, extractiveTokens) &&
      extractiveTokens < originalTokenCount
    ) {
      compressed = extractive;
      provider = "extractive";
      constraintReport = extractiveValidation.report;
    } else if (!this.withinExpansionBudget(originalTokenCount, extractiveTokens)) {
      errors.push(
        `extractive candidate exceeded expansion budget (${originalTokenCount} -> ${extractiveTokens}).`,
      );
      fallbackReason = "fallback_expanded";
    } else {
      fallbackReason = "no_improvement";
    }

    // Stage C: Optional LLM rewrite only when expected gain is meaningful.
    const expectedGain = originalTokenCount - extractiveTokens;
    const allowRewriteForTier =
      promptTier === "large" ||
      (promptTier === "medium" && this.compression.allowLlmRewriteForMedium);
    const shouldTryLlm = allowRewriteForTier && expectedGain >= this.compression.minExpectedGainTokens;
    if (promptTier === "large") {
      const sidecar = await callAdvancedCompressor(this.advancedCompressor, prompt, originalTokenCount);
      if (sidecar) {
        const sidecarCandidate = sanitizeCompression(sidecar.compressed);
        const sidecarTokens = countTokens(sidecarCandidate);
        const sidecarValidation = this.validateCandidate(prompt, sidecarCandidate);
        if (
          sidecarValidation.valid &&
          this.withinExpansionBudget(originalTokenCount, sidecarTokens) &&
          sidecarTokens < countTokens(compressed)
        ) {
          compressed = sidecarCandidate;
          provider = sidecar.provider;
          constraintReport = sidecarValidation.report;
          fallbackReason = undefined;
        } else if (!sidecarValidation.valid) {
          errors.push(
            `${sidecar.provider} dropped constraints (${sidecarValidation.report.missing.join("; ")}).`,
          );
          fallbackReason = "constraint_violation";
        }
      }
    }
    if (shouldTryLlm) {
      const abort = new AbortController();
      let winner = await this.raceFastTier(prompt, abort);
      if (!winner) {
        errors.push("All fast-tier providers failed or unavailable.");
        winner = await this.runFallbackTier(prompt, errors);
      }
      if (winner) {
        const sanitized = sanitizeCompression(winner.compressed);
        const winnerTokens = countTokens(sanitized);
        const winnerValidation = this.validateCandidate(prompt, sanitized);
        if (!winnerValidation.valid) {
          errors.push(
            `${winner.provider} dropped constraints (${winnerValidation.report.missing.join("; ")}).`,
          );
          fallbackReason = "constraint_violation";
        } else if (!this.withinExpansionBudget(originalTokenCount, winnerTokens)) {
          errors.push(
            `${winner.provider} exceeded expansion budget (${originalTokenCount} -> ${winnerTokens}).`,
          );
          fallbackReason = "fallback_expanded";
        } else if (winnerTokens < countTokens(compressed)) {
          compressed = sanitized;
          provider = winner.provider;
          constraintReport = winnerValidation.report;
          providerUsage = winner.usage;
        } else if (provider === "keep-original" && winnerTokens < originalTokenCount) {
          // If we don't have any improved candidate yet, accept the LLM result
          // as long as it is strictly shorter than the original.
          compressed = sanitized;
          provider = winner.provider;
          constraintReport = winnerValidation.report;
          providerUsage = winner.usage;
        } else {
          fallbackReason = "no_improvement";
        }
      } else if (provider === "keep-original" && !fallbackReason) {
        fallbackReason = "provider_failure";
      }
    }

    if (provider === "keep-original" && !fallbackReason) {
      fallbackReason = "no_improvement";
    }

    if (this.cache && provider !== "keep-original") {
      this.cache.set(cacheKey, { compressed, provider, createdAt: Date.now() });
    }

    const delta = computeDelta(prompt, compressed);
    this.metrics.recordRequest({
      originalTokens: delta.originalTokens,
      compressedTokens: delta.compressedTokens,
    });

    return {
      compressed,
      provider,
      bypassed: false,
      cacheHit: false,
      fallbackReason,
      errors,
      constraintReport,
      providerUsage,
      promptTier,
      ...delta,
    };
  }
}
