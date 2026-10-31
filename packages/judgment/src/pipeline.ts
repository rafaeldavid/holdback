// Stages 1, 2, 4 and 5 wired together over an intake result. Panel selection (which seats, criteria
// order per judge, nonces derived from the seed) is T-009's: this module takes the seats it is given
// and refuses an unpinned, unregistered or single-family panel before any judge is called. Model
// calls go through an injected provider; a request carries the model ID, the two prompt strings and
// fixed sampling parameters, and nothing else (no tools, no secrets, no URLs to fetch).
import type { Hex32, MimeType, PanelMember, Problem, Result } from '@holdback/core';
import { canonicalKeccak, err, ok, problem } from '@holdback/core';
import { aggregate, preDecision, type Aggregate, type PanelVerdict } from './aggregate.js';
import { runChecks } from './checks/index.js';
import type { Intaken } from './intake.js';
import { buildPrompt, type Nonces, type PromptTemplateKind } from './prompt.js';
import { screen, screenTerms, validateTermsText, type ScreenResult } from './screen.js';
import { validatePolicy, validateRubric, type JudgmentAcceptance, type JudgmentCriterion, type JudgmentPolicy } from './terms.js';
import { parseVerdict } from './verdict.js';
import type { Judgment } from '@holdback/core';

export interface PanelSeat {
  judgeId: string;
  provider: string;
  /** A label only. The family that counts comes from the registry (or, without one, this label normalized). */
  family: string;
  /** Pinned model ID from the registry. */
  model: string;
}

/** The judge registry the commitment binds (T-009 loads it and checks registryHash): model ID to family. */
export type JudgeRegistry = ReadonlyMap<string, { family: string }>;

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

export type PipelinePolicy = JudgmentPolicy;

export interface PipelineInput {
  intake: Intaken;
  acceptance: JudgmentAcceptance;
  /** `format` is the commitment's agreed deliverable format; a different delivered format is refused. */
  deliverable: { description: string; format?: MimeType };
  policy: PipelinePolicy;
  seats: readonly PanelSeat[];
  /** When given, every seat's model must be in it, and the family comes from it. */
  registry?: JudgeRegistry;
  provider: JudgeProvider;
  /** Per-judge boundary and canary. */
  nonces: (seat: PanelSeat, index: number) => Nonces;
  /**
   * Per-judge sampling seed (T-009: derived from the panel seed). With it, a CSV over the data budget
   * is judged from a seeded sample without escalating; without it, sampled data escalates.
   */
  sampleSeed?: (seat: PanelSeat, index: number) => Hex32;
  /** First-instance (default) or appeal template. */
  template?: PromptTemplateKind;
  /** Per-judge criteria order; defaults to rubric order. Must be a permutation of the rubric. */
  criteriaFor?: (seat: PanelSeat, index: number) => readonly JudgmentCriterion[];
  references?: ReadonlyMap<string, Uint8Array>;
  maxDataChars?: number;
  maxOutputTokens?: number;
}

