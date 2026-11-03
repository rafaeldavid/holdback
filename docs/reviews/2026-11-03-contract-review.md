# Contract review: Phase 2 settlement contracts (2026-11-03)

T-206. Review of `contracts/src/` at `main` `baac930`:
- `HoldbackRules`;
- `HoldbackBonds`;
- `HoldbackTypes`, with the `Money` library;
- `IHoldbackBeacon`, `SimBeacon` and `DrandQuicknetBeacon`;
- how `HoldbackRules` drives Commerce Payments' `AuthCaptureEscrow` v1.1.0 (vendored at `6b0a5ef3`, unmodified, audited separately).

Nothing was deployed. Everything ran on Foundry's in-process EVM and on local anvil. Labels: **measured** (a test or a tool run shows it), **inferred** (from reading the code), **guessed**. Line numbers refer to `baac930`.

**Reviewers.**

| Pass | Model | How |
| --- | --- | --- |
| Checklist and code review | Claude Opus 5.5 (`claude-opus-5-5`) | The checklist in §3, the T-204 mapping, static analysis, the regression tests and the fixes |
| Adversarial pass | Claude Fable 5.1 (`claude-fable-5-1`), red-teamer role, max effort | Had the code and design docs but not the first pass's notes; wrote 24 proof-of-concept tests in its own worktree |
| Cross-family pass | not run | No non-Anthropic model is reachable from this environment; human gate for Rafa (§7) |

Both passes are Anthropic models, so the task's "two model families" criterion is **not met** yet.

**Baseline.**
- `forge test`: 168 tests pass at `baac930`. After PR 113 removed redundant tests, `main` has 147 [measured].
- Slither 0.11.6 and Aderyn 0.6.8 over `contracts/src/` (§4) [measured].

## 1. Verdict

**What holds.**
- The no-admin rule holds without exception: no owner, role, pause, freeze, blacklist or proxy; no `SELFDESTRUCT`, `CALLCODE` or Holdback `DELEGATECALL`; every parameter immutable or constant; every timeout open to anyone [measured].
- Signatures are domain-separated, byte-compatible with core, and bound to the commitment and the role [measured].
- The stage machine refuses every replay, and state changes come before every external call [measured, inferred].

**What broke a litmus test.** Four findings, each fixed in its own PR with a regression test that fails on `main`:
- **H-1:** the appeal adjudicator could choose its panel seed through the unchecked `attempt` (defended judgment).
- **H-2:** an overturned rejection released the content key to a refunded buyer (the hold).
- **M-1:** a buyer's own CPP reclaim stranded every encumbered bond forever (neutrality, the hold).
- **M-2:** a delivery carried by a decision after `deliverBy` beat the buyer's reclaim (the hold).

H-1 and H-2 each have a half outside the contract, in core's state machine and in the reference adjudicator. Both are follow-ups (T-210, T-211).

**What does not block, and what does.**
- The low and informational items do not block a testnet deployment.
- The missing cross-family review does block it (§7).
- Until Phase 4 the bond model is custody only: no on-chain path pays anyone from an adjudicator's bond (I-8). On chain, "appeals backed by the adjudicator's bond" holds only through the appellant's bond.

## 2. Findings

| ID | Severity | Finding | Litmus test | Label | Status |
| --- | --- | --- | --- | --- | --- |
| H-1 | high | The appeal adjudicator chooses its panel seed through `attempt` | judgment | measured | fixed, PR #120; core follow-up T-210 |
| H-2 | high | An overturned rejection releases the key to a refunded buyer | hold | measured | fixed in the contract, PR #125; adjudicator T-211, SimChain T-210 |
| M-1 | medium | A buyer's CPP reclaim strands every encumbered bond | neutrality, hold | measured | fixed, PR #122 |
| M-2 | medium | A carried delivery after `deliverBy` beats the reclaim | hold | measured | fixed, PR #127 |
| L-1 | low | An early accept names an attempt, not a delivery | hold (record) | measured | T-212 item 3 |
| L-2 | low | The bond vault credits nominal amounts | neutrality | inferred | T-212 item 1 |
| L-3 | low | A zero-bond appeal is accepted | judgment | measured | accepted until Phase 4 |
| L-4 | low | The seed commitment is checked on 144 bits, reusably | judgment | inferred | T-212 item 2 |
| L-5 | low | Uncovered fallback and appeal adjudicators still decide | judgment | measured | T-212 item 5 |
| L-6 | low | `authorizationExpiry` ignores `judgeBy` | hold | measured | T-212 item 4 |
| I-1 to I-11 | info | §2.3 | | | |

