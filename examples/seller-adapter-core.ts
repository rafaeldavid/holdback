// The seller adapter's core (T-434, ADR-0037 section 7): every rule of the adapter, with no file, server or timer of
// its own. Two shells run it: seller-adapter.ts on Node (a journal file, an HTTP server on 127.0.0.1, a poll every
// `pollMs`), and apps/hosted-sellers on Cloudflare (Durable Object storage, the Worker's routes, an alarm). The
// shell hands the core an `AdapterIO`: how to read the files the configuration names, and how to load and save the
// journal. The core answers standard `Request`s with `Response`s, and a pass moves every open deal as far as it can.
// It imports no Node module but node:crypto, which the Workers runtime provides with the nodejs_compat flag.
// What the adapter does, and how a seller runs it, is in seller-adapter.ts.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { concat, keccak256, stringToHex, type Hex } from 'viem';
import { preflightDelivery } from '@holdback/judgment';
import { plain } from '@holdback/testkit';
import { Agent } from './agent.ts';
import { convertReport, parseReportMapping, ReportNotConverted, type ReportMapping } from './report-converter.ts';
import { FilesNotAdded, isRedirect, sellerApiClient, type SellerApiConfig } from './seller-adapter-api.ts';
import { freshNonce, isAddressText, jcs, knownPins, moneyAddressWarnings, operatorFeeOf } from './verify.ts';

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
  /**
   * true: the offer carries the template's `optionalRubric`, so a panel of judges scores the delivery after the checks
   * pass (T-331). false: the offer carries no rubric. A buyer's option can ask for the panel this way.
   */
  rubric?: boolean;
}

/** At most `requests` requests in each window of `windowSec` seconds. Any positive whole numbers: your choice. */
export interface QuoteLimit {
  requests: number;
  windowSec: number;
}

export interface SellerAdapterConfig {
  /** Where this adapter listens for POST /quote, on 127.0.0.1: only a proxy on the same machine reaches it. */
  port: number;
  /**
   * Who may ask for a quote. Omit it and POST /quote is open to anyone who reaches it. `bearer`: a request must carry
   * `Authorization: Bearer <credential>` with one of the credentials in the environment variable `env`, comma-separated.
   * The credentials come from the environment only, and the adapter never logs them.
   */
  quoteAuth?: { kind: 'bearer'; env: string };
  /**
   * How many quotes the adapter answers: `overall` counts every request that passed `quoteAuth`. Past it, the
   * adapter answers 429 with Retry-After and makes no offer. Omit it for no limit. A limit per client belongs in
   * your proxy, which sees the client's address.
   */
  quoteRateLimit?: { overall?: QuoteLimit };
  /**
   * Your API's three addresses, `result` with `{jobId}` where the job's ID goes; or, for an API of another shape,
   * `baseUrl`, an optional `auth` credential and a mapping for each call (T-366, seller-adapter-api.ts).
   */
  sellerApi: SellerApiConfig;
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
  /**
   * Adds a top-level `salt` of 32 random bytes (`0x` and 64 hex digits) to each JSON report, after the mapping and
   * before the checks run (T-431). A delivery's SHA-256 is public, so anyone who can guess a report could confirm the
   * guess from it; the salt stops that, and two deliveries of the same report no longer look equal. The adapter draws
   * one salt a deal when it makes the offer and keeps it in the journal, so a retried delivery carries the same bytes
   * and a deal offered without one is delivered without one. Your template's checks must allow the field, as the
   * shipped template's do. Left out: on with the shipped template, off with any other.
   */
  reportSalt?: boolean;
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
  /** The options a buyer may add to a quote, `{"options": {…}}`, and no others. Your API gets them with the scope. */
  options?: Record<string, OptionRule>;
  /** How a quote's scope and options change its offer's terms: a window per size band, a check per option (T-330). */
  termsRules?: TermsRule[];
  /**
   * Where buyers pay you (ADR-0033): every offer names it as `sellerPayoutAddress`, and a release or your share of a
   * settlement goes there. Left out: your signing address, and the adapter says so in one line at start. A production
   * seller sets one apart from HOLDBACK_KEY, so the key that signs every day never holds the income. Only this field
   * sets it: the adapter refuses to sign terms that name another.
   */
  payoutAddress?: string;
  /** The club you offer in. Left out: the club the operators' discovery document names (`demo.clubId`). */
  clubId?: string;
  /**
   * The three adjudicators you name in every offer; the buyer agrees to them by funding. Left out: the ones the
   * operators' discovery document names by role (`demo.adjudicators`). A zero address stops the start.
   */
  adjudicators?: { primary: string; fallback: string; appeal: string };
  /**
   * Your mandate in the club, which every offer needs. When discovery offers a faucet for this club (the test
   * service), the adapter takes a mandate from it at start and asks again when less than `renewBeforeSec` is left
   * (default 86,400 s, one day). `fromFaucet: false`: only the mandate your principal gave you.
   */
  mandate?: { fromFaucet?: boolean; renewBeforeSec?: number };
  /**
   * Which key signs each offer and delivery (T-432). `"standing"`, the default: HOLDBACK_KEY signs every deal, so one
   * read of the commitments by that address lists all of them. `"per-deal"`: a fresh key signs each deal, derived
   * from HOLDBACK_KEY and the offer's own nonce, so a read by any one key finds one deal. The adapter derives the key
   * again from the signed terms after a restart, so no deal key is stored anywhere. Each deal key takes its own
   * mandate from the test service's faucet when the quote comes in: one grant a quote, counted against the faucet's
   * limit per client (`demo.faucet.perClientPerWindow` in discovery). Without a faucet for the club, the start stops.
   * HOLDBACK_KEY then signs nothing the operators check. Payments still go to `payoutAddress`, or to HOLDBACK_KEY's
   * address, which every deal names.
   */
  signingKey?: 'standing' | 'per-deal';
  /** Windows in whole seconds. Your API's `deliverWithinSec`, when a quote carries one, replaces this one; a terms rule replaces both. */
  timing: { offerExpiresInSec: number; fundWithinSec: number; deliverWithinSec: number; judgeWithinSec: number; fallbackWithinSec: number; appealWindowSec: number; appealDecideSec: number };
  /** The journal file. Its directory must exist. */
  journal: string;
  /**
   * A file the adapter appends one JSON line to for each event (T-417): quotes, stage changes with their times, the
   * job's states, refusals and deliveries. For the seller's own product metrics. No report content, key, credential,
   * buyer address or scope goes into it. Left out: no events.
   */
  events?: string;
  /** How often the adapter polls the operators and your API, in milliseconds. */
  pollMs: number;
  log?: (line: string) => void;
}

// ---- The defaults: what a configuration file leaves out. Write your own file (seller-adapter.config.json). ----
// The shipped template's path is the shell's: seller-adapter.ts adds it as `config.template`.
export const DEFAULTS: Omit<SellerAdapterConfig, 'template'> = {
  port: 8791,
  sellerApi: {
    quote: 'http://127.0.0.1:8790/quote',
    start: 'http://127.0.0.1:8790/jobs',
    result: 'http://127.0.0.1:8790/jobs/{jobId}/result',
  },
  scope: {
    commit: { type: 'string', pattern: '^[0-9a-f]{40}$' },
    files: { type: 'strings', pattern: '^[A-Za-z0-9_./-]{1,200}$', min: 1, max: 50 },
    lines: { type: 'integer', min: 1, max: 10_000_000 },
  },
  // A buyer may ask for proof-of-concept files with every finding, Low and Info included, and for a panel of judges
  // that scores the report on the template's five criteria after the checks pass.
  options: { proofPerFinding: { type: 'boolean' }, panel: { type: 'boolean' } },
  termsRules: [
    // 20,000 lines or more: 14 days to deliver.
    { when: [{ field: 'scope.lines', atLeast: 20_000 }], timing: { deliverWithinSec: 1_209_600 } },
    {
      when: [{ field: 'options.proofPerFinding', equals: true }],
      checks: [{ id: 'proof-all', type: 'json_schema', required: true, schema: { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: { type: 'object', required: ['pocFiles'] } } } } }],
      describe: 'Every finding, whatever its severity, carries the proof-of-concept files that show it.',
    },
    { when: [{ field: 'options.panel', equals: true }], rubric: true },
  ],
  // 15 minutes to accept, 30 to fund, 7 days to deliver, 2 minutes for each adjudicator, 5 for appeals.
  timing: { offerExpiresInSec: 900, fundWithinSec: 1800, deliverWithinSec: 604_800, judgeWithinSec: 120, fallbackWithinSec: 120, appealWindowSec: 0, appealDecideSec: 300 }, // phase one: no party appeal (ADR-0033 §2b)
  journal: 'seller-adapter.journal.json',
  pollMs: 5000,
  // After a refused result, fetch it again every 10 minutes until deliverBy. To be told, and to say when it is fixed:
  //   alerts: { callback: 'https://ops.example/crow-alerts', secretEnv: 'HOLDBACK_ALERT_SECRET' },
  //   redelivery: { refetchEverySec: 600, readyAuth: { kind: 'bearer', env: 'HOLDBACK_READY_CREDENTIALS' } },
  redelivery: { refetchEverySec: 600 },
  // Behind the HTTPS proxy of seller-adapter-service.md, for example:
  //   quoteAuth: { kind: 'bearer', env: 'HOLDBACK_QUOTE_CREDENTIALS' },
  //   quoteRateLimit: { overall: { requests: 100, windowSec: 60 } },
};
// ---- End of the defaults. ----

