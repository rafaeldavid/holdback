# T-316: a check runner a seller runs on its delivery before it delivers

- **Lane:** judgment, with one example and two sentences of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 5, settlement and judgment code (Change recipes): one review, blocking findings only. The `llms.txt` sentences are kind 1.
- **Depends on:** T-008 (the check library), T-317 (the audit-report terms and sample reports, used as the sample deal)
- **Paths this task may touch:** `packages/judgment/src/intake.ts`, `packages/judgment/src/pipeline.ts`, `packages/judgment/src/preflight.ts`, `packages/judgment/src/preflight.test.ts`, `packages/judgment/src/index.ts`, `examples/check-delivery.ts`, `examples/check-delivery.test.ts`, `examples/package.json`, `examples/tsconfig.json`, `pnpm-lock.yaml` (the examples' workspace links only), `site/llms.txt`, `site/index.html` (only if the build regenerates it), this file. Never: `spec/schemas/`, `contracts/`, `packages/judgment/src/checks/`.
- **Human gate:** no. The site deploy that publishes the `llms.txt` sentences waits for Rafa.
- **Status:** done (PR 278, merged 2026-11-11)
- **Agent/session:** the T-316 and T-317 session, 2026-11-11, branch `t-316-seller-check-runner`

## Intent

Rafa asked on 2026-11-11 for a way for a seller to run the agreed deterministic checks on its own delivery before it delivers.

**Problem (measured).** The rules contract takes one delivery attempt: `contracts/src/HoldbackRules.sol` line 624 reverts when `dv.attempt != 1`. A failed required check refunds the buyer. Nothing in the repository lets a seller run the agreed checks on its own bytes first, so a seller learns that its file fails only after its one attempt is spent.

**Goal.** A seller runs one command on its own machine, on the exact bytes it will deliver, and gets the result the adjudicator's first stage gives for those bytes: the same pass or fail for each check, with the same detail, and the same refusal when intake would refuse the file.

**Inputs.**
- The terms as the seller signed them: a JSON file with `acceptance` and `deliverable.format`, as `GET /v1/commitments/{id}/terms` returns.
- The file to deliver.

**Outputs.**
1. `preflightDelivery` in `packages/judgment/src/preflight.ts`, an importable function. It runs intake's rules for the plaintext (the MIME allowlist, the agreed format, the 10 MB cap, strict UTF-8) and then stage 1, the deterministic checks.
2. `examples/check-delivery.ts`, a command around that function: `node examples/check-delivery.ts <terms.json> <file>`. It prints the result, then one line per check, and exits 0 when the checks do not refuse the file.
3. A test that runs the adjudicator's path (`intake` on the encrypted delivery, then `runPipeline`) and the runner on the same inputs and compares the results.
4. Two sentences in `site/llms.txt`, step 7, that tell a seller to run the checks first.

**How the runner stays the adjudicator's code, not a copy.** The runner calls the same exported functions the adjudicator's path calls. This task extracts them from `intake` and `runPipeline` without changing what either does:
- `refuseMime`, `refuseSize` and `decodePlaintext` from `intake`;
- `stageOne` from `runPipeline`: the checks on the text as delivered, and the decision the checks alone give.

**Non-goals.**
- No change to any check, to aggregation, to the screen or to what `intake` and `runPipeline` return.
- No code execution from the deliverable and no network call. The runner reads local files only.
- No screen and no panel. On a rubric deal the runner says the judges decide next; it does not predict them.
- No retry rule. The contract keeps one delivery attempt.
- No check of the check library's version against the adjudicator's. The policy does not bind one (T-317's Handoff, limit 2).

## Context

- `packages/judgment/src/checks/index.ts`: `runChecks`, the check library.
- `packages/judgment/src/intake.ts` and `packages/judgment/src/pipeline.ts`: stages 0 and 1 as the adjudicator runs them.
- `apps/adjudicator/src/service.ts`, `#judge` and `mapIntakeError`: an intake refusal that is the seller's fault rejects with no panel.
- `docs/team.md`, Rules and checks: "Deliverables untrusted, output surfaces" (check details reach a terminal as one plain line) and "Examples run as written".
- `fixtures/terms/audit-report.yaml` and `fixtures/data/audit-report/` (T-317): the sample deal.

## Acceptance criteria

- [x] `preflightDelivery` returns, for the same plaintext, MIME and acceptance, the `deterministic` outcomes `runPipeline` returns after `intake` on the encrypted delivery: same ids, `required`, `passed` and `detail`, in the same order (test, including property tests over changed reports, arbitrary text and arbitrary bytes).
- [x] Its `result` is the adjudicator's decision when no panel sits: `reject` for a failed required check, `accept` for a checks-only deal that passes, `escalate` for a check that runs out of budget; and `panel` when the judges decide next (test).
- [x] For a file intake refuses (a format outside the allowlist, another format than agreed, over 10 MB, not UTF-8), it returns the same refusal code as `intake`, runs no check, and `result` is `reject` (test).
- [x] `intake` and `runPipeline` behave as before: the existing judgment tests pass unchanged.
- [x] `node examples/check-delivery.ts <terms.json> <file>` runs as written (Node strips the types), prints the result and one plain line per check, and exits 0 for accept or panel, 1 for reject, and 2 for escalate or any failure of the command itself (test, as a child process).
- [x] The command's `--json` output equals the adjudicator's path on the T-317 sample deal: the passing report, the report that misses a file, the reordered report and the report with no findings (test).
- [x] The command loads no reference files, as the adjudicator service loads none: a `reference_row_match_min` check fails in both with "reference not available" (test; added after the review).
- [x] The command makes no network call and executes nothing from the deliverable: it imports only `node:fs`, `node:url` and two workspace packages (test reads the imports).
- [x] `site/llms.txt`, step 7, tells a seller to run the checks first; `node site/build.mjs && node site/check.mjs` passes.
- [x] One review by the `reviewer` agent; blocking findings fixed.

## Out of scope

- The screen. A screen flag on a rubric deal escalates, and a seller cannot see it from this runner (Handoff).
- Sealed checks, which the seller cannot read by design.
- An HTTP endpoint for the same run. The seller's bytes stay on its machine.

## Evidence

All runs on 2026-11-11, on branch `t-316-seller-check-runner`, rebased on `origin/main` at `b97cb85`.

- **Test first (measured).** `pnpm exec vitest run packages/judgment/src/preflight.test.ts` failed to load before `preflight.ts` existed. Its first full run failed 2 of 17 tests: the test file expected `accept` for a CSV whose optional check fails. The adjudicator's path seats a panel there, and the preflight agreed with it. The test was wrong and now states that rule.
- **The preflight test (measured).** `pnpm exec vitest run packages/judgment/src/preflight.test.ts`: 17 tests passed. Three are property tests of 60 runs each: reports with any subset of 11 changes, arbitrary text as JSON or CSV, and arbitrary bytes.
- **The test fails on a diverging preflight (measured).** With the preflight running the checks on the normalized text, 3 tests failed. With the size cap removed from the preflight, 1 test failed. The file was restored after each run.
- **The command's test (measured).** `pnpm exec vitest run examples/check-delivery.test.ts`: 16 tests passed. Fourteen run `node examples/check-delivery.ts` as a child process; one calls the exported function and one reads the imports.
- **The judgment package (measured).** `pnpm exec vitest run packages/judgment`: 15 files passed; 489 tests passed and 2 skipped. No existing test file changed.
- **Callers of the pipeline (measured).** `pnpm exec vitest run examples/check-delivery.test.ts examples/try.test.ts examples/examples.test.ts packages/testkit apps/adjudicator/src/service.test.ts tests/audit-report-template.test.ts tests/site-deploy.test.ts`: 17 files passed; 317 tests passed and 1 skipped.
- **Snapshots (measured).** `pnpm snap`: 34 passed, 0 failed. No snapshot changed.
- **Site (measured).** `node site/build.mjs && node site/check.mjs`: "site check PASS". `site/try.mjs` keeps its SHA-256, so the lockfile change does not move the published command.
- **Types and lint (measured).** `pnpm typecheck` exits 0. `pnpm exec eslint packages/judgment/src examples` prints nothing.
- **A run on the sample deal (measured).** `node examples/check-delivery.ts spec/examples/commitment.audit-report.example.json fixtures/data/audit-report/report.missing-file.json` prints "Result: reject. The required check coverage fails, so the adjudicator rejects this file and the buyer is refunded." and `FAIL  coverage (required): schema: /filesReviewed: fewer than 3 items`, and exits 1. The scenario `audit-report-missing-file` shows the adjudicator's same detail.
- **Review (measured).** The `reviewer` agent returned ISSUES with one blocking finding, fixed in this branch (Decisions 5). It found `intake()` and `runPipeline()` unchanged in refusal order, codes, details, record and pre-panel decision.
- **Not run.** The full `pnpm verify` (the recipe keeps it for deploys) and gitleaks, which is not installed on this machine. CI runs both gates.

## Decisions

1. **Extract, do not copy.** `intake()` calls `refuseMime`, `refuseSize` and `decodePlaintext`; `runPipeline()` calls `stageOne`. The preflight calls the same four functions. A change to any rule reaches the adjudicator and the seller in one edit.
2. **`decodePlaintext` returns no intake record.** The record says the plaintext hash was verified, and only `intake()` verifies it. A caller of the helper cannot pass its result to `runPipeline` as an intake.
3. **`result` is stage 1's decision, in its own words.** `reject`, `escalate`, `accept` or `panel`. A failed optional check seats a panel even with an empty rubric (`aggregate.test.ts`, "optional failed, rubric empty"), so the preflight says `panel` there and the command says why.
4. **Exit codes.** 0 for accept or panel, 1 for reject, 2 for escalate and for every failure of the command itself. Exit 1 means "the adjudicator would reject", so a crash never exits 1.
5. **No reference files in the command (review finding, High).** The first draft took `--reference <file>`. The adjudicator service passes no `references` to the pipeline (`apps/adjudicator/src/service.ts`), so a `reference_row_match_min` check fails there with "reference not available" for every file. With the option, the command reported a pass the service cannot give. The option is gone; the command fails the check as the service does and prints a note. `preflightDelivery` keeps its `references` input, which mirrors `runPipeline`'s, with a comment on when to pass it.
6. **Plain lines through the one untrusted-text module.** The command prints file paths, check ids and check details through `plain`, and JSON through `safeJson`, both from `@holdback/testkit`. The examples package gains two workspace dependencies (`@holdback/judgment`, `@holdback/testkit`) and six lines in `pnpm-lock.yaml`.
7. **The terms are read leniently.** The command needs `acceptance` and `deliverable.format`, and for each check a string `id`, a string `type` and a boolean `required`. The check library refuses anything else it cannot evaluate, as it does for the adjudicator.
8. **No root script.** The command runs as `node examples/check-delivery.ts` after `pnpm install && pnpm build`, like the other examples' source files.

## Handoff

**Done.** `preflightDelivery` in `packages/judgment`, the command `examples/check-delivery.ts`, their tests, and the step 7 paragraph in `site/llms.txt`. The review's blocking finding is fixed.

**Not done.**
- The site deploy that publishes the paragraph waits for Rafa.
- The command needs a clone of the repository and a build. `@holdback/judgment` is not published to a package registry.

**Findings for other lanes, none fixed here.**

1. **High · The adjudicator service never loads reference files.** `apps/adjudicator/src/service.ts` and `packages/testkit/src/judgment.ts` call `runPipeline` without `references`. A required `reference_row_match_min` check therefore rejects every delivery, while `docs/api.md` recommends that check to buyers. Impact: a deal with such a check can only refund. Next action: a task in the judgment lane either loads the reference by its committed hash before stage 1, or has the primary adjudicator decline terms that carry the check. The command gains a reference option in the same change.
2. **Medium · `safeJson` leaves four characters raw.** `packages/testkit/src/untrusted.ts` escapes invisible characters, and `JSON.stringify` escapes C0 controls, so U+007F to U+009F, U+2028 and U+2029 from a CSV header reach a terminal through `--json` (measured by the reviewer). The text output is clean. Next action: the test lane adds those ranges to `safeJson`, with a test.
3. **Info · An oversize file gets the same refusal code with another detail.** The adjudicator refuses the ciphertext first ("ciphertext is N bytes"); the preflight has only the plaintext ("plaintext is N bytes; the cap is 10485760").

**Known limits.**
- The command does not run the screen. On a rubric deal a screen flag escalates, and the seller cannot see it here. A follow-up could report the screen's signals for the file; the screen is deterministic and needs no network.
- The command cannot tell which build of the check library the adjudicator runs. T-317's Handoff, limit 2, says what binding the version needs.
- Sealed checks stay sealed.

**How to resume.** Run `pnpm exec vitest run packages/judgment/src/preflight.test.ts examples/check-delivery.test.ts`. To try the command: `pnpm build`, then `node examples/check-delivery.ts spec/examples/commitment.audit-report.example.json fixtures/data/audit-report/report.json`.
