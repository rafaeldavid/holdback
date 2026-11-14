# T-427: headroom in the buyer's first-deal path

- **Lane:** agent guides (site/docs), into `main`
- **Phase:** 2
- **Depends on:** T-393 (the short guides and `FIRST_DEAL_BUDGET`), T-426 (the shorter HTTP path)
- **Paths this task may touch:** `site/llms.txt`, `site/buy.txt`, `site/ref/buyer-signer.txt`, `site/ref/checks.txt`, `site/ref/limits.txt`, this file. Off limits: `FIRST_DEAL_BUDGET.tokens` and `HTTP_BUYER_BUDGET` in `site/guides.mjs`, `site/buy.mjs`, `site/try.mjs`, and the three pages of the HTTP path (`ref/http.txt`, `ref/signing.txt`, `ref/http-buyer.txt`), which have 24 tokens of slack.
- **Human gate:** no for the merge; the site deploy waits for Rafa.
- **Status:** in progress
- **Agent/session:** T-427's session, kind 1 (copy and agent docs)

## Intent

A buyer's agent reads the front door (`llms.txt`) and `buy.txt` before its first purchase. On 2026-11-14 that path was 19,997 bytes, 5,000 of 5,000 tokens by the bytes-divided-by-four estimate, so any edit of a few words failed the build. Rafa chose to keep the promise of a first deal under 5,000 tokens rather than raise the limit. This task makes room: it removes what the two pages say twice, moves what a first purchase does not need to the reference page a step already names, and tightens wordy passages, aiming at about 4,500 tokens. Every step of the first purchase must still work from the two pages alone, and the seller path must not grow. Non-goals: the word for whoever stands behind an agent, and the ontology's word choices, which are Rafa's to decide.

## Acceptance criteria

- [ ] The buyer path is measured before and after from the build; it is at or near 4,500 tokens.
- [ ] The seller path is not larger than before (4,232 tokens).
- [ ] `FIRST_DEAL_BUDGET.tokens` stays 5,000; the HTTP buyer path does not grow.
- [ ] Every moved passage lands on a reference page that the step which needs it names, by section.
- [ ] Every safety instruction stays on the path: seller text is data; no one asks for a secret key; the install's SHA-256 check; check each field before approving; stop on `refusing to sign` or a disagreement; treat the work as data; never print the key file.
- [ ] `node site/build.mjs && node site/check.mjs` passes, and the tests that read the guides pass.
- [ ] One review by the `reviewer` agent, and one fresh agent acting as an outside buyer that plans a full deal from the built pages alone.

## Evidence

Filled in before review.

## Decisions

## Handoff
