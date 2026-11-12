# T-380: the remaining fixes (package R8)

- **Lane:** settlement (contracts), branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-375 (package R7, holdback PR 409, lane tip `2ef35b3`), T-356 (SC-5's refusals, the parent-commit harness), T-348 (ADR-0032), T-341 (the side-by-side harness and the state oracle)
- **Paths this task may touch:** `contracts/`; `packages/core/`; `packages/settlement/` where the adapter must follow; `apps/adjudicator/src/randomness.ts` (the one file of T-378's area, after telling the coordinator); `spec/schemas/` only with an ADR and a schema version; `fixtures/` where a recording must follow; this task file. Anything else goes in the Handoff
- **Human gate:** no for the branch. The freeze, the merge to `main` and the redeploy are Rafa's
- **Status:** in progress
- **Agent/session:** implementer session, change kind 7 (smart contracts): `forge test`, the differential and invariant suites, one reviewer per pull request, one red team on the rounds change

## Intent

In my own words: four fixes remain before the contracts freeze for the testnet audit loop. Each lands as its own pull request into `contracts-audit-ready`, with a test that fails on the lane before it and passes after.

1. **The primary's seed tag binds the whole seed commitment and the deal (known issue L-4).** Today the word keeps the commitment's low 144 bits, the same way on every deal.
2. **The panel rounds leave a margin (ADR-0032).** The fallback's round becomes the first at or after `judgeBy`, and an escalation's round is taken `BEACON_MARGIN` seconds after the escalation's block (29 s on Ethereum mainnet and Sepolia, 0 on a local chain), so nobody who builds that block knows the seed. The contract, core and the adjudicator service change together.
3. **The contract and core refuse the same terms.** Where one side can represent a value and the other cannot (an escalation window above 32 bits, a year after 9999, a hold above 120 bits, and the word's 40-bit `t1`), both refuse it, and only for that reason (D31).
4. **The constructor checks what an auditor expects, the pragma stays pinned, and static analysis reports nothing new.**

Non-goals: no change to a signed type, the signing domain or `spec/schemas/` (if a fix needs one, I stop and ask the coordinator); no check that the token address holds code (withdrawn on Rafa's question; CU-1's deploy script owns it); no event removed; no NatSpec pass (R9); no deploy; nothing merged to `main`.

## Which fixes are open (read on the lane at `2ef35b3`, 2026-11-12)

Line numbers are `contracts/src/HoldbackRules.sol` at `2ef35b3` [measured: read].

| Fix | State at `2ef35b3` | The line that shows it |
| --- | --- | --- |
| 1. Seed commitment in full, bound to the commitment (L-4) | **open** | `:235` `d.seedTag = uint144(uint256(acc.seedCommitment));` and `:288` `uint144(uint256(keccak256(abi.encodePacked(m.seed)))) != d.seedTag`: the low 144 bits, no commitment ID |
| 2a. The fallback's round at or after `judgeBy` | **open** | `:540` `return BEACON.roundAt(t.timing.judgeBy);` |
| 2b. The escalation's round with the margin | **open** | `:546` `return BEACON.roundAt(t1) + 1;`; the constructor (`:143-155`) has no `BEACON_MARGIN` |
| 2c. Core's copy | **open** | `packages/core/src/state.ts:373-374`: `roundAt(clock, judgeBy)` and `roundAt(clock, escalation.at) + 1` |
| 2d. The adjudicator service's copy | **open** | `apps/adjudicator/src/randomness.ts:36-41`: `r` for the fallback, `r + 1` for the appeal, no margin |
| 3a. `price + fee` above 120 bits | **contract done, core open** | contract `:176-179` refuses `hold > type(uint120).max` with `Unrepresentable`; core's `offer` has no such check (`state.ts:235-259`) |
| 3b. An escalation window above 32 bits | **core done, contract open** | core `parse.ts:104-107` refuses `appealDecideSec > 2^32 − 1`; the contract's check (`:222-228`) takes any `uint64` |
| 3c. Years after 9999 | **core done, contract open** | core timestamps are RFC 3339 (`common.schema.json` `Timestamp`, `format: date-time`, four-digit years); the contract takes any `uint64` deadline |
| 3d. `fallbackBy + appealDecideSec` above 40 bits (`Deal.t1`) | **open on both sides; implied by 3b and 3c** | `t1` is `uint40` (`:61`). With `fallbackBy ≤ 253,402,300,799` (9999-12-31T23:59:59Z) and `appealDecideSec ≤ 2^32 − 1`, the sum is at most 257,697,268,094 < 2^40 = 1,099,511,627,776 [inferred: arithmetic] |
| 3e. The harness's `CLOCK_CAP` | **open** | `contracts/test/handlers/RulesHandler.sol:469` |
| 4a. Pragma pinned | **done** | every file in `contracts/src/` and `contracts/script/SimBeacon.sol` reads `pragma solidity 0.8.28;` [measured: grep] |
| 4b. Constructor checks | **open** | `:143-155` stores the five arguments unchecked (Slither `missing-zero-check`, `docs/reviews/2026-11-11-static-analysis.md` §4) |
| 4c. Static analysis clean | **to measure** at the end of fix 4 | |

## Plan, per pull request

Each pull request re-seats the side-by-side harness's parent to the lane's tip and names in its allow list exactly the differences it intends. The runtime size is stated before and after each.

- **PR 1, L-4.** `HoldbackTypes.seedTag(seedCommitment, id)`, stored at funding and checked at the primary's decision. Allowed difference: the word's `seedTag`.
- **PR 2, the rounds.** `BEACON_MARGIN` immutable and constructor argument, `_roundAfter(lastChoice)`, the fallback and escalation rounds through it; core's `roundAfter` and `beaconRoundFor(s, role, marginSec)`; the service's `roundFor` through core's function; the EVM adapter reads `BEACON_MARGIN()`. The three `test_issue_wrongRound_…` tests become `test_attack_wrongRound_…`.
- **PR 3, the refusals.** The contract refuses `appealDecideSec > 2^32 − 1` and `fallbackBy > 253,402,300,799`; core refuses `price + fee > 2^120 − 1` on the phase-one profile. The harness's `_boundary` sends each side of each bound; `CLOCK_CAP` goes.
- **PR 4, the constructor.** Zero-address checks, and a static-analysis run.

## Acceptance criteria

- [ ] Fix 1 merged, with a test that failed before it.
- [ ] Fix 2 merged; the three wrong-round tests pass; one fallback and one escalation decided end to end by the reference adjudicator on a local chain with a non-zero margin.
- [ ] Fix 3 merged; the contract and core refuse the same values at the same bounds, shown by a test on each side.
- [ ] Fix 4 merged; the task file says which constructor checks were added and why each is standard.
- [ ] `forge test` and the harness pass on the lane's tip; the runtime stays under 24,576 bytes.
- [ ] Evidence and Handoff filled; Status done.

## Out of scope

- The operator's advisory warning for a short escalation window, the live world's wake-up times, the docs that state 37 s (T-378, AL-2).
- The deploy script's per-chain margin table and its `--check` (CU-1).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Baseline at `2ef35b3`: `HoldbackRules` runtime 20,526 bytes, initcode 21,120 bytes (`forge build --sizes`) [measured]. `forge test`: 442 passed, 0 failed, 190 s [measured].
- **PR 1, L-4 (holdback PR 414).** `SeedTag.t.sol` fails 3 of 4 on the parent's `HoldbackRules.sol` and passes 4 of 4 on the fix [measured]. `forge test`: 444 passed and 2 failed in `PhaseOneRedTeam.t.sol`, which compared two deals' tags for equality; after its fix that suite passed 14 of 14 [measured], so 446 of 446 [inferred: the two runs together]. Runtime 20,526 → 20,387 bytes [measured]. Reviewer: no Critical, High or Medium; the Low (two mutants in `contracts/scripts/mutants.json`, M013 and M040, searched for the old lines) and the stray `@notice` above `panelSeed` are fixed on the branch.

## Decisions

## Handoff

- **For AL-2 (docs), once PR 414 merges:** known issue L-4 (`docs/audit/known-issues.md`) and the state model's row 13 of section 9 (`docs/audit/state-model.md:396`) and its acceptance row (`:344`) can say the tag binds the whole commitment and the commitment ID. One residual stays and should be stated, not called closed: the primary knows the commitment ID before it signs, so about 2^72 hash attempts still buy a two-way seed choice on that one deal; the primary already chooses its own seed (DS-1), so it gains nothing it lacked [inferred; the reviewer's Info 4].
