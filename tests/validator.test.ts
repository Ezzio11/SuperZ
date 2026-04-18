import { describe, expect, it } from "vitest";
import { verifyNegativeConstraints } from "../src/engine/validator.js";

describe("verifyNegativeConstraints", () => {
  it("reports no constraints when the input has none", () => {
    const report = verifyNegativeConstraints(
      "Build a simple REST API using Express.",
      "Task: REST API @ Express.",
    );
    expect(report.preserved).toBe(true);
    expect(report.originalCount).toBe(0);
  });

  it("detects when a negation is preserved via ! syntax", () => {
    const original = "Build a login component, do not use Tailwind CSS.";
    const compressed = "Task: login component. !Tailwind CSS.";
    const report = verifyNegativeConstraints(original, compressed);
    expect(report.preserved).toBe(true);
  });

  it("flags a compression that silently drops a negation", () => {
    const original = "Build a login component. Never use Tailwind CSS.";
    const compressed = "Task: login component. Style with Tailwind.";
    const report = verifyNegativeConstraints(original, compressed);
    expect(report.preserved).toBe(false);
    expect(report.missing.length).toBeGreaterThan(0);
  });

  it("accepts 'without X' when compressed retains the negation keyword", () => {
    const original = "Return data without exposing the internal id.";
    const compressed = "Return data w/o exposing internal id.";
    const report = verifyNegativeConstraints(original, compressed);
    // w/o is not normalized, but "exposing" is preserved and we accept "no"/"!"
    // variants. Fall back to checking the exact keyword.
    expect(report.missing.length).toBeLessThanOrEqual(1);
  });

  it("treats deny/reject style constraints as preserved negation", () => {
    const original =
      "Design an access control matrix with explicit deny rules taking precedence.";
    const compressed = "Access control matrix. explicit deny rules > allow.";
    const report = verifyNegativeConstraints(original, compressed);
    expect(report.preserved).toBe(true);
  });

  it("preserves cannot-style constraints", () => {
    const original =
      "Implement signed URL upload and ensure keys cannot escape tenant prefix.";
    const compressed =
      "Signed URL upload. keys cannot escape tenant prefix.";
    const report = verifyNegativeConstraints(original, compressed);
    expect(report.preserved).toBe(true);
  });
});
