// Crow's test seller (T-222, D47): an always-on party that sells one test dataset to any visitor's agent on the
// Sepolia test environment. It is a party like any other: it reaches the operators over their public HTTP API, signs
// only what it prepared and checked itself (examples/agent.ts, examples/verify.ts), and holds its own keys, derived
// from one Sepolia-only secret (keys.ts). The operators give it nothing they would not give any agent.
//
// It follows the agent intake convention in site/llms.txt ("Two agents, two people"): the buyer's agent stores its
// sealed proposal on Crow, sends the pointer and the sealed key here, and reads the commitment ID back with its
// status token. The seller opens the proposal, offers its catalog terms on Crow from its one standing address (the
// proposed terms mean yes; another price or other checks get the catalog terms as a counter-offer; other work is
// refused), delivers within seconds of the funding, and records the outcome.
//
//   GET  <base>                     the intake page: <script id="crow-agent"> with the intake and the offer
//   GET  <base>/agent.json          the same JSON
//   POST <base>/requests            {"type": "crow-request", proposal: {uri, sha256}, sealedKey, statusTokenHash}
//   GET  <base>/status?token=<t>    the buyer's own request: status, commitmentId, outcome, transactions
//   GET  <base>/health              operational or degraded, and how many deals are open
import type { Hex } from 'viem';
import { Agent } from '../../../examples/agent.ts';
import { freshNonce, jcs, openEnvelopeKey, operatorFeeOf, Refusal, type Intent, type Pin } from '../../../examples/verify.ts';
import { BAD_CSV, CHECKS, DELIVERABLE, GOOD_CSV, ITEM_ID, LIMITS, PRICE_UNITS, TIMING, type Limits, type Outcome } from './catalog.ts';
import { encryptionKey, publicOf, signingKey } from './keys.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The slice of Durable Object storage the seller uses; apps/demo-cloud's MemoryStorage is its in-memory twin. */
export interface Storage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
  list<T = unknown>(options: { prefix: string; end?: string }): Promise<Map<string, T>>;
}

export { LIMITS, type Limits } from './catalog.ts';

export type Status = 'received' | 'offered' | 'delivered' | 'released' | 'refunded' | 'expired' | 'failed';

/** A submission the seller signed, kept with its idempotency key so a retry replays it rather than resubmitting. */
interface Pending {
  step: 'offer' | 'deliver';
  path: string;
  body: J;
  key: string;
}

export interface Deal {
  n: number;
  status: Status;
  tokenHash: string;
  proposal: { uri: string; sha256: string };
  sealedKey: string;
  receivedAt: number;
  updatedAt: number;
  buyer?: string;
  outcome?: Outcome;
  /** True when the proposal asked for another price or other checks and the seller offered its catalog terms. */
  countered?: boolean;
  commitmentId?: Hex;
  terms?: J;
  /** Settlement time of the offer and of the delivery, in ms. */
  offeredAt?: number;
  deliveredAt?: number;
  pending?: Pending;
  /** A transient failure being retried: since when, the next try, and what went wrong. */
  retry?: { since: number; at: number; tries: number; error: string };
  detail?: string;
  txs?: Array<{ step: string; tx: string }>;
}