/** The parts of judgment.schema.json this stage produces (aggregate in the v0.5 shape). T-009 adds the rest. */
export interface JudgmentDraft {
  intake: Judgment['intake'];
  deterministic: Judgment['deterministic'];
  screen: ScreenResult;
  panel: { ran: boolean; members: PanelMember[] };
  aggregate: Aggregate;
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
const ALIAS_WORD = /latest|preview|current|default|stable|newest|beta|experimental/i;
/** Without a registry, an ID must end in a date or numeric revision: -20260601, -2026-05-01, -001, -2411. */
const VERSION_STAMP = /[-_@](?:\d{8}|\d{4}-\d{2}-\d{2}|\d{3,4})$/;

/**
 * Pinned model IDs only: ASCII, no floating-alias words, and either listed in the registry or,
 * when no registry is given, ending in a date or revision stamp.
 */
export function isPinnedModelId(model: string, registry?: JudgeRegistry): boolean {
  if (!MODEL_ID.test(model) || ALIAS_WORD.test(model)) return false;
  return registry ? registry.has(model) : VERSION_STAMP.test(model);
}

const normFamily = (f: string) => f.trim().toLowerCase();

/** The family each seat counts as, or a refusal. */
function resolveSeats(seats: readonly PanelSeat[], policy: PipelinePolicy, registry?: JudgeRegistry): Result<string[], string> {
  const families: string[] = [];
  for (const s of seats) {
    if (!isPinnedModelId(s.model, registry)) {
      return err(`model ${JSON.stringify(s.model.slice(0, 80))} for ${s.judgeId} is not a pinned model ID${registry ? ' in the registry' : ''}`);
    }
    const family = normFamily(registry ? registry.get(s.model)!.family : s.family);
    if (!family) return err(`no family for ${s.judgeId}`);
    families.push(family);
  }
  if (new Set(seats.map((s) => s.judgeId)).size !== seats.length) return err('duplicate judgeId in the panel');
  if (new Set(seats.map((s) => s.model)).size !== seats.length) return err('duplicate model ID in the panel');
  const distinct = new Set(families).size;
  if (distinct < policy.minFamilies) return err(`the panel has ${distinct} model families; the policy needs ${policy.minFamilies}`);
  return ok(families);
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

function labelledTerms(acceptance: JudgmentAcceptance, description: string): Array<readonly [string, string]> {
  return [
    ['deliverable.description', description] as const,
    ...acceptance.rubric.criteria.flatMap((c) => [
      [`criterion ${c.id} description`, c.description] as const,
      ...Object.entries(c.anchors).map(([k, v]) => [`criterion ${c.id} anchor ${k}`, v] as const),
    ]),
  ];
}
const termsTexts = (acceptance: JudgmentAcceptance, description: string) => labelledTerms(acceptance, description).map(([, t]) => t);

/**
 * Offer-time validation of the party-written terms that judges will read as instructions:
 * refuses hidden characters (tag, zero-width, bidi, variation selectors outside ordinary emoji
 * and script use) and mixed-script words. Returns the reasons; empty means acceptable.
 */
export function validateTerms(acceptance: JudgmentAcceptance, description: string): string[] {
  return validateTermsText(labelledTerms(acceptance, description));
}

export async function runPipeline(input: PipelineInput): Promise<Result<JudgmentDraft, Problem>> {
  const { acceptance, policy, seats } = input;
  const policyProblem = validatePolicy(policy) ?? validateRubric(acceptance.rubric);
  if (policyProblem) return err(problem('invalid_terms', policyProblem));
  const resolved = resolveSeats(seats, policy, input.registry);
  if (!resolved.ok) return err(problem('invalid_terms', resolved.error));
  const families = resolved.value;
  if (input.deliverable.format !== undefined && input.deliverable.format !== input.intake.mime) {
    return err(problem('mime_not_allowed', `delivered ${input.intake.mime}; the commitment agreed ${input.deliverable.format}`));
  }

  // Stage 1 runs first, on the text as delivered. Stage 2 always runs, on normalized text and on
  // the party-written terms, so the record shows it even without a panel.
  const { outcomes: deterministic, inconclusive } = runChecks(acceptance.deterministicChecks, {
    data: input.intake.raw,
    mime: input.intake.mime,
    ...(input.references ? { references: input.references } : {}),
  });
  const screened = screen({ data: input.intake.data, hiddenTagText: input.intake.hiddenTagText, removed: input.intake.removed, mime: input.intake.mime });
  const termSignals = screenTerms(termsTexts(acceptance, input.deliverable.description));
  const baseScreen: ScreenResult = { flagged: screened.flagged || termSignals.length > 0, signals: [...screened.signals, ...termSignals].slice(0, 20) };
  const thresholds = { minValid: policy.minValid, acceptSupermajority: policy.acceptSupermajority, rejectSupermajority: policy.rejectSupermajority };
  const base = { intake: input.intake.record, deterministic };

  if (false) {
    const agg = aggregate({ checks: deterministic, inconclusive, rubric: acceptance.rubric, screenFlagged: baseScreen.flagged, verdicts: [], thresholds });
    return ok({ ...base, screen: baseScreen, panel: { ran: false, members: [] }, aggregate: agg });
  }

  const rubricHash = canonicalKeccak(acceptance.rubric);
  const rubricIds = acceptance.rubric.criteria.map((c) => c.id);
  const sameIds = (cs: readonly JudgmentCriterion[]) => cs.length === rubricIds.length && cs.every((c) => rubricIds.includes(c.id)) && new Set(cs.map((c) => c.id)).size === cs.length;

  type SeatResult = { member: PanelMember; verdict: PanelVerdict; canaryEcho: boolean; filtered?: string; strided: boolean };
  const results = await Promise.all(
    seats.map(async (seat, i): Promise<SeatResult | string> => {
      const family = families[i]!;
      const criteria = input.criteriaFor?.(seat, i) ?? acceptance.rubric.criteria;
      if (!sameIds(criteria)) return `criteria for ${seat.judgeId} are not a permutation of the rubric`;
      const prompt = buildPrompt({
        spec: { description: input.deliverable.description },
        criteria,
        data: input.intake.data,
        nonces: input.nonces(seat, i),
        ...(input.template ? { template: input.template } : {}),
        ...(input.maxDataChars !== undefined ? { maxDataChars: input.maxDataChars } : {}),
        ...(input.sampleSeed ? { sample: { seed: input.sampleSeed(seat, i), mime: input.intake.mime } } : {}),
      });
      if (!prompt.ok) return `prompt for ${seat.judgeId}: ${prompt.error}`;
      const p = prompt.value;
      const member: PanelMember = {
        judgeId: seat.judgeId,
        provider: seat.provider,
        family,
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
      const none = { family, verdict: null };
      if (res.kind !== 'ok') return { member: { ...member, status: res.kind }, verdict: none, canaryEcho: false, strided: p.sampling === 'stride' };
      if (res.latencyMs !== undefined) member.latencyMs = res.latencyMs;
      const parsed = parseVerdict(res.text, { criterionIds: rubricIds, canary: p.canary, rationaleMaxChars: policy.rationaleMaxChars });
      if (parsed.status === 'abstain') {
        return { member: { ...member, status: 'abstain' }, verdict: none, canaryEcho: parsed.reason === 'canary_echo', filtered: parsed.reason, strided: p.sampling === 'stride' };
      }
      const status = parsed.verdict.overall === 'abstain' ? 'abstain' : 'ok';
      return { member: { ...member, status, verdict: parsed.verdict }, verdict: { family, verdict: parsed.verdict }, canaryEcho: false, strided: p.sampling === 'stride' };
    }),
  );
  const refused = results.find((r): r is string => typeof r === 'string');
  if (refused) return err(problem('invalid_terms', refused));
  const rs = results as SeatResult[];

  const canarySignals = rs.filter((r) => r.canaryEcho).map((r) => ({ kind: 'canary_echo' as const, detail: `judge ${r.member.judgeId} echoed its canary` }));
  const finalScreen: ScreenResult = { flagged: baseScreen.flagged || canarySignals.length > 0, signals: [...baseScreen.signals, ...canarySignals] };
  // A filter abstention could be induced by the seller, so it escalates rather than shrinking the panel.
  const escalate = rs.filter((r) => r.filtered).map((r) => `judge ${r.member.judgeId} output rejected by a filter (${r.filtered})`);
  // A seeded sample is recomputable and unpredictable to the seller; only the even-stride fallback escalates.
  if (rs.some((r) => r.strided)) escalate.push('the judges saw a sample of the deliverable, not all of it');
  const agg = aggregate({ checks: deterministic, rubric: acceptance.rubric, screenFlagged: finalScreen.flagged, verdicts: rs.map((r) => r.verdict), thresholds, escalate });
  return ok({ ...base, screen: finalScreen, panel: { ran: true, members: rs.map((r) => r.member) }, aggregate: agg });
}
