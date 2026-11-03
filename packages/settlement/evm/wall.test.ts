// EvmSettlement on a wall-clock chain (kind 'testnet', ADR-0028), without one: a chain double answers the few reads
// the pre-funding stages make and holds deal A's funding simulation until the test lets it revert. On a live chain
// each commitment runs on its own lane, so other deals move while one waits for its block. No network, no anvil.
import { describe, expect, it } from 'vitest';
import type { EvmChain, Mined } from './chain.js';
import { EvmSettlement } from './evm-settlement.js';
import { LIVE_ABIS } from './live.js';
import { evmCast, evmGenesis, EvmDeal } from './testing.js';

const address = (c: string) => `0x${c.repeat(40)}` as `0x${string}`;
const PLENTY = 10n ** 24n;
const WALL = Date.parse('2026-01-01T00:00:00Z');

class HeldChain implements EvmChain {
  readonly clock = 'wall' as const;
  readonly chainId = 31337;
  readonly expiryMargin = 86_400n;
  readonly tokenDomain = { name: 'Crow Test USDC', version: '1' };
  readonly abis = LIVE_ABIS;
  readonly deployment = { token: address('a'), escrow: address('e'), erc3009Collector: address('c'), permit2Collector: address('d'), multicall: address('f'), rules: address('b'), bonds: address('9'), beacon: address('8'), fromBlock: 0n };
  readonly publicClient = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'DOMAIN_SEPARATOR') return `0x${'11'.repeat(32)}`;
      if (['balanceOf', 'freeOf', 'bondOf'].includes(functionName)) return PLENTY;
      return 0n;
    },
  } as unknown as EvmChain['publicClient'];
  /** Resolves when a funding simulation is waiting; `revert` lets it fail. */
  waiting: Promise<void>;
  revert!: () => void;
  private signal!: () => void;
  private readonly gate = new Promise<void>((r) => (this.revert = r));
  constructor() {
    this.waiting = new Promise<void>((r) => (this.signal = r));
  }
  senderFor(): `0x${string}` {
    return address('7');
  }
  async simulate(): Promise<void> {
    this.signal();
    await this.gate;
    throw new Error('execution reverted: ERC20: transfer amount exceeds balance');
  }
  async send(): Promise<Mined> {
    throw new Error('nothing is sent in these tests');
  }
}

async function settlement(chain: HeldChain) {
  const cast = evmCast();
  const { genesis, club } = await evmGenesis({ cast, token: chain.deployment.token, chainId: chain.chainId, rules: chain.deployment.rules, start: new Date(WALL).toISOString().replace('.000Z', 'Z'), buyer: PLENTY, bond: PLENTY });
  const s = await EvmSettlement.restore(chain, genesis, undefined, () => WALL);
  return { s, cast, club, genesis };
}

describe('EvmSettlement on a wall-clock chain', () => {
  it("a funding that fails while another deal moves takes back only its own agreement, never the other deal's events", async () => {
    const chain = new HeldChain();
    const { s, cast, club } = await settlement(chain);
    const a = new EvmDeal(s, cast, club, 'A');
    const b = new EvmDeal(s, cast, club, 'B');
    for (const d of [a, b]) {
      expect((await s.submit(await d.offer(), { via: 'op' })).ok).toBe(true);
      expect((await s.submit(await d.accept(), { via: 'op' })).ok).toBe(true);
    }
    const failing = s.submit(await a.agreeAndFund(), { via: 'op' });
    await chain.waiting;
    // While A waits for its block, B agrees on its own lane and is answered.
    const bAgree = await b.agreeAndFund();
    if (bAgree.kind !== 'agree_and_fund') throw new Error('unreachable');
    const agreed = await s.submit({ kind: 'agree', message: bAgree.agree }, { via: 'op' });
    expect(agreed.ok ? agreed.events.map((e) => e.type) : agreed.problem.type).toEqual(['commitment.agreed']);
    chain.revert();
    const r = await failing;
    expect(r.ok ? 'ok' : r.problem.type).not.toBe('ok');
    const log = s.log();
    expect(log.filter((e) => e.commitmentId === b.id).map((e) => e.type)).toEqual(['commitment.offered', 'adjudicator.accepted', 'commitment.agreed']);
    expect(log.filter((e) => e.commitmentId === a.id).map((e) => e.type)).toEqual(['commitment.offered', 'adjudicator.accepted']);
    // One chain of hashes, in order.
    for (const [i, e] of log.entries()) {
      expect(e.seq).toBe(i);
      if (i > 0) expect(e.prevHash).toBe(log[i - 1]!.hash);
    }
    expect((await s.state(a.id))?.escrowState).toBe('AcceptedByAdjudicator');
  });

  it('a retry after a restart replays the first answer; the same key with another body is a conflict', async () => {
    const chain = new HeldChain();
    const { s, cast, club, genesis } = await settlement(chain);
    const d = new EvmDeal(s, cast, club, 'replay');
    const offer = await d.offer();
    const first = await s.submit(offer, { via: 'op', idempotencyKey: 'k-offer' });
    expect(first.ok).toBe(true);
    const restarted = await EvmSettlement.restore(chain, genesis, s.drain(), () => WALL);
    const again = await restarted.submit(offer, { via: 'op', idempotencyKey: 'k-offer' });
    expect(again).toEqual({ ...first, replayed: true });
    expect(restarted.log()).toEqual(s.log());
    const other = await restarted.submit(await d.accept(), { via: 'op', idempotencyKey: 'k-offer' });
    expect(other.ok ? 'ok' : other.problem.type).toBe('idempotency_conflict');
  });
});
