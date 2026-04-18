import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { windsurfHome } from "../../util/paths.js";
import { mergeJsonText } from "../../util/json-merge.js";
import { ClientWriter, DetectResult, MCP_SERVER_CONFIG, WriteOperation } from "./base.js";

export class WindsurfWriter implements ClientWriter {
  info() {
    return {
      id: "windsurf",
      name: "Windsurf",
      configPath: join(windsurfHome(), "mcp_config.json"),
    };
  }

  detect(): DetectResult {
    const detected = existsSync(windsurfHome());
    return {
      info: this.info(),
      detected,
      reason: detected ? undefined : "~/.codeium/windsurf not found",
    };
  }

  planInstall(): WriteOperation[] {
    const { configPath } = this.info();
    const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
    return [
      {
        path: configPath,
        contents: mergeJsonText(existing, {
          mcpServers: { "prompt-compressor": MCP_SERVER_CONFIG },
        }),
        description: "Register prompt-compressor in Windsurf mcp_config.json",
      },
    ];
  }

  planUninstall(): WriteOperation[] {
    const { configPath } = this.info();
    if (!existsSync(configPath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const servers = parsed.mcpServers as Record<string, unknown> | undefined;
      if (servers) delete servers["prompt-compressor"];
      return [
        {
          path: configPath,
          contents: `${JSON.stringify(parsed, null, 2)}\n`,
          description: "Remove prompt-compressor from Windsurf config",
        },
      ];
    } catch {
      return [];
    }
  }
}
