# ADR-0031: The phase-one contract scope

- **Status:** Proposed, 2026-11-11. Rafa decided most of its lines the same day. Before it first merged (D57): phase one ships without party appeals and bonds (SC-7), contract signers stay (SC-4 is refused), the on-chain beacon proof stays for now (SC-8 is not cut), the settlement for late work stays (SC-5b is not cut), and a cut feature's events leave with it. After it merged (D58): the unfunded offer's expiry moves off chain (SC-6), a zero price stays allowed, the two stricter rules are agreed, and third-party payouts are cut for phase one with a planned return (SC-3). He also added one thing to phase one: a payout address for the seller and a payment address for the buyer, each apart from the address that signs (section 11), which need their own ADR and a schema version. SC-1 and SC-2 follow his stated direction and proceed unless he stops one. No scope point is open. Rafa may overrule any line.
- **Date:** 2026-11-11
- **Raised by:** T-342, package R1 of the contract refinement plan (kept privately, `docs/private-materials.md`), from Rafa's standard for the contracts on 2026-11-11: "it's better to have a limited scope for an initial phase of the product than perfectly complete and universal design contracts that open up to risks."
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0003 (the escrow base), ADR-0006 (defended judgment), ADR-0007 (bonded adjudicators), ADR-0016 (the acceptance and the state machine), ADR-0018 (the beacon), ADR-0019 (mutual settlement), ADR-0025 and ADR-0026 (funding), ADR-0029 (delivery binding), ADR-0030 (adjudicator registration); D23, D26, D28, D31, D32, D38, D42, D43, D54.
- **Changes (when built, by later tasks):** `contracts/src/`, their tests and the deploy scripts; the off-chain mirrors in `packages/core`, `packages/settlement/evm`, `apps/operator` and `apps/adjudicator`; the list of SimChain-only fixtures in `packages/testkit/src/runner.ts`. **No cut changes a signed type or a file in `spec/schemas/`.** One addition does, the seller's payout address and the buyer's payment address (section 11), and it gets its own ADR and schema version. This ADR itself changes no code.
- **Amends, for the phase-one contracts only:** ADR-0007 (bonds and the overturn payout), ADR-0016 §1 (funding gated on reserved bond) and §2 (the appeal state), ADR-0006 (tier 3, the party appeal), ADR-0019's D23 amendment (payouts to any address), D38 and D42 (any token per deal), D43 (the overturn payout on chain), ADR-0030 (the operators' refusal of an unbonded fallback). Each stays the full protocol's design, and SimChain keeps it.

Labels: **measured** (read at the cited line by this task, or by the search this task ran, at commit `26d4670`, where `contracts/src` equals the deployed commit `64be1f1`: `git diff --quiet 64be1f1 HEAD -- contracts/src` exits 0), **documented** (stated in the cited doc), **inferred** (from reading, not from a run), **guessed**. Nothing was run. Line numbers are those of `26d4670`; the contract clean-up (T-334) moves them.

## Summary

**Phase one is an escrow with a neutral decider, and nothing else.** It is the next deployment of the contracts: the one an external audit reads and a first pilot uses, on a testnet. One token per deployment. The buyer funds a hold with one ERC-3009 signature. The seller delivers. The primary adjudicator decides, or the fallback does when the primary is late; either may escalate to the appeal adjudicator. The buyer may accept early, both parties may settle between themselves, and anyone may trigger a timeout. The first decision is final.

**What phase one cuts on purpose:**

| # | Cut | State | Whose call |
| --- | --- | --- | --- |
| SC-1 | One settlement token per deployment | Proceeds | Rafa's stated direction; he may stop it |
| SC-2 | ERC-3009 funding only | Proceeds | same |
| SC-3 | A mutual settlement pays the buyer and the seller only | **Cut for phase one** (Rafa, 2026-11-11), with a planned return through a receivable address in the terms. D23 is deferred | decided |
| SC-4 | Signatures from plain keys only | **Refused by Rafa, 2026-11-11.** Contract signers stay | decided |
| SC-5 | Refuse terms that settlement does not process | Proceeds for deadlines out of order, `maxSubmissions` other than 1 and a zero escalation window. **A zero price stays allowed** (Rafa, 2026-11-11) | Rafa's stated direction; the zero price decided |
| SC-5b | A settlement in `Held` cannot name a delivery or release a key | **Not cut: the settlement for late work stays** (Rafa, 2026-11-11). Core changes to allow it | decided |
| SC-6 | No on-chain record of an unfunded offer's expiry | **Goes ahead, off chain** (Rafa, 2026-11-11). The operators send no transaction | decided |
| SC-7 | No party appeals and no bonds | **Decided by Rafa, 2026-11-11** (D57) | decided |
| SC-8 | No on-chain proof of the randomness beacon | **Not cut: the proof stays for now** (Rafa, 2026-11-11). Revisit with the choice of chain | decided |

**One addition, decided in principle by Rafa:** the signed terms name a payout address for the seller and a payment address for the buyer, each apart from the address that signs (section 11). Unlike every cut, it changes a signed type, so its own ADR and a schema version follow.

**The price of SC-7, stated plainly.** Litmus test 3 says "Appeals are backed by the adjudicator's bond". Phase one sets that line aside. A wrong first decision has no remedy on chain: the losing party loses at most the deal's price plus the fee, and its recourse is the signed record and the law (D26). The parties' protection moves to what they choose before they sign: the three adjudicators, the fallback and the default outcome.

