// Judge providers (T-009): fake, recorded, the timeout wrapper, routing, and the live providers' refusal
// without keys. No test here makes a network call; the live request path is not exercised.
import { canonicalJson } from '@holdback/core';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { JudgeProvider, JudgeRequest } from '../pipeline.js';
import { parseVerdict } from '../verdict.js';
import { fakeProvider, honestVerdict } from './fake.js';
import { liveProvider, LIVE_KEY_ENV } from './live.js';
import { recordedProvider, recorder, type JudgeRecording } from './recorded.js';
import { routeByProvider, withTimeout } from './timeout.js';

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
const inputHash = (r: JudgeRequest) => `0x${createHash('sha256').update(canonicalJson({ system: r.system, user: r.user })).digest('hex')}`;

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

describe('timeout wrapper', () => {
  const slow: JudgeProvider = { complete: () => new Promise((resolve) => setTimeout(() => resolve({ kind: 'ok', text: 'late' }), 200)) };
  it('abstains as a timeout after the policy timeout', async () => {
    expect(await withTimeout(slow, 20).complete(req())).toEqual({ kind: 'timeout' });
  });
  it('passes a fast answer through and records its latency', async () => {
    const res = await withTimeout(fakeProvider(), 1000).complete(req());
    expect(res.kind).toBe('ok');
    expect(res.kind === 'ok' && typeof res.latencyMs).toBe('number');
  });
  it('keeps a recorded latency instead of measuring the replay', async () => {
    const rec: JudgeRecording = { judgeId: 'claude-a', model: 'claude-a-model-20260601', inputHash: inputHash(req()), text: 't', latencyMs: 812 };
    expect(await withTimeout(recordedProvider([rec]), 1000).complete(req())).toEqual({ kind: 'ok', text: 't', latencyMs: 812 });
  });
});

describe('routing by provider', () => {
  it('sends each request to the provider its seat names, and refuses unknown providers', async () => {
    const seen: string[] = [];
    const tag = (name: string): JudgeProvider => ({ complete: async () => (seen.push(name), { kind: 'timeout' }) });
    const p = routeByProvider({ anthropic: tag('a'), 'openai-compatible': tag('o') });
    await p.complete(req());
    await p.complete(req({ provider: 'openai-compatible' }));
    expect(seen).toEqual(['a', 'o']);
    const res = await p.complete(req({ provider: 'google' }));
    expect(res.kind === 'error' && !res.transport).toBe(true);
  });
});

describe('live providers refuse without keys', () => {
  it.each(['anthropic', 'openai-compatible'] as const)('%s', (kind) => {
    const r = liveProvider(kind, {});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(LIVE_KEY_ENV[kind]);
  });
  it('openai-compatible also needs a base URL', () => {
    const r = liveProvider('openai-compatible', { [LIVE_KEY_ENV['openai-compatible']]: 'k' });
    expect(r.ok).toBe(false);
  });
});
