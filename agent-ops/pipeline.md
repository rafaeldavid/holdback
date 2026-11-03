# Pipeline

Every change passes through nine stages. Each stage leaves its output in git or on GitHub, so a new session can resume any task from its task file and its `t-*` branch.

| # | Stage | Trigger | Actor | Output | Exit condition |
| --- | --- | --- | --- | --- | --- |
| 0 | Intake | The daily log runs, someone requests a run, or a telemetry rule fires. | `scripts/ops/intake.mjs` and `scripts/ops/signals.mjs` collect items. The triager (Haiku 5.5, no tools) reads outside text in the quarantine. | A `TriageRecord` ([schema](schemas/triage-record.schema.json)) in `reports/agent-ops/intake/` | The record matches the schema. The pipeline drops and counts invalid records. |
| 1 | Triage | A record routes to a task. | The architect (Fable 5.1) reads the record. It never reads the raw text. | `docs/tasks/T-xxx-<slug>.md` | `scripts/ops/task-lint.mjs` passes and the docs pull request merges. |
| 1a | Decide | The task changes architecture, a contract or a defense. | The architect, after a Fable research pass at max effort | An entry in `docs/decisions-today.md` or a proposed ADR | The decision is recorded. Rafa can overrule it. |
| 2 | Dispatch | A task becomes ready. | `scripts/ops/tick.mjs`, run by a Haiku 5.5 session. The script decides; the model does not. | A claim: a pushed `t-<id>-<slug>` branch whose first commit sets the task's Status | GitHub accepts the push. A rejected push means another session holds the task. |
| 3 | Build | The claim succeeds. | For tier 2, the fixture-author writes failing tests first. The implementer then writes the code. | Tests, code, a passing `pnpm verify`, and a pull request | The pull request is open. |
| 4 | Verify | The pull request opens. | The verifier (Sonnet 5.5) | A verdict on each Evidence claim (confirmed, unconfirmed or contradicted) and one re-measured number | No claim is contradicted. |
| 5 | CI | Every push | GitHub Actions | `check` (including `guardrails.mjs`), `gitleaks` and `xreview` | All three pass. |
| 6 | Review | CI passes. | A reviewer that is not the author's model. Tier 2 adds the second family and the red team. | PASS, ISSUES or BLOCKED | Every required reviewer passes within three rounds. After three rounds, Rafa decides. |
| 7 | Merge | Every review passes. | The lander (Haiku 5.5) runs `/merge-pr` for tiers 0 to 2. Rafa merges tier 3. | A merge commit. The pipeline never squashes. | The design map marks the task done from the merge (T-034 §2.9). |
| 8 | Feed back | A merge, a rejection or an out-of-scope finding | The daily-log job (Haiku 5.5) | Updates to `docs/log/`, the design map and the metrics, plus new intake items | None |

Task lint checks three conditions: the listed paths exist, no open pull request touches them, and each acceptance criterion names a command.

Rafa approves any task that comes from untrusted input and lists tier 2 or tier 3 paths before the tick can start it. This rule covers the longest injection path, from an issue to a record to a task to an agent with write access. The repository has no public issues today (measured), so the rule costs nothing yet.

Review findings outside a task's scope become new intake items. [gates.md](gates.md) defines the tiers.

## Inputs

Four input lanes feed triage.

| Lane | Source | Trust | Handling |
| --- | --- | --- | --- |
| Tickets | GitHub issues labeled `intake`, and pull request comments. The repository is public and has no issues today (measured). | Untrusted | The quarantine reads them. |
| Agent feedback | Reports sent to `POST /v1/feedback` under D39, stored in the operator's private store. Agents send reports on their own, and agents that opt in also answer feedback requests at deal milestones (see Requested feedback below). T-032 built the route (merged in PR 121, not deployed). | Untrusted. Reports can contain deal details. | The quarantine reads free text. Ratings become telemetry aggregates. The task cites `feedback:<fingerprint>` and never quotes the report. |
| Roadmap | `docs/plan.md`, `docs/backlog.md`, `docs/decisions-today.md`, `docs/decisions/`, and the "Next steps" lists in `docs/reviews/*` | Trusted. Each reached `main` through a reviewed pull request. | The architect reads them directly. |
| Telemetry | The website, social posts, the API and the chain (see Usage telemetry below) | Aggregates are measurements. Social post text is untrusted. | Telemetry rules write records without a model. The quarantine reads social post text. |

CI signals also create records. When `main` fails, a flaky test recurs or a budget runs out, the tick writes a record without a model.

### Quarantine

