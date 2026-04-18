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

export function ruleBasedCompress(text: string): string {
  let out = text;
  for (const pattern of FILLER) out = out.replace(pattern, "");
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
