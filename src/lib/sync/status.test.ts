import { describe, expect, it } from "vitest";

import { deriveSyncState, describeSyncState, type SyncInputs } from "@/lib/sync/status";

const healthy: SyncInputs = {
  realtimeEnabled: true,
  online: true,
  wsStatus: "connected",
  synced: true,
  pendingUpdates: 0,
  queuedActions: 0,
};

describe("deriveSyncState", () => {
  it("is synced when everything is reconciled", () => {
    expect(deriveSyncState(healthy)).toBe("synced");
  });

  it("is local-only when real-time is not configured, whatever else is true", () => {
    expect(deriveSyncState({ ...healthy, realtimeEnabled: false })).toBe("local-only");
    expect(deriveSyncState({ ...healthy, realtimeEnabled: false, online: false })).toBe(
      "local-only",
    );
  });

  it("trusts the OS offline signal over the socket state", () => {
    expect(deriveSyncState({ ...healthy, online: false })).toBe("offline");
    expect(deriveSyncState({ ...healthy, online: false, wsStatus: "connecting" })).toBe("offline");
  });

  it("maps socket states", () => {
    expect(deriveSyncState({ ...healthy, wsStatus: "disconnected" })).toBe("offline");
    expect(deriveSyncState({ ...healthy, wsStatus: "connecting" })).toBe("connecting");
  });

  it("is syncing while anything is still in flight", () => {
    expect(deriveSyncState({ ...healthy, synced: false })).toBe("syncing");
    expect(deriveSyncState({ ...healthy, pendingUpdates: 3 })).toBe("syncing");
    expect(deriveSyncState({ ...healthy, queuedActions: 1 })).toBe("syncing");
  });
});

describe("describeSyncState", () => {
  it("has a label and explanation for every state", () => {
    for (const state of ["local-only", "offline", "connecting", "syncing", "synced"] as const) {
      const presentation = describeSyncState(state);
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(presentation.detail.length).toBeGreaterThan(0);
    }
  });

  it("reassures that offline edits are kept", () => {
    expect(describeSyncState("offline").detail).toMatch(/saved to this device/);
  });
});
