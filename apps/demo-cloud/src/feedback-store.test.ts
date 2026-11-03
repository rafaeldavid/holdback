// T-032: the demo's private report store in Workers KV. Reports and fingerprints expire after the retention period.
import type { Hex32 } from '@holdback/core';
import type { StoredReport } from '@holdback/operator';
import { describe, expect, it } from 'vitest';
import { KvFeedbackStore, type KvNamespace } from './feedback-store.js';

function fakeKv(): KvNamespace & { puts: Array<{ key: string; ttl?: number }> } {
  const data = new Map<string, string>();
  const puts: Array<{ key: string; ttl?: number }> = [];
  return {
    puts,
    get: async (key) => data.get(key) ?? null,
    put: async (key, value, options) => {
      data.set(key, value);
      puts.push({ key, ...(options?.expirationTtl ? { ttl: options.expirationTtl } : {}) });
    },
  };
}

const report = (id: string, fingerprint: Hex32, duplicateOf?: string): StoredReport => ({
  id,
  receivedAt: '2026-11-03T12:00:00Z',
  status: 'received',
  fingerprint,
  ...(duplicateOf ? { duplicateOf } : {}),
  report: { kind: 'docs', summary: 's', detail: 'd' },
  attached: { log: null, operatorId: 'demo-op-1', schemaVersion: '0.8', eventSeq: 0 },
  replies: [],
});

describe('KvFeedbackStore', () => {
  it('keeps a report and the first report of each fingerprint for 90 days', async () => {
    const kv = fakeKv();
    const store = new KvFeedbackStore(kv);
    const fp = `0x${'ab'.repeat(32)}` as Hex32;
    await store.add(report('r1', fp));
    await store.add(report('r2', fp, 'r1'));
    expect((await store.get('r1'))?.id).toBe('r1');
    expect(await store.get('nope')).toBeUndefined();
    expect(await store.firstWith(fp)).toBe('r1');
    expect(kv.puts).toEqual([
      { key: 'fb:r1', ttl: 7_776_000 },
      { key: `fp:${fp}`, ttl: 7_776_000 },
      { key: 'fb:r2', ttl: 7_776_000 },
    ]);
  });
});
