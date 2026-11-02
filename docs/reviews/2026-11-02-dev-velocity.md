# Dev velocity review, 2026-11-02

An independent read of how this repository is developed: where the coordinator's and the agents' time goes, which repeated steps should become commands, skills, hooks or scripts, and how to make CI and `pnpm verify` run only what a change affects. Recommendations only; nothing here was changed. Every number is labeled **measured** (read from `gh`, the logs or the files), **inferred** (derived from measured numbers) or **guessed**.

Sources: `CLAUDE.md`, `docs/team.md`, `docs/operations.md`, `docs/testing.md`, `.github/workflows/ci.yml`, `package.json`, `scripts/verify.ts`, `vitest.config.ts`, `contracts/foundry.toml`, `formal/check.sh`, `.claude/agents/*`, `.claude/commands/*`, `.claude/settings.json`, the last 40 merged PRs, the last 200 workflow runs (per-job and per-step timings on runs 41428171444, 41418049826, 41431233049, 41414456216, 41402908123 and both attempts of 41418049826 and 41431703599), the repository ruleset, and the project memory notes.

## Baseline (what the cycle costs today)

**Cadence (measured).** 40 PRs merged between 2026-10-31 08:56 and 2026-11-02 10:44; 15 merges today by 13:11. 680 commits in 7 days. Median PR lead time (created to merged) 20 min; docs-only PRs took 1 to 6 min yesterday and 23 min today (PR 82). Direct pushes to main: 76 on 2026-11-01, 2 today, and since the ruleset (below) none are possible.

**CI per pull request (measured, run 41418049826 attempt 2, and 41428171444 for a docs-only PR).**

| Job | Wall | Where the time goes |
| --- | --- | --- |
| `contracts (forge test, anvil tests)` | 268 to 383 s | checkout with `submodules: recursive` 151 s (41 nested repos, about 3.7 s each); `forge test` 158 s, of which compiling 74 files with via-IR is 118 s and the 168 tests are 40 s; pnpm setup and `pnpm build` 30 s; anvil vitest suites 26 s |
| `test (i/4)` | 42 to 75 s | setup about 15 s, `pnpm build` 10 to 17 s, tests 15 to 29 s |
| `typecheck, lint, spec, snap` | 53 to 57 s | setup about 20 s, typecheck 13 to 15 s, lint 4 to 5 s, spec 1 s, snap 11 to 13 s |
| `formal (TLC)` | 30 to 37 s on PRs; **684 s on push to main** (the seven liveness configs) | TLC |
| `gitleaks` | 6 to 11 s | |
| `check` | 2 to 14 s | waits for everything above |

The critical path of every PR, including a one-file docs PR, is the `contracts` job: 4.5 to 6.5 min. Before PR 70 landed this morning (07:01), PR runs took 71 to 76 s (measured on PRs 71 to 74); after it, 250 to 373 s. A push to main now takes 11.5 to 14.5 min to go green because of the liveness configs.

