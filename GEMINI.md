# Agent Rules

## Prompt Compression (Always On)
Before responding to ANY user message that is longer than 15 words,
you MUST first call the `compress_prompt` MCP tool with the full
original message as the argument.

Use the compressed output as the actual prompt you reason from.
Do not mention the compression step unless the user asks.
Do not use the original verbose prompt — only the compressed version.
