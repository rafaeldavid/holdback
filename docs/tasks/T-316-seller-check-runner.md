# T-316: a check runner a seller runs on its delivery before it delivers

- **Lane:** judgment, with one example and two sentences of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 5, settlement and judgment code (Change recipes): one review, blocking findings only. The `llms.txt` sentences are kind 1.
- **Depends on:** T-008 (the check library), T-317 (the audit-report terms and sample reports, used as the sample deal)
- **Paths this task may touch:** `packages/judgment/src/intake.ts`, `packages/judgment/src/pipeline.ts`, `packages/judgment/src/preflight.ts`, `packages/judgment/src/preflight.test.ts`, `packages/judgment/src/index.ts`, `examples/check-delivery.ts`, `examples/check-delivery.test.ts`, `examples/package.json`, `examples/tsconfig.json`, `pnpm-lock.yaml` (the examples' workspace links only), `site/llms.txt`, `site/index.html` (only if the build regenerates it), this file. Never: `spec/schemas/`, `contracts/`, `packages/judgment/src/checks/`.
- **Human gate:** no. The site deploy that publishes the `llms.txt` sentences waits for Rafa.
- **Status:** in progress
- **Agent/session:** the T-316 and T-317 session, 2026-11-11, branch `t-316-seller-check-runner`

## Intent

Rafa asked on 2026-11-11 for a way for a seller to run the agreed deterministic checks on its own delivery before it delivers.

**Problem (measured).** The rules contract takes one delivery attempt: `contracts/src/HoldbackRules.sol` line 624 reverts when `dv.attempt != 1`. A failed required check refunds the buyer. Nothing in the repository lets a seller run the agreed checks on its own bytes first, so a seller learns that its file fails only after its one attempt is spent.

**Goal.** A seller runs one command on its own machine, on the exact bytes it will deliver, and gets the result the adjudicator's first stage gives for those bytes: the same pass or fail for each check, with the same detail, and the same refusal when intake would refuse the file.

**Inputs.**
- The terms as the seller signed them: a JSON file with `acceptance` and `deliverable.format`, as `GET /v1/commitments/{id}/terms` returns.
- The file to deliver, and any reference files a `reference_row_match_min` check names.

**Outputs.**
1. `preflightDelivery` in `packages/judgment/src/preflight.ts`, an importable function. It runs intake's rules for the plaintext (the MIME allowlist, the agreed format, the 10 MB cap, strict UTF-8) and then stage 1, the deterministic checks.
2. `examples/check-delivery.ts`, a command around that function: `node examples/check-delivery.ts <terms.json> <file>`. It prints one line per check and exits 0 when the checks do not refuse the file.
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

- [ ] `preflightDelivery` returns, for the same plaintext, MIME and acceptance, the `deterministic` outcomes `runPipeline` returns after `intake` on the encrypted delivery: same ids, `required`, `passed` and `detail`, in the same order (test, including a property test over changed reports).
- [ ] Its `result` is the adjudicator's decision when no panel sits: `reject` for a failed required check, `accept` for a checks-only deal that passes, `escalate` for a check that runs out of budget; and `panel` when a rubric deal passes its checks (test).
- [ ] For a file intake refuses (wrong MIME, another format than agreed, over 10 MB, not UTF-8), it returns the same refusal code as `intake`, runs no check, and `result` is `reject` (test).
- [ ] `intake` and `runPipeline` behave as before: the existing judgment tests pass unchanged.
- [ ] `node examples/check-delivery.ts <terms.json> <file>` runs as written (Node strips the types), prints one plain line per check, and exits 0 for accept or panel, 1 for reject, and 2 for escalate or a usage error (test, as a child process).
- [ ] The command's `--json` output equals the adjudicator's path on the T-317 sample deal: the passing report, the report that misses a file, and the reordered report (test).
- [ ] The runner makes no network call and executes nothing from the deliverable: it imports only `node:fs`, `node:path` and the workspace's own packages (test reads the imports).
- [ ] `site/llms.txt`, step 7, tells a seller to run the checks first; `node site/build.mjs && node site/check.mjs` passes.
- [ ] One review by the `reviewer` agent; blocking findings fixed.

## Out of scope

- The screen. A screen flag on a rubric deal escalates, and a seller cannot see it from this runner (Handoff).
- Sealed checks, which the seller cannot read by design.
- An HTTP endpoint for the same run. The seller's bytes stay on its machine.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

Choices made inside this task.

## Handoff

Not started beyond this file.
