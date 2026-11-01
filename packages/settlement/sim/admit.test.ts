// T-026 persistence hook: a mandate admitted at run time (the public demo's faucet) is journaled, so a chain
// rebuilt from genesis and its journal has the same agents, and the journal reads from an offset.
import { describe, expect, it } from 'vitest';
import { Deal, mandateFor, simActor, simCast, simClub, simGenesis, wideScope, type Cast } from './actors.js';
import { SimChain } from './simchain.js';

const START = '2026-11-01T09:00:00Z';
const BOND = 25_000_000_000n;

async function bare(): Promise<{ chain: SimChain; cast: Cast; club: ReturnType<typeof simClub>; genesis: Awaited<ReturnType<typeof simGenesis>> }> {
  const cast = simCast('admit');
  const club = simClub(simActor('club-operator').address);
  const full = await simGenesis({ cast, club, start: START, balances: { buyer: 10_000_000_000n }, bonds: { primary: BOND, fallback: BOND, appeal: BOND } });
  // No mandates at genesis: the agents arrive later, as they do through the demo faucet.
  const genesis = { ...full, mandates: [] };
  return { chain: new SimChain(genesis), cast, club, genesis };
}

const mandate = (cast: Cast, who: 'buyer' | 'seller', clubId: string, principal = simActor('demo-principal')) =>
  mandateFor(principal, cast[who].address, clubId, wideScope(['buyer', 'seller'], '2027-11-01T09:00:00Z'), START);

describe('SimChain.admit (run-time mandate, test worlds only)', () => {
  it('refuses an offer before the seller is admitted and takes it after', async () => {
    const { chain, cast, club } = await bare();
    const deal = new Deal(chain, cast, { club });
    const before = await chain.submit(await deal.offer());
    expect(before.ok ? 'ok' : before.problem.type).toBe('scope_exceeded');
    expect(await chain.admit(await mandate(cast, 'seller', club.id))).toBeNull();
    expect((await chain.submit(await deal.offer())).ok).toBe(true);
    expect(chain.agentMandates().map((m) => m.agent)).toEqual([cast.seller.address]);
  });

  it('refuses a mandate whose signature does not recover to its principal, or for an unknown club', async () => {
    const { chain, cast, club } = await bare();
    const m = await mandate(cast, 'seller', club.id);
    expect((await chain.admit({ ...m, principal: simActor('someone-else').address }))?.type).toBe('invalid_signature');
    expect((await chain.admit(await mandate(cast, 'seller', 'no-such-club')))?.type).toBe('not_found');
    expect(chain.journal()).toEqual([]);
  });

  it('journals admissions, so replay rebuilds the same chain, and journal(from) reads the tail', async () => {
    const { chain, cast, club, genesis } = await bare();
    await chain.admit(await mandate(cast, 'seller', club.id));
    await chain.admit(await mandate(cast, 'buyer', club.id));
    chain.faucet(cast.buyer.address, 5n);
    const deal = new Deal(chain, cast, { club });
    expect((await chain.submit(await deal.offer())).ok).toBe(true);
    chain.advance(3);
    const journal = chain.journal();
    expect(journal.map((e) => e.op)).toEqual(['admit', 'admit', 'faucet', 'submit', 'advance']);
    expect(chain.journal(3)).toEqual(journal.slice(3));
    const replayed = await SimChain.replay(genesis, journal);
    expect(replayed.digest()).toBe(chain.digest());
    expect(replayed.agentMandates()).toEqual(chain.agentMandates());
  });
});