/** The fields a configuration file may set: every field of the configuration but `log`. */
export const FILE_KEYS = ['port', 'sellerApi', 'template', 'reportMapping', 'reportSalt', 'scope', 'options', 'termsRules', 'payoutAddress', 'clubId', 'adjudicators', 'mandate', 'signingKey', 'events', 'timing', 'journal', 'pollMs', 'quoteAuth', 'quoteRateLimit', 'alerts', 'redelivery'];
/** Options removed in T-331, each with what to do instead. A configuration that still sets one is refused. */
const REMOVED: Array<[string, (c: J) => boolean, string]> = [
  ['stream', (c) => c?.stream !== undefined, 'the adapter learns of a funded hold by polling every pollMs; remove the field'],
  ['host', (c) => c?.host !== undefined, 'the adapter listens on 127.0.0.1 only, behind your proxy; remove the field'],
  ['trustProxy', (c) => c?.trustProxy !== undefined, 'it served quoteRateLimit.perClient, which is gone too; remove the field'],
  ['quoteRateLimit.perClient', (c) => c?.quoteRateLimit?.perClient !== undefined, 'limit per client in your proxy, and keep quoteRateLimit.overall and quoteAuth here'],
];
export function removedError(where: string, c: J): string | null {
  const hit = REMOVED.find(([, set]) => set(c));
  return hit ? `${where}: ${hit[0]} was removed (T-331): ${hit[2]}` : null;
}
const httpAddress = (v: J): boolean => {
  try {
    const u = new URL(v);
    return typeof v === 'string' && (u.protocol === 'http:' || u.protocol === 'https:');
  } catch {
    return false;
  }
};
const wholeAtLeast = (v: J, min: number) => Number.isSafeInteger(v) && v >= min;

/** Where the files a configuration names are, for `configFrom`: given by the shell, Node's or the Worker's. */
export interface ConfigFiles {
  /** The path of a file the configuration names (`template`, `reportMapping`), as the shell will read it. */
  beside(path: string): string;
  /** A file's text, by a path `beside` gave. Throws when there is no such file. */
  readText(path: string): string;
  /** The shipped template's path: used when the configuration names none. */
  shippedTemplate: string;
}

/**
 * A configuration (T-331), from the one JSON object a seller writes. Only `sellerApi` is required; every other field
 * defaults to `DEFAULTS` above, and `clubId` and `adjudicators` to what discovery names. `template` and
 * `reportMapping` are paths `files.beside` resolves; `journal` is where the Node adapter runs, as before. With your own
 * template, `scope` is required, and the shipped `options` and `termsRules` do not apply: they belong to the shipped
 * template. `timing` may name only the windows you change. Nothing in it runs: it is data, checked again at start.
 * `file` names the configuration in each error. seller-adapter.ts's `loadConfig` reads a file and calls this.
 */
export function configFrom(f: J, file: string, files: ConfigFiles): SellerAdapterConfig {
  if (!isRecord(f)) throw new Error(`${file} must hold one JSON object`);
  const removed = removedError(file, f);
  if (removed) throw new Error(removed);
  for (const k of Object.keys(f)) if (!FILE_KEYS.includes(k)) throw new Error(`${file} has a field the adapter does not take: ${plain(k).slice(0, 60)}`);
  const api = f.sellerApi;
  if (!isRecord(api)) throw new Error(`${file}: sellerApi is required: your API's quote, start and result addresses`);
  // An address in today's shape, or a mapping (T-366), which the start checks whole, with the credential.
  for (const k of ['quote', 'start', 'result']) if (!isRecord(api[k]) && !httpAddress(api[k])) throw new Error(`${file}: sellerApi.${k} must be an http or https address, or a call mapping`);
  for (const k of Object.keys(api)) if (!['quote', 'start', 'result', 'baseUrl', 'auth'].includes(k)) throw new Error(`${file}: sellerApi has a field the adapter does not take: ${plain(k).slice(0, 60)}`);
  const beside = (p: J, at: string): string => {
    if (typeof p !== 'string' || p === '') throw new Error(`${file}: ${at} must be a file path`);
    return files.beside(p);
  };
  const own = f.template !== undefined;
  if (own && f.scope === undefined) throw new Error(`${file}: scope is required with your own template: the fields a buyer's scope must have`);
  if (f.timing !== undefined) {
    if (!isRecord(f.timing)) throw new Error(`${file}: timing must be an object of windows`);
    for (const [k, v] of Object.entries(f.timing)) {
      if (!(WINDOWS as readonly string[]).includes(k)) throw new Error(`${file}: timing has a window the offer does not take: ${plain(k).slice(0, 60)}`);
      if (!wholeAtLeast(v, 0)) throw new Error(`${file}: timing.${k} must be a whole number of seconds, 0 or more`);
    }
  }
  if (f.port !== undefined && !(wholeAtLeast(f.port, 0) && f.port <= 65_535)) throw new Error(`${file}: port must be a whole number from 0 to 65535`);
  if (f.pollMs !== undefined && !wholeAtLeast(f.pollMs, 1)) throw new Error(`${file}: pollMs must be a positive whole number of milliseconds`);
  if (f.journal !== undefined && (typeof f.journal !== 'string' || f.journal === '')) throw new Error(`${file}: journal must be a file path`);
  if (f.events !== undefined && (typeof f.events !== 'string' || f.events === '')) throw new Error(`${file}: events must be a file path`);
  if (f.reportSalt !== undefined && typeof f.reportSalt !== 'boolean') throw new Error(`${file}: reportSalt must be true or false`);
  if (f.signingKey !== undefined && f.signingKey !== 'standing' && f.signingKey !== 'per-deal') throw new Error(`${file}: signingKey must be "standing" or "per-deal"`);
  if (own && Array.isArray(f.termsRules) && f.termsRules.some((r: J) => r?.rubric === true)) {
    // A rule that adds the optional rubric needs a template that holds one: refuse the file, not a buyer's quote.
    let t: J;
    try {
      t = JSON.parse(files.readText(beside(f.template, 'template')));
    } catch {
      t = undefined; // the start names an unreadable template
    }
    const i = f.termsRules.findIndex((r: J) => r?.rubric === true);
    if (isRecord(t) && t.optionalRubric === undefined) throw new Error(`${file}: termsRules[${i}].rubric: the template has no optionalRubric for the rule to add`);
  }
  const pass = (k: string) => (f[k] === undefined ? {} : { [k]: f[k] });
  return {
    port: f.port ?? DEFAULTS.port,
    sellerApi: { ...(api.baseUrl === undefined ? {} : { baseUrl: api.baseUrl }), ...(api.auth === undefined ? {} : { auth: api.auth }), quote: api.quote, start: api.start, result: api.result },
    template: own ? beside(f.template, 'template') : files.shippedTemplate,
    ...(f.reportMapping === undefined ? {} : { reportMapping: beside(f.reportMapping, 'reportMapping') }),
    ...pass('reportSalt'), ...pass('signingKey'),
    scope: f.scope ?? DEFAULTS.scope,
    ...(own ? { ...pass('options'), ...pass('termsRules') } : { options: f.options ?? DEFAULTS.options, termsRules: f.termsRules ?? DEFAULTS.termsRules }),
    timing: { ...DEFAULTS.timing, ...(f.timing ?? {}) },
    journal: f.journal ?? DEFAULTS.journal,
    ...(f.events === undefined ? {} : { events: f.events }),
    pollMs: f.pollMs ?? DEFAULTS.pollMs,
    redelivery: f.redelivery ?? DEFAULTS.redelivery,
    ...pass('payoutAddress'), ...pass('clubId'), ...pass('adjudicators'), ...pass('mandate'), ...pass('quoteAuth'), ...pass('quoteRateLimit'), ...pass('alerts'),
  } as SellerAdapterConfig;
}

/** A report the salt cannot go into: not a JSON object, or one that already has a top-level `salt`. */
export class SaltNotAdded extends Error {}
/**
 * Puts `"salt": "<salt>"` first in a JSON object's text (T-431). Every other byte stays as it was, so numbers, key
 * order and spacing are the report's own. Refuses a report that is not a JSON object in UTF-8, or already has a `salt`.
 */
export function addSalt(report: Uint8Array, salt: string): Uint8Array {
  let text: string;
  let value: J;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(report);
  } catch {
    throw new SaltNotAdded('the report is not UTF-8 text');
  }
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, '')); // a leading byte-order mark stays, as the adjudicator's intake drops it
  } catch {
    throw new SaltNotAdded('the report is not JSON');
  }
  if (!isRecord(value)) throw new SaltNotAdded('the report is not a JSON object');
  if (Object.hasOwn(value, 'salt')) throw new SaltNotAdded('the report already has a top-level salt');
  const open = text.indexOf('{') + 1;
  const rest = text.slice(open);
  const lead = /^\s*/.exec(rest)![0];
  const field = `"salt": ${JSON.stringify(salt)}`;
  const salted = rest.slice(lead.length).startsWith('}') ? `${text.slice(0, open)}${field}${rest}` : `${text.slice(0, open)}${lead}${field},${rest}`;
  return new TextEncoder().encode(salted);
}

export type Stage = 'offered' | 'starting' | 'start-unknown' | 'started' | 'refused' | 'delivering' | 'delivered' | 'closed';
/**
 * One deal in the journal. `refused`: the last result failed preflight; the adapter holds the delivery and waits
 * for a fixed report until `deliverBy`. `delivering`: recorded just before the delivery call, so a restart reads
 * the settlement layer before it delivers again. `start-unknown` (T-408): a start that cannot be repeated safely was
 * sent and no job ID came back; the deal waits for a person to name the job (POST /deals/<id>/job) until `deliverBy`.
 */
