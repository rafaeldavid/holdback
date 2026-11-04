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
| Public-audit cross-check | A separate Claude Opus 5.5 session (per its commit trailers), with a Claude Fable 5.1 red team | Compared the contracts, class by class, with published audits: Commerce Payments' six, Permit2, Solady, USDC/ERC-3009, Kleros, UMA, Reality.eth, Sablier, Superfluid, and BLS verifiers. In the contracts it found M-3, L-7, L-8, I-12 and I-13. Outside them it found PA-M2 (medium, the operator-fee bundle front-run in the EVM adapter, mitigated in PR #138, merged). Its report and tests are in PR #137 |
| Per-PR review | Claude Opus 5.5, reviewer role, briefed with the project context | Each fix PR and this report, until PASS |
| Cross-family pass | DeepSeek `deepseek-v4-pro` (reasoning on) | Five narrow parts at `2342756`, each with a project primer and only the code it needs. No review text or finding ID reached it, but its questions pointed at known findings (§8 Limits). Its answers are verbatim in `2026-11-03-contract-review-deepseek.md` |

With the DeepSeek pass, the task's "two model families" criterion is met, Anthropic and DeepSeek [inferred]. The model DeepSeek served was `deepseek-v4-pro` [measured]. §8 Limits says where its agreement was prompted.

**Baseline.**
- `forge test`: 168 tests pass at `baac930`; 143 on `main` after PR 113 removed redundant tests [measured].
- Slither 0.11.6 and Aderyn 0.6.8 over `contracts/src/` (§4) [measured].

## 1. Verdict

**What holds.**
- The no-admin rule holds without exception: no owner, role, pause, freeze, blacklist or proxy; no `SELFDESTRUCT`, `CALLCODE` or Holdback `DELEGATECALL`; every parameter immutable or constant; every timeout open to anyone [measured].
- Signatures are domain-separated, byte-compatible with core, and bound to the commitment and the role [measured].
- The stage machine refuses every replay [measured].
- Every money path writes the stage before its first call to CPP or a token. The deal word is sometimes written after a call to the bond vault, but only after `release` or `encumber`, which make no external call (H4) [inferred].

**What broke a litmus test.** Five findings, each fixed in its own PR with regression tests that fail on `main`. H-1 and H-2 each have a part outside the contract, in core's state machine and the reference adjudicator (T-210, T-211).
- **H-1:** the appeal adjudicator could choose its panel seed through the unchecked `attempt` (defended judgment).
- **H-2:** a decision could release the content key to a refunded buyer (the hold).
- **M-1:** a buyer's own CPP reclaim stranded every encumbered bond forever (neutrality, the hold).
- **M-2:** a delivery landed after `deliverBy` could beat the buyer's reclaim (the hold).
- **M-3:** a sham deal could lock a named fallback's or appeal adjudicator's bond, which that adjudicator never consented to (neutrality).

The public-audit cross-check found no high or medium issue against our use of CPP, Permit2, Solady or USDC, and none in the drand verifier. Its one medium outside the contracts, PA-M2 (the operator-fee bundle front-run), is in the EVM adapter; its mitigation merged in PR #138 [measured by the cross-check; PR #137].

**What blocks what.**
- Rule for this review: low findings block mainnet, not the Sepolia testnet.
- The cross-family review is done (DeepSeek, §8) and found no new high or medium. Rafa's read still gates calling Phase 2 done (§7).
- "Appeals are backed by the adjudicator's bond" was **not met on chain**: no on-chain path paid anyone from an adjudicator's bond, and an appeal moved only the appellant's bond (I-8). As an unmet mandatory clause, I-8 blocked mainnet (§8). **Update (D43, T-212):** an overturn now pays the wronged party the price from the first decider's bond, and only the losing party may appeal (L-7). The clause is met for party appeals; the rest of I-8 (default compensation, the appeal fee, a minimum appeal bond) stays Phase 4.

## 2. Findings

