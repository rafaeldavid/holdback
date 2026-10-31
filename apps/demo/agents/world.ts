// The demo world: one SimChain whose genesis carries the Data Services Club (fixtures/clubs), mandates for
// Atlas Research's and Tidewater Data's agents, the buyer's test balance and the three benches' bonds; any
// number of operator nodes over it; and a content-addressed ciphertext store. Clock, keys and randomness come
// from one testkit context, so a seed replays the same commitments, deliveries and settlement log.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { holdbackDomain, type Address, type Club, type EncryptedKey, type Hex32, type SettlementEvent, type Sha256, type Timestamp } from '@holdback/core';
import type { RandomSource } from '@holdback/core/crypto';
import { MemoryCiphertextStore, type CiphertextStore } from '@holdback/core/store';
import { simRegistry, startOperator, type RunningOperator } from '@holdback/operator';
import { Holdback, type SubmitCallOptions } from '@holdback/sdk';
import { mandateFor, SIM_CHAIN_ID, SimChain, TOKEN, wideScope, type Genesis } from '@holdback/settlement/sim';
import { createContext, loadClubFile, type SimContext } from '@holdback/testkit';
import { keccak256, stringToBytes } from 'viem';
import { agentKeys, rngSource, type AgentKeys } from './keys.js';

function repoRoot(): string {
  let dir = dirname(new URL(import.meta.url).pathname);
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('repository root (pnpm-workspace.yaml) not found');
    dir = up;
  }
  return dir;
}

export const REPO_ROOT = repoRoot();
export const DATA_DIR = join(REPO_ROOT, 'fixtures/data/dataset-cleaning');
export const CLUB_FILE = join(REPO_ROOT, 'fixtures/clubs/data-services-v1.yaml');
export const TERMS_FILE = join(REPO_ROOT, 'fixtures/terms/clean-customers-2000.yaml');
export const CHECKS_ONLY_TERMS_FILE = join(REPO_ROOT, 'fixtures/terms/clean-customers-2000-checks-only.yaml');

export const TUSD = 1_000_000n;
export const DEMO_START: Timestamp = '2026-11-01T09:00:00.000Z';
export const DOMAIN = holdbackDomain(SIM_CHAIN_ID);

export interface Cast {
  /** Atlas Research's procurement agent (buyer). */
  atlas: AgentKeys;
  /** Tidewater Data's cleaning agent (seller). */
  tidewater: AgentKeys;
  benchA: AgentKeys;
  benchB: AgentKeys;
  benchC: AgentKeys;
}

export type ActorName = 'atlas' | 'tidewater' | 'bench-a' | 'bench-b' | 'bench-c';

export interface DemoWorldOptions {
  seed?: number;
  start?: Timestamp;
  /** Operator IDs to start, in the SDK's failover order. Default op-1, op-2. */
  operators?: readonly string[];
  /** Atlas's starting balance in base units. Default 10,000 tUSD. */
  buyerBalance?: bigint;
  /** Each bench's junior bond in base units. Default 25,000 tUSD. */
  bond?: bigint;
}

export interface DemoWorld {
  readonly ctx: SimContext;
  readonly chain: SimChain;
  readonly club: Club;
  readonly cast: Cast;
  readonly store: CiphertextStore;
  readonly operators: readonly RunningOperator[];
  /** Deterministic bytes from the context's RNG. */
  readonly random: RandomSource;
  operatorUrl(id: string): string;
  /** An SDK client over the operators in order, with SimChain as the direct-submit escape hatch. */
  sdk(): Holdback;
  /** A fresh idempotency key from the context, so reruns send the same keys. */
  call(): SubmitCallOptions;
  /** Context time in whole seconds; always equal to SimChain's clock. */
  now(): Timestamp;
  advance(seconds: number): void;
  balance(who: ActorName): Promise<bigint>;
  addressOf(who: ActorName): Address;
  /** The commitment's events, oldest first, read through the operators (or SimChain directly). */
  events(id: Hex32): Promise<SettlementEvent[]>;
  /** Content-key envelopes released to a recipient: GET /v1/commitments/{id}/key, else SimChain directly. */
  keysFor(id: Hex32, recipient: Address): Promise<EncryptedKey[]>;
  close(): Promise<void>;
}

const wholeSecond = (ts: Timestamp): Timestamp => new Date(Math.floor(Date.parse(ts) / 1000) * 1000).toISOString().replace('.000Z', 'Z');

