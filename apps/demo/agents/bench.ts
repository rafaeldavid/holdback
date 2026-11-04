// The adjudicators as the demo agents see them. The parties name a primary, fallback and appeal adjudicator
// in the terms; the primary finds the offer on the settlement layer and accepts it with a seed commitment, and
// after delivery it decides. `AdjudicatorSeam` is that narrow interface; `ServiceBench` is the adjudicator
// service (apps/adjudicator) running on the world's SimChain through its settlement adapter, with fake judges
// (no models, no keys) drawn from config/judges.yaml's pinned placeholder registry.
import {
  canonicalKeccak,
  parseAdjudicator,
  parseJudgment,
  type AdjudicatorPolicy,
  type AdjudicatorRegistration,
  type Address,
  type Base64Url,
  type DecisionOutcome,
  type Hex32,
  type Judgment,
} from '@holdback/core';
import { Adjudicator, defaultPolicy, loadRegistryFile, policyHashOf, SettlementAdapter } from '@holdback/adjudicator';
import { fakeProvider, type FakeScript, type JudgeProvider, type JudgeRequest, type LoadedRegistry } from '@holdback/judgment';
import { join } from 'node:path';
import { keccak256, stringToBytes } from 'viem';
import { BENCH_A, BENCH_B, BENCH_C, PROFILES, SWIFTLINE, type BenchProfile } from './cast.js';
import type { AgentKeys } from './keys.js';

const BENCHES = [BENCH_A, BENCH_B, BENCH_C];
import { DOMAIN, REPO_ROOT, TUSD, type DemoWorld } from './world.js';

export const REGISTRY_FILE = join(REPO_ROOT, 'config/judges.yaml');
export const REGISTRY_URI = 'file:///config/judges.yaml';

/**
 * Live judges (`pnpm demo --live`): while set, every bench seats this registry and calls this provider
 * (already routed and timeout-wrapped), and per-beat fake scripts are ignored. Unset, the demo is scripted.
 */
let liveJudging: { registry: LoadedRegistry; registryUri: string; provider: JudgeProvider } | undefined;
export function useLiveJudges(live: { registry: LoadedRegistry; registryUri: string; provider: JudgeProvider } | undefined): void {
  liveJudging = live;
}
export const liveJudgesInUse = (): boolean => liveJudging !== undefined;
const registryUri = () => liveJudging?.registryUri ?? REGISTRY_URI;

export interface JudgeReport {
  commitmentId: Hex32;
  outcome: DecisionOutcome;
  /** The signed judgment record the bench published: checks, screen, panel and aggregate. */
  record: Judgment;
  /** Judge requests this decision made (empty when no panel sat). */
  requests: JudgeRequest[];
  /** Adjudicators submit to the settlement layer themselves. */
  via: 'direct';
  /** Wall-clock marks of the run that decided; seams other than ServiceBench may omit them. */
  timing?: JudgingTime;
}

/**
 * Wall-clock marks (performance.now()) of one judging run: the service run from reading the delivery to its
 * submitted decision, and the span from the first judge call to the last verdict when a panel sat.
 */
export interface JudgingTime {
  startedAt: number;
  /** When the service had fetched the delivery's ciphertext (decryption, checks and screen follow). */
  fetchedAt?: number;
  panel?: { startedAt: number; endedAt: number };
  /** When the service published the signed judgment record (its decision is submitted next). */
  publishedAt?: number;
  endedAt: number;
}

const judgingTimes = new Map<Hex32, JudgingTime>();

/**
 * Takes (reads and forgets) the last judging run's marks for a commitment, for the demo's timeline.
 * Kept here because JobResult does not carry the JudgeReport.
 */
export function takeJudgingTime(commitmentId: Hex32): JudgingTime | undefined {
  const t = judgingTimes.get(commitmentId);
  judgingTimes.delete(commitmentId);
  return t;
}

/** Forgets every mark; the demo source calls it before each run, so marks never outlive their world. */
export function clearJudgingTimes(): void {
  judgingTimes.clear();
}

export interface AdjudicatorSeam {
  readonly name: string;
  readonly keys: { address: Address; encryptionPublicKey: Base64Url };
  readonly policy: AdjudicatorPolicy;
  readonly policyHash: Hex32;
  readonly registryHash: Hex32;
  /** Accepts open offers that name it as primary; returns the commitments it accepted. */
  acceptOffers(): Promise<Hex32[]>;
  /** Decides the commitment if it is this bench's turn, and returns the published record. */
  judge(commitmentId: Hex32): Promise<JudgeReport>;
}

/** Bond pool terms the benches publish (adjudicator.schema.json); backers arrive in a later phase. */
export const POOL_TERMS = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10000, noticePeriodSec: 691200 } as const;

/**
 * A published registration as a reader finds it: the document the bench posted, untrusted and not
 * yet validated, with the bond pool replaced by what SimChain holds now, and the profile posted beside it.
 */
export interface Listing {
  address: Address;
  document: Record<string, unknown>;
  profile?: BenchProfile;
}