export interface SellerOptions {
  storage: Storage;
  /** Operator base URLs: the first relays, and trusted reads need two distinct origins. */
  operators: string[];
  /** The same operators' other base URLs, whose ciphertext URIs it also accepts (T-312: both hostnames serve one node). */
  aliases?: string[];
  /** TEST_AGENTS_SEED: 32 bytes of 0x-prefixed hex. */
  seed: string;
  /** The settlement layer the seller signs for, pinned in its own code (examples/verify.ts knownPins). */
  pin: Pin;
  /** The public URL of the intake, such as https://crow.direct/agents/test-seller. */
  base: string;
  limits?: Limits;
  /** The windows it offers (catalog.ts); tests shorten them. */
  timing?: Record<string, number>;
  /** How long a transient failure is retried before the deal fails. Default 15 minutes. */
  retryForMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

/** A refusal: the deal fails with this reason, and nothing is retried. */
export class Refused extends Error {}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const pad = (n: number) => String(n).padStart(9, '0');
/** Whether a URI names Crow's own ciphertext store on one of these origins: the seller fetches nothing else a stranger names. */
export const storeUri = (uri: URL, origins: string[]): boolean => origins.includes(uri.origin) && /^\/v1\/ciphertext\/sha256:[0-9a-f]{64}$/.test(uri.pathname);
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body, null, 1), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...extra } });
const problem = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status, typeof extra['retryAfterSec'] === 'number' ? { 'retry-after': String(extra['retryAfterSec']) } : {});
const sha256hex = async (b: Uint8Array) => Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(b))).toString('hex');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
/** JSON with every 0x-hex string lowercased: addresses compare ignoring case. */
const lower = (v: J): J => JSON.parse(JSON.stringify(v ?? null), (_k, x) => (typeof x === 'string' && /^0x[0-9a-fA-F]+$/.test(x) ? x.toLowerCase() : x));
const units = (base: bigint) => {
  const frac = (base % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${base / 1_000_000n}${frac ? `.${frac}` : ''}`;
};

/** What a per-client cap counts: an IPv4 address, or an IPv6 address's /64, which one host usually holds whole. */
export function clientKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}::/64`;
}

/** The request: everything in it is a pointer or sealed; nothing about the deal is readable here. */
export function checkRequest(r: J): string | null {
  if (!r || r.type !== 'crow-request') return 'type must be "crow-request"';
  const p = r.proposal;
  if (!p || typeof p.uri !== 'string' || !/^https?:\/\/\S+$/.test(p.uri) || p.uri.length > 500) return 'proposal.uri must be the URI Crow returned for the ciphertext (POST /v1/ciphertext)';
  if (typeof p.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(p.sha256)) return 'proposal.sha256 must be "sha256:<64 hex>" of the ciphertext';
  if (typeof r.sealedKey !== 'string' || !/^[A-Za-z0-9_-]{139}$/.test(r.sealedKey)) return "sealedKey must be the 139-character base64url NaCl envelope of the proposal key, sealed to this intake's encryptionPublicKey";
  if (typeof r.statusTokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.statusTokenHash)) return 'statusTokenHash must be the hex SHA-256 of a random token of at least 16 characters that you keep';
  return null;
}

export class TestSeller {
  private readonly s: Storage;
  private readonly limits: Limits;
  private readonly timing: Record<string, number>;
  private readonly retryForMs: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  /** The seller's one standing address (D47): one agent for every deal. */
  readonly agent: Agent;
  /** Per-client request times, in memory only: no visitor's IP is ever stored (docs/operations.md, Telemetry). */
  private readonly clients = new Map<string, number[]>();
  private card: { at: number; value: J } | undefined;
  private prunedAt = 0;
  private readonly o: SellerOptions;

  constructor(o: SellerOptions) {
    this.o = o;
    this.s = o.storage;
    this.limits = o.limits ?? LIMITS;
    this.timing = o.timing ?? TIMING;
    this.retryForMs = o.retryForMs ?? 15 * MIN;
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((l) => console.log(l));
    this.agent = new Agent(o.operators, signingKey(o.seed, 'seller/standing'), encryptionKey(o.seed, 'seller/standing'), o.pin.domain, o.pin.chain);
  }

  /** The intake's own x25519 key: the one the page publishes and proposals are sealed to. */
  get intake() {
    return publicOf(this.o.seed, 'seller/intake');
  }

  private get price() {
    return { token: this.o.pin.token.id, amount: PRICE_UNITS };
  }

  /**
   * What the buyer pays on top of the price, as the operators serve it now: the primary adjudicator's fee and the
   * operator's fee (site/llms.txt, section 6). Null when the operators cannot be read.
   */
  private async fees(): Promise<J | null> {
    try {
      const d = await this.agent.trusted('/.well-known/holdback.json', (x) => ({ primary: x.demo?.adjudicators?.find((a: J) => a.role === 'primary')?.address ?? null, schedule: x.fees?.operator ?? null }));
      if (!d.primary) return null;
      const adjudication = (await this.agent.registration(d.primary)).fee.min;
      const operator = d.schedule ? operatorFeeOf(this.price, d.schedule) : 0n;
      const total = BigInt(PRICE_UNITS) + BigInt(adjudication.amount) + operator;
      return { adjudication, operator: { token: this.price.token, amount: operator.toString() }, total: { token: this.price.token, amount: total.toString() } };
    } catch {
      return null;
    }
  }

  /** The intake document (site/llms.txt, "Agent intake"), with the one offer this seller makes. Cached 5 minutes. */
  async agentCard(): Promise<J> {
    const now = this.now();
    if (this.card && now - this.card.at < 5 * MIN) return this.card.value;
    const base = this.o.base;
    const fees = await this.fees();
    const value = {
      type: 'crow-agent',
      name: "Crow's test seller",
      // A standing seller lists its address, unlike the convention's per-deal sellers (D47): check terms.seller against it.
      seller: this.agent.address,
      intake: { api: `${base}/requests`, status: `${base}/status`, health: `${base}/health`, encryptionPublicKey: this.intake.encryptionPublicKey, scheme: 'x25519-xsalsa20poly1305' },
      offers: [{
        id: ITEM_ID,
        terms: { price: this.price, deliverable: DELIVERABLE, template: 'checks-only', disclosure: 'public', checks: CHECKS, timing: this.timing },
        ...(fees ? { fees } : {}),
        outcomes: {
          release: 'the default: 3 rows that pass every check; the seller is paid and you open the work',
          refund: 'add "test": {"outcome": "refund"} to your proposal: 2 rows, which fail the rows check; the price comes back, the adjudication and operator fees do not, and no key is released',
        },
      }],
      limits: this.limits,
      testTokensOnly: true,
    };
    if (fees) this.card = { at: now, value };
    return value;
  }

