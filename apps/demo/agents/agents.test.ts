// The scripted demo agents (T-012) drive each beat through the SDK and an operator over SimChain, with keys,
// clock and randomness from the testkit context. Honest parties only (docs/backlog.md has the rest).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalKeccak } from '@holdback/core';
import { afterEach, describe, expect, it } from 'vitest';
import { STAND_IN_POLICY, StandInBench, type AdjudicatorSeam } from './bench.js';
import { beatBadWork, beatHappyPath, beatHiddenTags, beatHold, beatMutualSplit, players } from './beats.js';
import { createDemoWorld, DATA_DIR, type DemoWorld } from './world.js';

const TUSD = 1_000_000n;
const manifest = JSON.parse(readFileSync(join(DATA_DIR, 'manifest.json'), 'utf8')) as { files: Array<{ name: string; sha256: string }> };
const sha = (name: string) => manifest.files.find((f) => f.name === name)!.sha256;

const worlds: DemoWorld[] = [];
async function world(seed = 7): Promise<DemoWorld> {
  const w = await createDemoWorld({ seed });
  worlds.push(w);
  return w;
}
afterEach(async () => {
  await Promise.all(worlds.splice(0).map((w) => w.close()));
});

describe('beat 1: choose, agree and hold', () => {
  it('the seller offers terms naming Bench A, B and C, Bench A accepts, and one SDK call through op-1 holds $2,050', async () => {
    const w = await world();
    const r = await beatHold(w);
    expect(r.state.escrowState).toBe('Held');
    expect(r.via).toBe(w.operatorUrl('op-1'));
    expect(r.commitment.adjudication).toMatchObject({ adjudicator: w.cast.benchA.address, fallbackAdjudicator: w.cast.benchB.address, appealAdjudicator: w.cast.benchC.address });
    expect(r.commitment.clubId).toBe('data-services-v1');
    expect(r.commitment.rulebookHash).toBe(w.club.rulebookHash);
    expect(await w.balance('atlas')).toBe(7_950n * TUSD);
    expect(w.chain.pool(w.cast.benchA.address).reserved).toBe(2_000n * TUSD);
  });
});

describe('the adjudicator seam (T-009)', () => {
  it('beats take any AdjudicatorSeam, so the T-009 service can replace the stand-in without touching the agents', async () => {
    const w = await world();
    const inner = new StandInBench(w.cast.benchA, w);
    const calls: string[] = [];
    const seam: AdjudicatorSeam = {
      keys: inner.keys,
      policyHash: inner.policyHash,
      registryHash: inner.registryHash,
      accept: (c) => (calls.push('accept'), inner.accept(c)),
      judge: (id) => (calls.push('judge'), inner.judge(id)),
    };
    const r = await beatHold(w, { players: players(w, seam) });
    expect(calls).toEqual(['accept']);
    expect(r.commitment.adjudication.policyHash).toBe(canonicalKeccak(STAND_IN_POLICY));
    expect(r.state.escrowState).toBe('Held');
  });
});

describe('beats 2-4: deliver encrypted, judge, settle, open the work', () => {
  it('releases $2,000 to Tidewater and the key to Atlas, whose SDK opens the CSV and matches the committed plaintext hash', async () => {
    const w = await world();
    const r = await beatHappyPath(w);
    expect(r.finalState).toBe('Released');
    expect(r.decision).toBe('accept');
    expect(r.checks.filter((c) => !c.passed)).toEqual([]);
    expect(r.opened).toBeDefined();
    expect(r.opened!.plaintextSha256).toBe(sha('customers.clean.csv'));
    expect(r.opened!.matchesDelivery).toBe(true);
    expect(r.opened!.text).toBe(readFileSync(join(DATA_DIR, 'customers.clean.csv'), 'utf8'));
    expect(r.opened!.removed.tagChars).toBe(0);
    expect(await w.balance('atlas')).toBe(7_950n * TUSD);
    expect(await w.balance('tidewater')).toBe(2_000n * TUSD);
    expect(await w.balance('bench-a')).toBe(50n * TUSD);
    expect(r.vias.every((v) => v === w.operatorUrl('op-1'))).toBe(true);
    // Bench A's bond backs its decision through the 300 s appeal window, then anyone can release it.
    expect(w.chain.pool(w.cast.benchA.address).reserved).toBe(2_000n * TUSD);
    w.advance(301);
    const after = await w.sdk().trigger(r.commitmentId, 'appeal_expiry', w.call());
    expect(after.state.finalAt).not.toBeNull();
    expect(w.chain.pool(w.cast.benchA.address).reserved).toBe(0n);
  });

  it('the delivery carries only hashes and envelopes: the ciphertext in the store does not contain the plaintext', async () => {
    const w = await world();
    const r = await beatHappyPath(w);
    const ciphertext = await w.store.get(r.delivery.ciphertext.sha256);
    const plain = readFileSync(join(DATA_DIR, 'customers.clean.csv'));
    expect(Buffer.from(ciphertext).includes(plain.subarray(0, 64))).toBe(false);
    expect(r.delivery.plaintextSha256).toBe(sha('customers.clean.csv'));
    expect(r.delivery.encryptedKeys.map((k) => k.recipient)).toEqual([w.cast.benchA.address, w.cast.benchB.address, w.cast.benchC.address, w.cast.atlas.address]);
  });
});

