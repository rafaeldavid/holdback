// The adjudicator service (T-009): accepts offers with a seed commitment, watches for cases it must
// decide, opens the work with the key it is entitled to, runs the judgment pipeline on a panel drawn
// from the seed for its role, publishes a signed judgment record and signs the Decision.
//
// - Primary: seed = keccak256(seedSecret || commitmentId), committed at acceptance, revealed in the Decision.
// - Fallback and appeal: seed = panelSeed(id, role, attempt, beacon value at the round settlement state
//   fixes (ADR-0018)); the key comes only from an envelope released on takeover (ADR-0020).
// - No re-roll: a decision, once computed, is kept and resubmitted unchanged; the judges are never
//   asked again for the same (commitment, role, attempt).
import {
  canonicalKeccak,
  err,
  ok,
  problem,
  signMessage,
  type AdjudicatorAcceptance,
  type AdjudicatorPolicy,
  type AdjudicatorRegistration,
  type Address,
  type Decision,
  type DecisionOutcome,
  type EncryptedKey,
  type Hex32,
  type HoldbackDomain,
  type Judgment,
  type Problem,
  type Result,
  type TokenAmount,
} from '@holdback/core';
import { ContentKey, encodePublicKey, encryptionKeyPairFromSecretKey, open as openContent, unwrapKey, wrapKey, wrapKeyForRecipients } from '@holdback/core/crypto';
import { intake, panelPlan, runPipeline, type IntakeError, type JudgeProvider, type JudgmentDraft, type LoadedRegistry } from '@holdback/judgment';
import { concat, keccak256, stringToBytes, toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { checkPolicyBinding, policyHashOf } from './policy.js';
import { panelSeed, roundFor } from './randomness.js';
import type { AdjudicatorSettlement, DecisionTask } from './settlement-port.js';

export interface AdjudicatorConfig {
  address: Address;
  name: string;
  /** From the environment only (HOLDBACK_ADJUDICATOR_KEY). */
  signingKey: Hex;
  /** x25519 secret key for envelopes, from the environment only. */
  encryptionSecretKey: Uint8Array;
  /** 32 bytes from the environment; the primary's seeds are derived from it, so they survive restarts. */
  seedSecret: Hex32;
  policy: AdjudicatorPolicy;
  registry: LoadedRegistry;
  registryUri: string;
  fee: { min: TokenAmount };
  domain: HoldbackDomain;
  /** Already routed by provider and wrapped with the judge timeout. */
  provider: JudgeProvider;
  settlement: AdjudicatorSettlement;
  affiliations?: string[];
}

export interface RunReport {
  accepted: Hex32[];
  declined: Array<{ commitmentId: Hex32; reason: string }>;
  triggered: Hex32[];
  decided: Array<{ commitmentId: Hex32; role: DecisionTask['role']; outcome: DecisionOutcome }>;
  /** Judged, record published, but no Decision: the appeal panel was inconclusive after an escalation. */
  undecided: Hex32[];
  refused: Array<{ commitmentId: Hex32; problem: Problem }>;
}

type Outcome = { decision: Decision; record: Judgment } | { decision: null; record: Judgment };

/** keccak256 of the RFC 8785 JSON of the record without recordHash, signature and recordUri. */
export function recordHashOf(record: Omit<Judgment, 'recordHash' | 'signature'> & Partial<Judgment>): Hex32 {
  const body: Partial<Judgment> = { ...record };
  delete body.recordHash;
  delete body.signature;
  delete body.recordUri;
  return canonicalKeccak(body);
}

const ZERO_SCORE_REASON = (code: string) => `intake refused the delivery: ${code}`;

export class Adjudicator {
  readonly policy: AdjudicatorPolicy;
  readonly address: Address;
  readonly #cfg: AdjudicatorConfig;
  readonly #account;
  /** Computed decisions by commitment|role|attempt: resubmitted unchanged, never recomputed. */
  readonly #done = new Map<string, Outcome>();

  constructor(cfg: AdjudicatorConfig) {
    this.#cfg = cfg;
    this.policy = cfg.policy;
    this.address = cfg.address.toLowerCase() as Address;
    this.#account = privateKeyToAccount(cfg.signingKey);
    if (this.#account.address.toLowerCase() !== this.address) throw new Error('signing key does not match the adjudicator address');
  }

  /** The fields of adjudicator.schema.json this service publishes (pool and status come from settlement). */
  registration(): Omit<AdjudicatorRegistration, 'pool' | 'poolTermsHash' | 'status'> {
    return {
      address: this.address,
      name: this.#cfg.name,
      encryptionPublicKey: encodePublicKey(encryptionKeyPairFromSecretKey(this.#cfg.encryptionSecretKey).publicKey),
      affiliations: this.#cfg.affiliations ?? [],
      policy: this.policy,
      registry: { hash: this.#cfg.registry.hash, uri: this.#cfg.registryUri },
      policyHash: policyHashOf(this.policy),
      fee: this.#cfg.fee,
    };
  }

  /** Fee quote stub: the policy minimum (fee from calibration metrics is Phase 3). */
  quote(): TokenAmount {
    return this.#cfg.fee.min;
  }

  /** The primary's commit-reveal seed for a commitment: fixed, and recoverable after a restart. */
  seedFor(commitmentId: Hex32): Hex32 {
    return keccak256(concat([toBytes(this.#cfg.seedSecret), stringToBytes('holdback.primary-seed.v1'), toBytes(commitmentId)]));
  }

  async runOnce(): Promise<RunReport> {
    const port = this.#cfg.settlement;
    const report: RunReport = { accepted: [], declined: [], triggered: [], decided: [], undecided: [], refused: [] };
    for (const offer of await port.offers(this.address)) {
      const r = await this.#accept(offer.commitment);
      if (r.ok) report.accepted.push(offer.commitment.id);
      else report.declined.push({ commitmentId: offer.commitment.id, reason: r.error.detail });
    }
    for (const id of await port.takeoversDue(this.address)) {
      if ((await port.triggerFallback(id)).ok) report.triggered.push(id);
    }
    for (const task of await port.tasks(this.address)) {
      const r = await this.decideTask(task);
      if (!r.ok) {
        report.refused.push({ commitmentId: task.commitment.id, problem: r.error });
        continue;
      }
      if (!r.value.decision) {
        report.undecided.push(task.commitment.id);
        continue;
      }
      const sent = await port.submit(r.value.decision);
      if (sent.ok) report.decided.push({ commitmentId: task.commitment.id, role: task.role, outcome: r.value.decision.outcome });
      else report.refused.push({ commitmentId: task.commitment.id, problem: sent.error });
    }
    return report;
  }

  async #accept(c: DecisionTask['commitment']): Promise<Result<AdjudicatorAcceptance, Problem>> {
    const { adjudication } = c;
    if (adjudication.adjudicator.toLowerCase() !== this.address) return err(problem('not_your_turn', 'not the primary adjudicator'));
    if (adjudication.policyHash !== policyHashOf(this.policy)) return err(problem('policy_mismatch', 'policy-hash-mismatch: the offer binds another policy'));
    if (adjudication.registryHash !== this.#cfg.registry.hash) return err(problem('registry_mismatch', 'the offer binds another registry'));
    const min = this.quote();
    if (adjudication.fee.token !== min.token || BigInt(adjudication.fee.amount) < BigInt(min.amount)) return err(problem('invalid_terms', `fee is below the quote ${min.amount} ${min.token}`));
    const unsigned: Omit<AdjudicatorAcceptance, 'signature'> = {
      type: 'AdjudicatorAcceptance',
      commitmentId: c.id,
      adjudicator: this.address,
      seedCommitment: keccak256(this.seedFor(c.id)),
      policyHash: adjudication.policyHash,
      registryHash: adjudication.registryHash,
      fee: adjudication.fee,
      bondReserved: c.price,
      nonce: keccak256(concat([toBytes(c.id), stringToBytes('holdback.acceptance-nonce.v1')])),
      expiresAt: c.timing.offerExpiresAt,
    };
    const msg = { ...unsigned, signature: await signMessage(this.#cfg.signingKey, this.#cfg.domain, unsigned) };
    const sent = await this.#cfg.settlement.submit(msg);
    return sent.ok ? ok(msg) : err(sent.error);
  }

  /** The policy the commitment binds: this adjudicator's own, or the primary's published one. */
  async #boundPolicy(task: DecisionTask): Promise<Result<AdjudicatorPolicy, Problem>> {
    const bound = task.commitment.adjudication.policyHash;
    let policy = this.policy;
    if (policyHashOf(policy) !== bound) {
      const primary = await this.#cfg.settlement.registration(task.commitment.adjudication.adjudicator);
      if (primary) policy = primary.policy;
    }
    const check = checkPolicyBinding(policy, bound);
    return check.ok ? ok(policy) : err(check.error);
  }

  /** Judges one task and signs its Decision (or returns the refusal). Idempotent per (commitment, role, attempt). */
  async decideTask(task: DecisionTask): Promise<Result<Outcome, Problem>> {
    const key = `${task.commitment.id}|${task.role}|${task.attempt}`;
    const done = this.#done.get(key);
    if (done) return ok(done);
    const r = await this.#decide(task);
    if (r.ok) this.#done.set(key, r.value);
    return r;
  }

  async #decide(task: DecisionTask): Promise<Result<Outcome, Problem>> {
    const { commitment, role, attempt } = task;
    const id = commitment.id;
    const policyR = await this.#boundPolicy(task);
    if (!policyR.ok) return policyR;
    const policy = policyR.value;
    if (this.#cfg.registry.hash !== commitment.adjudication.registryHash) {
      return err(problem('registry_mismatch', `this adjudicator's registry hashes to ${this.#cfg.registry.hash}; the commitment binds ${commitment.adjudication.registryHash}`));
    }

    // The key this adjudicator may use (ADR-0020).
    const envelope: EncryptedKey | undefined =
      role === 'primary' ? task.delivery.encryptedKeys.find((k) => k.recipient.toLowerCase() === this.address) : task.releasedKey;
    if (!envelope || envelope.recipient.toLowerCase() !== this.address) {
      return err(problem('invalid_state', role === 'primary' ? 'no envelope for this adjudicator in the delivery' : `no key released to the ${role} adjudicator; it does not read the work before takeover`));
    }

    // The seed for the role (ADR-0018).
    let seed: Hex32;
    let beacon: Decision['beacon'];
    if (role === 'primary') seed = this.seedFor(id);
    else {
      const fixedAt = task.roundFixedAt ?? (role === 'fallback' ? commitment.timing.judgeBy : undefined);
      if (!fixedAt) return err(problem('seed_mismatch', 'no settlement time fixes the beacon round for this appeal'));
      const round = roundFor(role, fixedAt);
      const value = await this.#cfg.settlement.randomness.value(round);
      if (!value) return err(problem('seed_mismatch', `beacon round ${round} is not published yet; waiting (no substitute source)`));
      seed = panelSeed(id, role, attempt, value);
      beacon = { source: this.#cfg.settlement.randomness.kind, round, value };
    }

    let contentKey: ContentKey | undefined;
    const ciphertext = await this.#cfg.settlement.ciphertext(task.delivery.ciphertext.uri);
    const intaken = await intake({
      delivery: { ...task.delivery, encryptedKeys: [envelope] },
      ciphertext,
      recipient: this.address,
      format: commitment.deliverable.format,
      unwrapKey: async (env) => {
        contentKey = unwrapKey(env, this.#cfg.encryptionSecretKey);
        return contentKey.exportBytes();
      },
      open: (ct, k) => openContent(ct, ContentKey.fromBytes(k), task.delivery.plaintextSha256),
    });

    const appeal = role === 'appeal';
    const seedFields = role === 'primary' ? { seedSource: 'commit-reveal' as const, seedCommitment: keccak256(seed) } : { seedSource: 'beacon' as const, beaconRound: beacon!.round };
    const panelBase = { policyId: policy.id, policyHash: commitment.adjudication.policyHash, ...seedFields, seed };

    let draft: Pick<JudgmentDraft, 'intake' | 'deterministic' | 'screen' | 'panel' | 'aggregate'>;
    if (!intaken.ok) {
      const mapped = mapIntakeError(intaken.error, role);
      if (!mapped.ok) return mapped;
      draft = {
        intake: { plaintextHashVerified: false, mime: task.delivery.plaintextMime, bytes: 0, normalized: false },
        deterministic: [],
        screen: { flagged: false, signals: [] },
        panel: { ran: false, members: [] },
        aggregate: { decision: mapped.value, weightedScore: null, reasons: [ZERO_SCORE_REASON(intaken.error.code)] },
      };
    } else if (appeal && task.appealGround === 'missing-or-wrong-key' && task.firstOutcome === 'accept') {
      // The ground is the key, not the work: re-release the key to the buyer under the bonded decision.
      draft = {
        intake: intaken.value.record,
        deterministic: [],
        screen: { flagged: false, signals: [] },
        panel: { ran: false, members: [] },
        aggregate: { decision: 'accept', weightedScore: null, reasons: ['appeal ground missing-or-wrong-key: the content key is released to the buyer with this decision'] },
      };
    } else {
      const size = appeal ? policy.appealPanelSize : policy.panelSize;
      const familiesAvailable = new Set(this.#cfg.registry.active.map((e) => e.family)).size;
      // Appeal: minFamiliesAppeal where the registry has them, else the first-instance minimum.
      const minFamilies = appeal ? Math.max(policy.minFamilies, Math.min(policy.minFamiliesAppeal, familiesAvailable)) : policy.minFamilies;
      const plan = panelPlan({ registry: this.#cfg.registry, seed, commitmentId: id, size, minFamilies, criteria: commitment.acceptance.rubric.criteria });
      if (!plan.ok) return err(problem('invalid_terms', `panel: ${plan.error}`));
      const run = await runPipeline({
        intake: intaken.value,
        acceptance: commitment.acceptance,
        deliverable: { description: commitment.deliverable.description, format: commitment.deliverable.format },
        policy: {
          minValid: appeal ? policy.minValidAppeal : policy.minValid,
          minFamilies,
          rationaleMaxChars: policy.rationaleMaxChars,
          acceptSupermajority: policy.acceptSupermajority,
          rejectSupermajority: policy.rejectSupermajority,
        },
        seats: plan.value.seats,
        registry: plan.value.registry,
        provider: this.#cfg.provider,
        nonces: plan.value.nonces,
        criteriaFor: plan.value.criteriaFor,
        sampleSeed: plan.value.sampleSeed,
        template: appeal ? 'appeal' : 'first-instance',
      });
      if (!run.ok) return run;
      draft = run.value;
    }

    // Map the panel's decision onto what the role may sign.
    let outcome: DecisionOutcome | null = draft.aggregate.decision;
    if (appeal && outcome === 'escalate') outcome = task.firstOutcome ?? null; // party appeal: first decision stands; after escalation: no decision
    const record = await this.#record(task, { ...draft, panel: { ...panelBase, ran: draft.panel.ran, members: draft.panel.members } });
    await this.#cfg.settlement.publishRecord(record);
    if (outcome === null) return ok({ decision: null, record });

    const unsigned: Omit<Decision, 'signature'> = {
      type: 'Decision',
      commitmentId: id,
      attempt,
      adjudicator: this.address,
      role,
      outcome,
      seed,
      policyHash: commitment.adjudication.policyHash,
      registryHash: commitment.adjudication.registryHash,
      judgmentRecordHash: record.recordHash,
      nonce: keccak256(concat([toBytes(id), stringToBytes(`holdback.decision-nonce.v1:${role}:${attempt}`)])),
      expiresAt: task.deadline,
      ...(beacon ? { beacon } : {}),
      ...(appeal && task.appealGround ? { appealGround: task.appealGround } : {}),
    };
    if (outcome === 'accept' && contentKey) unsigned.keyForBuyer = wrapKey(contentKey, commitment.buyerEncryptionPublicKey);
    if (outcome === 'escalate') {
      const next = await this.#cfg.settlement.registration(commitment.adjudication.appealAdjudicator);
      if (!next || !contentKey) return err(problem('adjudicator_unavailable', 'cannot wrap the content key for the appeal adjudicator'));
      unsigned.encryptedKeys = wrapKeyForRecipients(contentKey, [{ recipient: commitment.adjudication.appealAdjudicator, publicKey: next.encryptionPublicKey }]);
    }
    const decision: Decision = { ...unsigned, signature: await signMessage(this.#cfg.signingKey, this.#cfg.domain, unsigned) };
    return ok({ decision, record });
  }

  async #record(task: DecisionTask, draft: Pick<Judgment, 'intake' | 'deterministic' | 'screen' | 'panel' | 'aggregate'>): Promise<Judgment> {
    const { weightedScore, ...agg } = draft.aggregate;
    const body = {
      commitmentId: task.commitment.id,
      attempt: task.attempt,
      adjudicator: this.address,
      role: task.role,
      intake: draft.intake,
      deterministic: draft.deterministic,
      screen: draft.screen,
      panel: draft.panel,
      aggregate: { ...agg, ...(weightedScore !== undefined ? { weightedScore } : {}) },
      decidedAt: this.#cfg.settlement.now(),
    };
    const recordHash = recordHashOf(body);
    const signature = await this.#account.signMessage({ message: { raw: recordHash } });
    return { ...body, recordHash, signature };
  }
}

/**
 * Intake failures (T-008 Handoff). The seller's faults reject (or, for a key the primary cannot open,
 * escalate so the appeal adjudicator checks its own envelope); a ciphertext that does not match the
 * delivery hash is the store's fault and is retried, never decided.
 */
export function mapIntakeError(e: IntakeError, role: DecisionTask['role']): Result<DecisionOutcome, Problem> {
  switch (e.code) {
    case 'ciphertext_hash_mismatch':
      return err(problem('invalid_state', 'the stored ciphertext does not match the delivery; retrying later'));
    case 'no_key_for_recipient':
    case 'key_unwrap_failed':
      return role === 'appeal' ? err(problem('invalid_state', `appeal adjudicator cannot open its key (${e.code})`)) : ok('escalate');
    default:
      return ok('reject');
  }
}
