# T-385: the docs pass for phase one (package AL-2)

- **Lane:** docs and the agent docs, branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-380 (package R8, merged at lane tip `73bbafa`), T-374 (AL-1), T-376 (R4b), T-378 (R6c-2), T-379 (R6c-3); T-384's first pull request for the interface file and the renamed tests
- **Paths this task may touch:** `docs/` except `docs/tasks/` (other than this file) and `docs/cutover-phase-one.md` (T-383's); `site/llms.txt`, `site/sell.txt`, `site/index.html` and, as its only source, the vignettes in `site/build.mjs`; `README.md`; `SECURITY.md`; `contracts/README.md`; `formal/README.md`'s wording; the entries of `tests/cut-feature-alignment.known.json` that these files leave. Step 1, the merge of main, also needed two test files (`apps/demo-cloud/src/notice.test.ts`, `tests/cut-feature-alignment.test.ts`): holdback PR 432 says why
- **Human gate:** no for the branch. Tier-3 lines (`CLAUDE.md` and the rest) go to the coordinator for Rafa. No deploy
- **Status:** done on the merge of holdback PR 437 (step 1: PR 432; step 2: PRs 435, 436 and 437)
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

All measured on 2026-11-12 unless a line says otherwise.

- **Step 1, holdback PR 432:** main at `e29d387` merged into the lane, then the lane's tip `22e5793` merged in. It merged as `690edfd` after all 12 CI checks passed.
  - Locally `pnpm test` passed 3,588 and skipped 197; typecheck, lint and the site check pass.
  - `pnpm snap` passed 48 of 48 after the five ADR-0036 fixtures were re-seated (`b19170a`): only hashes and panel seats moved.
- **The agent docs, holdback PR 435, merged as `32e94c2`:** `site/llms.txt`, `site/sell.txt` and the vignettes of `site/build.mjs`.
  - `node site/build.mjs && node site/check.mjs` passes.
  - The cutover's copies command (`scripts/record-copies.mjs`), run on a copy of the branch with a made-up new record, finds no line in my paths that names an old deployment value. The two `HoldbackBonds` lines it failed on are gone.
- **The audit docs, holdback PR 436, merged as `<436_MERGE>`:** the seven files of `docs/audit/`. It also places the R11 review's point that the H-2 limit holds in phase one for key-bearing calls (T-388), and T-384's interface file and test names.
- **The rest, holdback PR 437:** `docs/`, `README.md`, `SECURITY.md`, `contracts/README.md`, `formal/README.md`'s wording, ADR-0018, ADR-0031 and decision D67 (checked against PR 433).
- **Tests:** `vitest run tests` passes 447 of 447 on each branch, and `pnpm lint` passes.
- **The alignment known list:** 61 files at the lane's tip `73bbafa`, 23 of them in my paths. After the three pull requests it holds 39, and one of them is in my paths: `site/try.mjs` (Handoff). [Computed from each branch's measured count: 61 − 3 − 7 − 12.]

## Handoff

**Left on the known list in my paths: `site/try.mjs` only.** It is the bundle of `examples/try.ts`, `agent.ts` and `verify.ts`, built by `node site/build.mjs`. It names `permit2Collector` and `HoldbackBonds` through `examples/deployments.ts`, which the cutover's copies command replaces with the new record (CU-1), and the appeal intent through `examples/verify.ts`. It leaves the list when those two do. Every other entry the list keeps is outside my paths.

**The freeze must refresh:**
- The deployment's addresses: cutover step 3, `node scripts/record-copies.mjs`, rewrites `site/llms.txt`'s pins and `examples/deployments.ts`.
- `docs/audit/scope.md`: `<FREEZE_COMMIT>`, `<RUNTIME_BYTES>`, each constructor value with its address and code hash, and `<filled at the redeploy>` for the two deployed contracts.
- `docs/decisions/ADR-0018`: `<R10B_VERIFIER_GAS>`, from R10b's report.
- `formal/README.md`: its `HoldbackRules.sol` line citations, pinned at `74fa299`, need one pass. They sit in `formal/`, outside this task.
- The site's `try.mjs` SHA-256: `node site/build.mjs` after the copies command, so the one command in `llms.txt` carries the new hash.
- No other line citation into `contracts/src` is left in my paths. Dated records keep theirs: `known-issues.md` section 8 at `1430f77`, and `test-quality.md` at `5a90dc5`.

**The first site deploy after the lane reaches main must carry:**
- `site/try.mjs` and `site/index.html` rebuilt (`node site/build.mjs`), because `examples/verify.ts` and `examples/agent.ts` changed, and with them the SHA-256 and the page's one command.
- `site/llms.txt` with the new deployment's pins: the two money addresses, paying from your own wallet, the phase-one rules and the beacon floors.
- It must not deploy before the redeploy. The page describes the phase-one contracts, and until then the pinned addresses are the 0.7 deployment's.

**Tier-3 lines for Rafa** (not in any of my pull requests):
- `CLAUDE.md:54`, "Design principle: rails, not a record-keeper": "Arbitration can be private too: adjudicators may judge with private inference" should read "Judging can be private too: adjudicators may judge with private inference" (Rafa, 2026-11-12: no "arbitration" for what Crow does).
- The liveness run time in `CLAUDE.md` already reads "tens of minutes" on the lane (T-376). `CLAUDE.md` has no "D1 to D56" left.

**Not verified:**
- "The hunt's findings 2 and 4" (the plan's SC-5 row) could not be identified, so no rows were added.
- Known issue A-4: whether a restart while waiting for the fallback's round re-runs the panel.
- Some rows of the invariants table that map a model property to its test.
- The 43 s mainnet fallback floor comes from ADR-0032 alone. The operators' notice uses 44 s on both chains, and the docs say so.
- `api.md`, `README.md`, `demo.md` and `site/llms.txt` say the public demo runs the phase-one contracts. That is true from the cutover on.

**Found outside my paths, sent to the coordinator:**
- `apps/operator/src/sim-bin.ts` still prints "each bonded 25,000 tUSD" and the appeal economics under phase one.
- Discovery does not name the world's profile.
- `docs/cutover-phase-one.md` still runs `predeploy-fork.test.ts`.
- `fixtures/clubs/data-services-v1.yaml` keeps `payoutsTo: any`.
- `contracts/scripts/mutants.json` has two mutants with ID M139.
- The deploy script's constructor arguments: CU-1's.

**Crow Control (step 3):** only `control/page.src.html` names the old deployment. Lines 186-201 give the rules contract, the escrow, the bond vault (the row to delete) and the token. It is a page template, not a data file, so it is listed for the coordinator and not changed. No file in `control/` names the world's start block.

**How to resume:** each pull request's body names its files and checks. The sentence list that drove the pass is in `reports/scratch/t385-list*.md` on the maintainer's machine (not tracked).
