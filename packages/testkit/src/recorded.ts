// Recorded judges: verdicts replayed from fixtures/recordings/<scenario>/<role>/<judgeId>.json.
// The role (primary, fallback, appeal) is part of the key, so a primary panel and an appeal panel in one
// scenario can seat the same judge and still give different verdicts.
// A recording is bound to the pinned model ID, the prompt template hash, the rubric hash and the hash
// of the exact judge input. If any of them changes, the verdict no longer answers the question being
// asked, so the provider throws instead of replaying it (docs/testing.md, Recorded judges).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseJudgeVerdict, type Hex32, type JudgeVerdict } from '@holdback/core';
import { APPEAL_PROMPT_TEMPLATE_HASH } from '@holdback/judgment';

export const RECORDING_FORMAT = 'holdback.recording/v1';
/** The first format: no role, filed under <scenario>/<judgeId>.json. Read only by the migration. */
export const RECORDING_FORMAT_V0 = 'holdback.recording/v0';

export type JudgeRole = 'primary' | 'fallback' | 'appeal';
export const JUDGE_ROLES: readonly JudgeRole[] = ['primary', 'fallback', 'appeal'];

/** What a panel member is asked: who answers, with which template and rubric, about which input. */
export interface JudgeRequest {
  scenario: string;
  /** The adjudicator role whose panel this judge sits on. */
  role: JudgeRole;
  judgeId: string;
  provider: string;
  family: string;
  /** Pinned model ID, never an alias such as "latest". */
  model: string;
  promptTemplateHash: Hex32;
  inputHash: Hex32;
  rubricHash: Hex32;
}

/**
 * live: a model's answer. fake: the fixed passing verdict of FakeJudges. authored: a verdict a fixture author
 * wrote by hand to set up a scenario (a split panel, an abstention). Fake capture never overwrites live or
 * authored recordings.
 */
export type CapturedFrom = 'live' | 'fake' | 'authored';
const CAPTURED_FROM: readonly CapturedFrom[] = ['live', 'fake', 'authored'];

export interface Recording extends JudgeRequest {
  format: typeof RECORDING_FORMAT;
  capturedFrom: CapturedFrom;
  verdict: JudgeVerdict;
}

export interface JudgeResult {
  status: 'ok' | 'recorded';
  verdict: JudgeVerdict;
  capturedFrom?: CapturedFrom;
}

/** A source of verdicts. Synchronous: recorded and fake judges never touch the network. */
export interface JudgeProvider {
  readonly kind: 'recorded' | 'fake';
  judge(request: JudgeRequest): JudgeResult;
}

const HASH = /^0x[0-9a-f]{64}$/;
const ID = /^[a-z0-9_][a-z0-9._-]*$/;
const FLOATING = /latest/i;
/** Everything a verdict answered. A recording replays only when all of these match the request. */
const BOUND = ['provider', 'family', 'model', 'promptTemplateHash', 'inputHash', 'rubricHash'] as const;
const KEYS = ['format', 'scenario', 'role', 'judgeId', ...BOUND, 'capturedFrom', 'verdict'];

/** The re-record command this build can run. Live capture needs live providers in the testkit and model keys. */
function rerecordHint(scenario: string): string {
  return `Re-record stub verdicts with: pnpm snap --judges fake --record --update ${scenario}, then pnpm snap --update ${scenario}. Live capture (--judges live --record) is not wired into the testkit yet (it needs model keys).`;
}

export class RecordingMissingError extends Error {
  override name = 'RecordingMissingError';
  constructor(readonly path: string, request: JudgeRequest) {
    super(
      `no recorded verdict for judge ${request.judgeId} in scenario ${request.scenario}: ${path} does not exist. ` +
        rerecordHint(request.scenario),
    );
  }
}

export class RecordingInvalidError extends Error {
  override name = 'RecordingInvalidError';
  constructor(readonly path: string, reason: string) {
    super(`recording ${path} is invalid: ${reason}`);
  }
}

export class RecordingOverwriteError extends Error {
  override name = 'RecordingOverwriteError';
  constructor(
    readonly path: string,
    existing: string = 'live',
    mismatches: readonly Mismatch[] = [],
  ) {
    super(
      [
        `refusing to overwrite ${path}: it holds ${existing === 'authored' ? 'an authored' : 'a live-captured'} verdict, and a fake verdict must never replace it.`,
        ...(mismatches.length
          ? [
              'It no longer matches the judge input:',
              ...mismatches.map((m) => `  ${m.field}: recorded ${m.recorded}, requested ${m.requested}`),
              existing === 'authored' ? 'Re-author it: copy the requested values into the file and check the verdict still makes sense for the new input.' : 'Re-capture it live, or delete it deliberately.',
            ]
          : ['Delete it deliberately if you mean to.']),
      ].join('\n'),
    );
  }
}