  /** The intake page: what the seller sells, in words, and the crow-agent block an agent reads. */
  async page(): Promise<string> {
    const card = await this.agentCard();
    const offer = card.offers[0];
    // `<` inside the JSON is escaped, so no value can close the script element.
    const block = JSON.stringify(card).replace(/</g, '\\u003c');
    const fees = offer.fees
      ? `You pay ${units(BigInt(offer.fees.total.amount))} tUSDC in all: the 25 tUSDC price, the adjudicator's fee of ${units(BigInt(offer.fees.adjudication.amount))} tUSDC and the operator's fee of ${units(BigInt(offer.fees.operator.amount))} tUSDC.`
      : 'You also pay the adjudicator\'s fee and the operator\'s fee, which the operators publish.';
    const l = card.limits;
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crow's test seller</title>
<script type="application/json" id="crow-agent">${block}</script>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#1d1d1f;background:#fff}code{font-size:.9em;word-break:break-all}</style>
</head><body>
<h1>Crow's test seller</h1>
<p><strong>Test tokens only.</strong> This agent sells one test dataset on Crow's Sepolia test environment, in tUSDC, an open-mint test token worth nothing.</p>
<p>It sells 3 rows of <code>customer_id,email</code> for 25 tUSDC on a checks-only deal: the columns, the row count (3) and unique IDs decide. ${fees} To see a refund, put <code>"test": {"outcome": "refund"}</code> in your proposal: it then delivers 2 rows, the rows check fails, and the price comes back; the two fees do not, and no key is released.</p>
<p>To buy, follow "Try it" in <a href="https://crow.direct/llms.txt">https://crow.direct/llms.txt</a>, or send a request as its "Two agents, two people" describes. Every offer comes from <code>${card.seller}</code>: check the seller in the terms against it. Unlike a person's intake, this page lists its address, because a public test seller has nothing to hide between deals.</p>
<p>Crow's maintainers run both the operators and this seller. It holds its own keys and uses only the operators' public API, but it is not an independent business.</p>
<p>Limits: ${l.perClientPerHour} requests per IP address an hour and ${l.perClientPerDay} a day; ${l.perHour} offers an hour and ${l.perDay} a day in all; ${l.open} in progress at once. When it is busy, it answers 429 with when to retry.</p>
</body></html>
`;
  }

  async fetch(request: Request, client: string): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const base = new URL(this.o.base).pathname.replace(/\/+$/, '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });
    if (path === base && request.method === 'GET') return new Response(await this.page(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    if (path === `${base}/agent.json` && request.method === 'GET') return json(await this.agentCard());
    if (path === `${base}/status` && request.method === 'GET') return this.status(url.searchParams.get('token') ?? '');
    if (path === `${base}/health` && request.method === 'GET') return this.health();
    if (path === `${base}/requests` && request.method === 'POST') return this.receive(request, client);
    return problem(404, `not found; the intake is at ${this.o.base}`);
  }

  private async degraded(): Promise<{ reason: string; since: number } | undefined> {
    const d = await this.s.get<{ reason: string; since: number }>('degraded');
    // A degraded seller tries again after an hour: the next offer checks the mandate afresh.
    return d && this.now() - d.since < HOUR ? d : undefined;
  }

  private async health(): Promise<Response> {
    const d = await this.degraded();
    const open = (await this.s.list({ prefix: 'o:' })).size;
    return json({ status: d ? 'degraded' : 'operational', open, ...(d ? { reason: d.reason } : {}) });
  }

  private async receive(request: Request, client: string): Promise<Response> {
    let r: J;
    try {
      r = await request.json();
    } catch {
      return problem(400, 'send the crow-request as JSON');
    }
    const bad = checkRequest(r);
    if (bad) return problem(400, bad);
    const known = await this.s.get<number>(`t:${r.statusTokenHash}`);
    if (known !== undefined) return json({ id: known, status: `${this.o.base}/status?token=<your token>` }, 200);
    const d = await this.degraded();
    if (d) return problem(503, `the test seller cannot offer now: ${d.reason}`, { retryAfterSec: Math.ceil((d.since + HOUR - this.now()) / 1000) });
    const now = this.now();
    const busy = (why: string, until: number) => problem(429, `the test seller is busy: ${why}`, { retryAfterSec: Math.max(1, Math.ceil((until - now) / 1000)) });
    const midnight = Date.parse(`${day(now)}T00:00:00Z`) + DAY;
    if ((await this.s.list({ prefix: 'o:' })).size >= this.limits.open) return busy(`${this.limits.open} deals are in progress`, now + MIN);
    // The shared hour and day caps count offers made, so requests that never open cannot use them up (offer() counts).
    const full = await this.capped(now);
    if (full) return busy(full.why, full.until);
    const who = clientKey(client);
    const mine = (this.clients.get(who) ?? []).filter((t) => now - t < DAY);
    const mineLastHour = mine.filter((t) => now - t < HOUR);
    if (mineLastHour.length >= this.limits.perClientPerHour) return busy(`${this.limits.perClientPerHour} requests from your IP address in the last hour`, Math.min(...mineLastHour) + HOUR);
    if (mine.filter((t) => day(t) === day(now)).length >= this.limits.perClientPerDay) return busy(`${this.limits.perClientPerDay} requests from your IP address today (UTC)`, midnight);
    this.clients.set(who, [...mine, now]);
    for (const [c, times] of this.clients) if (times.every((t) => now - t >= DAY)) this.clients.delete(c);
    const n = ((await this.s.get<number>('n')) ?? 0) + 1;
    const deal: Deal = { n, status: 'received', tokenHash: r.statusTokenHash, proposal: { uri: r.proposal.uri, sha256: r.proposal.sha256 }, sealedKey: r.sealedKey, receivedAt: now, updatedAt: now };
    await this.s.put({ n, [`d:${pad(n)}`]: deal, [`o:${pad(n)}`]: n, [`t:${r.statusTokenHash}`]: n });
    this.log(`test-seller: deal ${n} received`);
    return json({ id: n, status: `${this.o.base}/status?token=<your token>` }, 201);
  }

  /** Whether the shared hour or day cap on offers is full, and until when. */
  private async capped(now: number): Promise<{ why: string; until: number } | null> {
    const recent = ((await this.s.get<number[]>('recent')) ?? []).filter((t) => now - t < DAY);
    const lastHour = recent.filter((t) => now - t < HOUR);
    if (lastHour.length >= this.limits.perHour) return { why: `${this.limits.perHour} offers in the last hour`, until: Math.min(...lastHour) + HOUR };
    if (recent.filter((t) => day(t) === day(now)).length >= this.limits.perDay) return { why: `${this.limits.perDay} offers today (UTC)`, until: Date.parse(`${day(now)}T00:00:00Z`) + DAY };
    return null;
  }

  /** Whether any deal is open: the Worker keeps the alarm set while one is. */
  async hasOpen(): Promise<boolean> {
    return (await this.s.list({ prefix: 'o:' })).size > 0;
  }

  private async status(token: string): Promise<Response> {
    if (token.length < 16) return problem(400, 'token=<the random token whose SHA-256 you sent as statusTokenHash>');
    const n = await this.s.get<number>(`t:${await sha256hex(new TextEncoder().encode(token))}`);
    const d = n === undefined ? undefined : await this.s.get<Deal>(`d:${pad(n)}`);
    if (!d) return problem(404, 'no request with that token');
    const explorer = this.o.pin.chain?.explorer;
    return json({
      id: d.n,
      // The convention's three states, received, offered and failed; after the offer, the deal is followed on Crow.
      // A seller that gave up before delivering reports failed, so nobody funds an offer it will not serve.
      status: d.status === 'received' || (d.status === 'failed' && !d.deliveredAt) ? d.status : 'offered',
      deal: d.status,
      ...(d.commitmentId ? { commitmentId: d.commitmentId, seller: this.agent.address } : {}),
      ...(d.countered !== undefined ? { countered: d.countered } : {}),
      ...(d.outcome ? { outcome: d.outcome } : {}),
      ...(d.detail ? { detail: d.detail } : d.retry ? { detail: `retrying: ${d.retry.error}` } : {}),
      ...(d.txs?.length ? { transactions: d.txs.map((t) => ({ ...t, ...(explorer ? { url: `${explorer}/tx/${t.tx}` } : {}) })) } : {}),
      updatedAt: new Date(d.updatedAt).toISOString(),
    });
  }

  /** Opens a request's sealed proposal: the ciphertext from Crow's store, its hash, the key sealed to the intake. */
  private async open(d: Deal): Promise<J> {
    const origins = [...this.o.operators, ...(this.o.aliases ?? [])].map((u) => new URL(u).origin);
    const uri = new URL(d.proposal.uri);
    if (!storeUri(uri, origins)) throw new Refused(`proposal.uri must be a ciphertext URI on ${origins.join(' or ')}`);
    const res = await fetch(uri);
    if (res.status === 404) throw new Refused('the proposal ciphertext is not in the store (404)');
    if (!res.ok) throw new Error(`the proposal ciphertext could not be fetched (${res.status})`);
    const ct = new Uint8Array(await res.arrayBuffer());
    if (ct.length > 16_384) throw new Refused('the proposal is larger than 16 KiB');
    if (`sha256:${await sha256hex(ct)}` !== d.proposal.sha256) throw new Refused('the proposal ciphertext does not match proposal.sha256');
    let key: Uint8Array;
    try {
      key = openEnvelopeKey([{ recipient: 'intake', scheme: 'x25519-xsalsa20poly1305', ciphertext: d.sealedKey }], 'intake', encryptionKey(this.o.seed, 'seller/intake'));
    } catch {
      throw new Refused("sealedKey does not open with this intake's key: seal the proposal key to the encryptionPublicKey on the intake page");
    }
    let text: string;
    try {
      const aes = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, ['decrypt']);
      text = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ct.slice(0, 12) }, aes, ct.slice(12)));
    } catch {
      throw new Refused('the proposal does not decrypt with the sealed key (iv || AES-256-GCM || tag, no associated data)');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Refused('the proposal is not JSON');
    }
  }

  /**
   * The buyer, the outcome it asked for, and whether its terms are the catalog's with the demo's adjudicators and the
   * seller's windows (a proposal may leave those two out). Refuses a malformed proposal or other work.
   */
  private read(p: J, adjudicators: { primary: string; fallback: string; appeal: string }): { buyer: string; encryptionPublicKey: string; outcome: Outcome; countered: boolean } {
    if (p?.type !== 'crow-proposal') throw new Refused('the proposal must be {"type": "crow-proposal", …}');
    if (typeof p.buyer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(p.buyer)) throw new Refused('proposal.buyer must be your 0x address');
    if (typeof p.buyerEncryptionPublicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(p.buyerEncryptionPublicKey) || Buffer.from(p.buyerEncryptionPublicKey, 'base64url').length !== 32) throw new Refused('proposal.buyerEncryptionPublicKey must be your x25519 public key, 43 characters of base64url');
    const outcome = p.test?.outcome ?? 'release';
    if (outcome !== 'release' && outcome !== 'refund') throw new Refused('proposal.test.outcome must be "release" or "refund"');
    const t = p.terms ?? {};
    // Other work is refused rather than countered: an offer on Crow should not name a buyer for work it never asked about.
    if (t.deliverable !== undefined && (t.deliverable?.kind !== DELIVERABLE.kind || t.deliverable?.format !== DELIVERABLE.format)) throw new Refused(`this seller sells only ${DELIVERABLE.description} (kind ${DELIVERABLE.kind}, format ${DELIVERABLE.format})`);
    const want = { price: this.price, deliverable: DELIVERABLE, template: 'checks-only', disclosure: 'public', checks: CHECKS, adjudicators, timing: this.timing };
    const asked = { price: t.price, deliverable: t.deliverable, template: t.template, disclosure: t.disclosure, checks: t.checks, adjudicators: t.adjudicators ?? adjudicators, timing: t.timing ?? this.timing };
    return { buyer: p.buyer.toLowerCase(), encryptionPublicKey: p.buyerEncryptionPublicKey, outcome, countered: jcs(lower(asked)) !== jcs(lower(want)) };
  }

  /** Writes a deal with `patch` applied; a field patched to undefined is removed. */
  private async save(d: Deal, patch: { [K in keyof Deal]?: Deal[K] | undefined }): Promise<Deal> {
    const next = { ...d, ...patch, updatedAt: this.now() } as Deal;
    for (const k of Object.keys(patch) as Array<keyof Deal>) if (patch[k] === undefined) delete next[k];
    const open = next.status === 'received' || next.status === 'offered' || next.status === 'delivered';
    await this.s.put({ [`d:${pad(d.n)}`]: next });
    if (!open) await this.s.delete([`o:${pad(d.n)}`]);
    return next;
  }

  /**
   * Submits a signed body with its own idempotency key: the same key and body replay the first answer, so a retry
   * after a lost response never submits twice. A 429, a 5xx or a network error is transient; any other refusal is final.
   */
  private async submit(p: Pending): Promise<J> {
    let res: Response;
    try {
      res = await fetch(`${this.o.operators[0]}${p.path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': p.key }, body: JSON.stringify(p.body) });
    } catch (e) {
      throw new Error(`POST ${p.path}: ${message(e)}`);
    }
    const out = (await res.json().catch(() => ({}))) as J;
    if (res.ok) return out;
    if (out.type === 'relay_refused') throw new Error(`Crow's relayer declined the transaction, probably out of test ETH: ${out.detail}`);
    if (res.status === 429 || res.status >= 500) throw new Error(`POST ${p.path}: ${out.type}: ${out.detail}`);
    throw new Refused(`POST ${p.path}: ${out.type}: ${out.detail}`);
  }

