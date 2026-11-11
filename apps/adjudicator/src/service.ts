// The adjudicator service: accepts offers with a seed commitment, watches for cases it must
// decide, opens the work with the key it is entitled to, runs the judgment pipeline on a panel drawn
// from the seed for its role, publishes a signed judgment record and signs the Decision.
//
// - Primary: seed = keccak256(seedSecret || commitmentId), committed at acceptance, revealed in the Decision.
// - Fallback and appeal: seed = panelSeed(id, role, attempt, beacon value at the round settlement state
//   fixes (ADR-0018)); the key comes only from an envelope released on takeover (ADR-0020).
// - No re-roll: a decision, once computed, is kept and resubmitted unchanged; the judges are never
//   asked again for the same (commitment, role, attempt).
// - Consent (T-211, D29): it declines an offer or a fallback turn whose appeal windows or fee are outside its terms, an
//   appeal turn below its fee, and a fallback turn its free bond cannot back or whose appeal adjudicator it does not
//   trust (T-221, ADR-0030 §6); it expires the appeals of its own
//   decisions once due, which frees its bond. The buyer's key travels only with an accept, never on a deal that
//   stands Refunded.
// - The bound policy (T-221 review): a fallback or appeal turn judges under the policy whose hash the terms bound, read
//   by that hash, never the primary's latest registration. `declines` answers from the terms alone whether it would
//   take a role, so it triggers no takeover it would decline and an operator fills it in as a default only when it would not.
import {
  canonicalKeccak,
  commitmentId,
  deliveryHash,
  err,
  isSealed,
  ok,
  problem,
  signMessage,
  termsOf,
  verifyMessage,
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
import { ContentKey, decodePublicKey, encodePublicKey, encryptionKeyPairFromSecretKey, open as openContent, unwrapKey, wrapKey, wrapKeyForRecipients } from '@holdback/core/crypto';
import { describeUnavailable, intake, loadReferences, panelPlan, runPipeline, signedOutcome, type IntakeError, type JudgeProvider, type JudgmentDraft, type LoadedRegistry } from '@holdback/judgment';
import { concat, keccak256, stringToBytes, toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { quicknetValue } from './drand.js';
import { checkPolicyBinding, policyHashOf } from './policy.js';
import { panelSeed, roundFor } from './randomness.js';
import type { AdjudicatorSettlement, DecisionTask } from './settlement-port.js';

/** The longest appeal windows this service decides under unless configured (T-211): a week each. */
export const DEFAULT_APPEAL_LIMITS: AppealLimits = { maxAppealWindowSec: 7 * 86_400, maxAppealDecideSec: 7 * 86_400 };

export interface AppealLimits {
  maxAppealWindowSec: number;
  maxAppealDecideSec: number;
}

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
  /**
   * Accept private and judgment offers without opening their sealed terms (default false: decline them, D29).
   * This service cannot open sealed terms yet (T-207), so an accepted sealed offer could never be judged and would
   * fall to its default outcome. Only a local world that exercises private flows by early accept or mutual settlement
   * (`pnpm sim`) turns it on.
   */
  acceptSealedUnread?: boolean;
  /**
   * The fallback and appeal adjudicators this service accepts an offer with (T-212). Since an overturn pays the price
   * from the first decider's bond (I-8), one actor as buyer, seller and appeal adjudicator could name this service as
   * primary, take its honest accept, file a zero-bond appeal and overturn it through its own appeal adjudicator. So an
   * offer naming any other fallback or appeal adjudicator is declined. Unset: this service trusts only itself.
   */
  trustedAdjudicators?: readonly Address[];
  /**
   * The longest appeal windows it accepts an offer or decides a takeover under (T-211, D29). A decider's bond stays
   * reserved until the appeal closes, appealWindowSec and then appealDecideSec after it decides, and the deal sets both
   * (D31). So a sham deal naming this service as fallback, with windows a century long, would lock its bond that long
   * once it decided (T-206 M-3). Unset: DEFAULT_APPEAL_LIMITS.
   */
  appealLimits?: AppealLimits;
}

export interface RunReport {
  accepted: Hex32[];
  declined: Array<{ commitmentId: Hex32; reason: string }>;
  /** Its own decisions whose appeal it expired, freeing its bond (T-211). */
  expired: Hex32[];
  triggered: Hex32[];
  decided: Array<{ commitmentId: Hex32; role: DecisionTask['role']; outcome: DecisionOutcome }>;
  /** Judged, record published, but no Decision: the appeal panel was inconclusive after an escalation. */
  undecided: Hex32[];
  refused: Array<{ commitmentId: Hex32; problem: Problem }>;
}

type Outcome = { decision: Decision; record: Judgment } | { decision: null; record: Judgment };

interface Preflight {
  policy: AdjudicatorPolicy;
  envelope: EncryptedKey;
  seed: Hex32;
  beacon?: NonNullable<Decision['beacon']>;
  buyerKey: Uint8Array;
  /** Absent for the appeal role, which cannot escalate. */
  appealKey?: Uint8Array;
}

interface Judged {
  record: Judgment;
  /** null: an inconclusive appeal panel after an escalation; nothing is signed. */
  outcome: DecisionOutcome | null;
  contentKey?: ContentKey;
  published: boolean;
}

/** keccak256 of the RFC 8785 JSON of the record without recordHash, signature and recordUri. */
export function recordHashOf(record: Omit<Judgment, 'recordHash' | 'signature'> & Partial<Judgment>): Hex32 {
  const body: Partial<Judgment> = { ...record };
  delete body.recordHash;
  delete body.signature;
  delete body.recordUri;
  return canonicalKeccak(body);
}

const ZERO_SCORE_REASON = (code: string) => `intake refused the delivery: ${code}`;

/** The judged-record cache key: one panel per (commitment, role, attempt), never re-rolled. */
const judgedKey = (t: Pick<DecisionTask, 'commitment' | 'role' | 'attempt'>) => `${t.commitment.id}|${t.role}|${t.attempt}`;

export class Adjudicator {
  readonly policy: AdjudicatorPolicy;
  readonly address: Address;
  readonly #cfg: AdjudicatorConfig;
  readonly #account;
  /** Judged records by commitment|role|attempt, kept the moment the panel returns (no re-roll). */
  readonly #judged = new Map<string, Judged>();

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
    const report: RunReport = { accepted: [], declined: [], expired: [], triggered: [], decided: [], undecided: [], refused: [] };
    // T-211: its own decisions hold its bond until their appeal closes, and a sham deal's parties never close it. So it
    // expires them itself once due, first, so the bond they free counts for what follows.
    for (const id of await port.appealExpiriesDue(this.address)) {
      try {
        if ((await port.expireAppeal(id)).ok) report.expired.push(id);
      } catch (e) {
        report.refused.push({ commitmentId: id, problem: problem('adjudicator_unavailable', `appeal expiry failed (${String((e as Error).message).slice(0, 120)}); retrying on the next pass`) });
      }
    }
    for (const offer of await port.offers(this.address)) {
      const r = await this.#accept(offer.commitment);
      if (r.ok) report.accepted.push(offer.commitment.id);
      else report.declined.push({ commitmentId: offer.commitment.id, reason: r.error.detail });
    }
    for (const c of await port.takeoversDue(this.address)) {
      // T-211: it does not trigger a takeover it would decline. Anyone still may; the deal then defaults at fallbackBy.
      // T-221 review: that includes a registry, a bound policy or a panel it cannot run.
      const declined =
        this.#termsMismatch(c) ?? (await this.#turnProblem(c, 'fallback', { consented: c.adjudication.adjudicator.toLowerCase() === this.address, cover: true })) ?? (await this.#runnable(c, 'fallback'));
      if (declined) report.refused.push({ commitmentId: c.id, problem: declined });
      else if ((await port.triggerFallback(c.id)).ok) report.triggered.push(c.id);
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
    const declined = this.#offerProblem(c) ?? (await this.#referenceProblem(c));
    if (declined) return err(declined);
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

  /** What it declines an offer for as primary, from the terms alone (D29): it does not accept terms it cannot or will not run. */
  #offerProblem(c: DecisionTask['commitment']): Problem | null {
    const { adjudication } = c;
    // Declining leaves the offer unaccepted, so no buyer funds a hold that would only reach its default outcome; the
    // offer expires at offerExpiresAt.
    if (isSealed(c) && !this.#cfg.acceptSealedUnread) {
      return problem('adjudicator_unavailable', `${this.#cfg.name} cannot open sealed terms yet (ADR-0024, T-207): it declines private and judgment offers rather than accept a deal it could not judge; offer at disclosure public`);
    }
    // T-212: an untrusted appeal adjudicator could overturn this service's honest decision and take the price from its
    // bond; an untrusted fallback is declined on the same footing.
    for (const [role, who] of [['fallback', adjudication.fallbackAdjudicator], ['appeal', adjudication.appealAdjudicator]] as const) {
      const untrusted = this.#untrusted(role, who, 'offer');
      if (untrusted) return untrusted;
    }
    if (adjudication.policyHash !== policyHashOf(this.policy)) return problem('policy_mismatch', 'policy-hash-mismatch: the offer binds another policy');
    if (adjudication.registryHash !== this.#cfg.registry.hash) return problem('registry_mismatch', 'the offer binds another registry');
    return this.#termsMismatch(c) ?? this.#windowsProblem(c) ?? this.#feeProblem(c);
  }

  /**
   * Why it would decline `role` on these terms, read from the terms alone: no bond, clock or delivery. An operator asks
   * before it fills this service in as a default adjudicator, and notes the answer when the parties name it themselves
   * (T-221 review). The fallback's cover and the appeal's timing are still checked at the turn. null: it would take it.
   */
  async declines(c: DecisionTask['commitment'], role: DecisionTask['role']): Promise<Problem | null> {
    if (role === 'primary') return this.#offerProblem(c) ?? (await this.#referenceProblem(c));
    const consented = c.adjudication.adjudicator.toLowerCase() === this.address;
    return this.#termsMismatch(c) ?? (await this.#turnProblem(c, role, { consented, cover: false, ahead: true })) ?? (await this.#runnable(c, role));
  }

  /** The appeal adjudicators it takes a fallback turn under, itself included (T-212, T-221). */
  #trusted(): string[] {
    return [...new Set([this.address, ...(this.#cfg.trustedAdjudicators ?? []).map((a) => a.toLowerCase())])];
  }

  /**
   * T-212 and T-221 (ADR-0030 §6): an appeal adjudicator outside its trusted set could overturn this service's decision
   * and pay the price from its bond (D43). As primary it checks the fallback and the appeal adjudicator at acceptance; as
   * fallback, the appeal adjudicator at its turn, since an outside primary's terms can name it as fallback. `terms`: the
   * same rule asked ahead of any deal, by an operator before it fills this service in.
   */
  #untrusted(role: 'fallback' | 'appeal', who: Address, what: 'offer' | 'fallback turn' | 'terms'): Problem | null {
    const trusted = this.#trusted();
    if (trusted.includes(who.toLowerCase())) return null;
    const why = `an appeal decided by an untrusted adjudicator could pay the price from this adjudicator's bond (${what === 'offer' ? 'T-212' : 'T-221, ADR-0030 §6'})`;
    if (what === 'offer') return problem('invalid_terms', `${this.#cfg.name} does not trust ${who} as the ${role} adjudicator: ${why}; offer with a ${role} adjudicator it trusts`);
    if (what === 'terms') return problem('invalid_terms', `${this.#cfg.name} takes a fallback turn only under an appeal adjudicator it trusts (${trusted.join(', ')}), and ${who} is not one: ${why}`);
    // A fallback turn comes only after judgeBy, when core refuses the primary's decision; the parties may still settle.
    return problem('invalid_terms', `${this.#cfg.name} does not trust ${who} as the appeal adjudicator, so it declines this deal's fallback turn: ${why}. So no adjudicator will decide this deal's first instance; the default outcome applies at fallbackBy unless the parties settle by mutual agreement first`);
  }

  /** D29 (T-211): a primary's or fallback's decision holds its bond until the appeal closes, and the deal sets how long. */
  #windowsProblem(c: DecisionTask['commitment']): Problem | null {
    const limits = this.#cfg.appealLimits ?? DEFAULT_APPEAL_LIMITS;
    for (const [field, max] of [['appealWindowSec', limits.maxAppealWindowSec], ['appealDecideSec', limits.maxAppealDecideSec]] as const) {
      if (c.timing[field] > max) {
        return problem('invalid_terms', `${this.#cfg.name} decides only deals whose ${field} is at most ${max} s: a decider's bond stays reserved until the appeal closes, and this deal sets ${c.timing[field]} s (T-211, D29)`);
      }
    }
    return null;
  }

  #feeProblem(c: DecisionTask['commitment']): Problem | null {
    const min = this.quote();
    const { fee } = c.adjudication;
    if (fee.token !== min.token) return problem('invalid_terms', `the fee is in ${fee.token}; the quote is ${min.amount} ${min.token}`);
    if (BigInt(fee.amount) < BigInt(min.amount)) return problem('invalid_terms', `the fee ${fee.amount} ${fee.token} is below the quote ${min.amount} ${min.token}`);
    return null;
  }

  /** The contract reserves a fallback's bond when it decides and refuses an uncovered one (T-206 M-3). */
  async #coverProblem(c: DecisionTask['commitment']): Promise<Problem | null> {
    const cover = await this.#cfg.settlement.bondCover(this.address, c);
    if (cover >= BigInt(c.price.amount)) return null;
    return problem('coverage_exceeded', `${this.#cfg.name} has ${cover} free bond for this deal and the price is ${c.price.amount} ${c.price.token}: a fallback's decision is backed by its bond, so it declines rather than sign one it cannot cover`);
  }

  /** The checks read the terms the settlement port hands over, so they must be the deal's own: the ID hashes them. */
  #termsMismatch(c: DecisionTask['commitment']): Problem | null {
    return commitmentId(termsOf(c)) === c.id ? null : problem('invalid_terms', `the terms handed to ${this.#cfg.name} do not hash to commitment ${c.id}; refusing`);
  }

  /**
   * T-211 (T-206 M-3): a fallback or appeal adjudicator signed nothing at agreement, so it consents when it decides.
   * - Fallback: its decision holds its bond until the appeal closes, so the windows, the fee and its cover.
   * - Appeal: its decision is final, so no window follows it, and nothing on chain reserves its bond yet (L-5); only
   *   the fee. Gating it on free bond would let the party that won drain that bond and so block the appeal.
   * `consented`: a turn on a deal it already consented to, as primary by its acceptance or by its own first decision,
   * so a later quote or limit does not renege on it (and the wrong-key re-release, which runs no panel). `cover`: false
   * when the turn's cached outcome is an escalation, which reserves no bond. null: it takes the turn.
   * A fallback turn also needs an appeal adjudicator it trusts (T-221), consented or not: its decision reserves its bond
   * for that appeal adjudicator to slash, and a primary's acceptance already checked the same set.
   */
  async #turnProblem(c: DecisionTask['commitment'], role: 'fallback' | 'appeal', o: { consented: boolean; cover: boolean; ahead?: boolean }): Promise<Problem | null> {
    if (role === 'fallback') {
      const untrusted = this.#untrusted('appeal', c.adjudication.appealAdjudicator, o.ahead ? 'terms' : 'fallback turn');
      if (untrusted) return untrusted;
    }
    if (!o.consented) {
      const terms = (role === 'fallback' ? this.#windowsProblem(c) : null) ?? this.#feeProblem(c);
      if (terms) return terms;
    }
    return o.cover ? this.#coverProblem(c) : null;
  }

  /**
   * The policy the commitment binds: this adjudicator's own, else the one whose hash the terms bound, read by that hash
   * (T-221 review: the primary can register a new policy after agreement, so its latest registration is read only when
   * the port keeps no policy by hash, and then only a policy that still hashes to the terms passes).
   */
  async #boundPolicy(c: DecisionTask['commitment']): Promise<Result<AdjudicatorPolicy, Problem>> {
    const bound = c.adjudication.policyHash;
    let policy = this.policy;
    if (policyHashOf(policy) !== bound) {
      const kept = await this.#cfg.settlement.policy?.(bound);
      const primary = kept ? null : await this.#cfg.settlement.registration(c.adjudication.adjudicator);
      policy = kept ?? primary?.policy ?? policy;
    }
    const check = checkPolicyBinding(policy, bound);
    return check.ok ? ok(policy) : err(check.error);
  }

  #registryProblem(c: DecisionTask['commitment']): Problem | null {
    if (this.#cfg.registry.hash === c.adjudication.registryHash) return null;
    return problem('registry_mismatch', `this adjudicator's registry hashes to ${this.#cfg.registry.hash}; the commitment binds ${c.adjudication.registryHash}`);
  }

  /**
   * Whether the panel the role convenes can be seated from its registry and reach a result (as `selectPanel` and the
   * aggregation would find out): enough active judges and families, and a valid-verdict minimum the panel can reach.
   */
  #seatProblem(policy: AdjudicatorPolicy, role: DecisionTask['role']): Problem | null {
    const appeal = role === 'appeal';
    const size = appeal ? policy.appealPanelSize : policy.panelSize;
    const minValid = appeal ? policy.minValidAppeal : policy.minValid;
    const { active } = this.#cfg.registry;
    const families = new Set(active.map((e) => e.family)).size;
    const minFamilies = appeal ? Math.max(policy.minFamilies, Math.min(policy.minFamiliesAppeal, families)) : policy.minFamilies;
    if (size > active.length || minFamilies > families || minFamilies > size) {
      return problem('invalid_terms', `panel: the registry has ${active.length} active judges in ${families} families; the ${appeal ? 'appeal' : 'first-instance'} panel needs ${size} meeting ${minFamilies} families`);
    }
    if (minValid > size) return problem('invalid_terms', `panel: the policy needs ${minValid} valid verdicts from ${appeal ? 'an appeal' : 'a first-instance'} panel of ${size}, which no panel can reach`);
    return null;
  }

  /**
   * What the terms ask that this build, registry or store cannot run: a policy it cannot honour, another registry, a
   * panel it cannot seat, or a reference its store does not return.
   */
  async #runnable(c: DecisionTask['commitment'], role: DecisionTask['role']): Promise<Problem | null> {
    const policy = await this.#boundPolicy(c);
    if (!policy.ok) return policy.error;
    return this.#registryProblem(c) ?? this.#seatProblem(policy.value, role) ?? (await this.#referenceProblem(c));
  }

  /**
   * T-327 review, finding 1: it does not agree to serve a deal whose references its store does not return (or returns
   * with other bytes, or larger than any store keeps), as primary at acceptance and as fallback before a takeover.
   * Otherwise it would refuse every turn of a deal it accepted, and a buyer and seller acting together could send the
   * deal to its default outcome and take the bonds. Read here and again at judging; a store that loses the bytes later
   * leaves the deal to the fallback and then its default outcome.
   */
  async #referenceProblem(c: DecisionTask['commitment']): Promise<Problem | null> {
    // Sealed terms carry no `acceptance` this service can read (it cannot open them yet, T-207), so it sees no
    // reference by design: the check applies to the terms it can read, and a sealed offer goes on as before.
    if (isSealed(c)) return null;
    const { unavailable } = await loadReferences(c.acceptance?.deterministicChecks ?? [], (uri) => this.#cfg.settlement.ciphertext(uri));
    if (!unavailable.length) return null;
    return problem('adjudicator_unavailable', `${this.#cfg.name} serves a deal only when its store holds every reference the terms name, and the reference ${describeUnavailable(unavailable)}: upload it with POST /v1/ciphertext to the store this adjudicator reads, then offer again`);
  }

  /**
   * Judges one task and signs its Decision (or returns the refusal). Idempotent per (commitment, role,
   * attempt), and never re-rolls: everything that can fail is checked before any judge is called, and
   * the judged record is kept the moment the panel returns, so a retry after a later failure (record
   * publication, submission) only publishes, wraps and signs again. It never calls the judges twice.
   */
  async decideTask(task: DecisionTask): Promise<Result<Outcome, Problem>> {
    const key = judgedKey(task);
    const pre = await this.#preflight(task);
    if (!pre.ok) return pre;
    let judged = this.#judged.get(key);
    if (!judged) {
      const r = await this.#judge(task, pre.value);
      if (!r.ok) return r;
      judged = r.value;
      this.#judged.set(key, judged);
    } else if (judged.record.deliveryHash !== deliveryHash(task.delivery)) {
      // ADR-0029: the record, the key and the decision name the delivery judged. A retry handed another seller-signed
      // delivery for the same attempt (seller equivocation) is refused: no re-judging, and no decision naming a body
      // the record does not cover.
      return err(problem('invalid_state', `this adjudicator judged delivery ${judged.record.deliveryHash} for this commitment, role and attempt; the task now carries ${deliveryHash(task.delivery)}, and it never judges an attempt twice`));
    }
    // T-211: the bond may have moved while the panel ran; read it again before publishing and signing (kept, no re-roll).
    // An escalation reserves no bond on either chain, so it needs no cover.
    if (task.role === 'fallback' && judged.outcome !== 'escalate') {
      const short = await this.#coverProblem(task.commitment);
      if (short) return err(short);
    }
    if (!judged.published) {
      try {
        await this.#cfg.settlement.publishRecord(judged.record);
      } catch (e) {
        return err(problem('adjudicator_unavailable', `judgment record publication failed (${String((e as Error).message).slice(0, 120)}); retrying without re-judging`));
      }
      judged.published = true;
    }
    // Signing is deterministic (RFC 6979), so a retry signs the identical Decision.
    if (judged.outcome === null) return ok({ decision: null, record: judged.record });
    return ok({ decision: await this.#sign(task, pre.value, judged), record: judged.record });
  }

  /** Every check that can refuse the task, before any judge is called or anything is published. */
  async #preflight(task: DecisionTask): Promise<Result<Preflight, Problem>> {
    const { commitment, role, attempt } = task;
    const id = commitment.id;
    const mismatch = this.#termsMismatch(commitment);
    if (mismatch) return err(mismatch);
    // The wrong-key re-release runs no panel (#judge).
    const rerelease = role === 'appeal' && task.appealGround === 'missing-or-wrong-key' && task.firstOutcome === 'accept';
    // Before any judge is called (T-211); the fallback's cover is read again before it signs.
    if (role !== 'primary') {
      const mine = (a: string | undefined) => a?.toLowerCase() === this.address;
      const consented = mine(commitment.adjudication.adjudicator) || (role === 'appeal' && mine(task.firstDecider)) || rerelease;
      const cached = this.#judged.get(judgedKey(task))?.outcome;
      const declined = await this.#turnProblem(commitment, role, { consented, cover: role === 'fallback' && cached !== 'escalate' });
      if (declined) return err(declined);
    }
    const policyR = await this.#boundPolicy(commitment);
    if (!policyR.ok) return policyR;
    // T-221 review: a panel that cannot be seated or reach a result is refused before any judge is called.
    const unrunnable = this.#registryProblem(commitment) ?? (rerelease ? null : this.#seatProblem(policyR.value, role));
    if (unrunnable) return err(unrunnable);
    // ADR-0029: judge only this commitment's delivery, signed by its seller. The decision names this delivery's hash, so a
    // body the seller never signed (an operator's mistake or forgery) is refused here, not judged and then refused by
    // settlement.
    if (task.delivery.commitmentId !== id) {
      return err(problem('invalid_terms', `the delivery handed to this adjudicator is for commitment ${task.delivery.commitmentId}, not ${id}; refusing before judging`));
    }
    if (!(await verifyMessage(this.#cfg.domain, { ...task.delivery, type: 'Delivery' }, commitment.seller))) {
      return err(problem('invalid_signature', `the delivery handed to this adjudicator is not signed by the seller ${commitment.seller}; refusing before judging`));
    }
    // Key-wrapping prerequisites: the buyer's key (accept) and, for roles that may escalate, the appeal adjudicator's.
    let buyerKey: Uint8Array;
    try {
      buyerKey = decodePublicKey(commitment.buyerEncryptionPublicKey);
    } catch {
      return err(problem('invalid_terms', 'the buyer encryption key in the commitment is not a valid public key'));
    }
    let appealKey: Uint8Array | undefined;
    if (role !== 'appeal') {
      const next = await this.#cfg.settlement.registration(commitment.adjudication.appealAdjudicator);
      try {
        if (!next) throw new Error('missing');
        appealKey = decodePublicKey(next.encryptionPublicKey);
      } catch {
        return err(problem('adjudicator_unavailable', 'the appeal adjudicator has no usable registration, so an escalation could not carry its key; refusing before judging'));
      }
    }
    // The key this adjudicator may use (ADR-0020).
    const envelope: EncryptedKey | undefined =
      role === 'primary' ? task.delivery.encryptedKeys.find((k) => k.recipient.toLowerCase() === this.address) : task.releasedKey;
    if (!envelope || envelope.recipient.toLowerCase() !== this.address) {
      return err(problem('invalid_state', role === 'primary' ? 'no envelope for this adjudicator in the delivery' : `no key released to the ${role} adjudicator; it does not read the work before takeover`));
    }
    // The seed for the role (ADR-0018).
    if (role === 'primary') return ok({ policy: policyR.value, envelope, seed: this.seedFor(id), buyerKey, ...(appealKey ? { appealKey } : {}) });
    const fixedAt = task.roundFixedAt ?? (role === 'fallback' ? commitment.timing.judgeBy : undefined);
    if (!fixedAt) return err(problem('seed_mismatch', 'no settlement time fixes the beacon round for this appeal'));
    // T-217: the source the commitment's rulebook names, on its clock; never another in its place (ADR-0018 §5).
    const source = this.#cfg.settlement.randomness(commitment);
    if (!source) {
      return err(problem('adjudicator_unavailable', `${this.#cfg.name} has no source for the randomness this commitment's rulebook names (a drand-quicknet rulebook needs a drand source); it does not decide rather than seed the panel from another (ADR-0018 §5)`));
    }
    const round = roundFor(role, fixedAt, source.clock);
    const got = await source.value(round);
    if (!got) return err(problem('seed_mismatch', `beacon round ${round} is not published or not proven yet; waiting (no substitute source)`));
    // A bad proof burns up to 250,000 gas in the contract's pairing check: this service signs only a proof it checked.
    const proven = source.kind === 'sim' || (source.kind === 'drand-quicknet' && got.signature !== undefined && (await quicknetValue(round, got.signature)) === got.value);
    if (!proven) return err(problem('seed_mismatch', `the beacon answer does not prove drand quicknet round ${round}; refusing to sign a proof the rules contract would refuse, and waiting (no substitute source)`));
    const beacon = { source: source.kind, round, value: got.value, ...(got.signature ? { signature: got.signature } : {}) };
    return ok({ policy: policyR.value, envelope, seed: panelSeed(id, role, attempt, got.value), beacon, buyerKey, ...(appealKey ? { appealKey } : {}) });
  }

  /** Intake and the panel. The only step that calls judges; its result is cached by the caller. */
  async #judge(task: DecisionTask, pre: Preflight): Promise<Result<Judged, Problem>> {
    const { commitment, role } = task;
    const id = commitment.id;
    const { policy, seed, beacon } = pre;
    let contentKey: ContentKey | undefined;
    const ciphertext = await this.#cfg.settlement.ciphertext(task.delivery.ciphertext.uri);
    const intaken = await intake({
      delivery: { ...task.delivery, encryptedKeys: [pre.envelope] },
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
      const mapped = mapIntakeError(intaken.error);
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
      // T-327: reference files come from the same content store as the delivery, by the hash the terms commit to.
      // One the store does not return, or returns with other bytes, is the store's fault, like a ciphertext that
      // does not match its delivery: refused before any judge is called, with no record, and retried; the
      // fallback and then the default outcome follow if it never comes (red team H1). Read once: the record is cached.
      const loaded = await loadReferences(commitment.acceptance.deterministicChecks, (uri) => this.#cfg.settlement.ciphertext(uri));
      if (loaded.unavailable.length) {
        return err(problem('adjudicator_unavailable', `reference files unavailable from this adjudicator's store: ${describeUnavailable(loaded.unavailable)}; not judged, retrying (no record)`));
      }
      const references = loaded.references;
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
        references,
        // D27c: a party appeal (a first decision exists) differs from the appeal after an escalation.
        ...(appeal ? { appealKind: task.firstOutcome ? ('party' as const) : ('escalated' as const) } : {}),
      });
      if (!run.ok) return run;
      draft = run.value;
    }

    // Map the panel's decision onto what the role may sign.
    // Party appeal: an undecided appeal panel leaves the first decision standing; after an escalation: no decision.
    const outcome: DecisionOutcome | null = signedOutcome(draft.aggregate.decision, { appeal, ...(task.firstOutcome ? { firstOutcome: task.firstOutcome } : {}) });
    const record = await this.#record(task, { ...draft, panel: { ...panelBase, ran: draft.panel.ran, members: draft.panel.members } });
    return ok({ record, outcome, published: false, ...(contentKey ? { contentKey } : {}) });
  }

  /** Wraps the keys and signs. Cannot fail on inputs: the preflight checked every prerequisite. */
  async #sign(task: DecisionTask, pre: Preflight, judged: Judged): Promise<Decision> {
    const { commitment, role, attempt } = task;
    const id = commitment.id;
    const outcome = judged.outcome!;
    const unsigned: Omit<Decision, 'signature'> = {
      type: 'Decision',
      commitmentId: id,
      attempt,
      // The delivery the record judged (decideTask refuses a task that carries another).
      deliveryHash: judged.record.deliveryHash,
      adjudicator: this.address,
      role,
      outcome,
      seed: pre.seed,
      policyHash: commitment.adjudication.policyHash,
      registryHash: commitment.adjudication.registryHash,
      judgmentRecordHash: judged.record.recordHash,
      nonce: keccak256(concat([toBytes(id), stringToBytes(`holdback.decision-nonce.v1:${role}:${attempt}`)])),
      expiresAt: task.deadline,
      ...(pre.beacon ? { beacon: pre.beacon } : {}),
      ...(role === 'appeal' && task.appealGround ? { appealGround: task.appealGround } : {}),
    };
    // ADR-0012 (T-206 H-2): the buyer's key travels only with an accept, and never on a deal that stands Refunded. A
    // party appeal that overturns a reject pays the seller from the first decider's bond, and the buyer keeps its refund;
    // a key in the signed decision would reach it through the calldata and the operators even though settlement refuses
    // it. After an escalation firstOutcome is absent and the accept releases the price, so it keeps the key, which
    // settlement requires.
    if (outcome === 'accept' && judged.contentKey && task.firstOutcome !== 'reject') unsigned.keyForBuyer = wrapKey(judged.contentKey, pre.buyerKey);
    if (outcome === 'escalate' && judged.contentKey && pre.appealKey) {
      unsigned.encryptedKeys = wrapKeyForRecipients(judged.contentKey, [{ recipient: commitment.adjudication.appealAdjudicator, publicKey: pre.appealKey }]);
    }
    return { ...unsigned, signature: await signMessage(this.#cfg.signingKey, this.#cfg.domain, unsigned) };
  }

  async #record(task: DecisionTask, draft: Pick<Judgment, 'intake' | 'deterministic' | 'screen' | 'panel' | 'aggregate'>): Promise<Judgment> {
    const { weightedScore, ...agg } = draft.aggregate;
    const body = {
      commitmentId: task.commitment.id,
      attempt: task.attempt,
      deliveryHash: deliveryHash(task.delivery),
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
 * Intake failures. The seller's faults reject without a panel. Everything else is
 * refused before any record is published: a key this adjudicator cannot open (the fallback takes over
 * at judgeBy, or the default applies) and a stored ciphertext that does not match the delivery (the
 * store, not the seller, may be at fault; retried).
 */
export function mapIntakeError(e: IntakeError): Result<DecisionOutcome, Problem> {
  switch (e.code) {
    case 'ciphertext_hash_mismatch':
      return err(problem('invalid_state', 'the stored ciphertext does not match the delivery; retrying later'));
    case 'no_key_for_recipient':
    case 'key_unwrap_failed':
      return err(problem('invalid_state', `this adjudicator cannot open its key (${e.code}); refusing without a record`));
    default:
      return ok('reject');
  }
}