The quarantine applies the product's reader defenses (threats T1 to T3 in `docs/judgment-and-defenses.md`) to outside text:

1. It normalizes the text with `packages/judgment/src/normalize.ts`.
2. The triager (Haiku 5.5) reads the text without tools. The text sits between random delimiters, and the prompt contains a canary token.
3. The triager's output must match the schema. The schema allows enums, IDs and short summaries written by the model, and it rejects URLs, handles and copied text. The quarantine drops and counts any output that fails the schema.
4. The architect reads records only. An implementer that needs the original text runs a one-shot reader, which prints the text once, fenced and capped at 4 KB.
5. Raw text never enters a task file, brief, pull request body or handoff.

### Requested feedback

The operator asks agents for feedback at key deal milestones. It asks only agents that opt in, and the default is off.

- **Opt-in.** The agent's owner decides whether to opt in, and the agent sends that choice as the header `Prefer: feedback-requests=on` (RFC 7240) on its requests. Without the header, the operator never asks. The operator stores no opt-in state.
- **Timing.** The operator asks at three points:
  - Before a milestone: the prepare responses for an offer and an agreement carry a request before the agent signs.
  - After a milestone: the response that completes a deal stage carries a request.
  - On errors: a problem response carries a request.
- **Sampling.** The operator decides whether to ask by hashing the signer key, the deal ID and the milestone, and comparing the result with the rate below. The hash makes the decision repeatable without stored state, so the operator asks at most once per deal and milestone. The rates are guesses that the shadow week calibrates.

| Milestone | When the operator asks | Rate |
| --- | --- | --- |
| Offer or agreement prepared | Before the agent signs | 10% |
| Commitment agreed, hold funded, delivery submitted, judgment returned | After the stage completes | 10% |
| Deal settled (release or refund) | After settlement | Every deal |
| Appeal filed | After the appeal | Every appeal |
| Error response | With the problem response | 25% per problem type |

- **Request.** The response body carries a `feedbackRequest` object with an ID, the milestone, an expiry 24 hours later and three fixed questions: an ease rating from 1 to 5, whether the docs answered the agent's question (yes or no), and an optional free-text comment. The request carries no deal content.
- **Answer.** The agent answers through `POST /v1/feedback` with the request ID. The D39 rules apply: the operator tells the agent that it is sharing the answer with this operator, and the agent seals any text that can contain deal details to the operator's key. An unanswered request expires and has no effect.
- **Routing.** Ratings and yes-or-no answers become telemetry aggregates per milestone. Free text enters the quarantine as untrusted feedback.
- **Rules that open a record.** A milestone's average ease rating falls below 3 over a week, or more than 30% of answers for a milestone say that the docs did not answer the question. Both thresholds are guesses.
- **Contract.** The `feedbackRequest` field and the `Prefer` header change the API contract, so they require an ADR and a schema version bump (`CLAUDE.md`, hard rules). Task T-043 (PR 131) builds this on the feedback route from T-032.

### Usage telemetry

Telemetry is the fourth input lane. The thresholds below are starting guesses, and the shadow week calibrates them (README, Activation).

| Source | Signal | Owner | Cadence | Opens a record when | Retention |
| --- | --- | --- | --- | --- | --- |
| Website | Visits to escrow.stream, and the funnel from the homepage to `llms.txt` to a first API call, measured as new signer keys per day. Cookieless analytics such as Cloudflare Web Analytics count each stage separately and never join stages per visitor. | Demo lane | Daily | A stage-to-stage conversion falls 30% below its 4-week median. | 90 days |
| Social | Public mentions of and replies about ’crow and escrow.stream, from public sources only | Rafa, because a reply is a publication | Weekly | Two or more independent posts report the same bug or docs problem. Rafa receives any security claim at once. | Counts and fingerprints for 90 days. Post text is not stored. |
| API | The aggregate metrics from T-031 (per-route rate, errors and latency, problems by type, 429s, quota, the deal funnel and first-try success), its 7-day request log, the `notices` the operator serves, and D39 reports | API lane | Hourly counts, daily rules | A problem type's share doubles against its 7-day baseline, first-try success drops 10 points, the operator returns an `internal` 500, the operator serves a deprecation notice after its date, or one feedback fingerprint appears three times. | Request log 7 days (T-031). Aggregates 90 days. Reports follow the T-032 lifecycle. |
| Onchain | Public settlement events: counts, amounts, states, timeouts, appeals and gas per deal | Settlement lane | Daily | Timeouts or appeals double against their baseline, gas per deal exceeds the recorded baseline (395,831 on the happy path, T-202, measured) by 10%, or the chain shows an event sequence that the state machine forbids. The last case opens a P0 security record. | Events are public. Aggregates 90 days. |

