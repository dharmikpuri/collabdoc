import { describe, expect, it } from "vitest";

import { diffSequences, type DiffOp } from "@/lib/diff/myers";

const eq = (a: string, b: string) => a === b;
const chars = (value: string) => value.split("");

/** Rebuilds both inputs from the ops: the one property every diff must have. */
function replay<T>(ops: DiffOp<T>[]) {
  const before: T[] = [];
  const after: T[] = [];
  for (const op of ops) {
    if (op.type !== "insert") before.push(...op.items);
    if (op.type !== "delete") after.push(...op.items);
  }
  return { before, after };
}

/** Small deterministic PRNG so the randomised cases are reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

describe("diffSequences", () => {
  it("returns one equal run for identical input", () => {
    expect(diffSequences(chars("abc"), chars("abc"), eq)).toEqual([
      { type: "equal", items: ["a", "b", "c"] },
    ]);
  });

  it("reads a replacement as delete then insert", () => {
    expect(diffSequences(chars("abc"), chars("axc"), eq)).toEqual([
      { type: "equal", items: ["a"] },
      { type: "delete", items: ["b"] },
      { type: "insert", items: ["x"] },
      { type: "equal", items: ["c"] },
    ]);
  });

  it("handles empty inputs", () => {
    expect(diffSequences([], [], eq)).toEqual([]);
    expect(diffSequences([], chars("ab"), eq)).toEqual([{ type: "insert", items: ["a", "b"] }]);
    expect(diffSequences(chars("ab"), [], eq)).toEqual([{ type: "delete", items: ["a", "b"] }]);
  });

  it("finds a longest common subsequence", () => {
    const ops = diffSequences(chars("ABCBDAB"), chars("BDCABA"), eq)!;
    const common = ops.filter((op) => op.type === "equal").flatMap((op) => op.items);
    expect(common).toHaveLength(4); // LCS length of the classic CLRS example
  });

  it("returns null instead of building a table past the cap", () => {
    expect(diffSequences(chars("abcdef"), chars("uvwxyz"), eq, 10)).toBeNull();
  });

  it("trims a shared prefix and suffix before applying the cap", () => {
    const long = "x".repeat(5_000);
    const ops = diffSequences(chars(`${long}a${long}`), chars(`${long}b${long}`), eq, 10);
    expect(ops).not.toBeNull();
    expect(ops!.filter((op) => op.type !== "equal")).toEqual([
      { type: "delete", items: ["a"] },
      { type: "insert", items: ["b"] },
    ]);
  });

  it("always replays to the original inputs (randomised)", () => {
    const random = rng(42);
    const word = () =>
      Array.from({ length: Math.floor(random() * 30) }, () => "abcde"[Math.floor(random() * 5)]!);
    for (let i = 0; i < 300; i += 1) {
      const a = word();
      const b = word();
      const ops = diffSequences(a, b, eq)!;
      expect(replay(ops)).toEqual({ before: a, after: b });
    }
  });
});
