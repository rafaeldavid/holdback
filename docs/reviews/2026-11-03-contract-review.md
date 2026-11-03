# Contract review: Phase 2 settlement contracts (2026-11-03)

T-206 reviews `contracts/src/` at `main` `baac930`:
- `HoldbackRules`;
- `HoldbackBonds`;
- `HoldbackTypes`, with the `Money` library;
- `IHoldbackBeacon`, `SimBeacon` and `DrandQuicknetBeacon`;
- how `HoldbackRules` drives `AuthCaptureEscrow` v1.1.0 from Commerce Payments (CPP; vendored at `6b0a5ef3`, unmodified, audited separately).

The review deployed nothing. Everything ran on Foundry's in-process EVM and local anvil.

Labels:
- **measured:** a test or tool run shows it;
- **inferred:** from reading the code;
- **guessed:** a judgement not checked.

Line numbers refer to `baac930`.

**Reviewers.**

| Pass | Model | How |
| --- | --- | --- |
| Checklist and code review | Claude Opus 5.5 (`claude-opus-5-5`) | The checklist in §3, the T-204 mapping, static analysis, the regression tests and the fixes |
| Adversarial pass | Claude Fable 5.1 (`claude-fable-5-1`), red-teamer role, max effort | Briefed with the project context (`CLAUDE.md`, the control-point table, ADR-0003, -0012, -0016, -0018, -0019, -0022 and -0025, T-202's list of differences from SimChain, `state.ts`), but not with the first pass's findings. Its 24 proof-of-concept tests (17 attacks, 7 defenses) ran against `baac930` in its own worktree. They are not in the repo |
| Public-audit cross-check | A separate Claude session | Compared the contracts, class by class, with published audits: Commerce Payments' six, Permit2, Solady, USDC/ERC-3009, Kleros, UMA, Reality.eth, Sablier, Superfluid, and BLS verifiers. It found M-3. Its report lands in its own PR |
| Per-PR review | Claude Opus 5.5, reviewer role, briefed with the project context | Each fix PR and this report, until PASS |
| Cross-family pass | not run | No non-Anthropic model is reachable from this environment; human gate for Rafa (§7) |

All passes are Anthropic models, so the task's "two model families" criterion is **not met** yet.

**Baseline.**
- `forge test`: 168 tests pass at `baac930`; 143 on `main` after PR 113 removed redundant tests [measured].
- Slither 0.11.6 and Aderyn 0.6.8 over `contracts/src/` (§4) [measured].

## 1. Verdict

**What holds.**
- The no-admin rule holds without exception: no owner, role, pause, freeze, blacklist or proxy; no `SELFDESTRUCT`, `CALLCODE` or Holdback `DELEGATECALL`; every parameter immutable or constant; every timeout open to anyone [measured].
- Signatures are domain-separated, byte-compatible with core, and bound to the commitment and the role [measured].
- The stage machine refuses every replay [measured].
- Every money path writes the stage before its first call to CPP or a token. The deal word is sometimes written after a call to the bond vault, which makes no external call (H4) [inferred].

**What broke a litmus test.** Five findings, each fixed in its own PR with regression tests that fail on `main`. H-1 and H-2 each have a part outside the contract, in core's state machine and the reference adjudicator (T-210, T-211).
- **H-1:** the appeal adjudicator could choose its panel seed through the unchecked `attempt` (defended judgment).
- **H-2:** a decision could release the content key to a refunded buyer (the hold).
- **M-1:** a buyer's own CPP reclaim stranded every encumbered bond forever (neutrality, the hold).
- **M-2:** a delivery landed after `deliverBy` could beat the buyer's reclaim (the hold).
- **M-3:** a sham deal could lock a named fallback's or appeal adjudicator's bond, which that adjudicator never consented to (neutrality).

The public-audit cross-check found no high or medium issue against our use of CPP, Permit2, Solady or USDC, and none in the drand verifier.

**What blocks deployment.**
- Rule for this review: low findings block mainnet, not the Sepolia testnet.
- The cross-family review blocks calling Phase 2 done (§7).
- "Appeals are backed by the adjudicator's bond" is **not met on chain until Phase 4**. No on-chain path pays anyone from an adjudicator's bond; an appeal moves only the appellant's bond (I-8).

## 2. Findings

| ID | Severity | Finding | Litmus test | Label | Status |
| --- | --- | --- | --- | --- | --- |
| H-1 | high | The appeal adjudicator chooses its panel seed through `attempt` | judgment | measured | fixed, PR #120 (merged); core in T-210 |
| H-2 | high | A decision can release the key to a refunded buyer | hold | measured | fixed in the contract, PR #125 (merged); reference adjudicator in T-211, SimChain in T-210 |
| M-1 | medium | A buyer's CPP reclaim strands every encumbered bond | neutrality, hold | measured | fixed, PR #122 (merged) |
| M-2 | medium | A delivery landed after `deliverBy` beats the reclaim | hold | measured | fixed, PR #127 (merged) |
| M-3 | medium | A sham deal locks a named fallback's or appeal adjudicator's bond | neutrality | measured | fixed, PR #135 (merged); reference adjudicator residual in T-211 |
| L-1 | low | An early accept names an attempt, not a delivery | hold (record) | measured | T-212 item 3 |
| L-2 | low | The bond vault credits nominal amounts | neutrality | inferred | T-212 item 1 |
| L-3 | low | A zero-bond appeal is accepted | judgment | measured | accepted until Phase 4 |
| L-4 | low | The seed commitment is checked on 144 bits, reusably | judgment | inferred | T-212 item 2 |
| L-5 | low | Uncovered fallback and appeal adjudicators still decide | judgment | measured | the fallback's part fixed by M-3; the appeal adjudicator's in T-212 item 5 |
| L-6 | low | `authorizationExpiry` ignores `judgeBy` | hold | measured | T-212 item 4 |
| L-7 | low | The party a decision favoured can take the only appeal slot | judgment | measured | T-212 item 7 |
| L-8 | low | A `judgeBy` already past at funding makes the fallback's seed public before the terms are signed | judgment | measured | T-212 item 8 |
| I-1 to I-13 | info | Each labelled and disposed of in §2.3 | | | |

Proofs marked "adversarial pass" are among the 24 tests in that pass's local worktree, measured against `baac930`. They are not in the repo; attack tests pass while the attack works.

### 2.1 High

#### H-1. The appeal adjudicator chooses its panel seed through `attempt` (fixed)

- **Found by:** both passes.
- **Where:** `HoldbackRules.sol:270-279`. `_firstInstance` checked `m.attempt == d.attempt` (`:300`) for the primary and the fallback; the appeal paths (`_escalationDecision` `:321`, `_appealDecision` `:350`) did not. The seed check is `m.seed == panelSeed(id, role, m.attempt, beaconValue)` (`:279`; `HoldbackTypes.sol:419-422`).
- **Attack:**
  1. After an escalation or a party appeal, the appeal adjudicator reads the work.
  2. It computes the panel for each `attempt` from 0 to 255.
  3. It runs the judges and signs the attempt whose panel gives the outcome it wants.
  4. The contract accepts it, and the decision is final (residual 7). ADR-0018 counts 50 random seeds as enough to reach any chosen panel of a 6-entry registry 94% of the time.
- **Proof:**
  - `test/unit/AppealAttempt.t.sol`: 7 tests, 2 of which fail on `main` (the two appeal paths) [measured]. Limiting the check to the appeal role fails three more (primary in `Delivered`, primary carrying the delivery, fallback), so every role is pinned [measured].
  - The adversarial pass's `test_attack_appeal_attempt_gives_256_valid_seeds` [measured, local].
- **Fix:** `decide` compares the attempt for every role.
- **Follow-up (T-210):** `packages/core/src/state.ts` has the same gap. `escalationDecision` and `stepAppeal` do not compare the attempt, and `beaconSeed` hashes it [inferred].

#### H-2. A decision can release the key to a refunded buyer (fixed in the contract)

- **Found by:** the adversarial pass, rated high. The first pass rated it low at first, because the adjudicator holds the key anyway (residual 6). It raised the rating once it found the reference adjudicator attaches the key on the honest path.
- **Where:**
  - `HoldbackRules.sol:362` emitted `KeyReleased` for any party-appeal decision that carried a key, whatever the first outcome.
  - `_settleDecision`'s reject branch (`:340-345`) accepted a reject that carried a key and dropped it silently.
  - `apps/adjudicator/src/service.ts:392` attaches `keyForBuyer` to every accept, the appeal role included.
  - `packages/settlement/sim/simchain.ts:881` releases it too.
- **Scenario:**
  1. The primary rejects, and the buyer is refunded.
  2. The seller appeals.
  3. The appeal adjudicator overturns to accept, the reference service attaches the key, and the contract releases it.
  4. The buyer ends with the refund and the work. The seller ends with neither, because the overturn payout from the first adjudicator's bond is Phase 4 on chain (SimChain pays it).

  This breaks ADR-0012 ("on rejection or reclaim, the key is never released to the buyer") and the formal model's `KeyOnlyWithPayment` (`formal/Holdback.tla:463-465`).
- **Proof:**
  - `test/unit/AppealKey.t.sol`: 7 tests, 6 of which fail on `main` [measured]. The failures are the key-carrying refusals (overturned reject, upheld reject, overturned accept, first-instance reject, escalated reject) and the recovery test. Only `test_upheldAccept_releasesTheKey`, ADR-0012's wrong-key ground after an accept, passes on both.
  - `invariant_keyOnlyWithPayment`, which reaches the path through the handler's `decideAppeal` action, fails on `main` [measured].
  - The adversarial pass's `test_attack_overturned_reject_releases_key_without_paying_seller` shows the seller's balance unchanged and the decider's bond released [measured, local].
- **Fix:** one rule in `decide`, before any effect: a decision carries the buyer's key only with an accept, and never on a deal that stands `Refunded`; otherwise `InvalidMessage`. The refused appeal stays open. The same verdict, re-signed without the key, settles it; if nobody re-signs, `expireAppeal` closes it [measured].
- **Limit:** the key travels in the decision's calldata and through operators. The refusal keeps the settlement rule and record honest, but cannot stop a signed key from reaching the buyer.
  - The protecting fix is in the reference adjudicator: never seal the key for an appeal whose first outcome was reject (T-211). Until T-211 lands, its honest overturn-to-accept appeals revert on chain and then expire.
  - SimChain should refuse the same messages (T-210).
  - Paying the wronged seller from the first adjudicator's bond is Phase 4.

### 2.2 Medium

#### M-1. A buyer's CPP reclaim strands every encumbered bond (fixed)

- **Found by:** both passes. T-203 had recorded it for T-202 earlier (`docs/backlog.md`, due "before T-206"; T-203 Decisions 4).
- **Where:** `_refundAll` (`HoldbackRules.sol:576-585`) always called `void`. It is reached from `reclaim`, from `triggerDefault`, and from `triggerFallback` then `triggerDefault`.
- **Mechanism:** from `authorizationExpiry`, the buyer may call CPP's payer-only `reclaim` (ADR-0003's backstop), which zeroes the authorization. CPP's `void` then reverts with `ZeroAuthorization` (`AuthCaptureEscrow.sol:304-316`).
- **Scenario:** an open deal that nobody closed through the rules contract within the margin. From then on every timeout reverts, so the primary's bond (and the fallback's or appeal adjudicator's) can never be withdrawn.
  - Under D31 this needs nobody to be at fault: with `deliverBy` after the expiry, the rules `reclaim` is still `TooEarly` when CPP already lets the buyer reclaim.
  - T-203's handler had excluded reclaimed holds from the timeout-liveness check.
