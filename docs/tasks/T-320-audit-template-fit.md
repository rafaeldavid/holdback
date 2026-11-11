# T-320: the audit-report template fits real reports

- **Lane:** demo (terms and data fixtures), test (scenarios), with one section of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4 (example and fixture code) and 1 (`site/llms.txt`), from the Change recipes in `docs/team.md`. No code in `packages/judgment` beyond one test's sample edits.
- **Depends on:** T-317 (the template, PR 273), T-316 (the seller's check runner, PR 278), T-318 (the seller adapter and its stub, PR 284)
- **Paths this task may touch:** `fixtures/terms/audit-report.yaml`, `fixtures/terms/audit-report-rubric.yaml`, `fixtures/data/audit-report/`, `fixtures/scenarios/audit-report-*`, `fixtures/recordings/audit-report-rubric-accepted/`, `fixtures/README.md` (the terms table), `spec/examples/commitment.audit-report.example.json`, `examples/seller-adapter.template.json`, `examples/seller-adapter-stub.ts`, `examples/seller-adapter.test.ts` and `examples/check-delivery.test.ts` (only where they read the template), `packages/judgment/src/preflight.test.ts` (only its edits of the sample report), `site/llms.txt`, `site/index.html` (only if the build regenerates it), `tests/audit-report-template.test.ts`, this file. Never: `spec/schemas/`, `packages/judgment/src/checks/`.
- **Human gate:** no. The site deploy that publishes the changed `llms.txt` section waits for Rafa.
- **Status:** done (PR 287, merged 2026-11-11)
- **Agent/session:** the T-320 and T-321 session, 2026-11-11, branch `t-320-audit-template-fit`

## Intent

Rafa asked on 2026-11-11 for the audit-report template (T-317) to accept reports as auditors publish them, so that one audit-shaped deal runs end to end with no gap (T-321 runs it).

**Why.** A private measurement of eight published code-audit reports, 47 findings in all, found that none passes the template's `report` check as written. The template asks for one file, one line range and one quoted excerpt for every finding, an impact for every finding, and proof-of-concept files from Medium up. Published reports do not all carry those.

**Goal.** A seller can put a real report into the template's JSON shape without inventing fields, and the deterministic checks still decide the deal. I loosen the shape in generic terms:

1. **Locations.** A finding carries a list of locations, at least one. A location names a file. Its line range and its code excerpt are optional. The `scope` check holds every location's file to the agreed scope.
2. **Proof of concept is a term of the deal.** The proof rule moves out of the `report` check into a check of its own, `proof`. The deal states the lowest severity that needs proof, or states that none does. The default stays Medium and higher.
3. **Optional fields.** `impact` becomes optional. The report may carry a `summary` and a `reportDate`. A finding may carry a `status`: open, fixed or acknowledged.
4. **What stays.** A report with no findings passes. The agreed files in any order pass `coverage`, and a missing file fails it. Every check is deterministic and uses only the keywords `packages/judgment/src/checks/json-schema.ts` supports.

**Inputs.** The template and its fixtures from T-317; the `json_schema` interpreter as it stands; the testkit's scripted judges (`pnpm snap --judges fake --record`).

**Outputs.**
- `fixtures/terms/audit-report.yaml` with five required checks: `report`, `proof`, `scope`, `coverage`, `hidden`.
- The four sample reports in `fixtures/data/audit-report/` in the new shape.
- The three existing scenarios with new snapshots, and one new scenario, `audit-report-rubric-accepted`, whose terms carry the optional rubric, so a panel of scripted judges scores the report.
- The worked example, the seller adapter's template, the stub seller API's report and the "Writing checks for a report" section of `site/llms.txt`, all in the new shape.

**Non-goals.**
- No change to `spec/schemas/` and no change to the check library.
- No firm's report layout, headings, wording, pricing or command names. The report shape and the samples are generic and written for this task.
- No new cross-field rule (a line range that ends before it starts, two findings with one id). The subset cannot say them (T-317 Handoff, limit 3).
- No setting in the adapter's scope for the proof term. The seller sets it in its template file.

## Context

- `docs/tasks/T-317-audit-report-template.md`: the template this task loosens, its decisions and its known limits.
- `packages/judgment/src/checks/json-schema.ts`: the supported keywords.
- `fixtures/README.md`: scenario, terms, data and recording layout.
- `CLAUDE.md`, "Parametrize, don't restrict" (D31) and "agreed terms bind" (D28): the checks are the contract, and the parties set their values.

## Acceptance criteria

- [ ] `fixtures/terms/audit-report.yaml` loads through the testkit, and every check passes `validateCheck`.
- [ ] A finding with two locations passes. A location with a file only passes. A finding with no location fails `report`. A location whose file is outside the scope fails `scope`, whichever location it is.
- [ ] A Medium finding without proof-of-concept files fails `proof` and only `proof`. With the threshold moved to High the same report passes. With the `proof` check removed a Critical finding without proof passes.
- [ ] A finding without `impact` passes. A report with `summary` and `reportDate` passes, and so does one without them. A finding with `status` open, fixed or acknowledged passes; another status fails `report`.
- [ ] A report with no findings passes all five checks. The agreed files in another order pass. A missing file fails `coverage` and only `coverage`.
- [ ] `pnpm snap` passes: `audit-report-accepted` and `audit-report-reordered` end Released, `audit-report-missing-file` ends Refunded, and the new `audit-report-rubric-accepted` runs the panel and ends Released.
- [ ] `spec/examples/commitment.audit-report.example.json` passes `pnpm validate:spec`, and its `id` is the commitment ID of its body.
- [ ] `examples/seller-adapter.template.json`, filled with the sample scope, equals the terms file's acceptance block; the stub's report passes the checks (the adapter's own tests).
- [ ] `site/llms.txt`, "Writing checks for a report", shows the locations recipe and the proof term; each recipe is a check the interpreter accepts (test). `node site/build.mjs && node site/check.mjs` passes.
- [ ] `spec/schemas/` is unchanged.
- [ ] No name of a customer, design partner or audit firm appears in the change.

## Out of scope

- The end-to-end deal on the adapter and the buyer signer (T-321).
- The judges' 100,000-character read limit and binding the check library's version (T-317 Handoff, limits 1 and 2).

## Evidence

All runs on 2026-11-11, on branch `t-320-audit-template-fit` cut from `origin/main` at `b13cfa7`.

- **Test first (measured).** With the test rewritten and the template unchanged, `pnpm exec vitest run tests/audit-report-template.test.ts` failed 19 tests. With the new scenario and no recordings, `pnpm snap audit-report-accepted audit-report-missing-file audit-report-reordered audit-report-rubric-accepted` printed "0 passed, 4 failed".
- **The template test (measured).** `pnpm exec vitest run tests/audit-report-template.test.ts`: 1 file, 39 tests passed.
- **Snapshots (measured).** `pnpm snap`: 35 passed, 0 failed. Four `audit-report-*` snapshots changed or are new, and no other snapshot changed:
  - `audit-report-accepted`, `audit-report-reordered`: the checks line reads `report ✓ · proof ✓ · scope ✓ · coverage ✓ · hidden ✓`; the report is 5,098 bytes (was 4,507); the commitment ID and the hashes follow the new terms. Released.
  - `audit-report-missing-file`: `coverage ✗ (schema: /filesReviewed: fewer than 3 items)`, the other four checks pass; 5,063 bytes. Refunded.
  - `audit-report-rubric-accepted` (new): the five checks pass, then a panel of 3 scripted judges from 2 families scores 4/4/4/4/4 each; aggregate accept, weighted score 4.00. Released. The recordings say `capturedFrom: fake`.
- **Tests that read the template, the reports and the example (measured).** `pnpm exec vitest run tests/ examples/seller-adapter.test.ts examples/check-delivery.test.ts packages/judgment/src/preflight.test.ts packages/core/src/parse.test.ts packages/core/src/validators.test.ts apps/demo-cloud/src/startup.test.ts packages/testkit/src examples/try.test.ts examples/examples.test.ts`: 36 files; 693 tests passed and 1 skipped, after one byte count in `examples/check-delivery.test.ts` moved from 3,841 to 5,063.
- **Spec (measured).** `pnpm validate:spec`: 35 of 35 examples valid; `spec/openapi.json` fresh. `git diff spec/schemas` is empty.
- **Site (measured).** `node site/build.mjs && node site/check.mjs`: "site check PASS". The build left `site/index.html` and `site/try.mjs` unchanged.
- **Types and lint (measured).** `pnpm typecheck` exits 0. `pnpm lint` prints nothing.
- **Fit to published reports (inferred).** The measurement of the eight reports is private and this task did not rerun it. The five listed blockers (one location per finding, a required line range, a required excerpt, a required impact, proof from Medium up) are each now optional or a term; tests show a report without each one passing.
- **Not run.** The full `pnpm verify` (the recipe keeps it for deploys) and gitleaks, which is not installed on this machine. CI runs both gates.

## Decisions

1. **The proof term is a check of its own, `proof`.** The `report` check keeps the shape of `pocFiles`; `proof` says which severities must carry them. A deal moves the threshold by editing one list, or drops the term by leaving the check out. A failed proof rule now names itself: the failed check is `proof`, not `report`.
2. **The `proof` check lists the severities that need no proof.** A severity outside the scale then needs proof, which is the safe side. The description states the same term in words ("rated Medium or higher"), and a test holds the two together.
3. **Five checks, in the order `report`, `proof`, `scope`, `coverage`, `hidden`.** T-317 chose one rule per check so the failed check's id names the rule; this keeps that.
4. **A location is `{file, lines?, excerpt?}` with no other property.** The `scope` check requires the `locations` list and holds each `file` to the scope. A finding with no location fails `report` and `scope`.
5. **`status` is one of open, fixed, acknowledged.** The words are template values, like the severity scale. `summary` holds up to 5,000 characters and `reportDate` is `YYYY-MM-DD`.
6. **The finding id pattern, `rootCause` and `recommendedFix` stay as they were.** The brief did not list them. The id pattern (`F-` and 2 to 4 digits) is a template value a seller changes when its ids differ.
7. **The rubric variant is a second terms file.** A scenario names one terms file, so the panel scenario needs `fixtures/terms/audit-report-rubric.yaml`. A test holds its deliverable and checks equal to the checks-only file's and its rubric equal to the worked example's.
8. **Three rubric criteria are reworded.** `root_cause` no longer assumes an excerpt, `impact` scores only the impacts a report states, and `severity` reads "what the finding describes". The ids, weights and threshold are unchanged.
9. **The sample report shows each loosened field.** F-02 has two locations, one with a file only; F-03 states no impact; the three findings carry the three statuses; the report has a summary and a date. The empty report's summary says it found nothing.
10. **The stub seller API writes its own summary.** It counts the job's files and findings, so the text is true for any scope a test sends.
11. **The adapter's template and the worked example are derived from the terms file.** Two one-off scripts in `reports/scratch` (not committed) wrote them, and the existing tests hold the three equal.

## Handoff

**Done.** The loosened template, the four sample reports, four scenarios with snapshots (one new, on the panel path), the rubric terms file, the worked example with a new `id`, the adapter's template, the stub's report and the `llms.txt` section. No schema change and no change to the check library.

**For T-321.** The stub seller API returns a report in the new shape, and `examples/seller-adapter.template.json` fills to the five checks. The sample scope (3 files, 3,000 lines) still prices at 2,000.00 tUSD with a 4-day window.

**Not done.**
- The site deploy that publishes the changed `llms.txt` section waits for Rafa.
- The recordings for the panel scenario are scripted stubs (`capturedFrom: fake`). No model has scored the sample report.
- The adapter has no scope field for the proof term. A seller sets it in its template file.
- Nobody reran the private measurement against the new shape (see Evidence, inferred).

**Known limits, unchanged from T-317.** The judges' 100,000-character read, the unbound check-library version, and no cross-field rules (a line range that ends before it starts, two findings with one id).

**How to resume.** Run `pnpm exec vitest run tests/audit-report-template.test.ts` and `pnpm snap audit-report-accepted audit-report-missing-file audit-report-reordered audit-report-rubric-accepted`. To change the template, change `fixtures/terms/audit-report.yaml` first, then copy the change to `audit-report-rubric.yaml`, the worked example and `examples/seller-adapter.template.json`; the tests name what still differs and print the commitment ID the example needs.
