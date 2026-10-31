# T-020: Developer surface: an HTTP API, examples and a quickstart a newcomer can use

- **Lane:** api + demo
- **Phase:** 1
- **Depends on:** T-007, T-009, T-012, T-018
- **Paths this task may touch:** `examples/` (new, inside the pnpm workspace), `apps/operator/` (new endpoints, a start script and bin), `apps/adjudicator/` (a test adjudicator), `README.md`, `docs/api.md`, `docs/quickstart.md` (new), package `README.md` files, `pnpm-workspace.yaml`, root `package.json` scripts, and the root `tsconfig.json` and `vitest.config.ts` (to compile and test `examples/`)
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** implementer, 2026-10-31
- **Re-scoped:** 2026-10-31 by D30 (API-first, Rafa via the coordinator): no high-level SDK layer and no MCP server now; the existing SDK client stays as it is.

## Intent

Two outsider agents (`docs/reviews/2026-10-31-outsider-usability.md`) settled deals correctly but spent nearly all their time reading source, because there is no way in: no quickstart, a wrong SDK example, a low-level SDK, no runnable operator or adjudicator. Make the first deal take minutes from `README.md`.

**Restated (implementer, after D30).** An agent in any language should settle its first deal from `README.md` in minutes, talking only to an operator's HTTP API and signing with a standard library (viem, ethers, eth-account). The operator prepares; the agent verifies and signs; the operator relays. Concretely:

1. **Prepare, sign, submit.** For each party message (offer, agree and fund, delivery, early accept, appeal, mutual settlement), `POST /v1/prepare/<kind>` takes plain inputs and returns the exact EIP-712 typed data (domain, the types it needs, primary type, message with nonce and expiry filled), its digest, and the body to submit with the signature slot(s) named. The typed data is a pure function of the inputs plus defaults the response states, so an agent can recompute and check it. The agent submits the signed body to the existing write route. The operator never signs a party message and never holds a party key.
2. **Deliveries without our SDK.** `GET /v1/commitments/{id}/recipients` lists each required recipient's encryption public key and the envelope spec. The envelope (our NaCl box construction, not HPKE) is documented byte for byte with test vectors that a test checks against core. `POST /v1/ciphertext` stores ciphertext; operators never see plaintext.
3. **Defaults.** `POST /v1/prepare/offer` takes a `default` or `checks-only` template and fills the club's rulebook hash and the primary adjudicator's policy ID, policy hash, registry hash and minimum fee from its published registration.
4. **A world.** `pnpm sim`: SimChain, two operator nodes, three test adjudicators with fake judges, funded test keys, all printed.
5. **Docs and examples.** `docs/quickstart.md` (first in `README.md`): curl for every step, plus a short signing snippet in TypeScript and in Python. `examples/buy-dataset.ts` and `examples/sell-translation.ts` use only `fetch`, a signing library and a NaCl library, and run in CI. The review's doc fixes.
6. **Discovery (optional add).** `/.well-known/holdback.json`: the status document plus the API base URL.

**Non-goals.** No protocol, schema or settlement-rule change; no SDK expansion (the client stays internal); no MCP server; no operator-side encryption of plaintext; no package publishing. The outsider re-test is run by the coordinator (Handoff).

## Context

- The outsider review (all friction items); `docs/api.md`; `apps/operator/`; `packages/core/src/eip712.ts` and `packages/core/src/crypto/`; D30.

## Acceptance criteria

- [ ] Prepare endpoints for offer, agree-and-fund, delivery, early accept, appeal and mutual settlement return EIP-712 typed data, digest and submit body; signing that typed data with viem and submitting the body moves the commitment. The operator signs nothing.
- [ ] "Verify before you sign" documented with the fields to check (counterparty, amount, adjudicators, payouts).
- [ ] Recipients endpoint and envelope spec with test vectors checked in CI; ciphertext upload and read endpoints.
- [ ] Offer prepare with `default` and `checks-only` templates; policy and registry hashes from the adjudicator's published registration.
- [ ] `pnpm sim` starts SimChain, two operator nodes and three test adjudicators with fake judges, printing endpoints and funded test keys.
- [ ] `examples/buy-dataset.ts` and `examples/sell-translation.ts` (fetch + signing library only), each under ~60 lines, run in CI.
- [ ] `docs/quickstart.md` linked first from `README.md`: curl per step, TypeScript and Python signing snippets; states SimChain, fake judges, no real money, fee kept on refund, tUSD 6 decimals.
- [ ] `docs/api.md`: example matches the API; `apply_default` in the trigger table; `key.released` says whose key it is.
- [ ] Fake-judge records are marked as fake wherever they appear to an integrator.
- [ ] OpenAPI for the new endpoints if T-015's document is cheap to extend; otherwise noted.
- [ ] Re-run the outsider test (both briefs, fresh agents) and record time to first settled deal; target under 15 minutes with no source reading (coordinator).
- [ ] `pnpm verify` green.

## Out of scope

- Publishing packages to a registry (needs Rafa); a high-level SDK and the MCP tool surface (D30); protocol changes; operator-side encryption of plaintext.

## Evidence

## Decisions

## Handoff
