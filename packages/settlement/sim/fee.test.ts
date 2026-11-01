// The operator fee on SimChain (ADR-0023): a buyer-signed TransferAuthorization in the agree-and-fund
// submission moves to the operator's address in the same step, outside the hold, and is never refunded.
import { parseEvent, type Address, type ProblemType } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import type { Submission, SubmitResult } from '../src/interface.js';
import { Deal, simActor, simCast, simClub, simGenesis } from './actors.js';
import { SimChain } from './simchain.js';

const START = '2026-11-01T09:00:00Z';
const PRICE = 2_000_000_000n;
const HOLD = PRICE + 50_000_000n;
const OP = simActor('op-fees', 'operator').address;

async function world() {
  const cast = simCast();
  const club = simClub(simActor('club-operator').address);
  const genesis = await simGenesis({ cast, club, start: START, balances: { buyer: 10_000_000_000n, seller: 1_000_000_000n }, bonds: { primary: 25_000_000_000n, fallback: 25_000_000_000n, appeal: 25_000_000_000n } });
  const chain = new SimChain(genesis);
  const deal = new Deal(chain, cast, { club });
  const bal = async (a: Address) => BigInt((await chain.balances([a]))[a]!.amount);
  const submit = async (s: Submission | Promise<Submission>, key?: string): Promise<SubmitResult> => chain.submit(await s, key ? { idempotencyKey: key, via: 'op-1' } : { via: 'op-1' });
  const ok = async (s: Submission | Promise<Submission>, key?: string) => {
    const r = await submit(s, key);
    if (!r.ok) throw new Error(`refused: ${r.problem.type}: ${r.problem.detail}`);
    return r;
  };
  const refused = async (s: Submission | Promise<Submission>): Promise<ProblemType> => {
    const r = await submit(s);
    if (r.ok) throw new Error(`expected a refusal, got ${r.state.escrowState}`);
    return r.problem.type;
  };
  await ok(deal.offer());
  await ok(deal.accept());
  return { chain, cast, deal, bal, ok, refused, submit };
}

describe('operator fee on SimChain (ADR-0023)', () => {
  it('moves the fee to the operator with the hold, posts fee.operator, and keeps it out of escrow', async () => {
    const w = await world();
    const before = await w.bal(w.cast.buyer.address);
    const r = await w.ok(w.deal.agreeAndFund({ operatorFee: { to: OP, value: 200_000n } }));
    expect(r.state.escrowState).toBe('Held');
    expect(r.state.hold?.amount.amount).toBe(HOLD.toString());
    expect(r.events.map((e) => e.type)).toEqual(['commitment.agreed', 'hold.funded', 'fee.operator']);
    const fee = r.events.at(-1)!;
    expect(parseEvent(fee).ok).toBe(true);
    expect(fee.payload).toMatchObject({ from: w.cast.buyer.address.toLowerCase(), to: OP.toLowerCase(), amount: { token: 'tUSD', amount: '200000' } });
    expect(await w.bal(OP)).toBe(200_000n);
    expect(await w.bal(w.cast.buyer.address)).toBe(before - HOLD - 200_000n);
  });

  it('applies all three or none: a fee the buyer cannot cover leaves the commitment unagreed', async () => {
    const w = await world();
    expect(await w.refused(w.deal.agreeAndFund({ operatorFee: { to: OP, value: 9_000_000_000n } }))).toBe('insufficient_funds');
    expect((await w.chain.state(w.deal.id))?.escrowState).toBe('AcceptedByAdjudicator');
    expect(await w.bal(OP)).toBe(0n);
  });

  it('refuses a fee signed by someone else, for another commitment, or in another token', async () => {
    const w = await world();
    expect(await w.refused(w.deal.agreeAndFund({ operatorFee: { to: OP, value: 1n, signer: simActor('mallory') } }))).toBe('invalid_signature');
    expect(await w.refused(w.deal.agreeAndFund({ operatorFee: { to: OP, value: 1n, commitmentId: `0x${'ab'.repeat(32)}` } }))).toBe('invalid_terms');
    expect(await w.refused(w.deal.agreeAndFund({ operatorFee: { to: OP, value: 1n, token: 'tEUR' } }))).toBe('invalid_terms');
    expect((await w.chain.state(w.deal.id))?.escrowState).toBe('AcceptedByAdjudicator');
  });

  it('charges once: the same key replays, and the same signed body under a new key is refused', async () => {
    const w = await world();
    const s = await w.deal.agreeAndFund({ operatorFee: { to: OP, value: 200_000n } });
    await w.ok(s, 'k1');
    expect((await w.ok(s, 'k1')).replayed).toBe(true);
    expect((await w.submit(s, 'k2')).ok).toBe(false);
    expect(await w.bal(OP)).toBe(200_000n);
  });

  it('fee.kept-on-refund: a refund returns price and adjudication fee, never the operator fee', async () => {
    const w = await world();
    const before = await w.bal(w.cast.buyer.address);
    await w.ok(w.deal.agreeAndFund({ operatorFee: { to: OP, value: 200_000n } }));
    w.chain.advance((Date.parse(w.deal.terms.timing.deliverBy) - Date.parse(w.chain.now())) / 1000 + 1);
    const r = await w.chain.trigger(w.deal.id, 'reclaim');
    expect(r.ok && r.state.escrowState).toBe('Refunded');
    expect(await w.bal(w.cast.buyer.address)).toBe(before - 200_000n);
    expect(await w.bal(OP)).toBe(200_000n);
  });

  it('without a fee, agree-and-fund is unchanged (direct submission is free)', async () => {
    const w = await world();
    const r = await w.ok(w.deal.agreeAndFund());
    expect(r.events.map((e) => e.type)).toEqual(['commitment.agreed', 'hold.funded']);
  });
});
