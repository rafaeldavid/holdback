// A local world to build against (`pnpm sim`, docs/quickstart.md): one SimChain, operator nodes over it that
// share a ciphertext store, three test adjudicators with fake judges, and funded test accounts. It runs in one
// process; agents reach it over HTTP only, through the operators' REST API. A small sim service beside them
// lists the test accounts and moves the clock. With publishSecrets (the default, for one developer's `pnpm
// sim`) it lists their keys too: they derive from public labels and guard nothing. A world shared by several
// parties (tools/sim) turns it off: keys then derive from the label and a random per-world secret, and no
// route but the caller's own POST /accounts ever serves one. No real money: SimChain, the test token tUSD,
// and the operators' startup guards run on the real environment.
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { canonicalKeccak, holdbackDomain, parseAdjudicator, type AdjudicatorRegistration, type Address, type Hex32, type Judgment, type Timestamp } from '@holdback/core';
import { MemoryCiphertextStore } from '@holdback/core/store';
import { FAIL_MARKER, testAdjudicator, type TestAdjudicator } from '@holdback/adjudicator';
import type { FakeScript } from '@holdback/judgment';
import { mandateFor, SIM_CHAIN_ID, SIM_RULEBOOK, simClub, SimChain, TOKEN, wideScope, type Genesis } from '@holdback/settlement/sim';
import { testAccount } from './accounts.js';
import { simRegistry } from './registry.js';
import { startOperator, type RunningOperator } from './server.js';
import { TUSD } from './units.js';

export type SimRole = 'primary' | 'fallback' | 'appeal';

/** A test account as the sim service lists it when it keeps secrets: no signing or encryption secret key. */
export interface SimPublicAccount {
  label: string;
  address: Address;
  balance: string;
  encryptionPublicKey: string;
}

/** A test account with its keys: this process's own view, and what GET / lists when publishSecrets is on. */
export interface SimAccount extends SimPublicAccount {
  privateKey: `0x${string}`;
  encryptionSecretKey: string;
}

/** What GET <sim>/ serves: SimInfo, with accounts stripped of their secret keys unless publishSecrets is on. */
export type SimPublicInfo = Omit<SimInfo, 'accounts'> & { accounts: Array<SimAccount | SimPublicAccount> };

/** Where everything is, with every account's keys: the process that started the world holds them all. */
export interface SimInfo {
  kind: 'holdback-sim';
  chainId: number;
  /** The EIP-712 domain to configure in your agent (pin it there; do not take it from an operator). */
  domain: { name: 'Holdback'; version: string; chainId: number; verifyingContract: Address };
  clubId: string;
  /** Operator base URLs (each serves /v1 and /.well-known/holdback.json). */
  operators: string[];
  token: { symbol: 'tUSD'; decimals: 6 };
  adjudicators: Array<{ role: SimRole; name: string; address: Address; fakeJudges: true }>;
  /** Funded test accounts. TEST KEYS ONLY: each derives from its label (and, without publishSecrets, a per-world secret). */
  accounts: SimAccount[];
  /** The club rulebook's economics: base units and basis points. */
  economics: Record<string, string>;
  notes: string[];
}

export interface SimWorldOptions {
  host?: string;
  /** Port of the sim service; 0 picks a free one. */
  port?: number;
  /** One port per operator node (0 picks a free one). Default: two nodes. */
  operatorPorts?: readonly number[];
  /** Funded test accounts, by label. Each may act as buyer or seller. */
  accounts?: readonly string[];
  /**
   * Whether the sim service's public routes (GET / and the rest) list the accounts' signing and encryption
   * secret keys. Default true: in one developer's `pnpm sim` every account is theirs, and the keys derive from
   * public labels. Set it false when several parties share the world (tools/sim): keys then derive from each
   * label plus a random per-world secret, GET / lists addresses and public keys only, and an account's keys
   * reach only the caller of the POST /accounts that hands it out. `SimWorld.info` holds every key either way.
   */
  publishSecrets?: boolean;
  /** More funded accounts, handed out one at a time by POST <sim>/accounts. Default 32. */
  spareAccounts?: number;
  /** Each account's starting balance in base units. Default 10,000 tUSD. */
  balance?: bigint;
  /** Each adjudicator's bond in base units. Default 25,000 tUSD. */
  bond?: bigint;
  /** Each adjudicator's minimum fee in base units. Default 1 tUSD. */
  fee?: bigint;
  /** Fake-judge scripts per adjudicator role; unscripted judges pass. */
  judges?: Partial<Record<SimRole, FakeScript>>;
  /** How often the adjudicators look for work, in ms. Default 100. */
  pollMs?: number;
  /** Checked by the operators' startup guards (no real money). Default: process.env. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Where adjudicator errors go. Default: stderr. */
  onError?: (e: Error) => void;
}

