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
//   Durable Object's free-tier use with a warning, and hourly and daily summary lines in Workers Logs;
// - adjudicator passes run only while a case awaits these adjudicators (T-057): `nextPass` tells the Durable Object
//   when to set its alarm, so an idle world, or one woken by a plain read, costs no alarm.
// No real money: SimChain (chain id 31337), the test token tUSD, and the operators' startup guards.
//
// On Sepolia (D41, ADR-0028; option `live`), the same world settles on the HoldbackRules contracts through
// EvmSettlement instead of SimChain. The chain holds the money and is the authority for every state from funding
// on; the world keeps what the chain does not (the signed offer, acceptance and agreement before funding, the
// adjudicators' envelopes) and the event log. It persists each commitment's book and the log in pages, so a restart
// reads one row per commitment and one per 64 events, and replays nothing. The relayer key pays gas for what the
// operators relay; the faucet mints test tUSDC on chain (D42); the three adjudicators keep their own bonds in HoldbackBonds.
import { canonicalKeccak, holdbackDomain, parseAdjudicator, problem, wholeSecond, type AdjudicatorRegistration, type Address, type EscrowState, type HoldbackDomain, type Hex32, type Judgment, type Mandate, type OperatorFeeSchedule, type Problem, type SettlementEvent, type Sha256, type Timestamp, type TokenAmount } from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import { StoreError, type CiphertextStore } from '@holdback/core/store';
import { testAdjudicator, type TestAdjudicator } from '@holdback/adjudicator';
import { fetchHandler, Operator, ReportLimiter, testAccount, type DemoFacts, type FaucetOutcome, type FeedbackOptions, type FeedbackStore, type NoticeSubject, type Registry, type TestAccount } from '@holdback/operator';
import { decodePublicKey } from '@holdback/core/crypto';
import { ensureBond, EvmSettlement, rebindToken, RelayRefused, type Book, type LiveChain } from '@holdback/settlement/live';
import { privateKeyToAccount } from 'viem/accounts';
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
  /** Settle on a live testnet (D41) instead of SimChain. A world keeps the settlement it was created with. */
  live?: LiveSettlement;
  now?: () => number;
  onError?: (e: Error) => void;
}

/** The live chain a world settles on, and the demo adjudicators' standing on it. */
export interface LiveSettlement {
  chain: LiveChain;
  /** The bond each demo adjudicator keeps in HoldbackBonds, in base units. Default 25,000 tUSDC. */
  bond?: bigint;
  /** Test ETH each demo adjudicator keeps for its own approve and deposit. Default 0.005 ETH. */
  adjudicatorGas?: bigint;
  /** The block explorer for transaction links in the notes. Default Sepolia Etherscan. */
  explorer?: string;
}

/** Fixed when the world is created: a different configuration names a fresh world (WORLD_NAME). */
interface Meta {
  secret: string;
  start: Timestamp;
  minWindowSec: number;
  /** Absent in worlds created before D41: SimChain. */
  settlement?: 'sim' | 'sepolia';
  /** The rules contract a live world settles on, lowercase. */
  rules?: string;
  /** Live worlds: the adjudicators whose bonds are in place. */
  bonded?: string[];
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
/**
 * Adjudicator passes stop this long after settlement last moved (a write or an adjudicator's action) or the world woke
 * with work due, so a case no pass can finish (a refused delivery, an undecided panel) is not polled until its deadline.
 */
const ACTIVE_FOR_MS = 15 * 60_000;
/**
 * A pass runs this soon after settlement moves (CHAIN_PASS_MS on a chain, which also paces its setup); each pass in a
 * row that changes nothing doubles the wait, up to SLOWEST_PASS_MS.
 */
const PASS_MS = 1000;
const CHAIN_PASS_MS = 2000;
const SLOWEST_PASS_MS = 60_000;
const SCRIPTED_PANEL = 'scripted judge panel: no model runs in this demo, every panel verdict is a fake judge marked "[fake judge, no model ran]"; use template checks-only for real acceptance';
const livePanel = (perDay: number) =>
  `live judge panel: pinned models from two families (Anthropic, DeepSeek; config/judges-live.yaml), at most ${perDay} live judge calls a day across this demo; past that, panels are scripted fake judges whose verdicts are marked "[fake judge, no model ran]"`;
const SEALED =
  'These demo adjudicators decline private and judgment offers: they cannot open sealed terms yet (T-207), so the offer would stay unaccepted and expire, and nobody could fund it. Offer at disclosure public on this demo; the work itself is encrypted either way.';

const lc = (s: string) => s.toLowerCase();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const jkey = (i: number) => `j:${String(i).padStart(12, '0')}`;
const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io';
/** Each demo adjudicator's bond on a chain, as on SimChain: 25,000 tUSDC covers a thousand 25 tUSDC deals at once. */
const DEFAULT_LIVE_BOND = 25_000n * TUSD;
/** Test ETH for an adjudicator's own approve and deposit: 0.005 ETH, about 30 times what the two cost at a 1 gwei tip. */
const DEFAULT_ADJUDICATOR_GAS = 5_000_000_000_000_000n;
/** A deal lane below 0.01 test ETH gets 0.03 from the funding lane: about 50 test deals at a 1 gwei tip (research §12). */
const LANE_FLOOR = 10_000_000_000_000_000n;
const LANE_TOP_UP = 30_000_000_000_000_000n;
/** Faucet mints a day on a chain: about 0.04 test ETH at a 1 gwei tip (research §5). */
const FAUCET_MINTS_PER_DAY = 600;
const BONDING = "The demo adjudicators' bonds are being put in place on Sepolia (a few blocks after this world started); the primary accepts offers once its bond is there.";

/**
 * An append-only log kept in storage pages of PAGE entries, one row each (prefix + page number): a restart reads
 * one row per PAGE entries, and an append rewrites only the last page (the Nov 2 outage was a replay of one row per
 * journal entry against the read quota).
 */
class PagedLog<T> {
  static readonly PAGE = 64;
  private constructor(
    private readonly storage: WorldStorage,
    private readonly prefix: string,
    private readonly entries: T[],
  ) {}

