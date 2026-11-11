// Seller: sell a service that prices by quote through Crow, with no protocol code of your own (T-318).
// You already run an HTTP API with a quote call, a start call and a result call. This adapter sits beside it:
//
//   1. Quote to offer.   A buyer POSTs {buyer, buyerEncryptionPublicKey, scope, options?} to this adapter's /quote.
//                        The adapter checks the scope and options, asks your API for a price, fills your deal template
//                        with the scope, applies your terms rules (a window per size band, a check per option: T-330),
//                        signs an offer that names the buyer, submits it, and answers {commitmentId, price, fees,
//                        expiresAt}. The buyer reads the commitment by its ID, and compares it with your published
//                        defaults (GET /defaults: the template and your windows).
//   2. Hold to start.    The adapter follows the operators' event stream for `hold.funded`, and polls as well. It
//                        starts the job only when every operator shows the commitment Held.
//   3. Result to delivery. When your API returns the result, the adapter runs the adjudicator's first stage on
//                        those exact bytes (preflightDelivery). It encrypts and delivers only when the checks do
//                        not refuse them. Otherwise it does not deliver, and logs each failed check.
//
// You change the configuration below and nothing else. Your signing key comes from the environment. The adapter
// signs your offer and your delivery with it; it never holds a buyer's key, and the operators only relay.
//
// Your API, as the adapter calls it (seller-adapter-stub.ts is a working example):
//   quote:  POST <quote>   {scope, options?}              -> {price: {token, amount}, quoteId?, deliverWithinSec?}
//           `amount` is base units as a decimal string ("2000000000" is 2,000.00 of a 6-decimal token).
//   start:  POST <start>   {commitmentId, quoteId, scope, options?} -> {jobId}, with `Idempotency-Key: <commitmentId>`.
//           The same key must return the same job: after a crash the adapter sends the start again.
//   result: GET  <result>  ({jobId} in the address)       -> 202 while the job runs; 200 with the result's bytes.
//
// It keeps a journal file of its deals, so a restart neither starts a job twice nor delivers twice: the journal
// records each job, and the settlement layer says whether a delivery is already there. Run one adapter per journal.
// It listens on 127.0.0.1 and makes public-level offers. Every quote makes the adapter sign an offer, so in production
// run it as seller-adapter-service.md says: behind an HTTPS proxy, with `quoteAuth` and `quoteRateLimit` set (T-324).
// The deliverable is data: the adapter parses it only inside the check library, and runs nothing from it, from
// the template, from a rule, from the scope or from an option.
//
//   pnpm install && pnpm build
//   HOLDBACK_KEY=0x… HOLDBACK_OPERATORS=https://…,https://… node examples/seller-adapter.ts
//   node examples/seller-adapter.ts --sim     (test keys, adjudicators and operators from a running `pnpm sim`)
// Env: HOLDBACK_KEY (the seller's signing key) and HOLDBACK_OPERATORS (two or more, comma-separated). The adapter
// signs under the settlement layer those operators serve, which must be one pinned in verify.ts: SimChain, Sepolia,
// or the deployment in HOLDBACK_DEPLOYMENT. Your API prices in that layer's token: `tUSD` on SimChain, the token's
// address on a chain (discovery, `demo.token.id`). Test tokens only: nothing here is real money.
import { createHash, timingSafeEqual } from 'node:crypto';
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

/** What one of a buyer's options may hold. An option is optional: a quote may leave it out. */
export type OptionRule = ScopeRule | { type: 'boolean' };

/**
 * One condition of a terms rule, on `scope.<field>`, `scope.<field>.length` (a list's size) or `options.<field>`:
 * the value equals `equals`, or is a whole number from `atLeast` to `atMost` (either may be left out). An option the
 * quote leaves out meets no condition.
 */
export type Condition = { field: string; equals: string | number | boolean } | { field: string; atLeast?: number; atMost?: number };