  /** Advances every open deal one step. Returns when to run again (ms since the epoch), or null when idle. */
  async work(): Promise<number | null> {
    await this.prune();
    const open = [...(await this.s.list<number>({ prefix: 'o:' })).values()];
    const deals = (await Promise.all(open.map((n) => this.s.get<Deal>(`d:${pad(n)}`)))).filter((d): d is Deal => d !== undefined);
    if (deals.length === 0) return null;
    let settlement: number | undefined;
    const now = this.now();
    const due = deals.filter((d) => !d.retry || d.retry.at <= now);
    if (due.length) {
      try {
        settlement = await this.agent.settlementNow();
      } catch (e) {
        this.log(`test-seller: the operators' settlement time is unavailable: ${message(e)}`);
      }
    }
    // New requests one at a time, so the shared caps they count cannot be raced; the rest at once.
    for (const d of due.filter((x) => x.status === 'received')) await this.advance(d, settlement);
    await Promise.all(due.filter((x) => x.status !== 'received').map((d) => this.advance(d, settlement)));
    const after = (await Promise.all(open.map((n) => this.s.get<Deal>(`d:${pad(n)}`)))).filter((d): d is Deal => d !== undefined && ['received', 'offered', 'delivered'].includes(d.status));
    if (after.length === 0) return null;
    // Fast while a step is due or the buyer is about to fund; slower for an offer left waiting.
    const cadence = (d: Deal) => (d.retry ? Math.max(d.retry.at, now + 1000) : d.status === 'offered' && settlement !== undefined && settlement - (d.offeredAt ?? 0) > 5 * MIN ? now + 15_000 : now + 3000);
    return Math.min(...after.map(cadence));
  }

