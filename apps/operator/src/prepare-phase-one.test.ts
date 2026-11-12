// T-356 (SC-3, ADR-0031 §4): on the phase-one contracts the settlement prepare route refuses a payout to anyone but
// the buyer and the seller, before either party signs; on the full protocol (SimChain) it prepares it as before.
import { holdbackDomain, type AnyCommitment, type Hex32, type TokenAmount } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { prepare, PrepareError, type PrepareContext } from './prepare.js';

const id = `0x${'ab'.repeat(32)}` as Hex32;
const buyer = '0x00000000000000000000000000000000000000b1';
const seller = '0x00000000000000000000000000000000000000c1';
const third = '0x00000000000000000000000000000000000000d1';
const token = '0x00000000000000000000000000000000000000e1';
const amt = (amount: string) => ({ token, amount }) as TokenAmount;
const commitment = { id, buyer, seller, price: amt('2000000') } as unknown as AnyCommitment;

const ctx = (phaseOne: boolean): PrepareContext => ({
  ...(phaseOne ? { phaseOne: true } : {}),
  domain: holdbackDomain(31337, '0x00000000000000000000000000000000000000f1'),
  now: () => '2026-11-12T00:00:00Z',
  club: () => undefined,
  registration: async () => null,
  commitment: async (c) => (c === id ? commitment : undefined),
  delivery: async () => undefined,
  attempt: async () => 0,
  state: async () => null,
});

const input = (to: string) => ({ commitmentId: id, nonce: `0x${'01'.repeat(32)}`, releaseKey: false, payouts: [{ to: seller, amount: amt('1000000') }, { to, amount: amt('1000000') }] });

describe('prepare settlement on the phase-one contracts (SC-3)', () => {
  it('refuses a payout to a third address, naming the field and the reason', async () => {
    const r = await prepare('settlement', ctx(true), input(third)).catch((e: unknown) => e);
    expect(r).toBeInstanceOf(PrepareError);
    expect((r as PrepareError).problem).toMatchObject({ field: 'payouts.1.to', detail: expect.stringMatching(/neither the buyer nor the seller.*\(ADR-0031 §4\)/) });
  });

  // The commitment here is a stub that carries only what the payee check reads, so the two cases below stop later, at
  // the typed data; what they show is that the SC-3 refusal does not fire for them.
  it('does not refuse a split between the parties', async () => {
    const r = await prepare('settlement', ctx(true), input(buyer)).catch((e: unknown) => e);
    expect(String((r as Error).message ?? '')).not.toMatch(/neither the buyer nor the seller/);
  });

  it('does not refuse a third-party payout on the full protocol (SimChain keeps D23)', async () => {
    const r = await prepare('settlement', ctx(false), input(third)).catch((e: unknown) => e);
    expect(String((r as Error).message ?? '')).not.toMatch(/neither the buyer nor the seller/);
  });
});