/**
 * A rule that changes one offer's terms from your template and `timing` (T-330). It applies when every condition in
 * `when` holds (an empty list: always). Rules apply in order, so a later one wins. All of it is data: nothing here runs.
 */
export interface TermsRule {
  when: Condition[];
  /** Refuse the quote with 400 and this text, after the fields the conditions name. No price is asked, no offer made. */
  refuse?: string;
  /** Windows in whole seconds that replace the configured ones, and your API's `deliverWithinSec`. */
  timing?: Partial<SellerAdapterConfig['timing']>;
  /** Checks to remove, by id. */
  dropChecks?: string[];
  /** Checks in the shapes of an offer's, with placeholders as in the template. One with an id already there replaces it; others are added at the end. */
  checks?: J[];
  /** Text added to the deliverable's description, after a space. Placeholders as in the template. */
  describe?: string;
}

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
   * Your deal template: a JSON file with `deliverable`, `checks` and optionally `rubric` and `fee` (the adjudication
   * fee you offer; left out, the primary adjudicator's published minimum), in the shapes of an offer. `{{field}}`
   * stands for a scope field, and `{{field.length}}` for the size of a list. `\{{field}}` is the text `{{field}}`.
   * Buyers read it, with `timing`, `scope` and `options`, at GET /defaults: your published defaults.
   */
  template: string;
  /**
   * A mapping file (report-converter.ts) that turns your API's result into your template's JSON, so your API keeps
   * its own report shape. The adapter checks and delivers the converted bytes. Left out: it delivers the result as it comes.
   */
  reportMapping?: string;
  /** The fields a scope must have, and no others. */
  scope: Record<string, ScopeRule>;
  /** The options a buyer may add to a quote, `{"options": {…}}`, and no others. Your API gets them with the scope. */
  options?: Record<string, OptionRule>;
  /** How a quote's scope and options change its offer's terms: a window per size band, a check per option (T-330). */
  termsRules?: TermsRule[];
  clubId: string;
  /** The three adjudicators you name in every offer; the buyer agrees to them by funding. */
  adjudicators: { primary: string; fallback: string; appeal: string };
  /** Windows in whole seconds. Your API's `deliverWithinSec`, when a quote carries one, replaces this one; a terms rule replaces both. */
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
  // A buyer may ask for proof-of-concept files with every finding, Low and Info included.
  options: { proofPerFinding: { type: 'boolean' } },
  termsRules: [
    // 20,000 lines or more: 14 days to deliver.
    { when: [{ field: 'scope.lines', atLeast: 20_000 }], timing: { deliverWithinSec: 1_209_600 } },
    {
      when: [{ field: 'options.proofPerFinding', equals: true }],
      checks: [{ id: 'proof-all', type: 'json_schema', required: true, schema: { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: { type: 'object', required: ['pocFiles'] } } } } }],
      describe: 'Every finding, whatever its severity, carries the proof-of-concept files that show it.',
    },
  ],
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
  // Behind the HTTPS proxy of seller-adapter-service.md, for example:
  //   trustProxy: true,
  //   quoteAuth: { kind: 'bearer', env: 'HOLDBACK_QUOTE_CREDENTIALS' },
  //   quoteRateLimit: { perClient: { requests: 10, windowSec: 60 }, overall: { requests: 100, windowSec: 60 } },
};
// ---- End of configuration. ----

