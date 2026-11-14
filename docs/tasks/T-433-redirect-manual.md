# T-433: the seller adapter follows no redirect, in a way the Workers runtime accepts

- **Lane:** demo (the seller adapter)
- **Phase:** 2
- **Depends on:** ADR-0037 (Accepted 2026-11-14, D68), T-407
- **Paths this task may touch:** `examples/seller-adapter.ts`, `examples/seller-adapter-api.ts`, `examples/seller-adapter.test.ts`, `examples/seller-adapter-job-api.test.ts`, this file and the task files T-434 to T-436 (claimed here)
- **Human gate:** no
- **Status:** review
- **Agent/session:** the T-407 session, on Rafa's word of 2026-11-14 ("Yes, start both")

## Intent

The adapter refuses redirects from the seller's API because a redirect could carry the API credential elsewhere. It does so with `redirect: 'error'`, which the Workers runtime does not implement: it throws a `TypeError` before sending (ADR-0037 section 1; documented in Cloudflare's Request API). The same holds for the alert callback, which carries an HMAC signature. This task switches both to `redirect: 'manual'` and has the adapter refuse any 3xx itself, so the hosted adapter (T-435) can call the same code. A seller running the adapter on its own machine sees no change except a clearer error line.

Non-goals: any other part of the hosted build (T-434 to T-436).

## Acceptance criteria

- [x] Under a base URL, a 3xx from the seller's API is refused with an error that names the status and the call, and the target is never requested.
- [x] The client asks `fetch` for `redirect: 'manual'`, never `'error'`.
- [x] An alert callback that answers 3xx is not followed; the log names the redirect, and the signed body reaches only the configured address.
- [x] Every existing adapter test passes unchanged.

## Evidence

All measured on 2026-11-14 on branch `t-433-redirect-manual`, from `origin/main` at `0250676`.

- `pnpm exec vitest run examples/seller-adapter`: 4 files, 94 tests passed, run twice; 95 after the review fixes below. The three new tests are included: a 302 from the seller's API refused with its status named and the target never requested; `fetch` asked for `redirect: 'manual'`; an alert callback that answers 307 logged as a redirect, with the signed body sent only to `/crow-alerts`.
- `pnpm exec vitest run examples/buy-with-signer.test.ts examples/audit-deal.test.ts examples/one-token.test.ts`: 40 tests passed.
- `pnpm typecheck` and ESLint on the four changed files: clean.
- The redirect test for the alert callback runs in a simulated world of its own. In the shared one, the deals before it had spent both test buyers' balances (`insufficient_funds`).
- `site/try.mjs` and `site/buy.mjs` are unchanged: SHA-256 `04ef4434…` and `e74ff223…`.
- Snapshot diffs: none.
- **Review** (the `reviewer` agent, PASS with two Low findings, both fixed):
  - A `result.status` list could name a 3xx code, which a refused redirect could never match. The configuration is now refused at load, naming the list. Tested.
  - The redirect's body cancel now swallows its own error, so the redirect message is the one reported.
  - The alert test also checks the `x-crow-signature` header on the one request received.

## Handoff

The next step is T-434, the core split (ADR-0037 section 7).
