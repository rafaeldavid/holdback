// A local world to build against (`pnpm sim`, docs/quickstart.md): one SimChain, operator nodes over it that
// share a ciphertext store, three test adjudicators with fake judges, and funded test accounts. It runs in one
// process; agents reach it over HTTP only, through the operators' REST API. A small sim service beside them
// lists the test accounts (keys included: they derive from public labels and guard nothing) and moves the
// clock. No real money: SimChain, the test token tUSD, and the operators' startup guards run on the real
// environment.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { canonicalKeccak, holdbackDomain, parseAdjudicator, type AdjudicatorRegistration, type Address, type Hex32, type Judgment, type Timestamp } from '@holdback/core';
import { MemoryCiphertextStore } from '@holdback/core/store';
import { testAdjudicator, type TestAdjudicator } from '@holdback/adjudicator';
import type { FakeScript } from '@holdback/judgment';
import { mandateFor, SIM_CHAIN_ID, SIM_RULEBOOK, simClub, SimChain, TOKEN, wideScope, type Genesis } from '@holdback/settlement/sim';
import { testAccount } from './accounts.js';
import { simRegistry } from './registry.js';
import { startOperator, type RunningOperator } from './server.js';
import { TUSD } from './units.js';

export type SimRole = 'primary' | 'fallback' | 'appeal';

/** GET <sim>/ : where everything is. */
export interface SimInfo {
  kind: 'holdback-sim';
  chainId: number;
  clubId: string;
  /** Operator base URLs (each serves /v1 and /.well-known/holdback.json). */
  operators: string[];
  token: { symbol: 'tUSD'; decimals: 6 };
  adjudicators: Array<{ role: SimRole; name: string; address: Address; fakeJudges: true }>;
  /** Funded test accounts. TEST KEYS ONLY: each derives from its public label. */
  accounts: Array<{ label: string; address: Address; balance: string; privateKey: `0x${string}`; encryptionPublicKey: string; encryptionSecretKey: string }>;
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
  info: SimInfo;
  chain: SimChain;
  operators: readonly RunningOperator[];
  adjudicators: Record<SimRole, TestAdjudicator>;
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
  let offsetMs = 0;
  const start = wholeSecond(Date.now());

  // Genesis: the club, a mandate per account (both roles, a year), balances and bonds.
  const club = simClub(testAccount('sim-club-operator').address, SIM_RULEBOOK, SIM_CLUB_ID);
  const expires = wholeSecond(Date.parse(start) + 365 * 86_400_000);
  const accounts = labels.map((l) => testAccount(l));
  const adjKeys = ADJUDICATORS.map((a) => ({ ...a, keys: testAccount(a.label) }));
  const mandates = [];
  for (const a of accounts) {
    const p = testAccount(`${a.label}/principal`);
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
  const loop = (async () => {
    while (running) {
      tick();
      for (const a of Object.values(adjudicators)) {
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
  const info: SimInfo = {
    kind: 'holdback-sim',
    chainId: SIM_CHAIN_ID,
    clubId: club.id,
    operators: operators.map((o) => o.url),
    token: { symbol: 'tUSD', decimals: 6 },
    adjudicators: ADJUDICATORS.map((a) => ({ role: a.role, name: a.name, address: adjudicators[a.role].address, fakeJudges: true as const })),
    accounts: accounts.map((a) => ({
      label: a.label,
      address: a.address,
      balance: balance.toString(),
      privateKey: a.privateKey,
      encryptionPublicKey: a.encryptionPublicKey,
      encryptionSecretKey: b64(a.encryptionSecretKey),
    })),
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
      'Test keys only: every key here derives from a public label.',
      'Fake judges: no model runs; every verdict starts "[fake judge, no model ran]" and model IDs start "placeholder-".',
      'The adjudication fee is paid on a refund too: a refunded buyer gets the price back, not the fee.',
      'Settlement-layer time follows the wall clock; POST /advance {"seconds": n} moves it forward.',
    ],
  };

  const server = createServer((req, res) => void handle(req, res).catch((e: Error) => send(res, 500, { type: 'invalid_state', detail: e.message })));
  const url = await listen(server, options.port ?? 0, host);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://sim.invalid').pathname;
    if (req.method === 'GET' && path === '/') return send(res, 200, info);
    if (req.method === 'GET' && path === '/clock') return send(res, 200, { now: chain.now() });
    if (req.method === 'POST' && path === '/advance') {
      const chunks: Buffer[] = [];
      for await (const c of req as AsyncIterable<Buffer>) if (chunks.push(c) > 16) break;
      let seconds: unknown;
      try {
        seconds = (JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { seconds?: unknown }).seconds;
      } catch {
        seconds = undefined;
      }
      if (!Number.isSafeInteger(seconds) || (seconds as number) < 0) return send(res, 400, { type: 'invalid_terms', detail: 'advance takes {"seconds": <whole seconds>}' });
      return send(res, 200, { now: world.advance(seconds as number) });
    }
    send(res, 404, { type: 'not_found', detail: `no route ${req.method} ${path}` });
  }

  const world: SimWorld = {
    url,
    info,
    chain,
    operators,
    adjudicators,
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

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' }).end(JSON.stringify(body));
}
