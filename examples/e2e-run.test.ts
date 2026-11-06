// The run machinery of round 1 (e2e-run.ts), offline: the money checks count only the deal's own transfers, the gate
// after a scenario closes a deal it left holding money by its timeouts through the API or says why it cannot, the
// driver finds a deal another run of the same round keys offered, and one run at a time holds the round's lock. The
// money fixtures are round 1's 2026-11-05T190711Z records of scenarios 4 and 5a, whose balance windows took in a second
// run's scenario 1 (2026-11-05T193705Z, funded in block 12,071,597 and paid in 12,071,600).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHECKS, DATASET, PRICE } from './e2e-scenario-kit.ts';
import { delta, flowOf, fund, get, lockFile, nextTimeout, offer, openDeal, otherRunDeals, releaseLock, Round, Run, settleOpen, shortWindows, sleep, takeLock, type DealRecord, type Holding } from './e2e-run.ts';
import { simWorld, type Served } from './e2e-world.ts';
import { Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const TOKEN = '0x5029787d7e141f2d51788035cc23903652d196b6';
const BUYER = '0x6c6cf80d54c0b7dc11cc2a7b2d1990202f3679b5';
const SELLER = '0x8b01fec41ca6a4537934cbe3b4227f2f13709f39';
const FEE_TO = '0x966216a0e06a6d78197714e221a1958e3c7b1ae2';
const COLLECTOR = '0xa7c26ba572dce83ab4466379fc8aee84345888e7';
const STORE = '0x9467f22ec7623b17a1f1c34d2575eec90caaa162';
const ADJ_1 = '0xc1f7c0171ef131ead8921d6266a015c62e08f2bc';
const FALLBACK = '0x594a2253389936fc7b75d8857f5489cd83de68a2';
const DEMO_PRIMARY = '0x71f8a3e163528c773fb358a718294a0b32697c9e';
const BONDS = '0x83f3a2615a2be9a7dadca924ed9952ec85749ad1';

const transfer = (from: string, to: string, amount: string) => ({ contract: 'token', event: 'Transfer', args: { from, to, amount } });
const bondEvent = (event: string, adjudicator: string, amount: string) => ({ contract: 'bonds', event, args: { adjudicator, token: TOKEN, amount } });
const tx = (block: number, logs: J[]): DealRecord['transactions'][number] => ({
  tx: `0x${block.toString(16).padStart(64, '0')}`, status: 'success', from: BUYER as Hex, to: null, block, blockHash: `0x${'00'.repeat(32)}`, gasUsed: '0', effectiveGasPrice: '0', calls: [], logs, steps: [], link: '', sentBy: 'operator',
});
const holding = (token: string, bond = '0', free = bond): Holding => ({ token, bond, free });
const funding = (block: number, primary: string) =>
  tx(block, [transfer(BUYER, FEE_TO, '4710000'), bondEvent('BondEncumbered', primary, '25000000'), transfer(BUYER, COLLECTOR, '26000000'), transfer(COLLECTOR, STORE, '26000000')]);

/** Scenario 4's deal 0xa46d7a…fea8 as recorded: its own transactions' logs, and wallet balances that took in another deal. */
const FOUR: DealRecord = {
  label: "the round's silent primary, the demo fallback and appeal adjudicators", id: `0x${'a4'.repeat(32)}`, relay: 'https://api.escrow.stream', notes: [],
  transactions: [
    funding(12_071_562, ADJ_1),
    tx(12_071_563, []),
    tx(12_071_592, []),
    tx(12_071_593, [bondEvent('BondReleased', ADJ_1, '25000000'), bondEvent('BondEncumbered', FALLBACK, '25000000'), transfer(STORE, FALLBACK, '1000000'), transfer(STORE, SELLER, '25000000')]),
    tx(12_071_599, [bondEvent('BondReleased', FALLBACK, '25000000')]),
  ],
  chain: { stage: 'Released', appeal: 'expired', attempt: 1, payment: { collected: true, capturable: '0', refundable: '26000000' }, block: 12_071_599 },
  balances: {
    before: { [BUYER]: holding('808810000'), [SELLER]: holding('1113750000'), [ADJ_1]: holding('1000000', '25000000'), [FALLBACK]: holding('0', '25000000000') },
    after: { [BUYER]: holding('747390000'), [SELLER]: holding('1138750000'), [ADJ_1]: holding('1000000', '25000000'), [FALLBACK]: holding('1000000', '25000000000') },
  },
};

/** Scenario 5a's deal 0x3a279b…dfb2 as recorded: refunded by its default, while the seller's wallet took another deal's 25 tUSDC. */
const FIVE_A: DealRecord = {
  label: 'checks-only, a check that runs out of its work budget', id: `0x${'3a'.repeat(32)}`, relay: 'https://api.escrow.stream', notes: [],
  transactions: [funding(12_071_601, DEMO_PRIMARY), tx(12_071_602, []), tx(12_071_604, [bondEvent('BondReleased', DEMO_PRIMARY, '25000000')]), tx(12_071_610, [transfer(STORE, BUYER, '26000000')])],
  chain: { stage: 'Refunded', appeal: 'closed', attempt: 1, payment: { collected: true, capturable: '0', refundable: '0' }, block: 12_071_610 },
  balances: {
    before: { [BUYER]: holding('747390000'), [SELLER]: holding('1138750000'), [DEMO_PRIMARY]: holding('26000000', '25002500000', '24977500000') },
    after: { [BUYER]: holding('742680000'), [SELLER]: holding('1163750000'), [DEMO_PRIMARY]: holding('28000000', '25002500000', '24977500000') },
  },
};

describe('the money checks count only the deal itself (round 1, 2026-11-05)', () => {
  it("4: the buyer pays this deal's price and fees once, though its wallet also paid another deal's in the window", () => {
    expect(BigInt(FOUR.balances.after![BUYER]!.token) - BigInt(FOUR.balances.before[BUYER]!.token)).toBe(-61_420_000n);
    expect(delta(FOUR, BUYER)).toBe(-30_710_000n);
    expect(delta(FOUR, SELLER)).toBe(25_000_000n);
    expect(delta(FOUR, FALLBACK)).toBe(1_000_000n);
    for (const a of [ADJ_1, FALLBACK]) for (const f of ['bond', 'free'] as const) expect(delta(FOUR, a, f), `${a} ${f}`).toBe(0n);
  });

  it("5a: the seller gets nothing from this deal, though its wallet took another deal's payout in the window", () => {
    expect(BigInt(FIVE_A.balances.after![SELLER]!.token) - BigInt(FIVE_A.balances.before[SELLER]!.token)).toBe(25_000_000n);
    expect(delta(FIVE_A, SELLER)).toBe(0n);
    expect(delta(FIVE_A, BUYER)).toBe(-4_710_000n);
    expect(flowOf(FIVE_A, DEMO_PRIMARY)).toEqual({ token: '0', bond: '0', free: '0' });
  });

  it('reads bonds from their events: a deposit, an encumbrance, a slash, and an appeal bond paid into the bond', () => {
    const rec: DealRecord = {
      ...FIVE_A,
      transactions: [
        tx(1, [{ contract: 'bonds', event: 'BondDeposited', args: { adjudicator: ADJ_1, token: TOKEN, amount: '10000000' } }, bondEvent('BondEncumbered', ADJ_1, '25000000')]),
        tx(2, [{ contract: 'bonds', event: 'AppealBondHeld', args: { commitmentId: `0x${'3a'.repeat(32)}`, appellant: SELLER, amount: '1250000' } }, transfer(SELLER, BONDS, '1250000')]),
        tx(3, [
          { contract: 'bonds', event: 'BondSlashed', args: { commitmentId: `0x${'3a'.repeat(32)}`, adjudicator: ADJ_1, to: BUYER, token: TOKEN, amount: '25000000' } },
          transfer(BONDS, BUYER, '25000000'),
          { contract: 'bonds', event: 'AppealBondPaid', args: { commitmentId: `0x${'3a'.repeat(32)}`, to: ADJ_1, toBond: true, amount: '1250000' } },
        ]),
      ],
    };
    expect(flowOf(rec, ADJ_1)).toEqual({ token: '0', bond: '-13750000', free: '-13750000' });
    expect(delta(rec, BUYER)).toBe(25_000_000n);
    expect(delta(rec, SELLER)).toBe(-1_250_000n);
  });

  it('on SimChain, with no chain to read, still compares the balances before and after', () => {
    const { chain: _c, ...sim } = FIVE_A; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(delta({ ...sim, transactions: [] }, SELLER)).toBe(25_000_000n);
  });
});

describe('nextTimeout: which trigger closes a deal that still holds money, when it is due, and when the deal is closed', () => {
  const timing = { deliverBy: '2026-11-05T19:00:00Z', judgeBy: '2026-11-05T19:01:00Z', fallbackBy: '2026-11-05T19:04:00Z', appealDecideSec: 60 };
  const ms = (iso: string) => Date.parse(iso);
  it('reclaim at deliverBy for a funded deal with nothing delivered', () => {
    for (const s of ['Agreed', 'Held']) expect(nextTimeout(s, timing)).toEqual({ kind: 'reclaim', deadline: 'deliverBy', at: ms(timing.deliverBy), settleBy: ms(timing.deliverBy) });
  });
  it('the fallback takeover at judgeBy for a delivered deal, then the default at fallbackBy', () => {
    expect(nextTimeout('Delivered', timing)).toEqual({ kind: 'fallback', deadline: 'judgeBy', at: ms(timing.judgeBy), settleBy: ms(timing.fallbackBy) });
    expect(nextTimeout('FallbackJudging', timing)).toEqual({ kind: 'default', deadline: 'fallbackBy', at: ms(timing.fallbackBy), settleBy: ms(timing.fallbackBy) });
  });
  it("the default at appealDecideBy after an escalation, from the operators' deadline or, without one, its latest possible time", () => {
    expect(nextTimeout('Escalated', timing, { appealDecideBy: '2026-11-05T19:02:30Z' })).toEqual({ kind: 'default', deadline: 'appealDecideBy', at: ms('2026-11-05T19:02:30Z'), settleBy: ms('2026-11-05T19:02:30Z') });
    expect(nextTimeout('Escalated', timing)).toEqual({ kind: 'default', deadline: 'appealDecideBy', at: ms('2026-11-05T19:05:00Z'), settleBy: ms('2026-11-05T19:05:00Z') });
  });
  it('apply-default at once on SimChain, and nothing for a deal that holds no money', () => {
    expect(nextTimeout('Defaulted', timing)).toEqual({ kind: 'apply-default', at: 0, settleBy: 0 });
    for (const s of ['Released', 'Refunded', 'Settled', 'Expired', 'Offered']) expect(nextTimeout(s, timing)).toBeNull();
  });
});

describe("the round's lock: one run of the round's keys at a time", () => {
  const master = '0x6D4cEa33dAf09Ba803238d46392162d41BDB029f';
  it('takes a free lock, refuses a second run while the first holds it, and is free again once released', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-lock-'));
    const first = takeLock(dir, master, { folder: join(dir, 'a') });
    expect(first.tookOver).toBeUndefined();
    expect(JSON.parse(readFileSync(lockFile(dir, master), 'utf8'))).toMatchObject({ pid: process.pid, folder: join(dir, 'a') });
    expect(() => takeLock(dir, master, { folder: join(dir, 'b') })).toThrow(Refusal);
    expect(() => takeLock(dir, master, { folder: join(dir, 'b') })).toThrow(new RegExp(`^refusing to start: another run of the round's keys is in progress \\(process ${process.pid}, started .*, writing ${join(dir, 'a')}\\)`));
    // Another master's run is another round: it takes its own lock.
    releaseLock(takeLock(dir, '0x0000000000000000000000000000000000000001', { folder: join(dir, 'c') }).lock);
    releaseLock(first.lock);
    expect(existsSync(lockFile(dir, master))).toBe(false);
    releaseLock(takeLock(dir, master, { folder: join(dir, 'd') }).lock);
  });

  it("takes over a lock whose process has ended, and says so; a release leaves another process's lock alone", () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-lock-'));
    const ended = spawnSync(process.execPath, ['-e', '']).pid!;
    writeFileSync(lockFile(dir, master), JSON.stringify({ pid: ended, startedAt: '2026-11-05T19:07:11Z', folder: join(dir, 'old') }));
    const { lock, tookOver } = takeLock(dir, master, { folder: join(dir, 'new') });
    expect(tookOver).toMatch(new RegExp(`^the lock of an earlier run \\(process ${ended}, started 2026-11-05T19:07:11Z\\) was left behind; that process has ended, so this run takes it over$`));
    writeFileSync(lockFile(dir, master), JSON.stringify({ pid: ended + 1, startedAt: '2026-11-05T19:35:02Z', folder: join(dir, 'other') }));
    releaseLock(lock);
    expect(existsSync(lockFile(dir, master))).toBe(true);
  });
});

