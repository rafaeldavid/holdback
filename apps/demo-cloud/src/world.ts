// The public demo world: one SimChain, two operator nodes over it, three test adjudicators and a
// faucet, in one place so a Cloudflare Durable Object can hold it (worker.ts) and a Node test can run it.
//
// Public mode, as against `pnpm sim` (apps/operator/src/sim-world.ts), which is unchanged:
// - no clock or adjudicator controls: settlement time is the wall clock, and nothing here moves it;
// - no route serves a secret key. Every key the world holds (the club's test principal that signs faucet
//   mandates, the adjudicators, the two receipt signers) derives from a random per-world secret kept in
//   storage and never served. Agents make their own keys;
// - POST /v1/faucet funds and admits an address: a fixed amount of tUSD and a mandate in the demo club,
//   once per address per window, and a few addresses per client per window. The operators serve it (the one
//   faucet, D39); this world supplies the grant;
// - the discovery document (also at GET /) carries the demo's facts: club, token, adjudicators by role, faucet,
//   judges (D39); notices in the body say which judge panel would score an offer and why an offer was declined;
// - the adjudicators decline sealed (private or judgment) offers, which they cannot open yet;
// - the journal of what the chain accepted, the ciphertext and the judgment records are persisted, so the
//   world is rebuilt by replay after the Durable Object is evicted;
// - minimal telemetry (telemetry.ts, T-031): a 7-day request log without bodies, header values, IPs or paths, the
//   Durable Object's free-tier use with a warning, and hourly and daily summary lines in Workers Logs.
// No real money: SimChain (chain id 31337), the test token tUSD, and the operators' startup guards.
import { canonicalKeccak, holdbackDomain, parseAdjudicator, problem, wholeSecond, type AdjudicatorRegistration, type Address, type Hex32, type Judgment, type Mandate, type OperatorFeeSchedule, type Sha256, type Timestamp, type TokenAmount } from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import { StoreError, type CiphertextStore } from '@holdback/core/store';
import { testAdjudicator, type TestAdjudicator } from '@holdback/adjudicator';
import { fetchHandler, Operator, ReportLimiter, simRegistry, testAccount, type DemoFacts, type FaucetOutcome, type FeedbackOptions, type FeedbackStore, type NoticeSubject, type Registry, type TestAccount } from '@holdback/operator';
import { decodePublicKey } from '@holdback/core/crypto';
import { mandateFor, SIM_CHAIN_ID, SIM_RULEBOOK, simClub, SimChain, TOKEN, wideScope, type Genesis, type JournalEntry } from '@holdback/settlement/sim';
import { panelConfig, type JudgeProvider, type PanelConfig } from './judges.js';
import type { WorldStorage } from './storage.js';
import { dealFacts, Telemetry, type DayFacts, type TelemetryOptions } from './telemetry.js';

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
  /**
   * Live judge calls a day across the demo. Default LIVE_JUDGE_CALLS_PER_DAY from `env`, else 30.
   * Live judging needs HOLDBACK_ANTHROPIC_API_KEY, HOLDBACK_OPENAI_COMPATIBLE_API_KEY and
   * HOLDBACK_OPENAI_COMPATIBLE_BASE_URL in `env` (Worker secrets); without them the panel is scripted.
   */
  liveCallsPerDay?: number;
  /** Stands in for the live models (tests): the world runs as if the keys were set. */
  judgeProvider?: JudgeProvider;
  /** Where telemetry's summary lines and warnings go. Default: the console, which Workers Logs keeps. */
  telemetryLog?: TelemetryOptions['log'];
  /**
   * The private report store behind /v1/feedback (T-032; the Worker binds Workers KV). Absent: the nodes take no
   * reports. Sealed reports need FEEDBACK_ENCRYPTION_PUBLIC_KEY in `env`; its secret stays with the operator.
   */
  feedbackStore?: FeedbackStore;
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
  { role: 'primary', label: 'demo-adjudicator-a', name: 'Demo Adjudicator A' },
  { role: 'fallback', label: 'demo-adjudicator-b', name: 'Demo Adjudicator B' },
  { role: 'appeal', label: 'demo-adjudicator-c', name: 'Demo Adjudicator C' },
];
const nameOf = (a: { name: string }, live: boolean) => `${a.name} (test; real checks, ${live ? 'live panel within a daily budget' : 'scripted panel'})`;
const POOL_TERMS = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10000, noticePeriodSec: 691200 } as const;
/** Largest ciphertext this demo stores (a Durable Object value is at most 2 MiB). */
export const DEMO_MAX_CIPHERTEXT_BYTES = 1_048_576;
/** Work stays scheduled this long after the last write or adjudicator action. */
const ACTIVE_FOR_MS = 15 * 60_000;
const SCRIPTED_PANEL = 'scripted judge panel: no model runs in this demo, every panel verdict is a fake judge marked "[fake judge, no model ran]"; use template checks-only for real acceptance';
const livePanel = (perDay: number) =>
  `live judge panel: pinned models from two families (Anthropic, DeepSeek; config/judges-live.yaml), at most ${perDay} live judge calls a day across this demo; past that, panels are scripted fake judges whose verdicts are marked "[fake judge, no model ran]"`;
