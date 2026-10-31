// Adjudicator-side providers (T-009): the judge timeout, routing by provider, and the live providers'
// refusal without keys. No test here makes a network call; the live request path is not exercised.
import { canonicalJson } from '@holdback/core';
import { fakeProvider, recordedProvider, type JudgeProvider, type JudgeRecording, type JudgeRequest } from '@holdback/judgment';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { liveProvider, LIVE_KEY_ENV } from './live.js';
import { routeByProvider, withTimeout } from './timeout.js';

const req = (over: Partial<JudgeRequest> = {}): JudgeRequest => ({
  judgeId: 'claude-a',
  provider: 'anthropic',
  model: 'claude-a-model-20260601',
  system: 'rules',
  user: 'data',
  temperature: 0,
  maxOutputTokens: 2048,
  ...over,
});
const inputHash = (r: JudgeRequest): `0x${string}` => `0x${createHash('sha256').update(canonicalJson({ system: r.system, user: r.user })).digest('hex')}`;

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
