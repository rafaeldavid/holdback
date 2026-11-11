// Seller: sell a service that prices by quote through Crow, with no protocol code of your own (T-318).
// You already run an HTTP API with a quote call, a start call and a result call. This adapter sits beside it:
//
//   1. Quote to offer.   A buyer POSTs {buyer, buyerEncryptionPublicKey, scope} to this adapter's /quote. The
//                        adapter checks the scope, asks your API for a price, fills your deal template with the
//                        scope, signs an offer that names the buyer, submits it, and answers
//                        {commitmentId, price, fees, expiresAt}. The buyer reads the commitment by its ID.
//   2. Hold to start.    The adapter follows the operators' event stream for `hold.funded`, and polls as well. It
//                        starts the job only when every operator shows the commitment Held.
//   3. Result to delivery. When your API returns the result, the adapter runs the adjudicator's first stage on
//                        those exact bytes (preflightDelivery). It encrypts and delivers only when the checks do
//                        not refuse them. Otherwise it holds the delivery, alerts you with each failed check
//                        (`alerts`), and waits for a fixed report until `deliverBy`: it fetches the result again
//                        on your schedule, or when you POST /deals/<commitmentId>/ready (`redelivery`, T-329).
//
// You change the configuration below and nothing else. Your signing key comes from the environment. The adapter
// signs your offer and your delivery with it; it never holds a buyer's key, and the operators only relay.
//
// Your API, as the adapter calls it (seller-adapter-stub.ts is a working example):
//   quote:  POST <quote>   {scope}                        -> {price: {token, amount}, quoteId?, deliverWithinSec?}
//           `amount` is base units as a decimal string ("2000000000" is 2,000.00 of a 6-decimal token).
//   start:  POST <start>   {commitmentId, quoteId, scope} -> {jobId}, sent with `Idempotency-Key: <commitmentId>`.
//           The same key must return the same job: after a crash the adapter sends the start again.
//   result: GET  <result>  ({jobId} in the address)       -> 202 while the job runs; 200 with the result's bytes.
//           After a refusal, the same address answers with your fixed report once you have one.
//
// It keeps a journal file of its deals, so a restart neither starts a job twice nor delivers twice: the journal
// records each job, and the settlement layer says whether a delivery is already there. Run one adapter per journal.
// It listens on 127.0.0.1 and makes public-level offers. Every quote makes the adapter sign an offer, so in production
// run it as seller-adapter-service.md says: behind an HTTPS proxy, with `quoteAuth` and `quoteRateLimit` set (T-324).
// The deliverable is data: the adapter parses it only inside the check library, and runs nothing from it, from
// the template or from the scope.
//
//   pnpm install && pnpm build
//   HOLDBACK_KEY=0x… HOLDBACK_OPERATORS=https://…,https://… node examples/seller-adapter.ts
//   node examples/seller-adapter.ts --sim     (test keys, adjudicators and operators from a running `pnpm sim`)
// Env: HOLDBACK_KEY (the seller's signing key) and HOLDBACK_OPERATORS (two or more, comma-separated). The adapter
// signs under the settlement layer those operators serve, which must be one pinned in verify.ts: SimChain, Sepolia,
// or the deployment in HOLDBACK_DEPLOYMENT. Your API prices in that layer's token: `tUSD` on SimChain, the token's
// address on a chain (discovery, `demo.token.id`). Test tokens only: nothing here is real money.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Hex } from 'viem';
import { preflightDelivery } from '@holdback/judgment';
import { plain } from '@holdback/testkit';
import { Agent } from './agent.ts';
import { convertReport, loadReportMapping, ReportNotConverted } from './report-converter.ts';
import { jcs, knownPins, operatorFeeOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** What one field of a buyer's scope may hold. Anything else is refused before your API or your key sees it. */
export type ScopeRule =
  | { type: 'string'; pattern: string }
  | { type: 'strings'; pattern: string; min: number; max: number } // distinct strings
  | { type: 'integer'; min: number; max: number };

/** At most `requests` requests in each window of `windowSec` seconds. Any positive whole numbers: your choice. */
export interface QuoteLimit {
  requests: number;
  windowSec: number;
}

export interface SellerAdapterConfig {
  /** Where this adapter listens for POST /quote. */
  port: number;
  /** The address it listens on. Default 127.0.0.1: only a proxy on the same machine reaches it. */
  host?: string;
  /**
   * You run a proxy in front (seller-adapter-service.md): take the client's address from the last X-Forwarded-For
   * entry, which the proxy appends. Set it only when nothing but your proxy can reach the adapter; otherwise a
   * client could name any address and escape `quoteRateLimit.perClient`. Default false: the socket's address.
   */
  trustProxy?: boolean;
  /**
   * Who may ask for a quote. Omit it and POST /quote is open to anyone who reaches it. `bearer`: a request must carry
   * `Authorization: Bearer <credential>` with one of the credentials in the environment variable `env`, comma-separated.
   * The credentials come from the environment only, and the adapter never logs them.
   */
  quoteAuth?: { kind: 'bearer'; env: string };
  /**
   * How many quotes the adapter answers. `perClient` counts by client address, before the credential is checked;
   * `overall` counts every request that passed `perClient` and `quoteAuth`. Past either, it answers 429 with
   * Retry-After and makes no offer. Omit it for no limit.
   */
  quoteRateLimit?: { perClient?: QuoteLimit; overall?: QuoteLimit };
  /** Your API's three addresses. `result` holds `{jobId}` where the job's ID goes. */
  sellerApi: { quote: string; start: string; result: string };
  /**
   * Your deal template: a JSON file with `deliverable`, `checks` and optionally `rubric`, in the shapes of an
   * offer. `{{field}}` stands for a scope field, and `{{field.length}}` for the size of a list.
   */
  template: string;
  /**
   * A mapping file (report-converter.ts) that turns your API's result into your template's JSON, so your API keeps
   * its own report shape. The adapter checks and delivers the converted bytes. Left out: it delivers the result as it comes.
   */
  reportMapping?: string;
  /**
   * How the adapter tells you it refused a result (T-329). Each alert is an `ALERT` line in the log and, when
   * `callback` is set, a POST of a JSON body to that address: the deal, `deliverBy`, and each check that failed or
   * could not be decided, with why. `secretEnv` names an environment variable that holds a secret; the adapter then
   * signs each body with HMAC-SHA256 in `X-Crow-Signature: sha256=<hex>`. It sends each alert once and waits at
   * most `timeoutMs` (default 10,000 ms); a callback that fails or hangs never holds up a deal.
   */
  alerts?: { callback?: string; secretEnv?: string; timeoutMs?: number };
  /**
   * How the adapter gets your fixed report after it refused one (T-329). It fetches the result again from
   * `sellerApi.result` every `refetchEverySec` seconds of settlement-layer time (0: at every poll; omitted: only
   * when you say), and at once when you POST /deals/<commitmentId>/ready with `Authorization: Bearer <credential>`,
   * one of the credentials in the environment variable `readyAuth.env`, comma-separated. It delivers the first
   * result its check run does not refuse, before `deliverBy`, and never delivers twice.
   */
  redelivery?: { refetchEverySec?: number; readyAuth?: { kind: 'bearer'; env: string } };
  /** The fields a scope must have, and no others. */
  scope: Record<string, ScopeRule>;
  clubId: string;
  /** The three adjudicators you name in every offer; the buyer agrees to them by funding. */
  adjudicators: { primary: string; fallback: string; appeal: string };
  /** Windows in whole seconds. Your API's `deliverWithinSec`, when a quote carries one, replaces this one. */
  timing: { offerExpiresInSec: number; fundWithinSec: number; deliverWithinSec: number; judgeWithinSec: number; fallbackWithinSec: number; appealWindowSec: number; appealDecideSec: number };
  /** The journal file. Its directory must exist. */
  journal: string;
  /** How often the adapter polls the operators and your API, in milliseconds. */
  pollMs: number;
  /** Follow the first operator's event stream to learn of a funded hold sooner. Default true. */
  stream?: boolean;
  log?: (line: string) => void;
}

// ---- Configuration: change this, and nothing below it. ----
export const config: SellerAdapterConfig = {
  port: 8791,
  sellerApi: {
    quote: 'http://127.0.0.1:8790/quote',
    start: 'http://127.0.0.1:8790/jobs',
    result: 'http://127.0.0.1:8790/jobs/{jobId}/result',
  },
  template: fileURLToPath(new URL('./seller-adapter.template.json', import.meta.url)),
  scope: {
    commit: { type: 'string', pattern: '^[0-9a-f]{40}$' },
    files: { type: 'strings', pattern: '^[A-Za-z0-9_./-]{1,200}$', min: 1, max: 50 },
    lines: { type: 'integer', min: 1, max: 10_000_000 },
  },
  clubId: 'sim-club',
  adjudicators: {
    primary: '0x0000000000000000000000000000000000000000', // yours; --sim reads the sim's three
    fallback: '0x0000000000000000000000000000000000000000',
    appeal: '0x0000000000000000000000000000000000000000',
  },
  // 15 minutes to accept, 30 to fund, 7 days to deliver, 2 minutes for each adjudicator, 5 for appeals.
  timing: { offerExpiresInSec: 900, fundWithinSec: 1800, deliverWithinSec: 604_800, judgeWithinSec: 120, fallbackWithinSec: 120, appealWindowSec: 300, appealDecideSec: 300 },
  journal: 'seller-adapter.journal.json',
  pollMs: 5000,
  // After a refused result, fetch it again every 10 minutes until deliverBy. To be told, and to say when it is fixed:
  //   alerts: { callback: 'https://ops.example/crow-alerts', secretEnv: 'HOLDBACK_ALERT_SECRET' },
  //   redelivery: { refetchEverySec: 600, readyAuth: { kind: 'bearer', env: 'HOLDBACK_READY_CREDENTIALS' } },
  redelivery: { refetchEverySec: 600 },
  // Behind the HTTPS proxy of seller-adapter-service.md, for example:
  //   trustProxy: true,
  //   quoteAuth: { kind: 'bearer', env: 'HOLDBACK_QUOTE_CREDENTIALS' },
  //   quoteRateLimit: { perClient: { requests: 10, windowSec: 60 }, overall: { requests: 100, windowSec: 60 } },
};
// ---- End of configuration. ----

export type Stage = 'offered' | 'starting' | 'started' | 'refused' | 'delivering' | 'delivered' | 'closed';
/**
 * One deal in the journal. `refused`: the last result failed preflight; the adapter holds the delivery and waits
 * for a fixed report until `deliverBy`. `delivering`: recorded just before the delivery call, so a restart reads
 * the settlement layer before it delivers again.
 */
export interface Deal {
  id: Hex;
  stage: Stage;
  terms: J;
  scope: J;
  quoteId?: string;
  jobId?: string;
  note?: string;
  /** Distinct results refused so far (T-329). */
  refusals?: number;
  /** SHA-256 of the last refused result's bytes, hex: the same bytes again raise no second alert. */
  refusedSha256?: string;
  /** When to fetch the result again, in settlement-layer time; absent when only the seller's "ready" fetches it. */
  nextFetchAt?: string | undefined;
  /** The seller said a fixed report is ready: the next pass fetches it. */
  ready?: boolean;
}
interface Journal {
  deals: Record<string, Deal>;
  /** Answers by Idempotency-Key, with the hash of the request they answered. */
  quotes: Record<string, { bodyHash: string; answer: J }>;
}

export interface RunningAdapter {
  url: string;
  /** A copy of the journal's deals. */
  deals(): Deal[];
  /** Whether the event stream is connected. */
  following(): boolean;
  close(): Promise<void>;
}

class Refused extends Error {
  readonly status: number;
  readonly type: string;
  readonly headers: Record<string, string>;
  constructor(status: number, type: string, detail: string, headers: Record<string, string> = {}) {
    super(detail);
    this.status = status;
    this.type = type;
    this.headers = headers;
  }
}

const BASE_UNITS = /^(0|[1-9][0-9]{0,77})$/;
const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)(\.length)?\}\}/g;
const BEFORE_HOLD = ['Offered', 'AcceptedByAdjudicator', 'Agreed'];
const MAX_BODY_BYTES = 65_536;

