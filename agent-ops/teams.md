# Teams and model mix

`.claude/agents/` defines six roles; this design adds four. All code is written by Anthropic models. A second family reviews tier 2 and every milestone ([gates.md](gates.md)). A reviewer is never the implementer's model.

Two reviewers from one family do not count as cross-family: Opus reviewing Sonnet shares training data and blind spots.

| Role | Model | Why this model | Tools | Writes |
| --- | --- | --- | --- | --- |
| triager (new) | Haiku 5.5 | It reads the most dangerous text. No tools and a strict schema contain it; model strength does not | none: JSON out | `TriageRecord`s |
| architect | Fable 5.1 | tasks and ADRs bound everything downstream | Read, Write; no Bash, as today | `docs/tasks/`, `docs/decisions/`, `docs/plan.md`, `docs/backlog.md` |
| implementer | Sonnet 5.5; Opus 5.5 on tier 2 | volume work, test first; the stronger author on money, judgment and schemas | all, inside its sandbox | its task's paths |
| fixture-author | Sonnet 5.5 | on tier 2 it writes failing fixtures before the implementer starts, so tests and code come from different sessions | Read, Write, Bash | `fixtures/scenarios/` |
| verifier | Sonnet 5.5 | a false "confirmed" defeats the stage | Read, Bash; Edit only the task's Evidence | the task's Evidence |
| reviewer | Opus 5.5 on Sonnet's work; Fable 5.1 on Opus's | never the author's model; reproduces the evidence | Read, Bash; no Write or Edit (`reviewer.md` grants both today, measured) | review comments |
| xreviewer (new) | DeepSeek `deepseek-v4-pro`; a GPT-family model as the fallback and at phase exits, pinned at activation | a different family makes different errors | none: `ReviewVerdict` out ([schema](schemas/review-verdict.schema.json)) | a status check, through CI |
| red-teamer | Fable 5.1, max effort; DeepSeek through the xreview script at milestones | attackers gain from family diversity | Read, Write, Bash; DeepSeek: none | `fixtures/scenarios/attack.*`, `neutrality.*` |
| tick runner, lander (new) | Haiku 5.5 | mechanical: run `tick.mjs`, launch what it prints, run `/merge-pr` (T-036) | Bash (`gh`, `scripts/ops/`) | branches, auto-merge state |
| daily-log job (new) | Haiku 5.5 | mechanical: log, map, metrics, CI excerpts; a script checks the output | Read, Write | `docs/log/` |

## Rules

- **Pin and record.** Every review records the model ID and the date, as `config/judges-live.yaml` does. Model IDs live in `ops.yaml`, so changing one is a tier 3 PR. DeepSeek publishes aliases, not snapshots, so the date recorded is the day of the call.
- **Haiku does only work a schema or script checks.** In two live judge runs its evidence ran past the verdict schema's 300 characters and it abstained (measured, `config/judges-live.yaml`). For the triager that failure shows up as a dropped record, counted during the shadow week.
- **Escalate on failure, not by default.** A red review or CI result goes back to the implementer with the handoff, for at most 3 rounds. After that the task is parked as `needs-human`.
- **The xreviewer reuses the judges' transport.**
  - The client is the OpenAI-compatible provider in `apps/adjudicator/src/providers/live.ts`, which counts usage through `onUsage`.
  - The diff is spotlighted and placed in the data position, with no tools and a canary token, the same defenses a judge gets.
  - Its prompt file is separate from the Anthropic reviewer's, and no Anthropic model summarizes its output into the PR.
- **Second-family review is advice today, never a check.** `reviewer.md` recommends it, but no second-family CLI is installed (measured 2026-11-02, `docs/reviews/2026-11-02-dev-velocity.md` §1.6). The review T-209 asks for before Sepolia is still pending (inferred).

## Work in progress and budgets

| Limit | Value | Basis |
| --- | --- | --- |
| implementers in flight | 3, at most 1 per lane; 5 after T-034 | lanes own disjoint paths (`docs/team.md`); shared files collide beyond that (inferred) |
| PRs waiting on CI | 2 | a full run is 9 jobs, against GitHub's limit of 20 concurrent jobs (inferred) |
| cross-family reviews in flight | 1; 30 calls a day | the same provider cap as the live judges |
| full `pnpm verify` per machine | 1 | two in parallel push tests past their timeouts (measured, `docs/backlog.md`) |
| sessions in all | 5 | guessed |

Budgets are parameters (D31) with guessed starting values, since nothing in the repo meters tokens yet:

| Tier | Budget per task |
| --- | --- |
| tier 0 | USD 5 |
| tier 1 | USD 25 |
| tier 2 | USD 80 |
| tier 3 | USD 40 |

The daily cap is USD 300. A session over budget stops with a handoff, and the tick launches nothing past the daily cap. Each provider console also holds a spend cap, separate from the judges' keys.
