import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadEnv(rootPath) {
  try {
    const envFile = readFileSync(resolve(rootPath, ".env"), "utf8");
    for (const line of envFile.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (key && rest.length) {
        let value = rest.join("=").trim();
        value = value.replace(/^["']|["']$/g, "");
        process.env[key.trim()] = value;
      }
    }
  } catch {
    // .env not found — fall back to system env vars
  }
}

const getProviders = () => [
  {
    name: "Cerebras",
    tier: "fast",
    url: "https://api.cerebras.ai/v1/chat/completions",
    apiKey: process.env.CEREBRAS_API_KEY,
    model: "llama-3.3-70b",
    timeout: 4000,
  },
  {
    name: "Groq",
    tier: "fast",
    url: "https://api.groq.com/openai/v1/chat/completions",
    apiKey: process.env.GROQ_API_KEY,
    model: "llama-3.1-8b-instant",
    timeout: 4000,
  },
  {
    name: "Google",
    tier: "fast",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    apiKey: process.env.GOOGLE_API_KEY,
    model: "gemini-2.0-flash",
    timeout: 5000,
  },
  {
    name: "OpenRouter",
    tier: "fallback",
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: process.env.OPENROUTER_API_KEY,
    model: "meta-llama/llama-3.1-8b-instruct:free",
    timeout: 6000,
  },
  {
    name: "HuggingFace",
    tier: "fallback",
    url: "https://router.huggingface.co/novita/v3/openai/chat/completions",
    apiKey: process.env.HF_API_KEY,
    model: "meta-llama/llama-3.1-8b-instruct",
    timeout: 10000,
  },
];

const SYSTEM_PROMPT = `You are a strict prompt compression engine. Your ONLY job is to rewrite the user's prompt into a maximally dense execution script, preserving 100% of the technical intent and all constraints.
You MUST output your response in valid JSON format using exactly this schema: {"compressed_prompt": "your compressed text here"}.
DO NOT answer the user's question, solve their problem, or provide recommendations.

RULES:
1. Telegraphic style: Drop articles, pronouns, and conversational filler completely.
2. Developer shorthand: Replace common words with standard abbreviations (db, auth, fn, req/res, config, pkg, impl, dep, env, ctx, msg, err, val, obj, arr, str, num, bool).
3. Symbol substitution: Replace words with operators that coding models understand natively.
   - "with" → w/, "without" → w/o, "and" → &, "or" → |, "not" / "do not" / "never" → !, "returns" / "outputs" → →, "input" → ←, "greater than" → >, "less than" → <, "using" → @, "therefore" → ∴, "requires" → dep:, "extends" / "inherits from" → :>
4. Complex queries: Convert multi-part narrative requests into dense Key:Value pairs.
5. Strict Preservation: NEVER drop or alter negative constraints (!, NOT, NEVER, no X). These are the highest-priority tokens in any prompt.
6. Semantic Deduplication: Identify and merge all semantically redundant statements into a single canonical constraint. "Make it fast, performance is key, ensure it is optimized" → "perf: optimize". Keep only the highest-signal version.
7. Drop Implicit Defaults: Remove any requirement that is a universal baseline expectation for competent code (e.g., "make it readable", "add error handling", "keep it clean", "make it efficient", "use best practices"). Only retain constraints that are project-specific or non-default.
8. Type Annotation Syntax: Represent data structures using TypeScript/JSON schema notation instead of prose. "a list of user objects with a name and an id" → User[]{name,id}. "a dictionary mapping strings to integers" → Map<str,int>.
9. Ternary Shorthand: Compress conditional logic into ternary notation. "if the user is authenticated show the dashboard, otherwise redirect to login" → auth? → /dashboard : → /login.
10. No Assistance: Do not attempt to write the requested code, architect the system, or answer the query. Just compress.
11. NO Predictive Engineering: Strictly forbidden from inferring or injecting solutions, libraries, or components not explicitly named in the input. Parse only what is provided.

EXAMPLES:
User: "Could you please write a function that takes an array of strings and returns them sorted alphabetically."
Assistant: {"compressed_prompt": "fn: str[] → sorted asc"}

User: "I am building a React app and need a login component. Make absolutely sure NOT to use Tailwind CSS for this, I only want standard CSS modules. Make sure the code is clean and readable."
Assistant: {"compressed_prompt": "Task: React login component. Constraint: !Tailwind CSS, CSS modules only."}

User: "I need a Node.js middleware that authenticates requests using JWT. It must be fast, highly performant and optimized. It should return a 401 error without exposing any token details if validation fails."
Assistant: {"compressed_prompt": "Task: Node.js middleware. auth @ JWT → 401 if invalid. Constraint: !expose token details."}

User: "Build me an API endpoint that takes a list of product objects, where each product has a name, a price, and a list of tags. If the user has an admin role, return all fields, otherwise return only name and price."
Assistant: {"compressed_prompt": "Task: API endpoint. ← Product[]{name,price,tags[]}. admin? → all fields : → {name,price}."}`;

async function callProvider(provider, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provider.timeout);

  try {
    const res = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 400,
        temperature: 0,
        top_p: 1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content?.trim();
    if (!rawContent) throw new Error("Empty response");

    let compressed;
    try {
      const parsed = JSON.parse(rawContent);
      compressed = parsed.compressed_prompt || rawContent;
    } catch (e) {
      compressed = rawContent;
    }

    return compressed;
  } finally {
    clearTimeout(timer);
  }
}

export async function compressPrompt(prompt) {
  const providers = getProviders();
  const errors = [];
  const fastTier = providers.filter((p) => p.tier === "fast" && p.apiKey);
  const fallbackTier = providers.filter((p) => p.tier === "fallback" && p.apiKey);

  if (fastTier.length > 0) {
    try {
      const promises = fastTier.map((provider) =>
        callProvider(provider, prompt).then((compressed) => ({
          compressed,
          provider: provider.name,
        }))
      );
      return await Promise.any(promises);
    } catch (aggregateError) {
      errors.push("Fast tier engines failed.");
    }
  }

  for (const provider of fallbackTier) {
    try {
      const compressed = await callProvider(provider, prompt);
      return { compressed, provider: provider.name, errors };
    } catch (err) {
      errors.push(`${provider.name}: ${err.message}`);
    }
  }

  return { compressed: ruleBased(prompt), provider: "fallback-regex", errors };
}

function ruleBased(text) {
  return text
    .replace(/\b(please|kindly|could you|can you|I want you to|I need you to|I would like you to|make sure to|be sure to|just|basically|essentially|actually|literally|very|really|quite|rather|somewhat|a bit|a little)\b\s*/gi, "")
    .replace(/\bin order to\b/gi, "to")
    .replace(/\bdue to the fact that\b/gi, "because")
    .replace(/\bat this point in time\b/gi, "now")
    .replace(/\bas an ai( language model)?\b[,.]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const server = new McpServer({
  name: "prompt-compressor",
  version: "1.0.0",
});

server.tool(
  "compress_prompt",
  "Compresses a verbose prompt to minimize token usage while preserving full intent. Uses a parallel race strategy for minimum latency.",
  { prompt: z.string().describe("The original prompt to compress") },
  async ({ prompt }) => {

    const conversationalKeywords = /\b(what do you think|how should i|what else|brainstorm|advice on|opinion|recommendation|pros and cons|which is better|help me decide|what is the best way)\b/i;
    const isShort = prompt.split(/\s+/).length < 20;

    if (isShort || conversationalKeywords.test(prompt)) {
      return {
        content: [{ type: "text", text: `${prompt}\n\n[Bypass | 0 tokens saved | 0% smaller]\n*(Log: Bypassed due to conversational/length heuristic)*` }],
      };
    }

    const originalTokens = Math.ceil(prompt.length / 4);
    const { compressed, provider, errors } = await compressPrompt(prompt);

    const compressedTokens = Math.ceil(compressed.length / 4);
    const savedTokens = originalTokens - compressedTokens;
    const pct = originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 100) : 0;

    const stats = `[${provider} | ~${savedTokens} tokens saved | ${pct}% smaller]`;
    const log = errors?.length ? `\n*(Log: ${errors.join(" ")})*` : "";

    return {
      content: [{ type: "text", text: `${compressed}\n\n${stats}${log}` }],
    };
  }
);