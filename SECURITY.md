# Security Policy

## Reporting a vulnerability

Please email the maintainers privately instead of opening a public issue:

- [Ezzio](https://github.com/Ezzio11)
- [Samahy](https://github.com/MO-Elsamahy)

Expect an acknowledgement within 72 hours and a coordinated disclosure
plan within two weeks for confirmed issues.

## What we treat as a vulnerability

- Remote code execution in the MCP server or CLI.
- Arbitrary file write outside the documented config paths (the universal
  installer).
- API key leakage from `.env`, SecretStorage, or cache files.
- Downgrade or injection of the system prompt such that the compressor
  begins *answering* the user's prompt rather than compressing it.
- Bypass of the negative-constraint validator in
  [`src/engine/validator.ts`](./src/engine/validator.ts) — any case where a
  compression silently drops a `not` / `never` / `no X` / `!X` / `without X`
  constraint. These can have outsized real-world consequences.

## What we do NOT treat as a vulnerability

- Provider-side failures or rate limits.
- Compression of long prompts into output that is still legal but
  stylistically different from a human-written compression.
- Cache hits replaying a previous compression — the cache is keyed by the
  normalized prompt plus system prompt and provider set versions.

## Handling of API keys

- Keys are loaded from `.env` (via `dotenv`) or from VSCode SecretStorage
  (for the extension). They are **never** logged, never written to the disk
  cache, and never returned in any HTTP response.
- The extension scopes secrets with a `promptCompressor.secret.` prefix so
  they cannot collide with other extensions' secrets.
- `superz doctor` prints only provider names and latencies, never keys.
