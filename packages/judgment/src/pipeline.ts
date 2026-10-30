// Stages 1, 2, 4 and 5 wired together over an intake result. Panel selection (which seats, criteria
// order per judge, nonces derived from the seed) is T-009's: this module takes the seats it is given
// and refuses an unpinned or single-family panel before any judge is called. Model calls go through
// an injected provider; a request carries the model ID, the two prompt strings and fixed sampling
// parameters, and nothing else (no tools, no secrets, no URLs to fetch).
import type { AcceptanceSpec, AdjudicatorPolicy, Criterion, Judgment, PanelMember, Problem, Result } from '@holdback/core';
import { canonicalKeccak, err, ok, problem } from '@holdback/core';
import { aggregate, preDecision, type PanelVerdict } from './aggregate.js';
import { evaluateChecks } from './checks/index.js';
import type { Intaken } from './intake.js';
import { buildPrompt, type Nonces } from './prompt.js';
import { screen, type ScreenResult } from './screen.js';
import { parseVerdict } from './verdict.js';

export interface PanelSeat {
  judgeId: string;
  provider: string;
  family: string;
  /** Pinned, dated model ID from the registry. */
  model: string;
}

export interface JudgeRequest {
  judgeId: string;
  provider: string;
  model: string;
  system: string;
  user: string;
  temperature: 0;
  maxOutputTokens: number;
}

export type JudgeResponse =
  | { kind: 'ok'; text: string; latencyMs?: number }
  | { kind: 'timeout' }
  | { kind: 'error'; transport: boolean; detail: string };

/** Implemented by T-009 (Anthropic, OpenAI-compatible, recorded); tests use fakes. Enforces the judge timeout. */
export interface JudgeProvider {
  complete(request: JudgeRequest): Promise<JudgeResponse>;
}

export type PipelinePolicy = Pick<AdjudicatorPolicy, 'minValid' | 'acceptSupermajority' | 'rejectSupermajority' | 'minFamilies' | 'rationaleMaxChars'>;

export interface PipelineInput {
  intake: Intaken;
  acceptance: AcceptanceSpec;
  deliverable: { description: string };
  policy: PipelinePolicy;
  seats: readonly PanelSeat[];
  provider: JudgeProvider;
  /** Per-judge boundary and canary. */
  nonces: (seat: PanelSeat, index: number) => Nonces;
  /** Per-judge criteria order; defaults to rubric order. Must be a permutation of the rubric. */
  criteriaFor?: (seat: PanelSeat, index: number) => readonly Criterion[];
  references?: ReadonlyMap<string, Uint8Array>;
  maxDataChars?: number;
  maxOutputTokens?: number;
}

/** The parts of judgment.schema.json this stage produces. T-009 adds identity, seed, policy, hash and signature. */
export interface JudgmentDraft {
  intake: Judgment['intake'];
  deterministic: Judgment['deterministic'];
  screen: ScreenResult;
  panel: { ran: boolean; members: PanelMember[] };
  aggregate: Judgment['aggregate'];
}

const UNPINNED = /latest/i;

/** Refuses floating aliases. The registry loader (T-009) also refuses them; this is the last line. */
export function isPinnedModelId(model: string): boolean {
  return model.trim().length > 0 && !UNPINNED.test(model);
}

function refuseSeats(seats: readonly PanelSeat[], policy: PipelinePolicy): string | undefined {
  for (const s of seats) if (!isPinnedModelId(s.model)) return `model ${JSON.stringify(s.model.slice(0, 80))} for ${s.judgeId} is not a pinned model ID`;
  if (new Set(seats.map((s) => s.judgeId)).size !== seats.length) return 'duplicate judgeId in the panel';
  const families = new Set(seats.map((s) => s.family)).size;
  if (families < policy.minFamilies) return `the panel has ${families} model families; the policy needs ${policy.minFamilies}`;
  return undefined;
}

async function call(provider: JudgeProvider, req: JudgeRequest): Promise<JudgeResponse> {
  const once = async (): Promise<JudgeResponse> => {
    try {
      return await provider.complete(req);
    } catch {
      return { kind: 'error', transport: true, detail: 'provider threw' };
    }
  };
  const first = await once();
  // One retry, on transport error only, with the same request (docs: Panel policy, Retries).
  return first.kind === 'error' && first.transport ? once() : first;
}