export type Stage = 'offered' | 'starting' | 'started' | 'delivered' | 'refused' | 'closed';
/** One deal in the journal. `refused`: the result failed preflight and was not delivered. */
export interface Deal {
  id: Hex;
  stage: Stage;
  terms: J;
  scope: J;
  options?: J;
  quoteId?: string;
  jobId?: string;
  note?: string;
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
/** `{{name}}` or `{{name.length}}`; with a backslash before it, `\{{name}}`, it is the text `{{name}}`. */
const PLACEHOLDER = /(\\?)\{\{([A-Za-z][A-Za-z0-9]*)(\.length)?\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{([A-Za-z][A-Za-z0-9]*)(\.length)?\}\}$/;
const BEFORE_HOLD = ['Offered', 'AcceptedByAdjudicator', 'Agreed'];
const MAX_BODY_BYTES = 65_536;
const WINDOWS = ['offerExpiresInSec', 'fundWithinSec', 'deliverWithinSec', 'judgeWithinSec', 'fallbackWithinSec', 'appealWindowSec', 'appealDecideSec'] as const;
const RULE_KEYS = ['when', 'refuse', 'timing', 'dropChecks', 'checks', 'describe'];
const isRecord = (v: J): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Why one value breaks its rule, or null when it keeps it. `at` names the field, as `scope.lines`. */
function valueError(at: string, v: J, rule: OptionRule): string | null {
  if (rule.type === 'boolean') return typeof v === 'boolean' ? null : `${at} must be true or false`;
  if (rule.type === 'integer') return typeof v === 'number' && Number.isSafeInteger(v) && v >= rule.min && v <= rule.max ? null : `${at} must be a whole number from ${rule.min} to ${rule.max}`;
  if (rule.type === 'string') return typeof v === 'string' && new RegExp(rule.pattern).test(v) ? null : `${at} must be a string matching ${rule.pattern}`;
  const re = new RegExp(rule.pattern);
  const ok = Array.isArray(v) && v.length >= rule.min && v.length <= rule.max && v.every((s) => typeof s === 'string' && re.test(s)) && new Set(v).size === v.length;
  return ok ? null : `${at} must be ${rule.min} to ${rule.max} distinct strings, each matching ${rule.pattern}`;
}

/** Why a scope (every field required) or the options (each one optional) break the configured rules, or null. */
function fieldsError(what: 'scope' | 'options', given: J, rules: Record<string, OptionRule>): string | null {
  if (!isRecord(given)) return `${what} must be an object`;
  for (const k of Object.keys(given)) if (!Object.hasOwn(rules, k)) return `${what} has a field this seller does not take: ${plain(k).slice(0, 60)}`;
  for (const [k, rule] of Object.entries(rules)) {
    if (what === 'options' && given[k] === undefined) continue;
    const wrong = valueError(`${what}.${k}`, given[k], rule);
    if (wrong) return wrong;
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
    const whole = WHOLE_PLACEHOLDER.exec(node);
    if (whole) return structuredClone(value(whole[1]!, whole[2])); // the value itself: a string, a number or a list
    return node.replace(PLACEHOLDER, (m: string, escaped: string, name: string, length?: string) => {
      if (escaped) return m.slice(1); // `\{{name}}` is the text `{{name}}`
      const v = value(name, length);
      return Array.isArray(v) ? v.join(', ') : String(v);
    });
  }
  if (Array.isArray(node)) return node.map((n) => fill(n, scope));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v, scope)]));
  return node;
}

/** Throws unless every placeholder in `node` names a scope field (and `.length` a list). `where` names the file or rule. */
function checkPlaceholders(where: string, node: J, scope: Record<string, ScopeRule>): void {
  if (typeof node === 'string') {
    for (const [, escaped, name, length] of node.matchAll(PLACEHOLDER)) {
      if (escaped) continue;
      const rule = scope[name!];
      if (!rule) throw new Error(`${where} uses {{${name}}}, which the scope rules do not define`);
      if (length && rule.type !== 'strings') throw new Error(`${where} uses {{${name}.length}}, and ${name} is not a list`);
    }
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) checkPlaceholders(where, v, scope);
  }
}

