# Pipeline

Work moves through nine stages. Each stage leaves an artifact in git or GitHub, so a session can die and the next one resumes from the task file and its `t-*` branch.

| # | Stage | Trigger | Actor (model) | Output | Exit |
| --- | --- | --- | --- | --- | --- |
| 0 | Intake | daily with `/daily-log`; on demand; when a telemetry rule fires | `scripts/ops/intake.mjs` and `scripts/ops/signals.mjs` (no model) → quarantine → triager (Haiku 5.5, no tools) | a `TriageRecord` ([schema](schemas/triage-record.schema.json)) in `reports/agent-ops/intake/` | the record matches the schema; an invalid one is dropped and counted |
| 1 | Triage | record routed to `task` | architect (Fable 5.1), reading records only | `docs/tasks/T-xxx-<slug>.md` | `scripts/ops/task-lint.mjs` passes; the docs PR merges |
| 1a | Decide | the task changes architecture, a contract or a defense | architect, after a Fable max-effort research pass | `docs/decisions-today.md` entry or ADR `Proposed` | recorded; Rafa may overrule |
| 2 | Dispatch | task ready (below) | `scripts/ops/tick.mjs`: stateless, no model decides; a Haiku 5.5 session runs it | claim: push `t-<id>-<slug>` with the Status flip as its first commit | push accepted; a rejected push means the task is taken |
| 3 | Build | claim | fixture-author first on tier 2, then the implementer | failing tests or fixtures, then code; `pnpm verify --affected`, then full `pnpm verify`; the PR | PR open |
| 4 | Verify | PR open | verifier (Sonnet 5.5) | each Evidence claim confirmed, unconfirmed or contradicted; one number re-measured | nothing contradicted |
| 5 | CI | push | GitHub Actions | `check` (with `guardrails.mjs`), `gitleaks`, `xreview` | all green |
| 6 | Review | CI green | reviewer, never the author's model; tier 2 adds the second family and the red-teamer | PASS, ISSUES or BLOCKED | every required reviewer passes within 3 rounds, else Rafa |
| 7 | Merge | PASS | lander (Haiku 5.5) through `/merge-pr`; Rafa on tier 3 | merge commit, never a squash | task done, derived from the merge (T-034 §2.9) |
| 8 | Feed back | merge, rejection, out-of-scope finding | daily-log job (Haiku 5.5) | `docs/log/`, design map, metrics, intake items | none |

**Task lint** (stage 1) checks three things:

- the listed paths exist;
- they overlap no open PR's changed files;
- every acceptance criterion names a command.

**Untrusted paths need Rafa.** A task derived from untrusted intake that lists tier 2 or tier 3 paths waits for Rafa before it is queued. That is the longest injection path: issue, then record, then task, then an agent with write tools. Public issues number 0 today (measured), so the gate costs nothing yet.

**Out-of-scope findings** become intake items, not scope creep. Tiers are defined in [gates.md](gates.md).

## Intake: four input lanes

| Lane | Where | Trust | Handling |
| --- | --- | --- | --- |
| Tickets | GitHub issues labeled `intake` and PR comments. The repo is public (measured); it has no issues yet (measured) | untrusted | quarantine, then the triager |
| Feedback (D39) | `POST /v1/feedback` into the operator's private store (T-032, not built) | untrusted; may carry deal details | quarantine, then the triager. The task cites `feedback:<fingerprint>` |
| Roadmap | `docs/plan.md`, `docs/backlog.md`, `docs/decisions-today.md`, `docs/decisions/`, the "Next steps" of `docs/reviews/*` | trusted: on `main` under the ruleset | the architect reads it directly |
| Telemetry | website, social, API, onchain (below) | aggregates are measured; social text is untrusted | a crossed rule writes a record with no model. Social text takes the quarantine path |

CI signals (a red `main`, a flake that fires again, a budget hit) are machine-made: the tick writes their records with no model.

### The quarantine

Untrusted text gets the product's own reader defense (threats T1 to T3, `docs/judgment-and-defenses.md`):

1. Normalize with `packages/judgment/src/normalize.ts`.
2. The triager (Haiku 5.5) has no tools. Its input sits between random delimiters, and its prompt carries a canary token.
3. Its output must match the schema: enums, ids and short model-written text, with no URLs, no handles and no copied text. Any other output is dropped and counted.
4. The architect reads records, never raw text. An implementer that needs the original runs a one-shot reader that prints it once, fenced and capped at 4 KB. Raw text never enters a task file, brief, PR body or handoff.

### Usage telemetry

Thresholds are guessed starting values; the shadow week (README, Activation) calibrates them.

