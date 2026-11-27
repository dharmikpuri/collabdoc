import { describe, expect, it } from "vitest";

import { can, ROLES, type Capability } from "@/lib/authz/roles";

const ALL: Capability[] = [
  "view",
  "edit",
  "createVersion",
  "restoreVersion",
  "manageSharing",
  "deleteDocument",
];

// The matrix every layer (API, collab server, RLS) defers to, spelled out in full.
const EXPECTED: Record<(typeof ROLES)[number], Capability[]> = {
  OWNER: ALL,
  EDITOR: ["view", "edit", "createVersion", "restoreVersion"],
  VIEWER: ["view"],
};

describe("can", () => {
  for (const role of ROLES) {
    for (const capability of ALL) {
      const allowed = EXPECTED[role].includes(capability);
      it(`${role} ${allowed ? "can" : "cannot"} ${capability}`, () => {
        expect(can(role, capability)).toBe(allowed);
      });
    }
  }

  it("only the owner can share or delete", () => {
    const owners = ROLES.filter(
      (role) => can(role, "manageSharing") || can(role, "deleteDocument"),
    );
    expect(owners).toEqual(["OWNER"]);
  });
});
