// Idempotency-Key middleware (docs/api.md, Conventions). A key binds to the first request that succeeded with it:
// the same request again replays the stored response, another request is a conflict. Refusals are not stored,
// so a corrected call can reuse its key (as SimChain does; backlog). Concurrent requests with one key
// run one after another, so the handler never runs twice for a key it has already succeeded with.
import { canonicalKeccak, type Hex32 } from '@holdback/core';

export interface StoredResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type IdempotencyOutcome = { kind: 'fresh'; response: StoredResponse } | { kind: 'replay'; response: StoredResponse } | { kind: 'conflict' };

/** The request a key binds to: method, path without the query, and the body in RFC 8785 canonical form. */
export const fingerprint = (method: string, path: string, body: unknown): Hex32 => canonicalKeccak({ method, path, body: body ?? null });

export class IdempotencyStore {
  private readonly done = new Map<string, { fingerprint: Hex32; response: StoredResponse }>();
  private readonly locks = new Map<string, Promise<unknown>>();

  /** Whether a success is stored under `key`: a request with it may be a replay (T-422). */
  has(key: string): boolean {
    return this.done.has(key);
  }

  /** The stored response when `key` succeeded with this very request, before any limit is counted (T-422). */
  replay(key: string, fp: Hex32): StoredResponse | undefined {
    const seen = this.done.get(key);
    return seen && seen.fingerprint === fp ? seen.response : undefined;
  }

  async run(key: string, fp: Hex32, handler: () => Promise<StoredResponse>): Promise<IdempotencyOutcome> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.then(() => this.once(key, fp, handler));
    const settled = current.catch(() => undefined);
    this.locks.set(key, settled);
    void settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    });
    return current;
  }

  private async once(key: string, fp: Hex32, handler: () => Promise<StoredResponse>): Promise<IdempotencyOutcome> {
    const seen = this.done.get(key);
    if (seen) return seen.fingerprint === fp ? { kind: 'replay', response: seen.response } : { kind: 'conflict' };
    const response = await handler();
    if (response.status < 300) this.done.set(key, { fingerprint: fp, response });
    return { kind: 'fresh', response };
  }
}
