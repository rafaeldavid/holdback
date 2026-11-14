// The security headers on every answer crow-site sends (T-451, roadmap row N52): the one place they are set.
// worker.js passes each response through secured() on its way out, the 301s to crow.direct included.
//
// Every answer carries transport security (HSTS, a year, subdomains included), no content sniffing, no framing (both
// X-Frame-Options and the policy's frame-ancestors), a referrer policy and a permissions policy that turns off the
// device features no page uses. HTML pages also carry a content security policy and the cross-origin opener and
// resource policies. The policy allows scripts and styles from the site itself, plus the inline ones the build wrote:
// site/csp.mjs hashes each inline <script> and <style> of every built page into csp-hashes.json at the site's root,
// and the Worker reads that file once per instance. Without it, no inline script or style runs (fail closed).
// Pages call out to two origins only: the early-access form (join.crow.direct) and the status page's newest-block
// check (eth-sepolia.blockscout.com). The status page reads the operators through the site's own relay
// (/status/operators.json), so the policy names no operator.
//
// One page is looser, and only for styles: the visual walkthrough (/visualdemo/, a standalone page kept as it was
// made, site/build.mjs) loads a Google font and colours four legend swatches with style attributes, so its style-src
// allows inline styles and fonts.googleapis.com, and its font-src fonts.gstatic.com. Its script is hashed as elsewhere.
//
// Cache-Control, CORS and every other header stay as the asset server or the route sent them; bodies are not touched,
// so the guides, try.mjs and buy.mjs keep their bytes and their pinned SHA-256.

export const HASHES_PATH = '/csp-hashes.json';
const CONNECT = ['https://join.crow.direct', 'https://eth-sepolia.blockscout.com'];
const WALKTHROUGH = '/visualdemo';

/** The headers every answer carries. */
export const COMMON = Object.freeze({
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()',
});

/** What an answer that is not a page carries besides COMMON: no policy to run anything, and readable from anywhere. */
const NOT_A_PAGE = Object.freeze({
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'cross-origin',
});

const quoted = (hashes) => (hashes ?? []).map((h) => `'${h}'`);

/**
 * The content security policy for an HTML page at `pathname`.
 * @param {{ scripts: string[], styles: string[] } | null} hashes the build's inline hashes (`sha256-…`), or null when
 *   the file could not be read: then no inline script or style is allowed.
 * @param {string} pathname the request's path
 */
export function contentSecurityPolicy(hashes, pathname) {
  const walkthrough = pathname === WALKTHROUGH || pathname.startsWith(`${WALKTHROUGH}/`);
  const styles = walkthrough ? ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'] : ["'self'", ...quoted(hashes?.styles)];
  return [
    "default-src 'none'",
    `script-src ${["'self'", ...quoted(hashes?.scripts)].join(' ')}`,
    `style-src ${styles.join(' ')}`,
    "img-src 'self'",
    `font-src ${walkthrough ? 'https://fonts.gstatic.com' : "'self'"}`,
    `connect-src 'self' ${CONNECT.join(' ')}`,
    "manifest-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export const isPage = (response) => /^text\/html\b/i.test((response.headers.get('content-type') ?? '').trim());

/**
 * The response with the security headers set and everything else as it was.
 * @param {Response} response
 * @param {{ pathname: string, hashes: { scripts: string[], styles: string[] } | null }} o
 */
export function secured(response, { pathname, hashes }) {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(COMMON)) out.headers.set(k, v);
  if (isPage(response)) {
    out.headers.set('content-security-policy', contentSecurityPolicy(hashes, pathname));
    out.headers.set('cross-origin-opener-policy', 'same-origin');
    out.headers.set('cross-origin-resource-policy', 'same-origin');
  } else {
    for (const [k, v] of Object.entries(NOT_A_PAGE)) out.headers.set(k, v);
  }
  return out;
}

const SHA256 = /^sha256-[A-Za-z0-9+/]{43}=$/;
/** The hashes file's content when it has the shape site/csp.mjs writes, or null. */
export function parseHashes(value) {
  const ok = (a) => Array.isArray(a) && a.every((h) => typeof h === 'string' && SHA256.test(h));
  return value && ok(value.scripts) && ok(value.styles) ? { scripts: value.scripts, styles: value.styles } : null;
}

let cached;
/**
 * The build's inline hashes, read once per Worker instance from the assets (the same upload as the pages, so they
 * match). A failed read is not kept: the next request tries again, and this one gets null (no inline code runs).
 */
export function inlineHashes(request, env) {
  if (cached) return cached;
  const reading = (async () => {
    const r = await env.ASSETS.fetch(new Request(new URL(HASHES_PATH, request.url).href));
    const parsed = r.status === 200 ? parseHashes(await r.json()) : null;
    if (!parsed) throw new Error(`${HASHES_PATH} answered ${r.status} or not in the shape site/csp.mjs writes`);
    return parsed;
  })();
  cached = reading;
  return reading.catch((e) => {
    if (cached === reading) cached = undefined;
    console.error(`crow-site: no inline hashes, so pages run no inline script or style: ${e.message}`);
    return null;
  });
}

/** Tests only: forget the cached hashes. */
export function forgetHashes() {
  cached = undefined;
}
