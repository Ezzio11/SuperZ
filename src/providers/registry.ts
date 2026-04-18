import { ProviderConfig } from "../config/schema.js";

/** Select only providers that have an API key present. */
export function activeProviders(all: ProviderConfig[]): ProviderConfig[] {
  return all.filter((p) => Boolean(p.apiKey));
}

export function byTier(providers: ProviderConfig[], tier: "fast" | "fallback"): ProviderConfig[] {
  return providers.filter((p) => p.tier === tier);
}
