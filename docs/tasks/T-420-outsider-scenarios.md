# T-420: The test seller plays every outsider scenario (roadmap N70)

- **Lane:** agent-access
- **Phase:** 2
- **Depends on:** T-222 (Crow's test seller), T-328 (the outsider design tests and findings F1, F2, F3, F9), T-413 (the Worker's `version.json`)
- **Paths this task may touch:** `apps/test-agents/` (its code, tests and scripts), `site/ref/intake.txt` (the test seller's offers only), this file
- **Human gate:** no. Rafa's word for this wave (2026-11-14): merge and deploy when ready, inside the wave brief's limits. Test tokens only.
- **Status:** in progress
- **Agent/session:** the T-420 session, second wave of 2026-11-14, worktree `.worktrees/holdback-T-420`, branch `t-420-outsider-scenarios`
- **Kind:** 4 (the test seller's Worker code), 1 (`site/ref/intake.txt`), 9 (one live deal per scenario on Sepolia); one `reviewer` pass

## Intent

An outside agent that reads crow.direct can buy one thing from Crow's live test seller today: a small dataset the checks decide, which releases in under a minute. It cannot see the other ways a deal ends without playing both sides itself (T-328: scenarios 2 and 5 were blocked against the test seller). This task gives the test seller one named offer per ending, which a buyer picks by name:

1. `customers-3`, the checked dataset, as before (with its `"test": {"outcome": "refund"}`);
2. `summary-judged`, a short text the operators' live judge panel passes, so the deal releases;
3. `summary-judged-fails`, the same terms and a text that states the opposite of the facts asked for, so the panel rejects it and the buyer is refunded;
4. `customers-3-silent`, a seller that takes the deal and never delivers, with `deliverBy` 5 minutes after the offer, so the buyer's hold comes back within minutes.

The judged offers use only what the live adjudicators already run, inside the seller's own daily budget of judged deals. The judged texts are honest work, good or bad: neither carries words aimed at a judge. Non-goals: operator code (`apps/demo-cloud/`, T-422's lane), contracts, judgment code, the guides' first-deal text and the pinned `site/try.mjs` and `site/buy.mjs`.

## Acceptance criteria

From the brief and N70 (title, summary, done-when):

- [x] Four named offers on the card, picked with `"offer": "<id>"`; a proposal without a name gets the offer whose deliverable it names, or `customers-3`. `customers-3` stays `offers[0]` with its shape, so `try.mjs` and `examples/try.ts` work unchanged.
- [x] The judged offers run under the `default` template, a rubric of 2 criteria and a live panel, within a daily budget: 5 judged deals a day (UTC), and none while the operators' live calls left today cannot seat a panel, or while their panel is scripted (a scripted panel passes everything, so the failing offer would release).
- [x] The silent offer never delivers, with a delivery window of 5 minutes, and the seller follows the deal to the reclaim.
- [x] `site/ref/intake.txt` describes the four offers, the judged budget and which timing fields the seller takes from a proposal (none: F9), in the ontology's words.
- [ ] Each scenario runs end to end on Sepolia against the live operators, with one deal recorded here: the commitment ID, the final state and the seconds it took (measured).
- [ ] The test seller is deployed from `origin/main`, with the version IDs recorded.

## Evidence

All measured on 2026-11-14 in this branch's worktree unless marked otherwise.

- **Test first:** the 6 new tests in `apps/test-agents/src/seller.test.ts` ("the test seller's named offers (T-420)") failed before the change: 6 failed, 14 passed. The retry test for the judged budget failed with the per-deal count switched off, and passes with it.
- **Local checks (kind 4 and kind 1):** `pnpm exec vitest run apps/test-agents` passed 80 of 80 tests after the review fixes (78 of 78 before them); `pnpm typecheck` passed; `pnpm exec eslint apps/test-agents` found nothing; `node site/build.mjs --op1 https://api.crow.direct --op2 https://api2.crow.direct --out reports/site-out && node site/check.mjs` passed, and the buyer's first-deal path stays at 4,996 of 5,000 tokens (estimate), as on `main`.
- **The unit tests' panel** is a stand-in the in-process world calls live (`judgeProvider`): it fails a text that says the seller is paid at once, which only the failing text says, and passes the rest. It shows the seller's flow, not what the live models decide; the live deals below do that.

## Decisions

- **Named offers, not more test outcomes.** F2 suggested `"test": {"outcome": "silent"}`. The brief asks for offers a buyer picks by name, and an offer of its own lets the silent deal carry its own shorter windows on the card, where a buyer reads them before it proposes. `test.outcome` stays on `customers-3` only, as `try.mjs` uses it.
- **The judged pair share one set of terms.** `summary-judged` and `summary-judged-fails` have equal terms; only the delivered text differs. A buyer sees that the panel, not the terms, makes the difference.
- **A judged request is declined when no live panel can sit.** The demo's scripted fallback passes every rubric deal, so the failing offer would release and show the wrong ending. The seller reads the first operator's `demo.judges` before it offers and declines with the reason. If the calls run out between the offer and the delivery, the scripted judges decide; `intake.txt` says so.

## Review

One `reviewer` pass on commits `542543d2` to `14030a49`: ISSUES, none blocking. What became of each finding:

1. The failing text spoke of the adjudicator's rating, which a defended judge might flag as aimed at the panel: fixed. It now says "The seller keeps the payment whether or not the adjudicator accepts the work", and says nothing about judging.
2. Unfunded offers could use up the 5 judged deals a day: fixed. A deal that closes with no delivery gives its place back (test: an unfunded judged offer expires, and the next judged request is offered).
3. A judged deal that ends otherwise than its offer intends (scripted judges after the calls ran out) read `outcome: refund`, `deal: released` with no reason: fixed. The status adds a `detail` from the judgment record (test: a lenient panel releases `summary-judged-fails`, and `detail` says why).
4. The copy left out that the seller declines while the operators' panel is scripted: fixed on the page and in `intake.txt`.
5. The silent deal closed 30 minutes after `deliverBy`, its retries 10: both 10 now. The detail no longer says the buyer sent the reclaim: "the hold went back to the buyer by the reclaim".
6. The word counts in two comments were wrong: fixed (64 and 54 words).
7. The silent windows (3 minutes to agree, 4 to fund) may be tight on Sepolia: measured in the live deal below.
8. `intake.txt` restated the demo's daily number of live calls: it now points to `demo.judges.liveCallsPerDay`.
9. The shared offer cap counts a retried request twice (older than this task): a follow-up, below.

## Handoff

(filled in at the end)
