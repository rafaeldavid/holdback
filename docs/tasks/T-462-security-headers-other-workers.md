# T-462: The security headers on the test agents' Worker and the early-access Worker

- **Lane:** security (crow-test-agents and crow-early-access)
- **Phase:** 2
- **Depends on:** T-451 (its header sets in `apps/demo-cloud/src/headers.ts`, merged in pull request 564)
- **Paths this task may touch:** the response-header code in `apps/test-agents/` and `apps/early-access/` and their tests (and one assertion in `tests/build-info.test.ts`, which read the Durable Object's throw that is now a 500); the test agents' two page templates (`apps/test-agents/src/seller.ts`, `buyer.ts`) only to take their one style from the shared constant; this task file
- **Human gate:** no for the pull request; the two deploys are the coordinator's, on Rafa's word ("You can go ahead"), which the coordinator holds first hand
- **Status:** done
- **Agent/session:** the T-451 side session, on the coordinator's brief of 2026-11-14
- **Roadmap row:** N52

## Intent

T-451 put the security headers on crow.direct and the two operators. Two Workers still answer without them, and a partner's scan of crow.direct will reach both: crow-test-agents, which serves Crow's test seller and test buyer under `crow.direct/agents/*`, and crow-early-access, which takes the sign-ups at join.crow.direct. Both also answer plain HTTP.

This task reuses the operators' header set (`apps/demo-cloud/src/headers.ts`, `API_HEADERS`) on every answer of both Workers, and does not copy it. The test agents' two HTML cards also get a content security policy that their one inline style passes. Plain HTTP gets a redirect to HTTPS, as on the operators. Each Worker keeps what it does: the same statuses, bodies, CORS and Cache-Control. The seller still quotes and sells, the buyer still buys, and the sign-up form on crow.direct still posts.

Non-goals: the site, the operators, the guides, the pinned `site/try.mjs` and `site/buy.mjs`, and `apps/hosted-sellers/`.

## Acceptance criteria

- [x] Every answer of crow-test-agents and crow-early-access carries the operators' set: HSTS, nosniff, `X-Frame-Options: DENY`, `default-src 'none'; frame-ancestors 'none'`, `no-referrer`, a same-origin resource policy and the permissions policy, imported from `apps/demo-cloud/src/headers.ts`.
- [x] The test seller's and test buyer's HTML cards carry a policy that allows their one inline style by hash and nothing else to run; the JSON data block a card carries still reads.
- [x] Plain HTTP gets a 301 (GET, HEAD) or a 308 (other methods) to the same path on HTTPS; local runs stay on HTTP.
- [x] CORS and Cache-Control on both Workers are unchanged, byte for byte.
- [x] A test per Worker fails before the change and asserts each header on each kind of answer.
- [x] The sign-up form on a crow.direct page posts under the new headers in a real browser engine, against a local run, with no policy or CORS error; nothing reaches the live store.
- [x] The test seller's card loads in a real browser engine with no policy violation.
- [x] `site/try.mjs` and `site/buy.mjs` keep their SHA-256.
- [x] The two deploys are handed to the coordinator with the after-checks.

## Evidence

Labels: measured, inferred, guessed.

### Before: what is served today (measured, 2026-11-14 17:50 UTC, plain GETs and OPTIONS preflights, no POST to the live services)

None of the security headers appears on any answer below: no `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, `Cross-Origin-Opener-Policy` or `Cross-Origin-Resource-Policy`.

| Answer | Read by | Status | Content-Type | Cache-Control | CORS |
| --- | --- | --- | --- | --- | --- |
| `crow.direct/agents/test-seller`, `/agents/test-buyer` (the cards) | both: a person reads the page, an agent reads its JSON block | 200 | `text/html; charset=utf-8` | `no-store` | none |
| `…/test-seller/agent.json`, `/health`, `/status?token=x` (400), `/nope` (404); `…/test-buyer/agent.json`, `/health`, `/status/0x00` (400) | an agent | as listed | `application/json` | `no-store` | `access-control-allow-origin: *` |
| `…/test-seller/version.json`, `…/test-buyer/version.json` | Crow Control | 200 | `application/json; charset=utf-8` | `no-store` | `access-control-allow-origin: *` |
| `OPTIONS …/test-seller/requests` | a browser | 204 | none | none | `allow-origin: *`, `allow-methods: GET, POST, OPTIONS`, `allow-headers: content-type` |
| `OPTIONS …/test-buyer/offers` | a browser | 204 | none | none | `allow-origin: *`, `allow-methods: GET, POST, OPTIONS`, `allow-headers: content-type, idempotency-key` |
| `http://crow.direct/agents/test-seller/agent.json` | an agent | 200 over plain HTTP | `application/json` | `no-store` | `*` |
| `escrow.stream/agents/test-seller/agent.json` | an agent | 308 to crow.direct | none | none | none |
| `join.crow.direct/`, `GET /early-access` | nobody (404) | 404 | `application/json` | none | `allow-origin: https://crow.direct`, `vary: origin`, `allow-headers: content-type`, `allow-methods: POST, OPTIONS` |
| `OPTIONS join.crow.direct/early-access`, from `https://crow.direct` and from `https://evil.example` | a browser on crow.direct | 204 | none | none | the same four; the allowed origin is `https://crow.direct` in both cases |
| `join.crow.direct/version.json` | Crow Control | 200 | `application/json; charset=utf-8` | `no-store` | `*` |
| `http://join.crow.direct/version.json` | | 200 over plain HTTP | as above | `no-store` | `*` |
| `join.escrow.stream/version.json` | | 301 to join.crow.direct | none | none | none |

**Early access serves no HTML page** (measured, by reading `apps/early-access/worker.js`). The sign-up form is the drawer and the home page's form on crow.direct, whose policy T-451 set. The Worker answers JSON only: `POST /early-access` from the allowed origins (crow.direct, www.crow.direct, the two escrow.stream hosts and two here.now hosts), the preflight, `GET /version.json`, and a 404 otherwise. A refused origin gets 403, and the CORS answer always names an allowed origin, never `*`.

**Pinned hashes (measured, live):** `try.mjs` `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8`, `buy.mjs` `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`.

### What each Worker will send (from the code; measured in the tests and a local run)

- **crow-test-agents, every answer:** the operators' set, imported from `apps/demo-cloud/src/headers.ts`: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, and the permissions policy. CORS (`*`, and the two preflights' methods and headers), `no-store`, statuses and bodies are as before.
- **The two cards (HTML):** the same, with `Cross-Origin-Opener-Policy: same-origin` and the card policy in place of the operators' one: `default-src 'none'; style-src 'sha256-…'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. The hash is of `CARD_STYLE` in `apps/test-agents/src/headers.ts`, which both page templates now take their one style from.
- **crow-early-access, every answer:** the operators' set unchanged. CORS stays as it was: the allowed origin echoed, `POST, OPTIONS`, `content-type`, `vary: origin`, and `*` on `/version.json`.
- **Plain HTTP on both:** GET and HEAD get a 301 and other methods a 308 to the same path on HTTPS, before anything reaches the agents or the store. `escrow.stream` and `join.escrow.stream` keep their redirects to crow.direct.

