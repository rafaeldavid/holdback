# T-412: The benchmark harness (roadmap B1)

- **Lane:** test (agent access)
- **Phase:** 2 (roadmap stage 1, "Outsiders can use it", its third bar: "each run records success, approvals, tokens, time, API calls, errors and doc gaps")
- **Depends on:** T-066 and T-370 (the One-Click harness, `tools/one-click/run.mjs`), T-328 (the outsider runner, `tools/one-click/outsider.mjs`), T-222 and T-239 (Crow's test seller and test buyer)
- **Paths this task may touch:** `tools/one-click/`, `scripts/metrics/one-click*`, `scripts/metrics/schemas/one-click*`, `tests/metrics/one-click*`, this file. Two shared lines outside them, named under Decisions: `scripts/metrics/schemas/common.schema.json` (the envelope's version pattern) and `tests/metrics/schemas.test.ts` (the list of schema names).
- **Human gate:** yes for the live runs only. They spend Rafa's model key and Sepolia test funds, so Rafa starts them (Handoff). Scripted runs need no key and no network.
- **Status:** in progress
- **Agent/session:** T-412 side session of the 2026-11-14 wave, worktree `.worktrees/holdback-T-412`, branch `t-412-benchmark-harness`
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
| s5 | The seller misses its deadline; the buyer reclaims | Reclaimed (Refunded by reclaim) | test seller | blocked: the test seller has no silent outcome that never delivers (N70) |
| s6 | A robot's data log checked against an agreed format | Released | test buyer | runs |

## What the stage's bar still lacks after this task

- **Live records.** No live record exists until Rafa runs the commands in the Handoff, so the four headline numbers read "missing".
- **s2 and s5 against the test seller** wait on N70 (a rubric item, and a silent outcome with a short delivery window).
- **The console** reads `one-click/1` run files only. Reading the summary file is a `control/` change (T-414's lane, or the coordinator's).
- **Doc gaps** in a live run come from the agent's own words (a "GUESS:" line the prompt asks for) plus the harness's stall signals; reading the digest is still how the findings are written.

## Acceptance criteria

- [ ] `node tools/one-click/bench.mjs --scenario <id>` writes one record per run, `crow.metrics.one-click/2`, with success, approvals, tokens in and out by model, cost in micro-USD from `config/model-prices.json`, wall time and time without the user, API calls, errors and doc gaps; `node scripts/metrics/check.mjs one-click <file>` accepts it, and still accepts every `/1` file.
- [ ] Scripted mode needs no key and no network beyond the in-process world. Each of the six scenarios has a scripted run that writes a valid record; s1, s3, s4 and s6 complete, s2 and s5 record the block and what is missing. A test fails when a runnable scenario stops completing.
- [ ] Live mode reads `HOLDBACK_AGENT_ANTHROPIC_API_KEY`, refuses to start without it, never prints it, and scrubs it from everything it writes. A test shows the refusal and that the key never reaches the record.
- [ ] `node scripts/metrics/one-click-summary.mjs` writes the headline metrics (approvals per deal, tokens per deal, time without the user, cost per deal) from the records, "missing" where no live record exists, and a scripted record never fills a number.
- [ ] `tools/one-click/README.md` says how to add a scenario, how to rerun one, and what a record means.
- [ ] The Handoff gives Rafa the exact live command for each scenario with a cost estimate and how it was made.

## Evidence

Filled in before review. Each item labelled measured, inferred or guessed.

## Decisions

## Handoff
