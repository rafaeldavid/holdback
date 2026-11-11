# Static analysis at HEAD, and the planted-failure check of CI (T-339)

**State:** Slither 0.11.6 finds no defect in `contracts/src/` at `1430f77`. It reports 78 results: 1 high, 17 medium, 40 low and 20 informational. Each high and medium result is already known or dismissed with a reason below [measured: the counts; inferred: the triage, from reading the code]. Aderyn did not run: it is not installed, and installing it waits on Rafa's OK. A planted failing forge test failed CI's `contracts (forge test)` job and the required `check` job (section 7) [measured].

## 1. What ran

| Item | Value |
| --- | --- |
| Commit | `1430f77` (`origin/main` on 2026-11-11). `contracts/src/` on the T-339 branch is the same tree [measured: `git diff --stat origin/main -- contracts/src` prints nothing] |
| Slither | 0.11.6, 102 detectors, 24 contracts analysed [measured] |
| Compiler | solc 0.8.28, `via_ir = true`, optimizer 200 runs, EVM `prague` (`contracts/foundry.toml`); forge 1.0.0-stable [measured] |
| Command | `slither /Users/rafa/Documents/escrow/.worktrees/t-339-static-analysis/contracts --filter-paths "lib/\|test/\|script/" --json reports/scratch/t-339-slither.json`, the same filter as at `baac930` |
| Raw output | `reports/scratch/t-339-slither.txt` (409 lines) and `reports/scratch/t-339-slither.json`, not committed |
| Aderyn | not run (section 4) |

## 2. Counts

| Run | High | Medium | Low | Info | Total |
| --- | --- | --- | --- | --- | --- |
| `baac930` (`docs/reviews/2026-11-03-contract-review.md` §4) | 1 | 16 | 40 | 20 | 77 |
| `1430f77` (this run) | 1 | 17 | 40 | 20 | 78 |

[measured]

By detector at `1430f77`: `arbitrary-send-erc20` 1 (high); `incorrect-equality` 9, `uninitialized-local` 6, `unused-return` 2 (medium); `reentrancy-events` 18, `timestamp` 15, `reentrancy-benign` 4, `missing-zero-check` 2, `calls-loop` 1 (low); `naming-convention` 9, `too-many-digits` 8, `low-level-calls` 2, `cyclomatic-complexity` 1 (informational) [measured].

## 3. Triage of every high and medium result

Line numbers are at `1430f77`. "Dismissed" means the code was read and the pattern Slither flags cannot do harm here. No result is a defect, so nothing goes to T-334's lane.

| # | Detector (impact) | Where | Answer | Reason |
| --- | --- | --- | --- | --- |
| S-1 | `arbitrary-send-erc20` (high) | `HoldbackBonds.sol:101`, `takeAppealBond` | dismissed, as at `baac930` | `takeAppealBond` is `onlyRules`. Its only caller, `fileAppeal` (`HoldbackRules.sol:503-518`), first checks the appellant's own EIP-712 Appeal signature, which binds the commitment, the appellant, the token and the bond amount (`:513`), and allows one appeal per deal (`:507`). So `from` is always the signer, for the amount it signed. The vault was deployed by the rules contract (`HoldbackRules.sol:146`), and `RULES` is immutable (`HoldbackBonds.sol:46`) |
| S-2 to S-10 | `incorrect-equality` ×9 (medium) | `HoldbackRules.sol:244, 255, 258, 262, 266, 283, 304` (`decide`); `:366, 367` (`_appealDecision`) | dismissed | Every instance compares an enum stage (`Stage`, `AppealState`) or an outcome code, never a balance or a timestamp. The detector targets equality on balances an attacker can nudge with a transfer; an enum has no such input |
| S-11 to S-16 | `uninitialized-local` ×6 (medium) | `HoldbackRules.sol:251-253` (`role`, `deadline`, `round` in `decide`); `:461-463` (`total`, `toSeller`, `captured` in `_payOut`) | dismissed | Solidity zero-initialises locals. In `decide`, every branch that does not revert assigns `role` and `deadline` (`:255-272`); `round` stays 0 only for the primary, which proves its seed by its commitment (`:287-289`) and never reads `round`. In `_payOut` the three are sums that start at 0 |
| S-17 | `unused-return` (medium) | `HoldbackRules.sol:483`, `_payOut` | known: I-2 | The ignored value is the remainder of the fee-share split on the dead branch I-2 records (its rate is a constant 0). `rest` at `:492` recomputes what stays held. T-334 removes that branch, so this result should disappear on `contracts-audit-ready` [inferred] |
| S-18 | `unused-return` (medium) | `HoldbackRules.sol:606`, `_refundAll` | dismissed | `_refundAll` reads only `capturableAmount` from CPP's `paymentState` and ignores `hasCollectedPayment` and `refundableAmount`. That is the one field it needs: CPP's `void` reverts when `capturableAmount` is 0 (`AuthCaptureEscrow.sol:307-308`), and this check skips `void` after the buyer's own CPP reclaim, so the deal still closes and its bonds are released (`:601`). The other two fields say nothing about what `void` can return |

