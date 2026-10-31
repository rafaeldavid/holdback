// Live judge providers: Anthropic Messages and OpenAI-compatible chat completions. Keys come from
// environment variables only, and a provider refuses to exist without one. Requests carry the pinned
// model, the two prompt strings, temperature 0 and an output cap; never tools, never URLs to fetch.
// Not exercised in tests or CI: recorded and fake providers stand in (docs/testing.md).
import { err, ok, type Result } from '@holdback/core';
import type { JudgeProvider, JudgeRequest, JudgeResponse } from '@holdback/judgment';
import type { RegistryProvider } from '@holdback/judgment';

export const LIVE_KEY_ENV: Readonly<Record<RegistryProvider, string>> = {
  anthropic: 'HOLDBACK_ANTHROPIC_API_KEY',
  'openai-compatible': 'HOLDBACK_OPENAI_COMPATIBLE_API_KEY',
};
export const OPENAI_COMPATIBLE_BASE_URL_ENV = 'HOLDBACK_OPENAI_COMPATIBLE_BASE_URL';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

type Env = Readonly<Record<string, string | undefined>>;

async function post(url: string, headers: Record<string, string>, body: unknown, read: (json: unknown) => string | undefined): Promise<JudgeResponse> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    return { kind: 'error', transport: true, detail: 'network error' };
  }
  if (res.status === 429 || res.status >= 500) return { kind: 'error', transport: true, detail: `HTTP ${res.status}` };
  if (!res.ok) return { kind: 'error', transport: false, detail: `HTTP ${res.status}` };
  const text = read(await res.json().catch(() => undefined));
  return text === undefined ? { kind: 'error', transport: false, detail: 'no text in the response' } : { kind: 'ok', text };
}

const anthropic = (key: string): JudgeProvider => ({
  complete: (r: JudgeRequest) =>
    post(
      ANTHROPIC_URL,
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model: r.model, system: r.system, messages: [{ role: 'user', content: r.user }], temperature: r.temperature, max_tokens: r.maxOutputTokens },
      (j) => {
        const c = (j as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
        return c?.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      },
    ),
});

const openaiCompatible = (key: string, baseUrl: string): JudgeProvider => ({
  complete: (r: JudgeRequest) =>
    post(
      `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      { authorization: `Bearer ${key}` },
      { model: r.model, messages: [{ role: 'system', content: r.system }, { role: 'user', content: r.user }], temperature: r.temperature, max_tokens: r.maxOutputTokens },
      (j) => (j as { choices?: Array<{ message?: { content?: string } }> } | undefined)?.choices?.[0]?.message?.content,
    ),
});

/** A live provider, or the reason it cannot run (no key, no base URL). */
export function liveProvider(kind: RegistryProvider, env: Env): Result<JudgeProvider, string> {
  const key = env[LIVE_KEY_ENV[kind]];
  if (!key) return err(`live ${kind} judges need ${LIVE_KEY_ENV[kind]} in the environment; use recorded or fake judges instead`);
  if (kind === 'anthropic') return ok(anthropic(key));
  const base = env[OPENAI_COMPATIBLE_BASE_URL_ENV];
  if (!base || !base.startsWith('https://')) return err(`live openai-compatible judges need an https ${OPENAI_COMPATIBLE_BASE_URL_ENV}`);
  return ok(openaiCompatible(key, base));
}
