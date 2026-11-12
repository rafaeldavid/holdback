# T-338: The audit docs: the invariants list, the events inventory, and the sources' disagreements settled

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-334 (contract clean, in parallel), T-336 (adds one invariant in parallel), T-340 (writes the threat model, in parallel)
- **Paths this task may touch:** `docs/audit/invariants.md`, `docs/audit/events.md` (new); `docs/audit/known-issues.md` (section 8, and the rows section 8 settles, except G-3, G-4, G-5, section 2's "Recorded in" cells and section 3, which other packages edit); `docs/audit/scope.md` (links to the audit pages); this task file
- **Human gate:** no
- **Status:** done (PR #324 merged 2026-11-11; invariant row 11 names `invariant_deliveryHashStored`, and `contracts/README.md` counts were refreshed to 26 unit files, 10 cross-check files, 11 invariants and 293 tests. The gas snapshot was not refreshed: it goes stale again when C2 changes `contracts/src`, and C9 owns it)
- **Agent/session:** implementer, pilot plan package C1d (change kind 2, process docs and records)

## Intent

An auditor who opens `docs/audit/scope.md` should find, in a few more pages, everything needed to start the contract audit without asking us about scope: which properties the code is checked against and by which test (the invariants list), and which events the contracts emit and who reads them (the events inventory, N28). The threat model is a third page; since the scope change below, T-340 writes it. The known-issues page ended with six places where our own sources disagreed; this task reads the primary sources (the code at HEAD, the PRs, the task files), settles each one, corrects the page's own rows, and leaves a short record of how each was settled.

Inputs: `contracts/src/`, `contracts/test/invariant/`, `formal/`, `docs/neutrality.md`, `docs/architecture.md`, `SECURITY.md`, the contract review, the ADRs, the PRs and the task files. Outputs: two new pages under `docs/audit/`, an edited section 8 of `known-issues.md`, links from `scope.md`, a threat-model draft handed to T-340, and this task file.

Non-goals:
- No contract source, test, `.gas-snapshot` or `contracts/README.md` change. Gaps in events are listed as requirements for the settlement spec (T-245), not fixed here; events are never removed.
- No edit to any doc outside `docs/audit/`. Where another doc is wrong, the Handoff lists it for the docs batch.
- No new finding is invented; the pages gather and check. L-3 with L-5 is stated plainly as open and blocking mainnet.
- The rows G-3, G-4, G-5, section 2's "Recorded in" cells and section 3 belong to other packages running at the same time.
- `docs/audit/threat-model.md` and `docs/audit/state-model.md` belong to T-340 (scope change from the coordinator, 2026-11-11).

## Context

- `docs/audit/scope.md`, `docs/audit/known-issues.md`
- `docs/neutrality.md`, `docs/architecture.md`, `SECURITY.md`
- `docs/reviews/2026-11-03-contract-review.md`, ADR-0018 and the ADRs it cites
- `contracts/src/`, `contracts/test/invariant/RulesInvariants.t.sol`, `contracts/test/handlers/RulesHandler.sol`, `formal/Holdback.tla`, `formal/README.md`
- T-206, T-212, T-232; T-336 (the delivery-hash liveness invariant for G-5); T-245 (the settlement spec, planned privately); T-340 (the threat model)

## Acceptance criteria

- [x] A threat-model draft names every actor, its capabilities and trust, the assets, the trust boundaries and each attack class with where it is defended or accepted; it quotes ADR-0018's "not adopted" answer for DS-1 and states that L-3 with L-5 is open and blocks mainnet. Handed to T-340 at `reports/scratch/t-338-threat-model-draft.md` (scope change).
- [x] `docs/audit/invariants.md` keys each of the 10 `invariant_*` tests by exact name, plus the state machine and the formal model's properties, each with the property, its check and the functions it constrains; row 11 is reserved for T-336.
- [x] `docs/audit/events.md` lists every event in `contracts/src/` with fields, emitters, consumers, consumer gaps and what it reveals publicly; gaps E-1 to E-10 are requirements for T-245.
- [x] `known-issues.md` section 8 records each of the six disagreements as settled, with the source that is right, and the page's own rows agree with it.
- [x] `scope.md` links the audit pages in reading order, the threat model marked "added by T-340".
- [x] Every claim is labelled measured, documented, inferred or unknown; file and line references are at `main` `1430f77`.

## Out of scope

- Contract code and tests; other docs (listed in Handoff instead); the rows other packages own; the threat model and state model pages (T-340).

## Evidence

- Commands run and results:
  - `git diff --quiet 64be1f1 1430f77 -- contracts/src contracts/test/invariant` exits 0, so every line reference at `1430f77` holds for the deployed commit too [measured].
  - `grep -n "event \|emit "` over `contracts/src/`: 24 events, 17 in `HoldbackRules.sol` (`:91-119`) and 7 in `HoldbackBonds.sol` (`:30-38`); `DrandQuicknetBeacon.sol`, `IHoldbackBeacon.sol` and the local beacon emit none [measured].
  - `grep -n "function invariant_"` in `contracts/test/invariant/RulesInvariants.t.sol`: exactly 10 invariants, each at 256 runs and depth 100 [measured].
  - `grep -rln "getLogs\|eth_getLogs\|decodeEventLog\|parseEventLogs"` over `apps`, `packages`, `examples`, `site` (tests and `dist` excluded): `evm-settlement.ts`, `sync.ts`, `e2e-chain.ts` [measured].
  - `gh pr view 161`: merged 2026-11-04T08:23:45Z, merge commit `64be1f1` [measured]. `gh pr view 160`: merged 2026-11-04T07:15:13Z [measured]. `gh pr view 239`: merged 2026-11-07T06:06:02Z; its 15 files include neither `tests/read-after-write.lint-bypass.test.ts` nor `packages/settlement/evm/t232-redteam.test.ts` [measured].
  - `git branch -a --contains 3515172`: only the local branch `t-232-review-round-backup`; `git ls-remote --heads origin t-232-review-round-backup` prints nothing [measured].
  - A grep for `drip`, `parseEther` and value sends over `apps/demo-cloud/src` and `apps/operator/src` finds no test-ETH drip [measured].
  - Link check: every relative link in `invariants.md`, `events.md`, `known-issues.md` and `scope.md` resolves except `threat-model.md`, which T-340 adds [measured, `ls -d` over the extracted targets].
  - `git -C <worktree> diff --stat origin/main -- contracts/src` prints nothing [measured, before each commit].
  - No `forge test`, `formal/check.sh` or `pnpm verify` ran: kind 2 needs no local check beyond the links.
- Snapshot diffs: none.
- Metrics: two new pages, `invariants.md` 16,647 bytes and `events.md` 13,978 bytes [measured: `wc -c`]; the threat-model draft has 27 attack classes [measured: table rows]; `known-issues.md` 17 lines added, 13 removed [measured: `git diff --stat`].

## Decisions

1. **L-3 and L-5 are recorded as one open, blocking issue.** D43 and T-212's Status both say they block mainnet; the review's older §2.3 wording ("accepted until Phase 4") predates D43. The pages say open, not accepted.
2. **L-5's severity of record is D43's medium.** The low (first pass), medium (adversarial pass) and high (DeepSeek) ratings stay as history in the row.
3. **O-2's evidence is recorded as missing, not the finding as wrong.** The red-team tests for O-2, O-3 and O-4 exist in commit `3515172` on a local branch only. The findings stand; the rows say their tests never reached `main`.
4. **The invariants page keeps the state machine as the contract implements it** (stage and appeal transitions with lines), as the brief asked. T-340's `state-model.md` may take it over; the invariants page then only needs a link.
5. **Event gaps are numbered E-1 to E-10** so T-245 can cite them. None changes an event.
6. **The threat model draft moved to scratch** on the coordinator's scope change, before any commit. Its links and line references are at `1430f77`.

## Handoff

**Done:** `docs/audit/invariants.md`, `docs/audit/events.md`, `known-issues.md` section 8 with rows R-7, L-3, L-5, O-2, O-3 and O-4, and the reading order in `scope.md`. The threat model draft is at `/Users/rafa/Documents/escrow/reports/scratch/t-338-threat-model-draft.md` for T-340: actors, assets, trust boundaries, 27 attack classes with lines and tests, the ADR-0018 quote for DS-1, and a section stating L-3 with L-5 as open and blocking mainnet.

**For the coordinator:**
- Fill invariant row 11 in `invariants.md` with T-336's test name once it lands, and the "Contract functions" cell if T-336 checks more than `_acceptDelivery` and the three name checks.
- When T-334's clean lands, the line numbers in both pages move; they cite `1430f77`.
- `scope.md` links `threat-model.md`, which does not exist until T-340 merges.

**For the docs batch (other docs found wrong; not edited here):**
1. `docs/reviews/2026-11-03-contract-review.md` §2 table, row L-1: Status says "T-212 item 3"; L-1 is fixed in PR #161 (`64be1f1`).
2. Same review, §2.3 L-3: "Status: accepted until Phase 4" predates D43; it blocks mainnet.
3. Same review, §2.3 L-5, Status: "The appeal adjudicator's coverage is a Phase 4 rule" should also say it blocks mainnet (D43; the same section's Severity bullet says so).
4. `docs/neutrality.md`, control-point table: the adjudicator row says "the defaulting adjudicators' bonds compensate the seller", and the appeal adjudicator row says "the appeal adjudicator's bond compensates the seller". The contract pays no default compensation (`HoldbackRules.sol:553-569`; I-8, Phase 4).
5. `docs/neutrality.md`, residual 7: "bounded by its own bond". The appeal adjudicator posts no bond on chain (L-5).
6. `docs/neutrality.md`, "How neutrality is tested": liveness says funded commitments reach "Released, Refunded or Defaulted"; the model's `FundedSettles` is Released, Refunded or Settled (`formal/Holdback.tla`, Liveness).
7. `docs/tasks/T-232-read-after-write-audit.md`, Handoff Backlog: cites `lint-bypass.test.ts` and red-team fixtures from commit `3515172`, which never reached `main`. Either land those tests or say where they are.
8. `docs/architecture.md`, the escrow-state diagram: "Defaulted --> Refunded: default outcome (seller compensated from bonds)" describes SimChain and the model, not the contract. A note that the contract defers compensation to Phase 4 would stop an auditor reading it as the contract's behaviour.
9. `formal/README.md`: the contract column still reads TBD (I-11); `invariants.md` gives the mapping from review §5.

**Open questions:** none for this task. T-245 has no task file in this repository; the events gaps wait for it.
