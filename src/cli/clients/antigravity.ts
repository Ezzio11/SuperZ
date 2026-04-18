import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mergeJsonText } from "../../util/json-merge.js";
import { ClientWriter, DetectResult, MCP_SERVER_CONFIG, WriteOperation } from "./base.js";

function antigravityConfigDir(): string {
  if (platform() === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "Antigravity",
      "User",
    );
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Antigravity", "User");
  }
  return join(homedir(), ".config", "Antigravity", "User");
}

/**
 * Google Antigravity is VSCode-derived, so it accepts the same
 * `mcp.json` shape as VSCode's Copilot agent.
 */
export class AntigravityWriter implements ClientWriter {
  info() {
    return {
      id: "antigravity",
      name: "Antigravity",
      configPath: join(antigravityConfigDir(), "mcp.json"),
    };
  }

  detect(): DetectResult {
    const detected = existsSync(antigravityConfigDir());
    return {
      info: this.info(),
      detected,
      reason: detected ? undefined : `Antigravity user dir not found (${antigravityConfigDir()})`,
    };
  }

  planInstall(): WriteOperation[] {
    const { configPath } = this.info();
    const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
    return [
      {
        path: configPath,
        contents: mergeJsonText(existing, {
          servers: {
            "prompt-compressor": { type: "stdio", ...MCP_SERVER_CONFIG },
          },
        }),
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