### Tests and checks (measured)

- `apps/test-agents/src/headers.test.ts` (4 tests) and `tests/early-access-headers.test.ts` (3 tests): all 7 fail on `origin/main`'s Workers (on the header assertions) and pass on the branch. They run a real Agents object behind the Worker, hash the card's style as served, and check CORS, `no-store` and bodies on each kind of answer. The full test-agents suite, `tests/forwarding.test.ts` and `tests/early-access-deploy.test.ts` pass: 100 tests in 10 files.
- `pnpm typecheck` and ESLint on the changed files: clean. `node site/build.mjs`: `site/try.mjs` `04ef4434…` and `site/buy.mjs` `e74ff223…` are unchanged, and `node site/check.mjs` passes.
- **The sign-up form, in a browser engine:** headless Chromium (Playwright 1.65.1, Chromium headless shell 1234) opened live `https://crow.direct/trust` and `https://crow.direct/`, filled the drawer and the home form, and submitted each. Every request to join.crow.direct went to a local crow-early-access (`wrangler dev`, local KV, not the live namespace), and its answer came back with its own headers. The browser accepted both answers (`access-control-allow-origin: https://crow.direct` beside the new `same-origin` resource policy and `DENY`), and the pages showed "Thank you" with no policy or CORS error. Playwright did not route the preflight itself; its answer, with the new headers and the same CORS headers, was measured with curl against the local run and in the test. Nothing reached the live store.
- **The test cards, in a browser engine:** the seller's and the buyer's card, as the Worker answers them (body and headers, written by a throwaway test), loaded in Chromium with their style applied by hash, their JSON block read, and no console message.

### Review and red team

The reviewer passed the change (PASS, three minor issues). The red team found nothing blocking: the cards cannot be framed, nothing runs on them, and no caller can reach their markup. Agents' plain clients ignore the headers. The sign-up form posted from crow.direct, www.crow.direct and npc.here.now in Chromium with real preflights (the red team's own run, behind a local HTTPS server with host-resolver rules, no Playwright route), which closes the gap the form check above left.

