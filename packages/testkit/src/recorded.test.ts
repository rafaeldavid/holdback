import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JudgeVerdict } from '@holdback/core';
import { RecordedJudges, RecordingInvalidError, RecordingMismatchError, RecordingMissingError, RecordingOverwriteError, recordingPath, toRecording, writeRecording, type JudgeRequest } from './recorded.js';

const h = (c: string) => `0x${c.repeat(64)}` as const;
const request: JudgeRequest = {
  scenario: 'demo',
  judgeId: 'claude-a',
  provider: 'anthropic',
  family: 'claude',
  model: 'claude-pinned-2026-10-01',
  promptTemplateHash: h('1'),
  inputHash: h('2'),
  rubricHash: h('3'),
};
const verdict: JudgeVerdict = {
  criteria: [{ id: 'quality', score: 4, evidence: 'ok' }],
  overall: 'pass',
  injectionSuspected: false,
  rationale: 'fine',
};

function dirWith(req: JudgeRequest = request, patch: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'rec-'));
  writeRecording(dir, toRecording(req, verdict, 'live'));
  if (Object.keys(patch).length) {
    const p = recordingPath(dir, req.scenario, req.judgeId);
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), ...patch }));
  }
  return dir;
}

function thrown(f: () => unknown): Error {
  try {
    f();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a throw');
}

describe('recorded judges', () => {
  it('stores model ID, prompt template hash and input hash next to the verdict', () => {
    const dir = dirWith();
    const saved = JSON.parse(readFileSync(recordingPath(dir, 'demo', 'claude-a'), 'utf8'));
    expect(saved).toMatchObject({ format: 'holdback.recording/v0', model: request.model, promptTemplateHash: h('1'), inputHash: h('2'), rubricHash: h('3'), capturedFrom: 'live' });
    expect(recordingPath(dir, 'demo', 'claude-a')).toBe(join(dir, 'demo', 'claude-a.json'));
  });

  it('replays the verdict when everything matches', () => {
    const r = new RecordedJudges(dirWith()).judge(request);
    expect(r).toEqual({ status: 'recorded', verdict, capturedFrom: 'live' });
  });

  for (const field of ['provider', 'family', 'model', 'promptTemplateHash', 'inputHash', 'rubricHash'] as const) {
    it(`fails loudly when ${field} differs`, () => {
      const changed = field === 'model' ? 'claude-pinned-2026-11-01' : field === 'provider' || field === 'family' ? `other-${field}` : h('9');
      const e = thrown(() => new RecordedJudges(dirWith()).judge({ ...request, [field]: changed }));
      expect(e).toBeInstanceOf(RecordingMismatchError);
      expect(e.name).toBe('RecordingMismatchError');
      expect(e.message).toContain(field);
      expect(e.message).toContain(changed);
      expect(e.message).toMatch(/stale/);
      expect(e.message).toMatch(/--record/);
      expect((e as RecordingMismatchError).mismatches.map((m) => m.field)).toEqual([field]);
    });
  }

  it('gives a re-record hint this build can run', () => {
    const e = thrown(() => new RecordedJudges(dirWith()).judge({ ...request, inputHash: h('9') }));
    expect(e.message).toContain('pnpm snap --judges fake --record --update demo');
    expect(e.message).not.toMatch(/Re-record with: pnpm snap --judges live/);
    const missing = thrown(() => new RecordedJudges(mkdtempSync(join(tmpdir(), 'rec-'))).judge(request));
    expect(missing.message).toContain('pnpm snap --judges fake --record --update demo');
    expect(missing.message).not.toMatch(/Capture one with: pnpm snap --judges live/);
  });

  it('never overwrites a live recording with a fake one', () => {
    const dir = dirWith();
    const before = readFileSync(recordingPath(dir, 'demo', 'claude-a'), 'utf8');
    const e = thrown(() => writeRecording(dir, toRecording(request, verdict, 'fake')));
    expect(e).toBeInstanceOf(RecordingOverwriteError);
    expect(e.message).toMatch(/live/);
    expect(readFileSync(recordingPath(dir, 'demo', 'claude-a'), 'utf8')).toBe(before);
    // A fake recording may replace a fake one.
    const fakeDir = mkdtempSync(join(tmpdir(), 'rec-'));
    writeRecording(fakeDir, toRecording(request, verdict, 'fake'));
    expect(() => writeRecording(fakeDir, toRecording(request, verdict, 'fake'))).not.toThrow();
  });

  it('lists every mismatching field at once', () => {
    const e = thrown(() => new RecordedJudges(dirWith()).judge({ ...request, model: 'other-pinned-1', inputHash: h('8') })) as RecordingMismatchError;
    expect(e.mismatches.map((m) => m.field)).toEqual(['model', 'inputHash']);
  });

  it('fails loudly when the recording is missing, naming the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const e = thrown(() => new RecordedJudges(dir).judge(request));
    expect(e).toBeInstanceOf(RecordingMissingError);
    expect(e.message).toContain(join(dir, 'demo', 'claude-a.json'));
  });

  it('rejects a recording whose verdict does not match the verdict schema', () => {
    const e = thrown(() => new RecordedJudges(dirWith(request, { verdict: { overall: 'maybe' } })).judge(request));
    expect(e).toBeInstanceOf(RecordingInvalidError);
  });

  it('rejects a recording with a floating model alias or a malformed hash', () => {
    expect(thrown(() => new RecordedJudges(dirWith(request, { model: 'claude-latest' })).judge(request))).toBeInstanceOf(RecordingInvalidError);
    expect(thrown(() => new RecordedJudges(dirWith(request, { inputHash: '0x12' })).judge(request))).toBeInstanceOf(RecordingInvalidError);
    expect(thrown(() => new RecordedJudges(dirWith(request, { format: 'v9' })).judge(request))).toBeInstanceOf(RecordingInvalidError);
    expect(thrown(() => new RecordedJudges(dirWith(request, { extra: 1 })).judge(request))).toBeInstanceOf(RecordingInvalidError);
  });

  it('refuses a request for a floating model alias before reading anything', () => {
    expect(() => new RecordedJudges('/nonexistent').judge({ ...request, model: 'latest' })).toThrow(/pinned/);
  });

  it('rejects a recording filed under the wrong scenario or judge', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    mkdirSync(join(dir, 'demo'), { recursive: true });
    writeFileSync(join(dir, 'demo', 'claude-a.json'), JSON.stringify(toRecording({ ...request, judgeId: 'claude-b' }, verdict, 'live')));
    expect(thrown(() => new RecordedJudges(dir).judge(request))).toBeInstanceOf(RecordingInvalidError);
  });

  it('refuses path traversal in scenario or judge IDs', () => {
    expect(() => recordingPath('/r', '../etc', 'x')).toThrow(/invalid/);
    expect(() => recordingPath('/r', 'demo', 'a/b')).toThrow(/invalid/);
  });
});
