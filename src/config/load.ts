import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ProviderConfig, SuperzConfig, SuperzConfigSchema } from "./schema.js";
import { tagged } from "../util/logger.js";
import { readUserConfig } from "./user-store.js";

const log = tagged("config");

/**
 * Load environment from .env files in standard locations (project
 * cwd, and the directory the binary was launched from). Never throws.
 */
export function loadEnvFiles(...extraDirs: string[]): void {
  const candidates = [process.cwd(), ...extraDirs]
    .map((dir) => resolve(dir, ".env"))
    .filter((p, i, arr) => arr.indexOf(p) === i);
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: false });
      log.debug("Loaded env file", path);
    }
  }
}

/**
 * Default provider registry. API keys sourced from env so secrets
 * never live in version control. Providers with no key are elided
 * at runtime but kept in config so `superz doctor` can flag them.
 *
 * Strategy: free-first by default. OpenRouter free model is primary,
 * paid/owned-provider keys act as fallbacks for reliability.
 */
function defaultProviders(): ProviderConfig[] {
  return [
    {
      name: "OpenRouter-Free",
      tier: "fast",
      url: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL ?? "google/gemma-4-26b-a4b-it:free",
      timeoutMs: 7000,
      supportsJsonMode: false,
    },
    {
      name: "Cerebras",
      tier: "fallback",
      url: "https://api.cerebras.ai/v1/chat/completions",
      apiKey: process.env.CEREBRAS_API_KEY,
      model: process.env.CEREBRAS_MODEL ?? "llama-3.3-70b",
      timeoutMs: 4500,
      supportsJsonMode: true,
    },
    {
      name: "Groq",
      tier: "fallback",
      url: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
      timeoutMs: 4500,
      supportsJsonMode: true,
    },
    {
      name: "Google",
      tier: "fallback",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      apiKey: process.env.GOOGLE_API_KEY,
      model: process.env.GOOGLE_MODEL ?? "gemini-2.0-flash",
      timeoutMs: 5500,
      supportsJsonMode: true,
    },
    {
      name: "HuggingFace",
      tier: "fallback",
      url: "https://router.huggingface.co/novita/v3/openai/chat/completions",
      apiKey: process.env.HF_API_KEY,
      model: process.env.HF_MODEL ?? "meta-llama/llama-3.1-8b-instruct",
      timeoutMs: 10000,
      supportsJsonMode: false,
    },
  ];
}

function defaultAdvancedCompressor(): Partial<SuperzConfig["advancedCompressor"]> {
  return {
    enabled: /^(1|true|yes)$/i.test(process.env.SUPERZ_ADV_COMPRESSOR_ENABLED ?? ""),
    endpoint: process.env.SUPERZ_ADV_COMPRESSOR_ENDPOINT,
    timeoutMs: process.env.SUPERZ_ADV_COMPRESSOR_TIMEOUT_MS
      ? Number(process.env.SUPERZ_ADV_COMPRESSOR_TIMEOUT_MS)
      : undefined,
    minTokens: process.env.SUPERZ_ADV_COMPRESSOR_MIN_TOKENS
      ? Number(process.env.SUPERZ_ADV_COMPRESSOR_MIN_TOKENS)
      : undefined,
    apiKey: process.env.SUPERZ_ADV_COMPRESSOR_API_KEY,
  };
}

function envBinding(providerName: string): { keyEnv: string; modelEnv: string } | null {
  const normalized = providerName.toLowerCase();
  if (normalized.includes("openrouter")) {
    return { keyEnv: "OPENROUTER_API_KEY", modelEnv: "OPENROUTER_MODEL" };
  }
  if (normalized.includes("cerebras")) {
    return { keyEnv: "CEREBRAS_API_KEY", modelEnv: "CEREBRAS_MODEL" };
  }
  if (normalized.includes("groq")) {
    return { keyEnv: "GROQ_API_KEY", modelEnv: "GROQ_MODEL" };
  }
  if (normalized.includes("google")) {
    return { keyEnv: "GOOGLE_API_KEY", modelEnv: "GOOGLE_MODEL" };
  }
  if (normalized.includes("huggingface")) {
    return { keyEnv: "HF_API_KEY", modelEnv: "HF_MODEL" };
  }
  return null;
}

function mergeProviderConfig(
  defaults: ProviderConfig[],
  userProviders: ProviderConfig[] | undefined,
): ProviderConfig[] {
  const userByName = new Map((userProviders ?? []).map((p) => [p.name, p]));
  const merged: ProviderConfig[] = defaults.map((base) => {
    const user = userByName.get(base.name);
    const env = envBinding(base.name);
    const envApiKey = env ? process.env[env.keyEnv] : undefined;
    const envModel = env ? process.env[env.modelEnv] : undefined;
    return {
      ...base,
      ...(user ?? {}),
      // Priority: env > user-config > defaults.
      apiKey: envApiKey ?? user?.apiKey ?? base.apiKey ?? undefined,
      model: envModel ?? user?.model ?? base.model,
    };
  });
  // Preserve any user-defined custom providers not in defaults.
  const defaultNames = new Set(defaults.map((p) => p.name));
  for (const provider of userProviders ?? []) {
    if (!defaultNames.has(provider.name)) {
      merged.push(provider);
    }
  }
  return merged;
}

export function loadConfig(overridePath?: string): SuperzConfig {
  loadEnvFiles();

  const user = readUserConfig();
  let base: Partial<SuperzConfig> = {};
  if (overridePath && existsSync(overridePath)) {
    try {
      base = JSON.parse(readFileSync(overridePath, "utf8")) as Partial<SuperzConfig>;
    } catch (err) {
      log.warn("Failed to parse config override, ignoring:", err);
    }
  }

  const defaults = defaultProviders();
  const advancedDefaults = defaultAdvancedCompressor();
  const merged: Partial<SuperzConfig> = {
    ...user,
    ...base,
    advancedCompressor: {
      enabled:
        base.advancedCompressor?.enabled ??
        user.advancedCompressor?.enabled ??
        advancedDefaults.enabled ??
        false,
      timeoutMs:
        base.advancedCompressor?.timeoutMs ??
        user.advancedCompressor?.timeoutMs ??
        advancedDefaults.timeoutMs ??
        3000,
      minTokens:
        base.advancedCompressor?.minTokens ??
        user.advancedCompressor?.minTokens ??
        advancedDefaults.minTokens ??
        220,
      endpoint:
        base.advancedCompressor?.endpoint ??
        user.advancedCompressor?.endpoint ??
        advancedDefaults.endpoint,
      apiKey:
        base.advancedCompressor?.apiKey ??
        user.advancedCompressor?.apiKey ??
        advancedDefaults.apiKey,
    },
    providers:
      base.providers && base.providers.length > 0
        ? base.providers
        : mergeProviderConfig(defaults, user.providers),
  };

  const parsed = SuperzConfigSchema.safeParse(merged);
  if (!parsed.success) {
    log.error("Invalid config:", parsed.error.flatten());
    throw new Error("Invalid SuperZ config");
  }
  return parsed.data;
}