const SEALED =
  'These demo adjudicators decline private and judgment offers: they cannot open sealed terms yet (T-207), so the offer would stay unaccepted and expire, and nobody could fund it. Offer at disclosure public on this demo; the work itself is encrypted either way.';

const lc = (s: string) => s.toLowerCase();
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
  private persisted: number;
  private persisting: Promise<void> = Promise.resolve();
  private lastActive: number;
  private readonly handlers: Array<(r: Request, client?: string) => Promise<Response>>;

  private constructor(
    private readonly o: PublicWorldOptions,
    /** Counts the world's storage use and keeps the request log; worker.ts tells it about alarms. */
    readonly telemetry: Telemetry,
    private readonly secret: string,
    readonly chain: SimChain,
    private readonly keys: TestAccount[],
    readonly operators: readonly Operator[],
    readonly adjudicators: Record<Role, TestAdjudicator>,
    private readonly panel: PanelConfig,
    /** Offers an adjudicator declined, with its reason, for the state read's notices. In memory: every pass declines again. */
    private readonly declined: Map<Hex32, string>,
    persisted: number,
    /** Each node's public address (OPERATOR_URLS), when configured. */
    private readonly publicUrls: readonly string[] = [],
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
    const now = o.now ?? Date.now;
    const telemetry = await Telemetry.open({ storage: o.storage, now, ...(o.telemetryLog ? { log: o.telemetryLog } : {}) });
    // Every storage call below is counted against the free tier.
    const { storage } = telemetry;
    const replayed = telemetry.wake();
    // Fixed when the world is created: the journal replays only against the genesis it was written under, so
    // a later configuration change (MIN_WINDOW_SEC) applies to a fresh world, not to this one.
    let meta = await storage.get<{ secret: string; start: Timestamp; minWindowSec: number }>('meta');
    if (!meta) {
      meta = { secret: hex(crypto.getRandomValues(new Uint8Array(32))), start: wholeSecond(now()), minWindowSec: o.minWindowSec ?? 60 };
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
    replayed();
    // Live or scripted judges, fixed for this instance: the registry it binds depends on which.
    const panel = panelConfig({ env: o.env, storage, now, ...(o.judgeProvider ? { judgeProvider: o.judgeProvider } : {}), ...(o.liveCallsPerDay !== undefined ? { liveCallsPerDay: o.liveCallsPerDay } : {}) });
    const registrations = new Map<string, Omit<AdjudicatorRegistration, 'pool'>>();
    const registration = (address: Address): AdjudicatorRegistration | null => {
      const r = registrations.get(lc(address));
      if (!r) return null;
      const p = chain.pool(address);
      const amount = (v: bigint) => ({ token: TOKEN, amount: v.toString() }) as AdjudicatorRegistration['fee']['min'];
      return { ...r, pool: { junior: amount(p.junior), senior: amount(p.senior), reserved: amount(p.reserved), terms: { ...POOL_TERMS } } } as AdjudicatorRegistration;
    };
    const faucetAmount = o.faucetAmount ?? 1_000n * TUSD;
    const faucetWindowSec = o.faucetWindowSec ?? 3600;
    const faucetPerClient = o.faucetPerClient ?? 10;
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
      // POST /v1/faucet: a fixed grant and a mandate in the demo club; `amount` is not honoured here.
      faucet: grantFrom({ storage, chain, club, principal, amount: faucetAmount, windowSec: faucetWindowSec, perClient: faucetPerClient, now }),
    };
    // ADR-0023: one schedule for both nodes (one operator), paid to one world address; from Worker variables.
    const operatorFee = operatorFeeFromEnv(o.env, key('demo-operator-fees').address);
    const feedback = feedbackFrom(o, (id) => telemetry.lookup(id));
    const adjudicators = {} as Record<Role, TestAdjudicator>;
    const declined = new Map<Hex32, string>();
    const operators: Operator[] = [];
    const publicUrls = String(o.env?.OPERATOR_URLS ?? '').split(',').map((u) => u.trim().replace(/\/+$/, '')).filter((u) => /^https:\/\//.test(u));
    // D39: the one discovery document carries what GET / used to list.
    const demo = async (): Promise<DemoFacts> => {
      const today = await panel.budget.used();
      return {
        clubId: club.id,
        token: { id: TOKEN, decimals: 6 },
        adjudicators: ADJUDICATORS.map((a) => ({ role: a.role, address: adjudicators[a.role].address, name: nameOf(a, panel.live) })),
        faucet: { path: '/v1/faucet', grant: { token: TOKEN, amount: faucetAmount.toString() } as TokenAmount, perAddressEverySec: faucetWindowSec, perClientPerWindow: faucetPerClient },
        operators: publicUrls.length ? publicUrls : operators.map((op) => op.baseUrl).filter(Boolean),
        minWindowSec: m,
        // Who judges rubric deals: the registry every adjudicator here binds, and today's live budget (UTC).
        judges: {
          panel: panel.live ? 'live' : 'scripted',
          registry: { uri: panel.registryUri, hash: panel.registry.hash },
          models: panel.registry.active.map((e) => e.model),
          ...(panel.live
            ? { liveCallsPerDay: panel.budget.perDay, liveCallsToday: today.calls, tokensToday: { input: today.inputTokens, output: today.outputTokens }, day: today.day }
            : { missing: panel.missing }),
        },
      };
    };
    const panelText = () => (panel.live ? livePanel(panel.budget.perDay) : SCRIPTED_PANEL);
    const notices = (about: NoticeSubject): string[] => {
      if (about.kind === 'prepare' && about.prepareKind === 'offer') {
        const i = (about.input ?? {}) as { template?: unknown; hashOnly?: unknown; disclosure?: unknown };
        if (i.hashOnly === true || i.disclosure === 'private' || i.disclosure === 'judgment') return [SEALED];
        return i.template === 'checks-only' ? [] : [panelText()];
      }
      if (about.kind === 'write' && about.op.kind === 'offer') {
        const c = about.op.commitment as { privateTerms?: unknown; acceptance?: { rubric?: { criteria?: unknown[] } } };
        if (c.privateTerms !== undefined) return [SEALED];
        return (c.acceptance?.rubric?.criteria?.length ?? 0) > 0 ? [panelText()] : [];
      }
      if (about.kind === 'state') {
        const why = declined.get(about.commitmentId);
        return why ? [`The primary adjudicator declined this offer: ${why}. It stays Offered until offerExpiresAt, and nobody can fund it.`] : [];
      }
      return [];
    };
    for (const i of [0, 1]) {
      operators.push(
        new Operator({
          settlement: chain,
          registry,
          store,
          ...(operatorFee ? { fee: operatorFee } : {}),
          signerKey: key(`demo-operator-${i + 1}`).privateKey,
          operatorId: `demo-op-${i + 1}`,
          env: o.env,
          rateLimit: o.rateLimit ?? { writes: 120, reads: 1200, windowMs: 60_000 },
          notes: notesFor(club.id, m, faucetAmount, faucetWindowSec, panel, operatorFee),
          demo,
          notices,
          ...(feedback ? { feedback } : {}),
          // The fields the request log keeps, picked here: the path and traceparent never reach telemetry.
          log: (e) =>
            telemetry.request({ requestId: e.requestId, at: Math.floor(now() / 1000), node: i === 1 ? 1 : 0, method: e.method, route: e.route, status: e.status, ...(e.problem ? { problem: e.problem } : {}), ms: e.ms }),
        }),
      );
    }

    const fee = { token: TOKEN, amount: TUSD.toString() } as AdjudicatorRegistration['fee']['min'];
    for (const a of adjKeys) {
      const adj = testAdjudicator({
        name: nameOf(a, panel.live),
        registry: panel.registry,
        registryUri: panel.registryUri,
        provider: panel.provider,
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
      if (!parsed.ok) throw new Error(`${nameOf(a, panel.live)}'s registration does not validate: ${parsed.error.detail}`);
      adjudicators[a.role] = adj;
    }
    const keys = [principal, key('demo-club-operator'), ...adjKeys.map((a) => a.keys), key('demo-operator-1'), key('demo-operator-2')];
    return new PublicWorld(o, telemetry, secret, chain, keys, operators, adjudicators, panel, declined, journal.length, publicUrls);
  }

  /** A day's settlement-side facts for its telemetry line: the deal funnel and signer counts, the journal, live judging. */
  private readonly facts: DayFacts = async (day, window) => {
    const log = this.chain.log();
    const ids = [...new Set(log.flatMap((e) => (e.type === 'commitment.offered' && e.commitmentId ? [e.commitmentId] : [])))];
    const views = new Map(await Promise.all(ids.map(async (id) => [id, await this.chain.state(id)] as const)));
    const finality = (id: string) => {
      const v = views.get(id as Hex32);
      return v ? { settledAt: v.settledAt ?? null, finalAt: v.finalAt ?? null } : undefined;
    };
    return { ...dealFacts(log, finality, window), journalEntries: this.chain.journalLength(), liveJudges: await this.panel.budget.on(day) };
  };

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
        await this.telemetry.storage.put(Object.fromEntries(batch.map((e, j) => [jkey(this.persisted + i + j), e])));
      }
      this.persisted += fresh.length;
    });
    return this.persisting;
  }

  /** One adjudicator pass (the Durable Object alarm): accept or decline offers, trigger fallbacks, decide. */
  async work(): Promise<void> {
    this.telemetry.invoked();
    this.tick();
    const { panel } = this;
    for (const [role, a] of Object.entries(this.adjudicators) as [Role, TestAdjudicator][]) {
      try {
        // Live only when today's budget still holds a whole panel of this adjudicator's size, so a panel is
        // live or scripted as a whole (a pass deciding several cases can still cross the line).
        if (panel.live) {
          const policy = a.registration().policy;
          panel.allowLive = (await panel.budget.remaining()) >= (role === 'appeal' ? policy.appealPanelSize : policy.panelSize);
        }
        const r = await a.runOnce();
        for (const d of r.declined) this.declined.set(d.commitmentId, d.reason);
        if (r.accepted.length + r.decided.length + r.triggered.length > 0) this.lastActive = this.now();
      } catch (e) {
        this.o.onError?.(e as Error);
      } finally {
        panel.allowLive = false;
      }
    }
    await panel.budget.flush();
    await this.persist();
    await this.flushTelemetry(false);
  }

  /** Flushes telemetry (when due, unless `force`). A failure is reported, never answered in place of a response. */
  async flushTelemetry(force = true): Promise<void> {
    try {
      await (force ? this.telemetry.flush(this.facts) : this.telemetry.maybeFlush(this.facts));
    } catch (e) {
      this.o.onError?.(e as Error);
    }
  }

  async fetch(request: Request, via: Via): Promise<Response> {
    this.telemetry.invoked();
    this.tick();
    const op = this.operators[via.node]!;
    // The public address when configured (OPERATOR_URLS), so one odd request (another port, http) cannot change it.
    op.baseUrl = this.publicUrls[via.node] ?? via.origin.replace(/\/+$/, '');
    const response = await this.handlers[via.node]!(request, via.client);
    if (request.method === 'POST') this.lastActive = this.now();
    await this.persist();
    await this.flushTelemetry(false);
    return response;
  }
}

