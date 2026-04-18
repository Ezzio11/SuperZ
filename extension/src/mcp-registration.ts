import * as vscode from "vscode";
import { SecretKeyStore } from "./secrets.js";

/**
 * Register the bundled MCP server with VSCode's built-in MCP host
 * (used by Copilot agent mode, Cursor, and Antigravity). When the
 * host doesn't expose an MCP API (older versions), we silently
 * skip — the extension's own commands still work.
 *
 * Using `any` against the VSCode API here because the MCP API
 * surface is evolving rapidly and not yet in @types/vscode stable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type McpDefinitionProvider = any;

export function registerMcpServer(
  context: vscode.ExtensionContext,
  secrets: SecretKeyStore,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lm = (vscode as any).lm;
  if (!lm || typeof lm.registerMcpServerDefinitionProvider !== "function") {
    return;
  }

  const provider: McpDefinitionProvider = {
    provideMcpServerDefinitions: async () => {
      const env = await secrets.asEnvBlock();
      return [
        {
          id: "prompt-compressor",
          label: "Prompt Compressor",
          command: "npx",
          args: ["-y", "prompt-compressor"],
          env,
        },
      ];
    },
    resolveMcpServerDefinition: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      definition: any,
    ) => definition,
  };

  const disposable = lm.registerMcpServerDefinitionProvider(
    "prompt-compressor",
    provider,
  );
  context.subscriptions.push(disposable);
}
