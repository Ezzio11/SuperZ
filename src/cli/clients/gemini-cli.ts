import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { geminiHome, projectRoot } from "../../util/paths.js";
import { mergeJsonText } from "../../util/json-merge.js";
import { mergeRulesMarkdown } from "../rules-template.js";
import { ClientWriter, DetectResult, MCP_SERVER_CONFIG, WriteOperation } from "./base.js";

export class GeminiCliWriter implements ClientWriter {
  info() {
    return {
      id: "gemini-cli",
      name: "Gemini CLI",
      configPath: join(geminiHome(), "settings.json"),
      rulesPath: join(projectRoot(), "GEMINI.md"),
    };
  }

  detect(): DetectResult {
    const detected = existsSync(geminiHome());
    return {
      info: this.info(),
      detected,
      reason: detected ? undefined : "~/.gemini not found",
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
        description: "Register prompt-compressor in Gemini CLI settings",
      },
    ];
    if (rulesPath) {
      const existingRules = existsSync(rulesPath) ? readFileSync(rulesPath, "utf8") : null;
      ops.push({
        path: rulesPath,
        contents: mergeRulesMarkdown(existingRules),
        description: "Install compression rules in GEMINI.md",
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
          description: "Remove prompt-compressor from Gemini CLI settings",
        },
      ];
    } catch {
      return [];
    }
  }
}
