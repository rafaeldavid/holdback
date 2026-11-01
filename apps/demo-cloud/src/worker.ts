// The public demo on Cloudflare (T-026): two Workers, holdback-op1 and holdback-op2, each an operator node in
// front of one Durable Object, World, that holds the whole public world (world.ts). holdback-op1 defines the
// Durable Object; holdback-op2 binds to it by script name. Each Worker forwards a request with which node it
// is, its own origin and the caller's IP; the Durable Object answers as that node, signing receipts with that
// node's key. Both nodes share one simulated settlement layer, and the notes they serve say so.
import { PublicWorld, type Via } from './world.js';
import type { WorldStorage } from './storage.js';

// The few Workers runtime types used here, declared locally so the package needs no Workers type package.
interface DurableObjectStorage extends WorldStorage {
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
}
interface DurableObjectState {
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(f: () => Promise<T>): Promise<T>;
}
interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

export interface Env {
  WORLD: DurableObjectNamespace;
  /** "0" for holdback-op1, "1" for holdback-op2. */
  NODE_INDEX: string;
  /** The demo club's minimum window in seconds (default 60). */
  MIN_WINDOW_SEC?: string;
  [name: string]: unknown;
}

/** The one world both Workers serve. Bump the name to start a fresh world. */
const WORLD_NAME = 'holdback-public-demo-v1';
const NODE = 'x-holdback-node';
const ORIGIN = 'x-holdback-origin';
const CLIENT = 'x-holdback-client';

const strings = (env: Env): Record<string, string> => Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'));

export class World {
  private world: Promise<PublicWorld> | undefined;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  private open(): Promise<PublicWorld> {
    this.world ??= this.state.blockConcurrencyWhile(() =>
      PublicWorld.open({
        storage: this.state.storage,
        env: strings(this.env),
        ...(this.env.MIN_WINDOW_SEC ? { minWindowSec: Number(this.env.MIN_WINDOW_SEC) } : {}),
        onError: (e) => console.error(`demo adjudicator: ${e.message}`),
      }),
    );
    return this.world;
  }

  private async schedule(world: PublicWorld, delayMs: number): Promise<void> {
    if (!world.active()) return;
    // An alarm whose handler threw stays set, overdue, while the runtime backs off its retries; a request then
    // re-arms it rather than wait (T-029 measured adjudicators idle for minutes after one failed version).
    const at = await this.state.storage.getAlarm();
    if (at === null || at < Date.now() - 5000) await this.state.storage.setAlarm(Date.now() + delayMs);
  }

  async fetch(request: Request): Promise<Response> {
    const world = await this.open();
    const via: Via = { node: request.headers.get(NODE) === '1' ? 1 : 0, origin: request.headers.get(ORIGIN) ?? new URL(request.url).origin, client: request.headers.get(CLIENT) ?? 'unknown' };
    const headers = new Headers(request.headers);
    for (const h of [NODE, ORIGIN, CLIENT]) headers.delete(h);
    const response = await world.fetch(new Request(request, { headers }), via);
    await this.schedule(world, 500);
    return response;
  }

  /** Adjudicators look for work about once a second while the world is active. */
  async alarm(): Promise<void> {
    const world = await this.open();
    await world.work();
    await this.schedule(world, 1000);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    // Set by this Worker only: whatever a caller sent under these names is replaced.
    headers.set(NODE, env.NODE_INDEX === '1' ? '1' : '0');
    headers.set(ORIGIN, url.origin);
    headers.set(CLIENT, request.headers.get('cf-connecting-ip') ?? 'unknown');
    const stub = env.WORLD.get(env.WORLD.idFromName(WORLD_NAME));
    return stub.fetch(new Request(request, { headers }));
  },
};
