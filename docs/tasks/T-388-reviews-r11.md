# T-388: the two whole-diff reviews before the freeze (package R11)

- **Lane:** settlement (contracts), branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-384 (package R9: pull request 1 fixes the code under review, pull request 2 its descriptions), T-380 (package R8), T-352 (package R10), T-385 (the docs pass)
- **Paths this task may touch:** `docs/reviews/` (two new reports), `contracts/test/crosscheck/R11Review.t.sol` (the tests behind review 1), this task file. A Critical or High finding in the contracts gets its own pull request, which may touch `contracts/src/*` and its tests. `examples/` belongs to T-390
- **Human gate:** yes for one call: the second review sends the public repository's source and docs to the DeepSeek API, which Rafa named on 2026-11-11 and runs himself. No deploy, no live run
- **Status:** in progress
- **Agent/session:** the T-388 session, change kind 10 (a review); a fix would be kind 7 (smart contracts)

## Intent

Read the phase-one contracts twice before they are frozen, tagged and deployed on Sepolia, so that the outside audit starts from fewer open findings. The bar is best effort: every finding these reviews make first saves a round of fix, redeploy and re-audit.

- **Review 1** is this session's, at full depth: every line of `contracts/src` at the commit, the vendored escrow's functions the contracts call, and in full the three dependencies no earlier review read (the payment collectors, `TokenStore.sol`, Solady's signature library). It works from questions for each external function: who can call it, in which stage, with which signatures; what it moves and to whom; what stops a second call; what happens at each deadline's exact second; what ordering, delaying or replaying gains; whether money can reach an address the terms did not name; whether the key can leave without the payment; whether any path leaves funds nobody can move.
- **Review 2** is by another model family, DeepSeek, through its API. It gets the same source, docs and questions, in pieces small enough that each answer completes, and none of review 1's conclusions. This session checks each of its claims against the code and says which hold.
- **Named scope beyond the diff:** sections 7 to 11 of `docs/audit/state-model.md`; the buyer signer's two paths (`examples/buyer-signer.ts`: where its expectations come from, and its resume path); and the question that one operator runs both nodes of the public demo and alone sets every expectation the buyer leaves out. After T-384's second pull request: the descriptions, read against the code.
- **Outputs:** two dated reports under `docs/reviews/` with a joint summary, and the tests behind review 1.
- **Non-goals:** no fix below High, no refactor, no change to events, no deploy. A finding that is not Critical, High or a regression is recorded and not fixed.

## Context

- The scope of phase one: [ADR-0031](../decisions/ADR-0031-phase-one-contract-scope.md). The beacon rounds and their margin: [ADR-0032](../decisions/ADR-0032-beacon-rounds-escalation-and-fallback.md). The two money addresses: [ADR-0033](../decisions/ADR-0033-payout-and-payment-addresses.md).
- [`docs/audit/state-model.md`](../audit/state-model.md), [`threat-model.md`](../audit/threat-model.md), [`invariants.md`](../audit/invariants.md), [`known-issues.md`](../audit/known-issues.md), [`scope.md`](../audit/scope.md), and [`formal/README.md`](../../formal/README.md).
- The earlier second-family read and its two method lessons: [`docs/reviews/2026-11-11-drand-verifier-second-read.md`](../reviews/2026-11-11-drand-verifier-second-read.md). That model missed the round finding, and three of its four answers stopped at the client's 8,192-token output limit.
- The deployed contracts are commit `64be1f1`; the diff under review is `git diff 64be1f1 <commit> -- contracts/src`.

## Acceptance criteria

- [ ] Review 1's report is under `docs/reviews/`, with the commit, what was read with line counts, findings by severity with file, line, scenario and test, what was checked and found sound by function, and where it did not look.
- [ ] Review 2's report is under `docs/reviews/`, with the same parts, the model, the calls and their token counts, every question that got no complete answer, and for each claim whether it holds.
- [ ] A joint summary says what must be fixed before the freeze, what goes to known issues, and what is for the outside auditor's attention.
- [ ] Every Critical or High finding in the contracts is fixed in its own pull request with a test that failed first, or handed to Rafa with a reason.
- [ ] Both reports are merged on the lane in one docs pull request.

## Out of scope

- Token-issuer risk: a token that freezes, pauses or blacklists is not a finding.
- The arithmetic inside `DrandQuicknetBeacon.sol`, which had its own review and second read (T-343, T-353). Review 1 reads the file for what the rules contract relies on.
- Fixes to `examples/`: T-390 owns them.

## Evidence

Filled in as the work lands. Each item is labelled measured, inferred or guessed.

## Decisions

- **The second review runs from Rafa's shell, not from a session** (the coordinator, 2026-11-12): the key stays in his environment. The runner is `reports/scratch/t-388/run.mjs` in the main checkout; it reads every file with `git show` at the commit it is given.
- **The runner calls the provider itself, not through the repository's live client.** That client caps output at 8,192 tokens and turns the model's reasoning off, and no cap in product code is raised for a review.

## Handoff

Filled in at the hand-off.
