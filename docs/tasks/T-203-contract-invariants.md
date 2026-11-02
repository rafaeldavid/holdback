# T-203: Invariant and fuzz tests for the rules contract

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-202's external interface (function signatures and events merged; handlers can be written against it while T-202 finishes its internals). The full campaign runs against T-202 as merged.
- **Paths this task may touch:** `contracts/test/invariant/`, `contracts/test/fuzz/`, `contracts/test/handlers/`, `.github/workflows/ci.yml` (add a `contracts` job running `forge test`, and a `formal` job that runs `formal/check.sh` only when that file exists, so T-204 needs no CI edit; change nothing else in the file), `docs/team.md` (the "No admin keys" row of Rules and checks only), `docs/tasks/T-203-contract-invariants.md`
- **Human gate:** none. Local chain only; no public network.
- **Status:** review
- **Agent/session:** implementer (T-203 worktree agent), 2026-11-01 to 2026-11-02

## Intent

Prove, by stateful fuzzing against the Foundry contracts, the invariants SimChain already property-tests: no unit of token is created or destroyed, no escrow settles twice, nothing has an admin path. Handlers drive random interleavings of every submission and every timeout from random callers, so a guard that only holds on the happy path fails here. Run in CI.

**In my words (T-203 agent, 2026-11-01).** T-202's unit tests show each guard on the path its author had in mind. This task asks whether the guards still hold when nobody is choosing the path: a handler calls every entry point of `HoldbackRules` and `HoldbackBonds` and every timeout, in random order, from random actors (parties, the three adjudicators, an operator, a stranger), with signatures from random keys, while time jumps onto, just before and just after every deadline. After every call, Foundry checks that tokens are conserved per token, CPP's token store holds exactly what the open commitments say, no commitment settles twice, bond books never go negative or double-count an encumbrance, every timeout fires exactly when due (for anyone), nothing moves without the right signature or a due timeout, and no admin path exists. Each invariant must be shown to catch a deliberate bug (a mutant in a scratch copy). CI runs `forge test` and the formal model's check, and the required `check` job waits for both.

**Non-goals.** No contract change: HoldbackRules has 34 bytes of EIP-170 headroom, and a failing invariant is a T-202 finding, recorded in Handoff. Not the formal model (T-204), not SimChain differential tests (T-205, running in parallel in `packages/settlement/evm`), not external review (T-206). Local EVM only: no broadcasts, no `cast send`, no public RPC.

## Context

- `docs/architecture.md` (invariants list, postings table); ADR-0022 (rounding: requirements up, splits round the rate side down with a named remainder claimant, bond payouts down); ADR-0003 (settle-once and idempotency live in the rules contract).
- `packages/settlement/sim/properties.test.ts` (the SimChain properties to mirror); `docs/neutrality.md` (contract review checklist: no owner, pause, blacklist, `selfdestruct`, upgrade proxy; every timeout callable by anyone).
- `docs/team.md` Rules and checks, "No admin keys" (Phase 2 check owed) and "Every settlement guard is tested on its own" (mutation sweep).

## Acceptance criteria

