// What a duet agent can do (T-391): only its owner's installed tools. Each tool is a fence, checked here, not a rule
// in a prompt:
//   fetch_url    GET only, to an allowlist of origins and paths (the world's operators, the docs, the seller's page,
//                the seller adapter's quote and defaults). No redirect is followed.
//   run_command  one of a fixed list of the repository's client commands, from this checkout, with its arguments
//                checked one by one: paths inside the agent's own folder, URLs on the allowlist, the buyer's key
//                store only by its one path. The child gets a minimal environment built here; no model key is in it.
//   read_file, write_file, list_files   inside the agent's own folder, never through a symbolic link.
//   wait, finish
// Keys live in files and environments the agent never reads: the buyer's key store sits outside its folder, the
// seller's key is the child's HOLDBACK_KEY. Every tool result passes through the run's secret list before a model or
// the record sees it. The buyer's approval stop is answered by the owner's policy file, not by a person.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolSpec } from './providers.ts';
import type { Recorder, Role, Secrets } from './record.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** One allowlist entry: an origin, and the paths under it (a path ending in "/" is a prefix; none: any path). */
export interface Allow {
  origin: string;
  paths?: string[];
}

/** What the owner pre-set for the buyer's approval stop. */
export interface Policy {
  /** The most the owner pays for one deal, everything included, in base units. */
  budget: string;
  /** Check IDs every offer must carry as required checks. */
  requiredChecks: string[];
}

export interface ToolboxOptions {
  role: Exclude<Role, 'runner'>;
  /** The agent's own folder: absolute, and the one place its file tools reach. */
  work: string;
  /** The owner's folder beside it, which no tool of the agent reaches: checked configuration copies live here. */
  owner: string;
  /** The repository checkout the client commands run from. */
  repo: string;
  /** The operators the client commands talk to. */
  operators: string[];
  allow: Allow[];
  secrets: Secrets;
  rec: Recorder;
  /** Buyer: the key store directory, outside `work`. */
  keyStore?: string;
  /** Buyer: the owner's pre-set answer to the approval stop. */
  policy?: Policy;
  /** Seller: the signing key, passed to the seller's commands as HOLDBACK_KEY. */
  sellerKey?: string;
  /** Seller: the port the adapter must listen on. */
  adapterPort?: number;
  /** Seller: the job API's base URL, the one place the adapter's sellerApi may point. */
  jobApi?: string;
  /** Per-command time limits in ms. */
  timeoutMs?: { short: number; long: number };
  /** The most characters one tool result gives the model. */
  resultLimit?: number;
}

/** What a tool call returns to the loop: the text the model reads, and whether it failed. */
export interface ToolResult {
  content: string;
  isError: boolean;
  /** Set by `finish`. */
  finished?: { outcome: string; report: string };
}

const HOOK = fileURLToPath(new URL('./fetch-log.mjs', import.meta.url));
const node = (script: string, args: string[]) => ['--import', HOOK, script, ...args];
const SCRIPTS: Record<string, string> = {
  'buy-with-signer': 'examples/buy-with-signer.ts',
  'seller-adapter': 'examples/seller-adapter.ts',
  'check-delivery': 'examples/check-delivery.ts',
  seal: 'examples/seal.ts',
  'deal-record': 'examples/deal-record.ts',
};
const COMMANDS: Record<'buyer' | 'seller', string[]> = {
  buyer: ['buy-with-signer', 'check-delivery', 'deal-record'],
  seller: ['seller-adapter', 'adapter-log', 'check-delivery', 'seal', 'deal-record'],
};
const ID = /^0x[0-9a-fA-F]{64}$/;
const DEC = /^[0-9]{1,30}$/;

/** A refusal of a call, with the reason the agent reads. Recorded as `refused`. */
class Refused extends Error {}

export class Toolbox {
  private adapter: { child: ChildProcess; log: string[]; read: number; exited: number | null } | undefined;
  /** Where the commands' preloaded fetch hook writes one line per HTTP call, and how far the record has read it. */
  private get fetchLog(): string { return join(this.o.owner, 'fetches.jsonl'); }
  private fetchRead = 0;
  readonly specs: ToolSpec[];

