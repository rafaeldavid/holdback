// The seller's own HTTP API, as the seller adapter calls it (T-366). The configuration's `sellerApi` block says how:
// three addresses in today's fixed shapes, or a mapping for each call: a method, a path under one base URL, headers
// and a JSON body template, with answers read by JSON pointers. A credential for the API comes from an environment
// variable. The job's state is read by HTTP status or by a status field; a result may name further files, which the
// adapter fetches one by one and adds to the delivered JSON before the checks run.
//
// Everything here is data. A placeholder is a name in double braces, `{{scope}}` or `{{jobId}}`, from a fixed list:
// no expressions, no code, no template language beyond that. Every request goes under `baseUrl` when one is set, and
// a mapping needs one: a configuration or an answer that would send a request anywhere else is refused. The
// credential is sent only to those requests, and never logged, journaled or put in an error message.
import { plain } from '@holdback/testkit';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The largest delivery the adapter makes, in bytes: the test service's ciphertext limit (discovery, `limits.maxCiphertextBytes`). */
export const DELIVERY_CAP_BYTES = 1_048_576;

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

/** One request to the seller's API. `path` is under `baseUrl`; `body` is a JSON template, `null` for no body. */
export interface CallMapping {
  method?: Method;
  path: string;
  headers?: Record<string, string>;
  body?: J;
}
export interface QuoteMapping extends CallMapping {
  /**
   * JSON pointers into the answer. Left out: today's `/price/amount`, `/price/token`, `/quoteId`, `/deliverWithinSec`.
   * `units` instead of `amount`: the answer counts units (credits, hours), and the price is that count times `unitPrice`.
   */
  read?: { amount?: string; units?: string; token?: string; quoteId?: string; deliverWithinSec?: string; validForSec?: string };
  /** With `read.units`: the price of one unit, in the token's base units as a decimal string (T-406). */
  unitPrice?: string;
}
export interface StartMapping extends CallMapping {
  /** A JSON pointer to the job's ID in the answer. Left out: `/jobId`. */
  read?: { jobId?: string };
  /** The header that carries the deal's ID as the idempotency key. Left out: `Idempotency-Key`. */
  idempotencyHeader?: string;
  /**
   * Whether the API returns the same job when the start is sent again with the same key (T-408). Left out: true
   * when the mapping names an `idempotencyHeader`, false when it names none. A start that is not repeatable is sent at
   * most once a deal.
   */
  repeatable?: boolean;
}
/** How the result call says the job runs, is done or failed. Left out: HTTP 202 runs, 200 is done. */
export type JobStatus =
  | { by: 'http'; running?: number[]; done?: number[]; failed?: number[] }
  | { by: 'field'; pointer: string; running: string[]; done: string[]; failed: string[] };
/** Further files the result names: fetched one by one and added to it before the checks run. */
export interface FilesMapping {
  /** A JSON pointer to a list of file paths inside the result. */
  list: string;
  /** The path that fetches one file, under `baseUrl`, with `{{file}}` where the file's path goes. */
  path: string;
  /** A JSON pointer to the field that receives `[{path, content}]`. It must be absent, or be `list` itself. */
  into: string;
  maxCount: number;
  maxTotalBytes: number;
  /** How a file's bytes become `content`. Left out: `utf8`. */
  encoding?: 'utf8' | 'base64';
}
export interface ResultMapping extends CallMapping {
  status?: JobStatus;
  /** A JSON pointer to the result inside the answer that holds it. Left out: the whole answer. */
  report?: string;
  /** A second call, made once the job is done, whose answer holds the result. */
  reportCall?: CallMapping;
  files?: FilesMapping;
}
export interface SellerApiConfig {
  /** Every request goes under this address. Required with a mapping or a credential. */
  baseUrl?: string;
  /** The credential: the value of environment variable `env`, sent as `<header>: <prefix><value>`. */
  auth?: { env: string; header: string; prefix?: string };
  quote: string | QuoteMapping;
  start: string | StartMapping;
  result: string | ResultMapping;
}

/** The named values a placeholder may stand for. */
export interface Values {
  buyer?: string | undefined;
  scope?: J;
  options?: J;
  commitmentId?: string | undefined;
  quoteId?: string | undefined;
  jobId?: string | undefined;
  file?: string | undefined;
}

/** A further file could not be fetched or added: the delivery waits, and the seller is alerted. */
export class FilesNotAdded extends Error {}

