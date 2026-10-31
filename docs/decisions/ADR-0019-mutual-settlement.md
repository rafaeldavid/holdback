# ADR-0019: Mutual settlement

- **Status:** Accepted, 2026-10-30 (D15)
- **Date:** 2026-10-30
- **Raised by:** Rafa: "one way out, without adjudicator, is both parties agree on outcome. So it's kinda like a 2/3 agreement, or adjudicator decides if they disagree." An independent research pass (Fable, max effort) recommended option A below. It amends ADR-0001, ADR-0012 and `docs/neutrality.md`, and changes T-006, T-007 and T-010.

## Context

- **Escrow already works as a 2-of-3 in most systems.** Buyer and seller can end the deal on any terms they both sign. The neutral third party acts only when they disagree.
- **Holdback has only half of that.** Measured in `packages/core/src/state.ts`:
  - The buyer can end a commitment alone with `EarlyAccept`.
  - The seller has no concession path, so it cannot refund before `deliverBy`.
  - `remedy.onReject` is `const full_refund`.
  - `Decision.outcome` is accept, reject or escalate.
  - Early acceptance is not appealable.
  - Every delivery must carry the content key encrypted to the buyer, so the settlement layer can release the key on any path both parties consent to.

**Prior art.** Every mature system puts the parties' consent first and the neutral party last:

| System | How it works | Source |
| --- | --- | --- |
| Bitcoin 2-of-3 escrow | Buyer and merchant release together without the mediator. The mediator signs only on a dispute. There is no split or fee rule (measured). | https://en.bitcoin.it/wiki/Contract |
| OpenBazaar | 2-of-2 on the happy path, 2-of-3 on a dispute. Moderators may split, and are paid only when they resolve a dispute (measured, from a 2016 design gist and secondary sources). | https://gist.github.com/cpacia/987905d75eca1bf089f53eecde166d44 |
| Bisq | The mediator holds no key, and its payout suggestion needs both traders. Arbitration pays less than mediation, so settling is cheaper (measured, through bisq.wiki excerpts). | https://bisq.wiki/Dispute_resolution |
| Kleros Escrow | Either party proposes an amount, and money moves only when the other explicitly accepts. A dispute is possible only after the settlement timeout (measured). | https://docs.kleros.io/products/escrow |
| Escrow.com | Direct negotiation first, then paid arbitration (measured). | https://www.escrow.com/learn-more/how-escrow-works/escrow-dispute |
| UNCITRAL ODR Technical Notes | Negotiation, then facilitated settlement, then a final stage (measured, paras 18 to 21). | https://uncitral.un.org/sites/uncitral.un.org/files/media-documents/uncitral/en/v1700382_english_technical_notes_on_odr.pdf |
| Stripe | Partial and repeated refunds up to the charge amount. Disputes are accept or challenge, with no partial settlement (measured). | https://docs.stripe.com/refunds |
| CPP `AuthCaptureEscrow` | Capture is partial and repeatable, each with its own fee, and `void` returns the remainder (measured, `docs/research/prior-art.md` Q3). | `docs/research/prior-art.md` |
| ERC-8183 | All or nothing. The evaluator cannot award another amount, and there is no mutual path (measured). | https://eips.ethereum.org/EIPS/eip-8183 |
| UMA | No negotiated settlement. Disputes go to the DVM vote (measured, prior-art S18). | `docs/research/prior-art.md` |

The prior-art review scored as neutrality failures the systems that let the neutral party pick an arbitrary split, such as OpenBazaar and Trustless Work (inferred).

## Decision

### Three tiers in every mode

1. **Consent.** `EarlyAccept`, signed by the buyer, and `MutualSettlement`, signed by both parties.
2. **Silence default.** There is none in judged modes. In optimistic mode, silence means release at `disputeBy`.
3. **Adjudication.** It is called by the party the silence default disfavors (D19). In judged modes it is automatic, so no one needs to call it. In optimistic mode the buyer calls it with a dispute. Either party can appeal.

Holdback is a 2-of-3 where the third key can only sign the outcomes the terms allow. The adjudicator signs accept, reject or escalate, under its bound policy, registry and seed, backed by a bond, an appeal and timeouts.

### The message

```
MutualSettlement {
  commitmentId,
  deliveryHash | null,   // the current delivery, or null while Held
  sellerAmount,          // 0 ≤ sellerAmount ≤ price; the buyer gets the rest
  releaseKey,            // true: the buyer receives the content key
  nonce,
  expiresAt
}
```

- Buyer and seller sign the identical EIP-712 struct, as with Offer and Agree. One signature moves nothing.
- Anyone may submit the co-signed message, through any operator or directly.

### Rules

- **Allowed** in `Held`, `Delivered`, `FallbackJudging` and `Escalated`, in every settlement mode.
- **Refused:**
  - after a decision has moved the funds (`Released`, `Refunded`);
  - in `Defaulted`;
  - when the commitment's rulebook sets `mutualSettlement.allowed: false`.
