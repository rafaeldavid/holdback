# T-323: a report converter in the seller adapter

- **Lane:** api (example code)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, API and example code (Change recipes): the examples' tests, no review. A target of 150k tokens.
- **Depends on:** T-316 (`preflightDelivery`, PR 278), T-318 (the seller adapter, PR 284), T-320 (the audit template's shape, PR 287)
- **Paths this task may touch:** `examples/report-converter.ts` and `examples/report-converter.test.ts` (new), `examples/seller-adapter.ts` (only the result-to-delivery path and the configuration field for the mapping), `examples/seller-adapter.test.ts` (new tests only), `examples/seller-adapter-stub.ts` (a second report shape only), new files under `fixtures/data/audit-report/`, `vitest.config.ts` (the new test file's cost line only), `site/llms.txt` (the seller section only), this file. Never: `packages/`, `apps/`, `spec/schemas/`, `contracts/`, `examples/buyer-signer.ts`, `examples/audit-deal.ts`, and the adapter's HTTP server, quote route and journal (T-324 rewrites those).
- **Human gate:** no. A site deploy that publishes an `llms.txt` change waits for Rafa.
- **Status:** done (PR 304, merged 2026-11-11)
- **Agent/session:** the T-323 session, 2026-11-11, branch `t-323-report-converter`
- **Roadmap:** N59

## Intent

Rafa asked on 2026-11-11 for the gaps that stop a real seller after the first audit deal on Sepolia. This is the first of them.

**Problem.** A seller's API already returns its report in its own JSON shape. The adapter delivers the result's bytes as they come, so today the seller must write code that rewrites its report into the audit template's shape before the adapter can deliver it.

**Goal.** The seller writes a mapping file, which is data, and the adapter converts each result with it before the check run. The seller writes no code.

**Inputs.**
- The mapping file, named in the adapter's configuration.
- The result's bytes from the seller's API: a JSON report in the seller's shape.

**Outputs.**
1. `examples/report-converter.ts`: it loads and checks a mapping file, and converts a report with it into the template's JSON. A report the mapping cannot convert is refused with a message that names the field. It also runs as a command, so a seller can try a mapping on one report before it sells.
2. In `examples/seller-adapter.ts`: a configuration field, `reportMapping`. When it names a mapping file, the adapter converts each result, then runs `preflightDelivery` on the converted bytes, and delivers those bytes. A result it cannot convert is not delivered, and the log names the field. When the field is absent, the adapter behaves as today.
3. Two report shapes under `fixtures/data/audit-report/`, each with its mapping. Both convert to the sample report, and a test runs both through the check run.
4. `examples/seller-adapter-stub.ts` can return its report in a seller's own shape, so a test runs a mapped deal end to end on SimChain.

**What a mapping can say.** Field paths into the report, constants, maps of enumerated values, lists mapped item by item, an optional field, a default, a field present only when another is, and a conversion between a whole number and its decimal text. Nothing more: nothing in a mapping, a scope or a report ever runs as code (hard rule: no code execution; deliverables are untrusted).

**Non-goals.**
- No expressions, string templates, arithmetic or regular expressions in a mapping.
- No change to the HTTP server, the quote route or the journal (T-324), to the buyer's signer, to `audit-deal.ts`, to any package or to `spec/schemas/`.
- No conversion of a format other than JSON.

## Context

- `docs/tasks/T-318-seller-adapter.md`: the adapter and its result-to-delivery path.
- `docs/tasks/T-320-audit-template-fit.md`: the shape a report must take to pass the template.
- `packages/judgment/src/preflight.ts` (T-316): the seller's check run.
- `examples/seller-adapter.template.json` and `fixtures/terms/audit-report.yaml`: the template's five checks.
- `CLAUDE.md`, hard rules: no code execution, deliverables are untrusted, no float in a hashed body.

## Acceptance criteria

- [x] A seller maps its API's report to the template's JSON with a mapping file and no code.
- [x] The converted report passes the seller's check run (`preflightDelivery`).
- [x] A fixture converts two differently shaped reports to the template, and a test runs both through the check run.
- [x] A report the mapping cannot convert is refused with a message that names the field, and is never delivered (test).
- [x] A mapping that holds anything but data is refused when it loads (test).
- [x] The adapter converts a result when its configuration names a mapping file, and behaves as today when it names none (test).
- [x] The converted report holds no number that is not a whole number (test).
- [x] `pnpm typecheck`, `pnpm lint` and the examples' tests pass.

## Out of scope

- The adapter as a service (N61, T-324), the buyer signer (N62, T-325), the audit deal script (N64, T-326), reference files (N66, T-327).
- N60 and N63, which wait for these to land.

## Evidence

All runs on 2026-11-11, on branch `t-323-report-converter`, cut from `origin/main` at `a310279`.

- **Test first (measured).** Before the converter existed, `pnpm build` failed on the new test with "Cannot find module './report-converter.ts'". With the converter and without the adapter change, `pnpm exec vitest run examples/seller-adapter.test.ts -t "own shape"` failed 3 of the 4 new tests: the mapped deal did not reach `Released`, the unconvertible report was refused by preflight and not by the converter, and a bad mapping file did not stop the adapter. The fourth test, no mapping, passed: it pins today's behaviour.
- **The converter's test (measured).** `pnpm exec vitest run examples/report-converter.test.ts`: 20 tests passed in about 2 s. Both report shapes convert to `fixtures/data/audit-report/report.json`, and `preflightDelivery` with the terms of `fixtures/terms/audit-report.yaml` passes all five checks and answers `accept` for each. A converted report without one file in scope fails `coverage` only. Refusals name the field for: a missing required field, a value outside the value map, text that is not a whole number, a fraction copied from the report, a list that is not a list, a report that is not JSON. A key hidden under `__proto__` reads as missing. A report value shaped like a directive is copied as data. A mapping with `$eval`, a bad `$as`, two sources, a path through `__proto__` or `constructor`, a key `__proto__`, a fraction, or another version is refused when it loads.
- **The adapter's test (measured).** `pnpm exec vitest run examples/seller-adapter.test.ts examples/report-converter.test.ts`: 36 tests passed in 4.9 s (16 for the adapter, 4 of them new). With `reportMapping` set, a result in the seller's own shape converts, passes preflight, and the deal ends `Released`; the buyer opens the sample report. With no mapping the same result fails preflight (`report`) and is not delivered. A result the mapping cannot convert is not delivered, the deal stays `Held`, no preflight runs, and the journal note names `findings[0].severity`. A mapping file with `$eval` stops the adapter at startup and names the file.
- **The tests fail on a broken converter (measured).** A converter that passed through a value its value map does not list failed 2 tests, one in each file. The file was restored after the run (`git diff` empty).
- **The examples and the site's tests (measured).** `pnpm exec vitest run examples tests/audit-report-template.test.ts tests/site-deploy.test.ts`: 23 files passed; 253 tests passed and 13 skipped, in 127 s.
- **The command (measured).** `node examples/report-converter.ts <shape-b mapping> <shape-b report>` printed the converted report. With the shape-A mapping on the shape-B report it printed "report-converter: commit: the report has no audit.revision.sha" and exited 1.
- **Types and lint (measured).** `pnpm typecheck` exits 0. `pnpm lint` prints nothing.
- **Site (measured).** `node site/build.mjs && node site/check.mjs`: "site check PASS". The build left `site/index.html` and `site/try.mjs` unchanged.
- **Not run.** The full `pnpm verify` (the recipe keeps it for deploys), `pnpm snap` (no scenario or judgment code changed) and gitleaks, which is not installed on this machine. CI runs them.

## Decisions

1. **A mapping is a tree in the template's shape.** A plain object or list in the mapping is the output object or list. A `$`-key object is a directive. A constant is written as it stands, so most of a mapping reads like the template it fills.
2. **Eleven directives, no more.** `$path`, `$const`, `$each` with `$item`, `$concat`, `$value`, and the modifiers `$map`, `$as`, `$optional`, `$default`, `$when`. Two report shapes needed each one: shape A's nested lists and optional spans, and shape B's flat main file plus other files (`$concat`) and line numbers as text (`$as: "integer"`). There are no expressions, templates or regular expressions.
3. **Absent and null are both missing.** Seller APIs write either for "none". A missing value refuses the report unless the node says `$optional` or `$default`.
4. **A refusal names the template field and the report's field.** For example `findings[0].severity: issues[0].risk is "severe", which the mapping does not list (…)`. The seller fixes either its mapping or its API from that line.
5. **The mapping is checked whole when it loads.** The adapter loads it at startup, so a bad mapping stops the adapter before it makes an offer, not when the first result arrives.
6. **Whole numbers only.** A constant in the mapping and a number copied from the report must be safe integers. A fraction refuses the report, so no float reaches the delivered bytes, which are hashed (`plaintextSha256`).
7. **Prototype keys are refused or unreadable.** A mapping may not name `__proto__`, `constructor` or `prototype` as a key or in a path. A path reads only a report's own properties.
8. **The converted bytes are fixed.** `JSON.stringify` with two-space indentation and a closing newline, so one report converts to the same bytes every time, and preflight checks the bytes the adapter delivers.
9. **A refused conversion is `refused` in the journal,** as a failed preflight is. The adapter does not retry it. The seller can deliver a corrected file by hand before `deliverBy`.
10. **The stub's second shape is shape A.** `report: 'own-shape'` answers the shape-A fixture rewritten for the job's scope, the same way the stub rewrites its `ok` report.

## Handoff

**Done.** The converter and its command, two report shapes with their mappings, the adapter's `reportMapping` field and its delivery-path hunk, the stub's second shape, tests for both files, and one bullet in the seller section of `site/llms.txt`.

**Not done.**
- The site deploy that publishes the `llms.txt` bullet waits for Rafa.
- The cost line of `examples/seller-adapter.test.ts` in `vitest.config.ts` still says 4 s; this task may not change it. The new test file needs no line (about 0.1 s of tests).

**For T-324 (the adapter as a service).** This task changed four places in `examples/seller-adapter.ts`: one import, the `reportMapping` field in `SellerAdapterConfig`, one line after `loadTemplate(c)`, and the conversion just before preflight in `advance()`. None is in the HTTP server, the quote route or the journal.

**Known limits.** Path keys hold letters, digits, `_` and `-` only. JSON only. `$each` on an empty list gives an empty list, which the template's `pocFiles` refuses (at least one item). Each sits in the triage file for the coordinator.

**How to resume.** Run `pnpm exec vitest run examples/report-converter.test.ts examples/seller-adapter.test.ts`. To try a mapping: `node examples/report-converter.ts fixtures/data/audit-report/seller-shape-a.mapping.json fixtures/data/audit-report/seller-shape-a.report.json`.
