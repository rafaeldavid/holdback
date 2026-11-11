# T-338: The audit docs: a threat model, the invariants list, the events inventory, and the sources' disagreements settled

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-334 (contract clean, in parallel), T-336 (adds one invariant in parallel)
- **Paths this task may touch:** `docs/audit/threat-model.md`, `docs/audit/invariants.md`, `docs/audit/events.md` (new); `docs/audit/known-issues.md` (section 8, and the rows section 8 settles, except G-3, G-4, G-5, section 2's "Recorded in" cells and section 3, which other packages edit); `docs/audit/scope.md` (links to the new pages); this task file
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** implementer, pilot plan package C1d (change kind 2, process docs and records)

## Intent

An auditor who opens `docs/audit/scope.md` should find, in three more pages, everything needed to start the contract audit without asking us about scope: who the actors are and what each can do (the threat model), which properties the code is checked against and by which test (the invariants list), and which events the contracts emit and who reads them (the events inventory, N28). The known-issues page today ends with six places where our own sources disagree; this task reads the primary sources (the code at HEAD, the PRs, the task files), settles each one, corrects the page's own rows, and leaves a short record of how each was settled.

Inputs: `contracts/src/`, `contracts/test/invariant/`, `formal/`, `docs/neutrality.md`, `docs/architecture.md`, `SECURITY.md`, the contract review, the ADRs, the PRs and the task files. Outputs: three new pages under `docs/audit/`, an edited section 8 of `known-issues.md`, links from `scope.md`, and this task file.

Non-goals:
- No contract source, test, `.gas-snapshot` or `contracts/README.md` change. Gaps in events are listed as requirements for the settlement spec (T-245), not fixed here; events are never removed.
- No edit to any doc outside `docs/audit/`. Where another doc is wrong, the Handoff lists it for the docs batch.
- No new finding is invented; the pages gather and check. One exception is stated plainly: L-3 with L-5 is open and blocks mainnet.
- The rows G-3, G-4, G-5, section 2's "Recorded in" cells and section 3 belong to other packages running at the same time.

## Context

- `docs/audit/scope.md`, `docs/audit/known-issues.md`
- `docs/neutrality.md`, `docs/architecture.md`, `SECURITY.md`
- `docs/reviews/2026-11-03-contract-review.md`, ADR-0018 and the ADRs it cites
- `contracts/src/`, `contracts/test/invariant/RulesInvariants.t.sol`, `formal/Holdback.tla`, `formal/README.md`
- T-206, T-212; T-336 (the delivery-hash liveness invariant for G-5); T-245 (the settlement spec)

## Acceptance criteria

- [ ] `docs/audit/threat-model.md` names every actor, its capabilities and trust, the assets, the trust boundaries and each attack class with where it is defended or accepted; it quotes ADR-0018's "not adopted" answer for DS-1 and states that L-3 with L-5 is open and blocks mainnet.
- [ ] `docs/audit/invariants.md` keys each of the 10 `invariant_*` tests by exact name, plus the state machine and the formal model's properties, each with the property, its check and the functions it constrains; one row is reserved for T-336.
- [ ] `docs/audit/events.md` lists every event in `contracts/src/` with fields, emitters, consumers, consumer gaps and what it reveals publicly; gaps are requirements for T-245.
- [ ] `known-issues.md` section 8 records each of the six disagreements as settled, with the source that is right, and the page's own rows agree with it.
- [ ] `scope.md` links the three pages in its reading order.
- [ ] Every claim is labelled measured, inferred, documented or guessed; file and line references are at HEAD.

## Out of scope

- Contract code and tests; other docs (listed in Handoff instead); the rows other packages own.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff
