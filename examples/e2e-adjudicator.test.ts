// The round's own adjudicator (e2e-adjudicator.ts), offline: its typed messages hash as core's do; on the demo's own
// world on SimChain it registers through the API once and reuses the registration in a later run, and serves silent
// and scripted on deals priced at zero (SimChain bonds no outsider at run time, and a zero price needs no bond); on the
// contracts deployed to anvil it bonds from its own key once, and its scripted decisions settle on chain.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashTypedData, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adjudicatorTyped, RoundAdjudicator, type Script } from './e2e-adjudicator.ts';
import { roundEncryptionKey, roundKey } from './e2e-keys.ts';
import { BAD_CSV, CHECKS, CSV, DATASET, PRICE } from './e2e-scenario-kit.ts';
import { buyerOpens, deliver, eventsOf, finish, fund, logsOf, offer, openDeal, Round, Run, sleep, until, type Deal } from './e2e-run.ts';
import { ANVIL_SKIP, anvilReady, anvilWorld, root, simWorld, type AnvilWorld, type Served } from './e2e-world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const lc = (a: string) => a.toLowerCase();

/** A run of the round in this process, as the driver makes one per scenario; its lines go to `lines`. */
async function runOn(urls: readonly string[], seed: string, rpcUrl: string, lines: string[]): Promise<Run> {
  const round = await Round.open({ operators: [...urls], seed, rpcUrl, log: (l) => lines.push(l) });
  return new Run(round, 'adj', "the round's own adjudicator");
}

/** A checks-only deal naming `primary` as primary and the demo's fallback and appeal adjudicators, funded and delivered. */
async function dealWith(r: Run, primary: RoundAdjudicator, price: string, work: string): Promise<Deal> {
  const { round } = r;
  const deal = await openDeal(r, { label: `the round's ${primary.role} as primary`, template: 'checks-only', deliverable: DATASET, checks: CHECKS, price, adjudicators: { primary: primary.address, fallback: round.demo.adjudicators.fallback, appeal: round.demo.adjudicators.appeal } }, [round.address('buyer'), round.address('seller'), primary.address]);
  await fund(r, deal);
  await deliver(r, deal, work);
  return deal;
}

/** Serves `script` for one deal, stopping in any case. */
async function served<T>(r: Run, a: RoundAdjudicator, script: Script, f: () => Promise<T>): Promise<{ value: T; acted: J[]; errors: string[] }> {
  const s = await a.serve(r, script);
  try {
    return { value: await f(), acted: s.acted, errors: s.errors };
  } finally {
    await s.stop();
  }
}

