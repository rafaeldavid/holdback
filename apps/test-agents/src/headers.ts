// The security headers on every answer crow-test-agents sends (T-462, roadmap row N52): the one place they are set.
// worker.ts passes each answer through secured() on its way out, the agents' answers and its own (the build reads, the
// 308 from escrow.stream, the redirect from plain HTTP).
//
// The set is the operators' (apps/demo-cloud/src/headers.ts, T-451), imported and not copied: transport security, no
// content sniffing, no framing, no referrer, a same-origin resource policy and the permissions policy. The JSON an agent
// reads keeps their policy, which lets nothing run. The two HTML cards (the test seller's and the test buyer's page)
// get their own: their one inline style, CARD_STYLE, is allowed by its hash, and nothing else loads or runs. A card's
// JSON block (<script type="application/json">) is data, not a script, so a policy does not block it.
// CORS, Cache-Control, statuses and bodies pass through as the agents wrote them.
import { createHash } from 'node:crypto';
import { API_HEADERS } from '../../demo-cloud/src/headers.ts';

/** The cards' one style, in both pages (seller.ts and buyer.ts), and the text the policy's hash is of. */
export const CARD_STYLE = 'body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#1d1d1f;background:#fff}code{font-size:.9em;word-break:break-all}';

/** The cards' content security policy: their inline style by hash, and nothing else. */
export const CARD_POLICY = [
  "default-src 'none'",
  `style-src 'sha256-${createHash('sha256').update(CARD_STYLE, 'utf8').digest('base64')}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const isPage = (r: Response): boolean => /^text\/html\b/i.test((r.headers.get('content-type') ?? '').trim());

/** The response with the security headers set and everything else as it was. */
export function secured(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(API_HEADERS)) out.headers.set(k, v);
  if (isPage(response)) {
    out.headers.set('content-security-policy', CARD_POLICY);
    out.headers.set('cross-origin-opener-policy', 'same-origin');
  }
  return out;
}

const isLocal = (host: string): boolean => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');

/**
 * The redirect for a plain-HTTP request, or null: a 301 for a read and a 308 for a write, which a client follows with
 * the same method and body or not at all, so nothing sent over plain HTTP reaches the agents. Local runs stay on HTTP.
 */
export function toHttps(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.protocol !== 'http:' || isLocal(url.hostname)) return null;
  return Response.redirect(`https://${url.host}${url.pathname}${url.search}`, request.method === 'GET' || request.method === 'HEAD' ? 301 : 308);
}
