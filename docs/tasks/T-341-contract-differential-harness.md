# T-341: the side-by-side harness and the state oracle (contract refinement package R3)

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-203 (the handler and the invariant suite), T-336 (the delivery liveness counter, absorbed here), T-340 (the state table, `docs/audit/state-model.md`)
- **Paths this task may touch:** new files under `contracts/test/differential/`; `contracts/test/handlers/RulesHandler.sol`; `contracts/test/invariant/`; `contracts/foundry.toml` (only what these tests need); this task file
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** implementer session, change kind 7 (smart contracts), refinement plan package R3

## Intent

Every later change to the contracts on `contracts-audit-ready` must prove what it changes and what it leaves alone. This task builds the two tools that proof needs.

1. **The side-by-side harness (gate VG-1).** A pinned copy of the contracts as deployed on Sepolia (commit `64be1f1`) lives under `contracts/test/differential/`, with a test that its bytes still match that commit. One test runs the same random sequence of handler actions against the old copy and against the source under test, from the same starting state at the same addresses, and compares after every step: every call's outcome, every event, every token balance, every hold, every bond, every deal's stage and stored word, and the clock. Any difference fails the run, unless an allow-list entry names the change and the exact difference. A sequence is reproducible from its printed seed. A planted behaviour change (a copy that stores no delivery hash) fails the harness, and a kept test proves it.
2. **The state oracle (gate VG-2).** After every step of the invariant campaign, every deal's stored word must be one of the legal combinations of `docs/audit/state-model.md` (T-340). Until that table lands, the oracle's rows are derived from the stage enum and the code on `main`, and each row says so. A planted illegal word fails the oracle, and a kept test proves it. The oracle also carries the delivery liveness counter of pilot package C1b (T-336): the "stores no delivery hash" mutant fails an invariant, and a kept test proves that too.

Inputs: the contract source on `main` (equal to `64be1f1`), the handler, T-336's uncommitted counter, T-340's table when it lands. Outputs: tests under `contracts/test/`, run by `forge test` in the CI job `contracts (forge test)`.

Non-goals: no change under `contracts/src/`, `docs/audit/`, `formal/`, `packages/`, `apps/`, `examples/`, `spec/` or `.github/`. No existing test or invariant is weakened or deleted. No deploy.

## Context

- Refinement plan (crow-private `roadmap/plans/2026-11-11-contract-refinement.md`): section 3.3 (the oracle), section 6 (gates VG-1 and VG-2), section 7 (package R3).
- `docs/audit/known-issues.md`, gap G-5 (no invariant counts a lost delivery hash).
- `contracts/test/handlers/RulesHandler.sol`, `contracts/test/invariant/RulesInvariants.t.sol`, `contracts/test/unit/Base.sol`.
- ADR-0029 (every decision names the posted delivery), ADR-0001 (neutrality), ADR-0002 (the hold).

## Acceptance criteria

- [ ] The pinned copy of `64be1f1`'s `contracts/src/` sits under `contracts/test/differential/`, and a test fails if any of its bytes change.
- [ ] The side-by-side test runs in `forge test`, compares calls, events, balances, holds, bonds, stages, deal words and the clock after every step, and prints the seed that reproduces a failure.
- [ ] With both sides built from `main`'s source and an empty allow-list, the harness passes.
- [ ] A planted behaviour change fails the harness; a kept test proves it.
- [ ] The state oracle runs as an invariant after every step of the campaign; a planted illegal word fails it; a kept test proves it.
- [ ] The delivery liveness counter (T-336) is in the handler, and the "stores no delivery hash" mutant fails it; a kept test proves it.
- [ ] The harness's run time is measured and fits the CI job, or its cost is stated.
- [ ] Nothing under `contracts/src/` changes; the deployed bytecode and `deploy-sepolia.sh --check` are untouched.

## Out of scope

- Allow-list entries for real changes: each change on `contracts-audit-ready` writes its own.
- `docs/audit/known-issues.md` row G-5 and `contracts/README.md` counts (other lanes).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
