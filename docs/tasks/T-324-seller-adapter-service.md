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

- [ ] A recipe runs the adapter behind HTTPS, and says why a TLS proxy rather than TLS in the adapter (test: a quote over HTTPS through a TLS proxy, with the rate limit keyed by the forwarded client address).
- [ ] With `quoteAuth` configured, `POST /quote` answers 401 without a valid bearer credential and makes no offer; with a valid one it answers as before. Without `quoteAuth`, the route behaves as today. The credential never appears in the log (test).
- [ ] With `quoteRateLimit` configured, `POST /quote` answers 429 with `Retry-After` past the seller's limits, per client and overall, and makes no offer for a refused request (test).
- [ ] A restart with several open deals at different stages starts one job for each funded deal, delivers once each, finishes each, and replays a keyed quote's answer (test).
- [ ] `pnpm typecheck`, `pnpm lint` and the examples' tests pass.

## Out of scope

- TLS inside the adapter.
- A lock that stops two adapters on one journal.
- Pruning the journal.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
