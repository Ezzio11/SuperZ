#!/usr/bin/env node
/**
 * A/B evaluation: send identical prompts to a real downstream LLM twice,
 *   (A) raw prompt as-is, and
 *   (B) SuperZ-compressed prompt,
 * then read the model's *authoritative* `usage` block to measure the real
 * token bill on both runs. This is the only honest way to prove savings.
 *
 * Methodology:
 *   - Paired design: every prompt is evaluated on both conditions, so we
 *     use a paired t-statistic on the per-prompt deltas.
 *   - Warm-up call discarded to avoid cold-start skew.
 *   - Sequential calls with jittered sleep to stay under provider rate limits.
 *   - Results saved to reports/ab-<timestamp>.{json,md}.
 *
 * Env overrides:
 *   SUPERZ_AB_TARGET_MODEL   downstream model to bill (default: same as config'd OpenRouter provider)
 *   SUPERZ_AB_TARGET_URL     chat completions endpoint (default: OpenRouter)
 *   SUPERZ_AB_TARGET_KEY_ENV env var holding key (default: OPENROUTER_API_KEY)
 *   SUPERZ_AB_LIMIT          number of prompts to evaluate (default: 50)
 *   SUPERZ_AB_MAX_TOKENS     max response tokens per call (default: 384)
 *   SUPERZ_AB_SLEEP_MS       pause between calls (default: 900)
 *   SUPERZ_AB_PRICE_IN       USD per 1M input tokens (default: 0.15, gpt-4o-mini reference)
 *   SUPERZ_AB_PRICE_OUT      USD per 1M output tokens (default: 0.60)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CompressionEngine, loadConfig } from "../dist/index.js";

// ----- Configuration -----------------------------------------------------

const config = loadConfig();

/**
 * Auto-pick a provider with a working API key. Priority favours providers
 * with the most generous free tiers:
 *   1. Groq         (14.4k req/day free on llama-3.1-8b-instant, no CC)
 *   2. Google       (1M tok/day free on Gemini 2.0 Flash)
 *   3. Cerebras     (free tier available)
 *   4. OpenRouter   (50 req/day on free models)
 *   5. HuggingFace  (rate-limited free)
 */
const PROVIDER_PREFERENCE = ["groq", "google", "cerebras", "openrouter", "huggingface"];
function pickProvider(preferredName) {
  const withKey = config.providers.filter((p) => p.apiKey && p.url);
  if (preferredName) {
    const match = withKey.find((p) => p.name.toLowerCase() === preferredName.toLowerCase());
    if (match) return match;
  }
  for (const key of PROVIDER_PREFERENCE) {
    const hit = withKey.find((p) => p.name.toLowerCase().includes(key));
    if (hit) return hit;
  }
  return withKey[0];
}

const providerOverride = process.env.SUPERZ_AB_PROVIDER;
const chosen = pickProvider(providerOverride);
const compressionProviderOverride = process.env.SUPERZ_AB_COMPRESSION_PROVIDER ?? "OpenRouter-Free";

const TARGET_URL = process.env.SUPERZ_AB_TARGET_URL ?? chosen?.url;
const TARGET_KEY = chosen?.apiKey;
const TARGET_MODEL = process.env.SUPERZ_AB_TARGET_MODEL ?? chosen?.model;
const TARGET_PROVIDER = chosen?.name ?? "unknown";

const LIMIT = Math.max(1, Number(process.env.SUPERZ_AB_LIMIT ?? 50));
const MAX_TOKENS = Math.max(64, Number(process.env.SUPERZ_AB_MAX_TOKENS ?? 256));
const SLEEP_MS = Math.max(0, Number(process.env.SUPERZ_AB_SLEEP_MS ?? 1500));
const PRICE_IN = Number(process.env.SUPERZ_AB_PRICE_IN ?? 0.15);
const PRICE_OUT = Number(process.env.SUPERZ_AB_PRICE_OUT ?? 0.6);
const MAX_RETRIES = Math.max(0, Number(process.env.SUPERZ_AB_MAX_RETRIES ?? 3));
const RETRY_CAP_MS = Math.max(1000, Number(process.env.SUPERZ_AB_RETRY_CAP_MS ?? 90000));
const UNSAFE_MODE = /^(1|true|yes)$/i.test(process.env.SUPERZ_AB_UNSAFE_MODE ?? "");

if (!TARGET_KEY || !TARGET_URL || !TARGET_MODEL) {
  console.error(
    "No provider with an API key is configured.\n" +
      "Free options (no credit card):\n" +
      "  - Groq:             https://console.groq.com/keys   (most generous free tier)\n" +
      "  - Google AI Studio: https://aistudio.google.com/app/apikey\n" +
      "  - OpenRouter:       https://openrouter.ai/keys\n" +
      'Then run: node dist/cli.js init   (or set GROQ_API_KEY / GOOGLE_API_KEY / OPENROUTER_API_KEY env vars)',
  );
  process.exit(2);
}

