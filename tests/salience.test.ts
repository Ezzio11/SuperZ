import { describe, expect, it } from "vitest";
import { adaptiveKeepRatio, pruneBySalience } from "../src/engine/salience.js";
import { countTokens } from "../src/engine/tokenizer.js";

describe("salience pruning", () => {
  it("retains hard constraints and removes lower-signal clauses", () => {
    const prompt =
      "Build API service. Must return status 401 on invalid token. Never expose secrets in logs. " +
      "Please keep the code clean and readable and generally nice. " +
      "Timeout must be 5000ms.";
    const out = pruneBySalience(prompt, 0.65);
    expect(out.toLowerCase()).toContain("never expose secrets");
    expect(out.toLowerCase()).toContain("5000ms");
    expect(out.toLowerCase()).toContain("401");
  });

  it("does not expand text", () => {
    const prompt =
      "Create endpoint /v1/compress with JSON output. Must not drop numeric limits. " +
      "Please kindly ensure the response is concise and professional.";
    const out = pruneBySalience(prompt, 0.75);
    expect(countTokens(out)).toBeLessThanOrEqual(countTokens(prompt));
  });

  it("adaptiveKeepRatio decreases with longer prompts", () => {
    const short = "Small prompt.";
    const long = `${"Long content with many tokens. ".repeat(220)}`;
    expect(adaptiveKeepRatio(short)).toBeGreaterThan(adaptiveKeepRatio(long));
  });
});
