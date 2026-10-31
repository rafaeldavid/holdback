// The adjudicators as the demo agents see them. The parties name a primary, fallback and appeal adjudicator
// in the terms; the primary finds the offer on the settlement layer and accepts it with a seed commitment, and
// after delivery it decides. `AdjudicatorSeam` is that narrow interface; `ServiceBench` is T-009's adjudicator
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
import { BENCH_A, BENCH_B, BENCH_C } from './cast.js';
import type { AgentKeys } from './keys.js';

const BENCHES = [BENCH_A, BENCH_B, BENCH_C];
import { DOMAIN, REPO_ROOT, TUSD, type DemoWorld } from './world.js';

export const REGISTRY_FILE = join(REPO_ROOT, 'config/judges.yaml');
export const REGISTRY_URI = 'file:///config/judges.yaml';

export interface JudgeReport {
  commitmentId: Hex32;
  outcome: DecisionOutcome;
  /** The signed judgment record the bench published: checks, screen, panel and aggregate. */
  record: Judgment;
  /** Judge requests this decision made (empty when no panel sat). */
  requests: JudgeRequest[];
  /** Adjudicators submit to the settlement layer themselves. */
  via: 'direct';
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

/** Registrations and judgment records, off the settlement layer, shared by the world's benches. */
export class BenchDirectory {
  readonly registrations = new Map<string, AdjudicatorRegistration>();
  readonly records = new Map<Hex32, Judgment>();
  readonly adapter: SettlementAdapter;

  constructor(readonly world: DemoWorld) {
    this.adapter = new SettlementAdapter({
      chain: world.chain,
      store: {
        ciphertext: async (uri) => {
          const id = uri.replace(/^mem:\/\/ciphertext\//, '');
          return world.store.get(id as `sha256:${string}`);
        },
        publishRecord: async (record) => {
          const parsed = parseJudgment(record);
          if (!parsed.ok) throw new Error(`judgment record: ${parsed.error.detail}`);
          this.records.set(record.recordHash, record);
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

  register(r: AdjudicatorRegistration): void {
    const parsed = parseAdjudicator(r);
    if (!parsed.ok) throw new Error(`registration for ${r.name}: ${parsed.error.detail}`);
    this.registrations.set(r.address.toLowerCase(), r);
  }
}

let registryCache: LoadedRegistry | undefined;
export function demoRegistry(): LoadedRegistry {
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

  constructor(
    readonly agent: AgentKeys,
    private readonly directory: BenchDirectory,
    options: { judges?: FakeScript; provider?: JudgeProvider } = {},
  ) {
    const registry = demoRegistry();
    this.policy = defaultPolicy(`${agent.name}/p1`);
    this.policyHash = policyHashOf(this.policy);
    this.registryHash = registry.hash;
    const inner = options.provider ?? fakeProvider(options.judges ?? {});
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
      registryUri: REGISTRY_URI,
      fee: { min: { token: 'tUSD', amount: (50n * TUSD).toString() } as AdjudicatorRegistration['fee']['min'] },
      domain: DOMAIN,
      provider: { complete: (r) => (this.requests.push(r), inner.complete(r)) },
      settlement: directory.adapter,
    });
    directory.register({
      ...this.service.registration(),
      pool: { junior: { token: 'tUSD', amount: '0' }, senior: { token: 'tUSD', amount: '0' }, reserved: { token: 'tUSD', amount: '0' }, terms: { ...POOL_TERMS } },
      poolTermsHash: canonicalKeccak(POOL_TERMS),
      status: 'active',
    } as AdjudicatorRegistration);
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
    const r = await this.service.runOnce();
    const refused = r.refused.find((x) => x.commitmentId === commitmentId);
    if (refused) throw new Error(`${this.name} refused ${commitmentId}: ${refused.problem.type}: ${refused.problem.detail}`);
    const decided = r.decided.find((x) => x.commitmentId === commitmentId);
    if (!decided) throw new Error(`${this.name} had nothing to decide for ${commitmentId}`);
    const record = [...this.directory.records.values()].filter((x) => x.commitmentId === commitmentId && x.adjudicator.toLowerCase() === this.agent.address.toLowerCase()).at(-1);
    if (!record) throw new Error(`${this.name} decided ${commitmentId} without publishing a record`);
    return { commitmentId, outcome: decided.outcome, record, requests: this.requests.slice(before), via: 'direct' };
  }
}
