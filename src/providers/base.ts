import { ProviderConfig } from "../config/schema.js";
import { tagged } from "../util/logger.js";

const log = tagged("provider");

export interface ProviderResult {
  provider: string;
  compressed: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedPromptTokens?: number;
  rawResponse?: unknown;
}

type ContentPart = { type?: string; text?: string; content?: string };
type ChatChoice = {
  message?: { content?: string | ContentPart[] | null };
  text?: string | null;
};
type OpenAIResponseLike = {
  choices?: ChatChoice[];
  output_text?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
};

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly reason: string,
    public readonly status?: number,
  ) {
    super(`${provider}: ${reason}${status !== undefined ? ` (HTTP ${status})` : ""}`);
    this.name = "ProviderError";
  }
}

/**
 * Generic OpenAI-compatible chat completion call. All supported
 * providers (Cerebras, Groq, Google Gemini via OpenAI-compat,
 * OpenRouter, HuggingFace router) speak this shape.
 */
export async function callOpenAICompatible(
  provider: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal,
): Promise<ProviderResult> {
  if (!provider.apiKey) {
    throw new ProviderError(provider.name, "missing API key");
  }

  const start = Date.now();
  const body: Record<string, unknown> = {
    model: provider.model,
    max_tokens: 512,
    temperature: 0,
    top_p: 1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
  if (provider.supportsJsonMode) {
    body.response_format = { type: "json_object" };
  }
  // OpenAI prompt caching is prefix-based and benefits from stable routing.
  if (provider.url.includes("api.openai.com")) {
    body.prompt_cache_key = `superz:${provider.model}`;
    body.prompt_cache_retention = "in_memory";
  }

  const res = await fetch(provider.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      "User-Agent": "prompt-compressor/2.0",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    // Do not propagate raw upstream response bodies; they can contain
    // request echoes or provider diagnostics that are too verbose for logs.
    throw new ProviderError(provider.name, "request failed", res.status);
  }

  const data = (await res.json()) as OpenAIResponseLike;
  const rawContent = extractRawContent(data);
  if (!rawContent) {
    throw new ProviderError(provider.name, "empty response");
  }

  const compressed = extractCompressed(rawContent);
  const latencyMs = Date.now() - start;
  const usage = data.usage;
  log.debug(`${provider.name} responded in ${latencyMs}ms`);
  return {
    provider: provider.name,
    compressed,
    latencyMs,
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
    cachedPromptTokens: usage?.prompt_tokens_details?.cached_tokens,
    rawResponse: data,
  };
}

function normalizeContentParts(parts: ContentPart[]): string {
  const texts = parts
    .map((p) => {
      if (typeof p.text === "string" && p.text.trim()) return p.text.trim();
      if (typeof p.content === "string" && p.content.trim()) return p.content.trim();
      return "";
    })
    .filter(Boolean);
  return texts.join("\n").trim();
}

function extractRawContent(data: OpenAIResponseLike): string {
  const first = data.choices?.[0];
  const messageContent = first?.message?.content;
  if (typeof messageContent === "string" && messageContent.trim()) {
    return messageContent.trim();
  }
  if (Array.isArray(messageContent)) {
    const joined = normalizeContentParts(messageContent);
    if (joined) return joined;
  }
  if (typeof first?.text === "string" && first.text.trim()) {
    return first.text.trim();
  }
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  return "";
}

/**
 * Parse the `{"compressed_prompt": "..."}` envelope if present; otherwise
 * treat the raw content as the compressed output. Also strips stray
 * markdown code fences that small models occasionally emit.
 */
export function extractCompressed(raw: string): string {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(stripped) as { compressed_prompt?: unknown };
    if (typeof parsed.compressed_prompt === "string" && parsed.compressed_prompt.trim()) {
      return parsed.compressed_prompt.trim();
    }
  } catch {
    // not JSON
  }
  return stripped;
}