  readonly o: ToolboxOptions;

  constructor(o: ToolboxOptions) {
    this.o = o;
    this.specs = specs(o.role);
  }

  /** Runs one tool call. A refusal or an error is a result the model reads, never a throw. */
  async call(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const limit = this.o.resultLimit ?? 60_000;
    try {
      const r = await this.dispatch(name, input);
      const content = this.o.secrets.scrub(r.content);
      return { ...r, content: content.length > limit ? `${content.slice(0, limit)}\n[… ${content.length - limit} more characters not shown]` : content };
    } catch (e) {
      const refused = e instanceof Refused;
      const text = this.o.secrets.scrub((e as Error).message);
      if (refused) this.o.rec.add(this.o.role, 'refused', { tool: name, reason: text });
      return { content: refused ? `Refused: ${text}` : `Error: ${text}`, isError: true };
    }
  }

  private async dispatch(name: string, input: J): Promise<ToolResult> {
    switch (name) {
      case 'fetch_url': return this.fetchUrl(String(input?.url ?? ''), Number(input?.offset ?? 0));
      case 'run_command': return this.run(String(input?.command ?? ''), Array.isArray(input?.args) ? input.args.map(String) : []);
      case 'read_file': return this.readFile(String(input?.path ?? ''), Number(input?.offset ?? 0));
      case 'write_file': return this.writeFile(String(input?.path ?? ''), typeof input?.content === 'string' ? input.content : JSON.stringify(input?.content ?? ''));
      case 'list_files': return this.listFiles(String(input?.path ?? '.'));
      case 'wait': {
        const s = Math.min(30, Math.max(1, Math.floor(Number(input?.seconds ?? 5)) || 5));
        await new Promise((r) => setTimeout(r, s * 1000));
        return { content: `Waited ${s} s.`, isError: false };
      }
      case 'finish': return { content: 'Finished.', isError: false, finished: { outcome: String(input?.outcome ?? ''), report: String(input?.report ?? '') } };
      default: throw new Refused(`there is no tool ${JSON.stringify(name).slice(0, 80)}: the tools are ${this.specs.map((s) => s.name).join(', ')}`);
    }
  }