export interface SimWorld {
  url: string;
  /** Every account with its keys, for this process only (never served unless publishSecrets is on). */
  info: SimInfo;
  /** Exactly what GET <sim>/ serves. */
  published: SimPublicInfo;
  chain: SimChain;
  operators: readonly RunningOperator[];
  adjudicators: Record<SimRole, TestAdjudicator>;
  /** Stops (or restarts) an adjudicator looking for work, to try fallback and default paths. */
  silence(role: SimRole, silent: boolean): void;
  /** Moves the clock forward (the sim clock otherwise follows the wall clock). */
  advance(seconds: number): Timestamp;
  close(): Promise<void>;
}

export const DEFAULT_ACCOUNTS = ['buyer-1', 'seller-1', 'buyer-2', 'seller-2'] as const;
export const SIM_CLUB_ID = 'sim-club';
const ADJUDICATORS: ReadonlyArray<{ role: SimRole; label: string; name: string }> = [
  { role: 'primary', label: 'sim-adjudicator-a', name: 'Sim Adjudicator A (fake judges)' },
  { role: 'fallback', label: 'sim-adjudicator-b', name: 'Sim Adjudicator B (fake judges)' },
  { role: 'appeal', label: 'sim-adjudicator-c', name: 'Sim Adjudicator C (fake judges)' },
];
/** Bond pool terms the test adjudicators publish (adjudicator.schema.json). */
const POOL_TERMS = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10000, noticePeriodSec: 691200 } as const;

const wholeSecond = (ms: number): Timestamp => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const lc = (a: string) => a.toLowerCase();

async function listen(server: Server, port: number, host: string): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return `http://${host}:${(server.address() as AddressInfo).port}`;
}

