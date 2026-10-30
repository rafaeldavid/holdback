# ADR-0010: Agent-team workflow

- **Status:** Proposed. Default unless Rafa objects.
- **Date:** 2026-10-30

## Decision

- Work flows through task files (`docs/tasks/`). Each has a lane, owned paths, dependencies, acceptance criteria, evidence and a handoff section.
- One task per worktree and branch, with small PRs.
- Role subagents in `.claude/agents/`: architect, implementer, fixture-author, red-teamer, reviewer, verifier.
- A reviewer returns PASS, ISSUES or BLOCKED. A cross-family second review is recommended for settlement and judgment code.
- Human gates apply to ADRs, schemas, contracts, defenses and irreversible actions.
- Every rule in `CLAUDE.md` maps to an enforcing check (`docs/team.md`).
- Parallel lanes start only after one full task loop has been verified.

## Consequences

Throughput is bounded by the speed of verification and review. That bound is deliberate.
