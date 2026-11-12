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
//   when to set its alarm, so an idle world, or one woken by a plain read, costs no alarm;
// - any agent registers its own adjudicator at POST /v1/adjudicators (ADR-0030, T-221), one row `ar:<address>` each,
//   never removed. The three demo adjudicators register the same way when the world opens, signed by their own keys,
//   and are the defaults for any role an offer leaves out. Bonds are read live on SimChain; a chain holds none (ADR-0031 §8).
// No real money: SimChain (chain id 31337), the test token tUSD, and the operators' startup guards.
//
// On Sepolia (D41, ADR-0028; option `live`), the same world settles on the HoldbackRules contracts through
// EvmSettlement instead of SimChain. The chain holds the money and is the authority for every state from funding
// on; the world keeps what the chain does not (the signed offer, acceptance and agreement before funding, the
// adjudicators' envelopes) and the event log. It persists each commitment's book and the log in pages, so a restart
// reads one row per commitment and one per 64 events, and replays nothing. The relayer key pays gas for what the
// operators relay; the faucet mints test tUSDC on chain (D42). The phase-one contracts take no party appeal and hold no
// bond (ADR-0031 §8): the demo adjudicators accept with bondReserved 0, and a first decision is final at once.
// Each pass reads the rules contract's logs from a stored cursor (ChainSync, T-218), so a call a party sent straight
// to the contract shows in the view too; a pass runs at least once a minute while any deal is open. Each relayer
// lane's in-flight row (T-219, lanes.ts) survives a restart between a broadcast and its receipt: the next pass lands
// that transaction as the relay it was, before the sync and the adjudicators. The demo club's rulebook names drand
// quicknet, which the rules contract verifies, and the demo adjudicators read its rounds from the public relays (T-217,
// T-220). One world lives through rulebook, schema and code changes; only a new rules contract needs a new one (D49).
// After the adjudicators, each pass sends the deals' due timeouts at the relayer's gas (T-231): the reclaim, the
// default and an accepted offer's expiry, so a deal ends when its parties are gone. A cap per pass
// and a daily budget bound what that spends, and the alarm wakes at the next one due.
import { canonicalKeccak, DRAND_QUICKNET_CHAIN_HASH, holdbackDomain, problem, registrationBodyHash, trimTrailingSlashes, wholeSecond, type AdjudicatorPolicy, type AdjudicatorRegistration, type AdjudicatorRole, type Address, type EscrowState, type HoldbackDomain, type Hex32, type Judgment, type Mandate, type OperatorFeeSchedule, type Problem, type RegisteredAdjudicator, type SettlementEvent, type Sha256, type Timestamp, type TokenAmount } from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import { StoreError, type CiphertextStore } from '@holdback/core/store';
import { declinesOf, drandQuicknet, testAdjudicator, type RandomnessSource, type RunReport, type TestAdjudicator } from '@holdback/adjudicator';
import {
  fetchHandler,
  nameToken,
  Operator,
  POOL_TERMS,
  register,
  ReportLimiter,
  signRegistration,
  testAccount,
  TUSD,
  type Bond,
  type DemoFacts,
  type FaucetOutcome,
  type FeedbackOptions,
  type FeedbackStore,
  type NoticeSubject,
  type Registry,
  type RegistrationStore,
  type StoredRegistration,
  type TestAccount,
} from '@holdback/operator';
import { decodePublicKey } from '@holdback/core/crypto';
import { ChainSync, EvmSettlement, OperatorTimeouts, rebindToken, RelayRefused, type Book, type Cursor, type LiveChain, type RecoverReport, type SyncReport, type TimeoutBudget, type TimeoutReport } from '@holdback/settlement/live';
import type { TimeoutKind } from '@holdback/settlement';
import { mandateFor, SIM_CHAIN_ID, SIM_RULEBOOK, simClub, SimChain, TOKEN, wideScope, type Genesis, type JournalEntry } from '@holdback/settlement/sim';
import { panelConfig, type JudgeProvider, type PanelConfig } from './judges.js';
import { StorageLanes } from './lanes.js';
import type { WorldStorage } from './storage.js';
import { dealFacts, Telemetry, type DayFacts, type TelemetryOptions } from './telemetry.js';

