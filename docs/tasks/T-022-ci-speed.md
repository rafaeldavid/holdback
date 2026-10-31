# T-022: Faster CI without losing coverage

- **Lane:** infra
- **Phase:** 1
- **Depends on:** T-020
- **Paths this task may touch:** `.github/workflows/ci.yml`, `vitest.config.ts`, root `package.json` scripts, and the test files named below (plus their helpers): `packages/settlement/sim/properties.test.ts`, `tests/spec.test.ts`, `packages/judgment/src/screen.test.ts` and `packages/judgment/src/screen.ts` (only if the screen itself is slow), `packages/testkit/src/runner.test.ts`, `apps/adjudicator/src/service.test.ts`, `apps/demo/agents/agents.test.ts`, `apps/demo/src/cli.test.ts`; `docs/testing.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

CI's `check` job takes about 3.5 minutes, and `pnpm test` is 2 min 36 s of it, measured on run 41224931892. The test files sum to 142 s of work; locally that runs in about 25 s across many cores, but the GitHub runner has 2. Five files are 59% of the time: settlement property tests (20 s, 4 tests), testkit runner tests (19 s), screen tests (16 s for 39 tests), adjudicator service tests (15 s) and spec tests (13 s for 165 tests). Get CI under about 90 seconds of wall time without deleting coverage that backs a litmus test.

Restate this in your own words in this section before writing code.

## Acceptance criteria

- [ ] Tests split across parallel CI jobs (`vitest --shard`), with typecheck, lint, spec and snap in their own job; the PR shows one required status or the jobs are documented for branch protection.
- [ ] Property tests take their run count from an environment variable: fewer runs on pull requests, the full count on `main` and in a nightly scheduled job. The same seed is kept, so failures reproduce.
- [ ] The spec tests compile each schema once.
- [ ] Find out why the screen tests are slow. If `screen.ts` itself is slow on realistic input, fix it (a slow screen is a performance and possible denial-of-service problem, not just a CI cost) with a timing test; if only the tests are heavy, make them lighter without losing cases.
- [ ] Where several suites run the same full demo beats, run them once per job and share the result, if that is a small change; otherwise note it in Handoff (the larger "one driver" refactor is after the demo).
- [ ] No test that backs a litmus test or a Rules-and-checks row is deleted. Any test removed or merged is listed with the reason.
- [ ] Before and after: per-file timings locally and the CI wall time, measured.
- [ ] `pnpm verify` unchanged in what it checks and green.

## Out of scope

- The one-driver refactor of snap and demo (after the demo); a paid or larger runner (needs Rafa).

## Evidence

## Decisions

## Handoff