function loadTemplate(c: SellerAdapterConfig, token: string): J {
  const template = JSON.parse(readFileSync(c.template, 'utf8'));
  if (!template.deliverable || !Array.isArray(template.checks)) throw new Error(`${c.template} needs "deliverable" and "checks"`);
  checkPlaceholders(c.template, template, c.scope);
  const fee = template.fee;
  if (fee !== undefined && !(isRecord(fee) && typeof fee.amount === 'string' && BASE_UNITS.test(fee.amount) && String(fee.token).toLowerCase() === token.toLowerCase())) {
    throw new Error(`${c.template}: fee must be {token, amount} in this settlement layer's token, ${token}, with the amount in base units as a decimal string`);
  }
  return template;
}

/** Throws, naming the rule and the field, unless the option rules and terms rules are well formed (T-330). */
function checkRules(c: SellerAdapterConfig): void {
  const options = c.options ?? {};
  if (!isRecord(options)) throw new Error('options must be an object of option rules');
  for (const [k, rule] of Object.entries(options)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k)) throw new Error(`options.${plain(k).slice(0, 60)}: an option's name is letters and digits, starting with a letter`);
    if (!['boolean', 'string', 'strings', 'integer'].includes((rule as J)?.type)) throw new Error(`options.${k}.type must be boolean, string, strings or integer`);
  }
  const rules = c.termsRules ?? [];
  if (!Array.isArray(rules)) throw new Error('termsRules must be a list');
  const whole = (v: J) => Number.isSafeInteger(v) && v >= 0;
  rules.forEach((r: J, i) => {
    const at = `termsRules[${i}]`;
    if (!isRecord(r)) throw new Error(`${at} must be an object`);
    for (const k of Object.keys(r)) if (!RULE_KEYS.includes(k)) throw new Error(`${at} has a field rules do not take: ${plain(k).slice(0, 60)}`);
    if (!Array.isArray(r.when)) throw new Error(`${at}.when must be a list of conditions`);
    r.when.forEach((w: J, j: number) => {
      const where = `${at}.when[${j}]`;
      const m = /^(scope|options)\.([A-Za-z][A-Za-z0-9]*)(\.length)?$/.exec(String(w?.field));
      if (!m) throw new Error(`${where}: field must be scope.<name>, scope.<name>.length or options.<name>`);
      const rule = (m[1] === 'scope' ? c.scope : options)[m[2]!];
      if (!rule) throw new Error(`${where}: ${m[1]}.${m[2]} is not a field of the ${m[1] === 'scope' ? 'scope' : 'option'} rules`);
      if (m[3] && rule.type !== 'strings') throw new Error(`${where}: ${m[1]}.${m[2]} is not a list`);
      const keys = Object.keys(w).filter((k) => k !== 'field');
      const equals = keys.length === 1 && keys[0] === 'equals' && ['string', 'number', 'boolean'].includes(typeof w.equals);
      const range = keys.length > 0 && keys.every((k) => (k === 'atLeast' || k === 'atMost') && Number.isSafeInteger(w[k]));
      if (!equals && !range) throw new Error(`${where} needs equals (a string, number or boolean), or atLeast and atMost (whole numbers)`);
    });
    if (r.refuse !== undefined && typeof r.refuse !== 'string') throw new Error(`${at}.refuse must be text`);
    if (r.describe !== undefined && typeof r.describe !== 'string') throw new Error(`${at}.describe must be text`);
    if (r.timing !== undefined) {
      if (!isRecord(r.timing)) throw new Error(`${at}.timing must be an object of windows`);
      for (const [k, v] of Object.entries(r.timing)) {
        if (!(WINDOWS as readonly string[]).includes(k)) throw new Error(`${at}.timing has a window the offer does not take: ${plain(k).slice(0, 60)}`);
        if (!whole(v)) throw new Error(`${at}.timing.${k} must be a whole number of seconds, 0 or more`);
      }
    }
    if (r.dropChecks !== undefined && !(Array.isArray(r.dropChecks) && r.dropChecks.every((d: J) => typeof d === 'string'))) throw new Error(`${at}.dropChecks must be a list of check ids`);
    if (r.checks !== undefined) {
      if (!Array.isArray(r.checks)) throw new Error(`${at}.checks must be a list of checks`);
      r.checks.forEach((k: J, j: number) => {
        if (!isRecord(k) || typeof k.id !== 'string' || typeof k.type !== 'string') throw new Error(`${at}.checks[${j}] needs a string id and type`);
      });
    }
    checkPlaceholders(at, { checks: r.checks, describe: r.describe }, c.scope);
  });
}