// ----- Prompt corpus (realistic engineering asks with constraints) --------
// 50 prompts with mixed sizes and domains for stronger validation:
// - small: short operator asks and guardrails
// - medium: practical feature requests with multiple constraints
// - large: spec-like prompts with dense requirements
const SMALL_PROMPTS = [
  "Create login API. Never log passwords. Return 401 on bad credentials.",
  "Refactor this function for readability but do not change behavior.",
  "Build cron job. Run every 5 minutes. Do not overlap runs.",
  "Write SQL query for top 10 customers by revenue in last 30 days.",
  "Generate Dockerfile for Node app, non-root user, expose port 3000.",
  "Add retry logic with exponential backoff; never retry 4xx responses.",
  "Implement health endpoint /healthz that checks db and redis quickly.",
  "Make JSON schema for invoice payload with required id and amount_cents.",
  "Create React form with email validation; no Tailwind CSS.",
  "Add rate limit 100 req/min per API key and return Retry-After.",
  "Write middleware to attach request-id; never overwrite existing header.",
  "Design cache key format for tenant/user/report and TTL 60 seconds.",
  "Implement webhook signature verification using HMAC SHA256.",
  "Build CLI command to rotate logs older than 7 days.",
  "Create feature flag check that defaults to false on errors.",
];

const MEDIUM_PROMPTS = [
  "Build REST endpoint POST /v1/orders that validates payload, writes order and items in one transaction, returns 201 with order_id, and never expose internal database ids in response.",
  "Create a background worker that sends welcome emails with idempotency keys, retries up to 3 times on SMTP 5xx, and skips users who unsubscribed.",
  "Implement JWT auth middleware that reads bearer token, validates exp and iss, loads user roles, returns 401 on invalid token, and must not leak token content in logs.",
  "Design SQL migration to add nullable deleted_at column with index, backfill in batches of 1000 rows, and avoid table locks longer than 2 seconds.",
  "Write GraphQL resolver for paginated products with filters by category and price range, include totalCount, and prevent N+1 queries with batching.",
  "Build file upload API for images under 5MB, verify mime by magic bytes, store in S3 with tenant prefix, and reject unsupported extensions.",
  "Create express error handler that maps validation errors to 400, auth errors to 401, unknown errors to 500, and always returns structured JSON.",
  "Implement Redis-based distributed lock for cron task with 30s lease and heartbeat, and ensure lock release even on uncaught exceptions.",
  "Add OpenTelemetry tracing for API routes and db calls, sample 10%, redact PII fields, and propagate trace-id across downstream HTTP calls.",
  "Design access-control matrix where explicit deny overrides allow, support role inheritance, and produce audit log entries for every policy decision.",
  "Create endpoint GET /v1/reports/:id that checks tenant ownership, streams CSV response, sets cache-control no-store, and never buffers full file in memory.",
  "Write CI pipeline steps: lint, typecheck, unit tests, integration tests against postgres, and fail deployment if code coverage drops below 80%.",
  "Implement websocket server with heartbeat every 20s, disconnect after 2 missed pongs, and cap each client to 50 messages per minute.",
  "Build data retention job that anonymizes users inactive for 180 days, skips legal_hold accounts, and records anonymization reason and timestamp.",
  "Create reusable HTTP client with timeout 5s, retry max 2 for network errors, circuit breaker open after 10 failures, and metrics by endpoint.",
  "Refactor monolith route handler into service + repository layers while preserving exact response schema and existing status codes.",
  "Implement idempotent payment callback endpoint using event_id dedup table and ignore duplicates older than 24h.",
  "Design feature rollout plan by tenant segment with 10% canary, automatic rollback on error-rate > 2%, and status dashboard updates.",
  "Write parser for CSV import that validates headers, reports row-level errors, continues after bad rows, and outputs summary counts.",
  "Create secure password reset flow: token expires in 15 min, invalidate previous tokens, require rate limits by IP and account.",
];

