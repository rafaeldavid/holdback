// SimChain models CPP's authorizationExpiry (ADR-0003, T-205; backlog row from T-006): after
// fallbackBy + appealDecideSec + margin, nothing can capture, so a payment to the seller (an early accept, or a
// mutual settlement that pays anyone but the buyer) is refused; a settlement that returns everything still works.
import { describe, expect, it } from 'vitest';
import { authorizationExpiry, DEFAULT_EXPIRY_MARGIN_SEC } from './simchain.js';
import { Deal, simActor, simCast, simClub, simGenesis, SIM_RULEBOOK } from './actors.js';
import { SimChain } from './simchain.js';

const START = '2026-11-01T09:00:00Z';

async function delivered(margin?: number) {
  const cast = simCast('expiry');
  const club = simClub(simActor('club-operator', 'expiry').address, SIM_RULEBOOK);
  const genesis = await simGenesis({ cast, club, start: START, balances: { buyer: 10_000_000_000n }, bonds: { primary: 25_000_000_000n, fallback: 25_000_000_000n, appeal: 25_000_000_000n } });
  const chain = new SimChain(margin === undefined ? genesis : { ...genesis, expiryMarginSec: margin });
  const deal = new Deal(chain, cast, { club });
  for (const s of [await deal.offer(), await deal.accept(), await deal.agreeAndFund(), await deal.deliver()]) {
    const r = await chain.submit(s);
    if (!r.ok) throw new Error(`${s.kind}: ${r.problem.type}`);
  }
  return { chain, deal, expiry: authorizationExpiry(deal.terms, margin ?? DEFAULT_EXPIRY_MARGIN_SEC) };
}

describe('authorizationExpiry (CPP capture deadline)', () => {
  it('is fallbackBy + appealDecideSec + margin, one day by default as in the local deployment', async () => {
    const { deal, expiry } = await delivered();
    expect(Date.parse(expiry)).toBe(Date.parse(deal.terms.timing.fallbackBy) + (deal.terms.timing.appealDecideSec + 86_400) * 1000);
  });

  it('allows an early accept one second before it and refuses it at it', async () => {
    const before = await delivered();
    before.chain.advanceTo(new Date(Date.parse(before.expiry) - 1000).toISOString());
    expect((await before.chain.submit(await before.deal.earlyAccept())).ok).toBe(true);
    const at = await delivered();
    at.chain.advanceTo(at.expiry);
    const r = await at.chain.submit(await at.deal.earlyAccept());
    expect(r.ok ? 'ok' : r.problem.type).toBe('deadline_passed');
  });

  it('after it, refuses a mutual settlement that pays the seller and allows one that returns everything to the buyer', async () => {
    const a = await delivered();
    a.chain.advanceTo(a.expiry);
    const paysSeller = await a.chain.submit(await a.deal.mutual());
    expect(paysSeller.ok ? 'ok' : paysSeller.problem.type).toBe('deadline_passed');
    const refund = await a.chain.submit(await a.deal.mutual({ payouts: a.deal.split(0n) }));
    expect(refund.ok).toBe(true);
  });

  it('takes the margin from genesis', async () => {
    const { chain, deal, expiry } = await delivered(60);
    expect(Date.parse(expiry)).toBe(Date.parse(deal.terms.timing.fallbackBy) + (deal.terms.timing.appealDecideSec + 60) * 1000);
    chain.advanceTo(expiry);
    const r = await chain.submit(await deal.earlyAccept());
    expect(r.ok ? 'ok' : r.problem.type).toBe('deadline_passed');
  });
});
