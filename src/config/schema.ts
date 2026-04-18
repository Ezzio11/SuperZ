import { z } from "zod";

export const ProviderTierSchema = z.enum(["fast", "fallback"]);
export type ProviderTier = z.infer<typeof ProviderTierSchema>;

export const ProviderConfigSchema = z.object({
  name: z.string(),
  tier: ProviderTierSchema,
  url: z.string().url(),
  apiKey: z.string().min(1).optional(),
  model: z.string(),
  timeoutMs: z.number().int().positive().default(6000),
  supportsJsonMode: z.boolean().default(true),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const CompressionConfigSchema = z.object({
  /** Minimum word count below which requests bypass compression entirely. */
  bypassMinWords: z.number().int().positive().default(20),
  /**
   * Minimum *token* count below which requests bypass compression entirely.
   * Short prompts carry too much risk of negative compression (LLM preamble
   * overhead + tokenizer boundary artefacts) for the expected savings to
   * be worthwhile. Bypass triggers if either bypassMinWords or
   * bypassMinTokens is unmet.
   */
  bypassMinTokens: z.number().int().positive().default(120),
  /** Maximum prompt tokens we'll send to a provider for compression. */
  maxInputTokens: z.number().int().positive().default(6000),
  /** Per-provider request timeout ceiling. */
  maxTimeoutMs: z.number().int().positive().default(15000),
  /** Cache tuning. */
  cacheEnabled: z.boolean().default(true),
  cacheMaxEntries: z.number().int().positive().default(500),
  cacheTtlMs: z
    .number()
    .int()
    .positive()
    .default(1000 * 60 * 60 * 24 * 7),
  /** Enable adaptive provider ordering based on historical win rate. */
  adaptiveRacing: z.boolean().default(true),
  /** Reject compressed output that drops negative constraints. */
  strictNegativeConstraints: z.boolean().default(true),
  /** Reject compressed output that drops numeric limits/thresholds. */
  strictNumericConstraints: z.boolean().default(true),
  /** Enable query-aware salience pruning before optional LLM rewrite. */
  queryAwarePruning: z.boolean().default(true),
  /**
   * Skip costly LLM rewrite if deterministic stage is unlikely to save at
   * least this many tokens.
   */
  minExpectedGainTokens: z.number().int().nonnegative().default(8),
  /**
   * Maximum allowed growth from original in final output.
   * Default 0 => never return a longer prompt.
   */
  maxExpansionAllowed: z.number().int().nonnegative().default(0),
  /** Token threshold for "small" prompts -> bypass path. */
  smallPromptMaxTokens: z.number().int().positive().default(120),
  /** Token threshold upper bound for medium prompts. */
  mediumPromptMaxTokens: z.number().int().positive().default(260),
  /** Allow expensive LLM rewrite stage for medium prompts. */
  allowLlmRewriteForMedium: z.boolean().default(false),
});
export type CompressionConfig = z.infer<typeof CompressionConfigSchema>;

export const AdvancedCompressorConfigSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().url().optional(),
  timeoutMs: z.number().int().positive().default(3000),
  minTokens: z.number().int().positive().default(220),
  apiKey: z.string().optional(),
});
export type AdvancedCompressorConfig = z.infer<typeof AdvancedCompressorConfigSchema>;

export const HttpConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(7420),
  cors: z.boolean().default(false),
  apiToken: z.string().optional(),
});
export type HttpConfig = z.infer<typeof HttpConfigSchema>;

export const SuperzConfigSchema = z.object({
  compression: CompressionConfigSchema.default({}),
  advancedCompressor: AdvancedCompressorConfigSchema.default({}),
  http: HttpConfigSchema.default({}),
  providers: z.array(ProviderConfigSchema).default([]),
});
export type SuperzConfig = z.infer<typeof SuperzConfigSchema>;

export const SYSTEM_PROMPT_VERSION = "2.0.0";
export const PROVIDER_SET_VERSION = "2.0.0";
