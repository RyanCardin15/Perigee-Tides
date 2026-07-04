/**
 * Minimal in-memory TTL cache used for NOAA metadata responses.
 * Station directories and per-station metadata change rarely, so caching
 * them avoids re-fetching multi-thousand-entry lists on every tool call.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_ENTRIES = 200;

export class TtlCache {
  private entries = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    // Evict the oldest entry when full (insertion order approximates LRU
    // well enough for this workload).
    if (this.entries.size >= MAX_ENTRIES && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Fetch-through helper: returns cached value or runs `loader` and caches it. */
  async getOrLoad<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    this.set(key, value, ttlMs);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Shared cache instance for the server process. */
export const cache = new TtlCache();