### 2.1 High

#### H-1. The appeal adjudicator chooses its panel seed through `attempt` (fixed)

- **Found by:** both passes.
- **Where:** `HoldbackRules.sol:270-279`. `_firstInstance` checked `m.attempt == d.attempt` (`:300`) for the primary and the fallback; the appeal paths (`_escalationDecision`, `:321`, and `_appealDecision`, `:350`) did not. The seed check is `m.seed == panelSeed(id, role, m.attempt, beaconValue)` (`:279`; `HoldbackTypes.sol:419-422`).
- **Attack:**
  1. After an escalation or a party appeal, the appeal adjudicator reads the work.
  2. It computes the panel for each `attempt` from 0 to 255.
  3. It runs the judges and signs the attempt whose panel gives the outcome it wants.
  4. The contract accepts it, and the decision is final (residual 7).

  ADR-0018 estimates that 50 random seeds reach any chosen panel of a 6-entry registry 94% of the time.
- **Proof** (`test/unit/AppealAttempt.t.sol`) [measured]:
  - `test_afterEscalation_refusesASeedFromAnotherAttempt` and `test_afterPartyAppeal_refusesASeedFromAnotherAttempt` settle on `baac930` and revert with `InvalidMessage` after the fix.
  - The primary and fallback attempt tests pin the check for every role: limiting the check to the appeal role fails three tests.
  - The adversarial pass's `test_attack_appeal_attempt_gives_256_valid_seeds` reproduces the attack.
- **Fix:** `decide` compares the attempt for every role.
- **Follow-up T-210:** `packages/core/src/state.ts` has the same gap. `escalationDecision` and `stepAppeal` do not compare the attempt, and `beaconSeed` hashes it, so SimChain accepts the same grind [inferred].

#### H-2. An overturned rejection releases the key to a refunded buyer (fixed in the contract)

- **Found by:** the adversarial pass, rated high. The first pass rated it low at first, because the adjudicator holds the key anyway (residual 6). It raised the rating after finding that the reference adjudicator attaches the key on the honest path. Both now rate it high.
- **Where:**
  - `HoldbackRules.sol:362` emitted `KeyReleased` for any party-appeal decision that carried a key, whatever the first outcome.
  - `apps/adjudicator/src/service.ts:392` attaches `keyForBuyer` to every accept, the appeal role included.
  - `packages/settlement/sim/simchain.ts:881` releases it too.
- **Scenario:**
  1. The primary rejects, and the buyer is refunded.
  2. The seller appeals, and the appeal adjudicator overturns to accept.
  3. The reference service attaches the key, and the contract releases it.
  4. The buyer ends with the refund and the work. The seller ends with neither, because the overturn payout from the first adjudicator's bond is Phase 4 on chain (SimChain pays it).

  This breaks ADR-0012 ("on rejection or reclaim, the key is never released to the buyer") and the formal model's `KeyOnlyWithPayment` invariant (`formal/Holdback.tla:463-465`).
- **Proof** [measured]:
  - In `test/unit/AppealKey.t.sol`, `test_overturnedReject_refusesAKeyForTheRefundedBuyer` and `test_upheldReject_refusesAKeyForTheRefundedBuyer` settle and emit the key on `main`, and revert after the fix.
  - `test_upheldAccept_releasesTheKey` keeps ADR-0012's wrong-key ground after an accept.
  - The adversarial pass's `test_attack_overturned_reject_releases_key_without_paying_seller` shows the seller's balance unchanged and the decider's bond released.
- **Fix:** an appeal decision may carry the key only when the deal stands `Released`. Otherwise it reverts with `InvalidMessage`.
- **Limit:** the key travels in the decision's calldata and through operators. The contract's refusal keeps the settlement record honest, but it cannot stop a signed key from reaching the buyer. The fix that protects the seller is in the adjudicator: never attach `keyForBuyer` to an appeal whose first outcome was reject (T-211). SimChain should refuse the same message (T-210). Paying the wronged seller from the first adjudicator's bond is Phase 4.

### 2.2 Medium

#### M-1. A buyer's CPP reclaim strands every encumbered bond (fixed)

