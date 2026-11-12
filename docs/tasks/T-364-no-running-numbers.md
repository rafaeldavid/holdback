# T-364: No running numbers in the standing docs

- **Lane:** docs (change kind 1)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Depends on:** T-362
- **Paths this task may touch:** the standing docs (`README.md`, `contracts/README.md`, `formal/README.md`, the top-level `docs/*.md`), `tests/design-map.test.ts` for the check, this file; a second pull request for `CLAUDE.md` and `AGENTS.md`
- **Human gate:** no for pull request B; pull request A changes `CLAUDE.md`, a tier 3 file that Rafa merges
- **Status:** done on the merge of pull request B; pull request A waits for Rafa
- **Agent/session:** the T-362 implementer session, 2026-11-12

## Intent

Rafa, 2026-11-12, about PR 375: a doc that copies a number that keeps changing, such as "D1 to D63", needs a pull request each time the number moves. So the standing docs stop carrying such numbers. A count or ID range is removed or replaced by a pointer to its source. A value that lives in code or config becomes a variable that a build fills and a check compares, or the doc names the source file. Dated records keep their numbers, because each is a measurement at a time.

Outputs: the rule as its own section of `docs/writing.md`; the sweep of the standing docs (pull request B); the same sweep of `CLAUDE.md` (pull request A, tier 3); a check in `tests/design-map.test.ts`; and the list of values that should become variables.

Non-goals: `site/` (its values are checked variables already), the dated records (decisions, ADRs, `docs/decisions-today.md`, task files, reviews, research, deploy record lines), `docs/audit/` (re-cited at the freeze), and `spec/`.

## Acceptance criteria

- [x] `docs/writing.md` has a section "Numbers that drift" with the rule.
- [x] Every hand-written count or ID range in the standing docs is removed or points to its source; each kept number is a dated record, a target, a rule, a spec constant or an outside fact.
- [x] A check fails on an ID range or a test count in the standing docs, in about 20 lines.
- [ ] Pull request B merged with CI green; pull request A open with CI green.

## Numbers removed, per file

| File | Removed | Kept, and why |
| --- | --- | --- |
| `README.md` | 4: the scenario, fixture, todo and contract-test counts of 2026-11-06 | the gas figures and round 1's "15 of 16", each dated with its task |
| `contracts/README.md` | 8: 29 unit files, 13 cross-check files, 11 invariants, 256 runs and depth 100 (now "set inline in `RulesInvariants.t.sol`"), and the last run's 383 tests, 55 suites and 0 skipped | "the deployed commit `64be1f1` passed 241", pinned to a commit; "more than 40 minutes", quoted from `ci.yml`'s comment |
| `docs/architecture.md` | 3: "ADR-0001 to ADR-0026", "D1 to D54", "up to ADR-0030" | "after D40", a fact about the page's last revision |
| `docs/demo.md` | 2: "~3 minutes" and "about $3" become "a few minutes" and "a few dollars" | "within 5 minutes", a success criterion |
| `docs/neutrality.md` | 1: "Eleven exist" | |
| `docs/plan.md` | 4: "Phases 0 to 2" in the opening, and the index's 38 fixtures, 37 existing and 1 todo | every row's dated status, which is the plan's record |
| `docs/team.md` | 1: "15 tests" in the read-after-write rule | the dated reasons each rule was proposed |
| `docs/api.md` | 1: "about 170 lines" of `examples/verify.ts` | the values in the candidate list below, and the spec constants (test vectors, encoding limits, worked examples) |

Total: 24 numbers in 8 files [measured: counted from the diff]. `CLAUDE.md`, in pull request A: 4 (the two decision ranges with one date range, the liveness minutes, "Phases 0 to 2"); the Node and pnpm versions point to `package.json`. `AGENTS.md` has no number [measured].

