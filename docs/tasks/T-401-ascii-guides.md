# T-401: the agent guides in plain ASCII, and a cleanup of llms.txt

- **Lane:** agent guides, into `main`
- **Phase:** 2
- **Depends on:** T-393 (the short guides), T-399 (Findings 2 and 4)
- **Paths this task may touch:** `site/llms.txt`, `site/buy.txt`, `site/sell.txt`, `site/ref/*.txt`, `site/guides.mjs`, the guides' tests and checks (`tests/site-guides.test.ts`, `tests/audit-report-template.test.ts`, one block of `site/check.mjs`), `site/index.html` as the build writes it, this file. Off limits: `site/build.mjs`, `apps/site/`, the other HTML pages, `tools/duet/` (T-400's), `site/buy.mjs`.
- **Human gate:** no. Rafa asked for it (2026-11-13, about 10:00 UTC, relayed by the coordinator). Nothing deploys: the site deploy is Rafa's word.
- **Status:** in review
- **Agent/session:** T-393's session, kind 1

## Intent

Rafa asked, in his words: "Can you clean up the llms.txt as well? Just use the name crow so there's no weird unicode characters? Not sure if you can identify other issues".

An agent reads the guides as plain text, and it copies what it reads. A curly apostrophe in "’crow", an ellipsis inside `0x…`, or a `×` in a formula is a byte that it can copy into a value, or that it reads as part of the value. This task writes every guide an agent reads in ASCII, adds a check that keeps them that way, cleans up the front door's opening lines, and closes two gaps that the live rehearsal (T-399) found in `buy.txt`.

## Acceptance criteria

- [x] `site/llms.txt`, `buy.txt`, `sell.txt` and every `site/ref/*.txt` hold no byte above 127. "Crow" is written in words. `…` becomes `...`, or `<...>` / `0x<id>` / `0x<hash>` inside a copyable value. `×` becomes `x`, `−` and `–` become `-`, and `é` becomes `e`.
- [x] `node site/check.mjs` fails on any byte above 127 in those files, naming the file, the line and the code point (group 14). `nonAscii` in `site/guides.mjs` has its own tests.
- [x] `llms.txt` line 3 reads in plain ASCII.
- [x] `llms.txt` line 5 stays byte for byte: Rafa kept "No humans needed." (see Handoff).
- [x] `llms.txt` line 7 drops its whole parenthetical: "Crow is an open protocol for deals between agents: ...". "Configure" says the pinned domain's name, "Holdback", is the protocol's working name. No guide mentions the logomark.
- [x] `llms.txt` drops "(ADR-0031)".
- [x] The Reference list in `llms.txt` is Markdown links, and the check reads that form.
- [x] Every cross-reference resolves; `site/check.mjs` group 11 already checks this.
- [x] `buy.txt` names the faucet's 429 in step 5 and says that no seller Crow runs sells by quote (step 2). `buy.mjs` is unchanged. Line 5 reads "the agent of a company that buys work".
- [x] A fresh read of the three guides; small fixes made, the rest listed in Handoff.
- [x] Site build and check pass, both first-deal paths are within budget, the home page is within its byte budget, and the pinned JSON blocks are byte-identical.

## Evidence

Measured at 10:30 UTC on 2026-11-13 on this branch (head 290ce4fd), against origin/main 13dcac77, unless marked otherwise.

- `node site/build.mjs && node site/check.mjs`: PASS. After the build, `git status --short` showed only the edited guides and `site/check.mjs` before they were committed; the build changed no other file.
- The ASCII check fails as it should. An en dash planted in `site/ref/limits.txt` line 48 printed `FAIL site/ref/limits.txt line 48 holds U+2013: ...`, once; the file was then restored. The second line in group 14 checks the published copies, with the operators and the commands filled in, and reports only a byte the source does not already hold.
- `LC_ALL=C grep -c '[^ -~<tab>]'` over `llms.txt`, `buy.txt`, `sell.txt` and `ref/*.txt` counted 0 lines in every file.
- Sizes, before (origin/main) and after (this branch). Tokens are bytes divided by four, the repository's stated estimate, because no `HOLDBACK_AGENT_ANTHROPIC_API_KEY` was set:

  | Measure | Before | After |
  | --- | --- | --- |
  | Buyer's first-deal path (`llms.txt` + `buy.txt`, published) | 19,231 bytes, 4,808 tokens (measured by the first session at 10:13 UTC) | 19,963 bytes, 4,991 tokens |
  | Seller's first-deal path (`llms.txt` + `sell.txt`, published) | 16,546 bytes, 4,137 tokens (same) | 16,866 bytes, 4,217 tokens |
  | `site/llms.txt` source | 5,941 bytes, about 1,486 tokens | 6,204 bytes, about 1,551 tokens |
  | The Reference section of `llms.txt` | 1,028 bytes, 257 tokens | 1,390 bytes, 348 tokens |
  | `site/buy.txt` source | 12,612 bytes | 13,081 bytes |
  | `site/sell.txt` source | 10,233 bytes | 10,290 bytes |
  | `site/index.html` (budget 8,000 bytes) | 6,676 bytes | 6,664 bytes |

  The budget is 5,000 tokens per path. The buyer's path has 9 tokens left.
- `site/index.html` differs from origin/main in four lines, all in `<head>`, all written by the build from `llms.txt` line 3: `<title>`, `og:site_name`, `og:title` and `twitter:title` read "Crow" for "’crow". The body, the hero's text included, is unchanged.
- The pinned domain and deployment blocks in `llms.txt` are byte-identical to origin/main (`diff` of the two `{"name"` and `{"tokenDomain"` lines). The four blocks `site/walkthrough.mjs` parses (`## EIP-712 types`, `Pin this EIP-712 domain`, `Pin this deployment too`, `USDC's ERC-3009 types`) parse to the same JSON on both, by the walkthrough's own parser run on each copy.
- The walkthrough was not run: it needs `OP1` and `OP2` and sends signed POSTs to the live operators, and this task makes no live calls. The blocks it reads did not change [inferred from the comparison above].
- `vitest run tests/site-guides.test.ts tests/audit-report-template.test.ts`: 2 files, 51 tests passed.
- `pnpm typecheck`: exit 0. `pnpm lint`: exit 0.

