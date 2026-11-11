# ADR-0031: The phase-one contract scope

- **Status:** Proposed, 2026-11-11. Rafa decided three of its lines the same day: phase one ships without party appeals and bonds (SC-7, D57), contract signers stay (SC-4 is refused), and a cut feature's events leave with it. The other cuts follow his stated direction and proceed unless he stops one. One cut is open (SC-8). Rafa may overrule any line.
- **Date:** 2026-11-11
- **Raised by:** T-342, package R1 of the contract refinement plan (kept privately, `docs/private-materials.md`), from Rafa's standard for the contracts on 2026-11-11: "it's better to have a limited scope for an initial phase of the product than perfectly complete and universal design contracts that open up to risks."
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0003 (the escrow base), ADR-0006 (defended judgment), ADR-0007 (bonded adjudicators), ADR-0016 (the acceptance and the state machine), ADR-0018 (the beacon), ADR-0019 (mutual settlement), ADR-0025 and ADR-0026 (funding), ADR-0029 (delivery binding), ADR-0030 (adjudicator registration); D23, D26, D28, D31, D32, D38, D42, D43, D54.
- **Changes (when built, by later tasks):** `contracts/src/`, their tests and the deploy scripts; the off-chain mirrors in `packages/core`, `packages/settlement/evm`, `apps/operator` and `apps/adjudicator`; the list of SimChain-only fixtures in `packages/testkit/src/runner.ts`. **No signed type and no file in `spec/schemas/` changes.** This ADR itself changes no code.
- **Amends, for the phase-one contracts only:** ADR-0007 (bonds and the overturn payout), ADR-0016 §1 (funding gated on reserved bond) and §2 (the appeal state), ADR-0006 (tier 3, the party appeal), ADR-0019's D23 amendment (payouts to any address), D38 and D42 (any token per deal), D43 (the overturn payout on chain), ADR-0030 (the operators' refusal of an unbonded fallback). Each stays the full protocol's design, and SimChain keeps it.

Labels: **measured** (read at the cited line by this task, or by the search this task ran, at commit `26d4670`, where `contracts/src` equals the deployed commit `64be1f1`: `git diff --quiet 64be1f1 HEAD -- contracts/src` exits 0), **documented** (stated in the cited doc), **inferred** (from reading, not from a run), **guessed**. Nothing was run. Line numbers are those of `26d4670`; the contract clean-up (T-334) moves them.

## Summary

**Phase one is an escrow with a neutral decider, and nothing else.** It is the next deployment of the contracts: the one an external audit reads and a first pilot uses, on a testnet. One token per deployment. The buyer funds a hold with one ERC-3009 signature. The seller delivers. The primary adjudicator decides, or the fallback does when the primary is late; either may escalate to the appeal adjudicator. The buyer may accept early, both parties may settle between themselves, and anyone may trigger a timeout. The first decision is final.

**What phase one cuts on purpose:**

| # | Cut | State | Whose call |
| --- | --- | --- | --- |
| SC-1 | One settlement token per deployment | Proceeds | Rafa's stated direction; he may stop it |
| SC-2 | ERC-3009 funding only | Proceeds | same |
| SC-3 | A mutual settlement pays the buyer and the seller only | Proceeds; D23 is deferred | same |
| SC-4 | Signatures from plain keys only | **Refused by Rafa, 2026-11-11.** Contract signers stay | decided |
| SC-5 | Refuse terms that settlement does not process | Proceeds, with two corrections to the plan (below) | Rafa's stated direction |
| SC-6 | No on-chain record of an unfunded offer's expiry | Proceeds; the plan's condition is not met as written (below) | Rafa's stated direction |
| SC-7 | No party appeals and no bonds | **Decided by Rafa, 2026-11-11** (D57) | decided |
| SC-8 | No on-chain proof of the randomness beacon | **Open.** Recommended: keep the proof | Rafa |

**The price of SC-7, stated plainly.** Litmus test 3 says "Appeals are backed by the adjudicator's bond". Phase one sets that line aside. A wrong first decision has no remedy on chain: the losing party loses at most the deal's price plus the fee, and its recourse is the signed record and the law (D26). The parties' protection moves to what they choose before they sign: the three adjudicators, the fallback and the default outcome.

**Three places where this ADR differs from the plan it records,** each explained below: the deadline order is strict and covers five deadlines, as `packages/core` already requires; the contract requires the acceptance's `bondReserved` to be zero instead of leaving it unchecked; and refusing a zero price is a new limit that D31 does not already cover.

## Context

- **The contracts are general in ways phase one does not use.** `HoldbackRules.sol` (669 lines) and `HoldbackBonds.sol` (118 lines) take any token, two funding methods, payouts to any address, party appeals with appeal bonds, and adjudicator bonds with an overturn payout [measured].
- **Half of the open contract findings sit in the appeal and bond code** [documented: `docs/audit/known-issues.md` sections 2 to 4]. Both findings that block mainnet are there: a free appeal can win the price from the decider's bond (L-3), and the appeal adjudicator decides with no bond while its decision moves another adjudicator's (L-5). Fixing them needs a minimum appeal bond in the signed terms, a bond for the appeal adjudicator and a schema change, in a contract that is 263 bytes under the size limit [documented: `docs/audit/scope.md`].
- **A cut feature needs no fix, no refactor and no auditor's hour.** Rafa's rule for this work is scope first: a feature stays only if the pilot or the mainnet test uses it, and a cut feature is removed from the code, not disabled by a flag.
- **The signed types describe the full protocol.** `packages/core` signs them and SimChain runs all of them. A phase-one deployment accepts a subset. That is why no cut here changes a signed type or a schema.

## Decision

### 1. What the phase-one contracts do

One contract, `HoldbackRules`, with its library `HoldbackTypes`, the beacon behind `IHoldbackBeacon`, and Commerce Payments' `AuthCaptureEscrow` with its ERC-3009 collector.

| Step | Entry point | Who can make it happen |
| --- | --- | --- |
| Agree and fund | `agreeAndFund` | Anyone relays the seller's signed terms, the primary's acceptance, the buyer's Agree and the buyer's ERC-3009 signature |
| Deliver | `deliver`, or a decision or early accept that carries the delivery | Anyone relays the seller-signed delivery, before `deliverBy` |
| Decide | `decide` | Anyone relays the signed decision of the adjudicator whose turn it is: the primary before `judgeBy`, the fallback before `fallbackBy`, the appeal adjudicator within `appealDecideSec` of an escalation |
| Accept early | `earlyAccept` | Anyone relays the buyer's signed early accept |
| Settle together | `mutualSettle` | Anyone relays a settlement both parties signed; it pays the buyer and the seller only |
| Time out | `reclaim`, `triggerFallback`, `triggerDefault` | Anyone, once the deadline has passed |

