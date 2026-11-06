# T-068: A daily cloud run measures One-Click Escrow, and skips days without code changes

- **Lane:** infra
- **Phase:** 9 (Infrastructure management; Rafa moved the daily measurement there on 2026-11-06)
- **Depends on:** T-066's PR 217, the One-Click harness (draft), merged with its 11 review findings fixed. The `SSH_AUTH_SOCK` leak (finding 1) and the CI sign-in (finding 9) come first; T-066's Handoff lists all 11. Stable EVM operations finish first (D53).
- **Paths this task may touch:** `.github/workflows/one-click-daily.yml` (new; tier 3), `tools/one-click/` (the CI mode and the gate), `tests/metrics/` (their tests), `docs/operations.md` (the job, its environment, forcing a run, rotating the key), `docs/costs.md` (the Anthropic workspace and its cap), `docs/reviews/` (the red team's report), `docs/plan.md` (this row), this file. (In the founders' private repository `rafaeldavid/crow-private`: `control/build-public.mjs`, `control/metrics.mjs`, `control/test/`, `control/README.md`.) Not `spec/`, `apps/`, `contracts/`, `site/`, `agent-ops/`, `pnpm-workspace.yaml` or `pnpm-lock.yaml`.
- **Human gate:** yes, for the capped Anthropic key and the `one-click` environment, for merging the `.github/` workflow (tier 3) and for the first forced run. "Gates for Rafa" lists each one.
- **Status:** todo (deferred until after stable EVM operations, Rafa 2026-11-06)
- **Agent/session:** not started. A docs session wrote this ticket on 2026-11-06 (branch `docs-daily-one-click-task`), from the brief of a build session that stopped before it filed the task.

## Intent

Rafa:
- "can you trigger this once per day with the cloud so it doesn't rely on my computer? But not trigger if a day doesn't have any changes to code?"
- 2026-11-06: "Move daily one-click measurements to infrastructure management phase".
- 2026-11-06 (D53): "Basically any work that isn't about finishing stable EVM operations should be pushed to later phase".

Restated: a cloud job measures the One-Click metric once a day, so the measurement never needs Rafa's Mac. One run of T-066's harness gives three numbers, defined in T-066 (Headline metrics, 1 to 3) and written to one run file:
1. approvals per honest deal: the approvals a fresh Claude Code needs from the homepage prompt to Released (target 1);
2. USD per deal at Opus 5.5 list prices and medium effort;
3. time to Released.

A GitHub Actions workflow in holdback runs the harness each morning before Crow Control's 07:07 Berlin build and uploads the run file as an artifact. The console's build fetches the newest one. On a day when nothing but docs changed since the last measured commit, the job runs no harness, starts no deal and spends nothing.

Inputs: the live homepage prompt, T-066's harness (PR 217) and a capped Anthropic API key. Outputs: one run file on each day with code changes, and the console's One-Click card fed from it.

Non-goals:
- Changing what the metric counts, the run file's shape or the console's card. T-066 owns those.
- The seller scenario, which needs Crow's test buyer (backlog).
- Cloudflare counts per deal. The runner has no Cloudflare login, so cloud runs read "unknown" (Decisions, 3).
- Runs on the Mac, or more than one scheduled run a day.
- Any change to the API, the operators, the site or the contracts.

## Context

Labels: measured, documented, inferred or guessed.

- **The harness** (T-066 slice 1, PR 217, draft) [documented, T-066]. `tools/one-click/run.mjs` drives a fresh Claude Code through the Agent SDK in an empty folder with default permissions. It answers every tool request at once, so the assistant's tools run unattended. It writes a run file in the `crow.metrics.one-click/1` schema, and `node scripts/metrics/check.mjs one-click <file>` checks it.
- **Today's numbers.** T-229 measured 1 approval per deal in both permission modes on 2026-11-05, with Released 79.2 s and 106.2 s after the start [measured, T-229 Evidence]. Before T-229, two runs with 4 approvals each cost USD 0.18 and 0.19 at list price and medium effort [measured, T-066 Evidence].
- **PR 217's findings that bear on a cloud run** [documented, T-066 Handoff]:
  - finding 1: the child process keeps `SSH_AUTH_SOCK`;
  - finding 5: request summaries keep header values and IP addresses;
  - finding 9: the environment filter drops `ANTHROPIC_API_KEY`, so the CI option cannot sign in today.
