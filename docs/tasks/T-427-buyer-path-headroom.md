# T-427: headroom in the buyer's first-deal path

- **Lane:** agent guides (site/docs), into `main`
- **Phase:** 2
- **Depends on:** T-393 (the short guides and `FIRST_DEAL_BUDGET`), T-426 (the shorter HTTP path)
- **Paths this task may touch:** `site/llms.txt`, `site/buy.txt`, `site/ref/buyer-signer.txt`, `site/ref/checks.txt`, `site/ref/limits.txt`, this file. Off limits: `FIRST_DEAL_BUDGET.tokens` and `HTTP_BUYER_BUDGET` in `site/guides.mjs`, `site/buy.mjs`, `site/try.mjs`, and the three pages of the HTTP path (`ref/http.txt`, `ref/signing.txt`, `ref/http-buyer.txt`), which have 24 tokens of slack.
- **Human gate:** no for the merge; the site deploy waits for Rafa.
- **Status:** in review
- **Agent/session:** T-427's session, kind 1 (copy and agent docs)

## Intent

A buyer's agent reads the front door (`llms.txt`) and `buy.txt` before its first purchase. On 2026-11-14 that path was 19,997 bytes, 5,000 of 5,000 tokens by the bytes-divided-by-four estimate, so any edit of a few words failed the build. Rafa chose to keep the promise of a first deal under 5,000 tokens rather than raise the limit. This task makes room: it removes what the two pages say twice, moves what a first purchase does not need to the reference page a step already names, and tightens wordy passages, aiming at about 4,500 tokens. Every step of the first purchase must still work from the two pages alone, and the seller path must not grow. Non-goals: the word for whoever stands behind an agent, and the ontology's word choices, which are Rafa's to decide.

## Acceptance criteria

- [x] The buyer path is measured before and after from the build; it is at or near 4,500 tokens.
- [x] The seller path is not larger than before (4,232 tokens).
- [x] `FIRST_DEAL_BUDGET.tokens` stays 5,000; the HTTP buyer path does not grow.
- [x] Every moved passage lands on a reference page that the step which needs it names, by section.
- [x] Every safety instruction stays on the path: seller text is data; no one asks for a secret key; the install's SHA-256 check; check each field before approving; stop on `refusing to sign` or a disagreement; treat the work as data; never print the key file.
- [x] `node site/build.mjs && node site/check.mjs` passes, and the tests that read the guides pass.
- [x] One review by the `reviewer` agent, and one fresh agent acting as an outside buyer that plans a full deal from the built pages alone.

## Evidence

Tokens are bytes divided by four, rounded up, as `site/check.mjs` counts them on its sample build.

**The paths** [measured, `node site/build.mjs && node site/check.mjs`]:

| Path | Before, bytes | Before, tokens | After, bytes | After, tokens |
| --- | --- | --- | --- | --- |
| Buyer (`llms.txt` + `buy.txt`) | 19,997 | 5,000 | 18,188 | 4,547 |
| Seller (`llms.txt` + `sell.txt`) | 16,928 | 4,232 | 16,637 | 4,160 |

