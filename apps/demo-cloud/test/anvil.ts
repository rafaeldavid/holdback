// What the demo world's anvil tests share (live.test.ts, registration.anvil.test.ts): the world served as two nodes
// over HTTP, the deployment anvil's contracts make, fresh parties, and the outside adjudicator of T-221 with the deal
// it is named primary in. Not a test file and not in the build: only tests import it.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey } from 'viem/accounts';
import type { Hex } from 'viem';
import { canonicalKeccak, holdbackDomain, wholeSecond, type Address, type Hex32, type RegisteredAdjudicator } from '@holdback/core';
import { placeholderRegistry, testAdjudicator, type SettlementReads, type TestAdjudicator, type TestAdjudicatorOptions } from '@holdback/adjudicator';
import { signRegistration, testAccount, type TestAccount } from '@holdback/operator';
import type { Submission } from '@holdback/settlement';
import type { DeploymentFile, EvmSettlement } from '@holdback/settlement/live';
import { anvilAvailable, type EvmWorld } from '@holdback/settlement/evm';
import { expect } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { pinOf } from '../../../examples/verify.ts';
import type { PublicWorld } from '../src/index.js';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
/** anvil on PATH and the contracts built: the anvil tests run, else they skip and say why. */
export const ready = anvilAvailable() && existsSync(`${root}contracts/out/HoldbackRules.sol/HoldbackRules.json`);
/** anvil's second well-known dev key (public; guards no value): the relayer's funding lane here. */
export const RELAYER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
/** The demo's fee: 1 bp, minimum 0.01 tUSDC plus the 4.70 tUSDC gas quote a chain world adds (D33 as amended). */
export const ENV = { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000', OPERATOR_FEE_GAS: '4700000' };

export type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const lc = (a: string) => a.toLowerCase();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The terms a registration binds for its own bond pool: the adjudicator alone, no backers (ADR-0014 is Phase 4). */
const OWN_POOL = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10000, noticePeriodSec: 0 };
export const PRICE = '25000000'; // 25 tUSDC
export const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
const DATASET = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
];

/** The deployment file of the contracts anvil deployed, as Sepolia's is pinned. */
export function deploymentOf(anvil: EvmWorld): DeploymentFile {
  const d = anvil.deployment;
  return {
    chainId: anvil.chainId,
    fromBlock: Number(d.fromBlock),
    token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
    escrow: d.escrow,
    erc3009Collector: d.erc3009Collector,    multicall: d.multicall,
    rules: d.rules,
    beacon: d.beacon,
    expiryMarginSec: Number(anvil.expiryMargin),
  };
}

import { serveTwoOrigins } from '../../../examples/two-origins.ts';
/** Serves a world as two nodes (127.0.0.1 is node 0, localhost node 1), with its passes every 200 ms. */
export const serve = (world: PublicWorld): Promise<{ urls: [string, string]; close(): Promise<void> }> => serveTwoOrigins(world, { tickMs: 200 });

/**
 * anvil 1.0.0 cannot estimate a call whose calldata floor (EIP-7623, Prague) exceeds its execution gas: it answers "gas
 * floor exceeds the gas limit" (T-217 Decision 11, measured). A relayed trigger is such a call; Sepolia's own nodes
 * estimate it. This JSON-RPC shim in front of anvil answers only that error, from eth_call: a revert stays a revert, a
 * success gets 1,000,000 gas. The same shim as apps/adjudicator/src/drand-fork.test.ts.
 */
