# T-039: The demo's adjudicator alarm runs only while a case awaits an adjudicator

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-031 (telemetry counts the alarm)
- **Paths this task may touch:** `apps/demo-cloud/src/`, `docs/backlog.md`, `docs/operations.md`, `docs/plan.md`, `docs/tasks/T-039-demo-alarm-cadence.md`
- **Human gate:** no (the deploy that ships it is Rafa's)
- **Status:** review
- **Agent/session:** side session from the T-031 follow-ups, branch `t-039-demo-alarm`

## Intent

The public demo World (one Durable Object on the Workers Free plan) spends its daily quota on its own adjudicator alarm. Two T-031 backlog rows: every cold start, even from a plain read, counted as activity and armed a one-second alarm for 15 minutes; and every pass costs a billed `setAlarm` and a billed alarm request. Goal: an adjudicator pass runs only when a case awaits one of the demo's adjudicators, read from settlement state, and a case no pass can finish is retried slowly. Deals in flight must still resume after a restart. Non-goals: the journal replay cost on wake (its own backlog row), any deploy.

## Acceptance criteria

- [x] The world opens active only when its adjudicators have a step to take: an offer awaiting the primary, a delivery, fallback case, escalation or open appeal to decide. A fallback takeover gets an alarm at its judgeBy, active or not. Read from SimChain state in `world.ts`.
- [x] A slower cadence when a pass changes nothing (doubling from 1 s to 60 s); a write brings the alarm forward to 1 s (both tested).
- [x] A deal resumes after a restart mid-deal; `world.test.ts` "survives the world being rebuilt from storage" passes.
- [x] Test: a world rebuilt from storage with no open work is not `active()` after a read; with a pending offer it is.
- [x] Savings reported with T-031's counters, labelled measured or inferred.
- [x] The two backlog rows closed or narrowed.

## Out of scope

- The journal replay on wake (backlog, Public demo), deploying, timeout triggers the parties own (expiry, reclaim, default, appeal expiry).

## Evidence

- **Measured, Node model** (`reports/scratch/t-039-measure.test.ts`, gitignored: main's `World` and this branch's in the `worker.test.ts` harness, a fake Durable Object state whose alarm the test fires on a fake clock). Requests are fetches plus alarms; rows written are storage keys put or deleted plus one per `setAlarm`, counted at the storage boundary. The instance's T-031 counters (`usage.requests`, `usage.rowsWritten`) gave the same numbers where one instance served the whole scenario (the deal row).

  | Scenario | Code | DO requests | Alarms | setAlarm | Rows written |
  | --- | --- | --- | --- | --- | --- |
  | Cold start from one read, idle world, then 15 min | main | 901 | 900 | 901 | 1,817 |
  | | T-039 | 1 | 0 | 0 | 1 |
  | One faucet grant on a warm idle world, then 15 min | main | 901 | 900 | 901 | 1,820 |
  | | T-039 | 1 | 0 | 0 | 6 |
  | A whole checks-only deal (2 faucet grants, offer, agree-and-fund, deliver), then 15 min | main | 936 | 903 | 903 | 1,837 |
  | | T-039 | 35 | 2 | 2 | 18 |
  | A delivery the primary refuses on every pass, first 15 min | main | 901 | 900 | 900 | 1,815 |
  | | T-039 | 20 | 19 | 19 | 53 |

  Rerun after the review fixes; the first run differed by one row in two cells (when the telemetry flush fell). Each old pass also journals a clock `advance` entry, so 15 minutes of activity cost about 1,800 rows written, not the 900 the backlog row estimated. The harness fakes `Date` only, so the log-flush timer never fires in it: on Cloudflare a request that leaves log lines waiting adds one flush a minute later (the reviewer measured 1 row in the request and 4 once the timer fired, with timers faked too). Main's numbers already include their flushes, made on its passes.
- **Inferred, Cloudflare:** the Free tier allows 100,000 rows written and 100,000 requests a day. Before, about 55 activity windows a day (any read after an eviction, any POST) used up the rows written; a world kept active all day would need about 173,000. After, a read or a cold start with nothing open costs about 4 rows with its log flush, a deal about 18 rows and 35 requests, and a stuck case about 50 rows per 15-minute window. Not measured on Cloudflare until a deploy: read `usage` in the first day lines.
- **Measured, tests:** `world.test.ts` (20 tests, 3 of them new for T-039, including the rebuild test) and `worker.test.ts` (4 new) pass, with all 33 demo-cloud tests. Each review fix's test fails on the commit before it: the takeover test (no takeover by judgeBy + 5 s), the straddled-deadline test (the delivered deal not active), and the overdue-alarm test (re-armed at judgeBy, a day out).
- **Measured, `pnpm verify`** (`reports/verify-t-039-demo-alarm.md`, 2026-11-03, this branch's tree before commit): typecheck, lint, forge build, forge, test, spec, snap and demo pass. snap:local fails on one fixture, `error.submission-limit` (refused `invalid_terms` on the contract where SimChain refuses `submission_limit_reached`). That fixture was promoted from `todo.` on main in 7fd10a6 (PR 116). This branch touches nothing it runs, and CI does not run snap:local. The first verify run also failed forge build while cloning the contract submodules into this fresh worktree; the rerun passed.

## Decisions

- Work is read from `chain.escrowState` (it carries the adjudicators and deadlines; `chain.state`'s view has no adjudicator addresses), over the commitments seen in the event log.
- "Settlement moved" (a new settlement event) replaces "any POST" as what restarts the activity window and the one-second cadence: a faucet grant or a prepare call brings no adjudicator work.
- The 15-minute window stays, as the bound for a case no pass can finish (refused, undecided): without it such a case would be polled until its deadline, which the parties set (D31) and may be far away.
- The alarm is brought forward when it is set later than the next pass (a write arrives during a slow cadence), and the flush timer for log lines runs whether or not a pass is due, since passes can now be a minute or more apart.
- Review (PR 136) finding 1: a fallback takeover is a wake point of its own, kept even while the primary can act now, and it arms an alarm at judgeBy whether or not the world is active. Before the fix a ready case hid it behind the slow cadence, up to a minute late, and late enough to reach fallbackBy.
- Review finding 5: `look` drops a commitment once no adjudicator can act on it again (its last adjudicator deadline passed, or it settled), so a request reads only open deals. Second review: the drop uses the wall clock, and a submission started before the deadline can still land after a concurrent look dropped the deal, so any settlement event brings its commitment back into the scan.
- Second review: an overdue alarm (its handler threw) is re-armed a second out, never later; before, an inactive world could push the retry out to a takeover hours away.

## Handoff

Done in the PR. Left (backlog, Public demo): a stuck case still costs about 20 passes per window; an offer declined for a passing reason (no unencumbered bond) waits for a pass run for other work or a restart; journal replay on wake. After the deploy (Rafa), read the first day lines' `usage` to confirm on Cloudflare.