/** `status`, when the state is read by a field: the field's value, such as `queued` or `running` (T-417, for the events). */
export type JobAnswer = { state: 'running'; status?: string } | { state: 'failed'; status: string } | { state: 'done'; bytes: Uint8Array };

export interface SellerApi {
  /** One log line: where the API is and how it is reached. Names the credential's variable, never its value. */
  describe: string;
  /** false: the quote's answer names no token, so the price is in the settlement layer's token. */
  readsToken: boolean;
  /** false: a start sent again could start a second job, so the adapter sends it at most once a deal (T-408). */
  startRepeatable: boolean;
  /** Why a start is not repeatable, for the start-up line; absent when it is. */
  startOneShotBecause?: string;
  quote(v: Values): Promise<J>;
  start(v: Values): Promise<string>;
  result(v: Values): Promise<JobAnswer>;
  /** The result with its further files added, or the result as it is when none are configured. */
  withFiles(result: Uint8Array, v: Values): Promise<Uint8Array>;
}

const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)(?:\.([A-Za-z][A-Za-z0-9]*))?\}\}/g;
const WHOLE = /^\{\{([A-Za-z][A-Za-z0-9]*)(?:\.([A-Za-z][A-Za-z0-9]*))?\}\}$/;
const TOKEN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
const RESERVED_HEADERS = ['host', 'content-length', 'transfer-encoding', 'connection'];
const CONTROL = /[\0-\x1f\x7f]/;
const OMIT = Symbol('omit');
const isRecord = (v: J): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
const short = (v: J) => plain(String(v)).slice(0, 80);

/** The names each call may use. `scope` and `options` stand alone only, as a whole body value. */
const NAMES = {
  quote: ['buyer', 'scope', 'options'],
  start: ['buyer', 'scope', 'options', 'commitmentId', 'quoteId'],
  result: ['buyer', 'scope', 'options', 'commitmentId', 'quoteId', 'jobId'],
  file: ['buyer', 'scope', 'options', 'commitmentId', 'quoteId', 'jobId', 'file'],
} as const;
type Use = keyof typeof NAMES;

/** Fields the configuration's scope and option rules define: `{{scope.<field>}}` and `{{options.<field>}}` must name one. */
export interface Fields {
  scope: string[];
  options: string[];
}

/** Throws unless every placeholder in `text` is a name this call may use; `whole`: the string is a whole body value. */
function checkText(at: string, text: string, use: Use, fields: Fields, whole: boolean): void {
  const rest = text.replace(PLACEHOLDER, '');
  if (rest.includes('{{') || rest.includes('}}')) throw new Error(`${at}: a placeholder is {{name}} or {{scope.<field>}}, nothing else`);
  for (const [m, name, field] of text.matchAll(PLACEHOLDER)) {
    if (!(NAMES[use] as readonly string[]).includes(name!)) throw new Error(`${at} uses {{${name}}}, which this call cannot fill (it takes ${NAMES[use].join(', ')})`);
    if (field !== undefined) {
      if (name !== 'scope' && name !== 'options') throw new Error(`${at} uses ${m}: only scope and options have fields`);
      if (!fields[name].includes(field)) throw new Error(`${at} uses ${m}, which the ${name === 'scope' ? 'scope' : 'option'} rules do not define`);
    } else if ((name === 'scope' || name === 'options') && !(whole && m === text)) {
      throw new Error(`${at} uses {{${name}}} inside text: it stands alone, as a whole body value, or as {{${name}.<field>}}`);
    }
  }
}
function checkTemplate(at: string, node: J, use: Use, fields: Fields): void {
  if (typeof node === 'string') return checkText(at, node, use, fields, true);
  if (Array.isArray(node)) return node.forEach((n, i) => checkTemplate(`${at}[${i}]`, n, use, fields));
  if (isRecord(node)) for (const [k, v] of Object.entries(node)) checkTemplate(`${at}.${k}`, v, use, fields);
}

function valueOf(v: Values, name: string, field: string | undefined): J {
  const got = (v as J)[name];
  if (field === undefined) return got;
  return isRecord(got) && Object.hasOwn(got, field) ? got[field] : undefined;
}
/** A value as text: a list joins with commas, an absent value is empty. */
const asText = (x: J): string => (x === undefined || x === null ? '' : Array.isArray(x) ? x.join(',') : String(x));