- **Found by:** both passes, independently. T-203 had already recorded it for T-202 (`docs/backlog.md`, due "before T-206").
- **Where:** `_refundAll` (`HoldbackRules.sol:576-585`) always called `void`. It is reached from `reclaim`, from `triggerDefault`, and from `triggerFallback` then `triggerDefault`.
- **Mechanism:** from `authorizationExpiry`, the buyer may call CPP's payer-only `reclaim` (ADR-0003's backstop), which zeroes the authorization. CPP's `void` then reverts with `ZeroAuthorization` (`AuthCaptureEscrow.sol:304-316`).
- **Scenario:** an open deal that nobody closed through the rules contract within the margin, after which the buyer reclaims on CPP. From then on every timeout reverts, so the primary's bond, and the fallback's or appeal adjudicator's, can never be withdrawn.
- **D31 case:** this needs nobody to be at fault. With `deliverBy` after the expiry, the rules `reclaim` is still `TooEarly` when CPP already lets the buyer reclaim.
- **Proof** [measured]:
  - `test/unit/AfterCppReclaim.t.sol` (Held; Delivered via fallback and default; Escalated; the D31 shape) reverts with `ZeroAuthorization` on `main` and passes after the fix.
  - With the handler corrected, `invariant_timeoutsExactlyWhenDue` fails on `main` with "reclaim: refused when due". T-203's handler had excluded reclaimed holds from that check (T-203 Decisions 4).
- **Fix:** from the expiry on, `_refundAll` reads CPP's capturable amount and skips `void` when the buyer already took the money. The stage still closes and the bonds are released. Before the expiry nothing can zero the authorization of an open deal, so the common path pays one comparison.

#### M-2. A carried delivery after `deliverBy` beats the reclaim (fixed)

- **Found by:** the adversarial pass, rated medium. The first pass listed it as informational, because T-202 had accepted it (D37 point 1, T-202 difference 5); the rating was raised on its impact.
- **Where:** `HoldbackRules.sol:241-245`. In `Held`, `decide` accepted a carried delivery with no `deliverBy` check, while `deliver` has one (`:226`).
- **Scenario:**
  - After `deliverBy`, `reclaim` and `decide(dv)` are both valid, and the first to land wins.
  - A seller watching for the buyer's reclaim can win with an accept.
  - A primary can carry a late delivery into an escalation, turning a reclaimable hold into an appeal case.
  - The deadline the buyer agreed to stops binding.
- **Reference behaviour:** the reference path already refuses this. The EVM adapter mirrors a carried delivery into core's `deliver` step, which refuses after `deliverBy` (`state.ts:275`). Only a direct submission got through.
- **Proof:** `test/unit/LateCarriedDelivery.t.sol` [measured].
- **Fix:** `decide` refuses a carried delivery from `deliverBy` on (`DeadlinePassed`).
  - A seller who delivered in time and expects a slow judge posts `deliver` (61k gas).
  - An early accept may still carry a late delivery, because the buyer is waiving its own deadline.
  - This amends D37 point 1 and T-202 difference 5.

### 2.3 Low and informational

#### L-1. An early accept names an attempt, not a delivery

- **Found by:** both passes.
- **Where:** `HoldbackTypes.sol:194-195, 314-316`; `HoldbackRules.sol:382-387`.
- **Mechanism:**
  - In `Held`, any seller-signed delivery may be carried.
  - In `Delivered`, any seller-signed delivery with the stored attempt is accepted, not necessarily the posted one, because no delivery hash is stored (T-202 decision 3).
- **Scenario:** a seller who signed two deliveries can relay the buyer's early accept with the one the buyer never opened. `JobSubmitted` and `KeyReleased` then name that delivery. A decision carrying a delivery has the same gap: the key comes from the decision, but the record can name another delivery.
- **Impact:** money and work are unaffected under D32. The buyer opened its envelope from the handed body before signing, so it already holds the content key.
- **Proof:** the adversarial pass's `test_attack_early_accept_paired_with_another_signed_delivery_after_onchain_deliver` [measured].
- **Follow-up (T-212):** a schema decision.

#### L-2. The bond vault credits nominal amounts

- **Found by:** the first pass.
- **Where:** `HoldbackBonds.sol:53-57, 95-101`.
- **Scenario:** with a fee-on-transfer or negatively rebasing token, the vault credits more than it holds, so the last withdrawer in that token is short. CPP measures the balance delta (`AuthCaptureEscrow.sol:418-424`); the vault does not. Exposure is limited to adjudicators who bond in that token, and a club can exclude such tokens [inferred].
- **Follow-up:** T-212.