/** Why a scope breaks the configured rules, or null when it keeps them. */
function scopeError(scope: J, rules: Record<string, ScopeRule>): string | null {
  if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) return 'scope must be an object';
  for (const k of Object.keys(scope)) if (!Object.hasOwn(rules, k)) return `scope has a field this seller does not take: ${plain(k).slice(0, 60)}`;
  for (const [k, rule] of Object.entries(rules)) {
    const v = scope[k];
    if (rule.type === 'integer') {
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < rule.min || v > rule.max) return `scope.${k} must be a whole number from ${rule.min} to ${rule.max}`;
    } else if (rule.type === 'string') {
      if (typeof v !== 'string' || !new RegExp(rule.pattern).test(v)) return `scope.${k} must be a string matching ${rule.pattern}`;
    } else {
      const re = new RegExp(rule.pattern);
      if (!Array.isArray(v) || v.length < rule.min || v.length > rule.max || !v.every((s) => typeof s === 'string' && re.test(s)) || new Set(v).size !== v.length) {
        return `scope.${k} must be ${rule.min} to ${rule.max} distinct strings, each matching ${rule.pattern}`;
      }
    }
  }
  return null;
}

/**
 * The template with each placeholder replaced by the scope's value. One pass: a scope value is never read as a
 * placeholder. Exported so a buyer can fill the same template with its own scope and compare the offer (audit-deal.ts).
 */
