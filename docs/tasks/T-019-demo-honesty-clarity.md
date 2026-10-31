# T-019: Demo honesty and clarity for an AI-lab reader

- **Lane:** demo
- **Phase:** 1
- **Depends on:** T-013, T-017, D25
- **Paths this task may touch:** `apps/demo/src/`, `apps/demo/agents/bench.ts`, `docs/demo.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Make every label in the transcripts and viewer true, and give the beat an AI lab cares most about (judging) real content.

Restate this in your own words in this section before writing code.

## Context

- `docs/reviews/2026-10-31-build-and-simplification-review.md` proposals 3–7; D25.

## Acceptance criteria

- [ ] Honest labels: `recorded` becomes `scripted` wherever fake judges run; the Source line drops task IDs ("scripted agents over the operator API; the adjudicator service with scripted judges"); the header prints once in the viewer.
- [ ] One commitment ID per job: each beat's world gets its own seed, so beats 5 and 10 have their own IDs and seed commitments.
- [ ] Judging time that means something: stamp checks, screen and panel from the adjudicator service, or one line "decision N ms after delivery; judging took M ms".
- [ ] Beat 3 shows one judge prompt and one verdict, collapsed like the signed message, through the untrusted-output helpers.
- [ ] Balance tables render only when the ledger changed; the closing lists four residual risks with a pointer to `docs/neutrality.md`.
- [ ] `pnpm verify` green; tests updated.

## Out of scope

- Beats 6a and 7 (T-018); one driver for snap and demo (after the demo).

## Evidence

## Decisions

## Handoff
