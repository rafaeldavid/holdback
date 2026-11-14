// The status page's relay for the two operators (T-421). The page at https://crow.direct/status checks each part of
// Crow from the reader's browser; the operators send no CORS header, so a browser cannot read their answer. The site
// Worker reads each operator's public discovery document, GET /.well-known/holdback.json, and answers
// GET /status/operators.json with what it saw. A Worker may fetch a Custom Domain on its own zone, and both operators
// are Custom Domains (Cloudflare's docs, Custom Domains, "Worker to Worker communication").
//
// It reads public endpoints only, sends no credential and keeps nothing but a 15 s edge cache of its answer, so a burst
// of visits costs at most two operator reads every 15 s per Cloudflare location.

export const STATUS_PATH = '/status/operators.json';
export const OPERATORS = Object.freeze([
  { id: 'op1', url: 'https://api.crow.direct' },
  { id: 'op2', url: 'https://api2.crow.direct' },
]);
export const DISCOVERY = '/.well-known/holdback.json';
export const CACHE_SEC = 15;
export const TIMEOUT_MS = 5000;

/** One operator's state from one read of its discovery document. */
export async function checkOperator({ id, url }, { fetcher = fetch, now = Date.now } = {}) {
  const t0 = now();
  try {
    const r = await fetcher(`${url}${DISCOVERY}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ms = now() - t0;
    if (r.status !== 200) return { id, url, state: 'down', status: r.status, ms, reason: `answered HTTP ${r.status}` };
    const body = await r.json().catch(() => null);
    if (!body || typeof body.operatorId !== 'string' || typeof body.apiVersion !== 'string') return { id, url, state: 'down', status: 200, ms, reason: 'answered 200, but not with its discovery document' };
    return { id, url, state: 'operational', status: 200, ms, operatorId: body.operatorId, chainId: body.domain?.chainId ?? null };
  } catch (e) {
    return { id, url, state: 'down', status: 0, ms: now() - t0, reason: e?.name === 'TimeoutError' ? `no answer in ${TIMEOUT_MS / 1000} s` : 'no answer' };
  }
}

/** Both operators, read in parallel. */
export async function operatorsStatus(o = {}) {
  const now = o.now ?? Date.now;
  const operators = await Promise.all(OPERATORS.map((op) => checkOperator(op, o)));
  return { checkedAt: new Date(now()).toISOString(), operators };
}

/**
 * The answer to GET /status/operators.json: a fresh read, or the cached one while it is under CACHE_SEC old.
 * `cache` is the Workers Cache API (caches.default) or undefined, where there is none (a test, a local run).
 */
export async function statusResponse(request, { cache, waitUntil = () => {}, ...o } = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('GET or HEAD only\n', { status: 405, headers: { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' } });
  const key = new Request(new URL(STATUS_PATH, request.url).href);
  let response = cache ? await cache.match(key) : undefined;
  if (!response) {
    response = new Response(`${JSON.stringify(await operatorsStatus(o), null, 2)}\n`, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${CACHE_SEC}`, 'access-control-allow-origin': '*' },
    });
    if (cache) waitUntil(cache.put(key, response.clone()));
  }
  return request.method === 'HEAD' ? new Response(null, response) : response;
}
