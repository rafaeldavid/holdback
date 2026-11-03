# T-055: The daily cost routine and how an alert reaches Rafa

- **Lane:** infra
- **Phase:** 10
- **Depends on:** T-052, T-053, T-054
- **Paths this task may touch:** `scripts/costs/daily.mjs` (new), `config/costs.launchd.plist.template` (new), `tests/costs/daily.test.ts` (new), `package.json` (a `costs:daily` script), `docs/costs.md` (a "Running it" section and the `latest.json` shape), `docs/operations.md` (the Costs pointer), `docs/tasks/T-055-cost-daily-routine.md`
- **Human gate:** **yes.** Rafa chooses where the routine runs and installs it on his machine, and chooses the channel that carries an alert to him. A message sent to him is outward-facing.
- **Status:** todo
- **Agent/session:** —

## Intent

Run the collector, the report and the rules once a day without anyone remembering to, keep the billing credentials outside every agent session, and interrupt Rafa only when a rule fires.

- Inputs: T-052's collector, T-053's report, T-054's rules.
- Outputs: one command, `node --env-file=.env.costs scripts/costs/daily.mjs`, scheduled; alerts at the top of the day's file and, when a rule fires, one message on Rafa's chosen channel; `latest.json` in the cost directory, holding the date, each source's status and the names of the rules that fired, never a figure.
- Non-goals: a dashboard, publishing any figure, Phase 9's alarms (T-047).

## Context

- `docs/costs.md`, "Where credentials and figures live" and "What this feeds".
- T-042 (Phase 9) may read `latest.json`; T-047 does not take spend from it, since its outputs are public.

## Where it runs

| Option | Tradeoffs |
| --- | --- |
| **A. Rafa's Mac, with launchd (recommended)** | The billing keys never leave the laptop. Runs only when the Mac is awake; launchd runs a missed calendar job at the next wake (inferred, to check). No model tokens: it is a Node script |
| B. An always-on machine Rafa controls, under a user no agent session uses | Runs every day. The billing keys, including the full-access Anthropic Admin key, live on that machine, so it must not be T-039's agent VM user |
| C. A scheduled task in the Claude desktop app | Easy to set up, but each run spends model tokens to run a script that needs none, and runs inside an agent session, where billing keys must not be |
| D. GitHub Actions or a Cloudflare Worker cron | Refused. Actions logs and artifacts are public on this repository; a Worker would hold billing keys in a deployed service |

**The routine runs from a dedicated clone** that only fast-forwards to `origin/main` (`git pull --ff-only` before each run), never from a checkout where agents switch branches, so the job only runs reviewed code with the billing keys.

## Rafa's steps

Every step is **human**. About 30 minutes (guessed).

1. Choose where it runs (the table above) and write the choice in Handoff.
2. Make the dedicated clone, outside `~/Documents` if macOS privacy controls block launchd there (inferred), and copy `.env.costs` into it.
3. Choose the alert channel: a desktop notification, an email to yourself, or a chat message through a bot you already use. Write it in Handoff, and put any token it needs in `.env.costs`.
4. Install the schedule. For option A: copy `config/costs.launchd.plist.template` to `~/Library/LaunchAgents/`, fill in the clone's path and the absolute path of `node` (launchd's `PATH` does not include it, inferred), and run the `launchctl` command the template's header gives.
5. After a week, confirm the test alert (agent step 3) reached you.

## Agent steps

1. **`daily.mjs`**: fast-forward the clone, then collect, report and rules. It writes the alerts first in the day's file, sends one message per day when any rule fired (the rule names and where to read the details, never a figure unless the channel is marked private to Rafa), and records each run's start, end and sources read in `runs.jsonl` in the cost directory. A missed day shows in the next run's file.
2. **`latest.json`**: write it each run, and document its shape in `docs/costs.md`: the date, each source's status, the names of the rules that fired. No figure.
3. **A test alert**: a `--test-alert` flag sends one message saying it is a test, so Rafa can check the channel without a threshold change.
4. **The launchd template**, with the schedule, the working directory, the absolute `node` path as a placeholder, `node --env-file=.env.costs scripts/costs/daily.mjs`, and logs in the cost directory.

## Acceptance criteria

- [ ] `pnpm vitest run tests/costs/daily.test.ts` passes: the order fast-forward, collect, report, rules; a refusal to run when the fast-forward fails; one message on a day with a fired rule and none on a quiet day (a fake channel); a missed day shown in the next run.
- [ ] A test shows the message holds rule names only, unless the channel is marked private, and that `latest.json` holds no amount.
- [ ] Seven daily files exist on Rafa's machine after a week (measured: a count, no figures).
- [ ] The test alert reached Rafa on his channel (human, recorded in Evidence).
- [ ] `docs/costs.md` documents `latest.json`.

## Out of scope

- A dashboard or status page; publishing figures (D39); automatic stops; editing Phase 9's task files.

## Evidence

## Decisions

## Handoff

- For Phase 9 (outside this task's paths): T-042 can name `latest.json` as a source of spend signals, and T-047 should record that its spend figure comes from the pipeline's own token tallies, not from this file.
