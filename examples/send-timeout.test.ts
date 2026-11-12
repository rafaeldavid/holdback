// The send-timeout command (send-timeout.ts, T-365). Offline: its command line, the commitment-ID check on the terms
// file, the plan it reads from dealOf for each stage, and the refusals that need no chain. On anvil, as a separate
// process run as Rafa runs it: each timeout the contracts on main have, with each deal driven to the point where the
// timeout is due and then closed by this command alone, no operator pass running; every refusal; the dry run; and the
// neutrality test that a deal still completes when every operator is offline after funding.
//
// On anvil the deals are opened and funded through the operators' own settlement adapter (EvmSettlement, as
// packages/settlement/evm/timeouts.test.ts does), because that is how a deal reaches the chain today. No operator pass
// (OperatorTimeouts) ever runs here, so no operator sends a timeout: each one the deal gets comes from this command.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodeFunctionData, maxUint256, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANVIL_SKIP, anvilReady, root } from './e2e-world.ts';
import { dealOfTerms, parseArgs, planTimeout, sendTimeout, type OnChain } from './send-timeout.ts';
import { jcsHash, Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const lc = (a: string) => a.toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secs = (iso: string) => BigInt(Date.parse(iso) / 1000);
/** A copy of `o` without `keys`. */
const without = (o: J, ...keys: string[]): J => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** Public terms in the wire form a party holds, with a commitment ID that is their own hash (checked below). */
const TERMS: J = {
  schemaVersion: '0.7',
  clubId: 'evm-club',
  rulebookHash: `0x${'11'.repeat(32)}`,
  buyer: '0x1111111111111111111111111111111111111111',
  seller: '0x2222222222222222222222222222222222222222',
  deliverable: { kind: 'dataset', description: 'A test deal', format: 'text/csv' },
  acceptance: { deterministicChecks: [], rubric: { criteria: [], passThreshold: 0 } },
  price: { token: '0x5029787d7e141f2d51788035cc23903652d196b6', amount: '2000000' },
  adjudication: {
    adjudicator: '0x3333333333333333333333333333333333333333',
    fallbackAdjudicator: '0x4444444444444444444444444444444444444444',
    appealAdjudicator: '0x5555555555555555555555555555555555555555',
    policyId: 'test/p1',
    fee: { token: '0x5029787d7e141f2d51788035cc23903652d196b6', amount: '10000' },
    registryHash: `0x${'22'.repeat(32)}`,
    policyHash: `0x${'33'.repeat(32)}`,
  },
  timing: { offerExpiresAt: '2026-11-12T10:15:00Z', fundBy: '2026-11-12T10:30:00Z', deliverBy: '2026-11-12T11:00:00Z', judgeBy: '2026-11-12T11:10:00Z', fallbackBy: '2026-11-12T11:20:00Z', appealWindowSec: 300, appealDecideSec: 600, maxSubmissions: 1 },
  settlement: { mode: 'guaranteed_on_decision', token: '0x5029787d7e141f2d51788035cc23903652d196b6' },
  remedy: { onReject: 'full_refund' },
  disclosure: { level: 'public' },
  buyerEncryptionPublicKey: 'buyer-x25519-public-key',
  nonce: `0x${'44'.repeat(32)}`,
  createdAt: '2026-11-12T10:00:00Z',
};

describe('parseArgs: the command line', () => {
  it('takes the terms and the deployment, an optional RPC, and sends unless --dry-run', () => {
    expect(parseArgs(['--terms', 't.json', '--deployment', 'd.json'])).toEqual({ terms: 't.json', deployment: 'd.json', rpc: null, dryRun: false });
    expect(parseArgs(['--dry-run', '--rpc', 'http://127.0.0.1:8545', '--deployment', 'd.json', '--terms', 't.json'])).toEqual({ terms: 't.json', deployment: 'd.json', rpc: 'http://127.0.0.1:8545', dryRun: true });
  });
  it('refuses an option it does not know, so a mistyped --dry-run never sends; a missing value; a repeat; a missing file', () => {
    expect(parseArgs(['--terms', 't.json', '--deployment', 'd.json', '--dryrun'])).toEqual({ error: 'send-timeout does not take --dryrun' });
    expect(parseArgs(['--terms', '--deployment', 'd.json'])).toEqual({ error: '--terms needs a value' });
    expect(parseArgs(['--terms', 'a', '--terms', 'b', '--deployment', 'd.json'])).toEqual({ error: '--terms is given twice' });
    expect(parseArgs(['--deployment', 'd.json'])).toEqual({ error: 'send-timeout needs --terms <file>' });
    expect(parseArgs(['--terms', 't.json'])).toEqual({ error: 'send-timeout needs --deployment <file>' });
  });
});

describe('dealOfTerms: the terms must hash to their own commitment ID', () => {
  const id = dealOfTerms(TERMS).id;
  it('takes terms with no id, or with the id they hash to, in either case', () => {
    expect(dealOfTerms({ ...TERMS, id, signatures: { seller: '0x00' } }).id).toBe(id);
    expect(dealOfTerms({ ...TERMS, id: id.toUpperCase().replace('0X', '0x') }).id).toBe(id);
  });
  it('refuses terms whose id is another commitment ID, and terms one signed field away from it', () => {
    expect(() => dealOfTerms({ ...TERMS, id: `0x${'ab'.repeat(32)}` })).toThrow(`refusing: the terms name the commitment ID 0x${'ab'.repeat(32)}, but they hash to ${id}`);
    expect(() => dealOfTerms({ ...TERMS, id, price: { ...TERMS.price, amount: '2000001' } })).toThrow(Refusal);
    expect(() => dealOfTerms({ ...TERMS, id, timing: { ...TERMS.timing, deliverBy: '2026-11-12T11:00:01Z' } })).toThrow(/but they hash to/);
  });
  it('gives the private wire form the same ID and the same tuple as the public form, from privateTerms\' hashes (ADR-0024)', () => {
    const { deliverable, acceptance, ...rest } = TERMS;
    const sealed = { ...rest, privateTerms: { deliverable: { hash: jcsHash(deliverable), ciphertext: 'x' }, acceptance: { hash: jcsHash(acceptance), ciphertext: 'y' } } };
    const a = dealOfTerms(TERMS);
    const b = dealOfTerms({ ...sealed, id });
    expect(b.id).toBe(a.id);
    expect(b.tuple).toEqual(a.tuple);
  });
  it('refuses an outsider\'s projection, a key file, terms missing a field, and a settlement the contracts do not run', () => {
    expect(() => dealOfTerms(without(TERMS, 'deliverable', 'acceptance'))).toThrow(/neither the deliverable and acceptance bodies nor privateTerms/);
    expect(() => dealOfTerms({ version: 1, address: TERMS.buyer, privateKey: `0x${'99'.repeat(32)}`, checked: { terms: TERMS } })).toThrow('refusing: the terms file holds a key');
    expect(() => dealOfTerms(without(TERMS, 'nonce'))).toThrow('refusing: the terms lack nonce');
    expect(() => dealOfTerms({ ...TERMS, settlement: { mode: 'settle_after_window', token: TERMS.price.token } })).toThrow(/settle only guaranteed_on_decision/);
  });
});

describe('planTimeout: the one timeout HoldbackRules on main finds due, by stage and chain time', () => {
  const timing = dealOfTerms(TERMS).timing;
  const t1 = secs('2026-11-12T11:05:00Z');
  const deal = (stage: string, appeal = 'none'): OnChain => ({ stage, appeal, t1, t2: 0n });
  /** The plan at chain time `iso`: its kind and the function it names. */
  const at = (d: OnChain, when: bigint) => {
    const p = planTimeout(d, timing, when);
    return p.kind === 'closed' ? 'closed' : `${p.kind} ${p.fn} ${p.at - when}`;
  };
  it('names each timeout at its deadline: due at the deadline\'s second, waiting the second before', () => {
    const cases: Array<[OnChain, string, bigint]> = [
      [deal('None'), 'expireOffer', secs(TERMS.timing.offerExpiresAt)],
      [deal('Held'), 'reclaim', secs(TERMS.timing.deliverBy)],
      [deal('Delivered'), 'triggerFallback', secs(TERMS.timing.judgeBy)],
      [deal('FallbackJudging'), 'triggerDefault', secs(TERMS.timing.fallbackBy)],
      [deal('Escalated'), 'triggerDefault', t1 + 600n],
      [deal('Released'), 'expireAppeal', t1 + 300n],
      [deal('Refunded'), 'expireAppeal', t1 + 300n],
      [deal('Refunded', 'open'), 'expireAppeal', t1 + 900n],
    ];
    for (const [d, fn, deadline] of cases) {
      expect(at(d, deadline), `${d.stage} ${d.appeal}`).toBe(`due ${fn} 0`);
      expect(at(d, deadline - 1n), `${d.stage} ${d.appeal}`).toBe(`wait ${fn} 1`);
    }
  });
  it('takes the earlier of offerExpiresAt and fundBy for an unfunded offer, as expireOffer does', () => {
    const early = dealOfTerms({ ...TERMS, timing: { ...TERMS.timing, fundBy: '2026-11-12T10:10:00Z' } }).timing;
    expect(planTimeout(deal('None'), early, secs('2026-11-12T10:10:00Z'))).toMatchObject({ kind: 'due', fn: 'expireOffer', deadline: 'fundBy' });
  });
  it('finds a deal closed once nothing can move it: settled, expired, or decided with its appeal closed', () => {
    for (const d of [deal('Settled'), deal('Expired'), ...['upheld', 'overturned', 'expired', 'closed'].flatMap((a) => [deal('Released', a), deal('Refunded', a)])]) {
      expect(planTimeout(d, timing, t1 + 10n ** 9n).kind, `${d.stage} ${d.appeal}`).toBe('closed');
    }
  });
});

describe('sendTimeout: refusals before any chain read', () => {
  const dir = mkdtempSync(join(tmpdir(), 't365-offline-'));
  const file = (name: string, v: unknown) => {
    const p = join(dir, name);
    writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
    return p;
  };
  const record = (chainId: number) => ({ chainId, rules: TERMS.buyer, escrow: TERMS.buyer, bonds: TERMS.buyer, multicall: TERMS.buyer, token: { address: TERMS.price.token } });
  const run = (o: { terms?: string; deployment: string; rpc?: string; dryRun?: boolean }, env: Record<string, string> = {}) =>
    sendTimeout({ terms: o.terms ?? file('terms.json', TERMS), deployment: o.deployment, rpc: o.rpc ?? 'http://127.0.0.1:9', dryRun: o.dryRun ?? true }, { say: () => {}, env });
  it('refuses a mainnet deployment record by name, before it connects to any RPC', async () => {
    await expect(run({ deployment: file('mainnet.json', record(1)) })).rejects.toThrow('refusing: chain 1 is a mainnet (hard rule: no real money)');
    await expect(run({ deployment: file('base.json', record(8453)) })).rejects.toThrow('refusing: chain 8453 is a mainnet');
  });
  it('refuses a file that is not a deployment record, and a terms file that is not JSON', async () => {
    await expect(run({ deployment: file('not-a-record.json', { chainId: 31337 }) })).rejects.toThrow('has no rules address');
    const phaseOne = without(record(31337), 'bonds');
    await expect(run({ deployment: file('phase-one.json', phaseOne) })).rejects.toThrow('has no bonds address; this command serves the contracts on main');
    await expect(run({ deployment: file('ok.json', record(31337)), terms: file('bad.json', '{') })).rejects.toThrow('is not JSON');
  });
  it('refuses a real send with no sender key, or a key of the wrong shape, without printing it', async () => {
    await expect(run({ deployment: file('ok.json', record(31337)), dryRun: false })).rejects.toThrow('TIMEOUT_SENDER_KEY is not set');
    const bad = 'not-a-key-1234';
    const e = await run({ deployment: file('ok.json', record(31337)), dryRun: false }, { TIMEOUT_SENDER_KEY: bad }).catch((x: Error) => x);
    expect(String(e)).toContain('is not a 32-byte hex private key');
    expect(String(e)).not.toContain(bad);
  });
});

/** anvil's well-known dev key (public; guards no value): the operators' relayer while the deals are opened. */
const RELAYER: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

describe.skipIf(!anvilReady)(`send-timeout on anvil, with no operator pass running${ANVIL_SKIP}`, () => {
  let anvil: J;
  let chain: J;
  let live: J;
  let s: J;
  let genesis: J;
  let club: J;
  let EvmDeal: J;
  let cast: J;
  let deployment: J;
  let skew = 0;
  const wall = () => Date.now() + skew;
  const dir = mkdtempSync(join(tmpdir(), 't365-anvil-'));
  const deploymentFile = () => join(dir, 'deployment.json');
  /** The sender: any funded key, none of the deal's parties or adjudicators (anvil's public test labels). */
  let sender: { key: Hex; address: string };

  beforeAll(async () => {
    const fromDemo = createRequire(join(root, 'apps/demo-cloud/package.json'));
    const evm = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/evm')).href);
    live = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/live')).href);
    const testing = await import(pathToFileURL(join(root, 'packages/settlement/dist/evm/testing.js')).href);
    EvmDeal = testing.EvmDeal;
    cast = testing.evmCast();
    sender = testing.testActor('t-365/anyone');
    anvil = await evm.EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    const d = anvil.deployment;
    deployment = {
      chainId: anvil.chainId, fromBlock: Number(d.fromBlock),
      token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
      escrow: d.escrow, erc3009Collector: d.erc3009Collector, permit2Collector: d.permit2Collector, multicall: d.multicall, rules: d.rules, bonds: d.bonds, beacon: d.beacon, expiryMarginSec: Number(anvil.expiryMargin),
    };
    writeFileSync(deploymentFile(), JSON.stringify(deployment, null, 2));
    chain = new live.LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER, pollMs: 100, rebroadcastMs: 10_000, mintBatchMs: 50 });
    for (const a of [...chain.lanes.map((l: J) => l.address), ...Object.values(cast).map((a: J) => a.address), sender.address]) await anvil.rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']);
    const start = new Date(Math.floor(wall() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    ({ genesis, club } = await testing.evmGenesis({ cast, token: lc(d.token), chainId: anvil.chainId, rules: d.rules, start, buyer: 0n, bond: 0n }));
    genesis = { ...genesis, simSeed: `0x${'00'.repeat(32)}` };
    await chain.mint(cast.buyer.address, 10n ** 12n);
    await chain.mint(cast.seller.address, 10n ** 10n);
    for (const a of [cast.primary, cast.fallback, cast.appeal]) await live.ensureBond(chain, a.key, 500_000_000_000n, 10n ** 18n);
    for (const p of [cast.buyer, cast.seller]) await chain.send({ key: p.key, to: d.token, data: encodeFunctionData({ abi: chain.abis.token, functionName: 'approve', args: [d.bonds, maxUint256] }) });
    s = await live.EvmSettlement.restore(chain, genesis, undefined, wall);
  }, 180_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  const ok = async (sub: J) => {
    const r = await s.submit(sub, { via: 'op-1' });
    if (!r.ok) throw new Error(`${sub.kind}: ${r.problem.type}: ${r.problem.detail}`);
  };
  /** A deal opened, accepted and funded through the operators' adapter, and delivered through it with `deliver`. */
  async function funded(tag: string, o: { deliver?: boolean } = {}): Promise<J> {
    const d = new EvmDeal(s, cast, club, tag);
    await ok(await d.offer());
    await ok(await d.accept());
    await ok(await d.agreeAndFund());
    if (o.deliver) await ok(await d.deliver());
    return d;
  }
  /** The terms file a party holds: the offer's commitment, with its id and the seller's signature, as the terms route serves it. */
  async function termsFile(d: J, over: (c: J) => J = (c) => c): Promise<string> {
    const p = join(dir, `${d.id}-${Math.random().toString(36).slice(2, 8)}.json`);
    writeFileSync(p, JSON.stringify(over((await d.offer()).commitment), null, 2));
    return p;
  }
  /** Moves anvil's clock by `sec`, and waits for a block at the new time. */
  async function jump(sec: number): Promise<void> {
    await anvil.rpc('evm_increaseTime', [sec]);
    skew += sec * 1000;
    const target = BigInt(Math.floor(wall() / 1000) - 1);
    for (let i = 0; i < 100; i++) {
      if ((await chain.publicClient.getBlock({ blockTag: 'latest' })).timestamp >= target) return;
      await sleep(100);
    }
    throw new Error(`anvil did not reach ${target}`);
  }
  const STAGE = ['None', 'Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Released', 'Refunded', 'Settled', 'Expired'];
  const APPEAL = ['none', 'open', 'upheld', 'overturned', 'expired', 'closed'];
  const dealOf = async (id: Hex) => {
    const r = (await chain.publicClient.readContract({ address: deployment.rules, abi: chain.abis.rules, functionName: 'dealOf', args: [id] })) as J;
    return `${STAGE[r.stage]} ${APPEAL[r.appeal]}`;
  };
  const balance = (a: string): Promise<bigint> => chain.publicClient.readContract({ address: deployment.token.address, abi: chain.abis.token, functionName: 'balanceOf', args: [a] });
  const nonce = (a: string): Promise<number> => chain.publicClient.getTransactionCount({ address: a, blockTag: 'pending' });

  /** The command as a separate process, as Rafa runs it, with only the environment given here. */
  function cli(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
    return new Promise((resolve) => {
      const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['TIMEOUT_SENDER_KEY', 'SEPOLIA_RPC_URL'].includes(k)));
      const child = spawn(process.execPath, [here('./send-timeout.ts'), ...args], { env: { ...clean, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (b: Buffer) => (out += b.toString()));
      child.stderr.on('data', (b: Buffer) => (out += b.toString()));
      child.on('exit', (code) => resolve({ code, out }));
    });
  }
  const args = (terms: string, o: { dryRun?: boolean; deployment?: string } = {}) => ['--terms', terms, '--deployment', o.deployment ?? deploymentFile(), '--rpc', anvil.rpcUrl, ...(o.dryRun ? ['--dry-run'] : [])];
  /** A real send from the stranger's key; its output never holds the key. */
  async function send(terms: string): Promise<{ code: number | null; out: string }> {
    const r = await cli(args(terms), { TIMEOUT_SENDER_KEY: sender.key });
    expect(r.out.toLowerCase()).not.toContain(sender.key.slice(2).toLowerCase());
    return r;
  }

  it('expireOffer: an offer nobody funded expires once offerExpiresAt passes; before it the command refuses and says when it opens; after it, the deal is closed', async () => {
    const d = new EvmDeal(s, cast, club, 't-365-offer');
    const terms = await termsFile(d);
    const early = await send(terms);
    expect(early.code).toBe(1);
    expect(early.out).toContain(`refusing: no timeout is due for ${d.id}, None on chain 31337`);
    expect(early.out).toContain(`The next one, expireOffer, opens at offerExpiresAt ${d.terms.timing.offerExpiresAt}`);

    await jump(901);
    const r = await send(terms);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`${d.id} is None on chain 31337 (rules ${lc(deployment.rules)}): offerExpiresAt passed at ${d.terms.timing.offerExpiresAt}`);
    expect(r.out).toContain('Due: expireOffer');
    expect(r.out).toContain(`events JobExpired. ${d.id} is now Expired, appeal none.`);
    expect(await dealOf(d.id)).toBe('Expired none');

    const again = await send(terms);
    expect(again.code).toBe(1);
    expect(again.out).toContain(`refusing: ${d.id} is closed on chain 31337 (rules ${lc(deployment.rules)}): it is Expired: its offer was never funded. No timeout remains`);
  }, 120_000);

  it('reclaim: nothing delivered by deliverBy; the dry run prints the plan and changes nothing, then the send refunds the buyer the price and fee', async () => {
    const d = await funded('t-365-reclaim');
    const terms = await termsFile(d);
    await jump(3_601);
    const [buyer, senderNonce] = [await balance(cast.buyer.address), await nonce(sender.address)];

    const dry = await cli(args(terms, { dryRun: true }));
    expect(dry.code, dry.out).toBe(0);
    expect(dry.out).toContain(`${d.id} is Held on chain 31337 (rules ${lc(deployment.rules)}): deliverBy passed at ${d.terms.timing.deliverBy}`);
    expect(dry.out).toContain('Due: reclaim, which nothing was delivered: the price and fee go back to the buyer.');
    expect(dry.out).toContain('dry run: nothing signed or sent');
    expect(await dealOf(d.id)).toBe('Held none');
    expect(await nonce(sender.address)).toBe(senderNonce);
    expect(await balance(cast.buyer.address)).toBe(buyer);

    const r = await send(terms);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`${d.id} is now Refunded, appeal closed.`);
    expect(await balance(cast.buyer.address)).toBe(buyer + BigInt(d.terms.price.amount) + BigInt(d.terms.adjudication.fee.amount));
    expect(await nonce(sender.address)).toBe(senderNonce + 1);
  }, 120_000);

  it('triggerFallback: the primary misses judgeBy after a delivery; the fallback adjudicator takes over', async () => {
    const d = await funded('t-365-fallback', { deliver: true });
    const terms = await termsFile(d);
    const early = await send(terms);
    expect(early.code).toBe(1);
    expect(early.out).toContain(`The next one, triggerFallback, opens at judgeBy ${d.terms.timing.judgeBy}`);
    await jump(4_201);
    const r = await send(terms);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`${d.id} is Delivered on chain 31337 (rules ${lc(deployment.rules)}): judgeBy passed at ${d.terms.timing.judgeBy}`);
    expect(r.out).toContain(`events FallbackTriggered. ${d.id} is now FallbackJudging, appeal none.`);
    expect(await dealOf(d.id)).toBe('FallbackJudging none');
  }, 120_000);

  it('triggerDefault after an escalation: the appeal adjudicator misses appealDecideSec; the price and fee go back to the buyer', async () => {
    const d = await funded('t-365-escalated', { deliver: true });
    await ok(await d.decide('primary', 'escalate'));
    const terms = await termsFile(d);
    await jump(301);
    const buyer = await balance(cast.buyer.address);
    const r = await send(terms);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(new RegExp(`${d.id} is Escalated on chain 31337 \\(rules ${lc(deployment.rules)}\\): appealDecideBy \\(escalated at \\S+ \\+ appealDecideSec 300 s\\) passed`));
    expect(r.out).toContain('Due: triggerDefault');
    expect(r.out).toContain(`${d.id} is now Refunded, appeal closed.`);
    expect(await balance(cast.buyer.address)).toBe(buyer + BigInt(d.terms.price.amount) + BigInt(d.terms.adjudication.fee.amount));
  }, 120_000);

  it('expireAppeal, window unused: nobody appeals an accept before appealBy; the decision becomes final', async () => {
    const d = await funded('t-365-appeal-none', { deliver: true });
    await ok(await d.decide('primary', 'accept'));
    const terms = await termsFile(d);
    expect(await dealOf(d.id)).toBe('Released none');
    const early = await send(terms);
    expect(early.code).toBe(1);
    expect(early.out).toMatch(/The next one, expireAppeal, opens at appealBy \(decided at \S+ \+ appealWindowSec 300 s\)/);
    await jump(301);
    const r = await send(terms);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('Due: expireAppeal');
    expect(r.out).toContain(`events AppealClosed. ${d.id} is now Released, appeal expired.`);
  }, 120_000);

  it('expireAppeal, appeal open: the seller appeals a reject and nobody decides it; the appeal expires and the first decision stands', async () => {
    const d = await funded('t-365-appeal-open', { deliver: true });
    await ok(await d.decide('primary', 'reject'));
    await ok(await d.appealBy('seller', 100_000_000n));
    const terms = await termsFile(d);
    expect(await dealOf(d.id)).toBe('Refunded open');
    await jump(301);
    // The window has closed, but an open appeal waits for its decision deadline as well.
    const early = await send(terms);
    expect(early.code).toBe(1);
    expect(early.out).toMatch(/The next one, expireAppeal, opens at appealDecideBy \(decided at \S+ \+ appealWindowSec 300 s \+ appealDecideSec 300 s\)/);
    const seller = await balance(cast.seller.address);
    await jump(300);
    const r = await send(terms);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`${d.id} is Refunded, appeal open, on chain 31337`);
    expect(r.out).toContain(`${d.id} is now Refunded, appeal expired.`);
    expect(await balance(cast.seller.address)).toBe(seller + 100_000_000n);
  }, 120_000);

  it('neutrality.operators-offline-after-funding: with every operator gone once the deal is funded, the seller delivers to the contract itself, both adjudicators stay silent, and a stranger closes the deal with this command alone: the fallback, then the default refund', async () => {
    const d = await funded('t-365-neutrality');
    const terms = await termsFile(d);
    // Every operator is offline from here: nothing submits through the adapter that opened the deal, and no operator
    // pass ever ran in this suite. The seller posts its signed delivery to HoldbackRules from its own key (ADR-0005).
    const delivery = (await d.deliver()).delivery;
    const wallet = anvil.wallet(cast.seller.key);
    const data = encodeFunctionData({ abi: chain.abis.rules, functionName: 'deliver', args: [live.termsView(d.terms), live.deliveryView(delivery), delivery.signature] });
    const hash = await wallet.sendTransaction({ account: wallet.account, chain: foundry, to: deployment.rules, data, gas: 8_000_000n });
    expect((await anvil.receipt(hash)).status).toBe('success');
    expect(await dealOf(d.id)).toBe('Delivered none');
    const [buyer, parties] = [await balance(cast.buyer.address), [await nonce(cast.buyer.address), await nonce(cast.seller.address)]];

    await jump(4_201);
    const fallback = await send(terms);
    expect(fallback.code, fallback.out).toBe(0);
    expect(fallback.out).toContain(`${d.id} is now FallbackJudging, appeal none.`);
    await jump(600);
    const def = await send(terms);
    expect(def.code, def.out).toBe(0);
    expect(def.out).toContain(`${d.id} is FallbackJudging on chain 31337 (rules ${lc(deployment.rules)}): fallbackBy passed at ${d.terms.timing.fallbackBy}`);
    expect(def.out).toContain(`events Defaulted, Refunded. ${d.id} is now Refunded, appeal closed.`);
    expect(await balance(cast.buyer.address)).toBe(buyer + BigInt(d.terms.price.amount) + BigInt(d.terms.adjudication.fee.amount));
    // The parties sent nothing after the delivery; only the stranger did.
    expect([await nonce(cast.buyer.address), await nonce(cast.seller.address)]).toEqual(parties);
    const closed = await send(terms);
    expect(closed.code).toBe(1);
    expect(closed.out).toContain('is closed on chain 31337');
  }, 120_000);

  describe('refusals against the chain', () => {
    /** Terms only: nothing is submitted for them. */
    const deal = () => new EvmDeal(s, cast, club, `t-365-refusal-${Math.random()}`);
    const record = (over: J) => {
      const p = join(dir, `record-${Math.random().toString(36).slice(2, 8)}.json`);
      writeFileSync(p, JSON.stringify({ ...deployment, ...over }));
      return p;
    };
    it('refuses an RPC that serves another chain than the record names', async () => {
      const r = await cli(args(await termsFile(deal()), { dryRun: true, deployment: record({ chainId: 11155111 }) }));
      expect(r.code).toBe(1);
      expect(r.out).toContain('refusing: the RPC serves chain 31337, but the pinned deployment is on chain 11155111');
    });
    it('refuses terms whose commitment ID is not their own hash', async () => {
      const r = await cli(args(await termsFile(deal(), (c) => ({ ...c, id: `0x${'ab'.repeat(32)}` })), { dryRun: true }));
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/refusing: the terms name the commitment ID 0x(ab){32}, but they hash to 0x[0-9a-f]{64}/);
    });
    it('refuses a record whose rules contract has no code at that address', async () => {
      const r = await cli(args(await termsFile(deal()), { dryRun: true, deployment: record({ rules: sender.address }) }));
      expect(r.code).toBe(1);
      expect(r.out).toContain(`refusing: the deployment record's rules contract ${sender.address} has no code on chain 31337`);
    });
    it('refuses a record whose rules contract signs under another domain than the terms', async () => {
      const r = await cli(args(await termsFile(deal(), (c) => ({ ...without(c, 'id', 'signatures'), schemaVersion: '0.6' })), { dryRun: true }));
      expect(r.code).toBe(1);
      expect(r.out).toContain(`refusing: the rules contract signs under Holdback 0.7, chain 31337, ${lc(deployment.rules)}, and the terms are signed under Holdback 0.6, chain 31337, ${lc(deployment.rules)}`);
    });
    it('refuses a record whose HoldbackBonds is not the one the rules contract created, as a record of other contracts would', async () => {
      const r = await cli(args(await termsFile(deal()), { dryRun: true, deployment: record({ bonds: deployment.escrow }) }));
      expect(r.code).toBe(1);
      expect(r.out).toContain(`refusing: the rules contract's HoldbackBonds is ${lc(deployment.bonds)}, and the deployment record names ${lc(deployment.escrow)}`);
    });
    it('refuses a contract that is not HoldbackRules at the rules address', async () => {
      const r = await cli(args(await termsFile(deal()), { dryRun: true, deployment: record({ rules: deployment.multicall }) }));
      expect(r.code).toBe(1);
      expect(r.out).toContain('does not answer eip712Domain(); it is not a HoldbackRules contract');
    });
  });
});
