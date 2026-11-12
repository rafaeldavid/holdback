# T-374: the lane takes main, then AL-1, the code alignment

- **Status:** review
- **Kind:** 4 (API and operator code), with one reviewer, on `contracts-audit-ready` (the plan's 7c.2 sets that rule for AL-1)
- **Branch:** `t-374-lane-sync` (part 1), then `t-374-al1-*` (part 2); pull requests into `contracts-audit-ready`, never `main`
- **Budget:** 300,000 tokens, a target and not a stop
- **Source:** the contract refinement plan, sections 7b, 7c.2, 7c.3 and 7d (kept privately, `docs/private-materials.md`)

## Intent

The lane holds the phase-one contracts, and `main` holds the contracts deployed on Sepolia. On 2026-11-12 `main` gained a day of work the lane lacks: the seller's page, the seller adapter's link to a seller's own API, the buyer's approval stop, `pnpm send-timeout`, the screen change with re-seated recordings, the One-Click harness, docs and CI. Two later lane sessions (R6c-2, the operator side, and R6c-3, the client side) edit those same files, so the lane must take `main` first.

**Part 1** merges `origin/main` into the lane in one pull request. Where a file depends on the contracts' shape (the contracts, core, the adapter, the schemas, the fixtures' terms), the lane's side wins. Where only `main` changed a tool or a doc, `main`'s side wins. Where both changed a file, the merge keeps both changes, and this file says how. The recordings are re-seated again on the merged code, because both sides re-seated them for different reasons. `examples/send-timeout.ts` is ported to the phase-one contracts: three timeouts (`reclaim`, `triggerFallback`, `triggerDefault`), no `Expired` stage, no bond vault, the two address fields in the terms file, and a reclaim that refunds the buyer's payment address. Everything `main` added compiles and passes against the lane, or is marked SimChain only where that is true.

**Part 2** is AL-1: the alignment test's known list (`tests/cut-feature-alignment.known.json`) goes to zero for the code AL-1 owns. That is the Sepolia round's scenarios (the appeal scenarios move to SimChain only), the fork suites (one rewritten from a party appeal to an escalation), the testkit's leftovers, `tools/`, `apps/demo`, the two test rulebooks that still allow any payee, `predeploy-fork.test.ts`, the escalation gas check and the follow-ups the plan's 7d gives AL-1. `packages/sdk/` is R6c-2's, and `examples/agent.ts` and `examples/verify.ts` are R6c-3's; this task lists what it would change there.

## Acceptance criteria

1. The lane holds `main`'s commits and every check passes: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm validate:spec`, `pnpm snap`, `pnpm snap --settlement=local`, `forge test`, the anvil suites and the site check.
2. `pnpm send-timeout` ends a deal on a local chain with the lane's contracts and no operator, from a third key, for each of the three timeouts; a Delivered deal takes two runs.
3. The known list holds no file AL-1 owns; every remaining file is named with its owner.
4. The Sepolia round's scenario list passes on anvil against the lane's contracts.

## Evidence

### Part 1: the lane takes main (pull request `t-374-lane-sync`)

The merge brings `origin/main` at `ec498d9` into the lane at `a37a48d` (after PR 387). Main was 155 commits ahead of the lane and the lane 123 ahead of main [measured, `git rev-list --count`].

**Conflicts: 145 paths, and how each was settled** [measured, `git merge`]:

| Paths | Settled | Why |
| --- | --- | --- |
| 139 under `fixtures/recordings/` and `fixtures/scenarios/*.expect.md` | The lane's side, then re-seated on the merged code | T-367's Handoff gives this order. Both sides re-seated the same recordings for different reasons (domain 0.8 on the lane, screen-1 on main) |
| `apps/adjudicator/src/service.ts` | Both | Main's timed store reads (`#port`, `#list`, T-372) with the lane's phase-one guards (no appeal expiries, no bond cover). `#port` now reads `phaseOne` through to the settlement port |
| `apps/demo-cloud/src/world.test.ts` | Both | Main's new imports, without `BondReads`, which the lane removed with the bond vault |
| `examples/buy-with-signer.ts`, `examples/buyer-signer.ts`, `examples/buyer-signer.test.ts`, `docs/tasks/T-332-buyer-signer-signed-fields.md` | Main's side | The lane's copies predate T-332. The lane's earlier sync merge `c75b1ba` (T-346) kept them by mistake, and no lane commit changed them after it [measured, by comparing blobs across `9466ee5`, `65e734d` and `c75b1ba`; the reviewer measured the same]. Main's versions also carry T-368's approval stop |