#### L-3. A zero-bond appeal is accepted

- **Found by:** the adversarial pass.
- **Where:** `HoldbackRules.sol:484-497`.
- **Scenario:** an appeal with `bond = 0` needs no allowance, and it keeps the first decider's bond encumbered for `appealDecideSec` longer. This is on T-202's difference list (item 9: the rulebook rate is not checked on chain), and a rulebook may set a rate of 0 (D31) [measured].
- **Status:** accepted until Phase 4 brings the rulebook's appeal terms on chain.

#### L-4. The seed commitment is checked on 144 bits, reusably

- **Found by:** both passes.
- **Where:** `HoldbackRules.sol:54, 210, 276`.
- **Scenario:** a primary that finds two seeds whose `keccak256` hashes share their low 144 bits (about 2^72 work) gains a two-way panel choice. Because the tag does not depend on the commitment, that choice holds on every deal it ever judges. Core checks all 256 bits, so off-chain verifiers would see it [inferred].
- **Follow-up (T-212):** fold the commitment ID into the tag.

#### L-5. Uncovered fallback and appeal adjudicators still decide

- **Found by:** both passes; they rate it differently.
- **Where:** `HoldbackRules.sol:304, 529`. A takeover records `tryEncumber`'s failure, and `decide` never consults that record. A party appeal encumbers nothing on the appeal adjudicator.
- **Conflict:** ADR-0016 §1 says that "if either lacks coverage then, the case goes to the default outcome". D37 point 4 built "else nothing".
- **Severity:** the adversarial pass rated it medium. It stays low here, because no on-chain path pays from any bond yet (I-8), so a covered and an uncovered decider risk the same today.
- **Proof:** `test_attack_fallback_decides_with_no_bond_at_stake` [measured].
- **Follow-up (T-212):** reconcile the ADR and the code before Phase 4.

#### L-6. `authorizationExpiry` ignores `judgeBy`

- **Found by:** the adversarial pass.
- **Where:** `HoldbackRules.sol:166`.
- **Scenario:** the expiry is `fallbackBy + appealDecideSec + EXPIRY_MARGIN`. A `judgeBy` after the expiry is representable under D31, though contradictory as a schedule. Then the primary's on-time decision cannot capture, and a seller who delivered on time is not paid. M-1's fix keeps the bonds safe in this case.
- **Proof:** `test_attack_d31_deadlines_after_expiry_strand_bonds_and_unpaid_seller` [measured].
- **Follow-up:** T-212.

#### Informational

- **I-1. No fallback without an on-chain `deliver`** (adversarial pass). `triggerFallback` needs `Delivered` (`:525`). On the two-transaction path, a seller whose primary goes silent can only watch the buyer reclaim, unless it posted `deliver`. So `neutrality.adjudicator-silent-before-judging` holds on chain only for a seller that spends the third transaction. That is the seller's choice under D32, and should be documented in `docs/neutrality.md`.
- **I-2. Dead branch.** `MUTUAL_FEE_SHARE_BPS` is a constant 0 (`:70`), so the fee-share capture in `_payOut` (`:464-471`) never runs. It costs bytes in a contract near the EIP-170 limit (T-212 item 6).
- **I-3. EIP-170 headroom.** `HoldbackRules` runtime was 24,051 bytes at `baac930` [measured, `forge build --sizes`]:

  | Build | Runtime (bytes) |
  | --- | --- |
  | `main` + #120 | 24,046 |
  | #122 alone | 24,415 |
  | #125 alone | 24,094 |
  | #127 alone | 24,077 |

  With all four merged onto `main` locally, the contract is 24,479 bytes, 97 under the limit, and all 166 tests pass [measured]. The next feature needs room first; I-2 is the first saving.
