// What the signer's tests share (T-434): the signer run as its own process with its keys in its own environment, the
// rules built from examples/signer-rules.v1.json (constraints version 1), a principal's mandate signed by a key made
// in memory, and terms in the shape the operators serve. Not a test file and not a tool: only tests import it.
// Every key here is made in memory for one test run and guards nothing.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { buildMandate, fileOf } from './mandate.ts';
import { commitmentIdOf, freshNonce, jcsHash, SIMCHAIN_DOMAIN, typedDataFile, typedOf, type Domain } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
/** The rules file of constraints version 1, as it sits in the repository: every limit the tests use comes from it. */
export const V1 = JSON.parse(readFileSync(here('./signer-rules.v1.json'), 'utf8'));
export const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const lc = (a: string) => a.toLowerCase();
export const fresh = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

export const DELIVERABLE = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
export const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
];
/** The acceptance a checks-only offer carries: the checks and an empty rubric. */
export const ACCEPTANCE = { deterministicChecks: CHECKS, rubric: { criteria: [], passThreshold: 0 } };

/** The parties of one test: the principal (a hardware wallet in real use), the signer's two keys, the seller, the reviewers. */
export function cast() {
  const key = () => generatePrivateKey();
  const k = { principal: key(), float: key(), buying: key() };
  return {
    keys: k,
    principal: privateKeyToAccount(k.principal),
    float: privateKeyToAccount(k.float).address.toLowerCase(),
    standing: privateKeyToAccount(k.buying).address.toLowerCase(),
    seller: fresh(), payout: fresh(),
    reviewers: { adjudicator: fresh(), fallbackAdjudicator: fresh(), appealAdjudicator: fresh(), policyId: 'demo-policy', policyHash: `0x${'33'.repeat(32)}`, registryHash: `0x${'22'.repeat(32)}`, fee: '1000000' },
    rulebookHash: `0x${'11'.repeat(32)}`,
  };
}
export type Cast = ReturnType<typeof cast>;

/** The version 1 rules with this test's addresses filled in; the limits are the file's own. */
export function rulesFor(c: Cast, o: { reads: string[]; chain?: J; sellers?: J[]; reviewers?: J; clubId?: string; rulebookHash?: string }): J {
  return {
    ...V1, chain: o.chain ?? { network: 'simchain' }, floatAddress: c.float,
    buying: {
      ...V1.buying, principal: c.principal.address.toLowerCase(), standingKey: c.standing, mandatePath: 'mandate.json', clubId: o.clubId ?? V1.buying.clubId, rulebookHash: o.rulebookHash ?? c.rulebookHash,
      reviewers: o.reviewers ?? c.reviewers,
      sellers: o.sellers ?? [{ seller: c.seller, payoutAddress: c.payout, deliverableHashes: [jcsHash(DELIVERABLE)], acceptanceHash: jcsHash(ACCEPTANCE) }],
    },
    reads: { ...V1.reads, operators: o.reads },
  };
}

/** The principal's signed mandate for the standing key, as the hardware wallet would sign the tool's file. */
export async function mandateFor(c: Cast, o: { domain?: Domain; clubId?: string; token?: string; days?: number; now?: number } = {}): Promise<J> {
  const domain = o.domain ?? SIMCHAIN_DOMAIN;
  const doc = buildMandate({ principal: c.principal.address, agent: c.standing, clubId: o.clubId ?? V1.buying.clubId, role: 'buyer', maxPerDeal: '1600000000', maxPerDay: '1600000000', token: o.token ?? 'tUSD', ...(o.days ? { days: o.days } : {}), ...(o.now ? { now: o.now } : {}) });
  return { ...doc, signature: await c.principal.signTypedData(fileOf('Mandate', doc, domain)) };
}

/** Public terms in the operators' shape, inside the version 1 windows unless `o` moves them. */
export function termsFor(c: Cast, o: { price?: string; createdAt?: number; buyer?: string; seller?: string; payout?: string; payer?: string; timing?: J; acceptance?: J; deliverable?: J; adjudication?: J; token?: string; extra?: J } = {}): J {
  const created = Math.floor((o.createdAt ?? Date.now()) / 1000) * 1000, token = o.token ?? 'tUSD';
  const w = V1.buying.windows, deliverBy = created + w.deliverWithinSec * 1000, judgeBy = deliverBy + 60_000;
  return {
    schemaVersion: V1.buying.terms.schemaVersion, clubId: V1.buying.clubId, rulebookHash: c.rulebookHash,
    buyer: o.buyer ?? fresh(), seller: o.seller ?? c.seller, buyerPaymentAddress: o.payer ?? c.float, sellerPayoutAddress: o.payout ?? c.payout,
    deliverable: o.deliverable ?? DELIVERABLE, acceptance: o.acceptance ?? ACCEPTANCE,
    price: { token, amount: o.price ?? '9000000' },
    adjudication: { adjudicator: c.reviewers.adjudicator, fallbackAdjudicator: c.reviewers.fallbackAdjudicator, appealAdjudicator: c.reviewers.appealAdjudicator, policyId: c.reviewers.policyId, fee: { token, amount: c.reviewers.fee }, registryHash: c.reviewers.registryHash, policyHash: c.reviewers.policyHash, ...o.adjudication },
    timing: { offerExpiresAt: iso(created + w.offerExpiresInSec * 1000), fundBy: iso(created + w.fundWithinSec * 1000), deliverBy: iso(deliverBy), judgeBy: iso(judgeBy), fallbackBy: iso(judgeBy + 60_000), appealWindowSec: 0, appealDecideSec: V1.buying.terms.appealDecideSec, maxSubmissions: 1, ...o.timing },
    settlement: { mode: 'guaranteed_on_decision', token }, remedy: { onReject: 'full_refund' }, disclosure: { level: 'public' },
    buyerEncryptionPublicKey: 'A'.repeat(43), nonce: freshNonce().toLowerCase(), createdAt: iso(created), ...o.extra,
  };
}

