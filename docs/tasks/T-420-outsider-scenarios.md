# T-420: The test seller plays every outsider scenario (roadmap N70)

- **Lane:** agent-access
- **Phase:** 2
- **Depends on:** T-222 (Crow's test seller), T-328 (the outsider design tests and findings F1, F2, F3, F9), T-413 (the Worker's `version.json`)
- **Paths this task may touch:** `apps/test-agents/` (its code, tests and scripts), `site/ref/intake.txt` (the test seller's offers only), this file
- **Human gate:** no. Rafa's word for this wave (2026-11-14): merge and deploy when ready, inside the wave brief's limits. Test tokens only.
- **Status:** done (PR 519 merged as `b630609f`; the test seller and the site deployed on 2026-11-14; one live deal per scenario recorded)
- **Agent/session:** the T-420 session, second wave of 2026-11-14, worktree `.worktrees/holdback-T-420`, branch `t-420-outsider-scenarios`, then `t-420-record` for the live record
- **Roadmap row:** N70
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
- [x] Each scenario runs end to end on Sepolia against the live operators, with one deal recorded here: the commitment ID, the final state and the seconds it took (measured).
- [x] The test seller is deployed from `origin/main`, with the version IDs recorded.

## Evidence

All measured on 2026-11-14 in this branch's worktree unless marked otherwise.

- **Test first:** the 6 new tests in `apps/test-agents/src/seller.test.ts` ("the test seller's named offers (T-420)") failed before the change: 6 failed, 14 passed. The retry test for the judged budget failed with the per-deal count switched off, and passes with it.
- **Local checks (kind 4 and kind 1):** `pnpm exec vitest run apps/test-agents` passed 80 of 80 tests after the review fixes (78 of 78 before them); `pnpm typecheck` passed; `pnpm exec eslint apps/test-agents` found nothing; `node site/build.mjs --op1 https://api.crow.direct --op2 https://api2.crow.direct --out reports/site-out && node site/check.mjs` passed, and the buyer's first-deal path stays at 4,996 of 5,000 tokens (estimate), as on `main`.
- **The unit tests' panel** is a stand-in the in-process world calls live (`judgeProvider`): it fails a text that says the seller is paid at once, which only the failing text says, and passes the rest. It shows the seller's flow, not what the live models decide; the live deals below do that.
- **Merged:** PR 519 as `b630609f`, by hand, after all 16 checks passed, `check` and `gitleaks` among them.
- **Test seller deploy 2026-11-14 11:36 UTC, commit `b630609`: pass.** crow-test-agents `0efca4f1-12ce-4249-bcaf-c3c716825ff8` (rollback target `13cb42b5-12c3-4579-a0b5-ced3bfab89a9`). It carried only this task's code into the Worker. The Durable Object kept serving the old card for about a minute: the card listed four offers from 11:38:02 UTC.
- **Site deploy 2026-11-14 11:47 UTC, commit `4f28a99` on a detached HEAD: pass.** crow-site `9a66ab50-5f94-4f5c-889c-0bbf7b28960d` (rollback target `0818c983-3757-46f0-a41e-6e980228a4c8`). It also carried T-423's PR 517. `https://crow.direct/ref/intake.txt` names the four offers (measured 11:48 UTC); `site/try.mjs` and `site/buy.mjs` did not change, so no install line handed out before stops working.

### One live deal per scenario (Sepolia, live operators, measured)

Played by `node apps/test-agents/scripts/play-offers.ts` from this Mac as an outside buyer, 11:39 to 11:47 UTC and at 12:41 UTC: for the first three, one fresh buyer address, `0x14529345b0e1072352169090ba5889d7dc456d4d`, funded once by the faucet. Seconds are wall time from the request to the intake to the end state on both operators.

| Scenario | Offer | Commitment ID | Final state | Seconds | What decided |
| --- | --- | --- | --- | --- | --- |
| Judged work that passes | `summary-judged` | `0xf3d68191f957109f95f0c8b1599fcb0818dc0936a83e42c01f37b7806ae7a8cd` | Released | 73.0 (61 from Held) | The check `hidden` passed. The primary adjudicator escalated 12 s after the delivery; the appeal adjudicator's live panel of 5 passed it, 5 of 5 from 2 families (claude, deepseek), weighted score 4.00 of 4 rubric points (400 hundredths); no judge set `injectionSuspected` |
| Judged work that fails | `summary-judged-fails` | `0x3b35c932b51a420686748bf5265044fdb5e7356ebb760cfa407e5c6e5653f249` | Refunded | 35.1 (25.5 from Held) | The check `hidden` passed; the primary's live panel of 3 rejected it, 3 of 3 fail |
| Seller never delivers | `customers-3-silent` | `0x2b6e735a4a96c0094f0fe8fb138122bc4047a26e64daded5364557c9b4030b9b` | Refunded | 368.2 (358.8 from Held) | No delivery. `deliverBy` 11:46:19 UTC, 5 minutes after the offer; the operators sent the reclaim themselves about a minute later (transaction `0xe8ee3145…f33a`); the seller's status read `refunded` |
| The checked dataset | `customers-3` | `0xdfda79ef87f66b279a17d78432dbeaf5dc306589869f004db53f4f2560cb1908` | Released | 37.7 (23.7 from Held) | The checks `cols`, `rows` and `uniq` passed; no panel. Played at 12:41 UTC with its own fresh buyer, `0x41eed4276a31e7d57b0b4d882f78b7f0e1189d12`, after the seller's cap of 3 requests per IP address an hour |

- **Each deal's transactions** are in the seller's status with Sepolia links: funded and delivered or reclaimed, and one `decided` per decision (two for the escalated deal).
- **The silent offer's windows were wide enough for a script** (finding 7): 2.3 s from the request to the offer and 7.2 s from the offer to `Held`, against 180 s to agree and 240 s to fund.
- **Live judge calls** read 11 of 30 for the UTC day after these deals: 3 + 5 for the escalated pass and 3 for the reject [measured from discovery; inferred that no other deal used any].
- **First try, 11:38 UTC:** the faucet refused all three buyers (`rate_limited`, per IP address, which this Mac's other sessions share [inferred]); no request reached the seller. The script now funds one buyer once for every offer (branch `t-420-live-deals`).

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

**State:** the four offers are live on the test seller and described on crow.direct. To rerun any scenario: `node apps/test-agents/scripts/play-offers.ts [--offer <id>]...` from a checkout after `pnpm install`. Each deal uses one of the seller's 3 requests an hour per IP address: a fourth in the same hour gets a 429 and fails, so play it with `--offer` after the hour; the judged ones use one or two panels of the day's live judge calls.

**For other lanes (not edited here):**
- `docs/operations.md` (T-423's lane): line 15 says the test seller "sells one test dataset"; it now makes four named offers (`site/ref/intake.txt`, "Crow's test seller"). The two record lines for its deploy log are in Evidence above.

**Follow-ups, not built:**
1. **A judged deal can take 8 live calls, not 3** [measured: the passing deal's primary escalated, and the appeal panel of 5 decided]. The seller checks for 3 calls left before it offers, and takes 5 judged deals a day; 5 deals at 8 calls would pass the demo's 30. Past the budget, a scripted appeal panel passes the work, so `summary-judged-fails` could release (the status then says why in `detail`) [inferred from the code]. Options: check for the primary's and the appeal's panel sizes together (8) before offering, or lower `judgedPerDay` to 3. Why the primary escalated cannot be read today: `GET /v1/commitments/{id}/judgments` is planned (501), and `/judgment` serves the appeal's record.
2. **F3: take a proposal whose stricter checks the delivery passes** (N70's done-when). It needs `preflightDelivery` from `@holdback/judgment` in this Worker's bundle, which carries no workspace package today: the deploy would need a build step or a bundler alias. Until then, other checks get a counter-offer, as `intake.txt` says.
3. **N39: a quoted item on the card**, with `pricing.defaults` (N70's done-when, absorbed from N39).
4. **Outsider scenarios 2 and 5 rerun with fresh agents** (N70's done-when; T-328's harness, `tools/one-click/outsider.mjs`). T-328 measured about 1.3 and 0.8 million tokens for those two runs, so a rerun is the coordinator's call.
5. **The shared offer cap counts a retried offer twice** (review finding 9, older than this task): `recent` gets a timestamp on each try, as `judged` did before `14030a49`.
6. **`play-offers.ts` has no test of its own**: the live run is its check (kind 9).

