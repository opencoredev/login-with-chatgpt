/**
 * A minimal async key/value store. The server package persists login sessions
 * through this interface, so any backend (in-memory, Redis, Upstash, a
 * database, cookies) can back it by implementing three methods.
 */
export interface KeyValueStore<T> {
  get(key: string): Promise<T | undefined> | T | undefined;
  set(key: string, value: T, options?: { ttlMs?: number }): Promise<void> | void;
  delete(key: string): Promise<void> | void;
}

interface Entry<T> {
  value: T;
  expiresAt?: number;
}

/**
 * Process-local {@link KeyValueStore} with optional TTL. Great for development
 * and single-instance servers; use a shared store (Redis/Upstash/DB) in
 * production so sessions survive restarts and span instances.
 */
export class MemoryStore<T> implements KeyValueStore<T> {
  private readonly map = new Map<string, Entry<T>>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, options: { ttlMs?: number } = {}): void {
    this.map.set(key, {
      value,
      expiresAt: options.ttlMs !== undefined ? this.now() + options.ttlMs : undefined,
    });
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}
