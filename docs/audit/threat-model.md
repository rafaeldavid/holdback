# Contract threat model

## Summary

This page names who can act on the contracts, what each actor can and cannot do, what is at stake, and the assumptions the contracts rest on. It describes `contracts/src` at commit `26d4670`, which equals the deployed commit `64be1f1` ([`scope.md`](scope.md)). It changes no code and adds no finding beyond [`state-model.md`](state-model.md) section 11.

- **Every entry point of the rules contract is open to anyone.** Authority comes from a signature or an expired deadline, never from the caller [measured: `HoldbackRules.sol` does not read `msg.sender`].
- **No actor can move a hold outside the signed terms** [inferred from the transition table in `state-model.md` section 3].
- **The contracts rest on 14 assumptions** (section 4). Four are implicit in the code today and stated here for the first time: the escrow's second copy of the hold (TA-1), the block proposer's view of a beacon round (TA-2), the vault's push payments (TA-3) and the lack of an address-distinctness check (TA-4).
- **Phase one drops party appeals and bonds** (scope cut SC-7, accepted on 2026-11-11). Rows marked "leaves with SC-7" describe the deployed contracts and do not apply after that cut.

Labels: **measured** (read at the cited line), **inferred**, **guessed**. Citations follow `state-model.md`: `R:` is `HoldbackRules.sol`, `B:` is `HoldbackBonds.sol`, `T:` is `HoldbackTypes.sol`, `E:` is the Commerce Payments `AuthCaptureEscrow.sol` at `6b0a5ef`. Row numbers (L01 to L37) are that page's. SC-n and IS-n are the labels of the contract refinement plan, which the maintainers keep privately ([`docs/private-materials.md`](../private-materials.md)).

## 1. Assets

| # | Asset | Where it sits | What protects it |
| --- | --- | --- | --- |
| AS-1 | **The hold:** `price + fee` of each funded deal | The escrow's token store for the rules contract (`E:420`) | Only the rules contract can capture or void (`R:174`, `E:270`, `E:304`); it does so only in the transitions of `state-model.md` section 3. From the escrow's expiry the buyer can also reclaim it directly (`E:323-340`) |
| AS-2 | **Adjudicators' bonds,** free and reserved (leaves with SC-7) | The bond vault (`B:20-21`) | Only the rules contract reserves, releases or pays from them (`B:49-52`); an adjudicator withdraws only the free part (`B:63-65`) |
| AS-3 | **Appeal bonds** (leaves with SC-7) | The bond vault (`B:28`) | Held from the filing until the appeal closes (`R:516`, `R:376`, `R:590`) |
| AS-4 | **The buyer's content key:** the envelope that opens the delivered work | Off chain until released; then in a `KeyReleased` event (`R:114`, `R:648`) | Released only in the call that pays the seller, or by a settlement both parties signed (`R:350-354`, `R:404-417`, `R:444-456`); refused on a deal that stands Refunded (`R:283`) |
| AS-5 | **The record:** the deal's word and the events, as evidence of who signed what | The rules contract's storage and logs | No entry point rewrites a terminal row; there is no admin path (`R:18`) |
| AS-6 | **Liveness:** every funded deal closes | The timeouts anyone may call (`R:533-592`) | Each non-terminal row has a timeout (`state-model.md` section 3) |

## 2. Actors

"Can" lists what the contracts allow. "Cannot" lists what they refuse, with the line that refuses it.

