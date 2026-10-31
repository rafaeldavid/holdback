// The scripted demo agents (T-012) drive each beat through the SDK and an operator over SimChain; Clearfield,
// Northgate and Atrium are T-009's adjudicator service on that SimChain with fake judges (no models, no keys).
// Keys, clock and randomness come from the testkit context. Honest parties only (docs/backlog.md has the rest).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAdjudicator, parseJudgment } from '@holdback/core';
import { afterEach, describe, expect, it } from 'vitest';
import { BenchDirectory, demoRegistry, ServiceBench, type AdjudicatorSeam } from './bench.js';
import { beatBadWork, beatHappyPath, beatHiddenTags, beatHold, beatMutualSplit, players } from './beats.js';
import { ATLAS, BENCH_A, BENCH_B, BENCH_C, BOND_BACKER, display, TIDEWATER } from './cast.js';
import { createDemoWorld, DATA_DIR, type DemoWorld } from './world.js';

const TUSD = 1_000_000n;
const manifest = JSON.parse(readFileSync(join(DATA_DIR, 'manifest.json'), 'utf8')) as { files: Array<{ name: string; sha256: string }> };
const sha = (name: string) => manifest.files.find((f) => f.name === name)!.sha256;
const CLEAN_BYTES = readFileSync(join(DATA_DIR, 'customers.clean.csv')).length;

const worlds: DemoWorld[] = [];
async function world(seed = 7): Promise<DemoWorld> {
  const w = await createDemoWorld({ seed });
  worlds.push(w);
  return w;
}
afterEach(async () => {
  await Promise.all(worlds.splice(0).map((w) => w.close()));
});

describe('cast', () => {
  it('names the invented parties, benches and backer once, for the agents and the narration', () => {
    expect(display.party(ATLAS)).toBe('Ledger (Atlas Research)');
    expect(display.party(TIDEWATER)).toBe('Tide-7 (Tidewater Data)');
    expect([BENCH_A, BENCH_B, BENCH_C].map(display.bench)).toEqual(['Clearfield Adjudication (Bench A)', 'Northgate Review (Bench B)', 'Atrium Appeals (Bench C)']);
    expect(ATLAS.principal).toMatchObject({ name: 'Priya Raman', title: 'Head of Data Ops' });
    expect(TIDEWATER.principal).toMatchObject({ name: 'Marcus Oyelaran', title: 'Founder' });
    expect(BOND_BACKER.name).toBe('Kite Capital');
  });

  it("Ledger's mandate from Priya Raman carries 5,000 tUSD per job and 20,000 per day", async () => {
    const w = await world();
    const m = w.chain.genesis.mandates.find((x) => x.agent === w.cast.atlas.address)!;
    expect(m.scope).toMatchObject({ roles: ['buyer'], maxPerCommitment: { amount: (5_000n * TUSD).toString() }, maxDaily: { amount: (20_000n * TUSD).toString() } });
  });

  it('Clearfield, Northgate and Atrium publish schema-valid registrations on the pinned placeholder registry', async () => {
    const w = await world();
    const p = players(w);
    const directory = (p.benchA as ServiceBench)['directory'] as BenchDirectory;
    for (const [bench, name] of [
      [p.benchA, 'Clearfield Adjudication'],
      [p.benchB, 'Northgate Review'],
      [p.benchC, 'Atrium Appeals'],
    ] as const) {
      const r = directory.registration(bench.keys.address)!;
      expect(parseAdjudicator(r).ok).toBe(true);
      expect(r.name).toBe(name);
      expect(r.registry.hash).toBe(demoRegistry().hash);
      expect(r.pool.junior.amount).toBe((25_000n * TUSD).toString());
    }
    expect(demoRegistry().doc.judges.every((j) =>/^placeholder-.+-\d{8}$/.test(j.model))).toBe(true);
  });
});

