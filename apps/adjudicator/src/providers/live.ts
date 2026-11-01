// Live judge providers: Anthropic Messages and OpenAI-compatible chat completions (T-009, T-028). Keys come from
// environment variables only, and a provider refuses to exist without one; a refusal names the variable, never
// a value. Requests carry the provider's model ID, the two prompt strings and an output cap; never tools, never
// URLs to fetch. Not exercised against a network in tests or CI: a stubbed fetch checks the request shape, and
// recorded and fake providers stand in elsewhere (docs/testing.md).
import { err, ok, type Result } from '@holdback/core';
import type { JudgeProvider, JudgeRequest, JudgeResponse } from '@holdback/judgment';
import type { RegistryProvider } from '@holdback/judgment';
import { routeByProvider, withTimeout } from './timeout.js';

export const LIVE_KEY_ENV: Readonly<Record<RegistryProvider, string>> = {
  anthropic: 'HOLDBACK_ANTHROPIC_API_KEY',
  'openai-compatible': 'HOLDBACK_OPENAI_COMPATIBLE_API_KEY',
};
export const OPENAI_COMPATIBLE_BASE_URL_ENV = 'HOLDBACK_OPENAI_COMPATIBLE_BASE_URL';
/** Every variable live judging needs, in the order a refusal names them. */
export const LIVE_ENV: readonly string[] = [LIVE_KEY_ENV.anthropic, LIVE_KEY_ENV['openai-compatible'], OPENAI_COMPATIBLE_BASE_URL_ENV];
/** The output-token cap per live judge call: a request asking for more is lowered to it. */
export const LIVE_MAX_OUTPUT_TOKENS = 2048;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

type Env = Readonly<Record<string, string | undefined>>;

/** Tokens one live call used, as the provider reported them. */
export interface JudgeUsage {
  provider: RegistryProvider;
  /** The registry's model ID (with its @date suffix). */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LiveOptions {
  /** Output-token cap per call. Default LIVE_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
  /** Called once per answered call with the provider's token counts. */
  onUsage?: (usage: JudgeUsage) => void;
  /** For tests. Default: the global fetch. */
  fetch?: typeof fetch;
}

/**
 * The provider's model ID for a registry model ID: a trailing "@YYYY-MM-DD" (the date the registry pinned it,
 * config/judges-live.yaml) is dropped; anything else is sent as it is.
 */
export const providerModelId = (model: string): string => model.replace(/@\d{4}-\d{2}-\d{2}$/, '');

const count = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0);

async function post(
  o: LiveOptions,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  read: (json: unknown) => { text: string | undefined; usage: [number, number] },
  usage: (input: number, output: number) => void,
): Promise<JudgeResponse> {
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    return { kind: 'error', transport: true, detail: 'network error' };
  }
  if (res.status === 429 || res.status >= 500) return { kind: 'error', transport: true, detail: `HTTP ${res.status}` };
  if (!res.ok) return { kind: 'error', transport: false, detail: `HTTP ${res.status}` };
  const r = read(await res.json().catch(() => undefined));
  usage(...r.usage);
  return r.text === undefined || r.text === '' ? { kind: 'error', transport: false, detail: 'no text in the response' } : { kind: 'ok', text: r.text };
}

const cap = (o: LiveOptions, r: JudgeRequest) => Math.min(r.maxOutputTokens, o.maxOutputTokens ?? LIVE_MAX_OUTPUT_TOKENS);
const report = (o: LiveOptions, provider: RegistryProvider, model: string) => (inputTokens: number, outputTokens: number) => o.onUsage?.({ provider, model, inputTokens, outputTokens });

// Current Claude models accept only the default sampling parameters (a temperature of 0 is a 400), so none is
// sent; effort low keeps adaptive thinking inside the output cap.
const anthropic = (key: string, o: LiveOptions): JudgeProvider => ({
  complete: (r: JudgeRequest) =>
    post(
      o,
      ANTHROPIC_URL,
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model: providerModelId(r.model), system: r.system, messages: [{ role: 'user', content: r.user }], max_tokens: cap(o, r), output_config: { effort: 'low' } },
      (j) => {
        const b = j as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: unknown; output_tokens?: unknown } } | undefined;
        return { text: b?.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''), usage: [count(b?.usage?.input_tokens), count(b?.usage?.output_tokens)] };
      },
      report(o, 'anthropic', r.model),
    ),
});

const openaiCompatible = (key: string, baseUrl: string, o: LiveOptions): JudgeProvider => ({
  complete: (r: JudgeRequest) =>
    post(
      o,
      `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      { authorization: `Bearer ${key}` },
      { model: providerModelId(r.model), messages: [{ role: 'system', content: r.system }, { role: 'user', content: r.user }], temperature: r.temperature, max_tokens: cap(o, r) },
      (j) => {
        const b = j as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | undefined;
        return { text: b?.choices?.[0]?.message?.content, usage: [count(b?.usage?.prompt_tokens), count(b?.usage?.completion_tokens)] };
      },
      report(o, 'openai-compatible', r.model),
    ),
});

/** A live provider, or the reason it cannot run (no key, no base URL). */
export function liveProvider(kind: RegistryProvider, env: Env, o: LiveOptions = {}): Result<JudgeProvider, string> {
  const key = env[LIVE_KEY_ENV[kind]];
  if (!key) return err(`live ${kind} judges need ${LIVE_KEY_ENV[kind]} in the environment; use recorded or fake judges instead`);
  if (kind === 'anthropic') return ok(anthropic(key, o));
  const base = env[OPENAI_COMPATIBLE_BASE_URL_ENV];
  if (!base || !base.startsWith('https://')) return err(`live openai-compatible judges need an https ${OPENAI_COMPATIBLE_BASE_URL_ENV}`);
  return ok(openaiCompatible(key, base, o));
}

/** The live-judging variables that are unset or empty, by name. */
export const missingLiveEnv = (env: Env): string[] => LIVE_ENV.filter((name) => !env[name]);

/**
 * Both live providers, routed by the seat's provider and wrapped in the judge timeout (default 60 s, the
 * policy's judgeTimeoutSec): what the adjudicator service takes as `provider`. Refuses, naming every missing
 * variable, unless all of LIVE_ENV are set.
 */
export function liveJudges(env: Env, o: LiveOptions & { timeoutMs?: number } = {}): Result<JudgeProvider, string> {
  const missing = missingLiveEnv(env);
  if (missing.length) return err(`live judges need ${missing.join(', ')} in the environment`);
  const a = liveProvider('anthropic', env, o);
  if (!a.ok) return a;
  const c = liveProvider('openai-compatible', env, o);
  if (!c.ok) return c;
  return ok(withTimeout(routeByProvider({ anthropic: a.value, 'openai-compatible': c.value }), o.timeoutMs ?? 60_000));
}
