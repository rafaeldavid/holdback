// The model providers a duet agent talks to (T-391): Anthropic's Messages API and an OpenAI-compatible chat
// completions API (DeepSeek), each with tool calls, plus a scripted provider for the tests. Keys come from the
// environment variables the judges' clients read (apps/adjudicator/src/providers/live.ts) and go only into the
// request's own header: never into a prompt, a tool result, an error or the record. Model IDs are the pinned ones in
// config/judges-live.yaml; a trailing "@<date>" is dropped before the call, as the judges' clients do.
import { readFileSync } from 'node:fs';

/** One tool as every provider is told about it: a name, a description, and a JSON Schema for its input. */
export interface ToolSpec {
  name: string;
  description: string;
  input: Record<string, unknown>;
}

/** A call the model asked for. `id` is the provider's, so the result can name it. */
export interface Call {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** The conversation, kept vendor-neutral: each provider writes it in its own wire format. */
export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls: Call[]; raw?: unknown }
  | { role: 'results'; results: Array<{ id: string; content: string; isError: boolean }> };

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Answer {
  text: string;
  calls: Call[];
  usage: Usage;
  /** Why the model stopped: `tool_use`, `end_turn`, `max_tokens` and the like, as the vendor says it. */
  stop: string;
  /** The vendor's own form of this turn, kept so the next request can repeat it exactly (thinking blocks). */
  raw?: unknown;
}

export interface Provider {
  vendor: 'anthropic' | 'deepseek' | 'scripted';
  /** The registry's model ID, with its @date. */
  model: string;
  turn(system: string, history: readonly Turn[], tools: readonly ToolSpec[]): Promise<Answer>;
}

export const KEY_ENV = { anthropic: 'HOLDBACK_ANTHROPIC_API_KEY', deepseek: 'HOLDBACK_OPENAI_COMPATIBLE_API_KEY' } as const;
export const BASE_URL_ENV = 'HOLDBACK_OPENAI_COMPATIBLE_BASE_URL';
/** Output tokens a turn may use, thinking included. */
export const MAX_OUTPUT_TOKENS = 8192;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

type Env = Readonly<Record<string, string | undefined>>;
type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A registry entry of config/judges-live.yaml, read as plain lines: the file is the repository's own. */
export interface RegistryModel {
  id: string;
  provider: 'anthropic' | 'openai-compatible';
  model: string;
}

export function registry(file = new URL('../../config/judges-live.yaml', import.meta.url)): RegistryModel[] {
  const out: RegistryModel[] = [];
  let cur: Partial<RegistryModel> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:- )?(id|provider|model):\s*(\S+)\s*$/.exec(line);
    if (!m) continue;
    if (m[1] === 'id' && cur.id) cur = {};
    (cur as J)[m[1]!] = m[2];
    if (cur.id && cur.provider && cur.model) {
      out.push(cur as RegistryModel);
      cur = {};
    }
  }
  return out;
}

/** The pinned model a vendor plays by default, and any other one the registry lists for it. */
export const DEFAULT_MODEL = { anthropic: 'claude-opus-5-5', deepseek: 'deepseek-v4-pro' } as const;

export function pinnedModel(vendor: 'anthropic' | 'deepseek', id: string | undefined): RegistryModel {
  const want = id ?? DEFAULT_MODEL[vendor];
  const kind = vendor === 'anthropic' ? 'anthropic' : 'openai-compatible';
  const found = registry().find((r) => r.id === want && r.provider === kind);
  if (!found) throw new Error(`${want} is not a ${vendor} model in config/judges-live.yaml: pick one of ${registry().filter((r) => r.provider === kind).map((r) => r.id).join(', ')}`);
  return found;
}

const providerModelId = (model: string): string => model.replace(/@\d{4}-\d{2}-\d{2}$/, '');
const count = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0);

/** A vendor's refusal, with the status and the vendor's own error type: never a header, never the request. */
export class VendorError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`HTTP ${status}${detail ? `: ${detail}` : ''}`);
    this.status = status;
  }
}

