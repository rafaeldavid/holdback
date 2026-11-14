# T-451: The standard security headers on crow.direct and on the public API

- **Lane:** security (the site Worker and the operator Workers)
- **Phase:** 2
- **Depends on:** none (the `security.txt` half of the row went live with T-421)
- **Paths this task may touch:** the response-header code in `apps/site/` and `apps/demo-cloud/` and their tests; `site/build.mjs` and `site/check.mjs` only for the script hashes and the new check; the new `site/csp.mjs`; one line in `tests/site-status.test.ts` (it counts the site Worker's asset reads); this task file; one paragraph in `docs/operations.md`
- **Human gate:** no for the pull request; the site deploy runs on Rafa's standing word for this wave (coordinator brief 2026-11-14, "Merge and deploy when ready"); the operator deploy waits for the coordinator's go
- **Status:** in progress
- **Agent/session:** T-451 side session, started by the coordinator on 2026-11-14
- **Roadmap row:** N52

## Intent

A design partner's security team will scan crow.direct and the API before the first pilot deal. Today no answer from the site or the operators carries a security header (measured, below). Browsers should refuse to load either over plain HTTP after a first visit, refuse to sniff a type, refuse to frame a page, and on the site refuse any script that the build did not write.

The fix sets the headers in one function per Worker, on every answer on its way out. The site gets a content security policy with no `unsafe-inline` for scripts: the build hashes every inline script and style it writes into one file, and the Worker names those hashes. The API, which answers JSON to machines, gets transport security, no sniffing, no framing and no referrer. Nothing else changes: bodies, statuses, `Cache-Control` and CORS stay byte for byte, so the pinned `try.mjs` and `buy.mjs` and every guide keep their SHA-256.

Non-goals: CORS changes (none; the operators send no CORS header today, below), the test agents' pages and the early-access Worker (other lanes' Workers), HSTS preload submission (an outward action), and page content.

## Acceptance criteria

From roadmap row N52's done-when, less `security.txt`, which is live:

- [ ] Every answer of crow-site carries `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` and a `Content-Security-Policy` with `frame-ancestors 'none'`; HTML pages also `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`.
- [ ] The site's policy allows no inline script but the ones the build wrote (hashes), and no outside origin but the two the pages call; only the visual walkthrough is looser, and for styles only.
- [ ] Every answer of holdback-op1 and holdback-op2 carries HSTS, nosniff, no framing (`X-Frame-Options` and `frame-ancestors`) and a referrer policy, the refusals the Worker answers itself included.
- [ ] CORS on both Workers is unchanged; `Cache-Control` is unchanged.
- [ ] `try.mjs`, `buy.mjs` and the guides are served with the same bytes: SHA-256 before and after.
- [ ] A test per Worker fails before the change and asserts each header on each kind of answer.
- [ ] `node site/build.mjs && node site/check.mjs` passes with a new check (group 18) that every built page's inline scripts and styles are covered by the policy.
- [ ] Every page kind loads in a real browser engine with no policy violation; the status page's live checks, the demo's player and switch, and the early-access drawer work.
- [ ] The site is deployed and the live headers measured again; the operator deploy is done or handed to the coordinator.

## Evidence

Labels: measured, inferred, guessed.

### Before: what is served today (measured, 2026-11-14 16:15 UTC, plain GETs with curl)

