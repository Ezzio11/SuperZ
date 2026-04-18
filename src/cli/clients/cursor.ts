import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cursorHome, projectRoot } from "../../util/paths.js";
import { mergeJsonText } from "../../util/json-merge.js";
import { loadRulesTemplate } from "../rules-template.js";
import { ClientWriter, DetectResult, MCP_SERVER_CONFIG, WriteOperation } from "./base.js";

/**
 * Cursor reads MCP servers from `~/.cursor/mcp.json` (global). Rules
 * are per-project under `.cursor/rules/<name>.mdc`.
 */
export class CursorWriter implements ClientWriter {
  info() {
    return {
      id: "cursor",
      name: "Cursor",
      configPath: join(cursorHome(), "mcp.json"),
      rulesPath: join(projectRoot(), ".cursor", "rules", "prompt-compressor.mdc"),
    };
  }

  detect(): DetectResult {
    const detected = existsSync(cursorHome());
    return {
      info: this.info(),
      detected,
      reason: detected ? undefined : "Cursor directory ~/.cursor not found",
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
        description: "Register prompt-compressor in ~/.cursor/mcp.json",
      },
    ];
    if (rulesPath) {
      const frontmatter = `---\ndescription: Prompt compression rules (SuperZ)\nalwaysApply: true\n---\n\n`;
      ops.push({
        path: rulesPath,
        contents: `${frontmatter}${loadRulesTemplate().trim()}\n`,
        description: "Install Cursor rule at .cursor/rules/prompt-compressor.mdc",
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
          description: "Remove prompt-compressor from ~/.cursor/mcp.json",
        },
      ];
    } catch {
      return [];
    }
  }
}
