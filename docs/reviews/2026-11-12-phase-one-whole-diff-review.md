# The phase-one contracts before the freeze: the first whole-diff review (package R11, review 1)

Date: 2026-11-12. Task: [T-388](../tasks/T-388-reviews-r11.md). Reviewer: one Claude session (Fable 5.2), with one subagent for the buyer's tool. Subject: `contracts/src` at commit `0180a39f` (`0180a39f941194f3a90733e5f785675caa6c2f32`) of `contracts-audit-ready`, the commit named for the freeze, against the contracts deployed on Sepolia at `64be1f1`. Both reviews read the code at `c629d06c` (`c629d06cf1edbec91bb89de891210dd26035a93d`); `0180a39f` differs from it in comments only (section 2). The second review, by another model family, is [`2026-11-12-phase-one-second-family-review.md`](2026-11-12-phase-one-second-family-review.md).

Labels: **measured** (read at the cited line, or produced by the named test or command), **documented** (stated in the cited doc), **inferred**, **guessed**. `R:` is `contracts/src/HoldbackRules.sol`, `T:` is `HoldbackTypes.sol`, `E:` is the vendored `AuthCaptureEscrow.sol`, `S:` is Solady's `SignatureCheckerLib.sol`, all at the commits of section 2.

## 1. Summary

**The contracts hold: this review found no Critical or High finding in `contracts/src`.** No call moves a hold to an address the signed terms do not name, no funded deal can be left with tokens nobody can move, and every opposing pair of deadlines splits time at one second [inferred from reading every line; measured for the cases the tests of section 5 cover].

**One High finding lay outside the contracts, in the buyer's reference tool, and is closed.** The one-run buy (`examples/buy-with-signer.ts`) funded an offer the seller postdated, so the buyer's hold stayed locked until a date the seller picked (finding C-1). The contracts are not at fault: the deadlines are terms both parties signed, and the contract enforces them. T-390 fixed the tool on 2026-11-12 (pull request 446, `609cdd7e`).

**The findings in the contracts are recorded and not fixed: one Medium, one Low and six Info (section 3). The four that matter most:**

1. **Medium.** A call that carries the buyer's key publishes it in its calldata even when the call reverts (finding M-1). It extends a known issue, and the second review found it independently.
2. **Low.** The contract takes terms whose three dispute fields are not zero, where the state model's register says they should be refused (finding L-1).
3. **Info.** Two more of the register's "enforce" verdicts are not in the code: an empty appeal ground on an escalation decision, and empty beacon fields on a primary's decision (finding I-1). T-384 reported the first of them too, with two more places that are by design (finding I-6).
4. **Info.** A delivery can hold two envelopes addressed to the buyer, and the relayer chooses which the contract releases (finding I-4, from the second review).

**The audit docs at the lane's tip `57fba5e3` now state the first three** (T-385 rewrote them on 2026-11-12, with this review's list). Section 6 tests the rewritten state model against the code, and section 6.1 answers the four statements the docs pass could not verify.

**The commit `0180a39f` is ready to freeze as far as this review can tell.** Nothing found here needs a change to `contracts/src`.

## 2. Scope

**Read in full, every line** [measured: line counts by `wc -l` at the cited commits]:

| File | Lines | Commit |
| --- | --- | --- |
| `contracts/src/HoldbackRules.sol` | 558 | `c629d06c` |
| `contracts/src/HoldbackTypes.sol` | 426 | same |
| `contracts/src/IHoldbackRules.sol` | 155 | same |
| `contracts/src/DrandQuicknetBeacon.sol` | 175 | same |
| `contracts/src/IHoldbackBeacon.sol` | 15 | same |
| `AuthCaptureEscrow.sol` (Commerce Payments v1.1.0, vendored) | 536 | `6b0a5ef` |
| `TokenStore.sol` | 38 | `6b0a5ef` |
| `collectors/TokenCollector.sol`, `ERC3009PaymentCollector.sol`, `ERC6492SignatureHandler.sol` | 78, 58, 62 | `6b0a5ef` |
| `collectors/OperatorRefundCollector.sol`, `interfaces/IERC3009.sol` | 36, 20 | `6b0a5ef` |
| Solady `SignatureCheckerLib.sol` | 527 | `5ea5d9f` |
| Solady `EIP712.sol` (the constructor, the cache and the hashing; the comments skimmed) | 208 | `5ea5d9f` |

**The commit to freeze against the commit read.** The code was final at `c629d06c` on 2026-11-12 at 18:22 UTC, and both reviews read it there. Two comment-only pull requests followed: the descriptions (pull request 441, `d3cd4605`) and one added sentence (pull request 445, `0180a39f`). With comments and line breaks removed, each of the five files of `contracts/src` at `0180a39f` equals its copy at `c629d06c` [measured: a script that strips `//` comments and white space from both and compares]. T-384 measured the same as identical runtime code. Line numbers in this report are those of `c629d06c`; the descriptions moved them.

**The diff:** `git diff 64be1f1 c629d06c -- contracts/src`: 7 files, 375 lines added, 509 removed [measured: `git diff --stat`]. I read every removed code line and compared every event's emit sites, old against new.

**The named scope beyond the diff:** sections 7 to 11 of `docs/audit/state-model.md` (section 6); the buyer signer, `examples/buyer-signer.ts`, 1,176 lines at `e4e930c4`, read in full by a subagent whose High and Medium claims I checked line by line (section 7); the descriptions of T-384's second pull request (section 8).

**Context read:** `CLAUDE.md`; ADR-0012, ADR-0019's amendment of 2026-11-12, ADR-0031 in full, ADR-0032 sections 3, 5 and 6, ADR-0033 section 2; `docs/audit/threat-model.md` and `known-issues.md` in full; `invariants.md` and `formal/README.md` (the tables that map the model to the code). The audit docs were read twice: at `c629d06c`, where they still described the deployed contracts, and at the lane's tip `57fba5e3`, after the docs pass (pull requests 436 and 437). `contracts/src` is the same at both commits [measured: `git diff --quiet c629d06c 57fba5e3 -- contracts/src`].

