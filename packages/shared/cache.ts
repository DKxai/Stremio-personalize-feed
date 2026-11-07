/** Bounded, process-local TTL cache; one process and one instance for this MVP. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();

  constructor(private readonly maxEntries = 500, private readonly ttlMs = 300_000) {
    if (maxEntries < 1 || ttlMs < 1) throw new Error('Invalid cache bounds');
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}
