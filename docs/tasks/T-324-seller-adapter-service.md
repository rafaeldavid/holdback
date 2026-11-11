# T-324: the seller adapter runs as a service

- **Lane:** api (example code), with one section of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, API and example code (Change recipes): the examples' tests, no review. The `site/llms.txt` section is kind 1.
- **Depends on:** T-318 (`examples/seller-adapter.ts`, PR 284)
- **Paths this task may touch:** `examples/seller-adapter.ts` (the HTTP server, the quote route, the journal and startup only), new files beside it for the service recipe, `examples/seller-adapter.test.ts` (new tests only), `vitest.config.ts` (a cost line for a new test file only), `.gitignore` (a line for a new state file only), `site/llms.txt` (the seller section only), this file. Never: `packages/`, `apps/`, `spec/schemas/`, `contracts/`, `examples/buyer-signer.ts` (T-325), `examples/audit-deal.ts` (T-326), or the adapter's result-to-delivery path (T-323).
- **Human gate:** no. The site deploy that publishes the `llms.txt` change waits for Rafa. The recipe deploys nothing.
- **Status:** in progress
- **Agent/session:** the T-324 session, 2026-11-11, branch `t-324-seller-adapter-service`; roadmap row N61

## Intent

Rafa asked on 2026-11-11 for the five gaps that stop a real seller to be closed; this task is roadmap row N61.

**Problem.** `examples/seller-adapter.ts` (T-318) runs as a demo process. It serves plain HTTP on 127.0.0.1, and anyone who can reach `POST /quote` makes the adapter sign and submit an offer with the seller's key, as often as they like. A seller cannot put that on the internet.

**Goal.** A seller runs the same adapter in production with four things it lacks today:

1. **HTTPS.** A recipe runs the adapter behind a TLS proxy. The adapter keeps serving plain HTTP on a loopback address; the proxy holds the certificate.
2. **Authentication on `POST /quote`.** The seller's configuration may require a bearer credential. The accepted credentials come from an environment variable and never reach a log. With no authentication configured, the route stays open, as today, so the existing tests and the buyer signer keep working.
3. **A rate limit on `POST /quote`.** The seller sets the values: requests per window, per client and overall. Any positive whole number is allowed (D31); these are the seller's limits on its own service, not protocol rules.
4. **Restart safety with open deals.** After a restart the adapter starts no job twice, delivers no report twice, and still finishes every open deal, whatever stage each was at.

