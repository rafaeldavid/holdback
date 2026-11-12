# T-359: the seller's page

- **Lane:** demo (site and agent docs)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 1 (copy and agent docs), from the Change recipes in `docs/team.md`: `node site/build.mjs && node site/check.mjs`, no review, a target of 40k tokens
- **Depends on:** T-329 (PR 317), T-330 (PR 316), T-331, T-332 (PR 320), T-333, T-355 (PR 363), all merged on `main`
- **Paths this task may touch:** `site/llms.txt`, the new `site/sell.txt`, `site/build.mjs` and `site/check.mjs` only as the page needs, this file
- **Human gate:** no for the change; the site deploy that publishes the page is Rafa's
- **Status:** done (PR 373, merge commit `18d2225`; this status lands with its own PR)
- **Agent/session:** the T-359 session, 2026-11-12, branch `t-359-seller-page`; pilot plan package 5 (crow-private `roadmap/plans/2026-11-11-pilot-refocus.md`, section 7.1)

## Intent

**Why.** In the pilot a seller's engineer and its agents set up the seller adapter from the public docs, and the hours they spend are one of the pilot's measures. Today the seller's part of `site/llms.txt` is four sections spread through a 98,821-byte guide [measured], so a seller reads five times more than it needs, and nothing tells it the order of the first steps.

**Goal.** One seller page, `site/sell.txt`, served at `https://crow.direct/sell.txt` and linked from `site/llms.txt`. It opens with a "first hour" list: the steps a new seller's engineer or agent takes, in order, from a clone to a first delivered deal against the stub on a local chain. Each step names its command, what the seller sees when it worked, and what to do when it did not. After the list come the four seller sections, with the doc lines that T-329 to T-355 left for this package folded in.

**Inputs.** The four seller sections of `site/llms.txt` ("Sell to Crow's test buyer", "Sell a priced API service", "A seller's client can carry the buyer's side", "Writing checks for a report"); the doc lines in the Handoff sections of T-331, T-332, T-333 and T-355; the code on `origin/main`, which every command on the page is run against.

**Outputs.** `site/sell.txt`; a short pointer in `site/llms.txt` where the sections were; `site/build.mjs` writes the page into a publish build; `site/check.mjs` checks the page as it checks `site/llms.txt`.

**Non-goals.** Any change to code under `examples/`, `apps/` or `packages/`: a command that fails because the code is wrong goes to Handoff. The contract lane's schema v0.11 (a seller payout address and a buyer payment address): it is not on `main` and R6c-3 adds it. The site deploy. Any partner or customer name.

## Acceptance criteria

- [x] `site/sell.txt` opens with a "first hour" list; each step names its command, what working looks like, and what to do when it did not work.
- [x] The four seller sections live only in `site/sell.txt`; `site/llms.txt` keeps a pointer and no copy.
- [x] The doc lines of T-331, T-332, T-333 and T-355 are on the page.
- [x] Every command on the page was run on this branch, or is labelled as not run.
- [x] `node site/build.mjs && node site/check.mjs` pass; `site/check.mjs` checks the page.
- [x] A fresh agent with only the page reaches a delivered deal against the stub on a local chain, or names the step where the page failed it.

## Out of scope

- A fix to the gap this task found: on `pnpm sim` no shipped buyer can fund an offer (Handoff).
- The deploy script's live check of `sell.txt` (`site/deploy.mjs` checks `/`, `/llms.txt` and `/try.mjs`).

## Evidence

- **Sizes [measured].** The four seller sections held 18,840 of 96,913 bytes at commit `31cc285`, as the plan says; on `origin/main` (`2d03383`) they held 20,748 of 98,821 bytes (3,484 + 7,285 + 4,875 + 5,104). After this change `site/llms.txt` is 78,762 bytes, and `site/sell.txt` is 33,495 bytes: the four sections, the doc lines, the "Keep a record of each deal" section and the first hour.
- **Checks [measured].** `node site/build.mjs && node site/check.mjs`: PASS. A planted line naming `examples/nope.ts`, `pnpm nope` and `127.0.0.1` outside the first hour failed the three new checks, one line each. `node site/build.mjs --op1 https://api.crow.direct --op2 https://api2.crow.direct --out <scratch>` writes `sell.txt` byte for byte equal to `site/sell.txt`. `pnpm exec vitest run examples/try.test.ts`: 7 passed. No code outside `site/` changed, so `pnpm lint` and `pnpm typecheck` were not run.
- **Every first-hour command, run on this branch [measured].** `pnpm sim` banner; the stub's ready line; `node examples/seller-adapter.ts seller.json --sim` printed its four lines with club `sim-club` and a mandate to 2027-11-12; `GET /defaults` answered the template; a curl quote answered `2000000000` and a total of `2001000000` base units of tUSD, and both operators served the commitment; a bad `scope.commit` answered 400 naming the field; a file with `quoteRateLimit.perClient` exited 2 naming it; `pnpm audit-deal --case released` ended Released in 2 s; `--case all` ended 7 of 7 as expected in 7 s. Step 9 (Sepolia) was not run.
- **The gap, measured.** On `pnpm sim`, `HOLDBACK_OPERATORS=http://127.0.0.1:8787,http://127.0.0.1:8788 node examples/buy-with-signer.ts http://127.0.0.1:8791/quote <dir> '<scope>' 3000000000 http://127.0.0.1:8791/defaults` got through the quote and the shown fields, then stopped at the agreement: `scope_exceeded: 0x… has no mandate in club sim-club`.
- **Fresh-agent test [measured].** One subagent (Sonnet, no context but the built `sell.txt`) cloned the public repository into a scratch folder and followed steps 1 to 8. It reached a delivered deal in step 2 (Released, the buyer opened the report) and 7 of 7 cases in step 8, in about 80 s from the first command to cleanup, with the install about 20 s. No step blocked it. It found one wrong line: step 7 said both operators answer `"Offered"`, and by then they answered `"AcceptedByAdjudicator"`. It also found three unclear ones in step 2: the step numbering, the club `demo-club` where step 5 shows `sim-club`, and two unexplained `refused request … 404` lines. All four are fixed on the page. That the 404s are the adapter's mandate read of a seller the world did not know yet is inferred from `mandateEnd()` in `examples/seller-adapter.ts`, not traced.

