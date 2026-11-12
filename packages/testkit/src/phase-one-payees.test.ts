// A club whose rulebook says `payoutsTo: any` on a phase-one world (T-386). The phase-one contracts pay a mutual
// settlement to the buyer's payment address and the seller's payout address only, whatever the club says (ADR-0031 §4,
// ADR-0033). SimChain on the `phase_one` profile, which `pnpm sim` and the local public world run (T-378), must refuse
// a payout to a third address as the chain's adapter does, with `invalid_terms`. On the `full` profile, which the
// SimChain-only fixtures run, the club's `any` still allows it (D23).
import { commitmentId, type Payout, type SettlementProfile } from '@holdback/core';
import { Deal, SIM_RULEBOOK, SimChain, sign, simActor, simCast, simClub, simGenesis } from '@holdback/settlement/sim';
import { keccak256, stringToBytes } from 'viem';
import { describe, expect, it } from 'vitest';

const START = '2026-11-01T09:00:00Z';
const THIRD = simActor('t-386/third-party').address;

/** A funded deal in Held on a SimChain of `profile`, in a club whose rulebook lets settlements pay any address. */
async function heldDeal(profile: SettlementProfile): Promise<{ chain: SimChain; deal: Deal }> {
  const cast = simCast();
  const club = simClub(simActor('club-operator').address, { ...SIM_RULEBOOK, mutualSettlement: { ...SIM_RULEBOOK.mutualSettlement, payoutsTo: 'any' } });
  const BOND = 25_000_000_000n;
  const genesis = { ...(await simGenesis({ cast, club, start: START, balances: { buyer: 10_000_000_000n }, bonds: { primary: BOND, fallback: BOND, appeal: BOND } })), profile };
  const chain = new SimChain(genesis);
  expect(chain.profile).toBe(profile);
  const deal = new Deal(chain, cast, { club });
  // Phase one requires an appeal window of 0 (ADR-0033 §2b). The sim Deal writes 300 s, so its terms take 0 here and
  // the ID and seed are derived again as its constructor derives them (packages/settlement/sim/actors.ts).
  if (profile === 'phase_one') {
    const d = deal as unknown as { terms: Deal['terms']; id: Deal['id']; seed: Deal['seed'] };
    d.terms = { ...deal.terms, timing: { ...deal.terms.timing, appealWindowSec: 0 } };
    d.id = commitmentId(d.terms);
    d.seed = keccak256(stringToBytes(`seed/${d.id}`));
  }
  const accepted = await deal.accept();
  if (accepted.kind !== 'adjudicator_accept') throw new Error('unreachable');
  // Phase one holds no bond, so the primary's acceptance reserves 0 (ADR-0031 §8); the full protocol reserves the price.
  const { signature: _sig, ...body } = accepted.message; // eslint-disable-line @typescript-eslint/no-unused-vars
  const acceptance = profile === 'phase_one' ? { kind: 'adjudicator_accept' as const, message: await sign(cast.primary, { ...body, bondReserved: { ...body.bondReserved, amount: '0' as typeof body.bondReserved.amount } }) } as typeof accepted : accepted;
  for (const s of [await deal.offer(), acceptance, await deal.agreeAndFund()]) {
    const r = await chain.submit(s);
    if (!r.ok) throw new Error(`refused: ${r.problem.type}: ${r.problem.detail}`);
  }
  expect(chain.escrowState(deal.id)?.kind).toBe('Held');
  return { chain, deal };
}

/** The price split: `share` to a third address, the rest to the seller's payout address. */
const toThird = (deal: Deal, share: bigint): Payout[] => {
  const price = BigInt(deal.terms.price.amount);
  const amount = (v: bigint) => ({ token: deal.terms.price.token, amount: v.toString() });
  return [
    { to: THIRD, amount: amount(share) },
    { to: deal.terms.sellerPayoutAddress, amount: amount(price - share) },
  ] as Payout[];
};

describe("a club's payoutsTo: any on the phase-one profile (T-386)", () => {
  it('refuses a settlement that pays a third address, with the chain adapter\'s problem type and reason', async () => {
    const { chain, deal } = await heldDeal('phase_one');
    const r = await chain.submit(await deal.mutual({ payouts: toThird(deal, 1_000_000n), deliveryHash: null }));
    expect(r.ok ? 'ok' : r.problem.type).toBe('invalid_terms');
    expect(r.ok ? '' : r.problem.detail).toMatch(/is neither the buyer's payment address nor the seller's payout address: the phase-one contracts pay a mutual settlement to those two only/);
    expect(chain.escrowState(deal.id)?.kind).toBe('Held');
  });

  it("settles a split between the parties' money addresses in the same club", async () => {
    const { chain, deal } = await heldDeal('phase_one');
    const r = await chain.submit(await deal.mutual({ deliveryHash: null }));
    expect(r.ok, r.ok ? '' : `${r.problem.type}: ${r.problem.detail}`).toBe(true);
    expect(chain.escrowState(deal.id)?.kind).toBe('Settled');
  });

  it('the full protocol keeps the club\'s choice: the same settlement to a third address settles (D23, SimChain only)', async () => {
    const { chain, deal } = await heldDeal('full');
    const r = await chain.submit(await deal.mutual({ payouts: toThird(deal, 1_000_000n), deliveryHash: null }));
    expect(r.ok, r.ok ? '' : `${r.problem.type}: ${r.problem.detail}`).toBe(true);
    expect(chain.escrowState(deal.id)?.kind).toBe('Settled');
  });
});
