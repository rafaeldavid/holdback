// The operator fee (ADR-0023, D33), end to end over HTTP against one SimChain: an operator publishes its schedule,
// prepares the third signed slot, answers 402 when it is not paid, and the settlement layer moves the fee outside
// the hold. Each `it` is named after the fixture T-029 asks for; like the neutrality.operator-* fixtures, they run
// the real operator, because the fee lives in the operator and not in the stub operators of `pnpm snap`.
import { holdbackDomain, parseOperatorStatus, signMessage, type Address, type OperatorFeeSchedule, type SettlementEvent, type UnsignedMessage } from '@holdback/core';
import { Holdback } from '@holdback/sdk';
import { Deal, simActor, tusd } from '@holdback/settlement/sim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Prepared } from './prepare.js';
import { asOperation, world, type World } from './_world.js';

const FEES: Address = simActor('crow-fees', 'operator').address;
const D33: OperatorFeeSchedule = { to: FEES, token: 'tUSD', bps: 1, min: '10000', max: null, appliesAt: 'agree-and-fund', refundable: false };
const domain = holdbackDomain(31337);

let w: World;
beforeEach(async () => {
  w = await world();
});
afterEach(async () => w.close());

type J = Record<string, unknown>;
const call = async (base: string, method: 'GET' | 'POST', path: string, body?: unknown, key?: string) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as J };
};
const bal = async (a: Address) => BigInt((await w.chain.balances([a]))[a]!.amount);
const feeEvents = (): SettlementEvent[] => w.chain.log().filter((e) => e.type === 'fee.operator');

/** Offers and accepts `deal` directly on the chain: the fee concerns only the buyer's funded agreement. */
async function accepted(deal: Deal = w.deal): Promise<Deal> {
  for (const s of [await deal.offer(), await deal.accept()]) {
    const r = await w.chain.submit(s);
    if (!r.ok) throw new Error(r.problem.detail);
  }
  return deal;
}

/** The buyer signs every slot of a prepared agree-and-fund with its own key and returns the body to submit. */
async function signed(p: Prepared): Promise<J> {
  const body = structuredClone(p.submit.body) as J;
  const unsigned = (m: J) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'signature')) as unknown as UnsignedMessage;
  body['signature'] = await signMessage(w.cast.buyer.key, domain, unsigned(body as J & { fund?: J; operatorFee?: J }));
  for (const k of ['fund', 'operatorFee'] as const) if (body[k]) (body[k] as J)['signature'] = await signMessage(w.cast.buyer.key, domain, unsigned(body[k] as J));
  return body;
}
const withoutParts = (b: J): J => Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'fund' && k !== 'operatorFee'));

async function prepared(base: string, deal: Deal): Promise<Prepared> {
  const r = await call(base, 'POST', '/v1/prepare/agree-and-fund', { commitmentId: deal.id });
  expect(r.status).toBe(200);
  return r.body as unknown as Prepared;
}

