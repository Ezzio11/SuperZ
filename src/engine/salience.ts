import { countTokens } from "./tokenizer.js";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "with",
  "and",
  "or",
  "if",
  "then",
  "that",
  "this",
  "it",
  "is",
  "are",
  "be",
  "as",
  "from",
  "we",
  "you",
  "they",
  "i",
]);

interface ClauseScore {
  idx: number;
  text: string;
  score: number;
  tokens: number;
}

export type PromptSizeTier = "small" | "medium" | "large";

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_/\-.\s]/g, " ")
    .split(/\s+/)
    // Strip leading/trailing punctuation ("-", ".", ",") so tokens like
    // "calls." and "calls" match each other and bare list-bullets like
    // "-" don't leak into the anchor set.
    .map((t) => t.replace(/^[-.,]+|[-.,]+$/g, ""))
    .filter(Boolean);
}

/**
 * Extremely light English stemmer. Collapses common morphological
 * variants so that a query word like "partition" matches an answer
 * clause containing "partitioned" or "partitions". Intentionally
 * conservative: leaves short tokens and identifier-like tokens
 * (containing `_` or `/`) untouched to avoid corrupting snake_case
 * schema identifiers such as `tenant_id` or path fragments like
 * `/v1/users`.
 */
function stemWord(w: string): string {
  if (w.length <= 4) return w;
  if (w.includes("_") || w.includes("/") || w.includes("-")) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

function stemmedSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(text)) out.add(stemWord(w));
  return out;
}

/**
 * Does a clause reference a schema-identifier-looking token (snake_case
 * with underscore, camelCase, or quoted identifier)? These are almost
 * always answer-bearing tokens in RAG / doc-QA contexts and should
 * never be pruned when the query is about "field"/"key"/"column"/"table".
 */
const IDENTIFIER_PATTERN = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/;
const IDENTIFIER_QUERY_HINTS = new Set([
  "field", "column", "key", "identifier", "id", "name",
  "table", "topic", "variable", "parameter", "flag",
  "partition", "index", "schema", "property",
]);