A deal ends in one of three stages: `Released`, `Refunded` or `Settled`. Each is final when it is written. Views: `dealOf`, `typedDataHash`, `deliveryHashOf` and the immutables.

Three state-changing entry points leave: `fileAppeal`, `expireAppeal` and `expireOffer`. Eight stay.

### 2. SC-1: one settlement token per deployment

- **What leaves.** Any-token support. The token becomes an immutable address fixed in the constructor (its name is the building task's choice). Every place that reads the token from the call uses the immutable instead: `_paymentInfo` (`HoldbackRules.sol:177`) and each `tokenIdHash(t.token)`.
- **What stays.** The signed terms still name the token three times (`price.token`, `adjudication.fee.token`, `settlement.token`), as the lowercase address (ADR-0025), and the commitment ID still hashes it.
- **The rule.** Terms that name another token never reach `Held` on this deployment. The building task picks one of two ways and tests the rule: keep `token` in the calldata view and revert unless it equals the immutable, or drop it from the calldata view and hash the immutable, so that other terms produce an ID nobody signed. This ADR prefers the second: the token then exists in one place.
- **What a party loses.** The choice of token per deal on one deployment. A second token needs a second deployment. That is a different rules contract and so a different EIP-712 `verifyingContract`: signatures do not cross between the two.
- **Who chooses the token.** Whoever deploys. The deployer has no authority afterwards, anyone may deploy for another token, and the parties accept a deployment's token by signing under its domain. The choice moves from the deal to the deployment; it does not move to an operator.
- **A deployment assumption the contract cannot check.** The token is a plain ERC-20 with ERC-3009: no fee on transfer, no rebasing, no transfer hook. `docs/audit/scope.md` states it. The controls a token issuer holds stay out of scope (residual 1).
- **Signed types and schemas.** None changes. The terms schema lets the three tokens differ; core already requires one token (`packages/core/src/state.ts:200-205`) and the EVM adapter already serves one (`packages/settlement/evm/evm-settlement.ts:1235`) [measured]. An agent that uses the API loses nothing it has today.
- **What it amends.** D42 says "the protocol and the contracts stay token-agnostic". From phase one the protocol stays token-agnostic and each deployment serves one token. Residual 1's mitigation, "the escrow accepts any ERC-20", becomes "anyone can deploy for a token with no freeze".
- **Trigger for bringing it back.** A deal that needs two tokens at once, or the assets module that D42 defers.

### 3. SC-2: ERC-3009 funding only

- **What leaves.** The Permit2 path: the constructor's `permit2Collector` argument, the immutable `PERMIT2_COLLECTOR` and its getter (`:73`), the branch that picks a collector (`:218`), and the `method` field of the `Funding` calldata with its check (`:205`). The deployment no longer deploys a `Permit2PaymentCollector`, and `deploy-sepolia.sh --check` no longer checks Permit2.
- **What stays.** `ERC3009_COLLECTOR`, the funding signature, and Multicall3, which the ERC-3009 collector uses to handle a wallet that is not deployed yet (`ERC3009PaymentCollector.sol:25-28,49`) [measured].
- **What a party loses.** A token without ERC-3009 cannot be a deployment's token: WETH and most ERC-20s. USDC has it. An agent that uses the API loses nothing: the EVM adapter refuses every scheme but `erc3009` today (`evm-settlement.ts:1235-1236`), and the local test world deploys no Permit2 [measured].
- **Contract wallets still fund.** The collector passes the signature as bytes (`ERC3009PaymentCollector.sol:42-49`), so a token whose ERC-3009 accepts a contract's signature funds a multisig with one signature [measured for the collector; the token's side is a test the building task adds].
- **Signed types and schemas.** None changes. `FundingAuthorization.scheme` keeps `permit2` in its enum (`spec/schemas/messages.schema.json:201-206`) for the full protocol. ADR-0025's `cpp-permit2` scheme stays Proposed and unbuilt.
- **Trigger for bringing it back.** A settlement token without ERC-3009.

### 4. SC-3: a mutual settlement pays the buyer and the seller only

- **What leaves.** Payouts to a third address. Today the contract pays one as a capture that is all fee, through the escrow's fee slot (`HoldbackRules.sol:470-475`). That branch, its `captured` counter and the loop's captures leave. The contract reverts with `InvalidMessage` on a payout whose `to` is neither the buyer nor the seller.
- **What stays.** `mutualSettle`; the signed `MutualSettlement` with its `Payout[]`; any split of the price between the buyer and the seller; the fee back to the buyer; the key release in the same transaction. A settlement then makes at most one capture, to the seller, and one void, to the buyer.
- **What a party loses.** A joint exit to another mechanism in one transaction: another escrow, or an outside arbiter. The parties pay themselves first and move the funds after, so one of them holds the money in between. That is the cost D23 named for its option A.
- **Signed types and schemas.** None changes. The schema lets `to` be any address, and the rulebook's `mutualSettlement.payoutsTo` is `parties` or `any` (`spec/schemas/club.schema.json:269-275`). A phase-one deployment behaves as `parties` whatever the rulebook says. A rulebook that says `any` then promises more than the contract does, so the demo club's rulebook moves to `parties` with the new demo world (D49).
- **Events.** `Paid` loses its only emit site (`:474`). See section 10.
- **What it amends.** D23 is deferred for the phase-one contracts. The fifth outcome in `docs/neutrality.md` ("at any split, to any addresses both parties sign") reads "at any split between the buyer and the seller".
- **Trigger for bringing it back.** Parties or a club that need the atomic exit, together with a payout path the escrow's authors designed for it.

### 5. SC-4: contract signers stay (refused by Rafa)

Rafa refused this cut on 2026-11-11: "Keep multisig compatibility and smart-contract ownership. The cost is too high for composability with other protocols." He clarified the same day: "I mean smart-contract operators and multisig adjudicators etc."

