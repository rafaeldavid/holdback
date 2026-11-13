// T-356 (SC-5, ADR-0031 §6): on a chain settlement the offer prepare route refuses, before the seller signs, terms
// the phase-one contracts would refuse at funding: deadlines not in strict order, and a deal whose price and fee are
// both 0 (the escrow refuses to hold nothing). On the full protocol (SimChain) it prepares a deal that holds nothing,
// as before. Built from the spec's examples; the context is a stub with what the route reads.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPEAL_WINDOW_PROBLEM, parseClub, parseCommitment, rulebookHash, ZERO_HOLD_PROBLEM, type TokenAmount } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { prepare, PrepareError, type PrepareContext } from './prepare.js';

const examples = join(import.meta.dirname, '..', '..', '..', 'spec', 'examples');
const load = (f: string): unknown => JSON.parse(readFileSync(join(examples, f), 'utf8'));
const parsedCommitment = parseCommitment(load('commitment.example.json'));
const parsedClub = parseClub(load('club.example.json'));
if (!parsedCommitment.ok || !parsedClub.ok) throw new Error('the spec examples must parse');
const example = parsedCommitment.value as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const club = parsedClub.value;
const tusd = (amount: string) => ({ token: 'tUSD', amount }) as TokenAmount;

const ctx = (phaseOne: boolean, minFee = '50000000'): PrepareContext =>
  ({
    ...(phaseOne ? { phaseOne: true } : {}),
    domain: { name: 'Holdback', version: '0.8', chainId: 31337, verifyingContract: '0x00000000000000000000000000000000000000f1' },
    now: () => '2026-11-12T00:00:00Z',
    club: (id: string) => (id === club.id ? { ...club, rulebookHash: rulebookHash(club.rulebook) } : undefined),
    registration: async () => ({ policy: { id: 'bench-a/p1' }, policyHash: example['adjudication'].policyHash, registry: { hash: example['adjudication'].registryHash }, fee: { min: tusd(minFee) } }),
    commitment: async () => undefined,
    delivery: async () => undefined,
    attempt: async () => 0,
    state: async () => null,
  }) as unknown as PrepareContext;

const body = (over: Record<string, unknown> = {}) => ({
  disclosure: 'public',
  template: 'checks-only',
  seller: example['seller'],
  buyer: { address: example['buyer'], encryptionPublicKey: example['buyerEncryptionPublicKey'] },
  adjudicators: { primary: example['adjudication'].adjudicator, fallback: example['adjudication'].fallbackAdjudicator, appeal: example['adjudication'].appealAdjudicator },
  clubId: club.id,
  deliverable: { kind: 'dataset', description: 'x', format: 'text/csv' },
  checks: [example['acceptance'].deterministicChecks[1]],
  price: tusd('2000000000'),
  fee: tusd('50000000'),
  nonce: `0x${'01'.repeat(32)}`,
  createdAt: '2026-11-12T00:00:00Z',
  ...over,
});
const outcome = (phaseOne: boolean, b: Record<string, unknown>, minFee?: string) =>
  prepare('offer', ctx(phaseOne, minFee), b).then(
    () => null,
    (e: unknown) => (e as PrepareError).problem,
  );

describe('prepare offer on the phase-one contracts (SC-5)', () => {
  it('prepares the default windows', async () => {
    expect(await outcome(true, body())).toBeNull();
  });

  it.each([
    ['offerExpiresAt equal to fundBy', { offerExpiresInSec: 900, fundWithinSec: 900 }, /offerExpiresAt < fundBy violated/],
    ['deliverBy before fundBy', { fundWithinSec: 1800, deliverWithinSec: 600 }, /fundBy < deliverBy violated/],
  ])('refuses deadlines out of order before the seller signs: %s', async (_name, timing, detail) => {
    expect(await outcome(true, body({ timing }))).toMatchObject({ type: 'invalid_terms', field: 'timing', detail: expect.stringMatching(detail) });
  });

  it('refuses price and fee both 0, naming the reason; prepares it on the full protocol', async () => {
    const nothing = body({ price: tusd('0'), fee: tusd('0') });
    expect(await outcome(true, nothing)).toMatchObject({ type: 'invalid_terms', field: 'price', detail: ZERO_HOLD_PROBLEM });
    expect(await outcome(false, nothing)).toBeNull();
  });

  it("refuses a zero price when the fee is left out and the primary's minimum fee is 0", async () => {
    expect(await outcome(true, body({ price: tusd('0'), fee: undefined }), '0')).toMatchObject({ detail: ZERO_HOLD_PROBLEM });
  });

  it('prepares a zero price with a fee above 0 (Rafa, 2026-11-11)', async () => {
    expect(await outcome(true, body({ price: tusd('0') }))).toBeNull();
  });

  it('refuses the hash-only offer that holds nothing too (it is built through the same route)', async () => {
    const hashOnly = body({ hashOnly: true, disclosure: 'private', template: undefined, deliverable: undefined, checks: undefined, deliverableHash: `0x${'11'.repeat(32)}`, acceptanceHash: `0x${'22'.repeat(32)}`, price: tusd('0'), fee: tusd('0') });
    expect(await outcome(true, hashOnly)).toMatchObject({ detail: ZERO_HOLD_PROBLEM });
  });

  // T-358 (ADR-0033 §2b): a phase-one deal states an appeal window of 0, the default. The route refuses any other
  // value with core's reason, before the seller signs; an operator on the full protocol takes the window named.
  it('fills an appeal window of 0 and refuses any other with APPEAL_WINDOW_PROBLEM', async () => {
    const prepared = await prepare('offer', ctx(true), body());
    expect((prepared.submit.body as { timing: { appealWindowSec: number } }).timing.appealWindowSec).toBe(0);
    for (const appealWindowSec of [1, 300]) {
      expect(await outcome(true, body({ timing: { appealWindowSec } }))).toMatchObject({ type: 'invalid_terms', field: 'timing.appealWindowSec', detail: APPEAL_WINDOW_PROBLEM });
    }
    expect(await outcome(true, body({ timing: { appealWindowSec: 0 } }))).toBeNull();
    const full = await prepare('offer', ctx(false), body({ timing: { appealWindowSec: 300 } }));
    expect((full.submit.body as { timing: { appealWindowSec: number } }).timing.appealWindowSec).toBe(300);
  });

  it('carries both money addresses, each equal to its signing address by default (ADR-0033 §7)', async () => {
    const t = (await prepare('offer', ctx(true), body())).submit.body as { buyer: string; seller: string; buyerPaymentAddress: string; sellerPayoutAddress: string };
    expect(t.buyerPaymentAddress).toBe(t.buyer);
    expect(t.sellerPayoutAddress).toBe(t.seller);
  });
});
