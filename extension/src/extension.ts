import * as vscode from "vscode";
import { registerMcpServer } from "./mcp-registration.js";
import { SecretKeyStore } from "./secrets.js";
import { SessionStats } from "./session-stats.js";
import { compressWithSecrets } from "./compress.js";

const OUTPUT_NAME = "Prompt Compressor";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(OUTPUT_NAME, { log: true });
  output.info("Prompt Compressor extension activated");

  const secrets = new SecretKeyStore(context.secrets);
  const stats = new SessionStats(context.globalState);

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.command = "promptCompressor.openStats";
  statusBar.tooltip = "Prompt Compressor — click for session stats";
  context.subscriptions.push(statusBar);

  const refreshStatus = (): void => {
    const saved = stats.totalTokensSaved();
    statusBar.text = saved > 0 ? `$(rocket) ${saved.toLocaleString()} tokens saved` : "$(rocket) Compressor";
    statusBar.show();
  };
  refreshStatus();

  context.subscriptions.push(
    vscode.commands.registerCommand("promptCompressor.compressSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor.");
        return;
      }
      const sel = editor.selection;
      const text = editor.document.getText(sel);
      if (!text.trim()) {
        vscode.window.showWarningMessage("Selection is empty.");
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Compressing…" },
        async () => {
          try {
            const result = await compressWithSecrets(text, secrets);
            await editor.edit((edit) => edit.replace(sel, result.compressed));
            stats.record(result.originalTokens, result.compressedTokens);
            refreshStatus();
            output.info(
              `Compressed selection: ${result.provider} saved ${result.savedTokens} tokens (${result.percentSaved}%)`,
            );
          } catch (err) {
            output.error(`Compression failed: ${(err as Error).message}`);
            vscode.window.showErrorMessage(`Compression failed: ${(err as Error).message}`);
          }
        },
      );
    }),

    vscode.commands.registerCommand("promptCompressor.compressClipboard", async () => {
      const text = await vscode.env.clipboard.readText();
      if (!text.trim()) {
        vscode.window.showWarningMessage("Clipboard is empty.");
        return;
      }
      const result = await compressWithSecrets(text, secrets);
      await vscode.env.clipboard.writeText(result.compressed);
      stats.record(result.originalTokens, result.compressedTokens);
      refreshStatus();
      vscode.window.showInformationMessage(
        `Clipboard compressed — ${result.savedTokens} tokens saved (${result.percentSaved}%).`,
      );
    }),

    vscode.commands.registerCommand("promptCompressor.toggleAutoCompressPaste", async () => {
      const cfg = vscode.workspace.getConfiguration("promptCompressor");
      const current = cfg.get<boolean>("autoCompressOnPaste", false);
      await cfg.update("autoCompressOnPaste", !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `Auto-compress on paste: ${!current ? "enabled" : "disabled"}`,
      );
    }),

    vscode.commands.registerCommand("promptCompressor.openStats", () => {
      const snap = stats.snapshot();
      output.show(true);
      output.info("=== Prompt Compressor — session stats ===");
      output.info(`Requests:         ${snap.requests}`);
      output.info(`Tokens in:        ${snap.totalOriginal.toLocaleString()}`);
      output.info(`Tokens out:       ${snap.totalCompressed.toLocaleString()}`);
      output.info(`Tokens saved:     ${snap.totalSaved.toLocaleString()}`);
      if (snap.totalOriginal > 0) {
        const pct = Math.round((snap.totalSaved / snap.totalOriginal) * 100);
        output.info(`Average reduction: ${pct}%`);
      }
    }),

    vscode.commands.registerCommand("promptCompressor.setApiKey", async () => {
      const provider = await vscode.window.showQuickPick(
        [
          { label: "Cerebras", value: "CEREBRAS_API_KEY" },
          { label: "Groq", value: "GROQ_API_KEY" },
          { label: "Google (Gemini)", value: "GOOGLE_API_KEY" },
          { label: "OpenRouter", value: "OPENROUTER_API_KEY" },
          { label: "HuggingFace", value: "HF_API_KEY" },
        ],
        { placeHolder: "Which provider?" },
      );
      if (!provider) return;
      const key = await vscode.window.showInputBox({
        prompt: `Paste your ${provider.label} API key`,
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      await secrets.set(provider.value, key.trim());
      vscode.window.showInformationMessage(`${provider.label} key saved to VSCode SecretStorage.`);
    }),
  );

  const mcpEnabled = vscode.workspace
    .getConfiguration("promptCompressor")
    .get<boolean>("mcpServer.enabled", true);
  if (mcpEnabled) {
    try {
      registerMcpServer(context, secrets);
      output.info("Registered MCP server with the host (Copilot / Cursor / Antigravity).");
    } catch (err) {
      output.warn(`MCP server registration skipped: ${(err as Error).message}`);
    }
  }
}

export function deactivate(): void {
  // no-op; all disposables are tracked via context.subscriptions.
}