export async function createDemoWorld(options: DemoWorldOptions = {}): Promise<DemoWorld> {
  const seed = options.seed ?? 7;
  const ctx = createContext({ seed, start: options.start ?? DEMO_START });
  const start = wholeSecond(ctx.clock.now());
  if (`${start.slice(0, -1)}.000Z` !== ctx.clock.now()) throw new RangeError(`start ${ctx.clock.now()} must be a whole second`);
  const cast: Cast = {
    atlas: agentKeys(seed, 'atlas'),
    tidewater: agentKeys(seed, 'tidewater'),
    benchA: agentKeys(seed, 'bench-a'),
    benchB: agentKeys(seed, 'bench-b'),
    benchC: agentKeys(seed, 'bench-c'),
  };
  const club = loadClubFile(CLUB_FILE);
  const expires = new Date(Date.parse(start) + 365 * 86_400_000).toISOString().replace('.000Z', 'Z');
  // Each agent acts under a mandate its principal (Atlas Research, Tidewater Data) signed.
  const mandates = [];
  for (const [agent, principal] of [
    [cast.atlas, 'atlas-research'],
    [cast.tidewater, 'tidewater-data'],
  ] as const) {
    const p = agentKeys(seed, principal);
    mandates.push(await mandateFor({ name: principal, key: p.signingKey, address: p.address }, agent.address, club.id, wideScope(['buyer', 'seller'], expires), start));
  }
  const bond = (options.bond ?? 25_000n * TUSD).toString();
  const genesis: Genesis = {
    start,
    simSeed: keccak256(stringToBytes(`holdback/demo-agents/v0/${seed}/sim-beacon`)),
    chainId: SIM_CHAIN_ID,
    token: TOKEN,
    clubs: [club],
    mandates,
    members: [],
    balances: { [cast.atlas.address]: (options.buyerBalance ?? 10_000n * TUSD).toString() },
    bonds: Object.fromEntries([cast.benchA, cast.benchB, cast.benchC].map((b) => [b.address, { junior: bond, senior: '0' }])),
  };
  const chain = new SimChain(genesis);
  const operators: RunningOperator[] = [];
  const ids = options.operators ?? ['op-1', 'op-2'];
  for (const id of ids) {
    const signer = agentKeys(seed, `operator/${id}`);
    operators.push(await startOperator({ settlement: chain, registry: simRegistry(chain), signerKey: signer.signingKey, operatorId: id, env: {} }));
  }
  const urls = new Map(ids.map((id, i) => [id, operators[i]!.url]));
  const sdk = () => new Holdback({ operators: [...urls.values()], settlement: chain, pollMs: 10 });
  const store = new MemoryCiphertextStore();
  const random = rngSource(ctx.rng);
  const addressOf = (who: ActorName): Address =>
    ({ atlas: cast.atlas, tidewater: cast.tidewater, 'bench-a': cast.benchA, 'bench-b': cast.benchB, 'bench-c': cast.benchC })[who].address;

  async function firstOperator<T>(path: string): Promise<T | undefined> {
    for (const url of urls.values()) {
      try {
        const res = await fetch(`${url}${path}`, { headers: { accept: 'application/json' } });
        if (res.ok) return (await res.json()) as T;
      } catch {
        // An operator that is down or refuses is skipped; SimChain answers last (ADR-0005).
      }
    }
    return undefined;
  }

  return {
    ctx,
    chain,
    club,
    cast,
    store,
    operators,
    random,
    operatorUrl: (id) => {
      const u = urls.get(id);
      if (!u) throw new Error(`no operator ${id}`);
      return u;
    },
    sdk,
    call: () => ({ idempotencyKey: `demo-${seed}-${ctx.ids.next('call')}` }),
    now: () => wholeSecond(ctx.clock.now()),
    advance: (seconds) => {
      ctx.clock.advanceSeconds(seconds);
      chain.advance(seconds);
    },
    balance: async (who) => BigInt((await chain.balances([addressOf(who)]))[addressOf(who)]!.amount),
    addressOf,
    events: async (id) => {
      try {
        return [...(await sdk().events(id, { limit: 200 })).items].sort((a, b) => a.seq - b.seq);
      } catch {
        const out: SettlementEvent[] = [];
        for await (const e of chain.events()) if (e.commitmentId === id) out.push(e);
        return out;
      }
    },
    keysFor: async (id, recipient) => {
      const page = await firstOperator<{ items: EncryptedKey[] }>(`/v1/commitments/${id}/key?recipient=${recipient}`);
      return page ? page.items : chain.keysFor(id, recipient);
    },
    close: async () => void (await Promise.all(operators.map((o) => o.close()))),
  };
}

/** The delivery facts a party reads from the settlement log: hashes and the ciphertext pointer, never content. */
export interface DeliveryFacts {
  attempt: number;
  deliveryHash: Hex32;
  plaintextSha256: Sha256;
  ciphertext: { uri: string; sha256: Sha256; bytes: number; cipher: 'aes-256-gcm' };
}

export async function deliveryFacts(world: DemoWorld, id: Hex32): Promise<DeliveryFacts> {
  const e = (await world.events(id)).filter((x) => x.type === 'delivery.submitted').at(-1);
  if (!e) throw new Error(`no delivery for ${id}`);
  return e.payload as unknown as DeliveryFacts;
}
