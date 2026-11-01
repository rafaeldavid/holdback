// The public demo world (T-026): one SimChain, two operator nodes over it, three test adjudicators and a
// faucet, in one place so a Cloudflare Durable Object can hold it (worker.ts) and a Node test can run it.
//
// Public mode, as against `pnpm sim` (apps/operator/src/sim-world.ts), which is unchanged:
// - no clock or adjudicator controls: settlement time is the wall clock, and nothing here moves it;
// - no route serves a secret key. Every key the world holds (the club's test principal that signs faucet
//   mandates, the adjudicators, the two receipt signers) derives from a random per-world secret kept in
//   storage and never served. Agents make their own keys;
// - POST /v1/faucet funds and admits an address: a fixed amount of tUSD and a mandate in the demo club,
//   once per address per window, and a few addresses per client per window;
// - the journal of what the chain accepted, the ciphertext and the judgment records are persisted, so the
//   world is rebuilt by replay after the Durable Object is evicted.
// No real money: SimChain (chain id 31337), the test token tUSD, and the operators' startup guards.
import { canonicalKeccak, holdbackDomain, parseAdjudicator, type AdjudicatorRegistration, type Address, type Hex32, type Judgment, type Mandate, type Sha256, type Timestamp } from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import { StoreError, type CiphertextStore } from '@holdback/core/store';
import { testAdjudicator, type TestAdjudicator } from '@holdback/adjudicator';
import { fetchHandler, fingerprint, IdempotencyStore, Operator, simRegistry, testAccount, type Registry, type StoredResponse, type TestAccount } from '@holdback/operator';
import { mandateFor, SIM_CHAIN_ID, SIM_RULEBOOK, simClub, SimChain, TOKEN, wideScope, type Genesis, type JournalEntry } from '@holdback/settlement/sim';
import type { WorldStorage } from './storage.js';

export type Role = 'primary' | 'fallback' | 'appeal';

export interface PublicWorldOptions {
  storage: WorldStorage;
  /** Checked by the operators' startup guards (no real money). */
  env: Readonly<Record<string, string | undefined>>;
  /** The demo club's minimum for each judge, fallback and appeal window, in seconds. Default 60. */
  minWindowSec?: number;
  /** What the faucet grants, in base units. Default 1,000 tUSD. */
  faucetAmount?: bigint;
  /** One grant per address per window. Default one hour. */
  faucetWindowSec?: number;
  /** Grants per client (IP address) per window. Default 10. */
  faucetPerClient?: number;
  /** Per-client operator throttle. Default 120 writes and 1,200 reads a minute. */
  rateLimit?: { writes: number; reads: number; windowMs: number };
  now?: () => number;
  onError?: (e: Error) => void;
}

/** Which node a request reached, as the Worker in front knows it. */
export interface Via {
  node: 0 | 1;
  /** The node's public origin, e.g. https://holdback-op1.example.workers.dev. */
  origin: string;
  /** The caller's address (cf-connecting-ip), for throttles. */
  client: string;
}

export const DEMO_CLUB_ID = 'demo-club';
const TUSD = 1_000_000n;
const ADJUDICATORS: ReadonlyArray<{ role: Role; label: string; name: string }> = [
  { role: 'primary', label: 'demo-adjudicator-a', name: 'Demo Adjudicator A (test; real checks, scripted panel)' },
  { role: 'fallback', label: 'demo-adjudicator-b', name: 'Demo Adjudicator B (test; real checks, scripted panel)' },
  { role: 'appeal', label: 'demo-adjudicator-c', name: 'Demo Adjudicator C (test; real checks, scripted panel)' },
];
const POOL_TERMS = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10000, noticePeriodSec: 691200 } as const;
/** Largest ciphertext this demo stores (a Durable Object value is at most 2 MiB). */
export const DEMO_MAX_CIPHERTEXT_BYTES = 1_048_576;
/** Work stays scheduled this long after the last write or adjudicator action. */
const ACTIVE_FOR_MS = 15 * 60_000;
const SCRIPTED_PANEL = 'scripted judge panel: no model runs in this demo, every panel verdict is a fake judge marked "[fake judge, no model ran]"; use template checks-only for real acceptance';

const wholeSecond = (ms: number): Timestamp => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const lc = (s: string) => s.toLowerCase();
const isAddress = (s: unknown): s is Address => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const jkey = (i: number) => `j:${String(i).padStart(12, '0')}`;

