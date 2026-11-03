# T-055: The daily cost routine and how an alert reaches Rafa

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-052, T-053, T-054
- **Paths this task may touch:** `scripts/costs/daily.mjs` (new), `config/costs.launchd.plist.template` (new), `tests/costs/daily.test.ts` (new), `package.json` (a `costs:daily` script), `.github/CODEOWNERS` (one line for `scripts/costs/`), `docs/costs.md` (a "Running it" section and the `cost-signals.json` shape), `docs/operations.md` (the Costs pointer), `docs/tasks/T-055-cost-daily-routine.md`
- **Human gate:** **yes.** Rafa chooses where the routine runs and installs it on his machine, approves each change to the cost scripts before it runs with his keys, and chooses the channel that carries an alert to him. A message sent to him is outward-facing.
- **Status:** todo
- **Agent/session:** —

## Intent

Run the collector, the report and the rules once a day without anyone remembering to, keep the billing credentials outside every agent session, run only code Rafa approved with them, and tell Rafa when a rule fires or a run fails.

- Inputs: T-052's collector and dedicated clone, T-053's report, T-054's rules.
- Outputs: one command, `node --env-file=.env.costs scripts/costs/daily.mjs`, scheduled in the dedicated clone; alerts at the top of the day's file; one message on Rafa's chosen channel when a rule fires or a run fails; `cost-signals.json` in `CROW_TELEMETRY_DIR`, holding the date, each source's status and the names of the rules that fired, never a figure.
- Non-goals: a dashboard, publishing any figure, the agent-ops phase's alarms (T-047).

## Context

- `docs/costs.md`, "Where credentials and figures live" and "What this feeds".
- CLAUDE.md, autonomy rule: agents may merge to `main` after CI and review without Rafa. So fast-forwarding to `main` alone does not mean Rafa saw the code that runs with the Admin key.
- T-044 (the agent-ops phase) proposes CODEOWNERS and risk tiers; this task adds one line for `scripts/costs/`.

## Where it runs

| Option | Tradeoffs |
| --- | --- |
| **A. Rafa's Mac, with launchd (recommended)** | The billing keys never leave the laptop. Runs only when the Mac is awake; launchd runs a missed calendar job at the next wake (inferred, to check). No model tokens: it is a Node script |
| B. An always-on machine Rafa controls, under a user no agent session uses | Runs every day. The billing keys, including the full-access Anthropic Admin key, live on that machine, so it must not be T-039's agent VM user |
| C. A scheduled task in the Claude desktop app | Refused. It runs inside an agent session, where billing keys must not be, and spends model tokens to run a script that needs none |
| D. GitHub Actions or a Cloudflare Worker cron | Refused. Actions logs and artifacts are public on this repository; a Worker would hold billing keys in a deployed service |

## Rafa's steps

Every step is **human**. About 30 minutes (guessed).

1. Choose where it runs (the table above) and write the choice in Handoff.
2. Check that `.env.costs` exists only in the dedicated clone (T-052, step 6). If you made it anywhere else, move it rather than copy it.
3. Choose the alert channel: a desktop notification, an email to yourself, or a chat message through a bot you already use. Write it in Handoff, and put any token it needs in `.env.costs`.
4. Approve the code as in T-052 (step 7): read what changed in `scripts/costs/`, `config/costs.template.json` and `config/model-prices.json` since your last approval, then run `node --env-file=.env.costs scripts/costs/approve.mjs`. Repeat whenever the routine says the code changed.
5. Install the schedule. For option A: copy `config/costs.launchd.plist.template` to `/Users/<you>/Library/LaunchAgents/`, fill in the clone's full path and the full path of `node` (launchd's `PATH` does not include it, inferred), and run the `launchctl` command the template's header gives.
6. After a week, confirm the test alert (agent step 4) reached you. From then on, a week without the "still running" message means the job did not start: check the plist and the `node` path.
7. Optional: require code-owner review in the `main` ruleset, so the CODEOWNERS line in agent step 5 binds. That is a repository setting, so it is yours.

## Agent steps

1. **`daily.mjs`**, importing only `node:` modules (T-052):
   1. Fast-forward the clone to `origin/main` (`git pull --ff-only`), running `git` with an environment stripped of every variable from `.env.costs`, so no git hook can see a billing key.
   2. Run T-052's approval check (`approved.mjs`), which refuses when the cost scripts or their config differ from the commit in `.costs-approved`, and says which files changed.
   3. Collect, report, rules.
   4. Write the alerts first in the day's file; record each run's start, end, outcome and sources read in `runs.jsonl` in the cost directory.
2. **Messages.** One message a day when any rule fired: the rule names and where to read the details, never a figure unless the channel is marked private to Rafa. One message for any run that fails or refuses, naming the step (fast-forward, approval, collect, report, rules), with no figure. One short "still running" message on the first run of each week, with how many of the last 7 days ran, so a job that never starts is noticed by its silence. A missed day shows in the next run's file.
3. **`cost-signals.json`**: write it each run to `CROW_TELEMETRY_DIR`, and document its shape in `docs/costs.md`: the date, each source's status, the names of the rules that fired. No figure.
4. **A test alert**: a `--test-alert` flag sends one message saying it is a test, so Rafa can check the channel without a threshold change.
5. **CODEOWNERS**: add `/scripts/costs/ @rafaeldavid`, beside the existing human-gate lines.
6. **The launchd template**, with the schedule, the working directory, the absolute `node` path as a placeholder, `node --env-file=.env.costs scripts/costs/daily.mjs`, and logs in the cost directory.

## Acceptance criteria

- [ ] `pnpm vitest run tests/costs/daily.test.ts` passes: the order fast-forward, approval check, collect, report, rules; one message on a day with a fired rule and none on a quiet day (a fake channel); one message naming the step when the fast-forward fails, when the approval check refuses, and when a step throws; the "still running" message on the week's first run, with the count of days run; `git` started with no variable from `.env.costs` in its environment; a missed day shown in the next run.
- [ ] A test shows a message holds rule names only, unless the channel is marked private, and that `cost-signals.json` holds no amount.
- [ ] Seven daily files exist on Rafa's machine after a week (measured: a count, no figures).
- [ ] The test alert reached Rafa on his channel (human, recorded in Evidence).
- [ ] `docs/costs.md` documents `cost-signals.json`, and `.github/CODEOWNERS` names `scripts/costs/`.

## Out of scope

- A dashboard or status page; publishing figures (D39); automatic stops; editing the agent-ops phase's task files; the ruleset change in Rafa's step 7.

## Evidence

## Decisions

## Handoff

- For the agent-ops phase (outside this task's paths): T-042 can name `cost-signals.json` in `CROW_TELEMETRY_DIR` as a source of spend signals, and T-047 should record that its spend figure comes from the pipeline's own token tallies, not from this routine.