/** A body template filled in one pass: a value is never read as a placeholder. An absent whole value drops its key. */
function fillBody(node: J, v: Values): J {
  if (typeof node === 'string') {
    const whole = WHOLE.exec(node);
    if (whole) {
      const x = valueOf(v, whole[1]!, whole[2]);
      return x === undefined ? OMIT : structuredClone(x);
    }
    return node.replace(PLACEHOLDER, (_m, name: string, field?: string) => asText(valueOf(v, name, field)));
  }
  if (Array.isArray(node)) return node.map((n) => fillBody(n, v)).filter((n) => n !== OMIT);
  if (isRecord(node)) return Object.fromEntries(Object.entries(node).map(([k, x]) => [k, fillBody(x, v)]).filter(([, x]) => x !== OMIT));
  return node;
}

/** A segment of a path: percent-encoded, and never `.`, `..` or empty, so it cannot climb out of the base URL. */
function segment(at: string, s: string): string {
  if (s === '' || s === '.' || s === '..') throw new Error(`${at}: a path segment is empty, "." or "..", which could leave the base URL`);
  return encodeURIComponent(s);
}

/** The address a URL template names for these values: placeholders encoded, then checked under the base URL. */
function urlFor(at: string, template: string, v: Values, base: URL | undefined): URL {
  const filled = template.replace(PLACEHOLDER, (_m, name: string, field?: string) => {
    const text = asText(valueOf(v, name, field));
    if (name === 'file') return text.split('/').map((s) => segment(at, s)).join('/');
    return text === '' ? '' : segment(at, text);
  });
  let u: URL;
  try {
    u = new URL(filled);
  } catch {
    throw new Error(`${at}: not an address`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`${at}: not an http or https address`);
  if (base && !under(u, base)) throw new Error(`${at}: the address leaves the base URL ${base.href}`);
  return u;
}
/** Whether `u` is at or below `base`: the same origin, no user information, and a path that starts with the base's. */
function under(u: URL, base: URL): boolean {
  return u.origin === base.origin && u.username === '' && u.password === '' && u.pathname.startsWith(base.pathname);
}

/** RFC 6901: `""` is the whole value; `/a/0/b~1c` reads `a`, item 0, then `b/c`. Own fields only. */
export function pointerParts(at: string, p: J): string[] {
  if (typeof p !== 'string' || (p !== '' && !p.startsWith('/'))) throw new Error(`${at} must be a JSON pointer: "" or "/" and the field names`);
  return p === '' ? [] : p.slice(1).split('/').map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
}
function pick(node: J, parts: string[]): J {
  let x = node;
  for (const k of parts) {
    if (Array.isArray(x) && /^(0|[1-9][0-9]*)$/.test(k)) x = x[Number(k)];
    else if (isRecord(x) && Object.hasOwn(x, k)) x = x[k];
    else return undefined;
  }
  return x;
}

/** Reads at most `cap` bytes of an answer; more is an error naming `what`. No cap: the whole answer. */
async function body(res: Response, what: string, cap: number | undefined): Promise<Uint8Array> {
  if (cap === undefined) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const c of res.body ?? []) {
    size += (c as Uint8Array).length;
    if (size > cap) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`the seller API's answer to ${what} is larger than ${cap} bytes`);
    }
    chunks.push(c as Uint8Array);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
function json(bytes: Uint8Array, what: string): J {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`the seller API's answer to ${what} is not JSON`);
  }
}

/** A call made ready to send: its method, URL template, headers and body template, checked once at start. */
interface Prepared {
  what: string;
  /** The call in a message: "the quote", "a file". */
  label: string;
  method: Method;
  url: string;
  headers: Record<string, string>;
  body: J; // undefined: no body
}

const METHODS: readonly Method[] = ['GET', 'POST', 'PUT', 'PATCH'];
const CALL_KEYS = ['method', 'path', 'headers', 'body'];

/**
 * Checks the `sellerApi` block and reads the credential from `env`. Throws, naming the field, on anything malformed:
 * an unknown field, a placeholder this call cannot fill, a path or header that could leave the base URL, an unset
 * credential. Nothing is sent here.
 */