/** The SimChain funding file for `terms`, as the buyer's tool writes it (fundingFiles). */
export function fundingFileFor(terms: J, domain: Domain = SIMCHAIN_DOMAIN, o: { value?: string; from?: string } = {}): J {
  const total = (BigInt(terms.price.amount) + BigInt(terms.adjudication.fee.amount)).toString();
  return typedDataFile(typedOf('FundingAuthorization', { scheme: 'erc3009', commitmentId: commitmentIdOf(terms), from: o.from ?? terms.buyerPaymentAddress, value: o.value ?? total, token: terms.price.token, validAfter: terms.createdAt, validBefore: terms.timing.fundBy, nonce: freshNonce(), expiresAt: terms.timing.fundBy }, domain));
}

/** A stand-in for the signer's own read endpoints: it answers each deal's escrowState as the test sets it (the chain's part). */
export async function stateServer(): Promise<{ url: string; set(id: string, state: string): void; close(): Promise<void> }> {
  const states = new Map<string, string>();
  const server: Server = createServer((req, res) => {
    const id = /^\/v1\/commitments\/(0x[0-9a-f]{64})$/.exec(req.url ?? '')?.[1];
    const s = id ? states.get(id) : undefined;
    if (!s) return void res.writeHead(404, { 'content-type': 'application/json' }).end('{"type":"not_found"}');
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, escrowState: s }));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, set: (id, s) => void states.set(id, s), close: () => new Promise((ok) => server.close(() => ok())) };
}

export type Running = { url: string; dir: string; rulesPath: string; statePath: string; flagPath: string; revocationsPath: string; proc: ChildProcess; stderr: () => string; post(body: J): Promise<{ status: number; body: J }>; get(path: string): Promise<{ status: number; body: J }>; restart(): Promise<Running>; kill(): Promise<void> };

/**
 * Starts `node examples/signer.ts serve` as its own process: its keys only in its own environment, its rules, mandate,
 * flag ("run") and state in a temporary folder of its own. The test process never holds the signer's keys after this
 * call returns, except where a test says it plays the signer's administrator.
 */
export async function startSigner(c: Cast, rules: J, mandate: J, o: { dir?: string; flag?: string } = {}): Promise<Running> {
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), 'crow-signer-'));
  const rulesPath = join(dir, 'rules.json'), statePath = join(dir, 'state'), flagPath = join(dir, 'flag'), revocationsPath = join(dir, 'revocations');
  if (!o.dir) {
    writeFileSync(rulesPath, JSON.stringify(rules, null, 2));
    writeFileSync(join(dir, 'mandate.json'), JSON.stringify(mandate));
    writeFileSync(flagPath, o.flag ?? 'run\n');
    mkdirSync(revocationsPath);
  }
  if (!o.dir) spawnSync(process.execPath, [here('./signer.ts'), 'init', '--state', statePath], { env: { PATH: process.env['PATH'] ?? '' } });
  const args = [here('./signer.ts'), 'serve', '--rules', rulesPath, '--state', statePath, '--flag', flagPath, '--listen', '127.0.0.1:0'];
  const proc = spawn(process.execPath, args, { env: { PATH: process.env['PATH'] ?? '', CROW_SIGNER_FLOAT_KEY: c.keys.float, CROW_SIGNER_BUYING_KEY: c.keys.buying }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  proc.stderr!.on('data', (d) => (err += String(d)));
  const url = await new Promise<string>((ok, fail) => {
    let out = '';
    proc.stdout!.on('data', (d) => {
      out += String(d);
      const m = /listening (http:\/\/[^\s]+)/.exec(out);
      if (m) ok(m[1]!);
    });
    proc.once('exit', (code) => fail(new Error(`the signer exited with ${code} before it listened: ${err}`)));
  });
  const call = async (method: string, path: string, body?: string) => {
    const res = await fetch(`${url}${path}`, { method, ...(body !== undefined ? { body, headers: { 'content-type': 'application/json' } } : {}) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const kill = () => new Promise<void>((ok) => (proc.exitCode !== null || proc.signalCode !== null ? ok() : (proc.once('exit', () => ok()), proc.kill())));
  const running: Running = {
    url, dir, rulesPath, statePath, flagPath, revocationsPath, proc, stderr: () => err,
    post: (body) => call('POST', '/v1/sign', typeof body === 'string' ? body : JSON.stringify(body)),
    get: (path) => call('GET', path),
    restart: async () => (await kill(), startSigner(c, rules, mandate, { dir })),
    kill,
  };
  return running;
}

/** A payment request as the agent sends it. */
export const payment = (terms: J, file: J = fundingFileFor(terms)) => ({ kind: 'payment', terms, file });
export const cleanup = (dirs: string[]) => dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
export type { Hex };
