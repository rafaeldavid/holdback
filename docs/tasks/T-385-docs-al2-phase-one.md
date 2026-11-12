# T-385: the docs pass for phase one (package AL-2)

- **Lane:** docs and the agent docs, branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-380 (package R8, merged at lane tip `73bbafa`), T-374 (AL-1), T-376 (R4b), T-378 (R6c-2), T-379 (R6c-3); T-384's first pull request for the interface file and the renamed tests
- **Paths this task may touch:** `docs/` except `docs/tasks/` (other than this file) and `docs/cutover-phase-one.md` (T-383's); `site/llms.txt`, `site/sell.txt`, `site/index.html` and, as its only source, the vignettes in `site/build.mjs`; `README.md`; `SECURITY.md`; `contracts/README.md`; `formal/README.md`'s wording; the entries of `tests/cut-feature-alignment.known.json` that these files leave. Step 1, the merge of main, also needed two test files (`apps/demo-cloud/src/notice.test.ts`, `tests/cut-feature-alignment.test.ts`): holdback PR 432 says why
- **Human gate:** no for the branch. Tier-3 lines (`CLAUDE.md` and the rest) go to the coordinator for Rafa. No deploy
- **Status:** in progress (step 1 merged: holdback PR 432, `690edfd`; step 2 under way)
- **Agent/session:** change kinds 1 and 2 (copy, agent docs and process docs), no review

## Intent

In my own words: the contracts on the lane are phase one, and most of the words around them still describe the full protocol. A design partner will audit the deployed contracts and read these docs, so every sentence in my paths must be true of the lane's code:

- no party appeal and no bond on chain, and the first decision by the primary or the fallback adjudicator is final;
- one token per deployment, ERC-3009 funding only, and a settlement that pays the buyer and the seller only;
- an unfunded offer that expires by the operators' clock, with no transaction;
- the two money addresses, schema 0.11 and domain "0.8";
- the 29 s beacon margin, with its 37 s floor for an escalation window and 43 s (mainnet) or 44 s (Sepolia) for the fallback's;
- the late-work settlement.

SimChain keeps the full protocol. So every doc that describes a world says which one: the chain's phase one, which `pnpm sim` and the local public world also run, or SimChain's full protocol, which `pnpm demo`, `pnpm snap` and the SimChain-only fixtures run.

The work lands in a few pull requests into `contracts-audit-ready`, by reader: first the merge of main; then the agent docs (`site/`); then the audit docs (`docs/audit/`); then the rest. Each file I fix leaves the alignment test's known list. Fee figures are described by where they come from (the operator's configuration, read through discovery's `fees.operator`), never as a number that the pilots' fee change would make false. Contract code is cited by function, error or event name; line citations that cannot be avoided are listed for the freeze.

Non-goals: no code change beyond what step 1's merge needed; no change to `docs/cutover-phase-one.md`, `formal/` other than its README's wording, or any tier-3 file; no deploy, including the site's.

## Acceptance

- No sentence in my paths presents a party appeal, a bond, the vault, Permit2 or a second token as live on chain.
- Every doc that describes a world says whether it is the chain's phase one or SimChain's full protocol.
- `node site/build.mjs && node site/check.mjs` passes; the tests that parse `docs/` pass.
- The alignment known list holds none of my files, or each one left is explained.
- Evidence and Handoff are filled, with what the freeze must refresh and what the first site deploy after the lane reaches main must carry.

## Evidence

(Filled as each pull request lands.)

- Step 1: holdback PR 432, main at `e29d387` merged into the lane, then the lane's tip `22e5793` merged in; merged as `690edfd` after all 12 CI checks passed. Locally `pnpm test` passed 3,588 and skipped 197; typecheck, lint and the site check pass; `pnpm snap` passed 48 of 48 after the five ADR-0036 fixtures were re-seated (`b19170a`) [measured, 2026-11-12].
- The agent docs: the cutover's copies command (`scripts/record-copies.mjs`), run on a copy of this branch with a made-up new record, finds no line in my paths that names an old deployment value [measured]; the two `HoldbackBonds` lines it failed on are gone.
- Alignment known list: 61 files at the lane's tip `73bbafa`, 23 of them in my paths [measured].

## Handoff

(Filled at the end.)
