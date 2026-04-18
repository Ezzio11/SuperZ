import * as vscode from "vscode";

const KEY_PREFIX = "promptCompressor.secret.";

/**
 * Tiny wrapper around VSCode SecretStorage so we never persist API
 * keys to user settings (where they'd sync across machines).
 */
export class SecretKeyStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(envName: string): Promise<string | undefined> {
    return this.secrets.get(KEY_PREFIX + envName);
  }

  async set(envName: string, value: string): Promise<void> {
    await this.secrets.store(KEY_PREFIX + envName, value);
  }

  async asEnvBlock(): Promise<Record<string, string>> {
    const names = ["CEREBRAS_API_KEY", "GROQ_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "HF_API_KEY"];
    const env: Record<string, string> = {};
    for (const name of names) {
      const value = await this.get(name);
      if (value) env[name] = value;
    }
    return env;
  }
}
