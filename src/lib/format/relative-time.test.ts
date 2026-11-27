import { describe, expect, it } from "vitest";

import { formatRelative } from "@/lib/format/relative-time";

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW - ms);

describe("formatRelative", () => {
  it.each([
    [ago(10_000), "just now"],
    [ago(5 * MIN), "5 minutes ago"],
    [ago(2 * 60 * MIN), "2 hours ago"],
    [ago(24 * 60 * MIN), "yesterday"],
    [ago(14 * 24 * 60 * MIN), "2 weeks ago"],
    [new Date(NOW + 3 * 60 * MIN), "in 3 hours"],
  ])("%s → %s", (date, expected) => {
    expect(formatRelative(date, NOW)).toBe(expected);
  });

  it("accepts ISO strings", () => {
    expect(formatRelative(ago(5 * MIN).toISOString(), NOW)).toBe("5 minutes ago");
  });

  it("treats an invalid date as just now rather than throwing", () => {
    expect(formatRelative("not a date", NOW)).toBe("just now");
  });
});