describe('operator fee (ADR-0023)', () => {
  it('publishes the schedule in /v1/status and discovery, and none when the node charges nothing', async () => {
    const op = await w.operator('op-1', { fee: D33 });
    const status = (await call(op.url, 'GET', '/v1/status')).body;
    expect(parseOperatorStatus(status).ok).toBe(true);
    expect(status['fees']).toEqual({ operator: D33 });
    expect(status['schemaVersion']).toBe('0.8');
    expect((status['domain'] as J)['version']).toBe('0.6');
    expect(((await call(op.url, 'GET', '/.well-known/holdback.json')).body['fees'] as J)['operator']).toEqual(D33);
    const free = await w.operator('op-2');
    expect((await call(free.url, 'GET', '/v1/status')).body['fees']).toBeUndefined();
  });

  it('fee.operator-fee-posted: the third slot pays 1 bp of 2,000 tUSD to the operator, outside the hold', async () => {
    const op = await w.operator('op-1', { fee: D33 });
    await accepted();
    const p = await prepared(op.url, w.deal);
    expect(p.sign.map((s) => [s.slot, s.typedData.primaryType])).toEqual([
      ['signature', 'Agree'],
      ['fund.signature', 'FundingAuthorization'],
      ['operatorFee.signature', 'TransferAuthorization'],
    ]);
    const fee = (p.submit.body as J)['operatorFee'] as J;
    expect(fee).toMatchObject({ type: 'TransferAuthorization', purpose: 'operator_fee', to: FEES, value: '200000', token: 'tUSD', from: w.cast.buyer.address, commitmentId: w.deal.id });
    const line = p.check.find((c) => c.includes('operator fee'))!;
    expect(line).toContain('0.2 tUSD');
    expect(line).toContain('1 bp of the price');
    expect(line).toContain('not refunded');
    const before = await bal(w.cast.buyer.address);
    const r = await call(op.url, 'POST', p.submit.path, await signed(p), 'paid-1');
    expect([r.status, r.body['escrowState']]).toEqual([200, 'Held']);
    expect(feeEvents().map((e) => e.payload)).toEqual([expect.objectContaining({ to: FEES.toLowerCase(), amount: { token: 'tUSD', amount: '200000' } })]);
    expect(await bal(FEES)).toBe(200_000n);
    expect(before - (await bal(w.cast.buyer.address))).toBe(2_050_000_000n + 200_000n);
    expect((r.body['hold'] as { amount: { amount: string } }).amount.amount).toBe('2050000000');
  });

  it('fee.min-applies-below-100: a 25 tUSD deal pays the 0.01 tUSD minimum', async () => {
    const op = await w.operator('op-1', { fee: D33 });
    const deal = await accepted(new Deal(w.chain, w.cast, { club: w.club, price: tusd('25000000'), fee: tusd('1000000'), tag: 'small' }));
    const p = await prepared(op.url, deal);
    expect(((p.submit.body as J)['operatorFee'] as J)['value']).toBe('10000');
    expect(p.check.find((c) => c.includes('operator fee'))).toContain('0.01 tUSD');
    expect((await call(op.url, 'POST', p.submit.path, await signed(p), 'small-1')).status).toBe(200);
    expect(await bal(FEES)).toBe(10_000n);
  });

  it('fee.bps-rounds-up: 2,000.000001 tUSD pays 200,001 base units, not 200,000', async () => {
    const op = await w.operator('op-1', { fee: D33 });
    const deal = await accepted(new Deal(w.chain, w.cast, { club: w.club, price: tusd('2000000001'), tag: 'odd' }));
    const p = await prepared(op.url, deal);
    expect(((p.submit.body as J)['operatorFee'] as J)['value']).toBe('200001');
  });

  it('fee.kept-on-refund: nothing delivered, the buyer reclaims price and adjudication fee; the operator keeps its fee', async () => {
    const op = await w.operator('op-1', { fee: D33 });
    await accepted();
    const before = await bal(w.cast.buyer.address);
    const p = await prepared(op.url, w.deal);
    expect((await call(op.url, 'POST', p.submit.path, await signed(p), 'refund-1')).status).toBe(200);
    w.chain.advance((Date.parse(w.deal.terms.timing.deliverBy) - Date.parse(w.chain.now())) / 1000 + 1);
    const r = await w.chain.trigger(w.deal.id, 'reclaim');
    expect(r.ok && r.state.escrowState).toBe('Refunded');
    expect(before - (await bal(w.cast.buyer.address))).toBe(200_000n);
    expect(await bal(FEES)).toBe(200_000n);
  });

  it('error.operator-fee-short-402: no fee, a short fee or a fee to someone else gets 402 naming the fee; nothing moves', async () => {
    const op = await w.operator('op-1', { fee: D33 });
    await accepted();
    const p = await prepared(op.url, w.deal);
    const body = await signed(p);
    const unpaid = await call(op.url, 'POST', p.submit.path, { ...withoutParts(body), fund: body['fund'] }, 'unpaid');
    expect([unpaid.status, unpaid.body['type']]).toEqual([402, 'payment_required']);
    expect(unpaid.body['detail']).toContain('0.2 tUSD');
    expect(unpaid.body['detail']).toContain(FEES);
    expect(unpaid.body['detail']).toContain('directly');
    // A short fee, signed and otherwise valid.
    const short = structuredClone(p);
    ((short.submit.body as J)['operatorFee'] as J)['value'] = '199999';
    const r = await call(op.url, 'POST', p.submit.path, await signed(short), 'short');
    expect([r.status, r.body['type']]).toEqual([402, 'payment_required']);
    const elsewhere = structuredClone(p);
    ((elsewhere.submit.body as J)['operatorFee'] as J)['to'] = simActor('someone-else').address;
    expect((await call(op.url, 'POST', p.submit.path, await signed(elsewhere), 'elsewhere')).status).toBe(402);
    expect((await w.chain.state(w.deal.id))?.escrowState).toBe('AcceptedByAdjudicator');
    expect(feeEvents()).toEqual([]);
    // An agreement without funding moves no money and costs nothing.
    expect((await call(op.url, 'POST', p.submit.path, withoutParts(body), 'agree-only')).body['escrowState']).toBe('Agreed');
  });

  it('idempotency.paid-agree-replays: the same key replays the answer, the same body under a new key is refused; charged once', async () => {
    const op = await w.operator('op-1', { fee: D33 });
    await accepted();
    const p = await prepared(op.url, w.deal);
    const body = await signed(p);
    const first = await call(op.url, 'POST', p.submit.path, body, 'once');
    const again = await call(op.url, 'POST', p.submit.path, body, 'once');
    expect(again).toEqual(first);
    expect((await call(op.url, 'POST', p.submit.path, body, 'twice')).status).toBe(409);
    // Through the SDK under the same key, at another node: the settlement layer replays, nothing moves twice.
    const op2 = await w.operator('op-2');
    const hb = new Holdback({ operators: [op2.url] });
    const { signature, fund, operatorFee, ...agree } = body as J & { fund: never; operatorFee: never; signature: never };
    await hb.submit({ kind: 'agree', message: { ...agree, signature } as never, fund, operatorFee }, { idempotencyKey: 'once' });
    expect(feeEvents()).toHaveLength(1);
    expect(await bal(FEES)).toBe(200_000n);
  });

  it('neutrality.operator-fee-direct-submission-free: both nodes charge, the buyer pays neither, and the deal settles by direct submission', async () => {
    const op1 = await w.operator('op-1', { fee: D33 });
    const op2 = await w.operator('op-2', { fee: { ...D33, to: simActor('op-2-fees', 'operator').address } });
    await accepted();
    const hb = new Holdback({ operators: [op1.url, op2.url], settlement: w.chain });
    const held = await hb.submit(asOperation(await w.deal.agreeAndFund()));
    expect([held.via, held.state.escrowState]).toEqual(['direct', 'Held']);
    const delivered = await hb.submit(asOperation(await w.deal.deliver()));
    expect(delivered.via).toBe(op1.url); // deliveries are free at every node
    w.chain.advance(5);
    expect((await hb.submit(asOperation(await w.deal.decide('primary', 'accept')))).state.escrowState).toBe('Released');
    expect(feeEvents()).toEqual([]);
    expect(await bal(FEES)).toBe(0n);
  });

  it('a node with a fee of 0 prepares two slots, as before', async () => {
    const op = await w.operator('op-1', { fee: { ...D33, bps: 0, min: '0' } });
    await accepted();
    const p = await prepared(op.url, w.deal);
    expect(p.sign.map((s) => s.slot)).toEqual(['signature', 'fund.signature']);
    expect((await call(op.url, 'POST', p.submit.path, await signed(p), 'zero')).body['escrowState']).toBe('Held');
    expect(feeEvents()).toEqual([]);
  });
});
