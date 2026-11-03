# Teams and model mix

The pipeline uses the six roles in `.claude/agents/` and adds four more. Anthropic models write all code. A model from a second AI company reviews tier 2 changes and every milestone ([gates.md](gates.md)). A reviewer never uses the same model as the author.

Two reviewers from one company do not count as two families. Opus and Sonnet share training data and blind spots.

| Role | Model | Reason | Tools | Writes |
| --- | --- | --- | --- | --- |
| Triager (new) | Haiku 5.5 | The triager reads the most dangerous text. The missing tools and the strict schema contain it, so model strength adds little. | None. It returns JSON. | `TriageRecord`s |
| Architect | Fable 5.1 | Tasks and ADRs constrain all later work. | Read and Write. It has no Bash, as today. | `docs/tasks/`, `docs/decisions/`, `docs/plan.md`, `docs/backlog.md` |
| Implementer | Sonnet 5.5, or Opus 5.5 for tier 2 | Sonnet handles volume work. Opus writes the code that holds money, judges work or defines schemas. | All tools, inside its sandbox | Its task's paths |
| Fixture-author | Sonnet 5.5 | For tier 2, it writes failing tests before the implementer starts, so tests and code come from different sessions. | Read, Write and Bash | `fixtures/scenarios/` |
| Verifier | Sonnet 5.5 | A false confirmation defeats the stage, so the verifier needs more than Haiku. | Read and Bash, plus Edit for the task's Evidence section only | The task's Evidence section |
| Reviewer | Opus 5.5 for Sonnet's work, Fable 5.1 for Opus's work | The reviewer is never the author's model. It reproduces the evidence itself. | Read and Bash. Today `reviewer.md` also grants Write and Edit (measured); activation removes them. | Review comments |
| Second-family reviewer (new) | DeepSeek `deepseek-v4-pro`, with a GPT-family model as the fallback and at phase exits. Activation pins the GPT model. | A model from another company makes different errors. | None. It returns a `ReviewVerdict` ([schema](schemas/review-verdict.schema.json)). | A status check, through CI |
| Red-teamer | Fable 5.1 at max effort, plus DeepSeek through the review script at milestones | Attackers find more with models from different families. | Read, Write and Bash. DeepSeek has no tools. | `fixtures/scenarios/attack.*` and `neutrality.*` |
| Tick runner and lander (new) | Haiku 5.5 | The work is mechanical: run `tick.mjs`, start the sessions it lists, and run `/merge-pr` (T-036). | Bash, for `gh` and `scripts/ops/` | Branches and auto-merge settings |
| Daily-log job (new) | Haiku 5.5 | The work is mechanical: write the log, the map, the metrics and CI excerpts. A script checks the output. | Read and Write | `docs/log/` |

## Rules

- Every review records the model ID and the date, as `config/judges-live.yaml` does. `ops.yaml` holds the model IDs, so a model change is a tier 3 pull request. DeepSeek publishes aliases instead of snapshots, so the recorded date is the day of the call.
- Haiku only does work that a schema or a script checks. In two live judge runs, Haiku 5.5 wrote evidence longer than the verdict schema's 300-character limit and abstained (measured, `config/judges-live.yaml`). If the triager fails the same way, the quarantine drops the record and counts it. The shadow week measures that count.
- A failed review or CI run returns the task to the implementer with the handoff. After three rounds, the pipeline marks the task `needs-human`.
- The second-family reviewer reuses the judges' client:
  - It calls DeepSeek through the OpenAI-compatible provider in `apps/adjudicator/src/providers/live.ts`, which reports usage through `onUsage`.
  - It receives the diff as data between delimiters, with no tools and a canary token, as a judge does.
  - It uses its own prompt file. No Anthropic model summarizes its output into the pull request.
- Today, second-family review is only a recommendation. `reviewer.md` recommends it, but no second-family CLI is installed (measured 2026-11-02, `docs/reviews/2026-11-02-dev-velocity.md` §1.6). The second-family review that T-209 requires before Sepolia has not run (inferred).

## Work in progress and budgets

| Limit | Value | Basis |
| --- | --- | --- |
| Implementers running | Three, with at most one per lane. Five after T-034. | Lanes own separate paths (`docs/team.md`). Shared files collide above that number (inferred). |
| Pull requests waiting on CI | Two | A full CI run uses 9 jobs, and GitHub allows 20 concurrent jobs (inferred). |
| Cross-family reviews running | One, and at most 30 calls a day | The live judges use the same provider limit. |
| Full `pnpm verify` runs per machine | One | Two parallel runs push tests past their timeouts (measured, `docs/backlog.md`). |
| Sessions in total | Five | Guessed |

Budgets are parameters (D31). Nothing in the repository meters tokens yet, so the starting values are guesses.

| Tier | Budget per task |
| --- | --- |
| 0 | USD 5 |
| 1 | USD 25 |
| 2 | USD 80 |
| 3 | USD 40 |

The daily cap is USD 300. A session that exceeds its budget stops and writes a handoff. The tick starts no task after the pipeline reaches the daily cap. Each provider console also holds a spend cap, separate from the judges' keys.
