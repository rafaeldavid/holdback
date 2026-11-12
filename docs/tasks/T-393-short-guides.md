# T-393: a short guide for each role

- **Lane:** docs (the site's agent guides), on the branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-385 (the phase-one rewrite of `site/llms.txt` and `site/sell.txt`, PRs 432, 436 and 437); T-391 (the two-agent run, PR 442, which measured the problem)
- **Paths this task may touch:** `site/llms.txt`, `site/buy.txt`, `site/sell.txt`, `site/ref/*.txt`, `site/guides.mjs`, `site/build.mjs`, `site/check.mjs`, `site/index.html` and `site/try.mjs` as the build writes them, `tests/site-guides.test.ts`, this file; and, by the coordinator's leave, one line of `tools/duet/duet.test.ts` (line 89)
- **Human gate:** no. The site deploys from `main` only, after the lane merges there.
- **Status:** done
- **Agent/session:** T-393 kind 1 session, started by the coordinator

## Intent

An agent that does one ordinary deal today reads about 31,000 tokens of Crow's guides and carries them on every later turn. In T-391's scripted paid run, carrying the guides cost the buyer 148,830 of its 165,605 tokens [measured]. The goal: an agent finishes one ordinary deal after reading at most about 5,000 tokens of Crow's docs for its role.

The inputs are today's two guides: `site/llms.txt` (85,400 bytes) and `site/sell.txt` (39,091 bytes). The outputs are:

- a front door, `llms.txt`, that says what Crow is and which page to read for which role;
- a buyer's page, `buy.txt`, and a shorter seller's page, `sell.txt`, each a first hour: one command per step, what a good answer looks like, and what each error means;
- the rest as reference files, each fetched alone, with each fact kept and no sentence in two files;
- a site check that counts each role's path against one stated budget and covers every file, link, call, command and script the guides name.

Non-goals: no change to what the API or the tools do, no deploy, no edit to `tools/duet` (the change it needs is in the Handoff), and nothing under `docs/` but this file.

## Acceptance criteria

- [x] A buyer's first-deal path (`llms.txt` + `buy.txt`) and a seller's (`llms.txt` + `sell.txt`) are each within the budget, and the site check counts them.
- [x] The budget is stated in one place (`FIRST_DEAL_BUDGET` in `site/guides.mjs`). With `HOLDBACK_AGENT_ANTHROPIC_API_KEY` set, the site check counts with Anthropic's `count_tokens` for `claude-opus-5-5`, the pinned model the two-agent run plays by default. Without a key it uses bytes divided by four, and it prints which method it used.
- [x] `llms.txt` is a short front door: what Crow is, which page to read for which role, "Try it", `OP1`/`OP2`, how a deal works, and the reference list.
- [x] The site check covers every guide:
  - the front door's reference list equals `site/ref/`;
  - every reference a guide names exists;
  - every crow.direct link resolves;
  - no sentence is in two guides;
  - every call is a route in `docs/api.md`;
  - every file under `examples/`, `fixtures/` or `spec/`, every `node examples/…` command and every `pnpm` script exists;
  - the deployment's addresses appear in `ref/signing.txt` alone;
  - a publish build writes every guide.
- [x] No fact is lost: the table below maps each section of the old guides to its new place.
- [x] The scripted two-agent runs report guide tokens before and after.
- [x] One reviewer, following each page as an agent would, found 14 issues, all fixed.
- [ ] Merged into `contracts-audit-ready` with a merge commit once every check passed.

## Out of scope

- `tools/duet`: the local docs server, its allowlist, the scripted fetches and the guide-token measure must learn the new files. That is T-391's session's change; the exact diff is in the Handoff.
- `examples/pay-from-wallet.ts` names `site/llms.txt, "Pay from your own wallet"` in its comment. That text now lives in `ref/http-buyer.txt`. `examples/` is outside this task's paths.
- Bundling the buyer's commands as one pinned file fetched from the site, like `site/try.mjs`, which needs changes in `examples/` (see Decisions).

## Evidence

**The sizes, per role** [measured: `node site/check.mjs` at the merge commit, bytes divided by four, no key in this session]. The budget is 5,000 tokens.

| Path | Before | After |
| --- | --- | --- |
| Buyer: the guides it read | `llms.txt` + `sell.txt` (the buyer's tools were in `sell.txt`), 124,491 bytes, about 31,123 tokens | `llms.txt` + `buy.txt`, 18,229 bytes, about 4,558 tokens |
| Seller: the guides it read | `llms.txt` + `sell.txt`, 124,491 bytes, about 31,123 tokens | `llms.txt` + `sell.txt`, 16,042 bytes, about 4,011 tokens |

The provider's count was not run, because this session has no key. Hex addresses and hashes take more tokens than prose, so the provider's count is likely higher than the estimate [guessed]. The first run with a key settles it: `HOLDBACK_AGENT_ANTHROPIC_API_KEY=… node site/check.mjs` prints both counts and holds the provider's to the budget. CI has no key, so CI holds the estimate.

**All the guides together.** Before: 124,491 bytes in 2 files. After: 140,433 bytes in 14 files [measured]. The total grew by 15,942 bytes, mostly because `buy.txt` is new and each reference file has its own title and opening line. An agent fetches its role's two files, and then a reference file only when a step names one.

**The two-agent run, scripted** [measured, 2026-11-12]. Both runs used `pnpm duet run --scenario <name> --buyer scripted --seller scripted`.
- "Before" is the lane at 55a3dce, which carries PR 442.
- "After" is this branch with T-391's patch from the Handoff applied, uncommitted, and removed after the runs.

Tokens are each agent's billed input and output, split by `tools/duet/measures.ts` into the guides it carried and the rest ("work"), at four bytes a token.

| Scenario | Buyer guides, before → after | Buyer work, before → after | Seller guides, before → after | Seller work, before → after | Outcome, both runs |
| --- | --- | --- | --- | --- | --- |
| paid | 124,025 → 27,426 | 14,949 → 14,254 | 248,050 → 44,275 | 24,885 → 22,854 | Released |
| refund | 124,025 → 27,426 | 13,491 → 12,792 | 347,270 → 56,350 | 55,441 → 45,560 | Refunded |
| bad-offer | 99,220 → 22,855 | 9,426 → 9,067 | 297,660 → 52,325 | 33,674 → 31,118 | no hold |
| late-offer | 124,025 → 27,426 | 13,515 → 12,817 | 297,660 → 52,325 | 33,787 → 31,240 | no hold |

The guides served, before: `llms.txt` 85,753 and `sell.txt` 39,091 bytes. After: `llms.txt` 6,294, `buy.txt` 11,916 and `sell.txt` 9,729 bytes.

Before, every scenario wrote a ticket. After, three scenarios end within every limit with no ticket. The fourth, late-offer, still writes one, for "agreeing to terms the owner's brief forbade: 1". That ticket was there before too; it comes from the scripted buyer's fixed steps, not from the docs.

**What this proves, and what it does not.** A scripted stand-in replays fixed tool calls. It proves the count, not that a model can work from the pages. These are the steps where I think a model is most likely to need the reference, for the first live runs to check [guessed]:
1. `buy.txt` step 4: the scope's fields, which are the seller's own and which the page can only point to.
2. `buy.txt` step 5: comparing `deadlines` and `windows` with the owner's dates, and reading `differences`.
3. `buy.txt` step 7: paying from a separate wallet. The holder's check and signature happen outside the agent; the full rules are in `ref/http-buyer.txt`.
4. `buy.txt` step 10: binary work, which the tool does not return.
5. `sell.txt` step 9: selling on the test service. It needs HTTPS, a card, and an API of another shape than the adapter's (`ref/seller-adapter.txt`, `ref/intake.txt`).
6. Selling to Crow's test buyer, which needs an offer and a delivery over HTTP (`ref/http-seller.txt`, `ref/signing.txt`).

**The review** [measured]. One reviewer subagent followed each page as an agent would, against the lane's tools. It ran `pnpm sim`, the stub, the adapter, `buy.txt` steps 4 to 12 and `sell.txt` steps 2 to 8 locally, with test keys only. It found 14 issues, all fixed in commit "the reviewer's findings on the guides":
- Errors the tools really print, which the page left out or got wrong: the adjudicator has not yet taken the deal; an expired offer; a 429; a second approve; the stack-trace form.
- Missing facts: the operator-fee file on the wallet path; the fee on a settled or reclaimed refund; how to make `HOLDBACK_KEY`; HTTPS and the card for the test service.
- Counts that were wrong: eight rehearsal cases, not seven; six start-up lines, not four.
- Seven cross-references to sections that were not there. The site check now verifies every section a guide cites by name.
- A way to pass the encryption key to `deal-record` without reading the key file, which also holds the signing key.

What the reviewer could not run: anything on Sepolia ("Try it", `sell.txt` step 9, Etherscan links), a quote route that needs a credential, Crow's test seller and test buyer, the operator-fee path, the HTTP-only path (read only), and the provider's count.

**The cutover's sweep still passes** [measured]. On a throwaway copy of this branch, I gave `scripts/record-copies.mjs` a made-up record that changes the 4 deployment values `site/llms.txt` names. It replaced 5 occurrences in `site/llms.txt`, the sweep passed, and `node site/check.mjs` passed after. To finish the sweep in a fresh worktree, I removed the unchecked-out submodule's gitlink from the copy's index; that finding went to T-383.

**Commands run and results** [measured]:
- `node site/build.mjs && node site/check.mjs`: PASS, with the two path counts above.
- `pnpm vitest run tests/site-guides.test.ts tests/site-deploy.test.ts examples/try.test.ts tools/duet`: 4 files, 50 tests passed.
- `eslint` on the changed scripts and the test: clean.
- The check's new rules fail when they should. A planted link to `https://crow.direct/nothing.txt` failed it, and so did a planted citation of a section that does not exist.

**Where each section went.** Sizes are bytes of the section, heading included, measured at the first split (16046f21); the review's fixes later changed some by a few hundred bytes. "After" is the new section, which may be reworded or tightened. No fact was dropped on purpose; "condensed" means the same facts in fewer words.

| Section before (file) | Bytes before | Where it is now | Bytes after |
| --- | --- | --- | --- |
| Head: tagline, what Crow is, test tokens (llms.txt) | about 1,150 | `llms.txt` head, unchanged; the "everything over HTTP, no SDK" sentence moved to `ref/http.txt`'s opening | about 1,150 |
| Try it: one test deal (llms.txt) | 5,447 | `llms.txt` "Try it": the one command and its trust anchors (1,549). What the command does step by step: `ref/intake.txt`, "The one command" (added at the review). The test seller's card, catalog, limits and windows and the by-hand purchase: `ref/intake.txt`, "Crow's test seller" (3,813). | 5,362 |
| Sell on Crow (llms.txt) | 500 | `llms.txt` "Read one page for your role" | 522 |
| Two agents, two people (llms.txt) | 5,393 | `ref/intake.txt`, same section | 5,664 |
| Configure (llms.txt) | 1,316 | `llms.txt` "Configure": `OP1`/`OP2` and both pins, one sentence added that the tools pin them themselves | about 1,400 |
| How a deal works (llms.txt) | 1,075 | `llms.txt`, condensed; the problem-type pointer added | 998 |
| Conventions (llms.txt) | 2,891 | `ref/http.txt` "Conventions"; the token's address now points to the pins | 2,909 |
| 1. Make your keys (llms.txt) | 1,022 | `ref/http.txt` "Make your keys" | 1,019 |
| 2. Discover and get test tUSDC (llms.txt) | 3,945 | `ref/http.txt` "Discover and get test tUSDC"; the token's address shown as `<demo.token.id>` | 3,919 |
| 3. Read what you bind to (llms.txt) | 1,129 | `ref/http.txt`, same section | 1,126 |
| 4. Prepare, verify, sign, submit (llms.txt) | 3,620 | `ref/signing.txt`, same section | 3,639 |
| 5. Seller: offer (llms.txt) | 6,010 | `ref/http-seller.txt` "Offer" | 5,998 |
| 6. Buyer: check the offer, agree and fund (llms.txt) | 8,054 | `ref/http-buyer.txt` "Check the offer, agree and fund" | 8,119 |
| 7. Seller: encrypt and deliver (llms.txt) | 4,106 | `ref/http-seller.txt` "Encrypt and deliver", test vectors included | 4,094 |
| 8. Both: read the result (llms.txt) | 2,749 | Reading and "Who gets what": `ref/http.txt` "Read the result" (1,348). Opening the work: `ref/http-buyer.txt` "Open the work" (1,382). | 2,730 |
| Writing checks that protect a buyer (llms.txt) | 2,443 | `ref/checks.txt`, same section | 2,416 |
| Encodings (llms.txt) | 4,744 | `ref/signing.txt` "Encodings" | 4,743 |
| Beyond the happy path (llms.txt) | 4,782 | `ref/after-funding.txt`, same section | 4,820 |
| Run your own adjudicator (llms.txt) | 2,842 | `ref/adjudicators.txt`, same section | 2,871 |
| Private deals (llms.txt) | 3,057 | `ref/adjudicators.txt`, same section | 3,077 |
| EIP-712 types (llms.txt) | 8,309 | `ref/signing.txt`, same section | 8,308 |
| Reporting a problem (llms.txt) | 3,369 | `ref/limits.txt`, same section | 3,401 |
| Honest limits (llms.txt) | 5,558 | `ref/limits.txt`, same section, with the sources line | 5,584 |
| Endpoints used here, with the drawings' credits (llms.txt) | 1,872 | Endpoints: `ref/http.txt` (1,376). Credits: `ref/limits.txt` "The drawings" (512). | 1,888 |
| First hour (sell.txt) | 8,131 | `sell.txt` "First hour"; step 2 condensed, step 9 points to the reference; step 10, the deal record, added | 8,367 |
| Sell a priced API service, with Your API's shape (sell.txt) | 12,445 | `ref/seller-adapter.txt`, same section | 12,595 |
| Keep a record of each deal (sell.txt) | 876 | Seller: `sell.txt` step 10. Buyer: `buy.txt` step 12. | in the two steps |
| A seller's client can carry the buyer's side (sell.txt) | 8,183 | `ref/buyer-signer.txt`, same section. The commands' path is in `buy.txt` steps 4 to 12. | 8,408 |
| Sell to Crow's test buyer (sell.txt) | 3,505 | `ref/intake.txt`, same section | 3,491 |
| Writing checks for a report (sell.txt) | 5,103 | `ref/checks.txt`, same section | 5,103 |
| (new) The buyer's first hour | none | `buy.txt`: rules for every step, 12 steps, where to go next | 11,916 file |

## Decisions

- **The buyer's first hour uses the buyer's tools from the public repository** (`buy-with-signer`, `pay-from-wallet`, `deal-record`), not raw HTTP signing. The tools check every message before they sign, and the two-agent run's buyer uses them already. A raw-HTTP buyer path (keys, faucet, check, the funding nonce, the types) measured about 7,800 tokens before trimming, well over the budget. The page says in one sentence that nothing requires Crow's code, and names the HTTP path in `ref/http.txt`, `ref/signing.txt` and `ref/http-buyer.txt`; `sell.txt` does the same for the adapter. The coordinator approved this on 2026-11-12 and is putting it to Rafa, because the product is "API first".
- **The buyer's tools stay "clone and build" for now.** One pinned file like `site/try.mjs` is possible: the three commands and their imports use only Node built-ins, viem and tweetnacl. But two things in `examples/` break inside one bundle. `deal-record.ts` runs `main()` whenever `import.meta.url` is the running file, which is always true in a bundle, and `buyer-signer.ts` imports it. And the tools print their next command from their own paths: `buy-with-signer.ts` builds its approve and fund lines that way, and `buyer-signer.ts` its `pay-from-wallet` check line (`new URL('./pay-from-wallet.ts', import.meta.url)`). Both live in `examples/`, outside this task. T-390's session is making them bundle-safe; the coordinator routes the bundle as a follow-up.
- **The reference is eleven files, not one file with anchors.** An agent fetches a text file whole, so an anchor saves nothing. Each file holds one topic a step can name.
- **The deployment's pins stay in `llms.txt`**, the one file `scripts/record-copies.mjs` rewrites. They cost both paths about 330 tokens. Moving them to `ref/signing.txt` would have needed a change in `scripts/`, outside this task. The site check fails if any other guide names a deployment address.
- **The token count uses the agents' own key, `HOLDBACK_AGENT_ANTHROPIC_API_KEY`,** as the two-agent run does, and never the live judges' key.
- **Crow's test buyer, and the one command step by step, moved to `ref/intake.txt`,** beside the test seller. Selling to the test buyer needs an offer and a delivery over HTTP, which the adapter's first hour does not use.

## Handoff

**Done.** The front door, the two role pages and eleven reference files are written; the budget is stated in `site/guides.mjs`; the site check counts it and covers every guide. Merged into `contracts-audit-ready` (merge commit in the coordinator's report).

**The first site deploy after the lane reaches main must carry:**
- `site/llms.txt`, `site/buy.txt`, `site/sell.txt` and `site/ref/*.txt`, built by `node site/build.mjs --op1 … --op2 … --out reports/site-out`. The publish build writes every guide, `ref/` included, and `wrangler` uploads the whole folder (`apps/site/wrangler.jsonc`). Check after the deploy that `https://crow.direct/buy.txt` and `https://crow.direct/ref/http.txt` answer 200.
- `site/deploy.mjs` checks only `llms.txt` and `try.mjs` on the live site. A later change could add `buy.txt` and `sell.txt` to its probe; that is outside this task.

**The two-agent run must change** (T-391's session; the exact patch is `t-393-duet-diff.patch` in the coordinator's notes folder, and it applies cleanly on the lane at 55a3dce):
- `world.ts` serves every guide, from `localGuide`'s `pages`, built with `site/build.mjs`'s `guidePage` and `site/guides.mjs`'s `guideFiles`. `docs` gains `buy`.
- `run.ts` allows `/llms.txt`, `/buy.txt`, `/sell.txt` and the `/ref/` prefix on the docs origin.
- `scripted.ts`: the buyer reads `llms.txt` and `buy.txt`.
- `measures.ts` counts `buy.txt` and `ref/*.txt` as guides.
- Not in the patch, still to do:
  - `scenarios.ts`'s buyer brief should name `buy.txt`.
  - `README.md` and `limits.json` should take the new sizes.
  - `replay.ts` and `tickets.ts` should name the new files.
  - `duet.test.ts`'s refund branch (lines 84 to 93) expects a token ticket, which no longer comes once the buyer reads `buy.txt`. Line 89's floor was lowered from 10,000 to 1,000 tokens in this task by the coordinator's leave; T-391 replaces that assertion.

**Follow-ups:**
- T-390 part 2: an offer dated outside the operators' time band stops the unattended path, and every approval stop shows the deadlines as dates. `buy.txt` steps 4 and 5 should say so once it merges. That is a small follow-up the coordinator sends with the commit.
- The bundle of the buyer's tools (Decisions).
- `examples/pay-from-wallet.ts` names `site/llms.txt, "Pay from your own wallet"` in its comment. That text is now in `ref/http-buyer.txt`.
- The provider's count with a key: the first run with `HOLDBACK_AGENT_ANTHROPIC_API_KEY` set shows whether the hex-heavy front door keeps the buyer's path under 5,000 tokens. If it does not, cut `buy.txt` first.

**How to resume:** `node site/build.mjs && node site/check.mjs` prints each path's size. `site/guides.mjs` holds the budget and the helpers, and `tests/site-guides.test.ts` tests them. My scratch work is in `reports/scratch/t393/` on the maintainer's machine (not tracked).