- **I-4. EIP-7702 accounts.** Solady sends every address with code to ERC-1271 (`SignatureCheckerLib.sol:90-120`). So an EIP-7702-delegated EOA can sign only if its delegate implements `isValidSignature` for the EOA's key [inferred]. Worth a line in the agent docs.
- **I-5. Appeal rounds follow `block.timestamp`** (both passes) [guessed]. An escalation or a filing fixes the next beacon round from its block's timestamp. On a chain whose block producer can lag timestamps, or with 12-second slots against drand's 3-second period, the round "strictly after" may already be public when the transaction is built. This is part of the D4 chain choice.
- **I-6. `EXPIRY_MARGIN` has no lower bound** (`:141`). Every capturing deadline ends by `fallbackBy + appealDecideSec` when deadlines are ordered, and after M-1 the margin no longer protects bonds. What it still does is ADR-0003's forced-inclusion allowance (§7).
- **I-7. Push transfers can block closure** (adversarial pass) [inferred]. CPP's `void` and the vault's appeal-bond refund both push tokens. If the token has blacklisted the recipient (residual 1), `reclaim`, `triggerDefault`, a reject and `expireAppeal` revert, and that deal's bonds stay encumbered.
- **I-8. Phase 4 gaps.** On chain there is no overturn payout, no default compensation, no appeal-fee collection and no minimum appeal bond (T-202 differences 8 and 9). Appeals move only the appellant's bond.
- **I-9. Mutual payouts are not screened** [measured by the adversarial pass]. A co-signed payout to the rules contract or to CPP's TokenStore strands those tokens. A payout to `address(0)` reverts the whole settlement, so nothing is lost. Both parties signed it (D31).
- **I-10. ERC-8183 event names.** The six Holdback events (`JobCreated`, `JobFunded`, `JobSubmitted`, `JobCompleted`, `JobRejected`, `JobExpired`) match the draft's event list, and their parameter names match an SDK README of the draft. Not checked [guessed beyond the names]: the canonical EIP text, the type of `jobId`, and `ProviderSet` and `BudgetSet`, which Holdback never emits because provider and budget are fixed.
- **I-11. The formal README's contract column still reads TBD** (`formal/README.md:84-102`). §5 gives the answer.

## 3. Checklist

Each item is answered **pass**, **fail** or **n/a**, with the code line at `baac930` or the test that shows it. Tests are in `contracts/test/` on `main`.

### No admin keys (hard rule; ADR-0001, ADR-0003)

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| A1 | No owner, role or owner-style modifier | pass | `HoldbackRules.sol:18-21`. `HoldbackBonds.sol:10-17`: the one privileged caller is `RULES`, the deploying rules contract, an immutable code address. ABI allowlists: `fuzz/NoAdmin.fuzz.t.sol` `test_everyAbi_isItsReviewedAllowlist` [measured] |
| A2 | No pause, freeze or blacklist | pass | No such state or selector; `test_forbiddenSelectors_absentEverywhere_andCallsFail` [measured] |
| A3 | No upgrade proxy; parameters fixed at deploy | pass | Every parameter is `immutable` (`HoldbackRules.sol:72-81`, `HoldbackBonds.sol:17`, `SimBeacon.sol:17`) or a constant (`DrandQuicknetBeacon.sol:18-65`). `invariant_noAdminPath` checks that no code hash changes [measured] |
| A4 | No `SELFDESTRUCT` or `CALLCODE` | pass | An opcode walk over Rules, Bonds, both beacons and CPP: `test_bytecode_noSelfdestruct_delegatecallOnlyInTheFixedClone` [measured] |
| A5 | No mutable `DELEGATECALL` | pass | The same walk finds `DELEGATECALL` only in CPP's fixed TokenStore minimal proxy, and checks that proxy's bytes [measured] |
| A6 | No `receive` or `fallback`; never holds funds | pass | `testFuzz_etherRefused`, `testFuzz_unknownSelector_reverts`; `invariant_noAdminPath` (no tokens or ether in the rules contract) [measured] |
| A7 | The beacon cannot be swapped | pass | `BEACON` is immutable (`HoldbackRules.sol:81`). `SimBeacon` refuses every chain but 31337 (`SimBeacon.sol:22-25`, `test_sim_refusesToDeployOffALocalChain`) [measured]. Nothing on chain says which verifier a rules contract trusts, so a deployment must be checked to name `DrandQuicknetBeacon` [inferred] |

