import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "../src/client/cache.js";

describe("TtlCache", () => {
  it("stores and retrieves within TTL", () => {
    const cache = new TtlCache();
    cache.set("k", 42, 1000);
    expect(cache.get<number>("k")).toBe(42);
  });

  it("expires entries after TTL", () => {
    vi.useFakeTimers();
    const cache = new TtlCache();
    cache.set("k", "v", 100);
    vi.advanceTimersByTime(150);
    expect(cache.get("k")).toBeUndefined();
    vi.useRealTimers();
  });

  it("getOrLoad only invokes the loader on a miss", async () => {
    const cache = new TtlCache();
    let calls = 0;
    const loader = async () => {
      calls++;
      return "value";
    };
    expect(await cache.getOrLoad("k", 1000, loader)).toBe("value");
    expect(await cache.getOrLoad("k", 1000, loader)).toBe("value");
    expect(calls).toBe(1);
  });
});
