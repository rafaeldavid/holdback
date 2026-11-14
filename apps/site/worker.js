// crow-site: serves the ’crow site at crow.direct and www.crow.direct from its static assets, and forwards the old
// hostnames (T-312): every request to escrow.stream or www.escrow.stream gets a 301 to the same path and query on
// https://crow.direct. wrangler.jsonc sets run_worker_first, so this runs before any asset is served; the assets
// binding still applies html_handling and not_found_handling. The guides and bundles get their charset named (below).
// GET /version.json adds the live version's creation time to the build's commit, for Crow Control (T-413, build-info.js).
import { buildInfo, buildResponse, isBuildRead } from './build-info.js';

const CANONICAL = 'https://crow.direct';
const FORWARDED = new Set(['escrow.stream', 'www.escrow.stream']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (FORWARDED.has(url.hostname)) return Response.redirect(`${CANONICAL}${url.pathname}${url.search}`, 301);
    if (isBuildRead(request, '/version.json')) return buildResponse(buildInfo({ worker: 'crow-site', commit: await builtCommit(request, env), metadata: env.CF_VERSION_METADATA }), request.method);
    return withCharset(await env.ASSETS.fetch(request));
  },
};

// The commit site/build.mjs wrote to the version.json asset, or null when the asset is missing or reads otherwise.
async function builtCommit(request, env) {
  try {
    const r = await env.ASSETS.fetch(new Request(request.url));
    return r.status === 200 ? (await r.json())?.commit ?? null : null;
  } catch {
    return null;
  }
}

// The guides (.txt) and the bundles (.mjs) are UTF-8. The asset store labels them text/plain and text/javascript with
// no charset, and a browser then reads them as Latin-1, so "Crow’s" shows as junk (Rafa, 2026-11-13; T-400). A
// _headers file would not apply here: this Worker runs first (run_worker_first), and Cloudflare applies _headers only to
// responses the asset server sends itself (developers.cloudflare.com/workers/static-assets/headers/). So the Worker
// names the charset on those two types, and leaves every other response as the asset server sent it.
const CHARSET = new Map([['text/plain', 'text/plain; charset=utf-8'], ['text/javascript', 'text/javascript; charset=utf-8'], ['application/javascript', 'text/javascript; charset=utf-8']]);
export function withCharset(response) {
  const type = (response.headers.get('content-type') ?? '').trim().toLowerCase();
  const named = CHARSET.get(type);
  if (!named) return response;
  const out = new Response(response.body, response);
  out.headers.set('content-type', named);
  return out;
}
