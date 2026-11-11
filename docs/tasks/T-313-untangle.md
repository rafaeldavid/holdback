# T-313: untangle the repository for a stable production testnet

- **Lane:** infra
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** a series of small PRs, each with its own kind (Change recipes: 2, 4, 5 and 11)
- **Depends on:** T-312 (crow.direct is live since 2026-11-10).
- **Paths this task may touch:** `apps/` (not the API's shape), `packages/` (not the settlement logic), `examples/`, `scripts/`, `site/`, `tests/`, `tools/`, `config/`, `docs/`, `README.md`, `brand/domain.md`, `vitest.config.ts`, this file. Drafted for Rafa to merge: `.github/workflows/ci.yml`. Never: `spec/schemas/`, contract events, `contracts/src`, `.gitleaksignore`, `agent-ops/`, `CLAUDE.md`, `AGENTS.md`, `.claude/`.
- **Human gate:** yes for every deploy and for the tier 3 PRs. Nothing here deploys.
- **Status:** in progress
- **Agent/session:** the untangle session, 2026-11-11, worktrees under `.worktrees/t-313-*`

## Intent

Rafa asked on 2026-11-10 and 2026-11-11 for the repository to be cleaned up and organized, "with the aim to have a stable production testnet and crow control", plan first, then execution. On 2026-11-11 he added that the product must stay light: CI, reviews and deploys take seconds or minutes, with no security gate removed.

The goal is fewer ways for the live demo to fail silently, in this order:

1. reliable operators and settlement on Sepolia;
2. a deploy and rollback that check themselves;
3. a working try command and test seller;
4. Crow Control reporting the truth from primary sources;
5. then tidiness: dead code, stale words, copies, misleading names;
6. then speed: CI time, review rules and deploy steps.

**Inputs:** five read-only maps of both repositories at `7bfbd92`, and the measured baseline below. **Outputs:** the PRs listed under Acceptance criteria, one final review, and a report.

**Non-goals.**
- No rewrite of the settlement contracts, the settlement logic or the operator API's shape. A production rebuild of those is planned.
- No change to `spec/schemas/` and no removed event.
- No deploy. Each waits for Rafa.
- Crow Control's own changes live in the private repository and are not recorded here beyond their effect.

## Context

- `docs/team.md`, Change recipes and Rules and checks.
- `docs/operations.md`: what is live and how to deploy it.
- T-312's Handoff: the escrow.stream mentions left to move.

## Acceptance criteria

Each row is one PR. A PR keeps behaviour unless its row says "fix".

- [ ] PR 1: this task file.
- [ ] PR 2 (fix): the World's `persist()` chain and the operator's `sync()` chain recover after a rejected write. A test with a store that fails once shows the next call writes.
- [ ] PR 3 (fix): `scripts/metrics`, `scripts/costs`, `config/costs.template.json` and `examples/e2e-round.ts` read crow.direct. Recorded fixtures keep the hosts they recorded.
- [ ] PR 6 (fix): `pnpm demo-cloud:deploy` refuses a tracked change or a branch without main before any upload; an unknown `SETTLEMENT` is refused; `pnpm demo-cloud:e2e` runs locally on SimChain.
- [ ] PR 7: the test seller's deploy reads the live version, deploys, waits for `operational`, and rolls back otherwise.
- [ ] PR 8 (fix): one mainnet chain list in `packages/core`, imported by the three guards; the timeouts pass reads a flag, not the words "reverted on chain"; `awaitingAdjudicator()` is removed.
- [ ] PR 9: dead code, dead files and stale mutation targets are gone or fixed.
- [ ] PR 10: the README map, the architecture page's layout and the docs' hosts match the repository.
- [ ] PR 11: guard tests for the copies that must remain; `site/check.mjs` runs in `pnpm verify`.
- [ ] PR 12: one untrusted-text module, one two-origin test harness, and names that say their unit.
- [ ] PR 13 (Rafa merges): CI runs every anvil-gated suite.
- [ ] PRs 15 to 20: the speed pass. Shards rebalanced; path-aware jobs and parallel contract jobs drafted for Rafa; one script for the site deploy; the review rule written down; a change ledger that one daily docs PR drains.
- [ ] One independent review of the whole change set passes, with blocking findings fixed.

## Out of scope

- Splitting `evm-settlement.ts`, `world.ts` and `server.ts`. Rafa decides; the recommendation is to wait for the rebuild.
- The contract tests' duplicated builders and `contracts/.gas-snapshot`.
- Everything in the session's triage note, which Rafa reviews for the roadmap.

## Evidence

- **Baseline, measured on main at `7bfbd92`, 2026-11-11:** `pnpm typecheck` exits 0. `pnpm test`: 143 test files passed and 2 skipped; 2,964 tests passed and 6 skipped; 506 s.
- **The seven anvil suites CI skips,** run locally with Foundry: 7 files passed, 17 tests passed and 2 skipped (both need `SEPOLIA_FORK_RPC`), 131 s (measured).
- **CI on a pull request,** run 42802205136: 7 min 30 s wall; the contracts job 7 min 18 s (anvil tests 231 s, `forge test` 171 s); test shard 4 took 3 min 10 s and shard 1 took 1 min 9 s (measured).
- Each PR's own evidence goes in its body.

## Decisions

1. **Rank by risk to stability, not by tidiness.** A fix to a silent failure goes before any removal of dead code.
2. **Keep the layout.** The maps found no orphaned source file. The problems are drift between copies and failures that report nothing, so the fix is one list per fact, and a guard test where a copy must remain.
3. **Document, do not move, the production code in `examples/`.** The test seller imports `agent.ts` and `verify.ts`, and `site/try.mjs` bundles them under a pinned SHA-256. Moving them changes the pin and needs a site deploy.

## Handoff

Not started beyond this file. The plan and the lower-priority items sit outside git, in `reports/scratch/untangle-plan.md` and `reports/scratch/untangle-triage.md`.
