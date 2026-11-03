// Gas per deal on anvil (D4): each path runs end to end through EvmSettlement, and every mined transaction's
// receipt gasUsed is recorded. `node packages/settlement/dist/evm/gas.js` prints the table (needs anvil and
// `forge build`). Steady state: a warm-up deal runs first so CPP's TokenStore clone exists and recipients hold tokens.
import type { Club, Hex32 } from '@holdback/core';
import type { Submission } from '../src/interface.js';
import { EvmSettlement, type TxRecord } from './evm-settlement.js';
import { EvmDeal, evmCast, evmGenesis, type EvmCast } from './testing.js';
import { EvmWorld } from './world.js';

export interface PathGas {
  path: string;
  txs: Array<{ call: string; gasUsed: bigint }>;
  total: bigint;
  finalState: string;
}

const START = '2026-01-01T00:00:00Z';

export async function newSettlement(world: EvmWorld): Promise<{ chain: EvmSettlement; cast: EvmCast; club: Awaited<ReturnType<typeof evmGenesis>>['club'] }> {
  const cast = evmCast();
  const { genesis, club } = await evmGenesis({ cast, token: world.deployment.token.toLowerCase(), chainId: world.chainId, rules: world.deployment.rules, start: START, buyer: 100_000_000_000n, bond: 50_000_000_000n });
  const chain = await EvmSettlement.create(world, genesis, Object.values(cast).map((a) => a.address));
  return { chain, cast, club };
}

/** Submits through op-1 (its key pays gas) and throws on a refusal. */
export async function must(chain: EvmSettlement, cast: EvmCast, s: Promise<Submission> | Submission): Promise<void> {
  const r = await chain.submit(await s, { via: 'op-1', sender: cast.operator.key });
  if (!r.ok) throw new Error(`${(await s).kind} refused: ${r.problem.type}: ${r.problem.detail}`);
  chain.advance(1);
}

async function funded(chain: EvmSettlement, cast: EvmCast, club: Club, tag: string, fee?: { to: `0x${string}`; value: bigint }): Promise<EvmDeal> {
  const d = new EvmDeal(chain, cast, club, tag);
  await must(chain, cast, d.offer());
  await must(chain, cast, d.accept());
  await must(chain, cast, d.agreeAndFund(fee ? { operatorFee: fee } : {}));
  return d;
}

async function carried(chain: EvmSettlement, d: EvmDeal): Promise<void> {
  const s = await d.deliver();
  if (s.kind !== 'deliver') throw new Error('unreachable');
  const p = await chain.carryDelivery(s.delivery);
  if (p) throw new Error(`carryDelivery refused: ${p.type}`);
  chain.advance(1);
}

const advanceTo = (chain: EvmSettlement, ts: string, plusSeconds = 0) => chain.advanceTo(new Date(Date.parse(ts) + plusSeconds * 1000).toISOString());