/**
 * The demo faucet's grant: a fixed amount of tUSD and a mandate in the demo club, signed by the club's own
 * test principal, once per address per window (persisted) and a few addresses per client per window (in memory).
 */
function grantFrom(w: {
  storage: WorldStorage;
  chain: SimChain;
  club: ReturnType<typeof simClub>;
  principal: TestAccount;
  amount: bigint;
  windowSec: number;
  perClient: number;
  now: () => number;
}): NonNullable<Registry['faucet']> {
  const perClient = new Map<string, { start: number; count: number }>();
  return async (address, { client }): Promise<FaucetOutcome> => {
    const now = w.now();
    const windowMs = w.windowSec * 1000;
    const retryAfterSec = (at: number) => Math.max(1, Math.ceil((at - now) / 1000));
    const last = await w.storage.get<number>(`fa:${address}`);
    if (last !== undefined && now - last < windowMs) return { ok: false, problem: problem('rate_limited', `${address} was funded in the last ${w.windowSec} seconds; one grant per address per window`), retryAfterSec: retryAfterSec(last + windowMs) };
    let c = perClient.get(client);
    if (!c || now - c.start >= windowMs) perClient.set(client, (c = { start: now, count: 0 }));
    if (c.count >= w.perClient) return { ok: false, problem: problem('rate_limited', 'too many faucet grants from this client; retry later'), retryAfterSec: retryAfterSec(c.start + windowMs) };
    c.count++;

    let mandate: Mandate | undefined = w.chain.agentMandates().find((x) => lc(x.agent) === address && x.clubId === w.club.id);
    if (!mandate) {
      const issuedAt = wholeSecond(now);
      const expires = wholeSecond(now + 30 * 86_400_000);
      mandate = await mandateFor({ name: `${w.principal.label}`, key: w.principal.privateKey, address: w.principal.address }, address, w.club.id, wideScope(['buyer', 'seller'], expires), issuedAt);
      const p = await w.chain.admit(mandate);
      if (p) return { ok: false, problem: p };
    }
    w.chain.faucet(address, w.amount);
    await w.storage.put({ [`fa:${address}`]: now });
    return {
      ok: true,
      grant: {
        clubId: w.club.id,
        granted: { token: TOKEN, amount: w.amount.toString() } as TokenAmount,
        balance: (await w.chain.balances([address]))[address]!,
        mandate: { ...mandate, mandateHash: canonicalKeccak(mandate) as Hex32 },
        nextGrantAfter: wholeSecond(now + windowMs),
        notice: "TEST TOKENS ONLY: tUSD on SimChain has no value. The mandate is signed by the demo club's own test principal, held by this demo.",
      },
    };
  };
}