  /** Whether a URL is on this agent's allowlist: http or https, no user info, an exact origin, an allowed path. */
  allowed(raw: string): URL {
    let u: URL;
    try { u = new URL(raw); } catch { throw new Refused(`${JSON.stringify(raw).slice(0, 200)} is not a URL`); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Refused(`only http and https URLs are fetched, not ${u.protocol}`);
    if (u.username || u.password) throw new Refused('a URL with a user name or password is not fetched');
    const hit = this.o.allow.find((a) => a.origin === u.origin && (!a.paths || a.paths.some((p) => (p.endsWith('/') ? u.pathname.startsWith(p) : u.pathname === p))));
    if (!hit) throw new Refused(`${u.origin}${u.pathname} is not on your owner's allowlist. You may fetch: ${this.o.allow.map((a) => (a.paths ? a.paths.map((p) => `${a.origin}${p}${p.endsWith('/') ? '…' : ''}`).join(', ') : `${a.origin}/…`)).join('; ')}`);
    if (u.pathname.split('/').some((s) => s === '..' || decodeURIComponent(s) === '..')) throw new Refused('a URL with a ".." segment is not fetched');
    return u;
  }

  private async fetchUrl(raw: string, offset: number): Promise<ToolResult> {
    const u = this.allowed(raw);
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(u, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      this.o.rec.add(this.o.role, 'http', { via: 'fetch_url', method: 'GET', url: u.href, status: 0, ms: Date.now() - started, error: (e as Error).name });
      return { content: `GET ${u.href} failed: ${(e as Error).name === 'TimeoutError' ? 'no answer in 30 s' : 'could not connect'}`, isError: true };
    }
    const text = await res.text();
    const body = this.o.rec.body(text);
    this.o.rec.add(this.o.role, 'http', { via: 'fetch_url', method: 'GET', url: u.href, status: res.status, ms: Date.now() - started, bytes: body.bytes, body: body.text, trimmed: body.trimmed });
    const from = Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
    const page = 60_000;
    const slice = text.slice(from, from + page);
    const more = from + page < text.length ? `\n[… ${text.length - from - page} more characters: fetch again with offset ${from + page}]` : '';
    const location = res.headers.get('location');
    return { content: `HTTP ${res.status} ${res.headers.get('content-type') ?? ''}${location ? `\nLocation (not followed): ${location}` : ''}\n\n${slice}${more}`, isError: res.status >= 400 };
  }

  /** A path inside the agent's folder, with no symbolic link on the way: or a refusal. */
  private inside(p: string, o: { mustExist?: boolean } = {}): string {
    if (p.includes('\0')) throw new Refused('a path with a NUL character is refused');
    const full = resolve(this.o.work, p);
    if (full !== this.o.work && !full.startsWith(this.o.work + sep)) throw new Refused(`${JSON.stringify(p).slice(0, 200)} is outside your folder; your tools reach only paths inside it`);
    let at = this.o.work;
    for (const part of relative(this.o.work, full).split(sep).filter(Boolean)) {
      at = join(at, part);
      if (!existsSync(at)) break;
      if (lstatSync(at).isSymbolicLink()) throw new Refused(`${relative(this.o.work, at)} is a symbolic link: your tools do not follow links`);
    }
    if (o.mustExist && !existsSync(full)) throw new Refused(`${relative(this.o.work, full) || '.'} does not exist in your folder`);
    return full;
  }

  private readFile(p: string, offset: number): ToolResult {
    const f = this.inside(p, { mustExist: true });
    if (!lstatSync(f).isFile()) throw new Refused(`${p} is not a file`);
    if (lstatSync(f).size > 4_000_000) throw new Refused(`${p} is larger than 4 MB`);
    const text = readFileSync(f, 'utf8');
    const from = Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
    const slice = text.slice(from, from + 60_000);
    this.o.rec.add(this.o.role, 'file', { op: 'read', path: relative(this.o.work, f), bytes: Buffer.byteLength(text) });
    return { content: `${slice}${from + 60_000 < text.length ? `\n[… more: read again with offset ${from + 60_000}]` : ''}`, isError: false };
  }

  private writeFile(p: string, content: string): ToolResult {
    const f = this.inside(p);
    if (f === this.o.work) throw new Refused('name a file, not your folder');
    if (Buffer.byteLength(content) > 1_000_000) throw new Refused('a file is at most 1 MB');
    if (existsSync(f) && !lstatSync(f).isFile()) throw new Refused(`${p} is not a file`);
    mkdirSync(dirname(f), { recursive: true });
    this.inside(relative(this.o.work, dirname(f))); // the folders just made are plain folders
    writeFileSync(f, content);
    const body = this.o.rec.body(content);
    this.o.rec.add(this.o.role, 'file', { op: 'write', path: relative(this.o.work, f), bytes: body.bytes, body: body.text, trimmed: body.trimmed });
    return { content: `Wrote ${Buffer.byteLength(content)} bytes to ${relative(this.o.work, f)}.`, isError: false };
  }

  private listFiles(p: string): ToolResult {
    const d = this.inside(p, { mustExist: true });
    if (!lstatSync(d).isDirectory()) throw new Refused(`${p} is not a folder`);
    const items = readdirSync(d, { withFileTypes: true }).map((e) => `${e.name}${e.isDirectory() ? '/' : e.isSymbolicLink() ? ' (link)' : ''}`);
    return { content: items.length ? items.join('\n') : '(empty)', isError: false };
  }

  // ---- The client commands ----

  private async run(command: string, args: string[]): Promise<ToolResult> {
    const role = this.o.role;
    if (!COMMANDS[role].includes(command)) throw new Refused(`${JSON.stringify(command).slice(0, 80)} is not one of your owner's installed commands: ${COMMANDS[role].join(', ')}`);
    if (args.length > 12 || args.some((a) => a.length > 20_000)) throw new Refused('at most 12 arguments of at most 20,000 characters each');
    if (args.some((a) => a.includes('\0'))) throw new Refused('an argument with a NUL character is refused');
    if (command === 'adapter-log') return this.adapterLog();
    const checked = this.check(command, args);
    if (command === 'seller-adapter') return this.startAdapter(checked);
    return this.exec(command, checked, command === 'buy-with-signer' && ['approve', 'resume'].includes(args[0] ?? '') ? 'long' : 'short');
  }

  /** The arguments as the command will get them, each one checked; or a refusal naming the one at fault. */
  private check(command: string, args: string[]): string[] {
    const file = (a: string | undefined, what: string, mustExist = true) => {
      if (!a) throw new Refused(`${command} needs ${what}`);
      this.inside(a, { mustExist });
      return a;
    };
    const flags = (rest: string[], allowed: Record<string, 'file' | 'value' | 'bare'>) => {
      for (let i = 0; i < rest.length; i++) {
        const kind = allowed[rest[i]!];
        if (!kind) throw new Refused(`${command} does not take ${JSON.stringify(rest[i]).slice(0, 80)} here; it takes ${Object.keys(allowed).join(', ') || 'no flags'}`);
        if (kind === 'file') file(rest[++i], `a file after ${rest[i - 1]}`);
        if (kind === 'value' && !/^[\w./+-]{1,100}$/.test(rest[++i] ?? '')) throw new Refused(`${rest[i - 1]} takes a plain value`);
      }
    };
    if (command === 'buy-with-signer') {
      if (args.includes('--expect-terms')) throw new Refused('your owner keeps the approval: run the command without --expect-terms, and answer its stop with the approve line it prints');
      const store = (a: string | undefined) => {
        if (a !== this.o.keyStore) throw new Refused(`the key store is ${this.o.keyStore}: your owner keeps your keys there, and the command takes no other directory`);
        return a;
      };
      const rest = args.filter((a) => a !== '--stop-after-funding');
      const [first] = rest;
      if (first === 'approve') {
        if (rest.length !== 4) throw new Refused('usage: approve <key store directory> <commitment ID> <the most you pay, base units>');
        store(rest[1]);
        if (!ID.test(rest[2]!)) throw new Refused('the commitment ID is 0x and 64 hex digits');
        if (!DEC.test(rest[3]!)) throw new Refused('the most you pay is base units as a decimal string');
        this.approval(rest[2]!.toLowerCase(), rest[3]!);
        return args;
      }
      if (first === 'resume') {
        if (rest.length < 2 || rest.length > 3) throw new Refused('usage: resume <key store directory> [<commitment ID>]');
        store(rest[1]);
        if (rest[2] !== undefined && !ID.test(rest[2])) throw new Refused('the commitment ID is 0x and 64 hex digits');
        return args;
      }
      if (rest.length < 4 || rest.length > 6) throw new Refused('usage: <quote URL> <key store directory> <scope, as JSON> <the most you pay, base units> [<defaults URL> [<options, as JSON>]]');
      this.allowed(first!);
      store(rest[1]);
      for (const [i, what] of [[2, 'the scope'], [5, 'the options']] as const) {
        if (rest[i] === undefined) continue;
        try { const v = JSON.parse(rest[i]!); if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(); } catch { throw new Refused(`${what} must be a JSON object`); }
      }
      if (!DEC.test(rest[3]!)) throw new Refused('the most you pay is base units as a decimal string');
      if (this.o.policy && BigInt(rest[3]!) > BigInt(this.o.policy.budget)) throw new Refused(`your owner's budget is ${this.o.policy.budget} base units, everything included: the most you pay cannot be more`);
      if (rest[4] !== undefined) this.allowed(rest[4]);
      return args;
    }
    if (command === 'check-delivery') {
      file(args[0], '<terms.json>');
      file(args[1], '<file>');
      flags(args.slice(2), { '--reference': 'file', '--mime': 'value', '--json': 'bare' });
      return args;
    }
    if (command === 'deal-record') {
      if (!ID.test(args[0] ?? '')) throw new Refused('usage: deal-record <commitmentId> --as buyer|seller [--delivery <file>] [--settlement <file>] [--out <file>]');
      const rest = args.slice(1);
      const as = rest.indexOf('--as');
      if (rest[as + 1] !== this.o.role) throw new Refused(`you are the ${this.o.role}: --as ${this.o.role}`);
      const out = rest.indexOf('--out');
      if (out >= 0) file(rest[out + 1], 'a file after --out', false);
      flags(rest.filter((_, i) => i !== as && i !== as + 1 && (out < 0 || (i !== out && i !== out + 1))), { '--delivery': 'file', '--settlement': 'file' });
      return args;
    }
    if (command === 'seal') {
      if (args.length !== 3) throw new Refused('usage: seal <journal.json> <file> <commitmentId>');
      file(args[0], '<journal.json>');
      file(args[1], '<file>');
      if (!ID.test(args[2]!)) throw new Refused('the commitment ID is 0x and 64 hex digits');
      return args;
    }
    if (command === 'seller-adapter') {
      const rest = args.filter((a) => a !== '--sim');
      if (rest.length !== 1) throw new Refused('usage: seller-adapter <config.json>; your owner has set HOLDBACK_KEY and HOLDBACK_OPERATORS, so --sim is not needed');
      return [this.adapterConfig(rest[0]!)];
    }
    throw new Refused(`${command} takes no arguments here`);
  }

  /** The owner's pre-set answer to the approval stop, read from the offer the stop showed with this key store. */
  private approval(id: string, max: string): void {
    const policy = this.o.policy;
    if (!policy) throw new Refused('your owner has set no approval policy: nothing is approved');
    const shown = this.shownOffer(id);
    const why: string[] = [];
    if (!shown) why.push(`no stop showed ${id} with a key in your key store`);
    else {
      const total = String(shown.fees?.total?.amount ?? '');
      if (!DEC.test(total) || BigInt(total) > BigInt(policy.budget)) why.push(`the offer costs ${total || 'an unknown amount'} base units, above the owner's budget of ${policy.budget}`);
      if (BigInt(max) > BigInt(policy.budget)) why.push(`the most you pay, ${max}, is above the owner's budget of ${policy.budget}`);
      const checks: J[] = Array.isArray(shown.checks) ? shown.checks : [];
      for (const c of policy.requiredChecks) if (!checks.some((k) => k?.id === c && k?.required === true)) why.push(`the offer has no required check "${c}", which the owner requires`);
    }
    this.o.rec.add('buyer', 'approval', { commitmentId: id, granted: why.length === 0, by: 'owner policy (pre-set)', reasons: why, policy });
    if (why.length) throw new Refused(`your owner's pre-set policy does not approve this offer: ${why.join('; ')}. Nothing was signed or paid.`);
  }

  /** The offer the signer's stop showed for this ID, from the key store, which only the owner's tools read. */
  private shownOffer(id: string): J {
    const store = this.o.keyStore;
    if (!store || !existsSync(store)) return undefined;
    for (const name of readdirSync(store)) {
      if (!/^0x[0-9a-f]{40}\.json$/.test(name)) continue;
      try {
        const s = JSON.parse(readFileSync(join(store, name), 'utf8'));
        if (String(s?.shown?.commitmentId ?? '').toLowerCase() === id) return s.shown.offer;
      } catch { /* a file mid-write: skip it */ }
    }
    return undefined;
  }

  /** Learns the key store's secrets, so they are scrubbed from every output: run after each buyer command. */
  learnKeys(): void {
    const store = this.o.keyStore;
    if (!store || !existsSync(store)) return;
    for (const name of readdirSync(store)) {
      if (!/^0x[0-9a-f]{40}\.json$/.test(name)) continue;
      try {
        const s = JSON.parse(readFileSync(join(store, name), 'utf8'));
        this.o.secrets.add(s?.privateKey);
        this.o.secrets.add(s?.encryptionSecretKey);
      } catch { /* a file mid-write: the next call learns it */ }
    }
  }

  /**
   * The seller adapter's configuration, checked and copied where the agent cannot change it after the check: the port
   * its owner gave it, a sellerApi under the owner's job API only, no credential or callback setting, no other URL,
   * and the journal inside the agent's folder. The adapter runs the copy.
   */
  private adapterConfig(p: string): string {
    const f = this.inside(p, { mustExist: true });
    let c: J;
    try { c = JSON.parse(readFileSync(f, 'utf8')); } catch { throw new Refused(`${p} is not JSON`); }
    if (c === null || typeof c !== 'object' || Array.isArray(c)) throw new Refused(`${p} is not a JSON object`);
    const allowedKeys = ['port', 'sellerApi', 'scope', 'options', 'termsRules', 'payoutAddress', 'clubId', 'adjudicators', 'mandate', 'timing', 'journal', 'pollMs', 'quoteRateLimit', 'redelivery'];
    const bad = Object.keys(c).filter((k) => !allowedKeys.includes(k));
    if (bad.length) throw new Refused(`your owner's adapter takes no ${bad.map((b) => JSON.stringify(b).slice(0, 40)).join(', ')} setting here (no template, mapping, credential or callback settings); it takes ${allowedKeys.join(', ')}`);
    if (c.port !== this.o.adapterPort) throw new Refused(`the adapter listens on port ${this.o.adapterPort}, the one your owner opened: set "port": ${this.o.adapterPort}`);
    const api = c.sellerApi;
    if (api === null || typeof api !== 'object' || Array.isArray(api)) throw new Refused('sellerApi must be an object naming your owner\'s job API');
    if ('auth' in api) throw new Refused('sellerApi.auth is not needed: your owner\'s job API takes no credential');
    const base = this.o.jobApi!;
    const urls: string[] = [];
    const walk = (v: J, at: string, ok: (s: string) => boolean): void => {
      if (typeof v === 'string' && /[a-z][a-z0-9+.-]*:\/\/|^\/\//i.test(v) && !ok(v)) urls.push(at);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`, ok);
    };
    // Every URL in sellerApi starts at the owner's job API; a call in the object form names a path the adapter keeps
    // under baseUrl, so baseUrl itself must be the job API. Anywhere else, nothing that looks like a URL.
    const underBase = (s: string) => s === base || s.startsWith(`${base}/`);
    if (api.baseUrl !== undefined && !(typeof api.baseUrl === 'string' && underBase(api.baseUrl))) throw new Refused(`sellerApi.baseUrl must be your owner's job API, ${base}`);
    for (const k of ['quote', 'start', 'result'] as const) {
      const v = api[k];
      if (typeof v === 'string' && !underBase(v)) throw new Refused(`sellerApi.${k} must be under your owner's job API, ${base}`);
      if (v !== undefined && typeof v !== 'string' && api.baseUrl === undefined) throw new Refused(`sellerApi.${k} in the object form needs sellerApi.baseUrl, your owner's job API`);
    }
    walk(api, 'sellerApi', underBase);
    for (const [k, v] of Object.entries(c)) if (k !== 'sellerApi') walk(v, k, () => false);
    if (urls.length) throw new Refused(`${urls.join(', ')}: only sellerApi may name a URL`);
    if (c.redelivery !== undefined && (typeof c.redelivery !== 'object' || Object.keys(c.redelivery ?? {}).some((k) => k !== 'refetchEverySec'))) throw new Refused('redelivery takes only refetchEverySec here');
    if (c.mandate !== undefined && (typeof c.mandate !== 'object' || Object.keys(c.mandate ?? {}).some((k) => !['fromFaucet', 'renewBeforeSec'].includes(k)))) throw new Refused('mandate takes only fromFaucet and renewBeforeSec');
    const journal = c.journal === undefined ? 'seller-adapter.journal.json' : c.journal;
    if (typeof journal !== 'string') throw new Refused('journal must be a file path inside your folder');
    c.journal = this.inside(journal);
    const copy = join(this.o.owner, `adapter-config-${Date.now()}.json`);
    writeFileSync(copy, JSON.stringify(c, null, 2));
    return copy;
  }

  /** The child's environment: built here from nothing, so no model key, no login and no shell setting reaches it. */
  env(): Record<string, string> {
    const env: Record<string, string> = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: this.o.work, TMPDIR: join(this.o.work, '.tmp'), HOLDBACK_OPERATORS: this.o.operators.join(','), NO_COLOR: '1', DUET_FETCH_LOG: this.fetchLog };
    mkdirSync(env['TMPDIR']!, { recursive: true });
    if (this.o.role === 'seller' && this.o.sellerKey) env['HOLDBACK_KEY'] = this.o.sellerKey;
    return env;
  }

  private exec(command: string, args: string[], kind: 'short' | 'long'): Promise<ToolResult> {
    const timeout = (this.o.timeoutMs ?? { short: 180_000, long: 1_200_000 })[kind];
    const script = join(this.o.repo, SCRIPTS[command]!);
    const started = Date.now();
    return new Promise((done) => {
      const child = spawn(process.execPath, node(script, args), { cwd: this.o.work, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      const cap = (s: string, d: Buffer) => (s.length < 2_000_000 ? s + d.toString('utf8') : s);
      child.stdout!.on('data', (d: Buffer) => void (out = cap(out, d)));
      child.stderr!.on('data', (d: Buffer) => void (err = cap(err, d)));
      const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (this.o.role === 'buyer') this.learnKeys(); // before any of the output is scrubbed or recorded
        this.ingestFetches();
        const so = this.o.rec.body(out), se = this.o.rec.body(err);
        this.o.rec.add(this.o.role, 'command', { command, args: args.map((a) => this.o.secrets.scrub(a)), exit: code, signal, ms: Date.now() - started, stdout: so.text, stderr: se.text, stdoutBytes: so.bytes, stderrBytes: se.bytes });
        if (command === 'buy-with-signer') {
          // The signer's own last word on a deal: the outcome, and whether it opened the work (its size, never its text).
          for (const line of out.split('\n')) {
            let j: J;
            try { j = JSON.parse(line); } catch { continue; }
            if (j && typeof j === 'object' && typeof j.outcome === 'string') this.o.rec.add('buyer', 'signer.outcome', { commitmentId: j.commitmentId, outcome: j.outcome, paid: j.paid ?? null, opened: typeof j.work === 'string' && j.work.length > 0, workBytes: typeof j.work === 'string' ? Buffer.byteLength(j.work) : 0, transactions: Array.isArray(j.transactions) ? j.transactions.length : 0 });
            if (j && typeof j === 'object' && j.approval === 'needed') this.o.rec.add('buyer', 'signer.stop', { commitmentId: j.commitmentId, total: j.fees?.total?.amount, checks: Array.isArray(j.checks) ? j.checks.map((k: J) => ({ id: k?.id, required: k?.required })) : [], differences: Array.isArray(j.differences) ? j.differences.map((d: J) => d?.field) : [] });
          }
        }
        const timedOut = signal === 'SIGTERM' && Date.now() - started >= timeout;
        done({ content: `exit ${code ?? signal}${timedOut ? ` (stopped after ${Math.round(timeout / 1000)} s)` : ''}\n--- stdout\n${out}\n--- stderr\n${err}`, isError: code !== 0 && !(command === 'buy-with-signer' && code === 3) });
      });
    });
  }

  /** Starts the seller adapter in the background and returns its first lines, or its error if it stopped. */
  private startAdapter([config]: string[]): Promise<ToolResult> {
    if (this.adapter && this.adapter.exited === null) throw new Refused('the adapter is already running: read its log with adapter-log');
    const child = spawn(process.execPath, node(join(this.o.repo, SCRIPTS['seller-adapter']!), [config!]), { cwd: this.o.work, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
    const a = { child, log: [] as string[], read: 0, exited: null as number | null };
    this.adapter = a;
    const line = (d: Buffer) => { for (const l of d.toString('utf8').split('\n')) if (l.trim()) a.log.push(l); };
    child.stdout!.on('data', line);
    child.stderr!.on('data', line);
    this.o.rec.add('seller', 'command', { command: 'seller-adapter', args: ['<checked copy of the config>'], background: true });
    return new Promise((done) => {
      const finish = () => {
        clearInterval(poll);
        const lines = a.log.slice(0, 40);
        a.read = lines.length;
        this.o.rec.add('seller', 'adapter.start', { running: a.exited === null, exit: a.exited, lines: lines.map((l) => this.o.rec.body(l).text) });
        done({ content: `${a.exited === null ? 'The adapter is running in the background. Read new log lines with adapter-log.' : `The adapter stopped with exit ${a.exited}.`}\n${lines.join('\n')}`, isError: a.exited !== null });
      };
      child.on('exit', (code) => { a.exited = code ?? -1; });
      const started = Date.now();
      const poll = setInterval(() => { if (a.exited !== null || a.log.length >= 4 || Date.now() - started > 15_000) finish(); }, 200);
    });
  }

  /** Moves the commands' HTTP calls into the record as `api` events, each at the time it was made. */
  ingestFetches(): void {
    if (!existsSync(this.fetchLog)) return;
    const text = readFileSync(this.fetchLog, 'utf8');
    const fresh = text.slice(this.fetchRead);
    const upTo = fresh.lastIndexOf('\n') + 1;
    this.fetchRead += upTo;
    for (const line of fresh.slice(0, upTo).split('\n').filter(Boolean)) {
      try {
        const f = JSON.parse(line);
        this.o.rec.add(this.o.role, 'api', { via: 'command', method: String(f.method), url: String(f.url), status: Number(f.status), ms: Number(f.ms) }, Number(f.at));
      } catch { /* a torn line: skip it */ }
    }
  }

  private adapterLog(): ToolResult {
    this.ingestFetches();
    const a = this.adapter;
    if (!a) throw new Refused('the adapter is not running: start it with seller-adapter <config.json>');
    const fresh = a.log.slice(a.read, a.read + 200);
    a.read += fresh.length;
    this.o.rec.add('seller', 'adapter.log', { lines: fresh.map((l) => this.o.rec.body(l).text), running: a.exited === null });
    return { content: `${a.exited === null ? 'running' : `stopped (exit ${a.exited})`}; ${fresh.length} new lines\n${fresh.join('\n')}`, isError: false };
  }

  /** Stops the adapter: the run is over. */
  async close(): Promise<void> {
    const a = this.adapter;
    if (a && a.exited === null) {
      a.child.kill('SIGTERM');
      await new Promise((r) => { a.child.once('exit', r); setTimeout(r, 3000); });
    }
    this.ingestFetches();
  }
}

/** The tools as each model is told about them. The run tool's list is the owner's installed commands. */
function specs(role: 'buyer' | 'seller'): ToolSpec[] {
  const commands = COMMANDS[role];
  return [
    { name: 'fetch_url', description: 'GET a URL and read the answer: status, content type and body (up to 60,000 characters; pass offset to read further). Only URLs on your owner\'s allowlist; redirects are not followed. GET only: anything that changes state goes through your owner\'s commands.', input: { type: 'object', properties: { url: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['url'] } },
    { name: 'run_command', description: `Run one of the client commands your owner installed from Crow's public repository, as \`node examples/<command>.ts <args>\`, from your folder, and read its exit code, stdout and stderr. Installed: ${commands.map((c) => (c === 'adapter-log' ? 'adapter-log (the new lines the background seller adapter has logged)' : c === 'seller-adapter' ? 'seller-adapter (starts in the background)' : c)).join(', ')}. Pass the arguments as the docs give them, one per array item, with no shell quoting. Your owner has set the environment these commands need (HOLDBACK_OPERATORS${role === 'seller' ? ', and HOLDBACK_KEY with your signing key' : ''}); you never see a key.`, input: { type: 'object', properties: { command: { type: 'string', enum: commands }, args: { type: 'array', items: { type: 'string' } } }, required: ['command', 'args'] } },
    { name: 'read_file', description: 'Read a text file in your folder (up to 60,000 characters; pass offset to read further).', input: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['path'] } },
    { name: 'write_file', description: 'Write a text file in your folder (at most 1 MB), making folders as needed.', input: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
    { name: 'list_files', description: 'List a folder inside your folder.', input: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'wait', description: 'Wait 1 to 30 seconds, for example while the other side acts.', input: { type: 'object', properties: { seconds: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['seconds'] } },
    { name: 'finish', description: 'End your work and report to your owner: the outcome in a few words, and a short report.', input: { type: 'object', properties: { outcome: { type: 'string' }, report: { type: 'string' } }, required: ['outcome', 'report'] } },
  ];
}
