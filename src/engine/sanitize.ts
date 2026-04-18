/**
 * Sanitize LLM compressor output. Chat-tuned models routinely add
 * conversational scaffolding ("Here is the compressed prompt:", "Sure,",
 * markdown code fences, trailing "Let me know if..."). That scaffolding
 * inflates token counts and sometimes doubles the "compressed" output
 * past the original length. We strip it aggressively but conservatively.
 */
const PREAMBLE_PATTERNS: RegExp[] = [
  /^\s*(sure|certainly|absolutely|of course|okay|ok|alright|got it|understood)[,:.!\s-]+/i,
  /^\s*here('?s| is)(\s+the)?\s+(compressed|minified|condensed|rewritten|shortened|revised)[^:\n]*[:\n-]+/i,
  /^\s*(the\s+)?(compressed|minified|condensed|rewritten|shortened)\s+(prompt|version|form|output)[^:\n]*[:\n-]+/i,
  /^\s*here('?s| is)[^:\n]*[:\n-]+/i,
  /^\s*(compressed|output|result|answer)\s*[:=-]\s*/i,
];

const POSTAMBLE_PATTERNS: RegExp[] = [
  /\n+\s*(let me know|hope this helps|feel free|if you|is there anything).*/is,
  /\n+\s*(this version|the compressed|this preserves|the above).*/is,
];

export function sanitizeCompression(raw: string): string {
  let text = raw ?? "";
  text = text.trim();
  if (!text) return text;

  // Strip markdown code fences if the whole thing is wrapped in one.
  const fencedMatch = text.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
  if (fencedMatch && fencedMatch[1]) text = fencedMatch[1].trim();

  // Strip matching surrounding quotes.
  const quoteMatch = text.match(/^["'`](.*)["'`]$/s);
  if (quoteMatch && quoteMatch[1]) text = quoteMatch[1].trim();

  for (const pat of PREAMBLE_PATTERNS) {
    const replaced = text.replace(pat, "").trim();
    if (replaced && replaced.length < text.length) text = replaced;
  }
  for (const pat of POSTAMBLE_PATTERNS) {
    text = text.replace(pat, "").trim();
  }
  return text;
}