  static async load<T>(storage: WorldStorage, prefix: string): Promise<PagedLog<T>> {
    const pages = await storage.list<T[]>({ prefix });
    return new PagedLog(storage, prefix, [...pages.values()].flat());
  }

  all(): readonly T[] {
    return this.entries;
  }

  async append(items: readonly T[]): Promise<void> {
    if (items.length === 0) return;
    const first = Math.floor(this.entries.length / PagedLog.PAGE);
    this.entries.push(...items);
    const last = Math.floor((this.entries.length - 1) / PagedLog.PAGE);
    const out: Record<string, unknown> = {};
    for (let p = first; p <= last; p++) out[`${this.prefix}${String(p).padStart(8, '0')}`] = this.entries.slice(p * PagedLog.PAGE, (p + 1) * PagedLog.PAGE);
    for (let i = 0, keys = Object.keys(out); i < keys.length; i += 100) await this.storage.put(Object.fromEntries(keys.slice(i, i + 100).map((k) => [k, out[k]])));
  }
}

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

/**
 * When this world's adjudicators act on a commitment: `now` for a step they can take now, judgeBy for a fallback
 * takeover, nothing while it is a party's turn; null once no adjudicator can act on it again, so `look` drops it. The
 * primary accepts an offer before offerExpiresAt and decides a delivery before judgeBy; the fallback takes over at
 * judgeBy and decides before fallbackBy; the appeal adjudicator decides an escalation or an open appeal before
 * appealDecideBy. Every other timeout (offer expiry, reclaim, default, appeal expiry) is a party's trigger.
 */
function workAt(s: EscrowState, ours: (address: string) => boolean, now: number): number[] | null {
  const { adjudicator, fallbackAdjudicator, appealAdjudicator } = s.terms.adjudication;
  const { offerExpiresAt, deliverBy, judgeBy, fallbackBy } = s.terms.timing;
  const passed = (deadline: Timestamp) => now >= Date.parse(deadline);
  switch (s.kind) {
    case 'Offered':
      return passed(offerExpiresAt) ? null : ours(adjudicator) ? [now] : [];
    case 'AcceptedByAdjudicator':
    case 'Agreed':
    case 'Held':
      // A delivery before deliverBy brings the adjudicators back.
      return passed(deliverBy) ? null : [];
    case 'Delivered':
    case 'FallbackJudging': {
      if (passed(fallbackBy)) return null;
      const at = s.kind === 'Delivered' && ours(adjudicator) && !passed(judgeBy) ? [now] : [];
      // Kept even while the primary can act now: the takeover must not wait on a slow cadence (T-057 review).
      if (ours(fallbackAdjudicator)) at.push(s.kind === 'Delivered' ? Date.parse(judgeBy) : now);
      return at;
    }
    case 'Escalated':
      return passed(s.escalation.appealDecideBy) ? null : ours(appealAdjudicator) ? [now] : [];
    case 'Released':
    case 'Refunded': {
      if (s.via.kind !== 'first_instance') return null;
      const a = s.via.appeal;
      if (a.kind === 'none') return passed(a.appealBy) ? null : [];
      if (a.kind === 'open') return passed(a.appealDecideBy) ? null : ours(appealAdjudicator) ? [now] : [];
      return null;
    }
    default:
      return null;
  }
}

export class PublicWorld {
  private persisted: number;
  private persisting: Promise<void> = Promise.resolve();
  private lastActive = -Infinity;
  /** Adjudicator passes in a row that changed nothing. */
  private idlePasses = 0;
  /** Every commitment an adjudicator may still act on, from the event log read up to `seq`. */
  private readonly commitments = new Set<Hex32>();
  private seq = 0;
  /** From the last look: whether the adjudicators have a step to take now, and the next fallback takeover (ms). */
  private due = false;
  private wake: number | null = null;
  private readonly handlers: Array<(r: Request, client?: string) => Promise<Response>>;

