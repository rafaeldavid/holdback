// crow-early-access: stores early-access email sign-ups from the ’crow site (crow.direct; served at join.crow.direct).
// One KV entry per address: the email (lowercased), when, and which page. No IP addresses, no cookies, no tracking.
// List sign-ups: npx wrangler@4 kv key list --binding EMAILS --config apps/early-access/wrangler.jsonc --remote
// The old hostname join.escrow.stream forwards to join.crow.direct (T-312): a 301 for GET and a 308 for any other
// method, which keeps a POST's method and body. A browser sign-up from a page still open on escrow.stream is served in
// place instead, into the same KV namespace: a browser sends a redirected cross-origin POST with Origin null, which
// this Worker would refuse, and a preflight cannot follow a redirect at all.
// GET /version.json names the commit (BUILD_COMMIT, from deploy.mjs) and the live version, for Crow Control (T-413).
// T-462: every answer carries the operators' security headers (apps/demo-cloud/src/headers.ts, T-451), imported and
// not copied: the Worker answers JSON only, and the sign-up form it serves is a drawer on crow.direct's own pages,
// under the site's policy. CORS stays as below: crow.direct's pages post here across origins, and a resource policy
// does not apply to a CORS request. Plain HTTP gets a 301 for a read and a 308 for a write, to HTTPS.
import { buildInfo, buildResponse, isBuildRead } from '../site/build-info.js';
import { secured } from '../demo-cloud/src/headers.ts';

const ALLOWED = ['https://crow.direct', 'https://www.crow.direct', 'https://escrow.stream', 'https://www.escrow.stream', 'https://npc.here.now', 'https://mighty-canvas-c3tc.here.now'];
const CANONICAL = 'https://join.crow.direct';
const FORWARDED = 'join.escrow.stream';
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

const cors = (origin) => ({
  'access-control-allow-origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  vary: 'origin',
});
const json = (status, body, origin) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors(origin) } });

const isLocal = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');

export default {
  // T-462: every answer leaves through secured(), the one place the security headers are set.
  async fetch(request, env) {
    return secured(await route(request, env));
  },
};

async function route(request, env) {
  const origin = request.headers.get('origin') ?? '';
  const url = new URL(request.url);
  if (url.protocol === 'http:' && !isLocal(url.hostname)) return Response.redirect(`https://${url.host}${url.pathname}${url.search}`, request.method === 'GET' || request.method === 'HEAD' ? 301 : 308);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (url.hostname === FORWARDED && !(request.method === 'POST' && ALLOWED.includes(origin))) {
    return Response.redirect(`${CANONICAL}${url.pathname}${url.search}`, request.method === 'GET' || request.method === 'HEAD' ? 301 : 308);
  }
  if (isBuildRead(request, '/version.json')) return buildResponse(buildInfo({ worker: 'crow-early-access', commit: env.BUILD_COMMIT, metadata: env.CF_VERSION_METADATA }), request.method);
  if (url.pathname !== '/early-access' || request.method !== 'POST') return json(404, { error: 'not found' }, origin);
  if (!ALLOWED.includes(origin)) return json(403, { error: 'sign up from the ’crow site' }, origin);
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'send JSON: {"email": "…"}' }, origin);
  }
  if (body && typeof body.company === 'string' && body.company !== '') return json(200, { ok: true }, origin); // honeypot
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL.test(email)) return json(400, { error: 'That doesn’t look like an email address.' }, origin);
  const key = `email:${email}`;
  if (!(await env.EMAILS.get(key))) {
    await env.EMAILS.put(key, JSON.stringify({ at: new Date().toISOString(), page: typeof body.page === 'string' ? body.page.slice(0, 120) : '' }));
  }
  return json(200, { ok: true }, origin);
}
