# T-220: Ship round 1's prerequisites to the live demo

- **Lane:** demo, infra
- **Phase:** 2
- **Depends on:** T-217, T-218, T-219 and T-221, merged first (this task edits `apps/demo-cloud/src/world.ts` and `worker.ts` after them). The record of the 0.7 redeploy is on main (PR 169).
- **Paths this task may touch:** `apps/demo-cloud/src/world.ts` (the chain world's rulebook names `drand-quicknet`; the demo adjudicators get T-217's drand source; the drand notice); its tests (`world.test.ts`, the new `one-world.anvil.test.ts` and `predeploy-fork.test.ts`) and the anvil harness they share (`apps/demo-cloud/test/anvil.ts`); `site/llms.txt` (the honest limits) and the site's build outputs; `docs/operations.md` (live versions, rollback targets); `README.md` (Status, only where it states these limits); `docs/api.md` (the two schema 0.9 lines, which T-221's Handoff gives to this deploy); `docs/neutrality.md` (the beacon row, which T-217's Handoff gives to this docs pass); `docs/backlog.md`; `docs/plan.md` (this row); this file
- **Human gate:** yes. The Worker and site deploys waited for Rafa's go-ahead, which he gave on 2026-11-05; the PR itself is in-repo.
- **Status:** done (merged in PR 204; deployed 2026-11-05, 11:04 UTC)
- **Agent/session:** Claude Code session on branch `t-220-ship-round-1`, worktree `.worktrees/t-220-prep` (2026-11-05); the deploy session from PR 204's merge commit, worktree `.worktrees/t220-deploy` (2026-11-05)

## Intent

The fixed contracts (PRs 160 and 161) are on Sepolia, and the public demo has run on them since 2026-11-04, about 08:30 UTC. The T-206 session redeployed them and cut the demo over, with Rafa's go-ahead ("Yes, redeploy now"). Its world is `holdback-public-demo-sepolia-2026-11-04`. Measured the same day: `/v1/status` serves schema 0.9 and EIP-712 domain "Holdback" 0.7, with `verifyingContract` `0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa`.

T-217, T-218, T-219 and T-221 (adjudicator registration through the API) change the Workers' code, so they reach the live demo only with a deploy. T-217 also changes the demo club's rulebook. The world keeps its name: each stored deal carries the rulebook it was offered under (`Book.club`), and only a new offer is checked against the current rulebook (measured, `docs/research/2026-11-04-one-world.md`). So the rulebook changes in place, and the demo adjudicators keep their keys and bonds (Rafa, 2026-11-04: "Yes, keep the world"; D49).

Restated: one deploy brings all four live before round 1 (T-216). It keeps the Sepolia world and changes its rulebook in place to name drand, and the agent docs say what changed. No contract changes. Rafa chose one deploy over a deploy per task on 2026-11-04 (T-216, scope question 5).

**In the implementer's words (2026-11-05).** Everything for the one deploy is ready in the repository, and only the deploy is left for Rafa:
1. **The code.** The Sepolia world's demo club names `drand-quicknet` with quicknet's chain hash, and its three adjudicators read rounds through T-217's source. Opening today's storage under this build changes the club in place. Deals already offered keep the club they were offered under; new offers bind the new hash. The "drand not yet" note goes, and the notes say the view is kept across deploys.
2. **The proof.** A fork run on Sepolia rehearses the rulebook switch: a world opened with the deployed build's rulebook (this build's code), then this build's rulebook on the same storage, then one deal of each kind the four tasks bring. It does not rehearse the upgrade from the deployed build's code (`dd0a55a`); `docs/operations.md` says what that first sync pass does to the live storage.
3. **The words.** `llms.txt` carries the four Handoffs' texts and keeps the limits that remain; `docs/operations.md` has the deploy steps and the rollback.

