import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

/**
 * Returns a platform-aware path inside the SuperZ data directory.
 * Windows: %APPDATA%\SuperZ
 * macOS/Linux: ~/.superz
 */
export function superzHome(...segments: string[]): string {
  const base =
    platform() === "win32"
      ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "SuperZ")
      : join(homedir(), ".superz");
  return segments.length ? join(base, ...segments) : base;
}

export function ensureDir(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
  return path;
}

/**
 * Platform-aware Claude Desktop config location.
 */
export function claudeDesktopConfigPath(): string {
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

/**
 * Platform-aware VSCode user settings path (stable channel).
 */
export function vscodeUserSettingsDir(): string {
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Code", "User");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Code", "User");
  }
  return join(homedir(), ".config", "Code", "User");
}

export function cursorHome(): string {
  return join(homedir(), ".cursor");
}

export function claudeHome(): string {
  return join(homedir(), ".claude");
}

export function geminiHome(): string {
  return join(homedir(), ".gemini");
}

export function qwenHome(): string {
  return join(homedir(), ".qwen");
}

export function codexHome(): string {
  return join(homedir(), ".codex");
}

export function windsurfHome(): string {
  return join(homedir(), ".codeium", "windsurf");
}

export function continueHome(): string {
  return join(homedir(), ".continue");
}

export function zedSettingsPath(): string {
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Zed", "settings.json");
  }
  return join(homedir(), ".config", "zed", "settings.json");
}

export function projectRoot(): string {
  return resolve(process.cwd());
}
