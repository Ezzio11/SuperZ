import { describe, expect, it } from "vitest";
import { deepMerge, mergeJsonText } from "../src/util/json-merge.js";

describe("deepMerge", () => {
  it("merges nested objects without losing sibling keys", () => {
    const a = { mcpServers: { existing: { command: "x" } } };
    const b = { mcpServers: { added: { command: "y" } } };
    const merged = deepMerge(a, b);
    expect(merged.mcpServers.existing).toEqual({ command: "x" });
    expect(merged.mcpServers.added).toEqual({ command: "y" });
  });

  it("replaces arrays rather than concatenating", () => {
    const a = { items: [1, 2] };
    const b = { items: [3] };
    expect(deepMerge(a, b)).toEqual({ items: [3] });
  });

  it("ignores undefined source values", () => {
    const a = { keep: "yes" };
    const b = { keep: undefined } as unknown as typeof a;
    expect(deepMerge(a, b)).toEqual({ keep: "yes" });
  });
});

describe("mergeJsonText", () => {
  it("creates a fresh JSON file when the existing text is empty", () => {
    const out = mergeJsonText(null, { foo: 1 });
    expect(JSON.parse(out)).toEqual({ foo: 1 });
  });

  it("preserves unknown fields in the existing JSON", () => {
    const existing = JSON.stringify({ userField: "keep", mcpServers: { old: {} } });
    const out = mergeJsonText(existing, { mcpServers: { new: { command: "n" } } });
    const parsed = JSON.parse(out);
    expect(parsed.userField).toBe("keep");
    expect(parsed.mcpServers.old).toEqual({});
    expect(parsed.mcpServers.new).toEqual({ command: "n" });
  });

  it("recovers gracefully from malformed input", () => {
    const out = mergeJsonText("{ not valid json", { foo: 1 });
    expect(JSON.parse(out)).toEqual({ foo: 1 });
  });
});
