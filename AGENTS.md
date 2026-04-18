<!-- SUPERZ_RULES_START -->
# Prompt Compression Rules

## Always compress first
Before responding to ANY user message longer than 15 words, you MUST first
call the `compress_prompt` MCP tool with the full original message as the
`prompt` argument.

Use the compressed output as the prompt you reason from. Do not mention the
compression step unless the user explicitly asks.

## When to skip
- Short messages (under 15 words) — no benefit.
- Conversational questions ("what do you think", "which is better", "help me
  decide") — the tool will bypass these automatically.
- Direct code-edit requests where the user has pasted exact code to modify
  verbatim.

## Absolute rules
- NEVER drop or alter negative constraints (`not`, `never`, `no X`, `!X`,
  `without X`). The tool's safety validator enforces this, but you must also
  respect negative constraints when reasoning from the compressed output.
- If the compressed prompt is ambiguous, you may ask the user one clarifying
  question rather than guessing.
- Never expose API keys, session tokens, or other secrets present in the
  original prompt after compression.
<!-- SUPERZ_RULES_END -->
