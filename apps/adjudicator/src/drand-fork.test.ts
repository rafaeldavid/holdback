// T-217 on a Sepolia fork: the adjudicator service decides a fallback and a party appeal from live drand quicknet
// rounds, and the deployed 0.7 HoldbackRules, over the deployed DrandQuicknetBeacon, accepts both decisions. A decision
// built from a bad proof is refused by the service before any transaction.
//
// Opt-in, like T-213's fork test (apps/demo-cloud/src/live.test.ts): it needs SEPOLIA_FORK_RPC (any Sepolia JSON-RPC),
// anvil on PATH, contracts/deployments/sepolia.json, and the network for the drand relays. Nothing reaches the real
// chain: anvil forks it, and the relayer is anvil's second dev key, funded on the fork only. The file lives here and not
// in packages/settlement/evm/ because it runs the adjudicator service, which that package cannot import.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  beaconRoundAt,
  commitmentId,
  DRAND_QUICKNET,
  DRAND_QUICKNET_CHAIN_HASH,
  holdbackDomain,
  plusSeconds,
  rulebookHash,
  signMessage,
  signTerms,
  wholeSecond,
  type AdjudicatorRegistration,
  type Address,
  type Club,
  type Commitment,
  type CommitmentTerms,
  type Decision,
  type Delivery,
  type Hex32,
  type Judgment,
  type Mandate,
  type Rulebook,
  type TokenAmount,
  type UnsignedMessage,
} from '@holdback/core';
import { encodePublicKey, encryptionKeyPairFromSecretKey, seal, wrapKeyForRecipients } from '@holdback/core/crypto';
import { anvilAvailable } from '@holdback/settlement/evm';
import { ensureBond, EvmSettlement, LIVE_ABIS, LiveChain, rebindToken, type DeploymentFile } from '@holdback/settlement/live';
import { SIM_RULEBOOK, type Genesis } from '@holdback/settlement/sim';
import { createPublicClient, decodeFunctionData, http, keccak256, sha256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drandQuicknet } from './drand.js';
import { policyHashOf } from './policy.js';
import type { RandomnessSource } from './randomness.js';
import { placeholderRegistry, testAdjudicator, type TestAdjudicator } from './test-adjudicator.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const forkRpc = process.env['SEPOLIA_FORK_RPC'];
const deploymentFile = `${root}contracts/deployments/sepolia.json`;
const forkReady = anvilAvailable() && !!forkRpc && existsSync(deploymentFile);
/** anvil's second well-known dev key (public; guards no value): the fork's relayer. */
const RELAYER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const EXAMPLE = JSON.parse(readFileSync(`${root}spec/examples/commitment.example.json`, 'utf8')) as Commitment;
const CSV = readFileSync(`${root}fixtures/data/dataset-cleaning/customers.clean.csv`, 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Keys from public labels; they guard no value. */
const actor = (name: string) => {
  const key = keccak256(stringToBytes(`holdback/t-217-fork/${name}`));
  return { name, key, address: privateKeyToAccount(key).address.toLowerCase() as Address, enc: encryptionKeyPairFromSecretKey(Uint8Array.from(Buffer.from(keccak256(stringToBytes(`enc/${name}`)).slice(2), 'hex'))) };
};

/**
 * anvil 1.0.0 cannot estimate a call whose calldata floor (EIP-7623, Prague) exceeds its execution gas: its binary
 * search goes below the floor and answers "gas floor exceeds the gas limit" (measured 2026-11-04, even for a plain
 * 1,500-byte call). A trigger is such a call. Sepolia's own nodes estimate these calls. This JSON-RPC shim in front of
 * anvil answers only that error, from eth_call: a revert stays a revert, a success gets 1,000,000 gas.
 */
async function estimateShim(upstream: string): Promise<{ url: string; close(): Promise<void> }> {
  type Rpc = { id: number; method: string; params?: unknown[] };
  const forward = (body: unknown) => fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<{ result?: unknown; error?: { message?: string } }>);
  const one = async (r: Rpc) => {
    const answer = await forward(r);
    if (r.method !== 'eth_estimateGas' || !/gas floor exceeds the gas limit/.test(answer.error?.message ?? '')) return answer;
    const call = await forward({ ...r, method: 'eth_call', params: [r.params?.[0], 'latest'] });
    return call.error ? { jsonrpc: '2.0', id: r.id, error: call.error } : { jsonrpc: '2.0', id: r.id, result: '0xf4240' };
  };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Rpc | Rpc[];
    const out = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function until<T>(what: string, f: () => Promise<T | undefined>, ms = 120_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(1000)) {
    const v = await f();
    if (v !== undefined) return v;
  }
  throw new Error(`${what} did not happen within ${ms / 1000} s`);
}