None of the six security headers appears on any answer below: no `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, `Cross-Origin-Opener-Policy` or `Cross-Origin-Resource-Policy`. The table gives what each answer does carry of the tracked set.

| Answer | Status | Content-Type | Cache-Control | CORS |
| --- | --- | --- | --- | --- |
| crow.direct `/`, `/demo/`, `/trust`, `/status`, `/problems/not_found` | 200 | `text/html` | `public, max-age=0, must-revalidate` | none |
| crow.direct `/no-such-page` | 404 | `text/html` | `public, max-age=0, must-revalidate` | none |
| crow.direct `/llms.txt`, `/trust.txt`, `/.well-known/security.txt` | 200 | `text/plain; charset=utf-8` | `public, max-age=0, must-revalidate` | none |
| crow.direct `/try.mjs`, `/buy.mjs` | 200 | `text/javascript; charset=utf-8` | `public, max-age=0, must-revalidate` | none |
| crow.direct `/status.json` | 200 | `application/json` | `public, max-age=0, must-revalidate` | none |
| crow.direct `/favicon.ico` | 200 | `image/vnd.microsoft.icon` | `public, max-age=0, must-revalidate` | none |
| crow.direct `/version.json` | 200 | `application/json; charset=utf-8` | `no-store` | `access-control-allow-origin: *` |
| crow.direct `/status/operators.json` | 200 | `application/json; charset=utf-8` | `public, max-age=15` | `access-control-allow-origin: *` |
| escrow.stream `/` | 301 to crow.direct | none | none | none |
| api and api2 `/.well-known/holdback.json` (with and without `Origin: https://crow.direct`) | 200 | `application/json` | none | none |
| api and api2 `GET /v1/agreements/0x00…00` | 404 | `application/problem+json` | none | none |
| api and api2 `GET /v1/nope` | 404 | `application/problem+json` | none | none |
| api and api2 `OPTIONS /v1/messages` (preflight from `https://crow.direct`) | 404 | `application/problem+json` | none | none |
| crow.direct `/agents/test-seller` (the test seller's card, Worker crow-test-agents) | 200 | `text/html; charset=utf-8` | `no-store` | none |
| crow.direct `/agents/test-seller/agent.json` | 200 | `application/json` | `no-store` | `access-control-allow-origin: *` |
| join.crow.direct `/` (early access, JSON only) | 404 | `application/json` | none | `allow-origin: https://crow.direct`, `vary: origin`, `allow-headers: content-type`, `allow-methods: POST, OPTIONS` |
| join.crow.direct `OPTIONS /early-access` | 204 | none | none | the same four |

**Today's CORS on the operators (measured):** none. No answer carries an `Access-Control-*` header, with or without an `Origin` header, and a preflight `OPTIONS` answers `404 not_found` like any unknown route. Agents call the API from servers, where CORS does not apply; a browser page on another origin cannot read an answer. The site's status page does not call the operators from the reader's browser: it reads `/status/operators.json`, the site Worker's relay (T-421), and the demo page only links to them. This task keeps it as it is; whether the API should answer browsers is a product question (Handoff).

**Pinned hashes before (measured, SHA-256 of the live bytes):** `try.mjs` `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8`; `buy.mjs` `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`; `llms.txt` `d81dc1ea…`, `buy.txt` `6d38aee2…`, `sell.txt` `f93a726d…`, `trust.txt` `043e8993…`, `ref/http.txt` `ac33dc2d…`.

### What the pages run and call (measured, scanning a publish build of `origin/main`)

| Page | Inline scripts | Inline styles | Style attributes | Calls out to |
| --- | --- | --- | --- | --- |
| `/` (home) | none (`/home.js`) | none | none | `join.crow.direct` (the sign-up form, from `home.js`) |
| `/demo/` | 2 (the drawer; the player and the endings switch) | 1 | none | `join.crow.direct` |
| `/trust` | 1 (the drawer) | none | none | `join.crow.direct` |
| `/status` | 2 (the checks; the drawer) | none | none | same origin (`/version.json`, `/status/operators.json`, `/agents/test-seller/health`), `eth-sepolia.blockscout.com` |
| `/problems/*` (32 pages) | none | 1 each, the same | none | nothing |
| `/404.html` | none | none (`/home.css`) | none | nothing |
| `/visualdemo/` | 1 | 2 | 4 (legend swatches) | `fonts.googleapis.com` (stylesheet), `fonts.gstatic.com` (font files) |

No page carries an inline event handler, a `javascript:` URL, an iframe, a worker, a `data:` URL or a `<form action>`. Scripts set styles through the CSSOM only (`el.style.height`), which a policy does not block.

### The change, tested (measured)

- `apps/demo-cloud/src/headers.test.ts` (4 tests) and `tests/site-headers.test.ts` (9 tests) fail on `origin/main`'s Workers and pass on the branch. The concurrency test fails on the first version of `headers.js` (the reviewer's finding 1) and passes on the fix.
- `node site/build.mjs --op1 https://api.crow.direct --op2 https://api2.crow.direct --out reports/site-out && node site/check.mjs` passes. Group 18 fails a build with a missing `csp-hashes.json`, a page with an unhashed inline script, an inline handler, a fetch to an outside origin or an outside image (each tried by appending one to a built page).
- A browser engine: headless Chromium (Playwright 1.65.1, Chromium headless shell 1234) against `wrangler dev` of the built site, 8 page kinds (`/`, `/demo/`, `/trust`, `/status`, `/problems/not_found`, `/problems/`, `/visualdemo/`, a 404): 0 policy violations. Under the policy:
  - the status page's five checks ran (site, both operators and the network operational; the test seller "Down: HTTP 404" because `wrangler dev` does not serve crow-test-agents' route);
  - the demo's player advanced (33 steps waiting at load, 30 after 4 s), its pause button worked and the frame took its height;
  - the endings switch selected "fails" and showed its ending;
  - the early-access drawer opened and posted to `join.crow.direct`, answered by a Playwright stand-in, so nothing was sent; the browser applies the policy before the stand-in sees the request;
  - the home page's sign-up form posted the same way;
  - the walkthrough loaded its Google font.