  private async advance(d: Deal, settlement: number | undefined): Promise<void> {
    try {
      if (settlement === undefined) throw new Error("the operators' settlement time is unavailable");
      if (d.status === 'received') await this.offer(d, settlement);
      else if (d.status === 'offered') await this.deliverWhenHeld(d, settlement);
      else if (d.status === 'delivered') await this.settleWhenDecided(d, settlement);
    } catch (e) {
      const latest = (await this.s.get<Deal>(`d:${pad(d.n)}`)) ?? d;
      if (e instanceof Refused || e instanceof Refusal) {
        this.log(`test-seller: deal ${d.n} failed at ${latest.status}: ${message(e)}`);
        await this.save(latest, { status: 'failed', detail: message(e), retry: undefined });
        return;
      }
      const now = this.now();
      const since = latest.retry?.since ?? now;
      // The retry budget closes a request not yet offered; deadlines close a deal on Crow, which the buyer may still fund.
      const giveUpAt =
        latest.status === 'received' ? since + this.retryForMs
        : latest.status === 'offered' ? Date.parse(latest.terms.timing.deliverBy) + 10 * MIN
        : (latest.deliveredAt ?? since) + 2 * HOUR;
      if (now >= giveUpAt) {
        this.log(`test-seller: deal ${d.n} failed at ${latest.status} after ${Math.round((now - since) / MIN)} min of retries: ${message(e)}`);
        await this.save(latest, { status: 'failed', detail: `gave up after ${Math.round((now - since) / 1000)} s of retries: ${message(e)}`, retry: undefined });
        return;
      }
      const tries = (latest.retry?.tries ?? 0) + 1;
      await this.save(latest, { retry: { since, at: now + Math.min(60_000, 1000 * 2 ** tries), tries, error: message(e) } });
    }
  }

