import { CompressionEngine, loadConfig, type CompressionResult } from "prompt-compressor";
import { SecretKeyStore } from "./secrets.js";

/**
 * Runs the shared compression engine using secrets from VSCode's
 * SecretStorage instead of `.env`. This keeps API keys out of
 * user settings while still letting us reuse the exact same engine
 * that the bundled MCP server runs.
 */
export async function compressWithSecrets(
  prompt: string,
  secrets: SecretKeyStore,
): Promise<CompressionResult> {
  const env = await secrets.asEnvBlock();
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    const config = loadConfig();
    const engine = new CompressionEngine(config);
    return await engine.compress(prompt, { force: true });
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
