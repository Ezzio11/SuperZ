import { AdvancedCompressorConfig } from "../config/schema.js";

export interface AdvancedCompressionResult {
  compressed: string;
  provider: string;
}

/**
 * Optional sidecar call (LLMLingua-style token-classification service).
 * Expected contract:
 *   POST <endpoint>
 *   {
 *     "prompt": "...",
 *     "target": "superz",
 *     "max_tokens": <number>
 *   }
 * -> 200
 *   {
 *     "compressed": "...",
 *     "provider": "sidecar-llmlingua2"
 *   }
 */
export async function callAdvancedCompressor(
  cfg: AdvancedCompressorConfig,
  prompt: string,
  originalTokens: number,
): Promise<AdvancedCompressionResult | null> {
  if (!cfg.enabled || !cfg.endpoint) return null;
  if (originalTokens < cfg.minTokens) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        prompt,
        target: "superz",
        max_tokens: originalTokens,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { compressed?: unknown; provider?: unknown };
    if (typeof data.compressed !== "string" || !data.compressed.trim()) return null;
    return {
      compressed: data.compressed.trim(),
      provider: typeof data.provider === "string" ? data.provider : "sidecar-advanced",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
