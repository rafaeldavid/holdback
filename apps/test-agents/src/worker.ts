// crow-test-agents: Crow's always-on test counterparties on the Sepolia test environment (T-222, T-239). One Durable
// Object, Agents, holds the test seller's deals and the test buyer's (under the key prefix "buyer:"); the Worker
// forwards each request with the caller's IP, and the object's alarm advances the open deals every few seconds while
// any is open. Both reach the operators over their public API like any agent (seller.ts, buyer.ts). Test tokens
// only: they sign for the pinned Sepolia deployment and nothing else, and refuse to start without their Sepolia-only
// secret.
import { knownPins, type Pin } from '../../../examples/verify.ts';
import { prefixed, TestBuyer } from './buyer.ts';
import { SEED_VAR } from './keys.ts';
import { TestSeller, type Storage } from './seller.ts';

// The few Workers runtime types used here, declared locally so the package needs no Workers type package.
interface DurableObjectStorage extends Storage {
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
}
interface DurableObjectState {
  storage: DurableObjectStorage;
}
interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface Env {
  AGENTS: DurableObjectNamespace;
  /** Comma-separated operator base URLs, two distinct origins. */
  OPERATOR_URLS: string;
  /** Comma-separated other base URLs of the same operators, whose ciphertext URIs the seller also accepts (T-312). */
  OPERATOR_ALIASES?: string;
  /** The intake's public URL, such as https://crow.direct/agents/test-seller. */
  SELLER_URL: string;
  /** The test buyer's public URL, such as https://crow.direct/agents/test-buyer. Without it, no buyer runs. */
  BUYER_URL?: string;
  /** Worker secret: 32 bytes of 0x-prefixed hex, Sepolia only (apps/test-agents/scripts/seed.mjs). */
  TEST_AGENTS_SEED?: string;
}

/** Bump to start fresh storage. The seller's keys stay: they derive from TEST_AGENTS_SEED alone. */
const OBJECT_NAME = 'crow-test-agents-sepolia-2026-11-04';
const CLIENT = 'x-crow-test-agents-client';
const SEPOLIA_CHAIN_ID = 11155111;

export class Agents {
  private seller: TestSeller | undefined;
  private buyer: TestBuyer | undefined;
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  /** The secret, the pinned Sepolia deployment and the operators both agents run with. */
  private config(): { seed: string; pin: Pin; operators: string[] } {
    const seed = this.env.TEST_AGENTS_SEED;
    if (!seed || !/^0x[0-9a-fA-F]{64}$/.test(seed)) throw new Error(`${SEED_VAR} is not set: it is a Worker secret (apps/test-agents/scripts/seed.mjs)`);
    // No real money: the agents sign only for the Sepolia deployment pinned in examples/deployments.ts.
    const pin = knownPins().find((p) => p.domain.chainId === SEPOLIA_CHAIN_ID);
    if (!pin) throw new Error('examples/deployments.ts pins no Sepolia deployment');
    const operators = this.env.OPERATOR_URLS.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
    return { seed, pin, operators };
  }

  private open(): TestSeller {
    if (this.seller) return this.seller;
    const { seed, pin, operators } = this.config();
    const aliases = (this.env.OPERATOR_ALIASES ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
    this.seller = new TestSeller({ storage: this.state.storage, operators, aliases, seed, pin, base: this.env.SELLER_URL });
    return this.seller;
  }

  /** The test buyer, when BUYER_URL is set: its deals live under "buyer:" in the same storage. */
  private openBuyer(): TestBuyer | undefined {
    if (this.buyer || !this.env.BUYER_URL) return this.buyer;
    const { seed, pin, operators } = this.config();
    this.buyer = new TestBuyer({ storage: prefixed(this.state.storage, 'buyer:'), operators, seed, pin, base: this.env.BUYER_URL });
    return this.buyer;
  }

  /** Whether a request is for the buyer: its path is the buyer's base path or under it. */
  private forBuyer(request: Request): boolean {
    if (!this.env.BUYER_URL) return false;
    const base = new URL(this.env.BUYER_URL).pathname.replace(/\/+$/, '');
    const path = new URL(request.url).pathname;
    return path === base || path.startsWith(`${base}/`);
  }

  /** Sets the alarm for `next` when none is set, a later one is, or the set one is overdue (its handler failed). */
  private async schedule(next: number | null): Promise<void> {
    if (next === null) return;
    const at = await this.state.storage.getAlarm();
    if (at === null || at > next || at < Date.now() - 5000) await this.state.storage.setAlarm(next);
  }

  async fetch(request: Request): Promise<Response> {
    const seller = this.open();
    const buyer = this.openBuyer();
    const response = buyer && this.forBuyer(request) ? await buyer.fetch(request) : await seller.fetch(request, request.headers.get(CLIENT) ?? 'unknown');
    // Any request re-arms a missing or overdue alarm while a deal is open, as the World does (docs/operations.md):
    // a lost alarm chain would otherwise leave open deals, and the open cap, stuck. Idle agents set none.
    if ((await seller.hasOpen()) || (buyer && (await buyer.hasOpen()))) await this.schedule(Date.now() + 500);
    return response;
  }

  async alarm(): Promise<void> {
    // Each agent's work runs on its own: one that throws does not stop the other's deals.
    const runs = await Promise.allSettled([this.open().work(), this.openBuyer()?.work() ?? Promise.resolve(null)]);
    const next = runs.map((r) => (r.status === 'fulfilled' ? r.value : Date.now() + 5000)).filter((x): x is number => x !== null);
    await this.schedule(next.length ? Math.min(...next) : null);
  }
}

/**
 * The site's old hostname (T-312). Its route stays while the forwarding runs, and each request on it gets a 308 to the
 * same path and query on crow.direct: a 308 keeps a POST's method and body, so a buyer on the old URL still arrives.
 */
const FORWARDED = 'escrow.stream';
const CANONICAL = 'https://crow.direct';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === FORWARDED) return Response.redirect(`${CANONICAL}${url.pathname}${url.search}`, 308);
    const headers = new Headers(request.headers);
    // Set by this Worker only: whatever a caller sent under this name is replaced.
    headers.set(CLIENT, request.headers.get('cf-connecting-ip') ?? 'unknown');
    return env.AGENTS.get(env.AGENTS.idFromName(OBJECT_NAME)).fetch(new Request(request, { headers }));
  },
};
