# T-019: Demo honesty and clarity for an AI-lab reader

- **Lane:** demo
- **Phase:** 1
- **Depends on:** T-013, T-017, D25, D26
- **Paths this task may touch:** `apps/demo/src/`, `apps/demo/agents/bench.ts`, `docs/demo.md`
- **Human gate:** no
- **Status:** review
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

- **Measured:** `pnpm verify` on the committed tree: typecheck, lint, test (64 files, 1,879 tests), spec, snap (25 passed), demo all pass; report `reports/verify-t-019-demo-honesty.md`.
- **Measured:** tests were written first (commit `b85bd67`); before the implementation, `honesty.test.ts` and `record.test.ts` failed to load (missing modules) and the new `simchain.test.ts` cases failed.
- **Measured:** `pnpm demo` writes "Mode: scripted. Judges are fake providers that return a fixed verdict: no model was called in this run." in every beat file; `grep -c "recorded verdicts" demo/out/*` is 0; no `T-0` in any source line. The viewer prints "Mode: scripted" once (`grep -o` count 1).
- **Measured:** commitment IDs: beats 1 to 4 `0x87437a1c…` (one job), beat 5 `0x5a2c4e62…`, beat 6 `0x86e01f06…`, beat 10 `0x370f9e9b…`; four distinct seed commitments (`simchain.test.ts`).
- **Measured:** beat 3 timeline, one run: checks and screen +51 ms (service run start), panel and judge prompt +334 ms (last verdict), decision +344 ms: "Decision 294 ms after delivery; judging took 293 ms (panel 55 ms)". Wall-clock, so the numbers vary between runs.
- **Measured:** beat 3 shows seat 1 (`placeholder-qwen-a-20260601`, qwen): the 20-line system message whole, the 1,861-line user message with its first 9 data lines and its last, "1,847 lines of the data section omitted", and the verdict JSON, labelled scripted.
- **Measured:** the hostile-text test now includes a judge-prompt event whose system message, data lines, criterion ID, evidence, injection evidence and rationale all carry the hostile payload: terminal lines have no escapes, bidi or tag characters; Markdown keeps the payload's line breaks only inside fences that close where the renderer closed them (the test parses the fences); HTML and JSON carry no markup or invisible characters.
- **Measured:** beat 5's Markdown has 3 balance tables (was 5); beat 3 has none (no money moved in it). Total Markdown output 777 lines (was 793) with the judge prompt added.
- **Measured:** shared record (D26), one run: beat 1 "4 settlement events, 4 operator receipts"; beat 4 "9 settlement events, 9 operator receipts, judgment record 0xb1cfe44f…, decision 0x35055317…"; beats 5, 6 and 10 likewise; every line says "both copies match". `record.test.ts` shows a missing receipt or a judgment record that is not the one the decision names turns `match` false and the line says "DIFFER".
- **Inferred:** T-018 will conflict in `simchain.ts`, `demo.ts`, `simchain.test.ts`, `render.test.ts`, `narrate.test.ts` and `untrusted.test.ts` (they use `standInSource`). The new tests in `honesty.test.ts` and `record.test.ts` use hand-built transcripts and do not depend on the stand-in.

## Decisions

- **Mode union keeps `recorded`.** `mode` is now `'scripted' | 'recorded' | 'live'`; `recorded` means replayed real model recordings (snap, later). `stand-in.ts` still says `recorded` and is out of bounds, so `demo.ts` relabels stand-in beats `scripted`. When T-018 deletes the stand-in, that line goes too.
- **Seeds:** beats 1 to 4 are one job on seed 7 (beat 1's hold is the hold judged in beat 3); beat n's job uses seed 7 + n (`seedOf`). Agent addresses differ between jobs as a result; the transcripts rarely show them.
- **Timing:** both options in the criterion. `ServiceBench.judge` records `performance.now()` around the service run and around every judge call. Checks and screen are stamped when the run began, the panel and judge prompt when the last verdict returned (clamped between the previous settlement event and the decision), and the decision line states "N ms after delivery; judging took M ms (panel P ms)". The marks reach the source through `judgingTimeOf(commitmentId)` in `bench.ts`, because `JobResult` (in `beats.ts`, outside this task's paths) does not carry the `JudgeReport`. `JudgeReport.timing` is set too, but optional so other seams compile unchanged.
- **Judge prompt:** seat 1 only, matched to its request by judge ID and model. The system message is shown whole; the user message keeps everything up to the data marker plus 9 data lines, then the last data line and the end marker, with the omitted count stated outside the fence so data cannot fake it. Lines are made plain at ingestion (`judge.ts`) and again in each renderer. In Markdown the section comes last, after the signed message, so everything before it is escaped prose.
- **Header once:** the viewer prints the most common mode and source plus units once; each beat prints "Shows" and only the mode or source that differs (beat 6 and beat 7 print their own source). The terminal does the same, keyed to the first beat. Per-beat Markdown files keep the full header, since each file stands alone.
- **Lean balances:** a snapshot renders when it differs from the one before; the first renders as the starting point only if a later one differs.
- **Closing:** residuals 3, 5, 6 and 8 from `docs/neutrality.md`, keeping its numbers; residual 5's line notes that both parties hold the same signed record (D26).
- **Shared record (D26):** each party gets its own `world.sdk()` client and fetches the commitment view, every event, every receipt, and the judgment record named by the decision event; the copy is hashed with `canonicalKeccak`. `match` requires equal hashes and that each copy is whole (a receipt per event, and the judgment record the decision names). Both clients use the default operator order. Reading through different operators would make the receipts differ by signer, and the SDK does not report which operator answered a read, so the line makes no "via" claim. The judgment record is resolved from what the bench published (`JobResult.record`); there is no read API for records yet. It appears once per job: at the end of beats 1, 4, 5, 6 and 10 (beats 2 and 3 are the middle of the beat 1-4 job).

## Handoff

- PR: https://github.com/rafaeldavid/holdback/pull/51
- For T-018: `runJob` now takes a seed (`seedOf(beat)`), and every run ends with a `shared-record` event. A new SimChain beat 7 or 6a gets both for free if it goes through `runJob` and `Narrator`. Its transcript should set `mode: 'scripted'` (`transcript()` already does). When the stand-in is deleted, drop the `mode: 'scripted'` override in `demo.ts` and the `'recorded'` wording tests that read stand-in output.
- Follow-ups (not done here): carry `JudgeReport.timing` on `JobResult` (one line in `beats.ts`) and remove `judgingTimeOf`; an SDK read that reports which operator answered, so each party can read through a different operator and the line can say so; a published-record read API so parties fetch the judgment record themselves; receipts as narrated events (review "Missing").
