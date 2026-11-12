# T-362: The docs batch for T-329 to T-361

- **Lane:** docs (change kind 1)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Depends on:** the merged pull requests of T-329 to T-357
- **Paths this task may touch:** `docs/` (not `docs/audit/` rows that describe the phase-one contracts), `contracts/README.md`; a second pull request for `CLAUDE.md` only
- **Human gate:** no for pull request 1; pull request 2 changes `CLAUDE.md`, a tier 3 file that Rafa merges
- **Status:** done (PR 374, merged 2026-11-12 as `826ace3`; its `CLAUDE.md` change, PR 375, became T-364's and merged 2026-11-12 as `36030d7`)
- **Agent/session:** T-362 implementer session, 2026-11-12

## Intent

Between 2026-11-11 and 2026-11-12 about thirty tasks left doc follow-ups in their Handoff sections, and no task owned them. This task collects every one of them and closes those that describe `main` as it is today: the contracts deployed on Sepolia (`64be1f1`) and the live service. It adds the plan's rows for T-329 to T-362 with statuses read from GitHub, records the site deploy of 2026-11-11 20:18 UTC, and names T-347's fixture in `docs/neutrality.md`.

Inputs: the Handoff sections of the task files T-329 to T-355 on `origin/main` at `2d03383`, the pull request list on GitHub, and the code and docs on `main`. Outputs: pull request 1 (docs, merged by this task), pull request 2 (`CLAUDE.md`, tier 3, for Rafa), and the table below.

Non-goals: no sentence about the phase-one contracts on `contracts-audit-ready` (those wait for the freeze), no code, schema, fixture, `site/` or `spec/` change, and no deploy. Each item checked as already fixed or no longer true is skipped and says so.

## Context

- `docs/team.md`, Change recipes, kind 1; `docs/writing.md`.
- The Handoff sections of T-329 to T-355; T-334, T-346, T-349, T-354, T-356, T-357 and T-358 keep their files on `contracts-audit-ready`; T-344 and T-360 are private-repository tasks.
- ADR-0031 (phase-one scope), ADR-0032 (beacon rounds), ADR-0033 (payout and payment addresses), ADR-0034 (settlement chain and mainnet gate).

## Acceptance criteria

- [x] `docs/plan.md` has a row for each of T-329 to T-362, its status taken from `gh pr list` on 2026-11-12; lane tasks say they are merged to `contracts-audit-ready` and wait for the freeze; T-344 and T-360 have a one-line row.
- [x] `docs/operations.md` records the site deploy of 2026-11-11 20:18 UTC.
- [x] `docs/neutrality.md` names `neutrality.store-withholds-delivery` (T-347).
- [x] Every follow-up in the table has one outcome: done here, waits for the freeze, or not a docs item.
- [ ] Pull request 1 merged with CI green; pull request 2 open with CI green.

## Out of scope

- The docs of the phase-one contracts, at the freeze.
- `site/llms.txt` lines, which belong to the seller's page (T-359, package 5).

## Follow-ups found

Sources are task files on `main` at `2d03383`, with the Handoff's line. "Freeze" means the lane's docs at the freeze: the package that lands the change named, or R12 where no lane package is named.

| # | Follow-up | Source | Outcome |
| --- | --- | --- | --- |
| 1 | Review §2 table, row L-1: Status says "T-212 item 3"; PR #161 fixed it | T-338:80 | Done here: row and §2.3 L-1 Status name PR #161 (`64be1f1`), checked at `HoldbackRules.sol:276, 403, 439, 628` [measured] |
| 2 | Review §2.3 L-3: "accepted until Phase 4" predates D43 | T-338:81 | Done here: the Status adds that it blocks mainnet since D43 |
| 3 | Review §2.3 L-5: should say it blocks mainnet | T-338:82 | Done here |
| 4 | `neutrality.md` adjudicator and appeal-adjudicator rows: bonds compensate the seller on a default; the contract pays none | T-338:83, T-340:102 | Done here: both rows say SimChain compensates and the deployed contract refunds the buyer with no compensation (I-8), checked at `HoldbackRules.sol:553-569` [measured] |
| 5 | `neutrality.md` residual 7: "bounded by its own bond" | T-338:84 | Done here: the appeal adjudicator posts no bond on the deployed contract (L-5) |
| 6 | `neutrality.md` liveness: "Released, Refunded or Defaulted" | T-338:85 | Done here: Released, Refunded or Settled (`FundedSettles`; a default ends Refunded, `formal/Holdback.tla:425-433`) |
| 7 | T-232's Backlog cites tests from commit `3515172` that never reached `main` | T-338:86 | Done here: T-232's Backlog says the commit is only on the local branch `t-232-review-round-backup` [measured: `git for-each-ref --contains`] |
| 8 | `architecture.md` diagram: "Defaulted --> Refunded (seller compensated from bonds)" | T-338:87 | Done here: the edge names SimChain's compensation and the contract's none |
| 9 | `formal/README.md`: the contract column reads TBD | T-338:88, T-340:103 | Already fixed: T-337 (PR #331) filled the mapping (`formal/README.md` §"Model to `state.ts` and to the contract") |
| 10 | Fill invariant row 11 with T-336's test name | T-338:75 | Already fixed: row 11 names `invariant_deliveryHashStored` |
| 11 | Line numbers in `invariants.md` and `events.md` cite `1430f77` and move with T-334 | T-338:76 | Freeze: T-334's clean is on the lane; re-cite at the frozen commit |
| 12 | `scope.md` links `threat-model.md`, which did not exist | T-338:77 | Already fixed: T-340 added it |
| 13 | The events gaps wait for T-245, which has no task file | T-338:90 | Not a docs item: the coordinator plans T-245 |
| 14 | `architecture.md` transition table: early accept needs Delivered; the contract also takes it in Held | T-340:101 | Done here, checked at `HoldbackRules.sol:398-403` [measured] |
| 15 | `HoldbackRules.sol:52` comment on `t1` | T-340:104 | Not a docs item: a source comment; the lane's clean-up (T-334's lane) |
| 16 | `known-issues.md` and `scope.md` describe appeals and bonds, which phase one cuts | T-340:105 | Freeze: the package that lands SC-7 (T-346, T-349) |
| 17 | `RulesInvariants.t.sol`, `invariant_escrowMatchesState` reads wrongly after a CPP reclaim | T-340:106 | Not a docs item: a test name; the contract lane's test triage |
| 18 | `state-model.md` and `threat-model.md` cite `26d4670`; re-cite at the frozen commit | T-340:110 | Freeze: R12 |
| 19 | `state-model.md` section 10 lists 12 differences between the formal model and the contract | T-340:98 | Not a docs item: the formal model's update, refinement package R4 |
| 20 | `known-issues.md` rewording table for H-2 limit, L-3, L-5, I-8 rest, T-221, A-1, A-2, A-3 | T-342:94-105 (the brief calls it T-341's; T-341's Handoff has no such table) | Freeze: "they move at the redeploy" (T-342:94); package that lands SC-7 (T-346, T-349) |
| 21 | `known-issues.md` rows L-2, L-6, L-8, I-2, R-1, R-3, R-6, R-7, R-8, DS-1, G-3, §8, and five new rows | T-342:107-121 | Freeze: same package; L-6 and L-8 with SC-5 (T-356) |
| 22 | ADR-0031's appendix: every doc that promises what phase one cuts | T-342:134 | Freeze: "the docs change at the redeploy" |
| 23 | `CLAUDE.md`: "D1 to D56" at two places | T-342:92 | Pull request 2 (tier 3, Rafa): D1 to D63, October 30 to November 12 |
| 24 | `CLAUDE.md`: liveness "~11 min"; T-337 measured 21 min | T-337:134-135 | Pull request 2 (tier 3, Rafa) |
| 25 | `formal/README.md` lines cite `26d4670` and drift with T-334 | T-337:132-133 | Freeze: R12 |
| 26 | Coverage gate never blocks; L-3, L-5, L-6 and a late `deliverBy` not modelled; model shape | T-337:118-131, 136-139 | Not a docs item: refinement package R4 (formal model) |
| 27 | `contracts/README.md` test counts need a refresh | T-335:92, T-341:41 | Done here: 29 unit files, 13 cross-check files, `StateOracle.t.sol`, a `test/differential/` row, and 383 tests in 55 suites (CI run 43138040593 at `1a3f50f`) [measured] |
| 28 | Five attack-shaped tests flip to `test_regression_` when their fixes land | T-335:87-90 | Not a docs item: the contract lane (T-212, pilot C3 to C5) |
| 29 | Add row G-7 to `known-issues.md` §6 | T-339:65 | Already fixed: row G-7 is there and fixed (PR #338) |
| 30 | S-17 should disappear on the lane; re-run shows 16 medium | T-339:66 | Not a docs item: the lane's static-analysis re-run before the freeze |
| 31 | Gate lines G-1 to G-10 into the mainnet gate | T-343:96 | Already fixed: ADR-0034 §7 (T-351, merged after) carries G-1 to G-10 |
| 32 | Finding X-1 to the contract lane | T-343:95 | Not a docs item: package R8 (ADR-0032) |
| 33 | `DrandRedTeam.t.sol` edits when `fileAppeal` leaves | T-343:100 | Not a docs item: the lane (R6) |
| 34 | Gate lines BR-1 to BR-10 into the mainnet gate | T-348:75 | Already fixed: ADR-0034 §7 carries BR-1 to BR-10 |
| 35 | Audit docs (`state-model.md` 6.3 and F-2, `threat-model.md` TA-2, `known-issues.md`), ADR-0018's pointer, `site/llms.txt` for the beacon rounds | T-348:77 | Freeze: "each lands when R8 lands" (package R8) |
| 36 | `state-model.md` sections 9.1, 9.5 and Appendix A list a zero price among SC-5's refusals; D58 superseded that | T-345:85 | Freeze: section 9 is the phase-one word; section 12 already records D58. The lane's docs at the freeze (R12) |
| 37 | `ZeroPrice.t.sol` changes per cut | T-345:76-81 | Not a docs item: the lane's cut packages |
| 38 | `neutrality.md` does not list `neutrality.store-withholds-delivery` | T-347:108 | Done here: in the adjudicator row, with T-327's `neutrality.store-withholds-reference`; "Nine exist" becomes "Eleven exist" [measured: 11 `neutrality.*` scenario files] |
| 39 | The plan's scenario index lacks 8 fixtures on disk | found here | Done here: the two store fixtures and six from T-317, T-320 and T-327; the count reads 38 (37 exist, 1 todo) [measured] |
| 40 | T-347's fix reaches the live adjudicators with an operator deploy | T-347:107 | Done: Rafa deployed the operators on 2026-11-12 at 05:01 UTC; the record line, the plan row and T-347's Handoff say so here (the coordinator's request) |
| 41 | ADR-0033 §11, 1: `state-model.md` 8.1 register row for `buyer` and `seller` splits | T-350:77 | Freeze: T-358 (the two address fields) |
| 42 | ADR-0033 §11, 2: `threat-model.md` §2 actors: the buyer's row splits; the primary's "cannot" cell | T-350:77 | Freeze: T-358 |
| 43 | ADR-0033 §11, 3: assumption TA-4 widens to four addresses | T-350:77 | Freeze: T-358 |
| 44 | ADR-0033 §11, 4: a new assumption on the payment address's trust in the signing key | T-350:77 | Freeze: T-358 |
| 45 | ADR-0033 §11, 5: `threat-model.md` §3 recipients become the payment and payout addresses | T-350:77 | Freeze: T-358 |
| 46 | ADR-0033 §11, 6: `threat-model.md` §6 payout address that is a deployment contract | T-350:77 | Freeze: T-358 |
| 47 | ADR-0033 §11, 7: `events.md`: the new event, and `provider` and `client` name parties | T-350:77 | Freeze: T-358 |
| 48 | `contracts/README.md`: the vendored escrow address `0xBdEA…0cff` is version 1.0.0; 1.1.0 is `0xf968…b19c` | T-351:90 | Done here, from ADR-0034 §3.4 [documented] |
| 49 | `packages/core/src/chains.ts` lacks Monad (143) and others | T-351:91 | Not a docs item: code, for triage |
| 50 | ADR-0018's gas figure is out of date (219,232 gas on a mainnet fork) | T-351:92 | Done here: a dated line in ADR-0018 "Size and gas" with 213,185 gas on Sepolia and 219,232 on mainnet |
| 51 | The first drand review's Fusaka figure: 8,064 gas, not 8,170; about 57,904 gas more, not 58,438 | T-353:65 | Done here: a correction bullet in the review's §7 |
| 52 | Agent docs could tell a party to let a signed settlement offer expire before a decision is due | T-351:93 | Not a docs item here: `site/llms.txt`, for T-359 or triage |
| 53 | `neutrality.md` gets the sequencer as a control point once an L2 is chosen | T-351:94 | Not now: no L2 is chosen (ADR-0034 §9) |
| 54 | `docs/audit/test-quality.md` needs the remaining 97 verdicts | T-352:108 | Not a docs item here: T-352's own, after its run |
| 55 | A nightly CI job for coverage and mutation | T-352:103 | Not a docs item: `.github/`, tier 3, Rafa's |
| 56 | The site deploy that publishes T-329's and T-330's `llms.txt` lines waits for Rafa | T-329:97, T-330:90 | Done: Rafa deployed it at 20:18 UTC; recorded in `docs/operations.md` here |
| 57 | The site deploy of 2026-11-11 20:18 UTC is not recorded | the coordinator's log | Done here |
| 58 | `site/llms.txt` lines for the seller and buyer sections | T-331:91-98, T-332:119-123, T-333:75-82, T-355:141-143 | Not a docs item here: `site/`, the seller's page package (T-359) |
| 59 | The live test seller's card does not list `pricing.defaults` | T-330:91 | Not a docs item: a test-agents change and deploy |
| 60 | Rows for T-329 to T-362 in `docs/plan.md` | the brief | Done here |

Count, of 60 rows: 19 done here (1 to 8, 14, 27, 38, 39, 40, 48, 50, 51, 56, 57, 60), 6 already fixed (9, 10, 12, 29, 31, 34), 2 in pull request 2 (23, 24), 16 wait for the freeze (11, 16, 18, 20, 21, 22, 25, 35, 36, 41 to 47), and 17 are not docs items or not due yet (13, 15, 17, 19, 26, 28, 30, 32, 33, 37, 49, 52 to 55, 58, 59).

## Evidence

Label: measured unless marked.

- Commands run and results [measured, 2026-11-12, on `t-362-docs-batch` from `2d03383`]:
  - `pnpm build`: exit 0.
  - `pnpm exec vitest run tests/contract-stack.test.ts apps/demo/src/transcript/honesty.test.ts apps/test-agents/src/deploy.test.ts`: 53 passed. These read the contract review, `docs/neutrality.md` and the record line of `docs/operations.md`.
  - `pnpm exec vitest run tests/`: 17 files, 383 tests passed, the design map's parse of `docs/plan.md` included.
  - `pnpm lint`: exit 0.
  - `node site/build.mjs && node site/check.mjs`: not run; the site reads `docs/api.md` only (`site/check.mjs:28`), which this task does not change.
- Statuses: `gh pr list --repo rafaeldavid/holdback --state all --limit 100` on 2026-11-12 at about 05:40 UTC; open pull requests: none for T-358, T-359 or T-361.
- Snapshot diffs: none; no fixture changed.
- Metrics: none.

## Decisions

- Lane tasks get an open box (`- [ ]`) with "merged to `contracts-audit-ready`; waits for the freeze": they are not on `main` and not deployed, so the plan's done count leaves them out.
- T-345's state-model note waits for the freeze. It corrects section 9, the phase-one word, and section 12 already records D58 on `main`.
- ADR-0018 keeps its original figure and gains a dated line, since an ADR records what was measured when it was written.

## Handoff

**Done.** Rows 1 to 8, 14, 27, 38, 39, 40, 48, 50, 51, 56, 57 and 60 of the table, in pull request 1.

**For the coordinator.** The 16 rows marked "Freeze" go to the lane's docs package; each names its source line and its package. Rows 23 and 24 are pull request 2, which Rafa merges.

**Not done.** No site build: no doc the site reads changed. Row 39's scenario index was counted, not run through `pnpm snap`; CI runs it.

**How to resume.** Read the table; a row's source is a task file on `main` and the Handoff line given.