export async function startSimWorld(options: SimWorldOptions = {}): Promise<SimWorld> {
  const host = options.host ?? '127.0.0.1';
  const labels = options.accounts ?? DEFAULT_ACCOUNTS;
  const balance = options.balance ?? 10_000n * TUSD;
  const bond = options.bond ?? 25_000n * TUSD;
  const fee = { token: TOKEN, amount: (options.fee ?? TUSD).toString() } as AdjudicatorRegistration['fee']['min'];
  const onError = options.onError ?? ((e: Error) => console.error(`sim adjudicator: ${e.message}`));
  const publishSecrets = options.publishSecrets ?? true;
  let offsetMs = 0;
  const start = wholeSecond(Date.now());

  // Party keys: from the public label alone when they are published anyway; otherwise from the label and a
  // secret this process never serves, so knowing a party's label (or the run id) gives nobody its key.
  const keySecret = publishSecrets ? null : randomBytes(32).toString('hex');
  const partyAccount = (label: string) => (keySecret ? { ...testAccount(`${label}/${keySecret}`), label } : testAccount(label));

  // Genesis: the club, a mandate per account (both roles, a year), balances and bonds.
  const club = simClub(testAccount('sim-club-operator').address, SIM_RULEBOOK, SIM_CLUB_ID);
  const expires = wholeSecond(Date.parse(start) + 365 * 86_400_000);
  const named = labels.map(partyAccount);
  // Spares are labelled by the run's start time, so a restarted sim hands out accounts nobody has used.
  const spares = Array.from({ length: options.spareAccounts ?? 32 }, (_, i) => partyAccount(`sim/${start}/agent-${i + 1}`));
  const accounts = [...named, ...spares];
  let nextSpare = 0;
  const adjKeys = ADJUDICATORS.map((a) => ({ ...a, keys: testAccount(a.label) }));
  const mandates = [];
  for (const a of accounts) {
    const p = partyAccount(`${a.label}/principal`);
    mandates.push(await mandateFor({ name: p.label, key: p.privateKey, address: p.address }, a.address, club.id, wideScope(['buyer', 'seller'], expires), start));
  }
  const genesis: Genesis = {
    start,
    simSeed: canonicalKeccak({ sim: 'holdback/sim-world/v1', start }),
    chainId: SIM_CHAIN_ID,
    token: TOKEN,
    clubs: [club],
    mandates,
    members: [],
    balances: Object.fromEntries(accounts.map((a) => [a.address, balance.toString()])),
    bonds: Object.fromEntries(adjKeys.map((a) => [a.keys.address, { junior: bond.toString(), senior: '0' }])),
  };
  const chain = new SimChain(genesis);
  const tick = () => chain.advanceTo(wholeSecond(Date.now() + offsetMs));
  const ticker = setInterval(tick, 250);

  // Off the settlement layer: one ciphertext store the operators share, judgment records, registrations.
  const store = new MemoryCiphertextStore();
  const latest = new Map<Hex32, Judgment>();
  const registrations = new Map<string, Omit<AdjudicatorRegistration, 'pool'>>();
  const registration = (address: Address): AdjudicatorRegistration | null => {
    const r = registrations.get(lc(address));
    if (!r) return null;
    const p = chain.pool(address);
    const amount = (v: bigint) => ({ token: TOKEN, amount: v.toString() }) as AdjudicatorRegistration['fee']['min'];
    return { ...r, pool: { junior: amount(p.junior), senior: amount(p.senior), reserved: amount(p.reserved), terms: { ...POOL_TERMS } } } as AdjudicatorRegistration;
  };

  const operators: RunningOperator[] = [];
  for (const [i, port] of (options.operatorPorts ?? [0, 0]).entries()) {
    operators.push(
      await startOperator({
        settlement: chain,
        registry: { ...simRegistry(chain), registration, judgment: (id) => latest.get(id) ?? null },
        store,
        signerKey: testAccount(`sim-operator-${i + 1}`).privateKey,
        operatorId: `op-${i + 1}`,
        env: options.env ?? process.env,
        host,
        port,
      }),
    );
  }
  const storeRoots = operators.map((o) => `${o.url}/v1/ciphertext/`);

  const adjudicators = {} as Record<SimRole, TestAdjudicator>;
  for (const a of adjKeys) {
    const adj = testAdjudicator({
      name: a.name,
      label: a.label,
      signingKey: a.keys.privateKey,
      encryptionSecretKey: a.keys.encryptionSecretKey,
      chain,
      store: {
        // Only this world's operators' store; the hash in the URI is checked again by store.get.
        ciphertext: async (uri) => {
          const id = /(sha256:[0-9a-f]{64})$/.exec(uri)?.[1];
          if (!id || !storeRoots.some((r) => uri.startsWith(r))) throw new Error(`ciphertext ${uri} is not in this sim's store`);
          return store.get(id as `sha256:${string}`);
        },
        publishRecord: async (record) => {
          latest.set(record.commitmentId, record);
          return `${operators[0]!.url}/v1/commitments/${record.commitmentId}/judgment`;
        },
      },
      registration: async (address) => registration(address),
      domain: holdbackDomain(SIM_CHAIN_ID),
      fee,
      ...(options.judges?.[a.role] ? { judges: options.judges[a.role]! } : {}),
    });
    registrations.set(adj.address, { ...adj.registration(), poolTermsHash: canonicalKeccak(POOL_TERMS), status: 'active' });
    const parsed = parseAdjudicator(registration(adj.address));
    if (!parsed.ok) throw new Error(`${a.name}'s registration does not validate: ${parsed.error.detail}`);
    adjudicators[a.role] = adj;
  }

  // The adjudicators look for work in turn, one pass at a time.
  let running = true;
  const silent = new Set<SimRole>();
  const loop = (async () => {
    while (running) {
      tick();
      for (const [role, a] of Object.entries(adjudicators) as Array<[SimRole, TestAdjudicator]>) {
        if (silent.has(role)) continue;
        try {
          const r = await a.runOnce();
          for (const d of r.declined) onError(new Error(`${a.registration().name} declined ${d.commitmentId}: ${d.reason}`));
          for (const x of r.refused) onError(new Error(`${a.registration().name}: ${x.problem.type}: ${x.problem.detail}`));
        } catch (e) {
          onError(e as Error);
        }
      }
      await new Promise((r) => setTimeout(r, options.pollMs ?? 100));
    }
  })();

  const rb = club.rulebook;
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
  const domain = holdbackDomain(SIM_CHAIN_ID);
  const accountView = (a: (typeof accounts)[number]): SimAccount => ({
    label: a.label,
    address: a.address,
    balance: balance.toString(),
    privateKey: a.privateKey,
    encryptionPublicKey: a.encryptionPublicKey,
    encryptionSecretKey: b64(a.encryptionSecretKey),
  });
  const publicView = ({ label, address, balance: bal, encryptionPublicKey }: SimAccount): SimPublicAccount => ({ label, address, balance: bal, encryptionPublicKey });
  const info: SimInfo = {
    kind: 'holdback-sim',
    chainId: SIM_CHAIN_ID,
    domain: { name: 'Holdback', version: domain.version, chainId: SIM_CHAIN_ID, verifyingContract: domain.verifyingContract },
    clubId: club.id,
    operators: operators.map((o) => o.url),
    token: { symbol: 'tUSD', decimals: 6 },
    adjudicators: ADJUDICATORS.map((a) => ({ role: a.role, name: a.name, address: adjudicators[a.role].address, fakeJudges: true as const })),
    accounts: named.map(accountView),
    economics: {
      adjudicationFeeMin: fee.amount,
      adjudicatorBond: bond.toString(),
      appealBondRateBps: String(rb.appealBondRateBps),
      appealFee: rb.appealFee.amount,
      defaultOutcomeSellerCompensationRateBps: String(rb.defaultOutcome.judged.sellerCompensationRateBps),
      windowCoverageRatioBps: String(rb.windowCoverageRatioBps),
    },
    notes: [
      'SimChain only: tUSD is a test token with 6 decimals (25 tUSD is "25000000"); no real money moves.',
      publishSecrets
        ? 'Test keys only: every key here derives from a public label.'
        : 'Secret keys are not published: each party has its own keys from whoever set up its world, and POST /accounts gives a fresh account\'s keys to its caller only. Test keys only, still.',
      'Fake judges: no model runs; every verdict starts "[fake judge, no model ran]" and model IDs start "placeholder-".',
      'The adjudication fee is paid on a refund too: a refunded buyer gets the price back, not the fee.',
      'Settlement-layer time follows the wall clock; POST /advance {"seconds": n} moves it forward.',
      'POST /accounts hands out a fresh funded account nobody else has used.',
      `Work containing ${FAIL_MARKER} fails every fake judge (panel deals), so reject and appeal paths can be tried.`,
      'POST /adjudicators/<primary|fallback|appeal> {"silent": true} stops that adjudicator, to try fallback and default.',
    ],
  };
  const published: SimPublicInfo = publishSecrets ? info : { ...info, accounts: info.accounts.map(publicView) };

  const server = createServer((req, res) => void handle(req, res).catch((e: Error) => send(res, 500, { type: 'invalid_state', detail: e.message })));
  const url = await listen(server, options.port ?? 0, host);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://sim.invalid').pathname;
    if (req.method === 'GET' && path === '/') return send(res, 200, published);
    if (req.method === 'GET' && path === '/clock') return send(res, 200, { now: chain.now() });
    if (req.method === 'POST' && path === '/advance') {
      const seconds = (await json(req))['seconds'];
      if (!Number.isSafeInteger(seconds) || (seconds as number) < 0) return send(res, 400, { type: 'invalid_terms', detail: 'advance takes {"seconds": <whole seconds>}' });
      return send(res, 200, { now: world.advance(seconds as number) });
    }
    if (req.method === 'POST' && path === '/accounts') {
      const a = spares[nextSpare];
      if (!a) return send(res, 409, { type: 'invalid_state', detail: 'no fresh accounts left; restart the sim or pass a larger spareAccounts' });
      nextSpare++;
      return send(res, 200, accountView(a)); // to this caller only; no other route lists a spare's keys
    }
    const role = /^\/adjudicators\/(primary|fallback|appeal)$/.exec(path)?.[1] as SimRole | undefined;
    if (req.method === 'POST' && role) {
      const s = (await json(req))['silent'];
      if (typeof s !== 'boolean') return send(res, 400, { type: 'invalid_terms', detail: 'takes {"silent": true | false}' });
      world.silence(role, s);
      return send(res, 200, { role, silent: s });
    }
    send(res, 404, { type: 'not_found', detail: `no route ${req.method} ${path}` });
  }

  const world: SimWorld = {
    url,
    info,
    published,
    chain,
    operators,
    adjudicators,
    silence: (r, s) => void (s ? silent.add(r) : silent.delete(r)),
    advance: (seconds) => {
      offsetMs += seconds * 1000;
      tick();
      return chain.now();
    },
    close: async () => {
      running = false;
      clearInterval(ticker);
      await loop;
      await Promise.all(operators.map((o) => o.close()));
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
    },
  };
  return world;
}

async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > 4096) return {};
    chunks.push(c);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' }).end(JSON.stringify(body));
}