- **What stays.** ERC-1271 signatures for every role: a multisig or any contract can be the buyer, the seller or any of the three adjudicators (`_requireSigned`, `HoldbackRules.sol:660-664`). Every entry point stays permissionless and gives the sender no role, so another protocol's contract can relay a step inside its own transaction.
- **What it is not.** An owner over Crow's contracts. The hard rule stands: no owner, pause, freeze, blacklist or upgrade proxy.
- **What keeping them costs,** for the tasks that build and document phase one:
  - tests with a contract wallet in every role, through every entry point; a wallet whose answer changes between two steps of one deal; a wallet that burns the gas it is given; an account with delegated code (EIP-7702). Today's tests cover a contract buyer only [documented by the plan];
  - the threat model (T-340) says what a contract signer can do: its code runs, read-only, inside the signature check; its answer can differ from step to step; each step checks its own signature, so a changed answer blocks that wallet's own next step and no one else's;
  - a wallet that is not deployed yet cannot agree and fund in one call: the buyer's agreement is checked before the funding step deploys the wallet (`:208`, then `:218`). The wallet must exist first;
  - Crow's own operators check plain-key signatures only and cannot follow a step sent through a contract wallet (residual 13). The contract is composable; the operators are not yet. That work (T-227) must land before the mainnet test.
- **What would reopen it.** A finding in those tests that a contract signer can block another party's step.

### 6. SC-5: refuse terms that settlement does not process

`agreeAndFund` refuses three kinds of terms, and `mutualSettle` refuses one kind of settlement.

1. **A zero price.**
   - What leaves: the branches that exist only for a zero price (`:357` and `:412` [measured]; the plan counts three). A zero fee stays allowed.
   - What a party loses: a deal with no price, for example free work judged for a fee.
   - **Correction to the plan.** The plan says this costs nothing because core refuses it today. It does not: the schema allows `"0"` (`spec/schemas/common.schema.json:46`) and no check in `packages/core/src` refuses a zero price [measured by search]. D31 lets the parties choose any amount the encoding can represent, and zero is one. So this refusal is a new limit. It rests on Rafa's direction of 2026-11-11, not on D31, and core must add the same refusal.
2. **Deadlines out of order.**
   - The rule: `offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`, each strictly before the next.
   - **Correction to the plan.** The plan writes `fundBy ≤ deliverBy ≤ judgeBy ≤ fallbackBy`. Core already requires the strict order over all five (`packages/core/src/timing.ts:33,46-49`) [measured]. The contract takes core's rule exactly. Otherwise the contract would accept terms that core refuses, and such a deal falls behind the operators' view (residual 13, the divergence case).
   - What a party loses: nothing through the API or on SimChain, which refuse these terms today. A party that submits straight to the contract loses equal deadlines, which give an adjudicator a window of zero length.
   - What it closes: an escrow expiry that falls before the delivery deadline or before an on-time decision (L-6); a fallback's beacon round that is public before funding (L-8); a delivery after `judgeBy`; a fallback and a default in one block.
3. **`maxSubmissions` other than 1.**
   - What leaves: nothing; the contract already takes one delivery (`:624`). The refusal stops terms that promise a resubmission the contract never honours.
   - What a party loses: nothing. Core's parser refuses it today (`packages/core/src/parse.ts:103`), and `state.ts:287` refuses a second attempt [measured]. The plan cites other lines for this; these are the checks.
4. **A mutual settlement in `Held` that names a delivery or releases a key.** In `Held`, `hasDelivery` must be false.
   - What leaves: the path where a settlement releases the buyer's key from a delivery that never landed on chain (`:435-447`). Core refuses it today (`state.ts:517-518`) [measured].
   - What a party loses: one case. After `deliverBy` with nothing posted, the parties can still settle the money, but the settlement cannot release the key in the same transaction. For late work the key then changes hands off chain, and one party trusts the other. Before `deliverBy` the seller posts `deliver` first, and the settlement then releases the key as today.

- **One funding deadline, settled here.** On the contract, agreeing and funding are one call. That call must land before `offerExpiresAt`, which the order rule puts before `fundBy`. So on EVM settlement an offer funds until `offerExpiresAt`, and `fundBy` only bounds the buyer's ERC-3009 authorization (`:179`). Core and SimChain keep two steps: agree before `offerExpiresAt`, then fund before `fundBy` (`state.ts:240,259`). The contract cannot follow that: it stores nothing before funding, so it cannot tell an agreement made in time from one made after the seller's offer lapsed. The EVM adapter already follows the contract (`packages/settlement/evm/timeouts.ts:111-112`) [measured]. The fix is in the docs and the prepare routes, not in the contract.
- **Signed types and schemas.** None changes. The schema keeps `maxSubmissions` 1 to 3 and a price of `"0"` for the full protocol; a phase-one deployment refuses them and the operator's prepare routes say so before anyone signs.
- **Trigger for bringing them back.** Resubmissions return with `settle_after_window` (ADR-0007). A zero price returns when a party asks for it. Equal deadlines do not return.

### 7. SC-6: no on-chain record of an unfunded offer's expiry

- **What leaves.** `expireOffer` (`:523-530`) and `Stage.Expired`. `Expired` is the last member of the enum, so removing it renumbers no other stage.
- **What stays.** `JobExpired`, which `reclaim` emits (`:539`).
- **What a party loses.** A transaction that records that an offer lapsed unfunded. Nothing depends on that record for safety: after the deadline `agreeAndFund` reverts on its own check (`:203`), and time does not run backwards.
- **Why cut it.** It is a function anyone can call to write storage for any terms, real or invented, and the state it writes guards nothing.
- **The plan's condition is not met as written.** The plan lets this cut proceed "if the adapter does not depend on it". The adapter does [measured]: it sends `expireOffer` (`evm-settlement.ts:1331-1332`, `timeouts.ts:80,112`), reads its `JobExpired` as `offer.expired` (`evm-settlement.ts:309,332,2067-2069,2120-2122`), and the operator's trigger route names it (`apps/operator/src/server.ts:332`).
- **This ADR's verdict: proceed, and move the expiry off chain in the same change.** Before funding nothing about an offer is on chain, so the operators' own record is the only record of an offer either way. The adapter expires an unfunded offer by its clock, and `offer.expired` stops having a transaction behind it. The operators also stop paying gas for each abandoned offer. If that change proves larger than it reads, keeping `expireOffer` costs eight lines and one enum member, and the building task says so before it cuts.
- **Signed types and schemas.** None changes. `escrowState` keeps `Expired` and the event list keeps `offer.expired`; both describe the operators' record.
- **Trigger for bringing it back.** None foreseen.

### 8. SC-7: no party appeals and no bonds (decided by Rafa)

Asked "Should phase one ship without party appeals and bonds (cut SC-7)?", Rafa answered on 2026-11-11: **"Yes, cut them"** (D57).

**The first decision by the primary or the fallback adjudicator is final on chain.**

