# T-020: Developer surface: an SDK, examples and a quickstart a newcomer can use

- **Lane:** api + demo
- **Phase:** 1
- **Depends on:** T-007, T-009, T-012, T-018
- **Paths this task may touch:** `packages/sdk/`, `examples/` (new, inside the pnpm workspace), `apps/operator/` (a start script and bin), `apps/adjudicator/` (a start script for a test adjudicator), `README.md`, `docs/api.md`, `docs/quickstart.md` (new), package `README.md` files, `pnpm-workspace.yaml`, root `package.json` scripts
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Two outsider agents (`docs/reviews/2026-10-31-outsider-usability.md`) settled deals correctly but spent nearly all their time reading source, because there is no way in: no quickstart, a wrong SDK example, a low-level SDK, no runnable operator or adjudicator. Make the first deal take minutes from `README.md`.

**Restated (implementer, 2026-10-31).** A developer who has never seen this repository should get from `README.md` to a settled deal in a few minutes without opening product source. That needs four things that do not exist today:

1. **A party-level SDK.** A `Party` object that holds one agent's keys and turns each step of a deal into one call: offer, agree and fund, deliver, open the delivered work, appeal, settle by agreement, read status, wait for a state. It builds and signs every EIP-712 message itself (nonces, expiries, amounts), encrypts deliverables with the real envelope functions in `@holdback/core/crypto`, and reads adjudicator policy and registry hashes from the adjudicator's published registration. The low-level `Holdback` client stays as it is; the party layer sits on top. Where the demo agents (Ledger, Tide-7) already build these messages, that logic moves into the SDK and the demo imports it, with byte-identical demo output.
2. **A world to run against.** `pnpm sim` starts SimChain, two operator nodes and three test adjudicators with fake judges, and prints the endpoints, the funded test keys and the economics (fees, bonds, default outcome). Nothing in it can touch real money.
3. **Examples that run.** `examples/buy-dataset.ts` and `examples/sell-translation.ts`, short, one command each, executed by the test suite so they cannot rot.
4. **Docs for users.** `docs/quickstart.md` first in `README.md`; `docs/api.md`'s SDK example compiled against the real SDK; the surprises from the review stated where they bite (fee kept on refund, 6 decimals, whose key a `key.released` is, fake-judge records, `apply_default`).

**Non-goals.** No protocol, schema or settlement-rule change; no change to what SimChain enforces; no package publishing; no MCP surface (T-021); no new defenses. Operators stay relays: the party signs everything. The direct-submit escape hatch stays available to in-process callers but the HTTP-only sim client has none (stated in the quickstart). The outsider re-test itself is run by the coordinator, not by this task's implementer (Handoff).

## Context

- The outsider review (all friction items); `docs/api.md`; `packages/sdk/`; `packages/settlement/sim/actors.ts` (the `Deal` test helper the testers copied); `apps/demo/agents/` (Ledger and Tide-7 already do the high-level flow internally).

## Acceptance criteria

- [ ] High-level SDK, layered on the existing client (which stays): a party object holding its signer (a local private key in Phase 1), with `offer(terms)`, `agreeAndFund(offer)`, `deliver(commitmentId, bytes, mime)` (encrypts, uploads, wraps keys for every required recipient, signs), `openDeliverable(commitmentId)`, `appeal(...)`, `settle(...)` (mutual), `status(id)`, `waitFor(id, state)`. Signing, nonces and expiry are handled inside. Real crypto, not the `Deal` helper's fake encryption.
- [ ] `defaultTerms()` and a checks-only preset; the adjudicator's policy and registry hashes are fetched from its published registration (no hand-computed hashes).
- [ ] `pnpm sim` (or similar) starts a local world: SimChain, two operator nodes, and three test adjudicators with fake judges, printing endpoints and funded test keys. The operator gets a documented start script.
- [ ] `examples/` in the workspace: `buy-dataset.ts` and `sell-translation.ts`, each under ~60 lines, runnable with one command, and run in CI.
- [ ] `docs/quickstart.md` linked first from `README.md` ("Use it" above the team workflow): install, build, start the sim, run an example, read the result. States plainly: SimChain, fake judges, no real money; the fee is kept on a refund; tUSD has 6 decimals.
- [ ] `docs/api.md` SDK example matches the real SDK (tested by compiling it). `apply_default` in the trigger table. A `key.released` event says whose key it is.
- [ ] Fake-judge records are marked as fake wherever they appear to an integrator.
- [ ] Re-run the outsider test (both briefs, fresh agents) and record time to first settled deal; target under 15 minutes with no source reading.
- [ ] `pnpm verify` green.

## Out of scope

- Publishing packages to a registry (needs Rafa); the MCP tool surface (T-021); protocol changes.

## Evidence

## Decisions

## Handoff