- **Proof** [measured]:
  - `test/unit/AfterCppReclaim.t.sol`: 7 tests, 5 of which fail with `ZeroAuthorization` on `main`. The other two pin the void after expiry when nobody reclaimed on CPP; a mutant that always skips the void fails them.
  - With the handler corrected, `invariant_timeoutsExactlyWhenDue` fails on `main` with "reclaim: refused when due".
- **Fix:** from the expiry on, `_refundAll` reads CPP's capturable amount and skips `void` when the buyer already took the money. The stage still closes and the bonds are released. Before the expiry nothing can zero the authorization of an open deal, so the common path pays one comparison.

#### M-2. A delivery landed after `deliverBy` beats the reclaim (fixed)

- **Found by:** the adversarial pass, rated medium. The first pass listed it as informational, because T-202 had accepted it (D37 point 1, T-202 difference 5). The rating was raised on its impact.
- **Where:** `HoldbackRules.sol:241-245` and `:385`. In `Held`, `decide` and `earlyAccept` accepted a carried delivery with no `deliverBy` check, while `deliver` has one (`:226`).
- **Scenario:**
  - After `deliverBy`, `reclaim` and a decision carrying the delivery are both valid, and the first to land wins.
  - A seller watching for the buyer's reclaim can win with an accept. A late reject costs the buyer the fee, and a late escalation turns a reclaimable hold into an appeal case.
  - An early accept names only the attempt (L-1), so a seller holding a long-lived early accept can also beat the reclaim with a delivery the buyer never opened.
  - Every other layer refuses a delivery after `deliverBy`: core (`state.ts:275`; an early accept needs `Delivered`, `:498`), the EVM adapter's mirror, and the formal model's `Deliver`.
