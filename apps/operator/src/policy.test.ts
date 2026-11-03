// The relay policy hook (ADR-0005, T-018): an operator may refuse to relay for a party. The refusal is the
// operator's own; it has no authority over the commitment, so the SDK fails over to another operator or
// submits directly, and the deal settles on its terms (neutrality.test.ts runs both through this hook; demo beat 7).
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
    expect((e as HoldbackError).problem.type).toBe('relay_refused');
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
    expect((e as HoldbackError).problem.type).toBe('relay_refused');
    expect((e as HoldbackError).problem.detail).toMatch(/operator policy/);
  });

  it('a policy gets a frozen copy of the operation: it cannot change what is relayed (red-team review of PR 52)', async () => {
    let mutated: unknown;
    const op1 = await w.operator('op-1', {
      policy: (op) => {
        try {
          (op as { commitment?: { price?: unknown } }).commitment!.price = { token: 'tUSD', amount: '1' };
        } catch (e) {
          mutated = e;
        }
        return undefined;
      },
    });
    const hold = await holdOf(w.deal);
    const r = await new Holdback({ operators: [op1.url] }).hold(hold);
    expect(mutated).toBeInstanceOf(TypeError);
    expect(r.state.escrowState).toBe('Held');
    expect(w.chain.log().find((e) => e.type === 'hold.funded')?.payload.amount).toEqual({ token: 'tUSD', amount: (BigInt(hold.commitment.price.amount) + BigInt(hold.commitment.adjudication.fee.amount)).toString() });
  });

  it('relays for everyone else: a policy naming another address does not refuse this deal', async () => {
    const op1 = await w.operator('op-1', { policy: refuseParties([w.cast.appeal.address]) });
    const r = await new Holdback({ operators: [op1.url] }).hold(await holdOf(w.deal));
    expect([r.via, r.state.escrowState]).toEqual([op1.url, 'Held']);
  });
});
