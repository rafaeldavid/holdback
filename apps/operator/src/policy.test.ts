// The relay policy hook (ADR-0005, T-018): an operator may refuse to relay for a party. The refusal is the
// operator's own; it has no authority over the commitment, so the SDK fails over to another operator or
// submits directly, and the deal settles on its terms (neutrality.operator-refuses, demo beat 7).
import { Holdback, HoldbackError } from '@holdback/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asOperation, holdOf, world, type World } from './_world.js';
import { refuseParties } from './policy.js';

let w: World;
beforeEach(async () => {
  w = await world();
});
afterEach(async () => w.close());

describe('refuseParties: an operator refuses to relay for one party', () => {
  it('refuses every operation on a commitment where the party is buyer or seller, whoever signs it', async () => {
    const seller = w.cast.seller.address;
    const op1 = await w.operator('op-1', { policy: refuseParties([seller], 'op-1 does not relay for this seller') });
    const only1 = new Holdback({ operators: [op1.url] });
    const hold = await holdOf(w.deal);
    // The hold is signed by the buyer, but the commitment names the refused seller.
    const e = await only1.hold(hold).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HoldbackError);
    expect((e as HoldbackError).problem.type).toBe('member_not_admitted');
    expect((e as HoldbackError).problem.status).toBe(403);
    expect((e as HoldbackError).problem.detail).toBe('op-1 does not relay for this seller');
    expect(w.chain.log()).toHaveLength(0);
  });

  it('refuses operations on a commitment it learned from the settlement log (delivery and decision carry no party address)', async () => {
    const op1 = await w.operator('op-1', { policy: refuseParties([w.cast.seller.address]) });
    const op2 = await w.operator('op-2');
    // The hold goes in through op-2; op-1 sees the commitment only on its event log.
    await new Holdback({ operators: [op2.url] }).hold(await holdOf(w.deal));
    const e = await new Holdback({ operators: [op1.url] }).submit(asOperation(await w.deal.deliver())).catch((x: unknown) => x);
    expect((e as HoldbackError).problem.type).toBe('member_not_admitted');
    expect((e as HoldbackError).problem.detail).toMatch(/operator policy/);
  });

  it('relays for everyone else: a policy naming another address does not refuse this deal', async () => {
    const op1 = await w.operator('op-1', { policy: refuseParties([w.cast.appeal.address]) });
    const r = await new Holdback({ operators: [op1.url] }).hold(await holdOf(w.deal));
    expect([r.via, r.state.escrowState]).toEqual([op1.url, 'Held']);
  });

  it('neutrality.operator-refuses through the hook: op-1 refuses the seller, the SDK fails over to op-2 and the deal is released', async () => {
    const op1 = await w.operator('op-1', { policy: refuseParties([w.cast.seller.address]) });
    const op2 = await w.operator('op-2');
    const hb = new Holdback({ operators: [op1.url, op2.url] });
    const vias = [(await hb.hold(await holdOf(w.deal))).via, (await hb.submit(asOperation(await w.deal.deliver()))).via];
    w.chain.advance(5);
    const last = await hb.submit(asOperation(await w.deal.decide('primary', 'accept')));
    expect([...vias, last.via]).toEqual([op2.url, op2.url, op2.url]);
    expect(last.state.escrowState).toBe('Released');
  });

  it('with op-2 down as well, the SDK submits directly to the settlement layer and the deal is released', async () => {
    const op1 = await w.operator('op-1', { policy: refuseParties([w.cast.seller.address]) });
    const op2 = await w.operator('op-2');
    await op2.close();
    const hb = new Holdback({ operators: [op1.url, op2.url], settlement: w.chain, requestTimeoutMs: 500 });
    const vias = [(await hb.hold(await holdOf(w.deal))).via, (await hb.submit(asOperation(await w.deal.deliver()))).via];
    w.chain.advance(5);
    const last = await hb.submit(asOperation(await w.deal.decide('primary', 'accept')));
    expect([...vias, last.via]).toEqual(['direct', 'direct', 'direct']);
    expect(last.state.escrowState).toBe('Released');
  });
});
