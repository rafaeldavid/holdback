# Opus 5.5 and Fable 5.1: where the drafts differed

Both drafted independently on 2026-11-03 from the same sources; neither saw the other's draft before writing. Opus reconciled them.

## Agreed from the start

- Queue state in git; no new database.
- Untrusted intake read only by a tool-less Haiku 5.5 that emits a schema record.
- DeepSeek V4 Pro as the cross-family reviewer: tool-less, schema-bound, through the repo's existing provider.
- A cross-family block stands until fixed or refuted by a counter-test; no re-roll because of a verdict.
- Pipeline self-modification is merged by Rafa only.
- One rerun, only for a listed flake; a timeout is never the fix.
- The kill switch fails closed.

## Disagreements

| # | Question | Opus | Fable | Chosen | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | Where it lives | `agent-ops/` | `docs/ops/` + `scripts/ops/` | `agent-ops/` | the ask names it; one path makes the self-modification gate one glob |
| 2 | Dispatcher | event-driven Sonnet coordinator; readiness by script | stateless script on a 20 min cron + merge events; Haiku runner | Fable's, with events primary and cron as fallback | a coordinator stopped at the weekly token limit on 2026-11-01 (measured); state re-derived each tick cannot go stale |
| 3 | Lane lock | draft PR opened at start | pushed `t-*` branch with the Status flip | Fable | a push is atomic and starts no CI run; a draft PR triggers `pull_request` CI (inferred from `ci.yml`) |
| 4 | Implementer on litmus code | Sonnet, with fixtures written first by another session | Opus | both: Opus implements R2, and fixtures come first | a rework cycle on R2 (CI plus a cross-family call) costs more than the model price gap (inferred) |
| 5 | Verifier model | Haiku | Sonnet | Sonnet | a false "confirmed" defeats the stage |
| 6 | Review depth | risk class computed from the diff's paths | tier S/M/L declared in the task file | computed | an agent cannot lower its own review by mislabelling; the task's listed paths predict the class, and a mismatch is a scope violation |
| 7 | Litmus paths | core crypto only | all of `packages/core/`, plus `pnpm-lock.yaml` | Fable's, plus Opus's `apps/adjudicator/`, judge registries, `.gitleaksignore` (R3), `AGENTS.md` (R3) | EIP-712 and money live in core; the lockfile is supply chain; a gitleaks allowlist line can hide a leaked secret |
| 8 | ADR review | cross-family blocks | cross-family advisory | required to exist, advisory in content | Rafa accepts ADRs (`.claude/agents/architect.md`); the critique is his input |
| 9 | Kill switch | `STATUS` + repo variable + `halt` issue label | repo variable + token + `STATUS`; three levels | Fable's | a label switch needs agents to hold a mutating `gh` grant |
| 10 | WIP | 3 code PRs | 3 implementers, 1 per lane, 2 in CI, 1 cross-family, 5 sessions | Fable's, plus one full verify per machine | parallel verifies flake (measured) |
| 11 | Intake into litmus code | not addressed | not addressed | an intake-derived task touching R2 or R3 waits for Rafa | added in reconciliation: issue → record → task → agent with write tools is the longest injection path; public issues are 0 today (measured), so the gate costs nothing yet |

Taken from one side only: Fable's one-shot raw reader, reviewer without Write or Edit, bot identity, single-writer commons files, isolated environment only, flake entries expiring after 14 days, and the abstention rule. Opus's framing of the pipeline as the product's judgment pattern, the staged rollout, the per-PR metrics footer, and R3 for `.gitleaksignore`.

## Open risks (both drafts)

1. Two families is all the diversity wired. DeepSeek IDs are provider aliases, so the reviewer can change under the same name, and its provider may retain data: feedback plaintext and secrets never go to it.
2. Branch claims with a 24 h TTL are a heuristic; 61 remote branches on 2026-11-02 (measured, dev-velocity review) show cleanup does not happen by itself.
3. Nothing meters tokens. The tick counts sessions and time, so a loop inside one session can spend its budget before the tick sees it.
4. A session in bypass mode does not re-check the kill switch mid-task.
5. Agents already read injection payloads daily (`attack.*` fixtures, demo transcripts). Quarantining issues and feedback narrows the new channel; it does not close the old ones.
