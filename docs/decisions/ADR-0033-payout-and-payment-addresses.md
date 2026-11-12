# ADR-0033: A payout address for the seller and a payment address for the buyer

- **Status:** Proposed, 2026-11-11. Rafa decided the substance the same day (ADR-0031 section 11, D58 item 5 and its amendment). This ADR is the design he asked for; he may overrule any line. Nothing here is built. On 2026-11-11 he also decided two of its open points (D62): the field names are final and the new event stays. Three points stay open, in the section "Rafa's answers, and the points still open".
- **Date:** 2026-11-11
- **Raised by:** T-350, from Rafa's decision on 2026-11-11: "The contract Seller (as in agree-er) should not be the same address as the asset payout address. So that does need to get fixed in the contract architecture if it isn't already the case". Research: this note (code read at the commits named below; nothing run), then one red-team pass (section 12).
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0003 (the escrow base), ADR-0016 (the commitment ID and the signed messages), ADR-0019 (mutual settlement), ADR-0023 (the operator fee), ADR-0024 (per-deal keys and the `Delegation`), ADR-0025 and ADR-0026 (funding), ADR-0029 (the last change to a signed type), ADR-0031 (the phase-one scope, section 11); D26, D31, D32, D35, D57, D58.
- **Changes (when built, by three later tasks):**
  - the contract package: `contracts/src/HoldbackTypes.sol` and `HoldbackRules.sol` with their tests; `spec/schemas/` (v0.11); `packages/core`; `packages/settlement/sim` and `packages/settlement/evm`; `spec/examples/`; every scenario snapshot and recording;
  - the operator package: `apps/operator` (the prepare routes), `apps/demo-cloud` (the faucet), `apps/adjudicator` and the test agents (the new fields with their defaults);
  - the client package: `examples/` (the buyer signer, the seller adapter, the audit deal, the deal record, `verify.ts`) and `site/llms.txt`.
  - This ADR itself changes no code.
