export interface ClientInfo {
  /** Stable slug used in CLI (`superz add cursor`, `superz remove cursor`). */
  id: string;
  /** Human-friendly name for prompts and logs. */
  name: string;
  /** Path of the primary config file this client uses. */
  configPath: string;
  /** Optional companion rules file (CLAUDE.md, GEMINI.md, etc.). */
  rulesPath?: string;
}

export interface DetectResult {
  info: ClientInfo;
  detected: boolean;
  reason?: string;
}

export interface WriteOperation {
  path: string;
  /** What the new file contents will be. `null` signals "delete on remove". */
  contents: string | null;
  description: string;
}

export interface ClientWriter {
  info(): ClientInfo;
  detect(): DetectResult;
  planInstall(): WriteOperation[];
  planUninstall(): WriteOperation[];
}

export const MCP_SERVER_CONFIG = {
  command: "npx",
  args: ["-y", "prompt-compressor"],
};

export const MCP_SERVER_CONFIG_TOML = `command = "npx"\nargs = ["-y", "prompt-compressor"]`;
