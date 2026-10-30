Phase 1: build the demo walking skeleton on SimChain (`docs/plan.md`, Phase 1; ADR-0008).

1. Re-read `docs/demo.md` and the Phase 1 task files T-004 to T-013. Apply any edits I approved at the end of Phase 0.
2. Run the first full loop alone: T-004 (core types), then T-005 (testkit). Confirm `/verify` produces trustworthy evidence before starting parallel lanes.
3. Then run lanes in parallel through subagents, following the parallelization map in `docs/team.md`:
   - settlement: T-006
   - api: T-007, after T-006
   - judgment: T-008, then T-009
   - demo: T-012
4. Use the `red-teamer` subagent on T-006, T-008 and T-009 before review. Use the `fixture-author` subagent for T-010.
5. Finish with T-013 and stop for my dry run. Report:
   - time-to-first-transcript on a fresh clone;
   - hold p95 on SimChain;
   - the fixture list with pass/fail;
   - open risks.

Do not capture live judge recordings without telling me which model IDs and providers you will use. That step needs my API keys.