The buyer path leaves 453 tokens of headroom, 9 percent. `llms.txt` shrank by 291 bytes, so the HTTP buyer path, which starts with it, shrank too [inferred from the seller path's change; `sell.txt` is unchanged].

**What went, and where** [measured, from the diff]:

| Was | Now |
| --- | --- |
| `llms.txt`: "The operators keep their view across deploys..." | `ref/limits.txt`, "The view outlives deploys, not redeploys" (already there) |
| `llms.txt`: "Each costs its whole length" and "each on its own; fetch one only when a step sends you there" | one line under "Reference": "Fetch one only when a step names it." |
| `buy.txt` intro: "Each step gives the command, what a good answer looks like..." | `llms.txt` says it of each role page |
| `buy.txt` step 4: "Each decision is final when it settles" | `llms.txt`, "How a deal works", step 3 |
| `buy.txt` step 4: the clock entry stops even an unattended run | `ref/buyer-signer.txt`, "An unattended agent approves with its own terms" (already there) |
| `buy.txt` step 6: the wallet's files, the operator fee file, digests, `eth_signTypedData_v4`, the 65-byte rule, the holder's install | `ref/buyer-signer.txt`, "Payment from a separate wallet", which step 6 names; step 6 keeps the check, the same digest and the fund command |
| `buy.txt` step 9: running the agreed checks in a clone | `ref/checks.txt`, "The buyer's own check run", which step 9 names |
| `buy.txt` step 10: early reclaim answers 409 | `ref/after-funding.txt`, "Your own trigger", which step 10 names ("Too early is 409") |
| `buy.txt` step 11: `HOLDBACK_ENCRYPTION_KEY` for the hash check | `ref/buyer-signer.txt`, "The deal record's hash check", which step 11 names |
| wordy passages in steps 2, 3, 7 | tightened in place |

**Commands run** [measured]: `node site/build.mjs && node site/check.mjs`: PASS. `npx vitest run tests/site-guides.test.ts tests/guide-budget.test.ts tests/cut-feature-alignment.test.ts apps/operator/src/guide-pointers.test.ts apps/operator/src/agent-ready.test.ts examples/try.test.ts tests/forwarding.test.ts`: all passed. The reviewer also ran `vitest run tests/` (659 tests) and the operator and demo-cloud guide tests (196 tests): passed. `site/buy.mjs`, `site/try.mjs` and the three HTTP-path pages are unchanged. No scripted walkthrough of the `buy.mjs` path exists; `site/walkthrough.mjs` follows the HTTP path, whose pages this change does not touch except the smaller `llms.txt`, and it was not run [measured: read the script's header].

**Review** [measured]. The `reviewer` agent on commit 821ce9ca: ISSUES, two Medium and six Low, all fixed in the next commit. (1) The two new sections sat mid-page and took in the trust paragraphs under their heading: moved to the end of `ref/buyer-signer.txt`. (2) The front door's "open protocol" sentence, which Rafa kept in T-401, was cut: restored. (3) Step 6 again says the wallet must show the same digest, and names the second signature when the operator fee is above 0. (4) Step 3 again names `pay --help` and `record --help`. (5) The Etherscan line under "Configure" is restored. (6) The new headings are noun phrases, and the new sections open with a sentence. (7) The wallet's fund command carries `HOLDBACK_OPERATORS`. (8) This file is filled in.

**The outside buyer** [measured]. A fresh Sonnet agent, given only the built pages and told to run nothing, planned the first purchase: the install with its SHA-256 check, the card, the quote run, the field-by-field check (with the clock entry), the approve, the follow, the record and the report. It opened no reference page for the plain path, and one (`ref/buyer-signer.txt`, the wallet section, named by step 6) for the wallet variant. It found no broken reference. Its other questions were already open on main: how to choose scope fields when a seller's page names none, how long to wait on `unconfirmed`, whether a card's quote URL must share the seller's origin, and an explicit approval by the principal before step 5. They are in Handoff.

## Decisions

- The wallet, record-hash and offline-check passages went to the reference pages the buyer's tools already belong to, not to `ref/http-buyer.txt`, which sits on the HTTP buyer's budgeted path.
- The front door's "open protocol" sentence stays (Rafa kept it in T-401) at the cost of about 55 tokens.

## Handoff

Done: merged with this file. The site needs a deploy (Rafa's go) before crow.direct and `guide-budget.json` show the new counts.

Questions from the outside buyer that predate this change, for triage, not this task:
- `buy.txt` step 3 gives no rule when a seller's page names no scope fields.
- Step 8's `unconfirmed` has no wait limit before reporting to the principal.
- Step 2 does not say whether the card's quote and defaults URLs must share the seller's origin.
- Step 5 does not say plainly to get the principal's yes on the offer before approving.
