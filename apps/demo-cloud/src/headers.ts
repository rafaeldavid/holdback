// The security headers on every answer the two operator Workers send (T-451, roadmap row N52): the one place they are
// set. worker.ts passes each response through secured() on its way out: the World's answers, the 429 flood refusal,
// the size and path refusals, and the 500 of an unconfigured node.
//
// The API answers JSON to machines, so it gets the headers that make sense there: transport security (HSTS, a year,
// subdomains included), no content sniffing, no framing (X-Frame-Options and a policy that allows nothing to run or
// frame it), no referrer, and a cross-origin resource policy that keeps another site from pulling an answer into its
// page as an image or a script, and the site's permissions policy. A plain HTTP client (curl, fetch in Node, an agent)
// ignores all seven. Plain HTTP itself is answered with a redirect to HTTPS (worker.ts, forward).
//
// CORS is not set here and stays as it was: today the operators send no Access-Control-* header and answer OPTIONS
// as any other unknown route (measured 2026-11-14, docs/tasks/T-451-security-headers.md). Cache-Control is untouched.
// Bodies, statuses and every other header pass through as the World wrote them.

export const API_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()',
});

/** The response with the security headers set and everything else as it was. */
export function secured(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(API_HEADERS)) out.headers.set(k, v);
  return out;
}
