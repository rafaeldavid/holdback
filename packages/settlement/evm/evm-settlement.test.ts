// EvmSettlement against the T-202 contracts on a local anvil (chain id 31337, 127.0.0.1 only). Needs `anvil` on
// PATH and `forge build` output in contracts/out; without them the suite is skipped with the reason in its name,
// which `pnpm verify` would show (it runs forge build first; see scripts/verify.ts).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { encodeFunctionData, getAddress, hashTypedData } from 'viem';
import { sign } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { authorizationExpiry } from '../sim/simchain.js';
import { RelayRefused } from './chain.js';
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

  it('operator fee relayed alone ahead of the bundle on LocalUSDC: the hold funds, paid by an earlier transaction', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'fee-front-run');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    const s = await d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 1_000_000n } });
    if (s.kind !== 'agree_and_fund' || !s.operatorFee) throw new Error('unreachable');
    await frontRun(world, cast.stranger.key, s.operatorFee, s.operatorFee.to, s.operatorFee.signature, chain.now());
    expect(await chain.tokenBalance(cast.operator.address)).toBe(1_000_000n);
    // LocalUSDC logs AuthorizationUsed then Transfer, as USDC does, so the earlier payment is proved.
    const r = await chain.submit(s, { via: 'op-1', sender: cast.operator.key });
    expect(r.ok ? r.state.escrowState : r.problem.type).toBe('Held');
    expect(chain.log().find((e) => e.type === 'fee.operator')?.payload).toMatchObject({ source: 'adapter', paid: 'by an earlier transaction' });
    expect(await chain.tokenBalance(cast.operator.address)).toBe(1_000_000n);
    expect(await chain.tokenBalance(cast.buyer.address)).toBe(100_000_000_000n - 2_050_000_000n - 1_000_000n);
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