/** A content-addressed ciphertext store in world storage (ADR-0016 §8 contract: get checks the hash). */
class StorageCiphertextStore implements CiphertextStore {
  constructor(private readonly storage: WorldStorage) {}
  async put(bytes: Uint8Array): Promise<Sha256> {
    if (bytes.length === 0) throw new StoreError('empty');
    if (bytes.length > DEMO_MAX_CIPHERTEXT_BYTES) throw new StoreError('too_large');
    const id = sha256(bytes);
    await this.storage.put({ [`ct:${id}`]: Uint8Array.from(bytes) });
    return id;
  }
  async get(id: Sha256): Promise<Uint8Array> {
    if (!/^sha256:[0-9a-f]{64}$/.test(id)) throw new StoreError('invalid_id');
    const bytes = await this.storage.get<Uint8Array>(`ct:${id}`);
    if (!bytes) throw new StoreError('not_found');
    if (sha256(bytes) !== id) throw new StoreError('hash_mismatch');
    return Uint8Array.from(bytes);
  }
}

export class PublicWorld {
  private readonly idempotency = new IdempotencyStore();
  private readonly perClient = new Map<string, { start: number; count: number }>();
  private persisted: number;
  private persisting: Promise<void> = Promise.resolve();
  private lastActive: number;
  private readonly handlers: Array<(r: Request, client?: string) => Promise<Response>>;