describe('beat 1: choose, agree and hold', () => {
  it('Tide-7 offers terms naming Clearfield, Northgate and Atrium; Clearfield accepts; Ledger holds $2,050 in one call through op-1', async () => {
    const w = await world();
    const r = await beatHold(w);
    expect(r.state.escrowState).toBe('Held');
    expect(r.vias).toEqual({ offer: w.operatorUrl('op-1'), hold: w.operatorUrl('op-1') });
    expect(r.commitment.adjudication).toMatchObject({
      adjudicator: w.cast.benchA.address,
      fallbackAdjudicator: w.cast.benchB.address,
      appealAdjudicator: w.cast.benchC.address,
      policyId: 'bench-a/p1',
      policyHash: r.players.benchA.policyHash,
      registryHash: demoRegistry().hash,
    });
    expect(r.commitment.rulebookHash).toBe(w.club.rulebookHash);
    expect(await w.balance('atlas')).toBe(7_950n * TUSD);
    expect(w.chain.pool(w.cast.benchA.address).reserved).toBe(2_000n * TUSD);
  });
});

describe('the adjudicator seam', () => {
  it('beats take any AdjudicatorSeam for Bench A; the default is the T-009 service', async () => {
    const w = await world();
    const inner = players(w).benchA;
    expect(inner).toBeInstanceOf(ServiceBench);
    const calls: string[] = [];
    const seam: AdjudicatorSeam = {
      name: inner.name,
      keys: inner.keys,
      policy: inner.policy,
      policyHash: inner.policyHash,
      registryHash: inner.registryHash,
      acceptOffers: () => (calls.push('accept'), inner.acceptOffers()),
      judge: (id) => (calls.push('judge'), inner.judge(id)),
    };
    const r = await beatHold(w, { players: players(w, { benchA: seam }) });
    expect(calls).toEqual(['accept']);
    expect(r.state.escrowState).toBe('Held');
  });
});