| Actor | Can | Cannot |
| --- | --- | --- |
| **Buyer** | Fund a deal it agreed to (`R:208`, `R:218`). Accept early, which pays the seller the price and returns the fee to the buyer (`R:412-413`). Sign a settlement with the seller. Appeal a release (`R:511`; leaves with SC-7). Reclaim the hold on the escrow from the escrow's expiry (`E:323-340`). Stay silent. Accept early after it reads an accept decision in the mempool; the adjudicator then earns no fee | Take the hold back before `deliverBy` (`R:537`), or after a delivery lands except by a reject, a default or a settlement. Stop a decision or a timeout: none needs its signature. Get the key from the contract without the payment (`R:350`, `R:404`, `R:283`). Change the terms after it signs: the ID is their hash (`T:270-294`) |
| **Seller** | Sign the terms. Post one delivery before `deliverBy` (`R:623-624`). Sign a settlement. Appeal a refund (leaves with SC-7). Withhold the delivery. Sign two deliveries and post the one a pending decision does not name, so that decision reverts (`R:276`) and the adjudicator must judge again before its deadline | Take the hold without an accept, an early accept or a settlement. Deliver at or after `deliverBy` by any path (`R:623`). Replace a posted delivery: `_acceptDelivery` runs only from Held (`R:229`, `R:244`, `R:401`) |
| **Primary adjudicator** | Accept the terms, which commits its panel seed and reserves its bond (`R:207-215`). Before `judgeBy`: accept (the seller is paid), reject (the buyer is refunded) or escalate. It earns the fee on an accept or a reject (`R:351`, `R:356`). Stay silent. Choose its own panel seed through the commitment (known issue DS-1). Read the delivered work, and so leak it (`neutrality.md`, residual 6) | Decide at or after `judgeBy` (`R:286`), twice (the decision leaves row L04), or about a delivery other than the posted one (`R:276`). Send the price anywhere but to the seller or the buyer (`R:175-176`). Release a key on a reject (`R:283`). Withdraw a reserved bond (`B:63-64`) |
| **Fallback adjudicator** | After `triggerFallback` and before `fallbackBy`: accept, reject or escalate, with a seed fixed by the beacon round at `judgeBy` (`R:258-261`, `R:290-297`). An accept or a reject reserves its bond (`R:327`), so an uncovered fallback can only escalate | Act before anyone calls `triggerFallback` (`R:258`). Choose its seed (`R:291-292`). Have its bond reserved without its own decision (`R:324-327`) |
| **Appeal adjudicator** | Decide an escalated case, accept or reject, before `t1 + appealDecideSec`; that decision is final (`R:340`). Decide a party appeal, which moves the price out of the first decider's bond when it overturns (`R:378`; leaves with SC-7). It posts no bond for either (known issue L-5) | Escalate (`R:277`). Choose its seed (`R:265`, `R:269`, `R:291-292`). Reopen a closed appeal (`R:266`) |
| **Anyone** (a relayer, an operator node, a stranger) | Call every entry point with messages others signed. Call each timeout once it is due. Choose when to relay a signed message inside its validity window, or not to relay it. Record the expiry of any terms whose funding deadline has passed, signed or not (`R:523-530`) | Change a signed field: the call fails the signature check (`R:660-664`). Trigger a timeout early (`R:527`, `R:537`, `R:547`, `R:561`, `R:563`, `R:580`, `R:582`). Gain any role: the contracts have no owner, pause, freeze, blacklist or upgrade proxy (`R:18`, `B:11`) |
| **Block proposer** (or an L2 sequencer) | Order transactions in a block, and include or leave out a transaction for a time. At a deadline's boundary it picks which of two opposing calls lands. It can see a beacon round before it includes the step that fixes that round (TA-2) | Set a block time outside the chain's rules. Forge a signature or a beacon proof |
| **Token contract and its issuer** | Whatever the token's code allows: freeze an address, pause, charge a fee on transfer, rebase, call back into the caller. Token-issuer risk is out of scope ([`scope.md`](scope.md), [`SECURITY.md`](../../SECURITY.md)); section 3 lists what follows from it | Nothing the contracts enforce. The parties choose the token in the signed terms (`R:177`); SC-1 fixes one token per deployment |
| **Beacon network** (drand quicknet) and the beacon contract | Stop publishing rounds; then no fallback or escalation decision can land, and the case defaults (`neutrality.md`, residual 10). A colluding threshold of nodes can bias a round | Target one deal with a round's value without that threshold. The beacon contract has no owner and no setter, and the rules contract's reference to it is immutable (`R:80`) |
| **Escrow contracts** (Commerce Payments, third-party code) | Hold every deal's funds. Their correctness is assumed (TA-8) | Move funds without their operator, except the payer's own reclaim after expiry (`E:323`). The rules contract is the operator of every deal's payment (`R:174`) |
| **Deployer and Crow's maintainers** | Choose the constructor's arguments once: the escrow, the collectors, the expiry margin and the beacon (`R:134-147`). The constructor checks none of them. Deploy a new version beside the old one | Change, pause, upgrade or drain a deployed contract. Change a deal's terms |
| **A contract as a signer** (ERC-1271) | Be any party. Answer a signature check differently from one call to the next (`R:661`). SC-4 would refuse such signers | Change a step already taken: each step checks its own message once |

