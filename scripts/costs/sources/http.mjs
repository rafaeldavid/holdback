// Read-only HTTP for the cost sources. An error carries a type, a status and at most one short lowercase word (a
// source's fixed word or the provider's own error code), never a response body, a message or a header, so no
// credential or provider text can reach the output or the terminal.
import { parseJsonExact } from '../money.mjs';

export class SourceError extends Error {
  /**
   * @param {'network'|'timeout'|'http'|'parse'|'shape'|'graphql'|'chain'} type
   * @param {string|null} code a fixed word or a `safeWord`, never a message or a body
   */
  constructor(type, status = null, code = null) {
    super([type, status, code].filter((p) => p !== null).join(' '));
    this.name = 'SourceError';
    this.type = type;
    this.status = status;
    this.code = code;
  }
}

/** Fetches JSON and parses it with every number kept as its source text. */
export async function getJson(ctx, url, init = {}) {
  let res;
  try {
    res = await ctx.fetch(url, { ...init, signal: ctx.signal });
  } catch (e) {
    throw new SourceError(e?.name === 'AbortError' || e?.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  if (!res.ok) throw new SourceError('http', res.status, await errorWord(res));
  let text;
  try {
    text = await res.text();
  } catch {
    throw new SourceError('network');
  }
  try {
    return parseJsonExact(text);
  } catch {
    throw new SourceError('parse');
  }
}

/** A provider's own error code, kept only when it is a short lowercase word, so it cannot carry a key or a message. */
export function safeWord(value) {
  return typeof value === 'string' && /^[a-z][a-z_]{0,39}$/.test(value) ? value : null;
}

// The error type in a failed response's JSON body, as Anthropic and DeepSeek send it (`error.type`, such as
// `permission_error`), or null. The rest of the body is never kept.
async function errorWord(res) {
  try {
    return safeWord(parseJsonExact(await res.text())?.error?.type);
  } catch {
    return null;
  }
}

/** Throws a shape error unless `ok` holds. */
export function expectShape(ok) {
  if (!ok) throw new SourceError('shape');
}
