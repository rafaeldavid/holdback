# T-345: a zero-price deal through every outcome

- **Lane:** settlement (tests only)
- **Phase:** 2
- **Depends on:** T-340 (the state model and threat model, on main)
- **Paths this task may touch:** one new file under `contracts/test/unit/` (`ZeroPrice.t.sol`); one new section each in `docs/audit/state-model.md` and `docs/audit/threat-model.md`; this file
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** Claude Opus 5.5, a sub-session of the contract refinement coordinator; package R5b of the contract refinement plan (kept privately)

## Intent

On 2026-11-11 Rafa decided that the contract keeps the price of 0: a deal can carry no token value and still be real, because other terms or a future oracle state give it meaning. So the zero-price branches in `HoldbackRules.sol` stay in the audited code, and they need proof.

This task proves what a deal with price 0 and a fee above 0 does today, in every outcome. Each test asserts what the escrow holds before and after, who receives the fee and how much, the deal's stored word against the state model's row, and every event from the rules contract, the escrow and the bond vault, with its amounts, zero amounts included. One more test shows that price 0 with fee 0 cannot be funded, and names the escrow's error.

Inputs: the contracts on `origin/main`, `docs/audit/state-model.md`. Outputs: one test file and two doc sections. Non-goals: changing any contract; deciding whether price 0 with fee 0 should be supported (that question is Rafa's).

## Context

- `contracts/src/HoldbackRules.sol`: the zero-amount branches at `R:351`, `R:356-357`, `R:361`, `R:412-413`, `R:416`, `R:466`, `R:493`.
- `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol:179`: `validAmount` refuses an amount of 0 with `ZeroAmount()`.
- `docs/audit/state-model.md` sections 2 and 5.1: the rows and the holdings per row.
- Change kind 7 (`docs/team.md`, Change recipes): `forge test`, one review.

## Acceptance criteria

- [ ] A deal with price 0 and a fee above 0 has a passing test, or a recorded finding, for each outcome: release, refund, reclaim, default, early accept, mutual settlement, an escalation decided each way.
- [ ] Each test asserts the escrow's holdings, the fee's receiver and amount, the stored word against its row, and the full ordered list of events from the rules contract, the escrow and the vault.
- [ ] A test shows that price 0 with fee 0 cannot be funded and names `AuthCaptureEscrow.ZeroAmount`.
- [ ] `forge test` passes with more tests than before and none weakened.
- [ ] The two doc sections cite the tests.

## Out of scope

- Any change under `contracts/src/`, the handlers, the invariant tests or `contracts/test/differential/`.
- Party appeals with price 0: scope cut SC-7 removes them from phase one.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs: none (no fixtures change)
- Metrics:

## Decisions

## Handoff
