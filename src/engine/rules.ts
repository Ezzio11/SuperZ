/**
 * Deterministic regex-based compression. Used as the final fallback
 * when every LLM provider fails. Focuses on stripping filler words
 * that carry no technical signal.
 */

const FILLER = [
  /\b(please|kindly|could you|can you|i want you to|i need you to|i would like you to|make sure to|be sure to|just|basically|essentially|actually|literally|very|really|quite|rather|somewhat|a bit|a little|if you could|if possible)\b\s*/gi,
  /\bfor all intents and purposes\b/gi,
  /\bas an ai( language model)?\b[,.]?\s*/gi,
];

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bat this point in time\b/gi, "now"],
  [/\bat the present time\b/gi, "now"],
  [/\bwith reference to\b/gi, "re:"],
  [/\bwith regard to\b/gi, "re:"],
  [/\bin the event that\b/gi, "if"],
  [/\bfor the purpose of\b/gi, "to"],
];

/**
 * Collapse near-duplicate paragraphs. RAG contexts routinely repeat the same
 * block multiple times (chunker overlap, duplicated filler). Keeping every
 * copy is pure token waste; keeping one copy preserves the information.
 *
 * We normalise whitespace and lower-case for the signature only, so exact
 * original formatting is preserved for the *first* occurrence.
 */
function dedupeParagraphs(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  if (paragraphs.length < 2) return text;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paragraphs) {
    const stripped = p.trim();
    if (!stripped) continue;
    const sig = stripped.toLowerCase().replace(/\s+/g, " ");
    if (sig.length < 24) {
      // Short paragraphs (likely headers / single lines) are kept as-is to
      // avoid removing structural anchors like "Question:".
      out.push(p);
      continue;
    }
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(p);
  }
  return out.join("\n\n");
}

/**
 * Dedupe sentence-level repetition inside a paragraph. Common in generated
 * filler ("Remember: never log secrets. Remember: never log secrets.").
 */
function dedupeSentences(text: string): string {
  return text
    .split(/\n/)
    .map((line) => {
      const sentences = line.split(/(?<=[.!?])\s+/);
      if (sentences.length < 2) return line;
      const seen = new Set<string>();
      const kept: string[] = [];
      for (const s of sentences) {
        const sig = s.trim().toLowerCase().replace(/\s+/g, " ");
        if (sig.length < 12) {
          kept.push(s);
          continue;
        }
        if (seen.has(sig)) continue;
        seen.add(sig);
        kept.push(s);
      }
      return kept.join(" ");
    })
    .join("\n");
}

export function ruleBasedCompress(text: string): string {
  let out = text;
  for (const pattern of FILLER) out = out.replace(pattern, "");
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  out = dedupeSentences(out);
  out = dedupeParagraphs(out);
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
