# T-031: Minimal telemetry for the MVP

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-030 (problem types and routes settle first)
- **Paths this task may touch:** `apps/demo-cloud/`, `apps/operator/src/` (a metrics hook only), `docs/operations.md`, `docs/tasks/T-031-telemetry-mvp.md`, `docs/backlog.md`
- **Human gate:** no for collecting; yes for publishing any aggregate (a status or stats page)
- **Status:** done (PR 118)
- **Agent/session:** implementer session, branch `t-031-telemetry`

## Intent

Give the operator the smallest set of numbers it needs to run the demo, debug agent failures and learn whether deals complete, without collecting anything ADR-0024 §1 says an operator should not see (D39; review §9 and §7). Today's outage (the Durable Objects free-tier read quota ran out unnoticed) is the motivating case.

## Acceptance criteria

- [x] About 14 aggregate metrics in Workers Analytics Engine (or Workers Logs where simpler): per-route request rate, error rate and latency; problems by type; 429s; Durable Object rows read and written against quota; journal size; live judge calls; the deal funnel (offered, funded, delivered, decided, final) and median time per stage; prepare-to-submit conversion; first-try success; active signers per day (count only).
- [x] A 7-day request log: Request-Id, route, status, problem type, timing, operator node. Never bodies, `Authorization`, IPs or addresses in the clear.
- [x] An alert or a documented check before the Durable Object quota runs out (what to watch and where, in `docs/operations.md`).
- [x] A test that no telemetry call receives a request body or header value; the runbook says where to read each metric.

## Out of scope

- Publishing aggregates (needs Rafa), per-deal analytics, anything about deal content.

## Evidence

- **Measured: `pnpm verify`** (`reports/verify-t-031-telemetry.md`, 2026-11-03, uncommitted tree equal to this branch's first commit). The machine ran at a load average of 50 to 95 on 8 cores, from other sessions.

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 427 ms |
  | lint | `pnpm lint` | pass | 6078 ms |
  | forge build | `forge build --root contracts` | pass | 2860 ms |
  | forge | `forge test --root contracts` | pass | 32007 ms |
  | test | `pnpm test` | fail | 44501 ms |
  | spec | `pnpm validate:spec` | pass | 722 ms |
  | snap | `pnpm snap` | pass | 10153 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 26240 ms |
  | demo | `pnpm demo` | pass | 5600 ms |

  The one `test` failure is `packages/testkit/src/judgment.test.ts` "draws the same panel from the same seed…", which timed out at 5 s. It is the load-sensitive test in `docs/backlog.md` (PR 77 review); this branch does not touch `packages/testkit`. A first run, before `forge build` had finished cloning `contracts/lib` submodules in this new worktree, also failed the EVM steps for want of artifacts. No snapshot diffs.
- **Measured: the new tests pass.**
  - `apps/demo-cloud/src/telemetry.test.ts`, 7 tests: the hourly log for seven days with lookup across a cold start and pruning; a line keeps only its eight fields; rows counted as billed and kept across a cold start; warnings at 80% and 95% once each; the per-route summary (p50 10 ms and p95 19 ms over 1 to 20 ms); the deal funnel and signer counts from synthetic events; hour and day lines across a cold start.
  - `apps/demo-cloud/src/world.test.ts`, "never receives a body, a header value, an IP or an address": a checks-only deal over HTTP, then requests carrying a value in every header (`authorization`, `traceparent`, `user-agent`, a custom header, `idempotency-key`), the query and the body, from client IP `203.0.113.77`. The day line counts the deal at every stage: `outcomes.released` 1, `signers` `{active: 2, fresh: 2, firstDealCompleted: 2}`, and the faucet's 429. None of the planted values, the IP, the parties' addresses, the commitment ID or any 40-hex address appears in the log lines, the stored log or the stored use.
  - `apps/operator/src/operator.test.ts`, "logs the route template and problem type": `/v1/agents/{address}`, `unmatched` for a stray path, `not_implemented` for a planned route.
- **Measured: the canary test catches a leak.** With the World's hook changed to log `e.path` as the route, the test failed; the hook was then restored.
- **The PR 118 review (ISSUES), and the fixes in the second commit (measured: `apps/demo-cloud` and `operator.test.ts`, 54 tests pass):**
  1. An idle world now flushes waiting lines on a timer, not an alarm, so it cannot wake a fresh instance that has lost them.
  2. `final` counts settled deals past their appeals only, and an early accept counts as `decided`. The unit test now has an expired offer and an early accept.
  3. A method outside a fixed set is logged as `OTHER`. A failing flush is reported and never replaces a response. A failing facts call still writes the day line. An offered event without `terms` is skipped.
  4. A stray formatting edit in `server.ts` is reverted.
  5. Docs: when lines are written, the row estimate, and that alarms are requests too. A backlog row covers the pre-existing cost that every cold start counts as activity.
  6. The canary test also sends an unmatched path carrying an address, checks the set of storage prefixes, and finds none of the planted values anywhere in storage. The unit test no longer prints to the console.

## Decisions

- **Workers Logs, not Analytics Engine, for all fourteen.** The World Durable Object already sees every request and every settlement event, so it folds them into an hourly and a daily summary line and writes them with `console.log`. That needs no new binding, no API token to read and nothing kept for three months. Analytics Engine (three-month retention, SQL) waits until trends beyond Workers Logs' 3 days matter (backlog row), which goes with D39's open question on weekly aggregates.
- **The request log lives in World storage, by UTC hour, for seven days.** Workers Logs keeps 3 days on the Free plan, and T-032 must find a line by Request-Id from inside the Worker. One value per hour, rewritten with today's use at most once a minute: about 2,900 to 3,000 rows written on a day of steady traffic, counting the extra put and the prune when an hour closes (inferred). That is about 3% of the Free tier's 100,000. Lines past 6,000 in an hour are counted, not kept, so one value stays under the 2 MB limit. A line cannot hold more than its eight fields: `Telemetry.request` copies them by name, and the World's log hook picks them from the operator's `LogEntry`, so `path` and `traceparent` never reach telemetry.
- **The operator's hook gains `route` and `problem` and keeps its other fields.** `routeOf` matches the OpenAPI document's templates, served and planned, and answers `unmatched` for anything else, so a path someone typed never becomes a metric name. `path` and `traceparent` stay in `LogEntry` for `pnpm sim` and `apps/demo`, which use them.
- **Quota use is estimated from the World's own calls** (each key read, written or deleted, and each `setAlarm`, as Cloudflare's billing table counts them) and warned at 80% and 95%. That is a lower bound; the dashboard and the GraphQL datasets are authoritative, and the runbook says where. A warning line in Workers Logs is the alert: Cloudflare's own usage notifications were not found for the Free plan (not checked further).
- **Cloudflare's invocation logs are turned off on both Workers.** Per Cloudflare's docs they capture every request's headers. That is how `Authorization` (a ReadToken names its viewer) and the client IP (`cf-connecting-ip`, and `x-holdback-client` into the Durable Object) were being stored for 3 days, against D39's "no `Authorization` in logs, IPs only in memory". Console lines and exceptions are still kept.
- **Funnel and signer numbers come from settlement events and each deal's finality**, computed when a day closes; nothing about them is stored. First-try success is defined from the settlement view: of the parties whose first signed event is that day, how many first deals have settled and are final. Counting refused writes per signer instead would need a per-address history of refusals, which minimal disclosure rules out.

