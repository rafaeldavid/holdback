// Hard rule "idempotency" (docs/api.md): the same Idempotency-Key with the same body replays the stored response;
// with a different body it is 409 idempotency_conflict. A refusal is not stored, so a corrected call can retry.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IdempotencyStore, fingerprint, type StoredResponse } from './idempotency.js';

const okResponse = (n: number): StoredResponse => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n }) });

describe('IdempotencyStore', () => {
  it('replays the stored response for the same key and body, without running the handler again', async () => {
    const store = new IdempotencyStore();
    let runs = 0;
    const fp = fingerprint('POST', '/v1/x', { a: 1 });
    const first = await store.run('k', fp, async () => okResponse(++runs));
    const second = await store.run('k', fp, async () => okResponse(++runs));
    expect(first).toEqual({ kind: 'fresh', response: okResponse(1) });
    expect(second).toEqual({ kind: 'replay', response: okResponse(1) });
    expect(runs).toBe(1);
  });

  it('returns a conflict for the same key with another body', async () => {
    const store = new IdempotencyStore();
    await store.run('k', fingerprint('POST', '/v1/x', { a: 1 }), async () => okResponse(1));
    expect((await store.run('k', fingerprint('POST', '/v1/x', { a: 2 }), async () => okResponse(2))).kind).toBe('conflict');
    expect((await store.run('k', fingerprint('POST', '/v1/y', { a: 1 }), async () => okResponse(2))).kind).toBe('conflict');
  });

  it('does not store a refusal, so the same key can be retried', async () => {
    const store = new IdempotencyStore();
    const fp = fingerprint('POST', '/v1/x', {});
    await store.run('k', fp, async () => ({ status: 409, headers: {}, body: '{}' }));
    expect(await store.run('k', fingerprint('POST', '/v1/x', { fixed: true }), async () => okResponse(7))).toEqual({ kind: 'fresh', response: okResponse(7) });
  });

  it('fingerprints the body canonically: key order does not matter', () => {
    expect(fingerprint('POST', '/p', { a: 1, b: 2 })).toBe(fingerprint('POST', '/p', { b: 2, a: 1 }));
    expect(fingerprint('POST', '/p', { a: 1 })).not.toBe(fingerprint('POST', '/q', { a: 1 }));
  });

  it('property: concurrent and sequential calls run each key once, replay same bodies, and refuse other bodies', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ key: fc.constantFrom('a', 'b', 'c'), body: fc.constantFrom(0, 1, 2), concurrent: fc.boolean() }), { minLength: 1, maxLength: 30 }),
        async (calls) => {
          const store = new IdempotencyStore();
          const runs = new Map<string, number>();
          const handler = (key: string, body: number) => async () => {
            runs.set(key, (runs.get(key) ?? 0) + 1);
            await new Promise((r) => setTimeout(r, 0));
            return okResponse(body);
          };
          const pending: Array<Promise<{ key: string; body: number; result: Awaited<ReturnType<IdempotencyStore['run']>> }>> = [];
          for (const c of calls) {
            const p = store.run(c.key, fingerprint('POST', '/v1/p', { body: c.body }), handler(c.key, c.body)).then((result) => ({ ...c, result }));
            if (c.concurrent) pending.push(p);
            else pending.push(Promise.resolve(await p));
          }
          const results = await Promise.all(pending);
          // The first call for each key (in arrival order) fixes its body.
          const firstBody = new Map<string, number>();
          for (const c of calls) if (!firstBody.has(c.key)) firstBody.set(c.key, c.body);
          for (const [key, n] of runs) expect([key, n]).toEqual([key, 1]);
          for (const r of results) {
            if (r.body === firstBody.get(r.key)) {
              expect(r.result.kind === 'conflict').toBe(false);
              expect(r.result.kind !== 'conflict' && r.result.response).toEqual(okResponse(r.body));
            } else expect(r.result.kind).toBe('conflict');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
