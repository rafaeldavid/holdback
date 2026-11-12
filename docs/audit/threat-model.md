# Contract threat model

## Summary

This page names who can act on the contracts, what each actor can and cannot do, what is at stake, and the assumptions the contracts rest on. It describes the phase-one contracts in `contracts/src` at `<FREEZE_COMMIT>` ([`scope.md`](scope.md)). SimChain keeps the full protocol, appeals and bonds included; this page does not describe it. It changes no code and adds no finding beyond [`state-model.md`](state-model.md) section 11.

- **Every entry point of the rules contract is open to anyone.** Authority comes from a signature or an expired deadline, never from the caller [measured: `HoldbackRules.sol` does not read `msg.sender`].
- **No actor can move a hold outside the signed terms** [inferred from the transition table in `state-model.md` section 3].
- **The contracts rest on the assumptions of section 4.** Three were implicit in the code and are first stated here: the escrow's second copy of the hold (TA-1), the panel round's margin (TA-2) and the lack of an address-distinctness check (TA-4).
- **Phase one has no party appeals and no bonds on chain** (D57). The first decision by the primary or the fallback adjudicator is final, and so is the appeal adjudicator's decision after an escalation.
- **Phase one keeps contract signers and the on-chain beacon proof.** The maintainer refused scope cut SC-4 and did not cut SC-8, both on 2026-11-11. A multisig or another smart contract can be the buyer, the seller or an adjudicator, and any contract can relay a step.

Labels: **measured** (read in the named function or file), **inferred**, **guessed**. Citations follow `state-model.md`: contract code by function, error, event or constant name in `HoldbackRules.sol` and `HoldbackTypes.sol` (imported as `H`) at `<FREEZE_COMMIT>`; `E:` is a line of the Commerce Payments `AuthCaptureEscrow.sol` at `6b0a5ef`. Row numbers (P01 to P17) are that page's section 9.3. SC-n and IS-n are the labels of the contract refinement plan, which the maintainers keep privately ([`docs/private-materials.md`](../private-materials.md)).

## 1. Assets