/** Registrations and judgment records, off the settlement layer, shared by the world's benches. */
export class BenchDirectory {
  readonly registrations = new Map<string, AdjudicatorRegistration>();
  readonly records = new Map<Hex32, Judgment>();
  /** Everything posted, valid or not, in posting order: what agents read when they choose adjudicators. */
  private readonly posted = new Map<string, { document: Record<string, unknown>; profile?: BenchProfile }>();
  readonly adapter: SettlementAdapter;
  /** performance.now() at the last ciphertext fetch and record publication through this directory. */
  readonly marks: { fetchedAt?: number; publishedAt?: number } = {};

  constructor(readonly world: DemoWorld) {
    this.adapter = new SettlementAdapter({
      chain: world.chain,
      store: {
        ciphertext: async (uri) => {
          const id = uri.replace(/^mem:\/\/ciphertext\//, '');
          const bytes = await world.store.get(id as `sha256:${string}`);
          this.marks.fetchedAt = performance.now();
          return bytes;
        },
        publishRecord: async (record) => {
          const parsed = parseJudgment(record);
          if (!parsed.ok) throw new Error(`judgment record: ${parsed.error.detail}`);
          this.records.set(record.recordHash, record);
          this.marks.publishedAt = performance.now();
          return `mem://records/${record.recordHash}`;
        },
      },
      registration: async (a) => this.registration(a),
    });
  }

  /** A full adjudicator.schema.json registration, with the bond pool as SimChain holds it now. */
  registration(address: Address): AdjudicatorRegistration | null {
    const base = this.registrations.get(address.toLowerCase());
    if (!base) return null;
    const p = this.world.chain.pool(address);
    const amount = (v: bigint) => ({ token: 'tUSD', amount: v.toString() }) as AdjudicatorRegistration['fee']['min'];
    return { ...base, pool: { junior: amount(p.junior), senior: amount(p.senior), reserved: amount(p.reserved), terms: { ...POOL_TERMS } } };
  }

  register(r: AdjudicatorRegistration, profile?: BenchProfile): void {
    const parsed = parseAdjudicator(r);
    if (!parsed.ok) throw new Error(`registration for ${r.name}: ${parsed.error.detail}`);
    this.registrations.set(r.address.toLowerCase(), r);
    this.publish(r as unknown as Record<string, unknown> & { address: Address }, profile);
  }

  /** Posts a document as-is. Anyone can post; readers validate (the directory is a bulletin board, not a gate). */
  publish(document: Record<string, unknown> & { address: Address }, profile?: BenchProfile): void {
    this.posted.set(document.address.toLowerCase(), { document, ...(profile ? { profile } : {}) });
  }

  /** Every posted registration, with its pool as SimChain holds it now. */
  listings(): Listing[] {
    const amount = (v: bigint) => ({ token: 'tUSD', amount: v.toString() });
    return [...this.posted.values()].map(({ document, profile }) => {
      // Lower case, as registrations write addresses, whatever case the poster used.
      const address = (document.address as string).toLowerCase() as Address;
      const p = this.world.chain.pool(address);
      const pool = { junior: amount(p.junior), senior: amount(p.senior), reserved: amount(p.reserved), terms: { ...POOL_TERMS } };
      return { address, document: { ...document, pool }, ...(profile ? { profile } : {}) };
    });
  }
}

/** Swiftline's minimum fee on this job: 1.0% of a 2,000 tUSD price (the registration carries an amount, not a rate). */
export const SWIFTLINE_FEE = 20n * TUSD;

/**
 * Posts Swiftline Verdicts' registration: one judge from one family. It declares the panel it actually runs,
 * so it does not validate against adjudicator.schema.json (v0.6 floors: panelSize 3, minFamilies 2); the
 * agents see that and the rulebook reasons when they read it. Swiftline never runs a service in the demo.
 */
export function publishSwiftline(directory: BenchDirectory, keys: AgentKeys): void {
  const policy = defaultPolicy(`${SWIFTLINE.label}/p1`, {
    panelSize: 1,
    appealPanelSize: 1,
    minFamilies: 1,
    minFamiliesAppeal: 1,
    minValid: 1,
    minValidAppeal: 1,
    acceptSupermajority: { numerator: 1, denominator: 1 },
    rejectSupermajority: { numerator: 1, denominator: 1 },
  });
  directory.publish(
    {
      address: keys.address.toLowerCase() as Address,
      name: SWIFTLINE.name,
      encryptionPublicKey: keys.encryptionPublicKey,
      affiliations: [],
      policy,
      registry: { hash: demoRegistry().hash, uri: registryUri() },
      policyHash: policyHashOf(policy),
      fee: { min: { token: 'tUSD', amount: SWIFTLINE_FEE.toString() } },
      status: 'active',
      poolTermsHash: canonicalKeccak(POOL_TERMS),
    },
    PROFILES[SWIFTLINE.label],
  );
}

let registryCache: LoadedRegistry | undefined;
export function demoRegistry(): LoadedRegistry {
  if (liveJudging) return liveJudging.registry;
  if (!registryCache) {
    const r = loadRegistryFile(REGISTRY_FILE);
    if (!r.ok) throw new Error(`config/judges.yaml: ${r.error.detail}`);
    registryCache = r.value;
  }
  return registryCache;
}

export class ServiceBench implements AdjudicatorSeam {
  readonly service: Adjudicator;
  readonly policy: AdjudicatorPolicy;
  readonly policyHash: Hex32;
  readonly registryHash: Hex32;
  readonly requests: JudgeRequest[] = [];
  /** performance.now() at each judge call and its answer, in call order. */
  private readonly calls: { startedAt: number; endedAt?: number }[] = [];

