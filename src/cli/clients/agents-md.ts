import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "../../util/paths.js";
import { mergeRulesMarkdown } from "../rules-template.js";
import { ClientWriter, DetectResult, WriteOperation } from "./base.js";

/**
 * Universal AGENTS.md rules file, read by an ever-growing number of
 * coding agents regardless of vendor. Always written to the current
 * project root as a safety net.
 */
export class AgentsMdWriter implements ClientWriter {
  info() {
    return {
      id: "agents-md",
      name: "AGENTS.md (universal)",
      configPath: join(projectRoot(), "AGENTS.md"),
    };
  }

  detect(): DetectResult {
    return { info: this.info(), detected: true };
  }

  planInstall(): WriteOperation[] {
    const path = join(projectRoot(), "AGENTS.md");
    const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
    return [
      {
        path,
        contents: mergeRulesMarkdown(existing),
        description: "Install prompt compression rules in AGENTS.md",
      },
    ];
  }

  planUninstall(): WriteOperation[] {
    return [];
  }
}
