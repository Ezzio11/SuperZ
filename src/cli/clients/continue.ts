import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { continueHome } from "../../util/paths.js";
import { ClientWriter, DetectResult, WriteOperation } from "./base.js";

/**
 * Continue.dev stores its config in YAML at `~/.continue/config.yaml`.
 */
export class ContinueWriter implements ClientWriter {
  info() {
    return {
      id: "continue",
      name: "Continue.dev",
      configPath: join(continueHome(), "config.yaml"),
    };
  }

  detect(): DetectResult {
    const detected = existsSync(continueHome());
    return {
      info: this.info(),
      detected,
      reason: detected ? undefined : "~/.continue not found",
    };
  }

  planInstall(): WriteOperation[] {
    const { configPath } = this.info();
    let doc: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        doc = (YAML.parse(readFileSync(configPath, "utf8")) ?? {}) as Record<string, unknown>;
      } catch {
        doc = {};
      }
    }
    const servers =
      (doc.mcpServers as Record<string, unknown> | undefined) ?? {};
    servers["prompt-compressor"] = {
      command: "npx",
      args: ["-y", "prompt-compressor"],
    };
    doc.mcpServers = servers;
    return [
      {
        path: configPath,
        contents: YAML.stringify(doc),
        description: "Register prompt-compressor in ~/.continue/config.yaml",
      },
    ];
  }

  planUninstall(): WriteOperation[] {
    const { configPath } = this.info();
    if (!existsSync(configPath)) return [];
    try {
      const doc = (YAML.parse(readFileSync(configPath, "utf8")) ?? {}) as Record<string, unknown>;
      const servers = doc.mcpServers as Record<string, unknown> | undefined;
      if (servers) delete servers["prompt-compressor"];
      return [
        {
          path: configPath,
          contents: YAML.stringify(doc),
          description: "Remove prompt-compressor from Continue.dev config",
        },
      ];
    } catch {
      return [];
    }
  }
}