## 3. What follows from the token's behaviour

Token-issuer risk is out of scope. The contracts still behave in a definite way when a token refuses a transfer, and a reader should know it [measured at the cited lines; inferred that no other path exists].

| The token refuses a transfer to | What stops | What still works |
| --- | --- | --- |
| the buyer | Every refund path: a reject (`R:357`), `reclaim` and `triggerDefault` (`R:609`), the fee's return on early accept (`R:413`), the buyer's own reclaim on the escrow | An accept decision. The primary's reservation stays until the deal closes |
| the seller | An accept, an early accept, a settlement that pays the seller | A reject, a reclaim, a default |
| the deciding adjudicator | Any decision with a fee above zero (`R:351`, `R:356`) | An escalation, then the next adjudicator or the default |
| an appellant (leaves with SC-7) | An overturn and the expiry of an open appeal (`R:376`, `R:590`): the first decider's reservation stays (TA-3) | An upheld appeal |

A token that charges a fee on transfer cannot fund: the escrow checks the exact amount received (`E:424`). It can still under-fund the vault (known issue L-2).

A token that calls back into the contracts during a transfer finds the deal's word already written: every call to the escrow, and every vault call that moves tokens, comes after the state write [measured: `R:211-218`, `R:321-333`, `R:341-342`, `R:373-378`, `R:407-413`, `R:450-454`, `R:514-516`, `R:587-590`, `R:598-609`]. The vault's `release` and `encumber` can come before the write (`R:317`, `R:326-327`, `R:337`, `R:370`); they change totals and call no other contract (`B:74-84`). The escrow also guards itself against reentry (`E:241`, `E:269`, `E:304`). The rules contract has no reentrancy guard of its own.

## 4. Assumptions

Each assumption names what the contracts rely on, where, and what happens if it fails.

