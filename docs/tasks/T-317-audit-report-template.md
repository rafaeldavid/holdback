# T-317: a deal template for a security-audit report

- **Lane:** demo (terms and data fixtures), test (scenarios), with one section of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 1 and 2 (Change recipes): agent docs, fixtures and a test. No code in `packages/judgment`.
- **Depends on:** T-008 (the `json_schema` check), T-016 (the testkit runs `@holdback/judgment`)
- **Paths this task may touch:** `fixtures/terms/audit-report.yaml`, `fixtures/data/audit-report/`, `fixtures/scenarios/audit-report-*`, `fixtures/README.md` (one table row), `spec/examples/commitment.audit-report.example.json`, `site/llms.txt`, `site/index.html` (only if the build regenerates it), `tests/audit-report-template.test.ts`, this file. Never: `spec/schemas/`, `packages/judgment/`.
- **Human gate:** no. The site deploy that publishes the new `llms.txt` section waits for Rafa.
- **Status:** done (PR 273, merged 2026-11-11)
- **Agent/session:** the T-316 and T-317 session, 2026-11-11, branch `t-317-audit-report-template`

## Intent

Rafa asked on 2026-11-11 for a generic template for work delivered as one JSON document: the findings report of a code audit.

**Goal.** A buyer and a seller can copy one set of terms for an audit report and get a deal the deterministic checks alone can decide. The checks say what a complete report is: its shape, the commit it reviewed, the files it covered. A report that meets them releases the price; one that misses them refunds the buyer.

**Inputs.**
- The `json_schema` check as it stands (`packages/judgment/src/checks/json-schema.ts`). It walks a subset of JSON Schema as data and refuses any keyword outside it. It has no `contains`, `if`, `then` or `$ref`.
- The `hidden_characters_max` check.
- The commitment schema v0.7 (`spec/schemas/commitment.schema.json`): deliverable kind `document`, format `application/json`.

**Outputs.**
1. A terms template, `fixtures/terms/audit-report.yaml`, checks-only by default, with four required checks:
   - `report`: the report's shape. Each finding has an id, a severity from a fixed list, a title, a file, a line range, a quoted code excerpt, a root cause, an impact and a recommended fix. A finding of Medium or higher also carries proof-of-concept files (`anyOf`).
   - `scope`: the report names the agreed commit (`const`), and every finding's file is in the agreed scope (`enum`).
   - `coverage`: the list of files reviewed equals the agreed scope in any order (`uniqueItems`, equal `minItems` and `maxItems`, `items.enum`).
   - `hidden`: no hidden characters (`hidden_characters_max`, total 0).
2. An optional rubric of five criteria a judge can score from the report alone, shown in the worked example.
3. Three scenario fixtures with snapshots: a passing report releases, a report that misses one in-scope file refunds, and the same files in another order release.
4. A worked example, `spec/examples/commitment.audit-report.example.json`, that passes `pnpm validate:spec`.
5. A section "Writing checks for a report" in `site/llms.txt`: the `json_schema` keywords the interpreter supports and three recipes (pin a commit, require proof by severity, match a file list in any order).
6. A test that compares the keyword list in `llms.txt` with the interpreter's behaviour, and holds the example and the terms file to the same checks.