- **Amounts.** `sellerAmount` goes to the seller, and `price - sellerAmount` goes to the buyer. The sum always equals the price.
- **Fee.** The rulebook sets it, never the message, so the parties cannot assign it against the rulebook.
  - In Phase 1 the full fee returns to the buyer, because no one decided. This mirrors early acceptance.
  - Later, a rulebook parameter `adjudicatorFeeShareAfterDeliveryBps` (default 0) can pay the sitting adjudicator a kill fee. ADR-0022 added the `Bps` suffix: the share is an integer in basis points.
- **Bond.** The adjudicator's reserved bond is released at settlement, because nothing is open to appeal.
- **Key.** Both parties choose `releaseKey`.
  - `true` is a discounted acceptance: the buyer receives the content key from the buyer-encrypted envelope in the delivery.
  - `false` is a paid cancellation: the seller keeps the work, and its share is a kill fee.
  - `releaseKey` must be false when there is no delivery.
  - As with early acceptance, a wrong key has no appeal.
- **Race with a decision.** Settle-once holds. Whichever of the settlement or the decision the settlement layer applies first wins, and the other is refused.

### What does not change

- **Adjudicator decisions stay binary.** Letting an adjudicator decide a split is rejected for now (alternative C). A party-chosen `remedy.onReject: prorated_by_score` may come back after Phase 3 calibration data exists.
- **No proposal relay endpoint.** Negotiation happens out of band, as the PRD says. Only the co-signed result is submitted.
- **`EarlyAccept` stays,** as the one-signature special case: full release, key released, fee back to the buyer.

**Privacy.** Research on the privacy model is in progress. That decision may change who can see a settlement and its split.

## Alternatives considered

- **B. Mutual settlement only before `judgeBy`** (`Held`, `Delivered`). This protects late-stage adjudicator revenue. But parties who agree during fallback or escalation would wait out windows of minutes in the demo and days on a chain, for a decision neither of them wants. It narrows choice for no safety gain.
- **C. The adjudicator decides splits from the rubric score.** A continuous target is easier to nudge by injection. False-accept and false-reject pricing and calibration break, appeals become arguments about amounts, and bonds must cover the differences. The rule-bound third key becomes discretionary. Not now.
- **D. Defer to Phase 4.** Phase 1 would be unchanged, but the seller concession gap and the demo beat would be lost.

## Consequences

- **Schema** (v0.5 if the PR 23 author folds it in, otherwise v0.6):
  - `messages.schema.json` adds `MutualSettlement` with `buyerSignature` and `sellerSignature`;
  - `commitment-state.schema.json` adds `Settled`, with `sellerAmount`, `buyerAmount` and `keyReleased`;
  - `event.schema.json` adds `commitment.settled`;
  - `club.schema.json` adds `mutualSettlement: { allowed, adjudicatorFeeShareAfterDeliveryBps }` (the suffix per ADR-0022).
- **Core `state.ts`:**
  - a new event `mutual_settle`;
  - guards:
    - the commitment is funded and undecided;
    - the two signers equal `terms.buyer` and `terms.seller`;
    - `deliveryHash` matches the current delivery, or is null in `Held`;
    - `sellerAmount ≤ price`;
    - `releaseKey` requires a delivery;
    - the rulebook allows it;
  - a new terminal `Settled` variant, which refuses appeals.
- **Postings:**
  - `escrow:{id} → seller` (`sellerAmount`);
  - `escrow:{id} → buyer` (`price - sellerAmount + fee`);
  - every adjudicator reservation on the commitment is released;
  - the buyer's key is emitted if and only if `releaseKey` is true.
- **API:** `POST /v1/commitments/{id}/settlements` takes the co-signed message and supports `?validateOnly=true` (ADR-0017). Triggers are unchanged.
- **Fixtures (T-010):**
  - Paths:
    - `mutual-split-releases-key`;
    - `mutual-refund-before-delivery`;
    - `mutual-cancel-keeps-work`.
  - Neutrality: `neutrality.mutual-settlement-adjudicator-offline`.
  - Errors:
    - `error.settlement-single-signature`;
    - `error.settlement-exceeds-price`;
    - `error.settlement-after-decision`;
    - `error.settlement-key-without-delivery`;
    - `error.settlement-stale-delivery`;
    - `error.settlement-disallowed-by-rulebook`.
  - Attacks: `attack.settlement-race-with-decision`.
- **Demo:** an optional beat 10, in which two agents agree a 70/30 split in milliseconds and the adjudicator stands by. It sits outside the success criteria.
- **Settlement layer feasibility:**
  - On SimChain it is two postings.
  - In Phase 2 it is `capture(sellerAmount, fee share)` then `void()`, before `authorizationExpiry`, with no new primitive (measured, prior-art Q3).