**Unchanged.** The adapter signs only with the seller's key and never holds a buyer's key; the operators relay. The same `Idempotency-Key` with the same body replays the answer, and with another body answers 409. The result-to-delivery path (T-323's lane) is not touched.

**Non-goals.** No deployment. No change to the protocol, the schemas or any package. No change to `examples/buyer-signer.ts`: if the signer needs to send a credential, the exact change goes in the Handoff.

## Context

- `docs/tasks/T-318-seller-adapter.md`: the adapter's design, its journal, and follow-up 5 (a rate limit on `POST /quote`).
- `examples/seller-adapter.ts`, `examples/seller-adapter-stub.ts`, `examples/seller-adapter.test.ts`.
- `site/llms.txt`, "Sell a priced API service".
- `examples/buyer-signer.ts`, `quote()`: posts `{buyer, buyerEncryptionPublicKey, scope}` with an `Idempotency-Key` and no other header.

## Acceptance criteria

- [x] A recipe runs the adapter behind HTTPS, and says why a TLS proxy rather than TLS in the adapter (test: a quote over HTTPS through a TLS proxy, with the rate limit keyed by the forwarded client address).
- [x] With `quoteAuth` configured, `POST /quote` answers 401 without a valid bearer credential and makes no offer; with a valid one it answers as before. Without `quoteAuth`, the route behaves as today. The credential never appears in the log (test).
- [x] With `quoteRateLimit` configured, `POST /quote` answers 429 with `Retry-After` past the seller's limits, per client and overall, and makes no offer for a refused request (test).
- [x] A restart with several open deals at different stages starts one job for each funded deal, delivers once each, finishes each, and replays a keyed quote's answer (test).
- [x] `pnpm typecheck`, `pnpm lint` and the examples' tests pass.

## Out of scope

- TLS inside the adapter.
- A lock that stops two adapters on one journal.
- Pruning the journal.

## Evidence

All runs on 2026-11-11, on branch `t-324-seller-adapter-service`, cut from `origin/main` at `a310279`.

- **Test first (measured).** With the new tests written and the adapter unchanged, `pnpm build` failed on `examples/seller-adapter.test.ts`: `quoteAuth`, `trustProxy`, `quoteRateLimit` and `host` do not exist on `SellerAdapterConfig`.
- **The adapter's test (measured).** `pnpm exec vitest run examples/seller-adapter.test.ts`: 20 tests passed in about 6 s, the 10 of T-318 and 10 new ones. The new ones cover:
  - the credential: 401 with `WWW-Authenticate: Bearer` for five wrong headers and no offer; 200 with a listed credential; replay and 409 behind the credential; no credential in the log; startup refused when the variable is empty;
  - the rate limit: 429 with `Retry-After` from 1 to 3,600 s per client and overall; a refused scope counts; no offer for a refused request; the window opens again after 1 s; `X-Forwarded-For` ignored without `trustProxy`; startup refused for 0, 1.5 or a 0 s window;
  - HTTPS: a quote through a TLS proxy with a self-signed certificate made by `openssl` for the run, and a forged `X-Forwarded-For` that does not escape the per-client limit; the Caddyfile proxies to the shipped host and port, and the systemd unit restarts the adapter and stops it with SIGTERM;
  - restarts: three open deals (one funded while the adapter was down, one started with its job running, one never funded), after the restart two `Released` with one job and one `delivery.submitted` each, the third still offered with no job, and the keyed quote replayed.
- **The tests fail on a broken adapter (measured).** With the gate disabled (`admit` not called), 4 of the new tests failed: the credential, both rate-limit tests and the HTTPS test. The file was restored.
- **A shared-world flake avoided (measured).** In a full run on the file's shared sim world, the restart test's deal A did not reach `AcceptedByAdjudicator` within 20 s; alone it passed. The restart test now starts its own world, as the operator-fee test does. Why the shared world's adjudicator stalls is not known (guessed: many open offers).
- **The examples and the site's tests (measured).** `pnpm exec vitest run examples tests/site-deploy.test.ts tests/audit-report-template.test.ts`: 22 files passed; 237 tests passed and 13 skipped, in 132 s.
- **Types and lint (measured).** `pnpm typecheck` exits 0. `pnpm lint` prints nothing.
- **Site (measured).** `node site/build.mjs && node site/check.mjs`: "site check PASS". `site/index.html` and `site/try.mjs` did not change.
- **CI's first run (measured).** Every job passed except test shard 2/4 and `check`: T-313's `tests/ci-gated.test.ts` counted `examples/seller-adapter.test.ts` as gated, because the HTTPS test skipped without `openssl`. The test no longer skips; it fails without `openssl`, which the CI runners have. `tests/ci-gated.test.ts` and the adapter's test then passed locally, 22 tests.
- **After merging `origin/main` at `488f30a`, with T-323's report converter (measured).** One conflict, in `site/llms.txt`: both bullets kept. `examples/seller-adapter.ts` merged cleanly, with T-323's `reportMapping` and this task's gate both in place. `pnpm build`, `pnpm lint` and the site check pass. `pnpm exec vitest run examples tests/ci-gated.test.ts tests/site-deploy.test.ts tests/audit-report-template.test.ts`: 24 files passed; 263 tests passed and 13 skipped, in 106 s.
- **Not run.** Caddy and systemd themselves: neither is installed on this machine, and the recipe deploys nothing. A Node TLS proxy in the test plays Caddy's part. The full `pnpm verify`, `pnpm snap` and gitleaks: CI runs them.

## Decisions

1. **A TLS proxy, not TLS in the adapter.** Caddy gets and renews the certificate itself, so the adapter never reads a private key and needs no reload when the certificate changes. TLS in the adapter would need certificate paths in the configuration, a renewal job and a reload. The adapter keeps serving plain HTTP on 127.0.0.1, as its tests run it.
2. **The credential is a bearer credential from an environment variable the seller names.** `quoteAuth: {kind: 'bearer', env: '<NAME>'}`; the variable holds one or more credentials, comma-separated, so the seller can give each buyer its own and remove one. The adapter keeps only their SHA-256 and compares in constant time. The scheme name is case-insensitive (RFC 7235). Without `quoteAuth` the route is open, as in T-318.
3. **The rate limit is two fixed windows, both optional.** `perClient` counts each client address before the credential is checked, so guessing counts against the guesser. `overall` counts what passed both, which caps how many offers the adapter signs. Any positive whole number is allowed (D31); 0, fractions and a 0 s window are malformed and refused at startup. A fixed window can pass up to twice the limit across a window's edge; the seller sets the values knowing that.
4. **`trustProxy` reads the last `X-Forwarded-For` entry.** The proxy appends the address it saw, so a client cannot choose the last entry. It is off by default: set it only when nothing but the proxy reaches the adapter.
5. **Restarts needed no new journal stage.** T-318's journal already records `starting` before the start call and reads the settlement layer before a delivery. This task adds the test with several open deals, a SIGTERM handler that lets the step in progress finish before exit, and `host`. A crash between an offer's submit and its journal record leaves an offer the buyer never hears of, which expires unfunded (bounded loss, D26).
6. **The recipe is files beside the adapter.** `seller-adapter-service.md` (the steps), `seller-adapter.Caddyfile` and `seller-adapter.service` (systemd). The secrets file lives at `/etc/crow-seller/environment`, root-owned with mode 0600, read by systemd before it drops to the adapter's user.

## Handoff

**Done.** Bearer authentication and a seller-set rate limit on `POST /quote`, `host` and `trustProxy`, a SIGTERM handler, the HTTPS recipe, 10 new tests, and two sentences in "Sell a priced API service" of `site/llms.txt`.

**Not done.**
- The site deploy that publishes the `llms.txt` change waits for Rafa.
- **The buyer signer sends no credential (T-325's file, not changed here).** To quote a seller that sets `quoteAuth`, `examples/buyer-signer.ts` needs this change in `quote()`:

  ```ts
  async quote(quoteUrl: string, scope: unknown, headers: Record<string, string> = {}): Promise<Quote> {
    // …
    const res = await fetch(quoteUrl, {
      // …
      headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': this.#saved.quoteKey },
  ```

  The caller passes `{ authorization: `Bearer ${process.env['CROW_QUOTE_CREDENTIAL']}` }` from its own environment. The signer never saves the header in its key store and never logs it. Its default stays no header, so open quote routes work as today.

**Lower-priority finds** are in `reports/scratch/t-324-triage.md`: a journal lock, the rate limit's memory under many client addresses, a crash between a delivery's submit and its record (T-323's path), an orphan offer after a crash, and credentials not bound to buyer addresses.

**How to resume.** Run `pnpm exec vitest run examples/seller-adapter.test.ts`. The recipe is `examples/seller-adapter-service.md`.
