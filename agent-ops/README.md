# agent-ops

**Status: not active.** This directory specifies a pipeline that does not run yet:

- `STATUS` reads `inactive`, and the repository variable `AGENT_OPS` is unset.
- The repository has no `scripts/ops/`, and `.claude/settings.json` has no hooks (measured).
- No file in `.claude/` or `.github/` reads this directory.

Agent ops lets AI agents change this repository continuously and in parallel:

1. It takes work from four sources: tickets, agent feedback, the roadmap and usage telemetry. Agent feedback includes answers to the feedback requests that the operator adds at deal milestones for agents whose owners opt in. Tickets also come from crawlers that probe the live demo for bugs, and from a security watch that turns public security events into targeted audits.
2. Triage turns each item into a task file.
3. A script called the tick starts each ready task in an isolated session.
4. Automated checks test each change. Simulated customers, whose needs follow market feedback, play deals against a world built from each change that touches a customer path. A model other than the author reviews the change, and a model from a second AI company reviews every critical change.
5. GitHub merges the change under the existing ruleset.

The pipeline applies the product's own judgment rules to its code: automated checks run before model review, models from two families review critical work, and no model treats outside text as instructions.

```mermaid
flowchart LR
  T[Tickets] & F[Agent feedback] & S[Social posts] --> Q[Quarantine: triager with no tools] --> R[TriageRecord]
  W[Website] & A[API] & O[Onchain] --> G[Telemetry rules, no model] --> R
  CR[Production crawlers] --> R
  SW[Security watch] -- match, no model --> R
  SW -- free text --> Q
  P[Plan, backlog, decisions, reviews] --> AR
  R --> AR[Architect writes the task] --> K{Tick checks switches, dependencies, files and limits}
  R -- route audit --> RT[Red-team audit]
  K -- claims a branch --> B[Build] --> V[Verify] --> C[CI: tests, secret scan, cross-family review, scripted simulation]
  C --> SIM[Model-driven simulated customers]
  SIM --> RV[Review by another model]
  RV -- tiers 0 to 2 --> M[Automatic merge] --> L[Log, map, metrics] --> R
  RV -- tier 3 --> H[Rafa merges]
```

| File | Contents |
| --- | --- |
| [pipeline.md](pipeline.md) | Stages, inputs, quarantine, requested feedback, telemetry, production crawlers, the security watch, usage simulation, dispatch, concurrency and code paths |
| [teams.md](teams.md) | Roles, models, tools, limits and budgets |
| [gates.md](gates.md) | Risk tiers, threats, cross-family review and CI controls |
| [ops.yaml](ops.yaml) | The same specification in machine-readable form |
| [schemas/](schemas/) | The two data contracts between stages: `TriageRecord` and `ReviewVerdict` |
| [reconcile.md](reconcile.md) | The three drafts behind this design, the decisions taken where they differed, and the choices in the 2026-11-05 amendments |
| [flow.html](flow.html) | Source of the published page at https://claude.ai/artifact/SFr3VwBWeyQ8uuTMsqS5a2, which is private to Rafa until he shares it. The page and this file do not show the 2026-11-05 amendments yet. |
| `STATUS` | The documented state: `inactive` |

`docs/team.md` remains the live process. After activation it links here and keeps the only Rules and checks table.

## Principles

- Only text merged to `main` counts as instructions. The pipeline treats all other text as data.
- Git holds the queue. Task files are the queue, `t-*` branches are claims, and merged pull requests mark work as done.
- A script decides when a task is ready. No model makes that decision.
- A model never reviews work that the same model wrote. A second model family reviews changes to money, judgment, schemas and the pipeline.
- Telemetry holds aggregates only, and the figures stay out of the public repository.
- Rafa controls the pipeline's own rules and every action outside the repository. One action stops the pipeline, and only Rafa can start it.

## Kill switch

Both switches fail closed: the tick treats a switch it cannot read as off. The authoritative switch, `AGENT_OPS`, is a repository setting, so the agents it controls cannot change it.

| Level | Effect | Method | Who |
| --- | --- | --- | --- |
| Pause | The tick starts no new tasks. Running sessions finish their current step and hand off. | Create `reports/agent-ops/HALT`, set `AGENT_OPS` to any value other than `on`, or trigger an alarm. | Anyone, Rafa, or an alarm |
| Stop | Every session stops, the lander cancels every pending auto-merge, and the tick deletes every claim. | Run `scripts/ops/stop.mjs`. | Rafa |
| Sever | No agent can push or spend. | Revoke the agents' GitHub identity and set every provider spend cap to zero. | Rafa |

A running session does not recheck the switch, so one more push can land after a stop.

## Observability