export function fill(node: J, scope: J): J {
  const value = (name: string, length: string | undefined): J => (length ? scope[name].length : scope[name]);
  if (typeof node === 'string') {
    const whole = new RegExp(`^${PLACEHOLDER.source}$`).exec(node);
    if (whole) return structuredClone(value(whole[1]!, whole[2])); // the value itself: a string, a number or a list
    return node.replace(PLACEHOLDER, (_m, name: string, length?: string) => {
      const v = value(name, length);
      return Array.isArray(v) ? v.join(', ') : String(v);
    });
  }
  if (Array.isArray(node)) return node.map((n) => fill(n, scope));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v, scope)]));
  return node;
}

function loadTemplate(c: SellerAdapterConfig): J {
  const text = readFileSync(c.template, 'utf8');
  const template = JSON.parse(text);
  if (!template.deliverable || !Array.isArray(template.checks)) throw new Error(`${c.template} needs "deliverable" and "checks"`);
  for (const [, name, length] of text.matchAll(PLACEHOLDER)) {
    const rule = c.scope[name!];
    if (!rule) throw new Error(`${c.template} uses {{${name}}}, which the scope rules do not define`);
    if (length && rule.type !== 'strings') throw new Error(`${c.template} uses {{${name}.length}}, and ${name} is not a list`);
  }
  return template;
}

async function readJson(req: IncomingMessage): Promise<J> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Refused(413, 'invalid_request', `the request is larger than ${MAX_BODY_BYTES} bytes`);
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Refused(400, 'invalid_request', 'the request body is not JSON');
  }
}

/** A fixed-window count per client: 0 when a request is admitted, otherwise the whole seconds until the window ends. */
function counter(limit: QuoteLimit): (who: string, now: number) => number {
  const windowMs = limit.windowSec * 1000;
  const windows = new Map<string, { start: number; count: number }>();
  return (who, now) => {
    let w = windows.get(who);
    if (!w || now - w.start >= windowMs) {
      if (windows.size >= 10_000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k); // forget ended windows
      w = { start: now, count: 0 };
      windows.set(who, w);
    }
    if (w.count >= limit.requests) return Math.max(1, Math.ceil((w.start + windowMs - now) / 1000));
    w.count++;
    return 0;
  };
}