describe('beat 5: bad work', () => {
  it('a file missing 8% of rows fails the rows check, Atlas is refunded in one step and never gets the key', async () => {
    const w = await world();
    const r = await beatBadWork(w);
    expect(r.finalState).toBe('Refunded');
    expect(r.decision).toBe('reject');
    expect(r.checks.filter((c) => c.required && !c.passed).map((c) => c.checkId)).toEqual(['rows']);
    expect(r.opened).toBeUndefined();
    expect(await w.chain.keysFor(r.commitmentId, w.cast.atlas.address)).toEqual([]);
    expect(await w.balance('atlas')).toBe(9_950n * TUSD);
    expect(await w.balance('tidewater')).toBe(0n);
    expect(await w.balance('bench-a')).toBe(50n * TUSD);
  });
});

describe('beat 6, ADR-0021 half: hidden tags under an empty rubric', () => {
  it('the checks-only job accepts the tag-laden file, and Atlas reads it with the payload stripped and reported', async () => {
    const w = await world();
    const r = await beatHiddenTags(w);
    expect(r.commitment.acceptance.rubric.criteria).toEqual([]);
    expect(r.finalState).toBe('Released');
    expect(r.opened!.plaintextSha256).toBe(sha('customers.clean.hidden-tags.csv'));
    expect(r.opened!.matchesDelivery).toBe(true);
    expect(r.opened!.removed.tagChars).toBeGreaterThan(0);
    expect(r.opened!.screen.flagged).toBe(true);
    expect(r.opened!.screen.signals.map((s) => s.kind)).toContain('unicode_tags');
    // What the agent reads is the clean file: the tag characters never reach it.
    expect(r.opened!.text).toBe(readFileSync(join(DATA_DIR, 'customers.clean.csv'), 'utf8'));
  });
});

describe('beat 10: agree without a judge', () => {
  it('both agents co-sign a 70/30 split after delivery; Atlas gets the key, Bench A never judges and its bond is released, the fee returns to Atlas', async () => {
    const w = await world();
    const r = await beatMutualSplit(w);
    expect(r.finalState).toBe('Settled');
    expect(r.decision).toBeUndefined();
    expect(r.payouts).toEqual([
      { to: w.cast.tidewater.address, amount: { token: 'tUSD', amount: (1_400n * TUSD).toString() } },
      { to: w.cast.atlas.address, amount: { token: 'tUSD', amount: (600n * TUSD).toString() } },
    ]);
    expect(await w.balance('tidewater')).toBe(1_400n * TUSD);
    expect(await w.balance('atlas')).toBe(8_600n * TUSD);
    expect(await w.balance('bench-a')).toBe(0n);
    expect(w.chain.pool(w.cast.benchA.address).reserved).toBe(0n);
    expect(r.opened!.matchesDelivery).toBe(true);
    expect(r.opened!.plaintextSha256).toBe(sha('customers.clean.csv'));
  });
});

describe('determinism', () => {
  it('the same seed gives the same commitment, delivery and settlement log; another seed does not', async () => {
    const a = await beatHappyPath(await world(7));
    const b = await beatHappyPath(await world(7));
    const c = await beatHappyPath(await world(8));
    expect(b.commitmentId).toBe(a.commitmentId);
    expect(b.delivery).toEqual(a.delivery);
    expect(worlds[1]!.chain.digest()).toBe(worlds[0]!.chain.digest());
    expect(c.commitmentId).not.toBe(a.commitmentId);
  });

  it('the agents read time from the testkit context, which stays in step with SimChain', async () => {
    const w = await world();
    expect(w.now()).toBe(w.chain.now());
    w.advance(42);
    expect(w.now()).toBe(w.chain.now());
    expect(w.ctx.clock.elapsedMs()).toBe(42_000);
  });
});