| ID | Severity | Finding | Litmus test | Label | Status |
| --- | --- | --- | --- | --- | --- |
| H-1 | high | The appeal adjudicator chooses its panel seed through `attempt` | judgment | measured | fixed, PR #120 (merged); core in T-210 |
| H-2 | high | A decision can release the key to a refunded buyer | hold | measured | fixed in the contract, PR #125 (merged); reference adjudicator in T-211, SimChain in T-210 |
| M-1 | medium | A buyer's CPP reclaim strands every encumbered bond | neutrality, hold | measured | fixed, PR #122 (merged) |
| M-2 | medium | A delivery landed after `deliverBy` beats the reclaim | hold | measured | fixed, PR #127 (merged) |
| M-3 | medium | A sham deal locks a named fallback's or appeal adjudicator's bond | neutrality | measured | fixed, PR #135 (merged); reference adjudicator residual in T-211 |
| L-1 | low | An early accept, and a decision (§8), names an attempt, not a delivery | hold (record) | measured | T-212 item 3; the adjudicator's check in T-211 and T-213 |
| L-2 | low | The bond vault credits nominal amounts | neutrality | inferred | T-212 item 1 |
| L-3 | low | A zero-bond appeal is accepted | judgment | measured | accepted until Phase 4 |
| L-4 | low | The seed commitment is checked on 144 bits, reusably | judgment | inferred | T-212 item 2 |
| L-5 | low, medium since D43 | Uncovered fallback and appeal adjudicators still decide | judgment | measured | the fallback's part fixed by M-3; the appeal adjudicator's in T-212 item 5, which now blocks mainnet |
| L-6 | low | `authorizationExpiry` ignores `judgeBy` | hold | measured | T-212 item 4 |
| L-7 | low | The party a decision favoured can take the only appeal slot | judgment | measured | fixed with the overturn payout (D43, T-212 item 7) |
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
  4. The buyer ends with the refund and the work. The seller ends with neither, because the overturn payout from the first adjudicator's bond is Phase 4 on chain (SimChain pays it). Since D43 the contract pays the seller the price from that bond.

  This breaks ADR-0012 ("on rejection or reclaim, the key is never released to the buyer") and the formal model's `KeyOnlyWithPayment` (`formal/Holdback.tla:463-465`).
- **Proof:**
  - `test/unit/AppealKey.t.sol`: 7 tests, 6 of which fail on `main` [measured]. The failures are the key-carrying refusals (overturned reject, upheld reject, overturned accept, first-instance reject, escalated reject) and the recovery test. Only `test_upheldAccept_releasesTheKey`, ADR-0012's wrong-key ground after an accept, passes on both.
  - `invariant_keyOnlyWithPayment` reaches the path through the handler's `decideAppeal` action. It fails on `main` for some seeds, for example `--fuzz-seed 2`, and passes for others; the unit tests above are the reproducible proof [measured].
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
  5. The attacker ties up about twice the price of its own capital: the hold, plus its primary's bond until the takeover. It can release everything at will with a mutual settlement.

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
- **Decisions too** (cross-family pass, §8): `Decision` also names the attempt, not the delivery, and the judgment record carries no delivery hash. A decision about one seller-signed delivery can be settled with another. An adjudicator that judged a body the seller never signed would not notice, so the adjudicator checks the seller's signature on what it judges.
- **Follow-up:** T-212 item 3, for both messages and the judgment record's delivery hash; T-211 and T-213 for the adjudicator's check.

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
- **Severity:** the adversarial pass rated it medium; it stays low here, because no on-chain path pays from any bond yet (I-8). Since D43 an overturn pays from the first decider's bond, but still never from the appeal adjudicator's. An appeal adjudicator with no bond and no fee on chain can now move the price out of the primary's bond. The primary consents to that adjudicator by signing an acceptance of terms that name it, and the reference adjudicator will decline terms whose fallback or appeal adjudicator it does not trust (T-212 item 3's PR). Both the PR #160 reviewer and its DeepSeek pass flagged this (DeepSeek rated it high). **Re-rated medium (D43):** consent bounds it for a careful primary, but litmus test 3 wants the appeal adjudicator bonded too, so T-212 item 5 now blocks mainnet.
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
- **Proof:** the cross-check's `AppealSlot.t.sol`, 3 tests [measured by the cross-check; PR #137].
- **Follow-up:** T-212. Admit only the party the decision went against, or give each party its own slot.
- **Status:** fixed with the overturn payout (D43), which raised it to medium. `fileAppeal` admits only the party the decision went against, and core refuses the other party's appeal too. `AppealSlot.t.sol` now pins the refusal; what is left is L-3's lock extension by the losing party's zero-bond appeal.

#### L-8. A `judgeBy` already past at funding makes the fallback's seed public before the terms are signed (cross-check, PA-L4)