export interface PublicWorldOptions {
  storage: WorldStorage;
  /** Checked by the operators' startup guards (no real money). */
  env: Readonly<Record<string, string | undefined>>;
  /** The demo club's minimum for each judge, fallback and appeal window, in seconds. Default 60. */
  minWindowSec?: number;
  /** What the faucet grants when a request names no amount, in base units. Default 1,000 tUSD. */
  faucetAmount?: bigint;
  /** The largest amount one grant gives, in base units. Default DEMO_FAUCET_MAX_GRANT. */
  faucetMaxAmount?: bigint;
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
  /** The block explorer for transaction links in the notes. Default Sepolia Etherscan. */
  explorer?: string;
  /**
   * The randomness the deployment's beacon verifies, which the demo club's rulebook names (T-220, D49). Default: the
   * beacon each deployment script deploys. On Sepolia that is DrandQuicknetBeacon (contracts/script/deploy-sepolia.sh),
   * so `drand-quicknet`; on a local anvil chain (31337) the harness deploys SimBeacon (packages/settlement/evm/world.ts),
   * so `sim`, which the build before T-220 named on every chain.
   */
  beacon?: 'drand-quicknet' | 'sim';
  /** Where the demo adjudicators read drand quicknet rounds (T-217). Default the public relays, through the global fetch. */
  drand?: RandomnessSource;
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
const ADJUDICATORS: ReadonlyArray<{ role: AdjudicatorRole; label: string; name: string }> = [
  { role: 'primary', label: 'demo-adjudicator-a', name: 'Demo Adjudicator A' },
  { role: 'fallback', label: 'demo-adjudicator-b', name: 'Demo Adjudicator B' },
  { role: 'appeal', label: 'demo-adjudicator-c', name: 'Demo Adjudicator C' },
];
const nameOf = (a: { name: string }, live: boolean) => `${a.name} (test; real checks, ${live ? 'live panel within a daily budget' : 'scripted panel'})`;
/**
 * The largest amount one faucet grant gives: 1,000,000 test tokens (T-314). A request names its own `amount` up to
 * this, so a buyer funds a deal priced like a real job, fees included, from one grant. The cap bounds this free
 * service, never a deal's price: on a chain the test token is open-mint, so an agent that needs more mints it itself.
 */
export const DEMO_FAUCET_MAX_GRANT = 1_000_000n * TUSD;
/**
 * Largest ciphertext this demo stores: 1 MiB (T-315). Each ciphertext is one row of Durable Object storage, and a row
 * (key and value) is at most 2 MiB, so 1 MiB leaves half the row free. Discovery states it as
 * `limits.maxCiphertextBytes`; docs/api.md and site/llms.txt state the same number (world.test.ts compares them).
 * A larger cap needs chunked rows or an object store first.
 */
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
/**
 * The cursor row is written when a pass read a log, or once it is this many blocks behind (about an hour on Sepolia):
 * an idle world writes no row a pass, and a restart rereads at most this many blocks (T-218).
 */
const CURSOR_EVERY_BLOCKS = 300n;
/** How often a pass reads the chain while every open deal has been quiet for a day (T-218). */
const IDLE_SYNC_MS = 15 * 60_000;
/**
 * Timeouts the operators send on their own a UTC day (T-231): at most about 28 million gas, 0.028 test ETH at 1 gwei a
 * gas, at 140,019 gas each (a reclaim on anvil, the dearest timeout the red team measured on PR 230). Past it, a deal
 * waits for the next UTC day or a party's trigger.
 */
const TIMEOUTS_PER_DAY = 200;
/**
 * Of those, accepted offers expired (65,597 gas each on anvil): an offer costs nothing to post, so its own cap keeps
 * offers from spending the rest.
 */
const OFFER_EXPIRIES_PER_DAY = 50;
const SCRIPTED_PANEL = 'scripted judge panel: no model runs in this demo, every panel verdict is a fake judge marked "[fake judge, no model ran]"; use template checks-only for real acceptance';
const livePanel = (perDay: number) =>
  `live judge panel: pinned models from two families (Anthropic, DeepSeek; config/judges-live.yaml), at most ${perDay} live judge calls a day across this demo; past that, panels are scripted fake judges whose verdicts are marked "[fake judge, no model ran]"`;
const SEALED =
  'These demo adjudicators decline private and judgment offers: they cannot open sealed terms yet (T-207), so the offer would stay unaccepted and expire, and nobody could fund it. Offer at disclosure public on this demo; the work itself is encrypted either way.';

const lc = (s: string) => s.toLowerCase();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const jkey = (i: number) => `j:${String(i).padStart(12, '0')}`;
const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io';
/** A deal lane below 0.01 test ETH gets 0.03 from the funding lane: about 19 test deals on Sepolia at a 1 gwei tip (1.56 million gas a deal, measured). */
const LANE_FLOOR = 10_000_000_000_000_000n;
const LANE_TOP_UP = 30_000_000_000_000_000n;
/** Faucet mints a day on a chain: about 0.08 to 0.14 test ETH on Sepolia at a 1 gwei tip (130,000 to 240,000 gas a mint, measured). */
const FAUCET_MINTS_PER_DAY = 600;
/** How long a demo adjudicator's own registration runs (T-221), and how close to its end a world signs a new one at open. */
const REGISTRATION_TTL_MS = 365 * 86_400_000;
const REGISTRATION_RENEW_MS = 30 * 86_400_000;

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
 * The adjudicator registrations POST /v1/adjudicators stores (ADR-0030 §3, T-221): one row `ar:<address>` each, read
 * with one list when the world opens and served from memory after. A row is never deleted (Rafa, 2026-11-04). Storage
 * lists rows by key, so each row keeps the order its address was first stored in (`seq`), and the listing pages by it.
 *
 * The policies too (T-221 review): terms bind only the primary's policy hash, and a primary can register a new policy
 * after agreement. So a replacement that changes the policy first keeps the old one in a row `ph:<policyHash>`, never
 * deleted, and `policy(hash)` reads any policy a registration here ever carried. The current ones need no row.
 */
class StorageRegistrations implements RegistrationStore {
  private constructor(
    private readonly storage: WorldStorage,
    private readonly rows: Map<string, StoredRegistration>,
    private readonly replaced: Map<string, AdjudicatorPolicy>,
    private next: number,
    /** Told a prefix's row count when it grows, for telemetry. */
    private readonly counted: (prefix: 'ar' | 'ph', rows: number) => void,
  ) {}

  static async load(storage: WorldStorage, counted: (prefix: 'ar' | 'ph', rows: number) => void): Promise<StorageRegistrations> {
    const rows = new Map([...(await storage.list<StoredRegistration>({ prefix: 'ar:' }))].map(([k, r]) => [k.slice(3), r] as const));
    const replaced = new Map([...(await storage.list<AdjudicatorPolicy>({ prefix: 'ph:' }))].map(([k, p]) => [k.slice(3), p] as const));
    const next = [...rows.values()].reduce((n, r) => Math.max(n, (r.seq ?? -1) + 1), 0);
    return new StorageRegistrations(storage, rows, replaced, next, counted);
  }

  count(): number {
    return this.rows.size;
  }

  /** Rows `ph:` held: policies a later registration replaced. */
  policiesKept(): number {
    return this.replaced.size;
  }

  async get(address: Address): Promise<StoredRegistration | undefined> {
    const r = this.rows.get(lc(address));
    return r && structuredClone(r);
  }

  async put(r: StoredRegistration): Promise<void> {
    const key = lc(r.record.address);
    const was = this.rows.get(key);
    const seq = was?.seq ?? this.next;
    const row: StoredRegistration = { ...structuredClone(r), seq };
    // The policy this one replaces, kept in the same write, before the row that replaces it.
    const keep = was && was.record.policyHash !== r.record.policyHash && !this.replaced.has(was.record.policyHash) ? was.record : undefined;
    await this.storage.put({ ...(keep ? { [`ph:${keep.policyHash}`]: keep.policy } : {}), [`ar:${key}`]: row });
    if (keep) {
      this.replaced.set(keep.policyHash, structuredClone(keep.policy));
      this.counted('ph', this.replaced.size);
    }
    if (!was) this.next = seq + 1;
    this.rows.set(key, row);
    this.counted('ar', this.rows.size);
  }

  async list(): Promise<StoredRegistration[]> {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }

  async policy(hash: Hex32): Promise<AdjudicatorPolicy | undefined> {
    const p = this.replaced.get(hash) ?? [...this.rows.values()].find((r) => r.record.policyHash === hash)?.record.policy;
    return p && structuredClone(p);
  }
}

/**
 * The operators' daily budget for the timeouts they send on their own (T-231): one row `ot:<YYYY-MM-DD>` a UTC day,
 * written before each send, so a restart in the middle of one still counts it. Offer expiries have their own cap
 * inside it. One Durable Object serves the world, so the day's count is held in memory and read once a day.
 */
export class TimeoutBudgetRows implements TimeoutBudget {
  private today: { day: string; sent: number; offers: number } | null = null;

  constructor(
    private readonly storage: WorldStorage,
    private readonly now: () => number,
    private readonly limits: { perDay: number; offersPerDay: number } = { perDay: TIMEOUTS_PER_DAY, offersPerDay: OFFER_EXPIRIES_PER_DAY },
  ) {}

  async take(kind: TimeoutKind): Promise<true | { opensAt: number; offersOnly: boolean }> {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (this.today?.day !== day) {
      const row = await this.storage.get<{ sent: number; offers: number }>(`ot:${day}`);
      this.today = { day, sent: row?.sent ?? 0, offers: row?.offers ?? 0 };
    }
    const opensAt = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
    if (this.today.sent >= this.limits.perDay) return { opensAt, offersOnly: false };
    const offer = kind === 'expire_offer';
    if (offer && this.today.offers >= this.limits.offersPerDay) return { opensAt, offersOnly: true };
    const next = { sent: this.today.sent + 1, offers: this.today.offers + (offer ? 1 : 0) };
    await this.storage.put({ [`ot:${day}`]: next });
    this.today = { day, ...next };
    return true;
  }

