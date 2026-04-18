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
    .filter(Boolean);
}

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

function scoreClause(text: string, anchors: Set<string>): number {
  const w = words(text);
  if (w.length === 0) return 0;
  let score = 0;
  for (const token of w) {
    if (anchors.has(token)) score += 1;
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
export function pruneBySalience(prompt: string, keepRatio: number, tier: PromptSizeTier): string {
  const clauses = splitClauses(prompt);
  if (clauses.length <= 1) return prompt.trim();

  const boundedKeepRatio = Math.max(0.5, Math.min(0.95, keepRatio));
  const originalTokens = countTokens(prompt);
  const targetTokens = Math.max(1, Math.floor(originalTokens * boundedKeepRatio));
  const anchors = anchorsFromPrompt(prompt);

  const scored: ClauseScore[] = clauses.map((text, idx) => ({
    idx,
    text,
    score: scoreClause(text, anchors),
    tokens: countTokens(text),
  }));

  const keep = new Set<number>([0]); // Always preserve the first clause/task framing.
  let total = scored[0]?.tokens ?? 0;

  const mustKeep = scored.filter((s) =>
    /\b(?:must|should|required?|never|not|without|forbid|disallow|deny|reject|cannot|can't)\b/i.test(
      s.text,
    ),
  );
  const mustKeepCodeLike = scored.filter((s) => hasCodeLikeSignal(s.text));
  for (const clause of [...mustKeep, ...mustKeepCodeLike]) {
    if (!keep.has(clause.idx)) {
      keep.add(clause.idx);
      total += clause.tokens;
    }
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
  if (tok >= 600) return 0.58;
  if (tok >= 350) return 0.65;
  return 0.72;
}
