import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeHome } from "../../util/paths.js";
import { mergeJsonText } from "../../util/json-merge.js";
import { mergeRulesMarkdown } from "../rules-template.js";
import { ClientWriter, DetectResult, MCP_SERVER_CONFIG, WriteOperation } from "./base.js";

/**
 * Claude Code CLI reads MCP servers from `~/.claude.json` and project-
 * level rules from `CLAUDE.md`. We write both so the `compress_prompt`
 * tool is always invoked before long prompts.
 */
export class ClaudeCodeWriter implements ClientWriter {
  info() {
    return {
      id: "claude-code",
      name: "Claude Code CLI",
      configPath: join(claudeHome(), "..", ".claude.json"),
      rulesPath: join(claudeHome(), "CLAUDE.md"),
    };
  }

  detect(): DetectResult {
    const infoObj = this.info();
    const detected = existsSync(claudeHome()) || existsSync(infoObj.configPath);
    return {
      info: infoObj,
      detected,
      reason: detected ? undefined : "Claude Code not installed (~/.claude not found)",
    };
  }

  planInstall(): WriteOperation[] {
    const { configPath, rulesPath } = this.info();
    const existingConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
    const ops: WriteOperation[] = [
      {
        path: configPath,
        contents: mergeJsonText(existingConfig, {
          mcpServers: { "prompt-compressor": MCP_SERVER_CONFIG },
        }),
        description: "Register prompt-compressor in ~/.claude.json",
      },
    ];
    if (rulesPath) {
      const existingRules = existsSync(rulesPath) ? readFileSync(rulesPath, "utf8") : null;
      ops.push({
        path: rulesPath,
        contents: mergeRulesMarkdown(existingRules),
        description: "Install compression rules in CLAUDE.md",
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
          description: "Remove prompt-compressor from ~/.claude.json",
        },
      ];
    } catch {
      return [];
    }
  }
}
