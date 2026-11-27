import { describe, expect, it } from "vitest";

import { normaliseTag, tagTint } from "@/lib/tags";

describe("normaliseTag", () => {
  it.each([
    ["  Machine Learning ", "machine-learning"],
    ["Café Déjà-vu", "cafe-deja-vu"],
    ["C++ / Rust!!", "c-rust"],
    ["--Q3  roadmap--", "q3-roadmap"],
    ["already-fine", "already-fine"],
    ["!!!", ""],
  ])("%j → %j", (input, expected) => {
    expect(normaliseTag(input)).toBe(expected);
  });

  it("caps tags at 24 characters", () => {
    expect(normaliseTag("a".repeat(40))).toHaveLength(24);
  });

  it("is idempotent", () => {
    for (const value of ["Launch Plan", "Ünïcödé tag", "x_y z"]) {
      const once = normaliseTag(value);
      expect(normaliseTag(once)).toBe(once);
    }
  });
});

describe("tagTint", () => {
  it("gives the same tag the same colour every time", () => {
    expect(tagTint("design")).toBe(tagTint("design"));
  });

  it("returns one of the defined tints", () => {
    for (const tag of ["a", "design", "q3-roadmap", "very-long-tag-name-here"]) {
      expect(tagTint(tag)).toMatch(/^bg-\w+-100 text-\w+-\d00 /);
    }
  });
});