describe('beats 2-4: deliver encrypted, defended judgment, settle, open the work', () => {
  it('a three-judge panel from two families accepts on a seeded sample; $2,000 goes to Tide-7 and the key to Ledger, which matches the plaintext hash', async () => {
    const w = await world();
    const r = await beatHappyPath(w);
    expect(r.finalState).toBe('Released');
    expect(r.decision).toBe('accept');
    const rec = r.record!;
    expect(parseJudgment(rec).ok).toBe(true);
    expect(rec.intake.plaintextHashVerified).toBe(true);
    expect(rec.deterministic.filter((c) => !c.passed)).toEqual([]);
    expect(rec.screen.flagged).toBe(false);
    expect(rec.panel).toMatchObject({ ran: true, policyId: 'bench-a/p1', seedSource: 'commit-reveal' });
    expect(rec.panel.members).toHaveLength(3);
    expect(rec.panel.members.every((m) => m.status === 'ok' && m.verdict?.overall === 'pass' && /^placeholder-/.test(m.model))).toBe(true);
    expect(new Set(rec.panel.members.map((m) => m.family)).size).toBeGreaterThanOrEqual(2);
    expect(rec.aggregate).toMatchObject({ decision: 'accept', passCount: 3, validCount: 3 });
    // Each judge saw a seeded sample, not the whole 0.5 MB file.
    expect(r.requests).toHaveLength(3);
    expect(r.requests.every((q) => /drawn at random/.test(q.user) && q.user.length < CLEAN_BYTES / 2)).toBe(true);
    // The decision reveals the seed Clearfield committed to at acceptance.
    expect(rec.panel.seed).toBeDefined();

    expect(r.opened!.plaintextSha256).toBe(sha('customers.clean.csv'));
    expect(r.opened!.matchesDelivery).toBe(true);
    expect(r.opened!.text).toBe(readFileSync(join(DATA_DIR, 'customers.clean.csv'), 'utf8'));
    expect(await w.balance('atlas')).toBe(7_950n * TUSD);
    expect(await w.balance('tidewater')).toBe(2_000n * TUSD);
    expect(await w.balance('bench-a')).toBe(50n * TUSD);
    expect(r.vias).toEqual([w.operatorUrl('op-1'), w.operatorUrl('op-1'), w.operatorUrl('op-1'), 'direct']);
    // Clearfield's bond backs its decision through the 300 s appeal window, then anyone can release it.
    expect(w.chain.pool(w.cast.benchA.address).reserved).toBe(2_000n * TUSD);
    w.advance(301);
    const after = await w.sdk().trigger(r.commitmentId, 'appeal_expiry', w.call());
    expect(after.state.finalAt).not.toBeNull();
    expect(w.chain.pool(w.cast.benchA.address).reserved).toBe(0n);
  });

  it('the delivery carries only hashes and envelopes: the stored ciphertext does not contain the plaintext', async () => {
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
  it('a file missing 8% of rows fails the required rows check, no panel sits, Ledger is refunded and never gets the key', async () => {
    const w = await world();
    const r = await beatBadWork(w);
    expect(r.finalState).toBe('Refunded');
    expect(r.decision).toBe('reject');
    expect(r.record!.deterministic.filter((c) => c.required && !c.passed).map((c) => c.checkId)).toEqual(['rows']);
    expect(r.record!.panel.ran).toBe(false);
    expect(r.requests).toEqual([]);
    expect(r.record!.aggregate.reasons).toEqual(['required deterministic check failed: rows']);
    expect(r.opened).toBeUndefined();
    expect(await w.chain.keysFor(r.commitmentId, w.cast.atlas.address)).toEqual([]);
    expect(await w.balance('atlas')).toBe(9_950n * TUSD);
    expect(await w.balance('tidewater')).toBe(0n);
    expect(await w.balance('bench-a')).toBe(50n * TUSD);
  });
});

describe('beat 6, ADR-0021 half: hidden tags under an empty rubric', () => {
  it("Clearfield's screen report flags the tag characters, the checks-only job is accepted without a panel, and Ledger reads the file with the payload stripped", async () => {
    const w = await world();
    const r = await beatHiddenTags(w);
    expect(r.commitment.acceptance.rubric.criteria).toEqual([]);
    expect(r.finalState).toBe('Released');
    expect(r.record!.screen.flagged).toBe(true);
    expect(r.record!.screen.signals.map((s) => s.kind)).toContain('unicode_tags');
    expect(r.record!.panel.ran).toBe(false);
    expect(r.record!.aggregate.reasons).toContain('all deterministic checks passed and the rubric is empty');
    expect(r.opened!.plaintextSha256).toBe(sha('customers.clean.hidden-tags.csv'));
    expect(r.opened!.matchesDelivery).toBe(true);
    expect(r.opened!.removed.tagChars).toBeGreaterThan(0);
    expect(r.opened!.screen.signals.map((s) => s.kind)).toContain('unicode_tags');
    // What Ledger reads is the clean file: the tag characters never reach it.
    expect(r.opened!.text).toBe(readFileSync(join(DATA_DIR, 'customers.clean.csv'), 'utf8'));
  });
});

describe('beat 10: agree without a judge', () => {
  it('Ledger and Tide-7 co-sign a 70/30 split after delivery; Ledger gets the key, Clearfield never judges and its bond is released, the fee returns to Atlas', async () => {
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
  it('the same seed gives the same commitment, delivery, judgment record and settlement log; another seed does not', async () => {
    const a = await beatHappyPath(await world(7));
    const b = await beatHappyPath(await world(7));
    const c = await beatHappyPath(await world(8));
    expect(b.commitmentId).toBe(a.commitmentId);
    expect(b.delivery).toEqual(a.delivery);
    expect(b.record!.recordHash).toBe(a.record!.recordHash);
    // The settlement log is identical except the key Clearfield seals to Ledger: T-009's service draws that
    // envelope's ephemeral key from system randomness (no injectable source yet; docs/backlog.md).
    const masked = (w: DemoWorld) =>
      w.chain.log().map((e) => JSON.stringify({ ...e, hash: null, prevHash: null }).replace(/"ciphertext":"[A-Za-z0-9_-]{100,}"/g, '"ciphertext":"<sealed>"'));
    expect(masked(worlds[1]!)).toEqual(masked(worlds[0]!));
    const sealed = (w: DemoWorld) => w.chain.log().filter((e) => JSON.stringify(e).includes('"envelope"')).length;
    expect(sealed(worlds[0]!)).toBeGreaterThan(0);
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
