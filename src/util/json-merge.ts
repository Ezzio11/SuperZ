/**
 * Deep merge utility specifically tuned for JSON config files.
 * - Objects are merged key-by-key.
 * - Arrays are replaced wholesale (never concatenated; config files
 *   almost always expect replacement semantics).
 * - Primitives are replaced.
 * - Source `undefined` values are ignored (so callers can pass
 *   partial patches without erasing existing fields).
 */
export function deepMerge<T>(target: T, source: Partial<T>): T {
  if (source === null || source === undefined) return target;
  if (target === null || target === undefined) return source as T;

  if (typeof target !== "object" || typeof source !== "object") {
    return source as T;
  }

  if (Array.isArray(target) || Array.isArray(source)) {
    return (source ?? target) as T;
  }

  const out: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === undefined) continue;
    const existing = out[key];
    if (
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = deepMerge(existing, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * Merge a patch into a JSON file while preserving any existing
 * fields the installer doesn't know about.
 */
export function mergeJsonText(existing: string | null, patch: Record<string, unknown>): string {
  let parsed: Record<string, unknown> = {};
  if (existing && existing.trim().length > 0) {
    try {
      parsed = JSON.parse(existing) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  const merged = deepMerge(parsed, patch);
  return `${JSON.stringify(merged, null, 2)}\n`;
}