- **Incentives (ADR-0014):** settling returns the fee, so it costs less than judging. Fewer cases are judged, so quality signals thin out. ADR-0015 already accepts that.

## Litmus tests

- **Neutrality.**
  - Both parties sign, and the payees are fixed to the two parties, so no party moves funds outside the terms. The terms-compliant outcomes gain "a settlement both parties co-signed".
  - The adjudicator gets no veto, which would be a new control point.
  - Either party can still walk away to the judged path, so neither gains a holdout over the other. Today only the buyer has a way to end the commitment without a decision, so this is more symmetric (inferred).
  - `neutrality.mutual-settlement-adjudicator-offline` shows a settlement completing while the adjudicator is offline.
  - Passes.
- **The hold.**
  - Settle-once and nonces hold.
  - An expiry bounds each signed settlement.
  - The amounts sum to the price.
  - The key goes to the buyer only when both chose it.
  - Passes.
- **Defended judgment.**
  - The judgment path is unchanged when it runs.
  - Adjudicator decisions stay binary.
  - Fewer cases are judged.
  - Passes.

## Amended by ADR-0020 (D16)

Who can see a settlement's split follows the disclosure level. The money movements are part of the public skeleton, so the amounts paid to each payout address are visible at every level. Any reasons or terms the parties attach stay in the body.

## Amended by D23 (any recipients)

Accepted 2026-10-31 (D23). Rafa's framing: if buyer and seller agree, they should be able to pull the held funds to any address or mechanism in any split, for example to arbitrate outside the model. An independent research pass (Fable, max effort) recommended this shape. Schema v0.6 carries it.

**What changes.**
- `sellerAmount` is replaced by `payouts`: one to eight entries, each `{to, amount}`.
- `to` is any address both parties sign for: a party, another escrow, an outside arbiter.
- Every amount is above zero and in the price token. The core parser refuses a recipient named twice, in any letter case, and payouts in more than one token.
- The payouts must sum to the price exactly. `mutualSettlementProblem` in core checks the sum, the token and the rulebook against the terms; T-006 applies it before any posting.
- The EIP-712 type gains `Payout(address to,TokenAmount amount)` and `Payout[] payouts`. Every leaf of a payout is signed.

**What does not change.**
- The adjudication fee still returns to `terms.buyer`.
- Every reservation on the commitment is released.
- The content key still goes only to the buyer, and only if both chose `releaseKey`.
- Settle-once, the nonce, the expiry and the race rule against a decision are unchanged.

**Rulebook.** `mutualSettlement.payoutsTo` is `parties` or `any`. With `parties`, every payout must name the buyer or the seller. The demo club uses `any`. A regulated club sets `parties`, because a payout to a non-party is a standard anti-money-laundering flag (FinCEN advisory on third-party layering, https://www.fincen.gov/system/files/2025-08/FinCEN-Advisory-CMLN-508.pdf).

**The limit.** Only money leaves. The content key is wrapped to the buyer and cannot follow the funds to an outside mechanism (ADR-0012, ADR-0020). If the parties exit to another arbiter, the seller hands the work over outside the protocol.

**Prior art.**
- Bitcoin 2-of-3 escrow: any two keys spend to any output, and the mediator never chooses alone (https://en.bitcoin.it/wiki/Contract).
- Safe multisig: `execTransaction(to, value, data, ...)` runs on the owner threshold, to any destination (https://github.com/safe-global/safe-smart-account/blob/main/contracts/Safe.sol).
- Escrow.com: disputes end by a "joint instruction providing the terms of an agreed upon resolution" (https://www.escrow.com/escrow-101/general-escrow-instructions).
- M&A escrow: joint written instructions release funds "to the account designated in writing in such joint written instruction" (https://lawinsider.com/clause/joint-written-instructions).
- In contrast, Kleros escrow fixes payees to the sender, the receiver and the arbitrator (https://github.com/kleros/kleros-interaction/blob/master/contracts/standard/arbitration/MultipleArbitrableTransaction.sol).

**Phase 2 on AuthCaptureEscrow (inferred from the contract code).** A payout to a third party is a fee-only `capture` to that address. The seller's share is a normal capture. The buyer's share is `void()`. All of it runs in one rules-contract transaction. A recipient the token issuer has denylisted reverts the whole settlement; the hold stays and the parties sign again (residual 1).

**Litmus tests.** Neutrality: two signatures still move the funds and no one else can; no actor loses a right it had under ADR-0019. The hold: integer sum, settle-once, nonce and expiry are unchanged, and a settlement applies atomically or not at all. Defended judgment: unchanged.

**Alternatives.** Keep payees fixed (option A): exiting to another mechanism would then need one party to take custody first, which is the trust escrow removes. Exit only to pre-registered addresses (C): the parties could not name a shared outside arbiter. Defer to a later schema (D): costs a second bump after T-006 and T-007 build on `sellerAmount`.

