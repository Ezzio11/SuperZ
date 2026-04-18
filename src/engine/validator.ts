/**
 * Verifies that a candidate compression preserves every negative
 * constraint from the original prompt. This is the single most
 * important safety guarantee of the compressor — dropping a "not"
 * or "never" silently corrupts the user's intent in the worst way.
 */

const NEGATION_WORDS = [
  "not",
  "never",
  "no",
  "none",
  "without",
  "avoid",
  "disallow",
  "forbid",
  "forbidden",
  "disabled",
  "disable",
  "prohibit",
  "prohibited",
  "exclude",
  "excluded",
  "deny",
  "denied",
  "reject",
  "rejected",
  "must not",
  "do not",
  "don't",
  "can't",
  "cannot",
  "shouldn't",
  "shall not",
  "won't",
];

const COMPRESSED_NEGATION_MARKERS = [
  "!",
  "not",
  "never",
  "no",
  "none",
  "without",
  "w/o",
  "cannot",
  "can't",
  "mustn't",
  "won't",
  "shouldn't",
  "don't",
  "avoid",
  "disallow",
  "forbid",
  "forbidden",
  "prohibit",
  "prohibited",
  "disabled",
  "disable",
  "exclude",
  "excluded",
  "deny",
  "denied",
  "reject",
  "rejected",
];

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "for",
  "to",
  "on",
  "use",
  "using",
  "with",
  "at",
  "by",
  "any",
]);

export interface NegativeConstraintReport {
  preserved: boolean;
  missing: string[];
  originalCount: number;
  compressedCount: number;
}

export interface NumericConstraintReport {
  preserved: boolean;
  missing: string[];
  originalCount: number;
  compressedCount: number;
}

export interface SchemaConstraintReport {
  preserved: boolean;
  missing: string[];
  originalCount: number;
  compressedCount: number;
}

export interface ConstraintValidationReport {
  preserved: boolean;
  missing: string[];
  negation: NegativeConstraintReport;
  numeric: NumericConstraintReport;
  schema: SchemaConstraintReport;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s!/]/g, " ").replace(/\s+/g, " ").trim();
}

interface Constraint {
  /** Display form of the constraint (e.g. `never use tailwind`). */
  display: string;
  /** Content words (target of the negation, stopwords removed). */
  contentTokens: string[];
  /** True for `!foo` shorthand from the original. */
  explicitBang: boolean;
}

