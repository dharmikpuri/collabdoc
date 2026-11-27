import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/lib/security/redirect";

describe("safeRedirectPath", () => {
  it("keeps same-site paths and their query", () => {
    expect(safeRedirectPath("/documents/abc?thread=t1")).toBe("/documents/abc?thread=t1");
    expect(safeRedirectPath("/search?q=launch")).toBe("/search?q=launch");
  });

  it("falls back for values that aren't usable strings", () => {
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
    expect(safeRedirectPath(42)).toBe("/dashboard");
    expect(safeRedirectPath("")).toBe("/dashboard");
    expect(safeRedirectPath(`/${"a".repeat(3_000)}`)).toBe("/dashboard");
    expect(safeRedirectPath(null, "/settings")).toBe("/settings");
  });

  it("never bounces back into the auth pages", () => {
    expect(safeRedirectPath("/sign-in")).toBe("/dashboard");
    expect(safeRedirectPath("/sign-up?next=/x")).toBe("/dashboard");
  });

  it("drops the origin of absolute URLs", () => {
    expect(safeRedirectPath("https://evil.example/steal?x=1")).toBe("/steal?x=1");
  });

  // Whatever comes in, the result must resolve to our own origin.
  const hostile = [
    "https://evil.example",
    "//evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2F%2Fevil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "  //evil.example",
    "http:evil.example",
    // Inputs whose *path* starts with "//", which a browser would read as another host.
    "https://collabdoc.app//evil.example",
    "/..//evil.example",
  ];
  for (const value of hostile) {
    it(`stays on this site for ${JSON.stringify(value)}`, () => {
      const path = safeRedirectPath(value);
      expect(path.startsWith("/")).toBe(true);
      expect(path.startsWith("//")).toBe(false);
      expect(path.includes("\\")).toBe(false);
      expect(new URL(path, "https://collabdoc.app").origin).toBe("https://collabdoc.app");
    });
  }
});