- **Order:** the contract package starts after the contract lane has merged ADR-0031's cuts of Permit2 funding, third-party payouts, and appeals and bonds. Section 2 counts its edits on that code and says what else changes if the package starts earlier.
- **Amends:** ADR-0016 (two fields join the terms and the commitment ID), ADR-0019 (which addresses a settlement's payouts may name), ADR-0023 and ADR-0025 (who signs the operator fee and the funding), ADR-0024 section 7 (a per-deal key no longer has to hold funds), ADR-0031 section 11 (designed here).

Labels: **measured** (read at the cited line by this task), **documented** (stated in the cited doc), **inferred** (from reading, not from a run), **guessed**. Nothing was run.

Citations, unless a line says otherwise:

| Short form | File | Commit |
| --- | --- | --- |
| `R:` | `contracts/src/HoldbackRules.sol` | `5a90dc5` (`origin/main` on 2026-11-11) |
| `T:` | `contracts/src/HoldbackTypes.sol` | `5a90dc5` |
| `E:` | `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol` | `6b0a5ef` (Commerce Payments v1.1.0, the pinned submodule) |
| `C:` | `…/commerce-payments/src/collectors/ERC3009PaymentCollector.sol` | `6b0a5ef` |
| `S:` | `…/commerce-payments/lib/solady/src/utils/SignatureCheckerLib.sol` | Solady `5ea5d9f`, the copy the escrow vendors |
| other paths | as written | `5a90dc5` |

The contract lane's branch `contracts-audit-ready` (at `b88f9e5`) moves some lines: the payer and the receiver are at `HoldbackRules.sol:176-177` there [measured]. The cuts of ADR-0031 remove more. The building task cites its own commit.

## Summary

**The signed terms gain two addresses, and the contract moves money only to and from those two.**

- **`buyerPaymentAddress`** funds the hold and receives every refund. It becomes the escrow's payer.
- **`sellerPayoutAddress`** receives every payment to the seller. It becomes the escrow's receiver.
- **`buyer` and `seller` stay the addresses that sign.** They agree, deliver, accept early and settle. When a party sets its two addresses apart, its signing address holds no money at any step.
- **The contract compares neither new address with anything.** Each may equal its signing address, and tooling sets it so when a party names none.
- **The payment address signs twice and only before funding:** the ERC-3009 authorization that funds the hold, and the one that pays the operator fee. Each is bound to one deal. After funding, nothing asks the payment address again.
- **It changes a signed type.** The schema moves to v0.11, and the EIP-712 domain and `commitment.schemaVersion` move to 0.8. Every commitment ID, signature, hash vector and recording moves.
- **Out of phase one:** a refund to an address other than the payer, payouts to a third address in a settlement, and changing the seller's address after signing. All three can return without another change to the signed terms (section 9).

**Where each amount lands.** `P` is the price and `F` the adjudicator's fee.

| Outcome | To `sellerPayoutAddress` | To `buyerPaymentAddress` | To the deciding adjudicator |
| --- | --- | --- | --- |
| Accept, by any adjudicator | `P` | 0 | `F` |
| Reject, by any adjudicator | 0 | `P` | `F` |
| Early accept | `P` | `F` | 0 |
| Reclaim, default | 0 | `P + F` | 0 |
| Mutual settlement | the seller's share | the rest of `P`, plus `F` | 0 |
| Escalation | nothing moves | nothing moves | nothing moves |
| The payer's own reclaim on the escrow, after its expiry | 0 | whatever the escrow still holds | 0 |

## Context

- **Today the address that signs is the address that is paid** [measured]. The escrow's payer is `t.buyer` and its receiver is `t.seller` (`R:175-176`). The same two addresses sign: the seller the terms and the delivery (`R:206`, `R:626`), the buyer the agreement, an early accept and a settlement (`R:208`, `R:400`, `R:442`). `CommitmentTerms` carries no other address for either party (`T:32-55`, `T:179`).
- **So a key that signs every day also holds the income, and a per-deal key has to hold the funds.** After a refund the price sits on the buyer's per-deal key, and no route moves it without ETH on that key (`docs/tasks/T-319-buyer-signer.md:106`) [documented].
- **The vendored escrow returns held funds only to its payer** [measured]. A void pays `paymentInfo.payer` (`E:304-316`). The reclaim after the expiry pays the payer, and only the payer may call it (`E:323-340`). No other function returns held funds. That is why the buyer's second address is a payment address and not a free refund address (ADR-0031 section 11).
- **The escrow's payer and receiver are only fields of the payment record** [measured]. The rules contract rebuilds that record from the terms in every call (`R:163-187`) and stores one word per deal. Naming two other addresses there needs no change to the escrow.
- **Rafa's decisions, all on 2026-11-11** (D58, D60):
  - the seller: the quote at the top of this ADR;
  - equal addresses: "They can be different, but can default to the same upon initial set-up if that is easiest for an agent. LIke when you input delivery address and then credit card address";
  - the buyer: "Yes, this should be part of the initial design.", and after the explanation of what the escrow allows: "Yes means the buyer gets a signing address and a payment address.";
  - a refund to another address: "If it Coinbase's code can't, then skip and make sure it's in the roadmap";
  - the buyer's tooling: "Do all of it now."

## Decision

### 1. The fields

**Names and types.** Two members of `CommitmentTerms`, each an `address`:

- `buyerPaymentAddress`
- `sellerPayoutAddress`

**The names are final** (Rafa, 2026-11-11; D62).

**Why these names.** Each starts with the party it belongs to, as `buyerEncryptionPublicKey` does. "Payment" and "payout" are Rafa's words, and they say the direction: the buyer pays from one, the seller is paid at the other. `buyer` and `seller` keep their names, so every message that already names a signer (`Agree.buyer`, `EarlyAccept.buyer`, `Offer.seller`) reads as before.

**Position.** Right after `seller`, the buyer's first. That keeps the parties' four addresses together, in the order the struct already uses (buyer, then seller) and the order of the escrow's record (payer, then receiver).

**The type string, before** (`T:179`, `packages/core/src/eip712.ts:109-126`) [measured]:

```
CommitmentTerms(string schemaVersion,string clubId,bytes32 rulebookHash,address buyer,address seller,bytes32 deliverableHash,bytes32 acceptanceHash,TokenAmount price,Adjudication adjudication,Timing timing,Settlement settlement,Remedy remedy,Disclosure disclosure,string buyerEncryptionPublicKey,bytes32 nonce,uint64 createdAt)
```

**After:**

```
CommitmentTerms(string schemaVersion,string clubId,bytes32 rulebookHash,address buyer,address seller,address buyerPaymentAddress,address sellerPayoutAddress,bytes32 deliverableHash,bytes32 acceptanceHash,TokenAmount price,Adjudication adjudication,Timing timing,Settlement settlement,Remedy remedy,Disclosure disclosure,string buyerEncryptionPublicKey,bytes32 nonce,uint64 createdAt)
```

The referenced types and their sorted concatenation do not change: `Adjudication`, `Disclosure`, `Remedy`, `Settlement`, `Timing`, `TokenAmount` (`T:180-185`).

**No other signed type changes.** `Agree`, `EarlyAccept`, `Offer`, `Delivery`, `Decision`, `AdjudicatorAcceptance`, `MutualSettlement`, `Payout`, `FundingAuthorization`, `TransferAuthorization`, `Delegation` and `Mandate` keep their type strings. Each already names the commitment ID or stands apart from it, so each covers the new addresses through the ID or does not need them.

**Both fields are required and never empty.** The struct has no "absent" form, and the schema requires both. A party that wants one address writes it twice. The default lives in the tooling (section 7), so two JSON forms of one deal cannot exist.

**The settlement view.** `struct Terms` (`T:32-55`) gains `address buyerPaymentAddress;` and `address sellerPayoutAddress;` after `address seller;`. `commitmentId` (`T:270-294`) encodes them after `t.seller` and before `t.deliverableHash`. Every member of that encoding is one static 32-byte word, so the building task may split the two `abi.encode` calls wherever the compiler's stack allows; the hash is the same.

**Versions.**

| What | From | To | Why |
| --- | --- | --- | --- |
| Schema (`$id`, the `Holdback-Schema-Version` header, `x-holdback-schema-version`) | 0.10 | 0.11 | A file in `spec/schemas/` changes (the hard rule) |
| EIP-712 domain version | 0.7 | 0.8 | An existing typed-data struct changes (`spec/README.md:51`, the rule since v0.7) |
| `commitment.schemaVersion` (the `const` at `spec/schemas/commitment.schema.json:77-80`) | "0.7" | "0.8" | The same rule; the terms then state which signed encoding settles them |

**The schema's changes (v0.11).**

- `commitment.schema.json`: `buyerPaymentAddress` and `sellerPayoutAddress`, each `common.schema.json#/$defs/Address`, both in `required` (`:6-23`), placed after `seller` (`:94-96`). `schemaVersion` becomes `"0.8"`.
- `messages.schema.json`: the descriptions of `FundingAuthorization.from` and of the operator fee's `from` say "the buyer's payment address". Their shapes do not change.
- The prepare routes' request bodies take both fields as optional inputs (section 7). That is the operator package's change and joins v0.11.
- `spec/README.md` gains the v0.11 entry.

**What happens to every commitment ID, hash vector and recording.**

- **Every commitment ID moves,** because the terms' type hash and `schemaVersion` both change. Every signature over an ID moves with it.
- **Hash vectors.** Core regenerates them (`packages/core/src/eip712.vectors.test.ts`), `contracts/test/unit/Vectors.t.sol` re-pins against them, and `packages/core/src/eip712.binding.test.ts` pins the new type string and domain 0.8. The contract and core must produce the same ID for the same terms before anything else merges.
- **Recordings are re-seated, never re-judged,** with the script ADR-0029's change used: `pnpm exec tsc -b packages/testkit && node scripts/reseat-recordings.mjs` (`docs/testing.md:105`) [documented]. A panel's draw hashes the commitment ID, so a new ID can seat other judges; the script refreshes the bindings and names any judge that needs a recording.
- **Every scenario snapshot re-snaps.** The reviewer reads the diff: IDs, signatures and the two new fields change, and no outcome or amount changes for a deal whose addresses are equal.
- **`spec/examples/` carry both fields,** and `pnpm validate:spec` fails a commitment without either.
- **A 0.7 signature never verifies under 0.8,** and the deployed Sepolia contracts keep settling 0.7 deals. The live demo stays on 0.7 until Rafa's redeploy. No Worker deploys from a commit with this change before the new contracts are on Sepolia, as for ADR-0029 section 8.
- **The side-by-side run** compares each later change with its parent commit, because calldata and IDs differ from the deployed contracts from this change on.

### 2. What the contract does with them

**Four edits to `HoldbackRules.sol` and one new event, on the phase-one code** (after ADR-0031's cuts; the line numbers are those of `5a90dc5`, which still has the cut features).

| # | Where (at `5a90dc5`) | Today | After |
| --- | --- | --- | --- |
| 1 | `_paymentInfo`, `R:175` | `payer: t.buyer` | `payer: t.buyerPaymentAddress` |
| 2 | `_paymentInfo`, `R:176` | `receiver: t.seller` | `receiver: t.sellerPayoutAddress` |
| 3 | `_payOut`, `R:468-470` | a payout to `t.seller` is the seller's share; a payout to `t.buyer` stays in the hold for the void | a payout to `t.sellerPayoutAddress` is the seller's share; a payout to `t.buyerPaymentAddress` stays in the hold for the void; any other `to` reverts with `InvalidMessage` (ADR-0031 section 4) |
| 4 | `_domainNameAndVersion`, `R:667` | `"0.7"` | `"0.8"` |

One event joins (below). Every signature check stays on `t.buyer` and `t.seller` (`R:206`, `R:208`, `R:400`, `R:442-443`, `R:626`). Every key proof and key release stays on `t.buyer` (`R:354`, `R:404`, `R:417`, `R:446`, `R:456`): the envelope is sealed to the key in the terms and addressed to the party, not to its wallet.

**If the package starts on code that still has a cut feature,** these also change, by the same two rules (deal money uses the payment and payout addresses; a signature's own stake stays with the signer) [measured at `5a90dc5`]:

- the overturn payout from a bond pays the wronged party's payment or payout address, not `t.buyer` or `t.seller` (`R:378`);
- an appeal bond still comes from, and returns to, the address that signs the appeal (`R:512-516`);
- a Permit2 funding is signed by the payment address, as the ERC-3009 one is (`R:218`);
- the contract's size: `5a90dc5` has 263 bytes of headroom (`docs/audit/known-issues.md`, I-2) [documented], and two hashed words, a comparison and an event may not fit there [guessed].

**Why the escrow's payer and receiver, and nothing forwarded.** Every transfer out of the hold is the escrow's own: a capture pays `paymentInfo.receiver` (`E:295`, `E:471`) and a void pays `paymentInfo.payer` (`E:315`). With the two addresses in those two fields, the rules contract adds no transfer of its own and never holds a token. The alternative, in which the rules contract receives and forwards, would put custody in Crow's own code (ADR-0031 section 11).

**The payment record's hash covers both addresses twice.** The escrow keys a payment by the hash of the whole record, payer and receiver included (`E:383-386`), and the record's `salt` is the commitment ID (`R:185`), which now hashes both addresses. A call whose terms name another address rebuilds another ID. `agreeAndFund` then reverts on the seller's signature, which is over the real ID (`R:206`). Every later entry point finds no deal under that ID and reverts on its stage check.

**Where each amount lands, by entry point** [inferred from the cited lines with edits 1 to 3 applied].

| Outcome | Entry point | Escrow calls | `sellerPayoutAddress` gets | `buyerPaymentAddress` gets | Others get |
| --- | --- | --- | --- | --- | --- |
| Accept by the primary or the fallback | `decide` (`R:351`) | one capture of `P + F` with fee `F` | `P` | 0 | the decider, `F` |
| Reject by the primary or the fallback | `decide` (`R:356-357`) | a capture of `F` that is all fee, then a void | 0 | `P` | the decider, `F` |
| Escalate, by the primary or the fallback | `decide` (`R:314-322`) | none | 0 | 0 | nobody |
| Accept after an escalation | `decide` (`R:336-342`, `R:351`) | as an accept | `P` | 0 | the appeal adjudicator, `F` |
| Reject after an escalation | `decide` (`R:336-342`, `R:356-357`) | as a reject | 0 | `P` | the appeal adjudicator, `F` |
| No decision after an escalation | `triggerDefault` (`R:562-568`) | a void | 0 | `P + F` | nobody |
| Early accept | `earlyAccept` (`R:412-413`) | a capture of `P`, then a void | `P` | `F` | nobody |
| Reclaim: no delivery by `deliverBy` | `reclaim` (`R:533-540`) | a void | 0 | `P + F` | nobody |
| Default: the fallback is silent | `triggerDefault` (`R:560-568`) | a void | 0 | `P + F` | nobody |
| Mutual settlement | `mutualSettle` (`R:454`, `R:459-497`) | a capture of the seller's share `s`, then a void | `s` | `P − s + F` | nobody (the fee share is 0 bps, `R:69`) |
| The payer's own reclaim, from the escrow's expiry | `ESCROW.reclaim`, called by `buyerPaymentAddress` (`E:323-340`) | the escrow's own | 0 | all that is still held | nobody |

- **A price of 0** sends the payout address nothing in every row; only the fee moves (ADR-0031 section 6).
- **`buyer` and `seller` receive nothing in any row** when they differ from the two new addresses.
- **The funding** pulls `P + F` from `buyerPaymentAddress` and from no other address (`C:38-50`). The collector returns no excess, because the rules contract authorizes exactly `maxAmount` (`R:218`, `C:53`).
- **The rules contract never calls the escrow's `charge` or `refund`** (`E:200`, `E:351`) [measured: `R` calls `authorize`, `capture`, `void`, `paymentState` and `getHash` only].
- **After the payer's own reclaim** `reclaim` and `triggerDefault` still close the deal: they find the hold empty and skip the void (`R:603-608`), as today.

**A settlement's payouts name the two new addresses.** `Payout.to` says where money goes, and money can only go to the escrow's payer and receiver. So the signed settlement names `buyerPaymentAddress` and `sellerPayoutAddress`, and the record then states the address that was paid. A payout to a signing address that differs from them is a payout to a third address, and phase one refuses it. If the two new addresses are equal to each other, every payout counts as the seller's share (the comparison at `R:468` comes first, as it does today when the buyer is the seller). The money reaches the same address either way. Two effects follow: `PaymentReleased` reports the whole amount, and such a settlement needs a capture, so it cannot land after the escrow's expiry (`E:277`). By then the payer can reclaim directly.

**Events.**

| Event | Names | Change |
| --- | --- | --- |
| `JobCreated(jobId, client, provider, evaluator, expiredAt)` (`R:216`) | `t.buyer`, `t.seller`: the parties | none |
| `JobFunded(jobId, client, amount)` (`R:217`) | `t.buyer`: the party whose deal is funded | none |
| `JobSubmitted(jobId, provider, deliverable)` (`R:629`) | `t.seller`: the signer of the delivery | none |
| `PaymentReleased(jobId, provider, amount)` (`R:353`, `R:415`, `R:480`) | `t.seller`: the party that was paid. The tokens go to `sellerPayoutAddress` | none |
| `Refunded(jobId, client, amount)` (`R:359`, `R:416`, `R:495`, `R:610`) | `t.buyer`: the party that was refunded. The tokens go to `buyerPaymentAddress` | none |
| `JobCompleted`, `KeyReleased` on an early accept (`R:414`, `R:417`) | `t.buyer` | none |
| **New:** `SettlementAddresses(bytes32 indexed id, address indexed buyerPaymentAddress, address indexed sellerPayoutAddress)` | both new addresses | emitted once, in `agreeAndFund`, beside `JobCreated` |
| The escrow's `PaymentAuthorized` (`E:88-90`, `E:252`) | the whole payment record, payer and receiver included | none; it is the escrow's |

- **Existing events keep their fields and their meaning: they name parties.** The adapter's sync, the events inventory and the ERC-8183 shape (client is the buyer, provider is the seller) all read them that way (`docs/audit/events.md:26`) [documented]. Rafa's rule is that events are not removed, and reshaping one changes what every reader built on it.
- **One event joins, and Rafa decided on 2026-11-11 that it stays (D62),** so the rules contract's own log says where the money goes. Without it a reader must decode the escrow's event, which is keyed by the payment's hash and not by the commitment ID. With it, an address finds every deal that pays it or refunds it by an indexed topic. It costs about 1,900 gas once per deal [inferred: a log with four topics and no data, 375 gas plus 375 per topic].
- **A reader takes the address that received tokens from `SettlementAddresses`** or from the token's own `Transfer` log, never from `PaymentReleased.provider` or `Refunded.client`. The events inventory says so when the docs follow.

**The contract compares neither new address with anything.** It does not require either to differ from, or to equal, its signing address, the other new address, an adjudicator, the zero address or any contract. Reasons:

- Rafa decided that the two may be equal (ADR-0031 section 11).
- D31: an address the encoding can represent is the party's to choose. The contract refuses only what settlement cannot process, and it can process any address: section 8 says what each odd value does.
- The contract already compares no addresses with each other (`docs/audit/threat-model.md`, assumption TA-4). A check here would be the only one, and it would stop at the first proxy or forwarder.

**Cost** [inferred from EIP constants; the building task measures]. Each address adds one calldata word to every call that carries the terms: about 370 gas per address, 740 per call (20 non-zero bytes at 16 gas, 12 zero bytes at 4). The ID's hash covers 64 more bytes. The escrow's work does not change. After the cut of appeals and bonds the size limit is not a constraint.

### 3. Who signs what

| Message | Signed by | Checked against | Where |
| --- | --- | --- | --- |
| The terms (the commitment ID) | the seller's signing key | `t.seller` | `R:206` |
| `AdjudicatorAcceptance` | the primary | `t.adjudicator` | `R:207` |
| `Agree` | the buyer's signing key | `t.buyer` | `R:208` |
| The funding: ERC-3009 `ReceiveWithAuthorization` | **the payment address** | `paymentInfo.payer`, by the token | `C:42-50` |
| The operator fee: ERC-3009 `TransferWithAuthorization` | **the payment address** | `from`, by the token | `packages/settlement/evm/evm-settlement.ts:1247-1256` |
| `Delivery` | the seller's signing key | `t.seller` | `R:626` |
| `EarlyAccept` | the buyer's signing key | `t.buyer` | `R:400` |
| `MutualSettlement` | both signing keys | `t.buyer`, `t.seller` | `R:442-443` |
| `Decision` | the adjudicator whose turn it is | the terms' adjudicators | `R:298-301` |
| The reclaim on the escrow after its expiry | a transaction from the payment address | `paymentInfo.payer` | `E:323` |

**The payout address signs nothing.** It only receives.

**On EVM settlement the payment address signs nothing under Crow's EIP-712 domain.** Both of its signatures are under the token's domain, and the token checks them. On SimChain, which has no token contract, it signs the same two authorizations as Crow messages (section 4).

**The funding authorization is bound to one deal** [measured].

- The collector calls `receiveWithAuthorization(from: payer, to: the collector, value: maxAmount, validAfter: 0, validBefore: preApprovalExpiry, nonce, signature)` (`C:42-50`).
- The nonce is the hash of the payment record with the payer set to zero (`…/collectors/TokenCollector.sol:70-77`), under the chain ID and the escrow's address (`E:383-386`). The record names the rules contract as operator, the receiver, the token, `P + F`, the three expiries and the commitment ID as salt (`R:173-186`).
- The commitment ID hashes every term, the payment address included. So the nonce is unique to one set of terms on one deployment, and the zeroed payer loses nothing: the payer is inside the salt.
- The token marks the nonce used (`contracts/script/TestUSDC.sol:86`, `:93`), and the escrow refuses a second funding of the same record (`E:247`), as does the rules contract (`R:202`).

**A payment address cannot be made to fund a deal it did not sign for** [inferred from the lines above].

- The token checks the signature against `from`, which is the payer the terms name (`contracts/script/TestUSDC.sol:92`). Without that address's signature over this nonce the funding reverts and nothing is stored.
- A signature for deal A does not fund deal B: B has another ID, so another nonce.
- Terms that name a victim as the payment address fund nothing: the victim has not signed that nonce.
- Only the collector can redeem the authorization (`TestUSDC.sol:69`), only the escrow can call the collector (`TokenCollector.sol:43`), and only the rules contract can make the escrow authorize this record (`E:241`). The rules contract does so only in `agreeAndFund`, after it has checked the seller's signature, the acceptance and the buyer's `Agree` (`R:206-208`, `R:218`). So the payment address's money enters the hold only when the buyer's signing key has agreed to the same terms.
- The tokens can go to one place only, the rules contract's token store (`C:56`, `E:420-424`).

**The operator fee is bound to one deal too** [measured]. It is a `TransferWithAuthorization` from the payment address to the operator's fee address, for the fee's amount, with the nonce `keccak256(abi.encode(commitmentId, "operator_fee"))` (`packages/settlement/evm/encode.ts:264`). The signature fixes the recipient and the amount. The adapter's rule "the fee comes from the buyer" (`evm-settlement.ts:1247`) becomes "from the payment address".

- **One limit, unchanged in kind.** Anyone may relay the fee's transfer alone, before the funding (ADR-0023's EVM amendment; `contracts/test/crosscheck/OperatorFeeFrontRun.t.sol`). The loss is at most the fee, it goes only to the operator the payment address named, and it now falls on the payment address.
- **The fee's nonce names the deal and not the deployment.** The commitment ID has no domain in it, so two rules contracts on one chain and one token would share the nonce. The token spends it once and the signature names the recipient and the amount, so the fee is paid once, to the operator named. It is not a replay.

**What the payment address accepts by signing.** Its signature on the funding is its consent to this deal's terms, and those terms name `buyer` as the party that agrees, accepts early and settles. After funding, the signing key alone can pay the price to the payout address (an early accept) or split it with the seller (a settlement).

- **The exposure is `P + F` plus the operator fee, for this one deal.** No signature of the signing key reaches any other money of the payment address.
- **The payment address protects itself before it signs** (D32). It rebuilds the commitment ID and the nonce from the terms it approves, and checks that the terms name the signing key it expects. The opaque nonce in the wallet's prompt tells it nothing by itself: the prompt shows the collector, an amount and a hash, and any contract can be an operator of the same escrow and collector (`E:241`). Only the nonce binds Crow's rules contract, the receiver and the signing key. The client package ships that check, with the deployment pinned in the holder's own configuration (section 10).
- **A signed funding cannot be withdrawn on `TestUSDC`,** which has no `cancelAuthorization` [measured: the whole file]. `LocalUSDC` has one (`contracts/script/LocalUSDC.sol:91`). A holder that signed for the wrong terms on `TestUSDC` empties the address or waits for `fundBy`, when the authorization lapses.
- **"Only the payment address can fund" assumes its own signature rule.** A plain key answers for itself. A contract wallet answers as its code says: one whose `isValidSignature` accepts the buyer's signing key, as an owner or a session key, lets that key fund this deal and spend the wallet's tokens through ERC-3009 anywhere else. That is the wallet's own rule and no part of Crow.

**What each kind of account does as a payment address.**

| Account | The funding | The operator fee | Refunds | The reclaim after the escrow's expiry |
| --- | --- | --- | --- | --- |
| A plain key | An ECDSA signature; the token recovers the signer (`S:42-61`) | The same | Arrive as a token transfer | The key sends the transaction itself, so it needs gas then |
| A contract wallet (a multisig, a smart account), deployed | Its ERC-1271 answer, which the token asks for (`S:62-71`) | The same | Arrive as a token transfer; a plain ERC-20 calls no code on the recipient | The wallet calls the escrow; a wallet that cannot make an arbitrary call loses this backstop and nothing else |
| A wallet that is not deployed yet | Funds with an ERC-6492 signature: the collector makes the deploying call first (`…/collectors/ERC6492SignatureHandler.sol:33-61`), then the token asks the wallet | Does not work in the same bundle: the token does not unwrap ERC-6492, so the wallet must be deployed before the fee's transfer | As a contract wallet | As a contract wallet |
| An account with delegated code (EIP-7702) | The token sees code at the address and asks it through ERC-1271 (`S:42`, `S:62-71`). The signature must be in the form the delegate's `isValidSignature` accepts. A plain ECDSA signature fails unless the delegate accepts it | The same | Arrive as a token transfer | The key sends the transaction itself |

- **The plan's claim about the test token holds** [measured by reading; no test covers it]. `TestUSDC` checks every authorization with Solady's `SignatureCheckerLib.isValidSignatureNow(from, digest, signature)` (`contracts/script/TestUSDC.sol:92`). For an address with code that function makes the ERC-1271 static call (`S:62-71`). `LocalUSDC` does the same (`contracts/script/LocalUSDC.sol:123`). `contracts/test/unit/TestUSDC.t.sol` has five tests and none signs with a contract [measured: its test names]. The contract package adds the test.
- **An undeployed wallet can be a payment address and cannot be a buyer's signing address.** The buyer's `Agree` is checked before the funding step could deploy the wallet (`R:208`, then `R:218`). The payment address is checked only inside the funding step, after the collector's deploying call.
- **An account whose code or answer changes** is asked once, at funding, and once for the fee. A change before then makes the funding revert, and nothing is held. A change after it affects nothing.
- **The ERC-6492 wrapper is not signed,** so whoever relays the funding chooses the deploying call. `docs/audit/threat-model.md` section 3 covers what that call can reach; this ADR changes nothing there.
- **Another token may check signatures differently.** These rows describe `TestUSDC` and `LocalUSDC`. The deployment's token is an assumption the contract cannot check (ADR-0031 section 2).

### 4. Core, SimChain and the EVM adapter

The contract package keeps the off-chain mirrors equal to the contract, as every earlier change did.

- **Core's types and typed data.** `CommitmentTerms` gains both fields, required (`packages/core/src/eip712.ts:109-126`, `types.ts`). The domain version becomes `'0.8'` (`eip712.ts:47-56`).
- **Core's state machine.**
  - The funding's `from` must equal `terms.buyerPaymentAddress` (`packages/core/src/state.ts:257` compares it with `terms.buyer` today).
  - The balance that covers the funding is the payment address's (`state.ts:272-277` takes it as an input).
  - The agreement and the early accept stay on `terms.buyer` (`state.ts:238`, `:570`).
  - A settlement's payouts may name `buyerPaymentAddress` and `sellerPayoutAddress` (`packages/core/src/mutual.ts:13` builds the set from `buyer` and `seller` today). On a phase-one deployment any other address is refused, as on the contract.
- **SimChain.** Two rules.
  - **Deal money uses the payment and payout addresses.** That covers the funding, the release, every refund, a settlement's payouts and the operator fee (`packages/settlement/sim/simchain.ts:755-756`, `:817`, `:835`, `:894`, `:932-939`, `:963`, `:977`). It also covers what a bond pays a wronged party on the full protocol: the overturn payout and the default compensation go to that party's payment or payout address.
  - **A stake a party makes by a later signature stays with the signer.** On the full protocol the appeal bond and the appeal fee come from the address that signs the appeal, and the bond returns there (`simchain.ts:533`, `:775-776`, `:871`, `:1004-1005`; core requires that address to be `buyer` or `seller`, `packages/core/src/state.ts:448`). A payment or payout address signs no appeal, so an appeal never moves its balance.
  - A payout to `sellerPayoutAddress` is a capture, checked first as on the contract; today SimChain treats a payout to anyone but the buyer as one (`simchain.ts:929`). With the two new addresses equal, SimChain and the contract must agree.
  - On SimChain the payment address signs the `FundingAuthorization` and the fee's `TransferAuthorization` under Crow's domain, as the buyer does today.
- **The EVM adapter.**
  - The payment record: `payer: t.buyerPaymentAddress`, `receiver: t.sellerPayoutAddress` (`packages/settlement/evm/encode.ts:217-218`).
  - The funding's typed data and digest: `from` is the payment address (`evm-settlement.ts:754`, `:774`).
  - The pre-funding balance read is the payment address's (`evm-settlement.ts:1239`).
  - The operator fee must come from the payment address, in the bundle (`evm-settlement.ts:1247`) and when the fee is relayed alone (`:2535`). The sync matches the fee's transfer by that address (`:2011`).
  - **The sync of a deal the node did not relay.** It rebuilds a direct funding with `from` set to the payment address (`:2189` sets `terms.buyer` today). It confirms a direct settlement by the payouts to `sellerPayoutAddress` against `PaymentReleased`, and treats payouts to `buyerPaymentAddress` as the void (`:2112-2116` use `terms.seller` and `terms.buyer` today). Built without these, a deal funded or settled by a direct transaction with the addresses apart would fall behind the operators' view, and the direct route is the one neutrality rests on.
  - The mandate, the scope, the daily total and the membership stay on `terms.buyer` (`evm-settlement.ts:1195-1198`, `:1238`).
  - `abis.json` regenerates: the `Terms` tuple of every entry point changes.
- **API events and the state view, on both settlements.**
  - An event's actor is the address whose signature caused it. `hold.funded` and `fee.operator` name the payment address, which is `m.from` in the code today (`evm-settlement.ts:1244`, `:1266`, `:2224`; `simchain.ts:818`, `:836`). `commitment.agreed` names `buyer`.
  - The state view's `balances` names the payment and payout addresses, because they hold the parties' money (`evm-settlement.ts:2598` and `simchain.ts:1047` name `buyer` and `seller` today).
- **The operator's settlement prepare route** builds its payouts to `sellerPayoutAddress` and `buyerPaymentAddress` (`apps/operator/src/prepare.ts:684-685`, `:705` use `c.seller` and `c.buyer` today). That edit is the operator package's; until it lands, a prepared settlement with the addresses apart is refused by core and by the contract.

### 5. Per-deal keys

ADR-0024 section 7 gives each party a one-time signing key per deal at the `private` and `judgment` levels. Until now that key also had to hold the funds.

**A per-deal signing key with a standing payment address.**

- The terms name the per-deal key as `buyer` and the standing address as `buyerPaymentAddress`.
- The per-deal key signs `Agree`, an early accept, a settlement and its read tokens. In phase one it holds no token and no gas at any step: operators relay its messages. On the full protocol a party that files an appeal stakes the bond from the key that signs the appeal (section 4); the later ADR that brings appeals back may name another payer for it.
- The standing address signs the funding and the operator fee, each for this one deal.
- Every refund returns to the standing address. After a release nothing is left anywhere.

**With a mandate.** The mandate names the signing key as the agent, and the operators check the scope, the per-commitment cap, the daily total and the membership against `terms.buyer`, as today (`evm-settlement.ts:1195-1198`). On the test service the faucet sends the mandate to the signing key and the tokens to the payment address. Nothing checks the payment address against a mandate or a club: its consent is its own signature on one deal's funding, for one amount. A club that wants more (a payer that is a member, or equal addresses) writes it into its rulebook later; phase one has no such rulebook field.

**With a `Delegation`.** The certificate names the per-deal key as `dealKey`, and the counterparty and the adjudicator check its scope and membership from it (ADR-0024 section 7). Its type does not change, and it does not name the payment address. The seller sees the payment address, because it signs terms that contain it. What the seller needs from the certificate is that the buyer is in scope; who stands behind the payment address is the buyer's to disclose (D35). Admission of a per-deal key by its certificate is not built yet (`docs/tasks/T-319-buyer-signer.md:111`); when it is, a buyer needs neither a faucet call nor a mandate of its own, and this design does not change.

**The seller's side is the same.** A per-deal signing key signs the terms and the delivery, and a standing payout address receives the price.

**What the deferred refund sweep becomes.** The buyer signer left out `sweep(to)` because no route relays a plain transfer for a key without gas (`T-319-buyer-signer.md:106`). **It is no longer needed and is not built.** A buyer that does not want money on a per-deal key names a payment address. A buyer that leaves the two equal on a per-deal key keeps today's behaviour, and the signer's one line says that refunds return to that key (section 7).

**The cost to privacy, stated.** A standing payment or payout address is in the terms' calldata and in the escrow's event for every deal it serves. It links those deals to each other on chain, where a per-deal key alone would not (`docs/neutrality.md`, residual 11, already says funding from a known treasury links the address). A party that wants its deals unlinked uses a fresh payment or payout address per deal, or leaves the two equal on the per-deal key. That is each party's choice per deal (D40).

### 6. What the parties check before they sign

Operators relay; they never author. A prepare route only saves a client the work of building the terms, and the client checks the result (D32).

- **Each party's own address comes from its own configuration and from nowhere else.** No prepare answer, notice, offer, delivery, work product or counterparty message sets or changes a party's payment or payout address. This is new: today the address that is paid is the address that signs, so no author of the terms can redirect a payment. From this change on, one substituted field would. `site/llms.txt` states the check as a rule an agent must follow, not as advice.
- **The buyer tells the seller its payment address** in the request for a quote, beside its signing address and its encryption key (the offer's prepare route takes `buyer: {address, encryptionPublicKey}` today, `apps/operator/src/prepare.ts:309-310`). When the request names none, the seller's side fills in the buyer's signing address.
- **The seller's client** refuses to sign terms whose `sellerPayoutAddress` is not the one in its configuration.
- **The buyer's client** refuses to agree to terms whose `buyerPaymentAddress` is not its own, or whose `sellerPayoutAddress` differs from the one in the offer it approved.
- **Each party compares the other side's new address with the three adjudicators.** A payout address equal to the deciding adjudicator pays that adjudicator the price on an accept; a payment address equal to it returns the price to the decider on a reject. Nothing requires the addresses to differ (the threat model's assumption TA-4); the tooling warns (section 7).
- **The holder of the payment address** refuses to sign a funding whose nonce it has not rebuilt from the terms it approves, with the rules contract, the escrow, the collector, the chain and the token taken from its own pinned configuration.
- **An adjudicator** accepts terms that name both addresses; its acceptance covers them through the ID. It checks nothing new. It may decline terms it will not run (D29).

### 7. Defaults and warnings

**The default is the signing address, said in one line.** Rafa's words are the rule: "can default to the same upon initial set-up if that is easiest for an agent".

| Tool | With no address set | The one line |
| --- | --- | --- |
| The seller adapter | uses its signing address as `sellerPayoutAddress` | at start-up: "Payout address: not set. Payments go to the signing address 0x… ." |
| The buyer signer | uses its signing address as `buyerPaymentAddress` | when it builds the request: "Payment address: not set. The signing address 0x… funds the hold, and refunds return to it." |
| The operator's prepare routes | fill an absent input with the signing address | one entry in the response's `notices` (`apps/operator/src/prepare.ts:76-77`) |
| The reference adjudicator and the test agents | carry both fields equal to the signing addresses | none |

No tool stops for a missing address. `site/llms.txt` and the adapter's recipe say why a production seller sets a separate payout address: the key that signs every day then never holds the income.

**Warnings are advisory and never refusals.** They go to the same one-line channels: the adapter's start-up output, the signer's output, and the prepare routes' `notices`.

| Condition | The warning says |
| --- | --- |
| `sellerPayoutAddress` is the zero address | Payments to the seller would be lost or would revert, depending on the token |
| `sellerPayoutAddress` is one of this deployment's contracts: the rules contract, the escrow, its token store, the collector, the token or the beacon (and the bond vault or a Permit2 collector on a deployment that has one) | Payments to the seller would be stranded there |
| `sellerPayoutAddress` is Multicall3 | Anyone could take the seller's payment: Multicall3 makes any call it is asked to [inferred: the standard contract; only its interface is vendored] |
| `buyerPaymentAddress` is the zero address or one of those contracts | No signature can fund this deal |
| `sellerPayoutAddress` or `buyerPaymentAddress` is one of the deal's three adjudicators | The adjudicator that decides would receive the price on one of its two outcomes |

The contract enforces none of them (section 2).

### 8. What an odd address does

A reader should know the contract's behaviour for values the tooling warns about [inferred from the cited lines; the contract package tests each].

| Value | What happens |
| --- | --- |
| `sellerPayoutAddress` is zero | An accept, an early accept and a settlement's seller share send tokens to the zero address. `TestUSDC` and `LocalUSDC` allow that transfer (Solady's `ERC20._transfer` has no zero-address check), so the seller's money is lost. A token that refuses the transfer makes those calls revert; the deal then ends by a reject, a reclaim, a default or a settlement that pays the buyer, and the buyer is refunded. The seller named the address; the loss is its own |
| `sellerPayoutAddress` is the rules contract, the escrow, the token store or the collector | The tokens arrive and no function moves them out. The token store's surplus is not counted as any deal's hold: the escrow funds by measured difference (`E:421-424`) and pays by its own accounts (`E:284`, `E:307`). The seller's own loss |
| `buyerPaymentAddress` is zero | The deal can never be funded: the token's check returns false for a zero signer (`S:37`). Nothing is stored |
| `buyerPaymentAddress` is one of the deployment's contracts | The deal can never be funded: those contracts answer no ERC-1271 call [inferred: none declares `isValidSignature`] |
| `buyerPaymentAddress` equals `sellerPayoutAddress` | Legal. Every outcome pays the same address |
| The token refuses transfers to the payment address | Every refund path reverts, as in `docs/audit/threat-model.md` section 3 for the buyer today. An accept still settles |
| The token refuses transfers to the payout address | An accept, an early accept and a settlement that pays the seller revert. A reject, a reclaim and a default still settle |

### 9. What stays out, and the way back in

| Left out of phase one | Why | Does it need another change to the signed terms? | What it does need |
| --- | --- | --- | --- |
| **A refund to an address other than the payer** | The escrow cannot: a void and a reclaim pay the payer (`E:315`, `E:339`). Rafa: "If it Coinbase's code can't, then skip and make sure it's in the roadmap" | **No, if it comes as a signed instruction; yes, if it comes as a third field.** A new message type is additive: it moves the schema version and leaves the domain version and every commitment ID alone (`spec/README.md:51`) | New code in the rules contract that pays refunds as captures to the named address through the escrow's fee slot, and one stored word per deal. The reclaim after the escrow's expiry would still pay the payer; no code of ours can change that |
| **Payouts to a third address in a settlement** (D23) | Cut for phase one by Rafa (ADR-0031 section 4) | **No.** `Payout.to` is already any address, and both parties sign the settlement | The contract's rule on `to` loosens, and the all-fee capture that ADR-0031 cut returns. The payment record is already shaped for it: `maxFeeBps` is 10,000 and `feeReceiver` is open (`R:183-184`) |
| **Changing the seller's receiving address after signing, by both parties' agreement** | It needs stored state and a new signed message; Rafa asked for it after the freeze | **No.** `sellerPayoutAddress` stays the address fixed at signing and becomes the default. A new message that both parties sign names the new address | One stored word per deal for the override, and a payment through the fee slot, because the escrow fixes the receiver in the record at funding (`E:246`, `E:282`) |

- **So the two fields chosen here are enough for all three.** None needs a new field in `CommitmentTerms`, a new domain version or a move of the commitment IDs, as long as the later work arrives as a signed message beside the terms.
- **Each still needs new contract code and storage,** so a new deployment, a new `verifyingContract` and an audit of the change. The fields save the signed type; they do not save the redeploy.
- **Phase one softens two of the three at signing.** A seller that must pay a third party names that party's address as its payout address. A buyer that wants refunds at another address funds from that address.
- **One name to settle when that work starts.** Rafa called the later address a "receivable address". `sellerPayoutAddress` is that address as fixed at signing; the later ADR decides whether its message says "receivable" or "payout".

### 10. The tests and proofs the three packages carry

**The contract package: tests that fail before the change.**

Contract, unit (a new file beside `contracts/test/unit/Settle.t.sol`), each with all four addresses distinct unless it says otherwise:

1. An accept by the primary pays `P` to the payout address and `F` to the primary. The seller's and the buyer's signing addresses hold what they held before.
2. A reject pays `P` to the payment address and `F` to the decider.
3. An early accept pays `P` to the payout address and `F` to the payment address.
4. A reclaim pays `P + F` to the payment address. A default does the same from the fallback's turn and from an escalation.
5. An escalation moves nothing. An accept after it pays as test 1 with the appeal adjudicator's fee; a reject after it pays as test 2.
6. The fallback's accept and reject pay as tests 1 and 2.
7. A mutual settlement pays the seller's share to the payout address and the rest, with the fee, to the payment address.
8. A settlement whose payout names the seller's signing address reverts with `InvalidMessage`. So does one that names the buyer's signing address.
9. With the payment address equal to the payout address, a settlement settles, that address holds `P + F`, and `PaymentReleased` reports every payout.
10. With a plain key as the payment address, the buyer's signing key cannot fund: its signature over the right nonce reverts in the token.
11. The payment address's authorization for another deal does not fund this one. The same authorization does not fund the same deal twice.
12. Changing either address in the terms changes the commitment ID, and the seller's signature over the old ID reverts with `BadSignature`.
13. With each new address equal to its signing address, every outcome moves the same amounts between the same accounts as before the change.
14. From the escrow's expiry only the payment address can reclaim on the escrow. The buyer's signing address and a stranger revert with `InvalidSender`. `reclaim` or `triggerDefault` then closes the deal (`contracts/test/unit/AfterCppReclaim.t.sol`, with the addresses apart).
15. A deployed contract wallet as the payment address funds through ERC-1271 on `TestUSDC` and on `LocalUSDC`, is refunded, and reclaims after the expiry.
16. An undeployed wallet as the payment address funds with an ERC-6492 signature. The same wallet as the buyer's signing address cannot agree.
17. An account with delegated code as the payment address funds when its delegate accepts the signature, and reverts with a plain ECDSA signature when the delegate does not.
18. A contract wallet whose answer changes after funding does not stop any later step.
19. No comparison: terms with a zero payout address, with the rules contract as the payout address, and with all four addresses equal each fund. A zero payment address never funds.
20. A price of 0 with the addresses apart: `contracts/test/unit/ZeroPrice.t.sol` asserts the payment and payout addresses.
21. Events: `JobCreated`, `JobFunded`, `PaymentReleased` and `Refunded` name the signing addresses; `SettlementAddresses` names both new addresses once per deal; the escrow's `PaymentAuthorized` carries them as payer and receiver.
22. `contracts/test/unit/Vectors.t.sol` pins the new type string and the ID of core's vectors.
23. Another operator contract on the same escrow and collector cannot redeem a funding signature made for a Crow deal: its `authorize` reverts in the token, because its record has another nonce.
24. With a token that refuses transfers to the payout address (and one that refuses the zero address), an accept reverts, and a reject, a reclaim and a default still settle.
25. With the token store as one deal's payout address, a second deal funds and settles in full: the first deal's surplus in the store is not counted as any hold.

Contract, invariants (`contracts/test/invariant/RulesInvariants.t.sol` and its handler):

26. The handler draws distinct payment and payout addresses for a share of its deals.
27. A signing address that differs from its payment or payout address never changes balance.
28. Conservation and settle-once hold with the addresses apart.

Core, SimChain and the adapter:

29. `state.test.ts`: a funding whose `from` is the signing key is refused when the addresses differ; a settlement's payouts to a signing address are refused; the agreement and the early accept stay on `buyer`.
30. `eip712.binding.test.ts` pins the type string and domain 0.8.
31. `tests/spec.test.ts`: a commitment without either field fails validation.
32. One scenario fixture with all four addresses apart runs on SimChain and on the contract with the same transcript: one deal `Released`, one `Refunded`, one `Settled`.
33. `neutrality.direct-funding-separate-addresses`, on the local chain: a deal with all four addresses apart is funded, fee-paid and settled by direct transactions, and the adapter's sync keeps it in the operators' view through to its close.
34. On SimChain, an appeal never changes the balance of a payment or payout address that differs from the appellant, and an overturn pays the wronged party's payment or payout address.
35. With the payment address equal to the payout address, a settlement gives the same transcript on SimChain and on the contract.
36. `pnpm snap` and `pnpm snap --settlement=local` pass after the re-seat.

The red team's finding M-2 is why test 33 is a `neutrality.*` fixture. No fixture is needed for a new actor: neither new address signs anything after funding, so neither can stop a funded deal (section 11).

**The operator package: the proof it carries.**

- A prepare route returns the funding slot and the operator-fee slot with the payment address as `signer`, and the agreement slot with the buyer's signing address (`apps/operator/src/prepare.ts`, the `sign` list).
- With no address in the request, the prepared terms carry the signing addresses and `notices` says so in one line each.
- Each warning of section 7 appears in `notices`, and the route still answers.
- The settlement prepare route names the payout and payment addresses in its payouts, and such a settlement lands.
- The offer's prepare route takes the buyer's payment address in its request.
- The faucet sends the tokens to the payment address and the mandate to the signing address. A per-deal signing key that holds no token passes every pre-funding check.
- The operator fee is collected from the payment address, in the same transaction as the funding, and also when it is relayed alone.
- **One stated exception: a wallet that is not deployed yet.** The bundle sends the fee before `agreeAndFund` (`evm-settlement.ts:1275-1276`), and the token does not unwrap ERC-6492, so the bundle reverts and no funds move. The package either answers such a funding with a problem that says to deploy the wallet first, or sends `agreeAndFund` first and the fee second, which keeps both legs in one transaction and deploys the wallet in time [inferred]. Reordering changes ADR-0023's bundle, so it takes that package's review. A test covers whichever it chooses.
- On the local world: one deal `Released` and one `Refunded` in which the buyer's signing key holds no token at any step. The Sepolia run is Rafa's.
- The reference adjudicator accepts terms with the addresses apart, and its decision pays the payout address.

**The client package: the proof it carries.**

- The buyer signer takes a funding signature made elsewhere and refuses it unless it is the payment address's, over this deal's nonce, for `P + F` and no more. The same holds for the operator fee: its recipient, its amount and its nonce.
- A check the holder of the payment address runs alone, before it signs: from the terms and the pinned deployment it rebuilds the commitment ID and the nonce, and prints the buyer's signing address, both new addresses and the total. It refuses a nonce that does not match.
  - It takes the rules contract, the escrow, the collector, the chain ID, the token's domain and the expiry margin from the holder's own pinned configuration, never from the request it is checking.
  - Its tests refuse a nonce built with another operator address, another receiver, another `buyer`, another chain ID and another margin.
- Three attack fixtures: `attack.prepare-substitutes-payout-address` (the seller's client refuses to sign), `attack.prepare-substitutes-payment-address` (the buyer's client refuses to agree), and `attack.notice-sets-payout-address`, in plain text and in hidden Unicode tag characters inside `notices` (the configured address does not change, and the terms carry it).
- The buyer signer shows the seller's payout address in the offer and refuses to agree when it changed since the approval. It refuses terms whose payment address is not its own.
- The seller adapter takes a payout address in its configuration, writes it into every offer, refuses prepared terms that carry another, and prints the lines of section 7.
- The audit deal has a case with the buyer's two addresses apart. The deal record shows the address that was paid and the address that was refunded.
- `examples/verify.ts` derives the payment record from the two new addresses (`:67-79` uses `t.seller` today) and names the payment address as the signer of the funding and fee slots (`:269-284`).
- A red team reads the outside-signature path, because it spends with a signature made elsewhere.

### 11. Litmus tests and the threat model

**1. Neutrality (ADR-0001): passes.**

- Both addresses are in the terms that the seller signs, the primary accepts and the buyer agrees to. Nobody can change either afterwards: the ID is their hash.
- No new actor can stop a funded deal. The payout address signs nothing. The payment address signs only before funding; declining then is the buyer declining to fund, which stores nothing.
- Every timeout still needs only the terms, and anyone can send it.
- An operator that will not prepare or relay a deal with two addresses stops nothing: the parties build the terms themselves, use another operator, or call the contract.

**2. The hold (ADR-0002): passes, with one backstop that moves.**

- Funds still leave the hold only on a decision, an early accept, a settlement both parties sign, or a timeout. Settle-once, the expiry and idempotency are untouched, and no new transfer exists in Crow's code.
- Neither party can take the hold alone, as before. The buyer's side is now two keys: the signing key acts, and only the payment address can be paid.
- **The backstop that needs no one else belongs to the payment address.** From the escrow's expiry only the payer can reclaim (`E:323`). A buyer whose payment address is a wallet that cannot make that call, or a key it has lost, gives up that backstop. Every other refund still reaches the address without any action by it.

**3. Defended judgment (ADR-0006): unaffected.** No judge, panel, seed or record reads either address.

**What each actor can now do that it could not, and what it still cannot.**

| Actor | New | Still cannot |
| --- | --- | --- |
| The seller | Be paid at any address it names when it signs the offer, a third party's included. Name an address that loses its own payment (section 8) | Change the payout address after signing. Touch the buyer's refund: the payer is in the terms the buyer agreed to and in the nonce the payment address signed. Take the hold without an accept, an early accept or a settlement |
| The buyer's signing key | Agree, accept early and settle while holding nothing | Fund, unless the payment address is a wallet whose own rule accepts that key. Be refunded. Redirect a refund to itself or anywhere else. Reclaim on the escrow. Reach any money of the payment address beyond this deal's hold |
| The buyer's payment address | Fund a deal that another key runs, and receive every refund | Be made to fund a deal it did not sign for (section 3). Stop a funded deal. Agree, accept early or settle for the buyer |
| Whoever supplies the terms or the nonce to a party that does not check them (a prepare route, a compromised host, text an agent treats as an instruction) | Send a seller's payment to a substituted payout address, or have a payment address sign a funding for other terms. Both are new, and both are stopped by the checks of section 6 | Do either to a party that rebuilds the terms from its own configuration |
| A counterparty that writes the other side's address into the terms | Nothing that survives the other side's check (section 6). Terms with a wrong payment address cannot be funded | Fund from an address that did not sign this deal's nonce |
| An operator | See both addresses before funding, as it sees the parties' addresses today. Relay the operator fee's transfer alone, as today; the loss is at most the fee and now falls on the payment address | Change either address: the terms fail the seller's signature. Author a funding. Redirect a payout or a refund |
| An adjudicator | Nothing. Its accept pays the payout address and its reject refunds the payment address, as the terms say | Choose where the price goes (`R:175-176` after the change). Its acceptance and its decision name the ID, so they cover both addresses |
| A relayer or a stranger | Nothing | Substitute an address in calldata: the ID changes and no such deal exists |

**What the audit pages need, for the task that owns them** (this task does not edit `docs/audit/`):

- **The state model's register** (`state-model.md` section 8.1): the row for `buyer` and `seller` splits. `buyer` and `seller` are enforced as signers; `buyerPaymentAddress` and `sellerPayoutAddress` are enforced as the escrow's payer and receiver.
- **The threat model's actors** (section 2): the buyer's row splits as in the table above, and the primary's "cannot" cell names the payout and payment addresses.
- **Assumption TA-4** widens: nothing requires the parties' four addresses and the three adjudicators to differ from each other.
- **One new assumption:** the payment address trusts the buyer's signing key with this deal's hold. Its signature on the funding is its consent, and its loss is bounded by `P + F` and the operator fee.
- **Section 3** (the token's behaviour): "the buyer" and "the seller" as recipients become the payment address and the payout address.
- **Section 6:** a payout address that is one of the deployment's contracts strands the seller's payment; both parties signed the terms that name it.
- **The events inventory:** the new event, and the sentence that `provider` and `client` name parties and not the receiving addresses.

### 12. The red team's findings, answered

One `red-teamer` pass read the first draft of this ADR, the contracts, the vendored escrow, the test tokens, core, both settlements, the operator's prepare routes and the threat model on 2026-11-11. It had the ADR and no other reasoning of the author. It ran nothing.

**Verdict: the contract design held on all three questions, with no Critical and no High finding** [inferred by the red team from reading]. It could not redirect a payout or a refund, fund from an address that did not sign, or lock a funded deal, beyond what section 8 states. It checked every citation of sections 2, 3 and 8 and found them correct except where a row below says so [measured by the red team]. Its findings were about what the draft left out or misstated; each is answered in the text.

| # | Severity | Finding | Answer |
| --- | --- | --- | --- |
| M-1 | Medium, SimChain only | The draft's one rule for SimChain did not say which address posts an appeal bond. Read literally, a payout address that signs nothing would pay a bond for an appeal its seller signed | Fixed in section 4: a stake made by a later signature comes from, and returns to, the signer; deal money and bond payouts to a wronged party use the payment and payout addresses. Section 5 says what that means for a per-deal key. Test 34 |
| M-2 | Medium | The draft's list of adapter and operator lines missed seven sites. Built to the list, a deal funded or settled by a direct transaction with the addresses apart would fall behind the operators' view | Fixed in section 4: the sync of a direct funding and of a direct settlement, the fee relayed alone, the event actors, the `balances` view, SimChain's capture rule and the settlement prepare route. Test 33 is a `neutrality.*` fixture for the direct route |
| L-1 | Low | "Four edits and no other" holds only after ADR-0031's cuts; the cited commits still have bonds, appeals and Permit2 | Fixed: the Order line in the header, and the paragraph in section 2 on what else changes on code that still has a cut feature |
| L-2 | Low | A seller that signs prepared terms unchecked can now lose the price to a substituted payout address; the draft did not say where an address may come from | Fixed in section 6: a party's address comes from its own configuration only, stated in `llms.txt` as a rule. Three attack fixtures join the client package's proof |
| L-3 | Low | The outside wallet's prompt cannot tell Crow's rules contract from any other operator of the same escrow; only the nonce binds it | Fixed in sections 3, 6 and 10: the holder's check pins the deployment from its own configuration, its tests refuse five kinds of wrong nonce, and test 23 shows another operator cannot redeem the signature |
| L-4 | Low | A wallet that is not deployed yet cannot pay through an operator that charges a fee, and the operator's proof list said it could | Fixed in section 10: the stated exception, with the two ways the operator package may handle it |
| L-5 | Low | No warning when a payout or payment address is one of the three adjudicators | Fixed in sections 6 and 7: the parties compare, and the tooling warns. No refusal (D31) |
| I-1 | Info | Multicall3 does not strand tokens; anyone can take them | Fixed in section 7 |
| I-2 | Info | Section 3 said the payment address signs nothing under Crow's domain; on SimChain it does | Fixed in sections 3 and 11: the claim is about EVM settlement |
| I-3 | Info | "The signing key cannot fund" fails for a wallet whose own rule accepts that key | Fixed in sections 3 and 11; test 10 is scoped to a plain key |
| I-4 | Info | A signed funding cannot be withdrawn on `TestUSDC` | Stated in section 3 |
| I-5 | Info | Terms with a changed address fail `agreeAndFund` on the seller's signature, not on the stage check | Fixed in section 2 |
| I-6 | Info | The seller always learns the payment address, and the draft did not say how it gets it | Fixed in sections 5 and 6: the buyer supplies it with its request for a quote |
| I-7 | Info | The header cited a section 12 that did not exist | This section |
| I-8 | Info | The operator fee's nonce is not bound to a deployment | Stated in section 3: paid once, to the operator named |
| I-9 | Info | With the two new addresses equal, every payout is a capture | Stated in section 2; tests 9 and 35 |

**Not changed by the red team:** the two fields, their position, the escrow's payer and receiver, the versions, and the answer to section 9.

## Alternatives considered

| Option | Why not |
| --- | --- |
| **A. Two fields in the terms; the escrow's payer and receiver (chosen)** | A change to a signed type and a redeploy |
| **B. A separate signed message per deal that names the addresses** | The contract stores one word per deal and rebuilds the payment record from the terms in every call, so the message would travel in every call and its hash would need a second stored word. The buyer and the adjudicator would no longer cover the addresses by signing the terms |
| **C. The rules contract receives the price and forwards it** | Crow's own contract takes custody and gains a transfer of its own in every outcome. The hold's test asks for custody on the neutral layer with the least code of ours |
| **D. One field only, for the seller** | Rafa decided the buyer's side belongs in the initial design. A second change to the signed type later would move every ID twice |
| **E. A free refund address for the buyer** | The escrow cannot pay it (`E:315`, `E:339`). Changing the escrow gives up its audits; paying refunds through the fee slot adds a transfer branch to every refund and still leaves the reclaim after the expiry with the payer |
| **F. The contract refuses equal addresses, or a zero or own-contract address** | Against Rafa's decision on equal addresses and against D31. A zero or stranded payout is the seller's own, and the tooling warns |
| **G. Reshape `PaymentReleased` and `Refunded` to name the receiving address** | Changes the meaning of events that every reader, the adapter's sync and the ERC-8183 shape rely on. One added event gives the same fact |
| **H. Optional fields that default to the signing address inside the hash** | Two JSON forms of one deal, and a default the contract would have to implement. A required field that the tooling fills keeps one form |
| **I. Name the payment address in `Agree` or in the `Delegation`** | `Agree` names the ID, which covers it. The `Delegation` attests scope and membership; who pays is the buyer's to disclose |

## Consequences

- Every deal's terms state four addresses for the parties. A party with one address writes it twice, and the tooling does that by default.
- A key that signs every day no longer has to hold money. A per-deal key holds none, and the refund sweep is no longer needed.
- Every fixture, vector and recording moves once, for both addresses. Agents re-pin domain 0.8, one type string and, after Rafa's redeploy, new addresses.
- A standing payment or payout address links the deals it serves on chain. The default, equal to the signing address, keeps today's behaviour.
- The payment address carries the operator fee's small front-run risk and the trust in the signing key, both bounded by one deal.
- Later work on third addresses lands beside the terms, not inside them.

## Rafa's answers, and the points still open

This ADR first listed five open points. Rafa answered on 2026-11-11 (D62). Two are decided, and three stay open. None blocks the contract package.

### Decided by Rafa, 2026-11-11

In the coordinating session, after a walk-through of the first three points, Rafa said: **"Accept all three"**. Two of the three were put to him as this ADR states them, and they are decided.

1. **The field names are final:** `buyerPaymentAddress` and `sellerPayoutAddress`. He was told that a rename after the contract package merges would be another change to the signed terms.
2. **The new event stays:** `SettlementAddresses`. His standing rule is that events are kept, for tracing, telemetry and monitoring. He was given the cost: about 1,900 gas per deal [inferred, section 2].

### Not decided: the third point reached him the wrong way round

- **What he was asked** [documented by the coordinating session]: "Add one more rule in the same version? Refusing an appeal window of zero ... a value of zero makes no sense in any case, and the format could refuse it."
- **Why that decides nothing.** The schema already refuses zero: `timing.appealWindowSec` has `minimum: 1` (`spec/schemas/commitment.schema.json:307-310`) [measured]. The candidate is the reverse (point 3 below). His "Accept all three" was an answer to a question that did not describe it, so this ADR does not record point 3 as decided. The coordinating session puts it to him again.

### Still open

3. **Should schema v0.11 allow an appeal window of 0, and should a phase-one deployment require it?**
   - **The candidate, as ADR-0031 section 8 point 3 has it:** "allow 0, and have the phase-one contract refuse any other value, as it refuses `maxSubmissions` above 1."
   - **Why it exists.** Phase one has no party appeal, so its contract never reads `appealWindowSec` (ADR-0031 section 8). The schema requires at least 1. So every phase-one deal's signed terms state an appeal window that nothing honours.
   - **What changes in the schema:** the field's `minimum` goes from 1 to 0. Its type in the signed struct stays `uint64`, so the type string does not change. On the full protocol core still requires each club's own minimum window (`packages/core/src/timing.ts:50-55`), so SimChain's deals keep their windows.
   - **Option A: the contract, core and the prepare routes all require 0 on a phase-one deployment.** `agreeAndFund` reverts on any other value, as it does for `maxSubmissions` other than 1 and for a `bondReserved` other than 0 (ADR-0031 sections 6 and 8). It costs one comparison.
   - **Option B: core and the prepare routes require 0; the contract does not check.** The contract is one comparison smaller. A deal funded by a direct transaction with a window above 0 is then taken by the contract and refused by core, so it falls behind the operators' view, and its terms still promise an appeal.
   - **Recommended: A.** It is the rule Rafa agreed for the two fields beside it ("Agree with your strict rules", D58 item 3), and it keeps the contract and core equal, which is what stops a direct deal from falling behind. Under D31 it refuses only a value this deployment cannot honour.
   - **If it is decided before the contract package starts,** it rides in v0.11 and the fixtures' IDs move once. Decided later, it needs schema v0.12 and moves every phase-one fixture's ID a second time, with no change to the domain version.
   - **Until it is decided,** v0.11 keeps `minimum: 1`, and the field stays signed and not read, as ADR-0031 records.
4. **The pilot's first deal.** Which of Rafa's addresses is the payment address, and which wallet signs the funding, is his choice when the deal is prepared.
5. **The Sepolia redeploy and the Worker switch** wait for him, as for every contract change.

## What would change this decision

- A settlement token whose ERC-3009 does not accept a contract's signature: contract wallets then cannot be payment addresses on that deployment, and the docs must say so.
- An escrow base that can refund an address other than the payer: option E returns, as a signed instruction beside the terms (section 9).
- A finding that a payment address can be made to fund a deal it did not sign for, or that a signing key can reach money beyond one deal's hold.
