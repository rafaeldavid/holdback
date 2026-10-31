// Judge providers (T-009): fake and recorded. No network.
import { canonicalJson } from '@holdback/core';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { JudgeProvider, JudgeRequest } from '../pipeline.js';
import { parseVerdict } from '../verdict.js';
import { fakeProvider, honestVerdict } from './fake.js';
import { recordedProvider, recorder, type JudgeRecording } from './recorded.js';

const SYSTEM = 'rules...\n6. "criteria" must contain each of these ids exactly once: dedupe_quality, no_fabrication.\n7. ...';
const req = (over: Partial<JudgeRequest> = {}): JudgeRequest => ({
  judgeId: 'claude-a',
  provider: 'anthropic',
  model: 'claude-a-model-20260601',
  system: SYSTEM,
  user: 'data',
  temperature: 0,
  maxOutputTokens: 2048,
  ...over,
});
const inputHash = (r: JudgeRequest): `0x${string}` => `0x${createHash('sha256').update(canonicalJson({ system: r.system, user: r.user })).digest('hex')}`;

describe('fake provider', () => {
  it('answers a schema-valid verdict over the criterion ids named in the prompt', async () => {
    const res = await fakeProvider().complete(req());
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const v = parseVerdict(res.text, { criterionIds: ['dedupe_quality', 'no_fabrication'], canary: 'c'.repeat(32), rationaleMaxChars: 600 });
    expect(v.status).toBe('ok');
    expect(v.status === 'ok' && v.verdict.overall).toBe('pass');
  });
  it('follows a per-judge script', async () => {
    const p = fakeProvider({ 'gpt-a': (r) => honestVerdict(r, 'fail', 1), 'qwen-a': 'timeout' });
    const fail = await p.complete(req({ judgeId: 'gpt-a' }));
    expect(fail.kind === 'ok' && JSON.parse(fail.text).overall).toBe('fail');
    expect(await p.complete(req({ judgeId: 'qwen-a' }))).toEqual({ kind: 'timeout' });
  });
});

describe('recorded provider', () => {
  it('replays only for the same model and the same rendered input', async () => {
    const rec: JudgeRecording = { judgeId: 'claude-a', model: 'claude-a-model-20260601', inputHash: inputHash(req()), text: '{"x":1}', latencyMs: 812 };
    const p = recordedProvider([rec]);
    expect(await p.complete(req())).toEqual({ kind: 'ok', text: '{"x":1}', latencyMs: 812 });
    const other = await p.complete(req({ user: 'other data' }));
    expect(other.kind === 'error' && !other.transport).toBe(true);
    const otherModel = await p.complete(req({ model: 'claude-b-model-20260601' }));
    expect(otherModel.kind).toBe('error');
  });
  it('a recorder captures what an inner provider answered, for replay', async () => {
    const r = recorder(fakeProvider());
    const first = await r.provider.complete(req());
    expect(r.recordings).toHaveLength(1);
    expect(r.recordings[0]!.inputHash).toBe(inputHash(req()));
    expect(await recordedProvider(r.recordings).complete(req())).toEqual(first);
  });
});

