# T-019: Demo honesty and clarity for an AI-lab reader

- **Lane:** demo
- **Phase:** 1
- **Depends on:** T-013, T-017, D25, D26
- **Paths this task may touch:** `apps/demo/src/`, `apps/demo/agents/bench.ts`, `docs/demo.md`
- **Human gate:** no
- **Status:** done
- **Agent/session:** implementer, branch `t-019-demo-honesty`

## Intent

Make every label in the transcripts and viewer true, and give the beat an AI lab cares most about (judging) real content.

In my words: a researcher reading `demo/out/` must never be told something the run did not do. The judges are fake providers, so the transcripts say "scripted", not "recorded"; the source line describes what ran without our task IDs; the viewer and terminal stop repeating the same four-line header eight times. Each job gets its own seed, so a "second job" no longer shows the first job's commitment ID and seed commitment. The judging sub-steps get times measured by the adjudicator service itself, and the decision line says how long after delivery it came and how long judging took. Beat 3 shows what a judge actually saw (one prompt, abridged in the middle of the data section with the count of lines left out) and what it answered, collapsed in the viewer; both are untrusted text and go through the untrusted-output helpers on every surface. Balance tables appear only when money moved; the closing names the four residual risks an AI lab will ask about and points to `docs/neutrality.md` for the rest. Added mid-task (D26, coordinator): each job ends with one measured line showing both agents hold the same record.

Non-goals: beats 6a and 7 on SimChain and deleting the stand-in source (T-018); one driver for snap and demo; receipts as narrated events; live judges; any change to `stand-in.ts`, `packages/testkit` or `agents/beats.ts`.

## Context

- `docs/reviews/2026-10-31-build-and-simplification-review.md` proposals 3–7; D25.
- D26 (both parties hold the same complete record), added by the coordinator during the task.

## Acceptance criteria

- [x] Honest labels: `recorded` becomes `scripted` wherever fake judges run; the Source line drops task IDs ("scripted agents over the operator API; the adjudicator service with scripted judges"); the header prints once in the viewer.
- [x] One commitment ID per job: each beat's world gets its own seed, so beats 5 and 10 have their own IDs and seed commitments.
- [x] Judging time that means something: stamp checks, screen and panel from the adjudicator service, or one line "decision N ms after delivery; judging took M ms".
- [x] Beat 3 shows one judge prompt and one verdict, collapsed like the signed message, through the untrusted-output helpers.
- [x] Balance tables render only when the ledger changed; the closing lists four residual risks with a pointer to `docs/neutrality.md`.
- [x] `pnpm verify` green; tests updated.
- [x] D26 (added): each SimChain job ends with a measured shared-record line, with a test.

## Evidence

