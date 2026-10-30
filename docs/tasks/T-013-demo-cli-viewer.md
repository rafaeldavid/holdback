# T-013: Narrated CLI, transcript renderer, static viewer, dry run

- **Lane:** demo
- **Phase:** 1
- **Depends on:** all Phase 1 tasks
- **Paths this task may touch:** `apps/demo/`
- **Human gate:** yes (dry run with Rafa)
- **Status:** todo
- **Agent/session:** —

## Intent

Make the demo readable for an AI-lab audience: narration, transcripts, timeline viewer, and a dry run against the success criteria.

Restate this in your own words in this section before writing code.

## Context

- `docs/demo.md` (all sections).

## Acceptance criteria

- [ ] `pnpm demo`, `--live`, `--beat n`; writes `demo/out/<beat>.md`, `.json`, `index.html` (static, no network).
- [ ] Narration follows the rules in `docs/demo.md`; recorded mode says so.
- [ ] Viewer shows timeline, balances, panel (model IDs), signed message (collapsed), neutrality events.
- [ ] Closing section states residual risks and asks for AI labs.
- [ ] Dry run on a fresh clone: time-to-first-transcript measured; four comprehension questions answered by a reviewer from transcripts alone.

## Out of scope

- Hosted deployment.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
