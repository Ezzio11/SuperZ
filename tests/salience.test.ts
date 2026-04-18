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

  it("force-keeps answer clause when query word is a morphological variant", () => {
    const prompt =
      "Use the description below verbatim.\n" +
      "--- DOC START ---\n" +
      "Kafka topics are partitioned by tenant_id to preserve per-tenant ordering.\n" +
      "The service exposes a public health endpoint that returns OK.\n" +
      "The weather has been unpredictable this week.\n" +
      "Lunch orders should be submitted by 11 AM.\n" +
      "Remember to mark your calendars for the quarterly all-hands.\n" +
      "--- DOC END ---\n" +
      "Question: Which field is used as the Kafka partition key?";
    const out = pruneBySalience(prompt, 0.5, "large");
    expect(out).toContain("tenant_id");
  });

  it("force-keeps schema identifier clauses when query asks for a named thing", () => {
    const prompt =
      "Use the context below.\n" +
      "--- CTX ---\n" +
      "Each row is written to Postgres with column event_id as the idempotency marker.\n" +
      "Everyone loves Friday donuts.\n" +
      "--- END ---\n" +
      "Question: Which column identifies duplicate events?";
    const out = pruneBySalience(prompt, 0.5, "large");
    expect(out).toContain("event_id");
  });
});
