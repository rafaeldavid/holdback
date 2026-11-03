# T-055: The daily cost routine and how an alert reaches Rafa

- **Lane:** infra
- **Phase:** 10
- **Depends on:** T-052, T-053, T-054
- **Paths this task may touch:** `scripts/costs/daily.mjs` (new), `config/costs.launchd.plist.template` (new), `tests/costs/daily.test.ts` (new), `package.json` (a `costs:daily` script), `docs/costs.md` (a "Running it" section and the `latest.json` shape), `docs/operations.md` (a pointer to `docs/costs.md`), `docs/tasks/T-055-cost-daily-routine.md`
- **Human gate:** **yes.** Rafa chooses where the routine runs and installs it on his machine, and chooses the channel that carries an alert to him. A message sent to him is outward-facing.
- **Status:** todo
- **Agent/session:** —

## Intent

Run the collector, the report and the rules once a day without anyone remembering to, keep the billing credentials on Rafa's machine, and interrupt him only when a rule fires.

- Inputs: T-052's collector, T-053's report, T-054's rules.
- Outputs: one command, `node --env-file=.env scripts/costs/daily.mjs`, scheduled; alerts at the top of the day's file and, when a rule fires, one message on Rafa's chosen channel; `reports/costs/latest.json` in a documented shape for Phase 9.
- Non-goals: a dashboard, publishing any figure, Phase 9's alarms (T-047).

## Where it runs

| Option | Tradeoffs |
| --- | --- |
| **A. Rafa's Mac, with launchd (recommended)** | The billing keys never leave the laptop. Runs only when the Mac is awake; launchd runs a missed job at the next wake (inferred, to check). No model tokens: it is a Node script |
| B. T-039's deploy environment, with cron | Always on. The billing keys, including the full-access Anthropic Admin key, move to the VM |
| C. A scheduled task in the Claude desktop app | Easy to set up, but each run spends model tokens to run a script that needs none |
| D. GitHub Actions or a Cloudflare Worker cron | Refused. Actions logs and artifacts are public on this repository; a Worker would hold billing keys in a deployed service |

## Rafa's steps

Every step is **human**. About 20 minutes (guessed).

1. Choose where it runs (the table above) and write the choice in Handoff.
2. Choose the alert channel: a desktop notification, an email to yourself, or a chat message through a bot you already use. Write it in Handoff, and put any token it needs in `.env`.
3. Install the schedule. For option A: copy `config/costs.launchd.plist.template` to `~/Library/LaunchAgents/`, fill in the repository path, and run the `launchctl` command the template's header gives.
4. After a week, confirm the alert test (agent step 3) reached you.

## Agent steps

1. **`daily.mjs`**: collect, then report, then rules. It writes the alerts first in the day's file, sends one message per day when any rule fired (the list of rule names and where to read the details, never a figure if the channel is not private to Rafa), and records each run's start, end and sources read in `reports/costs/runs.jsonl`. A missed day shows in the next run's file.
2. **`latest.json`**: document its shape in `docs/costs.md`: the date, the sources and their status, the rules that fired with their names. T-042 (signals) and T-047 (daily figures) read it.
3. **An alert test**: a `--test-alert` flag sends one message saying it is a test, so Rafa can check the channel without a threshold change.
4. **The launchd template**, with the schedule, the working directory, `node --env-file=.env scripts/costs/daily.mjs`, and logs under `reports/costs/`.

## Acceptance criteria

- [ ] `pnpm vitest run tests/costs/daily.test.ts` passes: the order collect, report, rules; one message on a day with a fired rule and none on a quiet day (a fake channel); a missed day shown in the next run.
- [ ] A test shows the message holds rule names only when the channel is not marked private.
- [ ] Seven daily files exist on Rafa's machine after a week (measured: a count, no figures).
- [ ] The test alert reached Rafa on his channel (human, recorded in Evidence).
- [ ] `docs/costs.md` documents `latest.json`, and T-042 and T-047 point to it (an edit to those task files if they are on main).

## Out of scope

- A dashboard or status page; publishing figures (D39); automatic stops.

## Evidence

## Decisions

## Handoff
