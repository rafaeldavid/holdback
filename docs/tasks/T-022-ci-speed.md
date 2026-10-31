# T-022: Faster CI without losing coverage

- **Lane:** infra
- **Phase:** 1
- **Depends on:** T-020
- **Paths this task may touch:** `.github/workflows/ci.yml`, `vitest.config.ts`, root `package.json` scripts, and the test files named below (plus their helpers): `packages/settlement/sim/properties.test.ts`, `tests/spec.test.ts`, `packages/judgment/src/screen.test.ts` and `packages/judgment/src/screen.ts` (only if the screen itself is slow), `packages/testkit/src/runner.test.ts`, `apps/adjudicator/src/service.test.ts`, `apps/demo/agents/agents.test.ts`, `apps/demo/src/cli.test.ts`; `docs/testing.md`
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer, branch `t-022-ci-speed`, PR #54

## Intent

CI's `check` job takes about 3.5 minutes, and `pnpm test` is 2 min 36 s of it, measured on run 41224931892. The test files sum to 142 s of work; locally that runs in about 25 s across many cores, but the GitHub runner has 2. Five files are 59% of the time: settlement property tests (20 s, 4 tests), testkit runner tests (19 s), screen tests (16 s for 39 tests), adjudicator service tests (15 s) and spec tests (13 s for 165 tests). Get CI under about 90 seconds of wall time without deleting coverage that backs a litmus test.

**Restated (implementer).** Pull-request CI should finish in about 90 seconds instead of about 3.5 minutes, while still checking everything it checks today. The levers:
- spread the test files over several parallel runners, so the work is no longer bound by 2 cores;
- stop repeating avoidable work: schemas recompiled per test, and the full property-test count on every PR;
- find out whether the screen tests are slow because `screen.ts` itself is slow. If it is, that is a product bug to fix with a timing test.

Non-goals:
- deleting or weakening tests that back a litmus test or a Rules-and-checks row;
- changing what `pnpm verify` checks;
- touching gitleaks;
- the one-driver refactor of snap and demo;
- a larger or paid runner.

## Acceptance criteria

- [x] Tests split across parallel CI jobs (`vitest --shard`), with typecheck, lint, spec and snap in their own job; the PR shows one required status or the jobs are documented for branch protection.
- [x] Property tests take their run count from an environment variable: fewer runs on pull requests, the full count on `main` and in a nightly scheduled job. The same seed is kept, so failures reproduce.
- [x] The spec tests compile each schema once.
- [x] Find out why the screen tests are slow. If `screen.ts` itself is slow on realistic input, fix it (a slow screen is a performance and possible denial-of-service problem, not just a CI cost) with a timing test; if only the tests are heavy, make them lighter without losing cases.
- [x] Where several suites run the same full demo beats, run them once per job and share the result, if that is a small change; otherwise note it in Handoff (the larger "one driver" refactor is after the demo). *Not small and outside the listed paths; noted in Handoff.*
- [x] No test that backs a litmus test or a Rules-and-checks row is deleted. Any test removed or merged is listed with the reason.
- [x] Before and after: per-file timings locally and the CI wall time, measured.
- [x] `pnpm verify` unchanged in what it checks and green.

## Out of scope

- The one-driver refactor of snap and demo (after the demo); a paid or larger runner (needs Rafa).

## Evidence

**CI wall time (measured, `gh run view <id> --json jobs`).**

| Run | Trigger | Run created to done | Longest job | Test step |
| --- | --- | --- | --- | --- |
| 41224931892 (before, T-020 PR) | pull_request | 207 s | `check` 205 s | 156 s, one job |
| 41227571431 (this PR, first push) | pull_request | 108 s | `test (1/4)` 99 s | 41 to 57 s per shard |
| 41228325336 (this PR, CI-measured costs) | pull_request | **97 s** | `test (4/4)` 88 s | 35 to 46 s per shard |

- Measured: each test shard spends about 10 s on setup and about 20 s on `pnpm build` (`tsc -b`) before its tests run. The static job takes 62 s and is not the long pole.
- Not yet measured: a push to main or the nightly run, which use the full property counts and add about 6 s to one shard (inferred from the local times below).

**Local per-file times, top files (measured, `npx vitest run --reporter=json`, 8 cores; JSON times exclude `beforeAll` hooks).**

| File | Before | After, full counts | After, PR cap 40 |
| --- | --- | --- | --- |
| `packages/settlement/sim/properties.test.ts` | 16.4 s (4 tests) | 16.3 s (10 tests) | 6.5 s |
| `tests/spec.test.ts` | 8.5 s | 0.4 s | 0.4 s |
| `packages/judgment/src/screen.test.ts` | 10.9 s | 13.4 s | 14.0 s |
| `packages/testkit/src/runner.test.ts` | 14.1 s | 15.1 s | 15.6 s |
| `apps/adjudicator/src/service.test.ts` | 14.5 s | 12.9 s | 13.2 s |
| Sum over all 72 files | 127.2 s, 1999 tests | 114.9 s, 2005 tests | 107.6 s, 2005 tests |
| Wall, `npx vitest run` | 33.0 s | 25.9 s | — |

- Measured: run-to-run noise on the unchanged files is about ±2 s.
- Measured: across the four shards, 72 of 72 files ran, each exactly once, for 2005 tests (1999 plus the 6 new `HOLDBACK_PROPERTY_RUNS` tests).
- Measured: CI per-file times (default reporter, hooks included) sum to 126 s over the shards.

