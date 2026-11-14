# T-412: The benchmark harness (roadmap B1)

- **Lane:** test (agent access)
- **Phase:** 2 (roadmap stage 1, "Outsiders can use it", its third bar: "each run records success, approvals, tokens, time, API calls, errors and doc gaps")
- **Depends on:** T-066 and T-370 (the One-Click harness, `tools/one-click/run.mjs`), T-328 (the outsider runner, `tools/one-click/outsider.mjs`), T-222 and T-239 (Crow's test seller and test buyer)
- **Paths this task may touch:** `tools/one-click/`, `scripts/metrics/one-click*`, `scripts/metrics/schemas/one-click*`, `tests/metrics/one-click*`, this file. Two shared lines outside them, named under Decisions: `scripts/metrics/schemas/common.schema.json` (the envelope's version pattern) and `tests/metrics/schemas.test.ts` (the list of schema names).
- **Human gate:** yes for the live runs only. They spend Rafa's model key and Sepolia test funds, so Rafa starts them (Handoff). Scripted runs need no key and no network.
- **Status:** done (PR 506, merged 2026-11-14; the six live runs recorded on 2026-11-14, crow-private PR 68)
- **Agent/session:** T-412 side session of the 2026-11-14 wave, worktree `.worktrees/holdback-T-412`, branch `t-412-benchmark-harness`
- **Roadmap row:** B1
- **Change kind:** 4 (tool code with its tests): the metrics tests, `pnpm typecheck`, `pnpm lint`; one `reviewer` pass (the wave's rule 8)

## Intent

The fundraise needs measured numbers for the stage 1 bar, not claims. Restated: one command, `node tools/one-click/bench.mjs --scenario <s1..s6>`, runs one of the six outsider scenarios with a fresh agent and writes one record per run: whether it reached its end state, the approvals a person would give, tokens in and out by model, cost in USD from `config/model-prices.json`, wall time and the time that is not user delay, API calls, errors, and each place the agent had to guess. A scripted mode plays the same six scenarios with no model and no key against the public demo's own world in this process, so CI tests the harness and fails when a scenario stops completing. A live mode drives a fresh Claude Code with the agent key the repository already names, and only Rafa starts it. A summary script turns the records into the four headline numbers the console reads, and writes "missing" until a live record exists: a scripted record never fills a headline number.

Non-goals: running the live scenarios (Rafa's); fixing the scenarios that cannot run (N70, below); changing the console (`control/` is T-414's lane); changing `run.mjs`'s homepage record or `outsider.mjs`.

## What the harness measured before this task (read 2026-11-14 from `origin/main` at `b9e33a9b`)

- **`run.mjs` + `metrics.mjs`** (T-066, T-370) [measured, from the code]: one scenario only, the homepage prompt to a Released deal, `buyer` (the `seller` scenario exits "Not measured yet"). Its record, `crow.metrics.one-click/1`, has approvals by kind and tool, tokens by model, cost at Opus 5.5 prices for every model, wall, model, tool and approval-wait time, Cloudflare counts from `wrangler tail`, and errors. It has no API call count, no doc gaps, no scripted-or-live flag, and no scenario beyond the homepage. It signs in with the Mac's Claude Code login, not a key. `--dry-run` replays a fixed script with fixed tool results, so it proves the record builder, not that any deal completes.
- **`outsider.mjs`** (T-328) [measured, from the code]: scenarios 1, 2, 4 and 5 from `llms.txt`, with approvals, tokens, wall time, HTTP calls by host and status (a curl wrapper and a fetch probe), the commitment's state from the operators, and a digest of the agent's turns to read for doc gaps by hand. Its `record.json` has no schema, no cost, no scripted mode, and no doc gaps as data.
- **`scripts/metrics/check.mjs`** checks every file against `scripts/metrics/schemas/*.schema.json` (Ajv 2020-12, strict). The console (`control/metrics.mjs`) reads only `crow.metrics.one-click/1` run files from `control/metrics/one-click/`.

## The six scenarios and what each needs (stage 1 bar; T-328's task file; roadmap N1a, N1b, N70)

| ID | Scenario | End state | Other party | Scripted run today |
| --- | --- | --- | --- | --- |
| s1 | Buy a small dataset under checks the buyer chooses | Released | test seller | runs |
| s2 | Buy rubric-judged written work | Released | test seller | blocked: the test seller sells no rubric-judged item (N70) |
| s3 | A seller-started deal | Released | test buyer | runs |
| s4 | A delivery that fails the buyer's checks | Refunded | test seller | runs |
| s5 | The seller misses its deadline; the buyer reclaims | Refunded (by the buyer's reclaim) | test seller | blocked: the test seller has no silent outcome that never delivers (N70) |
| s6 | A robot's data log checked against an agreed format | Released | test buyer | runs |

## What the stage's bar still lacks after this task

- **Live records.** No live record exists until Rafa runs the commands in the Handoff, so the four headline numbers read "missing". (Since 2026-11-14 six exist: Evidence.)
- **s2 and s5 against the test seller** wait on N70 (a rubric item, and a silent outcome with a short delivery window).
- **The console** reads `one-click/1` run files only. Reading the summary file is a `control/` change (T-414's lane, or the coordinator's).
- **Doc gaps** in a live run come from the agent's own `GUESS:` lines, which the goal asks for. Writing each friction point up as a finding (the stage's second bar) still means reading the run's raw log (`--logs`).

## Acceptance criteria

- [x] `node tools/one-click/bench.mjs --scenario <id>` writes one record per run, `crow.metrics.one-click/2`, with success, approvals, tokens in and out by model, cost in micro-USD from `config/model-prices.json`, wall time and time without the user, API calls, errors and doc gaps; `node scripts/metrics/check.mjs one-click <file>` accepts it, and still accepts every `/1` file.
- [x] Scripted mode needs no key and no network beyond the in-process world. Each of the six scenarios has a scripted run that writes a valid record; s1, s3, s4 and s6 complete, s2 and s5 record the block and what is missing. A test fails when a runnable scenario stops completing.
- [x] Live mode reads `HOLDBACK_AGENT_ANTHROPIC_API_KEY`, refuses to start without it, never prints it, and scrubs it from everything it writes. A test shows the refusal and that the key never reaches the record.
- [x] `node scripts/metrics/one-click-summary.mjs` writes the headline metrics (approvals per deal, tokens per deal, time without the user, cost per deal) from the records, "missing" where no live record exists, and a scripted record never fills a number.
- [x] `tools/one-click/README.md` says how to add a scenario, how to rerun one, and what a record means.
- [x] The Handoff gives Rafa the exact live command for each scenario with a cost estimate and how it was made.

## Evidence

All measured on 2026-11-14 in the worktree, on Node 22.22.2, unless labelled otherwise.

- **Scripted runs** [measured]: `node tools/one-click/bench.mjs --scenario all` wrote six valid records in 11.0 s of wall time and exited 0.

  | Scenario | State | Wall time | API calls |
  | --- | --- | --- | --- |
  | s1 | Released | 2,344 ms | 36 |
  | s2 | blocked (N70) | 0 ms | 0 |
  | s3 | Released | 3,103 ms | 31 |
  | s4 | Refunded | 2,640 ms | 31 |
  | s5 | blocked (N70) | 0 ms | 0 |
  | s6 | Released | 1,047 ms | 31 |

- **The tests**: `pnpm exec vitest run tests/metrics`: 9 files, 135 tests passed in 9.45 s [measured]. `one-click-bench.test.ts` runs all six scenarios scripted, checks each record against the schema and each end state, tests the live mode's key refusal (no key, an empty key), checks that a sentinel key never appears in output on three refusal paths or in a scrubbed record, and checks the record's arithmetic by hand. `one-click-summary.test.ts` checks the medians, the "missing" values and that scripted and failed runs fill no number.
- **The test bites** [measured]: with the test seller's good delivery cut to 1 row in `apps/test-agents/src/catalog.ts` (a local change, reverted at once and not committed), 3 tests failed: the exit code, s1 and s3. The other 22 passed.
- **Version 1 unchanged** [measured]: the old schema body, read with `git show origin/main:…`, equals `$defs.V1` and `$defs.Tokens` of the new file, compared as JSON. The 107 metrics tests that existed before this task pass unchanged.
- **The summary on scripted records** [measured]: `node scripts/metrics/one-click-summary.mjs --runs <the scripted folder> --out …` wrote a valid file with all four headline numbers `"state": "missing"`, value null, and the gap "No live record yet".
- **Checks** [measured]: `pnpm typecheck` passes; `pnpm exec eslint tools/one-click scripts/metrics tests/metrics` exits 0. The two scripted agents type-check (`tsc` with the repository's base config: exit 0). `node --check` passes on `bench.mjs` and `bench-live.mjs`.
- **Review** (one `reviewer` pass): ISSUES, 2 High, 4 Medium, 6 Low. The first High (an empty Handoff) read the tree before the Handoff commit. Fixed in the review commit, each with a test:
  - High: in live mode a file tool could read the home folder (`.zsh_history`, a Grep over `~`). File tools now stay inside the run's two folders, and the sandbox's read denials add the shell history and rc files, `.local` and `.cache`.
  - Medium: more environment reads denied (`env >`, `os.getenv`, `ps e`); the key source Claude Code reports goes into the record's gaps. The key is trimmed before use.
  - Medium: tokens come from the last result message, not a sum over them (if `modelUsage` is a running total, a sum counts turns twice; which one it is is guessed). The record keeps the SDK's own `total_cost_usd` and flags a difference over 5 percent.
  - Medium: the live commitment is taken only from the agent's own API calls, never from an ID that appears in text.
  - Low: the schema ties `mode` to `agent.kind` and `world.engine`, and the summary checks all three; a scripted success also needs the operator to report the same end state; a crash is named as a crash; doc gaps come from the agent's own words only; a missing price table and Haiku's long-prompt tier get gap lines; the summary adds uncached input.
  - The same file-tool gap exists in `run.mjs` and `outsider.mjs` (Handoff, follow-ups).
  - After the fixes [measured]: `pnpm exec vitest run tests/metrics`: 9 files, 151 tests passed; eslint exit 0; `pnpm typecheck` passes.
- **Not run at merge** [measured]: no live run before PR 506 merged. The live runs followed the same day (next item).
- **The six live runs** [measured]: Rafa ran them on 2026-11-14 from 13:22 to 14:40 UTC, from `main` at 40eb155, with a spend-capped key, Claude Code 2.1.318 with Opus 5.5 at effort medium, on Sepolia. Every record passed `bench: record valid`, and every scenario reached its end state. s2 and s5 ran against the test seller, so N70's rubric item and silent outcome were live by then.

  | Scenario | End state | Approvals (by tool) | Tokens in / out | Cost (USD) | Wall time | API calls |
  | --- | --- | --- | --- | --- | --- | --- |
  | s1 | Released | 20 (Bash 14, Write 6) | 1,073,841 / 21,256 | 1.06 | 256,695 ms | 41 |
  | s2 | Released | 25 (Bash 20, Write 4, one question card) | 1,893,443 / 24,562 | 1.29 | 324,562 ms | 59 |
  | s3 | Released | 11 (Bash 10, Write 1) | 564,014 / 15,914 | 0.73 | 195,481 ms | 66 |
  | s4 | Refunded | 8 (Bash 8) | 350,264 / 3,681 | 0.30 | 98,374 ms | 141 |
  | s5 | Refunded, by the buyer's reclaim | 28 (Bash 26, Monitor 1, one chat reply) | 3,552,708 / 28,318 | 1.83 | 886,145 ms | 141 |
  | s6 | Released | 10 (Bash 9, Write 1) | 665,021 / 15,569 | 0.73 | 200,797 ms | 53 |
  | All six | | 102 | | 5.94 | | |

  - **The four headline numbers** (nearest-rank medians of the 6 completed live deals): approvals 11 per deal (target 1), tokens 680,590 per deal, time without the user 200,787 ms, cost 733,922 micro-USD. `node scripts/metrics/one-click-summary.mjs --runs <the live folder>` and Crow Control's own reader (a local build with `--metrics-from control/metrics`) give the same four values.
  - **s5's reclaim** [measured, from its log]: the seller missed `deliverBy` (14:34:05 UTC); the first reclaim at 14:34:07 got `409 TooEarly` on both operators, and the retry at 14:34:24 refunded the 26 tUSDC hold. It took 886 s because the agent waited out the delivery window. Two copies of its script followed the deal; the reclaim is idempotent, so the refund happened once.
  - **Where the approvals go** [measured, each `permission_request` in the six logs paired with the agent's tool call]: the logs hold 103 permission requests (the records count 100 tool prompts, 1 question card and 1 chat reply; the 3-request difference in s2 and s5 is not explained yet). Of the 103, 47 read the docs (`curl` of `llms.txt` and the `ref/` files, then `cat` or `sed` over them), 26 ran the agent's own deal scripts or one API call, 14 were Write calls for those scripts, 6 were `npm install` of `viem` and `tweetnacl`, 9 were s5's extra workspace steps (heredoc script writes, `sed -i` patches, a Monitor, `ls`), and 1 was s2's question card when the test seller counter-offered its own rubric. The first `llms.txt` fetch asked twice in 5 of the 6 runs. Every tool prompt came from the default permission mode.
  - **Doc gaps**: 18 `GUESS:` lines across the six records (s4 none). The repeated ones: what `from` holds in a `crow-request`, where `"offer"` goes in a proposal, and what a checks-only deal's rubric looks like in the terms.

## Decisions

- **A version 2 beside version 1, in the same schema file.** `one-click.schema.json` now dispatches on `schema`: `/1` takes the old body unchanged (`$defs.V1`), `/2` the benchmark's record. `run.mjs` keeps writing `/1`, so the console's current card keeps working. The console reads `/1` files only, so a `/2` file in `control/metrics/one-click/` would show there as "unknown version" with a gap line.
- **Two shared lines outside the lane.** No lane of the wave owns them, and the work needs both: `common.schema.json`'s envelope took `/1` only and now takes any version number, `/[1-9][0-9]{0,5}`. Every other schema still pins its own version with `const`, so nothing else changes. `tests/metrics/schemas.test.ts` lists the schema names and gains `one-click-summary`.
- **Scripted runs use the real test agents' code, not a replay.** T-370's `--dry-run` replays fixed tool results, so it cannot notice a scenario that broke. The scripted world runs the code the live operators and test agents run, as `apps/test-agents/src/try.test.ts` does, so a break in the path fails CI. It imports TypeScript that Node's default type stripping refuses (a constructor parameter property in `buyer.ts`), so `bench.mjs` starts itself again with `--experimental-transform-types`.
- **s6 is played against the test buyer.** The test buyer takes any checks-only data offer within its published rules (`buyer-rules.ts`), so a robot fleet's agent can sell a run's data log with the log's format stated as five checks (columns, rows, one reading per joint and time, no empty position, joint names). No new test agent is needed.
- **s5 counts Refunded as success.** A reclaim ends Refunded on chain. The harness does not tell a reclaim from a rejected delivery, so a live s5 record needs its raw log read to confirm the reclaim.
- **Cost uses each model's own price**, not Opus 5.5's for every model as `run.mjs` does, so a Haiku side call costs Haiku's price.
- **Live runs keep the sandbox on by default** (T-328's runs needed it), and the live mode replaces `outsider.mjs` for new runs; `outsider.mjs` stays as it ran.

## Handoff

**Done:** the harness, its scripted runs of all six scenarios in CI, the live mode, the summary script and the README. The six live runs ran on 2026-11-14 (Evidence), and their records are in crow-private `control/metrics/bench/` (crow-private PR 68), where the console's Benchmark panel reads them.

**To rerun the live runs** (Rafa's, as before). Use a dedicated, spend-capped key for them and rotate it after: the agent runs with every request approved, and only plain-sight reads of the environment are denied. Each run spends that key (billed as API usage, not the Claude subscription) and Sepolia test funds from the public faucet; no real money. From `/Users/rafa/Documents/escrow`, on `main` after this merges, with `HOLDBACK_AGENT_ANTHROPIC_API_KEY` set in the shell (or `node --env-file=<his env file>` in place of `node`):

```
cd /Users/rafa/Documents/escrow
pnpm install && pnpm build
npm ci --ignore-scripts --prefix tools/one-click
node tools/one-click/bench.mjs --scenario s1 --live --logs reports/scratch/one-click-bench/logs
node tools/one-click/bench.mjs --scenario s2 --live --logs reports/scratch/one-click-bench/logs
node tools/one-click/bench.mjs --scenario s3 --live --logs reports/scratch/one-click-bench/logs
node tools/one-click/bench.mjs --scenario s4 --live --logs reports/scratch/one-click-bench/logs
node tools/one-click/bench.mjs --scenario s5 --live --logs reports/scratch/one-click-bench/logs
node tools/one-click/bench.mjs --scenario s6 --live --logs reports/scratch/one-click-bench/logs
node scripts/metrics/one-click-summary.mjs --runs reports/scratch/one-click-bench/live --out reports/scratch/one-click-summary.json
```

One at a time: the test seller takes 3 requests per client an hour (`site/llms.txt`), and s1 and s4 both use it.

| Scenario | Estimate (USD, list price, Opus 5.5 at effort medium) | How |
| --- | --- | --- |
| s1 | about 1.41 | measured: T-328's run of the same goal, 2026-11-11, the SDK's `total_cost_usd` |
| s2 | about 1.63 | measured: T-328's run (the agent played both sides) |
| s3 | about 1.0 to 1.6 | guessed: no run yet; the range of T-328's four runs |
| s4 | about 1.12 | measured: T-328's run |
| s5 | about 1.02 | measured: T-328's run (the agent played both sides) |
| s6 | about 1.0 to 1.6 | guessed: as s3 |
| All six | about 7 to 8.5 | the sum |

The estimates assume `llms.txt` is still about the size it was on 2026-11-11 (90 kB): the tokens were almost all cache reads of it (T-328 review, F5) [inferred]. Each run takes about 5 to 7 minutes [measured in T-328]. The runs of 2026-11-14 cost USD 5.94 for all six, below the estimate, and took 98 to 886 s each [measured].

To land new records, follow crow-private `control/README.md`, "The benchmark's headline numbers": copy them to `control/metrics/bench/` by pull request.

**Waits for another lane:**
- **N70** (the test seller): the live seller served s2 and s5 on 2026-11-14, but the scripted world still blocks them. Replace `blockedBy` for s2 and s5 in `tools/one-click/scenarios.mjs` with their scripted agents.

**Follow-ups not built:** the file-tool fence and the shell-history read denials in `run.mjs` and `outsider.mjs`, which have the gap the review found in this harness (for the triage note); Cloudflare request counts (`run.mjs --tail`) in the `/2` record; telling a reclaim from a rejection in a live s5 record; a CI run of the live mode with a capped key (T-068).