const LARGE_PROMPTS = [
  `I am working on a production Node.js microservice that handles payment intents via Stripe, and I need you to write a thoroughly tested module that exposes two functions: createPaymentIntent(userId, amountCents, currency, metadata) and confirmPaymentIntent(intentId). The module must handle Stripe idempotency keys derived from a hash of userId plus a monotonically increasing nonce stored in Redis, must never log full card numbers or CVVs, must not retry on 4xx Stripe errors but must retry exponentially on 5xx, and must emit structured JSON logs including correlation IDs. Please also include unit tests using vitest, mock the Stripe client, and make sure that every error path is covered.`,
  `Please help me design and implement a React hook called useDebouncedSearch that takes a query string and a debounce delay in milliseconds and returns the current results, loading state, and error. It must cancel in-flight requests when the query changes using an AbortController, must not issue a request when the query is empty or whitespace-only, must not cache across different query strings, and must expose a manual refetch function. Write the hook in TypeScript with full JSDoc, include an example usage in a functional component, and provide tests using @testing-library/react that cover rapid typing, network errors, and empty input.`,
  `We have a Django application that serves a multi-tenant SaaS product and we need a new management command that exports every tenant's user activity for the past 30 days into a signed S3 URL. The command must stream rows rather than loading all of them in memory, must include only active tenants, must never include soft-deleted users, must exclude PII columns like password hashes and social security numbers, must chunk uploads at 5 MB, and must write one CSV file per tenant. It should accept --dry-run and --tenant-id flags, log progress every 1000 rows, and roll back partial exports on error so we never publish a half-complete file.`,
  `I need a Terraform module for provisioning a Postgres RDS instance on AWS with the following constraints: it must be multi-AZ, must have encryption at rest using a customer-managed KMS key, must not allow public access, must enforce IAM database authentication, must create read replicas in at least two other availability zones, and must emit CloudWatch alarms for high CPU, replica lag over 30 seconds, and free storage below 20 percent. The module should accept variables for instance class, allocated storage, backup retention, and preferred maintenance window, and it must not hardcode the database password but pull it from AWS Secrets Manager at apply time.`,
  `Write a Go HTTP middleware that enforces rate limiting per API key using a Redis sliding window algorithm with a 1-minute window and configurable per-key limits. It must read the API key from the X-API-Key header, must reject requests without a key with 401, must return 429 with a Retry-After header when the limit is exceeded, must not throttle internal service-to-service traffic identified by the X-Internal-Source header being set to a value in a whitelist, must use context cancellation so slow Redis calls don't pile up, and must emit Prometheus metrics for allowed, rejected, and Redis errors. Include benchmarks showing it can handle 10k requests per second per instance.`,
  `Design the schema and write the migration for an events ledger in PostgreSQL for a fintech application. The table must store immutable transaction events including id, user_id, event_type, amount_cents, currency, metadata JSONB, created_at, and idempotency_key. Requirements: id must be a time-ordered UUID, created_at must default to statement timestamp in UTC, idempotency_key must have a partial unique index scoped by user_id only when it is not null, the table must be partitioned by month for at least 36 months forward, and no row must ever be deletable or updatable once inserted. Write the SQL migration, the rollback, and the trigger functions that prevent UPDATE and DELETE.`,
  `Build a Python FastAPI backend for a document processing pipeline where users upload PDFs and the service extracts, classifies, and summarizes them. The service must accept multipart uploads up to 50 MB, must reject anything other than PDF content types verified by magic bytes, must never trust the filename, must enqueue the processing job to Celery with the file stored in S3, must return a job id immediately, and must expose a polling endpoint GET /jobs/{id} with states pending, running, succeeded, failed. The summarize step must not call any external LLM directly but should go through an internal abstraction that supports pluggable providers. Include Pydantic models, proper error responses, and OpenAPI documentation.`,
  `I want you to implement a Kubernetes operator in Go using the Operator SDK that manages a CustomResource called PreviewEnvironment. Each PreviewEnvironment spec has a git branch, a service list, and a TTL in hours. On create, the operator must provision an ephemeral namespace, deploy the listed services using their Helm charts pinned to the commit SHA of that branch, attach an ingress with a subdomain derived from the branch name, and record the created-at timestamp. On TTL expiry the operator must tear down the namespace, must not touch any other namespace, must not leave orphaned cloud DNS records, and must emit Kubernetes events for every state transition. Provide the reconciler loop, the CRD, and RBAC manifests.`,
  `Write a thorough code review checklist for pull requests in a Next.js 14 application that uses the app router, React Server Components, server actions, and Drizzle ORM against PostgreSQL. The checklist must cover: correctness of server versus client component boundaries, safe handling of secrets and environment variables in server code only, use of cache revalidation tags, N+1 query avoidance on server components, accessibility regressions in new components, bundle-size impact from new client dependencies, migration safety and rollback plan, and test coverage for both unit and end-to-end flows. The checklist must not include stylistic preferences or things that our automated linters already catch.`,
  `I need to refactor an old Express.js codebase that currently mixes business logic, database access, and HTTP handling inside each route handler. Please propose and implement a clean hexagonal architecture with clear separation between domain, application, and infrastructure layers. Preserve existing external response shapes exactly, keep existing URL paths identical, do not introduce any new dependencies outside of what we already have in package.json, do not change database schemas, and provide a migration plan that allows us to refactor one route at a time without a big-bang rewrite. Include a concrete example refactor of the /api/users POST endpoint showing the before and after structure.`,
  `Implement a WebSocket-based real-time chat server in Rust using tokio and tungstenite that supports rooms, typing indicators, and delivery acknowledgments. Requirements: each connection must authenticate with a short-lived JWT before any room join, must not allow a client to join more than 20 rooms concurrently, must send a delivery ack within 500 ms or the server disconnects that client, must persist the last 100 messages per room to Postgres asynchronously without blocking broadcasts, must never leak memory on disconnect, and must expose a Prometheus exporter for connection counts, message throughput, and ack latency histograms. Write idiomatic async Rust, include integration tests using tokio-test.`,
  `Design a secure password reset flow for a web application that does not rely on email links alone. The flow must: generate a single-use reset token valid for 15 minutes, require the user to also enter a 6-digit code sent via SMS or authenticator app, invalidate all previous reset tokens for that user on issuance, never expose whether an email exists in any response, not log the reset token or the 6-digit code anywhere including application logs or APM traces, rate limit reset requests per IP and per account, and publish a security event for every issuance and every successful reset. Provide the API contract, database schema changes, and the exact HTTP status codes for each scenario.`,
  `Design a multi-region disaster recovery plan for an event-driven payments platform using Kafka, Postgres, and Redis. The solution must define RPO under 5 minutes and RTO under 20 minutes, require encrypted replication channels, never fail over without a consistency checkpoint, and include runbooks for primary outage, partial network partition, and region-wide DNS failure. Add drills cadence, blast-radius controls, rollback criteria, and exact observability signals used to declare incident severity.`,
  `Create an enterprise audit architecture for admin actions across API, worker, and CLI surfaces. Every action must include actor id, tenant id, resource id, before/after snapshots, request id, and immutable timestamp; sensitive fields must be hashed or redacted; logs must be append-only and tamper-evident; and query APIs must support pagination, filtering by action type, and export as signed CSV links that expire in 10 minutes.`,
  `Specify a full migration strategy from REST v1 to REST v2 for a public API used by third-party integrators. Maintain backward compatibility for 90 days, provide dual-write verification, never break webhook payload fields without version pinning, include canary rollout by customer cohort, publish deprecation headers, and define automatic rollback triggers for latency p95 increase above 25% or error rate increase above 1.5%.`,
];

