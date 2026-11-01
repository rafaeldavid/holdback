// The slice of Durable Object storage the public world uses (get, put of a batch, list by prefix), and an
// in-memory twin for tests. Values are structured-cloned, as Durable Object storage does.
export interface WorldStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Writes up to 128 keys at once (the Durable Object limit). */
  put(entries: Record<string, unknown>): Promise<void>;
  /** Every key with the prefix, in key order. */
  list<T = unknown>(options: { prefix: string }): Promise<Map<string, T>>;
}

export class MemoryStorage implements WorldStorage {
  private readonly data = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.has(key) ? (structuredClone(this.data.get(key)) as T) : undefined;
  }

  async put(entries: Record<string, unknown>): Promise<void> {
    if (Object.keys(entries).length > 128) throw new RangeError('put takes at most 128 keys');
    for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v));
  }

  async list<T = unknown>({ prefix }: { prefix: string }): Promise<Map<string, T>> {
    const keys = [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort();
    return new Map(keys.map((k) => [k, structuredClone(this.data.get(k)) as T]));
  }
}
