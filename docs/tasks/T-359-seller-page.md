# T-359: the seller's page

- **Lane:** demo (site and agent docs)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 1 (copy and agent docs), from the Change recipes in `docs/team.md`: `node site/build.mjs && node site/check.mjs`, no review, a target of 40k tokens
- **Depends on:** T-329 (PR 317), T-330 (PR 316), T-331, T-332 (PR 320), T-333, T-355 (PR 363), all merged on `main`
- **Paths this task may touch:** `site/llms.txt`, the new `site/sell.txt`, `site/build.mjs` and `site/check.mjs` only as the page needs, this file
- **Human gate:** no for the change; the site deploy that publishes the page is Rafa's
- **Status:** in progress
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

Filled in below as the work runs.

## Decisions

**The seller sections move to `site/sell.txt`; `site/llms.txt` keeps a pointer.** The other choice, building the page from the same source with the sections left in `site/llms.txt`, keeps the guide at 98,821 bytes and every seller reading through it; the plan's point is that a seller reads a fifth. Moving the text leaves one source with no build-time copy. The cost: section references on the page ("section 5") now point into another file, so the page says once at the top that section numbers are those of `https://crow.direct/llms.txt`.

**The page is text, not HTML.** `llms.txt` is served as text and read by agents; the seller page is the same kind of document. A person reads it as Markdown.

**The first hour runs on `pnpm sim` and `pnpm audit-deal`.** The whole deal through the stub ends Released in `pnpm audit-deal --case released`, in 2 s [measured]. The seller's own configuration file runs on `pnpm sim` up to a signed offer that both operators serve [measured]; no shipped buyer funds it there (Handoff). The page says so rather than offer a step that fails.

## Handoff

To be filled in at the end.