- [ ] Handlers cover every external function and every `TimeoutKind`, with callers drawn from the parties, the three adjudicators, an operator and an unrelated address, and time warps across every deadline.
- [ ] Invariants, each its own `invariant_*` function: conservation (sum of token balances over all actors, the escrow and the bond escrow is constant); the escrow's balance equals the sum of open holds; each commitment settles at most once; no balance underflows; encumbered bond is never counted twice; a timeout never succeeds before its deadline and always succeeds after it for any caller when its state allows.
- [ ] Fuzz tests for rounding: for random amounts and bps, share plus remainder equals the pot, requirements round up, bond payouts round down (ADR-0022).
- [ ] No admin selectors: an ABI-level test over every deployed contract fails on any selector outside a reviewed allowlist, and on any of the checklist's forbidden functions or opcodes.
- [ ] `forge test --match-path 'test/invariant/*'` green with at least 256 runs and depth 100 (set by inline `forge-config`, so `foundry.toml` stays T-202's), and the run count and seed recorded in Evidence (measured).
- [ ] Each invariant is shown to bite: for each one, a named mutant of the contract (applied in a scratch copy, journaled and restored as `docs/team.md` requires) makes it fail. List mutant and failing invariant in Evidence.
- [ ] CI runs `forge test` in a `contracts` job and `formal/check.sh` in a `formal` job when present; the `check` job requires both. `docs/team.md` "No admin keys" row points to the test.
- [ ] `pnpm verify` still green. PR opened.

## Out of scope

- Changing contract code: a failing invariant is a finding for T-202 (write it in Handoff and stop).
- The formal model (T-204), differential tests against SimChain (T-205), external review (T-206).

## Evidence

All runs were local: Foundry 1.0.0-stable, in-process EVM, chain id 31337, no RPC.

**Suites.**
- `(cd contracts && forge test)`: 135 tests pass in 18 suites (T-202's 96, plus 39 new). Wall time 13.5 s with a warm build. Log: `reports/forge-t203.log`. [measured]
- `forge test --match-contract RulesInvariants --fuzz-seed 0x203`: all 8 invariants pass at **256 runs × depth 100 = 25,600 calls each**, 204,800 calls in total. Log: `reports/invariant-seed-0x203.log`. [measured]
- `foundry.toml` sets no fuzz seed, so every other run, CI included, draws a fresh random seed. Runs and depth are set by inline `forge-config` on each invariant; `foundry.toml` is untouched. [measured]
- `HandlerSmoke.t.sol`: 12 scripted walks, one per handler action, each ending in success (fund, deliver, decide, appeal, appeal decision, escalation, fallback decision, fallback then default, early accept, mutual settlement, reclaim, expire offer, CPP reclaim, bonds, warp; strangers refused). [measured]

**Handler coverage.** These are Foundry's metrics for `invariant_timeoutsExactlyWhenDue` with seed 0x203. Each counts handler calls; a refused call shows as a revert, and "succeeded" is calls minus reverts. Every external function of `HoldbackRules` and `HoldbackBonds` and every TimeoutKind is reached. Callers come from seven actors, and signatures from those seven keys. [measured]

| Action | Calls | Succeeded |
| --- | --- | --- |
| `agreeAndFund` | 1,434 | 239 |
| `deliver` | 1,518 | 48 |
| `decide` (primary, fallback, appeal; in Held it carries the delivery) | 1,534 | 54 |
| `earlyAccept` | 1,539 | 71 |
| `mutualSettle` | 1,525 | 69 |
| `fileAppeal` | 1,514 | 12 |
| `expireOffer` | 1,483 | 575 |
| `reclaim` | 1,528 | 29 |
| `triggerFallback` | 1,520 | 12 |
| `triggerDefault` | 1,498 | 10 |
| `expireAppeal` | 1,485 | 17 |
| `bondDeposit` / `bondWithdraw` | 1,525 / 1,518 | 1,525 / 1,000 |
| buyer's CPP `reclaim` | 1,519 | 4 |
| `stranger` (CPP capture, void, refund; the vault's five rules-only functions) | 1,490 | 0 (all refused, as they must be) |
| `warp` | 1,497 | 781 |

This table is one of eight campaigns; each invariant runs its own. Late paths (fallback, default, appeals) succeed tens of times per campaign. [measured]

**Each invariant bites.** Each mutant was applied in its own scratch copy of `contracts/`, outside the repository, so there was nothing to restore. Each ran the full invariant suite against the final handler with no replayed failures (the persisted-failure cache was cleared). [measured]

| Mutant (one change) | Fails | First failing run |
| --- | --- | --- |
| M01 accept pays the fee to `address(bytes20(id))` | `invariant_conservation` | 29 |
| M02 `earlyAccept` drops the fee `void` | `invariant_escrowMatchesState` | 0 |
| M03 `triggerFallback` also accepts Released | `invariant_settleOnce`, `invariant_escrowMatchesState`, `invariant_timeoutsExactlyWhenDue` | 5, 15, 8 |
| M04 an upheld appeal bond is also paid back to the appellant (vault double-pays) | `invariant_bondsNeverNegative` | 76 |
| M05 escalation does not release first-instance reservations | `invariant_encumberedNotDoubleCounted` | 5 |
| M06 `reclaim` refused at exactly `deliverBy` (`<=`) | `invariant_timeoutsExactlyWhenDue` ("refused when due") | 0 |
| M07 `earlyAccept` drops the buyer signature check | `invariant_noMovementWithoutAuthority` | 12 |
| M08 accept pays the fee to the rules contract | `invariant_noAdminPath` ("rules holds tokens") | 0 |
| M09 `withdraw` refuses exactly the free amount (`>=`) | `invariant_bondsNeverNegative` (withdraw liveness) | 1 |
| M10 `expireAppeal` one second early | `invariant_timeoutsExactlyWhenDue` ("succeeded before it was due") | 7 |

M06 survived the first mutation pass. Timeout actions now try their own boundary (Decision 5), and M06 is caught. [measured]

**Fuzz (256+ runs each).** [measured]
- `Rounding.fuzz.t.sol`, ADR-0022, with amounts up to 2^200 and rates up to 2^40 bps:
  - a split's share is exactly the floor, and share plus remainder is the pot;
  - a split above 100% is refused;
  - a requirement is exactly the ceiling;
  - a payout is exactly the floor;
  - the two directions differ by one unit exactly when the product is not whole;
  - every uint120 hold amount stays in range;
  - above that, an overflowing `amount × bps` reverts and never wraps.
- `Postings.fuzz.t.sol`, random price and fee: release, refund, early acceptance, reclaim, default outcome, and a random three-way mutual split each pay every party exactly and leave the hold empty. The guaranteed-mode encumbrance equals `requirement(price, 10000)` and is released on close. Payouts that do not sum to the price are refused, and nothing moves.
- `NoAdmin.fuzz.t.sol`, over 7 deployed contracts:
  - each ABI matches a reviewed full-signature allowlist;
  - 24 forbidden admin selectors are absent everywhere, and calls to them fail;
  - any unknown selector, with random calldata from a random caller, reverts, and so does plain ether;
  - no SELFDESTRUCT or CALLCODE anywhere, and no DELEGATECALL except in the TokenStore clone, which is byte-for-byte Solady's minimal proxy to the fixed implementation.

**Finding (for T-202): a bond stays encumbered after the buyer's CPP reclaim.** A scratch test, not committed and outside the repository, runs two cases. [measured]
- Held: warp past `authorizationExpiry`, the buyer calls CPP `reclaim`, then `rules.reclaim` reverts. The commitment stays Held, the primary's encumbrance stays at the price, and the adjudicator's full withdraw reverts.
- Delivered: `triggerFallback`, then `triggerDefault` reverts. Primary and fallback both stay encumbered.

Both cases pass, which confirms the behaviour. It is written up in Handoff and in `docs/backlog.md`. [measured]

**Formal quick check** (what the CI `formal` job runs on pull requests). [measured]
- `formal/check.sh safety`: pass, 195,839 distinct states, depth 31, 8 s.
- `formal/check.sh broken/`: all six broken variants bite.
- Locally the first run fetched the pinned JRE, because `/usr/bin/java` is the macOS stub. CI installs Temurin 21 with `setup-java`.

**Anvil tests (T-205) will run in CI.** Locally, after `forge build` and `pnpm build`, `pnpm vitest run packages/settlement/evm packages/testkit/src/runner.test.ts --reporter=verbose` passes 78 tests in 4 files with no `SKIPPED`. That includes `EvmSettlement on anvil` (7 tests) and "runs a fixture on the contract and compares it with SimChain". [measured] The CI `contracts` job runs exactly this after `forge test` with Foundry v1.0.0 installed, and fails on any `SKIPPED`, so these suites can no longer skip silently in CI. [inferred: not yet observed on a GitHub runner; see the PR's checks]

**`pnpm verify`.** It passes all eight steps: typecheck, lint, forge (which includes this task's suites since the T-205 merge), test, spec, snap, snap:local and demo. Report: `reports/verify-t-203-contract-invariants.md`. It was run after the task file moved to `review`, so the design-map test saw this status. [measured]

**Contracts unchanged.** `git diff main -- contracts/src contracts/foundry.toml` is empty. HoldbackRules is still 24,542 bytes. [measured]

## Decisions

1. **The handler reuses the unit fixture.** `RulesHandler` extends `test/unit/Base.sol` and calls its `setUp()` in the constructor, so the handler deploys and signs with the same builders as T-202's unit tests: no second encoding of terms, decisions or CPP `PaymentInfo` to drift.
2. **Refused calls re-revert.** A handler call the rules refuse (and that records no violation) re-reverts with `Refused()`. The refused call changed nothing, so no state is lost, and Foundry's per-selector metrics then show real success counts. Ghost counters record the violations: a wrong-key success, a refusal of a due timeout, and so on.
3. **Stage-aware picking, plus a smoke test.** Three times in four, an action picks a commitment whose stage could accept it; otherwise it picks at random, so every refusal path stays exercised. `HandlerSmoke.t.sol` walks every action to success. It exists because the first campaign was nearly vacuous: corruptions keyed to `seed % 16 == 0` fired on most calls, since the fuzzer favours zeros. Corruptions are now keyed to 15.
4. **The buyer's CPP reclaim is an action.** After `authorizationExpiry` the buyer can take the hold back through CPP alone (ADR-0003). The handler models this, so the escrow invariant sees it. The timeout-liveness check then excludes reclaimed holds, because the rules contract's void paths revert on them. That exclusion is a finding, written below and in `docs/backlog.md`, not hidden.
5. **Timeouts try their own boundary.** Each timeout action first warps to one second before, exactly at, or one second after its own deadline, three times in four. Without this, mutant M06 survived: deadline-targeted warps alone rarely put the call right after the boundary.
6. **CI.** The `contracts` job pins Foundry v1.0.0 (the local version) and runs `forge test`. It then builds the workspace and runs the anvil-gated vitest suites, failing on any `SKIPPED`; this answers T-205's note that the test shards have no Foundry. The `formal` job runs `formal/check.sh safety` and `formal/check.sh broken/` on pull requests (about 20 s, per T-204), and the full check including the seven liveness configs on push to main (about 11 min on 8 cores). It skips cleanly if `formal/check.sh` is absent. `check` needs both jobs.
7. **Mutants in scratch copies, not the worktree.** Each mutant ran in its own copy of `contracts/` under the session scratchpad, with `lib` symlinked. The repository was never mutated, so nothing needed a journal or restore (the team.md "never leaves a mutant behind" rule is met by construction). `FOUNDRY_DISABLE_CODE_SIZE_LIMIT=true` was set for mutant runs only, since two mutants add bytes to a contract with 34 to spare.
8. **Test-first, adapted.** The contracts already existed, so a new invariant could not start red against them. Each invariant was made red against a named mutant instead (Evidence), which is the same check: it fails when the property breaks.

## Handoff

**Done.**
- `contracts/test/handlers/RulesHandler.sol`, `contracts/test/invariant/RulesInvariants.t.sol` (8 invariants) and `HandlerSmoke.t.sol` (12 paths).
- `contracts/test/fuzz/Rounding.fuzz.t.sol`, `Postings.fuzz.t.sol` and `NoAdmin.fuzz.t.sol`.
- `.github/workflows/ci.yml`: `contracts` and `formal` jobs, required by `check`.
- `docs/team.md`: the "No admin keys" row.
- No contract code changed.

**Finding for T-202 (not fixed; contract code is out of scope).** After the buyer's own CPP `reclaim`, the rules contract cannot close the commitment. `reclaim` (from Held) and `triggerDefault` (from FallbackJudging or Escalated) both call `void`, which reverts with `ZeroAuthorization`. The stage stays open and the reservation flags stay set, so the primary's bond (and the fallback's, once it was reserved) is encumbered for good and cannot be withdrawn.
- No money is lost: the buyer has the hold back.
- Any adjudicator can avoid it by calling the timeout itself in the window between the deadline and `authorizationExpiry`, which lasts at least `EXPIRY_MARGIN`.
- Shown by a scratch test (two cases, Held and FallbackJudging; Evidence) and recorded as a row in `docs/backlog.md` under Settlement layer.
- A fix needs bytes the contract lacks: skip `void` when capturable is zero, or add a permissionless close.

**Outside this task's paths.**
- `docs/backlog.md` (one row, at the coordinator's request: "other findings to backlog rows").
- The merge of main (T-205) brought no conflicts.

**Proposed Rules-and-checks row (not added: `docs/team.md` is limited to the No-admin row for this task).** "Invariant handlers are not vacuous: every handler action has a scripted smoke test that must succeed, and rare corruptions are keyed to non-zero seed values." Check: `contracts/test/invariant/HandlerSmoke.t.sol`. Repeated failure it would have caught: a T-203 campaign where corruptions keyed to zero sabotaged most decisions and mutual settlements, while every invariant still passed.

**For T-206.**
- The campaign's per-run reach is bounded: depth 100, at most 8 commitments. Late paths (fallback, then default; appeals after a fallback decision) succeed tens of times per campaign, not thousands (Evidence metrics). A longer campaign is cheap, about 6 s per invariant at the current size. Raise it by editing the inline `forge-config` lines: inline config takes precedence over `FOUNDRY_INVARIANT_RUNS` and `FOUNDRY_INVARIANT_DEPTH`.
- `Money.*` reverts when `amount × bps` overflows uint256 (solady `mulDiv`, not `fullMulDiv`). It never wraps, and hold amounts are capped at uint120, so this is unreachable from the contract.
