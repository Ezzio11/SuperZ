import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, vscodeUserSettingsDir } from "../../util/paths.js";
import { mergeJsonText } from "../../util/json-merge.js";
import { ClientWriter, DetectResult, MCP_SERVER_CONFIG, WriteOperation } from "./base.js";

/**
 * VSCode (with Copilot agent mode or Continue.dev) reads MCP servers
 * from either the workspace `.vscode/mcp.json` or user-level mcp.json.
 * We write the workspace file by default for discoverability, and the
 * user-level file when requested via `scope: "user"`.
 */
export class VSCodeWriter implements ClientWriter {
  constructor(private readonly scope: "workspace" | "user" = "workspace") {}

  info() {
    const path =
      this.scope === "workspace"
        ? join(projectRoot(), ".vscode", "mcp.json")
        : join(vscodeUserSettingsDir(), "mcp.json");
    return {
      id: this.scope === "workspace" ? "vscode" : "vscode-user",
      name: this.scope === "workspace" ? "VSCode (workspace)" : "VSCode (user)",
      configPath: path,
    };
  }

  detect(): DetectResult {
    const infoObj = this.info();
    if (this.scope === "user") {
      const detected = existsSync(vscodeUserSettingsDir());
      return {
        info: infoObj,
        detected,
        reason: detected ? undefined : "VSCode user settings directory not found",
      };
    }
    // Workspace: always plan-able, but only confirm when a .vscode
    // directory already exists or the project looks like a repo.
    const detected = existsSync(join(projectRoot(), ".vscode")) || existsSync(join(projectRoot(), ".git"));
    return {
      info: infoObj,
      detected,
      reason: detected ? undefined : "No .vscode or .git folder in current project",
    };
  }

  planInstall(): WriteOperation[] {
    const { configPath } = this.info();
    const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
    // VSCode's mcp.json uses { "servers": { ... } } not "mcpServers".
    const contents = mergeJsonText(existing, {
      servers: {
        "prompt-compressor": {
          type: "stdio",
          ...MCP_SERVER_CONFIG,
        },
      },
    });
    return [
      {
        path: configPath,
        contents,
        description: `Register prompt-compressor in ${configPath}`,
      },
    ];
  }

  planUninstall(): WriteOperation[] {
    const { configPath } = this.info();
    if (!existsSync(configPath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const servers = parsed.servers as Record<string, unknown> | undefined;
      if (servers) delete servers["prompt-compressor"];
      return [
        {
          path: configPath,
          contents: `${JSON.stringify(parsed, null, 2)}\n`,
          description: `Remove prompt-compressor from ${configPath}`,
        },
      ];
    } catch {
      return [];
    }
  }
}