| # | Assumption | Where the code relies on it | If it fails |
| --- | --- | --- | --- |
| TA-1 | **The escrow holds a second copy of "is the money held", and after its expiry the two copies can differ.** From `fallbackBy + appealDecideSec + EXPIRY_MARGIN` the buyer can empty the escrow directly while the deal's word still says funded (rows L03 to L06). The contracts assume the parties signed deadlines in order, so every timeout is due by then, and that a reader checks the escrow's state, not only the word, after the expiry. The plan's IS-6 | `R:169`, `R:603-608`, `E:323-340` | With deadlines out of order, the word stays open and the primary's bond stays reserved until `deliverBy` or `judgeBy` (`state-model.md` 5.2, 6.3). An integrator that reads the stage alone reports a hold that is gone. SC-5 enforces the order |
| TA-2 | **The party that sends a step picks its block, and the block's time picks the beacon round.** An escalation's round is `roundAt(t1) + 1` and an appeal's is `roundAt(t2) + 1`, where `t1` and `t2` are the block times of the escalation and the filing. A block proposer, or a sender it helps, can know that round's value before the step is included, and can include the step or hold it for a later block. The fallback's round, `roundAt(judgeBy)`, is public before the primary's deadline (known issue T-225 M1). The plan's IS-7 | `R:261`, `R:265`, `R:269` | The sender gets one choice of panel seed per block until its deadline. Accepted for Sepolia only (review item I-5). The planned fix leaves a margin of one block |
| TA-3 | **The vault pays by pushing tokens inside a state change, and every recipient can receive them.** An overturn pushes the price to the wronged party and the appeal bond back to the appellant; an expired open appeal pushes the bond back in the same call that frees the first decider's reservation. The plan's IS-11. Leaves with SC-7 | `B:92`, `B:115`, `R:376-378`, `R:589-590` | A recipient that cannot receive the token makes the call revert. For an open appeal both ways out then revert, and the first decider's reservation never frees |
| TA-4 | **Nothing requires the buyer, the seller and the three adjudicators to be different addresses.** The parties sign terms that name all five, and each party reads them before it signs. The plan's IS-14 | `R:193-219` has no such check | An appeal adjudicator that is also the first decider can uphold its own decision and take the appellant's bond into its own. A seller that is also the adjudicator accepts its own work. A buyer that is also the seller makes a sham deal that holds the primary's bond (known issues A-1, A-2) |
| TA-5 | **The token moves exactly the amount asked, lets every transfer through and does not call back.** Out of scope as issuer risk; section 3 lists the effects | every transfer | Section 3 |
| TA-6 | **Block time moves forward, stays within the chain's rules, and is between 1 and 2^40 − 1.** A party does not rely on a call landing in the last block before a deadline | every deadline; `t1` and `t2` are 40 bits wide (`R:52-53`) | A proposer decides which of two opposing calls lands at the boundary |
| TA-7 | **A party's key signs only what the party means.** A contract signer answers the same way each time it is asked. Signed messages are public once sent, and anyone may relay them until they expire; an appeal has no expiry and is good for its whole window | `R:660-664`; message expiries at `R:204`, `R:243`, `R:399`, `R:434` | An adjudicator that signs both an accept and a reject leaves the outcome to whoever relays first; both signatures remain as evidence. SC-4 removes contract signers |
| TA-8 | **The escrow's code is correct, and the rules contract is the only operator of a deal's payment.** The payment's hash covers the operator's address and the deal's ID as salt | `R:163-187`, `E:383-386` | A fault in the escrow reaches every hold |
| TA-9 | **The beacon is honest below its threshold and reachable, and the chain has the EIP-2537 precompiles.** | `R:290-297`; `DrandQuicknetBeacon.sol:79-87` | Without a provable round, no fallback or escalation decision lands and the case defaults to a refund. A colluding threshold picks panel seeds |
| TA-10 | **An adjudicator reads the terms before it accepts or decides.** The acceptance reserves the primary's bond until the deal closes or the appeal window ends, and the contract puts no upper limit on that window; the fallback's decision does the same for the fallback. Leaves with SC-7 | `R:215`, `R:327`, `R:577` | A long `appealWindowSec` holds a bond for as long as the terms say |
| TA-11 | **The parties sign terms that settlement can process:** deadlines in order, windows above zero, one attempt, no dispute fields. The contract checks none of these today | `state-model.md` 6.3 and 8.3 | A party loses its turn, or signs a promise the contract ignores. SC-5 and the register's verdicts close it |
| TA-12 | **A reader derives the outcome from the whole word, not from the stage.** An overturned deal keeps its first stage, and three causes share one row | `state-model.md` section 7 | An integrator reports the wrong outcome |
| TA-13 | **A wrong final decision has no remedy on chain.** An escalation decision is final today; after SC-7 every decision is. The parties choose the adjudicators, and the law is the backstop (`CLAUDE.md`, "the law stays the backstop") | `R:340`; SC-7 | A colluding or mistaken adjudicator moves one deal's price. The signed decision and the judgment record hash remain as evidence (`R:302`) |
| TA-14 | **The chain does not reorganise past a deadline's margin, and each deployment is used on one chain.** The EIP-712 domain binds the chain ID and the contract's address | `R:666-668` | A reorganisation can swap the order of two opposing calls near a deadline |

## 5. What the contracts do not defend against

Each is accepted or tracked elsewhere; this list points to it.

- An adjudicator that colludes with one party, or leaks the work it reads: `neutrality.md`, residuals 3 and 6.
- An appeal adjudicator that decides a party appeal with no bond of its own: known issue L-5. Leaves with SC-7.
- A free appeal that can win the price from the first decider's bond: known issue L-3. Leaves with SC-7.
- Sham deals that tie up an adjudicator's bond: known issues A-1 and A-2. Leave with SC-7.
- A buyer or a pair of parties that closes a deal just before a decision lands, so the adjudicator earns no fee: by design, the fee returns to the buyer on an early accept and on a settlement (`R:413`, `R:483`).
- The public skeleton of every deal: `neutrality.md`, residual 9.
- A token issuer's controls: out of scope.

## Where this page did not look

- **Not read in full:** the two payment collectors, `TokenStore.sol`, and Solady's signature library. The claims about them come from [`scope.md`](scope.md) and the reviews it cites.
- **Not run:** no test and no model check.
- **Not covered:** the off-chain components (the operators, the reference adjudicator, the judgment pipeline). [`scope.md`](scope.md) lists what each may and may not do.