- **The run file is public.** Any GitHub user with read access to a repository can download its run artifacts, and holdback is public [inferred from GitHub's documentation; measured: `gh repo view` reads `PUBLIC`]. T-066's data rules already keep local paths, IP addresses, keys, header values and model text out of a run file.
- **Crow Control's build** (D52) [documented]. crow-private's `control-hourly` workflow builds at 07:07 and 16:07 Berlin time, which is 06:07 and 15:07 UTC in November. Its `build` job holds only `GH_READ`, a read-only token for public repositories (T-066 Context). Its first job ends a run with nothing new in about 17 s, by comparing a digest of its inputs, holdback main's commit among them [measured, D52].
- **What one run spends** [measured: `apps/test-agents/src/catalog.ts` and T-066 Context]:
  - 1 of the test seller's 10 deals a day and 3 an hour per IP address;
  - 1 of its 20 deals an hour and 100 a day in all;
  - one faucet mint, 130,000 to 240,000 gas;
  - about 1.26 million gas for the deal, from Crow's lanes. Sepolia ETH is free, so the gas costs USD 0.
- **Minutes.** Standard GitHub-hosted runners are free for public repositories [documented, GitHub].
- **A main-only environment has a precedent:** holdback#214 kept its token in a holdback environment limited to `main` (D52, "Earlier choices") [documented].

## Design

From the brief of the build session that stopped on 2026-11-06. The builder confirms or changes each part in Decisions.

**The workflow,** `.github/workflows/one-click-daily.yml` in holdback, a public repository, so its minutes are free:
- Triggers: `schedule`, once a day, and `workflow_dispatch` with a `force` input. No `pull_request`, `pull_request_target` or `workflow_run` trigger, so no fork's code runs in it.
- The schedule: `cron: '23 3 * * *'`, 03:23 UTC. That is 04:23 Berlin time in winter and 05:23 in summer, at least 1 h 44 min before the console's 07:07 build all year, and off the hour, when GitHub delays more runs (D52) [inferred].
- `permissions: {}` at the top; each job asks only for what it needs.
- `concurrency: one-click-daily`, so two runs never overlap.

**Job 1, `gate`:** it skips the day when nothing but docs changed since the last measured commit.
- Permissions: `actions: read` only, to list this workflow's runs.
- The last measured commit is the head commit of the newest run of this workflow on `main` whose `measure` job succeeded.
- It measures when `force` is true, when no measured run exists, when that commit is not in main's history, or when `git diff --name-only <last measured> HEAD` lists any path that is not docs.
- Docs means a path under `docs/`, or a Markdown file outside `site/` (Decisions, 4). Everything under `site/` counts as code, because `llms.txt` and the homepage prompt steer the assistant.
- The rule is a pure function in `tools/one-click/gate.mjs`, tested on recorded path lists.
- A skipped day ends in seconds and starts no deal.

**Job 2, `measure`:** it runs only when the gate says so.
- `runs-on: ubuntu-latest`, `permissions: {}`, `environment: one-click`, `timeout-minutes: 20`.
- Every `uses:` names a full commit SHA, with its version in a comment. `actions/checkout` runs with `persist-credentials: false`.
- It installs `tools/one-click/` with `npm ci --ignore-scripts`, and the root packages with `pnpm install --frozen-lockfile --ignore-scripts`, because the schema check needs Ajv (T-066, finding 11).
- It runs `node tools/one-click/run.mjs --scenario buyer --effort medium --out <dir>` without `--tail`, then `node scripts/metrics/check.mjs one-click <file>`. When the check fails, the job fails and uploads nothing.
- It uploads the run file with `actions/upload-artifact`: name `one-click-run`, `retention-days: 90`, `if-no-files-found: error`. It never uploads the harness's raw logs, which hold the assistant's text.

**The key:**
- An Anthropic API key in its own workspace with a monthly spend cap.
- A secret of the `one-click` environment, whose deployment branches are `main` only, so a workflow on any other branch cannot read it.
- Out of reach of the assistant's tools. The harness approves every tool call, and the assistant's Bash can read its own environment and those of processes run by the same OS user (T-066, Gates item 1).
- A candidate design [inferred; the red team checks it]:
  - the assistant runs as a separate OS user without sudo;
  - the harness keeps the key and forwards the assistant's model calls to the Anthropic API from a loopback port;
  - the assistant's environment holds only that port and a placeholder key.
  The assistant can then spend within the cap and the job's 20 min, but cannot read or send the key.

**The console** (crow-private `control/`):
- Each scheduled build lists holdback's `one-click-run` artifacts with the `GH_READ` token it already holds. It downloads the newest one, and up to the last 10 for metric 1's median (T-066).
- It accepts an artifact only from a run of `.github/workflows/one-click-daily.yml` on holdback's own `main`, started by `schedule` or `workflow_dispatch`, that succeeded. It reads the run's `path`, `event`, `head_branch` and head repository from the API, never trusting the artifact's name alone.
- Each file then passes `control/metrics.mjs`'s hostile-input reader and the one-click schema, as run files do today.
- The newest accepted artifact's ID joins the build's skip digest (D52), so a new run file always triggers a build. If the digest is computed in `.github/workflows/control-hourly.yml`, that line is a crow-private `.github/` change, and Rafa merges it.
- This replaces T-066's push of run files into crow-private (T-066 Decision 1, Gates item 3), so no job gets write access to crow-private (Decisions, 2).

**Review:** a red team pass before Rafa merges the workflow, on three questions:
1. Key isolation: can the auto-approved assistant read or send the key, or reach the job's tokens (`GITHUB_TOKEN`, the artifact upload token, an OIDC token), through its environment, `/proc`, files, the loopback port or the logs?
2. Fork pull requests: can a fork run this workflow, change it before it runs with the secret, or read the environment's secret?
3. Artifact poisoning: can any run other than this workflow's scheduled or dispatched run on `main`, or the assistant during the run, produce a run file the console accepts? Does the reader survive a hostile run file?

**Cost** [guessed]: about USD 0.10 to 0.20 per run at Opus 5.5 list prices and medium effort, only on days with code changes, so roughly USD 2 to 4 a month. The upper bound is T-066's measured USD 0.18 to 0.19 at 4 approvals; T-229's flow needs 1 approval and fewer turns. GitHub's minutes cost nothing. Each run uses 1 of the test seller's 10 deals a day per IP address.

## Acceptance criteria

- [ ] Test first: tests of `tools/one-click/gate.mjs` fail before the gate exists. They cover a docs-only diff (skip), a change under `site/` or `tools/` (measure), no earlier measured run (measure), a last measured commit missing from main's history (measure) and `force` (measure).
- [ ] The harness's CI mode runs the assistant without access to the key. A test shows that the child's environment holds neither the key nor `SSH_AUTH_SOCK`.
- [ ] The workflow matches Design: two triggers only, `permissions: {}` at the top, `gate` with `actions: read` only, `measure` with `permissions: {}` and `environment: one-click`, every action pinned by a full commit SHA, and `persist-credentials: false`.
- [ ] The red team pass on key isolation, fork pull requests and artifact poisoning is done. Its report is in `docs/reviews/`, and its findings are fixed before Rafa merges.
- [ ] The first forced run uploads a run file that passes `scripts/metrics/check.mjs`, with `outcome.state` "Released" and `model.effortApplied` "medium". Evidence records its approvals, `cost.atOpus55.usdMicros` and its time to Released (measured).
- [ ] A scheduled run after a docs-only change skips the `measure` job and starts no deal (measured: the run's jobs, and no new deal for the test seller in the event log).
- [ ] The next console build shows the run's numbers in the One-Click card with the run's date. Its tests refuse an artifact from a fork's run, from another branch, from another workflow, and a run file that fails the schema.
- [ ] `docs/operations.md` describes the job, its environment, how to force a run and how to rotate the key. `docs/costs.md` lists the Anthropic workspace and its cap.
- [ ] `pnpm verify` runs, and its report is read.

## Gates for Rafa

1. **The capped key and the environment.** Rafa creates an Anthropic workspace with a monthly spend cap and one API key in it. In holdback's settings he creates the `one-click` environment, limits its deployment branches to `main`, and stores the key as its secret. No agent sees the key.
2. **Merging the workflow.** `.github/` is tier 3 (`agent-ops/gates.md`), so Rafa merges the PR after the red team's findings are fixed.
3. **The first forced run:** holdback → Actions → the workflow → "Run workflow", with `force`. It spends about USD 0.20 of the cap and one of the test seller's deals.

If the console's skip digest lives in crow-private's workflow file, Rafa also merges that one-line change. If the console's page changes, its crow-console deploy waits for his go-ahead.

## Out of scope

- T-066's harness, metrics and console card, beyond the harness's CI mode and the console's artifact source.
- The seller scenario and Crow's test buyer (backlog).
- Cloudflare counts in cloud runs.
- T-066's discovery fields (PR 216) and its other gates.
- Measuring after each live deploy instead of each code change (Handoff, question 1).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

Proposed by the docs session on 2026-11-06. The builder confirms or changes them, and Rafa can overrule any of them.

1. **Phase 9.** Rafa moved the daily measurement there on 2026-11-06. It is infrastructure work, not stable EVM operations (D53).
2. **Run files travel as artifacts, not as a push to crow-private.** T-066 planned a harness job that commits run files to crow-private (Decision 1, Gates item 3), which needs write access to that repository. An artifact needs none, and the console's build already holds a token that can read holdback. The cost: artifacts expire after 90 days, so the console sees no run older than that.
3. **No `--tail` in the cloud.** `wrangler tail` needs a Cloudflare login, which the runner does not have and should not get. Cloud runs write no Cloudflare counts, so the console's Cloudflare cost reads "unknown" (T-066, Decision 22). A run on the Mac with `--tail` can still add them.
4. **Docs means `docs/` and Markdown outside `site/`.** Those paths do not change what a fresh assistant sees. `site/` does, through `llms.txt`, the homepage prompt and `try.mjs`, so a change there triggers a run.
5. **A UTC schedule.** D52's console schedule uses GitHub's `timezone` key, and no scheduled console build had run under it by 2026-11-06 06:31 UTC (measured, `docs/log/2026-11-06.md`). A UTC cron at 03:23 does not depend on that key and stays before the 07:07 Berlin build in winter and summer.
6. **The gate reads code on main, not the live deploy.** Rafa asked to skip days without code changes. Code merged but not yet deployed does not change the live metric, so some runs measure an unchanged deployment [inferred]. Handoff question 1 asks whether to follow live deploys instead.

## Handoff

Not started. It starts after stable EVM operations (D53) and after PR 217 merges with its findings fixed.

To resume:
1. Check that PR 217 merged with its 11 findings fixed (T-066 Handoff), and that the live homepage prompt still starts with "Run a test deal with Crow".
2. Ask Rafa for Gates item 1.
3. Work in a worktree on `t-068-daily-one-click`, in this order: the gate and the harness's CI mode, test first; the workflow; the red team pass; Rafa's merge and first forced run; the console's reader in crow-private.

Open questions for Rafa:
1. Should the gate follow live deploys instead of code on main? T-066's discovery fields (PR 216) publish each node's build commit and the site's. With them, the gate could measure only when a live build changed.
2. The monthly cap on the key. About 3 times the expected spend, USD 10 a month, leaves room for retries [guessed].