**Tests written:** `contracts/test/crosscheck/R11Review.t.sol`, ten tests, all passing [measured: `forge test --match-contract R11ReviewTest`]: eight for this review and two for claims of the second review. The whole suite at `c629d06c` with the first seven: 479 tests passed, 0 failed, 0 skipped, in 65 suites [measured: `forge test` in `contracts/`, 2026-11-12 18:23 to 18:26 UTC, forge 1.0.0]. The side-by-side harness and the invariant suites are in that count. On this review's branch at the lane's tip `57fba5e3`, with the first nine: 481 tests passed, 0 failed, 0 skipped, in 65 suites [measured: `forge test`, 2026-11-12 18:57 to 19:01 UTC]. With all ten, on the branch at the lane's tip `55a3dce4` (whose `contracts/src` differs from `0180a39f` by three comment lines): 482 tests passed, 0 failed, 0 skipped, in 65 suites [measured: `forge test`, 2026-11-12 19:23 to 19:35 UTC].

**Left out:** section 9.

## 3. Findings

### C-1 · High · Closed · in the buyer's tool, not in the contracts · The one-run buy funded a postdated offer

- **What is wrong.** The buyer signer turns the terms' deadlines into windows counted from the seller's `createdAt` (`examples/buyer-signer.ts:685-689` at `e4e930c4`) and compares only those windows with the buyer's own terms (`:391`). Nothing compares `createdAt` or a deadline with a clock before funding. With `--expect-terms` and no difference, `examples/buy-with-signer.ts` funds without an approval stop [measured by reading; no deal was run].
- **The scenario.** The buyer's terms say `deliverWithinSec: 86400`. The seller signs the same windows, fee, checks and adjudicators with `createdAt` five years ahead. The run finds no difference and funds. `deliverBy` is five years and one day away, and `reclaim` reverts until then (`R:421`).
- **Nothing upstream stops it.** The operator's prepare route takes a given `createdAt` (`apps/operator/src/prepare.ts:383-384`), core checks only that it is before `offerExpiresAt` (`packages/core/src/parse.ts:108`), and funding on a chain is valid from the epoch.
- **Impact.** The price and the fee are locked, not taken, for as long as the seller chose, up to the year 9999. The seller gains leverage for a settlement. The attended path shows the deadlines with their times at the approval stop.
- **Why the contracts are not at fault.** The deadlines are terms both parties signed, and the contract enforces them as signed. `createdAt` is hashed into the commitment ID (`T:288`) and read nowhere else; a date far in the future is a parameter the parties manage (D31). The check belongs to the party that signs (D32).
- **It is the class of T-239's High finding of 2026-11-11,** fixed then for the standing test buyer (`docs/tasks/T-239-standing-test-buyer.md`) and not carried to the buyer signer.
- **Fix and owner.** T-390: a `createdAt` outside the operators' time band (600 s behind, 60 s ahead, the band `site/llms.txt` already states for an operator's own times) is a difference, so the one-run path stops for approval; every approval stop shows the deadlines as dates and as a distance from now. Nothing is refused. Closed by pull request 446, merged into the lane as `609cdd7e` on 2026-11-12 at 19:55 UTC; section 7.5 reads the path again.
- **A later row worth having:** an advisory notice at the operator's prepare route when a given `createdAt` is far from settlement time. It is a service an operator may add under D31, never a refusal, and it does not replace the buyer's own check.

### M-1 · Medium · A call that carries the buyer's key publishes it even when the call reverts

