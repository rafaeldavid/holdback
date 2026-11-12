# T-372: a hung store read never stalls the adjudicator

- **Lane:** judgment
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 5, settlement and judgment code (Change recipes): the packages' tests, one red team before it lands, a target of 200k tokens.
- **Depends on:** T-347 (an unreadable delivery never stalls other deals)
- **Roadmap:** "A delivery with no stored ciphertext can't stall the adjudicator for other deals", reopened
- **Paths this task may touch:** `apps/adjudicator/src/`; in `apps/demo-cloud/src/world.ts` only the declined-offer and refusal bookkeeping (the `DeclinedTurn` block, the state read's notices, `look()`'s skip of a declined offer, and the pass in `work()`), and its tests; the operator's delivery relay in `apps/operator/src/server.ts` and its tests; the fixtures this task adds; `docs/neutrality.md` for the fixtures' lines; this file.
- **Human gate:** no. The fix reaches the live adjudicators and operators only with a deploy, which waits for Rafa.
- **Status:** in progress
- **Agent/session:** the T-372 session, 2026-11-12, branch `t-372-hung-read-timeout`

## Intent

**Problem.** T-347 made a store read that *fails* cost only its own deal. A read that *never returns* still stalls everything: the adjudicator's pass awaits it, `runOnce` never returns, and every later deal in that pass and in all later passes goes unjudged. Three related gaps make the same failure hard to see or start:
1. The demo world's state read keeps only refusals on the terms, so a deal refused because the store did not answer shows no reason at all.
2. The demo world never clears a declined offer, so an offer the primary declined once (a reference not yet uploaded) still reads "declined, nobody can fund it" after the primary accepted it.
3. No operator checks its store before it relays a delivery, so a seller learns that its ciphertext is missing only when the deal defaults.

**Goal.**
1. Every read the pass awaits from the settlement port and its store has a time limit: the delivery's ciphertext, reference files, registrations, policies, bond cover and the task lists. A read past the limit is treated as an unreadable delivery is today: that deal is refused with the reason, nothing is judged, signed or published, the pass goes on with the other deals, and the deal is tried again on a later pass. A timeout never decides a deal and never reports it as declined.
2. The limit is a setting of the adjudicator service (`storeReadTimeoutMs`) with a stated default, not a protocol rule. Writes (a submission, a record publication) keep no limit here: their outcome after a timeout is unknown, and each relay has its own transport timeout.
3. The demo world's state read and its log carry an adjudicator-unavailable refusal, cut short and with no store error text.
4. A decline the primary reverses (it accepts on a later pass) leaves the public state read.
5. An operator with a ciphertext store refuses to relay a delivery whose ciphertext that store does not hold, and the error tells the seller to upload it first. The refusal is this operator's alone: other operators and direct submission still take the same signed delivery.

**Inputs.** The adjudicator's settlement port and store; the operator's store and the seller-signed Delivery.

**Outputs.** The timeout in `apps/adjudicator/src/service.ts`; the bookkeeping in `apps/demo-cloud/src/world.ts`; the relay check in `apps/operator/src/server.ts`; a failing test for each of the four gaps, committed before its fix; a `neutrality.*` test for the hung read and one for the relay check.

**Non-goals.**
- No change to the contracts, core, the settlement packages or the schemas.
- No signed reject for a ciphertext the store does not return in time (T-347 Decision 1 applies).
- No timeout on writes, the judges (they have their own) or the drand relays (they have their own).

## Context

- `docs/tasks/T-347-unreadable-delivery.md`: Decisions 1 and 2, and the red team's L1.
- `apps/adjudicator/src/service.ts` (`runOnce`, `#judge`, `#referenceProblem`), `settlement-port.ts`.
- `apps/demo-cloud/src/world.ts`: `DeclinedTurn`, the state read's `notices`, `look()`, `work()`.
- `apps/operator/src/server.ts`: `write()` and the relay policy (ADR-0005, D27).
- `docs/neutrality.md`.

## Acceptance criteria

- [ ] A test for each gap fails on `origin/main` and passes after the fix: the hung read, the missing refusal on the state read, the decline that is not cleared, the relay that does not check the store.
- [ ] A store that never answers for one deal: the two other deals in the same pass are judged (`neutrality.store-hangs`).
- [ ] An operator whose store lacks the bytes refuses; the SDK fails over to an operator that holds them and the deal settles (`neutrality.operator-lacks-ciphertext`).
- [ ] The timeout's default, its unit and why are in the adjudicator's configuration docs.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint` and `pnpm snap` pass; no existing `neutrality.*` or `attack.*` fixture changes its outcome.
- [ ] One red team on the diff; Critical, High and Medium findings fixed, Lows listed.

## Out of scope

- A write that never returns (a submission, a publication): each relay has its own transport timeout.
- An operator that checks a ciphertext held in another store than its own.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
