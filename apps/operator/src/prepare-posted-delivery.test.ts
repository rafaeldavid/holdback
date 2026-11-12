// T-357 review L5, triage item 84 (T-378): once a delivery is posted, the settlement prepare route names that delivery and
// refuses a `delivery` the caller sends, so no settlement can name another delivery than the one settlement holds.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCommitment, type AnyCommitment, type Hex32 } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { prepare, PrepareError, type PrepareContext } from './prepare.js';

const examples = join(import.meta.dirname, '..', '..', '..', 'spec', 'examples');
const parsed = parseCommitment(JSON.parse(readFileSync(join(examples, 'commitment.example.json'), 'utf8')));
if (!parsed.ok) throw new Error('the spec example must parse');
const c = parsed.value as unknown as AnyCommitment;
const delivery = JSON.parse(readFileSync(join(examples, 'delivery.example.json'), 'utf8')) as Record<string, unknown>;
const POSTED = `0x${'d1'.repeat(32)}` as Hex32;

const ctx = (posted: boolean): PrepareContext =>
  ({
    domain: { name: 'Holdback', version: '0.8', chainId: 31337, verifyingContract: '0x00000000000000000000000000000000000000f1' },
    now: () => '2026-11-12T00:00:00Z',
    club: () => undefined,
    registration: async () => null,
    commitment: async () => c,
    delivery: async () => (posted ? { deliveryHash: POSTED, attempt: 1 } : undefined),
    attempt: async () => 1,
    state: async () => null,
  }) as unknown as PrepareContext;
const input = (over: Record<string, unknown> = {}) => ({ commitmentId: c.id, nonce: `0x${'05'.repeat(32)}`, toSellerBps: 5000, ...over });

describe('prepare settlement after a delivery is posted', () => {
  it('names the posted delivery when the caller sends none', async () => {
    const p = await prepare('settlement', ctx(true), input());
    expect((p.submit.body as { deliveryHash: Hex32; releaseKey: boolean })).toMatchObject({ deliveryHash: POSTED, releaseKey: true });
  });

  it('refuses a delivery the caller sends, naming the posted one', async () => {
    const r = await prepare('settlement', ctx(true), input({ delivery: { ...delivery, commitmentId: c.id } })).then(
      () => null,
      (e: unknown) => (e as PrepareError).problem,
    );
    expect(r).toMatchObject({ type: 'invalid_terms', field: 'delivery', detail: expect.stringContaining(POSTED) });
  });
});