  private constructor(
    private readonly o: PublicWorldOptions,
    /** Counts the world's storage use and keeps the request log; worker.ts tells it about alarms. */
    readonly telemetry: Telemetry,
    private readonly secret: string,
    /** SimChain, or the EVM adapter over a live chain (D41). */
    readonly chain: SimChain | EvmSettlement,
    private readonly keys: TestAccount[],
    readonly operators: readonly Operator[],
    readonly adjudicators: Record<Role, TestAdjudicator>,
    private readonly panel: PanelConfig,
    /** Offers an adjudicator declined, with its reason, for the state read's notices. In memory: every pass declines again. */
    private readonly declined: Map<Hex32, string>,
    persisted: number,
    /** Each node's public address (OPERATOR_URLS), when configured. */
    private readonly publicUrls: readonly string[] = [],
    private readonly live?: LiveWorld,
  ) {
    this.persisted = persisted;
    this.handlers = operators.map((op) => fetchHandler(op));
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** Opens the world in `storage`: creates it on first use, otherwise rebuilds it (SimChain: replays its journal). */
  static async open(o: PublicWorldOptions): Promise<PublicWorld> {
    const now = o.now ?? Date.now;
    const telemetry = await Telemetry.open({ storage: o.storage, now, ...(o.telemetryLog ? { log: o.telemetryLog } : {}) });
    // Every storage call below is counted against the free tier.
    const { storage } = telemetry;
    const replayed = telemetry.wake();
    const settlement = o.live ? 'sepolia' : 'sim';
    // Fixed when the world is created: the journal replays only against the genesis it was written under, so
    // a later configuration change (MIN_WINDOW_SEC) applies to a fresh world, not to this one.
    let meta = await storage.get<Meta>('meta');
    if (!meta) {
      meta = { secret: hex(crypto.getRandomValues(new Uint8Array(32))), start: wholeSecond(now()), minWindowSec: o.minWindowSec ?? 60, settlement, ...(o.live ? { rules: lc(o.live.chain.deployment.rules) } : {}) };
      await storage.put({ meta });
    }
    if ((meta.settlement ?? 'sim') !== settlement) throw new Error(`this world settles on ${meta.settlement ?? 'sim'}; it cannot open as ${settlement} (name another world)`);
    if (o.live && meta.rules !== lc(o.live.chain.deployment.rules)) throw new Error(`this world settles on the rules contract ${meta.rules}, not ${o.live.chain.deployment.rules} (a new deployment needs a new world)`);
    const secret = meta.secret;
    const key = (label: string): TestAccount => ({ ...testAccount(`${label}/${secret}`), label });
    const m = meta.minWindowSec;
    o = { ...o, minWindowSec: m };
    // On a chain the token identifier is the test token's address (ADR-0025); the rulebook is SimChain's otherwise.
    const token = o.live ? lc(o.live.chain.deployment.token) : TOKEN;
    // What people read: tUSD on SimChain; on a chain the deployment's symbol (tUSDC, D42), never the address.
    const symbol = o.live ? o.live.chain.token.symbol : TOKEN;
    const chainId = o.live ? o.live.chain.chainId : SIM_CHAIN_ID;
    const domain: HoldbackDomain = o.live ? holdbackDomain(chainId, o.live.chain.deployment.rules) : holdbackDomain(SIM_CHAIN_ID);
    const rulebook = rebindToken({ ...SIM_RULEBOOK, minWindowsSec: { judge: m, fallback: m, appealWindow: m, appealDecide: m } }, TOKEN, token);
    const club = simClub(key('demo-club-operator').address, rulebook, DEMO_CLUB_ID);
    const principal = key('demo-club-principal');
    const adjKeys = ADJUDICATORS.map((a) => ({ ...a, keys: key(a.label) }));
    const bond = (25_000n * TUSD).toString();
    const genesis: Genesis = {
      start: meta.start,
      simSeed: canonicalKeccak({ sim: 'holdback/demo-cloud/v1', start: meta.start }),
      chainId,
      token,
      clubs: [club],
      mandates: [],
      members: [],
      balances: {},
      bonds: o.live ? {} : Object.fromEntries(adjKeys.map((a) => [a.keys.address, { junior: bond, senior: '0' }])),
    };
    let chain: SimChain | EvmSettlement;
    let journalLength = 0;
    let live: LiveWorld | undefined;
    if (o.live) {
      const books = [...(await storage.list<Book>({ prefix: 'b:' }))].map(([k, b]) => [k.slice(2) as Hex32, b] as const);
      const events = await PagedLog.load<SettlementEvent>(storage, 'e:');
      const mandates = await PagedLog.load<Mandate>(storage, 'mp:');
      // No chain call here: opening runs inside blockConcurrencyWhile (30 s), so the first pass reads the bonds.
      const evm = await EvmSettlement.restore(o.live.chain, genesis, { books, events: events.all(), mandates: mandates.all() }, now);
      chain = evm;
      live = { settlement: o.live, evm, events, mandates, bonded: new Set(meta.bonded ?? []), adjudicatorKeys: adjKeys.map((a) => a.keys.privateKey), meta, pools: 0, verified: false };
    } else {
      const journal = [...(await storage.list<JournalEntry>({ prefix: 'j:' })).values()];
      chain = await SimChain.replay(genesis, journal);
      journalLength = journal.length;
    }
    const ledger = ledgerOf(chain, o.live?.chain);

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
      const amount = (v: bigint) => ({ token, amount: v.toString() }) as AdjudicatorRegistration['fee']['min'];
      return { ...r, pool: { junior: amount(p.junior), senior: amount(p.senior), reserved: amount(p.reserved), terms: { ...POOL_TERMS } } } as AdjudicatorRegistration;
    };
    const faucetAmount = o.faucetAmount ?? 1_000n * TUSD;
    const faucetWindowSec = o.faucetWindowSec ?? 3600;
    const faucetPerClient = o.faucetPerClient ?? 10;
    const tokenAmount = (v: bigint): TokenAmount => ({ token, amount: v.toString() }) as TokenAmount;
    const registry: Registry = {
      chainId,
      ...(o.live ? { verifyingContract: o.live.chain.deployment.rules } : {}),
      clubs: [club],
      get mandates() {
        return chain.agentMandates();
      },
      members: [],
      adjudicators: () =>
        adjKeys.map((a) => {
          const p = chain.pool(a.keys.address);
          return { address: a.keys.address, bond: { junior: tokenAmount(p.junior), senior: tokenAmount(p.senior), reserved: tokenAmount(p.reserved) } };
        }),
      now: () => chain.now(),
      registration,
      judgment: (id) => records.get(id) ?? null,
      // POST /v1/faucet: a fixed grant and a mandate in the demo club; `amount` is not honoured here.
      faucet: grantFrom({ storage, ledger, club, principal, domain, token, symbol, amount: faucetAmount, windowSec: faucetWindowSec, perClient: faucetPerClient, now, ...(live ? { live } : {}) }),
    };
    // ADR-0023: one schedule for both nodes (one operator), paid to one world address; from Worker variables. On a
    // chain the minimum also carries the gas these nodes pay for a deal (D33, amended 2026-11-03).
    const gasQuote = o.live ? (o.env['OPERATOR_FEE_GAS'] ?? '0') : undefined;
    const operatorFee = operatorFeeFromEnv(o.env, key('demo-operator-fees').address, token, gasQuote);
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
        token: { id: token, decimals: 6 },
        adjudicators: ADJUDICATORS.map((a) => ({ role: a.role, address: adjudicators[a.role].address, name: nameOf(a, panel.live) })),
        faucet: { path: '/v1/faucet', grant: tokenAmount(faucetAmount), perAddressEverySec: faucetWindowSec, perClientPerWindow: faucetPerClient },
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
        if (why) return [`The primary adjudicator declined this offer: ${why}. It stays Offered until offerExpiresAt, and nobody can fund it.`];
        if (live && live.bonded.size < ADJUDICATORS.length) return [BONDING];
        return [];
      }
      return [];
    };
    const chainFacts = o.live ? { chainId, rules: o.live.chain.deployment.rules, token, symbol, funding: o.live.chain.funding, explorer: o.live.explorer ?? SEPOLIA_EXPLORER, gas: gasQuote } : undefined;
    const evm = chain instanceof EvmSettlement ? chain : undefined;
    for (const i of [0, 1]) {
      operators.push(
        new Operator({
          settlement: chain,
          registry,
          store,
          ...(operatorFee ? { fee: operatorFee } : {}),
          ...(evm ? { erc3009: { funding: (t) => evm.fundingTypedData(t), operatorFee: (x) => evm.operatorFeeTypedData(x) } } : {}),
          signerKey: key(`demo-operator-${i + 1}`).privateKey,
          operatorId: `demo-op-${i + 1}`,
          env: o.env,
          rateLimit: o.rateLimit ?? { writes: 120, reads: 1200, windowMs: 60_000 },
          notes: notesFor(club.id, m, faucetAmount, faucetWindowSec, panel, operatorFee, chainFacts),
          demo,
          notices,
          ...(feedback ? { feedback } : {}),
          // The fields the request log keeps, picked here: the path and traceparent never reach telemetry.
          log: (e) =>
            telemetry.request({ requestId: e.requestId, at: Math.floor(now() / 1000), node: i === 1 ? 1 : 0, method: e.method, route: e.route, status: e.status, ...(e.problem ? { problem: e.problem } : {}), ms: e.ms }),
        }),
      );
    }

