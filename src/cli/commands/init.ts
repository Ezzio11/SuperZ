import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import prompts from "prompts";
import { ClientWriter, WriteOperation } from "../clients/base.js";
import { allWriters, writerById } from "../clients/registry.js";
import { logger } from "../../util/logger.js";
import { readUserConfig, writeUserConfig } from "../../config/user-store.js";
import { ProviderConfig } from "../../config/schema.js";

export interface InitOptions {
  yes?: boolean;
  all?: boolean;
  dryRun?: boolean;
  only?: string[];
}

function applyOperation(op: WriteOperation, dryRun: boolean): "written" | "unchanged" | "dry" {
  if (op.contents === null) return "unchanged";
  if (existsSync(op.path)) {
    try {
      const current = readFileSync(op.path, "utf8");
      if (current === op.contents) return "unchanged";
    } catch {
      // proceed to write
    }
  }
  if (dryRun) return "dry";
  mkdirSync(dirname(op.path), { recursive: true });
  writeFileSync(op.path, op.contents, "utf8");
  return "written";
}

function printHeader(title: string): void {
  logger.log("");
  logger.log(`\x1b[1m${title}\x1b[0m`);
  logger.log("─".repeat(title.length));
}

function relativeOrAbsolute(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") || rel.length === 0 ? path : rel;
}

function upsertProvider(providers: ProviderConfig[], next: ProviderConfig): ProviderConfig[] {
  const idx = providers.findIndex((p) => p.name === next.name);
  if (idx < 0) return [...providers, next];
  const copy = [...providers];
  copy[idx] = next;
  return copy;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  free: boolean;
  contextLength?: number;
}

function isLikelyFreeModel(raw: Record<string, unknown>): boolean {
  const id = String(raw.id ?? "");
  if (id.includes(":free")) return true;
  const pricing = raw.pricing as Record<string, unknown> | undefined;
  const promptPrice = Number(pricing?.prompt ?? NaN);
  const completionPrice = Number(pricing?.completion ?? NaN);
  if (Number.isFinite(promptPrice) && Number.isFinite(completionPrice)) {
    return promptPrice === 0 && completionPrice === 0;
  }
  return false;
}

async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return [];
    }
    const payload = (await res.json()) as { data?: unknown[] };
    const models = (payload.data ?? [])
      .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === "object"))
      .map((m) => ({
        id: String(m.id ?? "").trim(),
        name: typeof m.name === "string" ? m.name : undefined,
        free: isLikelyFreeModel(m),
        contextLength:
          typeof m.context_length === "number"
            ? m.context_length
            : typeof m.contextLength === "number"
              ? m.contextLength
              : undefined,
      }))
      .filter((m) => m.id.length > 0);
    return models;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function chooseOpenRouterModel(
  apiKey: string,
  defaultModel: string,
): Promise<string | null> {
  logger.log("  \x1b[90mFetching available models from OpenRouter...\x1b[0m");
  const models = await fetchOpenRouterModels(apiKey);
  if (models.length === 0) {
    logger.warn("  Could not fetch models from OpenRouter. Falling back to manual model entry.");
    const manual = await prompts({
      type: "text",
      name: "model",
      message: "OpenRouter model",
      initial: defaultModel,
      validate: (v: string) => (v && v.trim().length > 0 ? true : "Model is required."),
    });
    return manual.model ? String(manual.model).trim() : null;
  }

  const freeModels = models.filter((m) => m.free);
  const preferred = freeModels.length > 0 ? freeModels : models;

  const defaultIndex = Math.max(
    0,
    preferred.findIndex((m) => m.id === defaultModel),
  );

  const choices = preferred.slice(0, 150).map((m) => ({
    title: `${m.id}${m.contextLength ? `  (ctx: ${m.contextLength})` : ""}${m.free ? "  [free]" : ""}`,
    value: m.id,
  }));
  choices.unshift({
    title: `Manual entry (${defaultModel})`,
    value: "__manual__",
  });

  const picked = await prompts({
    type: "select",
    name: "model",
    message:
      freeModels.length > 0
        ? "Choose an OpenRouter model (free models shown first)"
        : "Choose an OpenRouter model",
    choices,
    initial: defaultIndex + 1,
  });

  const selected = String(picked.model ?? "");
  if (!selected) return null;
  if (selected === "__manual__") {
    const manual = await prompts({
      type: "text",
      name: "model",
      message: "OpenRouter model",
      initial: defaultModel,
      validate: (v: string) => (v && v.trim().length > 0 ? true : "Model is required."),
    });
    return manual.model ? String(manual.model).trim() : null;
  }
  return selected;
}