**Screen (measured, `node` on the built `dist`, M-series laptop).**
- `screen()` on each demo CSV in `fixtures/data/dataset-cleaning` (0.46 to 0.71 MB) takes 111 to 158 ms; normalize takes 1 to 3 ms.
- On the six 9 MB adversarial shapes it takes 0.17 to 2.2 s. Throughput is about 4 MB/s and linear.
- A CPU profile spreads the time across the linear passes: `variants` (reverse and rot13 copies), the decoder run regexes and the phrase regexes. No pass is super-linear.
- With the 10 MB intake cap (`MAX_PLAINTEXT_BYTES`), the worst case is about 2.5 s of CPU per delivery (inferred).
- Could the inputs be smaller? Measured: I mutated the built `screen.js` to unbounded run regexes (`{16,}` for base64, `\p{L}+` for mixed-script words), the V8 stack-overflow shape the comments in `screen.ts` warn about. The "could not finish" signal appears at 9 MB for letters, mixed-script and base64 inputs, and not at 1 MB or 3 MB. The size is load-bearing, so the tests cannot get lighter without losing what they catch. The mutation was reverted and re-checked.
- Conclusion: the screen is not slow on realistic input. The test file is heavy because six tests build and screen 9 MB inputs (about 8.6 s of its 10.9 s), so `screen.ts` is unchanged.

**Property-run prefix (measured).** With seed 20261031, `numRuns: 30` generates exactly the first 30 inputs of `numRuns: 120`, so a capped run is a prefix and its failures reproduce with the same seed.

**Interleaving reach by run count at seed 20261031 (measured).**
- At 40 runs: 154 applied, 694 refused. Every kind except `appeal.filed`, `default.triggered` and `commitment.settled` is reached.
- At 80 runs: still no `appeal.filed`.
- At 100 runs: every kind is reached.

**`pnpm verify` (measured).** PASS on a clean tree at the branch head; report in `reports/verify-t-022-ci-speed.md`. Typecheck, lint, test, spec, snap and demo all passed, with no snapshot diffs. The test step took 26.1 s on the first clean run.

**Tests removed or merged.** None. No assertion was deleted.
- Changed: the interleaving property asserts its three deepest event kinds only at the full count, which runs on main and nightly. Its applied/refused floors scale with the run count.
- Not reduced: every per-case invariant (conservation, no negative balances, settle-once, reserved bond, idempotent resubmission, dry runs, replay) still runs on every case at any cap.

## Decisions

- **Four shards, not more** (measured and inferred). Each shard job pays about 30 s of fixed cost (setup plus `tsc -b`). Four shards bring the run to 97 s.
  - The repo is private, so each extra job costs billed minutes: about 7 jobs per run now, against 2 before (inferred, about double the minutes).
  - A fifth shard is a one-line matrix change if Rafa prefers wall time over minutes.
- **A cost-balanced sequencer in `vitest.config.ts`** instead of Vitest's hash split.
  - Measured: the hash split put 49 s in one shard and about 7 s in two others.
  - The cost table is a hint only: an unlisted file costs 2, so new files still run. Costs come from CI default-reporter times because the JSON reporter leaves out hooks.
- **Aggregate job named `check`.** It is the same status name as before, and it fails unless the static job and every shard succeeded.
  - `if: always()` makes it run, and fail, when a shard fails or is cancelled.
  - Branch protection is not available on this plan (the API returned 403), so this is the one status to require if it is turned on. Documented in `docs/testing.md`.
- **PR cap of 40 property runs.** It cuts the interleaving property from about 16 s to about 6 s. Below about 40 runs, `fallback.triggered` and `settlement.refunded` are no longer reached (measured), so the cheaper caps lose real reach.
- **The nightly runs as a `schedule` trigger in `ci.yml`**, not a separate workflow, to stay within this task's paths. It runs every job, gitleaks included, with gitleaks unchanged.
- **The 9 MB screen inputs stay.** They test the defense at the intake cap, and shrinking them could miss the V8 stack-overflow regressions that the comments in `screen.ts` describe.
- **`scripts/spec.mjs`** gained an optional argument: `validateExamples(spec = loadSpec())`. It is a helper of `tests/spec.test.ts`, and `pnpm validate:spec` behaves the same (24/24 examples valid, measured).

## Handoff

- **Shared demo beats: not done here.** These suites each run every demo beat on SimChain, at about 5 to 10 s per file on CI:
  - `apps/demo/src/transcript/render.test.ts`, `narrate.test.ts` and `untrusted.test.ts`, through `apps/demo/src/source/measured.fixture.ts`, with one cache per file;
  - `apps/demo/src/source/simchain.test.ts`;
  - `apps/demo/src/cli.test.ts` and `apps/demo/agents/agents.test.ts`.

  Running them once per job needs a Vitest `globalSetup` with `provide`/`inject` (or a file cache) in `measured.fixture.ts`. Those files are outside this task's paths, and the change is not small. Folding them into the one-driver refactor after the demo would save an estimated 15 to 20 s of CI file time (inferred).
- **Other levers, not taken.**
  - Cache `tsc -b` output between jobs: about 20 s per shard (measured build step). It would need a cache key over sources and care with `tsc -b` timestamp checks.
  - A fifth shard (see Decisions).
- **Not yet observed.** The first push-to-main and nightly runs should be checked for the full-count property time and a green `check`.
- **Decisions log.** The decisions above are test infrastructure only; the lead may copy them to `docs/decisions-today.md`, which is outside this task's paths.
- **Proposed check.** Fail CI if the shards' file counts don't add up to the unsharded count, using `vitest list` or the JSON reporter per shard and a sum in the `check` job. This guards the sequencer against a future edit that drops files. Today it is verified by hand (measured: 72 of 72).
