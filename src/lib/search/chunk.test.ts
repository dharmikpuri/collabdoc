import { describe, expect, it } from "vitest";

import { chunkText } from "@/lib/search/chunk";

const sentence = (i: number) =>
  `Paragraph ${i} talks about topic ${i} in enough words to take up some room on the page.`;

describe("chunkText", () => {
  it("returns nothing for empty text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("\n\n   \n")).toEqual([]);
  });

  it("keeps short text as one passage, joining paragraphs", () => {
    expect(chunkText("First line.\n\nSecond   line.")).toEqual(["First line.\nSecond line."]);
  });

  it("splits long text into bounded passages that carry an overlap", () => {
    const text = Array.from({ length: 80 }, (_, i) => sentence(i)).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(900 + 160);
    for (const chunk of chunks.slice(1)) expect(chunk.startsWith("…")).toBe(true);
  });

  it("loses no paragraph", () => {
    const paragraphs = Array.from({ length: 80 }, (_, i) => sentence(i));
    const joined = chunkText(paragraphs.join("\n")).join("\n");
    for (const paragraph of paragraphs) expect(joined).toContain(paragraph);
  });

  it("splits a single oversized paragraph on word boundaries", () => {
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`);
    const chunks = chunkText(words.join(" "));
    expect(chunks.length).toBeGreaterThan(1);
    const seen = new Set(chunks.join(" ").split(/[\s\n…]+/));
    for (const word of words) expect(seen.has(word)).toBe(true);
  });

  it("caps the number of passages per document", () => {
    const huge = Array.from({ length: 5_000 }, (_, i) => sentence(i)).join("\n");
    expect(chunkText(huge)).toHaveLength(200);
  });
});