async function maybeConfigureProviders(options: InitOptions): Promise<void> {
  if (options.dryRun || options.yes) return;

  const existing = readUserConfig();
  const existingOpenRouter = existing.providers?.find((p) =>
    p.name.toLowerCase().includes("openrouter"),
  );
  const defaultModel = existingOpenRouter?.model ?? "google/gemma-4-26b-a4b-it:free";

  const askSetup = await prompts({
    type: "confirm",
    name: "ok",
    message:
      "Configure provider credentials now? (recommended so users never edit .env manually)",
    initial: true,
  });
  if (!askSetup.ok) return;

  const primary = await prompts([
    {
      type: "password",
      name: "openrouterKey",
      message: "OpenRouter API key (required for free-first mode)",
      validate: (v: string) =>
        v && v.trim().length >= 10 ? true : "Please enter a valid API key.",
    },
    {
      type: "confirm",
      name: "selectFromOpenRouter",
      message: "Fetch available OpenRouter models and pick from list?",
      initial: true,
    },
  ]);
  if (!primary.openrouterKey) return;

  let selectedModel: string | null = null;
  if (primary.selectFromOpenRouter) {
    selectedModel = await chooseOpenRouterModel(String(primary.openrouterKey).trim(), defaultModel);
  } else {
    const manual = await prompts({
      type: "text",
      name: "openrouterModel",
      message: "OpenRouter model",
      initial: defaultModel,
      validate: (v: string) => (v && v.trim().length > 0 ? true : "Model is required."),
    });
    selectedModel = manual.openrouterModel ? String(manual.openrouterModel).trim() : null;
  }
  if (!selectedModel) return;

  const askFallback = await prompts({
    type: "confirm",
    name: "fallback",
    message: "Add optional fallback provider keys for reliability?",
    initial: false,
  });

  let fallback: Record<string, string> = {};
  if (askFallback.fallback) {
    fallback = await prompts([
      { type: "password", name: "cerebras", message: "Cerebras API key (optional)" },
      { type: "password", name: "groq", message: "Groq API key (optional)" },
      { type: "password", name: "google", message: "Google API key (optional)" },
      { type: "password", name: "hf", message: "HuggingFace API key (optional)" },
    ]);
  }

  let providers = existing.providers ?? [];
  providers = upsertProvider(providers, {
    name: "OpenRouter-Free",
    tier: "fast",
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: String(primary.openrouterKey).trim(),
    model: selectedModel,
    timeoutMs: 7000,
    supportsJsonMode: false,
  });
  if (fallback.cerebras?.trim()) {
    providers = upsertProvider(providers, {
      name: "Cerebras",
      tier: "fallback",
      url: "https://api.cerebras.ai/v1/chat/completions",
      apiKey: fallback.cerebras.trim(),
      model: "llama-3.3-70b",
      timeoutMs: 4500,
      supportsJsonMode: true,
    });
  }
  if (fallback.groq?.trim()) {
    providers = upsertProvider(providers, {
      name: "Groq",
      tier: "fallback",
      url: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: fallback.groq.trim(),
      model: "llama-3.1-8b-instant",
      timeoutMs: 4500,
      supportsJsonMode: true,
    });
  }
  if (fallback.google?.trim()) {
    providers = upsertProvider(providers, {
      name: "Google",
      tier: "fallback",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      apiKey: fallback.google.trim(),
      model: "gemini-2.0-flash",
      timeoutMs: 5500,
      supportsJsonMode: true,
    });
  }
  if (fallback.hf?.trim()) {
    providers = upsertProvider(providers, {
      name: "HuggingFace",
      tier: "fallback",
      url: "https://router.huggingface.co/novita/v3/openai/chat/completions",
      apiKey: fallback.hf.trim(),
      model: "meta-llama/llama-3.1-8b-instruct",
      timeoutMs: 10000,
      supportsJsonMode: false,
    });
  }

  const path = writeUserConfig({ ...existing, providers });
  logger.log(`  \x1b[32m✓\x1b[0m ${relativeOrAbsolute(path)}  \x1b[90m(saved provider credentials)\x1b[0m`);
}