**Where this ADR went past the plan it records, and what Rafa answered on 2026-11-11.** Two stricter rules are agreed ("Agree with your strict rules"): the deadline order is strict and covers five deadlines, as `packages/core` already requires, and the contract requires the acceptance's `bondReserved` to be zero instead of leaving it unchecked. The third point he overruled: this ADR named the zero-price refusal as a new limit under D31, and he decided that a zero price stays allowed.

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

### 4. SC-3: a mutual settlement pays the buyer and the seller only (decided by Rafa)

**Cut for phase one, by Rafa's own decision, with a follow-up.** His first reaction on 2026-11-11 was: "I do feel like Buyer and Seller should be able to agree to send the funds to any arbitrary address per their contract." The planning session then read the path again and recommended keeping it. It found the path low risk: the same kind of capture pays the adjudicator's fee on every reject (`HoldbackRules.sol:356`), so the mechanism stays in the contract either way, and no open finding touches it. With that in front of him, Rafa decided: **"Fine cut it for now, but make sure it's in the roadmap. It's very important because they may need to send the funds to another third party as part of the contract. Maybe the better design is that upon contract the seller has one address that is their counterparty and has another address related to receivable, and the receivable address can be changed with both party agreement to an arbitrary address if needed?"**

- **What leaves.** Payouts to a third address. Today the contract pays one as a capture that is all fee, through the escrow's fee slot (`HoldbackRules.sol:470-475`). That branch, its `captured` counter and the loop's captures leave. The contract reverts with `InvalidMessage` on a payout whose `to` is neither the buyer nor the seller.
- **What stays.** `mutualSettle`; the signed `MutualSettlement` with its `Payout[]`; any split of the price between the buyer and the seller; the fee back to the buyer; the key release in the same transaction. A settlement then makes at most one capture, to the seller, and one void, to the buyer.
- **What a party loses.** A joint exit to another mechanism in one transaction: another escrow, or an outside arbiter. The parties pay themselves first and move the funds after, so one of them holds the money in between. That is the cost D23 named for its option A.
- **Signed types and schemas.** None changes. The schema lets `to` be any address, and the rulebook's `mutualSettlement.payoutsTo` is `parties` or `any` (`spec/schemas/club.schema.json:269-275`). A phase-one deployment behaves as `parties` whatever the rulebook says. A rulebook that says `any` then promises more than the contract does, so the demo club's rulebook moves to `parties` with the new demo world (D49).
- **Events.** `Paid` loses its only emit site (`:474`) and leaves with the feature, under Rafa's rule that a cut feature's events go with it (section 10).
- **What it amends.** D23 is deferred for the phase-one contracts, not dropped. The fifth outcome in `docs/neutrality.md` ("at any split, to any addresses both parties sign") reads "at any split between the buyer and the seller".
- **How it comes back: a planned piece of work, not a wait for demand, in two halves.** Rafa's proposal is a receivable address in the terms: the seller's signing address stays its identity as the counterparty, and the receivable address is where its money goes.
  - **The first half is in phase one** (section 11): the terms name a payout address for the seller, fixed when the parties sign. A seller that must pay a third party names that party's address there.
  - **The second half starts after the phase-one contracts are frozen:** both parties can change that address to any address by signing. It needs its own ADR.

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

`agreeAndFund` refuses three kinds of terms. A zero price is not one of them.

- **A zero price stays allowed (decided by Rafa).** This ADR first recorded a refusal, and named it as a new limit that D31 does not cover: the schema allows `"0"` (`spec/schemas/common.schema.json:46`) and core does not refuse it [measured by search]. Asked on 2026-11-11 "Should we allow a deal with a price of zero?", Rafa answered: **"Yes. There may be other terms and assets related so we need to assume the contract itself can have a zero token value but other considerations like a state from an oracle in the future."** The token amount alone does not say whether a deal is real.
  - What stays: the branches for a zero price (`HoldbackRules.sol:357` and `:412`) [measured]. A separate task writes their tests: a deal with price 0 and a fee above 0 through every outcome.
  - Nothing changes in core or the schema.
  - **One stated limit (decided by Rafa): a deal must hold at least one base unit, as price or as fee.** A deal with price 0 and fee 0 cannot be funded: the escrow refuses to hold nothing (`AuthCaptureEscrow.sol:179`, `ZeroAmount`) [measured], while core funds it today. Told on 2026-11-11 "A deal where nobody pays anything, not even the judge, doesn't need an escrow yet.", Rafa answered: "Agree". The contract is unchanged. Core, the prepare routes and the docs say the same, so an agent gets a clear answer before funding. Under D31 this refuses only what settlement cannot process.

1. **Deadlines out of order** (the strict rule is agreed by Rafa, 2026-11-11: "Question 3: Agree with your strict rules.").
   - The rule: `offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`, each strictly before the next.
   - **The contract copies core's comparison exactly.** The plan first wrote `fundBy ≤ deliverBy ≤ judgeBy ≤ fallbackBy`, and now says "compared exactly as `packages/core/src/timing.ts:46-49` compares them". That comparison is strict and covers all five deadlines (`timing.ts:33,46-49`) [measured]. If the contract accepted terms that core refuses, such a deal would fall behind the operators' view (residual 13, the divergence case).
   - What a party loses: nothing through the API or on SimChain, which refuse these terms today. A party that submits straight to the contract loses equal deadlines, which give an adjudicator a window of zero length.
   - What it closes: an escrow expiry that falls before the delivery deadline or before an on-time decision (L-6); a fallback's beacon round that is public before funding (L-8); a delivery after `judgeBy`; a fallback and a default in one block.
