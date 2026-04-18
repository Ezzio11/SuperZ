import { describe, expect, it } from "vitest";
import { computeDelta, countTokens } from "../src/engine/tokenizer.js";

describe("tokenizer", () => {
  it("returns zero for empty strings", () => {
    expect(countTokens("")).toBe(0);
  });

  it("counts tokens for short strings", () => {
    expect(countTokens("Hello world")).toBeGreaterThan(0);
    expect(countTokens("Hello world")).toBeLessThan(5);
  });

  it("reports positive savings when compressed is shorter", () => {
    const original =
      "I would really appreciate it if you could please write a short Python function that adds two numbers together and returns the result.";
    const compressed = "fn: py add(a,b) -> a+b";
    const delta = computeDelta(original, compressed);
    expect(delta.savedTokens).toBeGreaterThan(0);
    expect(delta.percentSaved).toBeGreaterThan(0);
  });

  it("reports zero savings when strings are identical", () => {
    const delta = computeDelta("same text", "same text");
    expect(delta.savedTokens).toBe(0);
    expect(delta.percentSaved).toBe(0);
  });
});