## 4. Low and informational results, by detector

All dismissed; none moves money outside the terms [inferred from reading each location].

- `reentrancy-events` ×18 (low): events emitted after an external call to CPP or the bond vault, in `_payOut` (4), `_settleDecision` (3), `_appealDecision` (2) and one each in nine other functions. The callees are CPP (`nonReentrant`), the immutable vault this contract deployed, and the token; event order does not change state.
- `timestamp` ×15 (low): deadline comparisons with `block.timestamp`, in every timeout and deciding call. Deadlines are the design (ADR-0002); a validator's few seconds of drift are within what the parties set when they choose the windows.
- `reentrancy-benign` ×4 (low): `_deals[id] = d` after `BONDS.release` or `BONDS.encumber` in `_firstInstance` (2), `_escalationDecision` and `_appealDecision`. `release` and `encumber` only change the vault's own counters and emit an event (`HoldbackBonds.sol:74-84`); they make no external call, so there is no reentry path.
- `missing-zero-check` ×2 (low): the constructor's `erc3009Collector` and `permit2Collector` (`HoldbackRules.sol:136-137`). A deploy-time choice checked at deployment, as at `baac930`.
- `calls-loop` ×1 (low): `_capture` inside `_payOut`'s loop over co-signed payouts. Both parties sign the payout list; a reverting capture reverts only that settlement, which the parties can sign again or leave to the timeouts.
- `naming-convention` ×9 (info): immutables and constants in `UPPER_CASE` (`ESCROW`, `BONDS`, `BEACON` and so on). Style; kept.
- `too-many-digits` ×8 (info): the BLS12-381 field and curve constants in `DrandQuicknetBeacon.sol`. Kept, since they must match the published curve exactly.
- `low-level-calls` ×2 (info): `DrandQuicknetBeacon.sol:79-87` and `:155-159` call the EIP-2537 BLS precompiles, which have no Solidity interface. Kept.
- `cyclomatic-complexity` ×1 (info): `decide` scores 18. It is the one entry point for all three roles; T-334's lane may split it if the audit asks.

One `timestamp` and one `naming-convention` result sit in the simulated beacon, which C2 moves out of `src/`; they should leave the count then [inferred].

## 5. Diff from `baac930`

[measured: the counts and the lines; the commits from `git log -S` over `contracts/src/HoldbackRules.sol`]

| Change | Result | Cause |
| --- | --- | --- |
| Gone | `reentrancy-no-eth` (medium), `d.flags` set after `BONDS.tryEncumber` in `triggerFallback` (`baac930` `HoldbackRules.sol:529`) | `f685f09` (T-206 M-3) removed `tryEncumber`: the fallback now reserves its own bond with `encumber` when it decides (`:327`), which the `reentrancy-benign` row above covers |
| New | `incorrect-equality` at `HoldbackRules.sol:283`, `s == Stage.Refunded` in the key rule | `f2b28c1` (T-206 H-2 review): the buyer's key travels only with an accept, never on a refunded deal. Dismissed with S-2 to S-10 |
| New | `unused-return` at `HoldbackRules.sol:606`, `_refundAll` | `99dc47e` (T-206 M-1): close the deal after the buyer's CPP reclaim. Dismissed as S-18 |
| Same | `arbitrary-send-erc20`, 8 of 9 `incorrect-equality`, all 6 `uninitialized-local`, the I-2 `unused-return` | Lines moved by the fixes since `baac930` (S-1 was at `:100`, S-17 at `:464`) |
| Same count | Every low and informational detector: 40 low and 20 info at both commits | Locations shifted with the same fixes |

