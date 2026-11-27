import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientIp, rateLimit, rateLimitStore } from "@/lib/security/rate-limit";

// Buckets live for the life of the module, so every test uses its own key.
let n = 0;
const key = () => `test-${(n += 1)}`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("rateLimit (in-memory window)", () => {
  it("allows up to the limit, then refuses with a retry hint", async () => {
    const k = key();
    for (let i = 0; i < 3; i += 1) expect((await rateLimit(k, 3, 60_000)).ok).toBe(true);
    expect(await rateLimit(k, 3, 60_000)).toEqual({ ok: false, retryAfter: 60 });
  });

  it("counts down the retry hint and reopens when the window ends", async () => {
    const k = key();
    await rateLimit(k, 1, 10_000);
    vi.advanceTimersByTime(7_500);
    expect(await rateLimit(k, 1, 10_000)).toEqual({ ok: false, retryAfter: 3 });
    vi.advanceTimersByTime(2_500);
    expect((await rateLimit(k, 1, 10_000)).ok).toBe(true);
  });

  it("keeps separate keys apart", async () => {
    const a = key();
    const b = key();
    await rateLimit(a, 1, 60_000);
    expect((await rateLimit(a, 1, 60_000)).ok).toBe(false);
    expect((await rateLimit(b, 1, 60_000)).ok).toBe(true);
  });
});

describe("rateLimit (Redis configured)", () => {
  it("reports the Redis store when credentials are set", () => {
    expect(rateLimitStore()).toBe("memory");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    expect(rateLimitStore()).toBe("redis");
  });

  it("falls back to the local window when Redis is unreachable — it never fails open", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const k = key();
    expect((await rateLimit(k, 1, 60_000)).ok).toBe(true);
    expect((await rateLimit(k, 1, 60_000)).ok).toBe(false);
  });

  it("uses the shared Redis count when it answers", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example/");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify([{ result: 6 }, { result: 0 }, { result: 4_200 }])),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(await rateLimit(key(), 5, 60_000)).toEqual({ ok: false, retryAfter: 5 });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://redis.example/pipeline");
  });
});

describe("clientIp", () => {
  it("takes the first address from x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to x-real-ip, then a constant", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