- **Where:** `HoldbackRules.sol:200` and `:255-258`. `agreeAndFund` checks only `offerExpiresAt` and `fundBy`, and the fallback's round is `roundAt(judgeBy)`.
- **Scenario:** with `judgeBy` at or before funding (D31 allows it), that round is already published. The primary can never decide, so the case goes to the fallback, with a seed the terms' author picked by grinding the nonce. The reference path refuses this shape (`timing.ts` requires `fundBy < judgeBy`), so it takes a buyer who signs such terms directly.
- **Proof:** the cross-check's `KnownSeedFallback.t.sol`, 3 tests [measured by the cross-check; PR #137].
- **Follow-up:** T-212. Refuse at funding when `block.timestamp >= judgeBy`; D31 allows that as self-contradictory.

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
  - Disposition: Phase 4, and the clause in §1 is recorded as unmet; it blocks mainnet (§1, §8).
  - **Update (D43):** the overturn payout is built (`_appealDecision`, `HoldbackBonds.slash`; `OverturnPayout.t.sol` and `invariant_overturnPaysFromTheBond`), so the §1 clause is met for party appeals. Default compensation, the appeal fee and a minimum appeal bond stay Phase 4. With the payout live, a free appeal can win the price from the decider's bond, so the minimum appeal bond now blocks mainnet (D43).
- **I-9. Mutual payouts are not screened** [measured, adversarial pass, local].
  - A co-signed payout to the rules contract or to CPP's TokenStore strands those tokens. A payout to `address(0)` reverts the whole settlement, so nothing is lost.
  - Disposition: accepted. Both parties signed it (D31).
- **I-10. ERC-8183 event names** [inferred].
  - The contract's eight ERC-8183-shaped events (`HoldbackRules.sol:87-97`) are `JobCreated`, `JobFunded`, `JobSubmitted`, `JobCompleted`, `JobRejected`, `JobExpired`, `PaymentReleased` and `Refunded`.
  - The first six match the draft's event names and parameters as listed in the `erc8183` crate's 0.2.0 README (docs.rs). `PaymentReleased` and `Refunded` are not in that list. `ProviderSet` and `BudgetSet` are never emitted, because provider and budget are fixed at creation.
  - The canonical EIP text and the type of `jobId` were not checked. Disposition: backlog row, before Sepolia relies on ERC-8183 indexers.
- **I-11. The formal README's contract column still reads TBD** (`formal/README.md:84-102`) [measured].
  - Disposition: §5 gives the mapping; T-206's Handoff hands the README edit to the `formal/` lane.
