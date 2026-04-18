# Prompt Compressor (SuperZ) — VSCode / Cursor / Antigravity extension

Compress verbose prompts inline in your editor, save the tokens, and never leak
API keys to synced settings. The extension also registers a bundled MCP server
with your editor's AI host (Copilot agent mode, Cursor, Antigravity) so you
don't have to edit `mcp.json` by hand.

## Commands

| Command                                              | Default shortcut     |
| ---------------------------------------------------- | -------------------- |
| `Prompt Compressor: Compress Selection`              | `Ctrl/Cmd+Alt+K`     |
| `Prompt Compressor: Compress Clipboard`              | —                    |
| `Prompt Compressor: Toggle Auto-Compress on Paste`   | —                    |
| `Prompt Compressor: Open Session Stats`              | click the status bar |
| `Prompt Compressor: Set API Key`                     | —                    |

## Getting started

1. Install from the VS Code Marketplace (or Open VSX for Cursor / Antigravity / VSCodium).
2. Run `Prompt Compressor: Set API Key` and add at least one of:
   - `CEREBRAS_API_KEY`, `GROQ_API_KEY`, `GOOGLE_API_KEY` (fast tier, recommended).
   - `OPENROUTER_API_KEY`, `HF_API_KEY` (fallback tier).
3. Select text in an editor and press `Ctrl/Cmd+Alt+K`.

Keys are stored in VSCode SecretStorage (encrypted, per-machine), never in
user settings.

## Features

- **Inline compress-selection** with progress notification.
- **Clipboard compression** for any external AI tool.
- **Status bar indicator** showing cumulative tokens saved this session.
- **Auto-MCP registration** with Copilot / Cursor / Antigravity when supported.
- **Safety-validated**: the engine rejects compressions that silently drop
  negative constraints (`not`, `never`, `!X`, `without X`) and falls back to
  deterministic regex rules rather than corrupting your intent.

## License

MIT — see the main repository.
