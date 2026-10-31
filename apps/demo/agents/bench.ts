// SEAM (T-009): the adjudicator as the demo agents see it. The parties name it in the terms and send it the
// signed offer; it signs an acceptance and, after delivery, a decision. T-009's adjudicator service (PR 37,
// apps/adjudicator) replaces StandInBench behind this interface; nothing else in apps/demo/agents changes.
//
// StandInBench is a stand-in, not the defended pipeline. It opens its envelope, runs the terms' declarative
// checks with @holdback/judgment's registry on the raw text, and then:
//   - any required check failed: reject;
//   - every required check passed and the rubric is empty: accept (no panel sits, as in the real pipeline);
//   - every required check passed and the rubric has criteria: accept WITHOUT a panel, and say so in the
//     report (`panel: 'not run (stand-in for T-009)'`). Honest parties only until the basic demo works.
// It never re-rolls anything and reads the deliverable only as data.
import {
  canonicalKeccak,
  signMessage,
  type AdjudicatorAcceptance,
  type Commitment,
  type Decision,
  type DecisionOutcome,
  type Hex32,
  type Timestamp,
} from '@holdback/core';
import { open, unwrapKeyFor, wrapKey, type RandomSource } from '@holdback/core/crypto';
import type { CiphertextStore } from '@holdback/core/store';
import { runChecks, UntrustedData, type CheckOutcome } from '@holdback/judgment';
import type { Holdback } from '@holdback/sdk';
import type { Rng } from '@holdback/testkit';
import { keccak256 } from 'viem';
import type { AgentKeys } from './keys.js';
import { deliveryFacts, DOMAIN, type DemoWorld } from './world.js';

export interface JudgeReport {
  commitmentId: Hex32;
  outcome: DecisionOutcome;
  checks: CheckOutcome[];
  /** What decided beyond the checks. */
  panel: 'none (empty rubric)' | 'not run (stand-in for T-009)' | 'not reached (a required check failed)';
  decision: Decision;
  /** The operator URL that relayed the decision, or 'direct'. */
  via: string;
}

export interface AdjudicatorSeam {
  readonly keys: AgentKeys;
  readonly policyHash: Hex32;
  readonly registryHash: Hex32;
  /** Signs an acceptance of an offer that names this bench as primary. The settlement layer checks the bond. */
  accept(commitment: Commitment): Promise<AdjudicatorAcceptance>;
  /** Judges the latest delivery of an accepted commitment and submits the signed decision. */
  judge(commitmentId: Hex32): Promise<JudgeReport>;
}

/** The stand-in's policy object; its hash binds at agreement exactly as a T-009 policy hash would. */
export const STAND_IN_POLICY = { id: 'stand-in/checks-only/v0', panel: 'none', note: 'T-012 stand-in; T-009 replaces it' } as const;
export const STAND_IN_REGISTRY = { registry: 'stand-in/v0', models: [] as string[] } as const;

const plus = (ts: Timestamp, seconds: number): Timestamp => new Date(Date.parse(ts) + seconds * 1000).toISOString().replace('.000Z', 'Z');

export class StandInBench implements AdjudicatorSeam {
  readonly policyHash = canonicalKeccak(STAND_IN_POLICY);
  readonly registryHash = canonicalKeccak(STAND_IN_REGISTRY);
  private readonly accepted = new Map<Hex32, { commitment: Commitment; seed: Hex32 }>();
  private readonly hb: Holdback;
  private readonly store: CiphertextStore;
  private readonly rng: Rng;
  private readonly random: RandomSource;

  constructor(
    readonly keys: AgentKeys,
    private readonly world: DemoWorld,
  ) {
    this.hb = world.sdk();
    this.store = world.store;
    this.rng = world.ctx.rng;
    this.random = world.random;
  }

  private async sign<T extends Parameters<typeof signMessage>[2]>(m: T): Promise<T & { signature: `0x${string}` }> {
    return { ...m, signature: await signMessage(this.keys.signingKey, DOMAIN, m) };
  }

  async accept(commitment: Commitment): Promise<AdjudicatorAcceptance> {
    const { adjudication, price, timing } = commitment;
    if (adjudication.adjudicator.toLowerCase() !== this.keys.address.toLowerCase()) throw new Error(`${this.keys.name} is not the primary adjudicator of ${commitment.id}`);
    if (adjudication.policyHash !== this.policyHash || adjudication.registryHash !== this.registryHash) throw new Error(`${commitment.id} does not bind ${this.keys.name}'s policy and registry`);
    // Commit-reveal: the seed is fixed now and revealed in the decision.
    const seed = this.rng.hex32();
    this.accepted.set(commitment.id, { commitment, seed });
    return this.sign({
      type: 'AdjudicatorAcceptance',
      commitmentId: commitment.id,
      adjudicator: this.keys.address,
      seedCommitment: keccak256(seed),
      policyHash: this.policyHash,
      registryHash: this.registryHash,
      fee: adjudication.fee,
      bondReserved: price,
      nonce: this.rng.hex32(),
      expiresAt: timing.offerExpiresAt,
    } as const);
  }

  async judge(commitmentId: Hex32): Promise<JudgeReport> {
    const entry = this.accepted.get(commitmentId);
    if (!entry) throw new Error(`${this.keys.name} did not accept ${commitmentId}`);
    const { commitment, seed } = entry;
    const facts = await deliveryFacts(this.world, commitmentId);
    // ADR-0020: the primary's envelope is released at delivery.
    const envelopes = await this.world.keysFor(commitmentId, this.keys.address);
    const key = unwrapKeyFor(envelopes, this.keys.address, this.keys.encryption.secretKey);
    const plaintext = await open(await this.store.get(facts.ciphertext.sha256), key, facts.plaintextSha256);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    const run = runChecks(commitment.acceptance.deterministicChecks, { data: UntrustedData.wrap(text), mime: commitment.deliverable.format });
    const failedRequired = run.outcomes.some((c) => c.required && !c.passed) || run.inconclusive.length > 0;
    const outcome: DecisionOutcome = failedRequired ? 'reject' : 'accept';
    const panel: JudgeReport['panel'] = failedRequired
      ? 'not reached (a required check failed)'
      : commitment.acceptance.rubric.criteria.length === 0
        ? 'none (empty rubric)'
        : 'not run (stand-in for T-009)';
    const record = { commitmentId, attempt: facts.attempt, plaintextSha256: facts.plaintextSha256, checks: run.outcomes, inconclusive: run.inconclusive, panel, outcome, policy: STAND_IN_POLICY.id };
    const decision = (await this.sign({
      type: 'Decision',
      commitmentId,
      attempt: facts.attempt,
      adjudicator: this.keys.address,
      role: 'primary',
      outcome,
      seed,
      policyHash: this.policyHash,
      registryHash: this.registryHash,
      judgmentRecordHash: canonicalKeccak(record),
      nonce: this.rng.hex32(),
      expiresAt: plus(this.world.now(), 86_400),
      // Two-sided hold: an accept carries the content key sealed to the buyer's published key.
      ...(outcome === 'accept' ? { keyForBuyer: wrapKey(key, commitment.buyerEncryptionPublicKey, { random: this.random }) } : {}),
    } as const)) as Decision;
    const submitted = await this.hb.decide(decision, this.world.call());
    return { commitmentId, outcome, checks: run.outcomes, panel, decision, via: submitted.via };
  }
}
