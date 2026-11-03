# Teams and model mix

Roles are the existing `.claude/agents/` definitions plus three new ones (triager, cross-family reviewer, lander). Model IDs are pinned in `pipeline.yaml`; changing one is an R3 PR.

| Role | Model | Effort | Tools | Why this model |
| --- | --- | --- | --- | --- |
| triager (new) | Haiku 5.5 | low | none; JSON out | reads the most dangerous text, so it gets no tools and a schema; high volume, low value per item |
| architect (planner) | Opus 5.5; Fable for contested decisions | high; Fable max | Read, Grep, Glob, Write, Edit | task files and ADRs are where errors compound; no Bash, so it runs nothing |
| implementer, R0, R1, R3 | Sonnet 5.5 | medium | repo allowlist | fixtures, snapshots and the OpenAPI contract test catch these lanes' errors |
| implementer, R2 | Opus 5.5 | high | repo allowlist | EIP-712 types, aggregation, invariants: errors only reasoning catches; a rework cycle (CI plus a cross-family call) costs more than the price gap (inferred) |
| fixture-author | Sonnet 5.5 | medium | `fixtures/` only | on R2 it writes failing fixtures before the implementer starts: tests and code from different sessions |
| verifier | Sonnet 5.5 | low | Read, Grep, Glob, Bash; no Write, Edit, push or `gh` mutations | marks each claim confirmed, unconfirmed or contradicted; a false "confirmed" defeats the stage, so not Haiku |
| reviewer | Opus 5.5 | high, never below the implementer's | Read, Grep, Glob, Bash; no Write, Edit, push or `gh` mutations; read-only token | fresh session, never the implementer's; reproduces the evidence. Today's reviewer and verifier definitions grant Write and Edit (measured) |
| red-teamer | Fable 5.1 | max | Read, Grep, Glob, Write, Edit, Bash | adversarial work gets the strongest model; writes `attack.*` and `neutrality.*` fixtures, never weakens one |
| cross-family reviewer (new) | DeepSeek V4 Pro; a GPT-family model at phase exits | provider max | none; `ReviewVerdict` out | a second family breaks correlated blind spots (threat T8). The repo already calls DeepSeek through its OpenAI-compatible provider (`config/judges-live.yaml`, measured) |
| lander (new) | Haiku 5.5 | low | the only role allowed `gh pr merge`; `gh run rerun`, `git worktree` | mechanical: T-036's `/merge-pr` plus the landing checks in `gates.md` |
| log and map jobs | Haiku 5.5 | low | scripts | mechanical |

Same family is not cross-family: Opus reviewing Sonnet shares training data and blind spots.

## Team per class

| Class | Sessions, in order |
| --- | --- |
| R0 | implementer → reviewer → lander |
| R1 | implementer → verifier → reviewer → lander |
| R2 | fixture-author → implementer → verifier → reviewer ∥ cross-family ∥ red-teamer → lander |
| R3 | implementer → verifier → reviewer ∥ cross-family → Rafa |

The red team runs on every R2 PR and at every phase exit.

## Concurrency

| Limit | Value | Basis |
| --- | --- | --- |
| implementers in flight | 3, at most 1 per lane | lanes own disjoint paths (`docs/team.md`, measured); commons files collide beyond 3 (inferred) |
| PRs waiting on CI | 2 | 9 jobs per run against GitHub's 20 concurrent jobs (inferred from the dev-velocity review) |
| cross-family reviews in flight | 1 | cost (guessed); daily cap 30, like the demo's `LIVE_JUDGE_CALLS_PER_DAY` (measured) |
| full `pnpm verify` per machine | 1 | two in parallel push tests past their timeouts (measured, dev-velocity review) |
| sessions in all | 5 | guessed |

- **Claim:** push `t-<id>-<slug>` with the task's Status flip as its first commit. A rejected push means the task is taken. No push for 24 h: the claim is stale; only the tick deletes it and reopens the task.
- **Worktree:** one convention, `isolation: "worktree"` under `.claude/worktrees/`.
- **Commons files** (`docs/plan.md`, `docs/log/`, `docs/decisions-today.md`, the Rules and checks table, `CLAUDE.md`) have one writer each: the planner or the daily-log job. Implementers write their task file and PR body.
- **Merges:** merge commits, never squash (the design map parses them); branches merge `main`, never rebase.
- **Bounce:** a red review or CI goes to a fresh implementer with the handoff, at most twice; then the task parks as `needs-human`.