| Finding | From | What was done |
| --- | --- | --- |
| An answer that throws (a storage error, a failed KV write, an operator's malformed fee) leaves as Cloudflare's error page, with no headers and no CORS (Low; the same before this change) | both | Fixed: each Worker turns a throw into a 500 JSON answer with the headers and its own CORS, and logs the message; a test per Worker with a stub that throws |
| The tests did not assert that `Cache-Control` stays absent where it was absent (minor) | reviewer | Fixed: the early-access answers and both Workers' preflights are checked for no `Cache-Control` and no type |
| `isLocal` and the redirect are written in each Worker (minor) | reviewer | Kept: only the header set must be shared; a dev run reached on a LAN address gets the HTTPS redirect |
| Plain HTTP on escrow.stream went straight to crow.direct, another host (note) | red team | Fixed: the test agents upgrade to HTTPS on the same host first, as early access does |
| Agents that used plain HTTP now get a 301 or 308; plain `curl` without `-L`, `httpx` and `urllib` on a 308 POST do not follow (note) | red team | Intended: no client in the repository uses plain HTTP (measured by grep) |
| Firefox and WebKit not tried (note) | red team | Not run: only Chromium is installed. By the Fetch standard, a resource policy applies to no-cors requests only, so it cannot block the CORS sign-up (inferred) |

**What a scanner would still flag** (inferred from the scanners' rule sets): `access-control-allow-origin: *` on the test agents' JSON (OWASP ZAP 10098; by design, agents call them from anywhere); no `Cross-Origin-Embedder-Policy`, `X-Permitted-Cross-Domain-Policies` or `Clear-Site-Data` (Nuclei, informational); no `Cache-Control` on early access's 400, 403 and 404 (ZAP, informational, unchanged); no HSTS preload; and the early-access Worker's `workers.dev` host, which serves the same Worker with the same headers.

### After: both Workers deployed (2026-11-14 18:45 UTC)

The coordinator deployed both on Rafa's word ("You can go ahead"), from a detached worktree at `origin/main` `0907706`:
- crow-test-agents `47c99f76-d7dd-4398-b61b-752d8830b0b3` (rollback target `d3dce65d-ab02-4b19-a8eb-7d1031c23d0a`). It also carried T-445's seller change (pull request 562), merged after the previous live build `8c465bb7`.
- crow-early-access `d82f2bac-214a-43f5-9f48-4590167df50f` (rollback target `b33bf8dd-1625-40ee-9a39-a84fc46acbfd`). It carried T-462 alone.

Measured by this session at 18:48 UTC with `reports/scratch/t-462/measure.sh` (plain GETs and OPTIONS), and by the coordinator at 18:45 to 18:47 UTC:

| Answer | Before | After |
| --- | --- | --- |
| The two cards (`/agents/test-seller`, `/agents/test-buyer`) | none of the security headers | the seven headers, with `Content-Security-Policy: default-src 'none'; style-src 'sha256-OvjgERBVgrsJWIEt4uCgv6KKD8v4Fb2+9xPrkH0gd8U='; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` and `Cross-Origin-Opener-Policy: same-origin` |
| The agents' JSON (`agent.json`, `health`, `status`, `version.json`, the 404), the two preflights | none | the seven headers, with `default-src 'none'; frame-ancestors 'none'` |
| join.crow.direct (`/`, `/early-access` 404, `version.json`, the preflights) | none | the same seven |
| CORS and Cache-Control, every row of the Before table | as listed | unchanged, header for header |
| `http://crow.direct/agents/test-seller/agent.json`, `http://join.crow.direct/version.json` | 200 over plain HTTP | 301 to the same path on https |
| `escrow.stream/agents/…`, `join.escrow.stream/…` | 308 and 301 to crow.direct | unchanged |

- **The live cards:** each serves one style, whose SHA-256 is the policy's hash (measured). In headless Chromium both loaded with their style applied, their JSON block read and no console message, and a frame of the seller's card from another origin was refused (measured).
- **The agents still trade (measured by the coordinator):** the seller's health reads operational with 0 deals open. `node apps/test-agents/scripts/sell-to-test-buyer.mjs` ended released (`0x9bb277c1…90ab`), so the buyer still buys. `node examples/try.ts --seller https://crow.direct/agents/test-seller` ended Released in 46 s (`0x00a78095…e893`), so the seller still sells.
- **The form:** not posted live. The local-run check and the red team's real-preflight run stand.

## Handoff

- **The deploys (the coordinator's, on Rafa's word):** from a detached worktree at `origin/main` after `pnpm install --frozen-lockfile`, `node apps/test-agents/scripts/deploy.mjs` (it waits for the seller's health to read operational and rolls back on its own) and `node apps/early-access/deploy.mjs` (it waits for `/version.json` to name the commit and rolls back on its own).
- **The after-checks, plain requests only:**
  1. `/Users/rafa/Documents/escrow/reports/scratch/t-462/measure.sh` for the full after table (GETs and OPTIONS only).
  2. Every answer carries the seven headers; the two cards carry `style-src 'sha256-…'` in place of `default-src 'none'` alone, and `Cross-Origin-Opener-Policy: same-origin`.
  3. CORS and Cache-Control match the Before table.
  4. `http://crow.direct/agents/test-seller/agent.json` and `http://join.crow.direct/version.json` answer 301 to HTTPS.
  5. `curl -s https://crow.direct/agents/test-seller/health` reads operational, and `https://crow.direct/status` shows the test seller operational.
  6. `node apps/test-agents/scripts/sell-to-test-buyer.mjs` ends `released`, which shows the buyer still buys; the try command in `https://crow.direct/llms.txt` buys from the test seller, which shows the seller still sells.
  7. Do not post to the live sign-up form: the form was checked against a local run.
- An answer that throws in a Durable Object is now a 500 with the headers; the same gap on the operators and the site (T-451's Handoff) stays open.