const CORPUS = [
  ...SMALL_PROMPTS.map((prompt) => ({ prompt, sizeBucket: "small" })),
  ...MEDIUM_PROMPTS.map((prompt) => ({ prompt, sizeBucket: "medium" })),
  ...LARGE_PROMPTS.map((prompt) => ({ prompt, sizeBucket: "large" })),
];

const MAX_PROMPTS = Math.min(LIMIT, CORPUS.length);
const PROMPTS = CORPUS.slice(0, MAX_PROMPTS);

// ----- Helpers -----------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mean(arr) {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function quantile(arr, q) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function summarizeBucket(rows, bucket) {
  const subset = rows.filter((r) => r.sizeBucket === bucket);
  if (subset.length === 0) return null;
  const savedTotal = subset.reduce((acc, r) => acc + r.saved, 0);
  const wins = subset.filter((r) => r.saved > 0).length;
  const regressions = subset.filter((r) => r.saved < 0).length;
  return {
    n: subset.length,
    savedTotal,
    meanSaved: savedTotal / subset.length,
    meanReduction: subset.reduce((acc, r) => acc + r.reduction, 0) / subset.length,
    winRate: wins / subset.length,
    noRegressionRate: (subset.length - regressions) / subset.length,
  };
}

/**
 * Two-tailed p-value for a t-statistic with df degrees of freedom using
 * an Abramowitz & Stegun series approximation. Accurate enough to report
 * a qualitative p < 0.001 vs p < 0.05 verdict.
 */
function twoTailedPValue(t, df) {
  if (!isFinite(t) || df <= 0) return 1;
  const x = df / (df + t * t);
  // Regularized incomplete beta via continued fraction (Numerical Recipes)
  const a = df / 2;
  const b = 0.5;
  const bt =
    Math.exp(
      gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
    );
  let betaI;
  if (x < (a + 1) / (a + b + 2)) {
    betaI = (bt * betacf(x, a, b)) / a;
  } else {
    betaI = 1 - (bt * betacf(1 - x, b, a)) / b;
  }
  return Math.min(1, Math.max(0, betaI));
}