**Non-goals.**
- No change to `spec/schemas/`. If the template needs one, this task stops and says so in the Handoff.
- No change to the check library. The template uses only keywords the interpreter supports today.
- No customer's or firm's report format, pricing or command names. The report shape, the severity scale and the sample findings are written for this task.
- No scenario for the rubric variant. A panel run needs recorded verdicts; the test checks only that the rubric and its text are valid.
- No fix for the two known limits (the judges' 100,000-character read and the unbound check-library version). The Handoff states what a follow-up needs.

## Context

- `docs/api.md`, "Writing checks that resist a seller doing the minimum": on a checks-only deal the checks are the whole contract (D28).
- `CLAUDE.md`, "agreed terms bind": a buyer who wants protection writes it into the checks before agreeing (D28, D32).
- `fixtures/README.md`: scenario, terms and data layout.
- `packages/judgment/src/checks/json-schema.ts`: the supported keywords.
- `packages/judgment/src/prompt.ts`: `DEFAULT_MAX_DATA_CHARS`, the judges' read limit.

## Acceptance criteria

- [x] `fixtures/terms/audit-report.yaml` loads through the testkit (valid under `commitment.schema.json`), and every check passes `validateCheck`.
- [x] `pnpm snap` shows `audit-report-accepted` ending Released, `audit-report-missing-file` ending Refunded on the `coverage` check, and `audit-report-reordered` ending Released.
- [x] A report with no findings passes all four checks (test).
- [x] A Medium finding without proof-of-concept files, a report at another commit, and a finding in a file outside the scope each fail the named check (test).
- [x] `spec/examples/commitment.audit-report.example.json` passes `pnpm validate:spec`; its `id` is the commitment ID of its terms; its deliverable and checks equal the terms file's (test).
- [x] The example's rubric passes `validateRubric`, and its text passes `validateTerms` (test).
- [x] `site/llms.txt` has the section "Writing checks for a report" with the keyword list and the three recipes; a test fails when the list and the interpreter differ; each recipe in the section is a check the interpreter accepts (test).
- [x] `node site/build.mjs && node site/check.mjs` passes.
- [x] No name of a customer, design partner or audit firm appears in the change.

## Out of scope

- Cross-field rules the subset cannot say: a line range whose end is before its start, and two findings with the same id. The Handoff lists them.
- A report larger than the judges' read limit, and binding the check library's version in the adjudicator's policy (Handoff).

## Evidence

All runs on 2026-11-11, on branch `t-317-audit-report-template` cut from `origin/main` at `d218ebc`.

- **Test first (measured).** Before the snapshots existed, `pnpm snap audit-report-accepted audit-report-missing-file audit-report-reordered` printed "0 passed, 3 failed". Before the example and the `llms.txt` section existed, `pnpm exec vitest run tests/audit-report-template.test.ts` failed to load.
- **The template test (measured).** `pnpm exec vitest run tests/audit-report-template.test.ts`: 1 file, 34 tests passed.
- **The keyword test fails on a wrong list (measured).** With `contains` added to the supported list in `site/llms.txt`, and again with `not` removed from it, the test "lists exactly the keywords the json_schema interpreter supports" failed (1 failed, 33 passed each time). The file was restored after each run.
- **Snapshots (measured).** `pnpm snap`: 34 passed, 0 failed. Three snapshots are new and no existing snapshot changed:
  - `audit-report-accepted`: `report ✓ · scope ✓ · coverage ✓ · hidden ✓`, no panel, Released. The seller holds 1,500.00 tUSD and Bench A 25,050.00 tUSD.
  - `audit-report-missing-file`: `coverage ✗ (schema: /filesReviewed: fewer than 3 items)`, the other three checks pass, Refunded. The buyer holds 9,950.00 tUSD.
  - `audit-report-reordered`: all four checks pass, Released.
- **Spec (measured).** `pnpm validate:spec`: 35 of 35 examples valid; `spec/openapi.json` fresh.
- **Site (measured).** `node site/build.mjs && node site/check.mjs`: "site check PASS". The build left `site/index.html` and `site/try.mjs` unchanged.
- **Types and lint (measured).** `pnpm typecheck` exits 0. `pnpm exec eslint tests/audit-report-template.test.ts` prints nothing.
- **Tests that read the examples, the fixtures and the site (measured).** `pnpm exec vitest run tests/ packages/core/src/parse.test.ts packages/core/src/validators.test.ts apps/demo-cloud/src/startup.test.ts packages/testkit/src examples/try.test.ts`: 32 files passed; 636 tests passed and 1 skipped.
- **Sizes (measured).** The sample report is 4,507 bytes; the judges read up to 100,000 characters whole.
- **Not run.** The full `pnpm verify` (the recipe keeps it for deploys) and gitleaks, which is not installed on this machine. CI runs both gates.

## Decisions

1. **Three `json_schema` checks, not one.** `report`, `scope` and `coverage` each hold one rule, so the failed check's id tells the seller and the buyer which rule the report missed.
2. **`excerpt` is a required field of a finding.** The brief's field list did not name it. The rubric's first criterion compares the root cause with "the code excerpt the finding quotes", so a judge needs the excerpt in the report. One schema for both variants keeps the next build step to one file.
3. **A proof-of-concept file is a `{path, content}` object.** The deliverable is one document, so the report carries the file's text. Nothing runs it.
4. **`additionalProperties: false` on the report, each finding, each line range and each proof file.** A report cannot carry text outside the agreed fields.
5. **Text limits are template values.** `maxLength` is 200 characters for titles and paths, 2,000 for the prose fields and the excerpt, and 20,000 for a proof file. The parties change them when they copy the template (parametrize, do not restrict; D31).
6. **The rubric lives in the worked example only.** `fixtures/terms/audit-report.yaml` stays checks-only. A test holds the example's deliverable and checks equal to the terms file's, so the two cannot drift.
7. **The keyword test probes the interpreter.** It compiles a one-keyword schema for each of 63 JSON Schema keywords and reads the refusal. That needs no export from `packages/judgment`, so this change stays out of settlement and judgment code. The cost: a keyword outside that 63-word vocabulary would escape the comparison unless `llms.txt` lists it, in which case the test fails and names it.
8. **The example's `id` is real and its signature is a placeholder.** The test recomputes the commitment ID from the body. The seller signature is 65 bytes of `0xab`, as in the acceptance block of `commitment.example.json`.
9. **The sample reports are hand-written.** `report.reordered.json`, `report.missing-file.json` and `report.no-findings.json` are edits of `report.json`; the test holds each to its stated difference. The vault code, the findings and the severity scale are made up for this task.

## Handoff

**Done.** The template, three scenarios with snapshots, the worked example, the `llms.txt` section and the test. No schema change was needed.

**For the next build step.**
- The template's report schema is the `report`, `scope` and `coverage` checks in `fixtures/terms/audit-report.yaml`.
- The sample deliveries are in `fixtures/data/audit-report/`.
- The scenarios are `fixtures/scenarios/audit-report-accepted`, `audit-report-missing-file` and `audit-report-reordered`.
- T-316's check runner can take the terms file and any of the four reports as its sample deal.

**Not done.**
- No scenario runs the rubric variant. It needs recorded verdicts for three judges (`pnpm snap --judges fake --record --update <name>` writes stub ones).
- The site deploy that publishes the new section waits for Rafa.

**Known limits, each for a follow-up ticket.**

1. **The judges read 100,000 characters** (`DEFAULT_MAX_DATA_CHARS` in `packages/judgment/src/prompt.ts`). A JSON report over that size reaches the judges as an even-stride sample of its lines. A sampled read escalates the first decision, and an escalated appeal that read a sample accepts only on a whole, unanimous panel. The checks still run on the whole report. A report reaches the limit with five proof files of 20,000 characters each (inferred from the template's limits). A follow-up needs:
   - a seeded sample for JSON, as `sampleCsv` is for CSV rows: for example whole findings drawn by the panel seed, so the sample is unpredictable to the seller and does not escalate; or one panel read per finding with a rule for combining the reads;
   - an ADR, because either one changes a defense;
   - a fixture with a report over 100,000 characters that shows today's escalation and then the new behaviour.
2. **The adjudicator's policy does not bind the check library's version.** The policy binds `promptTemplateHash`, `aggregationVersion` and `screenVersion` (`spec/schemas/adjudicator.schema.json`), and nothing for the checks. Two adjudicators on different builds can disagree on the same schema, and a seller cannot tell which build will judge it. A follow-up needs:
   - a `CHECKS_VERSION` constant in `packages/judgment/src/checks/`, bumped when a check's result can change;
   - a `checksVersion` field in the adjudicator policy, which is a schema change with an ADR and a version bump, so `policyHash` covers it;
   - T-316's runner comparing its own version with the policy's and saying so when they differ.
3. **The subset has no cross-field rules.** A line range can end before it starts, and two findings can share an id. A follow-up would add a keyword or a check type, which is a schema change (ADR). Until then the rubric's `distinct` criterion covers duplicate findings on a rubric deal.
4. **Three checks parse the report three times.** The cost is small at this size (not measured beyond the 4,507-byte sample).

**How to resume.** Run `pnpm exec vitest run tests/audit-report-template.test.ts` and `pnpm snap audit-report-accepted audit-report-missing-file audit-report-reordered`. To change the example, change the terms file first, then the example; the test prints the commitment ID the new body needs.
