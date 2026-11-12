// T-372: an operator with a ciphertext store checks that store before it relays a delivery. A delivery whose ciphertext
// the store does not hold would never be judged by an adjudicator that reads it there, so the seller hears now, with the
// next step, not when the deal defaults. The refusal is this operator's alone (ADR-0005, D27): it changes nothing on the
// settlement layer, and the same signed delivery still goes through any operator that holds the bytes, or straight to
// the settlement layer.
import type { Sha256 } from '@holdback/core';
import { MemoryCiphertextStore, StoreError, type CiphertextStore } from '@holdback/core/store';
import { Holdback, HoldbackError } from '@holdback/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asOperation, holdOf, world, type World } from './_world.js';

let w: World;
beforeEach(async () => {
  w = await world();
});
afterEach(async () => w.close());

/** A store that holds one object under `id` (the sim deal's delivery names a fixed SHA-256 with no real bytes). */
const holding = (id: string): CiphertextStore => ({
  put: async () => id as Sha256,
  get: async (want) => {
    if (want !== id) throw new StoreError('not_found');
    return new Uint8Array([1, 2, 3]);
  },
});

const deliveryId = async () => {
  const d = await w.deal.deliver();
  if (d.kind !== 'deliver') throw new Error('unexpected submission kind');
  return { submission: d, sha256: d.delivery.ciphertext.sha256 };
};

describe("the delivery relay checks the operator's own store (T-372)", () => {
  it('refuses a delivery whose ciphertext its store does not hold, names the hash and the upload, and changes nothing on settlement', async () => {
    const op = await w.operator('op-1', { store: new MemoryCiphertextStore() });
    const hb = new Holdback({ operators: [op.url] });
    await hb.hold(await holdOf(w.deal));
    const { submission, sha256 } = await deliveryId();
    const err = await hb.submit(asOperation(submission)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HoldbackError);
    const p = (err as HoldbackError).problem;
    expect(p.type).toBe('relay_refused');
    expect(p.status).toBe(403);
    expect(p.detail).toContain(sha256);
    expect(p.detail).toMatch(/POST \/v1\/ciphertext/);
    expect(p.detail).toMatch(/another operator|settlement layer/);
    expect((await hb.commitment(w.deal.id))?.escrowState).toBe('Held');
  });

  it('relays a delivery whose ciphertext its store holds, as before', async () => {
    const { sha256 } = await deliveryId();
    const op = await w.operator('op-1', { store: holding(sha256) });
    const hb = new Holdback({ operators: [op.url] });
    await hb.hold(await holdOf(w.deal));
    const r = await hb.submit(asOperation((await deliveryId()).submission));
    expect([r.via, r.state.escrowState]).toEqual([op.url, 'Delivered']);
  });

  it('neutrality.operator-lacks-ciphertext: op-1 lacks the bytes and refuses, the SDK fails over to op-2, which holds them, and the deal settles', async () => {
    const { sha256 } = await deliveryId();
    const op1 = await w.operator('op-1', { store: new MemoryCiphertextStore() });
    const op2 = await w.operator('op-2', { store: holding(sha256) });
    const hb = new Holdback({ operators: [op1.url, op2.url] });
    await hb.hold(await holdOf(w.deal));
    const delivered = await hb.submit(asOperation((await deliveryId()).submission));
    expect(delivered.via).toBe(op2.url);
    w.chain.advance(5);
    const decided = await hb.submit(asOperation(await w.deal.decide('primary', 'accept')));
    expect(decided.state.escrowState).toBe('Released');
  });

  it('neutrality.operator-lacks-ciphertext, direct: no operator holds the bytes, so the SDK submits straight to the settlement layer and the deal settles', async () => {
    const op1 = await w.operator('op-1', { store: new MemoryCiphertextStore() });
    const hb = new Holdback({ operators: [op1.url], settlement: w.chain });
    await hb.hold(await holdOf(w.deal));
    const delivered = await hb.submit(asOperation((await deliveryId()).submission));
    expect([delivered.via, delivered.state.escrowState]).toEqual(['direct', 'Delivered']);
  });

  it('relays as before when its store fails or does not answer: only a definite "not held" refuses', async () => {
    const broken: CiphertextStore = { put: async () => 'sha256:00' as Sha256, get: async () => Promise.reject(new StoreError('io_error')) };
    const op = await w.operator('op-1', { store: broken });
    const hb = new Holdback({ operators: [op.url] });
    await hb.hold(await holdOf(w.deal));
    const r = await hb.submit(asOperation((await deliveryId()).submission));
    expect(r.state.escrowState).toBe('Delivered');
  });

  it('a dry run of the delivery says the same before anything is signed', async () => {
    const op = await w.operator('op-1', { store: new MemoryCiphertextStore() });
    const hb = new Holdback({ operators: [op.url] });
    await hb.hold(await holdOf(w.deal));
    const err = await hb.preview(asOperation((await deliveryId()).submission)).catch((e: unknown) => e);
    expect((err as HoldbackError).problem?.type).toBe('relay_refused');
  });
});
