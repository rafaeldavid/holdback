# T-417: the seller adapter emits events for the seller's product metrics

- **Lane:** demo (examples), the seller adapter
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4 (API and example code), from the Change recipes in `docs/team.md`: the examples' tests, one reviewer
- **Depends on:** T-366 (the job API mapping), T-406 (unit pricing), T-408 (the one-shot start)
- **Paths this task may touch:** `examples/seller-adapter.ts`, `examples/seller-adapter-api.ts`, `examples/seller-adapter.test.ts`, `examples/seller-adapter-job-api.test.ts`, `site/ref/seller-adapter.txt`, this file, and T-408's status line. Never: settlement, judgment, auth, the operators or their telemetry.
- **Human gate:** no. Rafa, 2026-11-14: "Make sure the adapter and API have the right emissions of data to help the product development." Nothing deploys.
- **Status:** done (PR 507, merge commit `cdb4163`)
- **Agent/session:** the T-399 session, 2026-11-14, branch `t-417-adapter-events`

## Intent

The operators already emit what product work needs from the rails, with no addresses or content: daily stage counts and median times between stages, outcomes, error types per route, prepare-to-submit conversion and latency (T-031, `apps/demo-cloud/src/telemetry.ts`), and `scripts/metrics/` computes deal timing from the public event log. The seller adapter emitted human log lines only, and its journal kept no time per stage. So nobody could measure, for a seller Crow runs: how long a quote takes and how often it is refused, how long funding takes after the offer, how long the job waits in the seller's queue and runs, how long delivery takes, or how often a report is refused and redelivered.

This task adds an opt-in events file: one JSON line per event, with times and durations, and nothing of the report, keys, credentials, the buyer's address or the scope. The journal also records when each deal first reached each stage.

## The events (`schema: crow.seller-adapter.event/1`, with `at`, ISO time)

| `type` | Fields | When |
| --- | --- | --- |
| `quote.answered` | `commitmentId`, `ms`, `replayed` | A quote became an offer; `replayed` true when the same Idempotency-Key and body answered before |
| `quote.refused` | `status`, `reason` (the problem type), `ms` | The adapter refused a quote, the credential and rate-limit refusals included |
| `deal.offered` | `commitmentId`, `price` (token and base units), `units` (when priced per unit), `deliverWithinSec`, `sellerApiQuoteMs` | The offer is signed and journaled |
| `deal.stage` | `commitmentId`, `stage`, `from`, `secSinceOffered`, `secSincePrevious`; `startAttempts` on `started`; `refusals` on `refused`, `delivered`, `closed` | A deal reaches a new stage |
| `job.status` | `commitmentId`, `status` (the API's value, such as `queued`, one of the configured running values), `secSinceStarted` | The job reports a new status value; only when its state is read by a field |
| `job.done` | `commitmentId`, `secSinceStarted`, `bytes` | The job's result arrives |
| `delivery.refused` | `commitmentId`, `attempt`, `failedChecks` (IDs), `refusedCode` | The seller's check run refuses a result |

## Acceptance criteria

- [x] `events` in the configuration names the file; left out, nothing is written and behaviour is unchanged.
- [x] The events above, each one JSON line, with `schema` and `at`.
- [x] The journal records `times` per stage and `jobDone`.
- [x] No report content, credential, buyer address or scope reaches the file (test).
- [x] A file that cannot be written logs once and never stops the adapter.
- [x] The seller-adapter guide says how to turn it on and what it holds.

## Evidence

Measured on 2026-11-14 in the worktree `.worktrees/t-409-events`, cut from `origin/main` at `f6b30a8`.

- **End to end** (`examples/seller-adapter-job-api.test.ts`, "a funded deal starts one job…"): the file starts with `deal.offered` and `quote.answered` and holds `starting`, `started`, `job.status` `queued` before `running`, `job.done`, `delivering` and `delivered`; `deal.offered` carries the price in base units and `deliverWithinSec` 172,800; `delivered` carries `secSinceOffered`, `secSincePrevious` and `refusals` 0. The credential, the buyer's address in both cases, the scope's target, the report's text and a proof file's content are each absent from the file. The journal's `times` hold `offered`, `starting`, `started`, `jobDone`, `delivering` and `delivered`.
- **A refused quote:** `quote.refused` with `status` 400 and `reason` `invalid_request`; the request's scope and address are absent.
- **A refused delivery** (`examples/seller-adapter.test.ts`, the alert test): `delivery.refused` with `attempt` 1 and `failedChecks` `["coverage"]`.
- **After the review (one reviewer: six minor points, none on privacy; all fixed).** A replayed quote is marked `replayed: true` (a test posts one key twice: `false`, then `true`); credential and rate-limit refusals are counted (a test: 401 gives `quote.refused` with `unauthorized`); `events` must be a file path (`1` is refused at load); a file in a missing folder logs one line and two quotes still answer 200 (test); the new status and completion records no longer repeat the stage's log line; the guide names the schema, the clock, the field-only status events and that the file holds commitment IDs and prices.
- **Tests.** The whole `examples/` suite: 34 files, 421 tests passed, 24 skipped. `tsc -b examples` exit 0; `eslint` on the changed files prints nothing. `node site/check.mjs` passed; no bundle changed.

## Handoff

**Done.** The events file, the journal's times, their tests and the guide's line. The guide reaches crow.direct with the next site deploy (Rafa's).

**For the pilot.** Add `"events": "<the job folder>/events.jsonl"` to each job's adapter configuration. The queue's time is `job.status` `queued` to `running`; the scan's time is `running` to `job.done`.

**Not here.** A reader or dashboard for the file; the hosted adapter (ADR-0037, T-407) should write the same events to its own store. The operators' telemetry is unchanged.
