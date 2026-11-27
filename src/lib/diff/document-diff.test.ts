import { describe, expect, it } from "vitest";

import { diffDocuments } from "@/lib/diff/document-diff";

const text = (value: string) => ({ type: "text", text: value });
const p = (value: string) => ({ type: "paragraph", content: value ? [text(value)] : [] });
const h = (level: number, value: string) => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const bullets = (...items: string[]) => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [p(item)] })),
});
const doc = (...content: object[]) => ({ type: "doc", content });

describe("diffDocuments", () => {
  it("reports nothing for identical documents", () => {
    const d = doc(h(1, "Plan"), p("Ship on Friday."));
    const result = diffDocuments(d, d);
    expect(result.rows.every((row) => row.kind === "same")).toBe(true);
    expect(result.stats).toEqual({ wordsAdded: 0, wordsRemoved: 0, blocksChanged: 0 });
    expect(result.approximate).toBe(false);
  });

  it("shows a one-word edit as one word, not a rewritten paragraph", () => {
    const result = diffDocuments(doc(p("The quick brown fox")), doc(p("The quick red fox")));
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.kind).toBe("changed");
    if (row.kind !== "changed") return;
    expect(row.segments).toEqual([
      { type: "equal", text: "The quick " },
      { type: "delete", text: "brown" },
      { type: "insert", text: "red" },
      { type: "equal", text: " fox" },
    ]);
    expect(result.stats).toEqual({ wordsAdded: 1, wordsRemoved: 1, blocksChanged: 1 });
  });

  it("aligns blocks, so an inserted paragraph doesn't mark the rest as changed", () => {
    const result = diffDocuments(
      doc(p("Intro."), p("Outro.")),
      doc(p("Intro."), p("A brand new middle paragraph."), p("Outro.")),
    );
    expect(result.rows.map((row) => row.kind)).toEqual(["same", "added", "same"]);
    expect(result.stats).toEqual({ wordsAdded: 5, wordsRemoved: 0, blocksChanged: 1 });
  });

  it("reports removed blocks", () => {
    const result = diffDocuments(doc(p("Keep."), p("Drop this.")), doc(p("Keep.")));
    expect(result.rows.map((row) => row.kind)).toEqual(["same", "removed"]);
    expect(result.stats.wordsRemoved).toBe(2);
  });

  it("ignores empty paragraphs (layout, not content)", () => {
    const result = diffDocuments(doc(p("A."), p(""), p("B.")), doc(p("A."), p("B.")));
    expect(result.stats.blocksChanged).toBe(0);
  });

  it("treats a heading level change as a change", () => {
    const result = diffDocuments(doc(h(1, "Plan")), doc(h(2, "Plan")));
    const row = result.rows[0]!;
    expect(row.kind).toBe("changed");
    if (row.kind !== "changed") return;
    expect([row.before.level, row.after.level]).toEqual([1, 2]);
  });

  it("flattens list items with their list context", () => {
    const result = diffDocuments(doc(), doc(bullets("one", "two")));
    expect(result.rows).toEqual([
      { kind: "added", block: { type: "list", text: "one", ordered: false, depth: 0 } },
      { kind: "added", block: { type: "list", text: "two", ordered: false, depth: 0 } },
    ]);
  });

  it("copes with junk input instead of throwing", () => {
    expect(() => diffDocuments(null, { content: "nope" })).not.toThrow();
  });
});