- Control run on the same pages: an injected inline script, a script from `cdn.jsdelivr.net` and a fetch to `example.com` were refused with policy errors, and a frame of `/trust` from another origin showed Chromium's error page.
- The pinned files in the build: `try.mjs` `04ef4434…`, `buy.mjs` `e74ff223…`, the same as live before.

### Review and red team

The reviewer (ISSUES, one Medium, three Low) and the red team (ISSUES, three Medium, four Low, notes) ran on the pull request. The red team found no way to frame a page crow-site serves and no way to run an injected or outside script on one.

| Finding | From | What was done |
| --- | --- | --- |
| Requests that arrive while a failed hashes read is in flight crash with Cloudflare's 1101, with no headers (Medium) | both | Fixed: every caller shares one promise that never rejects; a test sends 3 requests at once against a 503 |
| Plain HTTP answers 200 on crow.direct and both operators, with no redirect (Medium, measured live) | red team | Fixed: the site answers `http:` with a 301 to `https:` (to crow.direct for the old hostnames); the operators with a 301 for GET and HEAD and a 308 otherwise, so nothing sent over HTTP reaches the World; local hosts stay on HTTP; a test per Worker |
| `crow.direct/agents/*` (crow-test-agents) and join.crow.direct carry no headers (Medium) | red team | Not in this task's paths: Handoff, for the coordinator before the partner's scan |
| Group 18 does not read fetch, image or font origins (Low) | reviewer | Fixed for fetch and images; fonts and `setAttribute('style')` stay unchecked (Handoff) |
| The status relay and its 405 are not tested (Low) | reviewer | Fixed: a test |
| The page table gave `/404.html` an inline style (Low) | reviewer | Fixed: it has none |
| The deploy's live check does not read the policy (Low) | red team | `site/deploy.mjs` is not in this task's paths: Handoff |
| A Durable Object error gives a 1101 with no headers (Low) | red team | Not fixed: the answer is Cloudflare's, before any header could matter to a reader; Handoff |
| A CRLF checkout would hash differently from a browser (Low) | red team | Fixed: CR LF and a lone CR count as LF before hashing; a test |
| The operators send no Permissions-Policy (Low) | red team | Fixed: the site's value |
| `importmap` and `speculationrules` scripts are not hashed (note) | red team | Fixed: both are hashed |
| What a scanner may still report: no COEP, `style-src 'unsafe-inline'` on `/visualdemo/`, no report endpoint, the hosts above (note) | red team | Recorded below |

## Handoff

- The test seller's and test buyer's cards at `crow.direct/agents/*` are served by crow-test-agents (T-420's lane, `apps/test-agents/`), whose route runs before crow-site, so they carry none of these headers. The same headers belong there; not in this task's paths.
- join.crow.direct (early access, JSON only) carries none either; `apps/early-access/` is another lane's.
- Whether the API should answer browsers (CORS) is a product question for the coordinator; today it does not.
- **Before the partner's scan:** the same headers on crow-test-agents (`apps/test-agents/`, the pages under `crow.direct/agents/*`) and on early access (`apps/early-access/`). Both serve plain HTTP too; Cloudflare's zone setting "Always Use HTTPS" would cover every host at once, and is Rafa's.
- `site/deploy.mjs`'s live check could read `/demo/` and require that its policy names every hash in the built `csp-hashes.json`, so a deploy whose Worker cannot read the file fails and rolls back (today the pages would load with their inline scripts blocked).
- Group 18 does not read font origins or `setAttribute('style', …)` in scripts.
- An error the World throws reaches the caller as Cloudflare's 1101 page; wrapping `forward()` in a secured 500 problem would carry the headers there too.
- A scanner may still report: no `Cross-Origin-Embedder-Policy` (not set: no page needs it, and it would block the walkthrough's font); `style-src 'unsafe-inline'` on `/visualdemo/` only; no `report-to` endpoint for the policy.
- HSTS `preload`: not added. Submitting crow.direct to the preload list is an outward action for Rafa.
