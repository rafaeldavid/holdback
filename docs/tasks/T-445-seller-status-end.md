# T-445: the test seller's status shows how a deal ended

- **Lane:** test (Crow's test seller, `apps/test-agents/`)
- **Phase:** 2
- **Depends on:** T-222 (the test seller), T-420 (its named offers)
- **Paths this task may touch:** `apps/test-agents/src/seller.ts`, `apps/test-agents/src/seller.test.ts`, this file. Not `site/` or `tools/one-click/`: other sessions work there.
- **Human gate:** no for this pull request. The test seller's deploy waits for Rafa.
- **Status:** done (2026-11-14, PR 562)
- **Agent/session:** a side session of the benchmark coordinator (triage task 4), branch `t-445-seller-status-end`
- **Roadmap row:** N70

## Intent

In the live benchmark run s5 on 2026-11-14 (a missed deadline; the buyer reclaims), commitment `0xc978…6e9e` ended Refunded on Sepolia, but the test seller's status page still read `"status": "offered"`. Restated: a buyer that keeps reading `intake.status?token=…` after the offer must see the deal's end there, `released`, `refunded`, `expired` or `failed`, and not `offered` forever. Find why, fix the cause, and test each end state.

Non-goals: the intake convention's text in `site/ref/intake.txt` (the site lane), and the benchmark harness.

## Context

- `site/ref/intake.txt`, "Two agents, two people" step 4 and "Crow's test seller": `status` reads `received`, then `offered` or `failed`; `deal` reads the seller's own state.
- The s5 record: `reports/scratch/one-click-bench/live/2026-11-14T14-25-07Z-s5.json` (git-ignored), `outcome.commitmentId`.

## The cause

Two causes, the first is the one s5 hit:

1. **`status` never left `offered`.** `TestSeller.status()` mapped every state after the offer to `offered`: `status: d.status === 'received' || (d.status === 'failed' && !d.deliveredAt) ? d.status : 'offered'`. The seller did follow the chain: its own state (`deal`) moved to `refunded`, `released` or `expired`. Only the `status` field hid it. In s5, the operators' reclaim landed at 14:34:24Z, 19 s after deliverBy (14:34:05Z) [measured, `GET /v1/commitments/<id>/events`], so `deal` read `refunded` within seconds [inferred: the seller polls every 3 to 15 s] while `status` read `offered`.
2. **A missed deliverBy closed the deal as `failed` at once.** When a non-silent deal was Held past deliverBy (the seller was down or its delivery kept failing), `deliverWhenHeld()` saved `failed` and stopped following, so the buyer's reclaim a minute later never reached the status. The silent offer already waited for the reclaim; now both paths wait, and close as `failed` only if nobody has reclaimed 10 minutes after deliverBy.

## Acceptance criteria

- [x] `status` reads `received`, then `offered` while the deal is open on Crow (`delivered` included), then the end: `released`, `refunded`, `expired` or `failed`. A seller that gives up before delivering still reads `failed`, so the pinned `try.mjs`, which polls until `offered` or `failed`, is unchanged.
- [x] A seller that is back up past deliverBy, with the hold still Held, waits for the reclaim and ends `refunded`.
- [x] A test runs a missed-deadline reclaim and checks the final `status`; the released, refunded-by-checks, refunded-by-panel, expired and silent-offer tests check `status` the same way.

## Out of scope

- `site/ref/intake.txt` step 4 still says "after that, follow the deal on Crow". It stays true, and line 49 already lists the end states under `deal`. A sentence saying `status` ends on them too is the site lane's (Handoff).

## Evidence

- **Tests** [measured, 2026-11-14]: `pnpm exec vitest run apps/test-agents`: 6 files, 82 of 82 pass. `seller.test.ts` has 24 tests, 2 of them new: "follows a missed deadline to the buyer's reclaim: the status ends refunded" and "closes a missed deadline nobody reclaims as failed, 10 minutes after deliverBy".
- **The tests fail without the fix** [measured]: with `seller.ts` from `main` and the new tests, 7 of 24 fail, each with `expected 'offered' to be 'released'`, `'refunded'` or `'expired'`, or, in the missed-deadline test, the `failed` state the old code closed with. The 10-minute test passes on both, as it should: that behaviour is unchanged.
- **The s5 timeline** [measured, `GET https://api.crow.direct/v1/commitments/0xc978358de7741838019ed7d7e0410f7aa0c16e4e9311d5c61d14bd6c4f676e9e/events`]: offered 14:29:05Z, funded 14:29:36Z, deliverBy 14:34:05Z, reclaimed 14:34:24Z (`settlement.reclaimed`, sent by `demo-op-1`).
- **Typecheck and lint** [measured]: `pnpm typecheck` passes; `pnpm exec eslint` on the two changed files reports no problems. No snapshots change (no fixture covers the test seller).

## Decisions

- `status` keeps `offered` while the deal is open, `delivered` included, so the convention's open states stay three and a buyer polling for `offered` sees no new open state.

## Handoff

- **Deploy:** the live test seller (Worker `crow-test-agents`) runs the old code until it is deployed, which waits for Rafa (`docs/operations.md`).
- **Site lane:** `site/ref/intake.txt` step 4 may add that `status` ends on `released`, `refunded`, `expired` or `failed`.