2. **`maxSubmissions` other than 1.**
   - What leaves: nothing; the contract already takes one delivery (`:624`). The refusal stops terms that promise a resubmission the contract never honours.
   - What a party loses: nothing. Core's parser refuses it today (`packages/core/src/parse.ts:103`), and `state.ts:287` refuses a second attempt [measured]. The plan cites other lines for this; these are the checks.
3. **An escalation decision window of zero:** `appealDecideSec` must be at least 1.
   - Why: with a window of 0 the appeal adjudicator's deadline is the escalation's own second, so no decision can land and every escalated case defaults at once (`:264`, `:286`; the state model's finding F-2, T-340).
   - What a party loses: nothing. The schema already requires at least 1 (`spec/schemas/commitment.schema.json:311-314`) [measured], so such terms are malformed, and D31 refuses malformed terms.
   - `appealWindowSec` gets no check: with SC-7 the contract never reads it (section 8, point 3).
   - **A short window is a stated limit, not a refusal.** A window of a few seconds is at least 1 and still cannot be decided: the escalation's beacon round is published after the escalation, and the decision then needs a block before the window closes (`:265`, `:286`). Under D31 the contract sets no minimum above the schema's. The state model and the agent docs state the smallest window that can be decided on the deployed chain, and the operator's prepare route warns below it and does not refuse.

- **One funding deadline, settled here.** On the contract, agreeing and funding are one call. That call must land before `offerExpiresAt`, which the order rule puts before `fundBy`. So on EVM settlement an offer funds until `offerExpiresAt`, and `fundBy` only bounds the buyer's ERC-3009 authorization (`:179`). Core and SimChain keep two steps: agree before `offerExpiresAt`, then fund before `fundBy` (`state.ts:240,259`). The contract cannot follow that: it stores nothing before funding, so it cannot tell an agreement made in time from one made after the seller's offer lapsed. The EVM adapter already follows the contract (`packages/settlement/evm/timeouts.ts:111-112`) [measured]. The fix is in the docs and the prepare routes, not in the contract.
- **Signed types and schemas.** None changes. The schema keeps `maxSubmissions` 1 to 3 for the full protocol; a phase-one deployment refuses any value but 1, and the operator's prepare routes say so before anyone signs.
- **Trigger for bringing them back.** Resubmissions return with `settle_after_window` (ADR-0007). Equal deadlines and a zero decision window do not return.

### 6b. SC-5b: the settlement for late work stays (decided by Rafa)

**Not cut. In `Held`, a settlement both parties sign may still name a delivery and release its key in the same transaction as the payment.**

Asked on 2026-11-11 "Keep the path that settles late work and releases the key in the same transaction?", Rafa answered: **"Yes, keep it"**. His reason, from earlier the same day: "If the work is not delivered on time, can the two still agree to transfer the funds through the contract? If not, I think we should keep it since we should measure how many actually use the timebounds stricly vs. who settles anyways."

**Why it stays.** Without the path the two can still move the money by agreement after a missed deadline, but the key for late work changes hands off chain, and one party trusts the other. With it, a late settlement is safe for both sides, so it is more likely to be used, and it leaves a mark on chain that can be counted. Rafa wants to measure how many deals hold to their time bounds strictly and how many settle anyway.

- **What the path does today.** In `Held`, before any delivery is posted, `mutualSettle` takes a settlement with `hasDelivery` true. With `releaseKey` it checks that the carried delivery hashes to the hash both parties signed, proves the buyer's envelope against that delivery's key list, pays the split, and emits the buyer's key in the same transaction (`HoldbackRules.sol:435-447`, `:456`). The contract never checks the seller's signature on the delivery itself; the seller's signature on the settlement, which names the delivery's hash, stands in for it.
- **Why it was built.** For late work. After `deliverBy` no delivery can land (`:623`), so a decision or an early accept cannot settle one. D37's amendment of 2026-11-03 says: "A buyer who wants late work settles for it with the seller." The test `contracts/test/unit/LateCarriedDelivery.t.sol:84` (`test_lateWork_settlesByMutualSettlement`) holds the contract to it: at `deliverBy`, a settlement both signed pays the seller and releases the key [measured].
- **The gap the decision closes, toward the contract.** The contract is alone in taking this settlement. Core refuses a settlement in `Held` that names a delivery or releases a key (`packages/core/src/state.ts:516-518`), ADR-0019 says the same, and the formal model has it as a rule (the state model's finding F-1, T-340). **Core, ADR-0019 and the formal model must change to allow what the contract already allows.** Until core allows it, nobody can use the path through the API, and a party that uses it directly leaves its deal behind the operators' view (residual 13). A later package does that work, with a reviewer, because it opens a path for a signed message.
- **One new test for the contract:** the delivery named in the settlement is the one whose key is released, and a settlement that names one delivery cannot release another's key (`:445-446`).

The two options, kept as the record:

| | Cut the path (not chosen) | Keep the path (chosen) |
| --- | --- | --- |
| The money after a missed `deliverBy` | Still moves by a settlement both sign, until a reclaim lands | The same |
| The key for late work | Changes hands off chain. One party goes first and trusts the other | Is released in the same transaction as the payment, from the delivery the settlement names |
| What changes | The contract: in `Held`, `hasDelivery` must be false (`:435`). The test at `LateCarriedDelivery.t.sol:84` expects a revert. D37's sentence about late work is amended | Core (`state.ts:516-518`), ADR-0019 and the formal model change to allow what the contract already allows. A test checks that the delivery named in the settlement is the one whose key is released |
| What an auditor reads | One path fewer; no key leaves without a posted delivery | The one path where a key leaves with no posted delivery. Both parties signed the delivery's hash, and the buyer's envelope is proven against it (`:445-446`) |
| What the record shows | A settlement after `deliverBy`, with no sign of whether work changed hands | `MutuallySettled` with `keyReleased` true and no posted delivery: a late delivery the buyer still paid for |

- **One limit on the measurement.** The window for a late settlement is short. From `deliverBy` anyone may call `reclaim`, and the operators send it on their own once it is due (T-231). A reclaim ends the deal, so a late settlement counts only if it lands first. Whoever builds the measurement decides whether the operators wait before they reclaim.
- **How this ADR got here.** It first recommended the cut, for one rule across the contract and core. Rafa's goal outweighs that, and the same single rule is reached by changing core instead.
- **Signed types and schemas.** None changes.
- **What would reopen it.** A finding that the path releases a key the seller did not endorse.

### 7. SC-6: no on-chain record of an unfunded offer's expiry (decided by Rafa)

**Goes ahead, off chain.** Rafa, 2026-11-11: "I don't think we need to send that message because the expiry date will be hit anyways so it will simply show expired?" Then, after the explanation below: **"ok for question 1 I agree with your explanation and no ping from our side is necessary."** The operators mark an unfunded offer expired by their own clock and send no transaction.

**The fact he asked about.** An expired offer cannot be revived. Funding after `offerExpiresAt` reverts whether or not anyone recorded the expiry (`HoldbackRules.sol:203`). A new expiry date makes new terms, so a new commitment ID, and that needs three new signatures: the seller's on the terms, the primary adjudicator's acceptance, and the buyer's agreement.

- **What leaves.** `expireOffer` (`:523-530`) and `Stage.Expired`. `Expired` is the last member of the enum, so removing it renumbers no other stage.
- **What stays.** `JobExpired`, which `reclaim` emits (`:539`).
- **What a party loses.** A transaction that records that an offer lapsed unfunded. Nothing depends on that record for safety: after the deadline `agreeAndFund` reverts on its own check (`:203`), and time does not run backwards.
- **Why cut it.** It is a function anyone can call to write storage for any terms, real or invented, and the state it writes guards nothing.
- **The plan's condition is not met as written.** The plan lets this cut proceed "if the adapter does not depend on it". The adapter does [measured]: it sends `expireOffer` (`evm-settlement.ts:1331-1332`, `timeouts.ts:80,112`), reads its `JobExpired` as `offer.expired` (`evm-settlement.ts:309,332,2067-2069,2120-2122`), and the operator's trigger route names it (`apps/operator/src/server.ts:332`).
- **The verdict, which Rafa confirmed: proceed, and move the expiry off chain in the same change.** Before funding nothing about an offer is on chain, so the operators' own record is the only record of an offer either way. The adapter expires an unfunded offer by its clock, and `offer.expired` stops having a transaction behind it. The operators also stop paying gas for each abandoned offer.
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
2. **The acceptance's signed `bondReserved` must be zero** (agreed by Rafa, 2026-11-11: "Question 3: Agree with your strict rules.").
   - **The plan's claim, tested.** The plan recommends that the contract stops checking the field, and says this changes no signed type. The claim holds [measured]: `ACCEPTANCE_TYPEHASH` (`HoldbackTypes.sol:188-193`) keeps `TokenAmount bondReserved`, and `acceptanceHash` (`:296-312`) hashes whatever value the call carries. Only the comparison at `HoldbackRules.sol:205` is in question.
   - **Why this ADR does not leave it unchecked.** An unchecked field lets a funded deal carry an adjudicator's signed statement that it reserved the price, on a deployment where no bond can exist. A party may believe it, and the record is the parties' evidence (D26). Unchecked also opens a gap between the contract and core: core refuses an acceptance whose `bondReserved` is below the price (`packages/core/src/state.ts:223-231`) [measured], so a deal funded directly with another value would fall behind the operators' view.
   - **The rule.** `agreeAndFund` reverts unless `bondReserved` is 0. The comparison changes from "below the price" to "not zero", which costs no bytes. Every funded phase-one deal then carries an acceptance that says what is true: nothing is reserved. The schema allows `"0"` (`common.schema.json:46`), so no schema changes.
   - **The mirror.** On a phase-one deployment core requires zero and reads no free bond; the reference adjudicator signs zero (it signs the price today, `apps/adjudicator/src/service.ts:242`); the EVM adapter stops reading the vault (`evm-settlement.ts:974-991`). SimChain keeps the full rule.
   - **Not chosen.** Leave it unchecked (the plan's recommendation): simplest contract, and the two costs above. Keep today's check: an enforced statement that is false. Drop the field from the signed type: a new domain version and new hash vectors, and it would cut the field from the full protocol too.
3. **`timing.appealWindowSec` joins the fields that are signed and not enforced.** The plan does not list this one. With no party appeal the contract never reads it. The schema requires it to be at least 1 (`spec/schemas/commitment.schema.json:307-314`), so the contract cannot require zero without a schema change. Until a schema version allows zero, the terms of a phase-one deal state an appeal window that the contract does not honour, and the docs and the prepare routes must say so. **Recommended for the next schema version, whenever one comes for another reason:** allow 0, and have the phase-one contract refuse any other value, as it refuses `maxSubmissions` above 1. Until then it belongs in the register of signed fields the contract does not enforce. That register is section 8.3 of the state model (`docs/audit/state-model.md`, T-340, on its branch and not yet merged): sixteen fields, each with a verdict. Two of its verdicts follow from this ADR: the acceptance's `bondReserved` becomes an enforced field (zero), and a decision's `appealGround` can be required empty for every role, since no party appeal remains to give it a meaning. Its other "enforce" verdicts are fixes for the building tasks, not scope cuts.
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

### 9. SC-8: the on-chain proof of the beacon stays for now (decided by Rafa)

Rafa, 2026-11-11: **"the on-chain beacon proof stays for now, if that is the industry standard and what uniswap uses."** The cut is not taken. `DrandQuicknetBeacon.sol` stays in the phase-one contracts and in the audit's scope. The question comes back with the choice of chain.

- **His condition does not hold as worded, and he has been told.** Uniswap's contracts use no randomness beacon, and the most common source of randomness on chain is an oracle service, Chainlink VRF [from memory, not checked today]. Verifying a drand round on chain is sound and newer, and it is not an industry standard. The recommendation to keep it does not rest on the condition.
- **What the proof is.** drand is a public network that publishes a signed random value every few seconds. `DrandQuicknetBeacon.sol` (175 lines) checks one round's BLS signature against the network's public key, with the chain's BLS precompiles (EIP-2537). For a fallback's decision and for an escalation's, `decide` requires the round that the deal's state fixes, that round's proven value, and the panel seed derived from it (`HoldbackRules.sol:290-297`). No oracle operator and no key stand between the network and the contract: anyone can fetch a round and anyone can relay it.
- **Why phase one keeps it.**
  - **SC-7 raises its weight.** Before SC-7, an adjudicator that shopped for a panel still faced an appeal and its bond. In phase one the first decision is final. The proof is then the only thing on chain that stops a fallback, or the appeal adjudicator after an escalation, from picking the seed, and so the panel, that gives the outcome it wants (threat T21 in `docs/judgment-and-defenses.md`).
  - **It is the part of litmus test 3 that the contract enforces.** "Selected by commit-reveal" holds on chain for the primary through its seed commitment and for the others through the beacon. Phase one already sets one line of that test aside; cutting the proof would strain a second.
- **What keeping it costs.**
  - 175 lines of pairing code that an auditor must read, written for this project and not audited (ADR-0018). A separate task reviews its arithmetic before the freeze.
  - Its open hardening items wait for the redeploy: the fallback's round is the first at or after `judgeBy`, and an escalation's round leaves a margin of one block (T-225).
  - Each candidate chain must have EIP-2537 (ADR-0018). A chain without it refuses every proof, so no fallback or escalation could decide there.
- **What the cut would have removed,** kept as the record: `DrandQuicknetBeacon.sol`, and with it either only the BLS check (the decider's beacon value becomes its word, provable false off chain and attributable) or the whole beacon (the decider picks its seed).
- **Revisit when** the chain is chosen, or if the verifier's review finds a defect that is costly to fix.

### 10. Events

Rafa's rule is that events are never removed. Asked on 2026-11-11 "Where a cut removes a feature, may its events go with it?", he answered **"Agree"**. This is the one exception, and it covers only the events of a feature he has cut.

| Event | Where | Phase one |
| --- | --- | --- |
| `BondDeposited`, `BondWithdrawn`, `BondEncumbered`, `BondReleased`, `AppealBondHeld`, `AppealBondPaid`, `BondSlashed` | `HoldbackBonds.sol:30-38` | Leave with the vault (SC-7): the contract no longer exists |
| `AppealFiled`, `AppealClosed` | `HoldbackRules.sol:117-118` | Leave with the appeal paths (SC-7) |
| `Paid` | `HoldbackRules.sol:104` | Leaves with third-party payouts (SC-3), which Rafa cut on 2026-11-11. It had one emit site, for a payout to a third address |
| `JobExpired` | `HoldbackRules.sol:98` | Stays. `reclaim` still emits it; `expireOffer` no longer does (SC-6) |
| `KeyReleased` | `HoldbackRules.sol:114` | Stays. Its `path` value 3 (`KEY_APPEAL`) is never emitted |
| `JobCreated`, `JobFunded`, `JobSubmitted`, `JobCompleted`, `JobRejected`, `PaymentReleased`, `Refunded`, `FeePaid`, `Decided`, `FallbackTriggered`, `Defaulted`, `MutuallySettled` | `HoldbackRules.sol:91-119` | Stay, unchanged |

Each removal goes on the list of allowed differences of the side-by-side run that compares the old and the new contracts, and into the events inventory (`docs/audit/events.md`, T-338).

### 11. One addition to phase one: a payout address for the seller and a payment address for the buyer (decided in principle by Rafa)

**Every other section of this ADR removes something. This one adds: each party's money moves through an address apart from the address that signs. The seller has a payout address, where it is paid. The buyer has a payment address, which funds the hold and receives every refund. Both are decided in principle and not designed here. Their own ADR and a schema version follow.**

Rafa, 2026-11-11: **"The contract Seller (as in agree-er) should not be the same address as the asset payout address. So that does need to get fixed in the contract architecture if it isn't already the case".**

- **It is not the case today.** The escrow's receiver for every deal is `t.seller` (`HoldbackRules.sol:176`), and `t.seller` is the address whose signature the contract checks on the terms and on the delivery (`:206`, `:626`) [measured]. So a release, an early accept and the seller's share of a settlement all pay the signing address. No signed type carries a second address for the seller.
- **What is decided.**
  - The payout address and the signing address are separate fields in the signed terms. Both parties and the primary adjudicator sign terms that name it, so nobody changes it after signing.
  - The contract does not refuse equal addresses. Asked "Must the seller's two addresses be different, or may they be the same?", Rafa answered: "They can be different, but can default to the same upon initial set-up if that is easiest for an agent. LIke when you input delivery address and then credit card address". The tooling follows his words: when a seller sets no payout address, the reference adapter uses the signing address and says so in one line at start-up. It does not stop.
  - It is part of the phase-one contracts and of the commit that is frozen and audited.
- **The buyer gets a payment address, by Rafa's decision against the recommendation.** Put to him as "A separate refund address for the buyer. The suggestion is no, not in the first version.", he answered: **"Yes, this should be part of the initial design."**
  - **What phase one can give is a payment address, not a free refund address.** The vendored escrow returns held funds only to the address that funded the hold: both its void and the buyer's own reclaim pay the payer, and only the payer can reclaim (`AuthCaptureEscrow.sol:304-316`, `:323-340`) [measured]. On that explanation Rafa said: **"Yes means the buyer gets a signing address and a payment address."**
  - **Decided in principle.** The phase-one signed terms carry a payment address for the buyer, apart from the address that signs. The payment address funds the hold and receives every refund. It may equal the signing address, and the tooling leaves the two equal by default.
  - **Not in phase one:** a refund to an address other than the one that paid. Rafa's rule for it: "If it Coinbase's code can't, then skip and make sure it's in the roadmap". It returns with the planned work on sending funds to a third address (section 4).
  - **Not designed here.** Today the payer is the buyer's signing address (`HoldbackRules.sol:175`) [measured]. Naming another payer changes who signs the funding. The same ADR as the seller's payout address settles it.
- **It changes a signed type, which no cut in this ADR does.** New fields in `CommitmentTerms`; the escrow's receiver becomes the seller's payout address; every commitment ID moves. So it needs its own ADR, a schema version, a new EIP-712 domain version and new hash vectors (the hard rule on `spec/schemas/`). This ADR names it and points forward; it designs nothing.
- **How it sits with the cut of third-party payouts (section 4).** It softens that cut at once: a seller that must send the funds to a third party names that party's address as its payout address when it signs the offer. What stays for later is changing that address after signing, by both parties' agreement.
- **Litmus tests, at this level.** Neutrality: both addresses are in the terms every party signs, so no one party can redirect funds. The hold: funds still leave only on a decision, an early accept, a settlement both sign, or a timeout. The hold's test bites hardest on the buyer's side: the buyer's own reclaim on the escrow after its expiry is the backstop that needs no one else (ADR-0003), and only the payer can call it. With a payment address, that backstop belongs to the payment address, not to the signing key. The addresses' own ADR tests the design against all three.

## Signed types and schemas

**No cut changes an EIP-712 type, the domain version (0.7) or a file in `spec/schemas/` (v0.10).** A phase-one deployment accepts a subset of what the types can say, and the redeploy changes the domain's `verifyingContract`, as every redeploy does.

**One addition does change a signed type:** the seller's payout address and the buyer's payment address (section 11) add fields to `CommitmentTerms`. Its own ADR carries the schema version, the new domain version and the new hash vectors. The table below is about the cuts.

| What the types and schemas still allow | What a phase-one deployment does |
| --- | --- |
| Three token fields that may differ; any token (`commitment.schema.json`) | Refuses terms whose token is not the deployment's (SC-1) |
| `FundingAuthorization.scheme` of `permit2` | Takes ERC-3009 only (SC-2) |
| A `Payout` to any address; `payoutsTo: any` in a rulebook | Refuses a payout to anyone but the buyer or the seller (SC-3) |
| `maxSubmissions` 1 to 3 | Refuses any value but 1 (SC-5) |
| A price of `"0"` | Takes it, with a fee above 0. A deal with price 0 and fee 0 cannot be funded: the escrow refuses to hold nothing. That is a stated phase-one limit (section 6) |
| A `MutualSettlement` with `hasDelivery` before any delivery is posted | Takes it, as today (SC-5b, kept). Core refuses it today and changes to allow it |
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
| SC-5 | Passes. Every refusal comes before funds are held | Passes. The escrow's expiry can no longer fall before a deadline it must outlast | Unaffected |
| SC-5b not cut | Passes. A settlement needs both signatures | Kept whole: the key for late work still leaves in the same transaction as the payment | Unaffected |
| SC-6 | Passes. No held funds are involved | Passes | Unaffected |
| SC-7 | Passes in form: the terms name the decider, and its decision is the outcome the terms define. Weaker in substance: residual 3, collusion, loses two of its four bounds | Passes. No contract holds a bond or an appeal bond, and a deal settles once | **Sets one line aside:** "Appeals are backed by the adjudicator's bond" |
| SC-8 not cut | Passes | Passes | Kept whole: "selected by commit-reveal" holds on chain for every decider |

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

**What gets weaker, named.**

- **Collusion (residual 3)** is bounded today by commit-reveal selection, panels across families, an appeal to another adjudicator, and the bond. Phase one keeps the first two.
- **A party must trust all three adjudicators it names, not one.** The other party can steer which of them decides (red-team finding H-2). A seller that gives the primary an envelope it cannot open leaves the primary silent, and the fallback decides. A seller that plants text the screen flags forces an escalation, and the appeal adjudicator decides. Each of those decisions is final.
- **Nothing caps an adjudicator's open volume.** ADR-0007 names the 100% bond rule as what bounds an adjudicator that accepts everything for sellers it controls (threat T18): its open deals could not exceed its bond. Phase one has no such bound. The loss per deal is bounded; the number of deals is not. A buyer's defence is to refuse terms that name an adjudicator it does not know.
- **An adjudicator earns its fee for an accept or a reject and nothing for an escalation,** and no bond weighs against a careless decision (red-team finding M-3).
- **A cheaper model under a pinned name (residual 8)** loses its bond and its appeal the same way.
- **For a pilot, the answers are off chain and the parties' own:** a club rulebook that names the adjudicators, deal prices sized to the loss a party accepts, and a buyer's agent that checks all three adjudicators before it signs (D32).

## What waits on Rafa

1. **The sentence in `CLAUDE.md`,** a tier-3 file. Proposed wording for the last line of litmus test 3:
   > Appeals are backed by the adjudicator's bond. Phase one sets this line aside: its contracts have no party appeals and no bonds, and the first decision by the primary or the fallback adjudicator is final on chain (Rafa, 2026-11-11; D57, ADR-0031). SimChain keeps both.

   And for protocol property 2, one added sentence: "Phase one has no bonds on chain (D57); the bonding returns with them."
No scope point is open. The design of the two addresses in section 11 comes to him with their own ADR.

**Answered by Rafa on 2026-11-11, after this ADR first merged** (D58): a payout address for the seller and a payment address for the buyer are part of phase one, and each may equal the signing address; a deal must hold at least one base unit, as price or as fee; SC-6 goes ahead off chain; a zero price stays allowed; `bondReserved` must be zero and the five deadlines are checked in strict order; SC-3 is cut for phase one with a planned return, and `Paid` leaves with it.

## Red-team findings and answers

One red-team pass attacked the cuts on 2026-11-11 with `CLAUDE.md`, the litmus tests, `docs/neutrality.md` and today's contracts, and without this ADR or its reasoning. Its question: which cut lets one party block a valid commitment from settling, or move held funds or the buyer's key outside the terms? It ran nothing, because the phase-one code does not exist yet; each finding applies the cut list to today's lines.

**Its verdict: no Critical finding. No cut lets a party take held funds without a signature the terms name, and no cut leaves a deal stuck.** Every stage that is not final keeps an exit anyone can trigger. SC-1, SC-2, SC-3, SC-5 and SC-6 are safe for funds. It found 2 High, 5 Medium and 5 Low, and all but two describe the price of SC-7.

| # | Severity | Finding | New with the cut? | This ADR's answer |
| --- | --- | --- | --- | --- |
| H-1 | High | **SC-7.** A wrong first decision is final and nobody pays for it. A primary can accept with a key that does not decrypt (the contract checks only that the key is not empty, `HoldbackRules.sol:350`), or reject and pass the work to the buyer off chain. The loss is price plus fee per deal, with no cap across deals | The money path exists today; the missing remedy is new | **Accepted, as the stated price of Rafa's decision.** No small contract change restores the remedy: the adjudicator wraps the key itself, so the contract cannot prove it. "Litmus tests" above states the cost per row and the missing cap. The signed decision and delivery are the losing party's evidence (D26) |
| H-2 | High | **SC-7.** The seller chooses which of the three adjudicators decides: a broken envelope silences the reference primary and hands the case to the fallback, which now needs no bond; a planted screen flag forces an escalation. A buyer needs all three honest, where today it is safe with an honest appeal adjudicator | The fallback route is new; the escalation route exists (L-5) | **Accepted and stated** under "What gets weaker". No contract change. Two follow-ups for later tasks, not decided here: the reference primary could sign a reject when its own envelope is missing or does not open; the buyer's agent checks all three adjudicators before signing (D32) |
| M-1 | Medium | **Escalation is free, final and steerable.** A primary that is also the appeal adjudicator gets a second panel draw. A primary alone forces a refund by escalating to a silent appeal adjudicator. The escalator may know the escalation's beacon round before its transaction is included (review I-5) | Exists today; it becomes the only second look | **Raised in weight.** The fix for I-5, a margin of one block before the escalation's round, was planned for the redeploy; with SC-7 it is required before the freeze. The contract checks no distinctness of the three adjudicators: the threat model (T-340) states it, and an operator may warn (D31) |
| M-2 | Medium | **SC-8.** Without the on-chain proof a fallback or an appeal adjudicator searches for a beacon value that gives the panel it wants, in about 50 hashes, and the result is final | New if cut | **Not cut.** Rafa keeps the proof (section 9). The finding is the reason this ADR gives |
| M-3 | Medium | **SC-7.** An adjudicator earns the fee for any accept or reject and nothing for an escalation; the bond was the counterweight | The fee shape exists today | **Accepted and stated** under "What gets weaker". No small contract change |
| M-4 | Medium | **SC-4, contract signers stay.** A signature is checked when it is relayed, and an account's code can change. A plain key that takes delegated code (EIP-7702) after signing loses its pending signatures; an adjudicator that does this goes silent deniably. A contract signer can turn its half of a co-signed settlement off and on, a one-sided option. It cannot block a capture or a refund | Exists today | **Passed to the tasks that keep SC-4.** The outcomes are the fallback or the default, which the terms name, so neutrality holds. The threat model states both behaviours, and the contract-signer tests in section 5 cover them. The red team's suggested change, checking a plain-key signature before ERC-1271, changes how every signature is checked; the building task weighs it with those tests |
| M-5 | Medium | **SC-7.** Core, the reference adjudicator and the operator still assume bonds. If the contract is cut alone, every phase-one deal diverges from core and the operators' adjudicators stop acting | New | **Adopted as a precondition:** the off-chain phase-one profile lands before the redeploy ("Consequences"). The bond and appeal fixtures stay unchanged on SimChain and are not weakened |
| L-1 | Low | **SC-7.** `appealWindowSec`, the `Appeal` type and `appealGround` stay signed, so an agent built on today's docs believes it has a bonded appeal. Replay across deployments is closed: the domain names the contract | New | **Answered in the docs and the operators' discovery document, not by a new domain version.** The terms' `schemaVersion` is fixed to the domain version (`commitment.schema.json:77-80`), so a new version string is a schema change. The operator's status document names the deployment's profile. `KEY_APPEAL` leaves, and `appealGround` can be required empty for every role (section 8, point 3) |
| L-2 | Low | **The `Held` settlement rule** is safe for funds and matches core. Its cost: after `deliverBy` no co-signed settlement can release the key. Also, as today: a settlement signed before delivery dies when a delivery lands, and a due timeout can land before a co-signed settlement | The first is new if cut | **Not cut.** Rafa keeps the path (section 6b), so the cost does not arise |
| L-3 | Low | **SC-5.** The strict order and the zero-price refusal restrict what D31 would allow. Lost: a zero price with a paid judge, and a deal with no fallback through equal deadlines. Windows shorter than a block still fund and cannot be decided | New | **Half answered by Rafa's decision: a zero price stays allowed** (section 6). The strict order stands, agreed by Rafa. Short windows are the parties' parameter; an operator warns and does not refuse |
| L-4 | Low | **SC-7.** Volume through an adjudicator is free to fake, since no capital is locked; fallback and appeal adjudicators that never consented collect defaults | New | **Accepted.** An adjudicator's on-chain history counts for less in phase one. A pilot's club names its adjudicators |
| L-5 | Low | **SC-1, SC-2.** The deployer's one-time choices are the trust anchor: the token, the escrow, the collector, the beacon and the expiry margin | Exists today | **Adopted.** `docs/audit/scope.md` says the freeze lists every immutable with its address and code hash |

The red team also proposed ten fixtures for the phase-one contracts, among them `attack.accept-with-dead-key`, `attack.seller-routes-to-fallback`, `attack.seller-forces-escalation` and `neutrality.adjudicator-delegates-7702`. They record what phase one accepts; the tasks that build the cuts write them.

## Alternatives considered

- **Keep the general contracts and fix every finding.** Three new mechanisms and a schema change for the appeal bonds alone, in a contract at the size limit, and every line of it in the audit. Rafa's standard chooses the smaller contract.
- **Disable the cut features behind a flag.** The code stays, and so does every finding in it. A flag someone can flip is also an admin control, which the hard rules forbid.
- **Cut appeals and keep bonds.** A bond with no appeal has nothing to pay: on chain a bond moves only when an appeal overturns a decision. The vault would hold money to no purpose.
- **Keep appeals and cut bonds.** An appeal that cannot make the wronged party whole only delays finality; the money moved at the first decision (ADR-0007, guaranteed mode).
- **Change the signed types to match phase one.** A new domain version, a new schema version and new hash vectors, to describe a smaller protocol than the one SimChain runs. The types describe the full protocol; a deployment enforces a subset.

## Consequences

- **The contract an auditor reads is smaller:** one file gone, three entry points gone, the appeal state and the bond flags gone. The plan estimates about 250 of 1,463 lines [guessed there].
- **The off-chain code needs a phase-one profile, and it lands before the redeploy.** Core, the EVM adapter, the operator's prepare routes and the reference adjudicator must refuse what the contract refuses and accept what it accepts: the token, ERC-3009, payouts to the parties, `bondReserved` 0, no appeal, an offer that expires by the clock. If the contract changes alone, every phase-one deal diverges from core and the operators' adjudicators stop acting on it (red-team finding M-5). SimChain keeps the full protocol, and the operators' discovery document names the deployment's profile.
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
| `site/visualdemo/index.html` | 93, 122, 160-162, 186-188 | "bonded adjudicator"; "reserves 25 tUSD of its bond: it pays if it is overturned on appeal"; "The 60-second appeal window closes … the arbitrator's bond is free again" | The adjudicator accepts the case; the deal is final at the decision |
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
