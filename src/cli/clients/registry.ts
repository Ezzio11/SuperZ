import { AgentsMdWriter } from "./agents-md.js";
import { AntigravityWriter } from "./antigravity.js";
import { ClaudeCodeWriter } from "./claude-code.js";
import { ClaudeDesktopWriter } from "./claude-desktop.js";
import { ClientWriter } from "./base.js";
import { CodexCliWriter } from "./codex-cli.js";
import { ContinueWriter } from "./continue.js";
import { CursorWriter } from "./cursor.js";
import { GeminiCliWriter } from "./gemini-cli.js";
import { QwenCodeWriter } from "./qwen-code.js";
import { VSCodeWriter } from "./vscode.js";
import { WindsurfWriter } from "./windsurf.js";
import { ZedWriter } from "./zed.js";

export function allWriters(): ClientWriter[] {
  return [
    new ClaudeDesktopWriter(),
    new ClaudeCodeWriter(),
    new CursorWriter(),
    new VSCodeWriter("workspace"),
    new VSCodeWriter("user"),
    new ContinueWriter(),
    new WindsurfWriter(),
    new GeminiCliWriter(),
    new QwenCodeWriter(),
    new CodexCliWriter(),
    new AntigravityWriter(),
    new ZedWriter(),
    new AgentsMdWriter(),
  ];
}

export function writerById(id: string): ClientWriter | undefined {
  return allWriters().find((w) => w.info().id === id);
}
