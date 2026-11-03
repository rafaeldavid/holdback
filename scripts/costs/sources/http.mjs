// Read-only HTTP for the cost sources. An error carries a type and a status, never a response body or a
// header, so no credential or provider text can reach the output or the terminal.
import { parseJsonExact } from '../money.mjs';

export class SourceError extends Error {
  /** @param {'network'|'timeout'|'http'|'parse'|'shape'|'graphql'|'chain'} type */
  constructor(type, status = null) {
    super(status === null ? type : `${type} ${status}`);
    this.name = 'SourceError';
    this.type = type;
    this.status = status;
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
  if (!res.ok) throw new SourceError('http', res.status);
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
