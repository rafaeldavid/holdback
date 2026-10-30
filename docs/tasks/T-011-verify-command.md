# T-011: `/verify` command, feature map, PR template

- **Lane:** infra
- **Phase:** 0
- **Depends on:** T-005
- **Paths this task may touch:** `.claude/commands/verify.md`, `scripts/verify.ts`, `docs/feature-map.md`, `.github/pull_request_template.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Give every agent one command that runs the product and collects evidence, and a feature map tying user-facing beats to fixtures.

Restate this in your own words in this section before writing code.

## Context

- `docs/team.md`; `docs/demo.md`; pstack's verification practice (make results observable; label claims).

## Acceptance criteria

- [ ] `pnpm verify` runs typecheck, tests, snap, demo (recorded) and writes `reports/verify-<branch>.md` with pass/fail per step and snapshot diffs.
- [ ] `docs/feature-map.md`: each demo beat → fixtures → packages.
- [ ] PR template with acceptance checklist, evidence (measured/inferred/guessed), contract checklist, risks.

## Out of scope

- Product code.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
