# T-031: Minimal telemetry for the MVP

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-030 (problem types and routes settle first)
- **Paths this task may touch:** `apps/demo-cloud/`, `apps/operator/src/` (a metrics hook only), `docs/operations.md`, `docs/tasks/T-031-telemetry-mvp.md`, `docs/backlog.md`
- **Human gate:** no for collecting; yes for publishing any aggregate (a status or stats page)
- **Status:** todo
- **Agent/session:** —

## Intent

Give the operator the smallest set of numbers it needs to run the demo, debug agent failures and learn whether deals complete, without collecting anything ADR-0024 §1 says an operator should not see (D39; review §9 and §7). Today's outage (the Durable Objects free-tier read quota ran out unnoticed) is the motivating case.

## Acceptance criteria

- [ ] About 14 aggregate metrics in Workers Analytics Engine (or Workers Logs where simpler): per-route request rate, error rate and latency; problems by type; 429s; Durable Object rows read and written against quota; journal size; live judge calls; the deal funnel (offered, funded, delivered, decided, final) and median time per stage; prepare-to-submit conversion; first-try success; active signers per day (count only).
- [ ] A 7-day request log: Request-Id, route, status, problem type, timing, operator node. Never bodies, `Authorization`, IPs or addresses in the clear.
- [ ] An alert or a documented check before the Durable Object quota runs out (what to watch and where, in `docs/operations.md`).
- [ ] A test that no telemetry call receives a request body or header value; the runbook says where to read each metric.

## Out of scope

- Publishing aggregates (needs Rafa), per-deal analytics, anything about deal content.

## Evidence

## Decisions

## Handoff