### The hold (ADR-0002, ADR-0003, ADR-0012)

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| H1 | No function moves held funds or bonds without a signature, a decision or an expired timeout | pass | CPP is called only from:<br>• `agreeAndFund`: the buyer's collector signature and Agree (`:203-215`)<br>• `_settleDecision`: the adjudicator's signature (`:288`)<br>• `earlyAccept`: the buyer's signature (`:384`)<br>• `_payOut`: both parties' signatures (`:423-424`)<br>• `_refundAll`: timeouts past their deadline (`:506-548`)<br>Bonds move only on those paths, or by an adjudicator's own `withdraw` of free bond. `invariant_noMovementWithoutAuthority` [measured] |
| H2 | Conservation | pass | `invariant_conservation`, `invariant_escrowMatchesState`, `invariant_bondsNeverNegative`, `invariant_encumberedNotDoubleCounted`, `fuzz/Postings.fuzz.t.sol` [measured] |
| H3 | Settle-once; replays refused | pass | One stage word per commitment. Every money path leaves the funded stages before its first external call. `invariant_settleOnce`; `test_refuses_secondSettle` for decide, early accept and mutual; `test_refuses_replay` [measured]. Holdback-domain nonces are not spent; the stage machine is the replay guard (T-202 difference 11) |
| H4 | Checks-effects-interactions; reentrancy | pass | State is written before every call to CPP, the vault or a token. CPP has its own transient guard, and the beacon is reached by `staticcall` [inferred]. The adversarial pass's reentrant payee cannot move funds again [measured]. Both analyzers flag `triggerFallback` (`:529`); the vault is the fixed contract this one deployed, and `tryEncumber` makes no external call [inferred] |
| H5 | `authorizationExpiry` after the last capture (ADR-0003) | pass, with L-6 | `authorizationExpiry = refundExpiry = fallbackBy + appealDecideSec + EXPIRY_MARGIN` (`:166-178`), after every capturing deadline when deadlines are ordered [inferred]. `test_buyerReclaimOnCppAfterExpiry_needsNoOperator` [measured]. `EXPIRY_MARGIN` is a deploy choice (§7) |
| H6 | Every funded commitment reaches a terminal state and releases every bond | fail, now fixed | M-1, PR #122. `invariant_timeoutsExactlyWhenDue` now covers CPP-reclaimed deals |
| H7 | The key is released in the same transaction as the capture | pass | `_settleDecision` emits `KeyReleased` right after the capture (`:336-339`), and so do `earlyAccept` (`:395-400`) and `mutualSettle` (`:435-437`). An accept without a key is refused (`:335`). `test_accept_paysSellerAndFee_andReleasesKeyInTheSameTransaction`, `test_pricetoSeller_feeBack_keyReleased_deliveryCarried`, `test_paysAnySplit_feeBackToBuyer_releasesKey`, `test_refuses_acceptWithoutTheBuyersKey` [measured] |
| H8 | No key on reject or reclaim | fail, now fixed | H-2, PR #125 (the contract side) |
| H9 | Agreed deadlines bind every path | fail, now fixed | M-2, PR #127. `earlyAccept` may still carry a late delivery, by the buyer's own signature |
| H10 | Rounding (ADR-0022) | pass | The only rate math is `Money.requirement(price, 10000)`, which is exact, and `Money.split(fee, 0)`, which is always 0; each rounds as named. `fuzz/Rounding.fuzz.t.sol` [measured]. No floats and no other division |
| H11 | Fee routing cannot be diverted | pass | `feeReceiver = 0` and `maxFeeBps = 10000` (`:179-181`) leave the recipient to this code: the decider (`:336`, `:341`), nobody on an early accept (`:395-396`), or payout addresses both parties signed (`:452-455`) [inferred]. `test_fallback_decidesWithTheBeaconSeedAtJudgeBy` [measured] |

### Signatures, replay and EIP-712

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| S1 | Domain separation | pass | Solady `EIP712` with name `Holdback`, version `0.6`, chain ID and contract address (`:637-639`), rebuilt if the chain ID changes [inferred from Solady]. Core signs with the same domain (`packages/core/src/eip712.ts:51`) [measured]. `test_defense_cross_deployment_replay_refused` [measured, adversarial pass] |
| S2 | Struct hashes match core byte for byte | pass | `unit/Vectors.t.sol`, from `test_commitmentId_matchesCore` to `test_panelSeed_matchesCore` [measured] |
| S3 | No cross-type replay | pass | Each message type has its own type string (`HoldbackTypes.sol:159-230`). The seller's offer signature is over the CommitmentTerms struct hash [inferred] |
| S4 | No cross-commitment, cross-role or cross-deployment replay | pass | Every struct hash includes the commitment ID; decisions include the role and the adjudicator; the domain includes the deployment [inferred]. `test_refuses_termsChangedAfterSigning`, `test_fallback_refusesThePrimaryAfterTakeover`, `test_defense_same_address_two_roles_no_cross_role_replay` [measured] |
| S5 | No field the signer controls changes what the message is bound to | fail, now fixed; L-1 open | H-1, PR #120. L-1 remains (T-212) |
| S6 | Zero-address signers refused; ERC-1271 handled | pass | `isValidSignatureNowCalldata` returns false for signer 0 and uses ERC-1271 for contract signers (`SignatureCheckerLib.sol:85-120`). `test_refuses_missingSignature`, `test_defense_zero_address_role_cannot_sign` [measured]. For EIP-7702 accounts see I-4 |
| S7 | Malleable signatures are harmless | pass | No signature hash is stored or used as an ID; replays are refused by stage [inferred] |
| S8 | A relayer cannot change unsigned fields to its advantage | pass | `f.method` is unsigned, but the collector signature is under the token's or Permit2's own domain (`test_defense_funding_method_swap_refused`) [measured]. A carried `dv` must be seller-signed; see L-1 |