export async function estimateShim(upstream: string): Promise<{ url: string; close(): Promise<void> }> {
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
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Serves one world at a time as two nodes on fixed origins, as the Workers keep their addresses across a deploy, with
 * its passes every 200 ms (T-220). `deploy` waits for the running pass to end, then serves the world `next` opens,
 * usually from the same storage: a Worker deploy restarts the Durable Object, and the new code opens the world again.
 */
export async function host(first: PublicWorld): Promise<{ urls: [string, string]; pause(): Promise<void>; deploy(next: () => Promise<PublicWorld>): Promise<PublicWorld>; close(): Promise<void> }> {
  let current = first;
  let paused = false;
  let pass: Promise<void> = Promise.resolve();
  const server: Server = createServer(async (req, res) => {
    const at = req.headers.host ?? '';
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const r = await current.fetch(new Request(`http://${at}${req.url}`, { method: req.method ?? 'GET', headers, ...(body ? { body } : {}) }), { node: at.startsWith('localhost') ? 1 : 0, origin: `http://${at}`, client: req.socket.remoteAddress ?? 'unknown' });
    res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => k !== 'content-length')));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  let ticking = true;
  const loop = (async () => {
    while (ticking) {
      if (!paused) await (pass = current.work().catch(() => undefined));
      await sleep(200);
    }
  })();
  return {
    urls: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    /** Stops the passes (requests are still served) once the running pass ends; `deploy` starts them again. */
    pause: async () => {
      paused = true;
      await pass;
    },
    deploy: async (next) => {
      paused = true;
      await pass;
      current = await next();
      paused = false;
      return current;
    },
    close: async () => {
      ticking = false;
      await loop;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

/**
 * An outside adjudicator (T-221, ADR-0030), as an agent runs one: the reference adjudicator's code under its own key,
 * registered through POST /v1/adjudicators, and sending its acceptances, decisions and triggers through the operators'
 * HTTP API. It reads the deals from the world's settlement view, as it would from an operator's reads. The phase-one
 * contracts hold no bond (ADR-0031 §8), so it posts none and accepts with bondReserved 0.
 */
export class Outsider {
  readonly account: TestAccount;
  adj: TestAdjudicator;

  constructor(
    private readonly world: PublicWorld,
    private readonly urls: readonly string[],
    label: string,
    private readonly o: { trusted: readonly string[]; provider?: TestAdjudicatorOptions['provider'] },
  ) {
    this.account = testAccount(label);
    this.adj = this.build(placeholderRegistry(), 'file:///config/judges.yaml');
  }

  get address(): Address {
    return this.account.address;
  }

  /** Runs the same adjudicator with another registry (the registry_mismatch case): a new registration must bind it. */
  rebind(registry: NonNullable<TestAdjudicatorOptions['registry']>, uri: string): void {
    this.adj = this.build(registry, uri);
  }

  private build(registry: NonNullable<TestAdjudicatorOptions['registry']>, registryUri: string): TestAdjudicator {
    const evm = this.world.chain as EvmSettlement;
    const api = this.urls[0]!;
    const post = async (path: string, body: unknown, key: string): Promise<J> => {
      const res = await fetch(`${api}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
      const out = (await res.json()) as J;
      return res.ok ? { ok: true, state: out } : { ok: false, problem: out };
    };
    // The world's settlement view for reads; every write goes through the operator, as an outside agent's would.
    const reads = new Proxy(evm, {
      get(target, prop) {
        if (prop === 'submit') {
          return (s: Submission, opts?: { idempotencyKey?: string }) => {
            const key = opts?.idempotencyKey ?? crypto.randomUUID();
            if (s.kind === 'adjudicator_accept') return post(`/v1/commitments/${s.message.commitmentId}/acceptance`, s.message, key);
            if (s.kind === 'decide') return post(`/v1/commitments/${s.message.commitmentId}/decisions`, s.message, key);
            throw new Error(`an outside adjudicator sends no ${s.kind}`);
          };
        }
        if (prop === 'trigger') return (id: Hex32, timeout: string) => post(`/v1/commitments/${id}/triggers/${timeout.replace(/_/g, '-')}`, {}, crypto.randomUUID());
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as unknown as SettlementReads;
    const token = lc((this.world.chain as EvmSettlement).world.deployment.token);
    return testAdjudicator({
      name: 'Outside adjudicator (test)',
      label: this.account.label,
      signingKey: this.account.privateKey,
      encryptionSecretKey: this.account.encryptionSecretKey,
      chain: reads,
      store: {
        ciphertext: async (uri) => new Uint8Array(await (await fetch(uri)).arrayBuffer()),
        publishRecord: async (record) => `https://outsider.test/judgments/${record.commitmentId}`,
      },
      registration: async (address) => {
        const res = await fetch(`${api}/v1/adjudicators/${address}`);
        return res.ok ? ((await res.json()) as J) : null;
      },
      domain: holdbackDomain(evm.world.chainId, lc(evm.world.deployment.rules) as Address),
      // The demo adjudicators' quote: as fallback or appeal adjudicator they decline a deal whose fee is below theirs.
      fee: { token, amount: '1000000' } as TestAdjudicatorOptions['fee'],
      registry,
      registryUri,
      trustedAdjudicators: this.o.trusted as Address[],
      ...(this.o.provider ? { provider: this.o.provider } : {}),
    });
  }

  /** Its signed registration, as the llms.txt recipe builds it: the record with `pool` holding only `terms`. */
  async registration(issuedAt: string): Promise<RegisteredAdjudicator> {
    const body = { ...this.adj.registration(), pool: { terms: { ...OWN_POOL } }, poolTermsHash: canonicalKeccak(OWN_POOL), status: 'active' as const };
    const evm = this.world.chain as EvmSettlement;
    const envelope = { keyId: `${this.account.label}/${issuedAt}`, issuedAt: issuedAt as RegisteredAdjudicator['registration']['issuedAt'], nonce: canonicalKeccak({ outsider: this.address, issuedAt }), expiresAt: wholeSecond(Date.parse(issuedAt) + 30 * 86_400_000) };
    return signRegistration(this.account.privateKey, holdbackDomain(evm.world.chainId, lc(evm.world.deployment.rules) as Address), body, envelope);
  }

  /** Registers through the API; `policy` changes fields of the policy it publishes (a rotation after agreement). */
  async register(issuedAt: string, policy: Partial<RegisteredAdjudicator['policy']> = {}): Promise<{ status: number; body: J }> {
    let signed = await this.registration(issuedAt);
    if (Object.keys(policy).length) {
      const { registration: envelope, ...body } = signed;
      const rotated = { ...body.policy, ...policy };
      const evm = this.world.chain as EvmSettlement;
      const { bodyHash: _b, signature: _s, ...rest } = envelope; // eslint-disable-line @typescript-eslint/no-unused-vars
      signed = await signRegistration(this.account.privateKey, holdbackDomain(evm.world.chainId, lc(evm.world.deployment.rules) as Address), { ...body, policy: rotated, policyHash: canonicalKeccak(rotated) }, rest);
    }
    const res = await fetch(`${this.urls[0]}/v1/adjudicators`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(signed) });
    return { status: res.status, body: await res.json() };
  }

  /** One pass of the reference adjudicator. */
  async runOnce() {
    return this.adj.runOnce();
  }
}

/** A buyer or a seller with fresh keys, pinned to the world's deployment as try.ts pins Sepolia's. */
export function party(urls: readonly string[], deployment: DeploymentFile): { agent: Agent; key: Hex } {
  const key = generatePrivateKey();
  const pin = pinOf(deployment);
  return { key, agent: new Agent([...urls], key, crypto.getRandomValues(new Uint8Array(32)), pin.domain, pin.chain) };
}

/** Polls both nodes until each reports one of `states` under `field` (escrowState by default). */
export async function untilBoth(agent: Agent, id: string, states: string[], timeoutMs: number, field = 'escrowState'): Promise<J> {
  let seen: J[] = [];
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(250)) {
    seen = await Promise.all(agent.sources().map((api) => agent.call('GET', `/v1/commitments/${id}`, undefined, api)));
    if (seen.every((s) => states.includes(s[field]))) return seen[0];
  }
  throw new Error(`${id} is ${seen.map((s) => `${s.escrowState}/${s.appealState}`).join(' and ')} after ${timeoutMs / 1000} s, not ${states.join(' or ')} (${field}); notices: ${seen.flatMap((s) => s.notices ?? []).join(' | ')}`);
}