| # | Asset | Where it sits | What protects it |
| --- | --- | --- | --- |
| AS-1 | **The hold:** `price + fee` of each funded deal | The escrow's token store for the rules contract (`E:420`) | Only the rules contract can capture or void (`_paymentInfo` makes it the operator; `E:270`, `E:304`); it does so only in the transitions of `state-model.md` section 3. From the escrow's expiry the buyer's payment address can also reclaim it directly (`E:323-340`) |
| AS-4 | **The buyer's content key:** the envelope that opens the delivered work | Off chain until released; then in a `KeyReleased` event (`_releaseKey`) | Released only in the call that pays the seller's payout address, or by a settlement both parties signed (`_settleDecision`, `earlyAccept`, `mutualSettle`). A decision never carries it on a reject (`decide`), and a closed deal has no turn (`_turn`) |
| AS-5 | **The record:** the deal's word and the events, as evidence of who signed what | The rules contract's storage and logs | No entry point rewrites a terminal row; there is no admin path (the contract's NatSpec: no owner, role, pause, upgrade, fallback or receive) |
| AS-6 | **Liveness:** every funded deal closes | The timeouts anyone may call (`reclaim`, `triggerFallback`, `triggerDefault`) | Each non-terminal row has a timeout (`state-model.md` section 3) |

The deployed model's assets AS-2 and AS-3, adjudicators' bonds and appeal bonds, are not in phase one.

## 2. Actors

"Can" lists what the contracts allow. "Cannot" lists what they refuse, with the code that refuses it.

| Actor | Can | Cannot |
| --- | --- | --- |
| **Buyer's signing key** (`buyer`) | Agree (`agreeAndFund`, `H.agreeHash`). Accept early, which pays the seller's payout address the price and returns the fee to the payment address (`earlyAccept`). Sign a settlement with the seller. Stay silent. Accept early after it reads an accept decision in the mempool; the adjudicator then earns no fee | Fund, unless the payment address is a wallet that accepts that key. Be refunded money itself. Take the hold back before `deliverBy` (`reclaim`, `TooEarly`). Stop a decision or a timeout: none needs its signature. Get the key from the contract without the payment (`_settleDecision`, `earlyAccept`, `decide`). Change the terms after it signs: the ID is their hash (`H.commitmentId`) |
| **Buyer's payment address** (`buyerPaymentAddress`) | Fund the deal with its ERC-3009 authorization (`agreeAndFund`, through `ERC3009_COLLECTOR`). Receive every refund. Reclaim the hold on the escrow from its expiry (`E:323-340`) | Agree, accept early or settle for the buyer. Stop a funded deal. Be made to fund a deal it did not sign for (ADR-0033 §3) |
| **Seller** (`seller`, with its payout address `sellerPayoutAddress`) | Sign the terms. Post one delivery before `deliverBy` (`_acceptDelivery`). Sign a settlement. Withhold the delivery. Name a payout address, a third party's included, when it signs the offer. Sign two deliveries and post the one a pending decision does not name, so that decision reverts (`decide`, `InvalidMessage`) and the adjudicator must judge again before its deadline | Take the hold without an accept, an early accept or a settlement. Deliver at or after `deliverBy` by any path (`_acceptDelivery`). Replace a posted delivery: one lands only from Held (`deliver`, `decide`, `earlyAccept`). Change the payout address after signing |
| **Primary adjudicator** | Accept the terms with `bondReserved` 0, which commits its panel seed through the seed tag (`agreeAndFund`, `H.seedTag`). Before `judgeBy`: accept (the payout address is paid), reject (the payment address is refunded) or escalate. It earns the fee on an accept or a reject (`_settleDecision`). Stay silent. Choose its own panel seed through the commitment (known issue DS-1). Read the delivered work, and so leak it (`neutrality.md`, residual 6) | Decide at or after `judgeBy` (`decide`, `DeadlinePassed`), twice (the decision leaves P03), or about a delivery other than the posted one (`decide`, `InvalidMessage`). Send the price anywhere but to the seller's payout address or the buyer's payment address (`_paymentInfo`). Release a key on a reject (`decide`) |
| **Fallback adjudicator** | After `triggerFallback` and before `fallbackBy`: accept, reject or escalate, with a seed fixed by the first beacon round after `judgeBy − 1 + BEACON_MARGIN` (`_fallbackRound`, `decide`) | Act before anyone calls `triggerFallback` (`_turn` gives the fallback a turn only in FallbackJudging). Choose its seed (`decide`, `BadSeed`) |
| **Appeal adjudicator** | Decide an escalated case, accept or reject, before `t1 + appealDecideSec`; that decision is final (`_escalationDecision`). It posts no bond | Escalate (`decide` allows it accept or reject only). Choose its seed (`_escalationRound`, `decide`, `BadSeed`). Decide a deal that is already closed: no stage gives it a turn (`_turn`) |
| **Anyone** (a relayer, an operator node, another protocol's contract, a stranger) | Call every entry point with messages others signed, from a plain account or from inside another contract's call. Call each timeout once it is due. Choose when to relay a signed message inside its validity window, or not to relay it | Change a signed field: the call fails the signature check (`_requireSigned`, `BadSignature`). Trigger a timeout early (`reclaim`, `triggerFallback`, `triggerDefault`, `TooEarly`). Gain any role: the contracts have no owner, pause, freeze, blacklist or upgrade proxy |
| **Block proposer** (or an L2 sequencer) | Order transactions in a block, and include or leave out a transaction for a time. At a deadline's boundary it picks which of two opposing calls lands | Know a panel's round when it builds the block that fixes it, unless it also proposes the two slots after and colludes with a party (TA-2; ADR-0032 §6, residual 1). Set a block time outside the chain's rules. Forge a signature or a beacon proof |
| **Token contract and its issuer** | Whatever the token's code allows: freeze an address, pause, charge a fee on transfer, rebase, call back into the caller. Token-issuer risk is out of scope ([`scope.md`](scope.md), [`SECURITY.md`](../../SECURITY.md)); section 3 lists what follows from it | Nothing the contracts enforce. The deployer fixes the deployment's one token (`TOKEN`), and funding refuses terms that name another (`agreeAndFund`) |
| **Beacon network** (drand quicknet) and the beacon contract | Stop publishing rounds; then no fallback or escalation decision can land, and the case defaults (`neutrality.md`, residual 10). A colluding threshold of nodes can bias a round | Target one deal with a round's value without that threshold. The beacon contract has no owner and no setter, and the rules contract's reference to it is immutable (`BEACON`) |
| **Escrow contracts** (Commerce Payments, third-party code) | Hold every deal's funds. Their correctness is assumed (TA-8) | Move funds without their operator, except the payer's own reclaim after expiry (`E:323`). The rules contract is the operator of every deal's payment (`_paymentInfo`) |
| **Deployer and Crow's maintainers** | Choose the constructor's arguments once: the escrow, the ERC-3009 collector, the expiry margin, the beacon, the token and the beacon margin. The constructor refuses a zero address for the escrow, the collector, the beacon or the token (`ZeroAddress`), and a beacon margin of 0 on any chain but the local one (`NoBeaconMargin`). It checks nothing else, such as the code at those addresses. Deploy a new version beside the old one | Change, pause, upgrade or drain a deployed contract. Change a deal's terms |
| **A contract as a signer** (ERC-1271: a multisig, a smart account) | Be the buyer, the payment address, the seller or any adjudicator; phase one keeps this (SC-4 is refused). Its code runs inside each signature check (`_requireSigned`). Answer differently from one call to the next | Change state from inside a check: the check is a read-only call [inferred: Solady's checker uses a static call; not read in full]. Change a step already taken: each step checks its own message once, so a changed answer blocks that signer's own next step and nothing else. Agree and fund in one call before the wallet is deployed: the buyer's agreement is checked before the funding step could deploy it (`agreeAndFund` checks the signatures before `ESCROW.authorize`), so the wallet must exist first |

## 3. What follows from the token's behaviour

Token-issuer risk is out of scope. The contracts still behave in a definite way when a token refuses a transfer, and a reader should know it [measured in the named functions; inferred that no other path exists].

| The token refuses a transfer to | What stops | What still works |
| --- | --- | --- |
| the buyer's payment address | Every refund path: a reject (`_settleDecision`), `reclaim` and `triggerDefault` (`_refundAll`), the fee's return on early accept (`earlyAccept`), and its own reclaim on the escrow. A reject then pays the adjudicator no fee either, because the failed refund reverts the whole call | An accept decision. Nothing is reserved, so nothing else is stranded |
| the seller's payout address | An accept, an early accept, a settlement that pays the seller's share | A reject, a reclaim, a default |
| the deciding adjudicator | Any decision with a fee above zero (`_settleDecision`) | An escalation, then the next adjudicator or the default |

A token that charges a fee on transfer cannot fund: the escrow checks the exact amount received (`E:424`). The deployment's token must be a plain ERC-20 with ERC-3009 ([`scope.md`](scope.md)).

A token that calls back into the contracts during a transfer finds the deal's word already written: every call to the escrow comes after the state write [measured: `agreeAndFund`, `_firstInstance`, `_escalationDecision`, `earlyAccept`, `mutualSettle`, `_refundAll`]. The escrow also guards itself against reentry (`E:241`, `E:269`, `E:304`). The rules contract has no reentrancy guard of its own.

A nested call needs no hostile token. The ERC-3009 collector unwraps an ERC-6492 funding signature and makes the call it names, through Multicall3 (`collectors/ERC6492SignatureHandler.sol:52-58` in the pinned CPP). The wrapper is not signed, so whoever relays `agreeAndFund` chooses that call. It runs after the deal's word says Held (`agreeAndFund` writes the word before `ESCROW.authorize`) and before the tokens arrive (`E:250-255`). It can take only the steps anyone could take in the next transaction: a nested capture or void fails at the escrow's guard, and a delivery or an escalation lands on a legal row. `triggerFallback` cannot: funding needs `now < fundBy < judgeBy` [inferred from `agreeAndFund`; `contracts/test/crosscheck/Erc6492Prepare.t.sol`, `test_defense_prepareCallWithD31Timing_refusedBeforeThePrepareCall`, shows such terms refused before the prepare call].

## 4. Assumptions

Each assumption names what the contracts rely on, where, and what happens if it fails. The deployed model's TA-3 and TA-10, about the vault's push payments and a bond held through a long appeal window, are not in phase one.

| # | Assumption | Where the code relies on it | If it fails |
| --- | --- | --- | --- |
| TA-1 | **The escrow holds a second copy of "is the money held", and after its expiry the two copies can differ.** From `fallbackBy + appealDecideSec + EXPIRY_MARGIN` the buyer's payment address can empty the escrow directly while the word still says funded (P02 to P05). The contract refuses terms out of order, so every timeout is due by then. A reader must check the escrow's state, not only the word, after the expiry. The plan's IS-6 | `agreeAndFund` (the order), `_escrowExpiry`, `_refundAll`, `E:323-340` | An integrator that reads the stage alone reports a hold that is gone |
| TA-2 | **The party that sends a step picks its block, and a margin keeps the panel's round unknown when that block is built.** The fallback's round is the first published after `judgeBy − 1 + BEACON_MARGIN`; an escalation's is the first after `t1 + BEACON_MARGIN` (ADR-0032). The margin is 29 s on Ethereum mainnet and Sepolia, so the round is public at least 30 s after the last choice. The plan's IS-7 | `BEACON_MARGIN`, `_roundAfter`, `_fallbackRound`, `_escalationRound` | A validator operator that proposes three slots in a row and colludes with a party can learn the seed before the step is fixed: one known draw, then one blind draw. Accepted for phase one; the mainnet gate measures how often such runs occur (ADR-0032 §6, BR-6) |
| TA-4 | **Nothing requires the parties' four addresses and the three adjudicators to differ from each other.** The parties sign terms that name all of them, and each party reads them before it signs. The plan's IS-14 | `agreeAndFund` has no such check (ADR-0033 §2) | A seller that is also the adjudicator accepts its own work. A payment address equal to the payout address makes every settlement payout the seller's share (`_payOut`) |
| TA-5 | **The token moves exactly the amount asked, lets every transfer through and does not call back.** Out of scope as issuer risk; section 3 lists the effects | every transfer | Section 3 |
| TA-6 | **Block time moves forward, stays within the chain's rules, and is between 1 and 2^40 − 1.** A party does not rely on a call landing in the last block before a deadline | every deadline; `t1` is 40 bits wide (`Deal.t1`) | A proposer decides which of two opposing calls lands at the boundary |
| TA-7 | **A party's key signs only what the party means.** A contract signer answers the same way each time it is asked. Signed messages are public once sent, and anyone may relay them until they expire | `_requireSigned`; message expiries in `agreeAndFund`, `decide`, `earlyAccept`, `mutualSettle` | An adjudicator that signs both an accept and a reject leaves the outcome to whoever relays first; both signatures remain as evidence. A contract signer that changes its answer blocks its own next step |
| TA-8 | **The escrow's code is correct, and the rules contract is the only operator of a deal's payment.** The payment's hash covers the operator's address and the deal's ID as salt | `_paymentInfo`, `E:383-386` | A fault in the escrow reaches every hold |
| TA-9 | **The beacon is honest below its threshold and reachable, and the chain has the EIP-2537 precompiles.** | `decide` (the beacon proof); `DrandQuicknetBeacon.beaconValue` | Without a provable round, no fallback or escalation decision lands and the case defaults to a refund. A colluding threshold picks panel seeds |
| TA-11 | **The parties sign terms that settlement can process.** The contract refuses deadlines out of order, an escalation window of 0, more than one attempt and an appeal window other than 0 (`agreeAndFund`). It does not refuse the dispute fields | `state-model.md` 6.3 and 8.3 | A party signs a promise the contract ignores (section 8.3, rows 2 to 4). A short window is a stated limit (`state-model.md` F-2) |
| TA-12 | **A reader derives the outcome from the closing reason and the decider, not from the stage alone.** Released and Refunded each have more than one cause | `Deal.reason`, `Deal.decider`; `state-model.md` section 7 | An integrator that reads the stage alone reports the wrong cause or the wrong fee recipient |
| TA-13 | **A wrong final decision has no remedy on chain.** Every decision is final when written: the primary's or the fallback's accept or reject, and the appeal adjudicator's decision after an escalation. The parties choose the adjudicators, and the law is the backstop (`CLAUDE.md`, "the law stays the backstop") | `_firstInstance`, `_escalationDecision` | A colluding or mistaken adjudicator moves one deal's price and fee. The signed decision and the judgment record hash remain as evidence (`Decided`) |
| TA-14 | **The chain does not reorganise past a deadline's margin, and each deployment is used on one chain.** The EIP-712 domain binds the chain ID and the contract's address; a second token needs a second deployment, and so a second domain | `TOKEN`, `_domainNameAndVersion` | A reorganisation can swap the order of two opposing calls near a deadline |
| TA-15 | **The buyer's payment address trusts the buyer's signing key with this deal's hold.** Its ERC-3009 authorization funds one deal, and after funding the signing key alone accepts early and settles | `agreeAndFund`; `earlyAccept`, `mutualSettle` | The signing key can accept early or settle against the payment address's interest. The loss is bounded by `P + F` and the operator fee (ADR-0033 §11) |
| TA-16 | **The deployment's token is a plain ERC-20 with ERC-3009:** no fee on transfer, no rebasing, no transfer hook. The contract cannot check this | `TOKEN`; the funding through `ERC3009_COLLECTOR` | Section 3 |

## 5. Attack classes and where each is handled

Each row names what an attacker tries, the code that refuses it and the test that covers it. The tests are named from the files in `contracts/test/` at `<FREEZE_COMMIT>` [measured on the lane's tip: the files and the invariant names exist; their bodies were not read for this page].

| Class | What the attacker tries | Refused at | Test |
| --- | --- | --- | --- |
| A forged or replayed signature | Reuse a signature on another deal, role, chain or contract | The EIP-712 domain (`_domainNameAndVersion`); every struct hash binds the commitment ID (`HoldbackTypes`); the step leaves the row it needs | `unit/Vectors.t.sol`, `crosscheck/Erc1271Replay.t.sol`, `crosscheck/TokenAndDomain.t.sol`; `invariant_noMovementWithoutAuthority` |
| A relayer changes a message | Alter a field, or reorder steps | Every field is signed (`_requireSigned`); each step checks the stage | `unit/Decide.t.sol`, `unit/Settle.t.sol` |
| Moving a hold outside the terms | Capture or void without a decision, an early accept, a settlement or a due timeout | `state-model.md` section 3; only the rules contract operates the escrow (`_paymentInfo`) | `invariant_conservation`, `invariant_escrowMatchesState` |
| Settling twice | Release and refund one hold | Every settlement leaves the funded rows before its first escrow call | `invariant_settleOnce` |
| A timeout too early, or blocked | Trigger before the deadline, or stop one after it | The opposing pairs of `state-model.md` 6.2; no caller check | `unit/Timeouts.t.sol`; `invariant_timeoutsExactlyWhenDue` |
| A late delivery beats the reclaim | Land a delivery at or after `deliverBy` | `_acceptDelivery` on every path | `unit/LateCarriedDelivery.t.sol` |
| Seller equivocation | Settle a signature about one delivery with another | `decide`, `earlyAccept`, `mutualSettle` require the posted delivery's hash | `unit/DeliveryBinding.t.sol` |
| The key without the payment | Release the buyer's key on a refunded deal | `decide` (a key only with an accept); `_turn` (no turn on a closed deal) | `unit/AppealKey.t.sol`, `unit/PhaseOneNoBonds.t.sol`, `attack/PhaseOneRedTeam.t.sol`; `invariant_keyOnlyWithPayment` |
| A deal stranded after the payment address's own reclaim | Leave the deal open when the escrow is empty | `_refundAll` | `unit/AfterCppReclaim.t.sol` |
| A seed the decider chooses | Pick a fallback or escalation seed through a free field | `decide` (role, attempt, round and seed checks) | `unit/AppealAttempt.t.sol`, `unit/DrandDecide.t.sol`, `unit/SeedTag.t.sol` |
| A panel round known when its step lands | Fix the round in a block whose builder already knows it | `_roundAfter`, `_fallbackRound`, `_escalationRound` | `unit/BeaconMargin.t.sol`, `crosscheck/DrandRedTeam.t.sol` |
| A forged beacon round | Prove a round with a bad signature | `DrandQuicknetBeacon.beaconValue` and its point checks (`InvalidSignature`) | `unit/DrandBeacon.t.sol`, `crosscheck/DrandEncodings.t.sol`, `crosscheck/DrandAllRounds.t.sol` |
| Funding in another token | Name a token other than the deployment's | `agreeAndFund` (`TOKEN`) | `unit/SingleToken.t.sol` |
| Funding through Permit2, not in phase one | Fund by a method other than ERC-3009 | `agreeAndFund` (`ERC3009_COLLECTOR` only) | `unit/Erc3009Only.t.sol` |
| A settlement payout to a third address | Pay anyone but the two money addresses | `_payOut` | `unit/PartiesOnlyPayout.t.sol` |
| Money to or from a signing address | Move a signing address's money when the money addresses are apart | `_paymentInfo`, `_payOut` | `unit/TwoAddresses.t.sol`; `invariant_signingAddressesMoveNoMoney` |
| Terms settlement cannot process | Fund terms out of order, or with values core cannot represent | `agreeAndFund` (`InvalidMessage`, `Unrepresentable`) | `unit/StrictTerms.t.sol`, `unit/Unrepresentable.t.sol` |
| A decision on a closed deal | Decide again, or with another role, after the deal closed | `_turn` | `unit/PhaseOneNoBonds.t.sol`, `attack/PhaseOneRedTeam.t.sol` |
| An admin path | Upgrade, pause, destroy or drain | None exists | `fuzz/NoAdmin.fuzz.t.sol`; `invariant_noAdminPath` |

`invariant_escrowMatchesState` holds only while no deal passes the escrow's expiry with its hold reclaimed; TA-1 is the state it does not cover [inferred from the invariant's name and `state-model.md` 5.2].

## 6. What the contracts do not defend against

Each is accepted or tracked elsewhere; this list points to it.

- A payout address that is one of the deployment's contracts, such as the rules contract or the escrow's token store. Both parties signed the terms that name it, and the seller's payment is stranded there (ADR-0033 §8). A settlement payout to any address but the two money addresses reverts (`_payOut`).
- An adjudicator that colludes with one party, or leaks the work it reads: `neutrality.md`, residuals 3 and 6.
- A wrong first decision: it is final on chain (TA-13), and the loss is bounded by one deal's price and fee.
- An accept whose key does not decrypt the work: no remedy on chain (threat T19).
- Party appeals and bonds, with known issues L-3, L-5, A-1 and A-2, are not in phase one; SimChain keeps them ([`known-issues.md`](known-issues.md), section 9).
- A buyer or a pair of parties that closes a deal just before a decision lands, so the adjudicator earns no fee: by design, the fee returns to the buyer's payment address on an early accept and on a settlement (`earlyAccept`, `_payOut`).
- The public skeleton of every deal: `neutrality.md`, residual 9.
- A token issuer's controls: out of scope.

## 7. A deal with price 0

**A deal with price 0 and a fee above 0 moves only the fee, and only to the party the terms name** [measured by [`ZeroPrice.t.sol`](../../contracts/test/unit/ZeroPrice.t.sol), T-345, ported by T-375; [`state-model.md`](state-model.md) section 12 has the table by outcome]. The maintainer decided on 2026-11-11 that the contract keeps a price of 0 (ADR-0031 §6). What changes for the actors:

- **The hold is the fee alone.** A decision pays the whole hold to the decider (`_settleDecision`). Every other exit returns it to the buyer's payment address. No path pays the seller's payout address anything, and a settlement refuses any payout (`_payOut`).
- **Section 3 relaxes.** With `P = 0` an accept and an early accept send the payout address nothing (`E:471`, `earlyAccept`), and a reject sends the payment address nothing (`_settleDecision`). A token that refuses transfers to the payout address does not stop an accept, and one that refuses the payment address does not stop a reject [inferred from that code; the tests use a token that lets every transfer through].
- **Events carry zero amounts.** `PaymentReleased(seller, 0)` and `Refunded(buyer, 0)` are emitted for payments that move nothing. A reader takes the amount from the event, not from its name.
- **Price 0 with fee 0 cannot be funded.** The escrow refuses a hold of 0 with `ZeroAmount()` (`E:179`), and nothing is stored. Core's phase-one profile refuses these terms at the offer (`ZERO_HOLD_PROBLEM` in `packages/core/src/state.ts`), so no operator prepares a funding call that reverts.

## Where this page did not look

- **Not read in full:** the ERC-3009 collector, `TokenStore.sol`, and Solady's signature library. The claims about them come from [`scope.md`](scope.md) and the reviews it cites.
- **Not run for this page:** no invariant campaign and no model check. The unit tests passed on the lane on 2026-11-12 ([`scope.md`](scope.md)).
- **Not covered:** the off-chain components (the operators, the reference adjudicator, the judgment pipeline). [`scope.md`](scope.md) lists what each may and may not do.
