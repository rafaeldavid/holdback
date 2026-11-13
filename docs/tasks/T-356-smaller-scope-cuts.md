# T-356: the smaller scope cuts and refusals (SC-1, SC-2, SC-6, SC-3, SC-5; package R5)

- **Lane:** settlement (contracts)
- **Phase:** 2
- **Depends on:** T-346 and T-349 (SC-7, merged to `contracts-audit-ready` at `4f6cea0`), T-341 (the side-by-side harness and the state oracle), T-354 (the alignment test), T-345 (`ZeroPrice.t.sol`), ADR-0031 (Proposed, with D57 and D58)
- **Paths this task may touch:** `contracts/src/`; `contracts/test/` (tests of removed features, a test for each refusal, the harness's pinned parent, allow-list and handler); `contracts/script/` where a cut requires it; `packages/core/src/` for each cut's mirror; `packages/settlement/evm/`, `apps/operator/`, `apps/adjudicator/`, `apps/demo-cloud/`, `apps/test-agents/` and `examples/e2e-*` only where a cut breaks them; `scripts/evm-abis.mjs` and `abis.json`; the fixtures' SimChain-only list; `tests/cut-feature-alignment.known.json`; this task file. Never `spec/schemas/`, `site/`, `docs/api.md`, `docs/audit/`, `examples/seller-adapter.ts`, `examples/buyer-signer.ts`, `examples/audit-deal.ts`
- **Human gate:** no for the branch. The freeze, the merge to `main` and the redeploy are Rafa's
- **Status:** done (2026-11-13): merged to contracts-audit-ready, in `main` through PR 475 (`27ab44e`), and live on Sepolia since the phase-one cutover of 2026-11-13
- **Agent/session:** implementer session, change kind 7 (smart contracts): `forge test`, one reviewer and one red team per pull request, a target of 300k tokens per pull request

## Intent

In my own words: the phase-one contracts should do only what the pilot uses, and refuse terms they cannot settle, so that an auditor reads less code and the contract and core agree on every input. Five small changes do that, one pull request each, in this order:

1. **SC-1:** a deployment serves one token, fixed at deploy. Terms in any other token never fund.
2. **SC-2:** the buyer funds by ERC-3009 only. Permit2 leaves; Multicall3 stays, because the ERC-3009 collector uses it.
3. **SC-6:** nobody records an unfunded offer's expiry on chain. `expireOffer` and `Stage.Expired` leave; the operators mark the offer expired by their own clock and send nothing. `reclaim` still emits `JobExpired`.
4. **SC-3:** a mutual settlement pays the buyer and the seller only; a payout to any other address reverts, and `Paid` leaves with the feature.
5. **SC-5:** the contract refuses three kinds of terms core already refuses: deadlines not in strict order (`offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`, as `packages/core/src/timing.ts:46-49` compares them), `maxSubmissions` other than 1, and an `appealDecideSec` of 0. A zero price stays allowed. Off chain, core and the prepare routes refuse terms whose price and fee are both 0, the one deal the escrow cannot hold.

Each pull request carries its own off-chain mirror, so the full CI passes on it. The late-work settlement stays: a mutual settlement in `Held` may still name a delivery and release its key.

Non-goals: no refactor beyond the cuts; no change to a signed type or to `spec/schemas/` (ADR-0031: no cut changes one); no change to SimChain, which keeps every cut feature as the full protocol's reference; no edit to the docs that describe the live service (the sentences that change are in the Handoff); nothing deployed; nothing merged to `main`.

## Context

- ADR-0031 sections 2, 3, 4, 6, 7 and 10 (what leaves and what stays per cut), and its "Signed types and schemas" table.
- The contract refinement plan (kept privately, `docs/private-materials.md`): package R5 in section 7, the cut rows in section 2, the gates in section 6, the component table in section 7b.
- `contracts/test/differential/` (T-341): since this task each change is compared with its parent commit, vendored in `parent/`.

## What leaves, before it leaves

Line numbers are those of `contracts/src/HoldbackRules.sol` at `4f6cea0` [measured].

### SC-1: one token per deployment (ADR-0031 §2)

- **Leaves:** support for any token. `_paymentInfo`'s `token: t.token` (`:155`) becomes the immutable.
- **Added:** the immutable `TOKEN` and its getter, set by a new last constructor argument; `agreeAndFund` reverts `InvalidMessage` unless `t.token == TOKEN` (beside the `bondReserved` check, `:184`).
- **Choice between the ADR's two ways** (it leaves it to this task): keep `token` in the calldata view and compare it with the immutable. See Decisions.
- **Stays:** the three signed token fields, the commitment ID's hash of the token.

### SC-2: ERC-3009 funding only (ADR-0031 §3)

- **Leaves:** the constructor argument `permit2Collector` (`:116`), the immutable `PERMIT2_COLLECTOR` and its getter (`:56`, `:122`), the collector choice (`:194`), the `Funding.method` field (`HoldbackTypes.sol:75`) and its check (`:184`). The deploy script stops deploying and checking a `Permit2PaymentCollector`; the anvil world stops deploying one.
- **Stays:** `ERC3009_COLLECTOR`, the funding signature, Multicall3. `FundingAuthorization.scheme` keeps `permit2` in the schema.

### SC-6: no on-chain record of an unfunded offer's expiry (ADR-0031 §7)

- **Leaves:** `expireOffer` (`:424-432`) and `Stage.Expired` (`:32`, the enum's last member, so no other stage renumbers). Off chain: the EVM adapter's `expireOffer` transaction and its reading of `JobExpired` as `offer.expired` from that call, and the transaction behind the operator trigger route's `expire-offer` on the EVM path (the route itself stays; Decision 4).
- **Stays:** `JobExpired`, emitted by `reclaim` (`:441`). SimChain's `expire_offer` and `escrowState: Expired` (the operators' record).

### SC-3: mutual payouts to the parties only (ADR-0031 §4, §10)

- **Leaves:** the all-fee capture to a third address in `_payOut` (`:401-406`), its `captured` counter (`:394`, `:403`, `:415`), and the event `Paid` (`:86`, its one emit site `:405`).
- **Added:** `_payOut` reverts `InvalidMessage` on a payout whose `to` is neither the buyer nor the seller.
- **Stays:** `mutualSettle`, the signed `Payout[]`, any split between the two parties, the fee back to the buyer, the key release.

### SC-5: refuse terms settlement cannot process (ADR-0031 §6)

- **Added:** `agreeAndFund` reverts on deadlines not in strict order (the five, compared as `timing.ts:46-49`), on `maxSubmissions != 1`, and on `appealDecideSec == 0`.
- **Already done by T-346:** `bondReserved != 0` reverts (`:184`); this task checks it and does not redo it.
- **Off chain:** core and the operator's prepare routes refuse terms whose price and fee are both 0, naming the reason and citing `ZeroPrice.t.sol`'s pinned refusal; the reference adjudicator signs `bondReserved` 0.
- **Not refused:** a zero price with a fee above 0.
- **Not touched:** `appealWindowSec`, the window for filing a party appeal. Whether phase one requires it to be 0, and where, is open with Rafa (ADR-0031 §8, point 3; the coordinator, 2026-11-12). No check on it is added, removed or changed in the contract, core or the prepare routes; code that reads it keeps its behaviour, and the Handoff names any such place a cut passes.

## Acceptance criteria

For each pull request:

- [ ] the plan's done test for the cut holds: a test that the refused input now reverts, and every section 6 gate that applies passes;
- [ ] the side-by-side harness runs with the change's parent as the old side, and its allow-list names exactly what the cut removed or now refuses;
- [ ] the state oracle passes with the phase-one rows, updated where a cut removes one (SC-6 removes the expired state);
- [ ] `forge test`, both anvil jobs and `formal/check.sh`'s safety run pass; the test count falls only by tests of a removed feature, each named here;
- [ ] the alignment test's known list is regenerated, and the entries it loses are the files the cut fixed;
- [ ] the bytes freed in `HoldbackRules` are reported.

## Out of scope

- SC-7 (done by T-346 and T-349), the two new addresses (R6c), the refactors (R7), the fixes of section 5 (R8).
- The docs that describe the live service: `site/llms.txt`, `docs/api.md` and the rest of ADR-0031's appendix.
- The demo club's rulebook value for payouts: ADR-0031 §4 moves it to `parties` with the new demo world (D49), at the redeploy.

## Evidence

Filled in per pull request. Labels: measured, inferred.

**In sum** [measured]: five pull requests, each reviewed by one reviewer and one red team, none with a Critical or High finding; two Mediums (SC-6's off-chain expiry, found by both) fixed before merge. `HoldbackRules` runtime 19,609 bytes at `4f6cea0` and 19,651 at SC-5: SC-1 +189, SC-2 −179, SC-6 −205, SC-3 −42, SC-5 +279, so **426 bytes freed by the cuts and 468 added by the token check and the refusals, 42 bytes more in all**. `forge test` 353 → 388 with T-357's 7 counted between SC-2 and SC-6; 5 tests of removed features removed (3 in SC-2, 2 in SC-6), each named below. Alignment known list 122 → 115.

### SC-1

- **The refused input reverts** [measured]: `SingleToken.t.sol`, 6 tests. Terms in another ERC-3009 token, every message correctly signed, revert `InvalidMessage` at `agreeAndFund`; nothing is stored and no token moves. The refusal comes before the signature checks. A later step on such terms finds no deal (`WrongStage(None)`). A second deployment for another token is another signing domain.
- **`forge test`** [measured]: parent (`1ec7127`, CI run 43121825676) 353 tests in 51 suites; SC-1 360 of 360 in 52 suites. Added: the 6 tests above and `test_parentIsTheChangesParent`. No test removed. The hook-token reentry test (`Withstood.t.sol`) now deploys a rules contract for its hook token instead of dropping the test.
- **Side-by-side, parent `4f6cea0` as the old side** [measured, `test_sideBySide_reachesEveryRow -vv`, 48 seeds]: the differences are exactly the three SC-1 entries: `TOKEN()` added (on every step's Surface), other-token terms funded by the parent and refused by SC-1 (4 seeds, diverged by design, in Calls, Events, Balances, Holds, Stages and Words), and other-token terms refused by both, by SC-1 first for the token (3 steps, Calls only). 714 checked calls landed; every phase-one row and stage was reached. `testFuzz_sideBySide` passed 256 runs.
- **State oracle** [measured]: `invariant_legalDealStates` and the rest of `RulesInvariants.t.sol` pass; no row changes with SC-1.
- **Size** [measured, artifact runtime lengths]: `HoldbackRules` 19,609 bytes at the parent, 19,798 with SC-1: **189 bytes added, none freed**. The immutable, its getter and the comparison cost more than the calldata read they replace.
- **Alignment** [measured]: 122 known files before and after. SC-1's one identifier, "any ERC-20", is in docs that change at the redeploy, so this change fixes no listed file.
- **Off chain** [measured]: `abis.json` regenerated (`abis.test.ts` passes); the anvil world and `deploy-sepolia.sh` deploy the token before the rules contract and pass it in; the script checks `TOKEN()`. Core already requires one token per deal (`state.ts:214-215`). After review, the EVM adapter also refuses an offer whose terms name a token the deployment does not serve, at the offer and before anyone else signs (`evm-settlement.test.ts`, "an offer in a token the deployment does not serve"); before, a club that allowed two tokens let the parties sign terms the contract never funds.
- **Anvil, settlement leg** [measured, local]: 215 of 215 in 13 files, none skipped (before the adapter refusal was added).
- **CI's first run** failed one test [measured, run 43127978234]: `test_oldIsTheDeployedCommit64be1f1` could not read `out/old/SimBeacon.sol`. `forge test` compiles only what the selected tests import, and nothing imported that copy once the harness deployed `script/SimBeacon.sol`. `PinnedSource.t.sol` now imports every copy it pins.
- **Review** (one reviewer, one red team, neither given this file's conclusions): ISSUES, no Critical, High or Medium.
  - Low (reviewer): off chain, other-token terms were refused only at funding. Fixed: the adapter refuses them at the offer, with a test.
  - Low (reviewer): the Handoff said "Pending". Fixed.
  - Low (red team): `live.ts` checks the domain and `EXPIRY_MARGIN` at start-up but not `TOKEN()` against the deployment file. Not fixable before the redeploy: the deployed contract has no `TOKEN()`. In the Handoff for the cutover.
  - Info, fixed: Decision 1 now says the hashes keep `t.token`; `SingleToken.t.sol`'s docstring no longer claims `InvalidMessage` names the token; the second-deployment test shows the positive half; the allow-list's entries 2 and 3 no longer cover the Surface field.
  - Info, no change: the constructor takes any address as the token, like every other immutable (the deploy script checks `TOKEN()`); `expireOffer` still records `Expired` for any terms (SC-6 removes it); the deploy script's `if [ -n "$TOKEN" ]` branch is now always taken (removing it re-indents 20 lines for nothing).
- **Merged** into `contracts-audit-ready` at `0786180` after CI run 43131170355 passed all 12 jobs [measured].

### SC-2

- **The refused input reverts** [measured]: `Erc3009Only.t.sol`, 3 tests. A Permit2 PermitTransferFrom signature for the deal's hold, with the buyer's Permit2 allowance in place (the input that funded before SC-2), reverts at `agreeAndFund`; nothing is stored and no token moves. `PERMIT2_COLLECTOR()` is gone from the ABI. Every hold is authorized through the ERC-3009 collector (the escrow's `PaymentAuthorized` names it).
- **Removed tests, each of the removed feature** [measured]: `AgreeAndFund.t.sol` `test_permit2_funds` (Permit2 funding); `Withstood.t.sol` `test_defense_funding_method_swap_refused` (the `method` field it swapped is gone); `Erc1271Replay.t.sol` `test_defense_permit2FundingSignature_doesNotReplayAcrossWalletsWithOneOwner` (Permit2 replay; the ERC-3009 replay test beside it stays).
- **`forge test`** [measured]: parent (SC-1) 360 in 52 suites; SC-2 360 of 360 in 53 suites (3 removed, 3 added).
- **Side-by-side, parent `0786180` as the old side** [measured, 48 coverage seeds]: exactly one difference, `PERMIT2_COLLECTOR()` gone, on every step's Surface. No seed diverged; 685 checked calls landed; every phase-one row and stage reached. `Funding.method` left too, so the pinned side encodes the parent's `agreeAndFund` with `method` 0 and the same ERC-3009 signature (`Sides.sol`, `_agreeAndFundCall`). The handler never funded through Permit2, on either side, so the Permit2 refusal is proven by the unit test, not by the harness.
- **State oracle** [measured]: passes; no row changes.
- **Size** [measured]: `HoldbackRules` runtime 19,798 → 19,619 bytes: **179 bytes freed**.
- **Alignment** [measured]: 122 → 115 known files. The seven that left are the files this change stopped naming Permit2 in: `apps/demo-cloud/src/lanes.test.ts`, `apps/demo-cloud/test/anvil.ts`, `examples/e2e-scenarios-direct.test.ts`, `examples/e2e-world.ts`, `packages/settlement/evm/attack-t230.test.ts`, `chain.ts`, `wall.test.ts`.
- **Off chain** [measured]: `abis.json` regenerated; the adapter encodes `Funding` as `{ signature }` and reads every funding as `erc3009`; `Deployment` loses `permit2Collector`, and `DeploymentFile` keeps it optional and unread, for records of the deployed contracts; the anvil world deploys no Permit2 collector; `deploy-sepolia.sh` deploys and checks no Permit2 collector and no Permit2. Anvil settlement leg 216 of 216 in 13 files, none skipped. `FundingAuthorization.scheme` keeps `permit2` in the schema.
- **CI on the first push** [measured, run 43134379924]: all 12 jobs passed, both anvil legs and `formal (TLC)` among them.
- **Review** (one reviewer, one red team, neither given this file's conclusions): ISSUES, no Critical, High or Medium.
  - Low (red team): core's `phase_one` profile took a `permit2` funding, and no test pinned the adapter's refusal. Fixed: `fund` refuses any scheme but `erc3009` on `phase_one` (`state.ts`, test "refuses a Permit2 funding authorization"); an anvil test pins the adapter's refusal before any transaction.
  - Low (reviewer): no contract-wallet funding test ran on the deployment's own token. Fixed: `test_contractWalletBuyer_fundsOnTestUSDC` funds and refunds an ERC-1271 buyer on `TestUSDC`.
  - Low (red team): a lane build pointed at the deployed contracts passes start-up and then has every funding refused. For the cutover; in the Handoff.
  - Low (reviewer): the evidence lacked the world leg and the formal run. Fixed above.
  - Info, fixed: `Erc3009Only`'s refusal test names the exact revert; the Edit tool had joined 9 deployment lines and dropped a space in 12 `{ signature: … }` sites, restored; the deploy script's comment on Multicall3 now says the collector is built with it (an undeployed ERC-6492 buyer cannot agree and fund in one call, ADR-0031 §5).
  - Info, no change: `DeploymentFile.permit2Collector` stays optional and unread for records of the deployed contracts; the harness cannot show the Permit2 refusal because the handler never funded through Permit2.
- **After the review** [measured]: `forge test` adds `test_contractWalletBuyer_fundsOnTestUSDC` (361 expected); core's `state.test.ts` 274 of 274.
- **Merged** into `contracts-audit-ready` at `b5d198c`, with T-357's late-work settlement merged in first (`6af04e1`: 368 of 368, CI run on that head passed all 12 jobs) [measured].

### SC-6

- **The refused input reverts** [measured]: `NoOfferExpiry.t.sol`, 4 tests. The parent's `expireOffer` call reverts with empty data and writes nothing; an offer past `offerExpiresAt` stays `None` and cannot fund (`DeadlinePassed`); every timeout on an unfunded offer finds no deal; `reclaim` still emits `JobExpired`.
- **Removed tests, each of the removed function** [measured]: `Timeouts.t.sol` `test_expireOffer`; `RelayFromContract.t.sol` `test_relay_expireOffer`. Changed, not removed: `HandlerSmoke`'s `test_expireOffer` (now: refused, the offer stays unfunded and cannot fund); `StateOracle.t.sol`'s reach test (an expired offer is P01); `Eip7702Signers` and `Erc1271GasBurn` (the lapsed offer is refused `DeadlinePassed` instead of recorded); `PhaseOneRedTeam`'s decided-deal test drops its `expireOffer` line.
- **`forge test`** [measured]: parent (SC-2 with T-357) 368 in 54 suites; SC-6 370 of 370 in 55 suites (2 removed, 4 added).
- **Side-by-side, parent `b5d198c` as the old side** [measured, 48 coverage seeds]: exactly SC-6's four entries: `expireOffer` gone (175 steps, Calls), no `JobExpired` for an offer (97, Events), no `Expired` stage stored (2,684 steps, Words), an expired offer refused as unfunded later (236, Calls). No seed diverged; 640 checked calls landed; every phase-one row and every stage reached (seven stages now).
- **State oracle** [measured]: the phase-one table loses row L02 (P01 to P17 remain); `invariant_legalDealStates` and the other invariants pass. The invariant campaign no longer targets the handler's `expireOffer`.
- **Size** [measured]: `HoldbackRules` runtime 19,619 → 19,414 bytes: **205 bytes freed**.
- **Alignment** [measured]: 115 → 115 known files. Every listed file still names the operators' timeout kind `expire_offer` or the route `expire-offer`, which stay (Decision 4); `expireOffer` itself is gone from every product file but a comment in `sync.ts` and the Sepolia round's `examples/e2e-chain.ts` and `e2e-scenarios.ts`, which describe the deployed contracts (Handoff).
- **Off chain** [measured]: `abis.json` regenerated; the adapter records an offer's expiry with no transaction and expects the chain's `None` for an expired book; the sync no longer reads a `JobExpired` before funding as an expiry; the timeout runner marks due expiries outside its caps and budget. Anvil settlement leg plus the demo world's timeout and one-world suites 221 of 221 in 15 files, none skipped; core and operator 1,212 of 1,212.
- **CI on the first push** [measured, run 43141480392]: all 12 jobs passed, both anvil legs and `formal (TLC)` among them.
- **Review** (one reviewer, one red team, neither given this file's conclusions): ISSUES, no Critical or High.
  - Medium (both, independently): the off-chain mark read nothing from the chain, so a funding this node had not synced, or a node clock ahead of the chain's, let it show a funded deal as `Expired`, set `finalAt`, and stop following the deal (the red team showed the book stays `Expired` after the sync puts it behind). Fixed: one read of one block before marking (Decision 4), and a deal behind the chain is refused. Anvil test "an offer funded on chain that this node has not synced is not marked expired" fails without the read [inferred: without it the trigger returns `Expired`].
  - Low (reviewer): the "What leaves" line said the trigger route's kind leaves while Decision 4 keeps it. Fixed: the line now names only the transaction.
  - Low (reviewer): the Evidence lacked the formal run and the CI run. Fixed above.
  - Low (red team, existed before SC-6): an `Agreed` book between `offerExpiresAt` and `fundBy` — core funds it and expires it only at `fundBy`, while the contract refuses funding from `offerExpiresAt`. ADR-0031 §6 sends this to the docs and the prepare routes; in the Handoff.
  - Info, fixed: a closed budget or a paused relay no longer holds an expiry back (`closedFor`).
  - Info, no change: after the redeploy, the stage lists cannot read the deployed contracts' `Expired`; the Sepolia round's scripts still name `expireOffer` (Handoff).
- **Merged** into `contracts-audit-ready` at `f47a96a` after CI run on `e789713` passed all 12 jobs [measured].

### SC-3

- **The refused input reverts** [measured]: `PartiesOnlyPayout.t.sol`, 4 tests. A settlement both parties signed that pays part of the price, or all of it, to a third address reverts `InvalidMessage`; the deal stays open, nothing moves, and with `releaseKey` no key is released. A split between the parties settles with exactly two transfers out of the hold (one capture to the seller, one void to the buyer).
- **Changed, not removed** [measured]: `Settle.t.sol`'s split test pays the parties only (a payee named twice); `Postings.fuzz.t.sol`'s random split pays the seller and the buyer twice and asserts the third address receives nothing; `Withstood.t.sol`'s zero-address payout now reverts `InvalidMessage` in the rules contract (before CPP's `ZeroFeeReceiver`), the payout-to-the-rules-contract Info test becomes a refusal (nothing stranded), and the reentrancy test re-enters during the seller's payout (the hook token gains a watched party) instead of a third payee's. No test removed.
- **`forge test`** [measured]: parent (SC-6) 370 in 55 suites; SC-3 374 of 374 in 56 suites.
- **Side-by-side, parent `f47a96a` as the old side** [measured, 48 coverage seeds]: one difference, a third-party settlement paid by the parent (`Paid`) and refused here (4 seeds, diverged by design); entry 2 (both refuse, the parent for its own reason) fired in the fuzz run before the handler recorded the payee. 598 checked calls landed; every phase-one row and stage reached. The handler names a third party in one settlement in 32 (it was nearly every one). The four removed actions are refused alike on both sides now that the parent has no `expireOffer` either, so their weight went to the deal flow (`SideBySide.t.sol`); without that, 543 calls landed, below the gate's floor of 576.
- **Size** [measured]: `HoldbackRules` runtime 19,414 → 19,372 bytes: **42 bytes freed**.
- **Alignment** [measured]: 115 → 115. The files that name `Paid` or `payoutsTo: any` either name another cut too or are the EVM test world's rulebook (`packages/settlement/evm/testing.ts`), which moves to `parties` with the new demo world (ADR-0031 §4).
- **Off chain** [measured]: core's `phase_one` profile refuses a payout to neither party, whatever the rulebook says, naming the reason (state test); the EVM adapter checks the payees before the simulation (the payee rule only, so every other refusal still comes from the contract's simulation by name, as T-357's late-work test expects), so the refusal comes with its reason and no transaction (anvil test "a settlement that pays a third address is refused"), and its sync no longer reads `Paid`; the operator's settlement prepare route refuses such a payout on a chain settlement before anyone signs (`prepare-phase-one.test.ts`). SimChain keeps D23.
- **CI on the first push** [measured, run on `4e4c1a3`]: all 12 jobs passed, both anvil legs and `formal (TLC)` among them.
- **Review** (one reviewer, one red team, neither given this file's conclusions): ISSUES, no Critical, High or Medium. The red team's fuzz over 1 to 6 payouts with repeats and a buyer equal to the seller found every non-party paid 0 and the hold emptied [their measurement].
  - Low (reviewer): the allow-list's entry 2 named cases that cannot occur (a wrong key, an overshoot). Fixed: it names the one case (the escrow refusing the parent's third-party capture) and says no coverage seed exercises it.
  - Low (red team): `Settle.t.sol` used a payee named twice as the normal split, which the API's parser refuses. Fixed: its comment says so. Low (red team, existed before): a zero-price deal has no settlement the API takes. In the Handoff.
  - Info, fixed: two stale comments (`Withstood.t.sol`'s callee, `SideBySide.t.sol`'s weights).
- **Merged** into `contracts-audit-ready` at `ebb77da` after CI on `1fc3100` passed all 12 jobs [measured].

### SC-5

- **The refused inputs revert** [measured]: `StrictTerms.t.sol`, 13 tests. `agreeAndFund` refuses with `InvalidMessage`, before any signature check, nothing stored and no token moved: each of the four adjacent equal pairs; three reversed pairs (the cases ADR-0031 §6 names); any order, fuzzed against the strict rule (ordered terms fund); `maxSubmissions` 0, 2, 3 and 255; `appealDecideSec` 0. What still funds: deadlines one second apart, `appealDecideSec` 1, a zero price with a fee, and `appealWindowSec` 0 (not checked: open with Rafa).
- **Already done, checked and not redone** [measured]: the acceptance's `bondReserved` 0 (`HoldbackRules.sol`'s funding check since T-346; `PhaseOneNoBonds.t.sol`); the reference adjudicator signs `bondReserved` 0 on a chain settlement (`apps/adjudicator/src/service.ts:243`, T-349).
- **Changed, not removed** [measured]: six tests built terms out of order, the input SC-5 refuses. `KnownSeedFallback.t.sol`'s two attacks (a fallback seed known or ground before funding, the hunt's L-8) and `Erc6492Prepare.t.sol`'s prepare-call attack (funding straight into `Escalated`) now show the funding refused; `AfterCppReclaim.t.sol`'s L-6 attack ("this test flips when the contract lane fixes it") and its deliverBy-after-expiry case now show the terms refused; `UntestedReverts.t.sol`'s uint48 test moves the later deadlines up so only representability fails. No test removed.
- **`forge test`** [measured]: parent (SC-3) 374 in 56 suites; SC-5 387 of 387 in 57 suites (13 added).
- **Side-by-side, parent `ebb77da` as the old side** [measured, 48 coverage seeds]: SC-5's two entries only: out-of-order terms funded by the parent and refused here (6 seeds, diverged by design) and refused by both, here first for the timing (2 steps, Calls). 623 checked calls landed; every phase-one row and stage reached. The handler draws strictly ordered deadlines (its ordered branch no longer draws an equal `offerExpiresAt`/`fundBy` pair) and draws any order in one offer in 32 (it was one in four), recorded in `fundOutOfOrder`.
- **State oracle** [measured]: passes; no row changes.
- **Size** [measured]: `HoldbackRules` runtime 19,372 → 19,651 bytes: **279 bytes added**, the cost of the refusals.
- **Alignment** [measured]: 115 → 115 (SC-5 adds refusals; it removes no cut identifier).
- **Off chain** [measured]: core's `offer` takes a `profile`; on `phase_one` it refuses `maxSubmissions` other than 1, `appealDecideSec` 0, and price and fee both 0 with `ZERO_HOLD_PROBLEM`, which names the escrow's `ZeroAmount` and cites `ZeroPrice.t.sol`'s `test_zeroPriceZeroFee_cannotFund_escrowRefusesZeroAmount` (on `main`, not yet on the lane); the full profile still takes a deal that holds nothing (SimChain funds it). The strict deadline order was already core's (`timing.ts:46-49`). The EVM adapter passes `phase_one` to `offer`. The operator's offer prepare route refuses price and fee both 0 on a chain settlement, before the seller signs [inferred: no route-level test, the stub registrations it needs are brittle; core's identical check is tested]. Core 291 of 291 in `state.test.ts`; anvil set 227 of 227; core, operator and alignment 1,222 of 1,222.
- **CI on the first push** [measured, run on `e661bb9`]: all 12 jobs passed, both anvil legs and `formal (TLC)` among them.
- **Review** (one reviewer, one red team, neither given this file's conclusions): ISSUES, no Critical, High or Medium. The red team's fuzz funded strictly ordered terms with every window from 1 s to 30 s and silenced each party four ways: every deal closed by a timeout a stranger could send, the buyer refunded in full; three invariants reran 512 runs of 256,000 calls each [their measurement].
  - Low (red team, existed before): the offer prepare route handed the seller a digest for out-of-order deadlines, which core and the contract then refuse. Fixed: on a chain settlement the route runs core's `validateTiming` before the seller signs; `prepare-offer-phase-one.test.ts` (7 tests) pins it and the zero-hold refusal (reviewer Low 2), the hash-only path and the zero price with a fee.
  - Low (reviewer): no lane test pinned the escrow's `ZeroAmount` for price 0 and fee 0 (`ZeroPrice.t.sol` is on `main` only). Fixed: `StrictTerms.t.sol` pins it (14 tests now).
  - Low (reviewer): `UntestedReverts`' uint48 test can no longer tell the `fundBy` clause from the expiry clause. Re-documented; the clause is kept (refactor nothing beyond the cut).
  - Low (red team, existed before): `Deal.t1` is uint40 while deadlines may fund up to the uint48 expiry, so a fallback or escalation at 2^40 s (year 36812) stores `t1` 0. Not fixed here: a new refusal beyond SC-5's list. In the Handoff.
  - Info, fixed: stale comments in `StateOracle.sol`, `RulesHandler.sol`, `UntestedReverts.t.sol` and core's `offer`; a vacuous assertion in `KnownSeedFallback.t.sol`. Info, no change: SC-5 reuses `InvalidMessage`; the warning below the smallest decidable escalation window is not built (Handoff); the fuzz handler never draws `maxSubmissions` other than 1 or a zero escalation window (unit tests cover both).
- **After the review** [measured]: `forge test` 388 expected (1 added); core and operator 1,227 of 1,227. Info, no change: off chain the payee check runs before the expiry and stage checks, so a settlement both stale and paying a third address gets another reason than the contract's (both refuse); the cutover, schema-description and payout-address notes are in the Handoff.

## Decisions

1. **SC-1 keeps `token` in the calldata view and compares it with the immutable** (ADR-0031 §2's first way; the ADR prefers the second and leaves the choice to this task). Dropping the field would change the `Terms` tuple, and so the selector of every entry point, in the same change that only meant to fix the token: every caller, the adapter's encoding and the side-by-side harness's shared ABI would move with it. The check sits in `agreeAndFund` only. Every later step finds the deal by the commitment ID, which hashes `t.token`, so a step on terms in another token finds no deal (`SingleToken.t.sol`). The cost is one comparison, which an auditor reads in one line. So, unlike the literal reading of ADR-0031 §2's "What leaves" line, the hashes keep `tokenIdHash(t.token)` (`H.commitmentId`, `H.acceptanceHash`, `mutualSettle`'s `mutualHash`): the ID binds the token, and the funding check makes it the immutable for every funded deal. Only `_paymentInfo` reads the immutable.
2. **The harness's old side is the change's parent,** vendored byte for byte in `contracts/test/differential/parent/` and replaced by each pull request. `old/` stays at the deployed commit `64be1f1`, because `PhaseOneNoBonds.t.sol` proves its "failed before" cases against it. The planted mutant is rebuilt from the parent. The SC-7 allow-list entries leave: they compared the deployed commit, which is no longer the old side.
3. **The handler offers the second token once in 64 offers** (it was one in two), so SC-1's refusal is exercised on every run without diverging most seeds.
4. **SC-6: the operators' timeout kind `expire_offer` and the trigger route stay; only the transaction leaves.** The adapter's `trigger(id, 'expire_offer')` steps core and logs `offer.expired` with `{ from }` (SimChain's payload) and no transaction; the timeout runner marks a due expiry outside the per-pass cap and the gas budget, reports it under a new `marked` list (not `sent`), and still waits while a transaction of that deal is in flight. The operator's trigger route is unchanged: it was chain-agnostic and now records the expiry through the adapter, so a party's trigger at the deadline answers `Expired` at once instead of after the pass's grace. `escrowState: Expired` and `offer.expired` stay, as ADR-0031 §7 says. Before SC-6 the on-chain `expireOffer` closed two races by reverting: a funding this node has not synced (relayed by another operator, or sent directly) and a node clock ahead of the chain's. After review, the mark makes one free read of one block first and refuses unless the deal is `None` there and, on a live chain, that block's time has passed `min(offerExpiresAt, fundBy)`, after which no block can fund it; a deal behind the chain is refused with its lag notice. The ADR's appendix drops `expire-offer` from the live docs; whether the docs list the route (which now records the expiry and sends nothing) is the docs package's call.
5. **SC-6, the harness:** the pinned parent's `Stage.Expired` (8) does not fit the new enum, so the pinned side reads it as `None`, the stage the new side holds for the same offer. Both sides then choose their next steps alike, and the allow-list names the three exact differences (the call, the raw word's stage byte, the later refusal reasons). The invariant campaign no longer targets the handler's `expireOffer` action, as it does not target the removed appeal actions.

## Handoff

**Done:** SC-1 (rafaeldavid/holdback#366), SC-2 (rafaeldavid/holdback#368), SC-6 (rafaeldavid/holdback#370), SC-3 (rafaeldavid/holdback#371), SC-5 (this pull request). Package R5 is complete once SC-5 merges.

**How each later change uses the harness:** re-vendor `contracts/test/differential/parent/` from the new parent (`git show <sha>:contracts/src/<file>`, renaming the rules file to `HoldbackRules.<sha>.sol`), rebuild `planted/` from it (its imports and the one deleted line), recompute the pins in `PinnedSource.t.sol` (keccak256 of each file's bytes), and replace the allow-list with that change's entries.

**Sentences for the docs package** (the live site and API docs describe the deployed contracts until the freeze, so none is edited here):

- SC-1: `docs/neutrality.md:41` "Mitigation: the escrow accepts any ERC-20" becomes "anyone can deploy for a token with no freeze"; `docs/architecture.md:48,268` "The deal's token is any ERC-20 the parties name" becomes "one token per deployment, fixed at deploy"; `docs/audit/scope.md` states the deployment assumption (a plain ERC-20 with ERC-3009: no fee on transfer, no rebasing, no hook) and lists `TOKEN` among the immutables the freeze records.
- SC-2: `SECURITY.md:28` drops Permit2 from the contracts reused unchanged; `docs/api.md:342` "Funding authorization (ERC-3009 or Permit2 style)" becomes "ERC-3009"; `docs/architecture.md:48,268` "others through Permit2" goes; `docs/operations.md` (the deploy record) lists one collector; `contracts/README.md:21` drops the `lib/permit2` build step; `site/try.mjs` drops its pinned `permit2Collector`. `docs/audit/scope.md` drops the Permit2 collector from the contracts in scope.
- SC-6: `docs/api.md:272,351` "**Expired offers.** … until someone calls `…/triggers/expire-offer`; until then the primary adjudicator's reserved bond stays encumbered" becomes "an unfunded offer expires by the operators' clock, with no transaction; nothing is reserved"; `site/llms.txt:545` says the `expire-offer` trigger records the expiry in the operator's own record and sends nothing; `docs/architecture.md:75-80` marks the `Expired` transitions as the operators' record, not the contract's; `docs/audit/state-model.md` drops row L02; `formal/README.md`'s `Expire` for `expire_offer` describes the full protocol (SimChain). The Sepolia round's scenario 3d (`examples/e2e-scenarios.ts:200-220`) checks "dealOf reads Expired" and "expireOffer emits JobExpired"; for the phase-one world it checks the operators' `Expired`, `dealOf` reading `None`, and no transaction; `examples/e2e-chain.ts`'s stage list and `expireOffer` trigger go with it.
- SC-3: `docs/neutrality.md:17` "at any split, to any addresses both parties sign (ADR-0019, D23)" becomes "at any split between the buyer and the seller"; `docs/api.md:98,121,347` and `docs/architecture.md:102,227,335` "payouts … to any addresses both sign for" become "to the buyer and the seller only"; `site/llms.txt:534,595-596` says payouts name the buyer or the seller only; the demo club's rulebook moves `mutualSettlement.payoutsTo` to `parties` with the new demo world (ADR-0031 §4, D49), and with it the EVM test world's rulebook (`packages/settlement/evm/testing.ts:71`). `docs/audit/events.md` drops `Paid`.
- SC-5: `docs/architecture.md:280` (the deadline order ends at `fallbackBy`, strictly); `site/llms.txt` and `docs/api.md` state the three refusals (deadlines in strict order, one delivery, an escalation window of at least a second) and the phase-one limit that a deal holds at least one base unit, as price or as fee; `docs/audit/known-issues.md` moves L-6, L-8 and the hunt's findings 2 and 4 to fixed; `docs/audit/state-model.md` 9.1, 9.5 and Appendix A drop a zero price from SC-5's refusals (T-345's hand-over) and its finding F-2 closes; the state oracle's P05 bound (`StateOracle.sol`, "SC-5 has not landed") can tighten to `t1 < fallbackBy` in a later change. The schema descriptions that say a payout may go to "another escrow, an arbiter" (`spec/schemas/common.schema.json:307`, `messages.schema.json:757`) describe the full protocol; the phase-one docs say the contracts pay the parties only (a schema change is not needed and not made here).

**For the cutover (R12):**

- `packages/settlement/evm/live.ts` should check `TOKEN()` against the deployment file's token at start-up, next to the domain and `EXPIRY_MARGIN` checks (red team L-1, SC-1). It cannot land before the redeploy: the deployed contract has no `TOKEN()`.
- From SC-2 on, a lane build pointed at the deployed Sepolia contracts passes start-up (same domain, same margin) and then has every funding refused, because `agreeAndFund`'s selector changed (red team L-1, SC-2). The `TOKEN()` check above catches it; comparing the rules contract's runtime code hash with the build's would catch it by design.
- The deployed record's `permit2Collector` is also pinned in `examples/deployments.ts:24,51`, `tests/contract-stack.test.ts:33` and `scripts/contract-stack.mjs:61`; each drops it with the new record.
- From SC-6 on, the adapter's stage lists stop at `Settled`, so a lane build reading the deployed contracts cannot name a deal they recorded as `Expired` (reviewer Info, SC-6); the cutover moves to the new world, where none exists.
- An `Agreed` book between `offerExpiresAt` and `fundBy`: core funds it and expires it at `fundBy`, the contract refuses funding from `offerExpiresAt` (red team L-2, SC-6; existed before). ADR-0031 §6 puts the fix in the docs and the prepare routes, not in this lane.
- From SC-3 on, a lane build reading the deployed contracts could not sync a past settlement there that paid a third address (its sync now refuses payees other than the parties; reviewer Info, SC-3). The cutover moves to the new world.
- Two API limits that existed before SC-3 (red team L-1, L-2; reviewer Info 5): a deal with price 0 has no settlement the API takes (the contract takes only an empty payout list there, the schema requires at least one payout above zero), and the contract adds up a payee named twice, which the API's parser refuses. Neither puts funds at risk; both belong to the zero-price and settlement docs.
- When the seller's payout address lands (ADR-0031 §11, R6c-1), the payee checks in the contract, core's phase-one profile, the adapter and the prepare route all compare with the seller's signing address today and must change together (red team Info, SC-3).
- **Not built, from ADR-0031 §6 and the state model's F-2:** the operator's prepare route warns, without refusing, when the escalation window is below the smallest one the deployed chain can decide (it depends on the block time and on ADR-0032's margin, package R8).
- **For R8 (the remaining fixes):** `Deal.t1` is uint40 while deadlines may fund up to the escrow's uint48 expiry; a fallback trigger or an escalation at or after 2^40 s (year 36812) stores `t1` 0, which the state model calls illegal (class I13). Refusing terms whose `fallbackBy + appealDecideSec` exceeds uint40 as unrepresentable closes it (SC-5 red team L-2). Only a direct submission can reach it: core refuses years after 9999.
- **Contract and core still differ for terms sent straight to the contract, none from SC-5** (red team I-4): the contract takes an `appealDecideSec` above uint32 and years after 9999, and refuses a `price + fee` above uint120, which core takes.
- ADR-0031:78 cites the adapter's ERC-3009 refusal at `evm-settlement.ts:1235-1236`; it is at `:1211` on the lane now.

**`appealWindowSec`:** no cut changes a check on it (the coordinator, 2026-11-12; open with Rafa).
