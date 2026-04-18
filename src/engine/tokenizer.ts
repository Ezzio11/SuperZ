import { encode as encodeCl100k } from "gpt-tokenizer/model/gpt-3.5-turbo";

/**
 * Accurate token count using the cl100k_base tokenizer used by
 * GPT-3.5/4 class models. This is a reasonable universal estimator
 * for mixed target models (Claude, Gemini, Llama) since they are
 * all within ~10% of each other for English text.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return encodeCl100k(text).length;
  } catch {
    // Defensive: tokenizer should never throw, but fall back to the
    // length/4 heuristic so compression always returns *something*.
    return Math.ceil(text.length / 4);
  }
}

export interface TokenDelta {
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  percentSaved: number;
}

export function computeDelta(original: string, compressed: string): TokenDelta {
  const originalTokens = countTokens(original);
  const compressedTokens = countTokens(compressed);
  const savedTokens = originalTokens - compressedTokens;
  const percentSaved = originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 100) : 0;
  return { originalTokens, compressedTokens, savedTokens, percentSaved };
}