/**
 * One deal with `outsider` as primary and the demo's fallback and appeal adjudicators (unless `adjudicators` names
 * others): the seller offers, the outsider accepts with an acceptance it builds itself, the buyer funds, the seller
 * delivers. Returns once Delivered on both nodes; the outsider has not decided.
 */
export async function outsideDeal(
  urls: readonly string[],
  deployment: DeploymentFile,
  outsider: Outsider,
  o: { work: string; rubric?: boolean; timing: Record<string, number>; adjudicators?: { fallback: string; appeal: string } },
): Promise<{ id: Hex32; terms: J; offered: J; buyer: Agent; buyerKey: Hex; seller: Agent }> {
  const d = (await (await fetch(`${urls[0]}/.well-known/holdback.json`)).json()) as J;
  const [, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address as string);
  const [b, s] = [party(urls, deployment), party(urls, deployment)];
  for (const a of [b.agent, s.agent]) await a.call('POST', '/v1/faucet', { address: a.address });
  const token = lc(deployment.token.address);
  const offer = await s.agent.offer({
    template: o.rubric ? 'default' : 'checks-only',
    clubId: d.demo.clubId,
    seller: s.agent.address,
    buyer: { address: b.agent.address, encryptionPublicKey: b.agent.encryptionPublicKey },
    adjudicators: { primary: outsider.address, fallback: o.adjudicators?.fallback ?? fallback, appeal: o.adjudicators?.appeal ?? appeal },
    price: { token, amount: PRICE },
    ...(o.rubric
      ? {
          deliverable: { kind: 'document', description: 'A one-paragraph product summary', format: 'text/plain' },
          checks: [{ id: 'hidden', type: 'hidden_characters_max', required: true, max: { tag: 0, bidi: 0, total: 0 } }],
          rubric: { passThreshold: 300, criteria: [{ id: 'clear', description: 'The summary is clear and accurate.', weight: 100, anchors: { '0': 'Unclear', '2': 'Partly', '4': 'Clear' } }] },
        }
      : { deliverable: DATASET, checks: CHECKS }),
    timing: o.timing,
  });
  const accepted = await outsider.runOnce();
  expect(accepted.accepted).toContain(offer.id);
  await untilBoth(b.agent, offer.id, ['AcceptedByAdjudicator'], 30_000);
  const held = await b.agent.agreeAndFund(offer.terms, 40_000_000n);
  expect(held.escrowState).toBe('Held');
  await untilBoth(s.agent, offer.id, ['Held'], 60_000);
  await s.agent.deliver(offer.terms, new TextEncoder().encode(o.work));
  await untilBoth(b.agent, offer.id, ['Delivered'], 60_000);
  return { id: offer.id as Hex32, terms: offer.terms, offered: offer.state, buyer: b.agent, buyerKey: b.key, seller: s.agent };
}

/** Runs a script of the repository in its own process, as an agent would, and keeps its output. */
export function runTry(env: Record<string, string>, script = 'examples/try.ts'): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`${root}${script}`], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (out += String(d)));
    child.on('close', (code) => resolve({ code, out }));
  });
}