  /** The standing address's live mandate in the club, from every operator; the faucet only when there is none (D47). */
  private async ensureMandate(clubId: string, settlement: number): Promise<void> {
    const live = async () => {
      let mandates: J[] = [];
      try {
        mandates = await this.agent.trusted(`/v1/agents/${this.agent.address}`, (x) => x.mandates ?? []);
      } catch (e) {
        if (!/not_found/.test(message(e))) throw e;
      }
      return mandates.some((m) => m.clubId === clubId && Date.parse(m.scope?.expiresAt) > settlement + 2 * Number(this.timing['deliverWithinSec'] ?? 3600) * 1000);
    };
    if (await live()) return;
    const grant = await this.submit({ step: 'offer', path: '/v1/faucet', body: { address: this.agent.address }, key: crypto.randomUUID() });
    if (grant.clubId !== clubId) throw new Refused(`the faucet admitted the seller to ${grant.clubId}, not ${clubId}`);
    if (await live()) return;
    const reason = 'its mandate has expired and the faucet did not renew it';
    await this.s.put({ degraded: { reason, since: this.now() } });
    this.log(`test-seller: degraded: ${reason}`);
    throw new Refused(`the test seller cannot offer now: ${reason}`);
  }

  private async offer(d: Deal, settlement: number): Promise<void> {
    if (!d.pending) {
      const a = this.agent;
      const found = await a.trusted('/.well-known/holdback.json', (x) => ({ domain: x.domain, clubId: x.demo?.clubId, token: x.demo?.token?.id, adjudicators: x.demo?.adjudicators }));
      // No real money: the seller deals only with operators on the settlement layer it pinned.
      if (jcs(lower(found.domain)) !== jcs(lower(this.o.pin.domain))) throw new Refused(`the operators serve EIP-712 domain ${jcs(found.domain)}, not the pinned ${jcs(this.o.pin.domain)}`);
      if (found.token !== this.o.pin.token.id || !found.clubId) throw new Refused(`the operators run no demo in ${this.o.pin.token.symbol}`);
      const role = (r: string): string => found.adjudicators?.find((x: J) => x.role === r)?.address ?? (() => { throw new Refused(`discovery names no ${r} adjudicator`); })();
      const adjudicators = { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') };
      const want = this.read(await this.open(d), adjudicators);
      // Only a request whose proposal opened counts against the shared caps: junk cannot use them up.
      const now = this.now();
      const full = await this.capped(now);
      if (full) throw new Refused(`the test seller is busy: ${full.why}; try again in ${Math.max(1, Math.ceil((full.until - now) / 1000))} s`);
      await this.s.put({ recent: [...((await this.s.get<number[]>('recent')) ?? []).filter((t) => now - t < DAY), now] });
      await this.ensureMandate(found.clubId, settlement);
      const request = {
        nonce: freshNonce(), disclosure: 'public', template: 'checks-only', clubId: found.clubId, seller: a.address,
        buyer: { address: want.buyer, encryptionPublicKey: want.encryptionPublicKey }, adjudicators, price: this.price, deliverable: DELIVERABLE, checks: CHECKS, timing: this.timing,
      };
      const prepared = await a.call('POST', '/v1/prepare/offer', request);
      const intent: Intent = { kind: 'offer', request, registration: await a.registration(adjudicators.primary), rulebookHash: await a.rulebookHash(found.clubId) };
      const { path, body } = await a.sign(prepared, intent);
      // Kept before it is sent: a retry sends this body with this key again.
      d = await this.save(d, { buyer: want.buyer, outcome: want.outcome, countered: want.countered, pending: { step: 'offer', path, body, key: crypto.randomUUID() } });
    }
    const p = d.pending!;
    try {
      await this.submit(p);
    } catch (e) {
      // An offer the operators already hold (an earlier try whose answer was lost) is made, not refused.
      if (!(e instanceof Refused)) throw e;
      const held = await this.agent.call('GET', `/v1/commitments/${p.body.id}/terms`).catch(() => null);
      if (String(held?.seller).toLowerCase() !== this.agent.address) throw e;
    }
    const { id, signatures: _s, ...terms } = p.body; // eslint-disable-line @typescript-eslint/no-unused-vars
    await this.save(d, { status: 'offered', commitmentId: id, terms, offeredAt: settlement, pending: undefined, retry: undefined });
    this.log(`test-seller: deal ${d.n} offered ${id}${d.countered ? ' (counter-offer)' : ''}`);
  }

  private async deliverWhenHeld(d: Deal, settlement: number): Promise<void> {
    const a = this.agent;
    if (!d.pending) {
      const state = await a.call('GET', `/v1/commitments/${d.commitmentId}`);
      const s = state.escrowState as string;
      if (s === 'Expired' || (['Offered', 'AcceptedByAdjudicator', 'Agreed'].includes(s) && settlement > Date.parse(d.terms.timing.fundBy))) {
        await this.save(d, { status: 'expired', detail: 'the buyer did not agree and fund before the funding window closed', retry: undefined });
        this.log(`test-seller: deal ${d.n} expired unfunded`);
        return;
      }
      if (s === 'Offered' && settlement - (d.offeredAt ?? settlement) > 2 * MIN) {
        const notices = (state.notices ?? []).join(' | ');
        throw new Refused(`the adjudicator did not accept the offer within 2 minutes${notices ? `: ${notices}` : ''}`);
      }
      if (s === 'Released' || s === 'Refunded' || s === 'Settled') {
        // Settled on Crow before this seller delivered: the buyer reclaimed after deliverBy, or the parties agreed.
        await this.save(d, { status: s === 'Released' ? 'released' : s === 'Refunded' ? 'refunded' : 'failed', detail: s === 'Refunded' ? 'the buyer reclaimed its hold: the seller did not deliver before deliverBy' : `the deal is ${s} on Crow without a delivery from this seller`, retry: undefined });
        this.log(`test-seller: deal ${d.n} ${s} before any delivery`);
        return;
      }
      if (['Delivered', 'FallbackJudging', 'Escalated', 'Defaulted'].includes(s)) {
        // A delivery is on record whose answer this seller never saw: follow the outcome.
        await this.save(d, { status: 'delivered', deliveredAt: settlement, retry: undefined });
        return;
      }
      if (s !== 'Held') {
        if (d.retry) await this.save(d, { retry: undefined });
        return;
      }
      if (settlement >= Date.parse(d.terms.timing.deliverBy)) {
        // Too late to deliver: the contract refuses it, and the buyer can reclaim its hold.
        await this.save(d, { status: 'failed', detail: `the seller did not deliver before deliverBy; the buyer can reclaim its hold (POST /v1/commitments/${d.commitmentId}/triggers/reclaim)`, retry: undefined });
        this.log(`test-seller: deal ${d.n} missed deliverBy`);
        return;
      }
      // Every operator must show Held before the work leaves the seller.
      const states = await Promise.all(a.sources().map((api) => a.call('GET', `/v1/commitments/${d.commitmentId}`, undefined, api)));
      if (!states.every((x) => x.escrowState === 'Held')) return;
      const csv = d.outcome === 'refund' ? BAD_CSV : GOOD_CSV;
      const { prepared, intent } = await a.prepareDelivery(d.terms, new TextEncoder().encode(csv));
      const { path, body } = await a.sign(prepared, intent);
      d = await this.save(d, { pending: { step: 'deliver', path, body, key: crypto.randomUUID() } });
    }
    try {
      await this.submit(d.pending!);
    } catch (e) {
      // A delivery the settlement layer already holds (an earlier try whose answer was lost) is done, not refused.
      if (!(e instanceof Refused) || !/invalid_state/.test(e.message)) throw e;
      const s = (await a.call('GET', `/v1/commitments/${d.commitmentId}`)).escrowState as string;
      if (['Offered', 'AcceptedByAdjudicator', 'Agreed', 'Held', 'Expired'].includes(s)) throw e;
    }
    await this.save(d, { status: 'delivered', deliveredAt: settlement, pending: undefined, retry: undefined });
    this.log(`test-seller: deal ${d.n} delivered (${d.outcome})`);
  }

  private async settleWhenDecided(d: Deal, settlement: number): Promise<void> {
    const a = this.agent;
    const state = (await a.call('GET', `/v1/commitments/${d.commitmentId}`)).escrowState as string;
    if (state === 'Settled') throw new Refused('the deal was settled by agreement on Crow');
    if (state !== 'Released' && state !== 'Refunded') {
      if (settlement - (d.deliveredAt ?? settlement) > 2 * HOUR) throw new Refused(`no decision within 2 hours of the delivery; the deal is ${state} on Crow`);
      if (d.retry) await this.save(d, { retry: undefined });
      return;
    }
    const events: J[] = (await a.call('GET', `/v1/commitments/${d.commitmentId}/events?limit=200`)).items;
    const what: Record<string, string> = { 'hold.funded': 'funded', 'delivery.submitted': 'delivered', 'judgment.decided': 'decided' };
    const seen = new Set<string>();
    const txs = events
      .sort((x, y) => x.seq - y.seq)
      .filter((e) => typeof e.payload?.tx === 'string' && what[e.type] && !seen.has(e.payload.tx) && seen.add(e.payload.tx))
      .map((e) => ({ step: what[e.type]!, tx: e.payload.tx as string }));
    await this.save(d, { status: state === 'Released' ? 'released' : 'refunded', txs, retry: undefined });
    this.log(`test-seller: deal ${d.n} ${state} ${d.commitmentId}`);
  }

  /** Once an hour: closed deals older than 7 days go, with their status tokens; only the deal counter stays. */
  private async prune(): Promise<void> {
    const now = this.now();
    if (now - this.prunedAt < HOUR) return;
    this.prunedAt = now;
    const old = [...(await this.s.list<Deal>({ prefix: 'd:' })).values()].filter((d) => !['received', 'offered', 'delivered'].includes(d.status) && now - d.updatedAt > 7 * DAY);
    for (let i = 0; i < old.length; i += 64) await this.s.delete(old.slice(i, i + 64).flatMap((d) => [`d:${pad(d.n)}`, `t:${d.tokenHash}`]));
  }
}
