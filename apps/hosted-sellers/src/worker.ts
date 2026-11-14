// A hosted seller (T-435, ADR-0037): Crow runs the seller adapter for a company that has only a job API, on Crow's own
// Cloudflare account. Each seller is its own Worker, `crow-seller-<slug>`, with its own secrets and one Durable Object
// that holds its deals. The Worker serves the seller's page at crow.direct/agents/<slug> and passes every other path
// under it to the object, where the adapter's core (examples/seller-adapter-core.ts) answers the quote and defaults
// routes and an alarm moves the open deals. The seller signs as any party does and reaches the operators over their
// public API: this Worker has no power over the hold, the operators or the adjudicators.
//
//   GET  <base>             the seller's page: a <script id="crow-agent"> card with the quote and defaults addresses
//   GET  <base>/agent.json  the same card as JSON
//   GET  <base>/health      operational or degraded, the open deals by stage, and the bundle's SHA-256
//   POST <base>/quote, GET <base>/defaults, POST <base>/deals/<id>/ready and /job: the adapter's own routes
//
// The seller's bundle (bundle.ts) is built at deploy and holds no secret. The secrets are Worker secrets: HOLDBACK_KEY,
// the seller's signing key, and the variables its configuration names for its credentials. The core gets those and
// no other variable. Test tokens only: the object starts only on Sepolia or SimChain.
import { createSellerAdapter, type Journal, type SellerAdapterCore, type Stage } from '../../../examples/seller-adapter-core.ts';
import { checkBundle, type HostedBundle, type HostedSeller } from './bundle.ts';

// The few Workers runtime types used here, declared locally so the package needs no Workers type package.
export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  list<T = unknown>(options: { prefix: string }): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
}
export interface DurableObjectState {
  storage: DurableObjectStorage;
}
interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface Env {
  SELLER: DurableObjectNamespace;
  /** Comma-separated operator base URLs, two distinct origins. */
  OPERATOR_URLS: string;
  /** The seller's public address, https://crow.direct/agents/<slug>. */
  SELLER_URL: string;
  /** Worker secret: the seller's signing key for this seller only. */
  HOLDBACK_KEY?: string;
  /** The Worker secrets the configuration names for its credentials, by those names. */
  [name: string]: unknown;
}

/** Chains a hosted seller may sign for: Sepolia and SimChain, both test networks. Anything else stops the object. */
export const TEST_CHAINS: readonly number[] = [11_155_111, 31_337];
/** Storage keys: one per deal and one per quote replay, so no single value grows with every quote (red team, T-434). */
const DEAL = 'deal:';
const QUOTE = 'quote:';
const MANDATES = 'mandates';
/** Durable Object storage takes at most 128 entries in one put. */
const PUT_MAX = 128;

/**
 * The journal kept as one storage entry per deal and per quote replay. `save` writes only the entries that changed
 * since the last save, in order; the output gate holds the next outgoing request until they are stored.
 */
export function journalStore(storage: DurableObjectStorage, log: (line: string) => void) {
  const written = new Map<string, string>();
  return {
    async load(): Promise<Journal | undefined> {
      const deals = await storage.list<Journal['deals'][string]>({ prefix: DEAL });
      const quotes = await storage.list<Journal['quotes'][string]>({ prefix: QUOTE });
      const mandates = await storage.get<string[]>(MANDATES);
      if (deals.size === 0 && quotes.size === 0 && mandates === undefined) return undefined;
      const journal: Journal = { deals: {}, quotes: {}, ...(mandates === undefined ? {} : { mandatesSeen: mandates }) };
      for (const [k, d] of deals) {
        journal.deals[k.slice(DEAL.length)] = d;
        written.set(k, JSON.stringify(d));
      }
      for (const [k, q] of quotes) {
        journal.quotes[k.slice(QUOTE.length)] = q;
        written.set(k, JSON.stringify(q));
      }
      if (mandates !== undefined) written.set(MANDATES, JSON.stringify(mandates));
      return journal;
    },
    save(journal: Journal): void {
      const changed: Record<string, unknown> = {};
      const consider = (key: string, value: unknown) => {
        const text = JSON.stringify(value);
        if (written.get(key) === text) return;
        changed[key] = JSON.parse(text);
        written.set(key, text);
      };
      for (const [id, d] of Object.entries(journal.deals)) consider(`${DEAL}${id}`, d);
      for (const [k, q] of Object.entries(journal.quotes)) consider(`${QUOTE}${k}`, q);
      if (journal.mandatesSeen !== undefined) consider(MANDATES, journal.mandatesSeen);
      const keys = Object.keys(changed);
      for (let i = 0; i < keys.length; i += PUT_MAX) {
        const part = Object.fromEntries(keys.slice(i, i + PUT_MAX).map((k) => [k, changed[k]]));
        void storage.put(part).catch((e: Error) => log(`The journal could not be stored: ${e.message}`));
      }
    },
  };
}
/** How long the object waits before it tries again after it could not start, in milliseconds. */
const RETRY_MS = 60_000;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
/** JSON inside a <script> element: no "</" or "<!--" can end it early. */
const scriptJson = (v: unknown) => JSON.stringify(v, null, 2).replace(/</g, '\\u003c');

