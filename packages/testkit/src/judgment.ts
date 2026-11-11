// The runner's judgment: @holdback/judgment's real pipeline on a panel drawn from config/judges.yaml
// by the seeded selection. Intake, deterministic checks, the screen, the panel and aggregation are the
// library's; only the model calls are replaced, by recorded or fake verdicts (JudgeProvider in recorded.ts).
//
// The panel follows the adjudicator service (apps/adjudicator service.ts): panelSize seats over minFamilies
// for the primary and fallback, appealPanelSize over minFamiliesAppeal (capped by the families the registry
// has) for the appeal adjudicator, under the appeal template. A panel is never re-rolled: the caller keeps
// one judgment per (commitment, role, attempt).
import { canonicalKeccak, err, ok, problem, type AdjudicatorPolicy, type Address, type CommitmentTerms, type Delivery, type DecisionOutcome, type Hex32, type Problem, type Result, type Sha256 } from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import {
  APPEAL_PROMPT_TEMPLATE_HASH,
  intake,
  loadReferences,
  panelPlan,
  PROMPT_TEMPLATE_HASH,
  requestInputHash,
  runPipeline,
  signedOutcome,
  type IntakeErrorCode,
  type JudgeProvider as PipelineProvider,
  type LoadedRegistry,
  type PanelSeat,
} from '@holdback/judgment';
import { readdirSync, readFileSync } from 'node:fs';
import { keccak256 } from 'viem';
import type { CapturedFrom, JudgeProvider, JudgeRequest } from './recorded.js';

/**
 * The runner's content store for reference files (T-327): the files in fixtures/data/reference/, each kept under
 * its SHA-256 as an operator's store keeps an upload (POST /v1/ciphertext). It reads only that directory and
 * answers by the hash at the end of the URI, never by the rest of it, as the adjudicator's stores do.
 */
const REFERENCE_DIR = new URL('../../../fixtures/data/reference/', import.meta.url);
let referenceStore: Map<string, Uint8Array> | undefined;
async function readReference(uri: string): Promise<Uint8Array> {
  if (!referenceStore) {
    referenceStore = new Map();
    let names: string[] = [];
    try {
      names = readdirSync(REFERENCE_DIR);
    } catch {
      // No reference files in this checkout: every lookup misses.
    }
    for (const name of names) {
      const bytes = new Uint8Array(readFileSync(new URL(name, REFERENCE_DIR)));
      referenceStore.set(sha256(bytes), bytes);
    }
  }
  const id = /(sha256:[0-9a-f]{64})$/.exec(uri)?.[1];
  const bytes = id ? referenceStore.get(id) : undefined;
  if (!bytes) throw new Error(`no reference ${uri.slice(0, 120)} in the runner's store`);
  return bytes;
}

export type Role = 'primary' | 'fallback' | 'appeal';

export interface PanelMemberView {
  judgeId: string;
  provider: string;
  family: string;
  /** Pinned model ID from the registry. */
  model: string;
  /** The pipeline's status for the seat: ok, abstain (including a filtered output), timeout or error. */
  status: 'ok' | 'abstain' | 'timeout' | 'error';
  /** Where the verdict came from. */
  source: 'recorded' | 'fake';
  capturedFrom?: CapturedFrom;
  overall: 'pass' | 'fail' | 'abstain' | null;
  /** Scores in rubric order; empty without a verdict. */
  scores: number[];
  injectionSuspected: boolean;
  inputHash: Hex32;
}

export interface CheckView {
  id: string;
  type: string;
  required: boolean;
  passed: boolean;
  detail?: string;
}

export interface JudgmentView {
  adjudicator: string;
  role: Role;
  attempt: number;
  intake: { plaintextSha256: Sha256; mime: string; bytes: number; source: string; hashVerified: boolean; normalized: boolean; refused?: IntakeErrorCode };
  checks: CheckView[];
  screen: { flagged: boolean; signals: Array<{ kind: string; detail?: string }> };
  panel: {
    ran: boolean;
    size: number;
    minFamilies: number;
    template: 'first-instance' | 'appeal';
    promptTemplateHash: Hex32;
    rubricHash: Hex32;
    seedSource: 'commit-reveal' | 'beacon';
    /** The beacon round that fixed a fallback or appeal seed (ADR-0018). */
    beaconRound: number | null;
    /** Null for the fallback and appeal adjudicators, which take a beacon seed. */
    seedCommitment: Hex32 | null;
    seed: Hex32;
    seedMatches: boolean | null;
    members: PanelMemberView[];
  };
  aggregate: { decision: DecisionOutcome; weightedScore: number | null; passCount?: number; failCount?: number; validCount?: number; passFamilies?: string[]; reasons: string[] };
  /** What the role signs: the panel's decision, mapped for the appeal role; null when it signs nothing. */
  outcome: DecisionOutcome | null;
}