| Source | Signal, aggregates only | Owner | Cadence | Opens a record when | Retention |
| --- | --- | --- | --- | --- | --- |
| Website | escrow.stream visits, and the funnel homepage → `llms.txt` → first API call (new signer keys per day). Cookieless analytics such as Cloudflare Web Analytics; each stage is counted on its own, never joined per visitor | demo lane | daily | a stage-to-stage conversion falls 30% below its 4-week median | 90 days |
| Social | public mentions of and replies about ’crow and escrow.stream, from public sources only | Rafa (a reply is publishing) | weekly | two or more independent posts report the same bug or docs confusion. Any security claim goes to Rafa at once | counts and fingerprints for 90 days; post text is never stored |
| API | T-031's aggregate metrics, including per-route rate, errors and latency, problems by type, 429s, quota, the deal funnel and first-try success; its 7-day request log; `notices` served; D39 reports | api lane | hourly aggregates; rules checked daily | a problem type's share doubles against its 7-day baseline; first-try success drops 10 points; any `internal` 500; a deprecation notice still served after its date; the same feedback fingerprint 3 times | request log 7 days (T-031); aggregates 90 days; reports follow T-032's lifecycle |
| Onchain | public settlement events: counts, amounts, states, timeouts, appeals, gas per deal | settlement lane | daily | timeouts or appeals double against their baseline; gas per deal rises 10% over the recorded baseline (395,831 on the happy path, T-202, measured); an event sequence the state machine forbids opens a P0 security record | events are public; aggregates 90 days |

- **Minimal disclosure** (D35, D39, D40):
  - aggregates only;
  - no deal content and no identities;
  - nothing from private deals beyond the public skeleton (T-207).
- **The numbers stay private.** Figures live in the private store: `reports/telemetry/` (git-ignored) or the operator's KV. A task cites `telemetry:<signal>` and states the symptom. Publishing any figure waits for Rafa (D39).
- **Signals are data, never instructions.** No aggregate, post text or feedback plaintext goes to a non-Anthropic provider.
- **Not built yet:**
  - T-031 and T-032 are `todo`;
  - enabling Web Analytics is a Cloudflare setting, and a social reader needs accounts, both Rafa's gates;
  - onchain means the local chain until Sepolia (T-206).

### Records

- **Kinds:** bug, docs, feature, feedback, friction, deprecation, incident, flake, security, spam.
- **Routes:** task, backlog, decision, close.
- **Order:** the demo path first (`CLAUDE.md`, first product priority), then severity, then age.
- **Security:** records preempt everything, never become public issues, and go to Rafa directly.

## Dispatch

`scripts/ops/tick.mjs` re-derives all its state from git and GitHub on every run, then exits. It runs after every merge to `main` and every CI completion, with a 20-minute cron as a fallback. A long-running coordinator was rejected: one paused at the weekly token limit on 2026-11-01 (measured, `docs/log/2026-11-01.md`).

A task is ready when all of these hold:

- both switches read active: `agent-ops/STATUS` and the repository variable `AGENT_OPS`;
- `reports/agent-ops/HALT` does not exist;
- its Status is `todo` and every task it depends on has merged;
- no `t-<id>-*` branch exists;
- its paths overlap no open PR and no claimed task;
- the work-in-progress caps and the daily budget have room ([teams.md](teams.md)).

The brief comes from the task file's fields through `/start-task` (T-036), never from free text.

**Why a branch is the claim:** CI runs on pushes to `main` and on every pull request (measured, `.github/workflows/ci.yml`). Pushing a `t-*` branch starts no CI run, while a draft PR would start a full one.

**Stale claims:** a claim with no push for 24 hours is stale. Its branch is deleted and the task reopens.

## Concurrency

**Isolation: one sandboxed cloud or VM session per task, with its own clone and scoped tokens.**

- **Why:** Rafa's machine checks every shell read against the working directories and prompts even in bypass mode (`docs/operations.md`, Working without permission prompts). Prompt floods stopped work on 2026-10-31 and 2026-11-01, and stopped a worktree run on 2026-11-03 (reported).
- **What a sandbox removes:** there is nothing outside it to protect, and it holds no personal credentials (`config/keys-dev-env.template`).
- **Local fallback:** the Agent tool's `isolation: "worktree"`, plus:
  - `scripts/hooks/bash-guard.sh`, which turns each pattern that prompts into a tool error before the permission layer sees it. The patterns: `cd` out of the root, heredoc and redirect writes, `sed -i`, interpreter one-liners, command substitution, `xargs`, `eval`, `find -exec`, `/private/tmp`, `~/`, polling loops. Arguments built at run time cannot be proven to stay in the repo, so the agent lists first and passes literal paths.
  - `TMPDIR`, `FOUNDRY_DIR` and the pnpm store pinned under `reports/`. Whether this removes every prompt is guessed.
- **One worktree convention.** Three coexist today (measured, velocity review).

**Shared files have one writer:**

| File | Writer |
| --- | --- |
| `docs/log/*`, `docs/decisions-today.md` | daily-log job; architect for decisions |
| `docs/plan.md`, `docs/backlog.md` | architect |
| `spec/openapi.json`, the design map | generated: regenerate after the merge, never merge by hand |
| `pnpm-lock.yaml`, `package.json`, `vitest.config.ts`, `contracts/lib/` | one task at a time, in the infra lane |
| `docs/team.md`, Rules and checks | rows are appended only |

**Conflicts:**

- **Updating a branch:** merge `main` into it; never rebase (Rafa's standing rule). The design map's work feed parses merge commits.
- **A conflict outside the task's paths:** stop and hand off. `/merge-pr` never resolves conflicts.
- **Superseded runs:** `cancel-in-progress` cancels them (T-034).