/** Whether a condition holds for this scope and these options. */
function holds(w: J, scope: J, options: J): boolean {
  const [, from, name, length] = /^(scope|options)\.([A-Za-z][A-Za-z0-9]*)(\.length)?$/.exec(w.field)!;
  let v = (from === 'scope' ? scope : (options ?? {}))[name!];
  if (v === undefined) return false;
  if (length) v = v.length;
  if ('equals' in w) return v === w.equals;
  return typeof v === 'number' && (w.atLeast === undefined || v >= w.atLeast) && (w.atMost === undefined || v <= w.atMost);
}

/**
 * The offer's deliverable, checks, rubric and windows for one quote: the template and `timing`, your API's window,
 * then each rule whose conditions hold, in order. A refusing rule throws 400 naming its fields.
 */
function termsFor(c: SellerAdapterConfig, template: J, scope: J, options: J, deliverWithinSec: number | undefined): { deliverable: J; checks: J[]; rubric?: J; timing: SellerAdapterConfig['timing'] } {
  const filled = fill(template, scope);
  let checks: J[] = filled.checks;
  const deliverable = { ...filled.deliverable };
  const timing = { ...c.timing, ...(deliverWithinSec === undefined ? {} : { deliverWithinSec }) };
  for (const r of c.termsRules ?? []) {
    if (!r.when.every((w) => holds(w, scope, options))) continue;
    if (r.refuse !== undefined) throw new Refused(400, 'invalid_request', `${r.when.map((w) => w.field).join(' and ')}: ${r.refuse}`);
    Object.assign(timing, r.timing);
    if (r.dropChecks) checks = checks.filter((k) => !r.dropChecks!.includes(k.id));
    for (const k of fill(r.checks ?? [], scope)) {
      const at = checks.findIndex((x) => x.id === k.id);
      checks = at < 0 ? [...checks, k] : checks.map((x, i) => (i === at ? k : x));
    }
    if (r.describe) deliverable.description = `${deliverable.description} ${fill(r.describe, scope)}`;
  }
  return { deliverable, checks, ...(filled.rubric === undefined ? {} : { rubric: filled.rubric }), timing };
}