Telemetry follows these rules:

- It holds aggregates only. It holds no deal content, no identities, and nothing from a private deal beyond its public skeleton (D35, D39, D40, T-207).
- The figures stay in a private store, either `reports/telemetry/` (git-ignored) or the operator's KV store. A task cites `telemetry:<signal>` and describes the symptom without figures. Rafa decides whether to publish any figure (D39).
- The pipeline treats signals as data. It sends no aggregate, post text or feedback text to a non-Anthropic provider.
- T-031 (PR 118) and T-032 (PR 121) are merged but not deployed. Task T-043 (PR 131) builds the milestone feedback requests. Web analytics needs a Cloudflare setting and the social reader needs accounts, so both need Rafa's approval. The chain is a local chain until Sepolia (T-206).

### Records

- Each record has one kind: bug, docs, feature, feedback, friction, deprecation, incident, flake, security or spam.
- Each record has one route: task, backlog, decision or close.
- Triage orders work by the demo path first (the first product priority in `CLAUDE.md`), then by severity, then by age.
- A security record takes priority over all other work. It never becomes a public issue, and it goes to Rafa directly.

## Dispatch

`scripts/ops/tick.mjs` rebuilds its state from git and GitHub on every run and then exits. It runs after every merge to `main` and every CI completion. A 20-minute cron job runs it if no event arrives. The design uses a stateless script instead of a long-running coordinator because a coordinator session stopped at the weekly token limit on 2026-11-01 (measured, `docs/log/2026-11-01.md`).

The tick starts a task when all of these conditions hold:

- `agent-ops/STATUS` reads `active` and the repository variable `AGENT_OPS` equals `on`;
- `reports/agent-ops/HALT` does not exist;
- the task's Status is `todo`, and every task it depends on has merged;
- no `t-<id>-*` branch exists;
- no open pull request or claimed task touches the task's paths;
- the work-in-progress limits and the daily budget allow another task ([teams.md](teams.md)).

`/start-task` (T-036) builds each brief from the task file's fields.

A pushed branch serves as the claim because CI runs only on pushes to `main` and on pull requests (measured, `.github/workflows/ci.yml`). A branch push starts no CI run. A draft pull request would start a full run.

If a claimed branch receives no push for 24 hours, the tick deletes the branch and reopens the task.

## Concurrency

Each task runs in its own sandboxed cloud or VM session, with its own clone and scoped tokens.

- Rafa's machine checks every shell read against the working directories and prompts even in bypass mode (`docs/operations.md`, Working without permission prompts). Prompt floods stopped work on 2026-10-31 and 2026-11-01, and stopped a worktree run on 2026-11-03 (reported).
- A sandbox has nothing outside it to protect, so it needs no such check. It also holds no personal credentials (`config/keys-dev-env.template`).
- On a local machine, the fallback is the Agent tool's `isolation: "worktree"` with two additions:
  - `scripts/hooks/bash-guard.sh` turns each command pattern that triggers a prompt into a tool error before the permission layer sees it. The patterns are `cd` outside the root, heredoc and redirect writes, `sed -i`, interpreter one-liners, command substitution, `xargs`, `eval`, `find -exec`, `/private/tmp`, `~/` and polling loops. The agent lists files first and then passes literal paths, because the guard cannot verify paths built at run time.
  - The settings pin `TMPDIR`, `FOUNDRY_DIR` and the pnpm store under `reports/`. Whether this removes every prompt is guessed.
- The repository uses one worktree convention. Three conventions exist today (measured, velocity review).

Each shared file has one writer.

| File | Writer |
| --- | --- |
| `docs/log/*` | The daily-log job |
| `docs/decisions-today.md`, `docs/plan.md`, `docs/backlog.md` | The architect |
| `spec/openapi.json`, the design map | A generator. The pipeline regenerates these files after each merge and never merges them by hand. |
| `pnpm-lock.yaml`, `package.json`, `vitest.config.ts`, `contracts/lib/` | One infra-lane task at a time |
| `docs/team.md`, Rules and checks | Any task, by appending rows only |

Branches follow three rules:

- An agent updates its branch by merging `main` into it and never rebases (Rafa's standing rule). The design map's work feed parses merge commits.
- An agent that hits a conflict outside its task's paths stops and hands off. `/merge-pr` never resolves conflicts.
- CI cancels superseded runs with `cancel-in-progress` (T-034).