export interface Deal {
  id: Hex;
  stage: Stage;
  terms: J;
  scope: J;
  options?: J;
  quoteId?: string;
  jobId?: string;
  note?: string;
  /** Distinct results refused so far (T-329). */
  refusals?: number;
  /** The salt this deal's report carries (T-431), drawn with the offer so a retried delivery sends the same bytes. */
  salt?: string;
  /** SHA-256 of the last refused result's bytes, hex: the same bytes again raise no second alert. */
  refusedSha256?: string;
  /** When to fetch the result again, in settlement-layer time; absent when only the seller's "ready" fetches it. */
  nextFetchAt?: string | undefined;
  /** The seller said a fixed report is ready: the next pass fetches it. */
  ready?: boolean;
  /** Start calls sent for this deal, recorded before each call (T-408). */
  startAttempts?: number;
  /** When the deal first reached each stage, and when the job finished, by this machine's clock (T-417). */
  times?: Partial<Record<Stage | 'jobDone', string>>;
  /** The job's last status value read by a status field, such as `queued` or `running` (T-417). */
  jobStatus?: string;
}
export interface Journal {
  deals: Record<string, Deal>;
  /** Answers by Idempotency-Key, with the hash of the request they answered. */
  quotes: Record<string, { bodyHash: string; answer: J }>;
  /**
   * The seller addresses and clubs this journal has seen hold a mandate, as `<address> <clubId>` (T-396). Until it has
   * seen the one it runs as, a start on the test service asks the faucet first: a fresh address holds none, and
   * reading it only draws a 404. A journal from before T-396 has no list and asks the faucet first once.
   */
  mandatesSeen?: string[];
}

export interface RunningAdapter {
  url: string;
  /** A copy of the journal's deals. */
  deals(): Deal[];
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
const RULE_KEYS = ['when', 'refuse', 'timing', 'dropChecks', 'checks', 'describe', 'rubric'];
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
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

/**
 * The template, checked. One token (plan section 2c): a fee that names no token takes the settlement layer's from
 * discovery, and one that names another is refused at start, naming both, before any offer is made.
 */
function loadTemplate(c: SellerAdapterConfig, token: { id: string; symbol: string }, readText: (path: string) => string): J {
  const template = JSON.parse(readText(c.template));
  if (!template.deliverable || !Array.isArray(template.checks)) throw new Error(`${c.template} needs "deliverable" and "checks"`);
  checkPlaceholders(c.template, template, c.scope);
  const fee = template.fee;
  if (fee !== undefined && !(isRecord(fee) && typeof fee.amount === 'string' && BASE_UNITS.test(fee.amount) && (fee.token === undefined || typeof fee.token === 'string'))) {
    throw new Error(`${c.template}: fee must be {amount} or {token, amount}, with the amount in base units as a decimal string`);
  }
  if (fee?.token !== undefined && fee.token.toLowerCase() !== token.id.toLowerCase()) {
    throw new Error(`${c.template}: fee names the token ${plain(fee.token).slice(0, 80)}, and these operators settle in ${token.id} (${token.symbol}) only: name that token, or leave the token out to take it from discovery`);
  }
  if (fee !== undefined) template.fee = { token: token.id, amount: fee.amount };
  // `rubric` may be empty (a checks-only deal); `optionalRubric` may not: the panel option would add nothing.
  if (template.rubric !== undefined && !(isRecord(template.rubric) && Array.isArray(template.rubric.criteria))) throw new Error(`${c.template}: rubric must be a rubric, an object with criteria`);
  if (template.optionalRubric !== undefined && !(isRecord(template.optionalRubric) && Array.isArray(template.optionalRubric.criteria) && template.optionalRubric.criteria.length > 0)) throw new Error(`${c.template}: optionalRubric must be a rubric, an object with one or more criteria`);
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
    if (r.rubric !== undefined && typeof r.rubric !== 'boolean') throw new Error(`${at}.rubric must be true or false`);
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
  let rubric: J = filled.rubric;
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
    if (r.rubric !== undefined) rubric = r.rubric ? filled.optionalRubric : undefined;
  }
  return { deliverable, checks, ...(rubric === undefined ? {} : { rubric }), timing };
}

/**
 * A refusing rule only reads the scope and options: run them before your API is asked, so a refused quote costs
 * nothing. A rule that adds the optional rubric to a template that holds none refuses its quote too: a buyer who
 * asked for the panel never gets an offer without one. (A configuration file with that rule does not load.)
 */
function refusalFor(c: SellerAdapterConfig, template: J, scope: J, options: J): void {
  for (const r of c.termsRules ?? []) {
    if (!r.when.every((w) => holds(w, scope, options))) continue;
    const fields = r.when.map((w) => w.field).join(' and ');
    if (r.refuse !== undefined) throw new Refused(400, 'invalid_request', `${fields}: ${r.refuse}`);
    if (r.rubric === true && template.optionalRubric === undefined) throw new Refused(400, 'invalid_request', `${fields || 'this quote'}: this seller's template has no optional rubric to add`);
  }
}

/** A request's body, or null when it is longer than `cap` bytes: the reading stops there. */
async function bodyOf(req: Request, cap: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) out.set(c, (at += c.length) - c.length);
  return out;
}

async function readJson(req: Request): Promise<J> {
  const bytes = await bodyOf(req, MAX_BODY_BYTES);
  if (bytes === null) throw new Refused(413, 'invalid_request', `the request is larger than ${MAX_BODY_BYTES} bytes`);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Refused(400, 'invalid_request', 'the request body is not JSON');
  }
}