/**
 * T-032: the nodes' report desk, when the Worker binds a store. Each report gets this world's log line for its
 * requestId. FEEDBACK_ENCRYPTION_PUBLIC_KEY (x25519, base64url) turns on sealed reports; a malformed one refuses to start.
 */
function feedbackFrom(o: PublicWorldOptions, requestLog: NonNullable<FeedbackOptions['requestLog']>): FeedbackOptions | undefined {
  if (!o.feedbackStore) return undefined;
  const key = o.env['FEEDBACK_ENCRYPTION_PUBLIC_KEY'];
  if (key) decodePublicKey(key);
  // One limiter for both nodes: they are one operator over one store.
  return { store: o.feedbackStore, requestLog, limiter: new ReportLimiter(), ...(key ? { encryptionPublicKey: key } : {}) };
}

const DECIMAL = /^(0|[1-9][0-9]{0,77})$/;

/**
 * ADR-0023: the demo's operator fee from Worker variables. OPERATOR_FEE_BPS (integer basis points, 0 to
 * 10000) and OPERATOR_FEE_MIN (base units) publish a schedule, OPERATOR_FEE_MAX (base units) caps it; with neither
 * of the first two, the nodes charge nothing and publish no schedule. A malformed value refuses to start.
 */
export function operatorFeeFromEnv(env: Readonly<Record<string, string | undefined>>, to: Address): OperatorFeeSchedule | undefined {
  const bps = env['OPERATOR_FEE_BPS'];
  const min = env['OPERATOR_FEE_MIN'];
  const max = env['OPERATOR_FEE_MAX'];
  if (bps === undefined && min === undefined) return undefined;
  if (bps === undefined || !/^(0|[1-9][0-9]{0,4})$/.test(bps) || Number(bps) > 10_000) throw new Error(`OPERATOR_FEE_BPS must be whole basis points from 0 to 10000, got ${JSON.stringify(bps)}`);
  if (min === undefined || !DECIMAL.test(min)) throw new Error(`OPERATOR_FEE_MIN must be base units as a decimal string (0.01 tUSD is "10000"), got ${JSON.stringify(min)}`);
  if (max !== undefined && max !== '' && !DECIMAL.test(max)) throw new Error(`OPERATOR_FEE_MAX must be base units as a decimal string, or unset, got ${JSON.stringify(max)}`);
  return { to, token: TOKEN, bps: Number(bps), min, max: max === undefined || max === '' ? null : max, appliesAt: 'agree-and-fund', refundable: false };
}

