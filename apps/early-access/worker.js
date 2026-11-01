// crow-early-access: stores early-access email sign-ups from the ’crow site (npc.here.now/escrow).
// One KV entry per address: the email (lowercased), when, and which page. No IP addresses, no cookies, no tracking.
// List sign-ups: npx wrangler@4 kv key list --binding EMAILS --config apps/early-access/wrangler.jsonc --remote
const ALLOWED = ['https://npc.here.now', 'https://mighty-canvas-c3tc.here.now'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

const cors = (origin) => ({
  'access-control-allow-origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  vary: 'origin',
});
const json = (status, body, origin) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors(origin) } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? '';
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
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
  },
};