describe('against the demo world on SimChain', () => {
  let demo: Served;
  beforeAll(async () => {
    demo = await simWorld();
  });
  afterAll(() => demo.close());
  const runOn = async (seed: string, lines: string[]) => new Run(await Round.open({ operators: [...demo.urls], seed, rpcUrl: 'http://127.0.0.1:9', log: (l) => lines.push(l) }), 'gate', 'the gate after a scenario');
  const triggers = (id: string) => demo.requests.filter((q) => q.startsWith(`POST /v1/commitments/${id}/triggers/`));

  it('closes a deal a stopped scenario left Held: it waits for deliverBy, sends reclaim through the API, and returns once the deal is Refunded', async () => {
    const lines: string[] = [];
    const r = await runOn(generatePrivateKey(), lines);
    const m = r.round.demo.minWindowSec;
    const deal = await openDeal(r, { label: 'funded, then the scenario stops', template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, timing: shortWindows(r, { offerExpiresInSec: 2 * m, fundWithinSec: 3 * m, deliverWithinSec: 4 * m }) }, [r.round.address('buyer'), r.round.address('seller')]);
    await fund(r, deal);
    const done = await settleOpen(r, r.deals, { waitMs: 90_000, gapMs: 500 });
    expect(done.join('\n'), lines.join('\n')).toMatch(new RegExp(`^${deal.id.slice(0, 8)}…${deal.id.slice(-4)} was Held past deliverBy ${deal.terms.timing.deliverBy}: the driver sent reclaim through the API`, 'm'));
    expect(triggers(deal.id)).toEqual([`POST /v1/commitments/${deal.id}/triggers/reclaim`]);
    for (const api of deal.buyer.sources()) expect((await get(deal.buyer, `/v1/commitments/${deal.id}`, api)).escrowState).toBe('Refunded');
    // Nothing holds money now: the gate returns at once and sends nothing.
    expect(await settleOpen(r, r.deals, { waitMs: 1000, gapMs: 100 })).toEqual([]);
  }, 120_000);

  it('refuses at once a deal its timeouts cannot close within the wait, and sends nothing', async () => {
    const r = await runOn(generatePrivateKey(), []);
    const deal = await openDeal(r, { label: 'funded, delivery due in an hour', template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, timing: shortWindows(r, { deliverWithinSec: 3600 }) }, [r.round.address('buyer'), r.round.address('seller')]);
    await fund(r, deal);
    const started = Date.now();
    await expect(settleOpen(r, r.deals, { waitMs: 60_000, gapMs: 500 })).rejects.toThrow(new RegExp(`^${deal.id} still holds money: it is Held, and its timeouts can close it only at ${deal.terms.timing.deliverBy}, after this run's 1-minute wait ends; run the remaining scenarios after then$`));
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(triggers(deal.id)).toEqual([]);
  }, 60_000);

  it("finds a deal of the round's buyer that another run offered after this run started, and neither this run's own deals nor older ones", async () => {
    const seed = generatePrivateKey();
    const mine = await runOn(seed, []);
    const other = await runOn(seed, []);
    const spec = { label: 'an offer', template: 'checks-only' as const, deliverable: DATASET, checks: CHECKS, price: PRICE };
    const parties = [mine.round.address('buyer'), mine.round.address('seller')];
    const older = await offer(other, spec, parties);
    // createdAt has whole seconds.
    await sleep(1100);
    const since = await mine.round.agent('master').settlementNow();
    await sleep(1100);
    const ours = await offer(mine, spec, parties);
    const theirs = await offer(other, spec, parties);
    // The demo primary accepts each offer, which updates the older one too.
    await sleep(1500);
    const found = await otherRunDeals(mine, new Set([ours.id]), since);
    expect(found.map((d) => d.id)).toEqual([theirs.id]);
    expect(found[0]).toMatchObject({ createdAt: theirs.terms.createdAt });
    expect(found.map((d) => d.id)).not.toContain(older.id);
  }, 60_000);
});