/** A refusing rule only reads the scope and options: run them before your API is asked, so a refused quote costs nothing. */
function refusalFor(c: SellerAdapterConfig, scope: J, options: J): void {
  for (const r of c.termsRules ?? []) if (r.refuse !== undefined && r.when.every((w) => holds(w, scope, options))) throw new Refused(400, 'invalid_request', `${r.when.map((w) => w.field).join(' and ')}: ${r.refuse}`);
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

/**
 * Starts the adapter: the /quote route, the event stream and the polling loop. The key and the operators come
 * from `env` (HOLDBACK_KEY, HOLDBACK_OPERATORS), never from the configuration.
 */
export async function startSellerAdapter(c: SellerAdapterConfig, env: Readonly<Record<string, string | undefined>> = process.env): Promise<RunningAdapter> {
  const admit = gate(c, env); // refuses a malformed limit or a missing credential before anything is signed
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
  checkRules(c);
  const template = loadTemplate(c, token.id);
  // Your published defaults: what every buyer reads before it asks (GET /defaults). The buyer's signer compares each
  // offer with them and shows its agent what differs (buyer-signer.ts). Placeholders stay as the template has them.
  const defaults = JSON.stringify({
    version: 1, deliverable: template.deliverable, checks: template.checks, ...(template.rubric === undefined ? {} : { rubric: template.rubric }),
    timing: c.timing, ...(template.fee === undefined ? {} : { fee: template.fee }), scope: c.scope, options: c.options ?? {},
  });
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
  async function offerFor(buyer: string, buyerEncryptionPublicKey: string, scope: J, options: J): Promise<J> {
    refusalFor(c, scope, options); // the seller's own exclusions, before its API is asked
    let quoted: J;
    try {
      quoted = await (await post('the quote', c.sellerApi.quote, { scope, ...(options === undefined ? {} : { options }) })).json();
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
    const built = termsFor(c, template, scope, options, deliverWithinSec);
    const panel = Array.isArray(built.rubric?.criteria) && built.rubric.criteria.length > 0;
    let offer;
    try {
      offer = await seller.offer({
        template: panel ? 'default' : 'checks-only',
        clubId: c.clubId,
        seller: seller.address,
        buyer: { address: buyer, encryptionPublicKey: buyerEncryptionPublicKey },
        adjudicators: c.adjudicators,
        price: { token: price.token, amount: price.amount },
        ...(template.fee === undefined ? {} : { fee: { token: template.fee.token, amount: template.fee.amount } }),
        deliverable: built.deliverable,
        checks: built.checks,
        ...(panel ? { rubric: built.rubric } : {}),
        timing: built.timing,
      });
    } catch (e) {
      log(`Offer failed: ${plain((e as Error).message)}.`);
      throw new Refused(502, 'offer_failed', 'the seller could not make this offer');
    }
    const { id, terms } = offer;
    journal.deals[id] = { id, stage: 'offered', terms, scope, ...(options === undefined ? {} : { options }), ...(typeof quoted.quoteId === 'string' ? { quoteId: quoted.quoteId } : {}) };
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
    const { buyer, buyerEncryptionPublicKey, scope, options } = body ?? {};
    if (typeof buyer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(buyer)) throw new Refused(400, 'invalid_request', 'buyer must be an address: 0x and 40 hex characters');
    if (typeof buyerEncryptionPublicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(buyerEncryptionPublicKey)) throw new Refused(400, 'invalid_request', 'buyerEncryptionPublicKey must be an x25519 public key, base64url, 43 characters');
    const wrong = fieldsError('scope', scope, c.scope) ?? (options === undefined ? null : fieldsError('options', options, c.options ?? {}));
    if (wrong) throw new Refused(400, 'invalid_request', wrong);
    const idempotencyKey = req.headers['idempotency-key'];
    if (idempotencyKey === undefined) return offerFor(buyer.toLowerCase(), buyerEncryptionPublicKey, scope, options);
    // The same key with the same body replays the answer; with another body it is a conflict.
    if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new Refused(400, 'invalid_request', 'Idempotency-Key must be 1 to 200 printable characters');
    const bodyHash = createHash('sha256').update(jcs({ buyer: buyer.toLowerCase(), buyerEncryptionPublicKey, scope, ...(options === undefined ? {} : { options }) })).digest('hex');
    const seen = journal.quotes[idempotencyKey] ?? inFlight.get(idempotencyKey);
    if (seen && seen.bodyHash !== bodyHash) throw new Refused(409, 'idempotency_conflict', 'this Idempotency-Key was used with another request');
    if (seen) return seen.answer;
    const answer = offerFor(buyer.toLowerCase(), buyerEncryptionPublicKey, scope, options);
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
      const started = (await (await post('the start', c.sellerApi.start, { commitmentId: id, ...(deal.quoteId ? { quoteId: deal.quoteId } : {}), scope: deal.scope, ...(deal.options === undefined ? {} : { options: deal.options }) }, { 'idempotency-key': id })).json()) as J;
      if (typeof started?.jobId !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(started.jobId)) throw new Error('the seller API\'s start answer has no usable jobId');
      record(deal, { stage: 'started', jobId: started.jobId, note: `job ${started.jobId}` });
    }
    if (deal.stage === 'started') {
      // The settlement layer, not the journal, says whether a delivery is already there.
      const state = await escrowState();
      if (state !== 'Held') {
        const delivered = await seller.trusted<boolean>(`/v1/commitments/${id}/events?limit=200`, (x) => x.items.some((e: J) => e.type === 'delivery.submitted'));
        return record(deal, delivered ? { stage: 'delivered', note: `the settlement layer already holds the delivery (${state})` } : { stage: 'closed', note: `the deal ended ${state} with no delivery` });
      }
      if (Date.parse(deal.terms.timing.deliverBy) <= (await seller.settlementNow())) return record(deal, { stage: 'closed', note: `the delivery deadline ${deal.terms.timing.deliverBy} passed` });
      const res = await api('the result', c.sellerApi.result.replace('{jobId}', encodeURIComponent(deal.jobId!)));
      if (res.status === 202) return; // the job still runs
      let bytes = new Uint8Array(await res.arrayBuffer());
      if (reportMapping) {
        // Your report in the template's shape (T-323). A report the mapping cannot convert is never delivered.
        try {
          const result = bytes.length;
          bytes = convertReport(reportMapping, bytes);
          log(`${id} converted the result with the report mapping: ${result} bytes to ${bytes.length} bytes.`);
        } catch (e) {
          if (!(e instanceof ReportNotConverted)) throw e;
          return record(deal, { stage: 'refused', note: `the result is not delivered: the report mapping cannot convert it: ${e.message}. To deliver another file by hand before ${deal.terms.timing.deliverBy}, use check-delivery.ts and seal.ts` });
        }
      }
      // The adjudicator's intake rules and stage 1, on the exact bytes that would be delivered (T-316).
      const format = deal.terms.deliverable.format;
      const pre = preflightDelivery({ plaintext: bytes, mime: format, format, acceptance: deal.terms.acceptance });
      const open = new Set(pre.inconclusive);
      log(`${id} preflight: ${pre.result}, ${pre.bytes} bytes, ${pre.plaintextSha256}.`);
      if (pre.refused) log(`  REFUSED ${pre.refused.code}: ${plain(pre.refused.detail)}`);
      for (const o of pre.deterministic) {
        if (!o.passed || open.has(o.checkId)) log(`  ${open.has(o.checkId) ? 'OPEN' : 'FAIL'} ${plain(o.checkId)} (${o.required ? 'required' : 'optional'})${o.detail === undefined ? '' : `: ${plain(o.detail)}`}`);
      }
      if (pre.result !== 'accept' && pre.result !== 'panel') {
        const why = pre.result === 'reject' ? 'the adjudicator would reject it and refund the buyer' : 'a check cannot be decided, so the deal would escalate';
        return record(deal, { stage: 'refused', note: `the result is not delivered: ${why}. To deliver another file by hand before ${deal.terms.timing.deliverBy}, use check-delivery.ts and seal.ts` });
      }
      await seller.deliver(deal.terms, bytes);
      record(deal, { stage: 'delivered', note: `${pre.bytes} bytes, ${pre.plaintextSha256}` });
    }
  }

  let closed = false;
  let running: Promise<void> | undefined;
  let again = false;
  const lastError = new Map<string, string>();
  async function pass(): Promise<void> {
    for (const deal of Object.values(journal.deals)) {
      if (closed) return;
      if (!['offered', 'starting', 'started'].includes(deal.stage)) continue;
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

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body));
    const path = new URL(req.url ?? '/', 'http://adapter').pathname;
    // The published defaults are public: no credential, and they make the adapter sign nothing.
    if (path === '/defaults' && req.method === 'GET') return void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=300' }).end(defaults);
    if (path !== '/quote') return void send(404, { type: 'not_found', detail: 'this adapter serves POST /quote and GET /defaults' });
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
