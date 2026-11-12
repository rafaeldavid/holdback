// T-356 (SC-5, ADR-0031 §6): on a chain settlement the offer prepare route refuses, before the seller signs, terms
// the phase-one contracts would refuse at funding: deadlines not in strict order, and a deal whose price and fee are
// both 0 (the escrow refuses to hold nothing). On the full protocol (SimChain) it prepares a deal that holds nothing,
// as before. Built from the spec's examples; the context is a stub with what the route reads.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseClub, parseCommitment, rulebookHash, ZERO_HOLD_PROBLEM, type TokenAmount } from '@holdback/core';
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
    domain: { name: 'Holdback', version: '0.7', chainId: 31337, verifyingContract: '0x00000000000000000000000000000000000000f1' },
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
});