- **What leaves `HoldbackRules.sol`:**
  - functions: `fileAppeal` (`:503-518`), `expireAppeal` (`:573-592`), `_appealDecision` (`:365-380`), `_releaseBonds` (`:655-658`) and every call to it;
  - the branch of `decide` that takes an appeal decision on a `Released` or `Refunded` deal (`:266-269`);
  - the bond calls: `BONDS.encumber` at funding (`:215`) and at the fallback's decision (`:327`); the immutable `BONDS` and the vault's creation in the constructor (`:74`, `:146`);
  - storage: `Deal.appeal`, `Deal.flags` and `Deal.t2`; the enum `AppealState`; the constants `F_PRIMARY`, `F_FALLBACK`, `F_BY_FALLBACK` and `KEY_APPEAL`;
  - the error `WrongAppealState`;
  - events: `AppealFiled` and `AppealClosed` (section 10).
- **What leaves `HoldbackTypes.sol`:** the `Appeal` calldata struct, `APPEAL_TYPEHASH` and `appealHash`. `Money.requirement` loses its only caller (`:215`).
- **What leaves entirely: `HoldbackBonds.sol`.**
  - functions: `deposit`, `withdraw`, `freeOf`, `encumber`, `release`, `slash`, `takeAppealBond`, `payAppealBond`;
  - storage: `RULES`, `bondOf`, `encumberedOf`, `appealBondOf`;
  - errors: `NotRules`, `InsufficientFreeBond`, `AppealBondTooLarge`, `AppealBondExists`;
  - its seven events (section 10).
- **What stays.**
  - `decide` for the primary in `Delivered`, the fallback in `FallbackJudging`, and the appeal adjudicator in `Escalated`;
  - escalation: a primary or a fallback may still sign `escalate`; no money moves, and the appeal adjudicator decides;
  - `triggerDefault` for a silent fallback and for a silent appeal adjudicator after an escalation: the price and the fee go back to the buyer;
  - `timing.appealDecideSec`, enforced twice: the deadline of an escalation's decision (`:264`, `:563`) and the escrow's expiry (`:169`);
  - the deal's word keeps the stage, the delivery attempt, the escalation time and the seed tag. `dealOf` returns a smaller struct, which is a change to the contract's ABI and not to any signed type.
- **What it closes.** Eight open findings stop applying: L-3, L-5, T-221's bond refusal, the rest of I-8, A-1, A-2, A-3 and the limit on H-2. L-2 goes too, because the vault was the only place that credited a nominal amount. The task that owns `docs/audit/known-issues.md` moves them under "not in phase one"; T-342's Handoff gives the wording.

#### The open points of this cut, settled

