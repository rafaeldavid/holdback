// Read-only HTTP for the cost sources. An error carries a type, a status and at most a code from a fixed list in
// this code, never a response body, a message or a header, so no credential or provider text can reach the output
// or the terminal.
import { parseJsonExact } from '../money.mjs';

export class SourceError extends Error {
  /**
   * @param {'network'|'timeout'|'http'|'parse'|'shape'|'graphql'|'chain'} type
   * @param {string|null} code a word from a fixed list in this code, never a message or a body
   */
  constructor(type, status = null, code = null) {
    super([type, status, code].filter((p) => p !== null).join(' '));
    this.name = 'SourceError';
    this.type = type;
    this.status = status;
    this.code = code;
  }
}

// Anthropic's documented `error.type` values (platform.claude.com/docs/en/api/errors, read 2026-11-04).
const ERROR_TYPES = new Set([
  'invalid_request_error',
  'authentication_error',
  'billing_error',
  'permission_error',
  'not_found_error',
  'conflict_error',
  'request_too_large',
  'rate_limit_error',
  'api_error',
  'timeout_error',
  'overloaded_error',
]);

/** The body's `error.type` when it is one of the listed values, or null. */
export function errorType(body) {
  const type = body?.error?.type;
  return typeof type === 'string' && ERROR_TYPES.has(type) ? type : null;
}

/**
 * Fetches JSON and parses it with every number kept as its source text. A failed response's body is parsed only
 * to give `errorCode` a chance to name it with a listed word; the rest of the body is never kept.
 */
export async function getJson(ctx, url, init = {}, errorCode = errorType) {
  let res;
  try {
    res = await ctx.fetch(url, { ...init, signal: ctx.signal });
  } catch (e) {
    throw new SourceError(e?.name === 'AbortError' || e?.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  if (!res.ok) {
    let code = null;
    try {
      code = errorCode(parseJsonExact(await res.text()));
    } catch {
      // An unreadable body leaves the status alone.
    }
    throw new SourceError('http', res.status, code);
  }
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

/** Throws a shape error unless `ok` holds. */
export function expectShape(ok) {
  if (!ok) throw new SourceError('shape');
}
