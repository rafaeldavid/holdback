# T-356: the smaller scope cuts and refusals (SC-1, SC-2, SC-6, SC-3, SC-5; package R5)

- **Lane:** settlement (contracts)
- **Phase:** 2
- **Depends on:** T-346 and T-349 (SC-7, merged to `contracts-audit-ready` at `4f6cea0`), T-341 (the side-by-side harness and the state oracle), T-354 (the alignment test), T-345 (`ZeroPrice.t.sol`), ADR-0031 (Proposed, with D57 and D58)
- **Paths this task may touch:** `contracts/src/`; `contracts/test/` (tests of removed features, a test for each refusal, the harness's pinned parent, allow-list and handler); `contracts/script/` where a cut requires it; `packages/core/src/` for each cut's mirror; `packages/settlement/evm/`, `apps/operator/`, `apps/adjudicator/`, `apps/demo-cloud/`, `apps/test-agents/` and `examples/e2e-*` only where a cut breaks them; `scripts/evm-abis.mjs` and `abis.json`; the fixtures' SimChain-only list; `tests/cut-feature-alignment.known.json`; this task file. Never `spec/schemas/`, `site/`, `docs/api.md`, `docs/audit/`, `examples/seller-adapter.ts`, `examples/buyer-signer.ts`, `examples/audit-deal.ts`
- **Human gate:** no for the branch. The freeze, the merge to `main` and the redeploy are Rafa's
- **Status:** in progress
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

- **Leaves:** `expireOffer` (`:424-432`) and `Stage.Expired` (`:32`, the enum's last member, so no other stage renumbers). Off chain: the EVM adapter's `expireOffer` transaction and its reading of `JobExpired` as `offer.expired` from that call, and the operator trigger route's `expire-offer` kind on the EVM path.
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

## Decisions

1. **SC-1 keeps `token` in the calldata view and compares it with the immutable** (ADR-0031 §2's first way; the ADR prefers the second and leaves the choice to this task). Dropping the field would change the `Terms` tuple, and so the selector of every entry point, in the same change that only meant to fix the token: every caller, the adapter's encoding and the side-by-side harness's shared ABI would move with it. The check sits in `agreeAndFund` only. Every later step finds the deal by the commitment ID, which hashes `t.token`, so a step on terms in another token finds no deal (`SingleToken.t.sol`). The cost is one comparison, which an auditor reads in one line. So, unlike the literal reading of ADR-0031 §2's "What leaves" line, the hashes keep `tokenIdHash(t.token)` (`H.commitmentId`, `H.acceptanceHash`, `mutualSettle`'s `mutualHash`): the ID binds the token, and the funding check makes it the immutable for every funded deal. Only `_paymentInfo` reads the immutable.
2. **The harness's old side is the change's parent,** vendored byte for byte in `contracts/test/differential/parent/` and replaced by each pull request. `old/` stays at the deployed commit `64be1f1`, because `PhaseOneNoBonds.t.sol` proves its "failed before" cases against it. The planted mutant is rebuilt from the parent. The SC-7 allow-list entries leave: they compared the deployed commit, which is no longer the old side.
3. **The handler offers the second token once in 64 offers** (it was one in two), so SC-1's refusal is exercised on every run without diverging most seeds.

## Handoff

**Done:** SC-1 (rafaeldavid/holdback#366). **Next:** SC-2, then SC-6, SC-3 and SC-5, each branched from `origin/contracts-audit-ready` after the previous one merges.

**How each later change uses the harness:** re-vendor `contracts/test/differential/parent/` from the new parent (`git show <sha>:contracts/src/<file>`, renaming the rules file to `HoldbackRules.<sha>.sol`), rebuild `planted/` from it (its imports and the one deleted line), recompute the pins in `PinnedSource.t.sol` (keccak256 of each file's bytes), and replace the allow-list with that change's entries.

**Sentences for the docs package** (the live site and API docs describe the deployed contracts until the freeze, so none is edited here):

- SC-1: `docs/neutrality.md:41` "Mitigation: the escrow accepts any ERC-20" becomes "anyone can deploy for a token with no freeze"; `docs/architecture.md:48,268` "The deal's token is any ERC-20 the parties name" becomes "one token per deployment, fixed at deploy"; `docs/audit/scope.md` states the deployment assumption (a plain ERC-20 with ERC-3009: no fee on transfer, no rebasing, no hook) and lists `TOKEN` among the immutables the freeze records.

**For the cutover (R12):** `packages/settlement/evm/live.ts` should check `TOKEN()` against the deployment file's token at start-up, next to the domain and `EXPIRY_MARGIN` checks (red team L-1, SC-1). It cannot land before the redeploy: the deployed contract has no `TOKEN()`.

**`appealWindowSec`:** no cut changes a check on it (the coordinator, 2026-11-12; open with Rafa).