export function sellerApiClient(api: J, env: Readonly<Record<string, string | undefined>>, fields: Fields): SellerApi {
  if (!isRecord(api)) throw new Error('sellerApi must be an object: your API\'s quote, start and result calls');
  for (const k of Object.keys(api)) if (!['baseUrl', 'auth', 'quote', 'start', 'result'].includes(k)) throw new Error(`sellerApi has a field the adapter does not take: ${short(k)}`);
  const mapped = ['quote', 'start', 'result'].some((k) => isRecord(api[k]));
  let base: URL | undefined;
  if (api.baseUrl !== undefined) {
    try {
      base = new URL(api.baseUrl);
    } catch {
      // refused below
    }
    if (typeof api.baseUrl !== 'string' || !base || (base.protocol !== 'http:' && base.protocol !== 'https:')) throw new Error('sellerApi.baseUrl must be an http or https address');
    if (base.username || base.password || base.search || base.hash) throw new Error('sellerApi.baseUrl carries no user, query or fragment: put the credential in sellerApi.auth');
    if (!base.pathname.endsWith('/')) base = new URL(`${base.href}/`);
  } else if (mapped || api.auth !== undefined) {
    throw new Error('sellerApi.baseUrl is required with a mapping or a credential: every request goes under it');
  }

  // ---- The credential: from the environment only, checked here so no later error can print it ----
  let auth: { header: string; value: string; env: string } | undefined;
  if (api.auth !== undefined) {
    const a = api.auth;
    if (!isRecord(a)) throw new Error('sellerApi.auth must be an object: env, header and an optional prefix');
    for (const k of Object.keys(a)) if (!['env', 'header', 'prefix'].includes(k)) throw new Error(`sellerApi.auth has a field the adapter does not take: ${short(k)}`);
    if (typeof a.env !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(a.env)) throw new Error('sellerApi.auth.env must name an environment variable');
    if (typeof a.header !== 'string' || !TOKEN.test(a.header) || RESERVED_HEADERS.includes(a.header.toLowerCase())) throw new Error('sellerApi.auth.header must be a header name');
    if (a.prefix !== undefined && (typeof a.prefix !== 'string' || CONTROL.test(a.prefix))) throw new Error('sellerApi.auth.prefix must be text with no control characters');
    const value = env[a.env];
    if (!value) throw new Error(`set ${a.env} to your seller API's credential: sellerApi.auth names it`);
    if (CONTROL.test(value)) throw new Error(`${a.env} holds a control character, which a header cannot carry`);
    auth = { header: a.header.toLowerCase(), value: `${a.prefix ?? ''}${value}`, env: a.env };
  }

  const LABELS: Record<string, string> = { 'sellerApi.quote': 'the quote', 'sellerApi.start': 'the start', 'sellerApi.result': 'the result', 'sellerApi.result.reportCall': 'the report call', 'sellerApi.result.files': 'a file' };
  const prepare = (at: string, c: J, use: Use, defaults: { method: Method; body: J }, extraKeys: string[], reserved: string[]): Prepared => {
    if (typeof c === 'string') {
      // Today's form: a whole address, with `{jobId}` where the job's ID goes.
      const url = c.split('{jobId}').join('{{jobId}}');
      checkText(at, url, use, fields, false);
      urlFor(at, url, { jobId: 'x', commitmentId: 'x', quoteId: 'x', buyer: 'x' }, base);
      return { what: at, label: LABELS[at]!, method: defaults.method, url, headers: {}, body: defaults.method === 'GET' ? undefined : defaults.body };
    }
    if (!isRecord(c)) throw new Error(`${at} must be an address or a call: method, path, headers, body`);
    for (const k of Object.keys(c)) if (![...CALL_KEYS, ...extraKeys].includes(k)) throw new Error(`${at} has a field the adapter does not take: ${short(k)}`);
    const method = c.method ?? defaults.method;
    if (!METHODS.includes(method)) throw new Error(`${at}.method must be ${METHODS.join(', ')}`);
    if (typeof c.path !== 'string') throw new Error(`${at}.path must be a path under sellerApi.baseUrl`);
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(c.path) || c.path.includes('\\')) throw new Error(`${at}.path: a path under sellerApi.baseUrl, not an address`);
    const url = `${base!.href}${c.path.replace(/^\/+/, '')}`;
    checkText(`${at}.path`, url, use, fields, false);
    urlFor(`${at}.path`, url, { jobId: 'x', commitmentId: 'x', quoteId: 'x', buyer: 'x', file: 'x' }, base);
    const headers: Record<string, string> = Object.create(null); // a header named __proto__ stays a header
    if (c.headers !== undefined) {
      if (!isRecord(c.headers)) throw new Error(`${at}.headers must be an object of header names and text`);
      for (const [k, v] of Object.entries(c.headers)) {
        const name = k.toLowerCase();
        if (!TOKEN.test(k) || RESERVED_HEADERS.includes(name)) throw new Error(`${at}.headers: ${short(k)} is not a header the adapter sends`);
        if (name === auth?.header || reserved.includes(name)) throw new Error(`${at}.headers: ${short(k)} is set by the adapter (the credential or the idempotency key)`);
        if (typeof v !== 'string' || CONTROL.test(v)) throw new Error(`${at}.headers.${k} must be text with no control characters`);
        checkText(`${at}.headers.${k}`, v, use, fields, false);
        headers[name] = v;
      }
    }
    let template: J = c.body === undefined ? defaults.body : c.body === null ? undefined : c.body;
    if (method === 'GET') {
      if (c.body !== undefined && c.body !== null) throw new Error(`${at}.body: a GET carries no body`);
      template = undefined;
    }
    if (template !== undefined) checkTemplate(`${at}.body`, template, use, fields);
    return { what: at, label: LABELS[at]!, method, url, headers, body: template };
  };

  const pointers = (at: string, read: J, keys: Record<string, string>): Record<string, string[]> => {
    if (read !== undefined && !isRecord(read)) throw new Error(`${at} must be an object of JSON pointers`);
    for (const k of Object.keys(read ?? {})) if (!Object.hasOwn(keys, k)) throw new Error(`${at} has a field the adapter does not take: ${short(k)}`);
    return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, pointerParts(`${at}.${k}`, read?.[k] ?? d)]));
  };

  // ---- The quote ----
  const q = api.quote;
  const quote = prepare('sellerApi.quote', q, 'quote', { method: 'POST', body: { scope: '{{scope}}', options: '{{options}}' } }, ['read', 'unitPrice'], []);
  const quoteRead = pointers('sellerApi.quote.read', isRecord(q) ? q.read : undefined, { amount: '/price/amount', units: '', token: '/price/token', quoteId: '/quoteId', deliverWithinSec: '/deliverWithinSec', validForSec: '' });
  // T-406: a quote that counts units, such as credits, priced at a fixed price per unit. No arithmetic beyond one
  // whole-number product, in base units, with no float anywhere.
  const unitsAt = isRecord(q) && isRecord(q.read) && q.read.units !== undefined ? String(q.read.units) : undefined;
  const unitPrice: J = isRecord(q) ? q.unitPrice : undefined;
  if (unitPrice !== undefined && unitsAt === undefined) throw new Error('sellerApi.quote.unitPrice needs sellerApi.quote.read.units, the pointer to the count the answer prices');
  if (unitsAt !== undefined && unitPrice === undefined) throw new Error('sellerApi.quote.read.units needs sellerApi.quote.unitPrice, the price of one unit in base units');
  if (unitsAt !== undefined && isRecord(q) && q.read.amount !== undefined) throw new Error('sellerApi.quote.read takes units or amount, not both');
  if (unitPrice !== undefined && (typeof unitPrice !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(unitPrice))) throw new Error('sellerApi.quote.unitPrice must be base units as a decimal string, such as "1500000" for 1.50 of a 6-decimal token');
  // In today's shape the token is in the answer; a mapping whose `read` names no token prices in the layer's token.
  const readsToken = !isRecord(q) || q.read === undefined || q.read.token !== undefined;
  const validFor = isRecord(q) && q.read?.validForSec !== undefined;

  // ---- The start ----
  const s = api.start;
  const idem = isRecord(s) && s.idempotencyHeader !== undefined ? s.idempotencyHeader : 'Idempotency-Key';
  if (typeof idem !== 'string' || !TOKEN.test(idem) || RESERVED_HEADERS.includes(idem.toLowerCase()) || idem.toLowerCase() === auth?.header) throw new Error('sellerApi.start.idempotencyHeader must be a header name other than the credential\'s');
  const start = prepare('sellerApi.start', s, 'start', { method: 'POST', body: { commitmentId: '{{commitmentId}}', quoteId: '{{quoteId}}', scope: '{{scope}}', options: '{{options}}' } }, ['read', 'idempotencyHeader', 'repeatable'], [idem.toLowerCase()]);
  // T-408: today's three addresses take the deal's ID as their key, so they repeat safely; a mapping repeats safely
  // only when it names the header its API keys a start by, or says so.
  if (isRecord(s) && s.repeatable !== undefined && typeof s.repeatable !== 'boolean') throw new Error('sellerApi.start.repeatable must be true or false');
  const startRepeatable = !isRecord(s) ? true : s.repeatable ?? s.idempotencyHeader !== undefined;
  const startOneShotBecause = startRepeatable ? undefined : isRecord(s) && s.repeatable === false ? 'the mapping says "repeatable": false' : 'the mapping names no idempotencyHeader';
  const startRead = pointers('sellerApi.start.read', isRecord(s) ? s.read : undefined, { jobId: '/jobId' });

  // ---- The result ----
  const r = api.result;
  const result = prepare('sellerApi.result', r, 'result', { method: 'GET', body: undefined }, ['status', 'report', 'reportCall', 'files'], []);
  const rm: J = isRecord(r) ? r : {};
  let status: { by: 'http'; running: number[]; done: number[]; failed: number[] } | { by: 'field'; pointer: string[]; running: string[]; done: string[]; failed: string[] } = { by: 'http', running: [202], done: [200], failed: [] };
  if (rm.status !== undefined) {
    const st = rm.status;
    if (!isRecord(st)) throw new Error('sellerApi.result.status must be an object: by "http" or by "field"');
    if (st.by === 'http') {
      for (const k of Object.keys(st)) if (!['by', 'running', 'done', 'failed'].includes(k)) throw new Error(`sellerApi.result.status has a field the adapter does not take: ${short(k)}`);
      const codes = (k: string, d: number[]): number[] => {
        const x = st[k] ?? d;
        if (!Array.isArray(x) || !x.every((n: J) => Number.isSafeInteger(n) && n >= 200 && n <= 599)) throw new Error(`sellerApi.result.status.${k} must be a list of HTTP status codes`);
        return x;
      };
      status = { by: 'http', running: codes('running', [202]), done: codes('done', [200]), failed: codes('failed', []) };
      const all = [...status.running, ...status.done, ...status.failed];
      if (new Set(all).size !== all.length) throw new Error('sellerApi.result.status: an HTTP status code is in more than one list');
      if (!status.done.every((n) => n >= 200 && n < 300)) throw new Error('sellerApi.result.status.done must be 2xx codes: the answer holds the result');
    } else if (st.by === 'field') {
      for (const k of Object.keys(st)) if (!['by', 'pointer', 'running', 'done', 'failed'].includes(k)) throw new Error(`sellerApi.result.status has a field the adapter does not take: ${short(k)}`);
      const words = (k: string): string[] => {
        const x = st[k];
        if (!Array.isArray(x) || !x.every((w: J) => typeof w === 'string' && w !== '')) throw new Error(`sellerApi.result.status.${k} must be a list of status values`);
        return x;
      };
      status = { by: 'field', pointer: pointerParts('sellerApi.result.status.pointer', st.pointer), running: words('running'), done: words('done'), failed: words('failed') };
      const all = [...status.running, ...status.done, ...status.failed];
      if (new Set(all).size !== all.length) throw new Error('sellerApi.result.status: a status value is in more than one list');
      if (status.done.length === 0) throw new Error('sellerApi.result.status.done must name one or more values');
    } else {
      throw new Error('sellerApi.result.status.by must be "http" or "field"');
    }
  }
  const reportAt = rm.report === undefined ? undefined : pointerParts('sellerApi.result.report', rm.report);
  const reportCall = rm.reportCall === undefined ? undefined : prepare('sellerApi.result.reportCall', rm.reportCall, 'result', { method: 'GET', body: undefined }, [], []);
  let files: (Omit<FilesMapping, 'list' | 'into' | 'path'> & { list: string[]; into: string[]; same: boolean; call: Prepared; encoding: 'utf8' | 'base64' }) | undefined;
  if (rm.files !== undefined) {
    const f = rm.files;
    if (!isRecord(f)) throw new Error('sellerApi.result.files must be an object: list, path, into, maxCount, maxTotalBytes');
    for (const k of Object.keys(f)) if (!['list', 'path', 'into', 'maxCount', 'maxTotalBytes', 'encoding'].includes(k)) throw new Error(`sellerApi.result.files has a field the adapter does not take: ${short(k)}`);
    const into = pointerParts('sellerApi.result.files.into', f.into);
    if (into.length === 0) throw new Error('sellerApi.result.files.into must name a field inside the result, not the whole result');
    if (!(Number.isSafeInteger(f.maxCount) && f.maxCount > 0)) throw new Error('sellerApi.result.files.maxCount must be a positive whole number');
    if (!(Number.isSafeInteger(f.maxTotalBytes) && f.maxTotalBytes > 0 && f.maxTotalBytes <= DELIVERY_CAP_BYTES)) throw new Error(`sellerApi.result.files.maxTotalBytes must be a positive whole number of bytes, at most the delivery cap of ${DELIVERY_CAP_BYTES}`);
    if (f.encoding !== undefined && f.encoding !== 'utf8' && f.encoding !== 'base64') throw new Error('sellerApi.result.files.encoding must be utf8 or base64');
    if (typeof f.path !== 'string' || !/\{\{file\}\}/.test(f.path)) throw new Error('sellerApi.result.files.path must be a path under sellerApi.baseUrl with {{file}} where the file\'s path goes');
    const call = prepare('sellerApi.result.files', { path: f.path }, 'file', { method: 'GET', body: undefined }, [], []);
    files = { list: pointerParts('sellerApi.result.files.list', f.list), into, same: f.list === f.into, call, maxCount: f.maxCount, maxTotalBytes: f.maxTotalBytes, encoding: f.encoding ?? 'utf8' };
  }

  const strict = base !== undefined; // a mapping or a credential: no redirects, and answers capped
  const send = async (p: Prepared, v: Values, extra: Record<string, string> = {}, cap: number | undefined = strict ? DELIVERY_CAP_BYTES : undefined): Promise<{ status: number; bytes: Uint8Array }> => {
    const url = urlFor(p.what, p.url, v, base);
    const headers: Record<string, string> = Object.create(null);
    for (const [k, t] of Object.entries(p.headers)) {
      const filled = t.replace(PLACEHOLDER, (_m, name: string, field?: string) => asText(valueOf(v, name, field)));
      if (CONTROL.test(filled)) throw new Error(`${p.what}: header ${k} would carry a control character`);
      headers[k] = filled;
    }
    let payload: string | undefined;
    if (p.body !== undefined) {
      const b = fillBody(p.body, v);
      payload = JSON.stringify(b === OMIT ? null : b);
      headers['content-type'] ??= 'application/json';
    }
    Object.assign(headers, extra);
    if (auth) headers[auth.header] = auth.value;
    // Redirects are refused under a base URL: a redirect could carry the credential elsewhere.
    const res = await fetch(url, { method: p.method, headers, ...(payload === undefined ? {} : { body: payload }), redirect: strict ? 'error' : 'follow', signal: AbortSignal.timeout(30_000) });
    return { status: res.status, bytes: await body(res, p.label, cap) };
  };
  const ok2xx = (what: string, status: number) => {
    if (status < 200 || status > 299) throw new Error(`the seller API answered ${status} to ${what}`);
  };
  const legacyOk = (what: string, status: number) => {
    if (status !== 200 && status !== 202) throw new Error(`the seller API answered ${status} to ${what}`);
  };
  const okFor = strict ? ok2xx : legacyOk;

  return {
    readsToken,
    startRepeatable,
    ...(startOneShotBecause ? { startOneShotBecause } : {}),
    describe: `The seller API is ${base ? `under ${base.href}` : 'at the three configured addresses'}, with ${auth ? `a credential from ${auth.env} in header ${auth.header}` : 'no credential'}${unitsAt !== undefined ? `; a quote prices ${plain(unitsAt)} units at ${unitPrice} base units each` : ''}; its job state is read by ${status.by === 'http' ? 'HTTP status' : 'a status field'}${files ? `, and a result's further files are added at ${plain(rm.files.into)}` : ''}.`,

    async quote(v) {
      const { status: code, bytes } = await send(quote, v);
      okFor('the quote', code);
      const a = json(bytes, 'the quote');
      const read = (k: string) => pick(a, quoteRead[k]!);
      const quoteId = read('quoteId');
      let amount: J = unitsAt === undefined ? read('amount') : undefined;
      let unitsRead: string | undefined;
      if (unitsAt !== undefined) {
        const units = read('units');
        const whole = (typeof units === 'number' && Number.isSafeInteger(units) && units >= 0) || (typeof units === 'string' && /^(0|[1-9][0-9]{0,30})$/.test(units));
        if (!whole) throw new Error(`the quote's ${plain(unitsAt)} is not a whole number of units, as a JSON number or digits with no leading zero: ${short(JSON.stringify(units ?? null))}`);
        amount = (BigInt(units) * BigInt(unitPrice)).toString();
        unitsRead = String(units);
        if (amount.length > 78) throw new Error(`the quote's price, ${units} units at ${unitPrice} base units, is larger than base units can hold`);
      }
      return { ...(unitsRead === undefined ? {} : { units: unitsRead }), price: { token: readsToken ? read('token') : undefined, amount }, quoteId: Number.isSafeInteger(quoteId) ? String(quoteId) : quoteId, deliverWithinSec: read('deliverWithinSec'), ...(validFor ? { validForSec: read('validForSec') } : {}) };
    },

    async start(v) {
      const { status: code, bytes } = await send(start, v, { [idem.toLowerCase()]: v.commitmentId! });
      okFor('the start', code);
      const id = pick(json(bytes, 'the start'), startRead['jobId']!);
      if (typeof id === 'string' && /^[\x21-\x7e]{1,200}$/.test(id)) return id;
      if (Number.isSafeInteger(id) && id >= 0) return String(id);
      throw new Error('the seller API\'s start answer has no usable jobId');
    },

    async result(v) {
      const { status: code, bytes } = await send(result, v);
      let done: Uint8Array = bytes;
      if (status.by === 'http') {
        if (status.running.includes(code)) return { state: 'running' };
        if (status.failed.includes(code)) return { state: 'failed', status: `HTTP ${code}` };
        if (!status.done.includes(code)) throw new Error(`the seller API answered ${code} to the result`);
      } else {
        ok2xx('the result', code);
        const word = pick(json(bytes, 'the result'), status.pointer);
        const w = typeof word === 'string' || typeof word === 'number' || typeof word === 'boolean' ? String(word) : undefined;
        if (w !== undefined && status.running.includes(w)) return { state: 'running', status: short(w) };
        if (w !== undefined && status.failed.includes(w)) return { state: 'failed', status: short(w) };
        if (w === undefined || !status.done.includes(w)) throw new Error(`the seller API's job status ${w === undefined ? 'is missing' : `"${short(w)}" is none of the configured values`}`);
      }
      if (reportCall) {
        const second = await send(reportCall, v);
        ok2xx('the report call', second.status);
        done = second.bytes;
      }
      if (reportAt) {
        const x = pick(json(done, reportCall ? 'the report call' : 'the result'), reportAt);
        if (x === undefined) throw new Error(`the seller API's result answer has nothing at ${plain(rm.report)}`);
        done = new TextEncoder().encode(typeof x === 'string' ? x : JSON.stringify(x));
      }
      return { state: 'done', bytes: done };
    },

    async withFiles(bytes, v) {
      if (!files) return bytes;
      let doc: J;
      try {
        doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        throw new FilesNotAdded('the result is not JSON, so its list of files cannot be read');
      }
      const list = pick(doc, files.list);
      if (list === undefined) return bytes; // the result names no files
      if (!Array.isArray(list) || !list.every((p) => typeof p === 'string' && p !== '' && p.length <= 1000)) throw new FilesNotAdded(`the result's ${plain(rm.files.list)} is not a list of file paths`);
      if (list.length > files.maxCount) throw new FilesNotAdded(`the result names ${list.length} files, more than files.maxCount, ${files.maxCount}`);
      if (new Set(list).size !== list.length) throw new FilesNotAdded(`the result names a file twice: ${short(list.find((p, i) => list.indexOf(p) !== i))}`);
      const parentParts = files.into.slice(0, -1);
      const last = files.into[files.into.length - 1]!;
      const parent = pick(doc, parentParts);
      if (!isRecord(parent)) throw new FilesNotAdded(`the result has no object at ${plain(rm.files.into)}'s parent, to add the files to`);
      if (!files.same && Object.hasOwn(parent, last)) throw new FilesNotAdded(`the result already has a field at ${plain(rm.files.into)}`);
      const added: Array<{ path: string; content: string }> = [];
      let total = 0;
      for (const path of list as string[]) {
        let got: { status: number; bytes: Uint8Array };
        try {
          got = await send(files.call, { ...v, file: path }, {}, files.maxTotalBytes - total);
        } catch (e) {
          throw new FilesNotAdded(`file ${short(path)}: ${plain((e as Error).message)}`);
        }
        if (got.status < 200 || got.status > 299) throw new FilesNotAdded(`file ${short(path)}: the seller API answered ${got.status}`);
        total += got.bytes.length;
        let content: string;
        if (files.encoding === 'base64') content = Buffer.from(got.bytes).toString('base64');
        else {
          try {
            content = new TextDecoder('utf-8', { fatal: true }).decode(got.bytes);
          } catch {
            throw new FilesNotAdded(`file ${short(path)} is not UTF-8 text; set files.encoding to base64 to deliver its bytes`);
          }
        }
        added.push({ path, content });
      }
      Object.defineProperty(parent, last, { value: added, enumerable: true, writable: true, configurable: true });
      const out = new TextEncoder().encode(JSON.stringify(doc));
      if (out.length > DELIVERY_CAP_BYTES) throw new FilesNotAdded(`the result with its files is ${out.length} bytes, more than the delivery cap of ${DELIVERY_CAP_BYTES}`);
      return out;
    },
  };
}
