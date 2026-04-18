import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeUsageLog } from "../src/util/usage-log.js";

describe("usage-log summary", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "superz-usage-"));
    path = join(dir, "usage.log.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns zeros when file is missing", () => {
    const summary = summarizeUsageLog({ path });
    expect(summary.totalEntries).toBe(0);
    expect(summary.savedTokensTotal).toBe(0);
  });

  it("aggregates entries by tier and provider", () => {
    const entries = [
      {
        ts: new Date().toISOString(),
        inputTokens: 2000,
        outputTokens: 1200,
        saved: 800,
        reductionRatio: 0.4,
        provider: "OpenRouter-Free",
        tier: "large",
        bypassed: false,
        cacheHit: false,
        constraintOk: true,
      },
      {
        ts: new Date().toISOString(),
        inputTokens: 300,
        outputTokens: 300,
        saved: 0,
        reductionRatio: 0,
        provider: "bypass",
        tier: "small",
        bypassed: true,
        cacheHit: false,
        constraintOk: true,
      },
      {
        ts: new Date().toISOString(),
        inputTokens: 1000,
        outputTokens: 500,
        saved: 500,
        reductionRatio: 0.5,
        provider: "extractive",
        tier: "large",
        bypassed: false,
        cacheHit: false,
        constraintOk: false,
      },
    ];
    writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n"), "utf8");

    const summary = summarizeUsageLog({ path });
    expect(summary.totalEntries).toBe(3);
    expect(summary.bypassed).toBe(1);
    expect(summary.compressed).toBe(2);
    expect(summary.savedTokensTotal).toBe(1300);
    expect(summary.byTier["large"]?.count).toBe(2);
    expect(summary.byTier["small"]?.count).toBe(1);
    expect(summary.byProvider["OpenRouter-Free"]?.savedTokens).toBe(800);
    expect(summary.constraintFailureRate).toBeCloseTo(1 / 3, 2);
  });

  it("filters entries outside the window", () => {
    const now = Date.now();
    const oldEntry = {
      ts: new Date(now - 10 * 86_400_000).toISOString(),
      inputTokens: 1000,
      outputTokens: 500,
      saved: 500,
      reductionRatio: 0.5,
      provider: "extractive",
      tier: "large",
      bypassed: false,
      cacheHit: false,
      constraintOk: true,
    };
    const recentEntry = {
      ts: new Date(now - 60_000).toISOString(),
      inputTokens: 500,
      outputTokens: 200,
      saved: 300,
      reductionRatio: 0.6,
      provider: "extractive",
      tier: "large",
      bypassed: false,
      cacheHit: false,
      constraintOk: true,
    };
    writeFileSync(
      path,
      [JSON.stringify(oldEntry), JSON.stringify(recentEntry)].join("\n"),
      "utf8",
    );

    const summary = summarizeUsageLog({ path, window: "1d" });
    expect(summary.totalEntries).toBe(1);
    expect(summary.savedTokensTotal).toBe(300);
  });
});