### Permissionless triggers and liveness (ADR-0001, ADR-0005, ADR-0007)

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| T1 | Every timeout callable by anyone | pass | `expireOffer`, `reclaim`, `triggerFallback`, `triggerDefault` and `expireAppeal` read no caller (`:502-572`). `unit/Timeouts.t.sol` calls each from an unrelated address; `invariant_timeoutsExactlyWhenDue` [measured] |
| T2 | Each timeout is refused before its deadline and allowed from it, complementary to the deciding call | pass | `<` and `>=` pairs at `deliverBy`, `judgeBy`, `fallbackBy` and both appeal windows; boundary warps in `RulesHandler._warpNear` [measured]. M-2 was the one pair that was not complementary |
| T3 | Every entry point can be relayed | pass | No function reads `msg.sender` except the adjudicator's own `deposit` and `withdraw` [inferred]. The suites relay through an unrelated address [measured] |
| T4 | A halted primary, fallback, appeal adjudicator, buyer or seller does not stop settlement | pass, with I-1 | Fallback at `judgeBy`; default at `fallbackBy` or after the escalation window; appeal expiry; reclaim at `deliverBy`. Each is tested in `unit/Timeouts.t.sol` [measured]. A silent primary on a deal with no posted delivery ends in a reclaim, not a fallback (I-1) |
| T5 | The beacon cannot choose a seed; an unprovable round leads to fallback or default | pass after H-1 | The round is fixed by state (`:255-266`), the value is proven by BLS (`DrandQuicknetBeacon.sol:79-87`), and the seed is recomputed (`:277-284`). `unit/DrandDecide.t.sol`, `unit/DrandBeacon.t.sol` [measured] |

### ADR conformance

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| D1 | ADR-0003: the rules contract is CPP's operator; `feeReceiver = 0`; a fee-only capture then `void` on reject | pass | `:170-183`, `:341-342`; `test_reject_feeOnlyCaptureThenVoid` [measured] |
| D2 | ADR-0012: the two-sided hold | pass after H-2 | H7, H8 |
| D3 | ADR-0016 §1: an uncovered fallback or appeal adjudicator leads to default | fail | L-5: the ADR text and D37 point 4 disagree |
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
| Slither `arbitrary-send-erc20` (high) | `HoldbackBonds.sol:100` | Accepted. The `from` address is the appellant, which the terms fix as the buyer or the seller. The call needs that appellant's EIP-712 Appeal signature, and only `RULES` can make it |
| Slither `incorrect-equality` ×8 (medium) | `decide`, `_appealDecision` | False positive: strict equality on enum stages, not on balances |
| Slither `reentrancy-no-eth`; Aderyn H-2 | `HoldbackRules.sol:529` | Accepted. `d.flags` is set after `BONDS.tryEncumber`, but the vault is the immutable contract this one deployed and `tryEncumber` makes no external call, so there is no reentry path. Moving the write before the call would cost bytes and change nothing |
| Slither `uninitialized-local` ×6 (medium) | `decide`, `_payOut` | False positive: zero initialization is intended (`role`, `round` and the sums) |
| Slither `unused-return` (medium) | `HoldbackRules.sol:464` | Accepted: the remainder from `Money.split` is computed again as `rest` (I-2) |
| Aderyn H-1 `abi.encodePacked` collision ×9 | `HoldbackTypes.sol:171-225` | False positive: every instance concatenates compile-time type strings into a type hash, and no input is chosen by an attacker |
| Aderyn H-3 unsafe cast | `SimBeacon.sol:28` | Accepted: `uint64(t)` truncates only for `t >= 2^64`, and callers pass `uint64` deadlines or `block.timestamp` |
| Aderyn L-8 unused constant | `DrandQuicknetBeacon.sol:65` | False positive: `PAIRING_GAS` is used at `:84` |

