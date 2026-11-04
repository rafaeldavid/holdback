// EvmSettlement against the T-202 contracts on a local anvil (chain id 31337, 127.0.0.1 only). Needs `anvil` on
// PATH and `forge build` output in contracts/out; without them the suite is skipped with the reason in its name,
// which `pnpm verify` would show (it runs forge build first; see scripts/verify.ts).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryHash, parseEvent, wholeSecond, type Club, type Hex32, type Mandate, type SettlementEvent } from '@holdback/core';
import { encodeFunctionData, getAddress, hashTypedData, keccak256, stringToBytes, type Hex } from 'viem';
import { sign } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { authorizationExpiry, type Genesis } from '../sim/simchain.js';
import type { Submission } from '../src/interface.js';
import { RelayRefused, type LaneRow } from './chain.js';
import { EvmSettlement, type Book } from './evm-settlement.js';
import { measurePath, must, newSettlement, PATHS } from './gas.js';
import { ensureBond, LiveChain, type DeploymentFile, type LaneStore } from './live.js';
import { evmCast, evmGenesis, EvmDeal } from './testing.js';
import { anvilAvailable, EvmWorld, EXPIRY_MARGIN } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));

/** Every event the adapter emitted that event.schema.json refuses (core's parser, Ajv strict), with the reason. */
const eventSchemaErrors = (log: readonly SettlementEvent[]): string[] =>
  log.flatMap((e) => {
    const r = parseEvent(e);
    return r.ok ? [] : [`#${e.seq} ${e.type}: ${r.error.detail}`];
  });

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
    // A second submission: the contract reverts InvalidMessage, which core names submission_limit_reached.
    const second = await chain.submit(await d.deliver(2), { sender: cast.seller.key });
    expect(second.ok ? 'ok' : second.problem.type).toBe('submission_limit_reached');
    const carried = await d.deliver(2);
    expect(carried.kind === 'deliver' ? (await chain.carryDelivery(carried.delivery))?.type : carried.kind).toBe('submission_limit_reached');
    expect(chain.escrowState(d.id)?.kind).toBe('Held');
    // Settle twice.
    await must(chain, cast, d.deliver());
    await must(chain, cast, d.decide('primary', 'accept'));
    const again = await chain.submit(await d.decide('primary', 'reject'), { sender: cast.primary.key });
    expect(again.ok ? 'ok' : again.problem.type).toBe('invalid_state');
    expect(chain.transactions().map((t) => t.call)).toEqual(['agreeAndFund', 'deliver', 'decide']);
  }, 60_000);

  // ADR-0029: a signature that names a delivery other than the posted one is refused as SimChain refuses it, and the
  // contract's deliveryHashOf, the mirror and the read model name the same delivery.
  it('an early accept or a decision naming another delivery is refused; the read model names the posted delivery', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'binding');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    await must(chain, cast, d.agreeAndFund());
    await must(chain, cast, d.deliver());
    const posted = deliveryHash(d.delivery!);
    const other = `0x${'4b'.repeat(32)}` as const;
    const early = await chain.submit(await d.earlyAccept({ deliveryHash: other }), { sender: cast.buyer.key });
    expect(early.ok ? 'ok' : early.problem.type).toBe('invalid_terms');
    const decided = await chain.submit(await d.decide('primary', 'accept', undefined, { deliveryHash: other }), { sender: cast.primary.key });
    expect(decided.ok ? 'ok' : decided.problem.type).toBe('invalid_terms');
    expect(await world.publicClient.readContract({ address: world.deployment.rules, abi: world.abis.rules, functionName: 'deliveryHashOf', args: [d.id] })).toBe(posted);
    expect((await chain.state(d.id))?.deliveryHash).toBe(posted);
    await must(chain, cast, d.decide('primary', 'accept'));
    expect((await chain.state(d.id))?.deliveryHash).toBe(posted);
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

  it('the buyer cancels the fee authorization before the relay: payment_required, not a free relay', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'fee-cancelled');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    const s = await d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 1_000_000n } });
    if (s.kind !== 'agree_and_fund' || !s.operatorFee) throw new Error('unreachable');
    // USDC's cancelAuthorization spends the fee nonce and moves nothing; authorizationState then reads true.
    const buyer = getAddress(cast.buyer.address);
    const nonce = s.operatorFee.nonce;
    const hash = hashTypedData({ domain: chain.tokenDomain(), types: { CancelAuthorization: [{ name: 'authorizer', type: 'address' }, { name: 'nonce', type: 'bytes32' }] }, primaryType: 'CancelAuthorization', message: { authorizer: buyer, nonce } });
    const cancel = encodeFunctionData({ abi: world.abis.token, functionName: 'cancelAuthorization', args: [buyer, nonce, await sign({ hash, privateKey: cast.buyer.key, to: 'hex' })] });
    expect((await world.send({ key: cast.buyer.key, to: world.deployment.token, data: cancel }, Date.parse(chain.now()) / 1000)).status).toBe('success');
    expect(await world.publicClient.readContract({ address: world.deployment.token, abi: world.abis.token, functionName: 'authorizationState', args: [buyer, nonce] })).toBe(true);
    const r = await chain.submit(s, { via: 'op-1', sender: cast.operator.key });
    expect(r.ok ? 'ok' : r.problem.type).toBe('payment_required');
    expect(chain.escrowState(d.id)?.kind).toBe('AcceptedByAdjudicator');
    expect(chain.transactions()).toHaveLength(0);
    expect(await chain.tokenBalance(cast.operator.address)).toBe(0n);
    expect(chain.log().map((e) => e.type)).not.toContain('commitment.agreed');
    // Another operator, or the buyer directly, can still fund the hold without this operator's fee.
    const funded = await chain.submit({ kind: 'agree_and_fund', agree: s.agree, funding: s.funding }, { via: 'op-2', sender: cast.operator.key });
    expect(funded.ok ? funded.state.escrowState : funded.problem.type).toBe('Held');
    expect(await chain.tokenBalance(cast.buyer.address)).toBe(100_000_000_000n - 2_050_000_000n);
  }, 60_000);

  it('a relay the lanes refuse is relay_refused, changes nothing, and the same agreement can be sent again', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'relay-refused');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    const s = await d.agreeAndFund();
    const refused = vi.spyOn(world, 'send').mockRejectedValueOnce(new RelayRefused('the gas estimate is above the cap'));
    try {
      const r = await chain.submit(s, { via: 'op-1', sender: cast.operator.key });
      expect(r.ok ? 'ok' : r.problem.type).toBe('relay_refused');
    } finally {
      refused.mockRestore();
    }
    expect(chain.escrowState(d.id)?.kind).toBe('AcceptedByAdjudicator');
    expect(chain.log().map((e) => e.type)).not.toContain('commitment.agreed');
    // The agreement's nonce and the buyer's daily spend were given back: the same signed messages fund.
    const again = await chain.submit(s, { via: 'op-1', sender: cast.operator.key });
    expect(again.ok ? again.state.escrowState : again.problem.type).toBe('Held');
    expect(chain.log().filter((e) => e.type === 'commitment.agreed')).toHaveLength(1);
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

  it('an overturned accept pays the buyer the price from the primary’s bond, as SimChain reports it (T-206 I-8)', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const [b0, s0, p0] = [await chain.tokenBalance(cast.buyer.address), await chain.tokenBalance(cast.seller.address), await chain.bondOf(cast.primary.address)];
    const id = await PATHS['party appeal (accept, buyer appeals, overturned)']!(chain, cast, club);
    expect((await chain.stage(id)).appeal).toBe(3); // HoldbackRules.AppealState.Overturned
    // The buyer paid price + fee, got its appeal bond back and the price from the bond: it is down only the fee.
    expect(b0 - (await chain.tokenBalance(cast.buyer.address))).toBe(50_000_000n);
    expect((await chain.tokenBalance(cast.seller.address)) - s0).toBe(2_000_000_000n);
    expect(p0 - (await chain.bondOf(cast.primary.address))).toBe(2_000_000_000n);
    const log = chain.log();
    const decided = log.findIndex((e) => e.type === 'appeal.decided');
    expect(log.slice(decided).map((e) => e.type)).toEqual(['appeal.decided', 'bond.slashed']);
    const slashed = log[decided + 1]!;
    expect(slashed.actor).toBe('anyone');
    // SimChain's payload plus the transaction, which event.schema.json admits since v0.9 (ChainTx): the same one as
    // the appeal.decided event before it.
    const { tx, block, sender, gasUsed } = log[decided]!.payload as Record<string, unknown>;
    expect(slashed.payload).toEqual({ adjudicator: cast.primary.address, junior: { token: expect.any(String), amount: '2000000000' }, senior: { token: expect.any(String), amount: '0' }, reason: 'overturn', tx, block, sender, gasUsed });
    expect(tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(eventSchemaErrors(log)).toEqual([]);
    expect(await chain.replayCheck()).toMatchObject({ ok: true });
  }, 120_000);

  // Gas per deal (D4), one test per path so a slow path names itself. Each runs a warm-up deal and then the path.
  const SETTLES: Record<string, { calls: string[]; finalState: string }> = {
    'happy path (decision carries the delivery)': { calls: ['agreeAndFund', 'decide'], finalState: 'Released' },
    'happy path with an on-chain deliver': { calls: ['agreeAndFund', 'deliver', 'decide'], finalState: 'Released' },
    'reject (fee-only capture + void)': { calls: ['agreeAndFund', 'decide'], finalState: 'Refunded' },
    'reclaim (nothing delivered)': { calls: ['agreeAndFund', 'reclaim'], finalState: 'Refunded' },
    'early accept (delivery carried)': { calls: ['agreeAndFund', 'earlyAccept'], finalState: 'Released' },
    'mutual settlement (70/30, before delivery)': { calls: ['agreeAndFund', 'mutualSettle'], finalState: 'Settled' },
    'party appeal (reject, seller appeals, upheld)': { calls: ['agreeAndFund', 'decide', 'fileAppeal', 'decide'], finalState: 'Refunded' },
    'party appeal (accept, buyer appeals, overturned)': { calls: ['agreeAndFund', 'decide', 'fileAppeal', 'decide'], finalState: 'Released' },
    'escalation, then the appeal adjudicator decides': { calls: ['agreeAndFund', 'decide', 'decide'], finalState: 'Released' },
    'fallback (primary silent, fallback accepts)': { calls: ['agreeAndFund', 'deliver', 'triggerFallback', 'decide'], finalState: 'Released' },
    'default (primary and fallback silent)': { calls: ['agreeAndFund', 'deliver', 'triggerFallback', 'triggerDefault'], finalState: 'Refunded' },
    'operator fee bundled with funding, then accept': { calls: ['agreeAndFund', 'decide'], finalState: 'Released' },
  };

  it('gas per deal covers every path (D4)', () => {
    expect(Object.keys(SETTLES)).toEqual(Object.keys(PATHS));
  });

  // Schema v0.9 (review of PR 160): every event the adapter emits, chain fields included, is a valid event.
  it('every event on every path validates against event.schema.json', async () => {
    const { chain, cast, club } = await newSettlement(world);
    for (const run of Object.values(PATHS)) await run(chain, cast, club);
    const types = new Set(chain.log().map((e) => e.type));
    for (const t of ['fee.operator', 'commitment.settled', 'bond.slashed', 'delivery.submitted', 'judgment.decided']) expect(types, t).toContain(t);
    expect(eventSchemaErrors(chain.log())).toEqual([]);
  }, 300_000);

  for (const [path, want] of Object.entries(SETTLES)) {
    it(`gas per deal: ${path} settles ${want.finalState} in ${want.calls.length} transactions (D4)`, async () => {
      const row = await measurePath(world, path);
      expect(row.txs.map((t) => t.call)).toEqual(want.calls);
      expect(row.finalState).toBe(want.finalState);
      for (const t of row.txs) expect(t.gasUsed).toBeGreaterThan(0n);
    });
  }
});

