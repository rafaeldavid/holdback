# T-334: Contract clean-up before the audit (package C2)

- **Lane:** settlement
- **Phase:** 11 (Security hardening: the contracts made audit-ready for the pilot's audit)
- **Depends on:** none. It is the first package on the integration branch `contracts-audit-ready`, cut from `origin/main` at `1430f77`.
- **Paths this task may touch:** `contracts/src/` (the listed items only); `contracts/test/` and `contracts/script/` only where the moved or removed code requires it; `contracts/README.md` and `docs/audit/known-issues.md` only for lines these items make untrue; this file.
- **Human gate:** no for this task. The merge into `main`, the redeploy and the freeze are package C9, Rafa's.
- **Status:** merged to contracts-audit-ready, waits for C9
- **Agent/session:** the T-334 session (Opus 5.5)

## Intent

The contract source must be clean before an outside auditor reads it, and the later security fixes need bytes that `HoldbackRules` does not have (263 bytes under the EIP-170 limit). This task removes dead code and fixes stale text, and changes nothing a deal can observe: no settlement path, no revert a reachable call can hit, no event, no ABI entry. Five items:

1. Remove the dead fee-share branch in `_payOut`: the rate is a constant 0, so the branch never runs.
2. Remove the five smaller dead items: `Money.payout` (no caller), the identity call `Money.requirement(t.price, ALL_BPS)`, the unused flag value, the stored time nothing reads, and one unreachable error.
3. Fix stale comments: the "Phase 1, 2 and 4" references and the ADR-0025 status written into the code.
4. Move the test-only `SimBeacon.sol` out of `contracts/src/`, so `src/` holds only what deploys to a shared chain.
5. Pin the compiler pragma exactly in every contract file.

Each item is done, or held back with a reason when doing it would change behaviour, an event or the ABI. The output is a pull request into `contracts-audit-ready`, never into `main`, with the bytes freed in `HoldbackRules` measured. The branch deploys nothing; `main` stays equal to the Sepolia deployment.

Non-goals: the refine and secure items of the pilot plan (packages C3 to C7), the README's counts and the gas snapshot (clean item 6, with package C1d), `formal/`, `packages/`, `spec/`, and any deploy.

## Context

- The plan's contract findings, clean items 1 to 5 (private repository, `roadmap/plans/2026-11-11-pilot-refocus.md`, sections 3.3 and 7.2).
- `docs/reviews/2026-11-03-contract-review.md` I-2 and I-3; `docs/audit/known-issues.md`; `docs/tasks/T-212-contract-hardening.md` item 6.
- ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0022 (rounding), ADR-0025 (token identifiers).
- `contracts/README.md`, the build-input rule: every edit under `contracts/src` needs a redeploy, so the work stays on the integration branch.

## Acceptance criteria

- [x] Each of clean items 1 to 5 is done, or reported as not safe to do with the reason.
- [x] `forge test` passes with 248 tests or more (248 of 248 on 2026-11-11).
- [x] The anvil suites and `formal/check.sh`'s safety run pass.
- [x] The bytes freed in `HoldbackRules` are measured with `forge build --sizes` against the 263 bytes of headroom.
- [x] One review and one red team on the diff; Critical and High findings fixed.
- [x] The PR merges into `contracts-audit-ready`, not `main` (PR #326).

## Out of scope

- Any change to a settlement path, an event or the ABI (`packages/settlement/evm/abis.json` is checked against the compiled ABI and is not on this lane's paths).
- Refactors beyond the listed items: they go to the triage note for Rafa's decision on how far to refine.
- `docs/audit/scope.md`, `.gas-snapshot` and the deployment record (package C9).

## Evidence

Branch `t-334-contract-clean-up`, PR #326 into `contracts-audit-ready`, 2026-11-11.

**Each item**

| Clean item | State | `HoldbackRules` runtime |
| --- | --- | --- |
| 1. The dead fee-share branch in `_payOut` | Done. The public `MUTUAL_FEE_SHARE_BPS` getter stays, because it is in the ABI that `abis.json` pins | −30 bytes [measured] |
| 2a. `Money.payout`, no caller in `src/` | Held. It compiles to 0 deployed bytes, and four `Rounding.fuzz` tests call it, so removing it drops the test count below 248 | 0 |
| 2b. The identity call `Money.requirement(t.price, ALL_BPS)` | Done: the bond encumbers `t.price`. `_paymentInfo` runs first and refuses a price + fee above uint120, so the old `mulDivUp` could never revert | −51 bytes [measured] |
| 2c. The unused flag value 4 (the removed appeal flag) | Held. Renumbering `F_BY_FALLBACK` from 8 changes what the public `dealOf` returns; `BondConsent.t.sol` and `RulesHandler.sol` pin 8 | 0 [inferred: a constant change] |
| 2d. `t1` written by `triggerFallback`, read by no contract path | Held. `dealOf` returns it and the struct documents it as `fallbackSince` | would free 31 bytes [measured, scratch build] |
| 2e. The unreachable `AppealBondExists` check in `HoldbackBonds` | Held after review (Low 4). It is unreachable today, but removing it frees bytes only in `HoldbackBonds` (21,942 spare) and drops the vault's own guard on held appeal bonds, which package C5 is about to change | 0 |
| 3. Stale comments: "Phase 1, 2 and 4", "ADR-0025, Proposed" | Done, in `HoldbackRules`, `HoldbackBonds` and `HoldbackTypes` (ADR-0025 is still Proposed; the comments now cite it without the status) | 0 |
| 4. `SimBeacon.sol` out of `src/` | Done: moved to `contracts/script/`. Forge still writes `out/SimBeacon.sol/SimBeacon.json`, so `packages/settlement/evm/world.ts` and the NoAdmin allowlist need no change; two test imports moved | 0 |
| 5. The pinned pragma | Done: `pragma solidity 0.8.28;` in all six files (`foundry.toml` already pinned solc 0.8.28) | 0 |

**Measured results**
- `HoldbackRules` runtime 24,313 → 24,232 bytes: 81 bytes freed, so the headroom under EIP-170 grows from 263 to 344 bytes (`forge build --sizes`, before at `1430f77` and after at the PR head). `HoldbackBonds` 2,676 bytes, unchanged at the head; `SimBeacon` 492 bytes, unchanged.
- The held items would free little more: the getter 11 bytes, and the `t1` write 31 bytes (scratch builds, reverted). Items 2a, 2c and 2e free 0 bytes in `HoldbackRules`. So clean items 1 and 2 cannot free more than about 123 bytes in all [inferred from these builds].
- `forge test`: 248 passed, 0 failed, 0 skipped, in 37 suites, before and after.
- The ABIs: the built `HoldbackRules` and `HoldbackBonds` ABIs equal `packages/settlement/evm/abis.json` (sorted JSON, byte for byte).
- The anvil settlement leg, locally (`pnpm vitest run packages/settlement/evm packages/testkit/src/runner.test.ts`): 13 files, 221 passed, 0 skipped.
- `formal/check.sh safety`: pass, 107,519 distinct states, depth 31, 19 s. `formal/` is unchanged.
- `pnpm typecheck`: pass.
- CI on PR #326 at `df68e4b`: all 13 checks passed, both anvil legs (settlement 8 min 2 s, world 7 min 16 s), `contracts (forge test)` and `formal (TLC)` included. CI on the head after the review fixes: see the PR.

**Review and red team** (each with CLAUDE.md, ADR-0001, ADR-0002, `docs/neutrality.md` and `docs/audit/known-issues.md`, without the author's conclusions)
- Red team: PASS, no Critical, High, Medium or Low finding; 4 Info. It fuzzed `mutualSettle` from all four stages it accepts (5,000 runs), the encumbrance against the uint120 cap, re-entrant and repeated `fileAppeal`, and the `SimBeacon` chain guard; 12 proof-of-concept tests in `reports/scratch/t-334-redteam/`, all passing, none left in the tree [measured by the red team].
- Review: ISSUES, no Critical or High; 1 Medium and 3 Low, all fixed in one round: the Evidence and Handoff (this section), the last phase comment in `_acceptDelivery`, the README's file count, and the restored `AppealBondExists` check. It judged the three other holds (2a, 2c, 2d) right.

## Decisions

1. **ABI over completeness.** Where removing dead code would change the ABI (the fee-share getter, the `AppealBondExists` declaration), the code stays: `abis.json` is in `packages/`, off this lane, and `abis.test.ts` fails on any difference.
2. **`dealOf` counts as behaviour.** A public view's return value is observable, so items 2c and 2d are held even though no contract path reads them.
3. **No test count traded for dead code.** `Money.payout` stays rather than dropping or rewriting four fuzz tests for 0 bytes.
4. **`SimBeacon` goes to `contracts/script/`,** beside `LocalUSDC.sol` and `LocalMulticall3.sol`, the other anvil-only helpers. `script/TestUSDC.sol` is the only `script/` file in the deploy's build inputs, so the move adds nothing to `--check`.

## Handoff

**The branch's state.** `contracts-audit-ready` holds T-334 after PR #326's merge: `contracts/src` differs from `main` and from the Sepolia deployment (`64be1f1`), so `deploy-sepolia.sh --check` fails on this branch by design and passes on `main`, which this task did not touch. The ABI equals `main`'s; `HoldbackRules` has 344 bytes of headroom; `forge test` passes 248 of 248. C3 can start from the branch tip.

**For the next packages**
- **C3 to C5:** 344 bytes is the budget. The held items 2d and the getter add at most 42 bytes. If secure items 1 and 2 need more, logic has to move out of `HoldbackRules` (the plan's section 3.4).
- **The first package that regenerates `abis.json`** (likely C5, with the new domain) [inferred]: it may then drop the `MUTUAL_FEE_SHARE_BPS` getter (11 bytes) and decide 2c and 2d with the adapter's `dealOf` readers (`packages/settlement/evm/timeouts.ts`).
- **C6 or C7 (refine, NatSpec):** `Money.requirement`, `Money.payout` and `Money.split` now have no caller in `src/`; only `Rounding.fuzz.t.sol` and `Postings.fuzz.t.sol` call them. Decide whether the library stays as ADR-0022's on-chain reference or moves to the test tree. 0 deployed bytes either way.
- **C9 (the freeze):** `docs/audit/scope.md` lines 5, 17 and 26 still say six files and link `contracts/src/SimBeacon.sol`, now a broken link; its line counts change too.
- **A `packages/` lane:** `packages/core/src/beacon.ts:2` names `contracts/src/SimBeacon.sol` in a comment.
- **C8:** the reviewer recommends a second-family review of `_payOut`, the `encumber(t.price)` revert order and the appeal-state writes; C8 covers the lane's whole diff.

**Waits for Rafa:** nothing in this task. The merge into `main`, the redeploy and the new world are C9.