    const fee = { token, amount: TUSD.toString() } as AdjudicatorRegistration['fee']['min'];
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
        domain,
        fee,
      });
      registrations.set(adj.address, { ...adj.registration(), poolTermsHash: canonicalKeccak(POOL_TERMS), status: 'active' });
      const parsed = parseAdjudicator(registration(adj.address));
      if (!parsed.ok) throw new Error(`${nameOf(a, panel.live)}'s registration does not validate: ${parsed.error.detail}`);
      adjudicators[a.role] = adj;
    }
    const keys = [principal, key('demo-club-operator'), ...adjKeys.map((a) => a.keys), key('demo-operator-1'), key('demo-operator-2')];
    const world = new PublicWorld(o, telemetry, secret, chain, keys, operators, adjudicators, panel, declined, journalLength, publicUrls, live);
    // A wake, from a plain read too, makes the world active only when its adjudicators have a step to take or a chain
    // world's setup is left: a deal left mid-way resumes, an idle world arms no alarm. A takeover later on is
    // scheduled whether or not it is active.
    await world.look();
    if (world.due || !world.ready()) world.stir();
    return world;
  }

  /** A day's settlement-side facts for its telemetry line: the deal funnel and signer counts, the journal, live judging. */
  private readonly facts: DayFacts = async (day, window) => {
    const chain = this.chain;
    const log = chain.log();
    // A chain world reads finality from its books: a state view would read balances from the chain for every deal.
    if (chain instanceof EvmSettlement) return { ...dealFacts(log, (id) => chain.finality(id as Hex32) ?? undefined, window), journalEntries: log.length, liveJudges: await this.panel.budget.on(day) };
    const ids = [...new Set(log.flatMap((e) => (e.type === 'commitment.offered' && e.commitmentId ? [e.commitmentId] : [])))];
    const views = new Map(await Promise.all(ids.map(async (id) => [id, await chain.state(id)] as const)));
    const finality = (id: string) => {
      const v = views.get(id as Hex32);
      return v ? { settledAt: v.settledAt ?? null, finalAt: v.finalAt ?? null } : undefined;
    };
    return { ...dealFacts(log, finality, window), journalEntries: chain.journalLength(), liveJudges: await this.panel.budget.on(day) };
  };

  /** Every secret this world holds, for the test that no route serves one. In-process only. */
  secretsForTest(): string[] {
    return [this.secret, ...this.keys.flatMap((k) => [k.privateKey, hex(k.encryptionSecretKey)]), ...(this.live?.settlement.chain.secretsForTest() ?? [])];
  }

  /** SimChain's state digest; on a chain, the head of the event log's hash chain. */
  digest(): Hex32 {
    if (this.chain instanceof SimChain) return this.chain.digest();
    return (this.chain.log().at(-1)?.hash ?? `0x${'00'.repeat(32)}`) as Hex32;
  }

  /**
   * True while adjudicator passes run: these adjudicators have a step to take now (or a chain world's setup is left),
   * and settlement moved, or the world woke with that step to take, in the last 15 minutes.
   */
  active(): boolean {
    return (this.due || !this.ready()) && this.now() - this.lastActive < ACTIVE_FOR_MS;
  }

  /**
   * When the next adjudicator pass should run (ms since the epoch), or null when none is due. While `active()`: a
   * second after settlement moved or a chain world's setup step went through (2 s on a chain, ADR-0028 §5), twice as
   * long after each pass in a row that changed nothing or whose setup step failed (up to a minute). And at the next
   * fallback takeover's judgeBy, whether active or not: one alarm per takeover.
   */
  nextPass(): number | null {
    const wait = Math.min((this.live ? CHAIN_PASS_MS : PASS_MS) * 2 ** this.idlePasses, SLOWEST_PASS_MS);
    // A takeover whose judgeBy passed since the last look gets a pass after the current wait: an alarm set in the past
    // would fire at once, again and again while nothing rereads the state (T-057 review 4).
    const wake = this.wake === null ? null : this.wake > this.now() ? this.wake : this.now() + wait;
    if (!this.active()) return wake;
    return Math.min(this.now() + wait, wake ?? Infinity);
  }

  /** Restarts the activity window and the one-second cadence. */
  private stir(): void {
    this.lastActive = this.now();
    this.idlePasses = 0;
  }

  /**
   * Rereads from settlement state whether the adjudicators have a step to take now (`due`) and when the next fallback
   * takeover is (`wake`). Returns whether settlement moved since the last look: every accepted write and every
   * adjudicator action is a settlement event.
   */
  private async look(): Promise<boolean> {
    const seen = this.seq;
    for await (const e of this.chain.events(this.seq)) {
      this.seq = e.seq + 1;
      // Any event brings its commitment back: a look may drop one by the wall clock while a submission stamped
      // before the deadline is still landing (T-057 review).
      if (e.commitmentId) this.commitments.add(e.commitmentId);
    }
    const ours = new Set(Object.values(this.adjudicators).map((a) => lc(a.address)));
    const now = this.now();
    this.due = false;
    this.wake = null;
    for (const id of this.commitments) {
      const s = this.chain.escrowState(id);
      const at = s ? workAt(s, (a) => ours.has(lc(a)), now) : null;
      if (at === null) {
        this.commitments.delete(id);
        continue;
      }
      // A declined offer stays Offered until it expires; the pass that declined it has nothing more to do.
      if (s!.kind === 'Offered' && this.declined.has(id)) continue;
      for (const t of at) {
        if (t <= now) this.due = true;
        else if (this.wake === null || t < this.wake) this.wake = t;
      }
    }
    return this.seq > seen;
  }

  private tick(): void {
    this.chain.advanceTo(wholeSecond(this.now()));
  }

  /**
   * Writes what is not yet in storage. SimChain: the journal entries. A chain world: each changed book in its row,
   * new events and mandates into their pages. Serialized, so entries land once and in order.
   */
  private persist(): Promise<void> {
    this.persisting = this.persisting.then(async () => {
      if (this.live) {
        const { books, events, mandates } = this.live.evm.drain();
        for (let i = 0; i < books.length; i += 100) await this.telemetry.storage.put(Object.fromEntries(books.slice(i, i + 100).map(([id, b]) => [`b:${id}`, b])));
        await this.live.events.append(events);
        await this.live.mandates.append(mandates);
        return;
      }
      const chain = this.chain as SimChain;
      const fresh = chain.journal(this.persisted);
      for (let i = 0; i < fresh.length; i += 100) {
        const batch = fresh.slice(i, i + 100);
        await this.telemetry.storage.put(Object.fromEntries(batch.map((e, j) => [jkey(this.persisted + i + j), e])));
      }
      this.persisted += fresh.length;
    });
    return this.persisting;
  }

  /**
   * A chain world's setup (ADR-0028 §7), one step per pass so a pass stays small: each adjudicator gets its bond in
   * HoldbackBonds, then the deal lanes their gas. Every step reads the chain first, so a repeat sends nothing.
   */
  private async setup(): Promise<void> {
    const l = this.live!;
    const chain = l.settlement.chain;
    const addresses = l.adjudicatorKeys.map((k) => privateKeyToAccount(k).address);
    if (!l.verified) {
      // Before anything is sent: the RPC serves the deployment's chain, and the contract is the one in the file.
      await chain.verify();
      l.verified = true;
      await l.evm.refreshPools(addresses);
    }
    // Once a minute (and first): the deal lanes' gas, then the bonds' standing. A pass that sent ETH ends there.
    if (this.now() - l.pools > 60_000) {
      l.pools = this.now();
      if ((await chain.topUpLanes(LANE_FLOOR, LANE_TOP_UP)).length > 0) return;
      await l.evm.refreshPools(addresses);
    }
    const next = l.adjudicatorKeys.find((k) => !l.bonded.has(privateKeyToAccount(k).address));
    if (!next) return;
    await ensureBond(chain, next, l.settlement.bond ?? DEFAULT_LIVE_BOND, l.settlement.adjudicatorGas ?? DEFAULT_ADJUDICATOR_GAS);
    l.bonded.add(privateKeyToAccount(next).address);
    l.meta.bonded = [...l.bonded];
    await this.telemetry.storage.put({ meta: l.meta });
    await l.evm.refreshPools(addresses);
  }

  /** True once a chain world's setup is done (every adjudicator bonded); a SimChain world always is. */
  ready(): boolean {
    return !this.live || (this.live.verified && this.live.bonded.size === ADJUDICATORS.length);
  }

  /** One adjudicator pass (the Durable Object alarm): accept or decline offers, trigger fallbacks, decide. */
  async work(): Promise<void> {
    this.telemetry.invoked();
    this.tick();
    if (this.live) {
      const setupLeft = !this.ready();
      try {
        await this.setup();
        // Every setup step that does not throw takes the setup forward (verify, gas, a bond).
        if (setupLeft) this.idlePasses = 0;
      } catch (e) {
        // A failing step (an RPC down) backs off like a pass that changes nothing (T-057 review).
        if (setupLeft) this.idlePasses++;
        this.o.onError?.(e as Error);
      }
      // The adjudicators wait for a verified chain and their own bonds: an acceptance without one is refused on chain.
      // The look still runs, so a takeover whose judgeBy passed meanwhile is due, not a stale wake (T-057 review 4).
      if (!this.ready()) {
        await this.persist();
        await this.look();
        return;
      }
    }
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
      } catch (e) {
        this.o.onError?.(e as Error);
      } finally {
        panel.allowLive = false;
      }
    }
    await panel.budget.flush();
    await this.persist();
    if (await this.look()) this.stir();
    else this.idlePasses++;
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
    // A URL origin has no path, so it never ends in a slash.
    op.baseUrl = this.publicUrls[via.node] ?? via.origin;
    const response = await this.handlers[via.node]!(request, via.client);
    await this.persist();
    if (await this.look()) this.stir();
    await this.flushTelemetry(false);
    return response;
  }
}

