// A stand-in for the judgment pipeline (T-008): it asks the panel through a JudgeProvider and applies a
// simple aggregation. Deterministic checks and the screen are listed but not evaluated.
import { canonicalKeccak, type CommitmentTerms, type DecisionOutcome, type Hex32, type Sha256 } from '@holdback/core';
import { keccak256 } from 'viem';
import type { JudgeProvider, JudgeRequest } from './recorded.js';
import { STUB_PANEL, STUB_PROMPT_TEMPLATE_HASH } from './stub-terms.js';

export interface PanelMemberView {
  judgeId: string;
  provider: string;
  family: string;
  model: string;
  status: 'ok' | 'recorded';
  capturedFrom?: string;
  overall: 'pass' | 'fail' | 'abstain';
  scores: number[];
  injectionSuspected: boolean;
  /** Why the runner made this judge abstain, if it did. */
  abstainReason?: string;
}

export interface JudgmentView {
  adjudicator: string;
  role: 'primary' | 'fallback' | 'appeal';
  attempt: number;
  intake: { plaintextSha256: Sha256; mime: string; bytes: number; source: string; hashVerified: boolean };
  checks: Array<{ id: string; type: string; required: boolean }>;
  panel: {
    promptTemplateHash: Hex32;
    rubricHash: Hex32;
    inputHash: Hex32;
    /** Null for a judge with no seed commitment: only the primary commits (contract gap recorded in T-004). */
    seedCommitment: Hex32 | null;
    seed: Hex32;
    seedMatches: boolean | null;
    members: PanelMemberView[];
  };
  aggregate: { decision: DecisionOutcome; weightedScore: string | null; reasons: string[] };
}

export interface JudgeInput {
  scenario: string;
  adjudicator: string;
  role: 'primary' | 'fallback' | 'appeal';
  terms: CommitmentTerms;
  commitmentId: Hex32;
  attempt: number;
  plaintextSha256: Sha256;
  plaintextVerified: boolean;
  mime: string;
  bytes: number;
  source: string;
  seed: Hex32;
  seedCommitment: Hex32 | null;
}

/** Runs the stub pipeline. Provider errors (a stale or missing recording) propagate: they must fail the run. */
export function stubJudgment(input: JudgeInput, judges: JudgeProvider): JudgmentView {
  const { terms } = input;
  const rubric = terms.acceptance.rubric;
  const rubricHash = canonicalKeccak(rubric);
  const inputHash = canonicalKeccak({
    commitmentId: input.commitmentId,
    attempt: input.attempt,
    plaintextSha256: input.plaintextSha256,
    mime: input.mime,
    deliverableHash: canonicalKeccak(terms.deliverable),
    rubricHash,
  });

  const members: PanelMemberView[] = STUB_PANEL.map((seat) => {
    const request: JudgeRequest = { scenario: input.scenario, ...seat, promptTemplateHash: STUB_PROMPT_TEMPLATE_HASH, inputHash, rubricHash };
    const result = judges.judge(request);
    const ids = result.verdict.criteria.map((c) => c.id);
    const expected = rubric.criteria.map((c) => c.id);
    const matches = ids.length === expected.length && new Set(ids).size === ids.length && expected.every((id) => ids.includes(id));
    const byId = new Map(result.verdict.criteria.map((c) => [c.id, c.score]));
    const view: PanelMemberView = matches
      ? {
          ...seat,
          status: result.status,
          overall: result.verdict.overall,
          scores: rubric.criteria.map((c) => byId.get(c.id)!),
          injectionSuspected: result.verdict.injectionSuspected,
        }
      : {
          ...seat,
          status: result.status,
          overall: 'abstain',
          scores: [],
          injectionSuspected: result.verdict.injectionSuspected,
          abstainReason: `criteria [${ids.join(', ')}] do not match the rubric [${expected.join(', ')}]`,
        };
    if (result.capturedFrom) view.capturedFrom = result.capturedFrom;
    return view;
  });

  return {
    adjudicator: input.adjudicator,
    role: input.role,
    attempt: input.attempt,
    intake: { plaintextSha256: input.plaintextSha256, mime: input.mime, bytes: input.bytes, source: input.source, hashVerified: input.plaintextVerified },
    checks: terms.acceptance.deterministicChecks.map((c) => ({ id: c.id, type: c.type, required: c.required })),
    panel: {
      promptTemplateHash: STUB_PROMPT_TEMPLATE_HASH,
      rubricHash,
      inputHash,
      seedCommitment: input.seedCommitment,
      seed: input.seed,
      seedMatches: input.seedCommitment === null ? null : keccak256(input.seed) === input.seedCommitment,
      members,
    },
    aggregate: aggregate(members, rubric.criteria.map((c) => c.weight), rubric.passThreshold),
  };
}

export function aggregate(members: PanelMemberView[], weights: number[], threshold: number): JudgmentView['aggregate'] {
  const valid = members.filter((m) => m.overall !== 'abstain');
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const perJudge = valid.map((m) => m.scores.reduce((acc, s, i) => acc + s * (weights[i] ?? 0), 0) / totalWeight);
  const mean = perJudge.length ? perJudge.reduce((a, b) => a + b, 0) / perJudge.length : null;
  const weightedScore = mean === null ? null : mean.toFixed(2);
  const passes = valid.filter((m) => m.overall === 'pass');
  const families = new Set(passes.map((m) => m.family));
  const tally = `${passes.length}/${members.length} pass across ${families.size} ${families.size === 1 ? 'family' : 'families'}`;

  if (members.some((m) => m.injectionSuspected)) return { decision: 'escalate', weightedScore, reasons: ['a judge suspected injection', tally] };
  if (valid.length < 2) return { decision: 'escalate', weightedScore, reasons: [`only ${valid.length} valid verdicts`] };
  if (passes.length === valid.length && families.size >= 2 && mean !== null && mean >= threshold) {
    return { decision: 'accept', weightedScore, reasons: [tally, `weighted score ${weightedScore} >= ${threshold.toFixed(1)}`] };
  }
  if (passes.length === 0) return { decision: 'reject', weightedScore, reasons: [tally] };
  return { decision: 'escalate', weightedScore, reasons: ['the panel split or missed the threshold', tally] };
}
