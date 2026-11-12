# T-380: the remaining fixes (package R8)

- **Lane:** settlement (contracts), branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-375 (package R7, holdback PR 409, lane tip `2ef35b3`), T-356 (SC-5's refusals, the parent-commit harness), T-348 (ADR-0032), T-341 (the side-by-side harness and the state oracle)
- **Paths this task may touch:** `contracts/`; `packages/core/`; `packages/settlement/` where the adapter must follow; `apps/adjudicator/src/randomness.ts` (the one file of T-378's area, after telling the coordinator); `spec/schemas/` only with an ADR and a schema version; `fixtures/` where a recording must follow; this task file. Anything else goes in the Handoff
- **Human gate:** no for the branch. The freeze, the merge to `main` and the redeploy are Rafa's
- **Status:** in progress (PR 1 merged, holdback PR 414, `7f99f90`; PR 2 merged, holdback PR 418, `cd88cca`)
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
| 3d. `fallbackBy + appealDecideSec` above 40 bits (`Deal.t1`) | **open on both sides; implied by 3b and 3c** | `t1` is `uint40` (`:61`). With `fallbackBy ≤ 253,402,387,139` (9999-12-31T23:59:59−23:59, the last RFC 3339 instant) and `appealDecideSec ≤ 2^32 − 1`, the sum is at most 257,697,354,434 < 2^40 = 1,099,511,627,776 [inferred: arithmetic] |
| 3e. The harness's `CLOCK_CAP` | **open** | `contracts/test/handlers/RulesHandler.sol:469` |
| 4a. Pragma pinned | **done** | every file in `contracts/src/` and `contracts/script/SimBeacon.sol` reads `pragma solidity 0.8.28;` [measured: grep] |
| 4b. Constructor checks | **open** | `:143-155` stores the five arguments unchecked (Slither `missing-zero-check`, `docs/reviews/2026-11-11-static-analysis.md` §4) |
| 4c. Static analysis clean | **to measure** at the end of fix 4 | |

## Plan, per pull request

Each pull request re-seats the side-by-side harness's parent to the lane's tip and names in its allow list exactly the differences it intends. The runtime size is stated before and after each.

- **PR 1, L-4.** `HoldbackTypes.seedTag(seedCommitment, id)`, stored at funding and checked at the primary's decision. Allowed difference: the word's `seedTag`.
- **PR 2, the rounds.** `BEACON_MARGIN` immutable and constructor argument, `_roundAfter(lastChoice)`, the fallback and escalation rounds through it; core's `roundAfter` and `beaconRoundFor(s, role, marginSec)`; the service's `roundFor` through core's function; the EVM adapter reads `BEACON_MARGIN()`. The three `test_issue_wrongRound_…` tests become `test_attack_wrongRound_…`.
- **PR 3, the refusals.** The contract refuses `appealDecideSec > 2^32 − 1` and `fallbackBy > 253,402,387,139`; core refuses `price + fee > 2^120 − 1` on the phase-one profile. The harness's `_boundary` sends each side of each bound; `CLOCK_CAP` goes.
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

- **How the runtime is measured.** The length of `deployedBytecode` in `contracts/out/HoldbackRules.sol/HoldbackRules.json`, the artifact of `contracts/src/` [measured]. Not `forge build --sizes`: its table has one row per contract name, and four contracts named `HoldbackRules` compile (the source and the pinned old, parent and planted copies), so its row is not the source's. My first figures came from that table and were wrong (20,526, 20,387 and 20,438 bytes).
- Baseline at `2ef35b3`: runtime 20,401 bytes [measured: the artifact of `parent/HoldbackRules.2ef35b3.sol`, the same source], as T-375 reported. `forge test`: 442 passed, 0 failed, 190 s [measured].
- **PR 1, L-4 (holdback PR 414).** `SeedTag.t.sol` fails 3 of 4 on the parent's `HoldbackRules.sol` and passes 4 of 4 on the fix [measured]. `forge test`: 444 passed and 2 failed in `PhaseOneRedTeam.t.sol`, which compared two deals' tags for equality; after its fix that suite passed 14 of 14 [measured], so 446 of 446 [inferred: the two runs together]. Runtime 20,401 → 20,452 bytes [measured: the artifact of `parent/HoldbackRules.7f99f90.sol`, the lane after PR 1]. Reviewer: no Critical, High or Medium; the Low (two mutants in `contracts/scripts/mutants.json`, M013 and M040, searched for the old lines) and the stray `@notice` above `panelSeed` are fixed on the branch.

- **PR 2, the rounds.** Runtime 20,452 → 20,475 bytes [measured: the artifact]; the limit is 24,576.
  - The brief named three `test_issue_wrongRound_…` tests; the lane had two. The third, `…appellantFilesOnlyWhenTheAppealSeedSuitsIt`, left with `fileAppeal` in R6, as ADR-0032 §3.6 said it would [measured: `grep -rn wrongRound contracts/test` at `2ef35b3`]. Both are rewritten as `test_attack_wrongRound_appealRoundIsNotProvenAtTheTimestampThatFixesIt` and `test_attack_wrongRound_relayerCannotLearnTheAppealSeedBeforeTheEscalationLands`, with the new `test_attack_wrongRound_fallbackRoundAtJudgeByIsRefused`, the measure test and a `test_boundary_…` test, in `DrandRedTeam.t.sol`. With the contract's two round functions set back to the parent's rule, these three fail, as do `BeaconMargin.t.sol`'s margin tests and `DrandDecide.t.sol`'s; with the fix all pass [measured: 16 failures under the old rule across the three suites; 8 of 8, 7 of 7 and 23 of 23 after].
  - ADR-0032 §3.6's list: the delay property (300 consecutive seconds, margins 0 and 29 s, `BeaconMargin.t.sol` on the contract and `state.test.ts` in core); core and the service against each other over the same range (`randomness.test.ts`); the adapter and the chain reading `BEACON_MARGIN()` (`margin.test.ts`, `live.test.ts`); a fallback that escalates; the constructor's refusal of 0 off chain 31337; the two new drand rounds in `fixtures/beacon/drand-quicknet.json`, which `DrandAllRounds.t.sol` and `drand-contract.redteam.test.ts` verify against the BLS verifier [measured: both pass with nine rounds].
  - **The done test.** `apps/adjudicator/src/drand-contract.redteam.test.ts`, "the reference adjudicator with a beacon margin on anvil": three reference adjudicator services over the EVM settlement on anvil, the rules contract deployed with a margin of 7 s. The fallback waits at `judgeBy`, decides (it escalates) on round `judgeBy + 7`, and the appeal adjudicator waits, then decides the escalation on round `t1 + 8`; the contract accepts both [measured: passes in 10 s]. With `service.ts`'s `roundFor` call left without the margin, the fallback never decides and the test fails [measured]. The anvil job names this file, so CI runs it (the coordinator's placement).
  - **Review and red team.** Reviewer: no Critical, High or Medium; one Medium-rated hand-off (the examples' old rule, outside these paths), Lows and Infos to the Handoff. Red team: no Critical, High or Medium; nobody who builds a block saw the round it fixes over 20,000 slots on each chain's phase and 3,600 `judgeBy` values; L-1 (a margin written as a string in the deployment file) is fixed, the live chain now refuses a margin that is not whole non-negative seconds (`live.test.ts`) [measured by them; the fix measured by me]. Its Infos: the 31337 guard is only a chain ID; `SimBeacon.roundAt` truncates at 2^64 (local only); the defaults of 0 in `step` and `beaconRoundFor`; Sepolia's fallback floor is 41 s or 44 s depending on whether a block stamped in the round's own second can carry the decision.
  - The SimChain and local world keep a margin of 0, under which the sim rounds do not move: the side-by-side harness, compared with `7f99f90`, allows one difference, the new `BEACON_MARGIN()` view in the Surface field.

- **PR 3, the refusals.** Runtime 20,475 → 20,469 bytes [measured: the artifact; the unreachable fundBy check left].
  - The contract now refuses with `Unrepresentable`, at funding and before any signature check, a fallbackBy after 9999-12-31T23:59:59−23:59 (253,402,387,139 s, the last instant RFC 3339 can state: a four-digit year and the largest offset) and an escalation window above 2^32 − 1 s. My first bound, 9999-12-31T23:59:59Z, was 86,340 s short: core takes offsets, so it took terms the contract refused (the reviewer's Medium, fixed). Core's phase-one offer refuses a hold above 2^120 − 1 (`HOLD_TOO_LARGE_PROBLEM`), which the contract already refused. The 40-bit `t1` needs no check of its own: with both bounds, fallbackBy + appealDecideSec ≤ 257,697,354,434 < 2^40 [inferred: arithmetic; `test_t1_atTheLatestEscalation_fitsFortyBits` stores and decides an escalation one second before the bound, measured]. `triggerFallback`'s `t1` is the one write with no bound in time; it wraps only from 2^40 s (the year 36,812), and nothing reads it but `dealOf`.
  - **Each side of each bound, on each side.** Contract: `contracts/test/unit/Unrepresentable.t.sol`, 8 tests, the review's −00:01 case among them; the two new refusals fail on the parent and all pass on the fix [measured]. Core: `state.test.ts`, "the bounds core and the contract share": a hold of 2^120 − 1 offers and 2^120 is refused on the phase-one profile (the full profile takes it); the parser takes an escalation window of 2^32 − 1 s and refuses 2^32 s, and takes a fallbackBy at 9999-12-31T23:59:59−23:59 (and −00:01, and Z) and refuses year 10000 in both forms [measured: 3 of 3].
  - **The harness.** `RulesHandler._boundary` now has eight kinds: the hold's 120 bits, the window's 32 bits, the last RFC 3339 instant, each on both sides, and SC-5's smallest gaps. T-375's 48-bit expiry kind is gone: a window that large is refused for its 32 bits first. `CLOCK_CAP` is gone: every warp target is a funded deal's deadline, below 2^40 s. `HandlerSmoke.t.sol` pins the eight kinds [measured]. The 48-bit expiry tests in `UntestedReverts.t.sol` now reach the bound through a deployment's EXPIRY_MARGIN, the one way left.

## Decisions

- **D66** (`docs/decisions-today.md`): how the margin reaches core (an argument to `step` and `beaconRoundFor`, not a field of the state), the EVM chain (the deployment file states it; the live chain checks it against `BEACON_MARGIN()` at start-up), and the adjudicator service (`Settlement.beaconMarginSec`, carried on the randomness source). The constructor takes the margin last, apart from `expiryMargin`.

## Handoff

- **For T-378 (operators and the adjudicator), after PR 2 merges.**
  - Two rows of `apps/adjudicator/scripts/mutants.mjs` find lines PR 2 changed: "the service rounds on the sim clock for a drand commitment" (`service.ts:749` now passes `source.marginSec ?? 0`) and "the adapter reads the sim beacon for every commitment" (`randomness(c)` now returns through `withMargin(...)`). I sent T-378 the new find strings; the coordinator asked me not to edit the script. The reviewer counted four rows that now find nothing, the script's lines 19, 22, 23 and 37 [its measurement: `git grep -c -F`]; a new row that drops `source.marginSec ?? 0` to `0` would cover the margin.
  - ADR-0032 §3.5, RT-4: `apps/demo-cloud/src/world.ts` wakes the fallback at `judgeBy` and retries 2, 6, 14, 30 and 62 s after; with 29 s the round is public 29 to 31 s after `judgeBy`. The alarm should be the round's publish time plus 1 to 2 s, for the fallback and for an escalation, and the sentence that states the old rule to users (`world.ts`, about line 1428) should change.
  - `apps/adjudicator/src/drand-fork.test.ts` (the cutover's step 4 runs it): its `judgeByRound` is `beaconRoundAt(judgeBy)`, the old rule; it should be `beaconRoundFor(state, 'fallback', 29)`, and the Sepolia deployment file it reads needs `beaconMarginSec: 29`.
- **For CU-1 (the deploy script and the start-up check).** `contracts/script/deploy-sepolia.sh` (lines 175 and 198 at the review) still passes five constructor arguments and checks `constructor(address,address,uint64,address,address)`, so it cannot deploy this contract until CU-1 updates it. The constructor accepts any non-zero margin on any chain (1 s, 86,400 s, 29,000 s all deploy [the red team's measurement]); the table below is the only guard, so the deploy should fail closed without it. The rules contract's constructor now ends with `uint64 beaconMargin`. The deploy script takes it from a table, one row per chain ID (29 for 1 and 11155111), refuses any other, and its `--check` reads `BEACON_MARGIN()` back (ADR-0032 §3.4, gate line BR-1). The deployment file gains `beaconMarginSec`; a live chain refuses to start when it differs from the contract's, and a file without it reads 0. A live chain also refuses to start against a contract with no `BEACON_MARGIN()`, so deals on the old deployment finish before a build with this change serves it (ADR-0032 §10, the cutover choice).
- **For the round driver (T-381, `examples/`) and T-379's `site/llms.txt`.** Three copies of the old rule remain outside this package's paths: `examples/e2e-scenarios-silent.ts` (about lines 254 and 268) expects `roundAt(judgeBy)` for the fallback, `examples/e2e-scenarios-escalation.ts` (about line 267) expects `roundAt(t1) + 1`, and `site/llms.txt` (about line 541) tells third-party adjudicators the old rule. Each should compute `roundAfter(clock, lastChoice, BEACON_MARGIN())` from core; the examples are gate line BR-10's live checks, and an adjudicator that follows the old `llms.txt` text signs a round the contract refuses [both reviews; inferred]. The operator API does not serve the margin: an HTTP-only adjudicator reads `BEACON_MARGIN()` from the chain.
- **For AL-2 (docs) when PR 2 merges** (ADR-0032 §10): `docs/audit/state-model.md` (section 5.3's rounds, section 6.3, finding F-2), `docs/audit/threat-model.md` (TA-2, the block proposer's row), `docs/audit/known-issues.md` (X-1, T-225 M1, I-5), a pointer in ADR-0018, and the smallest windows in `site/llms.txt` and `docs/api.md`: 37 s for an escalation and 43 s (mainnet) or 44 s (Sepolia) for the fallback.
- **For R10 (the mutation run).** `contracts/scripts/mutants.json`: M027, M028 and M112 pointed at lines R7 had already removed; they now mutate the new round lines, and M139 (no margin) and M140 (the constructor's guard dropped) are new.
- **For T-376 (the formal model).** The round a panel's seed comes from is outside the TLA+ model's state as far as I read [guessed: I did not open `formal/`]; if it models `judgeBy`'s round, the rule is now the first round after `judgeBy − 1 + margin`.

- **For AL-2 (docs), once PR 414 merges:** known issue L-4 (`docs/audit/known-issues.md`) and the state model's row 13 of section 9 (`docs/audit/state-model.md:396`) and its acceptance row (`:344`) can say the tag binds the whole commitment and the commitment ID. One residual stays and should be stated, not called closed: the primary knows the commitment ID before it signs, so about 2^72 hash attempts still buy a two-way seed choice on that one deal; the primary already chooses its own seed (DS-1), so it gains nothing it lacked [inferred; the reviewer's Info 4].
