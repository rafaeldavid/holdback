# T-057: The demo's adjudicator alarm runs only while a case awaits an adjudicator

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-031 (telemetry counts the alarm)
- **Paths this task may touch:** `apps/demo-cloud/src/`, `docs/backlog.md`, `docs/operations.md`, `docs/plan.md`, `docs/tasks/T-057-demo-alarm-cadence.md`, and an amendment note in `docs/decisions/ADR-0028-demo-settles-on-sepolia.md` §5 (after the Sepolia merge)
- **Human gate:** no (the deploy that ships it is Rafa's)
- **Status:** done (PR 136)
- **Agent/session:** side session from the T-031 follow-ups, branch `t-039-demo-alarm` (opened as T-039, renumbered: PR 131 holds T-039 to T-050)

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
  | | T-057 | 1 | 0 | 0 | 1 |
  | One faucet grant on a warm idle world, then 15 min | main | 901 | 900 | 901 | 1,820 |
  | | T-057 | 1 | 0 | 0 | 6 |
  | A whole checks-only deal (2 faucet grants, offer, agree-and-fund, deliver), then 15 min | main | 936 | 903 | 903 | 1,837 |
  | | T-057 | 35 | 2 | 2 | 18 |
  | A delivery the primary refuses on every pass, first 15 min | main | 901 | 900 | 900 | 1,815 |
  | | T-057 | 20 | 19 | 19 | 53 |

  Rerun after the review fixes; the first run differed by one row in two cells (when the telemetry flush fell). Each old pass also journals a clock `advance` entry, so 15 minutes of activity cost about 1,800 rows written, not the 900 the backlog row estimated. The harness fakes `Date` only, so the log-flush timer never fires in it: on Cloudflare a request that leaves log lines waiting adds one flush a minute later (the reviewer measured 1 row in the request and 4 once the timer fired, with timers faked too). Main's numbers already include their flushes, made on its passes.
- **Inferred, Cloudflare:** the Free tier allows 100,000 rows written and 100,000 requests a day. Before, about 55 activity windows a day (any read after an eviction, any POST) used up the rows written; a world kept active all day would need about 173,000. After, a read or a cold start with nothing open costs about 4 rows with its log flush, a deal about 18 rows and 35 requests, and a stuck case about 50 rows per 15-minute window. Not measured on Cloudflare until a deploy: read `usage` in the first day lines.
- **Measured, tests:** `world.test.ts` (20 tests, 3 of them new for T-057, including the rebuild test) and `worker.test.ts` (4 new) pass, with all 33 demo-cloud tests. Each review fix's test fails on the commit before it: the takeover test (no takeover by judgeBy + 5 s), the straddled-deadline test (the delivered deal not active), and the overdue-alarm test (re-armed at judgeBy, a day out).
- **Measured, `pnpm verify`** (`reports/verify-t-039-demo-alarm.md`, 2026-11-03, this branch's tree before commit): typecheck, lint, forge build, forge, test, spec, snap and demo pass. snap:local fails on one fixture, `error.submission-limit` (refused `invalid_terms` on the contract where SimChain refuses `submission_limit_reached`). That fixture was promoted from `todo.` on main in 7fd10a6 (PR 116). This branch touches nothing it runs, and CI does not run snap:local. The first verify run also failed forge build while cloning the contract submodules into this fresh worktree; the rerun passed.

## Decisions

- Work is read from `chain.escrowState` (it carries the adjudicators and deadlines; `chain.state`'s view has no adjudicator addresses), over the commitments seen in the event log.
- "Settlement moved" (a new settlement event) replaces "any POST" as what restarts the activity window and the one-second cadence: a faucet grant or a prepare call brings no adjudicator work.
- The 15-minute window stays, as the bound for a case no pass can finish (refused, undecided): without it such a case would be polled until its deadline, which the parties set (D31) and may be far away.
- The alarm is brought forward when it is set later than the next pass (a write arrives during a slow cadence), and the flush timer for log lines runs whether or not a pass is due, since passes can now be a minute or more apart.
- Review (PR 136) finding 1: a fallback takeover is a wake point of its own, kept even while the primary can act now, and it arms an alarm at judgeBy whether or not the world is active. Before the fix a ready case hid it behind the slow cadence, up to a minute late, and late enough to reach fallbackBy.
- Review finding 5: `look` drops a commitment once no adjudicator can act on it again (its last adjudicator deadline passed, or it settled), so a request reads only open deals. Second review: the drop uses the wall clock, and a submission started before the deadline can still land after a concurrent look dropped the deal, so any settlement event brings its commitment back into the scan.
- Second review: an overdue alarm (its handler threw) is re-armed a second out, never later; before, an inactive world could push the retry out to a takeover hours away.
- Merged with the Sepolia world (PR 138, D41, ADR-0028), which had `nextPassMs()`: 1 s on SimChain; on a chain, 2 s while setup is left or `awaitingAdjudicator() > 0`, else 12 s, all within the 15-minute window. `nextPass()` replaces it. A chain world's books change only through what its own nodes relay (EvmSettlement reads no chain logs), so `look()` serves both settlements, and idle 12 s passes saw no new deal state. They did run `setup()`, which tops up the relayer's deal lanes and refreshes the bond pools that discovery shows, at most once a minute; that now happens only on passes (backlog row). Kept from the chain branch: a 2 s first pass after settlement moves, and a 2 s pass while setup (verify, lane gas, bonds) is left. A world opening with setup left starts the window, and every chain world opens with a verify step. ADR-0028 §5 carries an amendment note. `live.test.ts` asserts the setup cadence and that a set-up world with only a Released deal has no pass due.
- Third review (of the merge): a setup step that throws (an RPC down) retried every 2 s, about 300 passes per window and per cold start, against main's 12 s. A failing setup step now counts as a pass that changed nothing, so retries double to a minute (about 20 per window); a step that goes through resets the wait. `live.test.ts` reopens a set-up world with a dead RPC and measures 4, 8 and 16 s, where the commit before the fix gave 2 s.

## Handoff

Done in PR 136: the reviewer subagent returned ISSUES twice (seven findings in all, each fixed with a test) and then PASS; the merge with the Sepolia world had a third review (one fix with a test, one backlog row). Left (backlog, Public demo): a stuck case still costs about 20 passes per window; an offer declined for a passing reason (no unencumbered bond) waits for a pass run for other work or a restart; a chain world's lane top-ups and pool refresh run only on passes; journal replay on wake. For the settlement lane, outside this task's paths: `EvmSettlement.awaitingAdjudicator()` (`packages/settlement/evm/evm-settlement.ts`) has no caller since this merge, and its comment says a live world paces its passes by it; remove it or reword it. After the deploy (Rafa), read the first day lines' `usage` to confirm on Cloudflare.
