import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import TOML from "@iarna/toml";
import { codexHome } from "../../util/paths.js";
import { ClientWriter, DetectResult, WriteOperation } from "./base.js";

/**
 * Codex CLI reads from `~/.codex/config.toml`. MCP servers live under
 * `[mcp_servers.<name>]`.
 */
export class CodexCliWriter implements ClientWriter {
  info() {
    return {
      id: "codex-cli",
      name: "Codex CLI",
      configPath: join(codexHome(), "config.toml"),
    };
  }

  detect(): DetectResult {
    const detected = existsSync(codexHome());
    return {
      info: this.info(),
      detected,
      reason: detected ? undefined : "~/.codex not found",
    };
  }

  private read(): Record<string, unknown> {
    const { configPath } = this.info();
    if (!existsSync(configPath)) return {};
    try {
      return TOML.parse(readFileSync(configPath, "utf8"));
    } catch {
      return {};
    }
  }

  planInstall(): WriteOperation[] {
    const { configPath } = this.info();
    const doc = this.read();
    const servers =
      (doc.mcp_servers as Record<string, unknown> | undefined) ?? {};
    servers["prompt-compressor"] = {
      command: "npx",
      args: ["-y", "prompt-compressor"],
    };
    doc.mcp_servers = servers;
    return [
      {
        path: configPath,
        contents: TOML.stringify(doc as TOML.JsonMap),
        description: "Register prompt-compressor in Codex CLI config.toml",
      },
    ];
  }

  planUninstall(): WriteOperation[] {
    const { configPath } = this.info();
    if (!existsSync(configPath)) return [];
    const doc = this.read();
    const servers = doc.mcp_servers as Record<string, unknown> | undefined;
    if (servers) delete servers["prompt-compressor"];
    return [
      {
        path: configPath,
        contents: TOML.stringify(doc as TOML.JsonMap),
        description: "Remove prompt-compressor from Codex CLI config.toml",
      },
    ];
  }
}
