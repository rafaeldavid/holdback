# T-313: untangle the repository for a stable production testnet

- **Lane:** infra
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** a series of small PRs, each with its own kind (Change recipes: 2, 4, 5 and 11)
- **Depends on:** T-312 (crow.direct is live since 2026-11-10).
- **Paths this task may touch:** `apps/` (not the API's shape), `packages/` (not the settlement logic), `examples/`, `scripts/`, `site/`, `tests/`, `tools/`, `config/`, `docs/`, `README.md`, `brand/domain.md`, `vitest.config.ts`, this file. Drafted for Rafa to merge: `.github/workflows/ci.yml`. Never: `spec/schemas/`, contract events, `contracts/src`, `.gitleaksignore`, `agent-ops/`, `CLAUDE.md`, `AGENTS.md`, `.claude/`.
- **Human gate:** yes for every deploy and for the tier 3 PRs. Nothing here deploys.
- **Status:** review
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

- [x] The task file (PR 259).
- [x] Fix: the demo world stays failed after a rejected storage write and the Durable Object reopens it from storage; the operator's event index recovers in place (PR 268).
- [x] Fix: `scripts/metrics`, `scripts/costs`, `config/costs.template.json` and `examples/e2e-round.ts` read crow.direct (PR 260).
- [x] Fix: `pnpm demo-cloud:deploy` refuses a tracked change or a branch without main before any upload; an unknown `SETTLEMENT` is refused; `pnpm demo-cloud:e2e` runs locally on SimChain (PR 262).
- [x] The test seller's deploy reads the live version, deploys, waits for `operational`, and rolls back otherwise (PR 265).
- [x] Fix: one mainnet chain list in `packages/core`, imported by the three guards; the timeouts pass reads a flag; `awaitingAdjudicator()` is removed (PR 269).
- [x] Dead code, three unshown images and four stale mutation targets are gone or fixed (PR 264).
- [x] One deploy helper for the three deploys, and `pnpm site:deploy` (PR 271); the site deploy empties its output first, and the seller's deploy takes `--dry-run` or nothing (PR 277); the pre-flight ignores files changed inside a submodule (PR 282).
- [x] One untrusted-text module (PR 270); one two-origin test harness, one set of demo terms, names that say their unit (PR 275).
- [x] `pnpm health`, the measure for each round (PR 261).
- [x] The docs batch: deploy commands, the console's move, three rows in Rules and checks, the README map (this PR).
- [ ] Rafa merges: CI runs seven more anvil suites, beside `forge test`, and only when the chain side changed (PR 263).
- [ ] Rafa reads and merges: an audit scope, a contracts README and one known-issues list (PR 267).
- [x] One independent review of the whole change set: no blocking finding; four findings fixed (PR 277 and two commits on PR 263).

Not done, by decision (Rafa, 2026-11-11: "do not over-engineer"): the guard tests for copied facts, the change ledger, and the split of the three large files. They are in the session's triage note.

## Out of scope

- Splitting `evm-settlement.ts`, `world.ts` and `server.ts`. Rafa decides; the recommendation is to wait for the rebuild.
- The contract tests' duplicated builders and `contracts/.gas-snapshot`.
- Moving planning and business documents to the private repository. The session classified every tracked non-source file and gave Rafa a move list; nothing moves until he says so.
- Everything in the session's triage note, which Rafa reviews for the roadmap.

## Evidence

All measured on 2026-11-11 unless marked.

- **Tests, before:** main at `7bfbd92`: `pnpm typecheck` exits 0; `pnpm test` passed 2,964 tests and skipped 6, in 143 files with 2 skipped, in 506 s.
- **Tests, after:** main at `8e7fb2a`: `pnpm typecheck` exits 0; `pnpm test` passed 3,090 tests, failed 1 and skipped 6, in 153 files, in 515 s. The one failure is `examples/e2e-scenarios-scripted.test.ts` ("adjudicator-1 made no decision; both operators show Released"), the load-sensitive check `docs/team.md` records from T-231. The machine's load average was 14.6, and the file passed 4 of 4 tests twice when run alone. CI on main passed at `8e7fb2a`.
- **No assertion was weakened** across the series (the final review read every changed test hunk).
- **The demo, before:** one live deal against api.crow.direct and api2.crow.direct ended Released in 44 s (commitment `0x6ef78b8b…5436`).
- **The demo, after:** another session deployed main at `a42dc45`, which holds this series, on 2026-11-11 at 07:54 UTC with `pnpm demo-cloud:deploy` and then `pnpm site:deploy`, both on their first real run with the pre-flight (`docs/operations.md`, T-314 to T-317). Its smoke deal ended Released in 44 s. A live deal after it ended Released in 49 s (commitment `0xb8eeab0a…4380`). The pre-flight refused the main checkout for a changed file inside a submodule; PR 282 makes it ignore those.
- **The local end-to-end run** of the Workers runtime (`pnpm demo-cloud:e2e`) could not start before PR 262 and ends Released in 73 s after it.
- **The storage failure** (PR 268): on anvil, recovering `persist()` in place stored an event log with a gap, and the world then refused to open ("saved event 2 is out of order"); a restart from main's failed state opened cleanly. So the fix keeps the world failed and reopens it. A write rejected after the book rows still leaves what a restart leaves (triage 36).
- **CI on a pull request:** 7 min 30 s before (run 42802205136: the contracts job 7 min 18 s, the slowest shard 3 min 10 s). On PR 263's own run, with no compiled output cached: the two anvil legs 4 min 23 s and 4 min 42 s, `forge test` 3 min 38 s, the slowest shard 3 min 2 s. That run also failed once on a missing import in `live.test.ts`, a file CI skipped before.
- **`pnpm health`:** before, at `f03c5fc`: 40 errors dropped with no log, 22 pieces of module-level state, 4 test hooks in demo code, 48 copies of facts beyond one each, 7 source files over 800 lines, 17 gated test files that no CI step names. After, at `8e7fb2a`, not counting the script itself: 41, 22, 4, 51, 7 and 17 (11 once PR 263 merges). So this round did not lower the counts: it fixed failures and deploy paths. The mainnet list fell from 4 files to 2 and the old host from 6 to 4, while the three deploy scripts and the seller's checks each name the operator URLs (2 files to 6).
- **Crow Control** (private repository): its checks read crow.direct and report a redirect as moved (PR 40); the console moved to control.crow.direct on 2026-11-11 at 06:44 UTC, crow-console `001cb560` (PR 41; `docs/operations.md` has the record). Its tests went from 186 to 207, all passing.
- **Reviews:** one on PR 268 and one on PR 269 (kind 5), then one over the whole set. None found a blocking issue; each found something worth fixing, and those fixes are in PRs 268, 269, 277 and 263.

## Decisions

1. **Rank by risk to stability, not by tidiness.** A fix to a silent failure goes before any removal of dead code.
2. **Keep the layout.** The maps found no orphaned source file. The problems are drift between copies and failures that report nothing, so the fix is one list per fact.
3. **Document, do not move, the production code in `examples/`.** The test seller imports `agent.ts` and `verify.ts`, and `site/try.mjs` bundles them under a pinned SHA-256. Moving them changes the pin and needs a site deploy.
4. **A broken world reopens; it does not recover in place.** Measured on anvil (Evidence). The operator's event index does recover in place, because a retry reads from the last indexed event and loses nothing.
5. **A redirect reads Unknown on Crow Control, with the word "moved".** The console has four states and its page ships with the Worker, so a fifth state would need a deploy.
6. **Pull requests never write the compile cache.** Main compiles from source on every push and is the only writer; a pull request that changes no contract restores main's output.
7. **Deletions and consolidations only in the second round** (Rafa, 2026-11-11). No guard-test scaffolding, no ledger script, no file splits before the rebuild's shape is known.

## Handoff

- **Done:** every row above that is ticked. Main is green at each merge.
- **Waiting on Rafa:**
  - merge PR 263 (tier 3: `.github/workflows/ci.yml`);
  - read and merge PR 267 (the audit files);
  - say which tiers of the move list go to the private repository;
  - re-approve the cost collector, since PR 260 edited one line under `scripts/costs`;
  - a test-seller deploy only when its code next changes: this series changed its deploy script, not the Worker;
  - the private workflow's comment and step name still say control.escrow.stream.
- **Not verified:** the signed-in console page at control.crow.direct and the 301 from the old host (both need a browser sign-in); the seller's deploy script and every script's rollback path against Cloudflare (tested with stand-ins only; the operators' and the site's deploys passed for real); a chain world's reopen after a failed write (run on SimChain only).
- **How to resume:** the triage note lists 45 lower-priority items with their locations. The health numbers above are the baseline for the next round: run `pnpm health --gh` before and after.
- **After PR 263 merges:** add the test `docs/team.md` proposes (every anvil-gated suite is named in CI), and mark that row built.