- **Proof:** `test/unit/LateCarriedDelivery.t.sol`: 7 tests, 4 of which fail on `main` (late accept, reject, escalate and early accept) [measured]. `invariant_timeoutsExactlyWhenDue` also fails any delivery that lands at or after `deliverBy`.
- **Fix:** one check in `_acceptDelivery`. Whichever call lands the delivery (`deliver`, or a decision or early accept carrying it), it must land before `deliverBy`.
  - A seller who delivered in time and expects a slow judge posts `deliver` (61k gas).
  - A buyer who wants late work settles for it with the seller (`mutualSettle`, tested).
  - This amends D37 point 1 and T-202 difference 5.

#### M-3. A sham deal locks a named fallback's or appeal adjudicator's bond (fixed)

- **Found by:** the public-audit cross-check, under the audit class "locking a third party's collateral without its consent". Neither of the first two passes reported it.
  - The first pass considered it and dismissed it as bounded and self-remediable. It believed the victim could free its bond by deciding. That was wrong: a decider's bond stays encumbered until the appeal closes, and the sham deal sets that window too.
- **Where:** `HoldbackRules.sol:529` (`triggerFallback`, open to anyone at `judgeBy`) and `:304` (the primary's escalation). Each called `BONDS.tryEncumber` for an adjudicator who signs nothing at agreement.
- **Scenario:**
  1. One actor holds the buyer, seller and primary keys.
  2. It names a bonded victim as fallback or appeal adjudicator, sets the price to the victim's free bond, and sets every window a century out (D31).
  3. The primary stays silent, and anyone triggers the fallback; or the primary escalates.
  4. The victim's free bond drops to zero. It cannot withdraw, and it cannot be funded as a primary on new deals.
  5. The attacker locks twice the price of its own capital and can release everything at will with a mutual settlement.

  On Sepolia, with faucet tokens, this takes the demo's adjudicator offline at no cost. ADR-0016 §1 says "Sham commitments cannot lock a bond the adjudicator never reserved".
- **Proof** [measured]:
  - `test/unit/BondConsent.t.sol` has 6 tests, ported from the cross-check's cases and extended; 4 of them fail on `main`.
  - A new handler action, `decideFallback`, lets the invariants reach the fallback's own decision. With it, deleting the fallback's reservation fails `invariant_encumberedNotDoubleCounted`. Before the action, no campaign reached that path.
- **Fix:**
  - Nothing is reserved at takeover or escalation.
  - The fallback's own accept or reject encumbers its bond. An uncovered fallback therefore cannot decide, and the deal defaults at `fallbackBy`, as ADR-0016 §1 says (amended accordingly). This closes L-5 for the fallback.
  - An escalation moves no money, so it needs no cover.
  - `HoldbackBonds.tryEncumber` and the appeal flag are gone, and `HoldbackRules` shrinks by about 500 bytes [measured].
- **Residual (T-211).** Deciding is consent, and the reference adjudicator decides every takeover automatically, without reading the deal's windows. A sham deal with a century-long appeal window therefore still locks that adjudicator's bond once the service decides it. T-211 makes the service decline fallback and appeal tasks outside its policy (D29) and check its free bond before signing.
- **Phase 4 tradeoff.** ADR-0007's compensation from a silent fallback's or appeal adjudicator's bond has no reservation to draw on, because a silent adjudicator never consented. This is recorded in the backlog ("Consent for default compensation") and in ADR-0016's amendment.

### 2.3 Low and informational

#### L-1. An early accept names an attempt, not a delivery (both passes)

- **Where:** `HoldbackTypes.sol:194-195, 314-316`; `HoldbackRules.sol:382-387`.
- **Mechanism:** in `Held`, any seller-signed delivery may be carried. In `Delivered`, any seller-signed delivery with the stored attempt is accepted, not necessarily the posted one, because no delivery hash is stored (T-202 decision 3).
- **Scenario:** a seller who signed two deliveries can relay the buyer's early accept with the one the buyer never opened. `JobSubmitted` and `KeyReleased` then name that delivery.
- **Impact:** money and work are unaffected under D32. The buyer opened its envelope from the handed body before signing, so it already holds the content key.
- **Advice:** a buyer should keep `EarlyAccept.expiresAt` short.
- **Proof:** adversarial pass, `test_attack_early_accept_paired_with_another_signed_delivery_after_onchain_deliver` [measured, local].
- **Follow-up:** T-212.

#### L-2. The bond vault credits nominal amounts (first pass)

- **Where:** `HoldbackBonds.sol:53-57, 95-101`.
- **Scenario:** with a fee-on-transfer or negatively rebasing token, the vault credits more than it holds, and the last withdrawer in that token is short. CPP refuses a collection unless the balance delta equals the amount (`AuthCaptureEscrow.sol:418-424`); the vault does not check. Only adjudicators bonding in that token are exposed, and a club can exclude such tokens [inferred].
- **Follow-up:** T-212.

#### L-3. A zero-bond appeal is accepted (adversarial pass)

- **Where:** `HoldbackRules.sol:484-497`.
- **Scenario:** `bond = 0` needs no allowance, and it keeps the first decider's bond encumbered for `appealDecideSec` longer. It is on T-202's difference list (item 9: the rulebook rate is not checked on chain), and a rulebook may set a rate of 0 (D31).
- **Proof:** `test_attack_zero_bond_appeal_accepted_without_allowance` [measured, local].
- **Status:** accepted until Phase 4 brings the rulebook's appeal terms on chain.

#### L-4. The seed commitment is checked on 144 bits, reusably (both passes)

- **Where:** `HoldbackRules.sol:54, 210, 276`.
- **Scenario:** a primary that finds two seeds whose `keccak256` hashes share their low 144 bits (about 2^72 work) has a two-way panel choice on every deal it ever judges, since the tag does not depend on the commitment. Core checks all 256 bits, so off-chain verifiers would see it [inferred].
- **Follow-up:** T-212.

#### L-5. Uncovered fallback and appeal adjudicators still decide (both passes; severity differs)

- **Where:** `HoldbackRules.sol:304, 529`. Takeover recorded `tryEncumber`'s failure, and `decide` never consulted it. A party appeal encumbers nothing on the appeal adjudicator.
- **Conflict:** ADR-0016 §1 says "if either lacks coverage then, the case goes to the default outcome". T-202 Decision 4 and `HoldbackBonds.sol:81` built "if it is free, else nothing", and the role still decided.
- **Severity:** the adversarial pass rated it medium; it stays low here, because no on-chain path pays from any bond yet (I-8).
- **Proof:** `test_attack_fallback_decides_with_no_bond_at_stake` [measured, local].
- **Status:**
  - The fallback's part is fixed by M-3: its own decision must encumber its bond.
  - The appeal adjudicator's coverage is a Phase 4 rule (T-212 item 5).

#### L-6. `authorizationExpiry` ignores `judgeBy` (adversarial pass)

- **Where:** `HoldbackRules.sol:166`.
- **Scenario:** the expiry is `fallbackBy + appealDecideSec + EXPIRY_MARGIN`. A `judgeBy` after it is representable under D31, though contradictory as a schedule, and then the primary's on-time decision cannot capture. M-1's fix keeps the bonds safe in that case.
- **Proof:** `test_attack_d31_deadlines_after_expiry_strand_bonds_and_unpaid_seller` [measured, local].
- **Follow-up:** T-212.

#### L-7. The party a decision favoured can take the only appeal slot (cross-check, PA-L3)

- **Where:** `HoldbackRules.sol:484-497`. `fileAppeal` takes one appeal per commitment from either party, and a zero bond needs no allowance (L-3).
- **Scenario:** the party the decision went for files a free appeal first. The losing party's appeal then reverts with `WrongAppealState(Open)`, and the decision stands. It is low today, because an appeal moves only the appellant's bond. It becomes medium once Phase 4 pays from bonds.
- **Proof:** the cross-check's `AppealSlot.t.sol`, 3 tests [measured, local].
- **Follow-up:** T-212. Admit only the party the decision went against, or give each party its own slot.

#### L-8. A `judgeBy` already past at funding makes the fallback's seed public before the terms are signed (cross-check, PA-L4)

- **Where:** `HoldbackRules.sol:200` and `:255-258`. `agreeAndFund` checks only `offerExpiresAt` and `fundBy`, and the fallback's round is `roundAt(judgeBy)`.
- **Scenario:** with `judgeBy` at or before funding (D31 allows it), that round is already published. The fallback panel's seed is then a function of the terms alone, so whoever writes them can grind the nonce for the panel it wants, and a silent, colluding primary hands the case to that panel. The reference path refuses this shape (`timing.ts` requires `fundBy < judgeBy`), so it takes a buyer who signs such terms directly.
- **Proof:** the cross-check's `KnownSeedFallback.t.sol`, 3 tests [measured, local].
- **Follow-up:** T-212. Refuse at funding when `block.timestamp >= judgeBy`; D31 allows that as self-contradictory. The same check removes the D31 shape behind L-6 for the primary.

#### Informational

Each item gives a label and a disposition.

- **I-1. No fallback without an on-chain `deliver`** [inferred; adversarial pass].
  - `triggerFallback` needs `Delivered` (`:525`). On the two-transaction path, a seller whose primary goes silent can only watch the buyer reclaim, unless it posted `deliver`.
  - So `neutrality.adjudicator-silent-before-judging` holds on chain only for a seller that spent the third transaction. That is the seller's choice under D32.
  - Disposition: documentation, in T-206's Handoff for `docs/neutrality.md`.
- **I-2. A dead branch** [inferred].
  - `MUTUAL_FEE_SHARE_BPS` is a constant 0 (`:70`), so the fee-share capture in `_payOut` (`:464-471`) never runs.
  - Its bytes sit in a contract near the EIP-170 limit. Disposition: T-212 item 6.
- **I-3. EIP-170 headroom** [measured, `forge build --sizes`].
  - `HoldbackRules` runtime was 24,051 bytes at `baac930`. With all five fixes on `main` (`cc834fc`) it is 23,986 bytes, 590 under the limit; M-3 freed the room H-2 and M-2 took.
  - Disposition: record the headroom with each T-212 change.
- **I-4. EIP-7702 accounts** [inferred].
  - Solady sends every address with code to ERC-1271 (`SignatureCheckerLib.sol:90-120`). So a 7702-delegated EOA can sign only if its delegate implements `isValidSignature` for the EOA's key.
  - Disposition: a line in the agent docs (T-206 Handoff).
- **I-5. Appeal rounds follow `block.timestamp`** [guessed; both passes].
  - An escalation or a filing fixes the next beacon round from its block's timestamp.
  - On a chain whose producer can lag timestamps, or with 12-second slots against drand's 3-second period, the round "strictly after" may already be public when the transaction is built.
  - Disposition: part of the D4 chain choice, accepted for Sepolia.
- **I-6. `EXPIRY_MARGIN` has no lower bound** (`:141`) [inferred].
  - With ordered deadlines every capturing deadline ends by `fallbackBy + appealDecideSec`. After M-1 the margin no longer protects bonds.
  - Disposition: 1 day for Sepolia (§7).
- **I-7. Push transfers can block closure** [inferred; adversarial pass].
  - CPP's `void` and the vault's appeal-bond refund push tokens. A recipient the token issuer has frozen (residual 1) makes those paths revert.
  - Disposition: out of scope by Rafa's ruling. The parties choose the token in their terms, and issuer freezes are parked for a roadmap module on assets.
- **I-8. Phase 4 gaps** [inferred].
  - The contract has no overturn payout, no default compensation, no appeal-fee collection and no minimum appeal bond (T-202 difference 9).
  - Disposition: Phase 4, and the clause in §1 is recorded as unmet.
- **I-9. Mutual payouts are not screened** [measured, adversarial pass, local].
  - A co-signed payout to the rules contract or to CPP's TokenStore strands those tokens. A payout to `address(0)` reverts the whole settlement, so nothing is lost.
  - Disposition: accepted. Both parties signed it (D31).
- **I-10. ERC-8183 event names** [inferred].
  - The contract's eight ERC-8183-shaped events (`HoldbackRules.sol:87-97`) are `JobCreated`, `JobFunded`, `JobSubmitted`, `JobCompleted`, `JobRejected`, `JobExpired`, `PaymentReleased` and `Refunded`.
  - The first six match the draft's event names and parameters as listed in the `erc8183` crate's 0.2.0 README (docs.rs). `PaymentReleased` and `Refunded` are not in that list. `ProviderSet` and `BudgetSet` are never emitted, because provider and budget are fixed at creation.
  - The canonical EIP text and the type of `jobId` were not checked. Disposition: backlog row, before Sepolia relies on ERC-8183 indexers.
- **I-11. The formal README's contract column still reads TBD** (`formal/README.md:84-102`) [measured].
  - Disposition: §5 gives the mapping; T-206's Handoff hands the README edit to the `formal/` lane.
- **I-12. `PAIRING_GAS` is fixed forever** (`DrandQuicknetBeacon.sol:65`) [inferred; cross-check PA-L1].
  - 250k is ample on Ethereum, where two pairs cost 102,900. It matters only on a chain that reprices EIP-2537.
  - Disposition: accepted. Another chain gets another beacon contract.
- **I-13. Beacon verification costs more on Sepolia than ADR-0018 says** [measured by the cross-check, `eth_estimateGas`; PA-L2].
  - Fusaka's MODEXP repricing raised `beaconValue` to about 213k gas, from about 159k on Prague.
  - Disposition: a fallback or appeal decision on Sepolia costs more than T-209 measured. Re-measure it on the deployment.

## 3. Checklist

Each item is answered **pass**, **fail** or **n/a**, with the line at `baac930` or a test. Tests are in `contracts/test/` on `main` unless marked "fix PR" or "adversarial pass, local".

### No admin keys (hard rule; ADR-0001, ADR-0003)

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| A1 | No owner, role or owner-style modifier | pass | `HoldbackRules.sol:18-21`. `HoldbackBonds.sol:10-17`: the one privileged caller is `RULES`, the deploying rules contract, an immutable code address. ABI allowlists: `fuzz/NoAdmin.fuzz.t.sol` `test_everyAbi_isItsReviewedAllowlist` [measured] |
| A2 | No pause, freeze or blacklist | pass | No such state or selector; `test_forbiddenSelectors_absentEverywhere_andCallsFail` [measured] |
| A3 | No upgrade proxy; parameters fixed at deploy | pass | Every parameter is `immutable` (`HoldbackRules.sol:72-81`, `HoldbackBonds.sol:17`, `SimBeacon.sol:17`) or a constant (`DrandQuicknetBeacon.sol:18-65`); `invariant_noAdminPath` checks that no code hash changes [measured] |
| A4 | No `SELFDESTRUCT` or `CALLCODE` | pass | Opcode walk over Rules, Bonds, both beacons and CPP: `test_bytecode_noSelfdestruct_delegatecallOnlyInTheFixedClone` [measured] |
| A5 | No mutable `DELEGATECALL` | pass | The same walk finds `DELEGATECALL` only in CPP's fixed TokenStore minimal proxy, and checks that proxy's bytes [measured] |
| A6 | No `receive` or `fallback`; never holds funds | pass, with I-9 | `testFuzz_etherRefused`, `testFuzz_unknownSelector_reverts`, `invariant_noAdminPath` [measured]. A co-signed mutual payout to the rules contract does leave tokens there (I-9) |
| A7 | The beacon cannot be swapped | pass | `BEACON` is immutable (`HoldbackRules.sol:81`). `SimBeacon` refuses any chain but 31337 (`SimBeacon.sol:22-25`, `test_sim_refusesToDeployOffALocalChain`) [measured]. Nothing on chain says which verifier a rules contract trusts, so a deployment must be checked to name `DrandQuicknetBeacon` [inferred] |

### The hold (ADR-0002, ADR-0003, ADR-0012)

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| H1 | No function moves held funds or bonds without a signature, a decision or an expired timeout | pass | CPP is called only from:<br>• `agreeAndFund`: the buyer's collector signature and Agree (`:203-215`)<br>• `_settleDecision`: the adjudicator's signature (`:288`)<br>• `earlyAccept`: the buyer's signature (`:384`)<br>• `_payOut`: both parties' signatures (`:423-424`)<br>• `_refundAll`: timeouts past their deadline (`:506-548`)<br>Bonds move only on those paths, or by an adjudicator's own `withdraw` of free bond. `invariant_noMovementWithoutAuthority` [measured] |
| H2 | Conservation | pass | `invariant_conservation`, `invariant_escrowMatchesState`, `invariant_bondsNeverNegative`, `invariant_encumberedNotDoubleCounted`, `fuzz/Postings.fuzz.t.sol` [measured] |
| H3 | Settle-once; replays refused | pass | One stage word per commitment. Every money path moves the stage out of the funded stages before its first call to CPP or a token. `invariant_settleOnce`, `test_refuses_secondSettle` (decide, early accept, mutual), `test_refuses_replay` [measured]. Holdback-domain nonces are not spent; the stage machine is the replay guard (T-202 difference 11) |
| H4 | Checks-effects-interactions; reentrancy | pass | State is written before every call to CPP or a token. The deal word is written after a vault call in `_firstInstance` (`:303-307`, `:312-317`), `_escalationDecision` (`:322-326`), `_appealDecision` (`:354-357`) and `triggerFallback` (`:529`). The vault is the immutable contract this one deployed, and `release` and `tryEncumber` make no external call, so there is no reentry path [inferred]. CPP has its own transient guard, and the beacon is reached by `staticcall`. The adversarial pass's reentrant payee cannot move funds again [measured, local] |
| H5 | `authorizationExpiry` after the last capture (ADR-0003) | pass, with L-6 | `authorizationExpiry = refundExpiry = fallbackBy + appealDecideSec + EXPIRY_MARGIN` (`:166-178`), after every capturing deadline when deadlines are ordered [inferred]; `test_buyerReclaimOnCppAfterExpiry_needsNoOperator` [measured] |
| H6 | Every funded commitment reaches a terminal state and releases every bond | fail, now fixed | M-1, PR #122 |
| H7 | The key is released in the same transaction as the capture | pass | `_settleDecision` emits `KeyReleased` after the capture (`:336-339`), and so do `earlyAccept` (`:395-400`) and `mutualSettle` (`:435-437`); an accept without a key is refused (`:335`). `test_accept_paysSellerAndFee_andReleasesKeyInTheSameTransaction`, `test_pricetoSeller_feeBack_keyReleased_deliveryCarried`, `test_paysAnySplit_feeBackToBuyer_releasesKey`, `test_refuses_acceptWithoutTheBuyersKey` [measured] |
| H8 | No key on reject or reclaim | fail, now fixed | H-2, PR #125: `invariant_keyOnlyWithPayment` |
| H9 | Agreed deadlines bind every path | fail, now fixed | M-2, PR #127 |
| H10 | Rounding (ADR-0022) | pass | The only rate math is `Money.requirement(price, 10000)` (exact) and `Money.split(fee, 0)` (always 0), each rounding as named; `fuzz/Rounding.fuzz.t.sol` [measured]. No floats and no other division |
| H11 | Fee routing cannot be diverted | pass | `feeReceiver = 0` and `maxFeeBps = 10000` (`:179-181`) leave the recipient to this code: the decider (`:336`, `:341`), nobody on an early accept (`:395-396`), or payout addresses both parties signed (`:452-455`) [inferred]; `test_fallback_decidesWithTheBeaconSeedAtJudgeBy` [measured] |

### Signatures, replay and EIP-712

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| S1 | Domain separation | pass | Solady `EIP712` with name `Holdback`, version `0.6`, chain ID and contract address (`:637-639`), rebuilt if the chain ID changes [inferred from Solady]; core signs the same domain (`packages/core/src/eip712.ts:51`) [measured]; `test_defense_cross_deployment_replay_refused` [measured, adversarial pass, local] |
| S2 | Struct hashes match core byte for byte | pass | `unit/Vectors.t.sol`, from `test_commitmentId_matchesCore` to `test_panelSeed_matchesCore` [measured] |
| S3 | No cross-type replay | pass | Each message type has its own type string (`HoldbackTypes.sol:159-230`); the seller's offer signature is over the CommitmentTerms struct hash [inferred] |
| S4 | No cross-commitment, cross-role or cross-deployment replay | pass | Every struct hash includes the commitment ID; decisions include the role and the adjudicator; the domain includes the deployment [inferred]. `test_refuses_termsChangedAfterSigning`, `test_fallback_refusesThePrimaryAfterTakeover` [measured]; `test_defense_same_address_two_roles_no_cross_role_replay` [measured, adversarial pass, local] |
| S5 | No field the signer controls changes what the message binds | fail, now fixed; L-1 open | H-1, PR #120. L-1 remains (T-212) |
| S6 | Zero-address signers refused; ERC-1271 handled | pass | `isValidSignatureNowCalldata` returns false for signer 0 and uses ERC-1271 for contract signers (`SignatureCheckerLib.sol:85-120`); `test_refuses_missingSignature` [measured]; `test_defense_zero_address_role_cannot_sign` [measured, adversarial pass, local]. EIP-7702 accounts: I-4 |
| S7 | Malleable signatures are harmless | pass | No signature hash is stored or used as an ID; replays are refused by stage [inferred] |
| S8 | A relayer cannot change unsigned fields to its advantage | pass | `f.method` is unsigned, but the collector signature is under the token's or Permit2's own domain (`test_defense_funding_method_swap_refused`) [measured, adversarial pass, local]. A carried `dv` must be seller-signed (L-1) |

### Permissionless triggers and liveness (ADR-0001, ADR-0005, ADR-0007)

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| T1 | Every timeout callable by anyone | pass | `expireOffer`, `reclaim`, `triggerFallback`, `triggerDefault` and `expireAppeal` read no caller (`:502-572`); `unit/Timeouts.t.sol` calls each from an unrelated address; `invariant_timeoutsExactlyWhenDue` [measured] |
| T2 | Each timeout is refused before its deadline and allowed from it, complementary to the deciding call | pass | `<`/`>=` pairs at `deliverBy`, `judgeBy`, `fallbackBy` and both appeal windows; boundary warps in `RulesHandler._warpNear` [measured]. M-2 was the one pair that was not complementary |
| T3 | Every entry point can be relayed | pass | The only `msg.sender` reads are the adjudicator's own `deposit` and `withdraw`, and the vault's `onlyRules` guard [inferred]; the suites relay through an unrelated address [measured] |
| T4 | A halted primary, fallback, appeal adjudicator, buyer or seller does not stop settlement | pass, with I-1 | Fallback at `judgeBy`, default at `fallbackBy` or after the escalation window, appeal expiry, reclaim at `deliverBy`, each in `unit/Timeouts.t.sol` [measured]. A silent primary on a deal with no posted delivery ends in reclaim, not fallback (I-1) |
| T5 | The beacon cannot choose a seed; an unprovable round leads to fallback or default | pass after H-1 | The round is fixed by state (`:255-266`), the value proven by BLS (`DrandQuicknetBeacon.sol:79-87`), the seed recomputed (`:277-284`); `unit/DrandDecide.t.sol`, `unit/DrandBeacon.t.sol` [measured]; the cross-check's encoding tests: one 48-byte encoding verifies per round |
| T6 | No bond is encumbered without its adjudicator's own signature (acceptance) or decision | fail, now fixed | M-3, PR #135: `test/unit/BondConsent.t.sol` |

### ADR conformance

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| D1 | ADR-0003: the rules contract is CPP's operator; `feeReceiver = 0`; a fee-only capture then `void` on reject | pass | `:170-183`, `:341-342`; `test_reject_feeOnlyCaptureThenVoid` [measured] |
| D2 | ADR-0012: the two-sided hold | pass after H-2 | H7, H8 |
| D3 | ADR-0016 §1: an uncovered fallback or appeal adjudicator leads to default | fail | L-5 (the ADR's text against T-202 Decision 4) |
| D4 | ADR-0018: no field the decider controls changes the seed; rounds fixed by state | pass after H-1 | H-1; I-5 |
| D5 | ADR-0022: integer rates, named rounding | pass | H10 |

## 4. Static analysis

Both tools ran over `contracts/src/` at `baac930`: Slither with `--filter-paths "lib/|test/|script/"`, Aderyn with `--src src`. Every high and medium result was triaged by reading the code, and none is a defect.

| Tool | High | Medium | Low | Info |
| --- | --- | --- | --- | --- |
| Slither 0.11.6 | 1 | 16 | 40 | 20 |
| Aderyn 0.6.8 | 3 (11 instances) | — | 8 | — |

[measured]

| Result | Where | Triage |
| --- | --- | --- |
| Slither `arbitrary-send-erc20` (high) | `HoldbackBonds.sol:100` | The `from` is the appellant, which the terms fix as buyer or seller. The call needs that appellant's EIP-712 Appeal signature and runs only from `RULES`. Accepted |
| Slither `incorrect-equality` ×8 (medium) | `decide`, `_appealDecision` | Strict equality on enum stages, not on balances. False positive |
| Slither `reentrancy-no-eth`; Aderyn H-2 | `HoldbackRules.sol:529` | `d.flags` is set after `BONDS.tryEncumber`. The vault is the immutable contract this one deployed, and `tryEncumber` makes no external call, so there is no reentry path. Accepted (H4) |
| Slither `uninitialized-local` ×6 (medium) | `decide`, `_payOut` | Zero-initialised by design (`role`, `round`, the sums). False positive |
| Slither `unused-return` (medium) | `HoldbackRules.sol:464` | The remainder of `Money.split` is computed again as `rest`. Accepted (I-2) |
| Aderyn H-1 `abi.encodePacked` collision ×9 | `HoldbackTypes.sol:171-225` | Every instance concatenates compile-time type strings into a type hash; no input is attacker-chosen. False positive |
| Aderyn H-3 unsafe cast | `SimBeacon.sol:28` | `uint64(t)` truncates only for `t >= 2^64`, and callers pass `uint64` deadlines or `block.timestamp`. Accepted |
| Aderyn L-8 unused constant | `DrandQuicknetBeacon.sol:65` | `PAIRING_GAS` is used at `:84`. False positive |

The low results are:
- `reentrancy-benign` ×4: deal-word writes after the vault calls in H4, with no reentry path;
- `reentrancy-events` ×18: events emitted after external calls;
- `timestamp` ×15, which is by design;
- `missing-zero-check` ×2 on constructor arguments, a deploy-time choice checked at deployment;
- `calls-loop` ×1: `_payOut` over co-signed payouts;
- naming style and literal size.

## 5. Model-to-contract correspondence (T-204)

Every action in `Next` of `formal/Holdback.tla` maps to a contract function [inferred from reading the model's `Next` and the ABI].

| Model action | Contract function |
| --- | --- |
| `Offer`, `AdjAccept`, `Agree`, `Fund` | `agreeAndFund`: the offer, the acceptance and the agree are signatures checked at funding |
| `Deliver` | `deliver`, or carried by `decide` or `earlyAccept` while `Held`. After M-2 every path requires `deliverBy`, as the model's `Deliver` does |
| `DecidePrimary`, `DecideFallback`, `DecideEscalated`, `DecideAppeal` | `decide`, by stage |
| `EarlyAccept` | `earlyAccept` |
| `MutualSettle` | `mutualSettle` |
| `FileAppeal` | `fileAppeal` |
| `Expire` | `expireOffer` |
| `Reclaim` | `reclaim` |
| `TriggerFallback` | `triggerFallback` |
| `TriggerDefault`, `ApplyDefault` | `triggerDefault` (one call; T-204 finding 2) |
| `ExpireAppeal` | `expireAppeal` |
| `TickAbs`, `TickEsc`, `TickAppeal` | `block.timestamp` |
| `Crash` | none: an actor stops (the environment) |
| `OperatorEarlyAccept`, `ReleaseKeyLate` (broken variants only) | none exists [measured: ABI allowlist] |

Gaps:
- The model has no CPP reclaim by the buyer. That is the transition behind M-1, so the model's liveness result did not cover it.
- The model's `DecideAppeal` releases no key, and the contract did (H-2). After the fix, `KeyOnlyWithPayment` also holds in the contract, and an invariant checks it.
- The model's `DecideAppeal` pays the wronged party from the bond; the contract does not yet (I-8).
- The model has no bond coverage. After M-3 the contract reserves the fallback's bond only when the fallback decides, and an uncovered fallback cannot decide. That matches ADR-0016 §1, which the model does not encode (L-5).
- `formal/README.md` lists the contract column as TBD (I-11).

## 6. Where the passes disagreed

| Item | First pass (Opus) | Adversarial pass (Fable) | Recorded |
| --- | --- | --- | --- |
| H-2 key to a refunded buyer | Low at first (the adjudicator holds the key anyway), then raised once the reference adjudicator was found to attach it on the honest path | High | High: on chain, the honest path breaks the hold for the seller |
| H-2 fix | The adjudicator service first, since the calldata carries the key regardless; a contract refusal for the record | A contract refusal (release only when `Released`), or pay the seller from the bond now | The contract refusal now (#125: one rule in `decide`, after the per-PR review found the reject paths too); the adjudicator (T-211) and SimChain (T-210) next; the bond payout stays in Phase 4 |
| M-2 late delivery | Informational, as T-202 accepted it (D37) | Medium, and the early accept may stay as the buyer's waiver | Medium, fixed on every path, the early accept included. The per-PR review showed every other layer refuses it, and L-1 makes a late carried early accept unsafe |
| L-5 uncovered deciders | Low | Medium | Low: no on-chain path pays from any bond yet. M-3 fixes the fallback's part |
| M-3 sham-deal bond lock | Considered and dismissed: the victim was assumed able to decide its way out, which is wrong | Not reported | Medium (found by the public-audit cross-check), fixed |
| A second M-1 fix (derive the expiry from every deadline) | Not proposed | Proposed | Split out as L-6, a `PaymentInfo` change with mirrors outside the contract |
| L-2 bond vault crediting | Found | Not reported | Low |
| I-1, I-7, I-9, L-3, L-6 | Not reported | Found | As listed |

## 7. Open items for Rafa

1. **Cross-family review (gate, not done).**
   - Only Anthropic models were reachable: the environment exposes no other provider's key by name, and `.env*` files were not read.
   - To close the "two model families" criterion, a reviewer from another family (an OpenAI or Google model, for example) reviews `contracts/src/` at `baac930` and the five fix PRs, without this document. The brief is in T-206's Handoff.
   - Its findings are appended here, with the disagreements, before Phase 2 is called done.
2. **Read this review** (task gate 1).
3. **Sepolia (approved; deploy pending).**
   - Rafa approved a Sepolia deployment (T-206 Decisions 7).
   - It runs once the five fixes are merged with `forge test` green on `main`.
   - The cross-check against public escrow audits, which Rafa set as a gate, has reported with no high or medium finding against the contracts' use of their dependencies or the beacon.
   - What it deploys: `DrandQuicknetBeacon` as the beacon (A7), `EXPIRY_MARGIN` of 1 day (86,400 s), the core set only, and no token.
   - EIP-2537 is live on Sepolia [measured]: `MAP_FP_TO_G1` returns a G1 point for a field element, and malformed input gets `PrecompileError`.
   - Before the public demo relies on Sepolia: until T-211 lands, the reference adjudicator's overturn-to-accept appeals revert there (H-2).