/** The object's name: one per seller, the same across deploys, so a deploy keeps the seller's open deals. */
export const objectName = (slug: string) => `crow-hosted-seller-${slug}`;

/** One seller's bundle, checked once per isolate: a bad bundle makes every request answer 503 and names why. */
export interface Setup {
  seller: HostedSeller | undefined;
  bundleError: string | undefined;
  /** The path under the seller's base, '' for the base itself; undefined for a path that is not the seller's. */
  under(path: string): string | undefined;
}

export function setupOf(bundle: HostedBundle): Setup {
  let seller: HostedSeller | undefined;
  let bundleError: string | undefined;
  try {
    seller = checkBundle(bundle);
  } catch (e) {
    bundleError = (e as Error).message;
    console.log(`The hosted seller's bundle is refused: ${bundleError}`);
  }
  const prefix = seller ? `/agents/${seller.slug}` : undefined;
  return { seller, bundleError, under: (path) => (prefix && (path === prefix || path.startsWith(`${prefix}/`)) ? path.slice(prefix.length) : undefined) };
}

/** The seller's Durable Object. entry.ts exports a subclass bound to the deployed bundle's setup. */
export class HostedSellerObject {
  private core: Promise<SellerAdapterCore> | undefined;
  private failure: string | undefined;
  /** When a failed start may be tried again: until then a request answers 503 at once and fetches nothing. */
  private retryAt = 0;
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    private readonly setup: Setup,
  ) {}

  /** The environment the core sees: the signing key, the operators, and the credentials the configuration names. */
  private coreEnv(s: HostedSeller): Record<string, string | undefined> {
    // A HOLDBACK_ variable would change what verify.ts pins (HOLDBACK_DEPLOYMENT, HOLDBACK_CHAIN_ID): refuse them all.
    const stray = Object.keys(this.env).find((k) => k.startsWith('HOLDBACK_') && k !== 'HOLDBACK_KEY');
    if (stray) throw new Error(`${stray} is set on this Worker; a hosted seller signs for the pinned deployment only: remove it`);
    const out: Record<string, string | undefined> = { HOLDBACK_KEY: typeof this.env.HOLDBACK_KEY === 'string' ? this.env.HOLDBACK_KEY : undefined, HOLDBACK_OPERATORS: this.env.OPERATOR_URLS };
    for (const name of s.credentialVars) out[name] = typeof this.env[name] === 'string' ? (this.env[name] as string) : undefined;
    return out;
  }

  /** The core, started once: on the first request or alarm, and again after a start that failed. */
  private open(s: HostedSeller): Promise<SellerAdapterCore> {
    if (!this.core && Date.now() < this.retryAt) return Promise.reject(new Error(this.failure ?? 'not started'));
    this.core ??= (async () => {
      const base = new URL(this.env.SELLER_URL);
      if (base.pathname.replace(/\/+$/, '') !== `/agents/${s.slug}`) throw new Error(`SELLER_URL is ${base.href}, and this seller's address is /agents/${s.slug}`);
      const store = journalStore(this.state.storage, (line) => console.log(line));
      const core = await createSellerAdapter({ ...s.config, log: (line) => console.log(`${new Date().toISOString()} ${line}`) }, this.coreEnv(s), {
        readText: (name) => {
          if (!Object.hasOwn(s.files, name)) throw Object.assign(new Error(`the bundle holds no file ${name.slice(0, 80)}`), { code: 'ENOENT' });
          return s.files[name] as string;
        },
        loadJournal: () => store.load(),
        // Not awaited: the output gate holds the next outgoing request until the writes are stored.
        saveJournal: (journal) => store.save(journal),
      });
      if (!TEST_CHAINS.includes(core.chainId)) {
        await core.close();
        throw new Error(`the operators serve chain ${core.chainId}; a hosted seller signs on test networks only (${TEST_CHAINS.join(', ')})`);
      }
      core.announce(`serves POST ${base.href.replace(/\/+$/, '')}/quote; journal in its Durable Object`);
      this.failure = undefined;
      return core;
    })().catch((e: Error) => {
      this.core = undefined;
      this.failure = e.message;
      this.retryAt = Date.now() + RETRY_MS;
      console.log(`The hosted seller ${s.slug} did not start: ${e.message}`);
      throw e;
    });
    return this.core;
  }

  /** Sets the alarm for `at` unless one is set sooner and not overdue. */
  private async schedule(at: number): Promise<void> {
    const set = await this.state.storage.getAlarm();
    if (set === null || set > at || set < Date.now() - 5000) await this.state.storage.setAlarm(at);
  }

  private async card(s: HostedSeller, core: SellerAdapterCore): Promise<Record<string, unknown>> {
    const base = this.env.SELLER_URL.replace(/\/+$/, '');
    return {
      type: 'crow-agent',
      name: s.card.name,
      // A standing seller lists its address, as Crow's test seller does: check terms.seller against it.
      ...(core.perDealKeys ? {} : { seller: core.address }),
      offers: [{ id: s.card.item, ...(s.card.description === undefined ? {} : { description: s.card.description }), pricing: { kind: 'quoted', quote: `${base}/quote`, defaults: `${base}/defaults` } }],
      health: `${base}/health`,
      operatedBy: 'Crow runs this seller for its company, and runs the operators and the demo adjudicators too. The seller reaches the operators over their public API, as any agent does.',
      configSha256: s.configSha256,
      testTokensOnly: true,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const { seller, under } = this.setup;
    if (!seller) return json(503, { type: 'unavailable', detail: 'this seller is not set up' });
    const sub = under(new URL(request.url).pathname);
    if (sub === undefined) return json(404, { type: 'not_found', detail: 'this Worker serves one seller' });
    if (sub === '/health' && request.method === 'GET') {
      let core: SellerAdapterCore | undefined;
      try {
        core = await this.open(seller);
      } catch {
        // reported below
      }
      // The open deals by stage; delivered and closed ones are done and not counted.
      const stages: Partial<Record<Stage, number>> = {};
      const open = (core?.deals() ?? []).filter((d) => !['delivered', 'closed'].includes(d.stage));
      for (const d of open) stages[d.stage] = (stages[d.stage] ?? 0) + 1;
      if (core?.hasOpen()) await this.schedule(Date.now() + core.pollMs);
      // Why it did not start stays in the log: the public answer says only that it did not.
      return json(core ? 200 : 503, { status: core ? 'operational' : 'degraded', seller: seller.slug, configSha256: seller.configSha256, ...(core ? { open: open.length, stages } : { reason: 'the seller could not start; its log says why' }) });
    }
    let core: SellerAdapterCore;
    try {
      core = await this.open(seller);
    } catch {
      await this.schedule(Date.now() + RETRY_MS); // a stored deal still needs its passes once the start succeeds
      return json(503, { type: 'seller_unavailable', detail: 'the seller cannot take requests now; try again in a minute' });
    }
    let response: Response;
    if ((sub === '' || sub === '/') && request.method === 'GET') {
      const card = await this.card(seller, core);
      const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(seller.card.name)}</title></head>
<body>
<h1>${escapeHtml(seller.card.name)}</h1>
${seller.card.description === undefined ? '' : `<p>${escapeHtml(seller.card.description)}</p>\n`}<p>This seller prices each job by quote on Crow, with test tokens only. A buyer's agent follows <a href="https://crow.direct/buy.txt">https://crow.direct/buy.txt</a> with the quote and defaults addresses in the card below.</p>
<p>Crow runs this seller for its company, and runs the operators and the demo adjudicators too. The seller reaches the operators over their public API, as any agent does.</p>
<script type="application/json" id="crow-agent">${scriptJson(card)}</script>
</body></html>
`;
      response = new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    } else if (sub === '/agent.json' && request.method === 'GET') {
      response = json(200, await this.card(seller, core));
    } else {
      response = await core.handle(request, sub);
    }
    // Any request re-arms a missing or overdue alarm while a deal is open: a lost alarm chain would leave it stuck.
    if (core.hasOpen()) await this.schedule(Date.now() + core.pollMs);
    return response;
  }

  /** Moves the open deals. It never throws: a throwing alarm is retried only six times, then never again. */
  async alarm(): Promise<void> {
    const { seller } = this.setup;
    if (!seller) return;
    let next: number | null;
    try {
      const core = await this.open(seller);
      core.wake();
      await core.idle();
      next = core.hasOpen() ? Date.now() + core.pollMs : null;
    } catch {
      next = Date.now() + RETRY_MS;
    }
    try {
      if (next !== null) await this.state.storage.setAlarm(next);
    } catch (e) {
      console.log(`The next alarm could not be set: ${(e as Error).message}. Any request sets it again.`);
    }
  }
}

/** The Worker in front of the object: it passes the seller's own paths through and answers every other with 404. */
export function workerFor(setup: Setup) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const { seller, under } = setup;
      if (!seller) return json(503, { type: 'unavailable', detail: 'this seller is not set up; its log says why' });
      if (under(new URL(request.url).pathname) === undefined) return json(404, { type: 'not_found', detail: `this Worker serves /agents/${seller.slug} only` });
      return env.SELLER.get(env.SELLER.idFromName(objectName(seller.slug))).fetch(request);
    },
  };
}