const tusdText = (base: string): string => {
  const v = BigInt(base);
  const frac = (v % TUSD).toString().padStart(6, '0').replace(/0+$/, '');
  return `${v / TUSD}${frac ? `.${frac}` : ''} tUSD`;
};

/** What each node states about itself in discovery and llms.txt. */
export function notesFor(
  clubId: string,
  minWindowSec: number,
  faucetAmount: bigint,
  faucetWindowSec: number,
  panel?: Pick<PanelConfig, 'live' | 'registry' | 'budget'>,
  fee?: OperatorFeeSchedule,
): string[] {
  const feeNote = fee
    ? fee.bps === 0 && fee.min === '0'
      ? `Operator fee: published at 0 (fees.operator in /v1/status): these nodes relay a funded agreement free for now. When it is switched on, POST /v1/prepare/agree-and-fund adds a third signature (slot operatorFee.signature), paid to ${fee.to}, outside the hold and not refunded.`
      : `Operator fee: these nodes charge an operator fee of ${fee.bps} bp of the price, at least ${tusdText(fee.min)}${fee.max === null ? '' : `, at most ${tusdText(fee.max)}`}, rounded up, paid by the buyer to ${fee.to} with the funded agreement: POST /v1/prepare/agree-and-fund returns a third signature (slot operatorFee.signature). It is a separate transfer, never part of the hold, and not refunded. A funded agree without it gets 402 payment_required; reads, prepare, the faucet, deliveries and direct submission to the settlement layer are free (ADR-0023).`
    : undefined;
  const whole = (faucetAmount / TUSD).toString();
  const judges = panel?.live
    ? `Adjudicators: three test adjudicators run by this demo, listed by role under demo.adjudicators in this discovery document. Deterministic checks are real. Rubric deals get a live judge panel: pinned models from two families, Anthropic and DeepSeek (${panel.registry.active.map((e) => e.model).join(', ')}; registry config/judges-live.yaml, not calibrated). At most ${panel.budget.perDay} live judge calls a day across this demo (UTC; demo.judges shows today's count); past that, panels are scripted fake judges whose verdicts start "[fake judge, no model ran]". DeepSeek's model names are provider aliases that can change underneath.`
    : 'Adjudicators: three test adjudicators run by this demo, listed by role under demo.adjudicators in this discovery document. Deterministic checks are real. Judge panels are scripted fake judges (no model runs; verdicts start "[fake judge, no model ran]"), so use template "checks-only" for real acceptance.';
  return [
    'Public demo node. TEST TOKENS ONLY: tUSD on SimChain (chain id 31337) has no value; no real money moves, and none can be deposited or withdrawn.',
    'Both demo operator nodes serve one shared simulated settlement layer (SimChain) held in one Cloudflare Durable Object. Each node signs receipts with its own key, but they are not independent operators: independent nodes need testnet contracts (Phase 2).',
    `Get test tokens: POST /v1/faucet {"address": "0x..."} with an Idempotency-Key header grants ${whole} tUSD and a mandate in club ${clubId}, once per address per ${faucetWindowSec} seconds. Make your own keys: no route here ever returns a secret key.`,
    `The faucet mandate is signed by the demo club's own test principal, which this demo holds; it lets your address act as buyer or seller in ${clubId}.`,
    judges,
    'Disclosure: offer at "public" on these nodes. The demo adjudicators cannot open sealed terms yet, so they decline private and judgment offers, which then expire unaccepted. The work itself is encrypted at every level.',
    `Settlement time is the wall clock. Club ${clubId} allows windows from ${minWindowSec} seconds: timing {"judgeWithinSec": ${minWindowSec}, "fallbackWithinSec": ${minWindowSec}, "appealWindowSec": ${minWindowSec}, "appealDecideSec": ${minWindowSec}} completes a deal in a few minutes.`,
    ...(feeNote ? [feeNote] : []),
    'Request log: these nodes keep one line per request for seven days (Request-Id, time, node, method, route template, status, problem type, timing), never a body, a header value, an IP address, or the addresses and IDs in the path. Quote the Request-Id of a failed request when you report it.',
    'State is journaled and replayed after a restart, but this is a demo: it may be reset at any time.',
  ];
}
