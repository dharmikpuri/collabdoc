import { describe, expect, it } from "vitest";

import { firstHeading, parseMarkdown } from "@/lib/markdown/parse";
import { toMarkdown } from "@/lib/markdown/serialize";

const SAMPLE = `# Launch plan

We ship **on Friday**, after *QA* sign-off and ~~Thursday~~. See [the brief](https://example.com/brief) or \`npm run build\`.

- Write the notes
- Record the demo
  - with voice-over

1. Freeze
2. Ship

- [x] Tests green
- [ ] Changelog

> Quote with **bold**

\`\`\`ts
const answer = 42;
\`\`\`

---

| Owner | Task |
| --- | --- |
| Asha | Docs |
`;

describe("markdown import/export", () => {
  it("parses every block type the editor supports", () => {
    const types = (parseMarkdown(SAMPLE).content ?? []).map((node) => node.type);
    expect(types).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
      "horizontalRule",
      "table",
    ]);
  });

  it("round-trips: export then re-import gives the same document", () => {
    const parsed = parseMarkdown(SAMPLE);
    expect(parseMarkdown(toMarkdown(parsed))).toEqual(parsed);
  });

  it("keeps the text of links with unsafe schemes but drops the link", () => {
    const json = JSON.stringify(parseMarkdown("[click me](javascript:alert(1))"));
    expect(json).toContain("click me");
    expect(json).not.toContain("javascript:");
  });

  it("leaves snake_case words alone", () => {
    const paragraph = parseMarkdown("call some_function_name now").content![0]!;
    expect(paragraph.content).toEqual([{ type: "text", text: "call some_function_name now" }]);
  });

  it("escapes a paragraph that would otherwise become a heading", () => {
    const md = toMarkdown({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "# not a heading" }] }],
    });
    expect(parseMarkdown(md).content![0]!.type).toBe("paragraph");
  });

  it("always produces a valid document, even from empty input", () => {
    expect(parseMarkdown("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("finds the first heading for an import's title", () => {
    expect(firstHeading("intro\n## *Plan* B\n# Later")).toBe("Plan B");
    expect(firstHeading("no headings here")).toBeNull();
  });
});
