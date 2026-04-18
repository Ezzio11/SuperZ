import { describe, expect, it } from "vitest";
import { ruleBasedCompress } from "../src/engine/rules.js";

describe("ruleBasedCompress", () => {
  it("removes filler words", () => {
    const out = ruleBasedCompress(
      "Could you please kindly write a function that just basically sorts things.",
    );
    expect(out.toLowerCase()).not.toContain("please");
    expect(out.toLowerCase()).not.toContain("kindly");
    expect(out.toLowerCase()).not.toContain("just basically");
  });

  it("collapses phrases like 'in order to'", () => {
    const out = ruleBasedCompress("We use this in order to sort the list.");
    expect(out).toContain("to sort");
  });

  it("is idempotent on already compressed text", () => {
    const input = "fn: sort str[] -> asc";
    expect(ruleBasedCompress(input)).toBe(input);
  });
});