## Decisions

**The seller sections move to `site/sell.txt`; `site/llms.txt` keeps a pointer.** The other choice, building the page from the same source with the sections left in `site/llms.txt`, keeps the guide at 98,821 bytes and every seller reading through it; the plan's point is that a seller reads a fifth. Moving the text leaves one source with no build-time copy. The cost: section references on the page ("section 5") now point into another file, so the page says once at the top that section numbers are those of `https://crow.direct/llms.txt`.

**The page is text, not HTML.** `llms.txt` is served as text and read by agents; the seller page is the same kind of document. A person reads it as Markdown.

**The first hour runs on `pnpm sim` and `pnpm audit-deal`.** The whole deal through the stub ends Released in `pnpm audit-deal --case released`, in 2 s [measured]. The seller's own configuration file runs on `pnpm sim` up to a signed offer that both operators serve [measured]; no shipped buyer funds it there (Handoff). The page says so rather than offer a step that fails.

## Handoff

**Done.** `site/sell.txt` with the first hour and the seller sections, the doc lines of T-331, T-332, T-333 and T-355 placed, the pointer in `site/llms.txt` (a "Sell on Crow" section, and one line under "Writing checks that protect a buyer"), `sellerPage()` and the publish write in `site/build.mjs`, check group 10 in `site/check.mjs` and check group 9 moved to read `sell.txt`. One stale line fixed while moving: "Run it as a service" said `quoteRateLimit` limits per client, which T-331 removed.

**Not done.**
- **The site deploy is Rafa's** (`pnpm site:deploy`). Until it runs, `https://crow.direct/sell.txt` does not exist and the live `llms.txt` still carries the four sections. `site/deploy.mjs` checks `/`, `/llms.txt` and `/try.mjs` after the upload, not `/sell.txt`; adding it is a small change to the deploy script, out of this task's paths.
- **For R6c-3 (the contract lane, schema v0.11).** The page names no payout or payment address. R6c-3 adds the seller's payout address to "Sell a priced API service" (the adapter's configuration, and what the offer signs) and to the first hour's step 5 if the adapter needs a new field to start, and the buyer's payment address to "A seller's client can carry the buyer's side" (the fields the signer shows and checks). `site/check.mjs` group 10 then holds any new file or script those lines name.

**For the coordinator: a gap in code, not on the page.** On `pnpm sim` no shipped buyer funds an offer: the sim's faucet (`apps/operator/src/registry.ts`, `faucet`) grants tokens and no mandate, and `examples/buyer-signer.ts` always makes fresh keys, so `buy-with-signer.ts` stops at the agreement with `scope_exceeded`. The seller's own configuration file therefore reaches a signed offer on a local chain, and the delivered deal on a local chain comes from `pnpm audit-deal`, whose world's faucet grants a mandate. Two small fixes would each close it: the sim's faucet grants a mandate in the sim club, as the test service's does; or `buy-with-signer.ts` takes `--sim`, as the adapter does, and uses a funded sim account. Either lets the first hour end with the seller's own adapter delivering. Not fixed here: it is outside this task's paths.

**Outside the listed paths.** `tests/audit-report-template.test.ts` read "Writing checks for a report" from `site/llms.txt`. Its describe block now reads it from `site/sell.txt` and checks that `llms.txt` points there (about 10 lines). No other test read the moved text, and the test follows the doc it checks. CodeQL flagged `site/check.mjs` for a URL substring test (js/incomplete-url-substring-sanitization), so the check parses links as group 2 does.

**For the service recipe's owner.** `examples/seller-adapter.Caddyfile` forwards `/quote` only, so `GET /defaults` answers 404 through it, and a card's `pricing.defaults` cannot point there. The fix is a `handle /defaults { reverse_proxy 127.0.0.1:8791 }` block beside `/quote`, plus a line in `examples/seller-adapter-service.md`. The page says so today. `POST /deals/<id>/ready` stays on loopback on purpose. Also roadmap work, from the coordinator (2026-11-12): the adapter sends the seller's API no credential and has no request mapping, so a seller whose API has another shape runs a small service in between. The page says so at step 9 of the first hour.

**How to resume.** `node site/build.mjs && node site/check.mjs`. To rerun the fresh-agent test, build with `--out`, give a new agent only `<out>/sell.txt`, and ask it to follow steps 1 to 8 in an empty folder.
