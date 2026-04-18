import { existsSync, readFileSync } from "node:fs";
import { claudeDesktopConfigPath } from "../../util/paths.js";
import { mergeJsonText } from "../../util/json-merge.js";
import { ClientWriter, DetectResult, MCP_SERVER_CONFIG, WriteOperation } from "./base.js";

export class ClaudeDesktopWriter implements ClientWriter {
  info() {
    return {
      id: "claude-desktop",
      name: "Claude Desktop",
      configPath: claudeDesktopConfigPath(),
    };
  }

  detect(): DetectResult {
    const path = claudeDesktopConfigPath();
    const detected = existsSync(path);
    return {
      info: this.info(),
      detected,
      reason: detected ? undefined : `No config file at ${path}`,
    };
  }

  planInstall(): WriteOperation[] {
    const path = claudeDesktopConfigPath();
    const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
    const contents = mergeJsonText(existing, {
      mcpServers: {
        "prompt-compressor": MCP_SERVER_CONFIG,
      },
    });
    return [
      {
        path,
        contents,
        description: `Register prompt-compressor in Claude Desktop mcpServers`,
      },
    ];
  }

  planUninstall(): WriteOperation[] {
    const path = claudeDesktopConfigPath();
    if (!existsSync(path)) return [];
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      return [];
    }
    const servers = parsed.mcpServers as Record<string, unknown> | undefined;
    if (servers && "prompt-compressor" in servers) {
      delete servers["prompt-compressor"];
    }
    return [
      {
        path,
        contents: `${JSON.stringify(parsed, null, 2)}\n`,
        description: "Remove prompt-compressor from Claude Desktop mcpServers",
      },
    ];
  }
}
