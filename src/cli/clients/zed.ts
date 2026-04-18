import { existsSync, readFileSync } from "node:fs";
import { mergeJsonText } from "../../util/json-merge.js";
import { zedSettingsPath } from "../../util/paths.js";
import { ClientWriter, DetectResult, MCP_SERVER_CONFIG, WriteOperation } from "./base.js";

/**
 * Zed registers MCP servers under `context_servers` in its
 * `settings.json`.
 */
export class ZedWriter implements ClientWriter {
  info() {
    return { id: "zed", name: "Zed", configPath: zedSettingsPath() };
  }

  detect(): DetectResult {
    const detected = existsSync(zedSettingsPath());
    return {
      info: this.info(),
      detected,
      reason: detected ? undefined : `No config at ${zedSettingsPath()}`,
    };
  }

  planInstall(): WriteOperation[] {
    const path = zedSettingsPath();
    const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
    const contents = mergeJsonText(existing, {
      context_servers: {
        "prompt-compressor": {
          source: "custom",
          ...MCP_SERVER_CONFIG,
        },
      },
    });
    return [
      {
        path,
        contents,
        description: "Register prompt-compressor in Zed context_servers",
      },
    ];
  }

  planUninstall(): WriteOperation[] {
    const path = zedSettingsPath();
    if (!existsSync(path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      const servers = parsed.context_servers as Record<string, unknown> | undefined;
      if (servers) delete servers["prompt-compressor"];
      return [
        {
          path,
          contents: `${JSON.stringify(parsed, null, 2)}\n`,
          description: "Remove prompt-compressor from Zed config",
        },
      ];
    } catch {
      return [];
    }
  }
}
