import * as Y from "yjs";
import { describe, expect, it } from "vitest";

/**
 * The guarantee CollabDoc is built on, checked directly against Yjs: peers that
 * edit independently (offline) converge to the same document once they swap
 * updates, and no one's edit is lost — no conflict dialog needed.
 */

/** Exchanges only what each side is missing, as the sync protocol does on reconnect. */
function sync(a: Y.Doc, b: Y.Doc) {
  const forB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const forA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, forB);
  Y.applyUpdate(a, forA);
}

function peer(from?: Y.Doc) {
  const doc = new Y.Doc();
  if (from) Y.applyUpdate(doc, Y.encodeStateAsUpdate(from));
  return doc;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

describe("offline edits merge without conflicts (Yjs CRDT)", () => {
  it("keeps both people's edits to the same sentence", () => {
    const asha = peer();
    asha.getText("body").insert(0, "We ship on Friday.");
    const marco = peer(asha);

    // Both go offline and edit the same sentence.
    asha.getText("body").insert("We ship ".length, "the editor ");
    const marcoText = marco.getText("body");
    marcoText.insert(marcoText.length - 1, ", after QA sign-off");

    sync(asha, marco);
    expect(asha.getText("body").toString()).toBe(
      "We ship the editor on Friday, after QA sign-off.",
    );
    expect(marco.getText("body").toString()).toBe(asha.getText("body").toString());
  });

  it("keeps an insertion made inside text someone else deleted around", () => {
    const a = peer();
    a.getText("body").insert(0, "alpha beta gamma");
    const b = peer(a);

    a.getText("body").delete(0, "alpha ".length); // a removes the first word
    b.getText("body").insert("alpha beta".length, " (kept)"); // b adds after "beta"

    sync(a, b);
    expect(a.getText("body").toString()).toBe("beta (kept) gamma");
    expect(b.getText("body").toString()).toBe("beta (kept) gamma");
  });

  it("is order-independent: updates applied in any order give the same document", () => {
    const base = peer();
    base.getText("body").insert(0, "start");
    const peers = [peer(base), peer(base), peer(base)];
    const updates: Uint8Array[] = [];
    peers.forEach((doc, i) => {
      doc.on("update", (update: Uint8Array) => updates.push(update));
      doc.getText("body").insert(0, `p${i} `);
    });

    const forward = peer(base);
    const backward = peer(base);
    updates.forEach((u) => Y.applyUpdate(forward, u));
    [...updates].reverse().forEach((u) => Y.applyUpdate(backward, u));
    expect(forward.getText("body").toString()).toBe(backward.getText("body").toString());
  });

  it("converges after many random concurrent edits across three peers", () => {
    const random = rng(7);
    const base = peer();
    base.getText("body").insert(0, "The quick brown fox jumps over the lazy dog.");
    const peers = [peer(base), peer(base), peer(base)];
    const inserted: string[] = [];

    for (let round = 0; round < 40; round += 1) {
      for (const [i, doc] of peers.entries()) {
        const text = doc.getText("body");
        if (random() < 0.7 || text.length === 0) {
          const token = `<${i}.${round}>`;
          inserted.push(token);
          text.insert(Math.floor(random() * (text.length + 1)), token);
        } else {
          const at = Math.floor(random() * text.length);
          text.delete(at, Math.min(2, text.length - at));
        }
      }
      // Peers reconnect at random moments, like flaky networks.
      if (random() < 0.3) sync(peers[0]!, peers[1]!);
      if (random() < 0.3) sync(peers[1]!, peers[2]!);
    }

    sync(peers[0]!, peers[1]!);
    sync(peers[1]!, peers[2]!);
    sync(peers[0]!, peers[1]!);

    const results = peers.map((doc) => doc.getText("body").toString());
    expect(new Set(results).size).toBe(1);
    expect(inserted.length).toBeGreaterThan(50);
  });
});