- **Measured:** `pnpm verify` on a clean tree after the PR 51 review fixes and the merge of origin/main (PR 50): typecheck, lint, test (65 files, 1,908 tests), spec, snap, demo all pass; report `reports/verify-t-019-demo-honesty.md`.
- **Measured:** tests were written first (commit `b85bd67`); before the implementation, `honesty.test.ts` and `record.test.ts` failed to load (missing modules) and the new `simchain.test.ts` cases failed.
- **Measured:** `pnpm demo` writes "Mode: scripted. Judges are fake providers that return a fixed verdict: no model was called in this run." in every beat file; `grep -c "recorded verdicts" demo/out/*` is 0; no `T-0` in any source line. The viewer prints "Mode: scripted" once (`grep -o` count 1).
- **Measured:** commitment IDs: beats 1 to 4 `0x87437a1c…` (one job), beat 5 `0x5a2c4e62…`, beat 6 `0x86e01f06…`, beat 10 `0x370f9e9b…`; four distinct seed commitments (`simchain.test.ts`).
- **Measured:** beats 1 to 4 are slices of one run on one world (review finding 1; before the fix, beat 1 ran in its own world and its hold at +75 ms preceded beat 2's delivery at +53 ms). Now the stamps run 30, 44, 120, 120, 133, 167 ms (beat 1), 227 ms (beat 2), 534 to 620 ms (beat 3), 620 to 947 ms (beat 4). `simchain.test.ts` asserts the timeline across beats 1 to 4 never goes backwards, beat 2's ledger starts where beat 1's ends, and only beat 1 carries the negotiation and profiles.
- **Measured:** beat 3, one run: decision "280 ms after delivery; judging took 279 ms: reading the delivery and fetching its ciphertext 1 ms, decrypting, checks and screen 221 ms, panel of 3 scripted judges 48 ms, aggregating and publishing the signed record 3 ms, signing and submitting the decision 6 ms". Checks and screen are stamped when the first judge is called, the panel when the last verdict returns. A test asserts the parts sum to the judging time, for beat 3 (panel) and beat 5 (no panel). Wall-clock, so numbers vary between runs.
- **Measured:** beat 3 shows seat 1 (`placeholder-qwen-a-20260601`, qwen): the 20-line system message whole, the 1,861-line user message with its first 9 data lines and its last, "1,847 lines of the data section omitted", and the verdict JSON, labelled scripted.
- **Measured:** the hostile-text test now includes a judge-prompt event whose system message, data lines, criterion ID, evidence, injection evidence and rationale all carry the hostile payload: terminal lines have no escapes, bidi or tag characters; Markdown keeps the payload's line breaks only inside fences that close where the renderer closed them (the test parses the fences); HTML and JSON carry no markup or invisible characters.
- **Measured:** beat 5's Markdown has 3 balance tables (was 5); beat 3 has none (no money moved in it). Total Markdown output 776 lines (was 793) with the judge prompt added.
- **Measured:** shared record (D26), one run, at the end of beats 4, 5, 6 and 10 (each job's end): "Ledger through op-1, Tide-7 through op-2, by the operator that signed each copy's receipts: 9 settlement events, 9 operator receipts, judgment record 0xb1cfe44f… as Clearfield Adjudication published it, by the hash the decision names, decision event 0x35055317…; … receipt signers aside: both copies match". The test asserts the routes from the receipts' signers. `record.test.ts` asserts that `match` turns false when a receipt is missing, when an event payload differs in an otherwise whole copy, when a receipt attests a different event hash, or when the judgment record is not the one the decision names; and that copies whose receipts differ only by signer and signature still match.
- **Measured:** the prompt cut takes the nonce from the begin marker and searches for the exact end marker from the end. A test inserts a wrong-nonce end marker and a mid-data copy of the real one, and the cut does not move.
- **Inferred:** T-018 will conflict in `simchain.ts`, `demo.ts`, `simchain.test.ts`, `render.test.ts`, `narrate.test.ts` and `untrusted.test.ts` (they use `standInSource`). The new tests in `honesty.test.ts` and `record.test.ts` use hand-built transcripts and do not depend on the stand-in.

## Decisions

- **Mode union keeps `recorded`.** `mode` is now `'scripted' | 'recorded' | 'live'`; `recorded` means replayed real model recordings (snap, later). `stand-in.ts` still says `recorded` and is out of bounds, so `demo.ts` relabels stand-in beats `scripted`. When T-018 deletes the stand-in, that line goes too.
- **Seeds and one run for beats 1 to 4:** beats 1 to 4 are one run on seed 7, sliced by phase (`happyJob` in `simchain.ts`: `beatHold` with the negotiation observer, then the same steps as `beatHappyPath`, which cannot take an observer without touching `beats.ts`). Beat n's own job uses seed 7 + n (`seedOf`). Agent addresses differ between jobs as a result; the transcripts rarely show them.
- **Timing:** `ServiceBench.judge` records `performance.now()` around the service run and around every judge call, and `BenchDirectory` marks when the ciphertext was fetched and the judgment record published. Checks and screen are stamped when the first judge is called (with no panel: when the record is published), the panel and judge prompt when the last verdict returns, all clamped between the previous settlement event and the decision. The decision line names the parts, which sum to the judging time. The marks reach the source through `takeJudgingTime(commitmentId)` (read once, then forgotten; `clearJudgingTimes()` runs before each world), because `JobResult` (in `beats.ts`, outside this task's paths) does not carry the `JudgeReport`. `JudgeReport.timing` is set too, but optional so other seams compile unchanged.
- **Judge prompt:** seat 1 only, matched to its request by judge ID and model. The system message is shown whole; the user message keeps everything up to the data marker plus 9 data lines, then the last data line and the end marker, with the omitted count stated outside the fence so data cannot fake it. The cut uses the begin marker's nonce and the exact end marker, searched from the end, so a data line that imitates a marker cannot move it. Lines are made plain at ingestion (`judge.ts`) and again in each renderer. In Markdown the section comes last, after the signed message, so everything before it is escaped prose.
- **Header once:** the viewer prints the most common mode and source plus units once; each beat prints "Shows" and only the mode or source that differs (beat 6 and beat 7 print their own source). The terminal does the same, keyed to the first beat. Per-beat Markdown files keep the full header, since each file stands alone.
- **Lean balances:** a snapshot renders when it differs from the one before; the first renders as the starting point only if a later one differs.
- **Closing:** residuals 3, 5, 6 and 8 from `docs/neutrality.md`, keeping its numbers; residual 5's line notes that both parties hold the same signed record (D26).
- **Shared record (D26):** Ledger's SDK client tries op-1 first and Tide-7's tries op-2 first. Each fetches the commitment view, every event and every receipt. The route is measured, not assumed: each operator signs its own receipts, and each operator's `/v1/status` gives its receipt signer, so the line names the operator that signed every receipt in that copy. The copy is hashed with `canonicalKeccak` after dropping the receipts' signer and signature (which differ by operator), and the line says "receipt signers aside". `match` requires equal hashes and that each copy is whole (a receipt per event, and the judgment record the decision names). The judgment record is the one Clearfield published (`JobResult.record`), found by the hash the decision event names, because there is no read API for records yet; the line says so. It appears once per job, at its end: beats 4, 5, 6 and 10.

## Handoff

- PR: https://github.com/rafaeldavid/holdback/pull/51
- PR 51 review (5 findings plus stale wording) addressed in commits `a10090c` (tests first), `ab3ba92` and `1eda473`.
- For T-018: `runJob` now takes a seed (`seedOf(beat)`), beats 1 to 4 come from `happyJob`, and every run ends with a `shared-record` event read through op-1 and op-2. If beat 7 makes op-1 refuse, check the record line's routes still hold (the SDK falls over to op-2, so Ledger's copy would then be signed by op-2). A new SimChain beat 7 or 6a gets both for free if it goes through `runJob` and `Narrator`. Its transcript should set `mode: 'scripted'` (`transcript()` already does). When the stand-in is deleted, drop the `mode: 'scripted'` override in `demo.ts` and the `'recorded'` wording tests that read stand-in output.
- Follow-ups (not done here): carry `JudgeReport.timing` on `JobResult` (one line in `beats.ts`) and remove `takeJudgingTime`; give `beatHappyPath` an `observe` option so `happyJob` can call it instead of repeating its steps; a published-record read API so parties fetch the judgment record themselves; verify receipt signatures in the shared-record comparison (the SDK's opt-in `verifyReceipts`, backlog); receipts as narrated events (review "Missing").