The low results are:
- timestamp comparisons, which are by design;
- events emitted after external calls;
- missing zero-address checks on constructor arguments (a deploy-time choice, checked at deployment);
- one external call in a loop (`_payOut`, over payouts both parties signed);
- naming style and literal size.

## 5. Model-to-contract correspondence (T-204)

Every action in `Next` in `formal/Holdback.tla` maps to a contract function [measured by reading the model's `Next`].

| Model action | Contract function |
| --- | --- |
| `Offer`, `AdjAccept`, `Agree`, `Fund` | `agreeAndFund` (the offer, the acceptance and the agree are signatures checked at funding) |
| `Deliver` | `deliver`, or carried by `decide` or `earlyAccept` while `Held` (for `decide`, before `deliverBy`, after M-2) |
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
| `OperatorEarlyAccept`, `ReleaseKeyLate` (broken variants only) | none exists [measured: ABI allowlist] |

Gaps between the model and the contract:
- The model has no CPP reclaim by the buyer. That is the transition behind M-1, so the model's liveness result did not cover it.
- The model's `DecideAppeal` releases no key, and the contract did (H-2). After the fix, `KeyOnlyWithPayment` holds for the contract too.
- The model's `DecideAppeal` pays the wronged party from the bond; the contract does not yet (I-8, Phase 4).
- The model does not represent bond coverage at takeover (L-5).
- `formal/README.md` still lists the contract column as TBD (I-11). The table above is the answer.

## 6. Where the two passes disagreed

| Item | First pass (Opus) | Adversarial pass (Fable) | Recorded |
| --- | --- | --- | --- |
| H-2 severity | Low at first (the adjudicator holds the key anyway). Raised once the reference adjudicator was found to attach the key on the honest path | High | High: on chain, the honest path breaks the hold for the seller |
| H-2 fix | The adjudicator service first, because calldata carries the key either way; a contract refusal for the record | A contract refusal (release only when `Released`), or pay the seller from the bond now | The contract refusal now (PR #125); the adjudicator (T-211) and SimChain (T-210) as follow-ups; the bond payout stays in Phase 4 |
| M-2 late carried delivery | Informational, as T-202 accepted it (D37) | Medium | Medium, and fixed: the buyer's deadline stopped binding, and the reference adapter already refuses this case |
| L-5 uncovered deciders | Low | Medium | Low: no on-chain path pays from any bond yet, so coverage changes nothing until Phase 4 |
| A second fix for M-1 (derive the expiry from every deadline) | Not proposed | Proposed | Split out as L-6, a `PaymentInfo` change with mirrors outside the contract |
| L-2 bond vault crediting | Found | Not reported | Low |
| I-1, I-7, I-9, L-3, L-6 | Not reported | Found | As listed |

## 7. Open items for Rafa

1. **Cross-family review (gate, not done).**
   - Only Anthropic models were reachable. The environment exposes no other provider's key by name, and `.env*` files were not read.
   - To meet the "two model families" criterion, a reviewer from another family (for example an OpenAI or Google model) reviews `contracts/src/` at `baac930`, plus the four fix PRs, without reading this document. The brief is in T-206's Handoff.
   - Its findings are appended here, with the disagreements, before Phase 2 is called done.
2. **Read this review** (the task's first human gate).
3. **`EXPIRY_MARGIN` for Sepolia.**
   - After M-1, the margin protects no bond; it only leaves time for forced inclusion before the buyer's CPP backstop opens.
   - Recommendation: 1 day (86,400 s), the value the local EVM world and the tests use. That covers the forced-inclusion window of OP Stack chains (12 hours) and Arbitrum (24 hours) [inferred from public chain documentation, not re-checked today].
   - Ethereum Sepolia has no sequencer, so any value works there.
4. **Sepolia deployment (gate, not done).** No deployment, key or RPC was used. Before one:
   - merge the fix PRs;
   - deploy `DrandQuicknetBeacon` as the beacon (A7);
   - confirm EIP-2537 on the target chain;
   - close item 1.