/** POST with up to three retries on 429 and 5xx, waiting 2, 4 and 8 s. */
async function post(url: string, headers: Record<string, string>, body: unknown, f: typeof fetch): Promise<J> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
    } catch (e) {
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
      throw new VendorError(0, `network error: ${(e as Error).name}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
    const json: J = await res.json().catch(() => undefined);
    if (!res.ok) {
      const e = json?.error;
      const detail = [e?.type, typeof e?.message === 'string' ? e.message.slice(0, 300) : undefined].filter(Boolean).join(': ');
      throw new VendorError(res.status, detail);
    }
    return json;
  }
}

/** Anthropic's Messages API with tools. The system prompt, the tools and the newest message are marked for caching. */
export function anthropic(model: string, key: string, f: typeof fetch = fetch): Provider {
  return {
    vendor: 'anthropic',
    model,
    async turn(system, history, tools) {
      const messages: J[] = history.map((t) => {
        if (t.role === 'user') return { role: 'user', content: [{ type: 'text', text: t.text }] };
        if (t.role === 'assistant') return { role: 'assistant', content: t.raw ?? [...(t.text ? [{ type: 'text', text: t.text }] : []), ...t.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input }))] };
        return { role: 'user', content: t.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError })) };
      });
      const last = messages.at(-1)?.content?.at?.(-1);
      if (last) last.cache_control = { type: 'ephemeral' };
      const wire = tools.map((t, i) => ({ name: t.name, description: t.description, input_schema: t.input, ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}) }));
      const b = await post(ANTHROPIC_URL, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model: providerModelId(model), max_tokens: MAX_OUTPUT_TOKENS, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], tools: wire, messages }, f);
      const content: J[] = Array.isArray(b?.content) ? b.content : [];
      return {
        text: content.filter((c) => c.type === 'text').map((c) => String(c.text ?? '')).join('\n'),
        calls: content.filter((c) => c.type === 'tool_use').map((c) => ({ id: String(c.id), name: String(c.name), input: c.input && typeof c.input === 'object' ? c.input : {} })),
        usage: { input: count(b?.usage?.input_tokens) + count(b?.usage?.cache_read_input_tokens) + count(b?.usage?.cache_creation_input_tokens), output: count(b?.usage?.output_tokens), cacheRead: count(b?.usage?.cache_read_input_tokens), cacheWrite: count(b?.usage?.cache_creation_input_tokens) },
        stop: String(b?.stop_reason ?? 'unknown'),
        raw: content,
      };
    },
  };
}

/**
 * An OpenAI-compatible chat completions API with tools (DeepSeek). On api.deepseek.com thinking is turned off, as
 * the judges' client does: a thinking turn with tool calls would need its reasoning sent back on every request.
 */
export function openaiCompatible(model: string, key: string, baseUrl: string, f: typeof fetch = fetch): Provider {
  const extra = new URL(baseUrl).host === 'api.deepseek.com' ? { thinking: { type: 'disabled' } } : {};
  return {
    vendor: 'deepseek',
    model,
    async turn(system, history, tools) {
      const messages: J[] = [{ role: 'system', content: system }];
      for (const t of history) {
        if (t.role === 'user') messages.push({ role: 'user', content: t.text });
        else if (t.role === 'assistant') messages.push({ role: 'assistant', content: t.text || null, ...(t.calls.length ? { tool_calls: t.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) });
        else for (const r of t.results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
      }
      const b = await post(`${baseUrl.replace(/\/$/, '')}/chat/completions`, { authorization: `Bearer ${key}` }, { model: providerModelId(model), messages, tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input } })), max_tokens: MAX_OUTPUT_TOKENS, ...extra }, f);
      const choice = b?.choices?.[0];
      const calls: Call[] = (Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : []).map((c: J, i: number) => {
        let input: J = {};
        try { input = JSON.parse(String(c?.function?.arguments ?? '{}')); } catch { input = { unparsed: String(c?.function?.arguments ?? '').slice(0, 2000) }; }
        return { id: String(c?.id ?? `call-${i}`), name: String(c?.function?.name ?? ''), input: input && typeof input === 'object' && !Array.isArray(input) ? input : {} };
      });
      const hit = count(b?.usage?.prompt_cache_hit_tokens);
      return { text: String(choice?.message?.content ?? ''), calls, usage: { input: count(b?.usage?.prompt_tokens), output: count(b?.usage?.completion_tokens), cacheRead: hit, cacheWrite: 0 }, stop: String(choice?.finish_reason ?? 'unknown') };
    },
  };
}

/** What a scripted step sees: the conversation so far, and the text of every tool result in it. */
export interface ScriptContext {
  history: readonly Turn[];
  /** Every tool result's text, oldest first. */
  results(): string[];
  /** The first capture group of `re` in the newest tool result that matches it. */
  find(re: RegExp): string | undefined;
}

/** One scripted turn: some words and the calls to make. A step may wait for a result by returning `again`. */
export type ScriptStep = (c: ScriptContext) => { text?: string; calls: Array<{ name: string; input: Record<string, unknown> }> } | 'again';

/**
 * A provider that replays a fixed sequence of tool calls, for the tests: it drives the same loop, tools, world and
 * record as a live model. It proves the harness, not that a model can do the deal. Its token counts are the
 * characters sent and returned divided by four, so the measures have something to add up.
 */
export function scripted(steps: readonly ScriptStep[], model = 'scripted'): Provider {
  let at = 0;
  let n = 0;
  return {
    vendor: 'scripted',
    model,
    async turn(system, history) {
      const results = () => history.flatMap((t) => (t.role === 'results' ? t.results.map((r) => r.content) : []));
      const ctx: ScriptContext = { history, results, find: (re) => results().reverse().map((r) => re.exec(r)?.[1]).find((x) => x !== undefined) };
      const input = Math.ceil((system.length + JSON.stringify(history).length) / 4);
      for (;;) {
        const step = steps[at];
        if (!step) return { text: 'The script has no more steps.', calls: [], usage: { input, output: 8, cacheRead: 0, cacheWrite: 0 }, stop: 'end_turn' };
        const r = step(ctx);
        let wait: Array<{ name: string; input: Record<string, unknown> }> = [];
        let made = r;
        if (r === 'again') {
          // Not ready yet: wait a second and repeat the step before this one, the call whose answer this step reads.
          at = Math.max(0, at - 1);
          made = steps[at]!(ctx);
          if (made === 'again') throw new Error(`scripted step ${at} cannot be repeated`);
          wait = [{ name: 'wait', input: { seconds: 1 } }];
        }
        at++;
        const calls = [...wait, ...(made as Exclude<typeof made, 'again'>).calls].map((c) => ({ id: `s-${++n}`, name: c.name, input: c.input }));
        const text = (made as Exclude<typeof made, 'again'>).text ?? '';
        return { text, calls, usage: { input, output: Math.ceil(JSON.stringify(calls).length / 4) + Math.ceil(text.length / 4), cacheRead: 0, cacheWrite: 0 }, stop: calls.length ? 'tool_use' : 'end_turn' };
      }
    },
  };
}

/** A live provider for a vendor, or the one line that says which variable is missing. Nothing is sent here. */
export function liveProvider(vendor: 'anthropic' | 'deepseek', model: string, env: Env): Provider | string {
  const key = env[KEY_ENV[vendor]];
  if (!key) return `${vendor} needs ${KEY_ENV[vendor]} in the environment: nothing was sent`;
  if (vendor === 'anthropic') return anthropic(model, key);
  const base = env[BASE_URL_ENV];
  if (!base || !base.startsWith('https://')) return `deepseek needs an https ${BASE_URL_ENV} in the environment: nothing was sent`;
  return openaiCompatible(model, key, base);
}
