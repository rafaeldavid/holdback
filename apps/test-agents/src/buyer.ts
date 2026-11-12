// Crow's test buyer (T-239): an always-on party that buys from any outside seller's agent on the Sepolia test
// environment, so a seller can complete a deal with no second person. It is a party like the test seller (seller.ts):
// it reaches the operators over their public HTTP API, signs only what it prepared and checked itself
// (examples/agent.ts, examples/verify.ts), and holds its own keys, derived from the Worker's Sepolia-only secret
// (keys.ts, label "buyer/standing"). The operators relay; they give it nothing they would not give any agent.
//
// A seller reads the card, offers on Crow naming the buyer's address and encryption key (site/llms.txt, section 5),
// and posts the commitment ID here. The buyer reads the terms from the operators and checks them against its
// published rules (buyer-rules.ts). It refuses an offer that breaks one, naming the rule, or takes it: it agrees and
// funds with test tUSDC once the adjudicator accepts the offer, follows the deal to Released or Refunded, and sends
// the reclaim itself when deliverBy passes with nothing delivered. It never opens or runs the work: the adjudicator's
// declarative checks decide.
//
//   GET  <base>                          the page: <script id="crow-buyer"> with the card
//   GET  <base>/agent.json               the card: the buyer's address and key, what it accepts, its limits
//   POST <base>/offers                   {"commitmentId": "0x…"}: 202 taken, 200 already taken, 422 or 429 {error, rule}
//   GET  <base>/status/<commitmentId>    the deal: status, detail, transactions
//   GET  <base>/health                   operational, and how many deals are open
import { recoverTypedDataAddress, type Hex } from 'viem';
import { Agent } from '../../../examples/agent.ts';
import { commitmentIdOf, freshNonce, fundingNonceOf, jcs, operatorFeeNonceOf, operatorFeeOf, Refusal, typedOf, type Intent, type Pin } from '../../../examples/verify.ts';
import { BUYER_LIMITS, CHECKS_RULE, MAX_ADJUDICATION_FEE_UNITS, MAX_PRICE_UNITS, WINDOWS, type BuyerLimits } from './buyer-rules.ts';
import { encryptionKey, signingKey } from './keys.ts';
import { clientKey, type Storage } from './seller.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export { BUYER_LIMITS, type BuyerLimits } from './buyer-rules.ts';

/** The chains the buyer signs on: SimChain and local chains (31337), Sepolia and Base Sepolia. Any other is refused. */
export const TEST_CHAIN_IDS = [31337, 11155111, 84532];

export type BuyerStatus = 'accepted' | 'funded' | 'released' | 'refunded' | 'reclaimed' | 'expired' | 'settled' | 'failed';
const OPEN: BuyerStatus[] = ['accepted', 'funded'];

/** A submission the buyer signed or sends, kept with its idempotency key so a retry or a restart replays it. */
interface Pending {
  step: 'fund' | 'reclaim';
  path: string;
  body: J;
  key: string;
}

export interface BuyerDeal {
  id: Hex;
  seller: string;
  status: BuyerStatus;
  terms: J;
  /** What the buyer pays in all, in base units: price, adjudication fee and operator fee. */
  total: string;
  /** Settlement time when the offer was taken, and when the funding was answered, in ms. */
  acceptedAt: number;
  fundedAt?: number;
  updatedAt: number;
  pending?: Pending;
  retry?: { since: number; at: number; tries: number; error: string };
  detail?: string;
  /** Who sent the reclaim that refunded a deal the seller never delivered. */
  reclaimedBy?: 'buyer' | 'operators';
  txs?: Array<{ step: string; tx: string }>;
}

export interface BuyerOptions {
  storage: Storage;
  /** Operator base URLs. It reads from every one that answers, and relays through the first that does. */
  operators: string[];
  /** TEST_AGENTS_SEED: 32 bytes of 0x-prefixed hex. */
  seed: string;
  /** The settlement layer the buyer signs for, pinned in its own code (examples/verify.ts knownPins). */
  pin: Pin;
  /** The public URL of the buyer, such as https://crow.direct/agents/test-buyer. */
  base: string;
  limits?: BuyerLimits;
  now?: () => number;
  log?: (line: string) => void;
}

/** A refusal: the deal fails with this reason, and nothing is retried. */
export class Refused extends Error {}

/** A step to try again no sooner than `ms` from now, such as a reclaim the chain does not yet take. */
class Later extends Error {
  constructor(
    msg: string,
    readonly ms: number,
  ) {
    super(msg);
  }
}

/**
 * How long a refused reclaim waits before the next try: one Sepolia block, about 12 s, by which the chain's clock has
 * caught up with the operators' (T-239 review, finding 2).
 */
export const RECLAIM_RETRY_MS = 12_000;

/** The states in which the hold is funded: the deal goes on, or is settled, on Crow. */
const FUNDED = ['Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Defaulted', 'Released', 'Refunded', 'Settled'];

/** What an offer must fit, read from the operators: whom it names, the club, the token, the adjudicators, the time. */
export interface Context {
  me: { address: string; encryptionPublicKey: string };
  clubId: string;
  token: string;
  adjudicators: { primary: string; fallback: string; appeal: string };
  /** The operators' fee schedule (ADR-0023), or null when they publish none. */
  feeSchedule: J | null;
  /** Settlement-layer time, in ms. */
  now: number;
}

export interface Broken {
  rule: string;
  error: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body, null, 1), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...extra } });