**Found in the same check, not restored here:** `c75b1ba` also dropped T-345's zero-price work: `contracts/test/unit/ZeroPrice.t.sol` (R7's; T-358 already named it) and the zero-price sections of `docs/audit/state-model.md` §12 and `docs/audit/threat-model.md` §7 (AL-2's). Both describe the contracts on main, so each owner restores them in the lane's shape.

**Main's files that did not fit the lane, and what changed:**

- `examples/send-timeout.ts` and its test: ported (below).
- `contracts/test/unit/MutationGaps.t.sol` (T-352) does not compile against the phase-one contracts: it funds by Permit2 (`_permit2`, `Funding.method`) [measured, `forge build`]. It stays on main; porting its mutant kills is R7's or R10's. `docs/audit/test-quality.md` still names it.
- `contracts/test/unit/AgreeAndFundExpiry.t.sol` (T-352) passes on the lane: 4 of 4 [measured, `forge test --match-path test/unit/AgreeAndFundExpiry.t.sol`].
- `fixtures/terms/audit-export.json` (T-355): schema `0.8` and an appeal window of 0, as T-358 moved the YAML terms.
- `site/llms.txt`: the EIP-712 types block and the domain pin's version regenerated from `examples/verify.ts`, and one `schemaVersion` line moved to `0.8`. The lane's copy failed the site check before this merge [inferred: the lane's `llms.txt` pinned 0.7 without the two address fields, and the lane's `verify.ts` pins 0.8 with them].

**The recordings' re-seat** [measured]: `pnpm exec tsc -b packages/testkit && node scripts/reseat-recordings.mjs`, then `node packages/testkit/dist/cli.js --update <fixture>` for each of 43 fixtures, then `pnpm snap`: 43 passed. 42 verdicts changed seat. Every fixture's final state, aggregate and screen result equals main's. `todo.provider-outage` took a fake pass on its new `gpt-a` seat; it takes main's authored abstain again, and escalates with both GPT seats abstaining.

**`send-timeout` on the lane** (the plan's 7c.3): three timeouts (`reclaim`, `triggerFallback`, `triggerDefault`); `None`, `Released`, `Refunded` and `Settled` have nothing to send; no bond vault; the domain check (0.8) refuses the contracts on main; the two address fields enter the commitment ID and the `Terms` tuple; a refund goes to the payment address. The reviewer compared the ID and every tuple field with `verify.commitmentIdOf` and `e2e-chain.termsTuple` and found them equal [measured by the reviewer].

**The alignment test's known list:** 117 files before the merge, 118 after [measured, `tests/cut-feature-alignment.known.json`]. The one new file is `docs/audit/test-quality.md` (T-352; owner R12 or AL-2).

**Checks** [measured, in the worktree]:

| Check | Result |
| --- | --- |
| `pnpm typecheck`, `pnpm lint`, `pnpm validate:spec` | pass; 35 of 35 examples valid |
| `pnpm test` | 3,402 passed, 7 failed under load (R7's forge running); the 7 pass alone: `audit-deal.test.ts` 26 of 26, and the four timing files 163 of 163 |
| `pnpm snap` | 43 passed |
| `node site/build.mjs && node site/check.mjs` | pass |
| `forge build` | pass, after `MutationGaps.t.sol` left |
| CI's anvil legs, run locally | settlement: 222 of 222; world: 41 of 41, `send-timeout.test.ts` 24 of 24 with its anvil suite |
| `pnpm snap --settlement=local` | 36 passed, 7 excluded (SimChain only) |

**One anvil finding for AL-1's escalation gas check:** on the phase-one contracts the primary's escalation is a call whose execution gas is below its EIP-7623 calldata floor. anvil 1.0.0 cannot estimate such a call and answers "gas floor exceeds the gas limit" [measured: the adapter's `escalate` failed in `EvmSettlement.send` → `LiveChain.pinned`]. On main the same test passed without a shim. The send-timeout test now opens its deals through the shim `packages/settlement/evm/timeouts.test.ts` uses (T-217 Decision 11). Sepolia's nodes estimate such calls [documented there; not measured here].

**Review:** one reviewer pass on the conflict resolutions and the port: PASS, no Critical or High. Fixed from it: a sender key of the right shape but out of the curve's range could have reached the output through viem's error; `senderKey` now refuses it without the value (Low). Left: see Handoff.

### Part 2: AL-1, the code alignment (pull request `t-374-al1`)

**The alignment test's known list: 118 files before AL-1, 87 after** [measured, `tests/cut-feature-alignment.known.json`]. No file AL-1 owns is left on it. Two files left it through `EXCLUDED` and three uses through `ALLOWED`, each with its reason in the test.

**What changed:**

| Area | Change |
| --- | --- |
| The Sepolia round (`examples/e2e-*`) | Scenarios 3c, 6 and 7 (party appeals) and their helpers moved into `examples/e2e-scenarios-appeal.ts`, which runs on SimChain only: on a chain each stops at `simChainOnly`. The pair is excluded from the scan by name. Scenarios 1, 2, 4, 8 and 11 call `closeOnSimChain`, which sends nothing on a chain. On a chain, 3d checks that both operators report the offer `Expired` by their clock, that `dealOf` reads `None` and that no transaction touched the deal. `STAGES` has the contract's 8 stages; `trigger` no longer takes `expireOffer` |
| `apps/adjudicator/src/drand-fork.test.ts` | The party appeal became an escalation: the fallback escalates from the round at `judgeBy`, and the appeal adjudicator decides from `beaconRoundFor(escalated, 'appeal')`. A tampered proof is still refused before any transaction |
| `apps/demo-cloud/src/predeploy-fork.test.ts` | **Deleted.** It rehearsed T-220's in-place rulebook switch, and the cutover opens a new world instead. `live-fork.test.ts` already opens a world on fresh storage against the record and runs `try.ts`, the walkthrough and an outside adjudicator (T-221) to Released. The anvil suites cover the direct delivery (T-218) and the reopen after a broadcast (T-219); `drand-fork.test.ts` covers the drand decision (T-217) |
| The adapter (`packages/settlement/evm`) | A join records a key envelope it already holds only once (item 83; `sync.test.ts` pins one buyer key per deal). The bond-reserve refusal answers `acceptance_mismatch`, as core's phase-one rule does (item 65). `PHASE_ONE_NO_APPEAL` is written once in core; the adapter and `apps/operator/src/prepare.ts` re-export it (item 64). New test: an estimate right after a send from the same key names a block at or after that send (item 68) |
| The testkit | `payoutsTo: 'parties'` in `stub-terms.ts` and `packages/settlement/evm/testing.ts` (the cutover's gap 8). The atomic-key invariant covers settlements that release the key. `settlement-carry.test.ts`: SimChain ignores a carried delivery in a settlement when the deal is `Delivered` (item 84, L5). The runner prints "not in phase one" (item 54) |
| `packages/core/src/beacon.ts` | The comment names `contracts/script/SimBeacon.sol` (item 34) |
| `tools/`, `scripts/`, `tests/` | The contract-stack page describes the phase-one contracts, and a new test checks its function table against `HoldbackRules`' external functions. `tools/sim` and the metrics scripts keep their appeal and bond handling, marked: they run on SimChain or read logs recorded from the 0.7 world |
| `apps/demo` | No live settlement path exists: `--live` swaps in live judges only [measured, `cli.ts`]. The closing notes and the page say the phase-one contracts have no party appeal and no bonds |

**The escalation gas check (the cutover's gap 3): yes, same code** [inferred from code]. The round's escalation scenarios 5a and 5b send no escalation themselves. The demo world's primary decides through the API, and the operator relays it through `EvmSettlement.send` (`evm-settlement.ts:1395`), then `LiveChain.simulate` (`live.ts:363-368`, the pinned `estimateGas`), then `sendNow` (`live.ts:557`), which reuses that estimate. So the scenario can run at the cutover's step 4. On anvil the world's estimate shim answers 1,000,000 gas for this call, because anvil 1.0.0 cannot estimate a call below its calldata floor. Only Sepolia measures the real figure.

**Checks** [measured, in the AL-1 worktree]: see the pull request for the final run. During the work: `examples/e2e-round.test.ts` 7 of 7 on anvil against the lane's contracts, with `results: 1 fail, 2 (pass|fail), 3a pass, 3d pass, 6 waits, 10a pass`. Scenario 1 fails only "a live panel judged", which needs live judges. The round's other anvil files: 23 of 23. `packages/settlement/evm`: all pass, `sync.test.ts` 49 of 49.

## Handoff

**State:** part 1 merged into the lane as `027e3db` (PR 398, 2026-11-12 09:16 UTC), by the coordinator after the `.gitleaksignore` entries Rafa approved. Part 2 is in its own pull request into `contracts-audit-ready`.

**Left on the known list, by owner** (87 files) [measured]:

- **R6c-2:** `packages/sdk/` (the client and `operations.ts`: the appeal operation, `expire-offer`, `appeal-expiry`), `apps/operator/`, `apps/demo-cloud/`, `apps/adjudicator/` (except the fork suite), and `tests/contract/openapi.contract.test.ts`, which tests the operator's appeal and offer-expiry routes on a SimChain world.
- **R6c-3:** `examples/verify.ts` and its test (`appealBondOf`, the appeal intent, `prepare/appeal`): the pinned client still builds and checks an appeal. On the lane it should refuse that intent with the phase-one reason, or keep it marked SimChain only. Also `examples/deal-record.ts` and its test (`appeal.decided`, `appeal.expired` in the record's event list).
- **CU-1:** `examples/deployments.ts` (`permit2Collector`, `HoldbackBonds`): the pinned record of the 0.7 deployment, which the copies command replaces.
- **R6, R8 and R5:** `spec/`, `packages/core`, `packages/settlement/evm`, `packages/settlement/src/interface.ts`, `fixtures/`.
- **R4b:** `formal/`.
- **AL-2:** `docs/`, `docs/audit/` (now including `test-quality.md`, which names `MutationGaps.t.sol`, still on main only), `site/`, `README.md`, `SECURITY.md`.

**For R6c-2.** AL-1 left these follow-ups in R6c-2's files:
- item 63: the adjudicator's bond reasons on a chain with no bonds;
- item 67: the 10 adjudicator mutants;
- item 84's other half: a prepare test that refuses a second `delivery`;
- T-356's route-level test for the zero-hold refusal.
AL-1 changed one block in `apps/operator/src/prepare.ts`: `PHASE_ONE_NO_APPEAL` is now imported from `@holdback/core` and re-exported.
- `site/llms.txt` still names domain 0.7 and schema 0.10 in its prose (line 117 and others), while its types block and domain pin say 0.8 (part 1). That prose is AL-2's.
- `docs/cutover-phase-one.md` and `docs/operations.md` still name `predeploy-fork.test.ts` for the cutover's fork step. That step now runs `live-fork.test.ts` and `drand-fork.test.ts` (AL-2 or the cutover's second pass).
- The local tools run the full protocol by default; the coordinator took that to Rafa as a decision.

**AL-1's review** (one reviewer pass): no Critical or High. Fixed from it:
- Medium: `live-fork.test.ts` sent an appeal window of 60 s, which phase one refuses. It now sends 0.
- Low: the appeal file's exclusion reason now names scenario 5b's refusal check.
- Low: the `tools/sim` expiry comments no longer call the operators' clock expiry SimChain only.

Left as Lows:
- `drand-fork.test.ts` no longer checks the fallback's own beacon round. Reaching `Escalated` implies the contract accepted it.
- The testkit's atomic-key check for a settlement does not check that the `key.released` event names the buyer (`stub-settlement.ts:175-188`).
- `apps/demo-cloud/src/one-world.anvil.test.ts:8` (R6c-2's) still names `predeploy-fork.test.ts` in a comment.

The reviewer suggested a second review from another model family on the key-release dedupe. That runs only if Rafa asks (`docs/team.md`, Change recipes).

**Not built:** a round scenario with a payment address apart from the signing address. It needs R6c-2's prepare inputs for a separate address; add it to the round then.

**How to resume:** `pnpm exec vitest run tests/cut-feature-alignment.test.ts --silent=false` prints what is left, per file and owner. After a fix, `-u` rewrites the known list. Only removals are progress.