## Handoff

**Line 5 is not changed.** At 10:07 UTC on 2026-11-13, after the brief was written, Rafa said of "No humans needed.": "Yes, it's the objective, keep." The paragraph is also the home page's lede: `page()` in `site/build.mjs` takes the headline from its first sentence and the lede from the rest. "Buy from any agent. Sell to any agent." would therefore put "Sell to any agent." into the lede. The home page's animated headline (`HEADLINES` in `site/build.mjs`) already leads with "Sell to any agent.". To reorder the pitch, T-400 or Rafa should first make `page()` stop reading that paragraph.

**Line 3** reads `> Crow. Verifiable settlement for AI commerce`. Its period stays because `page()` splits the tagline at the first ". " into the title and the subtitle. A colon form would break the title. So `index.html` now has `<title>Crow</title>`, and the og and twitter titles read "Crow · Verifiable settlement for AI commerce". Those lines are the only change to `index.html`, and the build wrote them.

**Line 7 and "Configure".** Rafa (relayed 2026-11-13): the intro sentence does not need its parenthetical, but the EIP-712 note belongs somewhere. Line 7 now reads "Crow is an open protocol for deals between agents: ..." with the rest unchanged. The domain's paragraph in "Configure" adds: `Its name, "Holdback", is the protocol's working name.`

**The multiplication sign** in `ref/http-buyer.txt`'s fee formula is `x`, as the brief says, not `*`: `max(min, ceil(price x bps / 10000))`. The stopped session had tried `*`, which reads as code; the brief chose `x`.

**ADR-0031 was dropped, not linked.** The sentence stands on its own: "the contracts on Sepolia take no party appeal and hold no bonds". An agent needs nothing from the ADR to act. A link would cost bytes on the buyer's path, which has 9 tokens left, and would invite a fetch.

**Absolute links.** The build publishes the guides' https://crow.direct addresses as written: `site/build.mjs` rewrites none of them, and `site/check.mjs` group 11 checks each against the published files. The Reference list follows the same pattern.

**Merge owed.** PR 492 (T-400) was open, not merged, when this branch was pushed. Once it merges: merge `origin/main` into this branch, keep both blocks in `site/check.mjs`, run `node site/build.mjs` so `site/index.html` is regenerated from the merged sources, and run the checks again.

**Cross-references.** `site/check.mjs` group 11 already checks three things: every `ref/<name>.txt` a guide names exists; every `` `ref/x.txt`, "Heading" `` and every front door's "Heading" is a real heading or bold lead; every crow.direct link resolves to a published file. The two citations added here (`ref/http.txt`, "Discover and get test tUSDC", and the front door's "Try it") pass it. No new check was needed.

**Found in the fresh read and not fixed here** (file and line on this branch):

1. `site/build.mjs` line 217, not mine: the home page's "Private Delivery" says "Only the buyer and the reviewer can open it". Every guide says "adjudicator".
2. `site/llms.txt` line 21: "It needs Node 20 or later" for `try.mjs`, while `buy.txt` line 16 and `sell.txt` line 9 need Node 22.18 or later. This may be right, because these are different tools, but an agent that reads both may install the wrong one. Check what `try.mjs` needs.
3. The person behind the agent has three names. `buy.txt` line 5 now says "company"; `buy.txt` says "your owner" 17 more times (lines 9, 16, 22 to 45, 75 to 79); `site/llms.txt` line 21 says "Ask your user to approve". "Company" does not fit "Ask your company to approve this one command", so the rest was not changed. One word for the person, chosen once, would settle it.
4. `site/llms.txt` line 9: "a deal takes about a minute". T-399 measured 24 s from funding to Released, and 3 min 39 s from the first fetch to Released. Line 29 says the try command takes "one to two minutes". The two lines agree, but "a deal" is ambiguous.
5. `site/sell.txt` line 31: `HOLDBACK_KEY=0x<your key> ... node examples/seller-adapter.ts` puts the secret key on the command line, where the shell history keeps it. A safer form reads it from a file or a prompt. That needs a change to `seller-adapter.ts`.
6. `site/buy.txt` line 41: "the appeal adjudicator, which decides escalations". `llms.txt` says that the Sepolia contracts take no party appeal. A reader may think "appeal adjudicator" contradicts that. One clause would settle it, but the buyer's path has 9 tokens left.
7. `site/sell.txt` lines 12 and 30 quote counts that you see when the step works ("11 numbered steps", "8 of 8 cases"). They are expected output, not standing numbers, but they go stale when a case is added. `tests/` or the walkthrough could check them.
8. T-399 Finding 2: on a faucet 429, `buy.mjs approve` prints a stack trace and does not show the `Retry-After` seconds. `buy.txt` now names the error, but the tool could print the wait. That needs `examples/buy-with-signer.ts`.
9. `site/sell.txt` line 21: "Worked: seven lines" then quotes four of them. An agent cannot tell which seven to expect.
10. `site/buy.txt` line 75: running the agreed checks yourself needs "a clone of the repository after `pnpm install && pnpm build`", which step 1 never set up; the page's tools are one file. It is optional, but it reads as a step.
11. The buyer's first-deal path has 9 of 5,000 tokens left (estimate). Any further line on `buy.txt` or `llms.txt` needs a cut elsewhere.