export const PATHS: Record<string, (chain: EvmSettlement, cast: EvmCast, club: Awaited<ReturnType<typeof newSettlement>>['club']) => Promise<Hex32>> = {
  'happy path (decision carries the delivery)': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'happy');
    await carried(chain, d);
    await must(chain, cast, d.decide('primary', 'accept'));
    return d.id;
  },
  'happy path with an on-chain deliver': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'happy-deliver');
    await must(chain, cast, d.deliver());
    await must(chain, cast, d.decide('primary', 'accept'));
    return d.id;
  },
  'reject (fee-only capture + void)': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'reject');
    await carried(chain, d);
    await must(chain, cast, d.decide('primary', 'reject'));
    return d.id;
  },
  'reclaim (nothing delivered)': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'reclaim');
    advanceTo(chain, d.terms.timing.deliverBy);
    await must(chain, cast, d.trigger('reclaim'));
    return d.id;
  },
  'early accept (delivery carried)': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'early');
    await carried(chain, d);
    await must(chain, cast, d.earlyAccept());
    return d.id;
  },
  'mutual settlement (70/30, before delivery)': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'mutual');
    await must(chain, cast, d.mutual(1_400_000_000n, false));
    return d.id;
  },
  // Only the party the decision went against appeals (T-206 L-7): after a reject, the seller.
  'party appeal (reject, seller appeals, upheld)': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'appeal');
    await carried(chain, d);
    await must(chain, cast, d.decide('primary', 'reject'));
    await must(chain, cast, d.appealBy('seller', 100_000_000n));
    const openedAt = Math.floor(Date.parse(chain.now()) / 1000) - 1;
    chain.advance(2);
    await must(chain, cast, d.decide('appeal', 'reject', openedAt + 1));
    return d.id;
  },
  // The first decider's bond pays the buyer the price (T-206 I-8).
  'party appeal (accept, buyer appeals, overturned)': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'overturn');
    await carried(chain, d);
    await must(chain, cast, d.decide('primary', 'accept'));
    await must(chain, cast, d.appealBy('buyer', 100_000_000n));
    const openedAt = Math.floor(Date.parse(chain.now()) / 1000) - 1;
    chain.advance(2);
    await must(chain, cast, d.decide('appeal', 'reject', openedAt + 1));
    return d.id;
  },
  'escalation, then the appeal adjudicator decides': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'escalate');
    await carried(chain, d);
    await must(chain, cast, d.decide('primary', 'escalate'));
    const at = Math.floor(Date.parse(chain.now()) / 1000) - 1;
    chain.advance(2);
    await must(chain, cast, d.decide('appeal', 'accept', at + 1));
    return d.id;
  },
  'fallback (primary silent, fallback accepts)': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'fallback');
    await must(chain, cast, d.deliver());
    advanceTo(chain, d.terms.timing.judgeBy);
    await must(chain, cast, d.trigger('fallback'));
    await must(chain, cast, d.decide('fallback', 'accept', Math.floor(Date.parse(d.terms.timing.judgeBy) / 1000)));
    return d.id;
  },
  'default (primary and fallback silent)': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'default');
    await must(chain, cast, d.deliver());
    advanceTo(chain, d.terms.timing.judgeBy);
    await must(chain, cast, d.trigger('fallback'));
    advanceTo(chain, d.terms.timing.fallbackBy);
    await must(chain, cast, d.trigger('default'));
    return d.id;
  },
  'operator fee bundled with funding, then accept': async (chain, cast, club) => {
    const d = await funded(chain, cast, club, 'opfee', { to: cast.operator.address, value: 1_000_000n });
    await carried(chain, d);
    await must(chain, cast, d.decide('primary', 'accept'));
    return d.id;
  },
};

export async function measure(world: EvmWorld): Promise<PathGas[]> {
  const out: PathGas[] = [];
  for (const [path, run] of Object.entries(PATHS)) {
    const { chain, cast, club } = await newSettlement(world);
    // Warm-up: the TokenStore clone and first-touch storage are paid once per operator, not per deal.
    await PATHS['happy path (decision carries the delivery)']!(chain, cast, club);
    const before = chain.transactions().length;
    const id = await run(chain, cast, club);
    const txs: TxRecord[] = chain.transactions().slice(before).filter((t) => t.commitmentId === id);
    out.push({ path, txs: txs.map((t) => ({ call: t.call, gasUsed: t.gasUsed })), total: txs.reduce((a, t) => a + t.gasUsed, 0n), finalState: chain.escrowState(id)!.kind });
  }
  return out;
}

export function gasTable(rows: readonly PathGas[]): string {
  const lines = ['| Path | Transactions | Gas per transaction | Total gas | Final state |', '| --- | --- | --- | --- | --- |'];
  for (const r of rows) lines.push(`| ${r.path} | ${r.txs.length} | ${r.txs.map((t) => `${t.call} ${t.gasUsed.toLocaleString('en-US')}`).join(' + ')} | ${r.total.toLocaleString('en-US')} | ${r.finalState} |`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const world = await EvmWorld.start(process.cwd());
  try {
    console.log(gasTable(await measure(world)));
  } finally {
    await world.stop();
  }
}