describe('adjudicatorTyped', () => {
  it('hashes an acceptance, decisions and a registration as core does', async () => {
    const core = await import(pathToFileURL(createRequire(join(root, 'apps/operator/package.json')).resolve('@holdback/core')).href);
    const domain = { name: 'Holdback' as const, version: '0.8', chainId: 11155111, verifyingContract: '0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa' as Hex };
    const h = (c: string) => `0x${c.repeat(64)}` as Hex;
    const asset = '0x2c6fa6f2ad3b2b44fb4c2e4d2a3e3cfcf96ae3a8';
    const me = '0x5d10fecab9242e66cb134b77309a3566ed75e3dd';
    const decision = { type: 'Decision', commitmentId: h('1'), attempt: 1, deliveryHash: h('2'), adjudicator: me, role: 'primary', outcome: 'reject', seed: h('3'), policyHash: h('4'), registryHash: h('5'), judgmentRecordHash: h('6'), nonce: h('7'), expiresAt: '2026-11-05T12:00:00Z' };
    const messages = [
      { type: 'AdjudicatorAcceptance', commitmentId: h('1'), adjudicator: me, seedCommitment: h('2'), policyHash: h('4'), registryHash: h('5'), fee: { token: asset, amount: '1000000' }, bondReserved: { token: asset, amount: PRICE }, nonce: h('8'), expiresAt: '2026-11-05T11:00:00Z' },
      decision,
      { ...decision, outcome: 'accept', keyForBuyer: { scheme: 'x25519-xsalsa20poly1305', ciphertext: 'c2VhbGVkLWtleS1mb3ItYnV5ZXI' } },
      { ...decision, role: 'appeal', appealGround: 'wrong-outcome', beacon: { source: 'drand-quicknet', round: 123, value: h('9'), signature: `0x${'ab'.repeat(48)}` } },
      { ...decision, outcome: 'escalate', encryptedKeys: [{ recipient: me, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5' }] },
      { type: 'AdjudicatorRegistration', adjudicator: me, encryptionPublicKey: 'A6d8Adb682dd4Aed883d592c521ccc795599fdf4a1c', keyId: 't-216/adjudicator-1/2026-11-05T12:00:00Z', policyHash: h('4'), registryHash: h('5'), fee: { token: asset, amount: '1000000' }, poolTermsHash: h('a'), bodyHash: h('b'), issuedAt: '2026-11-05T12:00:00Z', nonce: h('c'), expiresAt: '2026-12-05T12:00:00Z' },
    ];
    for (const m of messages) expect(hashTypedData(adjudicatorTyped(m, domain)), `${m.type} ${(m as J).outcome ?? ''}`).toBe(core.messageDigest(domain, m));
  });
});

describe('against the demo world on SimChain', () => {
  let demo: Served;
  beforeAll(async () => {
    demo = await simWorld();
  });
  afterAll(() => demo.close());

  it('registers through the API with the demo registry and policy under its own id, and a later run reuses it without posting', async () => {
    const seed = generatePrivateKey();
    const lines: string[] = [];
    const r = await runOn(demo.urls, seed, 'http://127.0.0.1:9', lines);
    const posts = () => demo.requests.filter((q) => q.startsWith('POST /v1/adjudicators')).length;
    const a = await RoundAdjudicator.ready(r, 'adjudicator-1');
    expect(posts()).toBe(1);
    const pick = (x: J) => ({ policy: x.policy, registry: x.registry, fee: x.fee, registration: x.registration, address: x.address });
    const read = (x: string): Promise<J> => r.round.agent('master').trusted(`/v1/adjudicators/${x}`, pick);
    const [mine, theirs] = [await read(a.address), await read(r.round.demo.adjudicators.primary)];
    expect(mine.address).toBe(privateKeyToAccount(roundKey(seed, 'adjudicator-1')).address.toLowerCase());
    expect(mine.registry).toEqual(theirs.registry);
    expect(mine.fee).toEqual(theirs.fee);
    expect(mine.policy).toEqual({ ...theirs.policy, id: 't-216/adjudicator-1' });
    expect(mine.registration.signature).toMatch(/^0x[0-9a-f]{130}$/);
    // A later run (a new Round, as the driver opens one per invocation) finds it in place.
    const later = await runOn(demo.urls, seed, 'http://127.0.0.1:9', lines);
    await RoundAdjudicator.ready(later, 'adjudicator-1');
    expect(posts()).toBe(1);
    expect(lines.join('\n')).toMatch(/adjudicator-1 0x\w+\.\.\.\w+: its registration is in place .*; reused/);
    expect(lines.join('\n')).not.toContain(roundKey(seed, 'adjudicator-1').slice(2));
  }, 60_000);

  it('serves silent and scripted: accepts, then never decides or decides as told, a wrong outcome included', async () => {
    const seed = generatePrivateKey();
    const lines: string[] = [];
    const r = await runOn(demo.urls, seed, 'http://127.0.0.1:9', lines);
    const a = await RoundAdjudicator.ready(r, 'adjudicator-2');
    // A wrong reject: the work passes every check.
    const rejected = await served(r, a, { decide: 'reject' }, async () => {
      const deal = await dealWith(r, a, '0', CSV);
      return { deal, done: await until(r, deal.buyer, deal.id, ['Released', 'Refunded'], 60_000) };
    });
    expect(rejected.value.done.escrowState, lines.join('\n')).toBe('Refunded');
    expect(rejected.acted).toEqual([{ id: rejected.value.deal.id, did: 'accepted' }, { id: rejected.value.deal.id, did: 'decided', outcome: 'reject' }]);
    // A wrong accept: a row is missing. The key it seals to the buyer opens the work.
    const accepted = await served(r, a, { decide: 'accept' }, async () => {
      const deal = await dealWith(r, a, '0', BAD_CSV);
      return { deal, done: await until(r, deal.buyer, deal.id, ['Released', 'Refunded'], 60_000) };
    });
    expect(accepted.value.done.escrowState, lines.join('\n')).toBe('Released');
    expect(await buyerOpens(r, accepted.value.deal, BAD_CSV)).toBe(true);
    // Silent: it accepts, then several passes go by and the deal stays Delivered on both operators.
    const silent = await served(r, a, 'silent', async () => {
      const deal = await dealWith(r, a, '0', CSV);
      await sleep(10_000);
      return { deal, now: await Promise.all(deal.buyer.sources().map((api) => deal.buyer.call('GET', `/v1/commitments/${deal.id}`, undefined, api))) };
    });
    expect(silent.value.now.map((v: J) => v.escrowState)).toEqual(['Delivered', 'Delivered']);
    expect(silent.acted).toEqual([{ id: silent.value.deal.id, did: 'accepted' }]);
    expect([...rejected.errors, ...accepted.errors, ...silent.errors]).toEqual([]);
    for (const k of [roundKey(seed, 'adjudicator-2'), `0x${Buffer.from(roundEncryptionKey(seed, 'adjudicator-2')).toString('hex')}`]) expect(lines.join('\n')).not.toContain(k.slice(2));
  }, 120_000);

  it("acts only on its round's deals: a stranger's deal that names it primary stays Offered", async () => {
    const lines: string[] = [];
    const r = await runOn(demo.urls, generatePrivateKey(), 'http://127.0.0.1:9', lines);
    const a = await RoundAdjudicator.ready(r, 'adjudicator-3');
    // Another round's parties: its address is public through its registration, so anyone can name it.
    const stranger = await runOn(demo.urls, generatePrivateKey(), 'http://127.0.0.1:9', lines);
    const theirs = await served(r, a, 'silent', async () => {
      const deal = await offer(stranger, { label: "a stranger's deal", template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: '0', adjudicators: { primary: a.address, fallback: r.round.demo.adjudicators.fallback, appeal: r.round.demo.adjudicators.appeal } }, []);
      // Several of its passes (3 s apart) go by.
      await sleep(10_000);
      return { deal, now: await Promise.all(deal.buyer.sources().map((api) => deal.buyer.call('GET', `/v1/commitments/${deal.id}`, undefined, api))) };
    });
    expect(theirs.value.now.map((v: J) => v.escrowState), lines.join('\n')).toEqual(['Offered', 'Offered']);
    expect(theirs.acted).toEqual([]);
    expect(theirs.errors).toEqual([]);
  }, 120_000);
});

describe.skipIf(!anvilReady)(`against the demo world on anvil${ANVIL_SKIP}`, () => {
  let world: AnvilWorld;
  const seed = generatePrivateKey();
  const lines: string[] = [];
  let r: Run;
  let a: RoundAdjudicator;
  beforeAll(async () => {
    world = await anvilWorld();
    process.env['HOLDBACK_DEPLOYMENT'] = JSON.stringify(world.deployment);
    await world.setBalance(privateKeyToAccount(roundKey(seed, 'adjudicator-1')).address, 10n ** 18n);
    r = await runOn(world.urls, seed, world.rpcUrl, lines);
  }, 180_000);
  afterAll(async () => {
    delete process.env['HOLDBACK_DEPLOYMENT'];
    await world?.close();
  });

  it('registers with no bond on the phase-one contracts (ADR-0031 §8): no transaction from its key, now or on a later run', async () => {
    const chain = r.round.chain!;
    a = await RoundAdjudicator.ready(r, 'adjudicator-1');
    expect((await chain.holdings([a.address]))[a.address]).toMatchObject({ bond: '0', free: '0' });
    expect(await chain.client.getTransactionCount({ address: a.address as Hex })).toBe(0);
    const later = await runOn(world.urls, seed, world.rpcUrl, lines);
    await RoundAdjudicator.ready(later, 'adjudicator-1');
    expect(await chain.client.getTransactionCount({ address: a.address as Hex })).toBe(0);
    expect(later.notes).toEqual([]);
  }, 180_000);

  it('decides by script on chain: a wrong reject refunds, a wrong accept releases with the key, and silent never decides', async () => {
    const decided = (deal: Deal) => logsOf(deal.record, 'Decided').map((l) => lc(l.args.adjudicator));
    const reject = await served(r, a, { decide: 'reject' }, async () => {
      const deal = await dealWith(r, a, PRICE, CSV);
      await until(r, deal.buyer, deal.id, ['Released', 'Refunded'], 120_000);
      await finish(r, deal);
      return deal;
    });
    expect(reject.value.record.chain?.stage, lines.join('\n')).toBe('Refunded');
    expect(decided(reject.value)).toEqual([a.address]);
    // Its acceptance reserved no bond, which the contract requires before it funds (ADR-0031 §8).
    const accepted = (await eventsOf(reject.value.buyer, reject.value.id, reject.value.buyer.sources()[0]!)).find((e) => e.type === 'adjudicator.accepted');
    expect(accepted?.payload?.bondRequired).toMatchObject({ amount: '0' });
    const accept = await served(r, a, { decide: 'accept' }, async () => {
      const deal = await dealWith(r, a, PRICE, BAD_CSV);
      await until(r, deal.buyer, deal.id, ['Released', 'Refunded'], 120_000);
      await finish(r, deal);
      return deal;
    });
    expect(accept.value.record.chain?.stage, lines.join('\n')).toBe('Released');
    expect(decided(accept.value)).toEqual([a.address]);
    expect(logsOf(accept.value.record, 'KeyReleased').map((l) => lc(l.args.recipient))).toContain(r.round.address('buyer'));
    expect(await buyerOpens(r, accept.value, BAD_CSV)).toBe(true);
    const silent = await served(r, a, 'silent', async () => {
      const deal = await dealWith(r, a, PRICE, CSV);
      await sleep(10_000);
      return { deal, stage: (await r.round.chain!.deal(deal.id)).stage };
    });
    expect(silent.value.stage).toBe('Delivered');
    expect(silent.acted).toEqual([{ id: silent.value.deal.id, did: 'accepted' }]);
    expect([...reject.errors, ...accept.errors, ...silent.errors]).toEqual([]);
    expect(lines.join('\n')).not.toContain(roundKey(seed, 'adjudicator-1').slice(2));
  }, 400_000);
});