/** A fixed-window count: 0 when a request is admitted, otherwise the whole seconds until the window ends. */
function counter(limit: QuoteLimit): (now: number) => number {
  const windowMs = limit.windowSec * 1000;
  let w = { start: -Infinity, count: 0 };
  return (now) => {
    if (now - w.start >= windowMs) w = { start: now, count: 0 };
    if (w.count >= limit.requests) return Math.max(1, Math.ceil((w.start + windowMs - now) / 1000));
    w.count++;
    return 0;
  };
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest();

/**
 * The quote route's rate limit and authentication, from the seller's configuration (T-324). The values are the
 * seller's own (D31): any positive whole number. Returns, for each request, the refusal or null to go on.
 */
function gate(c: SellerAdapterConfig, env: Readonly<Record<string, string | undefined>>): (req: Request) => Refused | null {
  const limits = c.quoteRateLimit ?? {};
  if (!isRecord(limits)) throw new Error('quoteRateLimit must be an object');
  for (const k of Object.keys(limits)) if (k !== 'overall') throw new Error(`quoteRateLimit has a field the adapter does not take: ${plain(k).slice(0, 60)}`);
  const l = limits.overall;
  if (l && !(Number.isSafeInteger(l.requests) && l.requests > 0 && Number.isSafeInteger(l.windowSec) && l.windowSec > 0)) {
    throw new Error('quoteRateLimit.overall needs requests and windowSec as positive whole numbers');
  }
  let accepted: Buffer[] | null = null; // SHA-256 of each credential: compared in constant time, never logged
  if (c.quoteAuth) {
    if (c.quoteAuth.kind !== 'bearer') throw new Error('quoteAuth.kind must be "bearer"');
    const list = (env[c.quoteAuth.env] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) throw new Error(`set ${c.quoteAuth.env} to one or more quote credentials, comma-separated`);
    accepted = list.map(sha256);
  }
  const overall = limits.overall ? counter(limits.overall) : null;
  const limited = (wait: number) => new Refused(429, 'rate_limited', `too many quote requests; try again in ${wait} s`, { 'retry-after': String(wait) });
  return (req) => {
    if (accepted) {
      const given = /^bearer ([\x21-\x7e]+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
      const digest = given === undefined ? null : sha256(given);
      if (!digest || !accepted.some((a) => timingSafeEqual(a, digest))) {
        return new Refused(401, 'unauthorized', 'this quote route needs Authorization: Bearer <credential>', { 'www-authenticate': 'Bearer realm="quote"' });
      }
    }
    const waitAll = overall?.(Date.now()) ?? 0;
    return waitAll ? limited(waitAll) : null;
  };
}

/** Whether a request carries `Authorization: Bearer <credential>` with one of the accepted digests, compared in constant time. */
function bearerOk(req: Request, accepted: Buffer[]): boolean {
  const given = /^bearer ([\x21-\x7e]+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
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

/** What the operators' discovery document says of the test demo, when they run one: its club, adjudicators and faucet. */
export interface Discovered {
  clubId: string | null;
  adjudicators: { primary: string | null; fallback: string | null; appeal: string | null };
  faucet: boolean;
}

// ---- Keys derived from HOLDBACK_KEY (T-432) ----
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
/**
 * A private key derived from the seller's key, a label and optionally a nonce: keccak256 of the three. Only the holder
 * of HOLDBACK_KEY can derive it, and two keys derived from it share nothing a stranger can see.
 */
export function derivedKey(key: Hex, label: string, nonce?: Hex): Hex {
  const k = keccak256(concat([key, stringToHex(label), ...(nonce === undefined ? [] : [nonce])]));
  const n = BigInt(k);
  if (n === 0n || n >= SECP256K1_ORDER) throw new Error(`the key derived for ${label} is not a valid secp256k1 key; draw another nonce`);
  return k;
}
/** The key that signs the deal whose terms carry `nonce`, in `signingKey: "per-deal"` (T-432). */
export const dealKeyOf = (key: Hex, nonce: Hex): Hex => derivedKey(key, 'crow.seller-adapter.deal-key/1', nonce);
/** The address each per-deal faucet grant sends its token unit to, so a grant on a chain mints nothing after the first. */
export const holdingKeyOf = (key: Hex): Hex => derivedKey(key, 'crow.seller-adapter.faucet-holding/1');
/**
 * The agent that signs for these terms: HOLDBACK_KEY's own when the terms name its address as the seller, else the
 * deal key its nonce derives. Refuses terms whose seller is neither, so nothing is ever signed by the wrong key.
 */
export function signerFor(key: Hex, operators: string[], pin: ReturnType<typeof knownPins>[number], terms: J): Agent {
  const seller = String(terms?.seller ?? '').toLowerCase();
  const standing = new Agent(operators, key, new Uint8Array(32), pin.domain, pin.chain);
  if (seller === standing.address) return standing;
  const nonce = terms?.nonce;
  if (typeof nonce === 'string' && /^0x[0-9a-fA-F]{64}$/.test(nonce)) {
    const deal = new Agent(operators, dealKeyOf(key, nonce as Hex), new Uint8Array(32), pin.domain, pin.chain);
    if (seller === deal.address) return deal;
  }
  throw new Error(`the terms name the seller ${plain(seller).slice(0, 60)}, which is neither HOLDBACK_KEY's address nor the deal key their nonce derives from it`);
}

/**
 * The seller's agent, signing under the settlement layer every operator serves, which must be one pinned in
 * verify.ts (SimChain, Sepolia, or HOLDBACK_DEPLOYMENT), as the buyer's signer pins it (buyer-signer.ts). Refuses
 * fewer than two operators at distinct origins, and a domain that is not pinned. seal.ts signs the same way.
 */
export async function pinnedSeller(operators: string[], key: string | undefined): Promise<{ seller: Agent; pin: ReturnType<typeof knownPins>[number]; discovered: Discovered }> {
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('set HOLDBACK_KEY to the seller\'s signing key (0x and 64 hex characters)');
  const reader = new Agent(operators, key as Hex, new Uint8Array(32)); // sealing a delivery needs no secret encryption key
  reader.sources();
  const exact = (d: J) => jcs({ ...d, verifyingContract: String(d?.verifyingContract).toLowerCase() });
  const role = (x: J, r: string) => {
    const a = Array.isArray(x?.demo?.adjudicators) ? x.demo.adjudicators.find((d: J) => d?.role === r)?.address : undefined;
    return typeof a === 'string' ? a : null;
  };
  // Every operator must serve the same document on these fields: one lying operator stops the start.
  const served = await reader.trusted('/.well-known/holdback.json', (x) => ({
    domain: x?.domain ?? null,
    clubId: typeof x?.demo?.clubId === 'string' ? x.demo.clubId : null,
    adjudicators: { primary: role(x, 'primary'), fallback: role(x, 'fallback'), appeal: role(x, 'appeal') },
    faucet: x?.demo?.faucet?.path === '/v1/faucet',
  }));
  const pins = knownPins();
  const pin = pins.find((p) => exact(p.domain) === exact(served.domain));
  if (!pin) throw new Error(`the operators serve EIP-712 domain ${plain(jcs(served.domain)).slice(0, 300)}, not one pinned in verify.ts (${pins.map((p) => jcs(p.domain)).join(' or ')})`);
  return { seller: new Agent(operators, key as Hex, new Uint8Array(32), pin.domain, pin.chain), pin, discovered: { clubId: served.clubId, adjudicators: served.adjudicators, faucet: served.faucet } };
}

/** What the shell gives the core (T-434): files, the journal and the event log, each the shell's own. */
export interface AdapterIO {
  /** A file's text, by the path the configuration holds (`template`, `reportMapping`). Throws when there is none. */
  readText(path: string): string;
  /** The shipped template's path, when the shell ships one: a configuration that uses it adds the report salt (T-431). */
  shippedTemplate?: string;
  /** The journal as last saved, or undefined for a new adapter. */
  loadJournal(): Journal | undefined | Promise<Journal | undefined>;
  /**
   * Saves the whole journal after every change. It must keep the old copy or the new one, never half of one, and
   * finish before any request the adapter sends next reaches the network: Node writes and renames a file at once;
   * a Durable Object's output gate holds outgoing requests until its storage write is done.
   */
  saveJournal(journal: Journal): void;
  /** Appends one event line (T-417). Left out: no events. */
  appendEvent?(line: string): void;
  /** The journal's path as a seller would type it, for the manual-delivery note. Left out: `<journal>`. */
  journalPath?: string;
}

/** A running core: the shell routes requests to `handle` and calls `wake` on its own schedule. */
export interface SellerAdapterCore {
  /** Answers one request. `path` is its path under the adapter's own address, such as `/quote`. */
  handle(request: Request, path?: string): Promise<Response>;
  /** Runs a pass now, or one more after the pass in progress. Passes never overlap. */
  wake(): void;
  /** Resolves when no pass is running. */
  idle(): Promise<void>;
  /** Whether a deal is open: offered, starting, started, waiting for a fix or delivering. */
  hasOpen(): boolean;
  /** A copy of the journal's deals. */
  deals(): Deal[];
  /** Logs the start-up lines: `where` says where the adapter serves, as "serves POST <url>/quote; journal <path>". */
  announce(where: string): void;
  /** Stops: no further pass starts, the one running finishes, and alerts still in flight are dropped. */
  close(): Promise<void>;
  /** How often the shell should call `wake`, in milliseconds. */
  pollMs: number;
}

/** Reads and checks a report mapping by its path, as report-converter.ts's loadReportMapping does, through `readText`. */
function readMapping(file: string, readText: (path: string) => string): ReportMapping {
  let value: unknown;
  try {
    value = JSON.parse(readText(file));
  } catch (e) {
    throw new Error((e as NodeJS.ErrnoException).code ? `${file} cannot be read: ${(e as Error).message}` : `${file} is not JSON`);
  }
  try {
    return parseReportMapping(value);
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`);
  }
}

/** Variables the shell reads for itself: no configuration may name one as a credential (T-434). */
export const SHELL_VARIABLES: readonly string[] = ['HOLDBACK_KEY', 'HOLDBACK_OPERATORS', 'HOLDBACK_DEPLOYMENT'];

const OPEN_STAGES: readonly Stage[] = ['offered', 'starting', 'start-unknown', 'started', 'refused', 'delivering'];

/**
 * The adapter's core: the quote route and the deal passes, with no file, server or timer of its own. The key and the
 * operators come from `env` (HOLDBACK_KEY, HOLDBACK_OPERATORS), never from the configuration.
 */
export async function createSellerAdapter(c: SellerAdapterConfig, env: Readonly<Record<string, string | undefined>>, io: AdapterIO): Promise<SellerAdapterCore> {
  const removed = removedError('the configuration', c);
  if (removed) throw new Error(removed);
  // A misspelt field inside a block would load silently and fall back to a default: refuse it, naming the path.
  const blocks: Array<[string, J, string[]]> = [
    ['adjudicators', c.adjudicators, ['primary', 'fallback', 'appeal']],
    ['mandate', c.mandate, ['fromFaucet', 'renewBeforeSec']],
    ['quoteAuth', c.quoteAuth, ['kind', 'env']],
    ['alerts', c.alerts, ['callback', 'secretEnv', 'timeoutMs']],
    ['redelivery', c.redelivery, ['refetchEverySec', 'readyAuth']],
    ['redelivery.readyAuth', c.redelivery?.readyAuth, ['kind', 'env']],
  ];
  for (const [at, block, keys] of blocks) {
    if (block === undefined) continue;
    if (!isRecord(block)) throw new Error(`${at} must be an object`);
    for (const k of Object.keys(block)) if (!keys.includes(k)) throw new Error(`${at} has a field the adapter does not take: ${plain(k).slice(0, 60)}`);
  }
  // Your API: its mapping and its credential, checked before anything is sent or signed (T-366).
  const sellerApi = sellerApiClient(c.sellerApi, env, { scope: Object.keys(c.scope ?? {}), options: Object.keys(isRecord(c.options) ? c.options! : {}) });
  const admit = gate(c, env); // refuses a malformed limit or a missing credential before anything is signed
  const refusal = refusalSettings(c, env);
  // Each credential has its own variable (T-434, ADR-0037 section 4). One variable named twice would send one secret to
  // two audiences: the seller's signing key to its API, its API's key to buyers, or a buyer's quote credential to the
  // ready and job routes. The shell's own variables are not credentials a configuration may name.
  const credentialVars: Array<[string, string | undefined]> = [
    ['sellerApi.auth.env', isRecord(c.sellerApi) && isRecord(c.sellerApi.auth) ? (c.sellerApi.auth as { env?: string }).env : undefined],
    ['quoteAuth.env', c.quoteAuth?.env],
    ['alerts.secretEnv', c.alerts?.secretEnv],
    ['redelivery.readyAuth.env', c.redelivery?.readyAuth?.env],
  ];
  const seenVar = new Map<string, string>();
  for (const [at, name] of credentialVars) {
    if (name === undefined) continue;
    if (SHELL_VARIABLES.includes(name)) throw new Error(`${at} names ${name}, which holds ${name === 'HOLDBACK_KEY' ? 'the seller\'s signing key' : 'the operators\' addresses'}: name a variable of its own`);
    const other = seenVar.get(name);
    if (other) throw new Error(`${at} and ${other} both name ${name}: each credential needs a variable of its own, so one secret never reaches two audiences`);
    seenVar.set(name, at);
  }
  const m = c.mandate ?? {};
  if (!isRecord(m) || (m.fromFaucet !== undefined && typeof m.fromFaucet !== 'boolean')) throw new Error('mandate.fromFaucet must be true or false');
  if (m.renewBeforeSec !== undefined && !wholeAtLeast(m.renewBeforeSec, 0)) throw new Error('mandate.renewBeforeSec must be a whole number of seconds, 0 or more');
  const operators = (env['HOLDBACK_OPERATORS'] ?? '').split(',').filter(Boolean);
  const { seller, pin, discovered } = await pinnedSeller(operators, env['HOLDBACK_KEY']);
  const token = pin.token; // the one token this settlement layer holds
  if (c.payoutAddress !== undefined && !isAddressText(c.payoutAddress)) throw new Error('payoutAddress must be an address: 0x and 40 hex characters, with a valid checksum if in mixed case');
  const payout = (c.payoutAddress ?? seller.address).toLowerCase();

  // The club and the adjudicators: the configuration's, or the ones discovery names (T-331).
  const clubId = c.clubId ?? discovered.clubId;
  if (typeof clubId !== 'string' || clubId === '') throw new Error('name clubId in the configuration: these operators\' discovery names no demo club');
  const named = c.adjudicators ?? discovered.adjudicators;
  if (!isRecord(named)) throw new Error('adjudicators must name primary, fallback and appeal');
  for (const r of ['primary', 'fallback', 'appeal'] as const) {
    const a = named[r];
    if (a === null && !c.adjudicators) throw new Error(`name adjudicators in the configuration: these operators' discovery names no ${r} adjudicator`);
    if (typeof a !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`adjudicators.${r} must be an address: 0x and 40 hex characters`);
    if (a.toLowerCase() === ZERO_ADDRESS) throw new Error(`adjudicators.${r} is the zero address: name your ${r} adjudicator, or leave adjudicators out to take the ones discovery names`);
  }
  const adjudicators = { primary: named.primary!, fallback: named.fallback!, appeal: named.appeal! };
  const fromDiscovery = { club: c.clubId === undefined, adjudicators: c.adjudicators === undefined };
  checkRules(c);
  const template = loadTemplate(c, token, io.readText);
  // Your published defaults: what every buyer reads before it asks (GET /defaults). The buyer's signer compares each
  // offer with them and shows its agent what differs (buyer-signer.ts). Placeholders stay as the template has them.
  // The optional rubric is published too: it is what a rule such as the shipped `panel` option adds to an offer.
  const defaults = JSON.stringify({
    version: 1, deliverable: template.deliverable, checks: template.checks, ...(template.rubric === undefined ? {} : { rubric: template.rubric }),
    ...(template.optionalRubric === undefined ? {} : { optionalRubric: template.optionalRubric }),
    timing: c.timing, ...(template.fee === undefined ? {} : { fee: template.fee }), scope: c.scope, options: c.options ?? {},
  });
  const reportMapping = c.reportMapping === undefined ? undefined : readMapping(c.reportMapping, io.readText);
  // The salt belongs to a template that allows it: the shipped one, or yours when you say so (T-431). The shell
  // decides which template is the shipped one; with neither said, no salt.
  const salting = c.reportSalt ?? io.shippedTemplate === c.template;
  if (salting && template.deliverable?.format !== 'application/json') {
    throw new Error(`reportSalt adds a field to a JSON report, and the template's deliverable is ${plain(String(template.deliverable?.format)).slice(0, 60)}: set reportSalt to false`);
  }
  const log = (line: string) => (c.log ?? console.log)(`${new Date().toISOString()} ${line}`);
  const journal: Journal = (await io.loadJournal()) ?? { deals: {}, quotes: {} };
  /** Saves the journal whole, through the shell: it keeps the old copy or the new one, never half of one. */
  const save = () => io.saveJournal(journal);
  // ---- Events (T-417): one JSON line each, for the seller's product metrics; never content, keys or identities ----
  let eventsBroken = false;
  const emit = (type: string, fields: Record<string, unknown>) => {
    if (!io.appendEvent) return;
    try {
      io.appendEvent(`${JSON.stringify({ schema: 'crow.seller-adapter.event/1', at: new Date().toISOString(), type, ...fields })}\n`);
    } catch (e) {
      if (!eventsBroken) log(`Events: cannot write ${plain(String(c.events ?? 'the event log'))} (${plain((e as Error).message)}); the adapter goes on without them.`);
      eventsBroken = true;
    }
  };
  const secBetween = (from: string | undefined, to: string) => (from === undefined ? null : Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  const record = (deal: Deal, change: Partial<Deal>) => {
    const from = deal.stage;
    Object.assign(deal, change);
    const now = new Date().toISOString();
    const moved = change.stage !== undefined && change.stage !== from;
    if (moved) deal.times = { ...deal.times, [deal.stage]: deal.times?.[deal.stage] ?? now };
    save();
    log(`${deal.id} is ${deal.stage}${deal.note ? `: ${plain(deal.note)}` : ''}.`);
    if (moved) emit('deal.stage', { commitmentId: deal.id, stage: deal.stage, from, secSinceOffered: secBetween(deal.times?.offered, now), secSincePrevious: secBetween(deal.times?.[from], now), ...(deal.stage === 'started' ? { startAttempts: deal.startAttempts ?? null } : {}), ...(deal.stage === 'refused' || deal.stage === 'delivered' || deal.stage === 'closed' ? { refusals: deal.refusals ?? 0 } : {}) });
  };

  // ---- The mandate: every offer needs one in the club (T-331) ----
  // On the test service (discovery offers a faucet for this club) each faucet grant signs a fresh 30-day mandate;
  // the adapter asks for 1 base unit of the test token with it, since the faucet takes no zero amount.
  const faucet = m.fromFaucet !== false && discovered.faucet && discovered.clubId === clubId;
  const renewBeforeMs = (m.renewBeforeSec ?? 86_400) * 1000;
  // A fresh key for each deal (T-432): its mandate comes from the faucet with each quote, so only the test service serves it.
  if (c.signingKey !== undefined && c.signingKey !== 'standing' && c.signingKey !== 'per-deal') throw new Error('signingKey must be "standing" or "per-deal"');
  const perDeal = c.signingKey === 'per-deal';
  if (perDeal && !faucet) throw new Error(`signingKey "per-deal" takes a mandate for each deal key from the test service's faucet, and ${m.fromFaucet === false ? 'mandate.fromFaucet is false' : `these operators serve no faucet for club ${plain(String(clubId))}`}: set signingKey to "standing"`);
  const sellerKey = env['HOLDBACK_KEY'] as Hex;
  const holding = perDeal ? new Agent(operators, holdingKeyOf(sellerKey), new Uint8Array(32)).address : undefined;
  /** The agent that signs each deal: HOLDBACK_KEY's, or the deal key the terms' nonce derives. One per deal, kept in memory only. */
  const signers = new Map<string, Agent>();
  let dealGrantAfter = 0; // local time before which no deal key is granted again, after the faucet refused one
  const signerOf = (deal: Deal): Agent => {
    let a = signers.get(deal.id);
    if (!a) signers.set(deal.id, (a = String(deal.terms.seller).toLowerCase() === seller.address ? seller : signerFor(sellerKey, operators, pin, deal.terms)));
    return a;
  };
  let mandateUntil = 0; // when the latest mandate in the club ends, in settlement-layer time; 0: none known
  /** The end of the seller's latest mandate in the club that covers selling, as every operator lists it; 0 for none. */
  async function mandateEnd(address: string = seller.address): Promise<number> {
    let list: J[];
    try {
      list = await seller.trusted(`/v1/agents/${address}`, (x) => x.mandates ?? []);
    } catch (e) {
      if (/: not_found: /.test((e as Error).message)) return 0; // an address no club has admitted yet
      throw e;
    }
    const ends = list.filter((x) => x?.clubId === clubId && Array.isArray(x?.scope?.roles) && x.scope.roles.includes('seller')).map((x) => Date.parse(x.scope.expiresAt)).filter(Number.isFinite);
    return ends.length ? Math.max(...ends) : 0;
  }
  const at = (ms: number) => new Date(ms).toISOString();
  let warned = 0;
  let faucetAfter = 0; // local time before which the faucet is not asked again, after it refused
  /** This seller and club, as the journal's `mandatesSeen` lists them. */
  const seenKey = `${seller.address.toLowerCase()} ${clubId}`;
  /** Records that this seller holds a mandate in the club, once, so a later start reads it before it asks the faucet. */
  const seen = () => {
    if (journal.mandatesSeen?.includes(seenKey)) return;
    journal.mandatesSeen = [...(journal.mandatesSeen ?? []), seenKey];
    save();
  };
  /** Makes sure a mandate covers the next `renewBeforeSec`: reads it, and on the test service asks the faucet. */
  async function checkMandate(now: number): Promise<void> {
    if (mandateUntil - now > renewBeforeMs) return;
    // On the test service a seller this journal has not seen hold a mandate goes to the faucet first (T-396): the grant
    // is the mandate, and a read before it finds none. Every other case reads first, as one may have come from elsewhere.
    if (!(faucet && !journal.mandatesSeen?.includes(seenKey))) {
      mandateUntil = await mandateEnd();
      if (mandateUntil > now) seen();
      if (mandateUntil - now > renewBeforeMs) return;
    }
    if (!faucet) {
      if (mandateUntil > now) {
        if (warned !== mandateUntil) log(`The seller's mandate in club ${plain(clubId!)} ends ${at(mandateUntil)}: ask the club's principal for a new one.`);
        warned = mandateUntil;
        return;
      }
      const offer = discovered.faucet && discovered.clubId === clubId ? ', or leave mandate.fromFaucet unset to take one from the test service\'s faucet' : '';
      throw new Error(mandateUntil ? `the seller ${seller.address}'s mandate in club ${clubId} ended ${at(mandateUntil)}: ask the club's principal for a new one${offer}` : `the seller ${seller.address} holds no mandate in club ${clubId}: ask the club's principal for one${offer}`);
    }
    // After a refusal the faucet is asked again only a minute later, however many quotes come in between.
    if (Date.now() < faucetAfter) {
      if (mandateUntil > now) return;
      throw new Error(`the seller ${seller.address} holds no mandate in club ${clubId}; the faucet refused at ${at(faucetAfter - 60_000)}, and the adapter asks again after ${at(faucetAfter)}`);
    }
    const had = mandateUntil > 0;
    let granted: J;
    try {
      granted = await seller.call('POST', '/v1/faucet', { address: seller.address, amount: '1' });
    } catch (e) {
      faucetAfter = Date.now() + 60_000;
      mandateUntil = await mandateEnd();
      if (mandateUntil > now) seen(); // a seller that holds one reads first from now on, so a refusal does not repeat
      if (mandateUntil > now) return log(`The faucet did not renew the seller's mandate (${plain((e as Error).message)}); the current one ends ${at(mandateUntil)}. The adapter asks again in a minute at the earliest.`);
      throw new Error(`the seller ${seller.address} holds no mandate in club ${clubId}, and the faucet refused: ${plain((e as Error).message)}`);
    }
    // On a chain an operator may list the new mandate some seconds after the other: wait up to about a minute for both.
    // A faucet that names no club in its answer granted tokens only (SimChain), so there is nothing to wait for.
    const waitFor = granted?.clubId === clubId ? 12 : 1;
    for (let tries = 1; ; tries++) {
      try {
        mandateUntil = await mandateEnd();
      } catch (e) {
        if (tries >= waitFor) throw e;
      }
      if (mandateUntil - now > renewBeforeMs || tries >= waitFor) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (mandateUntil <= now) throw new Error(`the seller ${seller.address} holds no mandate in club ${clubId}, and the faucet granted none`);
    seen();
    log(`The seller ${had ? 'renewed its mandate' : 'took a mandate'} in club ${plain(clubId!)} from the test service's faucet, until ${at(mandateUntil)}.`);
  }
  // One check at a time: a quote and a poll that both find the mandate ending ask the faucet once.
  let mandateChain: Promise<unknown> = Promise.resolve();
  const ensureMandate = (now: number): Promise<void> => {
    const run = mandateChain.then(() => checkMandate(now));
    mandateChain = run.catch(() => {});
    return run;
  };
  /**
   * A mandate for one deal key (T-432): a faucet grant that sends its token unit to the adapter's holding address, then
   * a wait until every operator lists the mandate. Throws when the faucet refuses; the quote then answers 503.
   */
  async function grantDealKey(address: string): Promise<void> {
    // As Agent.call sends it, and keeping the answer's Retry-After for the backoff after a refusal.
    const res = await fetch(`${operators[0]}/v1/faucet`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify({ address, amount: '1', paymentAddress: holding }) });
    const granted: J = await res.json().catch(() => ({}));
    if (!res.ok) {
      const retry = Number(res.headers.get('retry-after'));
      throw Object.assign(new Error(`POST /v1/faucet: ${plain(String(granted?.type))}: ${plain(String(granted?.detail)).slice(0, 200)}`), Number.isSafeInteger(retry) && retry > 0 ? { retryAfterSec: retry } : {});
    }
    const now = await seller.settlementNow();
    const waitFor = granted?.clubId === clubId ? 12 : 1;
    for (let tries = 1; ; tries++) {
      let until = 0;
      try {
        until = await mandateEnd(address);
      } catch (e) {
        if (tries >= waitFor) throw e;
      }
      if (until > now) return;
      if (tries >= waitFor) throw new Error(`the faucet answered, but the operators list no mandate for the deal key ${address}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (!perDeal) await ensureMandate(await seller.settlementNow()); // no mandate, no start
  else {
    log(`Signing key: a fresh key for each deal, derived from HOLDBACK_KEY; its own address ${seller.address} signs no deal. Each quote takes one faucet grant for its deal key.`);
    // Advisory, never a refusal: what still links the deals, and who can spend the faucet's grants.
    if (c.quoteAuth === undefined && c.quoteRateLimit === undefined) log('Warning: per-deal keys with no quoteAuth and no quoteRateLimit: anyone who reaches /quote spends a faucet grant with each quote, and past the faucet\'s limit a buyer is refused until it resets. Set one of them, or limit /quote in your proxy.');
    if (c.payoutAddress === undefined) log(`Warning: every deal names HOLDBACK_KEY's address ${seller.address} as its payout address, which links the deals in their terms and on the chain. Set payoutAddress to an address of its own to keep HOLDBACK_KEY out of them.`);
  }
  // ADR-0033 §7: one line on where payments go, and the advisory warnings for an odd payout address. None stops the start.
  if (perDeal) log(`Payout address: ${payout}${c.payoutAddress === undefined ? ", HOLDBACK_KEY's address, as payoutAddress is not set" : ''}. Every deal names it; the deal keys receive none.`);
  else if (c.payoutAddress === undefined) log(`Payout address: not set. Payments go to the signing address ${seller.address}.`);
  else if (payout === seller.address) log(`Payout address: ${payout}, the signing address itself. Payments go there.`);
  else log(`Payout address: ${payout}. Payments go there; the signing address ${seller.address} receives none.`);
  for (const w of moneyAddressWarnings('payout', payout, pin, adjudicators)) log(w);

  // ---- 1. Quote to offer ----
  /** `buyerPaymentAddress`: the address the buyer's quote named, lowercase, or undefined for its signing address. */
  async function offerFor(buyer: string, buyerEncryptionPublicKey: string, buyerPaymentAddress: string | undefined, scope: J, options: J): Promise<J> {
    refusalFor(c, template, scope, options); // the seller's own exclusions, before its API is asked
    // ADR-0033 §6: the buyer's money address against the deal's adjudicators and this deployment. Advisory only.
    for (const w of moneyAddressWarnings('payment', buyerPaymentAddress ?? buyer, pin, adjudicators)) log(`Quote from ${buyer}: ${w}`);
    // The mandate before the price: a seller that cannot offer now costs its API no call. This renews a test
    // mandate that ran out while the adapter waited.
    try {
      if (!perDeal) await ensureMandate(await seller.settlementNow()); // renews a test mandate that ran out while the adapter waited
    } catch (e) {
      log(`Quote refused: ${plain((e as Error).message)}.`);
      throw new Refused(503, 'seller_unavailable', 'the seller holds no mandate to offer now');
    }
    let quoted: J;
    let sellerApiQuoteMs: number | null = null;
    try {
      // Your API's errors name the call and the status only; its body is your API's and may be anything.
      const asked = Date.now();
      quoted = await sellerApi.quote({ buyer, scope, options });
      sellerApiQuoteMs = Date.now() - asked;
    } catch (e) {
      log(`Quote failed: ${plain((e as Error).message)}.`);
      throw new Refused(502, 'seller_api_failed', 'the seller could not price this scope');
    }
    // A mapping that reads no token prices in the settlement layer's token (T-366).
    const price = sellerApi.readsToken ? quoted?.price : { ...quoted?.price, token: token.id };
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
    const validForSec = quoted.validForSec;
    if (validForSec !== undefined && (!Number.isSafeInteger(validForSec) || validForSec < 0)) throw new Refused(502, 'seller_api_failed', 'the seller could not price this scope');
    const built = termsFor(c, template, scope, options, deliverWithinSec);
    // The offer never outlives your price: how long the price holds caps the offer's window.
    if (validForSec !== undefined) built.timing.offerExpiresInSec = Math.min(built.timing.offerExpiresInSec, validForSec);
    const panel = Array.isArray(built.rubric?.criteria) && built.rubric.criteria.length > 0;
    // The key that signs this deal (T-432): HOLDBACK_KEY's, or a fresh one from the offer's nonce with its own mandate.
    let signer = seller;
    let nonce: Hex | undefined;
    let grantMs: number | null = null;
    if (perDeal) {
      // After a refusal the faucet is not asked again until its own Retry-After has passed, however many quotes come in.
      const waitSec = Math.ceil((dealGrantAfter - Date.now()) / 1000);
      if (waitSec > 0) throw new Refused(503, 'seller_unavailable', 'the seller cannot take a key for a new deal now; try again later', { 'retry-after': String(waitSec) });
      nonce = freshNonce().toLowerCase() as Hex;
      signer = new Agent(operators, dealKeyOf(sellerKey, nonce), new Uint8Array(32), pin.domain, pin.chain);
      const asked = Date.now();
      try {
        await grantDealKey(signer.address);
      } catch (e) {
        const retryAfterSec = Math.max(60, (e as { retryAfterSec?: number }).retryAfterSec ?? 0);
        dealGrantAfter = Date.now() + retryAfterSec * 1000;
        log(`Quote refused: the faucet gave the deal key ${signer.address} no mandate (${plain((e as Error).message)}). No offer is signed with HOLDBACK_KEY instead; the faucet is asked again in ${retryAfterSec} s at the earliest.`);
        throw new Refused(503, 'seller_unavailable', 'the seller cannot take a key for a new deal now; try again later', { 'retry-after': String(retryAfterSec) });
      }
      grantMs = Date.now() - asked;
    }
    let offer;
    try {
      offer = await signer.offer({
        ...(nonce === undefined ? {} : { nonce }),
        template: panel ? 'default' : 'checks-only',
        clubId,
        seller: signer.address,
        // The buyer's payment address as its quote named it, and this seller's payout address from its own
        // configuration (ADR-0033 §6). Agent.offer rebuilds the prepared terms and refuses any other address in them.
        buyer: { address: buyer, encryptionPublicKey: buyerEncryptionPublicKey, ...(buyerPaymentAddress && buyerPaymentAddress !== buyer ? { paymentAddress: buyerPaymentAddress } : {}) },
        ...(payout !== signer.address ? { sellerPayoutAddress: payout } : {}),
        adjudicators,
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
    if (perDeal) signers.set(id, signer);
    // Agent.offer signed only terms it rebuilt from this request; this says so again where it matters most.
    if (String(terms.sellerPayoutAddress).toLowerCase() !== payout) throw new Error(`the signed offer ${id} names ${terms.sellerPayoutAddress} as the payout address, not the configured ${payout}`);
    journal.deals[id] = { id, stage: 'offered', terms, scope, ...(options === undefined ? {} : { options }), ...(typeof quoted.quoteId === 'string' ? { quoteId: quoted.quoteId } : {}), ...(salting ? { salt: `0x${randomBytes(32).toString('hex')}` } : {}), times: { offered: new Date().toISOString() } };
    save();
    emit('deal.offered', { commitmentId: id, price: terms.price, ...(quoted.units === undefined ? {} : { units: quoted.units }), deliverWithinSec: Math.round((Date.parse(terms.timing.deliverBy) - Date.parse(terms.createdAt)) / 1000), sellerApiQuoteMs, ...(perDeal ? { grantMs } : {}) });
    log(`${id} is offered${perDeal ? `, signed by its deal key ${signer.address},` : ''} to ${terms.buyer} for ${terms.price.amount} base units of ${plain(terms.price.token)}; the offer expires ${terms.timing.offerExpiresAt}.`);
    // What the buyer pays on top of the price: the adjudication fee, and the operators' fee when they publish one.
    const schedule = await seller.operatorFeeSchedule();
    const operatorFee = schedule ? operatorFeeOf(terms.price, schedule) : 0n;
    const operator = schedule ? { token: schedule.token, amount: operatorFee.toString() } : null;
    // `total` is what the buyer funds: the price plus both fees. The buyer computes it again from the terms itself.
    const total = { token: terms.price.token, amount: (BigInt(terms.price.amount) + BigInt(terms.adjudication.fee.amount) + operatorFee).toString() };
    return { commitmentId: id, price: terms.price, fees: { adjudication: terms.adjudication.fee, operator, total }, expiresAt: terms.timing.offerExpiresAt };
  }

  const inFlight = new Map<string, { bodyHash: string; answer: Promise<J> }>();
  /** `replayed`: the same Idempotency-Key and body answered before, so the answer is the stored one (T-417). */
  async function quote(req: Request): Promise<{ answer: J; replayed: boolean }> {
    const body = await readJson(req);
    const { buyer, buyerEncryptionPublicKey, buyerPaymentAddress, scope, options } = body ?? {};
    if (typeof buyer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(buyer)) throw new Refused(400, 'invalid_request', 'buyer must be an address: 0x and 40 hex characters');
    if (buyerPaymentAddress !== undefined && !isAddressText(buyerPaymentAddress)) throw new Refused(400, 'invalid_request', 'buyerPaymentAddress must be an address: 0x and 40 hex characters, or left out for the buyer\'s own');
    const paying: string | undefined = buyerPaymentAddress?.toLowerCase();
    if (typeof buyerEncryptionPublicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(buyerEncryptionPublicKey)) throw new Refused(400, 'invalid_request', 'buyerEncryptionPublicKey must be an x25519 public key, base64url, 43 characters');
    const wrong = fieldsError('scope', scope, c.scope) ?? (options === undefined ? null : fieldsError('options', options, c.options ?? {}));
    if (wrong) throw new Refused(400, 'invalid_request', wrong);
    const idempotencyKey = req.headers.get('idempotency-key') ?? undefined;
    if (idempotencyKey === undefined) return { answer: await offerFor(buyer.toLowerCase(), buyerEncryptionPublicKey, paying, scope, options), replayed: false };
    // The same key with the same body replays the answer; with another body it is a conflict.
    if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new Refused(400, 'invalid_request', 'Idempotency-Key must be 1 to 200 printable characters');
    const bodyHash = createHash('sha256').update(jcs({ buyer: buyer.toLowerCase(), buyerEncryptionPublicKey, ...(paying === undefined ? {} : { buyerPaymentAddress: paying }), scope, ...(options === undefined ? {} : { options }) })).digest('hex');
    const seen = journal.quotes[idempotencyKey] ?? inFlight.get(idempotencyKey);
    if (seen && seen.bodyHash !== bodyHash) throw new Refused(409, 'idempotency_conflict', 'this Idempotency-Key was used with another request');
    if (seen) return { answer: await seen.answer, replayed: true };
    const answer = offerFor(buyer.toLowerCase(), buyerEncryptionPublicKey, paying, scope, options);
    inFlight.set(idempotencyKey, { bodyHash, answer });
    try {
      journal.quotes[idempotencyKey] = { bodyHash, answer: await answer };
      save();
      return { answer: await answer, replayed: false };
    } finally {
      inFlight.delete(idempotencyKey);
    }
  }

  // ---- 2 and 3. Funded hold to start, result to delivery ----
  /**
   * Moves one deal as far as it can go now. A read every operator must answer the same way decides each step.
   * `passNow` is settlement-layer time, read once for the pass. `full`: read a waiting deal's state even when
   * nothing is due (the first pass after a start).
   */
  async function advance(deal: Deal, passNow: () => Promise<number>, full: boolean): Promise<void> {
    const id = deal.id;
    if (deal.stage === 'refused' && deal.ready !== true && !full) {
      // A refused deal waits for a fixed report: it reads nothing until a fetch or deliverBy is due (T-329 triage 2).
      const now = await passNow();
      const due = Date.parse(deal.terms.timing.deliverBy) <= now || (refusal.refetchEverySec !== undefined && (deal.nextFetchAt === undefined || Date.parse(deal.nextFetchAt) <= now));
      if (!due) return;
    }
    const escrowState = () => seller.trusted<string>(`/v1/commitments/${id}`, (x) => x.escrowState);
    if (deal.stage === 'offered') {
      const state = await escrowState();
      if (BEFORE_HOLD.includes(state)) return;
      if (state !== 'Held') return record(deal, { stage: 'closed', note: `the offer ended ${state} with no job started` });
      // Recorded before the call. A repeatable start sent again after a crash carries the same key; a one-shot start
      // counts its attempts from 0 here, so a journal without the count (written before T-408) reads as attempted.
      record(deal, { stage: 'starting', startAttempts: 0, note: 'every operator shows the hold funded' });
    }
    if (deal.stage === 'starting') {
      // A `starting` deal with no count comes from a journal written before T-408, whose start went out at least once.
      if (!sellerApi.startRepeatable && (deal.startAttempts === undefined || deal.startAttempts > 0)) {
        // T-408: the API cannot tell a repeat from a new job, so a second start could start (and charge) a second
        // one. The adapter never sends it again: a person finds the job at the seller and names it.
        const deliverBy: string = deal.terms.timing.deliverBy;
        record(deal, { stage: 'start-unknown', note: `the start was sent and no job ID came back; name the job with POST /deals/${id}/job before ${deliverBy}` });
        return alert({ type: 'job.start_unknown', commitmentId: id, deliverBy }, `the start was sent and no job ID came back; the adapter will not send it again. Find the job at the seller's API and name it with POST /deals/${id}/job before ${deliverBy}`);
      }
      if (!sellerApi.startRepeatable) {
        // The one start: only while the hold is funded and the deadline is ahead.
        const state = await escrowState();
        if (state !== 'Held') return record(deal, { stage: 'closed', note: `the deal is ${state}; no job started` });
        if (Date.parse(deal.terms.timing.deliverBy) <= (await seller.settlementNow())) return record(deal, { stage: 'closed', note: 'the delivery deadline passed before the job started' });
      }
      // Recorded before the call: a crash or a lost answer after it is seen on the next pass. A repeatable start
      // carries the deal's ID as its key, so a repeat returns the same job.
      record(deal, { startAttempts: (deal.startAttempts ?? 0) + 1 });
      const jobId = await sellerApi.start({ commitmentId: id, quoteId: deal.quoteId, buyer: deal.terms.buyer, scope: deal.scope, options: deal.options });
      record(deal, { stage: 'started', jobId, note: `job ${jobId}` });
    }
    if (deal.stage === 'start-unknown') {
      if (Date.parse(deal.terms.timing.deliverBy) <= (await seller.settlementNow())) return record(deal, { stage: 'closed', note: 'the delivery deadline passed with no job named; the buyer may reclaim the hold' });
      return;
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
      // The address is the configuration's; only named values, such as the job's ID from your API, go into it.
      const values = { commitmentId: id, quoteId: deal.quoteId, jobId: deal.jobId!, buyer: deal.terms.buyer, scope: deal.scope, options: deal.options };
      const job = await sellerApi.result(values);
      if (job.state === 'running') {
        // The job still runs. A new status value (`queued`, then `running`) is an event: the queue's time shows.
        if (job.status !== undefined && job.status !== deal.jobStatus) {
          const now = new Date().toISOString();
          deal.jobStatus = job.status;
          save();
          emit('job.status', { commitmentId: id, status: job.status, secSinceStarted: secBetween(deal.times?.started, now) });
        }
        return;
      }
      if (job.state === 'failed') {
        // A failed job is never delivered. The deal closes, so the seller hears of it once.
        const said = `the seller's job ${deal.jobId} failed (${job.status}); nothing is delivered, and the buyer may reclaim the hold after deliverBy ${deliverBy}`;
        record(deal, { stage: 'closed', ready: false, note: said });
        return alert({ type: 'job.failed', commitmentId: id, jobId: deal.jobId!, status: job.status, deliverBy }, said);
      }
      const result = job.bytes;
      if (deal.times?.jobDone === undefined) {
        const now = new Date().toISOString();
        deal.times = { ...deal.times, jobDone: now };
        save();
        emit('job.done', { commitmentId: id, secSinceStarted: secBetween(deal.times?.started, now), bytes: result.length });
      }
      const resultSha256 = createHash('sha256').update(result).digest('hex');
      let bytes = result;
      try {
        // Further files the result names, added before the checks run (T-366). One that fails holds the delivery.
        bytes = await sellerApi.withFiles(result, values);
        if (bytes !== result) log(`${id} added the result's files: ${result.length} bytes to ${bytes.length} bytes.`);
      } catch (e) {
        if (!(e instanceof FilesNotAdded)) throw e;
        return refuse(deal, now, resultSha256, { result: 'files_not_added', files: e.message, checks: [] }, `its files could not be added: ${e.message}`);
      }
      if (reportMapping) {
        // Your report in the template's shape (T-323). A report the mapping cannot convert is never delivered.
        try {
          // The result with its files, so the mapping can place them (T-366).
          const before = bytes;
          bytes = convertReport(reportMapping, before);
          log(`${id} converted the result with the report mapping: ${before.length} bytes to ${bytes.length} bytes.`);
        } catch (e) {
          if (!(e instanceof ReportNotConverted)) throw e;
          return refuse(deal, now, resultSha256, { result: 'not_converted', conversion: e.message, checks: [] }, `the report mapping cannot convert it: ${e.message}`);
        }
      }
      if (deal.salt !== undefined) {
        // The salt (T-431), drawn with the offer: every retry delivers the same bytes, and a deal offered without one
        // (another template, or before the salt) gets none, whatever the configuration says now.
        try {
          const before = bytes.length;
          bytes = addSalt(bytes, deal.salt);
          log(`${id} added the report's salt: ${before} bytes to ${bytes.length} bytes.`);
        } catch (e) {
          if (!(e instanceof SaltNotAdded)) throw e;
          return refuse(deal, now, resultSha256, { result: 'not_salted', salt: e.message, checks: [] }, `the salt cannot be added: ${e.message}`);
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
      await signerOf(deal).deliver(deal.terms, bytes);
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
    // `manual`: a redirect comes back unfollowed, and counts as a failed callback (T-433). The body and its signature
    // go only to the configured address.
    const sent: Promise<void> = fetch(refusal.callback, { method: 'POST', headers, body: text, redirect: 'manual', signal: AbortSignal.any([alertsAbort.signal, AbortSignal.timeout(refusal.timeoutMs)]) })
      .then(async (res) => {
        await res.body?.cancel();
        if (isRedirect(res)) log(`${body.commitmentId} the alert callback answered ${res.status} to ${body.type}, a redirect, which the adapter never follows; the ALERT line is the record.`);
        else if (!res.ok) log(`${body.commitmentId} the alert callback answered ${res.status} to ${body.type}; the ALERT line is the record.`);
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
      : `The adapter holds the delivery until ${deliverBy}; set redelivery to have it fetch a fixed report, or deliver a fixed file by hand: node examples/check-delivery.ts <terms.json> <file>, then node examples/seal.ts ${io.journalPath ?? '<journal>'} <file> ${deal.id}`;
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
      ...(typeof detail['files'] === 'string' ? [`FILES NOT ADDED ${plain(detail['files'])}`] : []),
    ];
    emit('delivery.refused', { commitmentId: deal.id, attempt, failedChecks: Array.isArray((detail as J).checks) ? (detail as J).checks.filter((x: J) => x.outcome !== 'pass').map((x: J) => String(x.checkId)) : [], refusedCode: (detail as J).refused?.code ?? null });
    alert({ type: 'delivery.refused', commitmentId: deal.id, deliverBy, attempt, ...detail, nextFetchAt: nextFetchAt ?? null }, `${reasons.join('; ') || plain(why)}. ${waits}.`);
  }

  let closed = false;
  let running: Promise<void> | undefined;
  let again = false;
  const lastError = new Map<string, string>();
  let firstPass = true;
  let mandateCheckedAt = Date.now(); // the start checked it
  async function pass(): Promise<void> {
    const full = firstPass;
    firstPass = false;
    let now: Promise<number> | undefined;
    const passNow = () => (now ??= seller.settlementNow());
    if (!perDeal && Date.now() - mandateCheckedAt >= 60_000) {
      // Once a minute: renew a test mandate before it runs out, so a quote rarely waits for the faucet.
      mandateCheckedAt = Date.now();
      try {
        await ensureMandate(await passNow());
        lastError.delete('mandate');
      } catch (e) {
        const message = plain((e as Error).message);
        if (lastError.get('mandate') !== message) log(`The mandate check failed: ${message}. The adapter tries again in a minute.`);
        lastError.set('mandate', message);
      }
    }
    for (const deal of Object.values(journal.deals)) {
      if (closed) return;
      if (!['offered', 'starting', 'start-unknown', 'started', 'refused', 'delivering'].includes(deal.stage)) continue;
      try {
        await advance(deal, passNow, full);
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

  type Send = (status: number, body: unknown, headers?: Record<string, string>) => Response;
  const send: Send = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

  /**
   * POST /deals/<commitmentId>/ready: the seller says its fixed report is ready (T-329). It takes no body: the
   * adapter fetches the report from the result address in its configuration, never from the request.
   */
  function readySignal(req: Request, commitmentId: string): Response {
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

  /**
   * POST /deals/<commitmentId>/job, body {"jobId": "<ID>"} (T-408): a person names the job of a deal whose start was
   * sent with no answer, after finding it at the seller's API. Behind the ready route's credential. The adapter then
   * follows that job as if the start had answered.
   */
  async function jobNamed(req: Request, commitmentId: string): Promise<Response> {
    if (req.method !== 'POST') return send(405, { type: 'method_not_allowed', detail: 'this route takes POST' });
    if (!bearerOk(req, refusal.ready!)) return send(401, { type: 'unauthorized', detail: 'this route needs Authorization: Bearer <credential>' }, { 'www-authenticate': 'Bearer realm="job"' });
    const bytes = await bodyOf(req, 4096);
    if (bytes === null) return send(413, { type: 'too_large', detail: 'the body is a JSON object with one jobId' });
    let jobId: unknown;
    try {
      jobId = JSON.parse(new TextDecoder().decode(bytes))?.jobId;
    } catch {
      return send(400, { type: 'invalid_body', detail: 'the body is JSON: {"jobId": "<the job\'s ID>"}' });
    }
    if (Number.isSafeInteger(jobId) && (jobId as number) >= 0) jobId = String(jobId);
    if (typeof jobId !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(jobId)) return send(400, { type: 'invalid_body', detail: 'jobId is the job\'s ID: 1 to 200 printable characters, or a whole number' });
    const id = commitmentId.toLowerCase();
    const deal = Object.hasOwn(journal.deals, id) ? journal.deals[id]! : undefined;
    if (!deal) return send(404, { type: 'not_found', detail: 'this adapter holds no such deal' });
    if (deal.stage !== 'start-unknown') return send(409, { type: 'not_waiting', detail: `the deal is ${deal.stage}, not waiting for its job's ID` });
    const holder = Object.values(journal.deals).find((d) => d.id !== deal.id && d.jobId === jobId);
    if (holder) return send(409, { type: 'job_taken', detail: `job ${jobId} belongs to another deal in this journal, ${holder.id}` });
    record(deal, { stage: 'started', jobId, note: `job ${jobId}, named by the seller's operator` });
    wake();
    return send(202, { commitmentId: id, stage: deal.stage, jobId });
  }

  /** One request, by its path under the adapter's address: the same routes the Node server served before T-434. */
  async function handle(req: Request, path: string = new URL(req.url).pathname): Promise<Response> {
    // The published defaults are public: no credential, and they make the adapter sign nothing.
    if (path === '/defaults' && req.method === 'GET') return new Response(defaults, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' } });
    const readyFor = refusal.ready ? /^\/deals\/(0x[0-9a-fA-F]{64})\/ready$/.exec(path)?.[1] : undefined;
    if (readyFor) return readySignal(req, readyFor);
    const jobFor = refusal.ready ? /^\/deals\/(0x[0-9a-fA-F]{64})\/job$/.exec(path)?.[1] : undefined;
    if (jobFor) return jobNamed(req, jobFor).catch(() => send(400, { type: 'invalid_body', detail: 'the body could not be read' }));
    if (path !== '/quote') return send(404, { type: 'not_found', detail: 'this adapter serves POST /quote and GET /defaults' });
    if (req.method !== 'POST') return send(405, { type: 'method_not_allowed', detail: 'this adapter serves POST /quote' });
    const refused = admit(req); // the rate limit and the credential, before the body is read
    if (refused) {
      emit('quote.refused', { status: refused.status, reason: refused.type, ms: 0 });
      return send(refused.status, { type: refused.type, detail: refused.message }, refused.headers);
    }
    const asked = Date.now();
    try {
      const { answer, replayed } = await quote(req);
      emit('quote.answered', { commitmentId: answer.commitmentId, ms: Date.now() - asked, replayed });
      return send(200, answer);
    } catch (err) {
      const e = err as Error;
      emit('quote.refused', { status: e instanceof Refused ? e.status : 500, reason: e instanceof Refused ? e.type : 'internal', ms: Date.now() - asked });
      if (e instanceof Refused) return send(e.status, { type: e.type, detail: e.message }, e.headers);
      log(`Quote failed: ${plain(e.message)}.`);
      return send(500, { type: 'internal', detail: 'the adapter could not answer' });
    }
  }

  return {
    handle,
    wake,
    idle: async () => {
      while (running) await running;
    },
    hasOpen: () => Object.values(journal.deals).some((d) => OPEN_STAGES.includes(d.stage)),
    deals: () => structuredClone(Object.values(journal.deals)),
    pollMs: c.pollMs,
    announce(where: string) {
      log(`Seller adapter for ${perDeal ? `a fresh key each deal, from HOLDBACK_KEY at ${seller.address},` : seller.address} ${where}, ${Object.keys(journal.deals).length} deals.`);
      const source = (yes: boolean) => (yes ? 'from discovery' : 'from the configuration');
      log(`Offers name club ${plain(clubId)} and its adjudicators ${fromDiscovery.club === fromDiscovery.adjudicators ? source(fromDiscovery.club) : `${source(fromDiscovery.adjudicators)}, the club ${source(fromDiscovery.club)}`}: primary ${adjudicators.primary}, fallback ${adjudicators.fallback}, appeal ${adjudicators.appeal}. ${perDeal ? 'Each deal key takes its own mandate from the faucet with its quote' : `The mandate ends ${at(mandateUntil)}${faucet ? '; the faucet renews it' : ''}`}.`);
      log(`A refused result alerts by the log${refusal.callback ? ' and the callback' : ''}${refusal.secret ? ', signed' : ''}; the adapter fetches it again ${refusal.refetchEverySec === undefined ? 'only when you say' : `every ${refusal.refetchEverySec} s`}${refusal.ready ? ', and on POST /deals/<commitmentId>/ready' : ''}, until deliverBy.`);
      if (!sellerApi.startRepeatable) log(`The seller API's start is sent at most once a deal: ${sellerApi.startOneShotBecause}. A start sent with no answer holds the deal at start-unknown${refusal.ready ? ', until you name the job with POST /deals/<commitmentId>/job' : '; with no ready credential set (redelivery.readyAuth) nobody can name the job, and the deal closes at deliverBy'}.`);
      const limit = c.quoteRateLimit?.overall;
      log(sellerApi.describe);
      log(`The quote route takes ${c.quoteAuth ? `a bearer credential from ${plain(c.quoteAuth.env)}` : 'no credential'}; rate limit ${limit ? `${limit.requests} per ${limit.windowSec} s` : 'none'}.`);
    },
    close: async () => {
      closed = true;
      await running;
      alertsAbort.abort(); // an alert still in flight is dropped; its ALERT line is in the log
      await Promise.all([...alertsInFlight]);
    },
  };
}
