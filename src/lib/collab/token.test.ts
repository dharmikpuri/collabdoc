import { jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { signCollabToken } from "@/lib/collab/token";

const SECRET = "unit-test-secret-at-least-32-characters";
const key = (value: string) => new TextEncoder().encode(value);

afterEach(() => vi.unstubAllEnvs());

describe("signCollabToken", () => {
  it("signs a short-lived token bound to one user, document and role", async () => {
    vi.stubEnv("COLLAB_TOKEN_SECRET", SECRET);
    const token = await signCollabToken({ userId: "user-1", documentId: "doc-9", role: "EDITOR" });

    const { payload, protectedHeader } = await jwtVerify(token, key(SECRET));
    expect(protectedHeader.alg).toBe("HS256");
    expect(payload.sub).toBe("user-1");
    expect(payload.documentId).toBe("doc-9");
    expect(payload.role).toBe("EDITOR");
    expect(payload.exp! - payload.iat!).toBe(60);
  });

  it("is rejected by a server holding a different secret", async () => {
    vi.stubEnv("COLLAB_TOKEN_SECRET", SECRET);
    const token = await signCollabToken({ userId: "u", documentId: "d", role: "VIEWER" });
    await expect(jwtVerify(token, key("some-other-secret-of-sufficient-size"))).rejects.toThrow();
  });

  it("refuses to sign without a secret", async () => {
    vi.stubEnv("COLLAB_TOKEN_SECRET", "");
    await expect(signCollabToken({ userId: "u", documentId: "d", role: "OWNER" })).rejects.toThrow(
      "COLLAB_TOKEN_SECRET is not set",
    );
  });
});
