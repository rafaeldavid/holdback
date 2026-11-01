// Adjudicator-side providers (T-009, T-028): the judge timeout, routing by provider, the live providers' refusal
// without keys, and the live request shape against a stubbed fetch. No test here makes a network call.
import { canonicalJson } from '@holdback/core';
import { fakeProvider, recordedProvider, type JudgeProvider, type JudgeRecording, type JudgeRequest } from '@holdback/judgment';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LIVE_ENV, LIVE_KEY_ENV, LIVE_MAX_OUTPUT_TOKENS, liveJudges, liveProvider, missingLiveEnv, OPENAI_COMPATIBLE_BASE_URL_ENV, providerModelId, type JudgeUsage } from './live.js';
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
  it('liveJudges names every missing variable, and never a value', () => {
    expect(missingLiveEnv({})).toEqual([...LIVE_ENV]);
    const partial = { [LIVE_KEY_ENV.anthropic]: 'secret-value-a' };
    const r = liveJudges(partial);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain(LIVE_KEY_ENV['openai-compatible']);
    expect(r.error).toContain(OPENAI_COMPATIBLE_BASE_URL_ENV);
    expect(r.error).not.toContain(LIVE_KEY_ENV.anthropic);
    expect(r.error).not.toContain('secret-value-a');
  });
});

describe('live request shape (stubbed fetch)', () => {
  const env = { [LIVE_KEY_ENV.anthropic]: 'ka', [LIVE_KEY_ENV['openai-compatible']]: 'ko', [OPENAI_COMPATIBLE_BASE_URL_ENV]: 'https://api.example.test/' };
  const capture = () => {
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url, headers: init.headers as Record<string, string>, body });
      const anthropic = url.includes('anthropic');
      const json = anthropic
        ? { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"v":1}' }], usage: { input_tokens: 120, output_tokens: 30 } }
        : { choices: [{ message: { content: '{"v":2}' } }], usage: { prompt_tokens: 110, completion_tokens: 40 } };
      return new Response(JSON.stringify(json), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    return { calls, fetch };
  };

  it('strips only an @date suffix to get the provider model ID', () => {
    expect(providerModelId('claude-sonnet-5-5@2026-09-28')).toBe('claude-sonnet-5-5');
    expect(providerModelId('deepseek-flash@2026-11-01')).toBe('deepseek-flash');
    expect(providerModelId('placeholder-claude-a-20260601')).toBe('placeholder-claude-a-20260601');
    expect(providerModelId('claude-x@20250929')).toBe('claude-x@20250929');
  });

  it('Anthropic: provider model ID, no sampling parameters, low effort, capped output, usage reported', async () => {
    const { calls, fetch } = capture();
    const usage: JudgeUsage[] = [];
    const p = liveProvider('anthropic', env, { fetch, maxOutputTokens: 1000, onUsage: (u) => usage.push(u) });
    if (!p.ok) throw new Error(p.error);
    const res = await p.value.complete(req({ model: 'claude-sonnet-5-5@2026-09-28', maxOutputTokens: 4096 }));
    expect(res).toEqual({ kind: 'ok', text: '{"v":1}' });
    const b = calls[0]!.body;
    expect(b['model']).toBe('claude-sonnet-5-5');
    expect(b['max_tokens']).toBe(1000);
    expect(b).not.toHaveProperty('temperature');
    expect(b['output_config']).toEqual({ effort: 'low' });
    expect(b).not.toHaveProperty('tools');
    expect(b['system']).toBe('rules');
    expect(usage).toEqual([{ provider: 'anthropic', model: 'claude-sonnet-5-5@2026-09-28', inputTokens: 120, outputTokens: 30 }]);
  });

  it('OpenAI-compatible: base URL, temperature 0, capped output at the default cap, usage reported', async () => {
    const { calls, fetch } = capture();
    const usage: JudgeUsage[] = [];
    const p = liveProvider('openai-compatible', env, { fetch, onUsage: (u) => usage.push(u) });
    if (!p.ok) throw new Error(p.error);
    const res = await p.value.complete(req({ provider: 'openai-compatible', model: 'deepseek-flash@2026-11-01', maxOutputTokens: 100_000 }));
    expect(res).toEqual({ kind: 'ok', text: '{"v":2}' });
    expect(calls[0]!.url).toBe('https://api.example.test/chat/completions');
    const b = calls[0]!.body;
    expect(b['model']).toBe('deepseek-flash');
    expect(b['temperature']).toBe(0);
    expect(b['max_tokens']).toBe(LIVE_MAX_OUTPUT_TOKENS);
    expect(b).not.toHaveProperty('tools');
    expect(b).not.toHaveProperty('thinking');
    expect(usage[0]).toEqual({ provider: 'openai-compatible', model: 'deepseek-flash@2026-11-01', inputTokens: 110, outputTokens: 40 });
  });

  it('turns DeepSeek thinking off on api.deepseek.com only', async () => {
    const { calls, fetch } = capture();
    const p = liveProvider('openai-compatible', { ...env, [OPENAI_COMPATIBLE_BASE_URL_ENV]: 'https://api.deepseek.com' }, { fetch });
    if (!p.ok) throw new Error(p.error);
    await p.value.complete(req({ provider: 'openai-compatible', model: 'deepseek-v4-pro@2026-11-01' }));
    expect(calls[0]!.url).toBe('https://api.deepseek.com/chat/completions');
    expect(calls[0]!.body['thinking']).toEqual({ type: 'disabled' });
  });

  it('liveJudges routes by provider and applies the timeout', async () => {
    const { calls, fetch } = capture();
    const r = liveJudges(env, { fetch, timeoutMs: 1000 });
    if (!r.ok) throw new Error(r.error);
    await r.value.complete(req({ model: 'claude-opus-5-5@2026-09-21' }));
    const res = await r.value.complete(req({ provider: 'openai-compatible', model: 'deepseek-v4-pro@2026-11-01' }));
    expect(calls.map((c) => c.body['model'])).toEqual(['claude-opus-5-5', 'deepseek-v4-pro']);
    expect(res.kind === 'ok' && typeof res.latencyMs).toBe('number');
  });
});