function splitClauses(text: string): string[] {
  return text
    .split(/(?:\n+|(?<=[.?!;])\s+)/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function hasCodeLikeSignal(text: string): boolean {
  return /[`{}[\]():=>]|\/v\d+\/|https?:\/\/|[A-Z_]{3,}|[a-z0-9_]+\([^)]*\)/.test(text);
}

function anchorsFromPrompt(prompt: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(prompt)) {
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    out.add(w);
  }
  // Keep explicit forbidden words around negations highly weighted.
  const negatedTargets =
    prompt.toLowerCase().match(
      /\b(?:not|never|without|forbid|forbidden|disallow|deny|reject|cannot|can't|must not)\b\s+([a-z0-9_/-]+)/g,
    ) ?? [];
  for (const target of negatedTargets) {
    const parts = words(target);
    for (const p of parts) if (p.length >= 3) out.add(p);
  }
  return out;
}

/**
 * Extract the *query* portion of a long prompt. Real-world long prompts
 * almost always end with the actual question/task following a trailing
 * marker: "Question:", "USER:", "User task:", or an imperative.
 *
 * Returns the substring we believe contains the query, or empty string
 * if no clear marker was found. Used downstream to boost clauses that
 * share content words with the query.
 */
export function extractQuery(prompt: string): string {
  const markers = [
    /\bQuestion:\s*([^\n]{0,400})/i,
    /\bUser task:\s*([^\n]{0,400})/i,
    /\bUSER:\s*([^\n]{0,400})(?!.*\bUSER:)/is,
    /\bTask:\s*([^\n]{0,400})/i,
  ];
  for (const re of markers) {
    const m = prompt.match(re);
    if (m && m[1]) return m[1].trim();
  }
  // Fallback: last non-empty line, which usually carries the ask.
  const lines = prompt.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

function queryAnchors(query: string): Set<string> {
  const out = new Set<string>();
  if (!query) return out;
  for (const w of words(query)) {
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    // Drop generic interrogative / task words.
    if (["what", "which", "when", "where", "who", "whom", "how", "why",
         "question", "task", "answer", "reply", "describe", "explain",
         "should", "would", "could", "name", "list", "give",
         "sentence", "short", "one"].includes(w)) continue;
    out.add(stemWord(w));
  }
  return out;
}

function scoreClause(
  text: string,
  anchors: Set<string>,
  queryTerms: Set<string>,
  queryHasIdentifierHint: boolean,
): number {
  const w = words(text);
  if (w.length === 0) return 0;
  let score = 0;
  let queryHits = 0;
  const seenHits = new Set<string>();
  for (const token of w) {
    if (anchors.has(token)) score += 1;
    const stem = stemWord(token);
    if (queryTerms.has(stem) && !seenHits.has(stem)) {
      score += 5;
      queryHits += 1;
      seenHits.add(stem);
    }
  }
  // Strong bonus when the clause overlaps with the query on multiple
  // distinct content words: this is the clause most likely to contain
  // the answer in a RAG / document-QA context.
  if (queryHits >= 2) score += 6;
  // If the query is about a named thing (field/column/key/identifier/...)
  // and this clause carries any schema-identifier-looking token, treat it
  // as very likely answer-bearing. One query-term hit is enough to boost.
  if (queryHasIdentifierHint && queryHits >= 1 && IDENTIFIER_PATTERN.test(text)) {
    score += 8;
  }
  if (/\b(?:must|should|required?|never|not|without|forbid|disallow|deny|reject|cannot|can't)\b/i.test(text)) {
    score += 4;
  }
  if (/\b\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds?|m|min|minutes?|h|hours?|kb|mb|gb|tb|%|x)\b/i.test(text)) {
    score += 3;
  }
  if (/(\/v\d+\/|\/[a-z0-9/_-]+|status|json|schema|http|post|get|put|patch|delete)/i.test(text)) {
    score += 2;
  }
  if (hasCodeLikeSignal(text)) score += 2;
  if (text.length > 220) score -= 1;
  return score;
}

/**
 * Query-aware salience pruning for long prompts. Retains the most important
 * clauses (constraints, numbers, API/schema details) under an adaptive budget.
 */
// Regex to identify "must-keep" constraint clauses. Broader than the negation
// list in validator.ts because here we also want to preserve IMPERATIVES
// and numeric thresholds even when they use softer verbs (avoid, limit).
const MUST_KEEP_PATTERN =
  /\b(?:must|should|required?|never|not|without|forbid|disallow|deny|reject|cannot|can't|avoid|exclude|prohibit|limit|cap|max|min|at least|at most|only|no\b)\b/i;

const NUMERIC_LITERAL_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds?|m|min|minutes?|h|hr|hours?|d|days?|kb|mb|gb|tb|%|percent|x|req|requests?|bytes?|chars?|tokens?|rows?|records?)\b/i;

const STATUS_CODE_PATTERN = /\b[1-5]\d{2}\b|\b[1-5]xx\b/i;

function isConstraintClause(text: string): boolean {
  if (MUST_KEEP_PATTERN.test(text)) return true;
  if (NUMERIC_LITERAL_PATTERN.test(text)) return true;
  if (STATUS_CODE_PATTERN.test(text)) return true;
  return false;
}

export function pruneBySalience(
  prompt: string,
  keepRatio: number,
  tier: PromptSizeTier,
  queryOverride?: string,
): string {
  const clauses = splitClauses(prompt);
  if (clauses.length <= 1) return prompt.trim();

  // Minimum keep-ratio must allow real compression on long contexts.
  // Callers supply ratios as low as 0.35 for very long prompts.
  const boundedKeepRatio = Math.max(0.25, Math.min(0.95, keepRatio));
  const originalTokens = countTokens(prompt);
  const targetTokens = Math.max(1, Math.floor(originalTokens * boundedKeepRatio));
  const anchors = anchorsFromPrompt(prompt);
  const query = queryOverride ?? extractQuery(prompt);
  const queryTerms = queryAnchors(query);
  const queryRawTokens = new Set(words(query));
  const queryHasIdentifierHint = [...queryRawTokens].some((t) =>
    IDENTIFIER_QUERY_HINTS.has(t),
  );

  const scored: ClauseScore[] = clauses.map((text, idx) => ({
    idx,
    text,
    score: scoreClause(text, anchors, queryTerms, queryHasIdentifierHint),
    tokens: countTokens(text),
  }));

  const keep = new Set<number>([0]); // Always preserve the first clause/task framing.
  let total = scored[0]?.tokens ?? 0;

  // Always retain constraint-bearing clauses regardless of budget. Dropping
  // them causes the validator to reject the whole candidate, wasting the
  // entire compression effort. Better to keep them and compress elsewhere.
  const mustKeep = scored.filter((s) => isConstraintClause(s.text));
  const mustKeepCodeLike = scored.filter((s) => hasCodeLikeSignal(s.text));
  // Force-keep every clause that shares >=2 stemmed content words with the
  // query, OR shares >=1 query word AND contains a schema identifier when
  // the query asks for a named thing. These are the clauses most likely
  // to carry the actual answer.
  const mustKeepQuery = scored.filter((s) => {
    if (queryTerms.size === 0) return false;
    const tokens = stemmedSet(s.text);
    let hits = 0;
    for (const q of queryTerms) if (tokens.has(q)) hits += 1;
    if (hits >= 2) return true;
    if (hits >= 1 && queryHasIdentifierHint && IDENTIFIER_PATTERN.test(s.text)) {
      return true;
    }
    return false;
  });
  for (const clause of [...mustKeep, ...mustKeepCodeLike, ...mustKeepQuery]) {
    if (!keep.has(clause.idx)) {
      keep.add(clause.idx);
      total += clause.tokens;
    }
  }

  // Always keep the last clause (typically contains the final task / question).
  const lastIdx = clauses.length - 1;
  if (lastIdx >= 0 && !keep.has(lastIdx) && scored[lastIdx]) {
    keep.add(lastIdx);
    total += scored[lastIdx].tokens;
  }

  const byImportance = [...scored].sort((a, b) => b.score - a.score || a.idx - b.idx);
  for (const clause of byImportance) {
    if (keep.has(clause.idx)) continue;
    if (tier === "medium" && clause.score < 2) continue;
    if (total + clause.tokens > targetTokens) continue;
    keep.add(clause.idx);
    total += clause.tokens;
  }

  if (keep.size === clauses.length) return prompt.trim();
  // Preserve original clause order and join with space (sentence-like output).
  return clauses
    .filter((_, idx) => keep.has(idx))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function adaptiveKeepRatio(prompt: string, tier: PromptSizeTier): number {
  const tok = countTokens(prompt);
  if (tier === "medium") {
    if (tok >= 240) return 0.82;
    return 0.88;
  }
  // large
  if (tok >= 4000) return 0.35;
  if (tok >= 2000) return 0.42;
  if (tok >= 1000) return 0.5;
  if (tok >= 600) return 0.58;
  if (tok >= 350) return 0.65;
  return 0.72;
}

/**
 * Split input into structural sections, treating markdown-style headings
 * (`#`, `##`, `###`) and delimiter lines (e.g. `--- REFERENCE START ---`)
 * as hard boundaries. Each section is pruned independently so that we
 * never merge a heading line with its body into a single noisy blob.
 *
 * Returns the original string unchanged when no structural markers are
 * found, so short plain prompts keep their exact existing behaviour.
 */
export function splitIntoSections(text: string): string[] {
  const headingLine = /^(?:#{1,6}\s+|-{3,}\s*[A-Z][^\n]*|USER:|ASSISTANT:|SYSTEM:|Question:)/;
  const lines = text.split(/\n/);
  const sections: string[][] = [];
  let current: string[] = [];
  let sawHeading = false;
  for (const line of lines) {
    if (headingLine.test(line.trim())) {
      sawHeading = true;
      if (current.length > 0) sections.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) sections.push(current);
  if (!sawHeading || sections.length < 2) return [text];
  return sections.map((lines) => lines.join("\n").trim()).filter(Boolean);
}

/**
 * Section-aware pruning. Splits by structural markers first, then prunes
 * each section independently with `pruneBySalience`, preserving headings
 * and dialogue role tags as anchors even when their content is short.
 */
export function pruneSectionAware(
  prompt: string,
  keepRatio: number,
  tier: PromptSizeTier,
): string {
  const sections = splitIntoSections(prompt);
  const query = extractQuery(prompt);
  if (sections.length <= 1) return pruneBySalience(prompt, keepRatio, tier, query);
  return sections
    .map((section) => pruneBySalience(section, keepRatio, tier, query))
    .join("\n\n");
}
