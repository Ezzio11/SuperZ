import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { platform } from "node:os";
import { SuperzConfig } from "./schema.js";
import { superzHome } from "../util/paths.js";

export function userConfigPath(): string {
  return superzHome("config.json");
}

export function readUserConfig(): Partial<SuperzConfig> {
  const path = userConfigPath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as Partial<SuperzConfig>;
  } catch {
    return {};
  }
}

export function writeUserConfig(config: Partial<SuperzConfig>): string {
  const path = userConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  // Best-effort hardening on Unix-like systems: owner read/write only.
  if (platform() !== "win32") {
    try {
      chmodSync(path, 0o600);
    } catch {
      // ignore permission errors
    }
  }
  return path;
}