1. **The appeal adjudicator stays, for escalations only.** It hears no party appeal. It decides a case that the primary or the fallback escalated, within `appealDecideSec`, under a seed from the beacon round after the escalation, and its decision is final. It posts no bond, as today (L-5). It keeps its name: the terms' field `appealAdjudicator` and the decision's role string `"appeal"` are in signed types, and renaming either would change them. The docs say "the appeal adjudicator, which in phase one hears escalations only".
2. **The acceptance's signed `bondReserved` must be zero.**
   - **The plan's claim, tested.** The plan recommends that the contract stops checking the field, and says this changes no signed type. The claim holds [measured]: `ACCEPTANCE_TYPEHASH` (`HoldbackTypes.sol:188-193`) keeps `TokenAmount bondReserved`, and `acceptanceHash` (`:296-312`) hashes whatever value the call carries. Only the comparison at `HoldbackRules.sol:205` is in question.
   - **Why this ADR does not leave it unchecked.** An unchecked field lets a funded deal carry an adjudicator's signed statement that it reserved the price, on a deployment where no bond can exist. A party may believe it, and the record is the parties' evidence (D26). Unchecked also opens a gap between the contract and core: core refuses an acceptance whose `bondReserved` is below the price (`packages/core/src/state.ts:223-231`) [measured], so a deal funded directly with another value would fall behind the operators' view.
   - **The rule.** `agreeAndFund` reverts unless `bondReserved` is 0. The comparison changes from "below the price" to "not zero", which costs no bytes. Every funded phase-one deal then carries an acceptance that says what is true: nothing is reserved. The schema allows `"0"` (`common.schema.json:46`), so no schema changes.
   - **The mirror.** On a phase-one deployment core requires zero and reads no free bond; the reference adjudicator signs zero (it signs the price today, `apps/adjudicator/src/service.ts:242`); the EVM adapter stops reading the vault (`evm-settlement.ts:974-991`). SimChain keeps the full rule.
   - **Not chosen.** Leave it unchecked (the plan's recommendation): simplest contract, and the two costs above. Keep today's check: an enforced statement that is false. Drop the field from the signed type: a new domain version and new hash vectors, and it would cut the field from the full protocol too.
3. **`timing.appealWindowSec` joins the fields that are signed and not enforced.** The plan does not list this one. With no party appeal the contract never reads it. The schema requires it to be at least 1 (`spec/schemas/commitment.schema.json:307-314`), so the contract cannot require zero without a schema change. Until a schema version allows zero, the terms of a phase-one deal state an appeal window that the contract does not honour, and the docs and the prepare routes must say so. **Recommended for the next schema version, whenever one comes for another reason:** allow 0, and have the phase-one contract refuse any other value, as it refuses `maxSubmissions` above 1. The signed-field register (T-340) records it until then.
4. **The docs that promise appeals or bonds** are listed in the appendix, each with the sentence to change, for a later docs package. They say "not in phase one" from the redeploy on, not before: the deployed contracts still have both.
5. **SimChain keeps appeals and bonds, as the full protocol's reference.**
   - The fixtures that use a cut feature move to the SimChain-only list, `LOCAL_EXCLUSIONS` in `packages/testkit/src/runner.ts:62-70`, each with the reason "not in phase one". The list has three entries today [measured].
   - Fixtures with a party `appeal` step: `honest-seller-survives-judge-noise-on-appeal` (already listed) and `error.early-accept-wrong-key-envelope`. The building task checks `error.appeal-decision-other-attempt` by its steps.
   - Fixtures that test the bond gate: `attack.adjudicator-self-dealing` and `error.coverage-exceeded`.
   - Fixtures whose default pays the seller from a bond: the two already listed, and the building task checks `attack.forced-stride-appeal-default`, `attack.injection-filter-abstain-appeal-default`, `attack.injection-splits-appeal-to-default` and `neutrality.store-withholds-reference`.
   - Fixtures that only escalate to the appeal adjudicator stay in the comparison: escalation stays.
   - **One thing the comparison still needs.** SimChain posts a bond reservation in every deal and closes an appeal window after every decision; the phase-one contract does neither. The building task either gives SimChain a named phase-one profile that turns both off for the comparison, or lists both as allowed differences once. This ADR prefers the profile: the comparison then stays a comparison of whole transcripts.
6. **The operators' refusal of an unbonded fallback leaves the EVM path.** ADR-0030 has an operator refuse to relay terms whose fallback has less free bond than the price. With no vault there is nothing to read. The served `observed.bond` of an adjudicator reads `none` on a phase-one deployment.
7. **The API reports a first decision as final at once.** On a phase-one deployment `finalAt` is the decision's time and no appeal window follows, as for an escalation's decision today. `spec/schemas/commitment-state.schema.json` needs no change: `appealState` reads `none`.

### 9. SC-8: the on-chain proof of the beacon (open, Rafa's call)

The cut would remove `DrandQuicknetBeacon.sol` (175 lines of pairing code) and the contract's dependency on the BLS precompiles (EIP-2537). Fallback and escalation decisions would carry a beacon value that the contract does not prove; the parties would check the drand proof off chain.

| Option | What the contract checks | Effect |
| --- | --- | --- |
| A. Keep the proof (recommended) | The round, fixed by state; the round's value, by BLS; the seed derived from it (`HoldbackRules.sol:290-297`) | A fallback or appeal adjudicator cannot choose its panel. The chain must have EIP-2537. The verifier is 175 lines an auditor must read, with open hardening items (T-225) |
| B. Keep the round and the seed derivation, drop the proof | The round and the derivation; the value is the decider's word | A false value is provable off chain from the signed decision, and attributable. The decision still settles |
| C. Remove the beacon from the contract | Nothing about the seed of a fallback or an escalation | The decider picks its seed, and so its panel, after reading the work |

**Recommendation: A for now, decided together with the choice of chain.**

- **SC-7 raises the price of this cut.** Before SC-7, an adjudicator that shopped for a panel still faced an appeal and its bond. In phase one the first decision is final. The on-chain proof is then the only thing on chain that stops a fallback, or the appeal adjudicator after an escalation, from choosing the panel that gives the outcome it wants (threat T21 in `docs/judgment-and-defenses.md`). Options B and C leave that to evidence after the fact.
- **It is the part of litmus test 3 that the contract enforces.** "Selected by commit-reveal" holds on chain for the primary through its seed commitment and for the others through the beacon. Phase one already sets one line of that test aside; this ADR does not recommend a second.
- **The cost of keeping it is known:** the hardening items wait for the redeploy (the fallback's round is the first at or after `judgeBy`; a margin of one block for an escalation's round), and each candidate chain must be checked for EIP-2537 (ADR-0018).
- **What would change the recommendation:** a chosen chain without EIP-2537, or an audit quote in which the verifier is a large share of the cost.

### 10. Events

Rafa's rule is that events are never removed. Asked on 2026-11-11 "Where a cut removes a feature, may its events go with it?", he answered **"Agree"**. This is the one exception, and it covers only the events of a feature he has cut.

| Event | Where | Phase one |
| --- | --- | --- |
| `BondDeposited`, `BondWithdrawn`, `BondEncumbered`, `BondReleased`, `AppealBondHeld`, `AppealBondPaid`, `BondSlashed` | `HoldbackBonds.sol:30-38` | Leave with the vault (SC-7): the contract no longer exists |
| `AppealFiled`, `AppealClosed` | `HoldbackRules.sol:117-118` | Leave with the appeal paths (SC-7) |
| `Paid` | `HoldbackRules.sol:104` | **Stays declared, with no emitter,** until Rafa confirms SC-3. His answer covers a feature he has cut; SC-3 proceeds on his direction, not on his answer. Recommended: it leaves with SC-3 |
| `JobExpired` | `HoldbackRules.sol:98` | Stays. `reclaim` still emits it; `expireOffer` no longer does (SC-6) |
| `KeyReleased` | `HoldbackRules.sol:114` | Stays. Its `path` value 3 (`KEY_APPEAL`) is never emitted |
| `JobCreated`, `JobFunded`, `JobSubmitted`, `JobCompleted`, `JobRejected`, `PaymentReleased`, `Refunded`, `FeePaid`, `Decided`, `FallbackTriggered`, `Defaulted`, `MutuallySettled` | `HoldbackRules.sol:91-119` | Stay, unchanged |

Each removal goes on the list of allowed differences of the side-by-side run that compares the old and the new contracts, and into the events inventory (`docs/audit/events.md`, T-338).

## Signed types and schemas

**No cut changes an EIP-712 type, the domain version (0.7) or a file in `spec/schemas/` (v0.10).** A phase-one deployment accepts a subset of what the types can say, and the redeploy changes the domain's `verifyingContract`, as every redeploy does.

| What the types and schemas still allow | What a phase-one deployment does |
| --- | --- |
| Three token fields that may differ; any token (`commitment.schema.json`) | Refuses terms whose token is not the deployment's (SC-1) |
| `FundingAuthorization.scheme` of `permit2` | Takes ERC-3009 only (SC-2) |
| A `Payout` to any address; `payoutsTo: any` in a rulebook | Refuses a payout to anyone but the buyer or the seller (SC-3) |
| A price of `"0"`; `maxSubmissions` 1 to 3 | Refuses both (SC-5) |
| The `Appeal` message (`appeal.schema.json`); the appeal states and events; `appealGround` | Takes no appeal. The contract has no entry point for one (SC-7) |
| `AdjudicatorAcceptance.bondReserved`, any amount | Requires 0 (SC-7) |
| `timing.appealWindowSec`, at least 1 | Signed, not read (SC-7) |
| The bond events and `BondMovement` (`event.schema.json`) | Never produced |

**If Rafa or a later task wants the types to say only what phase one does,** that is a schema change with an ADR and a version bump, and a new domain version where a signed struct changes. Three candidates, none adopted here: allow `appealWindowSec` 0 (recommended above for the next version); drop `bondReserved` from the acceptance; narrow `maxSubmissions` to 1.

## Litmus tests

### Each cut against the three tests

| Cut | 1. Neutrality | 2. The hold | 3. Defended judgment |
| --- | --- | --- | --- |
| SC-1 | Passes. The deployer names the token and has no authority after; the parties accept it by signing under that deployment | Passes, and narrows what the hold assumes about its token to one named token | Unaffected |
| SC-2 | Passes. Anyone still relays the buyer's funding signature | Passes. One collector fewer between the buyer and the hold | Unaffected |
| SC-3 | Passes. A settlement needed both signatures before and needs them now. The fifth outcome narrows to the two parties | Passes. The escrow's fee slot stops carrying payouts it was not designed for | Unaffected |
| SC-4 refused | Passes, with a duty: tests must show that a contract signer's changing answer blocks only its own step | Passes | Unaffected |
| SC-5 | Passes. Every refusal comes before funds are held. Strained in one case: a late-work settlement loses its atomic key release | Passes. The escrow's expiry can no longer fall before a deadline it must outlast | Unaffected |
| SC-6 | Passes. No held funds are involved | Passes | Unaffected |
| SC-7 | Passes in form: the terms name the decider, and its decision is the outcome the terms define. Weaker in substance: residual 3, collusion, loses two of its four bounds | Passes. No contract holds a bond or an appeal bond, and a deal settles once | **Sets one line aside:** "Appeals are backed by the adjudicator's bond" |
| SC-8 if taken | Passes | Passes | Strains a second line: "selected by commit-reveal" would hold on chain for the primary only |

### SC-7 and litmus test 3

**Phase one sets aside the line "Appeals are backed by the adjudicator's bond".** The contracts have no party appeal and no bond. The other three lines stand: deterministic checks first, a panel of pinned models from at least two families selected by commit-reveal, and the panel's defenses.

**The protocol's second property is also deferred on chain.** "Any capital holder can join the bonding" has nothing to join in phase one. It stays the protocol's design and SimChain's behaviour.

**What protects a party instead:**

- **The parties choose the three adjudicators** in the terms they both sign. No one assigns them. A party that does not trust an adjudicator does not sign.
- **The fallback and the default outcome.** A silent primary is replaced. If no adjudicator decides, anyone triggers the default and the buyer gets the price and the fee back.
- **Escalation.** An adjudicator that cannot decide passes the case to the appeal adjudicator instead of guessing.
- **The defenses in front of the decision** are unchanged: deterministic checks, the screen, a panel across model families, the primary's seed commitment and the beacon for the others.
- **Two exits that need no adjudicator:** the buyer's early accept, and a settlement both parties sign, at any time before a decision.
- **The signed record.** The terms, the delivery, the acceptance and the decision with its judgment record hash and seed are signed and attributable. They are the evidence a party takes to the adjudicator's owner, a club or a court.
- **The law** (D26, residual 5). Owners and controllers of agents can be compelled. The protocol bounds the loss and keeps the record; it does not replace recourse.

**What a wrong first decision costs, with no remedy on chain:**

| The wrong decision | Buyer | Seller | Bound |
| --- | --- | --- | --- |
| A wrong accept | Pays the price and the fee for work that fails the terms | Is paid | The buyer loses at most the price plus the fee |
| A wrong reject | Gets the price back, pays the fee, gets no key | Is not paid for work that met the terms; keeps the work, unless the adjudicator leaks it (residual 6) | The seller loses at most the price |
| An accept whose key does not decrypt the work (threat T19) | Pays the price and the fee and cannot read the work | Is paid | The buyer loses at most the price plus the fee. The full protocol answers this with an appeal that carries the key; phase one has none. The decision carries the sealed key, so the fault is the adjudicator's and provable |
| A default after every adjudicator stays silent | Gets the price and the fee back | Is not paid for delivered work; no bond compensates it (it never did on chain: finding I-8) | The seller loses at most the price |

Nobody is paid from a bond in any row. The deployed contracts pay an overturned decision's price from the first decider's bond (D43); phase one does not. **The loss is always bounded by one deal's price and fee,** and a party that wants a smaller bound signs smaller deals.

**What gets weaker, named.** Residual 3 (collusion) is bounded today by commit-reveal selection, panels across families, an appeal to another adjudicator, and the bond. Phase one keeps the first two. ADR-0007 names the 100% bond rule as what bounds an adjudicator that accepts everything for sellers it controls (threat T18); phase one has no such bound, and a buyer's only defence is to refuse terms that name an adjudicator it does not know. Residual 8 (a cheaper model under a pinned name) loses its bond and its appeal the same way.

## What waits on Rafa

1. **The sentence in `CLAUDE.md`,** a tier-3 file. Proposed wording for the last line of litmus test 3:
   > Appeals are backed by the adjudicator's bond. Phase one sets this line aside: its contracts have no party appeals and no bonds, and the first decision by the primary or the fallback adjudicator is final on chain (Rafa, 2026-11-11; D57, ADR-0031). SimChain keeps both.

   And for protocol property 2, one added sentence: "Phase one has no bonds on chain (D57); the bonding returns with them."
2. **SC-8:** keep the on-chain beacon proof, as recommended, or cut it.
3. **`Paid`:** may it leave with SC-3, as recommended?
4. **Three points where this ADR goes past the plan:** `bondReserved` must be zero; the strict five-deadline order; the zero-price refusal as a new limit under D31. Each proceeds unless he stops it.
5. **SC-6's failed condition:** proceed by moving the offer's expiry off chain, as recommended, or keep `expireOffer`.
6. **Whether an outside reviewer reads this ADR** before the cuts are built.

## Red-team findings and answers

Pending: one red-team pass attacks the cuts with `CLAUDE.md`, the litmus tests and `docs/neutrality.md`, without this ADR's reasoning. Its findings and this ADR's answers go here before the PR lands.

## Alternatives considered

- **Keep the general contracts and fix every finding.** Three new mechanisms and a schema change for the appeal bonds alone, in a contract at the size limit, and every line of it in the audit. Rafa's standard chooses the smaller contract.
- **Disable the cut features behind a flag.** The code stays, and so does every finding in it. A flag someone can flip is also an admin control, which the hard rules forbid.
- **Cut appeals and keep bonds.** A bond with no appeal has nothing to pay: on chain a bond moves only when an appeal overturns a decision. The vault would hold money to no purpose.
- **Keep appeals and cut bonds.** An appeal that cannot make the wronged party whole only delays finality; the money moved at the first decision (ADR-0007, guaranteed mode).
- **Change the signed types to match phase one.** A new domain version, a new schema version and new hash vectors, to describe a smaller protocol than the one SimChain runs. The types describe the full protocol; a deployment enforces a subset.

## Consequences

- **The contract an auditor reads is smaller:** one file gone, three entry points gone, the appeal state and the bond flags gone. The plan estimates about 250 of 1,463 lines [guessed there].
- **The off-chain code needs a phase-one profile.** Core, the EVM adapter, the operator's prepare routes and the reference adjudicator must refuse what the contract refuses and accept what it accepts: the token, ERC-3009, payouts to the parties, a non-zero price, `bondReserved` 0, no appeal, an offer that expires by the clock. SimChain keeps the full protocol.
- **The live demo loses its appeal beat** until appeals return, and the site's appeal examples come down with the redeploy.
- **Appeals and bonds return together,** with the fixes their findings need: a minimum appeal bond in the signed terms, a bond for the appeal adjudicator, and a refusal of terms the bonds cannot pay. That is a later phase with its own ADR and a schema version.
- **A redeploy is Rafa's.** It makes a new demo world (D49) and a new EIP-712 `verifyingContract`.

## Appendix: the docs that promise what phase one cuts

For a later docs package. Lines are those of commit `26d4670` [measured by a search this task ran; this task spot-checked `docs/neutrality.md`, `docs/audit/scope.md` and `docs/audit/known-issues.md` against its own read]. The docs change at the redeploy, not before: until then the deployed contracts still have appeals and bonds. Records of what happened (`docs/decisions/`, `docs/decisions-today.md`, `docs/tasks/`, `docs/reviews/`, `docs/research/`) do not change.

**The rule for every row:** where a page describes the full protocol, it keeps the text and adds "not in the phase-one contracts; SimChain only". Where it tells an agent what to do against the live deployment, the text goes.

| File | Lines | What it says now | What it says from the redeploy |
| --- | --- | --- | --- |
| `README.md` | 65, 71 | "Each adjudicator posts its own bond … The contract holds bonds today. An overturn pays the wronged party from the decider's bond"; "The adjudicator's bond backs appeals." | Phase one has no bonds and no party appeals; the first decision is final. Link this ADR |
| `README.md` | 79, 91, 99, 122 | Fixtures excluded for bond rules; the overturn payout; gas "its appeal expiry included"; `HoldbackBonds` in the contract list | Name the phase-one exclusions; drop the overturn line; restate gas without an appeal expiry; drop `HoldbackBonds` |
| `SECURITY.md` | 28 | Lists Permit2 among contracts reused unchanged | Drop Permit2 |
| `site/llms.txt` | 53, 300-310, 403 | Judging windows include "appeal"; `appealWindowSec` in examples; "final about a minute after the decision"; `finalAt` "stays `null` until the appeal window closes" | `appealWindowSec` is signed and not read; a decision is final at once |
| `site/llms.txt` | 535-536, 541, 667-668 | "**Appeal** … `POST /v1/prepare/appeal` …"; "On Sepolia, an appeal needs your own test ETH"; "the appeal expiry"; the two appeal routes | Remove the appeal section and routes for the live deployment; say there is no party appeal |
| `site/llms.txt` | 231, 552, 557, 559, 649 | "an appeal that overturns its decision pays the price from its bond"; "**Bond.** Deposit your bond in HoldbackBonds …"; "an overturn pays the price from your bond"; "its bond is not yet at stake on chain" | No bond exists; an adjudicator registers without one. Say what a wrong decision costs and that the record is the recourse |
| `site/llms.txt` | 534, 595-596 | `payouts` to any `to` | Payouts name the buyer or the seller only |
| `site/llms.txt` | 545 | Trigger kinds include `expire-offer` and `appeal-expiry` | Drop both for the live deployment |
| `site/llms.txt` | 594, 601 | The `Appeal` type; `bondReserved` in `AdjudicatorAcceptance` | Keep the types; say the deployment takes no `Appeal` and requires `bondReserved` 0 |
| `site/index.html` | 243, 245-255, 263, 288-293, 310 | "compensated from the adjudicators' bonds"; the appeal vignette ("the bond pays me 25000000 tUSDC"); "bonded"; "what would an appeal cost?"; the `appeal` tab | Remove the appeal vignette and its tab; drop "bonded" and the compensation line |
| `site/visualdemo/index.html` | 93, 122, 160-162, 186-188 | "bonded adjudicator"; "reserves 25 tUSD of its bond: it pays if it is overturned on appeal"; "The 60-second appeal window closes … the arbitrator's bond is free again" | The arbitrator accepts the case; the deal is final at the decision |
| `site/walkthrough.mjs`, `site/try.mjs` | walkthrough 272-295; try 337-342, 463-464, 549-551, 836-859, 1500, 2111, and 31-35, 50, 71, 99 | Appeal steps and copy ("final at … when the 60 s appeal window closes"); the pinned `permit2Collector` and `bonds` addresses and the `HoldbackBonds` ABI | Remove the appeal intent; report finality at the decision; drop the Permit2 and bond pins |
| `docs/api.md` | 97, 100, 102, 115, 250-253, 262-263, 267, 346 | The `appeal` prepare kind and route; "**Appeals.** The party a first-instance decision went against may appeal it … An overturn pays the wronged party the price from the first decider's bond"; "**`Released` is paid, not final**" | Mark the appeal API "not in phase one; SimChain only"; `Released` is final |
| `docs/api.md` | 225, 234-236, 351 | "an overturned decision is made good from the adjudicator's bond"; the rows "Appeal upheld", "Appeal overturned", "Every adjudicator silent … bonds pay the compensation" | No bond pays in phase one; a default refunds the buyer only |
| `docs/api.md` | 272, 351 | "**Expired offers.** … until someone calls `…/triggers/expire-offer`; until then the primary adjudicator's reserved bond stays encumbered" | An unfunded offer expires by the operators' clock; nothing is reserved |
| `docs/api.md` | 339, 366-368, 373-377 | "reserved bond"; "The bond is deposited on chain"; "**The bond.** Deposit it in `HoldbackBonds`"; "**Bonds and selection.** … A node refuses to prepare or relay an offer … whose fallback adjudicator has less free bond than the price" | `bondReserved` is 0; no deposit; no bond refusal; `observed.bond` reads `none` |
| `docs/api.md` | 98, 121, 347 | "`payouts` … to any addresses both sign for" | To the buyer and the seller only |
| `docs/api.md` | 342 | "Funding authorization (ERC-3009 or Permit2 style)" | ERC-3009 |
| `docs/neutrality.md` | 17 | "a settlement both parties co-signed, at any split, to any addresses both parties sign (ADR-0019, D23)" | "at any split between the buyer and the seller" |
| `docs/neutrality.md` | 25, 26 | "refuse to relay terms whose fallback has less free bond than the price (ADR-0030)" and its named test; the rules contract can "move bonds" | Drop both |
| `docs/neutrality.md` | 27, 28, 34 | The adjudicator "posts a bond"; cannot "avoid paying when an appeal overturns its decision"; "the defaulting adjudicators' bonds compensate the seller"; the appeal adjudicator row's party-appeal half and "the appeal adjudicator's bond compensates the seller"; the buyer can "appeal with a bond" | The adjudicator decides once and finally; a default refunds the buyer; the appeal adjudicator hears escalations only; the buyer cannot appeal |
| `docs/neutrality.md` | 41 | "Mitigation: the escrow accepts any ERC-20" | "anyone can deploy for a token with no freeze" |
| `docs/neutrality.md` | 43, 46, 47, 48 | Residual 3 "bounded by … appeals to a different adjudicator, and the bond … the binding limit is the 100% coverage rule"; residual 6; residual 7 "moves the primary's bond … bounded by its own bond"; residual 8 "Bounded by the bond, appeals and calibration" | Restate each bound for phase one: commit-reveal, panels across families, the parties' choice, the record and the law. Residual 7 becomes "the first decision is final" |
| `docs/neutrality.md` | 60 | "or the first decision standing when an appeal goes unheard" | Drop the clause |
| `docs/neutrality.md` | 85-89 | Four checklist lines about bonds | Drop the bond halves |
| `docs/architecture.md` | 18, 42, 44, 63, 156, 325 | "Adjudicators (permissionless, bonded)"; the contract "also holds bonds"; an adjudicator "posts a bond" | Not bonded in phase one |
| `docs/architecture.md` | 48, 268 | "The deal's token is any ERC-20 the parties name …; ERC-3009 tokens fund with one signature, others through Permit2" | One token per deployment, funded by ERC-3009 |
| `docs/architecture.md` | 68, 104-118, 133, 137, 167, 199, 205, 211 | The appeal state and its diagram; "An overturn moves bond money, not escrow money"; the appeal row of the interface table; "the adjudicator's bond pays the wronged party the price"; `finalAt` "once `appealBy` passes"; "finality with indemnity" | Mark the whole appeal state "not in the phase-one contracts; SimChain only"; a first decision is final at once |
| `docs/architecture.md` | 75-80, 95, 125 | "bond reserved" at acceptance and funding; the `Expired` transitions; "Defaulted → Refunded … (seller compensated from bonds)"; "unencumbered bond ≥ price" | No reservation; an offer expires off chain; a default refunds the buyer only |
| `docs/architecture.md` | 102, 227, 335 | "A co-signed `MutualSettlement` pays any split of the price … to any addresses both sign for" | Between the buyer and the seller |
| `docs/architecture.md` | 150 | "A missing or wrong key is an appeal ground, and an appeal decision may carry `K` to the buyer." | No appeal carries the key in phase one; say what the buyer holds instead: the signed decision |
| `docs/architecture.md` | 217, 228-235, 243-246, 324, 327-328, 341 | The bond pool, its postings, the coverage rule, and the glossary's Appeal, Bond, Coverage ratio and Backer | Keep as the full protocol; mark "SimChain only in phase one" |
| `docs/architecture.md` | 280, 283 | The deadline order ends "`< appealBy < appealDecideBy`"; "appeal window 300 s" | The order ends at `fallbackBy`; `appealDecideSec` times an escalation |
| `docs/judgment-and-defenses.md` | 10, 38, 39, 66, 82 | "a defended, bonded panel"; the party-appeal rules (D27c) and "the appellant's bond is returned"; "would pay an injecting seller from the appeal bond" | Keep the escalation rules; mark the party-appeal rules "SimChain only" |
| `docs/judgment-and-defenses.md` | 106, 109, 110 | T14 "defaults compensated from the bond"; T18 "100% bond coverage … appeals to a different adjudicator"; T19 "a bonded appeal ground; an appeal decision may carry the key" | State that phase one has no on-chain defense for T14, T18 and T19 beyond the parties' choice and the record |
| `docs/judgment-and-defenses.md` | 159-164 | The fee formula's bond terms | Mark as the full protocol's |
| `docs/quickstart.md` | 7, 22, 128, 139, 143, 145, 147, 149, 181 | "An appeal costs a bond of 5% of the price plus a 25 tUSD fee."; "may still appeal until `deadlines.appealBy`"; "**Before you appeal…**"; the bond reserved until `expire-offer` | Remove the appeal steps for the live deployment; a decision is final |
| `docs/demo.md` | 9, 35-36, 48, 51, 55, 57 | "a bonded multi-model panel"; "Bench A accepts and reserves bond"; "if it wins, Bench A's $2,000 bond pays"; the beat "Wrongful decision, paid by the bond" | The demo on phase-one contracts has no appeal beat and no bond |
| `docs/PRD.md` | 34, 45, 67, 113, 114, 180 | "post a bond"; "Any capital holder can join the bonding"; G5 "Capital behind judgment"; FR-16 and FR-17 | Keep as product requirements; mark each "deferred past phase one (ADR-0031)" |
| `docs/operations.md` | 107, 213, 301, 310, 400-415 | "bonds each demo adjudicator (25,000 tUSDC …)"; timeouts that include "the appeal expiry and an accepted offer's expiry"; `observed.bond: "bonded"`; the deploy record's bond vault and Permit2 collector | The new world bonds no one; two timeouts go; the deploy record lists one collector and no vault |
| `docs/plan.md` | 65, 80-81, 88, 153-161, 170-171, 179, 181 | Task and fixture rows that name bonds, appeals and Permit2 | Mark the fixtures that move to the SimChain-only list |
| `docs/testing.md` | 135 | "`appeal.filed`" among the deepest event kinds | SimChain only |
| `docs/audit/scope.md` | throughout | The bond vault, Permit2, "the parties choose the token" | Done in this PR as "after the redeploy"; the tables change at the freeze (T-338 and the freeze task) |
| `docs/audit/known-issues.md` | 17, 19, 22-24, 37-47, 54, 64-66, 85, 104 | Rows whose finding or bound names a bond or an appeal | T-338 owns the file; T-342's Handoff lists the rows and the wording |
| `contracts/README.md` | 21, 78 | The `lib/permit2` build step; `HoldbackBonds` among six ABIs | Drop both when the code goes |
| `formal/README.md` | 35-37, 43, 54, 58, 61-62, 70, 96-104 | The appeal states, `FileAppeal`, `DecideAppeal`, `ExpireAppeal`, the bond debits, `Expire` for `expire_offer` | The task that owns `formal/` brings the model level with the phase-one state model, or keeps the full model and marks it |
| `CLAUDE.md` | litmus test 3; property 2 | "Appeals are backed by the adjudicator's bond."; "Any capital holder can join the bonding." | Rafa's edit; the proposed wording is under "What waits on Rafa" |