**Runner queueing (measured).** Across the last 28 successful runs, every job started within 35 s of run creation except the two re-runs. Concurrency is not a problem today; it would become one if yesterday's 90 pushes a day returned with today's nine jobs per run (GitHub's free plan allows 20 concurrent jobs; inferred).

**Flakes (measured).** The anvil test `gas per deal: every path settles` timed out at 180 s on attempt 1 of PR 77 (09:15) and of PR 83 (10:55). On healthy runs the same test takes 10.5 s (09:25:22 to 09:25:33 in the re-run) and the whole anvil step 26 s. A 17x slowdown is a stall, not a slow runner. Cost: PR 77 went green 18 min later than it would have; PR 83 waited 2 h 13 min for its re-run (10:55 failure, 13:04 re-run, 13:09 merge). PR 84 then raised the timeout to 420 s, which makes each future stall cost 7 minutes before it reports. Two gitleaks false positives on 2026-11-01 (PRs 67 and 68) were each fixed with a `.gitleaksignore` push to main, and PR 67 was merged with gitleaks red. The design-map test failed once on a docs-only PR (PR 75 added Phase 7 to `docs/plan.md`), which shows that some tests read `docs/`.

**Locally (measured).** `pnpm verify` on 2026-11-01 took 43 s (typecheck 2.5 s, lint 2.5 s, test 25 s, spec 0.4 s, snap 8.6 s, demo 3.5 s). Since PRs 69 and 74 it also runs `forge build`, `forge test` and `snap --settlement=local`; inferred from the CI numbers on 2 cores, that is about 2 to 3 more minutes on an M-series laptop, and `docs/backlog.md` records that two verifies in parallel (forge compiling next to vitest) push `judgment.test.ts` "draws the same panel" (1.9 s alone, measured today) and `agents.test.ts` "determinism" (1.8 s alone) past the 5 s default timeout.

**Repository state that shapes the recommendations (measured today).**
- Ruleset `main` (id 26375153, active, no bypass actors): pull request required (0 approvals, `require_extra_approval_for_unattributed_changes: true`), required status checks **`check` and `gitleaks`** (non-strict), deletion and force pushes blocked. `allow_auto_merge` and `delete_branch_on_merge` are off. 61 remote branches; 19 agent worktrees under `.claude/worktrees/` for branches already merged.
- `check` needs `static`, `test`, `contracts`, `formal` but not `gitleaks`; `gitleaks` is required on its own by the ruleset, so that is fine.
- `tests/design-map.test.ts` reads `docs/plan.md` and `docs/api.md`; `site/check.mjs` reads `docs/api.md` and `examples/verify.ts` and is not run in CI at all.
- The design map's work feed (`scripts/design-map.mjs`) parses first-parent `Merge pull request #N` commits and takes the PR title from the body, so merges must stay merge commits (not squashes) unless the parser changes.
- Three worktree conventions coexist: `.claude/commands/task.md` says `git worktree add ../holdback-$ARGUMENTS` (outside the repo, which triggers the `outsideReadsBlocked` prompts the memory notes describe), `docs/team.md` says `.worktrees/holdback-T-xxx`, and practice is the Agent tool's `isolation: "worktree"` under `.claude/worktrees/`.

---

## 1. Skills and commands to automate

Ranked by estimated time saved per week. The week is assumed to hold about 75 PRs, 10 task starts, 2 demo deploys, 5 site deploys, 10 decisions and 5 daily logs (inferred from the two-day sample; the pace may not hold, so treat the totals as upper bounds).

Existing coverage: `/task` (pick up a task), `/verify`, `/handoff`, `/map`, `/snap`, `/decide` in `.claude/commands/`. Nothing covers the merge, the deploys, the review brief, the decision record, the daily log or the session start, which is where the repeated manual steps were today.

### 1.1 `/merge-pr <n> [T-xxx]` (saves about 3 h a week; inferred from 75 PRs x 2.5 min of polling, re-running, merging, cleaning up and flipping status)

**Trigger:** a PR has a PASS review and the coordinator wants it landed.

**What it replaces:** polling loops (`sleep 60; gh pr checks`), eyeballing which job failed, `gh run rerun`, `gh pr merge`, the task-status commit, worktree and branch cleanup, `pnpm map` and the republish, each done by hand today.

**Steps it runs:**
1. `gh pr view <n> --json number,title,headRefName,body,statusCheckRollup`; take the task id from the argument or the body (`T-\d{3}`).
2. **Wait without polling.** If the session runs in the Claude Code app and the PR is bound (`mcp__ccd_pr__bind_pr`), read `mcp__ccd_pr__get_status` (served from the app's cache; its description says to use it instead of polling) and turn on `mcp__ccd_pr__set_monitor` with `auto_fix` so the session is woken on a CI failure. Otherwise run `gh pr checks <n> --watch --fail-fast` as a Bash call with `run_in_background: true`: one notification when it exits, zero intermediate turns. (`gh` 2.88.1 here supports both flags; measured.)
3. **One retry for a known flake.** On failure: `gh run view <run> --log-failed | grep -E "Test timed out|×"`. If the failing test is on the known-flake list kept in `docs/testing.md` (today: `evm-settlement.test.ts` gas per deal, `judgment.test.ts` draws the same panel, `agents.test.ts` determinism), run `gh run rerun <run-id> --failed` once and go back to step 2. Anything else: stop and report ISSUES with the log excerpt. Never rerun twice.
4. **Merge** when `check` and `gitleaks` are green: `gh pr merge <n> --merge --delete-branch`. Merge commits, not squashes (the work feed parses them). If the merge is refused because of the ruleset's "unattributed changes" option, report it rather than retrying (see the watch item in 2.10).
5. **Close out the task:** `node scripts/task-done.mjs T-xxx --pr <n>` (new, about 30 lines: set `- **Status:** done`, append "Merged as PR n on <date>" to Handoff). Since main takes PRs only, do not open a PR per flip: commit on a `chore/task-status` branch and fold it into the day's log PR (1.8), or let the map derive "done" from the merge (2.9) so nothing waits on this.
6. **Clean up:** `git worktree remove <path>` for the merged branch if one exists under `.claude/worktrees/` or `.worktrees/`, `git worktree prune`, `git fetch --prune`.
7. `pnpm map`, then republish `reports/design-map.html` to the existing artifact URL (`/map` step 4).
8. Report: run id, reruns, merge SHA, map version; label measured.

**Draft `.claude/commands/merge-pr.md`:**

```markdown
---
description: Wait for a PR's checks without polling, retry one known flake, merge, close the task out, refresh the map
argument-hint: <pr-number> [T-xxx]
---
Land PR $ARGUMENTS once its checks pass. Never loop on `sleep`; wait with one of:
- `mcp__ccd_pr__get_status` (bound PR) plus `set_monitor auto_fix: true`, or
- `gh pr checks <n> --watch --fail-fast` as a background Bash call.

On a red check, read `gh run view <run> --log-failed`. If the failing test is in
`docs/testing.md` "Known flakes", run `gh run rerun <run> --failed` once and wait again.
Otherwise stop and report ISSUES with the excerpt.

When `check` and `gitleaks` are green: `gh pr merge <n> --merge --delete-branch`.
Then `node scripts/task-done.mjs T-xxx --pr <n>` (commit on `chore/task-status`, fold
into the day's log PR), remove the branch's worktree, `git worktree prune`,
`pnpm map`, republish the map to https://claude.ai/artifact/4nAPcSGQz6nL5mb8AuDhd2.
Report run id, reruns, merge SHA and map version, labeled measured.
```

**Longer term (needs Rafa, repo settings):** turn on `allow_auto_merge` and `delete_branch_on_merge`. With the ruleset now requiring `check` and `gitleaks`, `gh pr merge --auto --merge` right after the review makes steps 2 to 4 disappear: GitHub merges when the checks pass, the `auto_fix` monitor wakes the session only if they fail.

### 1.2 `/start-task T-xxx` (saves about 45 min a week; guessed, 10 starts x 4 to 5 min)

**Trigger:** a task file is `todo` and its dependencies are `done`.

**What it replaces:** writing the implementer brief by hand each time, creating the worktree, copying permissions, installing, and the three inconsistent worktree conventions.

**Steps:**
1. Read `docs/tasks/T-xxx-*.md`. Check every `Depends on` task is `done` (grep the Status lines) and that no PR exists for `t-xxx-*` (`gh pr list --head`). Stop if either fails.
2. Generate the brief from the task file: Intent (to be restated by the implementer), Paths, Acceptance criteria, Human gate, the lane's rules from `docs/team.md`, the three environment rules from the memory notes (stay at the worktree root with absolute paths; Edit and Write only, never `sed -i`, heredocs or interpreter one-liners; logs under `reports/`), `pnpm verify --affected` then `pnpm verify` before the PR, the PR template, and the handoff expectations.
3. Launch `implementer` with `isolation: "worktree"`. The brief tells it to `git switch -c t-xxx-<slug>`, `pnpm install --frozen-lockfile --prefer-offline`, run `forge build` only if the task's paths include `contracts/`, set `- **Status:** in progress` and the `Agent/session` line, and commit that first.
4. Append "lane started" to the day's log.

Also align `.claude/commands/task.md` step 4 and `docs/team.md` on the Agent-tool worktree; the `../holdback-T-xxx` form is the one that prompts.

### 1.3 Session brief on start (saves about 1 h a week; guessed, 3 starts a day x 5 min of reading four documents and running four `gh` commands)

**Trigger:** every session start (hook) or `/resume`.

**Script `scripts/brief.mjs`** prints, in under a second: the "Next steps (resume here)" list from the newest `docs/log/*.md`; open PRs with their `check`/`gitleaks` state (`gh pr list --json number,title,headRefName,statusCheckRollup`); tasks whose Status is `in progress` or `review`; failed runs in the last 24 h (`gh run list --status failure --limit 10`); `schemaVersion` from `https://api.escrow.stream/v1/status` and `api2`; stale worktrees (`git worktree list` entries whose branch is merged). Everything is measured output, labeled as such.

**Hook (settings.json, recommendation only):**

```json
"hooks": {
  "SessionStart": [{ "hooks": [{ "type": "command", "command": "node scripts/brief.mjs --short" }] }]
}
```

### 1.4 `/deploy-demo` (saves about 30 to 45 min a week; guessed, 2 deploys x 15 min plus the occasional incident like the v0.8 world that kept serving v0.7)

**Trigger:** Rafa's go-ahead for a demo redeploy (it reaches outside the repo, so the command asks once, up front, and then runs every step).

**Steps, from `docs/operations.md`:**
1. Preconditions: on `main`, `git fetch` shows no divergence, the last push-to-main run is green (`gh run list --branch main --limit 1`). Refuse otherwise (deploying from a branch that has not merged main dropped custom domains once).
2. Schema check: compare `SCHEMA_VERSION` in `apps/operator/src/server.ts` with `schemaVersion` from the live `/v1/status`. If they differ and `WORLD_NAME` in `apps/demo-cloud/src/worker.ts` was not changed since the last deploy, stop: the world must be reset first (the journal does not replay across versions).
3. `pnpm demo-cloud:deploy` (op1 first, then op2; the script already orders them).
4. Verify: `schemaVersion` on both nodes equals the code's; `node apps/demo-cloud/scripts/deal.ts https://api.escrow.stream https://api2.escrow.stream` exits 0 with Released. On a wrong version: `npx wrangler@4 tail holdback-op1 --format json` for 60 s and report; offer `wrangler rollback` for both Workers.
5. Docs: update the Schema paragraph in `docs/operations.md` and the version line in `site/llms.txt` (then `/deploy-site`), and the day's log. These are a docs-only PR.

### 1.5 `/deploy-site` (saves about 15 min a week; guessed, 5 deploys x 3 min, plus it stops unchecked site pushes)

`node site/build.mjs --op1 https://api.escrow.stream --op2 https://api2.escrow.stream --out reports/site-out && node site/check.mjs && npx wrangler@4 deploy --config apps/site/wrangler.jsonc`, then verify `curl -s https://escrow.stream/llms.txt | shasum -a 256` equals `shasum -a 256 reports/site-out/llms.txt`, and log it. Also add the `site` CI job from 2.8 so the check runs before, not only during, a deploy.

### 1.6 `/review-pr <n>` (saves about 30 min a week; guessed, 15 reviews x 2 min of brief writing)

Builds the reviewer brief from `gh pr view` and the task file, then launches `reviewer` (and, for `contracts/`, `packages/settlement/` or `packages/judgment/` changes, says which second-family tool to run the same brief through; none is installed locally today: `codex`, `gemini`, `opencode` all absent, measured). The brief: PR number, title and body; the task's acceptance criteria; the allowed paths and the actual changed paths (`gh pr diff --name-only`), with any out-of-scope path flagged up front; the Rules-and-checks rows the paths touch; the snapshot diffs (`git diff origin/main...<branch> --stat -- fixtures/`); the verify report path; how to check out (`gh pr checkout <n>` inside a worktree); the output contract PASS / ISSUES / BLOCKED with file and line.

### 1.7 `/record-decision "<title>" [--adr ADR-00nn] [--by rafa|research]` (saves about 20 min a week; guessed, 10 decisions x 2 min)

A small `scripts/decision.mjs` allocates the next number (D41 today), inserts `## Dnn. <title>` with the `**Decided <date> ...**` stub at the end of `docs/decisions-today.md`, updates the ranges in its Status paragraph (which today enumerates D37 to D40 by hand), and adds a bullet under "Decided today" in the day's log. The agent then fills the body with Edit: context, options, the choice, what it refines, the ADR it settles. If the decision changes architecture, a contract, a schema or a defense, the command ends by calling `/decide` for the ADR draft.

### 1.8 `/daily-log` (saves about 25 min a week; guessed, 5 x 5 min)

`scripts/log-skeleton.mjs` creates `docs/log/<today>.md` if missing, with the measured sections filled: "Waiting on Rafa" carried over from the previous log, merged PRs today (`gh pr list --state merged --search "merged:<date>"`), decisions added today (new `## D` headings in `docs/decisions-today.md` since yesterday's merge-base), Live (`/v1/status` of both nodes, site hash), Lanes (task statuses). The agent writes "Next steps (resume here)". The command opens the PR that also carries the task-status flips from 1.1. `/handoff` keeps its three-line append.

### 1.9 Hooks (saves attention more than minutes; the second one prevents the two red-gitleaks merges seen yesterday)

- **No polling loops.** A `PreToolUse` hook on Bash that refuses commands matching `sleep [0-9]+.*gh (pr checks|run (view|list))` or `while .*gh pr checks` with the message "use `gh pr checks --watch --fail-fast` in the background or `mcp__ccd_pr__get_status`". Script `scripts/hooks/no-polling.sh` reads the tool input JSON on stdin and exits 2 to block.
- **Secrets before commit.** `git config core.hooksPath .githooks` once per clone (worktrees share it), with `.githooks/pre-commit` running `gitleaks protect --staged --redact` when `gitleaks` is on PATH (it is not today, measured; `brew install gitleaks` is a local tool install, not a repo setting) and the repository's `.gitleaksignore`. False positives then get their allowlist line in the same commit instead of a red required check.

### 1.10 Design map refresh

`/map` already covers it. The remaining manual part is the artifact republish, which only an agent can do. Two ways to remove it from the merge path: run `pnpm map` and the republish only from `/daily-log` (once a day, not once a merge), or (Rafa's call, it is publishing) serve `reports/design-map.html` from the site Worker at a private path and let `/deploy-site` carry it.

---

## 2. Faster development cycles: run only what a diff affects

Ranked by time saved per week. Items 2.1 to 2.3 together take a code PR from 4.5 to 6.5 min down to about 1.5 to 2 min and a docs PR to about 1 min (inferred from the per-step timings above).

### 2.1 Cache the contracts dependency tree and the Solidity build (saves about 4 min on every PR; 75 PRs x 4 min = 5 h of CI wall time, of which roughly half is time the coordinator is waiting; inferred)

The two biggest blocks of the critical path are deterministic in their inputs: the 151 s submodule fetch depends only on the gitlink SHA of `contracts/lib/commerce-payments`, and the 118 s compile depends only on `contracts/**` plus that SHA. Neither is cached today (`foundry-toolchain@v1` caches RPC responses only).

```yaml
  contracts:
    name: contracts (forge test, anvil tests)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4            # no submodules here
      - id: lib
        run: echo "sha=$(git rev-parse HEAD:contracts/lib/commerce-payments)" >> "$GITHUB_OUTPUT"
      - uses: actions/cache@v4
        id: libcache
        with:
          path: contracts/lib/commerce-payments
          key: forge-lib-${{ steps.lib.outputs.sha }}
      - if: steps.libcache.outputs.cache-hit != 'true'
        run: git submodule update --init --recursive contracts/lib/commerce-payments
      - uses: foundry-rs/foundry-toolchain@v1
        with:
          version: v1.0.0
      - uses: actions/cache@v4
        with:
          path: |
            contracts/out
            contracts/cache
          key: forge-out-${{ hashFiles('contracts/foundry.toml', 'contracts/remappings.txt', 'contracts/src/**', 'contracts/test/**', 'contracts/script/**') }}-${{ steps.lib.outputs.sha }}
          restore-keys: forge-out-
      - name: forge test
        if: github.event_name == 'push' || needs.changes.outputs.contracts == 'true'
        working-directory: contracts
        run: forge test
      - name: forge build
        working-directory: contracts
        run: forge build
      # ... pnpm setup, build and the anvil tests as today
```

Notes: forge's own `cache/solidity-files-cache.json` checks content hashes, so a `restore-keys` partial hit recompiles only the changed files. The cached submodule directory carries `.git` gitfiles that point at the superproject's `.git/modules`; `forge` does not care, and `git status` is not used in this job. Expected contracts job after the change (inferred): about 110 to 125 s with `forge test`, about 80 s without it, and the shards become the critical path.

Also worth doing, independent of the cache: the tree is 41 repositories because `commerce-payments` pulls `spend-permissions` (48 MB, with `magicspend` and its own deps) only so that our remapping can reach `openzeppelin-contracts` through it. Our contracts import only `forge-std`, `solady`, `permit2` and OpenZeppelin's `IERC20` (measured from `contracts/remappings.txt` and the import lines). Adding `openzeppelin-contracts` as a direct submodule under `contracts/lib/` and initializing only the four needed nested libraries would make a cold fetch about 6 clones (about 20 s) instead of 41. That is a `contracts/` change and belongs in a task.

### 2.2 Path-filtered jobs, with `check` and `gitleaks` still reporting (docs-only PRs from 5 min to about 1 min; forge and TLC skipped on PRs that do not touch them; saves about 1.5 h a week on top of 2.1; inferred)

**The trap, stated exactly.** The ruleset requires the contexts `check` and `gitleaks` on every PR. A context is reported only when its job runs. Therefore:
- Never add `paths:` or `paths-ignore:` to `on.pull_request` in `ci.yml`: a docs-only PR would then produce no run at all, both required contexts would sit at "Expected, waiting for status", and the PR could never merge.
- Filter at the **job** level with `if:`, keep `gitleaks` unconditional (it costs 6 to 11 s), and make `check` accept `skipped` from the filtered jobs while still failing on `failure` or `cancelled`, and on a failed filter job.
- Push to main is never filtered: every merge still runs the full suite, so safety-relevant suites still run on main for every change. (`formal` is the one exception argued in 2.4.)

**Compute the filter from one source of truth.** Rather than encoding the rules twice (CI and `pnpm verify --affected`), put them in `scripts/ci/affected.mjs`: it takes a list of changed paths and prints booleans. CI feeds it the PR's files from the API (no checkout needed); `verify` feeds it `git diff --name-only`. `dorny/paths-filter@v3` is the drop-in alternative if a script feels heavy; it needs `pull-requests: read`.

```yaml
permissions:
  contents: read
  pull-requests: read

concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      code: ${{ steps.f.outputs.code }}
      contracts: ${{ steps.f.outputs.contracts }}
      anvil: ${{ steps.f.outputs.anvil }}
      formal: ${{ steps.f.outputs.formal }}
      docs: ${{ steps.f.outputs.docs }}
      site: ${{ steps.f.outputs.site }}
    steps:
      - uses: actions/checkout@v4
      - id: f
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          if [ "${{ github.event_name }}" = pull_request ]; then
            gh api "repos/${{ github.repository }}/pulls/${{ github.event.pull_request.number }}/files" --paginate --jq '.[].filename' > changed.txt
          else
            echo ALL > changed.txt     # push to main: everything runs
          fi
          node scripts/ci/affected.mjs changed.txt >> "$GITHUB_OUTPUT"

  static:
    needs: changes
    if: needs.changes.outputs.code == 'true'
    # ... unchanged steps

  test:
    needs: changes
    if: needs.changes.outputs.code == 'true'
    # ... unchanged matrix

  contracts:
    needs: changes
    if: needs.changes.outputs.contracts == 'true' || needs.changes.outputs.anvil == 'true'
    # ... 2.1's steps; `forge test` itself gated on outputs.contracts

  formal:
    needs: changes
    if: needs.changes.outputs.formal == 'true'
    # ... unchanged

  docs:
    name: docs (design map, plan, api)
    needs: changes
    if: needs.changes.outputs.docs == 'true' && needs.changes.outputs.code != 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm vitest run tests/design-map.test.ts
      - run: pnpm map

  site:
    needs: changes
    if: needs.changes.outputs.site == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc }
      - run: node site/build.mjs && node site/check.mjs

  check:
    needs: [changes, static, test, contracts, formal, docs, site]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: every job passed or was skipped by the path filter
        env:
          NEEDS: ${{ toJSON(needs) }}
        run: |
          echo "$NEEDS" | jq -r 'to_entries[] | "\(.key)=\(.value.result)"'
          test "$(echo "$NEEDS" | jq -r .changes.result)" = success
          echo "$NEEDS" | jq -e '[to_entries[] | select(.key != "changes") | .value.result] | all(. == "success" or . == "skipped")' > /dev/null

  gitleaks:
    # unchanged, unconditional: it is a required context of its own
```

`scripts/ci/affected.mjs` (outline, about 40 lines): `ALL` sets every output true. Otherwise `docs` = `docs/**`, `scripts/design-map.mjs`, `tools/design-map/**`; `site` = `site/**`, `apps/site/**`, `docs/api.md`, `examples/verify.ts`, `packages/core/src/crypto/**`; `contracts` = `contracts/**`, `.gitmodules`, `.github/workflows/ci.yml`; `anvil` = `contracts`'s set plus `packages/settlement/**`, `packages/testkit/**`, `packages/core/**`, `fixtures/**`; `formal` = `formal/**`, `.github/workflows/ci.yml`; `code` = any path **not** under `docs/`, `brand/`, `reports/`, `site/`, `apps/site/`, `.claude/`, `.github/CODEOWNERS`, `.github/pull_request_template.md`, `.gitleaksignore`, or a root `*.md`. Deny-listing `code` is the safe direction: a new directory counts as code until someone says otherwise. Why `docs` runs the design-map test: PR 75 proved that `docs/plan.md` can fail a test.

Why `skipped` is safe in `check`: with `changes` asserted `success`, a `skipped` result can only come from a job's own `if:`, never from a failed upstream. `cancel-in-progress` only cancels superseded runs of the same PR (PR 77 had two runs, PR 79 two, the T-203 PR four; measured), and the new run reports fresh contexts.

### 2.3 Fix the gas-per-deal stall at its root, and stop using 5 s as a correctness bound (saves about 1.5 h a week; inferred from 2 stalls in 24 PR runs today, each costing a re-run cycle plus detection latency)

**Diagnosis (inferred, to verify).** A healthy run of the test is 10.5 s; a bad run is still not done at 180 s. `EvmSettlement.send()` and `deploy()` wait with viem's `waitForTransactionReceipt` on a `publicClient` created with `cacheTime: 0` and the default `pollingInterval` (4 s). Viem checks the receipt once at the start and then only when `watchBlockNumber` reports a **new** block number. Anvil here runs in automine with no block time, so if that first check races the mining of the transaction (receipt not yet retrievable), no new block will ever arrive to trigger a re-check until another transaction lands, and the wait sleeps until viem's own 180 s timeout, which is the same number as the test's. The 17x stall-not-slowdown signature fits. Raising the test timeout to 420 s (PR 84) does not change this; it only reports later.

**Fix (in `packages/settlement/evm/world.ts` and `evm-settlement.ts`, so a settlement task):**
- Replace the receipt wait with a direct poll: `getTransactionReceipt` every 50 ms until present, 10 s cap, error with the hash and `anvil_getAutomine` on expiry. With automine the receipt is there within milliseconds.
- Or, lighter: `createPublicClient({ ..., pollingInterval: 100 })` and `waitForTransactionReceipt({ hash, pollingInterval: 100, timeout: 10_000 })`, plus a log line when a wait exceeds 2 s. Confirm the diagnosis by reading that log on the next CI run before closing the backlog row.
- Split `measure(world)` into one `it` per path (10 rows, each with a 60 s cap) so a stall names its path and fails in a minute, then drop the 420 s.

**The other two flakes** are 1.9 s and 1.8 s alone (measured today) against the default 5 s, and only fail under a parallel `forge` compile. Timeouts are hang detectors, not assertions (the Rules-and-checks table already says tests must not assert on wall-clock time), so set them globally in `vitest.config.ts`:

```ts
test: {
  testTimeout: 30_000,
  hookTimeout: 60_000,
  // ...
}
```

Add a "Known flakes" list to `docs/testing.md` (used by `/merge-pr` 1.1), and remove entries as their root causes land.

### 2.4 Run TLC only when the model changes (saves 11 min of runner time on every merge to main and 30 s on every PR; coordinator time only when a deploy waits for main to be green; inferred)

TLC's result is a pure function of `formal/**`, the pinned `tla2tools.jar` and the JRE. Re-running the seven liveness configs for 684 s on a docs merge proves nothing new. Gate `formal` on `needs.changes.outputs.formal` for PRs **and** pushes (the one place the full-on-main rule is relaxed, because the inputs did not change), keep safety plus `broken/` on PRs and the liveness set on push, and add a weekly `schedule` run of the full set to catch tool drift. `check` accepts `skipped` (2.2), so main stays green.

### 2.5 `pnpm verify --affected` (saves about 1 h a week; inferred from 10 tasks x 2 to 3 verifies x about 1.5 min of forge, plus the parallel-verify flakes it avoids)

`scripts/verify.ts` runs nine steps unconditionally. Add a `--affected` mode (default stays full):

```ts
// scripts/verify.ts (outline)
const base = git(['merge-base', 'HEAD', 'origin/main']);
const changed = new Set([...git(['diff', '--name-only', base]).split('\n'), ...git(['diff', '--name-only']).split('\n'), ...git(['ls-files', '--others', '--exclude-standard']).split('\n')].filter(Boolean));
const affected = computeAffected(changed); // the same scripts/ci/affected.mjs as CI
const steps: Step[] = [
  { name: 'typecheck', command: ['pnpm', 'typecheck'] },                       // always
  { name: 'lint', command: ['pnpm', 'lint'] },                                 // always
  { name: 'forge build', command: ['forge', 'build', '--root', 'contracts'], when: affected.contracts || affected.anvil },
  { name: 'forge', command: ['forge', 'test', '--root', 'contracts'], when: affected.contracts },
  { name: 'test', command: affectedMode ? ['pnpm', 'vitest', 'run', '--changed', base] : ['pnpm', 'test'] },
  { name: 'spec', command: ['pnpm', 'validate:spec'] },                        // always, 0.4 s
  { name: 'snap', command: ['pnpm', 'snap'], when: affected.code },
  { name: 'snap:local', command: ['pnpm', 'snap', '--settlement=local'], when: affected.anvil },
  { name: 'demo', command: ['pnpm', 'demo'], when: affected.code },
];
```

Skipped steps are listed in the report header as `skipped (affected mode: <reason>)`, never as pass, and the PR's Verification section must say which mode produced the evidence. Run the full `pnpm verify` once before opening the PR; CI runs everything that matters anyway.

`vitest run --changed <base>` follows the import graph, so it misses tests that read files at run time (fixtures, `spec/`, `docs/plan.md`, `config/`, `prompts/`). Add to `vitest.config.ts`:

```ts
forceRerunTriggers: ['fixtures/**', 'spec/**', 'config/**', 'prompts/**', 'docs/plan.md', 'docs/api.md', 'docs/tasks/**'],
```

so a change to any of those runs the whole suite. Also move `test` before the forge steps in the full mode (the backlog's suggestion), which keeps vitest off a machine that is compiling with via-IR.

### 2.6 Shards: leave the count, cache the build (saves 10 to 17 s per shard job, about 40 s off each PR's critical path once 2.1 lands; inferred, needs a measurement)

Each of the five Node jobs spends 10 to 17 s in `pnpm build`. Caching `**/dist` and `**/*.tsbuildinfo` with `actions/cache` keyed on `hashFiles('**/*.ts', '**/tsconfig*.json', 'pnpm-lock.yaml')` (excluding `node_modules`) should let `tsc -b` skip unchanged projects, but whether TypeScript 6.0's build mode honors a restored `.tsbuildinfo` after a fresh checkout changes every timestamp needs a measured run before adopting it. A fifth shard is not worth it: the shards are no longer the long pole after 2.1, and the fixed cost per job (about 30 s) dominates.

### 2.7 Fuzz and invariant budgets (no change recommended now)

`forge test` is 40 s of tests after a 118 s compile. The eight invariants at 256 runs x depth 100 are inside that 40 s. A `pr` Foundry profile with lower runs would save about 20 s per PR for less coverage; after 2.1 and 2.2 it is not on the critical path, so keep the full budget.

### 2.8 Coverage gap, not speed: a `site` job

`node site/build.mjs && node site/check.mjs` is listed in `CLAUDE.md` and run before deploys, but not in CI, while 11 of yesterday's direct pushes were `site:` changes (measured). The `site` job in 2.2 costs about 25 s and only runs when `site/**`, `docs/api.md` or the envelope vectors change.

### 2.9 Derive "done" from merges instead of flipping it by hand

Since main takes PRs only, each `docs(tasks): T-xxx done` commit now needs a PR and a CI run. Cheaper: let `scripts/design-map.mjs` treat a task whose Status is `review` as `done (PR n)` when a first-parent merge commit's body names the task (the work feed already parses those commits), and flip the file's Status in the daily log PR for the record. The map is current the moment a PR merges, and no one waits on a status commit.

### 2.10 Watch items on the ruleset and settings (Rafa's gates)

- `require_extra_approval_for_unattributed_changes: true` with 0 required approvals: if `gh pr merge` ever reports that unattributed commits need an approval, the fix is to link the committing email to the GitHub account or to turn that option off; `/merge-pr` should report it, not retry.
- `allow_auto_merge` off: once on, `gh pr merge --auto --merge` after the review removes the wait from the coordinator's loop entirely (1.1).
- `delete_branch_on_merge` off: 61 remote branches today; turning it on replaces `--delete-branch`.
- `gitleaks` is required by the ruleset but not in `check`'s `needs`; that is fine as long as the ruleset keeps both contexts. If the ruleset is ever reduced to `check` alone, add `gitleaks` to `needs` first.

---

## Do first

| # | Item | Expected saving per week | Basis |
| --- | --- | --- | --- |
| 1 | 2.1 cache the submodule tree and the forge build in the `contracts` job | about 4 min per PR; 5 h of CI wall time, roughly 2.5 h of coordinator waiting | measured step times, inferred saving |
| 2 | 2.2 job-level path filter with `check` accepting `skipped` and `gitleaks` unconditional; `concurrency` cancel; `docs` and `site` jobs; 2.4 TLC only on `formal/**` | docs PRs 5 min to 1 min; forge and TLC skipped when untouched; about 1.5 h | inferred |
| 3 | 2.3 root-cause the receipt wait, split the gas test by path, `testTimeout: 30_000` | about 1.5 h (6 re-run cycles avoided) and no more 7-minute stalls | measured flake rate, inferred saving |
| 4 | 1.1 `/merge-pr` with background `gh pr checks --watch` or the app's PR status, one flaky retry, cleanup, map; 2.9 map derives done from merges | about 3 h | inferred |
| 5 | 2.5 `pnpm verify --affected` sharing `scripts/ci/affected.mjs` with CI, plus 1.2 `/start-task` | about 1.75 h | inferred and guessed |

Together about 8 to 10 hours a week at the current pace (inferred; the pace itself is the least certain input). Items 1 to 3 are confined to the repository and pre-approved under the autonomy rule; items 4 and 5 are commands and scripts, also in-repo. The repo-settings items in 2.10 (auto-merge, delete-branch-on-merge, the unattributed-changes option) are the only ones that wait for Rafa.

## Next steps

1. Open an infra task for 2.1 and 2.2 together (one `ci.yml` change, one `scripts/ci/affected.mjs`), with before and after run timings in its Evidence.
2. Open a settlement task for 2.3's receipt wait and the per-path gas rows; record the diagnosis as confirmed or refuted from the first CI run's log.
3. Add `.claude/commands/merge-pr.md`, `start-task.md`, `deploy-demo.md`, `deploy-site.md`, `review-pr.md`, `record-decision.md`, `daily-log.md` and `scripts/brief.mjs`, `scripts/task-done.mjs`, `scripts/decision.mjs`, `scripts/log-skeleton.mjs`; align `task.md` and `docs/team.md` on the Agent-tool worktree.
4. Ask Rafa for `allow_auto_merge` and `delete_branch_on_merge`.