  private constructor(
    private readonly o: PublicWorldOptions,
    private readonly secret: string,
    readonly chain: SimChain,
    private readonly club: ReturnType<typeof simClub>,
    private readonly principal: TestAccount,
    private readonly keys: TestAccount[],
    readonly operators: readonly Operator[],
    readonly adjudicators: Record<Role, TestAdjudicator>,
    persisted: number,
  ) {
    this.persisted = persisted;
    this.lastActive = this.now();
    this.handlers = operators.map((op) => fetchHandler(op));
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** Opens the world in `storage`: creates it on first use, otherwise replays its journal. */
  static async open(o: PublicWorldOptions): Promise<PublicWorld> {
    const { storage } = o;
    // Fixed when the world is created: the journal replays only against the genesis it was written under, so
    // a later configuration change (MIN_WINDOW_SEC) applies to a fresh world, not to this one.
    let meta = await storage.get<{ secret: string; start: Timestamp; minWindowSec: number }>('meta');
    if (!meta) {
      meta = { secret: hex(crypto.getRandomValues(new Uint8Array(32))), start: wholeSecond((o.now ?? Date.now)()), minWindowSec: o.minWindowSec ?? 60 };
      await storage.put({ meta });
    }
    const secret = meta.secret;
    const key = (label: string): TestAccount => ({ ...testAccount(`${label}/${secret}`), label });
    const m = meta.minWindowSec;
    o = { ...o, minWindowSec: m };
    const rulebook = { ...SIM_RULEBOOK, minWindowsSec: { judge: m, fallback: m, appealWindow: m, appealDecide: m } };
    const club = simClub(key('demo-club-operator').address, rulebook, DEMO_CLUB_ID);
    const principal = key('demo-club-principal');
    const adjKeys = ADJUDICATORS.map((a) => ({ ...a, keys: key(a.label) }));
    const bond = (25_000n * TUSD).toString();
    const genesis: Genesis = {
      start: meta.start,
      simSeed: canonicalKeccak({ sim: 'holdback/demo-cloud/v1', start: meta.start }),
      chainId: SIM_CHAIN_ID,
      token: TOKEN,
      clubs: [club],
      mandates: [],
      members: [],
      balances: {},
      bonds: Object.fromEntries(adjKeys.map((a) => [a.keys.address, { junior: bond, senior: '0' }])),
    };
    const journal = [...(await storage.list<JournalEntry>({ prefix: 'j:' })).values()];
    const chain = await SimChain.replay(genesis, journal);

    const store = new StorageCiphertextStore(storage);
    const records = new Map<Hex32, Judgment>(Array.from(await storage.list<Judgment>({ prefix: 'jr:' }), ([k, v]) => [k.slice(3) as Hex32, v]));
    const registrations = new Map<string, Omit<AdjudicatorRegistration, 'pool'>>();
    const registration = (address: Address): AdjudicatorRegistration | null => {
      const r = registrations.get(lc(address));
      if (!r) return null;
      const p = chain.pool(address);
      const amount = (v: bigint) => ({ token: TOKEN, amount: v.toString() }) as AdjudicatorRegistration['fee']['min'];
      return { ...r, pool: { junior: amount(p.junior), senior: amount(p.senior), reserved: amount(p.reserved), terms: { ...POOL_TERMS } } } as AdjudicatorRegistration;
    };
    const base = simRegistry(chain);
    const registry: Registry = {
      chainId: base.chainId,
      clubs: base.clubs,
      get mandates() {
        return chain.agentMandates();
      },
      members: base.members,
      adjudicators: base.adjudicators,
      now: () => chain.now(),
      registration,
      judgment: (id) => records.get(id) ?? null,
      // No `faucet`: POST /v1/test/faucet (any amount) is not served here; POST /v1/faucet is.
    };
    const operators = [0, 1].map(
      (i) =>
        new Operator({
          settlement: chain,
          registry,
          store,
          signerKey: key(`demo-operator-${i + 1}`).privateKey,
          operatorId: `demo-op-${i + 1}`,
          env: o.env,
          rateLimit: o.rateLimit ?? { writes: 120, reads: 1200, windowMs: 60_000 },
          notes: notesFor(club.id, m, o.faucetAmount ?? 1_000n * TUSD, o.faucetWindowSec ?? 3600),
        }),
    );

    const fee = { token: TOKEN, amount: TUSD.toString() } as AdjudicatorRegistration['fee']['min'];
    const adjudicators = {} as Record<Role, TestAdjudicator>;
    for (const a of adjKeys) {
      const adj = testAdjudicator({
        name: a.name,
        label: a.label,
        signingKey: a.keys.privateKey,
        encryptionSecretKey: a.keys.encryptionSecretKey,
        chain,
        store: {
          // Only this world's store: the id is read from the URI and checked again by store.get.
          ciphertext: async (uri) => {
            const id = /(sha256:[0-9a-f]{64})$/.exec(uri)?.[1];
            if (!id) throw new Error(`ciphertext ${uri} is not in this demo's store`);
            return store.get(id as Sha256);
          },
          publishRecord: async (record) => {
            records.set(record.commitmentId, record);
            await storage.put({ [`jr:${record.commitmentId}`]: record });
            return `${operators[0]!.baseUrl}/v1/commitments/${record.commitmentId}/judgment`;
          },
        },
        registration: async (address) => registration(address),
        domain: holdbackDomain(SIM_CHAIN_ID),
        fee,
      });
      registrations.set(adj.address, { ...adj.registration(), poolTermsHash: canonicalKeccak(POOL_TERMS), status: 'active' });
      const parsed = parseAdjudicator(registration(adj.address));
      if (!parsed.ok) throw new Error(`${a.name}'s registration does not validate: ${parsed.error.detail}`);
      adjudicators[a.role] = adj;
    }
    const keys = [principal, key('demo-club-operator'), ...adjKeys.map((a) => a.keys), key('demo-operator-1'), key('demo-operator-2')];
    return new PublicWorld(o, secret, chain, club, principal, keys, operators, adjudicators, journal.length);
  }

  /** Every secret this world holds, for the test that no route serves one. In-process only. */
  secretsForTest(): string[] {
    return [this.secret, ...this.keys.flatMap((k) => [k.privateKey, hex(k.encryptionSecretKey)])];
  }

  digest(): Hex32 {
    return this.chain.digest();
  }

  /** True while there may be adjudicator work: within 15 minutes of the last write or decision. */
  active(): boolean {
    return this.now() - this.lastActive < ACTIVE_FOR_MS;
  }

  private tick(): void {
    this.chain.advanceTo(wholeSecond(this.now()));
  }

  /** Writes the journal entries not yet in storage. Serialized, so entries land once and in order. */
  private persist(): Promise<void> {
    this.persisting = this.persisting.then(async () => {
      const fresh = this.chain.journal(this.persisted);
      for (let i = 0; i < fresh.length; i += 100) {
        const batch = fresh.slice(i, i + 100);
        await this.o.storage.put(Object.fromEntries(batch.map((e, j) => [jkey(this.persisted + i + j), e])));
      }
      this.persisted += fresh.length;
    });
    return this.persisting;
  }

  /** One adjudicator pass (the Durable Object alarm): accept offers, trigger fallbacks, decide. */
  async work(): Promise<void> {
    this.tick();
    for (const a of Object.values(this.adjudicators)) {
      try {
        const r = await a.runOnce();
        if (r.accepted.length + r.decided.length + r.triggered.length > 0) this.lastActive = this.now();
      } catch (e) {
        this.o.onError?.(e as Error);
      }
    }
    await this.persist();
  }

  async fetch(request: Request, via: Via): Promise<Response> {
    this.tick();
    const op = this.operators[via.node]!;
    op.baseUrl = via.origin.replace(/\/+$/, '');
    const url = new URL(request.url);
    let response: Response;
    if (request.method === 'GET' && url.pathname === '/') response = json(200, this.index(via));
    else if (url.pathname === '/v1/faucet' && request.method === 'POST') response = await this.faucet(request, via);
    else {
      const notice = request.method === 'POST' ? await this.scriptedPanel(request.clone(), url.pathname) : false;
      response = await this.handlers[via.node]!(request, via.client);
      if (notice) {
        response = new Response(response.body, response);
        response.headers.set('holdback-notice', SCRIPTED_PANEL);
      }
    }
    if (request.method === 'POST') this.lastActive = this.now();
    await this.persist();
    return response;
  }

  /** A prepared or submitted offer that a judge panel would score: its response says the panel is scripted. */
  private async scriptedPanel(request: Request, path: string): Promise<boolean> {
    if (path !== '/v1/prepare/offer' && path !== '/v1/commitments') return false;
    try {
      const b = (await request.json()) as { template?: unknown; acceptance?: { rubric?: { criteria?: unknown[] } } };
      return path === '/v1/prepare/offer' ? b.template !== 'checks-only' : (b.acceptance?.rubric?.criteria?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /** GET /: where things are, for an agent that has only a URL. */
  private index(via: Via): Record<string, unknown> {
    const domain = holdbackDomain(SIM_CHAIN_ID);
    return {
      kind: 'holdback-public-demo',
      notice: 'Public demo. TEST TOKENS ONLY (tUSD on SimChain, chain id 31337); no real money.',
      operators: this.operators.map((o) => o.baseUrl).filter(Boolean),
      thisNode: via.origin,
      discovery: '/.well-known/holdback.json',
      openapi: '/v1/openapi.json',
      llms: '/llms.txt',
      faucet: { method: 'POST', path: '/v1/faucet', body: { address: '<your address>' }, headers: { 'Idempotency-Key': '<any unique string>' } },
      chainId: SIM_CHAIN_ID,
      domain: { name: 'Holdback', version: domain.version, chainId: SIM_CHAIN_ID, verifyingContract: domain.verifyingContract },
      clubId: this.club.id,
      /** The club's shortest judge, fallback and appeal window, in seconds. */
      minWindowSec: this.o.minWindowSec ?? 60,
      token: { symbol: 'tUSD', decimals: 6 },
      adjudicators: ADJUDICATORS.map((a) => ({ role: a.role, name: a.name, address: this.adjudicators[a.role].address, scriptedPanel: true })),
      notes: notesFor(this.club.id, this.o.minWindowSec ?? 60, this.o.faucetAmount ?? 1_000n * TUSD, this.o.faucetWindowSec ?? 3600),
    };
  }

  // ---- the faucet -------------------------------------------------------------------------------

  private async faucet(request: Request, via: Via): Promise<Response> {
    const instance = `urn:holdback:request:${crypto.randomUUID()}`;
    const fail = (status: number, type: string, detail: string, headers: Record<string, string> = {}): StoredResponse => ({
      status,
      headers: { 'content-type': 'application/problem+json', ...headers },
      body: JSON.stringify({ type, title: type, status, detail, instance }),
    });
    const send = (r: StoredResponse) => new Response(r.body, { status: r.status, headers: r.headers });
    const key = request.headers.get('idempotency-key');
    if (!key || key.length > 255) return send(fail(400, 'invalid_terms', 'mutating requests need an Idempotency-Key header (1 to 255 characters)'));
    let body: unknown;
    try {
      body = JSON.parse((await request.text()) || '{}');
    } catch {
      return send(fail(400, 'invalid_terms', 'the body is not JSON'));
    }
    const address = (body as { address?: unknown } | null)?.address;
    if (!isAddress(address)) return send(fail(400, 'invalid_terms', 'the faucet takes {"address": "0x<40 hex>"}: your own address; make your own keys'));
    const outcome = await this.idempotency.run(key, fingerprint('POST', '/v1/faucet', body), () => this.grant(lc(address) as Address, via, fail));
    if (outcome.kind === 'conflict') return send(fail(409, 'idempotency_conflict', `Idempotency-Key ${key} was used with another request`));
    return send(outcome.response);
  }

  private async grant(address: Address, via: Via, fail: (status: number, type: string, detail: string, headers?: Record<string, string>) => StoredResponse): Promise<StoredResponse> {
    const now = this.now();
    const windowMs = (this.o.faucetWindowSec ?? 3600) * 1000;
    const retry = (at: number) => ({ 'retry-after': String(Math.max(1, Math.ceil((at - now) / 1000))) });
    const last = await this.o.storage.get<number>(`fa:${address}`);
    if (last !== undefined && now - last < windowMs) return fail(429, 'rate_limited', `${address} was funded in the last ${windowMs / 1000} seconds; one grant per address per window`, retry(last + windowMs));
    let w = this.perClient.get(via.client);
    if (!w || now - w.start >= windowMs) this.perClient.set(via.client, (w = { start: now, count: 0 }));
    if (w.count >= (this.o.faucetPerClient ?? 10)) return fail(429, 'rate_limited', 'too many faucet grants from this client; retry later', retry(w.start + windowMs));
    w.count++;

    let mandate: Mandate | undefined = this.chain.agentMandates().find((m) => lc(m.agent) === address && m.clubId === this.club.id);
    if (!mandate) {
      const issuedAt = wholeSecond(now);
      const expires = wholeSecond(now + 30 * 86_400_000);
      mandate = await mandateFor({ name: `${this.principal.label}`, key: this.principal.privateKey, address: this.principal.address }, address, this.club.id, wideScope(['buyer', 'seller'], expires), issuedAt);
      const p = await this.chain.admit(mandate);
      if (p) return fail(422, p.type, p.detail);
    }
    const amount = this.o.faucetAmount ?? 1_000n * TUSD;
    this.chain.faucet(address, amount);
    await this.o.storage.put({ [`fa:${address}`]: now });
    const balance = (await this.chain.balances([address]))[address]!;
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        address,
        clubId: this.club.id,
        granted: { token: TOKEN, amount: amount.toString() },
        balance,
        mandate: { ...mandate, mandateHash: canonicalKeccak(mandate) },
        nextGrantAfter: wholeSecond(now + windowMs),
        notice: 'TEST TOKENS ONLY: tUSD on SimChain has no value. The mandate is signed by the demo club\'s own test principal, held by this demo.',
      }),
    };
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** What each node states about itself in discovery and llms.txt. */
export function notesFor(clubId: string, minWindowSec: number, faucetAmount: bigint, faucetWindowSec: number): string[] {
  const whole = (faucetAmount / TUSD).toString();
  return [
    'Public demo node. TEST TOKENS ONLY: tUSD on SimChain (chain id 31337) has no value; no real money moves, and none can be deposited or withdrawn.',
    'Both demo operator nodes serve one shared simulated settlement layer (SimChain) held in one Cloudflare Durable Object. Each node signs receipts with its own key, but they are not independent operators: independent nodes need testnet contracts (Phase 2).',
    `Get test tokens: POST /v1/faucet {"address": "0x..."} with an Idempotency-Key header grants ${whole} tUSD and a mandate in club ${clubId}, once per address per ${faucetWindowSec} seconds. Make your own keys: no route here ever returns a secret key.`,
    `The faucet mandate is signed by the demo club's own test principal, which this demo holds; it lets your address act as buyer or seller in ${clubId}.`,
    'Adjudicators: three test adjudicators run by this demo (GET / or GET /v1/adjudicators). Deterministic checks are real. Judge panels are scripted fake judges (no model runs; verdicts start "[fake judge, no model ran]"), so use template "checks-only" for real acceptance.',
    `Settlement time is the wall clock. Club ${clubId} allows windows from ${minWindowSec} seconds: timing {"judgeWithinSec": ${minWindowSec}, "fallbackWithinSec": ${minWindowSec}, "appealWindowSec": ${minWindowSec}, "appealDecideSec": ${minWindowSec}} completes a deal in a few minutes.`,
    'State is journaled and replayed after a restart, but this is a demo: it may be reset at any time.',
  ];
}
