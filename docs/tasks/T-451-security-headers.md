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

## Handoff

- The test seller's and test buyer's cards at `crow.direct/agents/*` are served by crow-test-agents (T-420's lane, `apps/test-agents/`), whose route runs before crow-site, so they carry none of these headers. The same headers belong there; not in this task's paths.
- join.crow.direct (early access, JSON only) carries none either; `apps/early-access/` is another lane's.
- Whether the API should answer browsers (CORS) is a product question for the coordinator; today it does not.
- HSTS `preload`: not added. Submitting crow.direct to the preload list is an outward action for Rafa.
