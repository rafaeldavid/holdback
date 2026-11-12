# T-393: a short guide for each role

- **Lane:** docs (the site's agent guides), on the branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-385 (the phase-one rewrite of `site/llms.txt` and `site/sell.txt`, PRs 432, 436 and 437); T-391 (the two-agent run, PR 442, which measured the problem)
- **Paths this task may touch:** `site/llms.txt`, `site/buy.txt`, `site/sell.txt`, `site/ref/*.txt`, `site/guides.mjs`, `site/build.mjs`, `site/check.mjs`, `site/index.html` and `site/try.mjs` as the build writes them, `tests/site-guides.test.ts`, this file
- **Human gate:** no. The site deploys from `main` only, after the lane merges there.
- **Status:** in progress
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
- [ ] One reviewer, following each page as an agent would, finds no step it cannot do from the page alone (or its findings are fixed).
- [ ] Merged into `contracts-audit-ready` with a merge commit once every check passed.

## Out of scope

- `tools/duet`: the local docs server, its allowlist, the scripted fetches and the guide-token measure must learn the new files. That is T-391's session's change; the exact diff is in the Handoff.
- `examples/pay-from-wallet.ts` names `site/llms.txt, "Pay from your own wallet"` in its comment. That text now lives in `ref/http-buyer.txt`. `examples/` is outside this task's paths.
- `scripts/record-copies.mjs` rewrites the deployment's addresses in `site/llms.txt`. They now live in `site/ref/signing.txt` (see the Handoff).

## Evidence

**The sizes, per role** [measured: `node site/check.mjs`, bytes divided by four, no key in this session]. The budget is 5,000 tokens.

| Path | Before | After |
| --- | --- | --- |
| Buyer: the guides it read | `llms.txt` + `sell.txt` (the buyer's tools were in `sell.txt`), 124,491 bytes, about 31,123 tokens | `llms.txt` + `buy.txt`, 17,032 bytes, about 4,258 tokens |
| Seller: the guides it read | `llms.txt` + `sell.txt`, 124,491 bytes, about 31,123 tokens | `llms.txt` + `sell.txt`, 15,256 bytes, about 3,814 tokens |

The provider's count was not run: this session has no key. Hex addresses and hashes take more tokens than prose. So the provider's count is likely higher than the estimate, by a margin I cannot measure here [guessed]. The first run with a key in CI or in Rafa's hands settles it: `HOLDBACK_AGENT_ANTHROPIC_API_KEY=… node site/check.mjs`.

**All the guides together.** Before, 124,491 bytes in 2 files. After, 139,047 bytes in 14 files [measured]. The total grew by 14,556 bytes, mostly because `buy.txt` is new (11,225 bytes) and each reference file has its own title and opening line. An agent fetches only its role's two files, and then a reference file when a step names one.

**The two-agent run, scripted** [measured, 2026-11-12]. Both versions ran `pnpm duet run --scenario <name> --buyer scripted --seller scripted` from a scratch merge of PR 442 and the lane. "Before" is the lane at 57fba5e3. "After" adds this branch's files and T-391's diff from the Handoff, applied in scratch only. Tokens are each agent's billed input and output, split into the guides it carried and the rest ("work"), as `tools/duet/measures.ts` estimates them at four bytes a token.

| Scenario | Buyer guides, before → after | Buyer work, before → after | Seller guides, before → after | Seller work, before → after | Outcome, both runs |
| --- | --- | --- | --- | --- | --- |
| paid | 148,830 → 21,360 | 16,775 → 12,765 | 248,050 → 38,280 | 23,872 → 20,413 | Released |
| refund | 148,830 → 21,360 | 15,316 → 11,304 | 347,270 → 49,764 | 51,499 → 42,771 | Refunded |
| bad-offer | 124,025 → 17,088 | 11,166 → 7,679 | 322,465 → 45,936 | 36,634 → 28,417 | no hold |
| late-offer | 148,830 → 25,632 | 15,341 → 12,723 | 322,465 → 49,764 | 36,756 → 31,063 | no hold |

The guides served were `llms.txt` 85,753 and `sell.txt` 39,091 bytes before, and `llms.txt` 5,788, `buy.txt` 11,225 and `sell.txt` 9,449 bytes after. Before, every scenario's ticket was over the token limits. After, no ticket names tokens. The one item left, late-offer's "agreeing to terms the owner's brief forbade: 1", was there before as well. It comes from the scripted buyer's fixed steps, not the docs.

**What this proves, and what it does not.** A scripted stand-in replays fixed tool calls. It proves the count, not that a model can work from the pages. These are the steps where I think a model is most likely to need the reference, for the first live runs to check [guessed]:

1. `buy.txt` step 4: the scope's fields. They are the seller's own, and the page says only that the seller's page or defaults name them.
2. `buy.txt` step 5: comparing the offer's `windows` and `deadlines` with the owner's dates, and reading `differences`.
3. `buy.txt` step 7: paying from a separate wallet. The holder's check and signing happen outside the agent, and the full rules are in `ref/http-buyer.txt`.
4. `buy.txt` step 10: binary work, which the tool does not return.
5. `sell.txt` step 9: an API of another shape than the adapter's, whose mapping is in `ref/seller-adapter.txt`.
6. Selling to Crow's test buyer, which needs an offer and a delivery over HTTP (`ref/http-seller.txt`, `ref/signing.txt`).

**Commands run and results** [measured]:
- `node site/build.mjs && node site/check.mjs`: PASS, with the two path counts above.
- `pnpm vitest run tests/site-guides.test.ts tests/site-deploy.test.ts examples/try.test.ts`: 3 files, 25 tests passed.

**Where each section went.** Sizes are bytes of the section, heading included. "After" is the new section, which may be reworded or tightened. No fact was dropped on purpose; "condensed" means the same facts in fewer words.

| Section before (file) | Bytes before | Where it is now | Bytes after |
| --- | --- | --- | --- |
| Head: tagline, what Crow is, test tokens (llms.txt) | about 1,150 | `llms.txt` head, unchanged; the "everything over HTTP, no SDK" sentence moved to `ref/http.txt`'s opening | about 1,150 |
| Try it: one test deal (llms.txt) | 5,447 | `llms.txt` "Try it", condensed (1,549). The test seller's card, catalog, limits and windows and the by-hand purchase are in `ref/intake.txt`, "Crow's test seller" (3,813). | 5,362 |
| Sell on Crow (llms.txt) | 500 | `llms.txt` "Read one page for your role" | 522 |
| Two agents, two people (llms.txt) | 5,393 | `ref/intake.txt`, same section | 5,664 |
| Configure (llms.txt) | 1,316 | `OP1`/`OP2` stay in `llms.txt` "Configure" (331); the domain and deployment pins are in `ref/signing.txt` "Pins" (1,244) | 1,575 |
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
| (new) The buyer's first hour | none | `buy.txt`: rules for every step, 12 steps, where to go next | 11,225 file |

## Decisions

- **The buyer's first hour uses the buyer's tools from the public repository** (`buy-with-signer`, `pay-from-wallet`, `deal-record`), not raw HTTP signing. The tools check every message before they sign, and the two-agent run's buyer uses them already. A raw-HTTP buyer path (keys, faucet, check, the funding nonce, the types) measured about 7,800 tokens before trimming, well over the budget. The HTTP path is complete in `ref/http.txt`, `ref/signing.txt` and `ref/http-buyer.txt`. Proposed to the coordinator on 2026-11-12. No objection had arrived when the branch started; Rafa may overrule.
- **The reference is eleven files, not one file with anchors.** An agent fetches a text file whole: an anchor saves nothing. Each file holds one topic a step can name.
- **The deployment's addresses live in `ref/signing.txt` alone.** Neither tool path needs them on the front door, and keeping them in one file keeps the cutover's rewrite to one place. The site check fails if any other guide names one of them.
- **The token count uses the agents' own key, `HOLDBACK_AGENT_ANTHROPIC_API_KEY`,** as the two-agent run does, never the live judges' key.
- **Crow's test buyer moved out of `sell.txt`** into `ref/intake.txt`, beside the test seller. Selling to it needs an offer and a delivery over HTTP, which the adapter's first hour does not use.

## Handoff

To be completed at the merge.
