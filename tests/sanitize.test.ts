import { describe, expect, it } from "vitest";
import { sanitizeCompression } from "../src/engine/sanitize.js";

describe("sanitizeCompression", () => {
  it("strips common LLM preamble phrases", () => {
    expect(
      sanitizeCompression("Sure, here's the compressed prompt: Build OAuth flow."),
    ).toBe("Build OAuth flow.");
    expect(sanitizeCompression("Certainly! Compressed: do X not Y.")).toBe("do X not Y.");
    expect(
      sanitizeCompression("Here is the compressed version:\nBuild a cache layer."),
    ).toBe("Build a cache layer.");
  });

  it("strips common LLM postamble phrases", () => {
    expect(
      sanitizeCompression("Build X.\n\nLet me know if you need adjustments."),
    ).toBe("Build X.");
    expect(
      sanitizeCompression("Do X and not Y.\nThis version preserves the constraint."),
    ).toBe("Do X and not Y.");
  });

  it("strips wrapping markdown code fences", () => {
    expect(sanitizeCompression("```\nBuild login form.\n```")).toBe(
      "Build login form.",
    );
    expect(sanitizeCompression("```text\nDo X.\n```")).toBe("Do X.");
  });

  it("strips wrapping quotes", () => {
    expect(sanitizeCompression('"Do X not Y."')).toBe("Do X not Y.");
    expect(sanitizeCompression("'Do X not Y.'")).toBe("Do X not Y.");
  });

  it("is a no-op for already-clean text", () => {
    const clean = "Build OAuth flow with Google, never store access tokens plaintext.";
    expect(sanitizeCompression(clean)).toBe(clean);
  });

  it("handles empty or whitespace-only input", () => {
    expect(sanitizeCompression("")).toBe("");
    expect(sanitizeCompression("   \n  ")).toBe("");
  });
});
