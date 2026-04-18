import { describe, expect, it } from "vitest";
import { verifyConstraints } from "../src/engine/validator.js";

describe("verifyConstraints", () => {
  it("preserves numeric constraints", () => {
    const original = "Retry with 3 attempts, timeout 5000ms, and cache TTL 60 seconds.";
    const compressed = "retry: 3 attempts, timeout 5000ms, cache ttl 60 seconds.";
    const report = verifyConstraints(original, compressed);
    expect(report.numeric.preserved).toBe(true);
    expect(report.preserved).toBe(true);
  });

  it("flags missing numeric constraints when strict numeric is enabled", () => {
    const original = "Rate limit 100 requests per minute and timeout 30s.";
    const compressed = "Rate limit requests per minute and timeout.";
    const report = verifyConstraints(original, compressed);
    expect(report.numeric.preserved).toBe(false);
    expect(report.preserved).toBe(false);
    expect(report.missing.some((x) => x.startsWith("num:"))).toBe(true);
  });

  it("allows missing numeric constraints when strict numeric is disabled", () => {
    const original = "Rate limit 100 requests per minute and timeout 30s.";
    const compressed = "Rate limit requests per minute and timeout.";
    const report = verifyConstraints(original, compressed, { strictNumeric: false });
    expect(report.numeric.preserved).toBe(false);
    expect(report.preserved).toBe(true);
  });

  it("preserves schema obligations like routes and methods", () => {
    const original = 'Create POST /v1/compress and return {"compressed_prompt": "..."} on 200.';
    const compressed = 'POST /v1/compress -> {"compressed_prompt":"..."} status 200.';
    const report = verifyConstraints(original, compressed);
    expect(report.schema.preserved).toBe(true);
    expect(report.preserved).toBe(true);
  });

  it("flags missing schema obligations", () => {
    const original = 'Create POST /v1/compress and return {"compressed_prompt": "..."} on 200.';
    const compressed = "Create endpoint and return result.";
    const report = verifyConstraints(original, compressed);
    expect(report.schema.preserved).toBe(false);
    expect(report.preserved).toBe(false);
    expect(report.missing.some((x) => x.startsWith("schema:"))).toBe(true);
  });
});