export async function runPipeline(input: PipelineInput): Promise<Result<JudgmentDraft, Problem>> {
  const { acceptance, policy, seats } = input;
  const refusal = refuseSeats(seats, policy);
  if (refusal) return err(problem('invalid_terms', refusal));

  // Stage 1 always runs first; stage 2 always runs, so the record shows it even without a panel.
  const deterministic = evaluateChecks(acceptance.deterministicChecks, { data: input.intake.data, mime: input.intake.mime, ...(input.references ? { references: input.references } : {}) });
  const screened = screen({ data: input.intake.data, hiddenTagText: input.intake.hiddenTagText, removed: input.intake.removed });
  const thresholds = { minValid: policy.minValid, acceptSupermajority: policy.acceptSupermajority, rejectSupermajority: policy.rejectSupermajority };
  const base = { intake: input.intake.record, deterministic };

  if (preDecision(deterministic, acceptance.rubric) !== 'panel') {
    const agg = aggregate({ checks: deterministic, rubric: acceptance.rubric, screenFlagged: screened.flagged, verdicts: [], thresholds });
    return ok({ ...base, screen: screened, panel: { ran: false, members: [] }, aggregate: agg });
  }

  const rubricHash = canonicalKeccak(acceptance.rubric);
  const rubricIds = acceptance.rubric.criteria.map((c) => c.id);
  const sameIds = (cs: readonly Criterion[]) => cs.length === rubricIds.length && cs.every((c) => rubricIds.includes(c.id)) && new Set(cs.map((c) => c.id)).size === cs.length;

  const results = await Promise.all(
    seats.map(async (seat, i): Promise<{ member: PanelMember; verdict: PanelVerdict; canaryEcho: boolean } | string> => {
      const criteria = input.criteriaFor?.(seat, i) ?? acceptance.rubric.criteria;
      if (!sameIds(criteria)) return `criteria for ${seat.judgeId} are not a permutation of the rubric`;
      const prompt = buildPrompt({
        spec: { description: input.deliverable.description },
        criteria,
        data: input.intake.data,
        nonces: input.nonces(seat, i),
        ...(input.maxDataChars !== undefined ? { maxDataChars: input.maxDataChars } : {}),
      });
      if (!prompt.ok) return `prompt for ${seat.judgeId}: ${prompt.error}`;
      const p = prompt.value;
      const member: PanelMember = {
        judgeId: seat.judgeId,
        provider: seat.provider,
        family: seat.family,
        model: seat.model,
        promptTemplateHash: p.promptTemplateHash,
        inputHash: p.inputHash,
        rubricHash,
        status: 'error',
      };
      const res = await call(input.provider, {
        judgeId: seat.judgeId,
        provider: seat.provider,
        model: seat.model,
        system: p.system,
        user: p.user,
        temperature: 0,
        maxOutputTokens: input.maxOutputTokens ?? 2048,
      });
      if (res.kind !== 'ok') return { member: { ...member, status: res.kind }, verdict: { family: seat.family, verdict: null }, canaryEcho: false };
      if (res.latencyMs !== undefined) member.latencyMs = res.latencyMs;
      const parsed = parseVerdict(res.text, { criterionIds: rubricIds, canary: p.canary, rationaleMaxChars: policy.rationaleMaxChars });
      if (parsed.status === 'abstain') {
        return { member: { ...member, status: 'abstain' }, verdict: { family: seat.family, verdict: null }, canaryEcho: parsed.reason === 'canary_echo' };
      }
      const status = parsed.verdict.overall === 'abstain' ? 'abstain' : 'ok';
      return { member: { ...member, status, verdict: parsed.verdict }, verdict: { family: seat.family, verdict: parsed.verdict }, canaryEcho: false };
    }),
  );
  const refused = results.find((r): r is string => typeof r === 'string');
  if (refused) return err(problem('invalid_terms', refused));
  const rs = results as Array<Exclude<(typeof results)[number], string>>;

  const canarySignals = rs.filter((r) => r.canaryEcho).map((r) => ({ kind: 'canary_echo' as const, detail: `judge ${r.member.judgeId} echoed its canary` }));
  const finalScreen: ScreenResult = { flagged: screened.flagged || canarySignals.length > 0, signals: [...screened.signals, ...canarySignals] };
  const agg = aggregate({ checks: deterministic, rubric: acceptance.rubric, screenFlagged: finalScreen.flagged, verdicts: rs.map((r) => r.verdict), thresholds });
  return ok({ ...base, screen: finalScreen, panel: { ran: true, members: rs.map((r) => r.member) }, aggregate: agg });
}
