import { createConsola, LogLevels } from "consola";

type Level = "silent" | "error" | "warn" | "info" | "debug" | "trace";

const LEVEL_MAP: Record<Level, number> = {
  silent: LogLevels.silent,
  error: LogLevels.error,
  warn: LogLevels.warn,
  info: LogLevels.info,
  debug: LogLevels.debug,
  trace: LogLevels.trace,
};

function resolveLevel(): number {
  const raw = (process.env.SUPERZ_LOG ?? "info").toLowerCase() as Level;
  return LEVEL_MAP[raw] ?? LogLevels.info;
}

/**
 * Structured logger writing exclusively to stderr, so it never
 * pollutes the MCP stdio protocol on stdout.
 */
export const logger = createConsola({
  level: resolveLevel(),
  stdout: process.stderr,
  stderr: process.stderr,
  defaults: {
    tag: "superz",
  },
});

export function tagged(tag: string) {
  return logger.withTag(tag);
}