- The lander checks a footer on every pull request. The footer lists the model for each role, the sessions, the reruns, each family's verdict, the tier and the budget used.
- The tick writes one line per run to `reports/agent-ops/metrics.jsonl` (git-ignored). The line lists the tasks that were ready, claimed, started or refused, with the reason for each refusal.
- The daily-log job writes a summary to `docs/log/`:
  - lead time and first-pass approval rate;
  - CI pass rate and reruns;
  - cross-family block, abstention and agreement rates, and canary recall;
  - hours spent waiting on Rafa, and spend;
  - the usage simulation's pass rate, flaky pairings and incomplete runs;
  - the crawler's pass rate, and the count of security records, which the log never names.

  The summary contains pipeline figures only. Product telemetry stays private (D39).
- Four alarms pause dispatch until Rafa clears them:
  - `main` fails for 30 minutes;
  - more than half of the cross-family reviews in a day block;
  - spending reaches the daily cap;
  - `gitleaks` finds a secret on an agent branch.

## Activation

Rafa approves each step, because each one reaches outside the repository or changes the pipeline's rules.

1. **Sandbox.** Set up a sandboxed environment with the scoped tokens in `config/keys-dev-env.template` and a GitHub App identity for the agents. Nothing runs on Rafa's laptop.
2. **Review keys.** Add a spend-capped DeepSeek key as an Actions secret. Make `xreview` a required check, and require code-owner review on tier 3 paths.
3. **Faster CI.** Merge T-034, T-035 and T-036, and create the known flakes list in `docs/testing.md`.
4. **Tool limits.** Remove Write and Edit from the reviewer and the verifier, and add the P6 deny list to `.claude/settings.json`.
5. **Quarantine tests.** Wire the schemas into the triage harness, run every `attack.*` payload through triage as a test, and add `tests/agent-ops-inactive.test.ts`.
   - **5b. Simulation harness dry runs** (T-061, T-062). The scripted tier runs in `pnpm verify` and as an advisory CI job for the rest of activation. The stager runs by hand on three tier 2 pull requests, and on `main` for five nights to measure the spread. The noise band and the budgets in `ops.yaml` come from those numbers.
   - **5c. Crawler by hand** (T-063). `node tools/crawler/crawl.ts --once` runs after the next deploy, and someone reads its record.
   - **5d. Watch dry run** (T-064). `watch.mjs --dry-run` runs daily for two weeks, and someone reads its records. The activation test sends a planted, already-fixed advisory, such as an old viem advisory, through the match, the quarantine and one scripted audit.
6. **Telemetry and feedback.** Deploy T-031 and T-032, which are merged. Build the milestone feedback requests in T-043 after its ADR. Enable web analytics and a public-source social reader. [pipeline.md](pipeline.md) lists each source's owner and retention.
   - **6b. The staging world** (T-062). Rafa creates `holdback-staging-op1` and `-op2`, `crow-test-agents-staging`, the hostnames `staging-api.escrow.stream`, `staging-api2.escrow.stream` and `staging.escrow.stream`, a staging relayer key, its funding lane with about 0.3 Sepolia ETH (guessed), and a staging `WORLD_SECRET`. The deploy wrapper gains `stage <tag> <sha>`. The first staging deploy runs from the current tag, and the crawler's probes pass against it.
   - **6c. Crawler timer** (T-063). Rafa approves the systemd timer under the `crawler` user, the deploy of the synthetic header if he chooses it, the weekly probes, and the push of the crawler's last record to the console.
   - **6d. Dependabot and the security channel** (T-064). Rafa merges the `npm` and `gitsubmodule` ecosystems into `.github/dependabot.yml`, confirms the channel for security records, and decides where confirmed exploits live: GitHub's draft advisory with a private fork, or the founders' private repository.
7. **Shadow week.** Run the tick with `--dry-run` for a week while Rafa starts tasks by hand. Compare the architect's task files with hand-written ones, and calibrate the telemetry thresholds.
   - **7b. Simulation shadow** (T-062). The model tier runs on every tier 2 pull request and writes records that bind nothing. At the end, Rafa decides whether the reviewer's PASS precondition binds, and whether the agent-docs probe blocks.
8. **One lane.** Run one lane until 10 pull requests merge without a revert (threshold guessed), then run three lanes with the cross-family gates. This follows principle 1 of `docs/team.md`: verification before parallelism.
   - **8b. First live audit** (T-064). One targeted audit runs with Rafa's capped keys for the second family, and its result goes in T-064's Evidence.
9. **Switch on.** Set `STATUS` to `active` and `AGENT_OPS` to `on`.
   - **9b. Nightly staging** (T-062). The nightly tag deploy to staging and the baseline run become standing configuration, approved once, like the console's hourly refresh (D45).
