# T-345: a zero-price deal through every outcome

- **Lane:** settlement (tests only)
- **Phase:** 2
- **Depends on:** T-340 (the state model and threat model, on main)
- **Paths this task may touch:** one new file under `contracts/test/unit/` (`ZeroPrice.t.sol`); one new section each in `docs/audit/state-model.md` and `docs/audit/threat-model.md`; this file
- **Human gate:** no
- **Status:** done
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

- [x] A deal with price 0 and a fee above 0 has a passing test, or a recorded finding, for each outcome: release, refund, reclaim, default, early accept, mutual settlement, an escalation decided each way.
- [x] Each test asserts the escrow's holdings, the fee's receiver and amount, the stored word against its row, and the full ordered list of events from the rules contract, the escrow and the vault.
- [x] A test shows that price 0 with fee 0 cannot be funded and names `AuthCaptureEscrow.ZeroAmount`.
- [x] `forge test` passes with more tests than before and none weakened.
- [x] The two doc sections cite the tests.

## Out of scope

- Any change under `contracts/src/`, the handlers, the invariant tests or `contracts/test/differential/`.
- Party appeals with price 0: scope cut SC-7 removes them from phase one.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
  - `forge test` on `origin/main` at `7147861`: 293 tests passed, 0 failed [measured].
  - The same after merging `origin/main` at `108856a`, with this file: 348 passed, 0 failed, 0 skipped; `ZeroPriceDealTest` has 21 [measured]. No other test file changed.
  - The 21 tests copied onto `origin/contracts-audit-ready` at `b88f9e5`: 21 passed [measured].
- Outcomes covered (`contracts/test/unit/ZeroPrice.t.sol`), with `P = 0` and `F = 500,000` base units: funding (L03); the primary accepts (L07) and rejects (L08); the fallback accepts (L09) and rejects (L10); reclaim (L34); the default after the fallback's silence, after an undecided escalation, and after the buyer's own reclaim on the escrow (L32); an escalation by the primary accepted (L31) and rejected (L32); an escalation by the fallback, then accepted; early accept from Held and after `deliver` (L33); a settlement before delivery (L35), after delivery with the key (L36), during the fallback's turn and during an escalation (L37); the payout refusal; an unbonded primary; price 0 with fee 0 [measured: each test passes].
- Findings: none. No test showed money moving outside the signed terms [measured].
- Review: one `reviewer` subagent, asked whether these tests could pass while a zero-price deal moves money wrongly. Its mutations on a scratch copy were caught: a fee paid to the seller, a skipped void, a bond reserved by the fallback [measured by the reviewer]. It found four unreached paths (a settlement during the fallback's turn, the fallback escalating, early accept after `deliver`, the default after the buyer's own reclaim on the escrow), one test with partial checks and one thin refusal case. All six are fixed in the third commit.
- CI on holdback PR 340: 15 of 15 checks passed, `contracts (forge test)` among them; merged as `5a90dc5` [measured].
- Snapshot diffs: none (no fixtures change).
- Metrics: none.

## Decisions

- **The full event list, not `expectEmit`.** `_check` compares every log from the rules contract, the escrow and the vault, in order, and fails on an extra one as well as a missing one. The token's own `Transfer` logs are left out; the balance checks cover them.
- **No event check on the reverted funding.** Foundry's log recorder keeps the logs of a reverted call, so the price 0 and fee 0 test proves the revert by the state: no word, no escrow record, no token moved.
- **A fixed time after a warp.** With `via_ir`, a `block.timestamp` read before a warp can be re-evaluated after it, so one test uses `judgeBy` as the escalation's time instead of reading the clock.
- **Party appeals are not covered.** Scope cut SC-7 removes them from phase one.

## Handoff

Done: one test file, 21 tests, and one section each in `docs/audit/state-model.md` (section 12) and `docs/audit/threat-model.md` (section 7).

**To run the same file against `contracts-audit-ready`** after each cut (the plan runs it again then):

```
git -C /Users/rafa/Documents/escrow fetch origin contracts-audit-ready
git -C /Users/rafa/Documents/escrow worktree add --detach /Users/rafa/Documents/escrow/.worktrees/t-345-audit-ready origin/contracts-audit-ready
git -C /Users/rafa/Documents/escrow/.worktrees/t-345-audit-ready submodule update --init --recursive
git -C /Users/rafa/Documents/escrow/.worktrees/t-345-audit-ready checkout origin/main -- contracts/test/unit/ZeroPrice.t.sol
forge test --root /Users/rafa/Documents/escrow/.worktrees/t-345-audit-ready/contracts --match-path test/unit/ZeroPrice.t.sol
git -C /Users/rafa/Documents/escrow worktree remove --force /Users/rafa/Documents/escrow/.worktrees/t-345-audit-ready
```

Once the lane merges `main`, the file is already there, and `forge test --match-path test/unit/ZeroPrice.t.sol` in the lane's own worktree is enough. Which cuts will need the file changed [inferred]:
- **SC-7** removes the vault, `appeal`, `flags` and `t2`: `_word`, `_bondsUntouched`, `_encumbered` and `_bondReleased` go, along with the vault's events in each expected list. The money and event assertions stay.
- **SC-6** removes `expireOffer`: the last block of the price 0 and fee 0 test goes.
- **SC-2** removes Permit2 funding: the Permit2 refusal in that test goes.
- **SC-3** removes third-party payouts: the third-party case in `test_mutual_refusesAnyPayout` still reverts, now for a second reason.
- **RF-4** (the closing reason) adds `reason` and `decider`: `_word` should check them.

Open questions:
- **Price 0 with fee 0** waits on Rafa. Today funding reverts with the escrow's `ZeroAmount()` (`AuthCaptureEscrow.sol:179`), and core has no such check [inferred], so core would accept terms the chain refuses.
- **State model section 9 is stale on SC-5.** Sections 9.1, 9.5 and Appendix A still list a zero price among SC-5's refusals; section 12 says the decision supersedes them. The owner of `docs/audit/` should correct those three places.
