import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { yjsStateToText } from "@/lib/search/yjs-text";

function element(name: string, ...children: (Y.XmlElement | Y.XmlText)[]) {
  const node = new Y.XmlElement(name);
  node.insert(0, children);
  return node;
}
function textNode(value: string) {
  const node = new Y.XmlText();
  node.insert(0, value);
  return node;
}

/** Builds the CRDT state the TipTap Collaboration extension would store. */
function state(...blocks: Y.XmlElement[]) {
  const doc = new Y.Doc();
  doc.getXmlFragment("default").insert(0, blocks);
  return Y.encodeStateAsUpdate(doc);
}

describe("yjsStateToText", () => {
  it("reads paragraphs and headings as lines", () => {
    const update = state(
      element("heading", textNode("Launch plan")),
      element("paragraph", textNode("We ship on Friday.")),
    );
    expect(yjsStateToText(update)).toBe("Launch plan\nWe ship on Friday.");
  });

  it("reads list items and table cells", () => {
    const update = state(
      element("bulletList", element("listItem", element("paragraph", textNode("Alpha")))),
      element(
        "table",
        element(
          "tableRow",
          element("tableCell", element("paragraph", textNode("A1"))),
          element("tableCell", element("paragraph", textNode("B1"))),
        ),
      ),
    );
    const text = yjsStateToText(update);
    expect(text).toContain("Alpha");
    expect(text).toMatch(/A1[\s|]+B1/);
  });

  it("returns an empty string for an empty document", () => {
    expect(yjsStateToText(Y.encodeStateAsUpdate(new Y.Doc()))).toBe("");
  });
});
