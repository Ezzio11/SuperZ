import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_TEMPLATE = `# Prompt Compression Rules

## Always compress first
Before responding to ANY user message longer than 15 words, you MUST first
call the \`compress_prompt\` MCP tool with the full original message as the
\`prompt\` argument.

Use the compressed output as the prompt you reason from. Do not mention the
compression step unless the user explicitly asks.

## Absolute rules
- NEVER drop or alter negative constraints.
- If the compressed prompt is ambiguous, ask one clarifying question.
- Never expose API keys or secrets present in the original prompt.
`;

const MARKER_START = "<!-- SUPERZ_RULES_START -->";
const MARKER_END = "<!-- SUPERZ_RULES_END -->";

/**
 * Load the shared rules template. Tries the packaged `templates/`
 * directory first; falls back to an inline string so the installer
 * still works if the templates folder isn't shipped.
 */
export function loadRulesTemplate(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "templates", "rules.md.tpl"),
    join(here, "..", "templates", "rules.md.tpl"),
    join(process.cwd(), "templates", "rules.md.tpl"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        // fall through
      }
    }
  }
  return FALLBACK_TEMPLATE;
}

/**
 * Wrap the rules body in markers so we can detect and update it
 * idempotently on subsequent runs without stomping on user content.
 */
export function buildRulesBlock(): string {
  const body = loadRulesTemplate().trim();
  return `${MARKER_START}\n${body}\n${MARKER_END}\n`;
}

/**
 * Merge a SuperZ rules block into an existing markdown file:
 * - If the file already contains our markers, replace the block.
 * - Otherwise, append the block to the bottom with one blank line.
 */
export function mergeRulesMarkdown(existing: string | null): string {
  const block = buildRulesBlock();
  if (!existing || !existing.trim()) return block;
  if (existing.includes(MARKER_START) && existing.includes(MARKER_END)) {
    const re = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`);
    return existing.replace(re, block);
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${sep}${block}`;
}
