#!/usr/bin/env node
import { CompressionEngine, loadConfig } from "../dist/index.js";

const prompts = [
  "I am building a React login page and I need you to create a clean component with validation and make sure not to use Tailwind CSS because we only use CSS modules in our project.",
  "Could you please help me write a Node.js middleware that validates JWT tokens, returns 401 on failure, and does not expose token details in error messages?",
  "We need an API endpoint that receives a list of products with fields name, price, and tags, and if user is admin return all fields otherwise return only name and price.",
  "Please refactor this TypeScript function to improve readability and performance while keeping the same behavior and add clear comments where needed.",
  "Build a caching layer for Redis with TTL control and retry logic, and never cache responses that include personal data or auth tokens.",
  "Design a background job pipeline for sending order confirmation emails with retries and dead-letter handling, and do not send duplicate emails.",
  "Create a GraphQL resolver for fetching user profile data with pagination and filtering while avoiding N+1 database queries.",
  "Implement a file upload endpoint that accepts images only, enforces size limits, and must not store files larger than 5MB.",
  "Write a migration plan from MySQL to PostgreSQL with rollback strategy and clear zero-downtime constraints.",
  "Build a feature flag system for React + Node where flags can be targeted by user role and region and never cached longer than 60 seconds.",
  "Implement OAuth login flow with Google and GitHub and do not persist provider access tokens in plaintext.",
  "Create a webhook receiver that validates HMAC signatures and rejects any request without a valid timestamp window.",
  "Build a real-time notification system over WebSocket with reconnect handling and backpressure strategy.",
  "Generate a test strategy for an e-commerce checkout flow covering payment failure, inventory race conditions, and coupon edge cases.",
  "Design rate limiting middleware with Redis sliding window and guarantee that internal service traffic is excluded from throttling.",
  "Refactor this monolithic controller into services and repositories while preserving existing response contracts exactly.",
  "Create an audit log module that records security-critical actions and never logs secrets, passwords, or token values.",
  "Implement multi-tenant data isolation using organization_id on every query and forbid cross-tenant joins.",
  "Build an ETL pipeline that ingests CSV files, validates schema, and skips malformed rows without stopping the whole batch.",
  "Write a retry wrapper for third-party API calls using exponential backoff and jitter, but never retry on 4xx auth failures.",
  "Design a Kubernetes deployment strategy for a Node API with rolling updates, readiness probes, and autoscaling thresholds.",
  "Create a policy for secret management in CI/CD that avoids hardcoded credentials and enforces periodic rotation.",
  "Implement a request deduplication mechanism for idempotent POST endpoints using idempotency keys.",
  "Build a scheduler that runs cron jobs with distributed locking and guarantees no concurrent execution of the same job.",
  "Design an access control matrix for admin roles and permissions with explicit deny rules taking precedence over allow.",
  "Create a data retention job that anonymizes inactive users after 180 days and never deletes legal-hold accounts.",
  "Implement client-side caching for search results with stale-while-revalidate and strict cache busting on filter changes.",
  "Write a secure password reset flow that expires links in 15 minutes and invalidates previous reset tokens.",
  "Build a logging architecture with structured JSON logs, correlation IDs, and sampling for noisy endpoints.",
  "Design a chatbot prompt pipeline that sanitizes user content and blocks prompt-injection patterns before model calls.",
  "Implement S3 pre-signed URL generation and ensure upload keys cannot escape the allowed tenant prefix.",
  "Create an invoice generation service with deterministic totals and explicit rounding rules across currencies.",
  "Build a moderation queue workflow with reviewer assignment, escalation rules, and immutable decision history.",
  "Design a mobile sync protocol for offline edits using conflict resolution and last-write-wins fallback.",
  "Implement health checks for dependencies and ensure liveness does not include expensive downstream checks.",
  "Build a telemetry ingestion endpoint that validates payload schema and rejects unknown event versions.",
  "Write a memory leak investigation checklist for Node workers including heap snapshots and allocation timelines.",
  "Create a release checklist for production deployment with rollback triggers and post-release verification gates.",
  "Design a search indexing pipeline with partial reindex support and failure recovery at document granularity.",
  "Implement fraud detection rules that flag suspicious transactions and never auto-block VIP accounts without manual review.",
];

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

async function run() {
  const engine = new CompressionEngine(loadConfig());
  const rows = [];

  for (const prompt of prompts) {
    const result = await engine.compress(prompt, { force: true, bypassCache: true });
    rows.push({
      provider: result.provider,
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      savedTokens: result.savedTokens,
      reductionRatio: result.originalTokens > 0 ? result.savedTokens / result.originalTokens : 0,
      negPreserved: result.constraintReport?.preserved ?? true,
      fallbackReason: result.fallbackReason ?? "",
      errorCount: result.errors?.length ?? 0,
    });
  }

  const ratios = rows.map((r) => r.reductionRatio);
  const meanRatio = mean(ratios);
  const sdRatio = std(ratios);
  const n = ratios.length;
  const ciHalfWidth = n > 0 ? (1.96 * sdRatio) / Math.sqrt(n) : 0;
  const ncp = mean(rows.map((r) => (r.negPreserved ? 1 : 0)));

  console.log("=== Prompt Compressor Benchmark ===");
  console.table(
    rows.map((r, idx) => ({
      case: idx + 1,
      provider: r.provider,
      original: r.originalTokens,
      compressed: r.compressedTokens,
      saved: r.savedTokens,
      reductionPct: `${(r.reductionRatio * 100).toFixed(1)}%`,
      negPreserved: r.negPreserved,
      fallbackReason: r.fallbackReason || "-",
      errors: r.errorCount,
    })),
  );
  console.log("");
  const fallbackTotal = rows.filter((r) => r.provider === "fallback-regex").length;
  const constraintFallbacks = rows.filter((r) => r.fallbackReason === "constraint_violation").length;
  const providerFallbacks = rows.filter((r) => r.fallbackReason === "provider_failure").length;
  console.log(`n=${n}`);
  console.log(`mean_reduction_ratio=${meanRatio.toFixed(4)} (${(meanRatio * 100).toFixed(2)}%)`);
  console.log(`95%_CI=[${(meanRatio - ciHalfWidth).toFixed(4)}, ${(meanRatio + ciHalfWidth).toFixed(4)}]`);
  console.log(`negative_constraint_preservation=${ncp.toFixed(4)}`);
  console.log(`fallback_total=${fallbackTotal}`);
  console.log(`fallback_provider_failure=${providerFallbacks}`);
  console.log(`fallback_constraint_violation=${constraintFallbacks}`);
}

run().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