Non-goals: the deploy itself (Rafa's gate); a new world name or new bonds (D49); contract changes; the advisory `judgeBy` on a quicknet round boundary (an operator change, backlog); the world key seed (D49, a later task); CI's must-not-skip list (a `.github/` change, Rafa's).

## Context

- `docs/operations.md`: "Settlement: SimChain or Sepolia", the deploy order, rollback.
- T-213 (the first cutover: its order and measurements, and the one deploy refused at start-up).
- T-212 Handoff: the redeploy runbook the T-206 session followed, and its entry "Redeployed and cut over, 2026-11-04", with the gas measured on the 0.7 contracts.
- `docs/update-flow.md` (the manual flows from `workers` and `agentdocs`).

## Acceptance criteria

- [x] Rafa's go-ahead, quoted with its date: "When ready, deploy", then "You need to ship this so you stop iterating" (Rafa, 2026-11-05). His choice on residual 13 is D50 (2026-11-05): deploy now, fix in T-227 before mainnet.
- [x] **A fork run before the deploy** (measured, 2026-11-05; Evidence; rerun on PR 204's final head `4a7b954`: 1 test passed in 284 s). On a Sepolia fork, the world built from this commit:
  - finds its three adjudicators bonded and sends nothing;
  - applies the rulebook change to a world opened before it: the old deal keeps its `rulebookHash` and moves on, and an offer bound to the old hash gets 422 `rulebook_unknown`;
  - runs `examples/try.ts` to Released;
  - decides, through the fallback with a drand proof, a deal whose primary stays silent;
  - shows a direct `deliver` in the view: the contract's stage with a "Behind the chain" notice within a pass, then, once the seller posts the signed delivery, the event labelled `direct` with no second transaction (T-218's design; Decision 8);
  - registers an outside adjudicator through the API and settles a deal in which it is the primary;
  - applies, when it reopens, a transaction it broadcast before being stopped.
- [x] **The rulebook, in place.** The world name stays `holdback-public-demo-sepolia-2026-11-04`.
  - [x] In code: its rulebook names `drand-quicknet` with quicknet's chain hash, and `GET /v1/clubs/demo-club` serves the new `rulebookHash`, `0x3fecb058…d108` on the fork. Each demo adjudicator reads rounds through T-217's drand source, and the "drand not yet" notice is gone (`world.ts`).
  - [x] Live: the same reads after the deploy; deals opened before it keep their old `rulebookHash` and state (list them before, read them after). Measured on both nodes at 11:05:19 UTC: `rulebookHash` `0x3fecb058…d108` with `drand-quicknet`; the 9 earlier deals keep `0xd25b8f97…0c25`.
- [x] **No deal left behind.** Open deals continue in the same world. The one effect is on an offer prepared before the deploy and posted after it: 422 `rulebook_unknown`, whose text says to read the club again. Check that every deal open at the deploy reads the same state afterwards. Measured: no deal was open at the deploy; all 9 deals the world held read the same `escrowState` and `appealState` on both nodes before and after.
- [x] **The gas quote stays as it is.** The redeploy measured 1,636,242 gas for a three-transaction deal on the 0.7 contracts, about 4.9 % above the 0.6 figure (T-212 Handoff). The quote was deliberately left at 4.70 tUSDC (`OPERATOR_FEE_GAS` 4700000, a 4.71 tUSDC minimum), for T-215 to replace with live gas and prices. This deploy does not change it unless T-215 has landed. Measured: holdback-op1's bindings show `OPERATOR_FEE_GAS` "4700000", and the smoke deal paid an operator fee of 4.71 tUSDC.
- [x] **Deploy both Workers together, then the site,** as the 0.7 cutover did (`pnpm demo-cloud:deploy`; `docs/operations.md`). Measured: both Workers between 11:03:40 and 11:04:11 UTC, the smoke deal Released at 11:09 UTC, the site at 11:10 UTC; the setup pass sent no transaction and all three adjudicators read `bonded`.
  - The world names live in the shared `worker.ts`, and the Durable Object always runs holdback-op1's code (op2's `WORLD` binding is op1's `World` class).
  - The code being replaced has no in-flight row, so deploy while no deal is mid-step.
  - Then run the smoke test (Released, three Etherscan links), then deploy the site.
  - The setup pass finds the bonds in place and sends nothing: `bonded` stays 3, and the funding lane's balance is unchanged (read it before and after).
- [x] **Live checks.**
  - [x] The homepage command runs end to end against both nodes. Measured: Released in 60 s with Crow's test seller, three Etherscan links (Evidence, "The deploy").
  - [x] `llms.txt` states what changed: fallback and appeal adjudicators decide with drand proofs, direct calls show in the view, and an agent can register its own adjudicator. It also keeps the honest limits that remain. The text comes from T-217's, T-218's, T-219's and T-221's Handoffs.
  - [x] Its "State may reset" line becomes: "The operators' view is kept across deploys. It starts over only when the settlement contracts are redeployed; what happened on Sepolia stays there. Keep your own copy of the terms you signed."
  - [x] `node site/build.mjs && node site/check.mjs` pass (measured on this branch).
- [x] **Rollback, written down** in `docs/operations.md`: holdback-op1 `50fd05c4`, holdback-op2 `1a95b960`, crow-site `5582b10e`. The world is the same under the old code. Deals offered under the drand rulebook keep their book, their fallback and appeal panels fall back to the default outcome under the old adjudicator code, and money is unaffected (inferred, `docs/research/2026-11-04-one-world.md`).
- [x] **Docs:** `docs/operations.md` (the deploy steps, the rollback and, since the deploy, the live versions), and `README.md` where it states these limits (the "until T-220's deploy" clauses are gone since the deploy's record PR).
- [x] **Review.** The `reviewer` role with project context reviewed PR 204 (four findings, all fixed; Evidence); CI passed all 12 checks on its final head `4a7b954` (measured).

## Out of scope

- Contract changes. T-212's open items (1, 2, 4, 5, 6 and 8) block mainnet, not Sepolia; each is a later redeploy.
- Mainnet.
- Withdrawing the demo adjudicators' bonds from the earlier vaults, a chore once the old deals close.
- A new world name. D49 allows one only for a new rules contract or another chain.

## Evidence

### The deploy (2026-11-05)

**Deployed and checked; no rollback.** Rafa gave the go-ahead on 2026-11-05: "When ready, deploy", then "You need to ship this so you stop iterating." He decided residual 13 the same day (D50): deploy now, with the honest limit in `llms.txt`, and fix it in T-227 before mainnet. A deploy session shipped PR 204's merge commit `69021a6` by the runbook in `docs/operations.md`. It saved each answer under `reports/t220/` in its worktree (git-ignored). Every line below is measured unless it says otherwise.

| Worker | New version | Rollback target |
| --- | --- | --- |
| holdback-op1 | `1d8a029c-44eb-4276-b5c0-c2c8894b25d5` | `50fd05c4` |
| holdback-op2 | `a042aae3-821a-4efd-856a-42070205c45e` | `1a95b960` |
| crow-site | `704bd295-21ed-4dc1-ab54-b181496448b8` | `5582b10e` |

**Before** (10:45 to 11:03 UTC):
1. PR 204's final head `4a7b954` contains origin/main `eeeb5f0`. CI passed all 12 checks on it. The fork run on it passed: 1 test in 284 s, forked at Sepolia block 12,068,986, world errors none. The merge commit `69021a6` has the same tree (`git diff --stat` empty), so the run stands for it. The first attempt stopped at import because the fresh worktree had no `dist/`; it passed after `pnpm build`.
2. Both nodes: `schemaVersion` 0.9, domain Holdback 0.7, `verifyingContract` `0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa`.
3. Both nodes: `rulebookHash` `0xd25b8f97…0c25`, `randomness` `{"source": "sim"}`.
4. The world held 9 deals, all final (7 Released, 2 Refunded, appeal `expired`), each bound to `0xd25b8f97…0c25`. Deal `0xf0453986…5e5b` read `Released`, appeal `expired`, with no `delivery.submitted` event.
5. At Sepolia block 12,068,976: the funding lane held 1.8118 Sepolia ETH (1811805135999733762 wei) at nonce 29; the three deal lanes were at nonces 29, 16 and 3, the three adjudicators at nonce 2. The old build reported the adjudicators' bonds as 0 and no `observed` field.
6. `head.eventSeq` stayed 94 on both nodes from 11:00:11 to 11:00:43 UTC, and read 94 again at 11:03:40 UTC.

**Deploy** (11:03:40 to 11:13 UTC):
1. `pnpm demo-cloud:deploy` deployed both Workers on the first try by 11:04:11 UTC; startup took 416 ms (op1) and 434 ms (op2). The new code served requests at once, but the Durable Object answered schema 0.9 until 11:04:55 UTC, about 44 s after the deploy (the window is measured; the restart as its cause is inferred).
2. Both nodes at 11:05:19 UTC: `schemaVersion` 0.10, the same domain and `verifyingContract`.
3. Both nodes: `rulebookHash` `0x3fecb058383da073d562995df281fbd28dc895c3f7c93e7114266f607218d108`, `randomness` `drand-quicknet` with chain hash `0x52db…e971`.
4. Both nodes list the three demo adjudicators, each with a `registration` and `observed.bond` `bonded`: `0x71f8…7c9e` primary, `0x594a…68a2` fallback, `0xdee0…f286` appeal.
5. `wrangler tail holdback-op1` from 11:04:21 to 11:13:06 UTC: 247 events from the new version, all `ok`, 16 of them alarms, 0 exceptions, 0 responses of 500 or more. Only deal `0xf0453986…5e5b` fell behind, as Deploy step 5 expected: it reads `Released` with the notice "Behind the chain: a delivery in transaction 0x64c5c757…caf1 found this node's book Released".
6. At Sepolia block 12,069,078 (11:07:54 UTC), the funding lane, the three deal lanes and the three adjudicators had the same balances, nonces and pending nonces as in Before step 5: the setup pass sent nothing.
7. All 9 earlier deals read the same `escrowState`, `appealState` and `rulebookHash` on both nodes at 11:12:10 UTC; only `0xf0453986…5e5b` carries a notice.
8. **The smoke deal.** The runbook's `node apps/demo-cloud/scripts/deal.ts https://api.escrow.stream https://api2.escrow.stream` refused before it sent anything: "refusing: https://api.escrow.stream is not on SimChain (chain id 31337)". `deal.ts` is SimChain-only, so the runbook's smoke step should name `examples/try.ts`; this record's change to `docs/operations.md` Deploy step 8 does. The deal ran as the 0.7 cutover's did: `HOLDBACK_OPERATORS=https://api.escrow.stream,https://api2.escrow.stream node examples/try.ts`. Commitment `0x8d10b25a…f84b` ended Released in 42 s, final at 11:10:12 UTC, bound to the new `rulebookHash`, operator fee 4.71 tUSDC. Each receipt has status 1:
   - funded [`0x451a22c0…8524`](https://sepolia.etherscan.io/tx/0x451a22c07d379d41e3e4990619b45dfdc919283fb0b578840b0dbc0a775b8524), 840,697 gas;
   - delivered [`0xfcb25893…c407`](https://sepolia.etherscan.io/tx/0xfcb258937e9f206b823766406f60b6172f7feeebbbe5719473a5d2f2de4ec407), 173,131 gas;
   - decided [`0x866ad888…a8d6`](https://sepolia.etherscan.io/tx/0x866ad8882861bd3a1eae25febee702ad372208011d14bfa59d5e31e2850ba8d6), 166,808 gas.
9. **The site.** `node site/build.mjs --op1 https://api.escrow.stream --op2 https://api2.escrow.stream --out <worktree>/reports/site-out` (the directory `apps/site/wrangler.jsonc` serves) and `node site/check.mjs` passed; `npx wrangler@4 deploy --config <worktree>/apps/site/wrangler.jsonc` uploaded 2 changed files, `llms.txt` and `try.mjs`. At 11:10:22 UTC `https://escrow.stream/try.mjs` had sha256 `cc310963bb0833e0d23f8018eb4ea802db09fa05fbd9489020340d2be2eed832`. The "Try it" command, run as its parts (the same pinned packages, the sha256 check, then `node try.mjs --seller https://escrow.stream/agents/test-seller`), ended Released in 60 s with Crow's test seller, final at 11:12:48 UTC (commitment `0xd55c6667…08be`):
   - funded [`0xe18bde01…40ae`](https://sepolia.etherscan.io/tx/0xe18bde0120b599ee37eae0d5b27bd45122cc4646e6525d3bbe3a31c326cf40ae);
   - delivered [`0x4ff4590e…1d75`](https://sepolia.etherscan.io/tx/0x4ff4590ec2755b70e224bd9f114e53a6603c789a8c5273e6fd97848152471d75);
   - decided [`0xec5061eb…5d5f`](https://sepolia.etherscan.io/tx/0xec5061eb63a40132f015ff759b02cf40a20c4451c425c67d88895f49d27c5d5f).

### Before the deploy

Branch `t-220-ship-round-1`, 2026-11-05. Each claim is labelled measured, inferred or guessed. Nothing was deployed and nothing was sent to Sepolia.

**The fork run** (`apps/demo-cloud/src/predeploy-fork.test.ts`; `SEPOLIA_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com`, anvil 1.0.0, Prague, forked at Sepolia block 12,068,638; 1 test passed in 284 s, run 3). [measured]
- Today's world first: opened with the deployed build's rulebook (`beacon: 'sim'`), it bonded its three adjudicators on the fork and was ready 30 s after the start. Its club's `rulebookHash` was `0xd25b8f97bf315dd3d4f8dfe36c472f9bc96ba7fbc742a2c3a3f04c1ecbf50c25`, the hash the live demo serves today (`GET https://api.escrow.stream/v1/clubs/demo-club`, read 2026-11-05).
- A deal was funded under it, and a second offer was signed against it and held back.
- **1. Setup sent nothing.** This build opened the same storage and was ready at once: 0 transactions in the blocks since the switch, the funding lane's balance and the three deal lanes' balances unchanged, `meta.bonded` still 3.
- **2. The rulebook in place.** The club now names `{"source": "drand-quicknet", "chainHash": "0x52db…e971"}` with `rulebookHash` `0x3fecb058383da073d562995df281fbd28dc895c3f7c93e7114266f607218d108`, the hash computed from the live rulebook with only `randomness` changed. The same three adjudicator addresses. The old deal kept `0xd25b…0c25`, was delivered and decided, ended Released, and the buyer opened its copy. The held-back offer got 422 `rulebook_unknown` ("no rulebook registered for 0xd25b…0c25").
- **6. A direct deliver** (`0x3cb9e1f0…be34`, sent by the seller to HoldbackRules): within a pass the state read showed `Delivered` with the "Behind the chain" notice naming that transaction. Once the seller posted the signed delivery, the `delivery.submitted` event carried `submittedVia: "direct"` and that transaction, the deal's one `deliver` was the seller's, and the primary decided: Released, copy opened.
- **3. `examples/try.ts`** ended Released with three chain lines (funded, delivered, decided).
- **4. An outside adjudicator** registered through `POST /v1/adjudicators` (200), bonded 100 tUSDC from its own key, accepted and decided as primary: Released, copy opened.
- **5. A silent primary:** a second outsider accepted and never decided. At `judgeBy` (09:45:24Z) the world triggered the fallback, and the demo fallback decided from drand quicknet round 33,689,520, the round at `judgeBy`; the deployed contract verified it (the `decide` took 329,547 gas). Released, copy opened. This step took 196 s, most of it the deal's own windows.
- **7. A restart mid-step:** with the passes stopped, the seller's delivery was relayed; the storage as it stood after the lane row and before the broadcast opened under a new instance. Its first pass landed the transaction (`lastRecovery`: applied 1, failed 0), the event carried `submittedVia: "demo-op-1"`, no lane row was left, and the deal ended Released.
- World errors: none.
- Gas on the fork, Prague pricing (Sepolia charges new state more, T-213): `deliver` 80,999 to 83,499; a primary `decide` 136,271 to 153,383; `triggerFallback` 52,420; the drand fallback `decide` 329,547; `expireAppeal` 54,797 to 59,585. Every rules-contract call succeeded.
- Runs 1 and 2 failed and changed the test, not the code. Run 1 passed items 1 to 5, then expected the direct deliver's event before the seller posted the delivery, which T-218 does not do (Decision 8). Run 2: publicnode answered "block not found: 0xb82718" for its own head and anvil exited while building its genesis, the flake T-217 saw twice; the test now forks 8 blocks behind the head and sets the next block's time to the wall clock (it was 100 s behind), and `docs/team.md` proposes the check.

**Offline and on anvil.** [measured]
- `apps/demo-cloud/src/world.test.ts`: 31 tests passed, 2 of them new (this line said 32; the review counted 31, and a rerun before the review's fix measured 31 passed). With the review's test (below), 32 pass. Today's Sepolia storage reopened under this build, with an RPC nobody answers (opening reads no chain): the rulebook names drand quicknet, its hash is new, the adjudicators, `meta` and registrations are unchanged, no `meta`, `ar:`, `ph:` or `b:` row is written, and the notes say what changed. A SimChain world and an anvil chain (31337) keep `sim`.
- `apps/demo-cloud/src/one-world.anvil.test.ts`: 1 test passes; with `world.test.ts` the run took 33 s, anvil's start included. A deal funded under the sim rulebook settles after the switch; the held-back offer gets 422; 0 transactions at setup; the fallback and appeal adjudicators hand the new deal the drand source and the old deal the sim beacon; no round was asked for.
- Both failed before the change to `world.ts` (the rulebook still named `sim`) and pass after it.
- `node site/build.mjs && node site/check.mjs`: PASS. `site/try.mjs` keeps sha256 `cc310963bb0833e0d23f8018eb4ea802db09fa05fbd9489020340d2be2eed832`; `site/index.html` is unchanged.

**`pnpm verify`** (`reports/verify-t-220-ship-round-1.md`, 2026-11-05T10:13Z, on `28aa61e` plus the review's fixes before they were committed: the tree of `24f10ca`, with only this file's text changed since): PASS on all nine steps, no snapshot diff against HEAD. `pnpm test`: 120 files passed and 2 skipped; 2,706 tests passed and 6 skipped (the opt-in fork tests), 159 s. `forge test`: 241 tests passed. [measured]

| Step | Status | Time |
| --- | --- | --- |
| typecheck | pass | 279 ms |
| lint | pass | 7,046 ms |
| forge build | pass | 2,040 ms |
| forge | pass | 31,941 ms |
| test | pass | 158,925 ms |
| spec | pass | 619 ms |
| snap | pass | 9,558 ms |
| snap:local | pass | 15,066 ms |
| demo | pass | 4,332 ms |

The first run (2026-11-05T09:49Z) was on `330d6c8` plus the uncommitted change to `world.ts`: PASS, 2,705 tests passed and 6 skipped. The review reran it on the committed `28aa61e`: PASS on all nine steps, 2,705 passed and 6 skipped, forge 241 passed, no snapshot diff [measured by the reviewer].

**Inferred, not run:** the rollback reading (the old code ignores the new rows; drand deals default on fallback and appeal under it); op1's startup CPU (T-217 Decision 15: the curve library loads on first use).

**The review of PR 204** (2026-11-05). Four findings, all four fixed in `d26f650`, `1b8e255`, `24f10ca` and this file:
1. **Medium: the honest limit understated residual 13.** `llms.txt` listed three of residual 13's cases and closed with "send direct calls to HoldbackRules itself", as if only a party that makes unusual direct calls were exposed. Fixed: the limit now says a party cannot rule it out on its own, because the operators relay through the public mempool and anyone who copies a signed step from it can cause it, even for a deal that uses only the API; it also says how the deal ends (the default refund, or the first decision standing). `docs/operations.md` Before step 7 makes Rafa's decision on residual 13 a gate on the deploy. Text only, so no test applies.
2. **Low: Decision 5's correction was false** [measured: `apps/operator/src/server.ts` `discovery` serves a top-level `defaultAdjudicators`; ADR-0030, `spec/openapi.json` and `docs/api.md` name it]. Test first: `world.test.ts` "the agent guide names the defaults where discovery serves them" failed against the old text (1 failed, 31 passed) and passes once `llms.txt` names `defaultAdjudicators` (32 passed) [measured]. Decision 5 now matches the code. `node site/build.mjs && node site/check.mjs`: PASS; `site/index.html` unchanged, `site/try.mjs` sha256 still `cc310963…d832` [measured].
3. **Low: the fork run rehearses the rulebook switch, not the upgrade from `dd0a55a`'s code.** Fixed in words: the fork test's header, Intent item 2 and Decision 7 say so. `docs/operations.md` Deploy step 5 (new) says what the first sync pass does to the live storage, which has no `cursor` row and no `chainTxs`: it reads from block 12,061,237, and deal `0xf0453986…5e5b` falls behind with a "Behind the chain" notice naming its lost `deliver` `0x64c5c757…caf1`, keeping `escrowState` `Released` [inferred from `EvmSettlement.follow` and `rebuild`: the book stands `Released`, so the rebuilt `deliver` fails and the deal falls behind]. The deal's live state read is `Released`, appeal `expired`, with no `delivery.submitted` among its 12 events [measured on api.escrow.stream, 2026-11-05]. Before step 4 keeps that read. No test measures this first pass (Handoff, follow-ups).
4. **Low: a test count did not reproduce.** `world.test.ts` had 31 tests, not 32 [measured: 31 passed before the review's test]. Corrected above, and the verify paragraph names the tree it ran on.

## Decisions

Made by the T-220 session on 2026-11-05; Rafa can overrule any of them.

1. **D49: one long-lived world;** this deploy changes the rulebook in place. `WORLD_NAMES` and `worker.ts` are unchanged.
2. **The rulebook names the randomness the deployment's beacon verifies,** through a `LiveSettlement.beacon` option. Its default comes from the chain: `drand-quicknet` on Sepolia, whose deploy script deploys DrandQuicknetBeacon, and `sim` on a local anvil chain (31337), whose harness deploys SimBeacon. So `worker.ts` needs no change, and the anvil tests of T-216, T-219 and T-221 (`live.test.ts`, `lanes.test.ts`, `registration.anvil.test.ts`, `examples/e2e-round.test.ts`) keep the sim beacon their contracts verify. A drand rulebook over SimBeacon would make every fallback and appeal there unprovable.
3. **One drand source for the three demo adjudicators,** on the world's clock, so a proven round is fetched once (`LiveSettlement.drand` stands in for tests). No relay log: a relay that fails shows in the service's refusals; logging and bounding outages are T-225.
4. **The notes say what changed.** The "drand not yet" line becomes a line that says fallback and appeal decide with drand proofs and what happens when no relay answers. The chain world's "may be reset" line becomes the one this task names for `llms.txt`.
5. **`llms.txt` takes the four Handoffs' texts,** with one addition and one correction against the code:
   - T-221's draft was right: discovery names the defaults by role in a top-level `defaultAdjudicators` (`apps/operator/src/server.ts`, `discovery`; ADR-0030; `spec/openapi.json`; `docs/api.md`). The text names that field, adds that the demo also lists them in `demo.adjudicators`, and that `GET /v1/adjudicators` marks each with `observed.defaultFor`. The first draft of this decision said discovery had no such field; the review of PR 204 found that false, and `world.test.ts` now holds `llms.txt` to the field discovery serves.
   - The HoldbackBonds address (`0x83f3…9ad1`, from `contracts/deployments/sepolia.json`) is in the prose of the appeal and registration steps, not in the pinned deployment JSON: `site/check.mjs` holds that block equal to `examples/deployments.ts`, which does not carry `bonds`. D48 default 5 asked for the pin with T-220; a pin in `examples/` is outside this task's paths (Handoff).
6. **Two honest limits added:** a step the operators cannot read (residual 13 in `docs/neutrality.md`), and T-221's line that an appeal adjudicator's decision is final. The first says a party cannot rule residual 13 out on its own: anyone who copies a signed step from the public mempool can cause it, even for a deal that uses only the API. Rafa's decision on residual 13 is step 7 of the Before list in `docs/operations.md`, a gate on the deploy.
7. **The fork run starts from the deployed build's rulebook,** by opening the world with `beacon: 'sim'` on a Sepolia fork, then reopening the same storage with this build's default. The live club's served hash, `0xd25b…0c25`, equals keccak256 of that sim rulebook (computed from the live `GET /v1/clubs/demo-club`), so the run starts where the live world's rulebook stands. Its storage is this build's, though: it already has a `cursor` row and books with `chainTxs`. The live storage, written by `dd0a55a`, has neither, so the first sync pass after the deploy reads from the deployment's `fromBlock` (Deploy step 5 in `docs/operations.md`).
8. **"Shows a direct deliver in the view" means what T-218 built:** within a pass the state read shows the contract's stage (`Delivered`) with a "Behind the chain" notice naming the seller's transaction; once the seller posts the signed delivery, the operator joins it with no second transaction and the `delivery.submitted` event carries `submittedVia: "direct"`. The contract keeps only the delivery's hash, so no event can carry the delivery before the post. The first fork run expected the event before the post and failed there; the test now checks T-218's behaviour.
9. **Paths beyond the list:** the tests of `world.ts` and the shared anvil harness (`apps/demo-cloud/test/anvil.ts`: `host`, which serves one world after another on fixed origins as a deploy does, and the estimate shim from T-217's fork test); `docs/api.md` (two schema lines, given to this deploy by T-221's Handoff); `docs/neutrality.md` (the beacon row, given to this docs pass by T-217's Handoff). The Paths line above lists them. One row in `docs/team.md`'s Rules and checks, as the team's process asks for a repeated failure mode: fork tests start a few blocks behind the RPC's head.
10. **The README and `docs/api.md` say "until T-220's deploy"** where the live demo and main differ, so they are true whether the PR merges before or after the deploy. The deploy session removes those clauses (Handoff).

## Handoff

**State:** done. [PR 204](https://github.com/rafaeldavid/holdback/pull/204) merged into main as `69021a6` on 2026-11-05, and a deploy session shipped that commit the same day at 11:04 UTC, on Rafa's go-ahead: holdback-op1 `1d8a029c`, holdback-op2 `a042aae3`, crow-site `704bd295`. Every check passed; nothing was rolled back (Evidence, "The deploy").

**Next:** T-216 reruns round 1 with `--t220`; its driver checks the published bundle against `cc310963…`, which `https://escrow.stream/try.mjs` serves since 11:10 UTC.

**What changed:**
- `apps/demo-cloud/src/world.ts`: the chain world's rulebook names `drand-quicknet` with quicknet's chain hash; one `drandQuicknet()` source for the demo adjudicators; `LiveSettlement.beacon` and `.drand`; the notes.
- Tests: `world.test.ts` (offline: the same storage reopened under this build; the anvil default; `llms.txt` names discovery's `defaultAdjudicators`), `one-world.anvil.test.ts` (an open deal across the switch on anvil; no network), `predeploy-fork.test.ts` (the fork run; opt-in with `SEPOLIA_FORK_RPC`); `apps/demo-cloud/test/anvil.ts` (`host`, `estimateShim`).
- `site/llms.txt` (rebuilt; `site/index.html` and `site/try.mjs` did not change), `docs/operations.md` (the deploy steps and rollback), `README.md`, `docs/api.md`, `docs/neutrality.md`, `docs/backlog.md`, `docs/plan.md`.

**The deploy, done 2026-11-05:** the deploy session followed "T-220: round 1's prerequisites in one deploy" in `docs/operations.md`, then its record PR:
- filled in this file's Evidence and ticked the live criteria;
- recorded the versions in `docs/operations.md` and marked its T-220 section deployed;
- dropped "until T-220's deploy" from `README.md` and `docs/api.md`, and set `docs/operations.md`'s Schema line to 0.10 live;
- changed Deploy step 8 to name `examples/try.ts`, since `apps/demo-cloud/scripts/deal.ts` refuses any chain but SimChain.

**Open for Rafa:**
- Residual 13 (`docs/backlog.md`, "the operators' adjudicators act on a deal behind the chain"): decided 2026-11-05 (D50). The deploy goes ahead with the honest limit `llms.txt` states, that a party cannot rule it out on its own, and T-227 fixes it in Phase 11, before mainnet.
- CI's must-not-skip anvil step: add `apps/demo-cloud/src/one-world.anvil.test.ts` beside `registration.anvil.test.ts` (backlog row; a `.github/` change).
- D48 default 5, the `bonds` pin in `llms.txt`'s deployment block: it needs `bonds` in `examples/deployments.ts` and `examples/verify.ts`'s pin type, then in `site/check.mjs`'s comparison. Until then the address is in the prose.

**Follow-ups, not built here:**
- The advisory `judgeBy` on a quicknet round boundary (T-217 Handoff) is a backlog row: an operator change, with T-225.
- `worker.ts`'s comment on `WORLD_NAMES` still says to bump a name for a schema change; D49 retired that for the Sepolia world. One comment line, outside this task's paths.
- No test measures the first sync pass on the deployed build's storage shape (no `cursor` row, books without `chainTxs`, a relayed step whose events were lost). An anvil test that strips those from a world's storage before reopening it would. The live deploy measured the expected result once: only `0xf0453986…5e5b` fell behind.
- The general Deploy block in `docs/operations.md` still names `apps/demo-cloud/scripts/deal.ts` for "a live end-to-end deal", which refuses the Sepolia nodes. One line; this record left it for the next docs pass.