/** What a chain world keeps beside its settlement: storage pages, the setup's progress, its keys. */
interface LiveWorld {
  settlement: LiveSettlement;
  evm: EvmSettlement;
  events: PagedLog<SettlementEvent>;
  mandates: PagedLog<Mandate>;
  /** Adjudicators whose bond is in place. */
  bonded: Set<string>;
  adjudicatorKeys: `0x${string}`[];
  meta: Meta;
  /** Whether this instance checked the RPC's chain and the rules contract against the deployment file. */
  verified: boolean;
  /** When the pools and lanes were last checked (ms). */
  pools: number;
}

/** What the faucet needs from the settlement layer: mandates, and a grant of test tokens in process or on chain. */
interface FaucetLedger {
  agentMandates(): Mandate[];
  admit(m: Mandate): Promise<Problem | null>;
  grant(address: Address, amount: bigint): Promise<{ tx?: string }>;
  balances(addresses: readonly Address[]): Promise<Record<Address, TokenAmount>>;
}

function ledgerOf(chain: SimChain | EvmSettlement, live: LiveChain | undefined): FaucetLedger {
  return {
    agentMandates: () => chain.agentMandates(),
    admit: (m) => chain.admit(m),
    balances: (a) => chain.balances(a),
    grant: async (address, amount) => {
      if (chain instanceof SimChain) {
        chain.faucet(address, amount);
        return {};
      }
      const mined = await live!.mint(address, amount);
      chain.forgetBalances([address]);
      return { tx: mined.hash };
    },
  };
}