- **I-12. `PAIRING_GAS` is fixed forever** (`DrandQuicknetBeacon.sol:65`) [inferred; cross-check PA-L1, PR #137].
  - 250k is ample on Ethereum, where two pairs cost 102,900. It matters only on a chain that reprices EIP-2537.
  - Disposition: accepted. Another chain gets another beacon contract.
- **I-13. Beacon verification costs more on Sepolia than ADR-0018 says** [measured by the cross-check, `eth_estimateGas`; PA-L2, PR #137].
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
| T5 | The beacon cannot choose a seed; an unprovable round leads to fallback or default | pass after H-1 | The round is fixed by state (`:255-266`), the value proven by BLS (`DrandQuicknetBeacon.sol:79-87`), the seed recomputed (`:277-284`); `unit/DrandDecide.t.sol`, `unit/DrandBeacon.t.sol` [measured]; the cross-check's encoding tests show one 48-byte encoding verifies per round [measured by the cross-check; PR #137] |
| T6 | No bond is encumbered without its adjudicator's own signature (acceptance) or decision | fail, now fixed | M-3, PR #135: `test/unit/BondConsent.t.sol` |

### ADR conformance

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| D1 | ADR-0003: the rules contract is CPP's operator; `feeReceiver = 0`; a fee-only capture then `void` on reject | pass | `:170-183`, `:341-342`; `test_reject_feeOnlyCaptureThenVoid` [measured] |
| D2 | ADR-0012: the two-sided hold | pass after H-2 | H7, H8 |
| D3 | ADR-0016 §1: an uncovered fallback or appeal adjudicator leads to default | fail at `baac930`; the fallback's part fixed | M-3, PR #135 (ADR-0016 amended); the appeal adjudicator's part open (L-5, T-212 item 5) |
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
- The model's `DecideAppeal` pays the wronged party from the bond; the contract did not (I-8) until D43, and now does.
- The model has no bond coverage. After M-3 the contract reserves the fallback's bond only when the fallback decides, and an uncovered fallback cannot decide. That matches ADR-0016 §1, which the model does not encode (L-5).
- `formal/README.md` lists the contract column as TBD (I-11).

## 6. Where the passes disagreed

| Item | First pass (Opus) | Adversarial pass (Fable) | Recorded |
| --- | --- | --- | --- |
| H-2 key to a refunded buyer | Low at first (the adjudicator holds the key anyway), then raised once the reference adjudicator was found to attach it on the honest path | High | High: on chain, the honest path breaks the hold for the seller |
| H-2 fix | The adjudicator service first, since the calldata carries the key regardless; a contract refusal for the record | A contract refusal (release only when `Released`), or pay the seller from the bond now | The contract refusal now (#125: one rule in `decide`, after the per-PR review found the reject paths too); the adjudicator (T-211) and SimChain (T-210) next; the bond payout stays in Phase 4 |
| M-2 late delivery | Informational, as T-202 accepted it (D37) | Medium, and the early accept may stay as the buyer's waiver | Medium, fixed on every path, the early accept included. The per-PR review showed every other layer refuses it, and L-1 makes a late carried early accept unsafe |
| L-5 uncovered deciders | Low | Medium | Low: no on-chain path pays from any bond yet. M-3 fixes the fallback's part. Since D43 an overturn pays from the first decider's bond, still never from the appeal adjudicator's (see L-5) |
| M-3 sham-deal bond lock | Considered and dismissed: the victim was assumed able to decide its way out, which is wrong | Not reported | Medium (found by the public-audit cross-check), fixed |
| A second M-1 fix (derive the expiry from every deadline) | Not proposed | Proposed | Split out as L-6, a `PaymentInfo` change with mirrors outside the contract |
| L-2 bond vault crediting | Found | Not reported | Low |
| I-1, I-7, I-9, L-3, L-6 | Not reported | Found | As listed |

## 7. Open items for Rafa

1. **Cross-family review: done (§8).** Rafa asked for it on DeepSeek ("Can you use the deepseek API token to do the review? You'll have to prompt it with full context of the project"). It found no new high or medium.
2. **Read this review** (task gate 1).
3. **Sepolia (approved; deployed, PR #150).**
   - Rafa approved a Sepolia deployment (T-206 Decisions 7).
   - It runs once the five fixes are merged with `forge test` green on `main`.
   - Rafa set the cross-check against public escrow audits as a gate, and it has reported (PR #137):
     - no high or medium finding against the contracts' use of their dependencies, or in the beacon;
     - M-3, now fixed;
     - PA-M2, the operator-fee bundle front-run, which is outside `contracts/src`; its mitigation merged in PR #138.
   - What it deploys: the core set, with `DrandQuicknetBeacon` as the beacon (A7) and `EXPIRY_MARGIN` of 1 day (86,400 s). The token is chosen by the Sepolia demo session: its TestUSDC goes in with the core set if PR #138 is on `main` when the deploy runs (T-206 Decisions 7).
   - EIP-2537 is live on Sepolia [measured]: `MAP_FP_TO_G1` returns a G1 point for a field element, and malformed input gets `PrecompileError`.
   - Before the public demo relies on Sepolia: until T-211 lands, the reference adjudicator's overturn-to-accept appeals revert there (H-2).

## 8. Cross-family pass (DeepSeek)

**Who and how.**
- DeepSeek `deepseek-v4-pro`, reasoning on, reviewed `contracts/src/` at `2342756`, the commit deployed on Sepolia, on 2026-11-03.
- It was called through the project's OpenAI-compatible key, loaded with `node --env-file`; the file itself was not read.
- No review text and no finding ID reached it [measured: a grep of its prompts]. It was not blind to the findings, though (Limits).
- Its answers are verbatim in [`2026-11-03-contract-review-deepseek.md`](2026-11-03-contract-review-deepseek.md). The model's own labels are kept; it could not run code.
- Three earlier runs returned no review text [measured: `finish: length`, empty answer]:
  - the whole project, about 72K tokens, with a 32K output budget;
  - the same with 64K;
  - a beacon-only run, 27.7K prompt tokens with 64K.

  Each spent its whole output on reasoning. A fourth connection dropped mid-stream.
- The pass that answered ran in five narrow parts. Each had a one-page project primer, one question set and only the code it needs:
  - the beacon's point handling;
  - the beacon's hash to curve, pairing and failures;
  - the hold;
  - judgment and bonds;
  - signed messages.

  All five finished normally, taking 225 to 399 s each [measured: `finish: stop`].

**Result.** DeepSeek's claims were checked against the code and this review [inferred unless marked]. The PR 155 reviewer then probed the overturn, late-accept and carried-delivery paths in forge [measured, scratch tests].
- No new high or medium.
- Of DeepSeek's two highs:
  - one is I-8;
  - the other, the decision-to-delivery binding, is new and triaged low, extending L-1.
- Its two mediums are an ADR-0018 deferral and, in part, L-6.
- The rest are known, deliberate or informational.
- On the drand verifier it passed all fifteen checklist items, the open gate from the PR 77 review (backlog). Its one caveat was that the public key could not be checked from the code, and the Sepolia deploy closes that. It also flagged one unreachable non-canonical case.

| DeepSeek item | Its severity | Triage | Recorded as |
| --- | --- | --- | --- |
| An overturning appeal does not pay the wronged party from the first adjudicator's bond (`HoldbackRules.sol` `_appealDecision`) | high | True, and known; nothing worse [measured: an overturned accept, an overturned reject and an overturned fallback accept each end with CPP at 0, no bond encumbered and nothing stuck]. The wronged party simply gets nothing. The code says "the overturn payout from the adjudicator's bond is Phase 4" | I-8 (T-202 difference 9; the §1 clause recorded as unmet). It blocks mainnet (below). Since fixed (D43) |
| A decision is not bound to the delivery: `decisionHash` names the attempt, not the delivery hash | high | True in mechanism. On chain only the seller can pair a decision with another delivery [measured: in `Held` a carried delivery signed by anyone but the seller reverts, and in `Delivered` the carried delivery is ignored]. Money is unaffected. But the off-chain record does not close the gap: the judgment record carries no delivery hash (`judgment.schema.json`), and `encryptedKeysHash` is the escalation envelope, not the delivery's keys. An adjudicator handed an unsigned body by an operator would sign a decision that a relayer could settle against the seller's real delivery [inferred]. So the adjudicator must check the seller's signature on what it judges | Low, extending L-1 to decisions. T-212 item 3 now covers both, with the judgment record's delivery hash in the same schema decision. The adjudicator's check goes to T-211 and T-213 (T-206 Handoff) |
| The primary chooses its own seed through its seed commitment | medium | Real and tracked, but deferred rather than settled. ADR-0018 lists mixing the beacon into the primary's seed under "Not adopted" as a later decision, bounded by calibration and appeal. Until Phase 4 an overturning appeal moves no money (I-8, measured above), so on chain the bound is calibration and the parties' choice of primary. This row and the I-8 row each rely on the other. Since D43 an overturn pays from the primary's bond, which restores the appeal bound ADR-0018 relies on | ADR-0018 (Not adopted); backlog row on the colluding primary (before open clubs) |
| `authorizationExpiry` does not bound every capture deadline | medium | Two items. (a) `judgeBy` after `fallbackBy` is L-6. (b) An early-accept or mutual `expiresAt` past `authorizationExpiry` can happen even with ordered deadlines. That is by design (T-202 difference 15), and T-212 item 4 does not touch it. Both are bounded [measured: a late early accept reverts, the buyer reclaims on CPP, and the fallback and default calls close the deal] | (a) L-6, T-212 item 4. (b) T-202 difference 15, no change |
| `mutualSettle` can release the key with nothing paid to the seller | medium/info | Deliberate. The seller co-signs the payouts and `releaseKey` (ADR-0012; ADR-0019; `KeyOnlyWithPayment` in the formal model sets no payout condition). DeepSeek's medium followed the primer's wording, "the key is released only with payment to the seller" | No change |
| A direct escrow reclaim leaves the rules contract's state stale | low/info | Fixed. `_refundAll` closes a deal whose hold the buyer reclaimed | M-1 (#122) |
| A token callback during `takeAppealBond` can re-enter before the appellant's bond arrives | low | Net zero, as DeepSeek also says. A re-entrant `expireAppeal` is impossible, because filing needs `now < appealBy` and expiring needs `now ≥ appealBy + appealDecideSec`. A re-entrant `decide` needs the next round already public (I-5). Even then, either the outer `transferFrom` completes or the transaction reverts. It needs a callback token the parties chose | Informational; the review's token class (L-2) |
| Appeal and escalation adjudicators can act unbonded | low/medium | True, and known | L-5 (T-212 item 5) |
| A zero-bond appeal takes the only slot | low | True, and known | L-3, L-7 |
| A y = 0 root with the sign bit set gives y = p, a non-canonical point | info | Unreachable [measured by script: the group order h·r is odd, and −4 is not a cube mod p, so x³ + 4 = 0 has no root] | No change |
| The quicknet public key cannot be checked from the code alone | info | Checked [measured]. The deploy verified drand round 1000 on Sepolia with this key, using the real fixture signature (`drand-quicknet.json`), and `sepolia.json` records its published randomness. The tests use seven real rounds | No change |
| The escalation and appeal rounds follow the escalating or appealing transaction's timestamp | info | Known. With 12-second slots against drand's 3-second period, the next round may already be public when the transaction is built | I-5 (accepted for Sepolia) |
| Terms are signed over the raw commitment ID; there is no zero-signer check | info | Safe today, as DeepSeek says. The ID is the `CommitmentTerms` struct hash, and Solady rejects a recovered zero address | No change |

**Where DeepSeek and this review disagree on severity.**

| Item | DeepSeek | This review | Kept |
| --- | --- | --- | --- |
| No overturn payout | High: it breaks "appeals are backed by the bond" | A documented Phase 4 gap, filed as informational | I-8, and it **blocks mainnet**. It is an unmet clause of litmus test 3, a mandatory rule, so the rule that informational items do not block mainnet does not apply to it. Rafa may raise its severity. Since fixed (D43) |
| Decision not bound to the delivery | High | Low: on chain it needs seller equivocation, and money is unaffected | Low, with L-1, plus the adjudicator's signature check (T-211, T-213) |
| The primary chooses its seed | Medium | Deferred (ADR-0018, Not adopted) | ADR-0018 and the backlog row; on chain until Phase 4, bounded only by calibration and the parties' choice of primary |
| The expiry bound | Medium | Low (a) and by design (b) | L-6; T-202 difference 15 |

**Limits.**
- **Not blind.** The question sets were written by the session that held these findings, and most of them point at known items:
  - the hold questions on expiry and reclaim (L-6, M-1) and on the key (H-2);
  - the judgment questions on the delivery (L-1), on a message field the seed hashes (H-1), on the appeal slot and the payout (L-7, I-8), and on bond consent (M-3).

  The primer also stated three properties the code deliberately lacks in Phase 2: an overturn payout from the bond, bonded appeal adjudicators, and the key only with payment, even in a mutual settlement. Those produced the I-8 high, the L-5 row and the mutual-key medium. So DeepSeek's agreement on those items was prompted, not independent. What it adds:
  - the verifier checklist;
  - the decision-to-delivery binding, new to this review, though the delivery question invited it;
  - the absence of other findings in the code it read.
- The PR 155 reviewer's forge probes are scratch tests, not in the repository (`reports/scratch/review-155/` in the T-206 worktree).
- DeepSeek read the code; it did not run it.
- The triage above is a reading of the code and the docs, except where marked measured.
- `deepseek-v4-pro` is a provider alias with no dated snapshot (`config/judges-live.yaml`).
- The pass checked the verifier's logic. It did not check that geth, reth and revm agree on `MAP_FP_TO_G1`'s cofactor clearing, beyond the round verified on Sepolia's RPC.

**Follow-up pass on PR #160 (2026-11-03, D43).** DeepSeek `deepseek-v4-pro` reviewed the overturn payout and the appeal slot as one narrow part: the same primer, six open questions, both contracts in full and excerpts of SimChain, core, the adapter and the event schema (`reports/scratch/deepseek/parts/overturn.*` in the T-206 worktree; finish `stop`, 186 s) [measured]. The questions named no finding. Triage [inferred unless marked]:

| DeepSeek said | Triage |
| --- | --- |
| High: the appeal adjudicator is never bonded, yet now moves bond money | L-5. Re-rated medium; T-212 item 5 blocks mainnet (above). The primer's "fallback and appeal adjudicators are bonded" invited it |
| Medium: zero-cost appeals | L-3, and D43's free-appeal bullet; a minimum appeal bond blocks mainnet |
| Medium: no appeal fee to the appeal adjudicator | I-8's remaining gap, Phase 4 |
| Medium: an overturn from reject to accept cannot release the key | Deliberate: H-2 and ADR-0012 (no key on a deal that stands Refunded; the seller is paid from the bond, not the buyer's money). SimChain still releases it; T-210 mirrors H-2 there |
| Payout recipient, source and once-only; bond accounting across role overlaps and price 0; the appeal restriction takes no legitimate appeal; adapter event order and schema | Pass. Its one caveat, `Money.requirement(price, 10000)` against `price`, is exact: `mulDivUp` with equal numerator and denominator [inferred from `HoldbackTypes.sol:431`] |
