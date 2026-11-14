# T-427: the demo page, reviewed against the pilot and this week's work

- **Lane:** site (the demo page's own files)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 1 (copy), with the demo generator's tests (`tools/duet/duet.test.ts`), from the Change recipes in `docs/team.md`; one `reviewer` pass, told to check every statement on the page against the live service; no red team
- **Depends on:** T-391 (the two-agent demo), T-418 (the ontology's words), T-420 (the test seller's live endings)
- **Paths this task may touch:** `site/demo/index.html`, `tools/duet/replay.ts`, `tools/duet/scenarios.ts` (one note), `tools/duet/duet.test.ts`, `tools/duet/README.md`, this file. Never: `site/build.mjs`, `site/check.mjs`, `site/footer.ts`, the header, the trust and status pages (T-421), the guides, `site/brand/`, `site/try.mjs`, `site/buy.mjs`.
- **Human gate:** no for the merge and the site deploy (Rafa's word for the wave of 2026-11-14: merge and deploy when ready). The proposal below waits for Rafa.
- **Status:** done (PR 536, merged as `d3ce4cf3`; site deployed 2026-11-14 13:14 UTC)
- **Agent/session:** the T-427 session, 2026-11-14, branch `t-427-demo-refresh`

## Intent

Rafa asked on 2026-11-14 whether the demo at crow.direct/demo still fits what the pilot and this week's work taught us. The page was made from one scripted run on a local simulator before the pilot's talks, the ontology's words and the test seller's live endings. This task reads the page as it is live, judges it against those, fixes the words that are wrong in the demo's own files, and brings back one proposal, with a rough mock, for what would need a new section.

## Acceptance criteria

- [x] The live page read as served, at phone width (375 px) and desktop width (1,280 px), and its source found: `site/demo/index.html`, written by `pnpm duet publish` from `tools/duet/replay.ts`.
- [x] A verdict on each question in the brief, with evidence from the page (below).
- [x] The page uses none of the ontology's refused claims, and says the payment hold with its release rule, the refund included; a test fails the page if it does not.
- [x] `node site/build.mjs && node site/check.mjs` and `pnpm exec vitest run tools/duet` pass.
- [x] One `reviewer` pass; its findings fixed or recorded (Review, below).
- [x] Merged by hand when `check` and `gitleaks` pass; the site deployed, with its version recorded.
- [x] One proposal with a mock under `reports/scratch/t427/`, and the one decision it needs from Rafa.

## The verdict

**What holds up.** The page looks and behaves like the rest of the site since the brand kit: warm white page, graphite text, the maple accent only on the filled button, one idea at a time, and it works at 375 px [measured: screenshots at 375 px and 1,280 px, 2026-11-14]. Every number on it is honest about where it came from: it says on the page that the deal is a scripted run on a local test setup with test money and no public records. The four steps under "How the payment is held" are the right story, and the step "Settle in one step" already says the price goes back if the work fails.

**What was stale.** Four things on the page contradicted the ontology settled on 2026-11-14:

| Where | Before | Why it was wrong |
| --- | --- | --- |
| Learn more, "What did each side pay and receive" | "Independent reviewer: received 1 test dollar" | A refused claim: Crow runs the reference reviewer. T-418 changed the other three uses and missed this one |
| The held-payment line (twice) and step 2 | "Neither side can take it alone." | The ontology lists this phrase as what triggers the buyer's worry; the calm form says the release rule |
| No admin keys | "no one can move held money outside the agreed terms" | Too wide: the ontology's form is "no one at Crow, and neither side alone" |
| The opening, the Learn more intro, "The new way" | "the payment is set aside" with no refund rule | The pilot's lesson is that a buyer wants to hear the money comes back; the home page already says "refunded at the deadline if it doesn't" |

The refund scenario's note in `tools/duet/scenarios.ts` and the README's table of plain words (linked from the page's "For engineers" card) also said "independent reviewer".

**What is missing.** The page shows only the happy path, and only on a local simulator. Since 2026-11-14 the test seller plays three endings live on Sepolia (T-420): judged work that passes (73.0 s), judged work that fails and is refunded (35.1 s), and a seller that never delivers, refunded after its 5-minute deadline (368.2 s). A reader with two minutes cannot see on the page that the buyer's money comes back when the work fails or never arrives, the worry the pilot's interviews raised first. That needs a new section: the proposal below.

## Answers to the brief's questions

1. **Does it show that the buyer's money comes back and the seller is paid the moment the work passes?** Half before this change. "The seller is paid the moment the work passes" is in the opening; the refund was only in step 4 of Learn more, for failed work, and a silent seller was not mentioned. After the change the opening says "If the work fails or never arrives, the buyer gets the price back", and step 4 adds the deadline refund.
2. **Only the happy path?** Yes. The replay is one paid deal. The refund and the silent seller exist live but are not shown: the proposal.
3. **In line with the ontology?** Not before (the table above); yes after, and a test now fails the page on the refused words (`REFUSED` in `tools/duet/duet.test.ts`). "Deal", "reviewer", "payment hold" and "company" are used; "escrow", "commitment" and "adjudicator" stay out of the reader's text (the existing `BANNED` test).
4. **Every number and statement true against the live service?** The page's numbers are the local run's and are labelled so (700 test dollars, 5 seconds, 0 people). The general statements hold: the reviewer's fee is kept on a refund after delivery and the whole payment comes back after a missed deadline (T-399 cases 4 and 5, measured on Sepolia), the reclaim needs no one's signature (`site/ref/after-funding.txt`), the settlement contracts have no admin key (`contracts/src/HoldbackRules.sol` line 20 and its immutables, read by the reviewer). The token is tUSD on the local run and tUSDC on the live service; the page names the local run's token, which is true of that run.
5. **Does it lead to the next step?** Early access twice, Learn more, and the guides under Resources. It never says a reader can run a test deal; the front page's line under Resources now says "Where an AI agent starts, and the one command for a test deal". The proposal adds a "Try one yourself" line.
6. **Looks and behaves like the site?** Yes (above). The page's share description ("set the payment aside and settle when the work passes") lives in `site/footer.ts`, outside this task's paths; it is not wrong, so it stays.

## The proposal (waits for Rafa)

**Three ways a deal ends, on the public test network.** Under the player, a section with a three-way switch: "The work passes", "The work fails", "The seller goes silent". One card shows at a time, each with its rule in one sentence, two measured numbers and a link to that deal's public record on the live API. The replay above stays as it is.

- **Mock:** `reports/scratch/t427/mock-three-endings.html` in the main checkout (not committed). The player is a placeholder in the mock.
- **What it shows that the page does not:** that the money comes back when the work fails or never arrives, on real deals a reader can check without asking Crow, with live times (73 s, 35 s, 6 min 8 s) next to the local run's 5 s.
- **What it takes:** a block in `replay.ts` with the three deals' IDs and numbers from a small data file (filled from T-420's table), its styles, a test, and one publish; about half a day of a session, kind 1 [guessed]. The three records are public already. The numbers are one run each; a later refresh could take them from T-425's 20 timed deals.
- **The alternative:** a switch above the player that replays a whole scripted run per ending (`pnpm duet run --scenario refund` exists; a silent seller does not yet). Fuller, but local only, with no public record, and three runs in one 90 KB page.
- **The decision for Rafa:** add the three-endings section under the player, linking the three live test deals' public records?

## Evidence

All measured on 2026-11-14 in this branch's worktree unless marked otherwise.

- **The live page:** `GET https://crow.direct/demo/` answered 200, 88,640 bytes; `version.json` read commit `a6b94727`, version `b0c3a3d3-448d-40dd-a112-38e0cce332de`, deployed 12:17:02 UTC.
- **The three live endings still read as T-420 recorded them:** `GET https://api.crow.direct/v1/commitments/<id>` gave `escrowState` Released for `0xf3d68191…a8cd`, Refunded for `0x3b35c932…f249` and Refunded for `0x2b6e735a…0b9b`.
- **Test first:** with the old `site/demo/index.html`, `replay.ts` and `scenarios.ts` and the new tests, 3 tests failed: "paid ends Released…", "refund ends Refunded…" and "uses no refused claim…". With the new files, `pnpm exec vitest run tools/duet` passed 32 of 32.
- **Site checks:** `node site/build.mjs --op1 https://api.crow.direct --op2 https://api2.crow.direct --out reports/site-out && node site/check.mjs`: PASS. `try.mjs` SHA-256 `04ef4434…75c8`, the same as the live install line, so no copy of the try command handed out stops working. Buyer's first-deal path 5,000 of 5,000 tokens and seller's 4,232 (estimates), from the guides, which this task does not touch.
- **How the page was edited:** no run record of the published run is left on this machine, so the same eleven replacements went into `replay.ts` and the committed page by one script, each with its expected count (as T-418 did by hand). A future `pnpm duet publish` writes the same words.

## Review

One `reviewer` pass on commit `482023d8`, told to check every statement on the page against the live service and the contracts: ISSUES, none blocking. It confirmed against `contracts/src/HoldbackRules.sol` that a refund after delivery returns the price and pays the reviewer its fee, that after a missed deadline anyone may trigger the reclaim with no signature and the whole payment comes back, that payment and the key are released in one transaction, and that the contract has no owner, pause or upgrade. What became of each finding:

1. **Medium, fixed:** step 2 said the whole payment comes back when the work fails; the reviewer keeps its fee. It now says "The price is released to the seller when the work passes, and comes back to the buyer if the work fails or misses its deadline", and a test pins it.
2. **Low, fixed:** "the price goes to the seller only if the work passes" left out a settlement both sides sign and the buyer's early accept. "only" is gone.
3. **Low, recorded:** "no one at Crow, and neither side alone, can move held money outside the agreed terms" is true of the contract, but Crow runs all three default reviewers on the live service (`demo.adjudicators` in discovery), whose pass or fail decides where the money goes inside the terms. Left as is; the reviewer's wording is part of the proposal's question about what the page says of reviewers.
4. **Low, fixed (older than this change):** "Each agent signs every step it takes" read wider than the facts (reads and the timeout refund are unsigned). It now says "every step that moves the deal on".
5. **Low, fixed:** the test now also refuses a bare "no one can", and checks step 2's rule.

After the fixes: `pnpm exec vitest run tools/duet` 32 of 32, `node site/check.mjs` PASS.

## Handoff

**Done; the proposal waits for Rafa.**

- **Merged:** PR 536 as `d3ce4cf3`, by hand, after all 14 checks that ran passed, `check` and `gitleaks` among them (2 contract suites skipped: no contract change).
- **Site deploy 2026-11-14 13:14 UTC, commit `d3ce4cf` on a detached HEAD: pass.** crow-site `610258b8-a9a7-4761-927a-c44d9f228c6d` (rollback target `b0c3a3d3-448d-40dd-a112-38e0cce332de`). It also carried PR 531 (the buyer guide's shorter wording, `site/buy.txt`, `site/llms.txt`, two `site/ref/` files), merged by another session and not deployed before.
- **Live checks (plain GETs, 13:15 UTC, measured):** `version.json` reads commit `d3ce4cf3` and version `610258b8…`; `https://crow.direct/demo/` holds each of the six new sentences and no "independent" or "Neither side can take"; `try.mjs` SHA-256 `04ef4434…` and `buy.mjs` `e74ff223…`, both unchanged, so no copy of the try command or the install line handed out stops working.
- **For Rafa:** the proposal above (three ways a deal ends) and its one question. Mock: `reports/scratch/t427/mock-three-endings.html` in the main checkout.
- **Follow-ups, not built:** the share description in `site/footer.ts` could add the refund rule (the footer's lane); review finding 3 (what the page says of who the reviewers are) goes with the proposal.