  /** Gives back a send that never went out (refused before its broadcast, or run by someone else first). */
  async give(kind: TimeoutKind): Promise<void> {
    const t = this.today;
    if (!t || t.day !== new Date(this.now()).toISOString().slice(0, 10) || t.sent === 0) return;
    const next = { sent: t.sent - 1, offers: Math.max(0, t.offers - (kind === 'expire_offer' ? 1 : 0)) };
    await this.storage.put({ [`ot:${t.day}`]: next });
    this.today = { day: t.day, ...next };
  }
}

/** A fallback or appeal turn one of this world's adjudicators declined on the deal's terms (T-221). */
interface DeclinedTurn {
  role: 'fallback' | 'appeal';
  detail: string;
}

/** Refusals that come from the terms themselves, so every later pass refuses the same way. */
const DECLINED_ON_TERMS = new Set(['invalid_terms', 'registry_mismatch', 'policy_mismatch']);

/** The turn `address` has on this deal now: the fallback's before fallbackBy, the appeal adjudicator's while an appeal or escalation is open. */
function pendingTurnOf(s: EscrowState, address: string): DeclinedTurn['role'] | null {
  const { fallbackAdjudicator, appealAdjudicator } = s.terms.adjudication;
  if ((s.kind === 'Delivered' || s.kind === 'FallbackJudging') && lc(fallbackAdjudicator) === lc(address)) return 'fallback';
  const appealing = s.kind === 'Escalated' || ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open');
  return appealing && lc(appealAdjudicator) === lc(address) ? 'appeal' : null;
}

/** What the state read says while a declined turn is still the deal's next step, and what happens instead (T-221 review). */
function declinedTurnNotice(s: EscrowState | null, t: DeclinedTurn): string | null {
  if (!s || pendingTurnOf(s, t.role === 'fallback' ? s.terms.adjudication.fallbackAdjudicator : s.terms.adjudication.appealAdjudicator) !== t.role) return null;
  if (t.role === 'fallback') return `The fallback adjudicator declined this deal's fallback turn: ${t.detail}.`;
  if (s.kind === 'Escalated') return `The appeal adjudicator declined this deal's escalation: ${t.detail}. The default outcome applies at ${s.escalation.appealDecideBy} unless the parties settle by mutual agreement first.`;
  const appealDecideBy = (s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open' ? s.via.appeal.appealDecideBy : undefined;
  return `The appeal adjudicator declined this deal's appeal: ${t.detail}. The appeal expires at ${appealDecideBy}, and the first decision stands.`;
}

/**
 * T-372: why one of this world's adjudicators cannot act on a deal yet, for a reason off the terms (its store did not
 * return the bytes, or did not answer in time). Kept while each pass refuses the same way, and only for the state it met.
 */
interface WaitingTurn {
  role: AdjudicatorRole;
  /** The adjudicator that refused, lowercase. */
  by: string;
  detail: string;
  kind: EscrowState['kind'];
}

/** The longest refusal detail the state read and the log carry, in characters: room for the deadline and what follows it. */
const WAITING_DETAIL_MAX = 600;

/**
 * A refusal's detail as the state read and the log may carry it: the URI the seller signed for its ciphertext is the
 * seller's own text, so it is named, not quoted (T-372 red team M2); the hash beside it says which bytes.
 */
function waitingDetail(s: EscrowState, detail: string): string {
  const uri = 'delivery' in s ? s.delivery.ciphertext.uri.slice(0, 200) : '';
  return (uri ? detail.split(uri).join('(the URI the seller signed)') : detail).slice(0, WAITING_DETAIL_MAX);
}

/** The role `address` refused in: the primary's while it accepts or judges, else its fallback or appeal turn. */
function waitingRoleOf(s: EscrowState, address: string): AdjudicatorRole | null {
  if ((s.kind === 'Offered' || s.kind === 'Delivered') && lc(s.terms.adjudication.adjudicator) === lc(address)) return 'primary';
  return pendingTurnOf(s, address);
}

/** What the state read says while the refusal still holds: the deal is still in the state the refusal met. */
function waitingNotice(s: EscrowState | null, w: WaitingTurn): string | null {
  if (!s || s.kind !== w.kind) return null;
  const what = s.kind === 'Offered' ? 'accept this offer' : 'judge this deal';
  return `The ${w.role} adjudicator cannot ${what} yet: ${w.detail}. It tries again on each pass.`;
}

/**
 * When this world's adjudicators act on a commitment: `now` for a step they can take now, judgeBy for a fallback
 * takeover, nothing while it is a party's turn; null once no adjudicator can act on it again, so `look` drops it. The
 * primary accepts an offer before offerExpiresAt and decides a delivery before judgeBy; the fallback takes over at
 * judgeBy and decides before fallbackBy; the appeal adjudicator decides an escalation or an open appeal before
 * appealDecideBy (SimChain only: a chain takes no party appeal, ADR-0031 §8). On a chain the operators send every other
 * timeout themselves once it is due (offer expiry, reclaim, default; OperatorTimeouts, T-231), and any party may trigger
 * one sooner. A decided deal on a chain is final at once, whether core writes its appeal as `none` with appealBy at the
 * decision or as `expired`: either way no adjudicator acts on it again.
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
  private failed = false;
  private lastActive = -Infinity;
  /** Adjudicator passes in a row that changed nothing. */
  private idlePasses = 0;
  /** T-372: each adjudicator's lists that did not answer in its last pass, as `address|step`, so each is logged once. */
  private readonly listsDown = new Set<string>();
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
    readonly adjudicators: Record<AdjudicatorRole, TestAdjudicator>,
    private readonly panel: PanelConfig,
    /** Offers an adjudicator declined, with its reason, for the state read's notices. In memory: every pass declines again. */
    private readonly declined: Map<Hex32, string>,
    /** Fallback and appeal turns this world's adjudicators declined on the deal's terms, with the reason, for the same notices; in memory too. */
    private readonly turnsDeclined: Map<Hex32, DeclinedTurn>,
    /** T-372: deals this world's adjudicators cannot act on yet for a reason off the terms, for the same notices; in memory too. */
    private readonly waiting: Map<Hex32, WaitingTurn>,
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
    // The operator's check lines and problems then read "4.71 tUSDC", not base units of an address.
    if (o.live) nameToken(token, symbol);
    const chainId = o.live ? o.live.chain.chainId : SIM_CHAIN_ID;
    // Addresses are served lowercase, as llms.txt pins them; the EIP-712 hash is the same either way.
    const rules = o.live ? (lc(o.live.chain.deployment.rules) as Address) : undefined;
    const domain: HoldbackDomain = rules ? holdbackDomain(chainId, rules) : holdbackDomain(SIM_CHAIN_ID);
    // T-220, D49: a chain world's rulebook names the randomness its rules contract verifies, drand quicknet on Sepolia.
    // The club is rebuilt from code on every open, so the rulebook changes in place: each stored deal keeps the club it
    // was offered under (Book.club), and only a new offer binds the new hash. SimChain keeps the sim beacon (T-217).
    const drand = o.live && (o.live.beacon ?? (o.live.chain.chainId === SIM_CHAIN_ID ? 'sim' : 'drand-quicknet')) === 'drand-quicknet';
    const rulebook = rebindToken({ ...SIM_RULEBOOK, minWindowsSec: { judge: m, fallback: m, appealWindow: 0, appealDecide: m }, ...(drand ? { randomness: { source: 'drand-quicknet' as const, chainHash: DRAND_QUICKNET_CHAIN_HASH } } : {}) }, TOKEN, token);
    // One source for the three: a proven round is kept, so the fallback and appeal adjudicators never ask for it twice.
    // In a Worker it uses the global fetch, one relay request per decision when the first relay answers (T-217).
    const rounds = drand ? (o.live!.drand ?? drandQuicknet({ now: () => wholeSecond(now()) })) : undefined;
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
      // No chain call here: opening runs inside blockConcurrencyWhile (30 s), so the first pass reads the logs since
      // the stored cursor; it comes within a pass's wait when a deal is open (`nextPass`). The lanes' rows
      // are read here (one list), and the first pass lands them (T-219).
      await o.live.chain.attach(new StorageLanes(storage));
      const evm = await EvmSettlement.restore(o.live.chain, genesis, { books, events: events.all(), mandates: mandates.all() }, now);
      chain = evm;
      const cursor = (await storage.get<Cursor>('cursor')) ?? null;
      // T-231: the operators' own timeouts, labelled as node 1's relay. The key derives from the world's secret, so no
      // client can use it first with another body and turn the operators' send into an idempotency conflict.
      const timeouts = new OperatorTimeouts(evm, {
        via: 'demo-op-1',
        key: (id, kind) => `operator-timeout:${canonicalKeccak({ operatorTimeout: kind, commitmentId: id, secret })}`,
        budget: new TimeoutBudgetRows(storage, now),
        sent: (kind) => telemetry.timeout(kind),
        ...(o.onError ? { onError: o.onError } : {}),
      });
      live = { settlement: o.live, evm, events, mandates, meta, toppedUp: 0, verified: false, sync: new ChainSync(evm, cursor), cursor, timeouts };
    } else {
      const journal = [...(await storage.list<JournalEntry>({ prefix: 'j:' })).values()];
      chain = await SimChain.replay(genesis, journal);
      journalLength = journal.length;
    }
    const ledger = ledgerOf(chain, o.live?.chain);