## Handoff

- **Status: merged (PR 118), not deployed;** the redeploy is Rafa's gate. From a branch that has merged main, `pnpm demo-cloud:deploy` deploys holdback-op1, then holdback-op2 (`docs/operations.md`, Deploy). There is no schema bump, so `WORLD_NAME` stays: the new keys (`rl:<hour>`, `tm:current`) start empty beside the journal.
- **After the deploy, check:**
  1. Send one request. The dashboard's Observability view shows no invocation log for it; `wrangler tail` still shows it live. Send one GET about 15 minutes after the last POST: its line is kept (a later report finds it), and the next day line's `usage.wakes` does not rise because of it.
  2. After the next hour boundary with traffic, a `telemetry: "hour"` line appears.
  3. The next UTC day, a `telemetry: "day"` line appears. Read `usage.rowsWritten` against the inference that the per-second alarm dominates (backlog row).
- **Known limits:**
  - A crash or deploy loses at most a minute of log lines and use counts. An idle instance holds waiting lines on a timer, not an alarm, until its flush (PR 118 review: an alarm could wake a fresh instance with the lines gone). Per Cloudflare's lifecycle docs, a pending timer keeps the object in memory; this is not measured on Cloudflare.
  - The rows of the last flush before an idle eviction are not counted.
  - `getAlarm` and Cloudflare's internal rows are not counted, so use is a lower bound.
  - A quiet hour's line is written at the next wake.
- **To T-032:** `world.telemetry.lookup(requestId)` returns the line. A miss reads up to 168 rows (one per hour of the week), so check the Request-Id's format and apply the report limits before calling it.
- **Lane:** within the listed paths. In `apps/operator/src/`, the hook is `LogEntry.route` and `LogEntry.problem` (`server.ts`), `routeOf` beside `plannedRoute` (`openapi/index.ts`) and one test (`operator.test.ts`).