/**
 * The demo faucet's grant: a fixed amount of tUSD and a mandate in the demo club, signed by the club's own
 * test principal, once per address per window (persisted) and a few addresses per client per window (in memory).
 * On a chain (ADR-0028 §6) the grant is a mint the funding lane sends, answered after its receipt, skipped when the
 * address already holds the grant, and capped per day. One Durable Object serves the world, so the grants in
 * progress and the day's count are held in memory: two requests that race for one address get one grant, and two
 * mints racing the cap read and raise one number.
 */
function grantFrom(w: {
  storage: WorldStorage;
  ledger: FaucetLedger;
  club: ReturnType<typeof simClub>;
  principal: TestAccount;
  domain: HoldbackDomain;
  token: string;
  symbol: string;
  amount: bigint;
  windowSec: number;
  perClient: number;
  now: () => number;
  live?: LiveWorld;
}): NonNullable<Registry['faucet']> {
  const perClient = new Map<string, { start: number; count: number }>();
  const granting = new Set<string>();
  let today = { day: '', minted: 0 };
  return async (address, { client }): Promise<FaucetOutcome> => {
    const now = w.now();
    const windowMs = w.windowSec * 1000;
    const retryAfterSec = (at: number) => Math.max(1, Math.ceil((at - now) / 1000));
    const last = await w.storage.get<number>(`fa:${address}`);
    if (last !== undefined && now - last < windowMs) return { ok: false, problem: problem('rate_limited', `${address} was funded in the last ${w.windowSec} seconds; one grant per address per window`), retryAfterSec: retryAfterSec(last + windowMs) };
    let c = perClient.get(client);
    if (!c || now - c.start >= windowMs) perClient.set(client, (c = { start: now, count: 0 }));
    if (c.count >= w.perClient) return { ok: false, problem: problem('rate_limited', 'too many faucet grants from this client; retry later'), retryAfterSec: retryAfterSec(c.start + windowMs) };
    if (granting.has(address)) return { ok: false, problem: problem('rate_limited', `a grant to ${address} is in progress; one grant per address per window`), retryAfterSec: retryAfterSec(now + 15_000) };
    c.count++;
    granting.add(address);
    try {
      return await grant(address, now, windowMs, retryAfterSec);
    } finally {
      granting.delete(address);
    }
  };

  async function grant(address: Address, now: number, windowMs: number, retryAfterSec: (at: number) => number): Promise<FaucetOutcome> {
    let mandate: Mandate | undefined = w.ledger.agentMandates().find((x) => lc(x.agent) === address && x.clubId === w.club.id);
    if (!mandate) {
      const issuedAt = wholeSecond(now);
      const expires = wholeSecond(now + 30 * 86_400_000);
      const scope = rebindToken(wideScope(['buyer', 'seller'], expires), TOKEN, w.token);
      mandate = await mandateFor({ name: `${w.principal.label}`, key: w.principal.privateKey, address: w.principal.address }, address, w.club.id, scope, issuedAt, w.domain);
      const p = await w.ledger.admit(mandate);
      if (p) return { ok: false, problem: p };
    }
    let tx: string | undefined;
    const held = BigInt((await w.ledger.balances([address]))[address]?.amount ?? '0');
    if (!w.live || held < w.amount) {
      const day = `fm:${new Date(now).toISOString().slice(0, 10)}`;
      if (w.live) {
        if (today.day !== day) {
          const stored = (await w.storage.get<number>(day)) ?? 0;
          if (today.day !== day) today = { day, minted: stored };
        }
        if (today.minted >= FAUCET_MINTS_PER_DAY) return { ok: false, problem: problem('rate_limited', `the faucet's ${FAUCET_MINTS_PER_DAY} mints for today (UTC) are spent; ${w.symbol} on this chain is open-mint, so you can also mint it yourself`), retryAfterSec: retryAfterSec(Date.parse(`${day.slice(3)}T00:00:00Z`) + 86_400_000) };
        today.minted++;
      }
      // Counted before the mint, so a grant racing it cannot mint twice; a failed mint gives the address its turn back.
      await w.storage.put({ [`fa:${address}`]: now, ...(w.live ? { [day]: today.minted } : {}) });
      try {
        tx = (await w.ledger.grant(address, w.amount)).tx;
      } catch (e) {
        await w.storage.put({ [`fa:${address}`]: 0 });
        if (e instanceof RelayRefused) return { ok: false, problem: problem('relay_refused', `the faucet cannot mint now: ${e.message}`) };
        throw e;
      }
    } else {
      await w.storage.put({ [`fa:${address}`]: now });
    }
    return {
      ok: true,
      grant: {
        clubId: w.club.id,
        granted: { token: w.token, amount: tx || !w.live ? w.amount.toString() : '0' } as TokenAmount,
        balance: (await w.ledger.balances([address]))[address]!,
        mandate: { ...mandate, mandateHash: canonicalKeccak(mandate) as Hex32 },
        nextGrantAfter: wholeSecond(now + windowMs),
        notice: w.live
          ? `TEST TOKENS ONLY: ${w.symbol} on Sepolia is an open-mint test token with no value, not Circle's USDC${tx ? `; minted in ${tx}` : '; this address already held the grant, so nothing was minted'}. The mandate is signed by the demo club's own test principal, held by this demo.`
          : "TEST TOKENS ONLY: tUSD on SimChain has no value. The mandate is signed by the demo club's own test principal, held by this demo.",
      },
    };
  }
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
export function operatorFeeFromEnv(env: Readonly<Record<string, string | undefined>>, to: Address, token: string = TOKEN, gas?: string): OperatorFeeSchedule | undefined {
  const bps = env['OPERATOR_FEE_BPS'];
  const min = env['OPERATOR_FEE_MIN'];
  const max = env['OPERATOR_FEE_MAX'];
  if (bps === undefined && min === undefined) return undefined;
  if (bps === undefined || !/^(0|[1-9][0-9]{0,4})$/.test(bps) || Number(bps) > 10_000) throw new Error(`OPERATOR_FEE_BPS must be whole basis points from 0 to 10000, got ${JSON.stringify(bps)}`);
  if (min === undefined || !DECIMAL.test(min)) throw new Error(`OPERATOR_FEE_MIN must be base units as a decimal string (0.01 tUSD is "10000"), got ${JSON.stringify(min)}`);
  if (max !== undefined && max !== '' && !DECIMAL.test(max)) throw new Error(`OPERATOR_FEE_MAX must be base units as a decimal string, or unset, got ${JSON.stringify(max)}`);
  if (gas !== undefined && !DECIMAL.test(gas)) throw new Error(`OPERATOR_FEE_GAS must be base units as a decimal string (1.50 tUSDC is "1500000"), got ${JSON.stringify(gas)}`);
  // D33 as amended 2026-11-03: on a chain the minimum is the relay minimum plus the per-deal gas quote, so the fee
  // max(min, bps of the price) never falls below the gas these nodes pay, and clients compute it as before.
  const floor = gas === undefined ? min : (BigInt(min) + BigInt(gas)).toString();
  return { to, token, bps: Number(bps), min: floor, max: max === undefined || max === '' ? null : max, appliesAt: 'agree-and-fund', refundable: false };
}

const tokenText = (base: string, symbol: string): string => {
  const v = BigInt(base);
  const frac = (v % TUSD).toString().padStart(6, '0').replace(/0+$/, '');
  return `${v / TUSD}${frac ? `.${frac}` : ''} ${symbol}`;
};

/** What each node states about itself in discovery and llms.txt. */
export function notesFor(
  clubId: string,
  minWindowSec: number,
  faucetAmount: bigint,
  faucetWindowSec: number,
  panel?: Pick<PanelConfig, 'live' | 'registry' | 'budget'>,
  fee?: OperatorFeeSchedule,
  /** A chain world's facts (D41): its chain, contracts and token, the relayer's funding lane, the explorer, the gas quote. */
  chain?: { chainId: number; rules: string; token: string; symbol: string; funding: string; explorer: string; gas?: string | undefined },
): string[] {
  const symbol = chain?.symbol ?? TOKEN;
  const amount = (base: string) => tokenText(base, symbol);
  const gas = chain?.gas && chain.gas !== '0' ? chain.gas : undefined;
  // D33 as amended 2026-11-03: the minimum carries the gas these nodes pay for a deal's transactions.
  const gasText = gas && fee ? ` That minimum is ${amount(gas)} for the gas these nodes pay for a deal's transactions on Sepolia (about 500,000 gas at 1 gwei, priced at this demo's fixed, fictional rate of 3,000 ${symbol} per test ETH) plus ${amount((BigInt(fee.min) - BigInt(gas)).toString())} for relaying; the quote is fixed per deal, whether the deal needs fewer transactions or more.` : '';
  const feeNote = fee
    ? fee.bps === 0 && fee.min === '0'
      ? `Operator fee: published at 0 (fees.operator in /v1/status): these nodes relay a funded agreement free for now. When it is switched on, POST /v1/prepare/agree-and-fund adds a third signature (slot operatorFee.signature), paid to ${fee.to}, outside the hold and not refunded.`
      : `Operator fee: these nodes charge an operator fee of ${fee.bps} bp of the price, at least ${amount(fee.min)}${fee.max === null ? '' : `, at most ${amount(fee.max)}`}, rounded up, paid by the buyer to ${fee.to} with the funded agreement: POST /v1/prepare/agree-and-fund returns a third signature (slot operatorFee.signature). It is a separate transfer, never part of the hold, and not refunded. A funded agree without it gets 402 payment_required; reads, prepare, the faucet, deliveries and direct submission to the settlement layer are free (ADR-0023).${gasText}${gas ? ' Submitting directly to the contract, you pay your own gas and no fee to these nodes.' : ''}`
    : undefined;
  const whole = (faucetAmount / TUSD).toString();
  const judges = panel?.live
    ? `Adjudicators: three test adjudicators run by this demo, listed by role under demo.adjudicators in this discovery document. Deterministic checks are real. Rubric deals get a live judge panel: pinned models from two families, Anthropic and DeepSeek (${panel.registry.active.map((e) => e.model).join(', ')}; registry config/judges-live.yaml, not calibrated). At most ${panel.budget.perDay} live judge calls a day across this demo (UTC; demo.judges shows today's count); past that, panels are scripted fake judges whose verdicts start "[fake judge, no model ran]". DeepSeek's model names are provider aliases that can change underneath.`
    : 'Adjudicators: three test adjudicators run by this demo, listed by role under demo.adjudicators in this discovery document. Deterministic checks are real. Judge panels are scripted fake judges (no model runs; verdicts start "[fake judge, no model ran]"), so use template "checks-only" for real acceptance.';
  const settlement = chain
    ? [
        `Public demo node. TEST TOKENS ONLY: deals settle on Ethereum Sepolia (chain id ${chain.chainId}) in ${symbol}, Crow Test USDC (${chain.token}): an open-mint test token with USDC's interface and no value, not Circle's USDC. No real money moves, and none can be deposited or withdrawn.`,
        `The money in every funded deal is held by the HoldbackRules contract ${chain.rules} through Coinbase Commerce Payments' AuthCaptureEscrow: check it at ${chain.explorer}/address/${chain.rules}. Events of on-chain steps carry the transaction hash in payload.tx (${chain.explorer}/tx/<hash>).`,
        `Each money step waits for a Sepolia block (about 12 s), so a test deal takes about a minute. A write answers once its transaction is in a block, before the block is final (about 15 minutes). These nodes pay the gas from their own relayer keys (funded from ${chain.funding}); they relay the messages you sign and never sign for you.`,
        'Both demo operator nodes are one program in one Cloudflare Durable Object behind two addresses: reading both catches a lying front end, not a lying index. The offer, the adjudicator acceptance and the agreement stay off chain until agreeAndFund checks all three on chain.',
      ]
    : [
        'Public demo node. TEST TOKENS ONLY: tUSD on SimChain (chain id 31337) has no value; no real money moves, and none can be deposited or withdrawn.',
        'Both demo operator nodes serve one shared simulated settlement layer (SimChain) held in one Cloudflare Durable Object. Each node signs receipts with its own key, but they are not independent operators: independent nodes need testnet contracts (Phase 2).',
      ];
  return [
    ...settlement,
    `Get test tokens: POST /v1/faucet {"address": "0x..."} with an Idempotency-Key header grants ${whole} ${symbol} and a mandate in club ${clubId}, once per address per ${faucetWindowSec} seconds. Make your own keys: no route here ever returns a secret key.`,
    `The faucet mandate is signed by the demo club's own test principal, which this demo holds; it lets your address act as buyer or seller in ${clubId}.`,
    judges,
    'Disclosure: offer at "public" on these nodes. The demo adjudicators cannot open sealed terms yet, so they decline private and judgment offers, which then expire unaccepted. The work itself is encrypted at every level.',
    `Settlement time is the wall clock. Club ${clubId} allows windows from ${minWindowSec} seconds: timing {"judgeWithinSec": ${minWindowSec}, "fallbackWithinSec": ${minWindowSec}, "appealWindowSec": ${minWindowSec}, "appealDecideSec": ${minWindowSec}} completes a deal in a few minutes.`,
    ...(feeNote ? [feeNote] : []),
    'Request log: these nodes keep one line per request for seven days (Request-Id, time, node, method, route template, status, problem type, timing), never a body, a header value, an IP address, or the addresses and IDs in the path. Quote the Request-Id of a failed request when you report it.',
    ...(chain ? ['Fallback and appeal adjudicators need drand proofs on Sepolia, which these demo adjudicators do not fetch yet: if the primary stays silent, the default outcome (a refund) applies after fallbackBy.'] : []),
    chain ? 'State survives a restart, but this is a demo: it may be reset at any time. Keep your own copy of the terms you signed.' : 'State is journaled and replayed after a restart, but this is a demo: it may be reset at any time.',
  ];
}
