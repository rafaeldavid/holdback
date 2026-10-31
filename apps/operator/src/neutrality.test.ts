// Neutrality (ADR-0001, ADR-0005, ADR-0017 §3): two operator nodes over one SimChain. Whatever an operator does
// (refuse, go offline, throttle, drop a response after relaying), the SDK completes the commitment through the
// other operator or straight to the settlement layer, and nothing is applied twice.
import { problem } from '@holdback/core';
import { Holdback } from '@holdback/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asOperation, holdOf, world, type World } from './_world.js';

let w: World;
beforeEach(async () => {
  w = await world();
});
afterEach(async () => w.close());

/** The demo path through an SDK client: hold, deliver, decide, released. */
async function demoPath(hb: Holdback) {
  const vias: string[] = [];
  vias.push((await hb.hold(await holdOf(w.deal))).via);
  vias.push((await hb.submit(asOperation(await w.deal.deliver()))).via);
  w.chain.advance(5);
  const last = await hb.submit(asOperation(await w.deal.decide('primary', 'accept')));
  vias.push(last.via);
  return { vias, state: last.state };
}

describe('two operators on one SimChain', () => {
  it('both serve the same commitment: a write through op-1 is readable through op-2', async () => {
    const op1 = await w.operator('op-1');
    const op2 = await w.operator('op-2');
    await new Holdback({ operators: [op1.url] }).hold(await holdOf(w.deal));
    expect((await new Holdback({ operators: [op2.url] }).commitment(w.deal.id))?.escrowState).toBe('Held');
    const s1 = await (await fetch(`${op1.url}/v1/status`)).json();
    const s2 = await (await fetch(`${op2.url}/v1/status`)).json();
    expect(s1.receiptSigner).not.toBe(s2.receiptSigner);
  });

  it('neutrality.operator-refuses: op-1 refuses every relay, op-2 settles the deal', async () => {
    const op1 = await w.operator('op-1', { policy: () => problem('invalid_state', 'this operator does not relay for you') });
    const op2 = await w.operator('op-2');
    const { vias, state } = await demoPath(new Holdback({ operators: [op1.url, op2.url] }));
    expect(vias).toEqual([op2.url, op2.url, op2.url]);
    expect(state.escrowState).toBe('Released');
  });

  it('neutrality.operator-offline: op-1 refuses and op-2 is offline, so the SDK submits directly and the deal settles', async () => {
    const op1 = await w.operator('op-1', { policy: () => problem('invalid_state', 'refused') });
    const op2 = await w.operator('op-2');
    await op2.close();
    const { vias, state } = await demoPath(new Holdback({ operators: [op1.url, op2.url], settlement: w.chain, requestTimeoutMs: 500 }));
    expect(vias).toEqual(['direct', 'direct', 'direct']);
    expect(state.escrowState).toBe('Released');
    expect(w.chain.log().every((e) => e.submittedVia === 'direct')).toBe(true);
  });

  it('neutrality.operator-rate-limits: op-1 throttles, the SDK waits once, fails over to op-2, then goes direct, and the hold settles', async () => {
    const op1 = await w.operator('op-1', { rateLimit: { writes: 0, reads: 100, windowMs: 3_600_000 } });
    const op2 = await w.operator('op-2');
    const waits: number[] = [];
    const hb = new Holdback({ operators: [op1.url, op2.url], settlement: w.chain, sleep: async (ms) => void waits.push(ms) });
    expect((await hb.hold(await holdOf(w.deal))).via).toBe(op2.url);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeLessThanOrEqual(2000);
    await op2.close();
    const delivered = await hb.submit(asOperation(await w.deal.deliver()));
    expect(delivered.via).toBe('direct');
    w.chain.advance(5);
    expect((await hb.submit(asOperation(await w.deal.decide('primary', 'accept')))).state.escrowState).toBe('Released');
  });

  it('a call op-1 relayed but whose response was lost completes through op-2 under the same key, applied once', async () => {
    const op1 = await w.operator('op-1', { dropResponses: true });
    const op2 = await w.operator('op-2');
    const hb = new Holdback({ operators: [op1.url, op2.url], requestTimeoutMs: 500 });
    const r = await hb.hold(await holdOf(w.deal), { idempotencyKey: 'once' });
    expect(r.via).toBe(op2.url);
    expect(r.state.escrowState).toBe('Held');
    expect(w.chain.log().filter((e) => e.type === 'hold.funded')).toHaveLength(1);
    // op-2 signs its own receipt for the event op-1 relayed.
    expect(r.receipt?.eventSeq).toBe(w.chain.log().at(-1)!.seq);
  });

  it('a call op-1 relayed but whose response was lost completes directly under the same key, applied once', async () => {
    const op1 = await w.operator('op-1', { dropResponses: true });
    const hb = new Holdback({ operators: [op1.url], settlement: w.chain, requestTimeoutMs: 500 });
    const r = await hb.hold(await holdOf(w.deal), { idempotencyKey: 'once-direct' });
    expect([r.via, r.state.escrowState]).toEqual(['direct', 'Held']);
    expect(w.chain.log().filter((e) => e.type === 'hold.funded')).toHaveLength(1);
  });
});
