// Recorded judges: verdicts replayed from fixtures/recordings/<scenario>/<judgeId>.json.
// A recording is bound to the pinned model ID, the prompt template hash, the rubric hash and the hash
// of the exact judge input. If any of them changes, the verdict no longer answers the question being
// asked, so the provider throws instead of replaying it (docs/testing.md, Recorded judges).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseJudgeVerdict, type Hex32, type JudgeVerdict } from '@holdback/core';

export const RECORDING_FORMAT = 'holdback.recording/v0';

/** What a panel member is asked: who answers, with which template and rubric, about which input. */
export interface JudgeRequest {
  scenario: string;
  judgeId: string;
  provider: string;
  family: string;
  /** Pinned model ID, never an alias such as "latest". */
  model: string;
  promptTemplateHash: Hex32;
  inputHash: Hex32;
  rubricHash: Hex32;
}

export type CapturedFrom = 'live' | 'fake';

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
const KEYS = ['format', 'scenario', 'judgeId', ...BOUND, 'capturedFrom', 'verdict'];

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
  constructor(readonly path: string) {
    super(`refusing to overwrite ${path}: it holds a live-captured verdict, and a fake verdict must never replace it. Delete it deliberately if you mean to.`);
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

export function recordingPath(dir: string, scenario: string, judgeId: string): string {
  for (const [what, v] of [
    ['scenario', scenario],
    ['judgeId', judgeId],
  ] as const) {
    if (!ID.test(v) || v.includes('..')) throw new RangeError(`invalid ${what} "${v}" for a recording path`);
  }
  return join(dir, scenario, `${judgeId}.json`);
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
  const path = recordingPath(dir, recording.scenario, recording.judgeId);
  if (recording.capturedFrom === 'fake' && existsSync(path)) {
    let existing: unknown;
    try {
      existing = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      existing = null;
    }
    // Anything not provably fake is treated as live and kept.
    if (typeof existing !== 'object' || existing === null || (existing as { capturedFrom?: unknown }).capturedFrom !== 'fake') throw new RecordingOverwriteError(path);
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
  if (r.format !== RECORDING_FORMAT) throw new RecordingInvalidError(path, `format must be "${RECORDING_FORMAT}"`);
  for (const k of ['scenario', 'judgeId', 'provider', 'family', 'model']) {
    if (typeof r[k] !== 'string' || r[k] === '') throw new RecordingInvalidError(path, `${k} must be a non-empty string`);
  }
  if (FLOATING.test(r.model as string)) throw new RecordingInvalidError(path, `model "${String(r.model)}" is a floating alias; recordings need a pinned model ID`);
  for (const k of ['promptTemplateHash', 'inputHash', 'rubricHash']) {
    if (typeof r[k] !== 'string' || !HASH.test(r[k])) throw new RecordingInvalidError(path, `${k} must be a 0x-prefixed 32-byte lowercase hex hash`);
  }
  if (r.capturedFrom !== 'live' && r.capturedFrom !== 'fake') throw new RecordingInvalidError(path, 'capturedFrom must be "live" or "fake"');
  if (r.scenario !== request.scenario || r.judgeId !== request.judgeId) {
    throw new RecordingInvalidError(path, `filed under ${request.scenario}/${request.judgeId} but records ${String(r.scenario)}/${String(r.judgeId)}`);
  }
  const verdict = parseJudgeVerdict(r.verdict);
  if (!verdict.ok) throw new RecordingInvalidError(path, `verdict does not match judge-verdict.schema.json: ${verdict.error.detail}`);
  return { ...(r as unknown as Recording), verdict: verdict.value };
}

export class RecordedJudges implements JudgeProvider {
  readonly kind = 'recorded';
  constructor(readonly dir: string) {}

  judge(request: JudgeRequest): JudgeResult {
    assertPinned(request.model);
    const path = recordingPath(this.dir, request.scenario, request.judgeId);
    const rec = readRecording(path, request);
    const mismatches = BOUND.filter((f) => rec[f] !== request[f]).map((field) => ({ field, recorded: rec[field], requested: request[field] }));
    if (mismatches.length) throw new RecordingMismatchError(path, mismatches, request);
    return { status: 'recorded', verdict: rec.verdict, capturedFrom: rec.capturedFrom };
  }
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

/** Wraps a provider and writes each verdict it returns as a recording. */
export class RecordingJudges implements JudgeProvider {
  constructor(
    private readonly inner: FakeJudges,
    private readonly dir: string,
  ) {}
  get kind(): 'fake' {
    return this.inner.kind;
  }
  judge(request: JudgeRequest): JudgeResult {
    const result = this.inner.judge(request);
    writeRecording(this.dir, toRecording(request, result.verdict, 'fake'));
    return result;
  }
}
