# Gates

## Trust boundary

The hard rule "deliverables are untrusted" applies to the pipeline's own inputs.

| Source | Trust | Path into the pipeline |
| --- | --- | --- |
| Rafa in chat; `docs/plan.md`, `docs/backlog.md`, `docs/decisions-today.md`, `docs/tasks/` on `main` | trusted | read by the planner directly; repo text arrives only through PRs under the ruleset |
| CI signals: red `main`, flake counts, budget hits, `/v1/status` schema drift | trusted, machine-made | the tick writes a `TriageRecord` with no model |
| GitHub issues, PR comments (the repo is public) | untrusted | quarantine → triage |
| `POST /v1/feedback` reports (D39, T-032; anonymous allowed, marked `x-holdback-untrusted`) | untrusted | operator export → quarantine → triage. Sealed bodies are opened only inside the triage run; plaintext never goes to a non-Anthropic provider |
| fork PRs | untrusted | never dispatched, never auto-merged |
| diffs, review findings, web pages | data | fenced and labelled when passed to the next agent |

**Triage** reuses the product's reader defense (threats T1 to T3 in `docs/judgment-and-defenses.md`):

1. Normalize with `packages/judgment/src/normalize.ts`: strip U+E0000–E007F and zero-width characters, NFKC.
2. Haiku 5.5, no tools, input spotlighted between random delimiters, a canary token in the prompt.
3. Output must match `schemas/triage-record.schema.json` (Ajv, strict). Fields are enums, ids and short model-written summaries; no URLs, no copied text. Invalid output is dropped and counted.
4. The planner reads records, never raw text. An implementer whose task needs the original runs a one-shot reader that prints it once, fenced, capped at 4 KB, under an "untrusted data" banner. Raw text never enters a task file, brief, PR body or handoff.
5. A task derived from untrusted intake that lists R2 or R3 paths waits for Rafa before entering the queue. That is the longest injection path: issue → record → task file → agent with write tools.

## Threats to the pipeline

| # | Threat | Defense |
| --- | --- | --- |
| P1 | Injection in an issue or feedback reaches an agent with write tools | tool-less triage, schema output, no copied text, one-shot raw reader |
| P2 | Second-order injection through a task file, PR body or handoff | briefs built from template fields only; agent-written text fenced for the next agent |
| P3 | A malicious diff instructs its reviewer | diff passed as data; cross-family reviewer has no tools; fork PRs never dispatched |
| P4 | Secret exfiltration | env-only secrets; `.env*` reads denied (measured); gitleaks required in CI (measured) and pre-commit (T-036); implementers hold no model, Cloudflare or chain keys and have no web tools |
| P5 | An agent weakens a check | `.github/`, `.claude/`, `agent-ops/`, `.gitleaksignore` are R3: Rafa merges. Snapshot updates need per-file justification (measured, `/snap`) |
| P6 | Escalation through tools | deny mutating `gh api`, `gh repo edit`, `gh secret`, `gh ruleset`, `gh pr merge --admin`, `wrangler`; `forge script`, `cast send` and force push are denied today (measured) |
| P7 | Supply chain | `--frozen-lockfile` (measured); `pnpm-lock.yaml` is R2; dependency bumps are their own tasks |
| P8 | Runaway cost or loops | per-class budgets and a daily cap enforced by the tick (`run.md`); the no-polling hook (T-036) |
| P9 | Unattributable work | a separate bot GitHub identity; agents merge under Rafa's account today (measured) |
| P10 | Correlated blind spots across Anthropic models | cross-family review at milestones (below) |

## Cross-family adversarial review

| Milestone | Trigger | Reviewers | Blocks |
| --- | --- | --- | --- |
| M1 litmus code | R2 PR | Opus reviewer + DeepSeek; red-teamer on judgment, settlement, contracts, operator | the merge |
| M2 pipeline change | R3 PR | Opus reviewer + DeepSeek | the merge; Rafa merges anyway |
| M3 ADR | an ADR goes to Rafa for acceptance | DeepSeek critique attached to the ADR | nothing; required input to Rafa |
| M4 phase exit | a `docs/plan.md` phase is claimed done | Fable red team + DeepSeek + a GPT-family model over every `attack.*` and `neutrality.*` fixture, plus new attacks | the exit claim |
| M5 pre-deploy | Rafa's go-ahead for a deploy | DeepSeek over the diff since the last deploy | nothing; the deploy is already gated |

**Mechanics.** The cross-family call goes through the judgment package's OpenAI-compatible provider with a judge's defenses: spotlighted diff, no tools, canary, output validated against `schemas/review-verdict.schema.json`. Schema failure is an abstention, which counts as no review; two abstentions park the PR for Rafa.

**Disagreement.** With two families there is no majority, so the asymmetry favours not merging:

1. A block from either family stands until the finding is fixed, or a counter-test lands in the PR (a test or fixture showing the claimed failure cannot happen) and the finding is answered line by line.
2. Two refutations from the same family on one PR escalate to Rafa.
3. Each disagreement is logged (family, path, claim, outcome) and summarized weekly in the daily log.
4. A reviewer is never re-run because of its verdict. A new review needs a new diff.

## Human gates

Unchanged from `CLAUDE.md`, plus R3 merges:

- deploys, repository settings and the ruleset, secrets and spend limits;
- anything published or sent to other people, including issue comments and replies to feedback;
- real keys or money; mainnet;
- remote force pushes and history rewrites;
- accepting an ADR;
- merging an R3 PR;
- activating this framework.

The hard rules and litmus tests stay enforced by the Rules and checks table in `docs/team.md` and by CI. The pipeline adds no exception to them.