export interface RunJudgmentInput {
  scenario: string;
  adjudicator: string;
  adjudicatorAddress: Address;
  role: Role;
  terms: Pick<CommitmentTerms, 'acceptance' | 'deliverable'>;
  commitmentId: Hex32;
  delivery: Delivery;
  /** The bytes the seller delivered; the runner stands in for decryption. */
  plaintext: Uint8Array;
  source: string;
  seed: Hex32;
  seedCommitment: Hex32 | null;
  beaconRound: number | null;
  registry: LoadedRegistry;
  policy: AdjudicatorPolicy;
  /** For an appeal of a first-instance decision: the decision the appeal panel reviews. */
  firstOutcome?: 'accept' | 'reject';
}

/** Intake failures that are the seller's fault: rejected with no panel (apps/adjudicator mapIntakeError). */
const SELLER_FAULTS: readonly IntakeErrorCode[] = ['mime_not_allowed', 'mime_mismatch', 'payload_too_large', 'decrypt_failed', 'plaintext_hash_mismatch', 'not_utf8'];

/**
 * Runs one adjudicator's judgment. Returns a Problem when the adjudicator must refuse (a panel the registry
 * cannot seat, a policy the pipeline refuses). Recording errors are thrown: they must fail the run.
 */
export async function runJudgment(input: RunJudgmentInput, judges: JudgeProvider): Promise<Result<JudgmentView, Problem>> {
  const { terms, role, policy, registry } = input;
  const appeal = role === 'appeal';
  const rubric = terms.acceptance.rubric;
  const rubricHash = canonicalKeccak(rubric);
  const promptTemplateHash = appeal ? APPEAL_PROMPT_TEMPLATE_HASH : PROMPT_TEMPLATE_HASH;
  const familiesAvailable = new Set(registry.active.map((e) => e.family)).size;
  const size = appeal ? policy.appealPanelSize : policy.panelSize;
  const minFamilies = appeal ? Math.max(policy.minFamilies, Math.min(policy.minFamiliesAppeal, familiesAvailable)) : policy.minFamilies;

  // Intake on the delivered bytes: the runner hands the plaintext over as its own "ciphertext" with an
  // identity opener, so the library still checks the MIME allowlist, size, plaintext hash and UTF-8.
  const ciphertext = input.plaintext;
  const intaken = await intake({
    delivery: {
      ...input.delivery,
      ciphertext: { ...input.delivery.ciphertext, sha256: sha256(ciphertext) },
      encryptedKeys: [{ recipient: input.adjudicatorAddress, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'AA' }],
    },
    ciphertext,
    recipient: input.adjudicatorAddress,
    format: terms.deliverable.format,
    unwrapKey: async () => new Uint8Array(32),
    open: async (ct) => ct,
  });

  const base = {
    adjudicator: input.adjudicator,
    role,
    attempt: input.delivery.attempt,
  };
  const panelBase = {
    size,
    minFamilies,
    template: appeal ? ('appeal' as const) : ('first-instance' as const),
    promptTemplateHash,
    rubricHash,
    seedSource: role === 'primary' ? ('commit-reveal' as const) : ('beacon' as const),
    beaconRound: input.beaconRound,
    seedCommitment: input.seedCommitment,
    seed: input.seed,
    seedMatches: input.seedCommitment === null ? null : keccak256(input.seed) === input.seedCommitment,
  };
  const intakeView = { plaintextSha256: input.delivery.plaintextSha256, mime: input.delivery.plaintextMime, bytes: input.plaintext.length, source: input.source };

  if (!intaken.ok) {
    if (!SELLER_FAULTS.includes(intaken.error.code)) return err(problem('invalid_state', `intake: ${intaken.error.code}`));
    const view: JudgmentView = {
      ...base,
      intake: { ...intakeView, hashVerified: false, normalized: false, refused: intaken.error.code },
      checks: [],
      screen: { flagged: false, signals: [] },
      panel: { ...panelBase, ran: false, members: [] },
      aggregate: { decision: 'reject', weightedScore: null, reasons: [`intake refused the delivery: ${intaken.error.code}`] },
      outcome: 'reject',
    };
    return ok(view);
  }

  const plan = panelPlan({ registry, seed: input.seed, commitmentId: input.commitmentId, size, minFamilies, criteria: rubric.criteria });
  if (!plan.ok) return err(problem('invalid_terms', `panel: ${plan.error}`));
  const seats = new Map<string, PanelSeat>(plan.value.seats.map((s) => [s.judgeId, s]));

  // Model calls go to the recorded or fake provider. A recording error is kept and rethrown after the
  // pipeline returns, because the pipeline would otherwise count a thrown provider as a transport error.
  const sources = new Map<string, { source: 'recorded' | 'fake'; capturedFrom?: CapturedFrom }>();
  let loud: Error | null = null;
  const provider: PipelineProvider = {
    async complete(req) {
      const seat = seats.get(req.judgeId)!;
      const request: JudgeRequest = {
        scenario: input.scenario,
        role,
        judgeId: seat.judgeId,
        provider: seat.provider,
        family: seat.family,
        model: req.model,
        promptTemplateHash,
        inputHash: requestInputHash(req),
        rubricHash,
      };
      try {
        const r = judges.judge(request);
        sources.set(req.judgeId, { source: r.status === 'recorded' ? 'recorded' : 'fake', ...(r.capturedFrom ? { capturedFrom: r.capturedFrom } : {}) });
        return { kind: 'ok', text: JSON.stringify(r.verdict) };
      } catch (e) {
        loud ??= e as Error;
        return { kind: 'error', transport: false, detail: (e as Error).name };
      }
    },
  };
  // As the adjudicator service: each reference by the hash the terms commit to, through the shared loader; one the
  // store does not hold is left out, and its check fails closed.
  const references = await loadReferences(terms.acceptance.deterministicChecks, readReference);
  const run = await runPipeline({
    intake: intaken.value,
    acceptance: terms.acceptance,
    references,
    deliverable: { description: terms.deliverable.description, format: terms.deliverable.format },
    policy: {
      minValid: appeal ? policy.minValidAppeal : policy.minValid,
      minFamilies,
      rationaleMaxChars: policy.rationaleMaxChars,
      acceptSupermajority: policy.acceptSupermajority,
      rejectSupermajority: policy.rejectSupermajority,
    },
    seats: plan.value.seats,
    registry: plan.value.registry,
    provider,
    nonces: plan.value.nonces,
    criteriaFor: plan.value.criteriaFor,
    sampleSeed: plan.value.sampleSeed,
    template: appeal ? 'appeal' : 'first-instance',
    // D27c, as the adjudicator service: a party appeal (a first decision exists) or the appeal after an escalation.
    ...(appeal ? { appealKind: input.firstOutcome ? ('party' as const) : ('escalated' as const) } : {}),
  });
  if (loud) throw loud;
  if (!run.ok) return err(run.error);
  const draft = run.value;

  const types = new Map(terms.acceptance.deterministicChecks.map((c) => [c.id, c.type as string]));
  const members: PanelMemberView[] = draft.panel.members.map((m) => {
    const v = m.verdict;
    const byId = new Map((v?.criteria ?? []).map((c) => [c.id, c.score]));
    const src = sources.get(m.judgeId) ?? { source: judges.kind };
    const view: PanelMemberView = {
      judgeId: m.judgeId,
      provider: m.provider,
      family: m.family,
      model: m.model,
      status: m.status === 'recorded' ? 'ok' : m.status,
      source: src.source,
      overall: v ? v.overall : m.status === 'abstain' ? 'abstain' : null,
      scores: v ? rubric.criteria.map((c) => byId.get(c.id) ?? 0) : [],
      injectionSuspected: v?.injectionSuspected ?? false,
      inputHash: m.inputHash,
    };
    if (src.capturedFrom) view.capturedFrom = src.capturedFrom;
    return view;
  });

  // The same mapping the adjudicator service signs by (@holdback/judgment signedOutcome): an appeal panel that
  // cannot decide leaves a party appeal's first decision standing, and signs nothing after an escalation.
  const outcome: DecisionOutcome | null = signedOutcome(draft.aggregate.decision, { appeal, ...(input.firstOutcome ? { firstOutcome: input.firstOutcome } : {}) });

  return ok({
    ...base,
    intake: { ...intakeView, hashVerified: draft.intake.plaintextHashVerified, normalized: draft.intake.normalized },
    checks: draft.deterministic.map((c) => ({ id: c.checkId, type: types.get(c.checkId) ?? 'unknown', required: c.required, passed: c.passed, ...(c.detail !== undefined ? { detail: c.detail } : {}) })),
    screen: { flagged: draft.screen.flagged, signals: draft.screen.signals.map((s) => ({ kind: s.kind, ...(s.detail !== undefined ? { detail: s.detail } : {}) })) },
    panel: { ...panelBase, ran: draft.panel.ran, members },
    aggregate: draft.aggregate,
    outcome,
  });
}
