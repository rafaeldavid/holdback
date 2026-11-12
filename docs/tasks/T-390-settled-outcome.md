# T-390: a deal that ends Settled finishes in the buyer's tools and adds up in the deal record

- **Lane:** demo (client tools)
- **Phase:** 2
- **Depends on:** T-379 (the buyer signer and the deal record with the two addresses, merged to `contracts-audit-ready` at `100cde3`), T-378 part 4 (the late-work settlement route, rafaeldavid/holdback#408), T-387 (the pilot kit's rehearsal, which found both defects)
- **Paths this task may touch:** `examples/buyer-signer.ts`, `examples/buy-with-signer.ts`, `examples/deal-record.ts`, their tests, this task file. Never `packages/settlement`
- **Human gate:** no
- **Status:** done on the merge of this task's pull request
- **Agent/session:** the T-379 session, change kind 4: one reviewer

## Intent

In my own words. A deal can end three ways, and the buyer's tools know two. A mutual settlement, with late work or as any split of the price, ends `Settled`. T-387 measured both gaps on a phase-one `pnpm sim` at `e4e930c` (`t-387-defects.md` in the shared notes):

- **The buyer's command never returns.** `watch()` in `examples/buyer-signer.ts` waits for `Released` or `Refunded`, so `buy-with-signer.ts resume` polls a settled deal for ever. `Settled` becomes a final outcome, recorded only when every configured operator agrees, as the other two are. When the settlement released the key, the buyer opens the work and checks both hashes. When it did not, the tool says so and opens nothing. Either way the outcome line names the settlement's payouts.
- **The deal record fails a check that holds.** `examples/deal-record.ts` conserves the hold from the `postings` of the settling event. SimChain's `commitment.settled` carries `payouts` and no postings, so "postings conserve the hold" fails, and `paidTo` comes out null, although the payout address was paid. The EVM adapter's event has the same `{payouts, keyReleased}` shape, and none of its events carries postings [measured by reading `packages/settlement/evm/evm-settlement.ts:1538-1554`]. So the record conserves the hold from the payouts where there are no postings: they sum to the price, and the adjudication fee returns to the buyer's payment address, less the sitting adjudicator's rulebook share. It names who was paid from them. Where an event carries no postings and no payouts, as a chain's release or refund does, the postings checks are marked not run, not failed.

Non-goals: no change to SimChain's or the EVM adapter's events (the record reads both shapes); no settlement command for the buyer (it signs a settlement through the API or its own tools).

## Context

- `t-387-defects.md` (shared notes): the reproduction.
- `packages/settlement/sim/simchain.ts:935-970`: what a settlement moves (one posting per payout, the fee share, the fee back to the buyer's payment address) and what `commitment.settled` carries.
- T-378's late-work route (rafaeldavid/holdback#408): the settlement carries the unposted delivery; `key.released` follows with path "mutual settlement"; no `delivery.submitted`.

## Acceptance criteria

- [x] `watch()` ends on `Settled` when every configured operator reports it, and returns the payouts and whether the key was released; an `unconfirmed` report covers `Settled` too.
- [x] `openDelivery()` on `Settled` with the key released opens the work and checks the ciphertext's and the plaintext's hashes: from the posted delivery when there is one, and for late work from the delivery the seller handed over (`--delivery <file>` on `resume`), checked against the seller's signature and the released envelope. Without the key released, or without the handed-over delivery for late work, it opens nothing and says why.
- [x] `buy-with-signer.ts resume` returns with exit status 0 and an outcome line naming the payouts, for a settlement with the key released, one without, and a late-work settlement. The script stays at 50 lines or fewer.
- [x] The deal record conserves the hold from a settlement's payouts, names `paidTo` and `refundedTo` from them, and marks the postings checks not run for an event with neither postings nor payouts. Tests on SimChain's shape and on the chain's shape.
- [x] `pnpm typecheck`, `pnpm lint`, the touched tests and `pnpm snap` pass; CI passes.

## Out of scope

- SimChain's and the EVM adapter's event payloads.
- The chain's Transfer logs as a source for the record's postings (Handoff).

## Evidence

Labels: measured, inferred, guessed.

- **Commands run, on the lane at `e4e930c` plus this branch** [measured]: `pnpm typecheck` passed; `npx eslint examples site tests` passed; `pnpm exec vitest run examples/ tests/cut-feature-alignment.test.ts` passed 398 tests in 32 files (23 skipped); `pnpm snap` passed 43 of 43, no snapshot diff; `node site/check.mjs` passed, and the site files did not change.
- **The buyer's tools** [measured, `examples/buyer-signer-settled.test.ts`, 3 tests, on demo-cloud's world in phase one]:
  - A settlement after a posted delivery, with the key released: `watch` reports `settled` and returns `Settled` with the key released; `buy-with-signer.ts resume` exits 0, prints the payouts, and opens the work.
  - A settlement that releases no key: `resume` exits 0 with the payouts, `work: null` and the note "the settlement released no key: there is no work to open".
  - A late-work settlement: `resume` exits 0 and asks for the handed-over delivery; with `--delivery <file>` it opens the work; with another signed delivery of the seller's it exits 1 ("the key the settlement released is not your envelope in the delivery you passed").
  - A judge that waits at a gate the test opens holds the rubric deal in judging after its delivery, so the parties can settle it first.
- **The deal record** [measured, `examples/deal-record.test.ts`, 1 new test and 3 new assertions]:
  - On SimChain's shape (a real late-work settlement): "postings conserve the hold" and "postings follow the outcome" pass, `paidTo` is the seller's payout address and `refundedTo` the buyer's payment address.
  - On the chain's shape (both operators' events stripped of postings, as the EVM adapter writes them): the two postings checks are marked not run, with the reason, and the record does not fail.
- **Where the shapes come from** [measured by reading]: SimChain's `commitment.settled` is `{payouts, keyReleased}` (`packages/settlement/sim/simchain.ts:967`), and its postings for the payouts and the fee are made but not put in the event. The EVM adapter writes every payload "as SimChain writes it for the same step (without postings)" (`packages/settlement/evm/evm-settlement.ts:1538`), and `commitment.settled` there is `{payouts, keyReleased}` too (`:1553`).

## Decisions

- **The fix is in the record, not in SimChain's event.** Both settlements write the same `{payouts, keyReleased}`, and a chain writes no postings for any outcome, so the record reads the payouts for a settlement and marks the postings checks not run where an event carries neither.
- **Late work opens from the delivery the seller handed over,** passed with `--delivery`, because no operator records it as a delivery. It opens only if the seller's signature recovers, the released envelope is the buyer's own in it, and both hashes match.
- **`Settled` is final only when every configured operator reports it with the same payouts and key release;** a disagreement keeps the deal unconfirmed, as for the other outcomes.

## Handoff

- **Outside the listed paths:** `examples/audit-deal.ts` gains `'Settled'` in two type unions (its outcome and `EndState`), a type-only change the wider `Delivery.outcome` needs; the rehearsal makes no settlement.
- **For the record on a chain:** a release's or refund's money is in the token's Transfer logs, which the record does not read; its postings checks say so and are not run.
- **For T-387:** rerun the settlement cases; `resume` takes `--delivery <file>` for late work.
