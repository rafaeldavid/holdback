// crow-site: serves the ’crow site at crow.direct and www.crow.direct from its static assets, and forwards the old
// hostnames (T-312): every request to escrow.stream or www.escrow.stream gets a 301 to the same path and query on
// https://crow.direct. wrangler.jsonc sets run_worker_first, so this runs before any asset is served; the assets
// binding still applies html_handling and not_found_handling.
const CANONICAL = 'https://crow.direct';
const FORWARDED = new Set(['escrow.stream', 'www.escrow.stream']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (FORWARDED.has(url.hostname)) return Response.redirect(`${CANONICAL}${url.pathname}${url.search}`, 301);
    return env.ASSETS.fetch(request);
  },
};