describe.skipIf(!forkReady)(`drand quicknet decisions on a Sepolia fork (T-217)${forkReady ? '' : ' (SKIPPED: needs SEPOLIA_FORK_RPC, anvil and contracts/deployments/sepolia.json)'}`, () => {
  let anvil: ChildProcess;
  let rpc: string;
  let shim: Awaited<ReturnType<typeof estimateShim>> | undefined;
  let forkBlock: bigint;
  const deployment = forkReady ? (JSON.parse(readFileSync(deploymentFile, 'utf8')) as DeploymentFile) : (undefined as never);

  beforeAll(async () => {
    const port = await new Promise<number>((resolve) => {
      const s = createNetServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    // Prague, as Sepolia runs: the drand verifier needs EIP-2537's BLS precompiles.
    anvil = spawn('anvil', ['--fork-url', forkRpc!, '--hardfork', 'prague', '--host', '127.0.0.1', '--port', String(port), '--block-time', '1', '--silent'], { stdio: 'ignore' });
    rpc = `http://127.0.0.1:${port}`;
    const call = (method: string, params: unknown[]) => fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json() as Promise<{ result?: unknown }>);
    // anvil forks over the public RPC, which can take a while to answer.
    let up = false;
    for (let i = 0; i < 400 && !up; i++) up = !!(await call('eth_chainId', []).catch(() => ({ result: undefined }))).result || (await sleep(200), false);
    if (!up) throw new Error(`anvil did not fork ${forkRpc} within 80 s`);
    forkBlock = BigInt((await call('eth_blockNumber', [])).result as string);
    await call('anvil_setBalance', [privateKeyToAccount(RELAYER).address, '0x8ac7230489e80000']);
    shim = await estimateShim(rpc);
  }, 90_000);
  afterAll(async () => {
    await shim?.close();
    anvil?.kill();
  });

  it('decides a fallback and a party appeal from live quicknet rounds; the deployed contract accepts both, and a bad proof never reaches it', async () => {
    const chain = new LiveChain({ deployment, rpcUrls: [shim!.url], relayerKey: RELAYER, pollMs: 300, rebroadcastMs: 20_000, mintBatchMs: 300 });
    await chain.verify();
    await chain.topUpLanes(10n ** 17n, 10n ** 18n);
    const token = deployment.token.address.toLowerCase();
    const amount = (v: bigint) => ({ token, amount: v.toString() }) as TokenAmount;
    const domain = holdbackDomain(deployment.chainId, deployment.rules.toLowerCase() as Address);
    const [buyer, seller, primary, fallback, appeal] = ['buyer', 'seller', 'primary', 'fallback', 'appeal'].map(actor) as [ReturnType<typeof actor>, ReturnType<typeof actor>, ReturnType<typeof actor>, ReturnType<typeof actor>, ReturnType<typeof actor>];

    // A club whose rulebook names drand quicknet, with windows short enough to run in about two minutes (D31).
    const rulebook: Rulebook = { ...rebindToken(SIM_RULEBOOK, 'tUSD', token), disclosureMin: 'public', minWindowsSec: { judge: 10, fallback: 60, appealWindow: 60, appealDecide: 60 }, appealFee: amount(0n), randomness: { source: 'drand-quicknet', chainHash: DRAND_QUICKNET_CHAIN_HASH } };
    const club: Club = { id: 't-217-fork', name: 'T-217 fork club', operator: primary.address, rulebook, rulebookHash: rulebookHash(rulebook) };
    const start = wholeSecond(Date.now());
    const mandates: Mandate[] = [];
    for (const who of [buyer, seller]) {
      const principal = actor(`${who.name}-principal`);
      const big = amount(10n ** 15n);
      const body = { principal: principal.address, agent: who.address, clubId: club.id, scope: { roles: ['buyer', 'seller'], maxPerCommitment: big, maxDaily: big, expiresAt: plusSeconds(start, 86_400) }, nonce: keccak256(stringToBytes(`mandate/${who.name}/${start}`)), issuedAt: start } as Omit<Mandate, 'signature'>;
      mandates.push({ ...body, signature: await signMessage(principal.key, domain, { ...body, type: 'Mandate' } as UnsignedMessage) } as Mandate);
    }
    const genesis: Genesis = { start, simSeed: keccak256(stringToBytes('t-217-fork')), chainId: deployment.chainId, token, clubs: [club], mandates, members: [], balances: {}, bonds: {} };
    const evm = await EvmSettlement.restore(chain, genesis);

    const price = 5_000_000n; // 5.00 tUSDC
    const fee = 1_000_000n; // 1.00 tUSDC
    for (const a of [primary, fallback, appeal]) await ensureBond(chain, a.key, price * 2n, 10n ** 17n);
    await chain.mint(buyer.address, 100n * price);

    // The three adjudicator services, each reading quicknet rounds from the live relays through its own counted source.
    const blobs = new Map<string, Uint8Array>();
    const records = new Map<string, Judgment>();
    const registrations = new Map<string, AdjudicatorRegistration>();
    const relayRequests = new Map<string, string[]>();
    const counted = (who: string, over?: RandomnessSource): RandomnessSource => {
      relayRequests.set(who, []);
      return over ?? drandQuicknet({ fetch: (input, init) => (relayRequests.get(who)!.push(String(input)), fetch(input, init)), log: (l) => console.log(`${who}: ${l}`) });
    };
    const registry = placeholderRegistry();
    const service = (a: ReturnType<typeof actor>, drand: RandomnessSource): TestAdjudicator => {
      const adj = testAdjudicator({
        name: a.name,
        label: `t217-${a.name}`,
        signingKey: a.key,
        encryptionSecretKey: a.enc.secretKey,
        chain: evm,
        store: { ciphertext: async (uri) => blobs.get(uri)!, publishRecord: async (r) => (records.set(r.recordHash, r), `mem://records/${r.recordHash}`) },
        registration: async (address) => registrations.get(address.toLowerCase()) ?? null,
        domain,
        fee: amount(fee),
        registry,
        trustedAdjudicators: [primary.address, fallback.address, appeal.address],
        drand,
      });
      registrations.set(adj.address, { ...adj.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
      return adj;
    };
    const p = service(primary, counted('primary'));
    const f = service(fallback, counted('fallback'));
    const a = service(appeal, counted('appeal'));

    // Offer, acceptance, agreement and funding, and the sealed delivery; then the primary stays silent.
    const now = wholeSecond(Date.now());
    const terms: CommitmentTerms = {
      schemaVersion: '0.7',
      clubId: club.id,
      rulebookHash: club.rulebookHash,
      buyer: buyer.address,
      seller: seller.address,
      deliverable: EXAMPLE.deliverable,
      acceptance: EXAMPLE.acceptance,
      price: amount(price),
      adjudication: { adjudicator: primary.address, fallbackAdjudicator: fallback.address, appealAdjudicator: appeal.address, policyId: p.service.policy.id, fee: amount(fee), registryHash: registry.hash, policyHash: policyHashOf(p.service.policy) },
      timing: { offerExpiresAt: plusSeconds(now, 60), fundBy: plusSeconds(now, 70), deliverBy: plusSeconds(now, 80), judgeBy: plusSeconds(now, 90), fallbackBy: plusSeconds(now, 600), appealWindowSec: 300, appealDecideSec: 300, maxSubmissions: 1 },
      settlement: { mode: 'guaranteed_on_decision', token },
      remedy: { onReject: 'full_refund' },
      disclosure: { level: 'public' },
      buyerEncryptionPublicKey: encodePublicKey(buyer.enc.publicKey),
      nonce: keccak256(stringToBytes(`t-217-fork/terms/${now}`)),
      createdAt: now,
    } as CommitmentTerms;
    const id = commitmentId(terms);
    const must = (r: { ok: boolean; problem?: { detail: string } }) => {
      if (!r.ok) throw new Error(r.problem?.detail);
    };
    const signed = async <T extends UnsignedMessage>(who: ReturnType<typeof actor>, m: T) => ({ ...m, signature: await signMessage(who.key, domain, m) });
    must(await evm.submit({ kind: 'offer', commitment: { ...terms, id, signatures: { seller: await signTerms(seller.key, domain, terms) } } }));
    expect(evm.escrowState(id)?.beaconSource).toBe('drand-quicknet');
    expect((await p.runOnce()).accepted).toEqual([id]);
    const agree = await signed(buyer, { type: 'Agree', commitmentId: id, buyer: buyer.address, nonce: keccak256(stringToBytes(`agree/${id}`)), expiresAt: terms.timing.offerExpiresAt } as const);
    const fa = await evm.fundingAuthorization(terms);
    const funding = { type: 'FundingAuthorization' as const, scheme: 'erc3009' as const, commitmentId: id, from: buyer.address, value: fa.value.toString(), token, validAfter: fa.validAfter, validBefore: fa.validBefore, nonce: fa.nonce, expiresAt: terms.timing.fundBy, signature: await sign({ hash: fa.digest, privateKey: buyer.key, to: 'hex' }) };
    must(await evm.submit({ kind: 'agree_and_fund', agree, funding }, { idempotencyKey: `fund/${id}` }));
    const sealed = await seal(new TextEncoder().encode(CSV));
    const uri = `mem://ciphertext/${sealed.ciphertextSha256}`;
    blobs.set(uri, sealed.ciphertext);
    const recipients = [primary, fallback, appeal, buyer].map((x) => ({ recipient: x.address, publicKey: x.enc.publicKey }));
    const body: Omit<Delivery, 'signature'> = { commitmentId: id, attempt: 1, ciphertext: { uri, sha256: sealed.ciphertextSha256, bytes: sealed.ciphertext.length, cipher: 'aes-256-gcm' }, plaintextSha256: sealed.plaintextSha256, plaintextMime: 'text/csv', encryptedKeys: wrapKeyForRecipients(sealed.key, recipients), submittedAt: evm.now() };
    must(await evm.submit({ kind: 'deliver', delivery: (await signed(seller, { ...body, type: 'Delivery' as const })) as unknown as Delivery }, { idempotencyKey: `deliver/${id}` }));
    expect(evm.escrowState(id)?.kind).toBe('Delivered');

    // The fallback takes over at judgeBy and decides from the quicknet round at judgeBy, which the contract verifies.
    const judgeByRound = beaconRoundAt(DRAND_QUICKNET, Date.parse(terms.timing.judgeBy) / 1000);
    await until('the fallback decision', async () => ((await f.runOnce()).decided.some((d) => d.role === 'fallback') ? true : undefined));
    const released = evm.escrowState(id);
    expect(released?.kind).toBe('Released');
    const first = released?.kind === 'Released' && released.via.kind === 'first_instance' ? released.via.decision : (undefined as never as Decision);
    expect(first.role).toBe('fallback');
    expect(first.beacon).toMatchObject({ source: 'drand-quicknet', round: judgeByRound });
    expect(first.beacon!.value).toBe(sha256(first.beacon!.signature!));
    console.log(`fallback decision: round ${judgeByRound}, ${relayRequests.get('fallback')!.length} relay request(s): ${relayRequests.get('fallback')!.join(', ')}`);

    // The buyer appeals. A service whose source returns a tampered proof refuses before any transaction.
    const appealBody = { commitmentId: id, appellant: 'buyer' as const, appellantAddress: buyer.address, grounds: 'wrong-outcome', bond: amount(0n), filedAt: evm.now() };
    must(await evm.submit({ kind: 'appeal', appeal: await signed(buyer, { ...appealBody, type: 'Appeal' as const }) as never }, { idempotencyKey: `appeal/${id}` }));
    const filed = evm.escrowState(id);
    const openedAt = filed?.kind === 'Released' && filed.via.kind === 'first_instance' && filed.via.appeal.kind === 'open' ? filed.via.appeal.openedAt : (undefined as never as string);
    const appealRound = beaconRoundAt(DRAND_QUICKNET, Math.floor(Date.parse(openedAt) / 1000)) + 1;
    const honest = drandQuicknet({});
    const lying: RandomnessSource = {
      kind: 'drand-quicknet',
      clock: DRAND_QUICKNET,
      async value(round) {
        const real = await honest.value(round);
        if (!real?.signature) return null;
        const signature = `${real.signature.slice(0, 40)}${real.signature[40] === '0' ? '1' : '0'}${real.signature.slice(41)}` as Hex;
        return { value: sha256(signature) as Hex32, signature };
      },
    };
    const liar = service(appeal, counted('liar', lying));
    const fork = createPublicClient({ transport: http(rpc) });
    // viem caches the head for 4 s by default; every read here must be fresh.
    const head = () => fork.getBlockNumber({ cacheTime: 0 });
    const before = await head();
    const refused = await until('the bad proof refused', async () => (await liar.runOnce()).refused.find((r) => /does not prove drand quicknet round/.test(r.problem.detail)));
    expect(refused.problem.type).toBe('seed_mismatch');
    let sent = 0;
    // A send would be mined within a block or two (one a second): wait for two, then count every transaction since.
    const refusedAt = await head();
    await until('two more blocks', async () => ((await head()) >= refusedAt + 2n ? true : undefined), 30_000);
    const latest = await head();
    expect(latest).toBeGreaterThan(before);
    for (let b = before + 1n; b <= latest; b++) sent += (await fork.getBlock({ blockNumber: b })).transactions.length;
    expect(sent).toBe(0);
    registrations.set(a.address, { ...a.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });

    // The honest appeal adjudicator decides from the first quicknet round after the filing.
    await until('the appeal decision', async () => ((await a.runOnce()).decided.some((d) => d.role === 'appeal') ? true : undefined));
    const after = evm.escrowState(id);
    const upheld = after?.kind === 'Released' && after.via.kind === 'first_instance' && after.via.appeal.kind === 'upheld' ? after.via.appeal.decision : (undefined as never as Decision);
    expect(upheld.role).toBe('appeal');
    expect(upheld.beacon).toMatchObject({ source: 'drand-quicknet', round: appealRound });
    console.log(`appeal decision: round ${appealRound}, ${relayRequests.get('appeal')!.length} relay request(s): ${relayRequests.get('appeal')!.join(', ')}`);

    // Every call to the rules contract since the fork, with its gas on the fork (anvil prices by Prague).
    const calls: string[] = [];
    for (let b = forkBlock + 1n, end = await head(); b <= end; b++) {
      for (const t of (await fork.getBlock({ blockNumber: b, includeTransactions: true })).transactions) {
        if (t.to?.toLowerCase() !== deployment.rules.toLowerCase()) continue;
        const r = await fork.getTransactionReceipt({ hash: t.hash });
        calls.push(`${decodeFunctionData({ abi: LIVE_ABIS.rules, data: t.input }).functionName} ${r.gasUsed} gas ${r.status}`);
      }
    }
    console.log(`rules contract calls on the fork: ${calls.join('; ')}`);
    expect(calls.filter((c) => c.startsWith('decide ')).map((c) => c.endsWith('success'))).toEqual([true, true]);
  }, 600_000);
});
