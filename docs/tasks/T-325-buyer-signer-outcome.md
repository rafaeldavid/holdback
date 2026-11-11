# T-325: the buyer signer reports the outcome and reclaims a hold after a missed deadline

- **Lane:** examples (client code), with one section of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, example and client code (Change recipes): the examples' tests, no review, a target of 150k tokens. The `site/llms.txt` edit is kind 1.
- **Depends on:** T-319 (`examples/buyer-signer.ts`).
- **Paths this task may touch:** `examples/buyer-signer.ts`, `examples/buyer-signer.test.ts`, `examples/buyer-signer-outcome.test.ts` (new), `examples/buy-with-signer.ts`, `vitest.config.ts` (one cost line for the new test file), `site/llms.txt` (the buyer signer's section only), `site/index.html` (only as `node site/build.mjs` regenerates it), this file. Never: `packages/`, `apps/`, `spec/schemas/`, `contracts/`, `examples/seller-adapter.ts` and its stub, template and test (T-323, T-324), `examples/audit-deal.ts` (T-326), `examples/agent.ts`, `examples/verify.ts`.
- **Human gate:** no. The site deploy that publishes the `llms.txt` edit waits for Rafa.
- **Status:** in progress
- **Agent/session:** the T-325 session, 2026-11-11, branch `t-325-buyer-signer-outcome`
- **Roadmap row:** N62

## Intent

Rafa listed this gap on 2026-11-11, after the first audit deal: the buyer signer stops at the funding.

**Problem.** `examples/buyer-signer.ts` (T-319) funds a deal and then only waits, for 10 minutes, for `Released` or `Refunded`. The buyer's agent learns nothing on the way. When the seller never delivers, the hold stays until someone sends the reclaim after `deliverBy`; on SimChain nobody does, and on Sepolia the buyer waits for the operators' own pass. A signer that is restarted between the funding and the outcome has to be told the commitment ID again.

**Goal.** After the funding, the signer follows the deal to its outcome, on the buyer's machine:
- it tells the buyer's agent, through a callback, when the deal is released, when it is refunded, and when `deliverBy` passes with nothing delivered;
- once `deliverBy` passes with the deal still `Held`, it sends the reclaim itself and reports the refund;
- it reads the state from every configured operator and goes on when one of them is offline;
- it keeps what it has done in the key file, so a restart neither loses the deal nor sends the reclaim twice.

**Inputs.** A signer that `agreeAndFund` funded (or `loadKeys` reopened), the agreed terms it saved, and the configured operators.

**Outputs.**
1. `BuyerSigner.watch(commitmentId, { onReport })`: follows the deal to `Released` or `Refunded`, sends the reclaim when it is due, and returns the outcome. `openDelivery` calls it, so a client that only calls `openDelivery` gets the reclaim too.
2. `openDeals(store)`: the funded deals in a key store with no recorded outcome, for a client that restarts without the commitment IDs.
3. Tests on SimChain through `startSimWorld`: the missed deadline, the deadline with one operator offline, a restart at each step around the reclaim, and the released and refunded reports.
4. The buyer signer's section in `site/llms.txt` says what the signer reports and that it sends the reclaim.

**Non-goals.**
- No new route, schema, contract or signed message.
- No Python signer and no Delegation admission (roadmap row N38).
- No buyer appeal, no early accept and no mutual settlement in the signer.
- No limit of the signer's own on any deadline (D31): it reads `deliverBy` from the agreed terms, and waits as long as the terms say.

## Context

- `site/llms.txt`, "Beyond the happy path": the operators send each timeout a minute or two after its deadline; anyone may send `POST /v1/commitments/<id>/triggers/reclaim` with `{}` once `deliverBy` has passed; too early is 409 `invalid_state`.
- `spec/openapi/paths.json`, the triggers route: "Anyone may call a trigger once its deadline passed; no signature."
- `apps/operator/src/server.ts`: errors are stored under their `Idempotency-Key` and replayed, so a refused trigger needs a fresh key for the next try.
- `examples/agent.ts` (`Agent.trusted`, `Agent.sources`), `examples/audit-deal.ts` (its own reclaim through the trigger route).
- Hard rules in `CLAUDE.md`: signed messages, idempotency, secrets never printed; neutrality (an offline operator does not stop the deal).

## Acceptance criteria

- [ ] `watch` reports `released`, `refunded` and `deliverBy-passed` to the buyer's agent, each once per run, and returns the outcome.
- [ ] After `deliverBy` passes with the deal `Held`, `watch` sends the reclaim with an `Idempotency-Key`, and reports the refund; the buyer's balance shows the hold back.
- [ ] The missed-deadline case passes on SimChain through `startSimWorld`, and again with one of the two operators closed.
- [ ] A signer reopened from the key store after a stop before the reclaim, after a reclaim whose answer was lost, and after the reclaim landed reaches `Refunded` with one reclaim request in all.
- [ ] `openDeals(store)` lists a funded deal with no outcome after a restart, and not once the outcome is recorded.
- [ ] Tests cover the released and the refunded (by decision) reports.
- [ ] `pnpm typecheck`, `pnpm lint` and the examples' tests pass.

## Out of scope

- A Python signer; Delegation admission (N38).
- A sweep of a refunded hold off the per-deal key (T-319 Handoff 1).
- Outcomes other than `Released` and `Refunded` as final states (an appeal, a settlement, a default in progress): `watch` keeps waiting through them.

## Evidence

Filled in before the PR leaves draft.

## Decisions

1. **The reclaim carries no signature, because the protocol defines none.** The task asked for a reclaim signed with the buyer's key. The API's reclaim is a timeout trigger: anyone may send it once `deliverBy` has passed, with `{}` and no signature, and the settlement layer checks the deadline (`spec/openapi/paths.json`; `site/llms.txt`, "Your own trigger"). A signed reclaim would be a new message type, an API contract change through an ADR, outside this task's paths. So the signer sends the trigger from the buyer's machine, with an `Idempotency-Key`, and no operator authors anything: the deadline in the terms both parties signed is the authority. The direct path from the buyer's key to the contract (the escape hatch) needs ETH on the per-deal key and stays out (Handoff).

## Handoff

Filled in at the end.
