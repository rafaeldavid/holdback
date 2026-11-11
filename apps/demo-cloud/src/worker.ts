// The public demo on Cloudflare: two Workers, holdback-op1 and holdback-op2, each an operator node in
// front of one Durable Object, World, that holds the whole public world (world.ts). holdback-op1 defines the
// Durable Object; holdback-op2 binds to it by script name. Each Worker forwards a request with which node it
// is, its own origin and the caller's IP; the Durable Object answers as that node, signing receipts with that
// node's key. Both nodes share one settlement layer, and the notes they serve say so.
//
// D41, ADR-0028: each Worker's SETTLEMENT variable, `sim` or `sepolia`, picks the world it forwards to. The two
// worlds have different names, so neither touches the other's storage, and setting the variable back is the
// rollback. The variable has no default (T-313): with any other value, or none, the Worker answers 500 and forwards
// nothing. A world records its settlement when it is created and keeps it. The Sepolia world's relayer key is the
// Worker secret SEPOLIA_RELAYER_KEY on holdback-op1 (the Durable Object runs with op1's environment); its contract
// addresses are contracts/deployments/sepolia.json, embedded in the bundle.
import { readFileSync } from 'node:fs';
import { PROBLEM_BASE, PROBLEMS } from '@holdback/operator';
import { LiveChain, SEPOLIA_PUBLIC_RPCS, type DeploymentFile } from '@holdback/settlement/live';
import { PublicWorld, type LiveSettlement, type Via } from './world.js';
import { KvFeedbackStore, type KvNamespace } from './feedback-store.js';
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
  /** The private report store (T-032), a KV namespace bound on holdback-op1. Absent: the nodes take no reports. */
  FEEDBACK?: KvNamespace;
  /** Which world this Worker serves: exactly `sim` or `sepolia` (D41). Required: any other value, or none, answers 500. */
  SETTLEMENT?: string;
  /** holdback-op1 secret: the Sepolia relayer's funding-lane key (apps/demo-cloud/scripts/relayer.mjs). */
  SEPOLIA_RELAYER_KEY?: string;
  /** Optional, comma-separated: keyed Sepolia RPC URLs tried before the public ones (a secret when keyed). */
  SEPOLIA_RPC_URLS?: string;
  /** Optional: the fee cap per gas in gwei (default 20). */
  SEPOLIA_MAX_FEE_GWEI?: string;
  [name: string]: unknown;
}

/**
 * The worlds the Workers serve, one per settlement. Bump a name to start a fresh world: a schema change can make a
 * stored journal unreplayable (v0.8's rulebook hash refused v0.7's offers), a new deployment needs a new chain world,
 * and the old world's storage stays for a rollback.
 */
const WORLD_NAMES = { sim: 'holdback-public-demo-2026-11-04', sepolia: 'holdback-public-demo-sepolia-2026-11-04' } as const;
type Settlement = keyof typeof WORLD_NAMES;
const NODE = 'x-holdback-node';
const ORIGIN = 'x-holdback-origin';
const CLIENT = 'x-holdback-client';
const SETTLEMENT = 'x-holdback-settlement';

const strings = (env: Env): Record<string, string> => Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'));
/** The settlement a value names, or null: there is no default, so a typo cannot serve the SimChain world as Sepolia's. */
const settlementOf = (v: unknown): Settlement | null => (v === 'sim' || v === 'sepolia' ? v : null);

/** The 500 a node answers while its SETTLEMENT variable names no settlement: an RFC 9457 problem, and a log line. */
function unconfigured(set: boolean): Response {
  const state = set ? 'is neither `sim` nor `sepolia`' : 'is not set';
  const detail = "This node's SETTLEMENT variable " + state + '. It must be exactly `sim` or `sepolia`, so the node forwards nothing until its operator sets it and deploys again.';
  console.error(`demo world: ${detail}`);
  return new Response(JSON.stringify({ type: 'internal', title: PROBLEMS.internal.title, status: 500, detail }), {
    status: 500,
    headers: { 'content-type': 'application/problem+json', link: `<${PROBLEM_BASE}internal>; rel="type"` },
  });
}