export async function runInit(options: InitOptions): Promise<void> {
  printHeader("SuperZ — Universal Installer");
  logger.log("Detecting installed MCP-compatible clients...\n");

  const writers = allWriters();
  const detections = writers.map((w) => ({ writer: w, result: w.detect() }));

  for (const { result } of detections) {
    const status = result.detected ? "\x1b[32m✓\x1b[0m" : "\x1b[90m·\x1b[0m";
    const suffix = result.detected ? "" : ` \x1b[90m(${result.reason})\x1b[0m`;
    logger.log(`  ${status} ${result.info.name}${suffix}`);
  }

  let chosen: ClientWriter[] = [];

  if (options.only && options.only.length > 0) {
    chosen = options.only
      .map((id) => writerById(id))
      .filter((w): w is ClientWriter => Boolean(w));
  } else if (options.all) {
    chosen = detections.filter((d) => d.result.detected).map((d) => d.writer);
    // Always include AGENTS.md as a safety net.
    const agents = writerById("agents-md");
    if (agents && !chosen.includes(agents)) chosen.push(agents);
  } else {
    const choices = detections
      .filter((d) => d.result.detected || d.result.info.id === "agents-md")
      .map((d) => ({
        title: d.result.info.name,
        value: d.result.info.id,
        selected: d.result.detected,
      }));
    if (choices.length === 0) {
      logger.warn("No MCP clients detected. You can still install AGENTS.md — pass --only agents-md.");
      return;
    }
    if (options.yes) {
      chosen = choices
        .filter((c) => c.selected)
        .map((c) => writerById(c.value))
        .filter((w): w is ClientWriter => Boolean(w));
    } else {
      const response = await prompts({
        type: "multiselect",
        name: "ids",
        message: "Install prompt-compressor into which clients?",
        choices,
        instructions: false,
        hint: "space to toggle, enter to confirm",
      });
      if (!response.ids || response.ids.length === 0) {
        logger.info("Nothing selected. Exiting.");
        return;
      }
      chosen = response.ids
        .map((id: string) => writerById(id))
        .filter((w: ClientWriter | undefined): w is ClientWriter => Boolean(w));
    }
  }

  await maybeConfigureProviders(options);

  printHeader(options.dryRun ? "Planned changes (dry-run)" : "Applying changes");

  let written = 0;
  let unchanged = 0;
  for (const writer of chosen) {
    const ops = writer.planInstall();
    for (const op of ops) {
      const result = applyOperation(op, Boolean(options.dryRun));
      const label = relativeOrAbsolute(op.path);
      if (result === "written") {
        written += 1;
        logger.log(`  \x1b[32m✓\x1b[0m ${label}  \x1b[90m${op.description}\x1b[0m`);
      } else if (result === "dry") {
        logger.log(`  \x1b[36m◦\x1b[0m ${label}  \x1b[90m${op.description}\x1b[0m`);
      } else {
        unchanged += 1;
        logger.log(`  \x1b[90m·\x1b[0m ${label}  \x1b[90m(unchanged)\x1b[0m`);
      }
    }
  }

  logger.log("");
  if (options.dryRun) {
    logger.log("Dry-run complete. Re-run without --dry-run to apply.");
  } else {
    logger.log(`Done — ${written} file(s) written, ${unchanged} unchanged.`);
    logger.log("Restart the affected clients to pick up the new MCP server.");
  }
}