Checked and left as they are: `formal/README.md`, `fixtures/README.md`, `tools/sim/README.md`, `docs/PRD.md` (its two "5 minutes" are targets), `docs/judgment-and-defenses.md` ("11 of 99" is a cited outside result), `docs/quickstart.md`, `docs/testing.md`, `docs/private-materials.md`, `docs/feature-map.md`, and the standing parts of `docs/operations.md` (Cloudflare's plan numbers are an outside fact read on a date; "about 10 minutes" is an order of size for a background run).

## What `docs/audit/` would change at the freeze

The pages are pinned to a commit, so their counts are records today. When the lane's docs package re-cites them, it could generate or drop:
- `scope.md:5`: the line count of the sources ("1,463 lines"), from `wc -l` at the frozen commit.
- `state-model.md:9, 11, 501, 502`: the row counts of the legal-state table (37, 20, 36, 17 rows) and `:546`, "21 tests": counts of the tables beside them and of `ZeroPrice.t.sol`.
- `threat-model.md:121`: "21 tests", the same file.
- `test-quality.md:9, 10, 15, 61, 88`: the coverage and mutation results (310 of 314, 79 of 92, 82 of 179, 179 mutants, 342 tests), which `contracts/scripts/coverage.mjs` and `mutate.mjs` write; the page could take them from the scripts' JSON output.

## Evidence

- Commands run and results [measured, 2026-11-12, branch `t-364-no-running-numbers` from `2377a7f`]:
  - `pnpm exec vitest run tests/design-map.test.ts`: 30 passed, the new check included. Its first case shows it catches all four sample lines and passes a dated line about one decision.
  - A scan of the standing docs for ID ranges, counts of tests, files, rows, lines, bytes, and run times, before and after: the counts above.
- Snapshot diffs: none.

## Decisions

- **`docs/api.md` keeps its operator and demo values for now.** It is the agent-facing reference. Removing a default or a cap from it would send an integrator to the source code. The ciphertext cap is already a checked variable: `apps/demo-cloud/src/world.test.ts` compares the doc with the node's cap. The others are in the candidate list, to wire the same way.
- **The check covers the two plainest patterns only** (an ID range, a count of tests) and leaves out `docs/plan.md` and `docs/operations.md`, whose rows and record lines are dated records with ranges in their titles. `CLAUDE.md` joins the list once pull request A merges.
- **Rough durations become words** ("a few minutes"), as the rule allows.

## Handoff

**Values that should become variables**, each with its source, for a later task to wire into a build and a check as `site/` does:

| Doc and line | Value | Source |
| --- | --- | --- |
| `docs/api.md`, "Size" and the ciphertext route | the demo's ciphertext cap, 1,048,576 bytes | `limits.maxCiphertextBytes` in discovery; `apps/demo-cloud/src/world.ts`. Already checked by `apps/demo-cloud/src/world.test.ts` |
| `docs/api.md`, references | the reference cap, 10,485,760 bytes | `packages/judgment/src/references.ts` (core's `MAX_CIPHERTEXT_BYTES`); its test checks the code, not the doc |
| `docs/api.md`, prepare defaults | 15 minutes to accept, 30 to fund, a day to deliver, 5 minutes per adjudicator | `apps/operator/src/terms.ts` |
| `docs/api.md`, verify | the clock window, 10 minutes behind and 60 seconds ahead | `examples/verify.ts` |
| `docs/api.md`, faucet | 1,000 test tUSDC per grant | `apps/demo-cloud/src/world.ts` |
| `docs/api.md`, demo timing | the demo club's windows from 60 seconds | the demo club's rulebook in `apps/demo-cloud/src/world.ts` |
| `docs/operations.md`, operator timeouts | a retry cadence that doubles to once a minute, for at most 15 minutes | `apps/demo-cloud/src/world.ts` and the timeouts pass |
| `contracts/README.md` | the invariant campaign's runs and depth | `contracts/test/invariant/RulesInvariants.t.sol` |
| `CLAUDE.md` | the Node and pnpm versions | `package.json` (`engines.node`, `packageManager`) |

**Not done.** No build or check wires any of these yet. `docs/audit/` waits for the freeze (above). `spec/README.md` has no number [measured].

**How to resume.** Read `docs/writing.md`, "Numbers that drift"; run `pnpm exec vitest run tests/design-map.test.ts`.
