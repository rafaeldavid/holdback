// crow-test-agents: Crow's always-on test counterparties on the Sepolia test environment (T-222). One Durable Object,
// Agents, holds the test seller's deals; the Worker forwards each request with the caller's IP, and the object's
// alarm advances the open deals every few seconds while any is open. The seller reaches the operators over their
// public API like any agent (seller.ts). Test tokens only: it signs for the pinned Sepolia deployment and nothing
// else, and refuses to start without its Sepolia-only secret.
import { knownPins } from '../../../examples/verify.ts';
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
  /** The intake's public URL, such as https://escrow.stream/agents/test-seller. */
  SELLER_URL: string;
  /** Worker secret: 32 bytes of 0x-prefixed hex, Sepolia only (apps/test-agents/scripts/seed.mjs). */
  TEST_AGENTS_SEED?: string;
}

/** Bump to start fresh storage. The seller's keys stay: they derive from TEST_AGENTS_SEED alone. */
const OBJECT_NAME = 'crow-test-agents-sepolia-2026-11-04';
const CLIENT = 'x-crow-test-agents-client';
const SEPOLIA_CHAIN_ID = 11155111;

export class Agents {
  private seller: TestSeller | undefined;
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  private open(): TestSeller {
    if (this.seller) return this.seller;
    const seed = this.env.TEST_AGENTS_SEED;
    if (!seed || !/^0x[0-9a-fA-F]{64}$/.test(seed)) throw new Error(`${SEED_VAR} is not set: it is a Worker secret (apps/test-agents/scripts/seed.mjs)`);
    // No real money: the seller signs only for the Sepolia deployment pinned in examples/deployments.ts.
    const pin = knownPins().find((p) => p.domain.chainId === SEPOLIA_CHAIN_ID);
    if (!pin) throw new Error('examples/deployments.ts pins no Sepolia deployment');
    const operators = this.env.OPERATOR_URLS.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
    this.seller = new TestSeller({ storage: this.state.storage, operators, seed, pin, base: this.env.SELLER_URL });
    return this.seller;
  }

  /** Sets the alarm for `next` when none is set, a later one is, or the set one is overdue (its handler failed). */
  private async schedule(next: number | null): Promise<void> {
    if (next === null) return;
    const at = await this.state.storage.getAlarm();
    if (at === null || at > next || at < Date.now() - 5000) await this.state.storage.setAlarm(next);
  }

  async fetch(request: Request): Promise<Response> {
    const seller = this.open();
    const response = await seller.fetch(request, request.headers.get(CLIENT) ?? 'unknown');
    // Any request re-arms a missing or overdue alarm while a deal is open, as the World does (docs/operations.md):
    // a lost alarm chain would otherwise leave open deals, and the open cap, stuck. An idle seller sets none.
    if (await seller.hasOpen()) await this.schedule(Date.now() + 500);
    return response;
  }

  async alarm(): Promise<void> {
    await this.schedule(await this.open().work());
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = new Headers(request.headers);
    // Set by this Worker only: whatever a caller sent under this name is replaced.
    headers.set(CLIENT, request.headers.get('cf-connecting-ip') ?? 'unknown');
    return env.AGENTS.get(env.AGENTS.idFromName(OBJECT_NAME)).fetch(new Request(request, { headers }));
  },
};
