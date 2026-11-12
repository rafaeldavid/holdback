// T-378 (the plan's 2b, "the partner-facing local tools run phase-one rules"): `pnpm sim`, which the seller adapter's
// --sim connects to, runs SimChain on core's phase-one profile. A non-zero appeal window is refused there with the chain's
// own problem (core's APPEAL_WINDOW_PROBLEM, which the contract enforces as InvalidMessage), at prepare and at a direct
// submission of signed terms. The full protocol, the default for every other world, still takes it.
import { readFileSync } from 'node:fs';
import { APPEAL_WINDOW_PROBLEM, ZERO_HOLD_PROBLEM } from '@holdback/core';
import { privateKeyToAccount } from 'viem/accounts';
import { hashTypedData } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prepared } from './prepare.js';
import { startSimWorld, type SimWorld } from './sim-world.js';

let phaseOne: SimWorld;
let full: SimWorld;
beforeAll(async () => {
  [phaseOne, full] = await Promise.all([
    startSimWorld({ accounts: ['buyer-1', 'seller-1'], env: {}, onError: () => {}, profile: 'phase_one' }),
    startSimWorld({ accounts: ['buyer-1', 'seller-1'], env: {}, onError: () => {} }),
  ]);
});
afterAll(async () => {
  await phaseOne.close();
  await full.close();
});

const post = async (w: SimWorld, path: string, body: unknown) => {
  const r = await fetch(`${w.info.operators[0]}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const offerInput = (w: SimWorld, timing: Record<string, number>) => {
  const acct = (l: string) => w.info.accounts.find((a) => a.label === l)!;
  const [p, f, a] = w.info.adjudicators;
  return {
    nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`,
    disclosure: 'public',
    template: 'checks-only',
    clubId: w.info.clubId,
    seller: acct('seller-1').address,
    buyer: { address: acct('buyer-1').address, encryptionPublicKey: acct('buyer-1').encryptionPublicKey },
    adjudicators: { primary: p!.address, fallback: f!.address, appeal: a!.address },
    price: { token: 'tUSD', amount: '25000000' },
    deliverable: { kind: 'dataset', description: 'x', format: 'text/csv' },
    checks: [{ id: 'rows', type: 'row_count_range', required: true, min: 1, max: 9 }],
    timing,
  };
};
function ints(types: Record<string, Array<{ name: string; type: string }>>, type: string, v: unknown): unknown {
  if (type.endsWith('[]')) return (v as unknown[]).map((x) => ints(types, type.slice(0, -2), x));
  if (types[type]) return Object.fromEntries(types[type]!.map((f) => [f.name, ints(types, f.type, (v as Record<string, unknown>)[f.name])]));
  return /^u?int\d*$/.test(type) ? BigInt(v as string) : v;
}
/** Signed terms with an appeal window of 300 s, prepared on the full world, whose SimChain has the same domain and club. */
async function signedWithWindow(w: SimWorld): Promise<Record<string, unknown>> {
  const p = (await post(w, '/v1/prepare/offer', offerInput(w, { appealWindowSec: 300 }))).body as Prepared;
  const s = p.sign[0]!;
  const account = privateKeyToAccount(w.info.accounts.find((a) => a.label === 'seller-1')!.privateKey);
  const typed = { ...s.typedData, message: ints(s.typedData.types, s.typedData.primaryType, s.typedData.message) } as Parameters<typeof hashTypedData>[0];
  const body = p.submit.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  body['signatures'] = { seller: await account.signTypedData(typed as Parameters<typeof account.signTypedData>[0]) };
  return body;
}

describe('pnpm sim runs the phase-one rules (T-378)', () => {
  it('pnpm sim opens its world on the phase-one profile', () => {
    const bin = readFileSync(new URL('./sim-bin.ts', import.meta.url), 'utf8');
    expect(bin).toMatch(/startSimWorld\(\{[^}]*profile: 'phase_one'/);
  });

  it('the offer prepare route refuses a non-zero appeal window with the chain\'s problem; the full protocol prepares it', async () => {
    const r = await post(phaseOne, '/v1/prepare/offer', offerInput(phaseOne, { appealWindowSec: 300 }));
    expect(r).toMatchObject({ status: 400, body: { type: 'invalid_terms', field: 'timing.appealWindowSec', detail: APPEAL_WINDOW_PROBLEM } });
    expect((await post(full, '/v1/prepare/offer', offerInput(full, { appealWindowSec: 300 }))).status).toBe(200);
  });

  it('SimChain itself refuses signed terms with a non-zero appeal window sent straight to POST /v1/commitments', async () => {
    const body = await signedWithWindow(full);
    const r = await post(phaseOne, '/v1/commitments', body);
    expect(r.body).toMatchObject({ type: 'invalid_terms', detail: APPEAL_WINDOW_PROBLEM });
    expect((await post(full, '/v1/commitments', body)).body.escrowState).toBe('Offered');
  });

  // AL-1's leftover (T-356): the zero-hold refusal at the route, over HTTP, before the seller signs.
  it('the offer prepare route refuses a deal that holds nothing (price and fee 0); the full protocol prepares it', async () => {
    const nothing = (w: SimWorld) => ({ ...offerInput(w, {}), price: { token: 'tUSD', amount: '0' }, fee: { token: 'tUSD', amount: '0' } });
    expect(await post(phaseOne, '/v1/prepare/offer', nothing(phaseOne))).toMatchObject({ status: 400, body: { type: 'invalid_terms', field: 'price', detail: ZERO_HOLD_PROBLEM } });
    expect((await post(full, '/v1/prepare/offer', nothing(full))).status).toBe(200);
  });

  // A party appeal is not in phase one: the route refuses it on this world, as on the chain.
  it('refuses a party appeal: the route answers that phase one has none', async () => {
    const r = await post(phaseOne, '/v1/prepare/appeal', { commitmentId: `0x${'ab'.repeat(32)}`, appellant: phaseOne.info.accounts[0]!.address });
    expect(r).toMatchObject({ status: 409, body: { type: 'invalid_state', detail: expect.stringMatching(/phase-one contracts, which have no party appeals/) } });
  });
});