export interface Mismatch {
  field: (typeof BOUND)[number];
  recorded: string;
  requested: string;
}

export class RecordingMismatchError extends Error {
  override name = 'RecordingMismatchError';
  constructor(readonly path: string, readonly mismatches: Mismatch[], request: JudgeRequest) {
    super(
      [
        `recorded verdict is stale for judge ${request.judgeId} in scenario ${request.scenario} (${path}):`,
        ...mismatches.map((m) => `  ${m.field}: recorded ${m.recorded}, requested ${m.requested}`),
        'The provider, family, model, prompt template, rubric or judge input changed since this verdict was recorded; replaying it would judge a different question. The runner never substitutes another verdict.',
        rerecordHint(request.scenario),
      ].join('\n'),
    );
  }
}

export function recordingPath(dir: string, scenario: string, role: JudgeRole, judgeId: string): string {
  for (const [what, v] of [
    ['scenario', scenario],
    ['judgeId', judgeId],
  ] as const) {
    if (!ID.test(v) || v.includes('..')) throw new RangeError(`invalid ${what} "${v}" for a recording path`);
  }
  if (!JUDGE_ROLES.includes(role)) throw new RangeError(`invalid role "${String(role)}" for a recording path`);
  return join(dir, scenario, role, `${judgeId}.json`);
}

function assertPinned(model: string): void {
  if (model === '' || FLOATING.test(model)) throw new RangeError(`judge model must be a pinned model ID, not "${model}"`);
}

export function toRecording(request: JudgeRequest, verdict: JudgeVerdict, capturedFrom: CapturedFrom): Recording {
  return { format: RECORDING_FORMAT, ...request, capturedFrom, verdict };
}