const problem = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status, typeof extra['retryAfterSec'] === 'number' ? { 'retry-after': String(extra['retryAfterSec']) } : {});
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const units = (base: bigint) => {
  const frac = (base % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${base / 1_000_000n}${frac ? `.${frac}` : ''}`;
};
const AMOUNT = /^(0|[1-9][0-9]{0,77})$/;
const ID = /^0x[0-9a-fA-F]{64}$/;
const lower = (s: unknown) => String(s).toLowerCase();
/** JSON with every 0x-hex string lowercased: addresses compare ignoring case. */
const lowerHex = (v: J): J => JSON.parse(JSON.stringify(v ?? null), (_k, x) => (typeof x === 'string' && /^0x[0-9a-fA-F]+$/.test(x) ? x.toLowerCase() : x));

/**
 * Whether an offer's terms fit the buyer's published rules, or the first rule they break. Pure: the terms are data
 * from a stranger, read and compared, never run.
 */
export function checkTerms(id: string, t: J, c: Context): Broken | null {
  const no = (rule: string, error: string): Broken => ({ rule, error });
  if (!t || typeof t !== 'object') return no('terms', 'the operators serve no terms for that commitment');
  try {
    if (lower(commitmentIdOf(t)) !== lower(id)) return no('commitmentId', `the terms hash to ${commitmentIdOf(t)}, not ${id}`);
  } catch {
    return no('terms', 'the terms do not encode as CommitmentTerms');
  }
  if (lower(t.buyer) !== c.me.address) return no('buyer', `the offer names buyer ${t.buyer}, not this buyer (${c.me.address})`);
  // ADR-0033 §6: the test buyer pays from its signing address, so the terms must name that address as the payment address.
  if (lower(t.buyerPaymentAddress) !== c.me.address) return no('buyerPaymentAddress', `the offer names payment address ${t.buyerPaymentAddress}; this buyer funds from ${c.me.address} and takes refunds there`);
  if (t.buyerEncryptionPublicKey !== c.me.encryptionPublicKey) return no('buyerEncryptionPublicKey', `the offer seals the work to ${t.buyerEncryptionPublicKey}, not this buyer's key (${c.me.encryptionPublicKey})`);
  if (t.clubId !== c.clubId) return no('accepts.clubId', `the offer is in club ${t.clubId}; this buyer deals in ${c.clubId}`);
  if (lower(t.price?.token) !== lower(c.token) || lower(t.settlement?.token) !== lower(c.token)) return no('accepts.token', `the offer is priced in ${t.price?.token}; this buyer pays only in ${c.token}`);
  if (!AMOUNT.test(String(t.price?.amount)) || BigInt(t.price.amount) > BigInt(MAX_PRICE_UNITS)) return no('accepts.maxPrice', `the price is ${t.price?.amount} base units; this buyer pays at most ${MAX_PRICE_UNITS} (${units(BigInt(MAX_PRICE_UNITS))} tUSDC)`);
  const a = t.adjudication ?? {};
  if (lower(a.fee?.token) !== lower(c.token) || !AMOUNT.test(String(a.fee?.amount)) || BigInt(a.fee.amount) > BigInt(MAX_ADJUDICATION_FEE_UNITS)) return no('accepts.maxAdjudicationFee', `the adjudication fee is ${a.fee?.amount} base units; this buyer pays at most ${MAX_ADJUDICATION_FEE_UNITS} (${units(BigInt(MAX_ADJUDICATION_FEE_UNITS))} tUSDC)`);
  const named = { primary: lower(a.adjudicator), fallback: lower(a.fallbackAdjudicator), appeal: lower(a.appealAdjudicator) };
  const want = { primary: lower(c.adjudicators.primary), fallback: lower(c.adjudicators.fallback), appeal: lower(c.adjudicators.appeal) };
  if (jcs(named) !== jcs(want)) return no('accepts.adjudicators', `the offer names adjudicators ${jcs(named)}; this buyer accepts only the demo's three by role, ${jcs(want)}`);
  if (t.disclosure?.level !== 'public') return no('accepts.disclosure', `the offer is ${t.disclosure?.level}; this buyer takes public terms only`);
  if (jcs(t.acceptance?.rubric ?? null) !== jcs({ criteria: [], passThreshold: 0 })) return no('accepts.template', 'the offer has a rubric; this buyer takes checks-only deals, decided by declarative checks alone');
  const checks = t.acceptance?.deterministicChecks;
  if (!Array.isArray(checks) || checks.length < CHECKS_RULE.min) return no('accepts.checks.min', `the offer has no deterministic checks; this buyer needs at least ${CHECKS_RULE.min}`);
  if (checks.length > CHECKS_RULE.max) return no('accepts.checks.max', `the offer has ${checks.length} checks; this buyer takes at most ${CHECKS_RULE.max}`);
  const types: readonly string[] = CHECKS_RULE.types;
  const odd = checks.find((x: J) => !x || typeof x !== 'object' || !types.includes(x.type));
  if (odd !== undefined) return no('accepts.checks.types', `check ${JSON.stringify(odd?.id ?? null)} has type ${JSON.stringify(odd?.type ?? null)}; this buyer accepts only ${types.join(', ')}`);
  if (checks.filter((x: J) => x.required === true).length < CHECKS_RULE.requiredAtLeast) return no('accepts.checks.requiredAtLeast', `no check is required; this buyer needs at least ${CHECKS_RULE.requiredAtLeast} with "required": true`);
  if (t.remedy?.onReject !== 'full_refund') return no('accepts.remedy', `the offer's remedy is ${JSON.stringify(t.remedy?.onReject ?? null)}; this buyer takes only "full_refund"`);
  const tm = t.timing ?? {};
  const at = (k: string) => Date.parse(tm[k]);
  const created = Date.parse(t.createdAt);
  const times = [created, at('offerExpiresAt'), at('fundBy'), at('deliverBy'), at('judgeBy'), at('fallbackBy')];
  if (times.some((x) => !Number.isFinite(x)) || !Number.isSafeInteger(tm.appealWindowSec) || !Number.isSafeInteger(tm.appealDecideSec)) return no('terms', 'the offer\'s timing does not parse');
  // Every window counts from settlement time: createdAt is the seller's own claim, which nothing else bounds, so an
  // offer dated 2099 with short windows would otherwise hold the buyer's tokens until 2099 (T-239 review, finding 1).
  const ahead = (created - c.now) / 1000;
  if (ahead > WINDOWS.maxCreatedAheadSec) return no('accepts.windows.maxCreatedAheadSec', `the offer is dated ${t.createdAt}, ${Math.round(ahead)} s after settlement time; this buyer takes offers dated at most ${WINDOWS.maxCreatedAheadSec} s ahead`);
  const left = Math.min(at('offerExpiresAt'), at('fundBy')) - c.now;
  if (left < WINDOWS.minFundingLeftSec * 1000) return no('accepts.windows.minFundingLeftSec', `the offer leaves ${Math.max(0, Math.floor(left / 1000))} s to agree and fund; this buyer needs ${WINDOWS.minFundingLeftSec} s`);
  const deliverSec = Math.round((at('deliverBy') - c.now) / 1000);
  if (deliverSec > WINDOWS.maxDeliverWithinSec) return no('accepts.windows.maxDeliverWithinSec', `the work is due ${deliverSec} s from now; this buyer waits at most ${WINDOWS.maxDeliverWithinSec} s`);
  const judging: Record<string, number> = { judge: (at('judgeBy') - at('deliverBy')) / 1000, fallback: (at('fallbackBy') - at('judgeBy')) / 1000, appealWindow: tm.appealWindowSec, appealDecide: tm.appealDecideSec };
  const long = Object.entries(judging).find(([, s]) => s > WINDOWS.maxJudgingSec);
  if (long) return no('accepts.windows.maxJudgingSec', `the ${long[0]} window is ${long[1]} s; this buyer accepts at most ${WINDOWS.maxJudgingSec} s for each`);
  return null;
}

/**
 * The agent, reading from every operator that answers, so one offline operator does not stop the buyer. Every
 * operator that answers must agree; with one left, the buyer still checks every prepared message against its own
 * intent before signing (verify.ts), so a lying operator cannot make it sign other terms.
 */
class BuyerAgent extends Agent {
  override sources(): string[] {
    const byOrigin = new Map<string, string>();
    for (const api of this.operators) byOrigin.set(new URL(api).origin.toLowerCase(), api.replace(/\/+$/, ''));
    return [...byOrigin.values()];
  }

  /** A read or a prepare: the operator named, or else each in turn while one is unreachable. Never a mutation. */
  override async call<T = J>(method: 'GET' | 'POST', path: string, body?: unknown, api?: string, extra: Record<string, string> = {}): Promise<T> {
    if (method === 'POST' && !path.startsWith('/v1/prepare/')) throw new Error(`the buyer submits ${path} through submit(), with its own idempotency key`);
    let last: unknown;
    for (const o of api ? [api] : this.sources()) {
      try {
        return await super.call<T>(method, path, body, o, extra);
      } catch (e) {
        last = e;
        if (!(e instanceof TypeError) && !(e instanceof SyntaxError)) throw e;
      }
    }
    throw last;
  }

  override async trusted<T = J>(path: string, pick: (x: J) => T = (x) => x): Promise<T> {
    const settled = await Promise.allSettled(this.sources().map(async (api) => pick(await super.call('GET', path, undefined, api))));
    const answers = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (answers.length === 0) throw (settled.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
    if (new Set(answers.map((x) => jcs(x))).size !== 1) throw new Error(`operators disagree on ${path}; do not proceed`);
    return answers[0]!;
  }

  override async settlementNow(): Promise<number> {
    const settled = await Promise.allSettled(this.sources().map(async (api) => Date.parse((await super.call('GET', '/.well-known/holdback.json', undefined, api)).settlementTime)));
    const times = settled.flatMap((r) => (r.status === 'fulfilled' && Number.isFinite(r.value) ? [r.value] : []));
    if (times.length === 0) throw new Error("no operator answered with the settlement-layer time");
    if (Math.max(...times) - Math.min(...times) > 5000) throw new Error('operators disagree on settlement-layer time; do not proceed');
    return Math.max(...times);
  }
}

export class TestBuyer {
  private readonly s: Storage;
  private readonly limits: BuyerLimits;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  /** The buyer's one standing address: one agent for every deal, as the test seller has (D47). */
  readonly agent: Agent;
  private card: { at: number; value: J } | undefined;
  private prunedAt = 0;
  private readonly o: BuyerOptions;
  /** Per-client post times, in memory only: no client address is ever stored (docs/operations.md, Telemetry). */
  private readonly clients = new Map<string, number[]>();
  /** The tail of the queue that takes offers one at a time: the caps' last check and the write run with no overlap. */
  private taking: Promise<unknown> = Promise.resolve();

  constructor(o: BuyerOptions) {
    // No real money: the buyer signs on test networks only.
    if (!TEST_CHAIN_IDS.includes(o.pin.domain.chainId)) throw new Error(`chain ${o.pin.domain.chainId} is not a test network: the test buyer signs only on chains ${TEST_CHAIN_IDS.join(', ')}`);
    this.o = o;
    this.s = o.storage;
    this.limits = o.limits ?? BUYER_LIMITS;
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((l) => console.log(l));
    this.agent = new BuyerAgent(o.operators, signingKey(o.seed, 'buyer/standing'), encryptionKey(o.seed, 'buyer/standing'), o.pin.domain, o.pin.chain);
  }

  private get token() {
    return this.o.pin.token.id;
  }

  /** What an offer must fit, from discovery as the operators that answer serve it, checked against the pin. */
  async context(): Promise<Context> {
    const a = this.agent;
    const found = await a.trusted('/.well-known/holdback.json', (x) => ({ domain: x.domain, clubId: x.demo?.clubId, token: x.demo?.token?.id, adjudicators: x.demo?.adjudicators, fee: x.fees?.operator ?? null }));
    if (jcs(lowerHex(found.domain)) !== jcs(lowerHex(this.o.pin.domain))) throw new Refused(`the operators serve EIP-712 domain ${jcs(found.domain)}, not the pinned ${jcs(this.o.pin.domain)}`);
    if (lower(found.token) !== lower(this.token) || !found.clubId) throw new Refused(`the operators run no demo in ${this.o.pin.token.symbol}`);
    const role = (r: string): string => found.adjudicators?.find((x: J) => x.role === r)?.address ?? (() => { throw new Refused(`discovery names no ${r} adjudicator`); })();
    return {
      me: { address: a.address, encryptionPublicKey: a.encryptionPublicKey },
      clubId: found.clubId, token: this.token,
      adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
      feeSchedule: found.fee, now: await a.settlementNow(),
    };
  }

  /** The card: who the buyer is, what it accepts, its limits. Cached 5 minutes once discovery answers. */
  async agentCard(): Promise<J> {
    const now = this.now();
    if (this.card && now - this.card.at < 5 * MIN) return this.card.value;
    const base = this.o.base;
    const ctx = await this.context().catch(() => null);
    const value = {
      type: 'crow-buyer',
      name: "Crow's test buyer",
      buyer: this.agent.address,
      buyerEncryptionPublicKey: this.agent.encryptionPublicKey,
      intake: { api: `${base}/offers`, status: `${base}/status/<commitmentId>`, health: `${base}/health` },
      accepts: {
        token: this.token,
        maxPrice: { token: this.token, amount: MAX_PRICE_UNITS },
        maxAdjudicationFee: { token: this.token, amount: MAX_ADJUDICATION_FEE_UNITS },
        ...(ctx ? { clubId: ctx.clubId, adjudicators: ctx.adjudicators } : {}),
        template: 'checks-only',
        disclosure: 'public',
        remedy: 'full_refund',
        checks: CHECKS_RULE,
        windows: WINDOWS,
      },
      pays: 'the price, the adjudication fee and the operator fee, from test tUSDC it takes from the faucet',
      limits: this.limits,
      testTokensOnly: true,
    };
    if (ctx) this.card = { at: now, value };
    return value;
  }

  /** The page: what the buyer accepts, in words, and the crow-buyer block an agent reads. */
  async page(): Promise<string> {
    const card = await this.agentCard();
    // `<` inside the JSON is escaped, so no value can close the script element.
    const block = JSON.stringify(card).replace(/</g, '\\u003c');
    const l = card.limits;
    const w = card.accepts.windows;
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crow's test buyer</title>
<script type="application/json" id="crow-buyer">${block}</script>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#1d1d1f;background:#fff}code{font-size:.9em;word-break:break-all}</style>
</head><body>
<h1>Crow's test buyer</h1>
<p><strong>Test tokens only.</strong> This agent buys from any seller's agent on Crow's Sepolia test environment, in tUSDC, an open-mint test token worth nothing.</p>
<p>Offer it a checks-only deal on Crow with public terms, naming its address <code>${card.buyer}</code> and its encryption key <code>${card.buyerEncryptionPublicKey}</code>. It pays at most ${units(BigInt(MAX_PRICE_UNITS))} tUSDC, plus an adjudication fee of at most ${units(BigInt(MAX_ADJUDICATION_FEE_UNITS))} tUSDC and the operator's fee. It needs ${CHECKS_RULE.min} to ${CHECKS_RULE.max} declarative checks, at least ${CHECKS_RULE.requiredAtLeast} of them required, of the types ${CHECKS_RULE.types.join(', ')}; the demo's three adjudicators; an offer dated at most ${w.maxCreatedAheadSec} s after settlement time; the work due within ${w.maxDeliverWithinSec} s of your post; each judging window at most ${w.maxJudgingSec} s; and ${w.minFundingLeftSec} s left to fund. Every window counts from settlement time when you post, not from the offer's <code>createdAt</code>.</p>
<p>Then POST <code>{"commitmentId": "0x…"}</code> to <code>${card.intake.api}</code>. It answers 202 and funds once the adjudicator accepts the offer, which must happen within ${w.maxAdjudicatorAcceptSec} s of your post, or 422 with the rule your offer broke. Deliver once the deal is <code>Held</code>: work that passes the checks is paid, work that fails them is refunded, and if you never deliver, it reclaims its hold after <code>deliverBy</code>. Follow the deal at <code>${card.intake.status}</code>.</p>
<p>Crow's maintainers run both the operators and this buyer. It holds its own keys and uses only the operators' public API, but it is not an independent business.</p>
<p>Limits: ${l.perSellerPerHour} deals per seller address an hour and ${l.perSellerPerDay} a day; ${l.perDay} a day in all; ${l.open} in progress at once; ${l.perClientPerMinute} posts per IP address a minute and ${l.perClientPerHour} an hour. Over a limit it answers 429 with the rule and when to retry.</p>
</body></html>
`;
  }

  /** `client` is the caller's IP address, which the Worker sets; the buyer counts it in memory and never stores it. */
  async fetch(request: Request, client = 'unknown'): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const base = new URL(this.o.base).pathname.replace(/\/+$/, '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, idempotency-key' } });
    if (path === base && request.method === 'GET') return new Response(await this.page(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    if (path === `${base}/agent.json` && request.method === 'GET') return json(await this.agentCard());
    if (path.startsWith(`${base}/status/`) && request.method === 'GET') return this.status(path.slice(`${base}/status/`.length));
    if (path === `${base}/health` && request.method === 'GET') return this.health();
    if (path === `${base}/offers` && request.method === 'POST') return this.receive(request, client);
    return problem(404, `not found; the buyer is at ${this.o.base}`);
  }

  private async health(): Promise<Response> {
    return json({ status: 'operational', open: (await this.s.list({ prefix: 'o:' })).size, buyer: this.agent.address });
  }

  /** Whether a per-seller or overall cap is full for this seller, and until when. */
  private async capped(seller: string, now: number): Promise<{ rule: string; why: string; until: number } | null> {
    const recent = ((await this.s.get<Array<{ at: number; seller: string }>>('recent')) ?? []).filter((r) => now - r.at < DAY);
    const today = recent.filter((r) => day(r.at) === day(now));
    const midnight = Date.parse(`${day(now)}T00:00:00Z`) + DAY;
    if (today.length >= this.limits.perDay) return { rule: 'limits.perDay', why: `${this.limits.perDay} deals today (UTC)`, until: midnight };
    const mine = recent.filter((r) => r.seller === seller);
    const lastHour = mine.filter((r) => now - r.at < HOUR);
    if (lastHour.length >= this.limits.perSellerPerHour) return { rule: 'limits.perSellerPerHour', why: `${this.limits.perSellerPerHour} deals from your address in the last hour`, until: Math.min(...lastHour.map((r) => r.at)) + HOUR };
    if (mine.filter((r) => day(r.at) === day(now)).length >= this.limits.perSellerPerDay) return { rule: 'limits.perSellerPerDay', why: `${this.limits.perSellerPerDay} deals from your address today (UTC)`, until: midnight };
    return null;
  }

  /** Whether a client is over its per-client cap on posts, and until when; counts the post when it is not. */
  private overClientCap(client: string, now: number): { rule: string; why: string; until: number } | null {
    const who = clientKey(client);
    const mine = (this.clients.get(who) ?? []).filter((t) => now - t < HOUR);
    const lastMinute = mine.filter((t) => now - t < MIN);
    if (lastMinute.length >= this.limits.perClientPerMinute) return { rule: 'limits.perClientPerMinute', why: `${this.limits.perClientPerMinute} posts from your IP address in the last minute`, until: Math.min(...lastMinute) + MIN };
    if (mine.length >= this.limits.perClientPerHour) return { rule: 'limits.perClientPerHour', why: `${this.limits.perClientPerHour} posts from your IP address in the last hour`, until: Math.min(...mine) + HOUR };
    this.clients.set(who, [...mine, now]);
    for (const [c, times] of this.clients) if (times.every((t) => now - t >= HOUR)) this.clients.delete(c);
    return null;
  }

  /** Runs `fn` after every earlier one has finished: one offer is taken at a time (T-239 review, finding 4). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.taking.then(fn, fn);
    this.taking = run.catch(() => undefined);
    return run;
  }

  private async receive(request: Request, client: string): Promise<Response> {
    let r: J;
    try {
      r = await request.json();
    } catch {
      return problem(400, 'send {"commitmentId": "0x…"} as JSON');
    }
    if (typeof r?.commitmentId !== 'string' || !ID.test(r.commitmentId)) return problem(400, 'commitmentId must be the 0x-prefixed 32-byte commitment ID of your offer on Crow');
    const id = r.commitmentId.toLowerCase() as Hex;
    const known = await this.s.get<BuyerDeal>(`d:${id}`);
    const taken = (status: number) => json({ commitmentId: id, status: `${this.o.base}/status/${id}` }, status);
    if (known) return taken(200);
    const now = this.now();
    const busy = () => problem(429, `the test buyer is busy: ${this.limits.open} deals are in progress`, { rule: 'limits.open', retryAfterSec: 60 });
    if ((await this.s.list({ prefix: 'o:' })).size >= this.limits.open) return busy();
    // Each post below costs reads on every operator, which share one read budget with the test seller: the client
    // cap comes before the first of them (T-239 review, finding 3).
    const over = this.overClientCap(client, now);
    if (over) return problem(429, `the test buyer is busy: ${over.why}`, { rule: over.rule, retryAfterSec: Math.max(1, Math.ceil((over.until - now) / 1000)) });
    const a = this.agent;
    let served: J;
    let ctx: Context;
    try {
      [served, ctx] = await Promise.all([a.trusted(`/v1/commitments/${id}/terms`), this.context()]);
    } catch (e) {
      if (/not_found/.test(message(e))) return problem(404, `the operators hold no commitment ${id}: offer on Crow first (site/llms.txt, section 5)`);
      return problem(503, `the test buyer cannot read the operators now: ${message(e)}`, { retryAfterSec: 30 });
    }
    const { id: _servedId, signatures, ...terms } = served; // eslint-disable-line @typescript-eslint/no-unused-vars
    const broken = checkTerms(id, terms, ctx);
    if (broken) return problem(422, `the test buyer refuses this offer: ${broken.error}`, { rule: broken.rule });
    const seller = lower(terms.seller);
    let signer = '';
    try {
      signer = lower(await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', terms, a.domain), signature: signatures?.seller }));
    } catch {
      // An unreadable signature recovers to nobody: refused below.
    }
    if (signer !== seller) return problem(422, "the test buyer refuses this offer: the seller's signature does not recover to terms.seller", { rule: 'signatures.seller' });
    let state: string;
    try {
      state = (await a.call('GET', `/v1/commitments/${id}`)).escrowState;
    } catch (e) {
      return problem(503, `the test buyer cannot read the operators now: ${message(e)}`, { retryAfterSec: 30 });
    }
    if (state !== 'Offered' && state !== 'AcceptedByAdjudicator') return problem(422, `the test buyer refuses this offer: it is ${state} on Crow, not open`, { rule: 'state' });
    const operatorFee = ctx.feeSchedule ? operatorFeeOf(terms.price, ctx.feeSchedule) : 0n;
    const total = BigInt(terms.price.amount) + BigInt(terms.adjudication.fee.amount) + operatorFee;
    // The caps are checked again, and the deal written, one post at a time and after the operator reads: posts that
    // arrive together cannot all pass a check made before any of them wrote (T-239 review, finding 4).
    return this.serial(async () => {
      if (await this.s.get(`d:${id}`)) return taken(200);
      if ((await this.s.list({ prefix: 'o:' })).size >= this.limits.open) return busy();
      const full = await this.capped(seller, now);
      if (full) return problem(429, `the test buyer is busy: ${full.why}`, { rule: full.rule, retryAfterSec: Math.max(1, Math.ceil((full.until - now) / 1000)) });
      const recent = ((await this.s.get<Array<{ at: number; seller: string }>>('recent')) ?? []).filter((x) => now - x.at < DAY);
      const deal: BuyerDeal = { id, seller, status: 'accepted', terms, total: total.toString(), acceptedAt: ctx.now, updatedAt: now };
      await this.s.put({ [`d:${id}`]: deal, [`o:${id}`]: 1, recent: [...recent, { at: now, seller }] });
      this.log(`test-buyer: took ${id} from ${seller} for ${units(total)} in all`);
      return taken(202);
    });
  }

  private async status(raw: string): Promise<Response> {
    if (!ID.test(raw)) return problem(400, 'status/<the 0x commitment ID you posted to offers>');
    const d = await this.s.get<BuyerDeal>(`d:${raw.toLowerCase()}`);
    if (!d) return problem(404, 'the test buyer has taken no offer with that commitment ID');
    const explorer = this.o.pin.chain?.explorer;
    return json({
      commitmentId: d.id,
      seller: d.seller,
      status: d.status,
      total: { token: this.token, amount: d.total },
      ...(d.reclaimedBy ? { reclaimedBy: d.reclaimedBy } : {}),
      ...(d.detail ? { detail: d.detail } : d.retry ? { detail: `retrying: ${d.retry.error}`, retryAt: new Date(d.retry.at).toISOString() } : {}),
      ...(d.txs?.length ? { transactions: d.txs.map((t) => ({ ...t, ...(explorer ? { url: `${explorer}/tx/${t.tx}` } : {}) })) } : {}),
      updatedAt: new Date(d.updatedAt).toISOString(),
    });
  }

  /** Whether any deal is open: the Worker keeps the alarm set while one is. */
  async hasOpen(): Promise<boolean> {
    return (await this.s.list({ prefix: 'o:' })).size > 0;
  }

  /** Writes a deal with `patch` applied; a field patched to undefined is removed. */
  private async save(d: BuyerDeal, patch: { [K in keyof BuyerDeal]?: BuyerDeal[K] | undefined }): Promise<BuyerDeal> {
    const next = { ...d, ...patch, updatedAt: this.now() } as BuyerDeal;
    for (const k of Object.keys(patch) as Array<keyof BuyerDeal>) if (patch[k] === undefined) delete next[k];
    await this.s.put({ [`d:${d.id}`]: next });
    if (!OPEN.includes(next.status)) await this.s.delete([`o:${d.id}`]);
    return next;
  }

  /**
   * Submits a body with its own idempotency key, through the first operator that answers: the same key and body
   * replay the first answer, so a retry after a lost response never submits twice. A 429, a 5xx or a network error
   * is transient; any other refusal is final.
   */
  private async submit(p: Pending): Promise<J> {
    let last: Error | undefined;
    for (const api of this.agent.sources()) {
      let res: Response;
      try {
        res = await fetch(`${api}${p.path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': p.key }, body: JSON.stringify(p.body) });
      } catch (e) {
        last = new Error(`POST ${p.path} via ${new URL(api).host}: ${message(e)}`);
        continue;
      }
      const out = (await res.json().catch(() => ({}))) as J;
      if (res.ok) return out;
      if (out.type === 'relay_refused') throw new Error(`Crow's relayer declined the transaction, probably out of test ETH: ${out.detail}`);
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`POST ${p.path}: ${out.type}: ${out.detail}`);
        continue;
      }
      throw new Refused(`POST ${p.path}: ${out.type}: ${out.detail}`);
    }
    throw last ?? new Error('no operator is configured');
  }

  /** Advances every open deal one step. Returns when to run again (ms since the epoch), or null when idle. */
  async work(): Promise<number | null> {
    await this.prune();
    const ids = [...(await this.s.list({ prefix: 'o:' })).keys()].map((k) => k.slice(2));
    const deals = (await Promise.all(ids.map((id) => this.s.get<BuyerDeal>(`d:${id}`)))).filter((d): d is BuyerDeal => d !== undefined);
    if (deals.length === 0) return null;
    const now = this.now();
    const due = deals.filter((d) => !d.retry || d.retry.at <= now);
    let settlement: number | undefined;
    if (due.length) {
      try {
        settlement = await this.agent.settlementNow();
      } catch (e) {
        this.log(`test-buyer: the operators' settlement time is unavailable: ${message(e)}`);
      }
    }
    // Fundings one at a time, so two cannot both count on one faucet grant; the rest at once.
    for (const d of due.filter((x) => x.status === 'accepted')) await this.advance(d, settlement);
    await Promise.all(due.filter((x) => x.status !== 'accepted').map((d) => this.advance(d, settlement)));
    const after = (await Promise.all(ids.map((id) => this.s.get<BuyerDeal>(`d:${id}`)))).filter((d): d is BuyerDeal => d !== undefined && OPEN.includes(d.status));
    if (after.length === 0) return null;
    // Fast while a step is due; slower while a funded deal waits for its delivery.
    const cadence = (d: BuyerDeal) => (d.retry ? Math.max(d.retry.at, now + 1000) : d.status === 'funded' && settlement !== undefined && Date.parse(d.terms.timing.deliverBy) - settlement > 10 * MIN ? now + 15_000 : now + 3000);
    return Math.min(...after.map(cadence));
  }

  private async advance(d: BuyerDeal, settlement: number | undefined): Promise<void> {
    try {
      if (settlement === undefined) throw new Error("the operators' settlement time is unavailable");
      if (d.status === 'accepted') await this.fund(d, settlement);
      else if (d.status === 'funded') await this.follow(d, settlement);
    } catch (e) {
      const latest = (await this.s.get<BuyerDeal>(`d:${d.id}`)) ?? d;
      const now = this.now();
      // Before the funding, a refusal is final. After it, the buyer's money is on Crow: it keeps following the deal
      // until a day after the last judging window closes, since the operators close every deadline themselves too.
      const t = latest.terms.timing;
      const lastWindow = Date.parse(t.fallbackBy) + (Number(t.appealWindowSec) + Number(t.appealDecideSec)) * 1000 + DAY;
      const final = latest.status === 'accepted' ? e instanceof Refused || e instanceof Refusal || (settlement ?? 0) > Date.parse(t.fundBy) : (settlement ?? 0) > lastWindow;
      if (final) {
        this.log(`test-buyer: ${d.id} failed at ${latest.status}: ${message(e)}`);
        await this.save(latest, { status: 'failed', detail: message(e), retry: undefined });
        return;
      }
      const since = latest.retry?.since ?? now;
      const tries = (latest.retry?.tries ?? 0) + 1;
      const wait = Math.max(e instanceof Later ? e.ms : 0, Math.min(60_000, 500 * 2 ** tries));
      await this.save(latest, { retry: { since, at: now + wait, tries, error: message(e) } });
    }
  }

  /** Test tUSDC and a live mandate in the club for one deal: the faucet only when either is missing. */
  private async ensureFunds(d: BuyerDeal): Promise<void> {
    const a = this.agent;
    const balance = BigInt((await a.call('GET', `/v1/balances/${a.address}`)).amount ?? '0');
    let mandates: J[] = [];
    try {
      mandates = (await a.call('GET', `/v1/agents/${a.address}`)).mandates ?? [];
    } catch (e) {
      if (!/not_found/.test(message(e))) throw e;
    }
    const live = mandates.some((m) => m.clubId === d.terms.clubId && Date.parse(m.scope?.expiresAt) > Date.parse(d.terms.timing.fundBy));
    const need = BigInt(d.total);
    if (balance >= need && live) return;
    // The faucet's default grant is 1,000 tUSDC; a deal that costs more names its own total (site/llms.txt, section 2).
    const grant = await this.submit({ step: 'fund', path: '/v1/faucet', body: { address: a.address, ...(need > 1_000_000_000n ? { amount: need.toString() } : {}) }, key: crypto.randomUUID() });
    if (grant.clubId !== d.terms.clubId) throw new Refused(`the faucet admitted the buyer to ${grant.clubId}, not ${d.terms.clubId}`);
    this.log(`test-buyer: faucet granted ${grant.granted?.amount ?? '?'} base units`);
  }

  private async fund(d: BuyerDeal, settlement: number): Promise<void> {
    const a = this.agent;
    const id = d.id;
    if (!d.pending) {
      const state = (await a.call('GET', `/v1/commitments/${id}`)).escrowState as string;
      const closes = Math.min(Date.parse(d.terms.timing.offerExpiresAt), Date.parse(d.terms.timing.fundBy));
      if (state === 'Expired' || (['Offered', 'AcceptedByAdjudicator', 'Agreed'].includes(state) && settlement >= closes)) {
        await this.save(d, { status: 'expired', detail: 'the offer closed before the test buyer could agree and fund it', retry: undefined });
        this.log(`test-buyer: ${id} expired unfunded`);
        return;
      }
      if (state === 'Offered') {
        // The buyer's published rule (accepts.windows.maxAdjudicatorAcceptSec): an offer the adjudicator leaves waiting is dropped.
        if (settlement - d.acceptedAt > WINDOWS.maxAdjudicatorAcceptSec * 1000) throw new Refused(`the adjudicator did not accept the offer within ${WINDOWS.maxAdjudicatorAcceptSec} s`);
        if (d.retry) await this.save(d, { retry: undefined });
        return; // the agreement is refused until the adjudicator accepts (acceptance_missing)
      }
      if (FUNDED.includes(state)) {
        // Funded already (an earlier funding whose answer was lost), or settled without this buyer.
        await this.save(d, { status: 'funded', fundedAt: settlement, retry: undefined });
        return;
      }
      if (state !== 'AcceptedByAdjudicator') {
        // Agreed but not held, or a state this buyer does not know: no funding is in place, so it waits, and the
        // deadlines above close the deal (T-239 review, finding 5).
        if (d.retry) await this.save(d, { retry: undefined });
        return;
      }
      await this.ensureFunds(d);
      const terms = d.terms;
      const schedule = await a.operatorFeeSchedule();
      // On a chain the token's ERC-3009 nonces are fixed by the terms (ADR-0025), so a second funding cannot happen.
      const c = a.chain;
      const nonces = { agreeNonce: freshNonce(), fundingNonce: c ? fundingNonceOf(terms, id, c) : freshNonce() };
      const feeNonce = c ? operatorFeeNonceOf(id) : freshNonce();
      const prepared = await a.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: id, ...nonces, ...(schedule ? { operatorFeeNonce: feeNonce } : {}) });
      const intent: Intent = { kind: 'agree-and-fund', terms, me: a.address, encryptionPublicKey: a.encryptionPublicKey, maxTotal: BigInt(d.total), expectedPrice: terms.price, expectedCommitmentId: id, ...nonces, ...(schedule ? { operatorFee: { schedule, nonce: feeNonce } } : {}), ...(c ? { chain: c } : {}) };
      const { path, body } = await a.sign(prepared, intent);
      // Kept before it is sent: a retry, or a restart, sends this body with this key again.
      d = await this.save(d, { pending: { step: 'fund', path, body, key: crypto.randomUUID() } });
    }
    try {
      await this.submit(d.pending!);
    } catch (e) {
      // A funding the settlement layer already holds (an earlier try whose answer was lost) is done, not refused.
      if (!(e instanceof Refused)) throw e;
      const s = (await a.call('GET', `/v1/commitments/${id}`)).escrowState as string;
      if (['Offered', 'AcceptedByAdjudicator', 'Expired'].includes(s)) throw e;
    }
    await this.save(d, { status: 'funded', fundedAt: settlement, pending: undefined, retry: undefined });
    this.log(`test-buyer: ${id} agreed and funded`);
  }

  private async follow(d: BuyerDeal, settlement: number): Promise<void> {
    const a = this.agent;
    const id = d.id;
    if (d.pending?.step === 'reclaim') {
      try {
        const out = await this.submit(d.pending);
        d = await this.save(d, { pending: undefined, reclaimedBy: out.escrowState === 'Refunded' ? 'buyer' : d.reclaimedBy });
      } catch (e) {
        if (!(e instanceof Refused)) throw e;
        // Too early by the contract's clock (409; on Sepolia the head block trails the operators' clock by about
        // 12 s), or refused for another reason. The next try is a new request with a new key, no sooner than one
        // block from now: the deal is read again then, so a refusal never loops (T-239 review, finding 2).
        await this.save(d, { pending: undefined });
        throw new Later(message(e), RECLAIM_RETRY_MS);
      }
    }
    const state = (await a.call('GET', `/v1/commitments/${id}`)).escrowState as string;
    if (state === 'Expired') {
      // Never held, or no longer: the deal closed on Crow, and its slot here closes with it (T-239 review, finding 5).
      await this.save(d, { status: 'expired', detail: 'the deal expired on Crow before it was held', retry: undefined });
      this.log(`test-buyer: ${id} expired`);
      return;
    }
    if (state === 'Held' && settlement > Date.parse(d.terms.timing.deliverBy)) {
      // Nothing delivered by deliverBy: the buyer takes its hold back itself (Beyond the happy path, triggers).
      d = await this.save(d, { pending: { step: 'reclaim', path: `/v1/commitments/${id}/triggers/reclaim`, body: {}, key: crypto.randomUUID() } });
      this.log(`test-buyer: ${id} reclaiming: nothing delivered by deliverBy`);
      return this.follow(d, settlement);
    }
    if (state !== 'Released' && state !== 'Refunded' && state !== 'Settled') {
      if (d.retry) await this.save(d, { retry: undefined });
      return;
    }
    const events: J[] = (await a.call('GET', `/v1/commitments/${id}/events?limit=200`)).items ?? [];
    const what: Record<string, string> = { 'hold.funded': 'funded', 'delivery.submitted': 'delivered', 'judgment.decided': 'decided', 'settlement.reclaimed': 'reclaimed' };
    const seen = new Set<string>();
    const txs = events
      .sort((x, y) => x.seq - y.seq)
      .filter((e) => typeof e.payload?.tx === 'string' && what[e.type] && !seen.has(e.payload.tx) && seen.add(e.payload.tx))
      .map((e) => ({ step: what[e.type]!, tx: e.payload.tx as string }));
    const delivered = events.some((e) => e.type === 'delivery.submitted');
    if (state === 'Released') {
      await this.save(d, { status: 'released', detail: 'the delivery passed the agreed checks: the seller is paid', txs, retry: undefined });
    } else if (state === 'Settled') {
      await this.save(d, { status: 'settled', detail: 'the deal was settled by agreement on Crow', txs, retry: undefined });
    } else if (!delivered) {
      const by = d.reclaimedBy ?? 'operators';
      await this.save(d, { status: 'reclaimed', reclaimedBy: by, detail: `nothing was delivered by deliverBy; ${by === 'buyer' ? 'the test buyer' : 'the operators'} sent the reclaim, and the price and the adjudication fee came back`, txs, retry: undefined });
    } else {
      await this.save(d, { status: 'refunded', detail: 'the delivery failed the agreed checks, or no decision came in time: the price and the adjudication fee came back', txs, retry: undefined });
    }
    this.log(`test-buyer: ${id} ${state}`);
  }

  /** Once an hour: closed deals older than 7 days go. */
  private async prune(): Promise<void> {
    const now = this.now();
    if (now - this.prunedAt < HOUR) return;
    this.prunedAt = now;
    const old = [...(await this.s.list<BuyerDeal>({ prefix: 'd:' })).values()].filter((d) => !OPEN.includes(d.status) && now - d.updatedAt > 7 * DAY);
    for (let i = 0; i < old.length; i += 64) await this.s.delete(old.slice(i, i + 64).map((d) => `d:${d.id}`));
  }
}

/** A view of one storage under a key prefix, so the buyer and the seller share one Durable Object without colliding. */
export function prefixed(s: Storage, p: string): Storage {
  return {
    get: <T = unknown>(k: string) => s.get<T>(`${p}${k}`),
    put: (e: Record<string, unknown>) => s.put(Object.fromEntries(Object.entries(e).map(([k, v]) => [`${p}${k}`, v]))),
    delete: (keys: string[]) => s.delete(keys.map((k) => `${p}${k}`)),
    list: async <T = unknown>(o: { prefix: string; end?: string }) => new Map([...(await s.list<T>({ prefix: `${p}${o.prefix}`, ...(o.end !== undefined ? { end: `${p}${o.end}` } : {}) }))].map(([k, v]) => [k.slice(p.length), v] as [string, T])),
  };
}