## 6. What waits

**Aderyn waits on Rafa.** It is not installed on this machine, and installing it is a download. The `baac930` run used Aderyn 0.6.8. To run it the same way, Rafa would install it with one of these [guessed: the install channels, from Cyfrin's published options; not tried here]:

```
brew install cyfrin/tap/aderyn
```

or `npm install -g @cyfrin/aderyn`. Then, with the submodules in place:

```
aderyn /Users/rafa/Documents/escrow/.worktrees/t-339-static-analysis/contracts --src src --output /Users/rafa/Documents/escrow/reports/scratch/t-339-aderyn.md
```

Its results then need the same triage: the `baac930` run's three highs (the type-hash `abi.encodePacked`, the vault reentrancy, the beacon cast) and low L-8 were all dismissed in the contract review, §4.

**Rows for `docs/audit/known-issues.md`** (the coordinator adds them; this task does not edit that file):

| ID | Gap | Recorded in | Status |
| --- | --- | --- | --- |
| G-7 | Aderyn has not run since `baac930`; Slither ran at `1430f77` with every result answered | `docs/reviews/2026-11-11-static-analysis.md` | open; waits on Rafa's OK to install Aderyn |

No Slither result needs a row of its own: S-17 is already I-2, and the rest are dismissed.

## 7. The planted-failure check of CI (T-241)

**State:** CI fails a change that adds a failing contract test. The `contracts (forge test)` job failed on the planted test, and the required `check` job failed because of it. This closes T-241's open item, "a planted failing contract test fails the run". No `.github/` change was needed [measured].

- **The change.** Draft PR #322, branch `t-339-planted-failure` from `origin/main` at `1430f77`, one file: `contracts/test/unit/PlantedFailure.t.sol`, whose one test runs `assertTrue(false, "T-339 planted failure: CI must fail on this")` [measured].
- **The run.** Workflow `ci`, run `43078620034`, about 11 minutes from push to the `check` job's result [measured].

| Job | Result |
| --- | --- |
| `changes` | success (`code=true chain=true`) |
| `gitleaks` | success |
| `typecheck, lint, spec, snap` | success |
| `test (1/4)` to `test (4/4)` | success |
| `formal (TLC)` | success |
| `anvil tests, settlement (must not skip)`, `anvil tests, world (must not skip)` | success (they build the contracts but do not run `forge test`) |
| `contracts (forge test)` | **failure**, after 3 min 37 s |
| `check` (the required status) | **failure** |

[measured: `gh run view 43078620034 --json jobs`; CodeQL's separate workflow also passed]

- **The failing line** in the `contracts (forge test)` log: `[FAIL: T-339 planted failure: CI must fail on this] test_plantedFailure() (gas: 3513)`. The summary reads `Ran 38 test suites in 47.33s (96.33s CPU time): 248 tests passed, 1 failed, 0 skipped (249 total tests)`, then `Encountered 1 failing test in test/unit/PlantedFailure.t.sol:PlantedFailureTest` and `Process completed with exit code 1` [measured: `gh run view 43078620034 --log-failed`].
- **Why `check` failed.** It printed `static=success test=success contracts=failure anvil=success formal=success`, and its step `test "failure" = success` exited with code 1 [measured, same log].
- **Clean-up.** PR #322 is closed unmerged, its remote and local branches are deleted, and its worktree is removed [measured: `gh pr view 322` reads `CLOSED`; `git ls-remote --heads origin t-339-planted-failure` prints nothing].
