import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { qwenHome, projectRoot } from "../../util/paths.js";
import { mergeJsonText } from "../../util/json-merge.js";
import { mergeRulesMarkdown } from "../rules-template.js";
import { ClientWriter, DetectResult, MCP_SERVER_CONFIG, WriteOperation } from "./base.js";

/**
 * Qwen Code is a fork of Gemini CLI. It reads from `~/.qwen/settings.json`
 * and QWEN.md for project rules.
 */
export class QwenCodeWriter implements ClientWriter {
  info() {
    return {
      id: "qwen-code",
      name: "Qwen Code",
      configPath: join(qwenHome(), "settings.json"),
      rulesPath: join(projectRoot(), "QWEN.md"),
    };
  }

  detect(): DetectResult {
    const detected = existsSync(qwenHome());
    return {
      info: this.info(),
      detected,
      reason: detected ? undefined : "~/.qwen not found",
    };
  }

  planInstall(): WriteOperation[] {
    const { configPath, rulesPath } = this.info();
    const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
    const ops: WriteOperation[] = [
      {
        path: configPath,
        contents: mergeJsonText(existing, {
          mcpServers: { "prompt-compressor": MCP_SERVER_CONFIG },
        }),
        description: "Register prompt-compressor in Qwen Code settings",
      },
    ];
    if (rulesPath) {
      const existingRules = existsSync(rulesPath) ? readFileSync(rulesPath, "utf8") : null;
      ops.push({
        path: rulesPath,
        contents: mergeRulesMarkdown(existingRules),
        description: "Install compression rules in QWEN.md",
      });
    }
    return ops;
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
          description: "Remove prompt-compressor from Qwen Code settings",
        },
      ];
    } catch {
      return [];
    }
  }
}
