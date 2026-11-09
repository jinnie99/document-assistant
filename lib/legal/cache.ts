type CacheOptions = {
  freshTtlMs: number;
  staleTtlMs: number;
  capacity: number;
  now?: () => number;
};

type Entry<V> = {
  value: V;
  freshUntil: number;
  staleUntil: number;
};

export class StaleCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();
  private readonly freshTtlMs: number;
  private readonly staleTtlMs: number;
  private readonly capacity: number;
  private readonly now: () => number;

  constructor(options: CacheOptions) {
    if (!Number.isFinite(options.freshTtlMs) || options.freshTtlMs < 0 || !Number.isFinite(options.staleTtlMs) || options.staleTtlMs < options.freshTtlMs || !Number.isInteger(options.capacity) || options.capacity < 1) throw new TypeError("INVALID_CACHE_OPTIONS");
    this.freshTtlMs = options.freshTtlMs;
    this.staleTtlMs = options.staleTtlMs;
    this.capacity = options.capacity;
    this.now = options.now ?? Date.now;
  }

  set(key: K, value: V): void {
    const createdAt = this.now();
    this.entries.delete(key);
    this.entries.set(key, { value, freshUntil: createdAt + this.freshTtlMs, staleUntil: createdAt + this.staleTtlMs });
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }

  getFresh(key: K): V | undefined {
    const entry = this.liveEntry(key);
    if (!entry || this.now() >= entry.freshUntil) return undefined;
    this.touch(key, entry);
    return entry.value;
  }

  getStale(key: K): V | undefined {
    const entry = this.liveEntry(key);
    const now = this.now();
    if (!entry || now < entry.freshUntil) return undefined;
    this.touch(key, entry);
    return entry.value;
  }

  private liveEntry(key: K): Entry<V> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() > entry.staleUntil) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private touch(key: K, entry: Entry<V>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}