function betacf(x, a, b) {
  const MAX = 200;
  const EPS = 3e-7;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function gammaln(x) {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// ----- Downstream model caller ------------------------------------------

class DailyQuotaExceeded extends Error {
  constructor(msg) {
    super(msg);
    this.code = "daily_quota_exceeded";
  }
}

async function callModelOnce(prompt, { timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(TARGET_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TARGET_KEY}`,
        "HTTP-Referer": "https://github.com/Ezzio11/prompt-compressor",
        "X-Title": "SuperZ A/B Evaluation",
      },
      body: JSON.stringify({
        model: TARGET_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
      }),
    });
    const latencyMs = Date.now() - started;
    if (res.status === 429) {
      const text = await res.text();
      const err = new Error(`429: ${text.slice(0, 220)}`);
      err.status = 429;
      err.headers = res.headers;
      err.body = text;
      throw err;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 220)}`);
    }
    const data = await res.json();
    const usage = data.usage ?? {};
    const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
    const raw = choice?.message?.content ?? choice?.text ?? "";
    const content =
      typeof raw === "string"
        ? raw
        : Array.isArray(raw)
          ? raw.map((p) => p?.text ?? p?.content ?? "").join("")
          : "";
    return {
      content,
      promptTokens: Number(usage.prompt_tokens ?? 0),
      completionTokens: Number(usage.completion_tokens ?? 0),
      totalTokens: Number(usage.total_tokens ?? 0),
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callModel(prompt, opts) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callModelOnce(prompt, opts);
    } catch (err) {
      lastErr = err;
      if (err.status !== 429) throw err;
      if (/free-models-per-day/i.test(err.body ?? "")) {
        throw new DailyQuotaExceeded(
          "OpenRouter free-models-per-day quota exhausted (50/day).\n" +
            "Free alternatives (no credit card needed):\n" +
            "  - Groq:             https://console.groq.com/keys    (14k+ requests/day free)\n" +
            "  - Google AI Studio: https://aistudio.google.com/app/apikey  (1M tokens/day free)\n" +
            "After getting a key, run `node dist/cli.js init` and pick the new provider,\n" +
            "or set GROQ_API_KEY / GOOGLE_API_KEY in the environment and re-run `npm run ab-test`.",
        );
      }
      const reset = Number(err.headers?.get?.("x-ratelimit-reset") ?? 0);
      const now = Date.now();
      let waitMs;
      if (reset > now) {
        waitMs = Math.min(reset - now + 250, RETRY_CAP_MS);
      } else {
        waitMs = Math.min(2000 * 2 ** attempt, RETRY_CAP_MS);
      }
      process.stdout.write(`[429 retry in ${Math.round(waitMs / 1000)}s] `);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

// ----- Main loop ---------------------------------------------------------

async function main() {
  const compressionProviders = config.providers.filter(
    (p) => p.name.toLowerCase() === compressionProviderOverride.toLowerCase(),
  );
  if (compressionProviders.length === 0) {
    console.error(
      `Compression provider "${compressionProviderOverride}" not found in config. ` +
        `Run "node dist/cli.js list" and set SUPERZ_AB_COMPRESSION_PROVIDER to one of your configured provider names.`,
    );
    process.exit(2);
  }
  const compressionConfig = {
    ...config,
    providers: compressionProviders,
    compression: UNSAFE_MODE
      ? {
          ...config.compression,
          // Experimental only: disable safety to measure pure savings potential.
          strictNegativeConstraints: false,
          strictNumericConstraints: false,
          maxExpansionAllowed: 100000,
          minExpectedGainTokens: 0,
          bypassMinTokens: 1,
          bypassMinWords: 1,
        }
      : config.compression,
  };
  const engine = new CompressionEngine(compressionConfig);

  console.log("=== SuperZ A/B Evaluation ===");
  console.log(`provider     = ${TARGET_PROVIDER}`);
  console.log(`compressor   = ${compressionProviders[0].name}`);
  console.log(`target_model = ${TARGET_MODEL}`);
  console.log(`target_url   = ${TARGET_URL}`);
  console.log(`prompts      = ${PROMPTS.length} / ${CORPUS.length} available`);
  console.log(`max_tokens   = ${MAX_TOKENS}`);
  console.log(`sleep_ms     = ${SLEEP_MS}`);
  console.log(`unsafe_mode  = ${UNSAFE_MODE ? "ON (no safety policy)" : "OFF"}`);
  const datasetMix = PROMPTS.reduce((acc, item) => {
    acc[item.sizeBucket] = (acc[item.sizeBucket] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`dataset_mix  = ${JSON.stringify(datasetMix)}`);
  console.log("Running warm-up call...");
  try {
    await callModel("Reply with just the single word: ready.");
  } catch (err) {
    if (err instanceof DailyQuotaExceeded) {
      console.error(`\n${err.message}`);
      console.error(`Tip: override the target model with SUPERZ_AB_TARGET_MODEL (e.g. a paid model or a different free slug).`);
      process.exit(3);
    }
    console.error("Warm-up failed (continuing anyway):", err.message ?? err);
  }

  const rows = [];
  for (let i = 0; i < PROMPTS.length; i++) {
    const promptItem = PROMPTS[i];
    const prompt = promptItem.prompt;
    process.stdout.write(`[${i + 1}/${PROMPTS.length}] compressing... `);
    const compression = await engine.compress(prompt, { force: true, bypassCache: true });
    process.stdout.write("raw... ");
    let raw;
    try {
      raw = await callModel(prompt);
    } catch (err) {
      if (err instanceof DailyQuotaExceeded) {
        console.log(`\n${err.message}`);
        break;
      }
      console.log(`\n  raw call failed: ${err.message ?? err}`);
      continue;
    }
    await sleep(SLEEP_MS);
    process.stdout.write("compressed... ");
    let comp;
    try {
      comp = await callModel(compression.compressed);
    } catch (err) {
      if (err instanceof DailyQuotaExceeded) {
        console.log(`\n${err.message}`);
        break;
      }
      console.log(`\n  compressed call failed: ${err.message ?? err}`);
      continue;
    }
    await sleep(SLEEP_MS);
    const saved = raw.promptTokens - comp.promptTokens;
    const reduction = raw.promptTokens > 0 ? saved / raw.promptTokens : 0;
    rows.push({
      idx: i + 1,
      sizeBucket: promptItem.sizeBucket,
      promptTier: compression.promptTier ?? promptItem.sizeBucket,
      provider: compression.provider,
      fallbackReason: compression.fallbackReason ?? "",
      localSaved: compression.savedTokens,
      apiRawIn: raw.promptTokens,
      apiCompIn: comp.promptTokens,
      saved,
      reduction,
      rawOut: raw.completionTokens,
      compOut: comp.completionTokens,
      rawLatency: raw.latencyMs,
      compLatency: comp.latencyMs,
      compressionLatency: compression.savedTokens >= 0 ? null : null,
      negPreserved: compression.constraintReport?.preserved ?? true,
      negationPreserved: compression.constraintReport?.negation?.preserved ?? true,
      numericPreserved: compression.constraintReport?.numeric?.preserved ?? true,
      schemaPreserved: compression.constraintReport?.schema?.preserved ?? true,
      compressionPromptTokens: Number(compression.providerUsage?.promptTokens ?? 0),
      compressionCachedTokens: Number(compression.providerUsage?.cachedPromptTokens ?? 0),
      rawResponse: raw.content,
      compResponse: comp.content,
      prompt,
      compressed: compression.compressed,
    });
    console.log(
      `saved=${saved} tok (${(reduction * 100).toFixed(1)}%)  ` +
        `raw=${raw.promptTokens}->${comp.promptTokens} in, out=${raw.completionTokens}/${comp.completionTokens}`,
    );
  }

  if (rows.length === 0) {
    console.error("\nNo successful A/B pairs collected.");
    process.exit(1);
  }

  // ----- Aggregate ---------------------------------------------------------

  const savings = rows.map((r) => r.saved);
  const reductions = rows.map((r) => r.reduction);
  const n = savings.length;
  const mSave = mean(savings);
  const sdSave = stddev(savings);
  const seSave = sdSave / Math.sqrt(n);
  const tStat = seSave > 0 ? mSave / seSave : 0;
  const pValue = twoTailedPValue(tStat, n - 1);
  const ciHalfWidth = 1.96 * seSave;

  const totalRawIn = rows.reduce((a, r) => a + r.apiRawIn, 0);
  const totalCompIn = rows.reduce((a, r) => a + r.apiCompIn, 0);
  const totalRawOut = rows.reduce((a, r) => a + r.rawOut, 0);
  const totalCompOut = rows.reduce((a, r) => a + r.compOut, 0);

  const costRaw = (totalRawIn * PRICE_IN + totalRawOut * PRICE_OUT) / 1_000_000;
  const costComp = (totalCompIn * PRICE_IN + totalCompOut * PRICE_OUT) / 1_000_000;
  const costSaved = costRaw - costComp;
  const costSavedPct = costRaw > 0 ? (costSaved / costRaw) * 100 : 0;

  const rawLatencies = rows.map((r) => r.rawLatency);
  const compLatencies = rows.map((r) => r.compLatency);
  const wins = rows.filter((r) => r.saved > 0).length;
  const regressions = rows.filter((r) => r.saved < 0).length;
  const fallbackCounts = rows.reduce((acc, r) => {
    const key = r.fallbackReason || "none";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const bySize = {
    small: summarizeBucket(rows, "small"),
    medium: summarizeBucket(rows, "medium"),
    large: summarizeBucket(rows, "large"),
  };
  const compressionPromptTotal = rows.reduce((acc, r) => acc + r.compressionPromptTokens, 0);
  const compressionCachedTotal = rows.reduce((acc, r) => acc + r.compressionCachedTokens, 0);
  const compressionCacheHitRate =
    compressionPromptTotal > 0 ? compressionCachedTotal / compressionPromptTotal : 0;
  const compressionCacheCostSavedUsd = (compressionCachedTotal * PRICE_IN * 0.5) / 1_000_000;

  console.log("\n=== Per-prompt results ===");
  console.table(
    rows.map((r) => ({
      case: r.idx,
      size: r.sizeBucket,
      provider: r.provider,
      raw_in: r.apiRawIn,
      comp_in: r.apiCompIn,
      saved: r.saved,
      reduction: `${(r.reduction * 100).toFixed(1)}%`,
      raw_out: r.rawOut,
      comp_out: r.compOut,
      raw_ms: r.rawLatency,
      comp_ms: r.compLatency,
      neg_ok: r.negationPreserved,
      num_ok: r.numericPreserved,
      schema_ok: r.schemaPreserved,
      cache_in: r.compressionCachedTokens,
      fallback: r.fallbackReason || "-",
    })),
  );

  console.log("\n=== Aggregate ===");
  console.log(`n=${n}`);
  console.log(`input_tokens_raw_total=${totalRawIn}`);
  console.log(`input_tokens_compressed_total=${totalCompIn}`);
  console.log(`input_tokens_saved_total=${totalRawIn - totalCompIn}`);
  console.log(
    `input_tokens_saved_mean=${mSave.toFixed(2)} (sd=${sdSave.toFixed(2)}, 95% CI [${(mSave - ciHalfWidth).toFixed(2)}, ${(mSave + ciHalfWidth).toFixed(2)}])`,
  );
  console.log(`mean_reduction_ratio=${(mean(reductions) * 100).toFixed(2)}%`);
  console.log(`paired_t=${tStat.toFixed(3)}  df=${n - 1}  p=${pValue.toExponential(2)}`);
  console.log(`compression_win_rate=${((wins / n) * 100).toFixed(2)}% (${wins}/${n})`);
  console.log(`no_regression_rate=${(((n - regressions) / n) * 100).toFixed(2)}% (${n - regressions}/${n})`);
  console.log(
    `constraint_survival_negation=${(mean(rows.map((r) => (r.negationPreserved ? 1 : 0))) * 100).toFixed(2)}%`,
  );
  console.log(
    `constraint_survival_numeric=${(mean(rows.map((r) => (r.numericPreserved ? 1 : 0))) * 100).toFixed(2)}%`,
  );
  console.log(
    `constraint_survival_schema=${(mean(rows.map((r) => (r.schemaPreserved ? 1 : 0))) * 100).toFixed(2)}%`,
  );
  console.log(`output_tokens_raw_total=${totalRawOut}`);
  console.log(`output_tokens_compressed_total=${totalCompOut}`);
  console.log(
    `latency_raw p50=${quantile(rawLatencies, 0.5).toFixed(0)}ms p95=${quantile(rawLatencies, 0.95).toFixed(0)}ms`,
  );
  console.log(
    `latency_comp p50=${quantile(compLatencies, 0.5).toFixed(0)}ms p95=${quantile(compLatencies, 0.95).toFixed(0)}ms`,
  );
  console.log(`estimated_cost_raw=$${costRaw.toFixed(6)}  (input $/1M=${PRICE_IN}, output $/1M=${PRICE_OUT})`);
  console.log(`estimated_cost_compressed=$${costComp.toFixed(6)}`);
  console.log(`estimated_cost_saved=$${costSaved.toFixed(6)} (${costSavedPct.toFixed(2)}%)`);
  console.log(
    `negative_constraint_preservation=${(mean(rows.map((r) => (r.negPreserved ? 1 : 0)))).toFixed(4)}`,
  );
  console.log(`fallback_reasons=${JSON.stringify(fallbackCounts)}`);
  console.log(`size_bucket_summary=${JSON.stringify(bySize)}`);
  console.log(
    `compression_cache_hit_ratio=${(compressionCacheHitRate * 100).toFixed(2)}% (${compressionCachedTotal}/${compressionPromptTotal})`,
  );
  console.log(`compression_cache_cost_saved_estimate=$${compressionCacheCostSavedUsd.toFixed(6)}`);

  // ----- Persist report ----------------------------------------------------

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = resolve(process.cwd(), "reports");
  mkdirSync(reportDir, { recursive: true });
  const jsonPath = resolve(reportDir, `ab-${stamp}.json`);
  const mdPath = resolve(reportDir, `ab-${stamp}.md`);
  const summary = {
    target: { model: TARGET_MODEL, url: TARGET_URL, maxTokens: MAX_TOKENS },
    pricing: { inputPerMillion: PRICE_IN, outputPerMillion: PRICE_OUT },
    aggregate: {
      n,
      inputTokensRawTotal: totalRawIn,
      inputTokensCompressedTotal: totalCompIn,
      inputTokensSavedTotal: totalRawIn - totalCompIn,
      meanSavedPerPrompt: mSave,
      stdDevSaved: sdSave,
      ci95: [mSave - ciHalfWidth, mSave + ciHalfWidth],
      meanReductionRatio: mean(reductions),
      compressionWinRate: wins / n,
      noRegressionRate: (n - regressions) / n,
      pairedT: tStat,
      df: n - 1,
      pValue,
      constraintSurvival: {
        negation: mean(rows.map((r) => (r.negationPreserved ? 1 : 0))),
        numeric: mean(rows.map((r) => (r.numericPreserved ? 1 : 0))),
        schema: mean(rows.map((r) => (r.schemaPreserved ? 1 : 0))),
      },
      fallbackReasons: fallbackCounts,
      bySize,
      compressionCache: {
        promptTokensTotal: compressionPromptTotal,
        cachedPromptTokensTotal: compressionCachedTotal,
        cacheHitRatio: compressionCacheHitRate,
        estimatedInputCostSavedUsd: compressionCacheCostSavedUsd,
      },
      latencyRaw: {
        p50: quantile(rawLatencies, 0.5),
        p95: quantile(rawLatencies, 0.95),
      },
      latencyCompressed: {
        p50: quantile(compLatencies, 0.5),
        p95: quantile(compLatencies, 0.95),
      },
      estimatedCostRawUsd: costRaw,
      estimatedCostCompressedUsd: costComp,
      estimatedCostSavedUsd: costSaved,
      negativeConstraintPreservation: mean(rows.map((r) => (r.negPreserved ? 1 : 0))),
    },
    rows,
  };
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  const md = [
    `# SuperZ A/B Evaluation Report`,
    ``,
    `- Generated: ${new Date().toISOString()}`,
    `- Target model: \`${TARGET_MODEL}\``,
    `- Endpoint: \`${TARGET_URL}\``,
    `- Prompts evaluated: **${n}**`,
    ``,
    `## Headline numbers`,
    ``,
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Input tokens saved (total) | **${totalRawIn - totalCompIn}** |`,
    `| Mean input tokens saved per prompt | **${mSave.toFixed(2)}** |`,
    `| 95% CI on per-prompt savings | [${(mSave - ciHalfWidth).toFixed(2)}, ${(mSave + ciHalfWidth).toFixed(2)}] |`,
    `| Mean input reduction | **${(mean(reductions) * 100).toFixed(2)}%** |`,
    `| Compression win rate | **${((wins / n) * 100).toFixed(2)}%** (${wins}/${n}) |`,
    `| No-regression rate | **${(((n - regressions) / n) * 100).toFixed(2)}%** (${n - regressions}/${n}) |`,
    `| Paired t (df=${n - 1}) | ${tStat.toFixed(3)} |`,
    `| Two-tailed p-value | ${pValue.toExponential(2)} |`,
    `| Latency raw p50 / p95 | ${quantile(rawLatencies, 0.5).toFixed(0)} / ${quantile(rawLatencies, 0.95).toFixed(0)} ms |`,
    `| Latency compressed p50 / p95 | ${quantile(compLatencies, 0.5).toFixed(0)} / ${quantile(compLatencies, 0.95).toFixed(0)} ms |`,
    `| Estimated cost saved | $${costSaved.toFixed(6)} (${costSavedPct.toFixed(2)}%) |`,
    `| Constraint survival (negation/numeric/schema) | ${(
      mean(rows.map((r) => (r.negationPreserved ? 1 : 0))) * 100
    ).toFixed(2)}% / ${(mean(rows.map((r) => (r.numericPreserved ? 1 : 0))) * 100).toFixed(2)}% / ${(
      mean(rows.map((r) => (r.schemaPreserved ? 1 : 0))) * 100
    ).toFixed(2)}% |`,
    `| Compression cache hit ratio | ${(compressionCacheHitRate * 100).toFixed(2)}% (${compressionCachedTotal}/${compressionPromptTotal}) |`,
    `| Compression cache input cost saved (estimate) | $${compressionCacheCostSavedUsd.toFixed(6)} |`,
    ``,
    `## By size bucket`,
    ``,
    `| Bucket | n | Saved total | Mean saved | Mean reduction | Win rate | No-regression |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    ...Object.entries(bySize).map(([bucket, stats]) =>
      stats
        ? `| ${bucket} | ${stats.n} | ${stats.savedTotal} | ${stats.meanSaved.toFixed(2)} | ${(stats.meanReduction * 100).toFixed(2)}% | ${(stats.winRate * 100).toFixed(2)}% | ${(stats.noRegressionRate * 100).toFixed(2)}% |`
        : `| ${bucket} | 0 | - | - | - | - | - |`,
    ),
    ``,
    `Pricing assumption: input $${PRICE_IN}/1M tokens, output $${PRICE_OUT}/1M tokens (override with \`SUPERZ_AB_PRICE_IN\` / \`SUPERZ_AB_PRICE_OUT\`).`,
    ``,
    `## Per-prompt breakdown`,
    ``,
    `| # | Size | Tier | Provider | Raw in | Comp in | Saved | Reduction | Raw out | Comp out | Raw ms | Comp ms | Neg ok | Num ok | Schema ok | Cache in | Fallback |`,
    `| - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |`,
    ...rows.map(
      (r) =>
        `| ${r.idx} | ${r.sizeBucket} | ${r.promptTier} | ${r.provider} | ${r.apiRawIn} | ${r.apiCompIn} | ${r.saved} | ${(r.reduction * 100).toFixed(1)}% | ${r.rawOut} | ${r.compOut} | ${r.rawLatency} | ${r.compLatency} | ${r.negationPreserved ? "yes" : "NO"} | ${r.numericPreserved ? "yes" : "NO"} | ${r.schemaPreserved ? "yes" : "NO"} | ${r.compressionCachedTokens} | ${r.fallbackReason || "-"} |`,
    ),
    ``,
    `## Reproduce`,
    ``,
    `\`\`\`bash`,
    `npm run build && npm run ab-test`,
    `# override target model or pricing as needed:`,
    `# $env:SUPERZ_AB_TARGET_MODEL="openai/gpt-4o-mini"; npm run ab-test`,
    `\`\`\``,
    ``,
  ].join("\n");
  writeFileSync(mdPath, md);

  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error("A/B evaluation failed:", err);
  process.exit(1);
});
