# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-04-18

Complete rewrite as a TypeScript monorepo with a universal installer and a
dedicated editor extension.

### Added
- TypeScript strict-mode codebase with modular `src/` layout (`engine/`,
  `providers/`, `config/`, `mcp/`, `cli/`, `util/`).
- **Universal installer** (`superz init` / `npx prompt-compressor init`) that
  detects and configures every MCP-compatible client: Claude Desktop, Claude
  Code CLI, Cursor, VSCode (Copilot / Continue), Windsurf, Gemini CLI, Qwen
  Code, Codex CLI, Antigravity, Zed, plus a universal `AGENTS.md` fallback.
- `superz doctor` to verify providers and client configs.
- `superz stats` with per-provider latency p50/p95, win-rate, and tokens
  saved.
- `superz serve --http` with Streamable HTTP + SSE MCP transport and a plain
  REST `POST /v1/compress` endpoint.
- Dedicated VSCode/Cursor/Antigravity extension with compress-selection,
  compress-clipboard, status-bar counter, SecretStorage-backed API keys, and
  auto MCP registration.
- **Negative-constraint validator**: compressions that drop `not` / `never`
  / `no X` / `!X` / `without X` are automatically rejected and fall back to
  the deterministic regex compressor.
- Accurate token counts via `gpt-tokenizer` (cl100k_base) instead of the
  `length / 4` heuristic.
- LRU + disk compression cache keyed by
  `sha256(systemPromptVersion + providerSetVersion + normalizedPrompt)`.
- Persistent metrics at `~/.superz/metrics.json` + adaptive fast-tier
  ordering based on historical win rate.
- Structured logging via `consola` (stderr only, so MCP stdio is
  unaffected).
- Dockerfile, docker-compose, and GHCR-ready image labels.
- GitHub Actions CI (lint + typecheck + test on Node 18/20/22 across
  Windows / macOS / Linux; npm publish with provenance on tag).

### Changed
- Single-file `src/index.js` removed; replaced by modular `src/**/*.ts`.
- `compressPrompt` now cancels losing provider requests via a shared
  `AbortController` instead of letting them run to completion.
- `.env` parsing is via `dotenv` + Zod validation instead of a hand-rolled
  parser.
- README fully rewritten around `npx prompt-compressor init`.
- `GEMINI.md` is now a generated artifact from a single shared template.

### Security
- API keys in the VSCode extension are stored in SecretStorage, not user
  settings.
- HTTP mode supports a required bearer token via `--token` or
  `SUPERZ_HTTP_TOKEN`.

## [1.0.0] — 2026-04-18

Initial single-file release.