/** The client's address: the last X-Forwarded-For entry, which your proxy appends, or the socket's. */
function clientOf(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const last = (Array.isArray(header) ? header.join(',') : (header ?? '')).split(',').map((s) => s.trim()).filter(Boolean).at(-1);
    if (last) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest();

/**
 * The quote route's rate limit and authentication, from the seller's configuration (T-324). The values are the
 * seller's own (D31): any positive whole number. Returns, for each request, the refusal or null to go on.
 */
function gate(c: SellerAdapterConfig, env: Readonly<Record<string, string | undefined>>): (req: IncomingMessage) => Refused | null {
  const limits = c.quoteRateLimit ?? {};
  for (const name of ['perClient', 'overall'] as const) {
    const l = limits[name];
    if (l && !(Number.isSafeInteger(l.requests) && l.requests > 0 && Number.isSafeInteger(l.windowSec) && l.windowSec > 0)) {
      throw new Error(`quoteRateLimit.${name} needs requests and windowSec as positive whole numbers`);
    }
  }
  let accepted: Buffer[] | null = null; // SHA-256 of each credential: compared in constant time, never logged
  if (c.quoteAuth) {
    if (c.quoteAuth.kind !== 'bearer') throw new Error('quoteAuth.kind must be "bearer"');
    const list = (env[c.quoteAuth.env] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) throw new Error(`set ${c.quoteAuth.env} to one or more quote credentials, comma-separated`);
    accepted = list.map(sha256);
  }
  const perClient = limits.perClient ? counter(limits.perClient) : null;
  const overall = limits.overall ? counter(limits.overall) : null;
  const limited = (wait: number) => new Refused(429, 'rate_limited', `too many quote requests; try again in ${wait} s`, { 'retry-after': String(wait) });
  return (req) => {
    const now = Date.now();
    // Per client first, so guessing credentials counts against the guesser.
    const waitClient = perClient?.(clientOf(req, c.trustProxy === true), now) ?? 0;
    if (waitClient) return limited(waitClient);
    if (accepted) {
      const given = /^bearer ([\x21-\x7e]+)$/i.exec(req.headers.authorization ?? '')?.[1];
      const digest = given === undefined ? null : sha256(given);
      if (!digest || !accepted.some((a) => timingSafeEqual(a, digest))) {
        return new Refused(401, 'unauthorized', 'this quote route needs Authorization: Bearer <credential>', { 'www-authenticate': 'Bearer realm="quote"' });
      }
    }
    const waitAll = overall?.('all', now) ?? 0;
    return waitAll ? limited(waitAll) : null;
  };
}

/** Whether a request carries `Authorization: Bearer <credential>` with one of the accepted digests, compared in constant time. */
function bearerOk(req: IncomingMessage, accepted: Buffer[]): boolean {
  const given = /^bearer ([\x21-\x7e]+)$/i.exec(req.headers.authorization ?? '')?.[1];
  const digest = given === undefined ? null : sha256(given);
  return digest !== null && accepted.some((a) => timingSafeEqual(a, digest));
}

/**
 * The alert and redelivery settings (T-329), checked before anything is signed. The values are the seller's own
 * (D31): any whole number. The callback's address comes from the configuration only, and its secret and the ready
 * credentials from the environment only; the adapter never logs them.
 */
function refusalSettings(c: SellerAdapterConfig, env: Readonly<Record<string, string | undefined>>) {
  const a = c.alerts ?? {};
  let callback: string | undefined;
  if (a.callback !== undefined) {
    let url: URL | undefined;
    try {
      url = new URL(a.callback);
    } catch {
      // refused below
    }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) throw new Error('alerts.callback must be an http or https address');
    callback = url.href;
  }
  if (a.timeoutMs !== undefined && !(Number.isSafeInteger(a.timeoutMs) && a.timeoutMs > 0)) throw new Error('alerts.timeoutMs must be a positive whole number of milliseconds');
  let secret: string | undefined;
  if (a.secretEnv !== undefined) {
    secret = env[a.secretEnv];
    if (!secret) throw new Error(`set ${a.secretEnv} to the alert callback's signing secret`);
  }
  const r = c.redelivery ?? {};
  if (r.refetchEverySec !== undefined && !(Number.isSafeInteger(r.refetchEverySec) && r.refetchEverySec >= 0)) throw new Error('redelivery.refetchEverySec must be a whole number of seconds, 0 or more');
  let ready: Buffer[] | null = null;
  if (r.readyAuth) {
    if (r.readyAuth.kind !== 'bearer') throw new Error('redelivery.readyAuth.kind must be "bearer"');
    const list = (env[r.readyAuth.env] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) throw new Error(`set ${r.readyAuth.env} to one or more ready credentials, comma-separated`);
    ready = list.map(sha256);
  }
  return { callback, secret, timeoutMs: a.timeoutMs ?? 10_000, refetchEverySec: r.refetchEverySec, ready };
}

/** A check run's failed and undecided checks, for an alert: the check, whether it is required, and why. */
type FailedCheck = { checkId: string; required: boolean; outcome: 'fail' | 'open'; detail?: string };
const checkLine = (f: FailedCheck) => `${f.outcome === 'open' ? 'OPEN' : 'FAIL'} ${plain(f.checkId)} (${f.required ? 'required' : 'optional'})${f.detail === undefined ? '' : `: ${plain(f.detail)}`}`;

/**
 * Starts the adapter: the /quote route, the event stream and the polling loop. The key and the operators come
 * from `env` (HOLDBACK_KEY, HOLDBACK_OPERATORS), never from the configuration.
 */
