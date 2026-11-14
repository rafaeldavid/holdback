# T-408: the seller adapter sends a start it cannot repeat safely at most once a deal

- **Lane:** demo (examples), the seller adapter
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4 (API and example code), from the Change recipes in `docs/team.md`: the examples' tests, one reviewer
- **Depends on:** T-366 (the adapter calls a seller's job API through a mapping); the High finding and the design are ADR-0037, section 6 (T-407, pull request 499, Proposed)
- **Paths this task may touch:** `examples/seller-adapter.ts`, `examples/seller-adapter-api.ts`, `examples/seller-adapter-job-api.test.ts`, `site/ref/seller-adapter.txt`, this file. Never: settlement, judgment, auth or the operators.
- **Human gate:** no. Rafa, 2026-11-14: "Go ahead on next steps that are possible", after the fix was recommended before the pilot's two scans. Nothing deploys.
- **Status:** done (PR 501, merge commit `f6b30a8`)
- **Agent/session:** the T-399 session, 2026-11-14, branch `t-408-start-once`

## Intent

The seller adapter starts the seller's job once the buyer's hold is funded. It sends the start with the deal's ID as an idempotency key and, when the call fails, sends it again at the next poll. That is safe only when the seller's API returns the same job for the same key. The pilot's seller has no idempotency key: it refuses a second launch with 409 while the first job runs, and charges a new one after it ends. So a start whose answer was lost made the adapter repeat it at every poll, never learn the job's ID, never deliver, and start a second, charged job once the first ended [read from code at `examples/seller-adapter.ts`, the `starting` branch; ADR-0037 section 1].

This task makes such a start a one-shot: sent at most once a deal, with the attempt recorded first. When no job ID comes back, the deal waits at a new stage, `start-unknown`, with one alert; a person finds the job at the seller's API and names it through a credentialed route, and the adapter follows that job. With no job named by `deliverBy`, the deal closes and the buyer may reclaim the hold.

## Acceptance criteria

- [x] `sellerApi.start.repeatable` (true or false); left out, a mapping is repeatable only when it names an `idempotencyHeader`. Today's three-address form stays repeatable.
- [x] A one-shot start is sent only while the hold is `Held` and `deliverBy` is ahead, and the attempt is recorded in the journal before the call.
- [x] A pass that finds a recorded attempt and no job ID never calls the start again: the deal moves to `start-unknown` and raises one `job.start_unknown` alert.
- [x] `POST /deals/<commitmentId>/job` with `{"jobId"}`, behind the ready credential, moves a `start-unknown` deal to `started` with that job; other stages answer 409, a wrong credential 401, a bad ID 400.
- [x] A `start-unknown` deal closes at `deliverBy`.
- [x] A journal written before this change cannot cause a second start.
- [x] The start-up log says when the start is a one-shot; the seller-adapter guide says how to name the job.
- [x] Existing behaviour holds: a repeatable start whose answer is lost is sent again under the same key and starts one job.

## Evidence

Measured on 2026-11-14 in the worktree `.worktrees/t-408-start-once`, cut from `origin/main`.

- **Test first.** The new test in `examples/seller-adapter-job-api.test.ts` failed before the change: `sellerApi.start has a field the adapter does not take: repeatable`.
- **After.** With the job stub's start set to `repeatable: false` and its first start answered 503 after making the run: the deal reached `start-unknown`; over the following polls the stub saw one start call in all; the log carried `job.start_unknown`; a wrong credential got 401, an empty ID 400; naming job 41 got 202, the deal was `Released`, one delivery, one run; naming it again got 409.
- **Tests.** `vitest run examples/seller-adapter-job-api.test.ts examples/seller-adapter.test.ts`: 2 files, 67 tests passed, the existing lost-answer test for a repeatable start among them. The whole `examples/` suite: 34 files, 419 tests passed, 24 skipped. `tsc -b examples` exit 0.
- **After the review (one reviewer: one Medium, four Low, all fixed).** A journal written before this change, with a `starting` deal and no attempt count, now reads as attempted: a test rewrites the journal that way, restarts the adapter, and sees `start-unknown` with still one start call. A named job that another deal in the journal holds answers 409 (read from code; no test). New tests: a mapping with no `idempotencyHeader` is a one-shot by default and with one is repeatable, the three-address form stays repeatable; an unknown deal on the job route answers 404; a `start-unknown` deal nobody names closes at `deliverBy` (the simulator's clock moved two days). The start-up line names the reason a start is a one-shot.
- **Site.** `node site/check.mjs` passed; no bundle changed.

## Handoff

**Done.** The one-shot start, the `start-unknown` stage, the job route and their test, and the guide's sentence. The guide reaches crow.direct with the next site deploy (Rafa's).

**For the pilot.** The kit's adapter configuration maps the partner's start with no `idempotencyHeader`, so it is a one-shot by default, and the kit already sets `redelivery.readyAuth`, so the job route is available. If a deal stops at `start-unknown`, find the job named `Crow deal <commitment ID>` in the workspace and name it: `POST /deals/<commitment ID>/job` with the ready credential.

**For ADR-0037 (T-407).** This is section 6, steps 1 to 5, in the Node adapter. The hosted design adds `/health` and the deploy guard; this task adds neither.