- **What is wrong.** The contract releases the buyer's envelope only in the call that pays (`R:302`, `R:344`, `R:380`). The envelope travels in that call's input, which is public from the moment the call is sent. A call that reverts has already disclosed it.
- **Where it bites.** A settlement with `releaseKey` on the posted path, where the operator holds the envelope until the settlement: a default that is due lands first, and the buyer has the whole hold back and the envelope [measured: `test_r11_issue_dueDefaultBeatsASettlementThatCarriesTheKey`]. The same holds when the settlement's `expiresAt` passes, or when the buyer's own signer changes its answer between signing and relay: an ERC-1271 wallet, or a plain key that takes EIP-7702 code, since the library asks an account with code only through ERC-1271 (`S:90`, `S:110-119`) [inferred]. An adjudicator's accept that misses its deadline by one block discloses the key the same way; the next adjudicator then decides.
- **Where it does not.** An early accept: the buyer holds its envelope before it signs (ADR-0012, D32). The late-work settlement in `Held`: ADR-0019's amendment of 2026-11-12 says the buyer holds the whole delivery there, and the seller withholds the ciphertext.
- **Already recorded in part.** Known issue "H-2 limit" said it for an appeal decision's calldata. ADR-0031's red-team findings M-4 and L-2 name the two races and not the disclosure.
- **Found twice.** The second review reached the same finding without this one's conclusions and rated it Medium (its question 11, claims C2, C3 and C5). I first rated it Low; Medium is the rating of record, because the key's release only with the payment is a named protection of the contracts (the threat model's asset AS-4) and the buyer can cause one of the races alone.
- **Impact.** The buyer can read work it did not pay for, in a race it can sometimes cause. No token moves outside the terms.
- **Next action.** Done in the docs: at `57fba5e3` known issue "H-2 limit" and the threat model's class "the key without the payment" state it, still unrated; the rating here is Medium. Practice for operators and sellers: relay a key-bearing call where a reverted call is not published, and do not relay a key-bearing settlement once a refund timeout is due. For the outside auditor's attention. No contract change: a commit-and-reveal of the key would be a new protocol step (D26).

### L-1 · Low · The contract takes terms whose dispute fields are not zero

- **What is wrong.** The state model's register gives `timing.disputeBy`, `disputeJudgeSec` and `disputeFallbackSec` the verdict "enforce: refuse nonzero" (`docs/audit/state-model.md`, section 8.3, rows 2 to 4). `agreeAndFund` compares none of them (`R:151-166`). Terms with all three set fund [measured: `test_r11_issue_disputeFieldsAreSignedAndNotRefused`].
- **Impact.** None on money. The schema forbids the fields in this settlement mode and core encodes their absence as 0, so only terms sent straight to the contract can carry them. Such a deal has an ID no operator can rebuild, and it falls behind the operators' view (known issue R-13).
- **Next action.** The register at `57fba5e3` now says "Enforce: refuse nonzero. Not built" for the three rows, which is true. What is left is Rafa's choice: leave it as a recorded limit, or add one comparison to `agreeAndFund`, a code change with its own proof and a redeploy. This review recommends leaving it for phase one: the finding is Low and the contract refuses nothing an honest party sends.

### I-1 · Info · Two more "enforce" verdicts of the register are not in the code

- **A decision's `appealGround` on an escalation.** Row 8 says phase one enforces it empty for every role. `_firstInstance` does (`R:270`); `_escalationDecision` does not (`R:285-290`). Already measured by the phase-one red team as its finding RT-2 (`contracts/test/attack/PhaseOneRedTeam.t.sol`, `test_issue_escalationDecisionAcceptsAnyAppealGround`).
- **A primary's beacon fields.** Row 11 says "enforce empty". `decide` reads the round, the value and the proof for the fallback and the appeal adjudicator only (`R:224-234`). A primary's accept with invented beacon fields lands [measured: `test_r11_issue_primaryDecisionMayCarryUnprovenBeaconFields`].
- **Impact.** A reader may take a signed field as checked. Money and the key are unaffected.
- **Next action.** Done: the register at `57fba5e3` says the first is half built and the second is not built.

### I-2 · Info · Closed · The audit docs described the deployed contracts in places

At `c629d06c`, `docs/audit/state-model.md` said funding refuses a zero price and that no contract had the phase-one changes yet. The docs pass corrected both (pull request 436, `e6a74b6`). Section 6 tests the rewritten page.

### I-3 · Info · A plain key that takes delegated code loses its pending signatures

Solady's checker tries `ecrecover` only when the signer has no code, and asks ERC-1271 otherwise, with no fallback (`S:90-121`). A plain key that sets EIP-7702 code after it signed has its earlier signatures refused unless the delegate accepts them. ADR-0031's red-team finding M-4 records it; the threat model's contract-signer row should say it. Each step checks its own signature, so the change blocks that signer's own next step. M-1 names the one case where it costs the other party something.

### I-4 · Info · With two envelopes addressed to the buyer, the relayer chooses which the contract releases

- **What it is.** The key proof takes any entry of the delivery's key list that is addressed to the buyer (`R:526-531`). A delivery with two such entries lets whoever relays an early accept, or a settlement with `releaseKey`, choose which envelope the `KeyReleased` event carries [measured: `test_r11_second_twoBuyerEnvelopes_theRelayerChoosesWhichIsReleased`]. Core requires at least one envelope for each recipient and does not refuse a second (`packages/core/src/state.ts:366-367`).
- **Found by the second review** (its question 6, claims C4 and C9, rated Medium there).
- **Impact.** None for a buyer that runs the reference check: `examples/verify.ts:613-614` refuses a delivery with more than one envelope for the buyer, in those words. It is the buyer's check before it signs (D32).
- **Next action.** One line in the register's row for a delivery's `encryptedKeys` (T-385 or the freeze's docs step).

### I-5 · Info · The funding's safety against a front-run rests on the token's payee rule

- **What it is.** The buyer's payment address signs an ERC-3009 receive authorization. A token that follows ERC-3009 lets only the payee, the collector, use it. With a token that did not, anyone holding the signature could move the price and the fee into the collector, where no call takes them out (`ERC3009PaymentCollector.sol:31-57`).
- **It does not happen on this deployment.** The Sepolia test token, the local token and the suite's token all keep the rule (`contracts/script/TestUSDC.sol:69`, `LocalUSDC.sol:84`; `contracts/test/unit/TestUSDC.t.sol`, `LocalUSDC.t.sol`) [measured: `test_r11_second_strangerCannotUseTheFundingAuthorization`]. The second review rated the scenario High without the token's source; it does not hold.
- **Next action.** `docs/audit/scope.md` names the token as "a plain ERC-20 with ERC-3009"; one clause there should say the payee rule is part of that. A check in the deploy script is a later row.

### I-6 · Info · Three places T-384 reported while it wrote the descriptions

T-384 changed no code and named three places where the code looked wrong to it (`docs/tasks/T-384-comments-r9.md`, Handoff). Each is checked here.

| # | What T-384 reported | Verdict | Severity |
| --- | --- | --- | --- |
| 1 | The appeal adjudicator's decision on an escalated case may carry any `appealGroundHash`; `_firstInstance` requires it empty and `_escalationDecision` checks nothing | **It is finding I-1 above, first bullet,** and the phase-one red team's RT-2 before it. True of the code (`R:270` against `R:285-290`) [measured: `test_issue_escalationDecisionAcceptsAnyAppealGround`]. The ground is hashed into the decision's signature and into nothing else: it is never emitted, stored or read, so no money, key or state depends on it. It is not the Low finding L-1, which is about the dispute fields | Info |
| 2 | `Deal.t1` keeps the escalation's time after the appeal adjudicator decides, while a primary's or a fallback's accept or reject writes the decision's time | **By design, and stated.** `_escalationDecision` writes the stage, the reason and the decider and leaves `t1` (`R:286-288`); the escalation's deadline was counted from it, and `triggerDefault` reads it (`R:447`). The time of that decision is the block time of its `Decided` event. The state model's rows P10 and P11, its section 10 and the description of `Deal` all say so. A reader that takes `t1` as "decided at" for every closed deal is wrong for these two rows | Info |
| 3 | A bad beacon proof reverts with the beacon's own `InvalidSignature`, not `BadSeed` | **True, and stated.** `decide` compares the round first and calls the beacon only for the right round (`R:228`); the beacon reverts on a proof that does not verify (`DrandQuicknetBeacon.sol`, `beaconValue`), and that revert passes through. `BadSeed` covers a wrong round, a value other than the proven one, and a seed the value does not give. Both outcomes refuse the decision and move nothing. A caller that matches on `BadSeed` alone misses the bad-proof case; the interface's note on errors says the beacon's error passes through | Info |

None needs a change for the reviews' verdict. The joint summary sets out, for the first, what enforcing it would cost against leaving it recorded.

## 4. What I checked and found sound, by function

Each line is inferred from reading unless a test is named.

**`agreeAndFund` (`R:132-178`).**
- Anyone may call it; authority is three signatures under the contract's domain: the seller's over the commitment ID (`R:167`), the primary's acceptance (`R:168`), the buyer's Agree (`R:169`). The ID hashes every term, both money addresses included (`T:265-291`).
- It refuses a stage other than None (`R:141`), a block time at or after `offerExpiresAt` or `fundBy` (`R:142`), an expired acceptance or Agree (`R:143`), a bond reservation other than 0 or another token (`R:146`), deadlines not strictly in order, more than one attempt, an escalation window of 0, an appeal window other than 0 (`R:152-158`), and a deadline after the year 9999 or a window above 32 bits (`R:166`).
- The buyer's payment address signs an ERC-3009 authorization whose nonce is the escrow's hash of the payment record without the payer (`TokenCollector.sol:70-77`). That record names this contract as operator, the seller's payout address as receiver and the commitment ID as salt (`R:111-124`), so the authorization serves this deal only. Only the collector can use it (`ERC3009PaymentCollector.sol:42-50`), only the escrow can call the collector (`TokenCollector.sol:43`), and only the operator can call `authorize` (`E:241`).
- The state write (`R:172-173`) comes before the escrow call (`R:177`). A second call reverts on the stage, and the escrow refuses a second collection (`E:247`).
- The nested call an ERC-6492 wrapper names runs through Multicall3 while the escrow's guard is locked (`ERC6492SignatureHandler.sol:52-58`, `E:241`). It can take only steps anyone could take in the next transaction; the threat model's section 3 already says so, and `contracts/test/crosscheck/Erc6492Prepare.t.sol` covers it.

**`deliver` and `_acceptDelivery` (`R:185-191`, `R:514-524`).** A delivery lands only from Held, before `deliverBy` (`R:518`), as attempt 1, with the seller's signature (`R:521`). Every caller leaves Held in the same transaction, so a posted delivery is never replaced, and the stored hash is non-zero exactly when the attempt is 1.

**`decide` (`R:200-243`).**
- The role, the deadline and the beacon round come from the stage and the stored `t1` (`_turn`, `R:249-263`), never from the message; the message's role must equal it (`R:216`).
- Every role must name the stored attempt and the posted delivery (`R:216`).
- **The outcome check.** `H.isValidOutcome(role, m.outcome)` (`R:217`, `T:155-158`) stands before every use of the outcome. `_firstInstance` and `_escalationDecision` are internal and called only from `decide`, after it (`R:241-242`). Without it, an escalation by the appeal adjudicator or an outcome above 2 would be read as a reject (`R:277`, `R:286`); with it, each reverts [measured: `test_r11_outcomeCheck_stopsWhatWouldReadAsAReject`]. T-384's test compares the new check with the old numeric bound on all 65,536 pairs of role and outcome (`contracts/test/unit/ValidOutcome.t.sol`).
- A key travels only with an accept (`R:222`), and an accept without a key reverts (`R:298`).
- The primary reveals the preimage of its seed commitment through the deal's tag (`R:226`). The fallback and the appeal adjudicator must carry the round the state fixes, its proven value, and the seed derived from it (`R:228-229`); `||` evaluates left to right, so the beacon is asked only for the right round.
- The deal's word is read once and written once on every path, before any token moves (`R:274`, `R:280`, `R:288`).
- A decision cannot be replayed: each one leaves the stage it needs, and the struct hash binds the ID, the role and the adjudicator (`T:358-384`).

**The rounds (`R:479-495`).** The code is ADR-0032's rule: the fallback's round is the first after `judgeBy − 1 + BEACON_MARGIN`, the escalation's the first after `t1 + BEACON_MARGIN`. `judgeBy` is at least 3 for a funded deal, so the subtraction cannot underflow. `triggerFallback` emits the same round (`R:434`).

**`_settleDecision` (`R:295-310`).** An accept makes one capture of the whole hold with the fee to the decider (`R:299`); the escrow sends the fee first and the rest to the receiver (`E:464-472`). A reject captures the fee alone to the decider and voids the price to the payer (`R:304-305`). With a price of 0 no void is made; with a fee of 0 no fee capture is made and the fee receiver is the zero address, which the escrow accepts for a fee of 0 (`E:524`). `contracts/test/unit/ZeroPrice.t.sol` covers the zero cases.

**`earlyAccept` (`R:318-345`).** Held or Delivered only; the buyer's signature names the attempt and the delivery (`R:330`, `R:334`); in Held the carried delivery must carry the seller's signature and land before `deliverBy`; the key proof ties the envelope to the buyer and to that delivery's key list (`R:526-531`). It has no deadline of its own; after the escrow's expiry its capture reverts.

**`mutualSettle` and `_payOut` (`R:353-409`).** Both parties sign one struct that names the payouts, the delivery and the key release (`R:370-371`). A payout names the seller's payout address or the buyer's payment address, or the call reverts (`R:393`); the payouts sum to the price (`R:397`); one capture and one void at most. The sums are checked arithmetic over amounts bounded by the price.

**`reclaim`, `triggerFallback`, `triggerDefault`, `_refundAll` (`R:417-453`, `R:497-508`).** Anyone may call each from its deadline. After the escrow's expiry `_refundAll` reads the escrow, closes the deal, and voids only what is still held (`R:502-506`).

**Deadlines.** Each opposing pair uses one expression on both sides: delivery `<` and reclaim `>=` `deliverBy` (`R:518`, `R:421`); the primary `<` and `triggerFallback` `>=` `judgeBy` (`R:223`, `R:431`); the fallback `<` and the default `>=` `fallbackBy` (`R:223`, `R:445`); the escalation's decision `<` and the default `>=` `t1 + appealDecideSec` (`R:223`, `R:447`, both through `_escalationDecideBy`).

**The escrow's expiry.**
- A capture reverts when the block time is at or after `authorizationExpiry` (`E:277-279`); the payer's own reclaim opens at that same second (`E:325-327`); a void has no time check (`E:304-316`) [measured: `test_r11_captureStopsAtTheExpirySecond_andThePayersReclaimOpensThere`, `test_r11_voidStillLandsAtTheExpirySecond`].
- No decision window outlives the escrow, even with an expiry margin of 0: the last possible decision is at `fallbackBy + appealDecideSec − 2`, two seconds before the expiry [measured: `test_r11_lastPossibleDecisionCaptures_withAnExpiryMarginOfZero`].
- Every closing path empties the escrow's capturable amount, so nothing is left for anyone to strand; if something were, the payer's reclaim takes it from the expiry.

**Where money can go.** The escrow pays three addresses for a deal: its payer on a void or a reclaim, its receiver on a capture, and the fee receiver the operator names (`E:315`, `E:339`, `E:468-471`). The rules contract sets them to `buyerPaymentAddress`, `sellerPayoutAddress` and the adjudicator of the deciding role, all hashed into the ID every party signed. It never calls `charge` or `refund`, and nobody else can: both need the operator as caller (`E:207`, `E:356`).

**Numbers.** The deal's word is 216 bits (`IHoldbackRules.sol`, `Deal`). `LAST_TIMESTAMP` is 253,402,300,799 s (9999-12-31T23:59:59Z) plus 86,340 s, as its comment says. A decision's or an escalation's `t1` is below `fallbackBy + appealDecideSec`, which fits 40 bits under the two bounds of `R:166`. The hold must fit 120 bits and the expiry 48 bits (`R:110`).

**No admin path.** No owner, role, pause, upgrade, delegatecall, `receive` or `fallback`; the constructor refuses a zero address and a beacon margin of 0 off the local chain (`R:75-79`).

**The signature library (`S:80-123`).** A zero signer fails. An account without code is checked by `ecrecover`, with 64-byte and 65-byte signatures; the library does not refuse a high `s`, and no signature is used as an identifier here, so malleability moves nothing. An account with code is asked through ERC-1271 by a static call. The scratch space, the free memory pointer and the zero slot are restored.

**The domain.** Solady's `EIP712` caches the separator and rebuilds it when the chain ID or the address differs. The type strings list their referenced types in alphabetical order; `contracts/test/unit/Vectors.t.sol` pins the hashes against `packages/core`.

**The diff from `64be1f1`.** Every check the lane removed belongs to a stated cut (party appeals, bonds, Permit2, any token, third-party payouts, the offer's on-chain expiry). The old check that `fundBy` fits 48 bits is replaced by the year-9999 bound on `fallbackBy`, which is later than `fundBy`. Every event the deployed contract emitted on a path that still exists is emitted there now; `SettlementAddresses` joined.

## 5. The tests behind this review

`contracts/test/crosscheck/R11Review.t.sol`. The three `issue` tests show a recorded finding as the contract stands.

| Test | What it measures |
| --- | --- |
| `test_r11_captureStopsAtTheExpirySecond_andThePayersReclaimOpensThere` | A capture lands one second before the escrow's expiry and reverts at it; the payer's reclaim reverts one second before it and lands at it |
| `test_r11_voidStillLandsAtTheExpirySecond` | The timeouts refund through the rules contract at the expiry second |
| `test_r11_lastPossibleDecisionCaptures_withAnExpiryMarginOfZero` | The last possible decision, with an expiry margin of 0, is two seconds before the expiry and pays |
| `test_r11_earlyAcceptAtPriceZero_afterThePayersReclaim_revertsAtTheVoid` | With a price of 0, an early accept after the payment address reclaimed reverts at the void of the fee (section 8) |
| `test_r11_outcomeCheck_stopsWhatWouldReadAsAReject` | An outcome above the three, and an escalation by the appeal adjudicator, revert and move nothing |
| `test_r11_issue_disputeFieldsAreSignedAndNotRefused` | Finding L-1 |
| `test_r11_issue_primaryDecisionMayCarryUnprovenBeaconFields` | Finding I-1 |
| `test_r11_issue_dueDefaultBeatsASettlementThatCarriesTheKey` | Finding M-1 |
| `test_r11_second_strangerCannotUseTheFundingAuthorization` | The second review's claim that a stranger can use the funding authorization at the token does not hold (finding I-5) |
| `test_r11_second_twoBuyerEnvelopes_theRelayerChoosesWhichIsReleased` | Finding I-4 |

## 6. Sections 7 to 11 of the state model, against the code

**At the lane's tip `57fba5e3`, sections 7 to 11 of `docs/audit/state-model.md` are true of the code.** I tested each claim by reading it against `contracts/src` at `c629d06c` [inferred unless a test is named]. Three small points are left, at the end of this section.

**The page was rewritten between my two reads.** At `c629d06c` four of the five sections still described the deployed contracts: a zero price refused, the register's verdicts for the dispute fields, the appeal ground and a primary's beacon fields given as enforced, the bond reservation and the appeal window given as unenforced, and twelve differences from a formal model that has since gained a phase-one profile. I sent the list to the docs pass (T-385), which corrected the page in pull request 436 (`e6a74b6`).

**Section 9, the phase-one machine.**

- **The rows (9.3).** Each of P01 to P17 is written by the function the row names, and no write produces another word: funding (`R:172-173`), a delivery (`R:190`, `R:208`, `R:332`), `triggerFallback` (`R:432-433`), an escalation (`R:272-274`), a first decision (`R:277-280`), an escalation's decision (`R:286-288`, which leaves `t1` at the escalation's time), an early accept (`R:337`), a settlement (`R:377`, which never writes the delivery hash), a reclaim or a default (`R:498`). The bounds on `t1` hold at the guards the page names. `contracts/test/invariant/StateOracle.t.sol` checks the same predicate after every step of the handler.
- **The closing reason (9.2).** `reason` is written in the storage write that closes the deal and never after; `decider` is set exactly with `Decided`.
- **The holdings (9.4).** Every closing path leaves the capturable amount at 0 and the refundable amount at what the table says, for a price of 0 and for a fee of 0 too (section 4, `_settleDecision`). With equal money addresses every payout counts as the seller's share (`R:393-395`).
- **What changed (9.1) and the cuts (9.5).** Each line names code that exists: the refusals of `agreeAndFund`, the six constructor arguments, the two money addresses, the margin on both rounds. A zero price stays allowed, and the escrow's refusal of a hold of 0 (`E:179`) stays the funding condition.

**Section 7, the outcome.** The six final outcomes are the closing reasons, with the stage telling a release from a refund. The amounts in each row match section 4's reading of the escrow calls.

**Section 8, the register.** Every row of 8.1 and 8.2 matches the code. In 8.3 each "Enforced" is built (`R:146`, `R:154-155`, `T:410-412`), and each verdict the code does not implement says so: rows 2 to 4 (finding L-1), row 8 (half built) and row 11 (finding I-1). The second review reached the same eight differences from the page as it stood at `c629d06c` (its question 17).

**Section 10, the formal model.** The twelve differences agree with `formal/README.md`, "Not modelled". The funding deadline is as the page says: one call, before `offerExpiresAt` and `fundBy` (`R:142`).

**Section 11, the findings.** F-1 is closed as the page says. F-2's numbers are right: 37 s for an escalation, and for the fallback 43 s on mainnet and 44 s on Sepolia (section 6.1). F-3's count of eighteen rows is right.

**Three points left:**

| # | Where | What |
| --- | --- | --- |
| 1 | 8.2, a delivery's `encryptedKeys`; 8.3 row 16 | Add that the key proof takes any entry addressed to the buyer, so two such entries leave the choice to the relayer (finding I-4) |
| 2 | The pages' `<FREEZE_COMMIT>` | A placeholder until the freeze; the freeze fills it (`state-model.md`, `threat-model.md`, `scope.md`, `invariants.md`) |
| 3 | Known issue "H-2 limit" | Unrated on the page; this review rates it Medium (finding M-1) |

### 6.1 Four statements the docs pass could not verify

T-385's task file lists four statements of `docs/audit/` it could not verify. Each is checked here.

| # | Statement | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | "The hunt's findings 2 and 4", which the plan says the refusal of unprocessable terms (SC-5) closes | **Confirmed, and both are closed in the code** | The two findings are in the maintainers' private plan. Finding 2: deadlines out of order let a delivery land after `judgeBy`, give the fallback a window of zero, and let the escrow's expiry fall before `deliverBy`. Finding 4: the terms can promise more than one delivery attempt while the contract takes one. `agreeAndFund` refuses both: the five deadlines strictly in order and one attempt (`R:152-158`; `contracts/test/unit/StrictTerms.t.sol`). With the order enforced the expiry is `fallbackBy + appealDecideSec + EXPIRY_MARGIN`, later than every deadline (`R:472-474`). No row is missing from the docs for them |
| 2 | Known issue A-4: does a restart while the reference adjudicator waits for the fallback's beacon round run its panel a second time | **Corrected: no, and the issue's real window is elsewhere** | The service checks the round before it calls any judge: `decideTask` runs `#preflight` first (`apps/adjudicator/src/service.ts:721-725`), and for the fallback and the appeal role `#preflight` returns "waiting" until the round's value is fetched and proven (`:815-827`). So during that wait no panel has run, and a restart loses nothing. On a phase-one deployment there is also no wait for cover. What remains of A-4: the judged result is kept in memory only (`:217-218`), so a restart after the panel returned and before the decision landed runs the panel again [measured by reading; no restart was run] |
| 3 | The invariant-to-test table of `invariants.md` | **Confirmed** | All eleven tests exist under their exact names in `contracts/test/invariant/RulesInvariants.t.sol`, and each body checks what its row says (the handler's counter, the balances or the state oracle the row names). Every model property the two tables name exists in `formal/Holdback.tla`. The pairing of a test with a model property is by subject; the page marks the loose ones "inferred" or "in part", and I found no pairing that is wrong [measured by reading both files] |
| 4 | The fallback window's floor: 43 s on mainnet from ADR-0032, 44 s in the API's notice | **Confirmed: both are right** | The fallback's round is published 29, 30 or 31 s after `judgeBy`, and the decision needs a block after that and before `fallbackBy`. Over every `judgeBy` in 720 s the smallest window that always has such a block is 43 s on Ethereum mainnet and 44 s on Sepolia; the 1 s comes from where each chain's 12 s slots fall against drand's 3 s rounds [measured: a script over both chains' genesis times, drand's genesis and a 29 s margin]. The operator's notice uses margin + period + block time, 29 + 3 + 12 = 44 s, on every chain (`fallbackFloorSec`, `apps/operator/src/prepare.ts:528`): exact on Sepolia and 1 s above the floor on mainnet, so it never tells a party a window is long enough when it is not |

## 7. The buyer signer and the one-operator question

**The buyer signer has one High finding (C-1, section 3), two Medium and ten Low; none lets a seller or an operator take a key or move money past the approved total.** A subagent read all 1,176 lines of `examples/buyer-signer.ts` at `e4e930c4`, with `examples/agent.ts` (394 lines), `examples/buy-with-signer.ts` (50 lines) and lines 1 to 475 of `examples/verify.ts`. It ran no deal and made no network call. I checked C-1, both Medium findings and six of the Low findings at the cited lines; the table says which. Line numbers are in `examples/buyer-signer.ts` unless a file is named. The path of C-1 was read again after T-390's fix (section 7.5).

### 7.1 Where the expectations come from

| Field the signer compares | The expected value comes from | When that source is silent |
| --- | --- | --- |
| The deliverable, the checks, the rubric, the fee, the windows, `maxSubmissions`, the adjudicators | The buyer's own terms file (`--expect-terms`), or else the seller's defaults (`differencesOf`, `:374-398`) | With no file and no defaults, every field is new and the run stops for approval |
| The settlement mode, the club, the rulebook hash | `Options.expect`, or else what every operator's discovery document says (`#expected`, `:711-731`) | The signer refuses and names the setting |
| The policy ID, the policy hash, the registry hash | `Options.expect`, and the primary adjudicator's own registration as every operator serves it (`:735-742`) | The signer refuses |
| The token | The pinned settlement layer, which every operator's discovery must match (`:674-678`) | The signer refuses |
| The buyer's address, encryption key and payment address | The buyer's own key file (`:793-796`) | Not applicable |
| The operator fee | Computed from the schedule both operators publish, never from the seller (`:680-681`) | A fee of 0 |
| The commitment ID and the seller's signature | Recomputed and recovered locally (`:670-672`) | The signer refuses |
| `createdAt`, and so every absolute deadline | **Nothing** (finding C-1) | Shown at the approval stop; never compared |

A misspelt key inside `expect` is refused (`expectOf`, `:418-424`). A misspelt option name, such as `expects`, falls back to the operators with no notice (`:494-500`) [the subagent's reading; not checked by me].

### 7.2 The resume path

- **What is saved:** one key file for each deal, mode 0600, written by an atomic rename: the keys, the quote, the shown offer, the checked terms, the funding files, the `paid` record; and a watch file for each deal with the reclaim and the outcome. No file name uses a commitment ID [the subagent's reading].
- **`Options.expect` is not saved.** After a restart the caller must give it again, or the operators' values apply. Recorded by T-332; still true.
- **One unparsable or foreign file stops `openDeals` and `loadKeys` for the whole store** (`:1145`, `:1172`): each parses every key file before it chooses [measured by reading]. Recorded by T-332 for the watch file; the key file widens it.
- **A resumed signer does not fund twice on a chain:** the funding nonce is derived from the terms and the ID (`examples/agent.ts:167`), so the token refuses a second use [inferred]. The Agree's nonce and the idempotency key are fresh on each try (`examples/agent.ts:60`, `:167`).

### 7.3 Findings in the tool, below High

| # | Severity | Finding | Checked by me |
| --- | --- | --- | --- |
| C-2 | Medium | **A funded deal with no saved `paid` record is invisible to `openDeals`.** `paid` is saved after the submit returns and the Held check passes (`:916-925`); `openDeals` takes only files that have it (`:1146`). A run that stops during the submit leaves a funded hold that `resume <store>` skips, with no reclaim armed. A second approve recovers it through the branch at `:919-923`. Nothing is lost | yes |
| C-3 | Medium | **Nothing but the approval stop tells the buyer which adjudicators it signs.** The policy fields are compared with the primary's own registration (`:735-742`), and `expect` has no setting for an adjudicator (`:416`). A seller that registers its own adjudicator passes every automatic check. The one-run path does require all three adjudicators in the terms file. The buyer's own check (D32) | yes |
| C-4 | Low | `acceptance.sealedChecks` and `acceptance.salt` are signed and never shown: the offer view takes the deterministic checks and the rubric only (`:693`) | yes, at the line; that they change the ID is the subagent's probe |
| C-5 | Low | The ID recompute accepts timestamps and integers that are not in canonical form; it needs both operators to serve them | no |
| C-6 | Low | Six messages carry text from a server without the `printable` filter (`:357`, `:593`, `:659`, `:916`, `:923`, `:1044`) | three of the six |
| C-7 | Low | `loadKeys` takes the first file that names an ID, and `quote` binds a key to the ID the seller claims before anything is checked (`:626-631`, `:1171-1173`): a second seller can shadow a pending deal's ID. Denial only | yes |
| C-8 | Low | A funding retry is a new request with a fresh idempotency key and Agree nonce (`examples/agent.ts:60`, `:167`) | yes |
| C-9 | Low | A misspelt option name, or `expect` left out after a restart, falls back to the operators with no notice | no |
| C-10 | Low | `differencesOf` misses an added check whose `id` is not a string (`:382-385`); it needs terms the schema refuses | no |
| C-11 | Low | `watch` reports nothing and never ends when the state is none of Held, Released or Refunded (`:1009-1047`) | no |
| C-12 | Low | The delivery's address is checked on the record the operators agree on (`:1110`), and the ciphertext is then fetched from the address in one operator's own answer (`examples/agent.ts:283-285`). The decryption and the two signed hashes bound it | yes |
| C-13 | Low | `same()` lowercases every 0x string before it compares, inside the deliverable and the checks too (`:305-306`) | yes |

**One record is stale.** T-332's Handoff says five signed fields are not shown. At `e4e930c4` four of them are in the offer view (`schemaVersion`, `remedy.onReject`, `nonce`, `createdAt`, `:408`), and `settlement.token` must equal the price's token and the pinned one (`:674-678`). None has an expectation.

### 7.4 One operator runs both nodes

**When one party runs both nodes, agreement between them proves nothing, and every expectation the buyer leaves out is that party's word.** The checks that reduce to it [the subagent's reading at the cited lines; I checked the first three rows]:

| Check | Lines | What a dishonest operator gains | Does `expect` close it |
| --- | --- | --- | --- |
| The settlement mode | `:719-723` | Nothing on phase one: the contract hashes one mode (`T:283`), so other terms cannot fund | yes |
| The club and the rulebook hash | `:726-731` | The buyer is bound to a rulebook it did not choose | yes |
| The policy ID, the policy hash, the registry hash | `:735-741` | A policy the buyer did not expect; an honest adjudicator declines a hash that is not its own | yes, for the values; not for which adjudicator |
| The operator fee | `:680-681` | A higher fee, up to the approved total or the budget | no |
| The reports: accepted, Held, Released, Refunded, the clock, the delivery record | `:814`, `:916`, `:1010-1035`, `:1103-1116` | False reports and delay. No money moves on an operator's word | no |

**What an operator cannot do, alone or with both nodes:** change the terms under an ID, forge the seller's signature, or move the hold. The signer recomputes the ID and recovers the signature itself, and the contract takes only signed steps.

**The smallest change that makes the default safe and refuses nothing new:**

1. One line at the offer, and one field in it, naming which expectations came from the operators and that both nodes name one operator when they do.
2. Save `expect` in the key file and use it again after a restart.
3. Later: take the settlement mode from the pinned contract, and check the adjudicator's registration signature.

Owner: T-390 for what it takes with C-1; the rest is a roadmap row for the client lane.

### 7.5 The path of C-1 after the fix

**The fix closes C-1 on the path I read: a postdated or backdated offer no longer funds on the one-run path.** I read T-390's change at the head of pull request 446 (`30114097`) [measured by reading; its five tests ran in CI, not by me]. It merged as `609cdd7e`, where the four files of the change equal the head I read [measured: `git diff --quiet 30114097 609cdd7e` on each]. The merge leaves `contracts/` as it is at `0180a39f` [measured].

- **The check.** `readOffer` now compares the offer's `createdAt` with every configured operator's settlement time and with this machine's own clock (`#clock` in `examples/buyer-signer.ts`). A `createdAt` more than 600 s behind or 60 s ahead of any of them is listed as a difference, and so is a `createdAt` that is not a date. The band is one constant, `CREATED_AT_BAND` in `examples/verify.ts`, the one a prepared offer is already held to.
- **The stop.** The one-run buy funds only when there is no difference (`examples/buy-with-signer.ts`), so a clock difference takes the run to the approval stop with exit status 3. Nothing is refused (D31): a person may still approve.
- **What the person sees.** Every approval stop now carries a timeline: `createdAt` and each of the five deadlines as a date and as a distance from now, counted on this machine's clock.
- **One party behind both nodes cannot set the clock.** The check uses this machine's clock too, which no operator reports; T-390's red team found the case where both operators lie together, and the fix covers it.
- **An approval cannot clear the difference unseen.** `checkOffer` keeps the clock differences the stop showed and compares the approval with them.
- **Tests** (`examples/buyer-signer-clock.test.ts`, T-390's): an offer postdated by five years and one backdated beyond the band each stop and fund nothing; both operators reporting a clock five years ahead still stop; an offer inside the band funds as before.
- **Left, by T-390's own record:** a machine or an operator whose clock is off by more than the band stops honest offers for approval, which fails safe.

## 8. The descriptions

**The descriptions of T-384's second pull request are true of the phase-one code: I found no sentence that describes the full protocol, and none that is false.** I read every description in the five source files at the pull request's head `256639f7` (pull request 441) against the code: the 487 lines of `IHoldbackRules.sol` in full, and every comment line the pull request adds or changes in `HoldbackRules.sol`, `HoldbackTypes.sol`, `IHoldbackBeacon.sol` and `DrandQuicknetBeacon.sol`. The pull request merged into the lane as `d3cd4605` on 2026-11-12 at about 19:16 UTC, and `contracts/src` there equals the head I read [measured: `git diff --quiet 256639f7 d3cd4605 -- contracts/src`].

- **The change is comments only** [measured: with comments and line breaks removed, each of the five files at `256639f7` equals its copy at the lane's tip `57fba5e3`]. T-384 proves the same by identical runtime code.
- **No description speaks of a cut feature as present.** Party appeals, bonds, Permit2, a free choice of token, payouts to other addresses and resubmissions appear only as "not in phase one". The appeal adjudicator is described each time as hearing escalations only.

**The escrow's expiry, sentence by sentence.** The pull request's reviewer asked for these to be read against the vendored escrow.

| Sentence (file at `256639f7`) | The escrow's code at `6b0a5ef` | Verdict |
| --- | --- | --- |
| "From it, the escrow refuses every capture, so no call that pays the seller or an adjudicator can land; the escrow's voids still work, and the buyer's payment address may also reclaim the hold on the escrow directly." (`IHoldbackRules.sol`, the deadlines) | `capture` reverts when `block.timestamp >= authorizationExpiry` (`E:277-279`). `void` has no time check (`E:304-316`). `reclaim` needs the payer as caller and reverts only when `block.timestamp < authorizationExpiry` (`E:323-327`) | Exactly true. "From it" is the expiry second itself [measured: `test_r11_captureStopsAtTheExpirySecond_andThePayersReclaimOpensThere`, `test_r11_voidStillLandsAtTheExpirySecond`] |
| "…to give the escrow's expiry, from which the escrow refuses captures and the buyer's payment address may reclaim the hold on the escrow directly" (`EXPIRY_MARGIN`) | the same lines | Exactly true |
| "every decision lands before `fallbackBy + appealDecideSec` … and the margin follows it. From it the escrow refuses captures; voids still work, and the payment address may reclaim the hold on the escrow itself." (`_escrowExpiry`) | the same lines; `R:223` with `_escalationDecideBy` for the bound | Exactly true [measured for the bound: `test_r11_lastPossibleDecisionCaptures_withAnExpiryMarginOfZero`] |
| "From the escrow's expiry the payment address may have reclaimed the hold on the escrow already; the deal then closes with nothing to void and no `Refunded`." (`_refundAll`) | `paymentState` returns the capturable amount (`E:75`); `R:502-506` reads it from the expiry on | Exactly true (`contracts/test/unit/AfterCppReclaim.t.sol`) |
| "the escrow's `AfterAuthorizationExpiry` from the escrow's expiry when the price is above 0" (`earlyAccept`), "…when the seller's share is above 0, and its `ZeroAuthorization` when the payment address has already reclaimed the hold" (`mutualSettle`) | `E:277-279`; `E:307-308` | True. One case is left out: see below |

**It also corrects two sentences that were imprecise at `c629d06c`.** There the comment on `EXPIRY_MARGIN` said that after the expiry "only the payment address's own reclaim on CPP remains", and the one on `_escrowExpiry` said the same. Voids remain too, which is how `reclaim` and `triggerDefault` still refund. The pull request's wording says so.

**One omission, Info, closed.** At `d3cd4605`, `earlyAccept`'s list of refusals did not name the escrow's `ZeroAuthorization`. It applies in one corner: a price of 0 with a fee above 0, after the escrow's expiry, once the payment address has reclaimed the hold. The call then reverts at the void of the fee (`R:340`, `E:307-308`) [measured: `test_r11_earlyAcceptAtPriceZero_afterThePayersReclaim_revertsAtTheVoid`]. `mutualSettle`'s list names the same error. T-384 added the sentence in pull request 445 (`0180a39f`), and it is true as written.

**The second family read the same descriptions** at `0180a39f` as its question 24, with the escrow attached and the expiry sentences first. It found each expiry sentence true, with the same lines of the escrow, and added one wording point: the descriptions say an accept and an early accept "pay the seller", and at a price of 0 the seller receives nothing while the key is still released (the second review, section 4.4).

## 9. Where I did not look

- **The arithmetic inside `DrandQuicknetBeacon.sol`.** I read the file for what the rules contract relies on: the round arithmetic, a revert on a bad proof, one valid encoding for each round. The pairing and hash-to-curve steps had their own review and second read (T-343, T-353).
- **OpenZeppelin's `SafeERC20`, Solady's `LibClone`, `ReentrancyGuardTransient` and `LibString`,** and Multicall3. I relied on their documented behaviour.
- **The token.** The test token and Sepolia's test USDC are outside `contracts/src`; token-issuer risk is out of scope.
- **Off-chain code,** except the lines of core and the operator that C-1 and L-1 cite, the adjudicator service's decision path (section 6.1), and the buyer signer.
- **Gas, the mutation run, coverage and static analysis:** T-352 (package R10).
- **Not run:** the anvil suites, the side-by-side harness beyond the forge suite, the formal model.

## 10. Recommendations and open questions

The joint summary of both reviews is section 6 of the second review. This review's own list:

| # | What | Owner |
| --- | --- | --- |
| 1 | Close C-1 in the buyer's tool before the pilot kit ships | Done: T-390, pull request 446 |
| 2 | Rate known issue "H-2 limit" Medium (finding M-1) and name it for the outside auditor | the freeze's docs step |
| 3 | Decide L-1: leave the dispute fields as a recorded limit, or add one comparison to `agreeAndFund` with its proof and a redeploy | Rafa; this review recommends leaving it |
| 4 | One line in the register for I-4 (two envelopes), one clause in `scope.md` for I-5 (the token's payee rule), and the wording "an accept or a reject is final" in the state model's section 9.1 | the freeze's docs step |
| 4b | In the descriptions, "pay the seller" reads "pay the seller the price, which may be 0" | the next change to the descriptions; not before the freeze |
| 5 | Name `ZeroAuthorization` in `earlyAccept`'s description (section 8) | Done: pull request 445 |
| 6 | Correct known issue A-4 as section 6.1 states it | the freeze's docs step |
| 7 | An advisory notice at the prepare route for a `createdAt` far from settlement time | a later roadmap row |