function extractConstraints(text: string): Constraint[] {
  const normalized = normalize(text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const out: Constraint[] = [];
  const explicitBangs = (text.match(/!\w+/g) ?? []).map((s) => s.toLowerCase());
  for (const bang of explicitBangs) {
    const word = bang.slice(1);
    if (!word) continue;
    out.push({ display: bang, contentTokens: [word], explicitBang: true });
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    const bigram = i + 1 < tokens.length ? `${token} ${tokens[i + 1] ?? ""}` : token;
    const matched = NEGATION_WORDS.find((w) => w === token || w === bigram);
    if (!matched) continue;
    const advance = matched.includes(" ") ? 2 : 1;
    const following = tokens.slice(i + advance, i + advance + 3);
    const content = following.filter((t) => !STOPWORDS.has(t));
    if (content.length === 0) continue;
    out.push({
      display: `${matched} ${following.join(" ")}`.trim(),
      contentTokens: content,
      explicitBang: false,
    });
  }

  const seen = new Set<string>();
  return out.filter((c) => {
    const key = c.contentTokens.join(" ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Returns true if the compressed output preserves a given constraint,
 * using proximity between content tokens and a negation marker.
 */
function compressedPreserves(compressed: string, constraint: Constraint): boolean {
  const normalized = normalize(compressed);
  if (constraint.explicitBang && constraint.contentTokens.length > 0) {
    const w = constraint.contentTokens[0];
    if (w && normalized.includes(`!${w}`)) return true;
  }
  // Require at least one content token from the original negated phrase.
  const candidates = constraint.contentTokens.filter((t) => normalized.includes(t));
  if (candidates.length === 0) return false;

  // Locate every occurrence of each candidate token and require a negation
  // marker within a short window (±6 tokens) of at least one match.
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const WINDOW = 6;
  for (const token of candidates) {
    const indices: number[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i] === token || tokens[i] === `!${token}`) indices.push(i);
    }
    if (indices.length === 0 && normalized.includes(`!${token}`)) return true;
    for (const idx of indices) {
      if (tokens[idx] === `!${token}`) return true;
      const lo = Math.max(0, idx - WINDOW);
      const hi = Math.min(tokens.length, idx + WINDOW + 1);
      for (let j = lo; j < hi; j += 1) {
        const t = tokens[j];
        if (!t) continue;
        if (COMPRESSED_NEGATION_MARKERS.includes(t)) return true;
        if (t.startsWith("!")) return true;
      }
    }
  }
  return false;
}

export function verifyNegativeConstraints(
  original: string,
  compressed: string,
): NegativeConstraintReport {
  const constraints = extractConstraints(original);
  const missing = constraints
    .filter((c) => !compressedPreserves(compressed, c))
    .map((c) => c.display);
  return {
    preserved: missing.length === 0,
    missing,
    originalCount: constraints.length,
    compressedCount: constraints.length - missing.length,
  };
}

function uniqueList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function extractNumericConstraints(text: string): string[] {
  const out: string[] = [];
  const normalized = text.toLowerCase();
  const strictPairs =
    normalized.match(
      /\b\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds?|m|min|minutes?|h|hr|hours?|kb|mb|gb|tb|%|percent|x)\b/g,
    ) ?? [];
  out.push(...strictPairs);

  const statusCodes = normalized.match(/\b(?:[1-5]xx|[1-5]\d{2})\b/g) ?? [];
  out.push(...statusCodes);

  const guardedNumbers =
    normalized.match(
      /\b(?:ttl|timeout|window|limit|retries?|retry|minutes?|seconds?|hours?|days?|tokens?|size|mb|gb|ratio|latency)\s*(?:[:=]?\s*)\d+(?:\.\d+)?\b/g,
    ) ?? [];
  out.push(...guardedNumbers);

  return uniqueList(out.map((x) => x.trim()));
}

function verifyNumericConstraints(original: string, compressed: string): NumericConstraintReport {
  const constraints = extractNumericConstraints(original);
  const normalizedCompressed = normalize(compressed);
  const missing = constraints.filter((c) => !normalizedCompressed.includes(c));
  return {
    preserved: missing.length === 0,
    missing,
    originalCount: constraints.length,
    compressedCount: constraints.length - missing.length,
  };
}

function extractSchemaConstraints(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  const quotedKeys = text.match(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g) ?? [];
  out.push(...quotedKeys.map((k) => k.toLowerCase().trim()));
  const routes = text.match(/\b\/[a-zA-Z0-9._~!$&'()*+,;=:@/-]+\b/g) ?? [];
  out.push(...routes.map((x) => x.toLowerCase().trim()));
  const methods = lower.match(/\b(get|post|put|patch|delete|head|options)\b/g) ?? [];
  out.push(...methods);
  return uniqueList(out);
}

function verifySchemaConstraints(original: string, compressed: string): SchemaConstraintReport {
  const constraints = extractSchemaConstraints(original);
  const normalizedCompressed = compressed.toLowerCase();
  const missing = constraints.filter((c) => !normalizedCompressed.includes(c));
  return {
    preserved: missing.length === 0,
    missing,
    originalCount: constraints.length,
    compressedCount: constraints.length - missing.length,
  };
}

export function verifyConstraints(
  original: string,
  compressed: string,
  opts: { strictNumeric?: boolean; strictNegation?: boolean } = {},
): ConstraintValidationReport {
  const negation = verifyNegativeConstraints(original, compressed);
  const numeric = verifyNumericConstraints(original, compressed);
  const schema = verifySchemaConstraints(original, compressed);
  const negationPreserved = opts.strictNegation === false ? true : negation.preserved;
  const numericPreserved = opts.strictNumeric === false ? true : numeric.preserved;
  const preserved = negationPreserved && numericPreserved && schema.preserved;
  const missing = [
    ...(negationPreserved ? [] : negation.missing.map((x) => `neg:${x}`)),
    ...(numericPreserved ? [] : numeric.missing.map((x) => `num:${x}`)),
    ...schema.missing.map((x) => `schema:${x}`),
  ];
  return { preserved, missing, negation, numeric, schema };
}
