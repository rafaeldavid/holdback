// T-425, measurement 2: deals finished with both operators stopped, on a local anvil chain only, never the live service.
// Each deal is funded through the operators (and delivered through them where it is delivered); then both operator
// nodes stop, and the deal is finished by calls straight to HoldbackRules from a party's own key, which pays its own
// anvil gas. The test times the direct part. It extends neutrality.operator-offline (one operator offline, on SimChain
// and on the contract) to both operators stopped. Skipped without anvil and forge build output, as CI's shards are.
//
//   node scripts/metrics/pitch-evidence.mjs direct        writes the record (PITCH_EVIDENCE_OUT) and prints its table
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openOwnEnvelope } from '../../examples/verify.ts';
import { ANVIL_SKIP, anvilReady } from '../../examples/e2e-world.ts';
import { LocalWorld, PRICE_UNITS, type LocalDeal } from './pitch-evidence-anvil.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const results: J[] = [];
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
/** Blocks from the head before the first direct call to the block of the last: anvil makes one a second. */
const blocksOf = (from: bigint, last: { block: number }) => last.block - Number(from);

describe.skipIf(!anvilReady)(`T-425 measurement 2: a deal finished with both operators stopped (anvil)${ANVIL_SKIP}`, () => {
  let lw: LocalWorld;
  let release: LocalDeal, timeouts: LocalDeal, reclaim: LocalDeal;
  let material: J;
  let stoppedAt = 0;

  beforeAll(async () => {
    lw = await LocalWorld.start();
    // Three deals, each Held through the operators while the passes run.
    release = await lw.deal();
    timeouts = await lw.deal();
    reclaim = await lw.deal();
    // Two of them delivered through the operators with the passes paused: no adjudicator judges them.
    await lw.deliver(release);
    await lw.deliver(timeouts);
    // The buyer's tool fetches the work before the operators stop, as it does to open the work (agent.ts envelopeMaterial).
    material = await release.buyer.agent.envelopeMaterial(release.terms, release.delivery);
    await lw.stopOperators();
    stoppedAt = Date.now();
  }, 600_000);

  afterAll(async () => {
    await lw?.close();
    const out = process.env['PITCH_EVIDENCE_OUT'];
    if (!out || !results.length) return;
    const lines = [
      'direct: both operators stopped, finished by direct calls to HoldbackRules (local anvil, 1 s blocks)',
      '| Path | Direct calls | Final stage | Direct part, wall | Blocks | Gas | Deadlines waited |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...results.map((r) => `| ${r.path} | ${r.calls.join(', ')} | ${r.stage} | ${sec(r.directMs)} | ${r.blocks} | ${r.gasUsed} | ${r.waited} |`),
      'The wall time includes viem\'s receipt polling, every 4 s by default; the blocks are what a chain adds.',
    ];
    writeFileSync(out, `${JSON.stringify({ schema: 'crow.metrics.pitch-evidence/1', generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), generator: { script: 'tests/metrics/pitch-evidence-direct.test.ts' }, direct: { chain: 'anvil (local), 1 s blocks', results, lines } }, null, 2)}\n`);
  });

  it('both operators are stopped: neither node answers', async () => {
    for (const url of lw.served.urls) await expect(fetch(`${url}/.well-known/holdback.json`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
    expect(await lw.stage(release.id)).toBe('Delivered');
    expect(await lw.stage(timeouts.id)).toBe('Delivered');
    expect(await lw.stage(reclaim.id)).toBe('Held');
  });

  it('release: the buyer opens its envelope and accepts early, straight to the contract: Released, the price to the seller', async () => {
    const t0 = Date.now();
    await openOwnEnvelope(material); // throws if the buyer's envelope does not open against the posted delivery
    const before = await lw.balances([release.seller.agent.address, release.buyer.agent.address]);
    const head = await lw.chain.client.getBlockNumber({ cacheTime: 0 });
    const tx = await lw.earlyAcceptDirect(release, release.buyer, release.buyer.key);
    const directMs = Date.now() - t0;
    expect(tx.status).toBe('success');
    expect(await lw.stage(release.id)).toBe('Released');
    const after = await lw.balances([release.seller.agent.address, release.buyer.agent.address]);
    expect(after[release.seller.agent.address]! - before[release.seller.agent.address]!).toBe(PRICE_UNITS);
    const fee = BigInt(release.terms.adjudication.fee.amount);
    expect(after[release.buyer.agent.address]! - before[release.buyer.agent.address]!).toBe(fee); // the fee is voided back to the buyer
    results.push({ path: 'release: buyer accepts early', commitmentId: release.id, calls: ['earlyAccept'], transactions: [tx.tx], stage: 'Released', directMs, blocks: blocksOf(head, tx), gasUsed: tx.gasUsed, waited: 'none', sinceStopMs: Date.now() - stoppedAt });
  }, 120_000);

  it('refund: nobody decides; anyone sends the fallback and default timeouts, straight to the contract: Refunded', async () => {
    const sender = timeouts.buyer.key; // any key with gas may send them; the buyer's is at hand
    const before = await lw.balances([timeouts.buyer.agent.address]);
    let directMs = 0;
    await lw.warpTo(timeouts.terms.timing.judgeBy);
    let head = await lw.chain.client.getBlockNumber({ cacheTime: 0 });
    let blocks = 0;
    let t0 = Date.now();
    const fallback = await lw.triggerDirect(timeouts, 'triggerFallback', sender);
    directMs += Date.now() - t0;
    blocks += blocksOf(head, fallback);
    expect(fallback.status).toBe('success');
    expect(await lw.stage(timeouts.id)).toBe('FallbackJudging');
    await lw.warpTo(timeouts.terms.timing.fallbackBy);
    head = await lw.chain.client.getBlockNumber({ cacheTime: 0 });
    t0 = Date.now();
    const dflt = await lw.triggerDirect(timeouts, 'triggerDefault', sender);
    directMs += Date.now() - t0;
    blocks += blocksOf(head, dflt);
    expect(dflt.status).toBe('success');
    expect(await lw.stage(timeouts.id)).toBe('Refunded');
    const after = await lw.balances([timeouts.buyer.agent.address]);
    const hold = PRICE_UNITS + BigInt(timeouts.terms.adjudication.fee.amount);
    expect(after[timeouts.buyer.agent.address]! - before[timeouts.buyer.agent.address]!).toBe(hold);
    const t = timeouts.terms.timing;
    const window = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 1000);
    results.push({ path: 'refund: nobody decides', commitmentId: timeouts.id, calls: ['triggerFallback', 'triggerDefault'], transactions: [fallback.tx, dflt.tx], stage: 'Refunded', directMs, blocks, gasUsed: (BigInt(fallback.gasUsed) + BigInt(dflt.gasUsed)).toString(), waited: `deliverBy ${window(timeouts.terms.createdAt, t.deliverBy)} s after the offer, then judge ${window(t.deliverBy, t.judgeBy)} s and fallback ${window(t.judgeBy, t.fallbackBy)} s, skipped on anvil's clock`, windowsSec: { deliverBy: window(timeouts.terms.createdAt, t.deliverBy), judge: window(t.deliverBy, t.judgeBy), fallback: window(t.judgeBy, t.fallbackBy) } });
  }, 120_000);

  it('reclaim: the seller never delivers; the buyer reclaims at deliverBy, straight to the contract: Refunded', async () => {
    const before = await lw.balances([reclaim.buyer.agent.address]);
    await lw.warpTo(reclaim.terms.timing.deliverBy);
    const head = await lw.chain.client.getBlockNumber({ cacheTime: 0 });
    const t0 = Date.now();
    const tx = await lw.triggerDirect(reclaim, 'reclaim', reclaim.buyer.key);
    const directMs = Date.now() - t0;
    expect(tx.status).toBe('success');
    expect(await lw.stage(reclaim.id)).toBe('Refunded');
    const after = await lw.balances([reclaim.buyer.agent.address]);
    expect(after[reclaim.buyer.agent.address]! - before[reclaim.buyer.agent.address]!).toBe(PRICE_UNITS + BigInt(reclaim.terms.adjudication.fee.amount));
    results.push({ path: 'reclaim: the seller never delivers', commitmentId: reclaim.id, calls: ['reclaim'], transactions: [tx.tx], stage: 'Refunded', directMs, blocks: blocksOf(head, tx), gasUsed: tx.gasUsed, waited: `deliverBy, ${Math.round((Date.parse(reclaim.terms.timing.deliverBy) - Date.parse(reclaim.terms.createdAt)) / 1000)} s after the offer, skipped on anvil's clock` });
  }, 120_000);
});
