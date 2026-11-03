// EvmSettlement against the T-202 contracts on a local anvil (chain id 31337, 127.0.0.1 only). Needs `anvil` on
// PATH and `forge build` output in contracts/out; without them the suite is skipped with the reason in its name,
// which `pnpm verify` would show (it runs forge build first; see scripts/verify.ts).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorizationExpiry } from '../sim/simchain.js';
import { measure, must, newSettlement, PATHS } from './gas.js';
import { EvmDeal } from './testing.js';
import { anvilAvailable, EvmWorld, EXPIRY_MARGIN } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));

describe.skipIf(!ready)(`EvmSettlement on anvil${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root);
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });

  it('talks to localhost only, on chain id 31337', async () => {
    expect(new URL(world.rpcUrl).hostname).toBe('127.0.0.1');
    expect(await world.publicClient.getChainId()).toBe(31337);
  });

  it('happy path: Released, price to the seller, fee to the primary, the buyer key in the paying transaction', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const id = await PATHS['happy path (decision carries the delivery)']!(chain, cast, club);
    expect(chain.escrowState(id)?.kind).toBe('Released');
    expect((await chain.stage(id)).stage).toBe('Released');
    expect(await chain.tokenBalance(cast.seller.address)).toBe(2_000_000_000n);
    expect(await chain.bondOf(cast.primary.address)).toBe(50_000_000_000n);
    expect(await chain.tokenBalance(cast.primary.address)).toBe(50_000_000n);
    const keys = await chain.keysFor(id, cast.buyer.address);
    expect(keys).toHaveLength(1);
    const types = chain.log().map((e) => e.type);
    // The primary's envelope is released off chain when the delivery lands (ADR-0020), as SimChain releases it.
    expect(types).toEqual(['commitment.offered', 'adjudicator.accepted', 'commitment.agreed', 'hold.funded', 'delivery.submitted', 'key.released', 'judgment.decided', 'settlement.released', 'key.released']);
    const released = chain.log().find((e) => e.type === 'settlement.released')!;
    const [toPrimary, toBuyer] = chain.log().filter((e) => e.type === 'key.released');
    expect(toBuyer!.payload['tx']).toBe(released.payload['tx']);
    expect(toPrimary!.payload).toMatchObject({ source: 'adapter', recipient: cast.primary.address, path: 'delivery' });
    expect(await chain.keysFor(id, cast.primary.address)).toHaveLength(1);
    // SimChain's payloads, so the operator and the adjudicators read either backend the same way.
    const offered = chain.log().find((e) => e.type === 'commitment.offered')!;
    expect((offered.payload['terms'] as { seller: string }).seller).toBe(cast.seller.address);
    const delivered = chain.log().find((e) => e.type === 'delivery.submitted')!;
    expect(delivered.payload).toMatchObject({ attempt: 1, ciphertext: { uri: expect.any(String) }, tx: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(chain.log().find((e) => e.type === 'judgment.decided')!.payload).toMatchObject({ role: 'primary', outcome: 'accept', seedSource: 'commit-reveal' });
    // Two transactions (D4).
    expect(chain.transactions().map((t) => t.call)).toEqual(['agreeAndFund', 'decide']);
    expect(await chain.replayCheck()).toMatchObject({ ok: true });
  }, 60_000);

  it('the funding and fee typed data an operator prepares hash to the digests the token checks (ADR-0025)', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'typed');
    const f = chain.fundingTypedData(d.terms);
    expect(f.typedData.primaryType).toBe('ReceiveWithAuthorization');
    expect(f.digest).toBe((await chain.fundingAuthorization(d.terms)).digest);
    const o = { commitmentId: d.id, from: cast.buyer.address, to: cast.operator.address, value: '10000', validAfter: d.terms.createdAt, validBefore: d.terms.timing.fundBy };
    const fee = chain.operatorFeeTypedData(o);
    expect(fee.digest).toBe((await chain.operatorFeeAuthorization(d.id, o.from, o.to, 10000n, o.validAfter, o.validBefore)).digest);
  }, 60_000);

  it('refusals carry SimChain problem types and change nothing', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'refusals');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    // The funding signed by the wrong key: the token refuses it.
    const bad = await chain.submit(await d.agreeAndFund({ fundingSigner: cast.stranger }), { via: 'op-1', sender: cast.operator.key });
    expect(bad.ok ? 'ok' : bad.problem.type).toBe('invalid_signature');
    expect(chain.escrowState(d.id)?.kind).toBe('AcceptedByAdjudicator');
    await must(chain, cast, d.agreeAndFund());
    // A reclaim before deliverBy, and a decision with nothing delivered.
    const early = await chain.submit(d.trigger('reclaim'), { sender: cast.stranger.key });
    expect(early.ok ? 'ok' : early.problem.type).toBe('invalid_state');
    // Settle twice.
    await must(chain, cast, d.deliver());
    await must(chain, cast, d.decide('primary', 'accept'));
    const again = await chain.submit(await d.decide('primary', 'reject'), { sender: cast.primary.key });
    expect(again.ok ? 'ok' : again.problem.type).toBe('invalid_state');
    expect(chain.transactions().map((t) => t.call)).toEqual(['agreeAndFund', 'deliver', 'decide']);
  }, 60_000);

  it('escape hatch: the buyer reclaims with its own key, no operator in the call path', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'hatch');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    await must(chain, cast, d.agreeAndFund());
    chain.advanceTo(d.terms.timing.deliverBy);
    const r = await chain.submit(d.trigger('reclaim'), { sender: cast.buyer.key });
    expect(r.ok).toBe(true);
    const tx = chain.transactions().at(-1)!;
    expect(tx.from.toLowerCase()).toBe(cast.buyer.address.toLowerCase());
    expect(tx.via).toBe('direct');
    expect(await chain.tokenBalance(cast.buyer.address)).toBe(100_000_000_000n);
  }, 60_000);

  it('operator fee: one transaction moves the fee to the operator and funds the hold, or neither', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'fee');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    // The funding is signed by the wrong key: the bundle reverts as a whole, so the fee does not move either.
    const bad = await chain.submit(await d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 1_000_000n }, fundingSigner: cast.stranger }), { via: 'op-1', sender: cast.operator.key });
    expect(bad.ok).toBe(false);
    expect(await chain.tokenBalance(cast.operator.address)).toBe(0n);
    expect(await chain.tokenBalance(cast.buyer.address)).toBe(100_000_000_000n);
    expect(chain.escrowState(d.id)?.kind).toBe('AcceptedByAdjudicator');
    await must(chain, cast, d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 1_000_000n } }));
    expect(chain.transactions()).toHaveLength(1);
    expect(await chain.tokenBalance(cast.operator.address)).toBe(1_000_000n);
    expect(await chain.tokenBalance(cast.buyer.address)).toBe(100_000_000_000n - 2_050_000_000n - 1_000_000n);
    expect(chain.escrowState(d.id)?.kind).toBe('Held');
    expect(chain.log().map((e) => e.type).slice(-2)).toEqual(['fee.operator', 'hold.funded']);
  }, 60_000);

  it('agrees with SimChain on authorizationExpiry: no capture from fallbackBy + appealDecideSec + margin on', async () => {
    const expiryOf = (d: EvmDeal) => authorizationExpiry(d.terms, Number(EXPIRY_MARGIN));
    const before = await newSettlement(world);
    const a = new EvmDeal(before.chain, before.cast, before.club, 'expiry-before');
    for (const s of [a.offer(), a.accept(), a.agreeAndFund(), a.deliver()]) await must(before.chain, before.cast, s);
    before.chain.advanceTo(new Date(Date.parse(expiryOf(a)) - 1000).toISOString());
    expect((await before.chain.submit(await a.earlyAccept(), { sender: before.cast.buyer.key })).ok).toBe(true);

    const at = await newSettlement(world);
    const b = new EvmDeal(at.chain, at.cast, at.club, 'expiry-at');
    for (const s of [b.offer(), b.accept(), b.agreeAndFund(), b.deliver()]) await must(at.chain, at.cast, s);
    at.chain.advanceTo(expiryOf(b));
    const early = await at.chain.submit(await b.earlyAccept(), { sender: at.cast.buyer.key });
    expect(early.ok ? 'ok' : early.problem.type).toBe('deadline_passed');
    expect(early.ok ? '' : early.problem.detail).toMatch(/AfterAuthorizationExpiry/);
    const paysSeller = await at.chain.submit(await b.mutual(1_000_000_000n, false), { sender: at.cast.buyer.key });
    expect(paysSeller.ok ? 'ok' : paysSeller.problem.type).toBe('deadline_passed');
    // Returning everything to the buyer is a void, which CPP allows after expiry.
    const refund = await at.chain.submit(await b.mutual(0n, false), { sender: at.cast.buyer.key });
    expect(refund.ok).toBe(true);
    expect(await at.chain.tokenBalance(at.cast.buyer.address)).toBe(100_000_000_000n);
  }, 60_000);

  it('gas per deal: every path settles, with its transaction count (D4)', async () => {
    const rows = await measure(world);
    const by = Object.fromEntries(rows.map((r) => [r.path, r]));
    expect(by['happy path (decision carries the delivery)']!.txs.map((t) => t.call)).toEqual(['agreeAndFund', 'decide']);
    expect(by['happy path (decision carries the delivery)']!.finalState).toBe('Released');
    expect(by['reject (fee-only capture + void)']!.finalState).toBe('Refunded');
    expect(by['reclaim (nothing delivered)']!.finalState).toBe('Refunded');
    expect(by['early accept (delivery carried)']!.finalState).toBe('Released');
    expect(by['mutual settlement (70/30, before delivery)']!.finalState).toBe('Settled');
    expect(by['party appeal (reject, buyer appeals, upheld)']!.finalState).toBe('Refunded');
    expect(by['escalation, then the appeal adjudicator decides']!.finalState).toBe('Released');
    expect(by['fallback (primary silent, fallback accepts)']!.finalState).toBe('Released');
    expect(by['default (primary and fallback silent)']!.finalState).toBe('Refunded');
    expect(by['operator fee bundled with funding, then accept']!.txs).toHaveLength(2);
    for (const r of rows) expect(r.total).toBeGreaterThan(0n);
    // Ten deals on anvil, each with clock warps; CI runners hit 180 s twice (PRs 77 and 83) while it passes locally.
  }, 420_000);
});
