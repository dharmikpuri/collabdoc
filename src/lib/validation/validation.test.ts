import { describe, expect, it } from "vitest";

import { rewriteSchema, searchSchema, setTagsSchema } from "@/lib/validation/ai";
import { changePasswordSchema, resetPasswordSchema, signUpSchema } from "@/lib/validation/auth";
import { shareDocumentSchema } from "@/lib/validation/sharing";
import { createVersionSchema, MAX_VERSION_CONTENT_BYTES } from "@/lib/validation/version";

const firstIssue = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => result.error?.issues[0];

describe("sign-up", () => {
  const valid = { name: "Asha", email: "asha@example.com", password: "launch2026" };

  it("accepts a valid account", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["too short", "abc123"],
    ["no number", "onlyletters"],
    ["no letter", "1234567890"],
  ])("rejects a password with %s", (_, password) => {
    expect(signUpSchema.safeParse({ ...valid, password }).success).toBe(false);
  });

  it("rejects a blank name and a bad email", () => {
    expect(signUpSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, email: "asha@" }).success).toBe(false);
  });
});

describe("password reset and change", () => {
  const token = "a".repeat(43);

  it("requires a well-formed reset token and matching passwords", () => {
    expect(
      resetPasswordSchema.safeParse({ token, password: "newpass99", confirm: "newpass99" }).success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({ token: "short", password: "newpass99", confirm: "newpass99" })
        .success,
    ).toBe(false);
    const mismatch = resetPasswordSchema.safeParse({
      token,
      password: "newpass99",
      confirm: "other99x",
    });
    expect(firstIssue(mismatch)?.path).toEqual(["confirm"]);
  });

  it("refuses a new password equal to the current one", () => {
    const same = changePasswordSchema.safeParse({
      current: "launch2026",
      password: "launch2026",
      confirm: "launch2026",
    });
    expect(firstIssue(same)?.path).toEqual(["password"]);
  });
});

describe("sharing", () => {
  it("only grants Editor or Viewer — ownership can't be shared", () => {
    expect(shareDocumentSchema.safeParse({ email: "b@example.com", role: "EDITOR" }).success).toBe(
      true,
    );
    expect(shareDocumentSchema.safeParse({ email: "b@example.com", role: "OWNER" }).success).toBe(
      false,
    );
  });
});

describe("version snapshots", () => {
  const base = { label: "Before launch", content: { type: "doc", content: [] } };

  it("accepts a normal snapshot", () => {
    expect(createVersionSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an oversized document", () => {
    const content = { type: "doc", text: "x".repeat(MAX_VERSION_CONTENT_BYTES) };
    expect(createVersionSchema.safeParse({ ...base, content }).success).toBe(false);
  });

  it("only accepts opaque idempotency keys and real timestamps", () => {
    expect(
      createVersionSchema.safeParse({ ...base, clientMutationId: "8f14e45f-ceea" }).success,
    ).toBe(true);
    expect(createVersionSchema.safeParse({ ...base, clientMutationId: "a;drop" }).success).toBe(
      false,
    );
    expect(createVersionSchema.safeParse({ ...base, capturedAt: "yesterday" }).success).toBe(false);
  });
});

describe("AI inputs", () => {
  it("bounds the rewrite selection and mode", () => {
    expect(rewriteSchema.safeParse({ text: "Tighten this.", mode: "shorten" }).success).toBe(true);
    expect(rewriteSchema.safeParse({ text: "x".repeat(8_001), mode: "shorten" }).success).toBe(
      false,
    );
    expect(rewriteSchema.safeParse({ text: "Hi", mode: "translate" }).success).toBe(false);
  });

  it("trims search queries and refuses blank ones", () => {
    expect(searchSchema.parse({ query: "  launch plan  " }).query).toBe("launch plan");
    expect(searchSchema.safeParse({ query: "   " }).success).toBe(false);
  });

  it("caps the number of tags", () => {
    expect(
      setTagsSchema.safeParse({ tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }).success,
    ).toBe(false);
  });
});