/** Writes a recording as stable, reviewable JSON (fixed key order, trailing newline). */
export function writeRecording(dir: string, recording: Recording): string {
  assertPinned(recording.model);
  const path = recordingPath(dir, recording.scenario, recording.role, recording.judgeId);
  if (recording.capturedFrom === 'fake' && existsSync(path)) {
    let existing: unknown;
    try {
      existing = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      existing = null;
    }
    // Anything not provably fake is treated as live or authored and kept.
    const from = typeof existing === 'object' && existing !== null ? (existing as { capturedFrom?: unknown }).capturedFrom : undefined;
    if (from !== 'fake') throw new RecordingOverwriteError(path, from === 'authored' ? 'authored' : 'live');
  }
  const ordered = Object.fromEntries(KEYS.map((k) => [k, recording[k as keyof Recording]]));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`);
  return path;
}

function readRecording(path: string, request: JudgeRequest): Recording {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new RecordingMissingError(path, request);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new RecordingInvalidError(path, `not JSON (${(e as Error).message})`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new RecordingInvalidError(path, 'not an object');
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!KEYS.includes(k)) throw new RecordingInvalidError(path, `unknown key "${k}"`);
  if (r.format === RECORDING_FORMAT_V0) throw new RecordingInvalidError(path, `format ${RECORDING_FORMAT_V0} has no role; run pnpm snap --migrate-recordings`);
  if (r.format !== RECORDING_FORMAT) throw new RecordingInvalidError(path, `format must be "${RECORDING_FORMAT}"`);
  for (const k of ['scenario', 'judgeId', 'provider', 'family', 'model']) {
    if (typeof r[k] !== 'string' || r[k] === '') throw new RecordingInvalidError(path, `${k} must be a non-empty string`);
  }
  if (FLOATING.test(r.model as string)) throw new RecordingInvalidError(path, `model "${String(r.model)}" is a floating alias; recordings need a pinned model ID`);
  for (const k of ['promptTemplateHash', 'inputHash', 'rubricHash']) {
    if (typeof r[k] !== 'string' || !HASH.test(r[k])) throw new RecordingInvalidError(path, `${k} must be a 0x-prefixed 32-byte lowercase hex hash`);
  }
  if (!CAPTURED_FROM.includes(r.capturedFrom as CapturedFrom)) throw new RecordingInvalidError(path, 'capturedFrom must be "live", "fake" or "authored"');
  if (r.scenario !== request.scenario || r.role !== request.role || r.judgeId !== request.judgeId) {
    throw new RecordingInvalidError(path, `filed under ${request.scenario}/${request.role}/${request.judgeId} but records ${String(r.scenario)}/${String(r.role)}/${String(r.judgeId)}`);
  }
  const verdict = parseJudgeVerdict(r.verdict);
  if (!verdict.ok) throw new RecordingInvalidError(path, `verdict does not match judge-verdict.schema.json: ${verdict.error.detail}`);
  return { ...(r as unknown as Recording), verdict: verdict.value };
}

const mismatchesOf = (rec: Recording, request: JudgeRequest): Mismatch[] =>
  BOUND.filter((f) => rec[f] !== request[f]).map((field) => ({ field, recorded: rec[field], requested: request[field] }));

export class RecordedJudges implements JudgeProvider {
  readonly kind = 'recorded';
  constructor(readonly dir: string) {}

  judge(request: JudgeRequest): JudgeResult {
    assertPinned(request.model);
    const path = recordingPath(this.dir, request.scenario, request.role, request.judgeId);
    const rec = readRecording(path, request);
    const mismatches = mismatchesOf(rec, request);
    if (mismatches.length) throw new RecordingMismatchError(path, mismatches, request);
    return { status: 'recorded', verdict: rec.verdict, capturedFrom: rec.capturedFrom };
  }
}

export interface Migrated {
  from: string;
  to: string;
  role: JudgeRole;
}

/**
 * Moves v0 recordings (<scenario>/<judgeId>.json) to <scenario>/<role>/<judgeId>.json (v1).
 * A v0 recording names no role: one bound to the appeal template becomes an appeal recording, any other a
 * primary one. Nothing else in the file changes, so a recording that was stale stays stale, and a fallback
 * recording filed as primary fails loudly (missing) on its next run instead of replaying. Idempotent.
 */
export function migrateRecordings(dir: string): Migrated[] {
  const moved: Migrated[] = [];
  if (!existsSync(dir)) return moved;
  for (const scenario of readdirSync(dir).sort()) {
    const sdir = join(dir, scenario);
    if (!statSync(sdir).isDirectory()) continue;
    for (const file of readdirSync(sdir).sort()) {
      const from = join(sdir, file);
      if (!file.endsWith('.json') || !statSync(from).isFile()) continue;
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(readFileSync(from, 'utf8')) as Record<string, unknown>;
      } catch (e) {
        throw new RecordingInvalidError(from, `not JSON (${(e as Error).message})`);
      }
      if (raw.format !== RECORDING_FORMAT_V0) throw new RecordingInvalidError(from, `expected format ${RECORDING_FORMAT_V0} directly under the scenario directory`);
      const role: JudgeRole = raw.promptTemplateHash === APPEAL_PROMPT_TEMPLATE_HASH ? 'appeal' : 'primary';
      const rec = { ...raw, format: RECORDING_FORMAT, role } as unknown as Recording;
      const to = recordingPath(dir, String(raw.scenario), role, String(raw.judgeId));
      if (existsSync(to)) throw new RecordingOverwriteError(to);
      const ordered = Object.fromEntries(KEYS.map((k) => [k, rec[k as keyof Recording]]));
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, `${JSON.stringify(ordered, null, 2)}\n`);
      unlinkSync(from);
      moved.push({ from, to, role });
    }
  }
  return moved;
}

/** Fake judges: a fixed passing verdict for every criterion. For stubs and for capturing stub recordings. */
export class FakeJudges implements JudgeProvider {
  readonly kind = 'fake';
  constructor(private readonly criteria: readonly string[]) {}

  judge(request: JudgeRequest): JudgeResult {
    assertPinned(request.model);
    return {
      status: 'ok',
      verdict: {
        criteria: this.criteria.map((id) => ({ id, score: 4, evidence: 'fake judge: fixed score' })),
        overall: 'pass',
        injectionSuspected: false,
        rationale: 'fake judge: fixed passing verdict, not a model output',
      },
    };
  }
}

/**
 * Wraps a provider and writes each verdict it returns as a recording. A live or authored recording already
 * on file is never overwritten: if it still answers this request it is replayed, otherwise the run stops
 * with the bindings that changed.
 */
export class RecordingJudges implements JudgeProvider {
  constructor(
    private readonly inner: FakeJudges,
    private readonly dir: string,
  ) {}
  get kind(): 'fake' {
    return this.inner.kind;
  }
  judge(request: JudgeRequest): JudgeResult {
    const path = recordingPath(this.dir, request.scenario, request.role, request.judgeId);
    if (existsSync(path)) {
      const rec = readRecording(path, request);
      if (rec.capturedFrom !== 'fake') {
        const mismatches = mismatchesOf(rec, request);
        if (mismatches.length) throw new RecordingOverwriteError(path, rec.capturedFrom, mismatches);
        return { status: 'recorded', verdict: rec.verdict, capturedFrom: rec.capturedFrom };
      }
    }
    const result = this.inner.judge(request);
    writeRecording(this.dir, toRecording(request, result.verdict, 'fake'));
    return result;
  }
}
