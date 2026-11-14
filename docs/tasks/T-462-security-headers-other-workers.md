# T-462: The security headers on the test agents' Worker and the early-access Worker

- **Lane:** security (crow-test-agents and crow-early-access)
- **Phase:** 2
- **Depends on:** T-451 (its header sets in `apps/demo-cloud/src/headers.ts`, merged in pull request 564)
- **Paths this task may touch:** the response-header code in `apps/test-agents/` and `apps/early-access/` and their tests; the test agents' two page templates (`apps/test-agents/src/seller.ts`, `buyer.ts`) only to take their one style from the shared constant; this task file
- **Human gate:** no for the pull request; the two deploys are the coordinator's, on Rafa's word ("You can go ahead"), which the coordinator holds first hand
- **Status:** in progress
- **Agent/session:** the T-451 side session, on the coordinator's brief of 2026-11-14
- **Roadmap row:** N52

## Intent

T-451 put the security headers on crow.direct and the two operators. Two Workers still answer without them, and a partner's scan of crow.direct will reach both: crow-test-agents, which serves Crow's test seller and test buyer under `crow.direct/agents/*`, and crow-early-access, which takes the sign-ups at join.crow.direct. Both also answer plain HTTP.

This task reuses the operators' header set (`apps/demo-cloud/src/headers.ts`, `API_HEADERS`) on every answer of both Workers, and does not copy it. The test agents' two HTML cards also get a content security policy that their one inline style passes. Plain HTTP gets a redirect to HTTPS, as on the operators. Each Worker keeps what it does: the same statuses, bodies, CORS and Cache-Control. The seller still quotes and sells, the buyer still buys, and the sign-up form on crow.direct still posts.

Non-goals: the site, the operators, the guides, the pinned `site/try.mjs` and `site/buy.mjs`, and `apps/hosted-sellers/`.

## Acceptance criteria

- [ ] Every answer of crow-test-agents and crow-early-access carries the operators' set: HSTS, nosniff, `X-Frame-Options: DENY`, `default-src 'none'; frame-ancestors 'none'`, `no-referrer`, a same-origin resource policy and the permissions policy, imported from `apps/demo-cloud/src/headers.ts`.
- [ ] The test seller's and test buyer's HTML cards carry a policy that allows their one inline style by hash and nothing else to run; the JSON data block a card carries still reads.
- [ ] Plain HTTP gets a 301 (GET, HEAD) or a 308 (other methods) to the same path on HTTPS; local runs stay on HTTP.
- [ ] CORS and Cache-Control on both Workers are unchanged, byte for byte.
- [ ] A test per Worker fails before the change and asserts each header on each kind of answer.
- [ ] The sign-up form on a crow.direct page posts under the new headers in a real browser engine, against a local run, with no policy or CORS error; nothing reaches the live store.
- [ ] The test seller's card loads in a real browser engine with no policy violation.
- [ ] `site/try.mjs` and `site/buy.mjs` keep their SHA-256.
- [ ] The two deploys are handed to the coordinator with the after-checks.

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

## Handoff

- The deploys (the coordinator's): `node apps/test-agents/scripts/deploy.mjs` and `node apps/early-access/deploy.mjs`, each from a detached worktree at `origin/main`.