export async function startSellerAdapter(c: SellerAdapterConfig, env: Readonly<Record<string, string | undefined>> = process.env): Promise<RunningAdapter> {
  const admit = gate(c, env); // refuses a malformed limit or a missing credential before anything is signed
  const refusal = refusalSettings(c, env);
  const key = env['HOLDBACK_KEY'];
  const operators = (env['HOLDBACK_OPERATORS'] ?? '').split(',').filter(Boolean);
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('set HOLDBACK_KEY to the seller\'s signing key (0x and 64 hex characters)');
  const reader = new Agent(operators, key as Hex, new Uint8Array(32)); // sealing a delivery needs no secret encryption key
  reader.sources(); // refuses fewer than two operators at distinct origins
  // The settlement layer is the one every operator serves, and it must be one pinned in verify.ts (SimChain, Sepolia,
  // or HOLDBACK_DEPLOYMENT), as the buyer's signer pins it (buyer-signer.ts). The seller signs under that domain.
  const exact = (d: J) => jcs({ ...d, verifyingContract: String(d?.verifyingContract).toLowerCase() });
  const served = await reader.trusted('/.well-known/holdback.json', (x) => x.domain);
  const pins = knownPins();
  const pin = pins.find((p) => exact(p.domain) === exact(served));
  if (!pin) throw new Error(`the operators serve EIP-712 domain ${plain(jcs(served ?? null)).slice(0, 300)}, not one pinned in verify.ts (${pins.map((p) => jcs(p.domain)).join(' or ')})`);
  const seller = new Agent(operators, key as Hex, new Uint8Array(32), pin.domain, pin.chain);
  const token = pin.token; // the one token this settlement layer holds
  const template = loadTemplate(c);
  const reportMapping = c.reportMapping === undefined ? undefined : loadReportMapping(c.reportMapping);
  const log = (line: string) => (c.log ?? console.log)(`${new Date().toISOString()} ${line}`);
  const journal: Journal = existsSync(c.journal) ? JSON.parse(readFileSync(c.journal, 'utf8')) : { deals: {}, quotes: {} };
  /** Writes the journal whole, then renames it into place: a crash leaves the old file or the new one. */
  const save = () => {
    writeFileSync(`${c.journal}.tmp`, JSON.stringify(journal, null, 2));
    renameSync(`${c.journal}.tmp`, c.journal);
  };
  const record = (deal: Deal, change: Partial<Deal>) => {
    Object.assign(deal, change);
    save();
    log(`${deal.id} is ${deal.stage}${deal.note ? `: ${plain(deal.note)}` : ''}.`);
  };
  /** Your API. A failure names the call and the status only; the body is your API's and may be anything. */
  const api = async (what: string, url: string, init: RequestInit = {}): Promise<Response> => {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), ...init });
    if (res.status !== 200 && res.status !== 202) throw new Error(`the seller API answered ${res.status} to ${what}`);
    return res;
  };
  const post = (what: string, url: string, body: unknown, headers: Record<string, string> = {}) => api(what, url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  // ---- 1. Quote to offer ----
  async function offerFor(buyer: string, buyerEncryptionPublicKey: string, scope: J): Promise<J> {
    let quoted: J;
    try {
      quoted = await (await post('the quote', c.sellerApi.quote, { scope })).json();
    } catch (e) {
      log(`Quote failed: ${plain((e as Error).message)}.`);
      throw new Refused(502, 'seller_api_failed', 'the seller could not price this scope');
    }
    const price = quoted?.price;
    // Money is base units as a decimal string, never a number (hard rule): refuse anything else from the seller API.
    if (!price || typeof price.token !== 'string' || typeof price.amount !== 'string' || !BASE_UNITS.test(price.amount)) {
      log('Quote refused: the seller API\'s price is not {token, amount} with the amount in base units as a decimal string.');
      throw new Refused(502, 'seller_api_failed', 'the seller could not price this scope');
    }
    // The settlement layer holds one token. A price in another is a seller API set up for another layer.
    if (price.token.toLowerCase() !== token.id.toLowerCase()) {
      log(`Quote refused: the seller API priced in ${plain(price.token).slice(0, 80)}; this settlement layer's token is ${token.id} (${token.symbol}).`);
      throw new Refused(502, 'seller_api_failed', 'the seller could not price this scope');
    }
    const deliverWithinSec = quoted.deliverWithinSec;
    if (deliverWithinSec !== undefined && (!Number.isSafeInteger(deliverWithinSec) || deliverWithinSec < 0)) throw new Refused(502, 'seller_api_failed', 'the seller could not price this scope');
    const filled = fill(template, scope);
    const panel = Array.isArray(filled.rubric?.criteria) && filled.rubric.criteria.length > 0;
    let offer;
    try {
      offer = await seller.offer({
        template: panel ? 'default' : 'checks-only',
        clubId: c.clubId,
        seller: seller.address,
        buyer: { address: buyer, encryptionPublicKey: buyerEncryptionPublicKey },
        adjudicators: c.adjudicators,
        price: { token: price.token, amount: price.amount },
        deliverable: filled.deliverable,
        checks: filled.checks,
        ...(panel ? { rubric: filled.rubric } : {}),
        timing: { ...c.timing, ...(deliverWithinSec === undefined ? {} : { deliverWithinSec }) },
      });
    } catch (e) {
      log(`Offer failed: ${plain((e as Error).message)}.`);
      throw new Refused(502, 'offer_failed', 'the seller could not make this offer');
    }
    const { id, terms } = offer;
    journal.deals[id] = { id, stage: 'offered', terms, scope, ...(typeof quoted.quoteId === 'string' ? { quoteId: quoted.quoteId } : {}) };
    save();
    log(`${id} is offered to ${terms.buyer} for ${terms.price.amount} base units of ${plain(terms.price.token)}; the offer expires ${terms.timing.offerExpiresAt}.`);
    // What the buyer pays on top of the price: the adjudication fee, and the operators' fee when they publish one.
    const schedule = await seller.operatorFeeSchedule();
    const operatorFee = schedule ? operatorFeeOf(terms.price, schedule) : 0n;
    const operator = schedule ? { token: schedule.token, amount: operatorFee.toString() } : null;
    // `total` is what the buyer funds: the price plus both fees. The buyer computes it again from the terms itself.
    const total = { token: terms.price.token, amount: (BigInt(terms.price.amount) + BigInt(terms.adjudication.fee.amount) + operatorFee).toString() };
    return { commitmentId: id, price: terms.price, fees: { adjudication: terms.adjudication.fee, operator, total }, expiresAt: terms.timing.offerExpiresAt };
  }

  const inFlight = new Map<string, { bodyHash: string; answer: Promise<J> }>();
  async function quote(req: IncomingMessage): Promise<J> {
    const body = await readJson(req);
    const { buyer, buyerEncryptionPublicKey, scope } = body ?? {};
    if (typeof buyer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(buyer)) throw new Refused(400, 'invalid_request', 'buyer must be an address: 0x and 40 hex characters');
    if (typeof buyerEncryptionPublicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(buyerEncryptionPublicKey)) throw new Refused(400, 'invalid_request', 'buyerEncryptionPublicKey must be an x25519 public key, base64url, 43 characters');
    const wrong = scopeError(scope, c.scope);
    if (wrong) throw new Refused(400, 'invalid_request', wrong);
    const idempotencyKey = req.headers['idempotency-key'];
    if (idempotencyKey === undefined) return offerFor(buyer.toLowerCase(), buyerEncryptionPublicKey, scope);
    // The same key with the same body replays the answer; with another body it is a conflict.
    if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new Refused(400, 'invalid_request', 'Idempotency-Key must be 1 to 200 printable characters');
    const bodyHash = createHash('sha256').update(jcs({ buyer: buyer.toLowerCase(), buyerEncryptionPublicKey, scope })).digest('hex');
    const seen = journal.quotes[idempotencyKey] ?? inFlight.get(idempotencyKey);
    if (seen && seen.bodyHash !== bodyHash) throw new Refused(409, 'idempotency_conflict', 'this Idempotency-Key was used with another request');
    if (seen) return seen.answer;
    const answer = offerFor(buyer.toLowerCase(), buyerEncryptionPublicKey, scope);
    inFlight.set(idempotencyKey, { bodyHash, answer });
    try {
      journal.quotes[idempotencyKey] = { bodyHash, answer: await answer };
      save();
      return await answer;
    } finally {
      inFlight.delete(idempotencyKey);
    }
  }

  // ---- 2 and 3. Funded hold to start, result to delivery ----
  /** Moves one deal as far as it can go now. A read every operator must answer the same way decides each step. */
  async function advance(deal: Deal): Promise<void> {
    const id = deal.id;
    const escrowState = () => seller.trusted<string>(`/v1/commitments/${id}`, (x) => x.escrowState);
    if (deal.stage === 'offered') {
      const state = await escrowState();
      if (BEFORE_HOLD.includes(state)) return;
      if (state !== 'Held') return record(deal, { stage: 'closed', note: `the offer ended ${state} with no job started` });
      record(deal, { stage: 'starting', note: 'every operator shows the hold funded' }); // recorded before the call, so a crash here repeats it under the same key
    }
    if (deal.stage === 'starting') {
      const started = (await (await post('the start', c.sellerApi.start, { commitmentId: id, ...(deal.quoteId ? { quoteId: deal.quoteId } : {}), scope: deal.scope }, { 'idempotency-key': id })).json()) as J;
      if (typeof started?.jobId !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(started.jobId)) throw new Error('the seller API\'s start answer has no usable jobId');
      record(deal, { stage: 'started', jobId: started.jobId, note: `job ${started.jobId}` });
    }
    if (deal.stage === 'started' || deal.stage === 'refused' || deal.stage === 'delivering') {
      // The settlement layer, not the journal, says whether a delivery is already there. After a crash at the
      // delivery call (`delivering`) the adapter reads it even while the state says Held: a chain's state may lag.
      const state = await escrowState();
      if (state !== 'Held' || deal.stage === 'delivering') {
        const delivered = await seller.trusted<boolean>(`/v1/commitments/${id}/events?limit=200`, (x) => x.items.some((e: J) => e.type === 'delivery.submitted'));
        if (delivered) return record(deal, { stage: 'delivered', note: `the settlement layer already holds the delivery (${state})` });
        if (state !== 'Held') return record(deal, { stage: 'closed', note: `the deal ended ${state} with no delivery` });
      }
      const deliverBy: string = deal.terms.timing.deliverBy;
      const now = await seller.settlementNow(); // settlement-layer time, as every operator reports it
      if (Date.parse(deliverBy) <= now) {
        if (!deal.refusals) return record(deal, { stage: 'closed', note: `the delivery deadline ${deliverBy} passed` });
        const said = `deliverBy ${deliverBy} passed with no fixed report delivered, after ${deal.refusals} refused ${deal.refusals === 1 ? 'result' : 'results'}; the adapter stopped, and the buyer may reclaim the hold`;
        record(deal, { stage: 'closed', ready: false, note: said });
        return alert({ type: 'delivery.deadline_passed', commitmentId: id, deliverBy, attempts: deal.refusals }, said);
      }
      if (deal.stage === 'refused') {
        const due = deal.ready === true || (refusal.refetchEverySec !== undefined && (deal.nextFetchAt === undefined || Date.parse(deal.nextFetchAt) <= now));
        if (!due) return; // the delivery waits for the seller's fixed report
      }
      // The address is the configuration's; only the job's ID, from your API, goes into it.
      const res = await api('the result', c.sellerApi.result.replace('{jobId}', encodeURIComponent(deal.jobId!)));
      if (res.status === 202) return; // the job still runs
      const result = new Uint8Array(await res.arrayBuffer());
      const resultSha256 = createHash('sha256').update(result).digest('hex');
      let bytes = result;
      if (reportMapping) {
        // Your report in the template's shape (T-323). A report the mapping cannot convert is never delivered.
        try {
          bytes = convertReport(reportMapping, result);
          log(`${id} converted the result with the report mapping: ${result.length} bytes to ${bytes.length} bytes.`);
        } catch (e) {
          if (!(e instanceof ReportNotConverted)) throw e;
          return refuse(deal, now, resultSha256, { result: 'not_converted', conversion: e.message, checks: [] }, `the report mapping cannot convert it: ${e.message}`);
        }
      }
      // The adjudicator's intake rules and stage 1, on the exact bytes that would be delivered (T-316).
      const format = deal.terms.deliverable.format;
      const pre = preflightDelivery({ plaintext: bytes, mime: format, format, acceptance: deal.terms.acceptance });
      const open = new Set(pre.inconclusive);
      const failed: FailedCheck[] = pre.deterministic
        .filter((o) => !o.passed || open.has(o.checkId))
        .map((o) => ({ checkId: o.checkId, required: o.required, outcome: open.has(o.checkId) ? 'open' : 'fail', ...(o.detail === undefined ? {} : { detail: o.detail }) }));
      log(`${id} preflight: ${pre.result}, ${pre.bytes} bytes, ${pre.plaintextSha256}.`);
      if (pre.refused) log(`  REFUSED ${pre.refused.code}: ${plain(pre.refused.detail)}`);
      for (const f of failed) log(`  ${checkLine(f)}`);
      if (pre.result !== 'accept' && pre.result !== 'panel') {
        const why = pre.result === 'reject' ? 'the adjudicator would reject it and refund the buyer' : 'a check cannot be decided, so the deal would escalate';
        const detail = { result: pre.result, plaintextSha256: pre.plaintextSha256, bytes: pre.bytes, ...(pre.refused ? { refused: { code: pre.refused.code, detail: pre.refused.detail } } : {}), checks: failed };
        return refuse(deal, now, resultSha256, detail, why);
      }
      // Recorded before the call: a crash between the call and its record makes the next start read the
      // settlement layer first, so the adapter never delivers twice.
      const attempt = (deal.refusals ?? 0) + 1;
      record(deal, { stage: 'delivering', ready: false, note: `delivering ${pre.bytes} bytes, ${pre.plaintextSha256}` });
      await seller.deliver(deal.terms, bytes);
      record(deal, { stage: 'delivered', note: `${pre.bytes} bytes, ${pre.plaintextSha256}` });
      if (deal.refusals) alert({ type: 'delivery.fixed', commitmentId: id, attempt, plaintextSha256: pre.plaintextSha256, bytes: pre.bytes }, `the fixed report passed the check run and is delivered, ${pre.bytes} bytes, ${pre.plaintextSha256}`);
    }
  }

  // ---- Refused results: hold the delivery, tell the seller, wait for the fixed report (T-329) ----
  const alertsAbort = new AbortController();
  const alertsInFlight = new Set<Promise<void>>();
  /**
   * Tells the seller: an `ALERT` log line always, and a POST to the configured callback when there is one. The
   * POST runs beside the deal loop and is never awaited by it; a failure is logged and the line above stays the record.
   */
  function alert(body: { type: string; commitmentId: string; attempt?: number } & Record<string, unknown>, summary: string): void {
    log(`ALERT ${body.commitmentId} ${body.type}${body.attempt === undefined ? '' : ` (attempt ${body.attempt})`}: ${summary}`);
    if (!refusal.callback) return;
    const text = JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (refusal.secret) headers['x-crow-signature'] = `sha256=${createHmac('sha256', refusal.secret).update(text, 'utf8').digest('hex')}`;
    const sent: Promise<void> = fetch(refusal.callback, { method: 'POST', headers, body: text, redirect: 'error', signal: AbortSignal.any([alertsAbort.signal, AbortSignal.timeout(refusal.timeoutMs)]) })
      .then(async (res) => {
        await res.body?.cancel();
        if (!res.ok) log(`${body.commitmentId} the alert callback answered ${res.status} to ${body.type}; the ALERT line is the record.`);
      })
      .catch((e: Error & { cause?: { code?: string } }) => {
        if (alertsAbort.signal.aborted) return;
        log(`${body.commitmentId} the alert callback failed for ${body.type}: ${plain(e.message)}${e.cause?.code ? ` (${plain(e.cause.code)})` : ''}; the ALERT line is the record.`);
      })
      .finally(() => alertsInFlight.delete(sent));
    alertsInFlight.add(sent);
  }

  /** Records a refused result and alerts the seller once for each distinct result. The delivery waits. */
  function refuse(deal: Deal, now: number, resultSha256: string, detail: { result: string; checks: FailedCheck[] } & Record<string, unknown>, why: string): void {
    const deliverBy: string = deal.terms.timing.deliverBy;
    const every = refusal.refetchEverySec;
    const nextFetchAt = every === undefined ? undefined : new Date(now + every * 1000).toISOString();
    const ways = [every === undefined ? null : `fetches the result again at ${nextFetchAt}`, refusal.ready ? `fetches it when you POST /deals/${deal.id}/ready` : null].filter(Boolean);
    const waits = ways.length
      ? `The adapter holds the delivery until ${deliverBy} and ${ways.join(', and ')}`
      : `The adapter holds the delivery until ${deliverBy}; set redelivery to have it fetch a fixed report, or deliver a fixed file by hand with check-delivery.ts and seal.ts`;
    if (deal.refusedSha256 === resultSha256) {
      // The same bytes as last time: the seller has been told. Wait for the next fetch.
      Object.assign(deal, { stage: 'refused', ready: false, nextFetchAt });
      save();
      return;
    }
    const attempt = (deal.refusals ?? 0) + 1;
    record(deal, { stage: 'refused', refusals: attempt, refusedSha256: resultSha256, ready: false, nextFetchAt, note: `the result is not delivered: ${why}. ${waits}` });
    const reasons = [
      ...(typeof detail['refused'] === 'object' && detail['refused'] ? [`REFUSED ${plain(String((detail['refused'] as J).code))}: ${plain(String((detail['refused'] as J).detail))}`] : []),
      ...detail.checks.map(checkLine),
      ...(typeof detail['conversion'] === 'string' ? [`NOT CONVERTED ${plain(detail['conversion'])}`] : []),
    ];
    alert({ type: 'delivery.refused', commitmentId: deal.id, deliverBy, attempt, ...detail, nextFetchAt: nextFetchAt ?? null }, `${reasons.join('; ') || plain(why)}. ${waits}.`);
  }

  let closed = false;
  let running: Promise<void> | undefined;
  let again = false;
  const lastError = new Map<string, string>();
  async function pass(): Promise<void> {
    for (const deal of Object.values(journal.deals)) {
      if (closed) return;
      if (!['offered', 'starting', 'started', 'refused', 'delivering'].includes(deal.stage)) continue;
      try {
        await advance(deal);
        lastError.delete(deal.id);
      } catch (e) {
        const message = plain((e as Error).message);
        if (!closed && lastError.get(deal.id) !== message) log(`${deal.id} waits at ${deal.stage}: ${message}. The adapter tries again at the next poll.`);
        lastError.set(deal.id, message);
      }
    }
  }
  /** Runs a pass now, or one more after the pass in progress. Passes never overlap. */
  const wake = () => {
    if (closed) return;
    if (running) return void (again = true);
    running = (async () => {
      do {
        again = false;
        await pass();
      } while (again && !closed);
    })().finally(() => (running = undefined));
  };

  // The event stream only wakes the loop; the trusted read in advance() decides. Polling covers a stream that drops.
  const abort = new AbortController();
  let following = false;
  async function follow(): Promise<void> {
    const node = seller.operators[0]!;
    while (!closed) {
      try {
        const head = ((await (await fetch(`${node}/.well-known/holdback.json`, { signal: abort.signal })).json()) as J).head.eventSeq;
        const res = await fetch(`${node}/v1/events?from=${head}`, { signal: abort.signal });
        if (!res.ok || !res.body) throw new Error(`the event stream answered ${res.status}`);
        following = true;
        const text = new TextDecoder();
        let buffer = '';
        for await (const chunk of res.body) {
          buffer += text.decode(chunk, { stream: true });
          for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (!/^event: hold\.funded$/m.test(frame)) continue;
            const data = /^data: (.*)$/m.exec(frame)?.[1];
            if (data && Object.hasOwn(journal.deals, String(JSON.parse(data).commitmentId))) wake();
          }
        }
      } catch {
        // Reconnect below. Polling finds a funded hold in the meantime.
      }
      following = false;
      if (!closed) await new Promise((r) => setTimeout(r, c.pollMs));
    }
  }

  /**
   * POST /deals/<commitmentId>/ready: the seller says its fixed report is ready (T-329). It takes no body: the
   * adapter fetches the report from the result address in its configuration, never from the request.
   */
  function readySignal(req: IncomingMessage, commitmentId: string, send: (status: number, body: unknown, headers?: Record<string, string>) => void): void {
    req.resume();
    if (req.method !== 'POST') return send(405, { type: 'method_not_allowed', detail: 'this route takes POST' });
    if (!bearerOk(req, refusal.ready!)) return send(401, { type: 'unauthorized', detail: 'this route needs Authorization: Bearer <credential>' }, { 'www-authenticate': 'Bearer realm="ready"' });
    const id = commitmentId.toLowerCase();
    const deal = Object.hasOwn(journal.deals, id) ? journal.deals[id]! : undefined;
    if (!deal) return send(404, { type: 'not_found', detail: 'this adapter holds no such deal' });
    if (deal.stage !== 'refused') return send(409, { type: 'not_waiting', detail: `the deal is ${deal.stage}, not waiting for a fixed report` });
    deal.ready = true;
    save();
    log(`${id} the seller says a fixed report is ready; the adapter fetches the result now.`);
    wake();
    return send(202, { commitmentId: id, stage: deal.stage, detail: 'the adapter fetches the result again now' });
  }

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body));
    const path = new URL(req.url ?? '/', 'http://adapter').pathname;
    const readyFor = refusal.ready ? /^\/deals\/(0x[0-9a-fA-F]{64})\/ready$/.exec(path)?.[1] : undefined;
    if (readyFor) return void readySignal(req, readyFor, send);
    if (path !== '/quote') return void send(404, { type: 'not_found', detail: 'this adapter serves POST /quote' });
    if (req.method !== 'POST') return void send(405, { type: 'method_not_allowed', detail: 'this adapter serves POST /quote' });
    const refused = admit(req); // the rate limit and the credential, before the body is read
    if (refused) {
      req.resume();
      return void send(refused.status, { type: refused.type, detail: refused.message }, refused.headers);
    }
    quote(req).then(
      (answer) => send(200, answer),
      (e: Error) => {
        if (e instanceof Refused) return send(e.status, { type: e.type, detail: e.message }, e.headers);
        log(`Quote failed: ${plain(e.message)}.`);
        return send(500, { type: 'internal', detail: 'the adapter could not answer' });
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(c.port, c.host ?? '127.0.0.1', resolve);
  });
  const bound = server.address() as AddressInfo;
  const url = `http://${bound.family === 'IPv6' ? `[${bound.address}]` : bound.address}:${bound.port}`;
  const timer = setInterval(wake, c.pollMs);
  const stream = c.stream === false ? Promise.resolve() : follow();
  wake(); // deals the journal left open
  log(`Seller adapter for ${seller.address} serves POST ${url}/quote; journal ${plain(c.journal)}, ${Object.keys(journal.deals).length} deals.`);
  log(`A refused result alerts by the log${refusal.callback ? ' and the callback' : ''}${refusal.secret ? ', signed' : ''}; the adapter fetches it again ${refusal.refetchEverySec === undefined ? 'only when you say' : `every ${refusal.refetchEverySec} s`}${refusal.ready ? ', and on POST /deals/<commitmentId>/ready' : ''}, until deliverBy.`);
  const limitText = (l: QuoteLimit | undefined) => (l ? `${l.requests} per ${l.windowSec} s` : 'none');
  log(`The quote route takes ${c.quoteAuth ? `a bearer credential from ${plain(c.quoteAuth.env)}` : 'no credential'}; rate limit per client ${limitText(c.quoteRateLimit?.perClient)}, overall ${limitText(c.quoteRateLimit?.overall)}${c.trustProxy ? '; clients by X-Forwarded-For' : ''}.`);

  return {
    url,
    deals: () => structuredClone(Object.values(journal.deals)),
    following: () => following,
    close: async () => {
      closed = true;
      clearInterval(timer);
      abort.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.all([running, stream]);
      alertsAbort.abort(); // an alert still in flight is dropped; its ALERT line is in the log
      await Promise.all([...alertsInFlight]);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let settings = config;
  let env: Readonly<Record<string, string | undefined>> = process.env;
  if (process.argv.includes('--sim')) {
    // A running `pnpm sim` hands out a funded test account and names its club, operators and adjudicators.
    const sim = process.env['HOLDBACK_SIM_URL'] ?? 'http://127.0.0.1:8780';
    const info = (await (await fetch(sim)).json()) as { clubId: string; operators: string[]; adjudicators: Array<{ address: string }> };
    const account = (await (await fetch(`${sim}/accounts`, { method: 'POST' })).json()) as { privateKey: string };
    const [primary, fallback, appeal] = info.adjudicators.map((a) => a.address);
    settings = { ...config, clubId: info.clubId, adjudicators: { primary: primary!, fallback: fallback!, appeal: appeal! } };
    env = { ...process.env, HOLDBACK_KEY: account.privateKey, HOLDBACK_OPERATORS: info.operators.join(',') };
  }
  let adapter: RunningAdapter;
  try {
    adapter = await startSellerAdapter(settings, env);
  } catch (e) {
    console.error(`seller-adapter: ${plain((e as Error).message)}`);
    process.exit(2);
  }
  // A service manager stops the adapter with SIGTERM: it stops taking quotes, lets the step in progress finish and
  // record itself in the journal, then exits. The next start resumes every open deal from the journal.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      console.log(`${new Date().toISOString()} ${signal}: the adapter stops after the step in progress; the journal keeps every open deal.`);
      void adapter.close().then(() => process.exit(0));
    });
  }
}