  constructor(
    readonly agent: AgentKeys,
    private readonly directory: BenchDirectory,
    options: { judges?: FakeScript; provider?: JudgeProvider; trustedAdjudicators?: readonly Address[] } = {},
  ) {
    const registry = demoRegistry();
    this.policy = defaultPolicy(`${agent.name}/p1`);
    this.policyHash = policyHashOf(this.policy);
    this.registryHash = registry.hash;
    const inner = liveJudging?.provider ?? options.provider ?? fakeProvider(options.judges ?? {});
    this.service = new Adjudicator({
      address: agent.address,
      // The registration carries the display name (cast.ts); the policy ID keeps the label.
      name: BENCHES.find((b) => b.label === agent.name)?.name ?? agent.name,
      signingKey: agent.signingKey,
      encryptionSecretKey: agent.encryption.secretKey,
      // Derived from the context seed like every demo key; it fixes the primary's commit-reveal seeds.
      seedSecret: keccak256(stringToBytes(`${agent.signingKey}/seed-secret`)),
      policy: this.policy,
      registry,
      registryUri: registryUri(),
      fee: { min: { token: 'tUSD', amount: (50n * TUSD).toString() } as AdjudicatorRegistration['fee']['min'] },
      domain: DOMAIN,
      provider: {
        complete: async (r) => {
          const call: { startedAt: number; endedAt?: number } = { startedAt: performance.now() };
          this.requests.push(r);
          this.calls.push(call);
          try {
            return await inner.complete(r);
          } finally {
            call.endedAt = performance.now();
          }
        },
      },
      settlement: directory.adapter,
      ...(options.trustedAdjudicators ? { trustedAdjudicators: options.trustedAdjudicators } : {}),
    });
    directory.register({
      ...this.service.registration(),
      pool: { junior: { token: 'tUSD', amount: '0' }, senior: { token: 'tUSD', amount: '0' }, reserved: { token: 'tUSD', amount: '0' }, terms: { ...POOL_TERMS } },
      poolTermsHash: canonicalKeccak(POOL_TERMS),
      status: 'active',
    } as AdjudicatorRegistration, PROFILES[agent.name]);
  }

  /** Display name, e.g. Clearfield Adjudication. */
  get name(): string {
    return BENCHES.find((b) => b.label === this.agent.name)?.name ?? this.agent.name;
  }

  get keys() {
    return this.agent;
  }

  async acceptOffers(): Promise<Hex32[]> {
    const r = await this.service.runOnce();
    if (r.declined.length) throw new Error(`${this.name} declined: ${r.declined.map((d) => d.reason).join('; ')}`);
    return r.accepted;
  }

  async judge(commitmentId: Hex32): Promise<JudgeReport> {
    const before = this.requests.length;
    const startedAt = performance.now();
    const r = await this.service.runOnce();
    const endedAt = performance.now();
    const calls = this.calls.slice(before);
    // Marks from this run only: the directory is shared by the world's benches.
    const within = (m: number | undefined) => (m !== undefined && m >= startedAt && m <= endedAt ? m : undefined);
    const fetchedAt = within(this.directory.marks.fetchedAt);
    const publishedAt = within(this.directory.marks.publishedAt);
    const timing: JudgingTime = {
      startedAt,
      ...(fetchedAt === undefined ? {} : { fetchedAt }),
      ...(calls.length ? { panel: { startedAt: Math.min(...calls.map((c) => c.startedAt)), endedAt: Math.max(...calls.map((c) => c.endedAt ?? endedAt)) } } : {}),
      ...(publishedAt === undefined ? {} : { publishedAt }),
      endedAt,
    };
    const refused = r.refused.find((x) => x.commitmentId === commitmentId);
    if (refused) throw new Error(`${this.name} refused ${commitmentId}: ${refused.problem.type}: ${refused.problem.detail}`);
    const decided = r.decided.find((x) => x.commitmentId === commitmentId);
    if (!decided) throw new Error(`${this.name} had nothing to decide for ${commitmentId}`);
    const record = [...this.directory.records.values()].filter((x) => x.commitmentId === commitmentId && x.adjudicator.toLowerCase() === this.agent.address.toLowerCase()).at(-1);
    if (!record) throw new Error(`${this.name} decided ${commitmentId} without publishing a record`);
    judgingTimes.set(commitmentId, timing);
    return { commitmentId, outcome: decided.outcome, record, requests: this.requests.slice(before), via: 'direct', timing };
  }
}