    const store = new StorageCiphertextStore(storage);
    const records = new Map<Hex32, Judgment>(Array.from(await storage.list<Judgment>({ prefix: 'jr:' }), ([k, v]) => [k.slice(3) as Hex32, v]));
    // ADR-0030 (T-221): every adjudicator's registration, the demo's three included, in rows `ar:<address>`, and every
    // policy a later registration replaced, in rows `ph:<policyHash>`.
    const registrations = await StorageRegistrations.load(storage, (prefix, rows) => telemetry.rows(prefix, rows));
    replayed();
    // Live or scripted judges, fixed for this instance: the registry it binds depends on which.
    const panel = panelConfig({ env: o.env, storage, now, ...(o.judgeProvider ? { judgeProvider: o.judgeProvider } : {}), ...(o.liveCallsPerDay !== undefined ? { liveCallsPerDay: o.liveCallsPerDay } : {}) });
    const faucetAmount = o.faucetAmount ?? 1_000n * TUSD;
    const faucetMaxAmount = o.faucetMaxAmount ?? DEMO_FAUCET_MAX_GRANT;
    if (faucetAmount > faucetMaxAmount) throw new Error(`faucetAmount ${faucetAmount} is above faucetMaxAmount ${faucetMaxAmount}`);
    const faucetWindowSec = o.faucetWindowSec ?? 3600;
    const faucetPerClient = o.faucetPerClient ?? 10;
    const tokenAmount = (v: bigint): TokenAmount => ({ token, amount: v.toString() }) as TokenAmount;
    const bondOf = (p: { junior: bigint; senior: bigint; reserved: bigint }): Bond => ({ junior: tokenAmount(p.junior), senior: tokenAmount(p.senior), reserved: tokenAmount(p.reserved) });
    // Any address's bond, read live (ADR-0030 §3 and §5) from SimChain's ledger. A chain holds no bond (ADR-0031 §8):
    // EvmSettlement's pool is empty for every address, and the operator shows `observed.bond: "none"` there.
    const pool = async (address: Address): Promise<Bond> => bondOf(chain.pool(address));
    /**
     * A stored registration as the adjudicators read it: for its policy and its key, never its bond (the service reads
     * its own cover through `bondCover`), so `pool` holds the settlement view's cached balances and no chain call is made.
     */
    const registration = async (address: Address): Promise<AdjudicatorRegistration | null> => {
      const r = await registrations.get(address);
      return r ? ({ ...r.record, pool: { ...bondOf(chain.pool(address)), terms: r.record.pool.terms } } as AdjudicatorRegistration) : null;
    };
    const registry: Registry = {
      chainId,
      ...(rules ? { verifyingContract: rules } : {}),
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
      registrations,
      pool,
      // ADR-0030 §4: the roles an offer leaves out are filled with the demo's three, which discovery names as defaults,
      // but only with one that would take its role on the terms (T-221 review); one the parties name gets a notice.
      defaultAdjudicators: Object.fromEntries(adjKeys.map((a) => [a.role, lc(a.keys.address)])) as Record<AdjudicatorRole, Address>,
      declines: declinesOf(() => Object.values(adjudicators)),
      judgment: (id) => records.get(id) ?? null,
      // POST /v1/faucet: the amount the request names, up to the cap (the default grant when it names none), and a
      // mandate in the demo club.
      faucet: grantFrom({ storage, ledger, club, principal, domain, token, symbol, amount: faucetAmount, maxAmount: faucetMaxAmount, windowSec: faucetWindowSec, perClient: faucetPerClient, now, ...(live ? { live } : {}) }),
    };
    // ADR-0023: one schedule for both nodes (one operator), paid to one world address; from Worker variables. On a
    // chain the minimum also carries the gas these nodes pay for a deal (D33, amended 2026-11-03).
    const gasQuote = o.live ? (o.env['OPERATOR_FEE_GAS'] ?? '0') : undefined;
    const operatorFee = operatorFeeFromEnv(o.env, lc(key('demo-operator-fees').address) as Address, token, gasQuote);
    const feedback = feedbackFrom(o, (id) => telemetry.lookup(id));
    const adjudicators = {} as Record<AdjudicatorRole, TestAdjudicator>;
    const declined = new Map<Hex32, string>();
    const turnsDeclined = new Map<Hex32, DeclinedTurn>();
    const waiting = new Map<Hex32, WaitingTurn>();
    const operators: Operator[] = [];
    const publicUrls = String(o.env?.OPERATOR_URLS ?? '').split(',').map((u) => trimTrailingSlashes(u.trim())).filter((u) => /^https:\/\//.test(u));
    // D39: the one discovery document carries what GET / used to list. T-066 adds the facts Crow Control reads by
    // script: the deployed commit, the relayer's lanes, the faucet's daily mints and the judges' tokens by model.
    const demo = async (): Promise<WorldDemoFacts> => {
      const today = await panel.budget.used();
      return {
        clubId: club.id,
        token: { id: token, decimals: 6 },
        adjudicators: ADJUDICATORS.map((a) => ({ role: a.role, address: adjudicators[a.role].address, name: nameOf(a, panel.live) })),
        faucet: {
          path: '/v1/faucet',
          grant: tokenAmount(faucetAmount),
          maxGrant: tokenAmount(faucetMaxAmount),
          perAddressEverySec: faucetWindowSec,
          perClientPerWindow: faucetPerClient,
          ...(o.live ? { mintsPerDay: FAUCET_MINTS_PER_DAY } : {}),
        },
        operators: publicUrls.length ? publicUrls : operators.map((op) => op.baseUrl).filter(Boolean),
        minWindowSec: m,
        // Who judges rubric deals: the registry every adjudicator here binds, and today's live budget (UTC).
        judges: {
          panel: panel.live ? 'live' : 'scripted',
          registry: { uri: panel.registryUri, hash: panel.registry.hash },
          models: panel.registry.active.map((e) => e.model),
          ...(panel.live
            ? { liveCallsPerDay: panel.budget.perDay, liveCallsToday: today.calls, tokensToday: { input: today.inputTokens, output: today.outputTokens, byModel: today.byModel ?? {} }, day: today.day }
            : { missing: panel.missing }),
        },
        build: { commit: buildCommit(o.env) },
        ...(o.live ? { relayer: relayerFacts(o.live.chain) } : {}),
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
        // T-372: only while the offer is still Offered; a decline the primary reverses is cleared by the pass that accepts.
        const state = chain.escrowState(about.commitmentId);
        if (why && (!state || state.kind === 'Offered')) return [`The primary adjudicator declined this offer: ${why}. It stays Offered until offerExpiresAt, and nobody can fund it.`];
        // T-211 and T-221: a demo fallback or appeal adjudicator declined its turn on this deal's terms (an appeal
        // adjudicator it does not trust, another registry, a bound policy or a panel it cannot run).
        const turn = turnsDeclined.get(about.commitmentId);
        const said = turn ? declinedTurnNotice(chain.escrowState(about.commitmentId), turn) : null;
        if (said) return [said];
        // T-372: an adjudicator that cannot act yet for a reason off the terms (a store that did not return the bytes).
        const wait = waiting.get(about.commitmentId);
        const waits = wait ? waitingNotice(state, wait) : null;
        if (waits) return [waits];
        // T-218: a deal the chain moved past this node's book (a direct delivery not yet posted, a forwarded call).
        const behind = live?.evm.lag(about.commitmentId);
        if (behind) return [behind];
        return [];
      }
      return [];
    };
    const chainFacts = o.live ? { chainId, rules: o.live.chain.deployment.rules, token, symbol, funding: o.live.chain.funding, explorer: o.live.explorer ?? SEPOLIA_EXPLORER, gas: gasQuote } : undefined;
    const evm = chain instanceof EvmSettlement ? chain : undefined;
    // ADR-0033 §7: a money address equal to one of these gets a notice at prepare. The escrow's token store is a clone the
    // escrow derives per operator, not in the deployment record, so it is not listed.
    const d = o.live?.chain.deployment;
    const contracts = d
      ? [
          { name: 'rules contract', address: lc(d.rules) as Address },
          { name: 'escrow', address: lc(d.escrow) as Address },
          { name: 'ERC-3009 collector', address: lc(d.erc3009Collector) as Address },
          { name: 'token', address: lc(d.token) as Address },
          { name: 'beacon', address: lc(d.beacon) as Address },
          { name: 'multicall3', address: lc(d.multicall) as Address },
        ]
      : undefined;
    for (const i of [0, 1]) {
      operators.push(
        new Operator({
          settlement: chain,
          registry,
          store,
          maxCiphertextBytes: DEMO_MAX_CIPHERTEXT_BYTES,
          ...(operatorFee ? { fee: operatorFee } : {}),
          ...(evm ? { erc3009: { funding: (t) => evm.fundingTypedData(t), operatorFee: (x) => evm.operatorFeeTypedData(x) } } : {}),
          ...(contracts ? { contracts } : {}),
          signerKey: key(`demo-operator-${i + 1}`).privateKey,
          operatorId: `demo-op-${i + 1}`,
          env: o.env,
          rateLimit: o.rateLimit ?? { writes: 120, reads: 1200, windowMs: 60_000 },
          notes: notesFor(club.id, m, { amount: faucetAmount, maxAmount: faucetMaxAmount, windowSec: faucetWindowSec }, panel, operatorFee, chainFacts),
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
        // The store, so a primary registered through the API is read for its policy, and its appeal adjudicator for its key.
        registration,
        // The policy the terms bound, by its hash, after the primary registered another (T-221 review).
        policy: async (hash) => (await registrations.policy(hash)) ?? null,
        // Rounds for a deal whose rulebook names drand quicknet (T-217); a deal offered under the sim rulebook keeps it.
        ...(rounds ? { drand: rounds } : {}),
        domain,
        fee,
        // The demo's three adjudicators trust each other as fallback and appeal adjudicators, and nobody else (T-212):
        // an appeal adjudicator a party controls could overturn an honest decision and take the price from the bond. As
        // fallback they also decline a turn under any other appeal adjudicator (T-221, ADR-0030 §6).
        trustedAdjudicators: adjKeys.map((k) => k.keys.address),
      });
      await registerOwn(registrations, domain, a.keys.privateKey, { ...adj.registration(), pool: { terms: { ...POOL_TERMS } }, poolTermsHash: canonicalKeccak(POOL_TERMS), status: 'active' }, { label: a.label, start: meta.start, now: wholeSecond(now()) });
      adjudicators[a.role] = adj;
    }
    telemetry.rows('ar', registrations.count());
    if (registrations.policiesKept() > 0) telemetry.rows('ph', registrations.policiesKept());
    const keys = [principal, key('demo-club-operator'), ...adjKeys.map((a) => a.keys), key('demo-operator-1'), key('demo-operator-2')];
    const world = new PublicWorld(o, telemetry, secret, chain, keys, operators, adjudicators, panel, declined, turnsDeclined, waiting, journalLength, publicUrls, live);
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
   * True once storage rejected a write (T-313). Memory then holds changes storage does not, and a chain world has
   * handed over rows it cannot write again: a later write would leave a gap in the stored event log, which no restart
   * can open (measured on anvil). So every later request and pass fails, and only a world opened anew from storage is
   * safe to serve; the Durable Object drops a broken world for that (worker.ts).
   */
  get broken(): boolean {
    return this.failed;
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
   * fallback takeover's judgeBy, whether active or not: one alarm per takeover. On a chain, also at the next timeout
   * the operators send on their own (T-231).
   */
  nextPass(): number | null {
    const wait = Math.min((this.live ? CHAIN_PASS_MS : PASS_MS) * 2 ** this.idlePasses, SLOWEST_PASS_MS);
    // A takeover whose judgeBy passed since the last look gets a pass after the current wait: an alarm set in the past
    // would fire at once, again and again while nothing rereads the state (T-057 review 4).
    const wake = this.wake === null ? null : this.wake > this.now() ? this.wake : this.now() + wait;
    // T-218: while a deal is open and recent, a pass reads the chain within a minute, so a direct call shows within one
    // pass; an open deal quiet for a day is read every 15 minutes.
    const open = this.live?.evm.openDeals();
    const sync = !open ? null : open.recent > 0 ? this.now() + wait : open.idle > 0 ? this.now() + Math.max(wait, IDLE_SYNC_MS) : null;
    // T-231: at the next timeout the operators send, or after the current wait when one is due now (as for a takeover).
    const due = this.live?.timeouts.nextAt() ?? null;
    const timeout = due === null ? null : due > this.now() ? due : this.now() + wait;
    const at = Math.min(this.active() ? this.now() + wait : Infinity, wake ?? Infinity, sync ?? Infinity, timeout ?? Infinity);
    return at === Infinity ? null : at;
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
   * new events and mandates into their pages. Serialized, so entries land once and in order. After a rejected write
   * every later call rejects with the same error and writes nothing: the world is `broken`.
   */
  private persist(): Promise<void> {
    const attempt = this.persisting.then(async () => {
      if (this.live) {
        const { books, events, mandates, relayed } = this.live.evm.drain();
        for (let i = 0; i < books.length; i += 100) await this.telemetry.storage.put(Object.fromEntries(books.slice(i, i + 100).map(([id, b]) => [`b:${id}`, b])));
        await this.live.events.append(events);
        await this.live.mandates.append(mandates);
        // Last: a lane's row goes only once the books and events its receipt changed are written (T-219).
        await this.live.settlement.chain.release(relayed);
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
    this.persisting = attempt.catch((e: unknown) => {
      if (!this.failed) {
        this.failed = true;
        this.o.onError?.(new Error(`a storage write failed, so this world answers nothing more until it is reopened from storage: ${(e as Error).message}`));
      }
      throw e;
    });
    return this.persisting;
  }

  /**
   * A chain world's setup (ADR-0028 §7): the RPC and the contract checked once, then the deal lanes' gas once a minute.
   * Every step reads the chain first, so a repeat sends nothing. No bond: the phase-one contracts hold none (ADR-0031 §8).
   */
  private async setup(): Promise<void> {
    const l = this.live!;
    const chain = l.settlement.chain;
    if (!l.verified) {
      // Before anything is sent: the RPC serves the deployment's chain, and the contract is the one in the file.
      await chain.verify();
      l.verified = true;
    }
    // Once a minute (and first): the deal lanes' gas. A top-up that fails is tried again on the next pass.
    if (this.now() - l.toppedUp > 60_000) {
      await chain.topUpLanes(LANE_FLOOR, LANE_TOP_UP);
      l.toppedUp = this.now();
    }
  }

  /**
   * Reads the rules contract's logs since the cursor and applies what this node did not relay (T-218). The books and
   * events are written first, then the cursor. An RPC failure applies nothing and leaves the cursor where it was. A
   * storage write that fails after `drain` is not retried (backlog, "drain before the writes succeed").
   */
  private async syncChain(): Promise<void> {
    const l = this.live!;
    try {
      const r = await l.sync.read();
      if (!r) return;
      await this.persist();
      if (r.report.logs > 0 || !l.cursor || BigInt(r.cursor.block) - BigInt(l.cursor.block) >= CURSOR_EVERY_BLOCKS) {
        await this.telemetry.storage.put({ cursor: r.cursor });
        l.cursor = r.cursor;
      }
      l.sync.commit(r.cursor);
      l.lastSync = r.report;
    } catch (e) {
      this.o.onError?.(e as Error);
    }
  }

  /**
   * Lands the relayer rows a restart left open (T-219), then writes what they changed and deletes them. A row an RPC
   * error leaves open waits for the next pass, and its lane sends nothing else meanwhile.
   */
  private async recoverLanes(): Promise<void> {
    const l = this.live!;
    if (l.settlement.chain.inFlight().length === 0) return;
    const r = await l.evm.recover();
    l.lastRecovery = r;
    for (const e of r.errors) this.o.onError?.(new Error(`an in-flight relayer row could not be resolved: ${e}`));
    await this.persist();
  }

  /** What the last chain read found (T-218), for the tests and the counters; null before the first. */
  lastSync(): SyncReport | null {
    return this.live?.lastSync ?? null;
  }

  /** What the last pass did with the relayer rows a restart left open (T-219); null when none were open. */
  lastRecovery(): RecoverReport | null {
    return this.live?.lastRecovery ?? null;
  }

  /** True once a chain world's setup is done (the chain verified, the deal lanes' gas in place); a SimChain world always is. */
  ready(): boolean {
    return !this.live || (this.live.verified && this.live.toppedUp > 0);
  }

  /** One adjudicator pass (the Durable Object alarm): accept or decline offers, trigger fallbacks, decide; on a chain, then send due timeouts. */
  async work(): Promise<void> {
    // A broken world takes no new work: the stored write failure, before an adjudicator acts or a transaction goes out.
    if (this.failed) await this.persisting;
    this.telemetry.invoked();
    this.tick();
    if (this.live) {
      const setupLeft = !this.ready();
      try {
        await this.setup();
        // Every setup step that does not throw takes the setup forward (verify, gas).
        if (setupLeft) this.idlePasses = 0;
      } catch (e) {
        // A failing step (an RPC down) backs off like a pass that changes nothing (T-057 review).
        if (setupLeft) this.idlePasses++;
        this.o.onError?.(e as Error);
      }
      // Before the sync and the adjudicators: what this node broadcast before a restart lands as its relay (T-219).
      if (this.live.verified) await this.recoverLanes();
      // Before the adjudicators, so they act on what was sent straight to the contract too (T-218).
      if (this.live.verified) await this.syncChain();
      // The adjudicators wait for a verified chain. The look still runs, so a takeover whose judgeBy passed meanwhile is
      // due, not a stale wake (T-057 review 4).
      if (!this.ready()) {
        if (this.live.verified) await this.closeDue();
        await this.persist();
        await this.look();
        return;
      }
    }
    const { panel } = this;
    for (const [role, a] of Object.entries(this.adjudicators) as [AdjudicatorRole, TestAdjudicator][]) {
      try {
        // Live only when today's budget still holds a whole panel of this adjudicator's size, so a panel is
        // live or scripted as a whole (a pass deciding several cases can still cross the line).
        if (panel.live) {
          const policy = a.registration().policy;
          panel.allowLive = (await panel.budget.remaining()) >= (role === 'appeal' ? policy.appealPanelSize : policy.panelSize);
        }
        const r = await a.runOnce();
        for (const d of r.declined) this.declined.set(d.commitmentId, d.reason);
        // T-372: a decline the primary reverses leaves the state read.
        for (const id of r.accepted) this.declined.delete(id);
        this.noteWaiting(a.address, r);
        // A fallback or appeal turn declined on the deal's own terms stays declined; the state read says why (T-221).
        for (const x of r.refused) {
          const s = DECLINED_ON_TERMS.has(x.problem.type) ? this.chain.escrowState(x.commitmentId) : null;
          const role = s ? pendingTurnOf(s, a.address) : null;
          if (role) this.turnsDeclined.set(x.commitmentId, { role, detail: x.problem.detail });
        }
      } catch (e) {
        this.o.onError?.(e as Error);
      } finally {
        panel.allowLive = false;
      }
    }
    await panel.budget.flush();
    // After the adjudicators, so their own steps go first: the demo fallback's takeover.
    const closed = this.live ? await this.closeDue() : false;
    await this.persist();
    // A timeout for a deal behind the chain logs no event, so it counts as settlement moving too.
    if ((await this.look()) || closed) this.stir();
    else this.idlePasses++;
    await this.flushTelemetry(false);
  }

  /**
   * Sends the deals' due timeouts at the relayer's gas (T-231), checked at a block no earlier than the chain sync's last.
   * True when it sent one. A failure is reported and the pass goes on; the next pass tries again after its back-off.
   */
  /**
   * T-372: keeps, for the state read and the log, why `address` could not act on a deal in this pass for a reason off
   * the terms (`adjudicator_unavailable`), and drops what it no longer refuses. The detail is the adjudicator's own
   * text, which names no store error (T-347 red team L5), cut to WAITING_DETAIL_MAX characters. Each new or changed
   * reason is logged once, not on every pass.
   */
  private noteWaiting(address: string, r: RunReport): void {
    const by = lc(address);
    const now = new Map(r.refused.filter((x) => x.problem.type === 'adjudicator_unavailable').map((x) => [x.commitmentId, x.problem.detail]));
    // A list that did not answer leaves what this adjudicator said before standing: it did not look again (red team L6).
    if (r.unavailable.length === 0) for (const [id, w] of this.waiting) if (w.by === by && !now.has(id)) this.waiting.delete(id);
    for (const [id, raw] of now) {
      const s = this.chain.escrowState(id);
      const role = s ? waitingRoleOf(s, by) : null;
      if (!s || !role) continue;
      // A refusal now supersedes an earlier decline of the same offer: the state read says the primary is retrying.
      this.declined.delete(id);
      const detail = waitingDetail(s, raw);
      const before = this.waiting.get(id);
      if (!before || before.detail !== detail || before.by !== by) this.o.onError?.(new Error(`the ${role} adjudicator cannot act on ${id} yet: ${detail}`));
      this.waiting.set(id, { role, by, detail, kind: s.kind });
    }
    // Each list that did not answer is logged once until it answers again.
    const lists = new Set(r.unavailable.map((u) => `${by}|${u.step}`));
    for (const u of r.unavailable) if (!this.listsDown.has(`${by}|${u.step}`)) this.o.onError?.(new Error(`adjudicator ${by}: ${u.problem.detail.slice(0, WAITING_DETAIL_MAX)}`));
    for (const k of this.listsDown) if (k.startsWith(`${by}|`) && !lists.has(k)) this.listsDown.delete(k);
    for (const k of lists) this.listsDown.add(k);
  }

  private async closeDue(): Promise<boolean> {
    const l = this.live!;
    try {
      const r = await l.timeouts.run(l.sync.cursor ? BigInt(l.sync.cursor.block) : undefined);
      l.lastTimeouts = r;
      return r.sent.length > 0;
    } catch (e) {
      this.o.onError?.(e as Error);
      return false;
    }
  }

  /** What the last pass did with the timeouts the operators send on their own (T-231); null before the first. */
  lastTimeouts(): TimeoutReport | null {
    return this.live?.lastTimeouts ?? null;
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
    // A broken world takes no new work: the stored write failure, before a handler runs or relays.
    if (this.failed) await this.persisting;
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

/**
 * Registers a demo adjudicator through the route's own checks (ADR-0030 §3), signed by its own key, so every registration
 * the world serves is signed. The first open signs it as of the world's start. A later open signs the same message again
 * (the same issuedAt and nonce), which the store answers as unchanged and writes no row for. A changed record (a build
 * with other template hashes, live judges turned on or off) or one within 30 days of its expiry gets a later issuedAt.
 */
async function registerOwn(
  store: RegistrationStore,
  domain: HoldbackDomain,
  key: `0x${string}`,
  body: Omit<RegisteredAdjudicator, 'registration'>,
  o: { label: string; start: Timestamp; now: Timestamp },
): Promise<void> {
  const served = (await store.get(body.address))?.record.registration;
  const lasts = (issuedAt: Timestamp) => Date.parse(issuedAt) + REGISTRATION_TTL_MS - Date.parse(o.now) > REGISTRATION_RENEW_MS;
  const issuedAt: Timestamp =
    served && served.bodyHash === registrationBodyHash(body) && lasts(served.issuedAt)
      ? served.issuedAt
      : !served && lasts(o.start)
        ? o.start
        : wholeSecond(Math.max(Date.parse(o.now), served ? Date.parse(served.issuedAt) + 1000 : 0));
  const envelope = { keyId: `${o.label}/${o.start}`, issuedAt, nonce: canonicalKeccak({ registration: o.label, start: o.start, issuedAt }), expiresAt: wholeSecond(Date.parse(issuedAt) + REGISTRATION_TTL_MS) };
  try {
    await register(store, await signRegistration(key, domain, body, envelope), { domain, now: o.now });
  } catch (e) {
    throw new Error(`${body.name}'s registration was refused: ${(e as Error).message}`);
  }
}

/** What a chain world keeps beside its settlement: storage pages, the setup's progress, its keys. */
interface LiveWorld {
  settlement: LiveSettlement;
  evm: EvmSettlement;
  events: PagedLog<SettlementEvent>;
  mandates: PagedLog<Mandate>;
  meta: Meta;
  /** Whether this instance checked the RPC's chain and the rules contract against the deployment file. */
  verified: boolean;
  /** When the lanes' gas was last checked (ms). */
  toppedUp: number;
  /** The reader of the rules contract's logs (T-218), and the cursor as last written to storage. */
  sync: ChainSync;
  cursor: Cursor | null;
  lastSync?: SyncReport;
  lastRecovery?: RecoverReport;
  /** The timeouts the operators send on their own (T-231), and what the last pass did with them. */
  timeouts: OperatorTimeouts;
  lastTimeouts?: TimeoutReport;
}

/** What the faucet needs from the settlement layer: mandates, and a grant of test tokens in process or on chain. */
interface FaucetLedger {
  admit(m: Mandate): Promise<Problem | null>;
  grant(address: Address, amount: bigint): Promise<{ tx?: string }>;
  balances(addresses: readonly Address[]): Promise<Record<Address, TokenAmount>>;
}

function ledgerOf(chain: SimChain | EvmSettlement, live: LiveChain | undefined): FaucetLedger {
  return {
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
 * The demo faucet's grant: test tokens and a fresh 30-day mandate in the demo club, signed by the club's own test
 * principal, once per address per window (persisted) and a few addresses per client per window (in memory). The
 * amount is the one the request names, up to `maxAmount` (T-314), or `amount` when it names none.
 * On a chain (ADR-0028 §6) the grant is a mint the funding lane sends, answered after its receipt, skipped when the
 * address already holds the amount asked, and capped per day. One Durable Object serves the world, so the grants in
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
  /** The grant when the request names no amount. */
  amount: bigint;
  /** The largest amount one grant gives. */
  maxAmount: bigint;
  windowSec: number;
  perClient: number;
  now: () => number;
  live?: LiveWorld;
}): NonNullable<Registry['faucet']> {
  const perClient = new Map<string, { start: number; count: number }>();
  const granting = new Set<string>();
  let today = { day: '', minted: 0 };
  // ADR-0033 §5: the tokens go to the payment address when the request names one, the mandate always to `address`, the
  // signing address. The per-address window counts the signing address, so one standing payment address can fund many
  // per-deal keys; the per-client window and the day's mints still bound what one caller takes.
  return async (address, { client, amount = w.amount, paymentAddress = address }): Promise<FaucetOutcome> => {
    // Refused before any limit is counted: a corrected call keeps its turn.
    if (amount > w.maxAmount) return { ok: false, problem: problem('invalid_terms', `amount ${amount} is above this faucet's cap of ${w.maxAmount} base units a grant (${tokenText(w.maxAmount.toString(), w.symbol)}; demo.faucet.maxGrant in discovery)`), field: 'amount' };
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
      return await grant(address, paymentAddress, amount, now, windowMs, retryAfterSec);
    } finally {
      granting.delete(address);
    }
  };

  async function grant(address: Address, payTo: Address, amount: bigint, now: number, windowMs: number, retryAfterSec: (at: number) => number): Promise<FaucetOutcome> {
    // Every grant signs a fresh 30-day mandate, which replaces the address's earlier one: an expired mandate is
    // refused at offer and agree (mandate_expired), and an agent may ask before its own deal outlasts the old one.
    const scope = rebindToken(wideScope(['buyer', 'seller'], wholeSecond(now + 30 * 86_400_000)), TOKEN, w.token);
    const mandate = await mandateFor({ name: `${w.principal.label}`, key: w.principal.privateKey, address: w.principal.address }, address, w.club.id, scope, wholeSecond(now), w.domain);
    const p = await w.ledger.admit(mandate);
    if (p) return { ok: false, problem: p };
    let tx: string | undefined;
    const held = BigInt((await w.ledger.balances([payTo]))[payTo]?.amount ?? '0');
    if (!w.live || held < amount) {
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
        tx = (await w.ledger.grant(payTo, amount)).tx;
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
        granted: { token: w.token, amount: tx || !w.live ? amount.toString() : '0' } as TokenAmount,
        balance: (await w.ledger.balances([payTo]))[payTo]!,
        mandate: { ...mandate, mandateHash: canonicalKeccak(mandate) as Hex32 },
        nextGrantAfter: wholeSecond(now + windowMs),
        notice: w.live
          ? `TEST TOKENS ONLY: ${w.symbol} on Sepolia is an open-mint test token with no value, not Circle's USDC${tx ? `; minted in ${tx}` : '; this address already held the amount asked, so nothing was minted'}. The mandate is signed by the demo club's own test principal, held by this demo.`
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
 * Discovery's `demo` object as this world serves it: DemoFacts plus the facts Crow Control reads by script (T-066).
 * spec/openapi/paths.json lists them under `Discovery.demo`.
 */
export type WorldDemoFacts = DemoFacts & {
  faucet: DemoFacts['faucet'] & { mintsPerDay?: number };
  /**
   * The commit holdback-op1 was deployed from (BUILD_COMMIT, set by scripts/deploy.mjs), or null when unknown. The
   * World Durable Object runs in holdback-op1, so both nodes show that Worker's commit.
   */
  build: { commit: string | null };
  /** A chain world's relayer: the funding lane and the deal lanes that pay its gas (ADR-0028). */
  relayer?: { fundingLane: string; dealLanes: string[] };
};

/** The deployed commit from the BUILD_COMMIT variable: 40 lowercase hex characters, or null. */
export function buildCommit(env: Readonly<Record<string, string | undefined>>): string | null {
  const c = String(env['BUILD_COMMIT'] ?? '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(c) ? c : null;
}

/** The relayer's public addresses, from the chain's lane accounts: the first is the funding lane, the rest deal lanes. */
export function relayerFacts(chain: { funding: string; lanes: readonly { address: string }[] }): { fundingLane: string; dealLanes: string[] } {
  return { fundingLane: lc(chain.funding), dealLanes: chain.lanes.slice(1).map((a) => lc(a.address)) };
}

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
  if (gas !== undefined && !DECIMAL.test(gas)) throw new Error(`OPERATOR_FEE_GAS must be base units as a decimal string (4.70 tUSDC is "4700000"), got ${JSON.stringify(gas)}`);
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
  faucet: { amount: bigint; maxAmount: bigint; windowSec: number },
  panel?: Pick<PanelConfig, 'live' | 'registry' | 'budget'>,
  fee?: OperatorFeeSchedule,
  /** A chain world's facts (D41): its chain, contracts and token, the relayer's funding lane, the explorer, the gas quote. */
  chain?: { chainId: number; rules: string; token: string; symbol: string; funding: string; explorer: string; gas?: string | undefined },
): string[] {
  const symbol = chain?.symbol ?? TOKEN;
  const amount = (base: string) => tokenText(base, symbol);
  const gas = chain?.gas && chain.gas !== '0' ? chain.gas : undefined;
  // D33 as amended 2026-11-03: the minimum carries the gas these nodes pay for a deal's transactions.
  const gasText = gas && fee ? ` That minimum is ${amount(gas)} for the gas these nodes pay for a deal's transactions on Sepolia (about 1.56 million gas, measured, at Sepolia's 1 gwei median tip, priced at this demo's fixed, fictional rate of 3,000 ${symbol} per test ETH) plus ${amount((BigInt(fee.min) - BigInt(gas)).toString())} for relaying; the quote is fixed per deal, whether the deal needs fewer transactions or more.` : '';
  const feeNote = fee
    ? fee.bps === 0 && fee.min === '0'
      ? `Operator fee: published at 0 (fees.operator in /v1/status): these nodes relay a funded agreement free for now. When it is switched on, POST /v1/prepare/agree-and-fund adds a third signature (slot operatorFee.signature), paid to ${fee.to}, outside the hold and not refunded.`
      : `Operator fee: these nodes charge an operator fee of ${fee.bps} bp of the price, at least ${amount(fee.min)}${fee.max === null ? '' : `, at most ${amount(fee.max)}`}, rounded up, paid by the buyer to ${fee.to} with the funded agreement: POST /v1/prepare/agree-and-fund returns a third signature (slot operatorFee.signature). It is a separate transfer, never part of the hold, and not refunded. A funded agree without it gets 402 payment_required; reads, prepare, the faucet, deliveries and direct submission to the settlement layer are free (ADR-0023).${gasText}${gas ? ' Submitting directly to the contract, you pay your own gas and no fee to these nodes.' : ''}`
    : undefined;
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
    `Get test tokens: POST /v1/faucet {"address": "0x..."} with an Idempotency-Key header grants ${amount(faucet.amount.toString())} and a mandate in club ${clubId}, once per address per ${faucet.windowSec} seconds. To fund a larger test deal, add "amount" in base units, up to ${faucet.maxAmount} (${amount(faucet.maxAmount.toString())}): the price plus the adjudication fee plus the operator fee. Make your own keys: no route here ever returns a secret key.`,
    `The faucet mandate is signed by the demo club's own test principal, which this demo holds; it lets your address act as buyer or seller in ${clubId}.`,
    judges,
    'Disclosure: offer at "public" on these nodes. The demo adjudicators cannot open sealed terms yet, so they decline private and judgment offers, which then expire unaccepted. The work itself is encrypted at every level.',
    `Settlement time is the wall clock. Club ${clubId} allows windows from ${minWindowSec} seconds: timing {"judgeWithinSec": ${minWindowSec}, "fallbackWithinSec": ${minWindowSec}, "appealWindowSec": 0, "appealDecideSec": ${minWindowSec}} completes a deal in a few minutes.`,
    ...(feeNote ? [feeNote] : []),
    'Request log: these nodes keep one line per request for seven days (Request-Id, time, node, method, route template, status, problem type, timing), never a body, a header value, an IP address, or the addresses and IDs in the path. Quote the Request-Id of a failed request when you report it.',
    ...(chain
      ? [
          "Fallback and appeal adjudicators decide on Sepolia: their panels are seeded from a drand quicknet round that settlement fixes (the round at judgeBy for the fallback, the first round after an escalation or appeal for the appeal adjudicator), and the rules contract verifies the round's BLS signature. If no drand relay answers before a deadline, nothing stands in: the deal takes its default outcome, or a party appeal expires and the first decision stands.",
          "The operators' view is kept across deploys. It starts over only when the settlement contracts are redeployed; what happened on Sepolia stays there. Keep your own copy of the terms you signed.",
        ]
      : ['State is journaled and replayed after a restart, but this is a demo: it may be reset at any time.']),
  ];
}