/** A mempool watcher sends the buyer's signed fee transfer by itself (transferWithAuthorization is permissionless). */
async function frontRun(world: EvmWorld, key: `0x${string}`, f: { from: string; value: string; validAfter: string; validBefore: string; nonce: `0x${string}` }, to: string, signature: `0x${string}`, now: string): Promise<void> {
  const data = encodeFunctionData({ abi: world.abis.token, functionName: 'transferWithAuthorization', args: [getAddress(f.from), getAddress(to), BigInt(f.value), BigInt(Date.parse(f.validAfter) / 1000), BigInt(Date.parse(f.validBefore) / 1000), f.nonce, signature] });
  expect((await world.send({ key, to: world.deployment.token, data }, Date.parse(now) / 1000)).status).toBe('success');
}

// tUSDC, the Sepolia demo's token (D42), logs AuthorizationUsed, so the adapter can tell whether an earlier use of the
// fee nonce paid this operator (ADR-0023).
describe.skipIf(!ready)(`EvmSettlement on anvil with tUSDC${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root, { token: 'test-usdc' });
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });

  it('the fee relayed alone ahead of the bundle paid this operator: the hold funds, paid by an earlier transaction', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'tusdc-front-run');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    const s = await d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 1_000_000n } });
    if (s.kind !== 'agree_and_fund' || !s.operatorFee) throw new Error('unreachable');
    await frontRun(world, cast.stranger.key, s.operatorFee, s.operatorFee.to, s.operatorFee.signature, chain.now());
    const r = await chain.submit(s, { via: 'op-1', sender: cast.operator.key });
    expect(r.ok ? r.state.escrowState : r.problem.type).toBe('Held');
    expect(await chain.tokenBalance(cast.operator.address)).toBe(1_000_000n);
    expect(await chain.tokenBalance(cast.buyer.address)).toBe(100_000_000_000n - 2_050_000_000n - 1_000_000n);
    expect(chain.log().find((e) => e.type === 'fee.operator')?.payload).toMatchObject({ source: 'adapter', paid: 'by an earlier transaction' });
  }, 60_000);

  it('the buyer spent the fee nonce paying someone else: payment_required, nothing held, and the funding alone still works', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'tusdc-fee-spent');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    const s = await d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 1_000_000n } });
    if (s.kind !== 'agree_and_fund' || !s.operatorFee) throw new Error('unreachable');
    const f = s.operatorFee;
    // The same nonce over a transfer to the buyer's friend: the fee nonce is used, and this operator is not paid.
    const elsewhere = await chain.operatorFeeAuthorization(d.id, cast.buyer.address, cast.stranger.address, 1_000_000n, f.validAfter, f.validBefore);
    expect(elsewhere.nonce).toBe(f.nonce);
    await frontRun(world, cast.buyer.key, f, cast.stranger.address, await sign({ hash: elsewhere.digest, privateKey: cast.buyer.key, to: 'hex' }), chain.now());
    const r = await chain.submit(s, { via: 'op-1', sender: cast.operator.key });
    expect(r.ok ? 'ok' : r.problem.type).toBe('payment_required');
    expect(chain.escrowState(d.id)?.kind).toBe('AcceptedByAdjudicator');
    expect(chain.transactions()).toHaveLength(0);
    expect(await chain.tokenBalance(cast.operator.address)).toBe(0n);
    expect(chain.log().map((e) => e.type)).not.toContain('commitment.agreed');
    // Another operator, or the buyer directly, can still fund the hold without this operator's fee.
    const funded = await chain.submit({ kind: 'agree_and_fund', agree: s.agree, funding: s.funding }, { via: 'op-2', sender: cast.operator.key });
    expect(funded.ok ? funded.state.escrowState : funded.problem.type).toBe('Held');
  }, 60_000);

  it("another transfer to this operator in the same transaction is not the fee nonce's payment", async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'tusdc-fee-elsewhere-batched');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    const s = await d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 1_000_000n } });
    if (s.kind !== 'agree_and_fund' || !s.operatorFee) throw new Error('unreachable');
    const f = s.operatorFee;
    // One transaction: the fee nonce pays the buyer's friend, and another authorization pays the operator the same.
    const twa = async (id: `0x${string}`, to: `0x${string}`) => {
      const a = await chain.operatorFeeAuthorization(id, cast.buyer.address, to, 1_000_000n, f.validAfter, f.validBefore);
      const signature = await sign({ hash: a.digest, privateKey: cast.buyer.key, to: 'hex' });
      return encodeFunctionData({ abi: world.abis.token, functionName: 'transferWithAuthorization', args: [getAddress(cast.buyer.address), getAddress(to), 1_000_000n, 0n, BigInt(Date.parse(f.validBefore) / 1000), a.nonce, signature] });
    };
    const calls = [await twa(d.id, cast.stranger.address), await twa(`0x${'22'.repeat(32)}`, cast.operator.address)].map((callData) => ({ target: world.deployment.token, allowFailure: false, callData }));
    const data = encodeFunctionData({ abi: world.abis.multicall, functionName: 'aggregate3', args: [calls] });
    expect((await world.send({ key: cast.stranger.key, to: world.deployment.multicall, data }, Date.parse(chain.now()) / 1000)).status).toBe('success');
    expect(await chain.tokenBalance(cast.operator.address)).toBe(1_000_000n);
    const r = await chain.submit(s, { via: 'op-1', sender: cast.operator.key });
    expect(r.ok ? 'ok' : r.problem.type).toBe('payment_required');
    expect(chain.escrowState(d.id)?.kind).toBe('AcceptedByAdjudicator');
  }, 60_000);
});

/** What a world keeps in storage for its settlement and its lanes (T-219), and what a restart would read from it. */
class Saved implements LaneStore {
  books = new Map<Hex32, Book>();
  events: SettlementEvent[] = [];
  mandates: Mandate[] = [];
  rows = new Map<string, LaneRow>();
  writes = 0;
  removes = 0;
  async load(): Promise<LaneRow[]> {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
  async write(row: LaneRow): Promise<void> {
    this.writes++;
    this.rows.set(`${row.lane}:${row.nonce}`, structuredClone(row));
  }
  async remove(rows: readonly LaneRow[]): Promise<void> {
    for (const r of rows) if (this.rows.delete(`${r.lane}:${r.nonce}`)) this.removes++;
  }
  /** The world's persist: the books and events, then the rows their receipts applied. */
  async persist(s: EvmSettlement): Promise<void> {
    const c = s.drain();
    for (const [id, b] of c.books) this.books.set(id, b);
    this.events.push(...c.events);
    this.mandates.push(...c.mandates);
    await (s.world as LiveChain).release(c.relayed);
  }
  /** What a Durable Object restarted at this moment reads. */
  copy(): Saved {
    const out = new Saved();
    out.books = structuredClone(this.books);
    out.events = structuredClone(this.events);
    out.mandates = structuredClone(this.mandates);
    out.rows = structuredClone(this.rows);
    return out;
  }
}

describe.skipIf(!ready)(`relayed transactions a restart left in flight (T-219; anvil standing in for Sepolia)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  let genesis: Genesis;
  let club: Club;
  const cast = evmCast();
  /** A relayer secret for this suite only (anvil; guards no value). */
  const relayer = keccak256(stringToBytes('t-219/settlement-relayer'));
  const chainOf = () => new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: relayer, pollMs: 100, mintBatchMs: 50 });
  /** A settlement opened on what `saved` holds, its chain attached to the rows there. */
  const open = async (saved: Saved) => {
    const chain = chainOf();
    await chain.attach(saved);
    return EvmSettlement.restore(chain, genesis, { books: [...saved.books], events: saved.events, mandates: saved.mandates });
  };
  const mining = (on: boolean) => anvil.rpc('evm_setIntervalMining', [on ? 1 : 0]);
  /**
   * Submits on `s` with mining held back, and copies the storage once the lane's row is written and the transaction is
   * in anvil's pool: what a Durable Object restarted between the broadcast and the receipt reads. Then mining goes on.
   */
  const interrupted = async (s: EvmSettlement, saved: Saved, sub: Submission, key: string, via?: string) => {
    await mining(false);
    const before = saved.writes;
    const relayed = s.submit(sub, { idempotencyKey: key, ...(via ? { via } : {}) });
    for (let i = 0; i < 300 && saved.writes === before; i++) await new Promise((r) => setTimeout(r, 20));
    for (let i = 0; i < 300 && (await anvil.rpc<{ pending: Hex }>('txpool_status', [])).pending === '0x0'; i++) await new Promise((r) => setTimeout(r, 20));
    const copy = saved.copy();
    expect(copy.rows.size).toBe(1);
    await mining(true);
    const r = await relayed;
    if (!r.ok) throw new Error(`${sub.kind}: ${r.problem.type}: ${r.problem.detail}`);
    return { copy, uninterrupted: r };
  };
  /** The events of one commitment, as the log holds them. */
  const of = (s: EvmSettlement, id: Hex32) => s.log().filter((e) => e.commitmentId === id);

  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    const d = anvil.deployment;
    deployment = {
      chainId: anvil.chainId,
      fromBlock: Number(d.fromBlock),
      token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
      escrow: d.escrow,
      erc3009Collector: d.erc3009Collector,
      permit2Collector: d.permit2Collector,
      multicall: d.multicall,
      rules: d.rules,
      bonds: d.bonds,
      beacon: d.beacon,
      expiryMarginSec: Number(anvil.expiryMargin),
    };
    const setup = chainOf();
    for (const a of [...setup.lanes.map((l) => l.address), ...Object.values(cast).map((a) => a.address)]) await anvil.rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']);
    ({ genesis, club } = await evmGenesis({ cast, token: d.token.toLowerCase(), chainId: anvil.chainId, rules: d.rules, start: wholeSecond(Date.now()), buyer: 0n, bond: 0n }));
    // The world's sim beacon is the contract's SimBeacon, deployed with the zero seed (world.ts).
    genesis = { ...genesis, simSeed: `0x${'00'.repeat(32)}` };
    await setup.mint(cast.buyer.address, 10n ** 12n);
    for (const a of [cast.primary, cast.fallback, cast.appeal]) await ensureBond(setup, a.key, 50_000_000_000n, 10n ** 18n);
  }, 180_000);
  afterAll(async () => {
    await anvil?.rpc('evm_setIntervalMining', [1]).catch(() => undefined);
    await anvil?.stop();
  });

  it('a funding, a delivery and a decision each land as the relay after a restart; a retry replays the mined result', async () => {
    const saved = new Saved();
    const a = await open(saved);
    const d = new EvmDeal(a, cast, club, 'restart-mid-step');
    for (const sub of [await d.offer(), await d.accept()]) expect((await a.submit(sub, { via: 'op-1' })).ok).toBe(true);
    await saved.persist(a);

    // The funding (the operator fee rides in the same bundle). The client's retry lands it first, then replays it.
    const fund = await d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 4_710_000n } });
    const f = await interrupted(a, saved, fund, 'k-fund', 'op-1');
    const b = await open(f.copy);
    const retry = await b.submit(fund, { idempotencyKey: 'k-fund', via: 'op-1' });
    expect(retry).toMatchObject({ ok: true, replayed: true, state: { escrowState: 'Held' } });
    // The same events the uninterrupted relay wrote: the operator's label, the adapter's agreement, the fee line.
    expect(of(b, d.id)).toEqual(of(a, d.id));
    expect(of(b, d.id).slice(-3).map((e) => [e.type, e.submittedVia, e.payload['source'] ?? null])).toEqual([
      ['commitment.agreed', 'op-1', 'adapter'],
      ['fee.operator', 'op-1', null],
      ['hold.funded', 'op-1', null],
    ]);
    expect(retry.ok && retry.events.map((e) => e.type)).toEqual(f.uninterrupted.events.map((e) => e.type));
    // The same key with another body is a conflict (hard rule: idempotency).
    const other = await b.submit(await d.agreeAndFund(), { idempotencyKey: 'k-fund', via: 'op-1' });
    expect(other.ok ? 'ok' : other.problem.type).toBe('idempotency_conflict');
    await f.copy.persist(b);
    expect(f.copy.rows.size).toBe(0);

    // The delivery: the next pass's recovery holds the seller-signed delivery, so the primary gets its envelope.
    const deliver = await d.deliver();
    const g = await interrupted(b, f.copy, deliver, 'k-deliver', 'op-1');
    const c = await open(g.copy);
    expect(await c.recover()).toMatchObject({ applied: 1, failed: 0 });
    expect(of(c, d.id)).toEqual(of(b, d.id));
    expect(of(c, d.id).slice(-2).map((e) => [e.type, e.submittedVia])).toEqual([
      ['delivery.submitted', 'op-1'],
      ['key.released', 'op-1'],
    ]);
    expect(await c.keysFor(d.id, cast.primary.address)).toHaveLength(1);
    expect(await c.submit(deliver, { idempotencyKey: 'k-deliver', via: 'op-1' })).toMatchObject({ ok: true, replayed: true, state: { escrowState: 'Delivered' } });
    await g.copy.persist(c);

    // The decision, as the demo's adjudicators submit it (no operator label): Released, and the buyer's key is served.
    const decide = await d.decide('primary', 'accept');
    const h = await interrupted(c, g.copy, decide, 'k-decide');
    const e = await open(h.copy);
    expect(await e.recover()).toMatchObject({ applied: 1 });
    expect((await e.state(d.id))!.escrowState).toBe('Released');
    expect(await e.keysFor(d.id, cast.buyer.address)).toHaveLength(1);
    expect(of(e, d.id)).toEqual(of(c, d.id));
    expect(e.log().some((x) => x.commitmentId === d.id && x.type === 'judgment.decided' && x.submittedVia === 'direct')).toBe(true);
    await h.copy.persist(e);
    // A later pass has nothing left: the rows are gone once the books are written.
    expect(h.copy.rows.size).toBe(0);
    expect(await e.recover()).toMatchObject({ applied: 0, seen: 0 });
    // One row written and one removed per transaction, across the three restarts (each copy counts its own writes).
    expect([saved.writes, f.copy.writes, g.copy.writes, h.copy.writes]).toEqual([1, 1, 1, 0]);
    expect(f.copy.removes + g.copy.removes + h.copy.removes).toBe(3);
  }, 120_000);
});