/** A log line with each keyed RPC URL cut to its origin: viem's errors name the URL, and a keyed path is a secret. */
function redact(message: string, env: Env): string {
  let out = message;
  for (const u of (env.SEPOLIA_RPC_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const origin = URL.canParse(u) ? new URL(u).origin : 'a keyed RPC';
    out = out.split(u).join(`${origin}/…`);
  }
  return out;
}

/** The Sepolia chain from holdback-op1's environment and the embedded deployment. Throws on a missing secret. */
function sepolia(env: Env): LiveSettlement {
  const key = env.SEPOLIA_RELAYER_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('SEPOLIA_RELAYER_KEY is not set: it is a Worker secret on holdback-op1 (apps/demo-cloud/scripts/relayer.mjs)');
  const deployment = JSON.parse(readFileSync(new URL('../../../contracts/deployments/sepolia.json', import.meta.url), 'utf8')) as DeploymentFile;
  const keyed = (env.SEPOLIA_RPC_URLS ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  const maxFee = Number(env.SEPOLIA_MAX_FEE_GWEI);
  return { chain: new LiveChain({ deployment, rpcUrls: [...keyed, ...SEPOLIA_PUBLIC_RPCS], relayerKey: key as `0x${string}`, ...(maxFee > 0 ? { maxFeeGwei: maxFee } : {}) }) };
}

export class World {
  private world: Promise<PublicWorld> | undefined;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  /**
   * Opens this object's world. An existing world keeps the settlement it recorded; a new one takes the one its
   * Worker named. The Durable Object always runs with holdback-op1's environment, so it cannot read a per-Worker
   * variable itself: the Worker forwards it.
   */
  private open(asked?: Settlement): Promise<PublicWorld> {
    if (this.world) return this.world;
    const opening = this.state.blockConcurrencyWhile(async () => {
      const meta = await this.state.storage.get<{ settlement?: Settlement }>('meta');
      const kind = meta ? (meta.settlement ?? 'sim') : (asked ?? 'sim');
      return PublicWorld.open({
        storage: this.state.storage,
        env: strings(this.env),
        ...(this.env.MIN_WINDOW_SEC ? { minWindowSec: Number(this.env.MIN_WINDOW_SEC) } : {}),
        ...(this.env.FEEDBACK ? { feedbackStore: new KvFeedbackStore(this.env.FEEDBACK) } : {}),
        ...(kind === 'sepolia' ? { live: sepolia(this.env) } : {}),
        onError: (e) => console.error(`demo world: ${redact(e.message, this.env)}`),
      });
    });
    // A failed open (a missing secret, say) is tried again on the next request instead of failing every one after.
    this.world = opening;
    opening.catch(() => {
      if (this.world === opening) this.world = undefined;
    });
    return opening;
  }

  /** Sets the alarm for the next adjudicator pass, if one is due (each setAlarm is billed as a row written). */
  private async schedule(world: PublicWorld): Promise<void> {
    this.flushLater(world);
    const next = world.nextPass();
    if (next === null) return;
    // An alarm whose handler threw stays set, overdue, while the runtime backs off its retries; a request then
    // re-arms it a second out rather than wait (measured: adjudicators idle for minutes after one failed version),
    // never later, even when the next pass due is a takeover hours away. An alarm set after the next pass (a slow
    // cadence, then a write brings new work) is brought forward.
    const at = await this.state.storage.getAlarm();
    const overdue = at !== null && at < Date.now() - 5000;
    if (at === null || at > next || overdue) {
      await this.state.storage.setAlarm(overdue ? Math.min(next, Date.now() + 1000) : next);
      world.telemetry.alarmSet();
    }
  }

  /**
   * Waiting log lines flush on a timer, not an alarm: a pending timer keeps this instance in memory until the flush and
   * costs no row, where an alarm could wake a fresh instance with the lines already gone. Passes can be a minute or
   * more apart, so the timer runs whether or not one is due; it skips when a pass has flushed the lines meanwhile.
   */
  private flushLater(world: PublicWorld): void {
    const due = world.telemetry.flushDueInMs();
    if (due === null || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      if (world.telemetry.flushDueInMs() !== null) void world.flushTelemetry();
    }, due);
  }

  async fetch(request: Request): Promise<Response> {
    // The Worker in front always names its settlement; without one this object opens no world, not the SimChain one.
    const asked = settlementOf(request.headers.get(SETTLEMENT));
    if (!asked) return unconfigured(request.headers.has(SETTLEMENT));
    const world = await this.open(asked);
    const via: Via = { node: request.headers.get(NODE) === '1' ? 1 : 0, origin: request.headers.get(ORIGIN) ?? new URL(request.url).origin, client: request.headers.get(CLIENT) ?? 'unknown' };
    const headers = new Headers(request.headers);
    for (const h of [NODE, ORIGIN, CLIENT, SETTLEMENT]) headers.delete(h);
    const response = await world.fetch(new Request(request, { headers }), via);
    await this.schedule(world);
    return response;
  }

  /**
   * One adjudicator pass (or a chain world's setup step), then the next alarm if a case still awaits the adjudicators
   * or setup is left; telemetry flushes on the same pass.
   */
  async alarm(): Promise<void> {
    const world = await this.open();
    await world.work();
    await this.schedule(world);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    const settlement = settlementOf(env.SETTLEMENT);
    if (!settlement) return unconfigured(env.SETTLEMENT !== undefined);
    // Set by this Worker only: whatever a caller sent under these names is replaced.
    headers.set(NODE, env.NODE_INDEX === '1' ? '1' : '0');
    headers.set(ORIGIN, url.origin);
    headers.set(CLIENT, request.headers.get('cf-connecting-ip') ?? 'unknown');
    headers.set(SETTLEMENT, settlement);
    const stub = env.WORLD.get(env.WORLD.idFromName(WORLD_NAMES[settlement]));
    return stub.fetch(new Request(request, { headers }));
  },
};
