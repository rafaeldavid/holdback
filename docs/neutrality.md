# Neutrality

## The test

No single party can stop a valid commitment from settling according to its terms, or move held funds or held work outside those terms. (ADR-0001)

"Valid" means:
- both agents signed the commitment within their registered scope;
- the hold was funded;
- each later step either happens by its deadline or is replaced by the timeout rule the commitment names.

"Settling according to its terms" means one of five outcomes:
- release on acceptance;
- refund on rejection;
- a reclaim after the seller misses its delivery deadline;
- the default outcome when no adjudicator decides in time;
- a settlement both parties co-signed, at any split of the price (ADR-0019).

## Control-point analysis

| Actor | Can | Cannot | How the transaction still completes if this actor refuses or disappears | Fixture |
| --- | --- | --- | --- | --- |
| Operator node (runs the REST API, relays signed messages, sponsors gas) | Relay, index, refuse service, rate-limit | Author or alter agent messages; move funds; change deadlines | The SDK fails over to another operator, or submits the signed message directly to the settlement layer (escape hatch) | `neutrality.operator-refuses`, `neutrality.operator-offline` |
| Rules contract (the escrow's operator; Phase 2) | Capture or void the buyer's funds; release keys; move bonds | Act without a valid decision, early acceptance or expired timeout; be paused, upgraded or drained; change a commitment's terms | It has no admin keys and every timeout is callable by anyone. A new version is a new deployment that parties opt into | Contract review checklist; differential tests against SimChain |
| Adjudicator (runs the panel, signs decisions, posts a bond) | Decide acceptance within its deadline; escalate | Decide outside its assigned commitments; move funds except through decision rules; avoid paying when an appeal overturns its decision; block the fallback or default after its deadline | The fallback adjudicator decides. If both miss their deadlines, anyone triggers the default outcome, and the defaulting adjudicators' bonds compensate the seller | `neutrality.adjudicator-offline`, `neutrality.adjudicator-silent-before-judging`, `neutrality.adjudicator-and-fallback-offline`, `neutrality.adjudicator-never-accepts`, `attack.adjudicator-self-dealing` |
| Appeal adjudicator | Decide an appeal within its deadline | Reopen a settled appeal | If the appeal is not decided by its deadline: after a party appeal, the first decision stands and the appellant's bond is returned; after an escalation, anyone triggers the default outcome and the appeal adjudicator's bond compensates the seller | `neutrality.appeal-adjudicator-offline`, `neutrality.appeal-adjudicator-offline-after-escalation` |
| Club operator (publishes the rulebook, admits members) | Admit or refuse members; publish a new rulebook version | Freeze held funds; change the rulebook of an existing commitment, whose hash is bound into it; block commitments under an open rulebook | Commitments carry the rulebook hash they were signed under. Revoking a member stops new commitments, not those in flight | `neutrality.club-revokes-mid-flight` |
| On-ramp or off-ramp (Stripe test, cards, other fiat sources) | Refuse to convert money | Touch funds once they are held | Fund with another ramp or directly in stablecoin | `neutrality.onramp-refuses` |
| Randomness beacon (Phase 2; SimChain's own in Phase 1) | Stop publishing rounds | Bias a round (threshold signature); target a case; choose a panel; release a time-locked key early without a colluding threshold of nodes (ADR-0020) | Rounds are permanent and served by several relays. If the decider's round cannot be proven by its deadline, the fallback or default applies (ADR-0018) | `neutrality.beacon-relay-refuses`, `todo.beacon-unavailable-whole-window` |
| Model provider | Refuse or degrade judge calls | Decide alone: the panel needs at least two families, and a missing judge abstains | Abstentions below the panel's minimum valid count lead to escalation or the fallback adjudicator | `neutrality.provider-outage` |
| Holdback maintainers | Ship new code; publish a judge registry | Pause, upgrade or drain deployed contracts. There are no admin keys and no proxy; a new version is a new deployment that parties opt into. Change the registry a signed commitment's panel is drawn from, because the commitment binds its `registryHash` | Existing commitments run on the code and registry they were signed under. Adjudicators may publish their own registries | Contract review checklist; `neutrality.maintainers-change-registry` |
| Buyer agent | Refuse to accept early; appeal with a bond | Block judgment, release or a timeout | Judgment runs without the buyer. Timeouts can be triggered by anyone | `neutrality.buyer-silent` |
| Seller agent | Withhold delivery | Take held funds | Anyone can reclaim once the delivery deadline passes | `S8 reclaim` |

## Residual control points

Accepted for the prototype and tracked here:

1. **Stablecoin issuer freezes.** Fiat-backed stablecoin issuers can blacklist addresses. Mitigation: the escrow accepts any ERC-20, and the prototype uses a test token. A production rulebook can require a token with no freeze function.
2. **L2 sequencer censorship.** A sequencer can delay transactions. Mitigation: use forced inclusion through L1 where the chain supports it, and size deadlines to leave time for it.
3. **Collusion.** An adjudicator colluding with one party is bounded by commit-reveal panel selection, cross-family panels, appeals to a different adjudicator, and the bond. It is not eliminated. Affiliation is self-declared at registration, so the binding limit is the 100% coverage rule in guaranteed mode: an adjudicator's open guaranteed volume cannot exceed its bond (ADR-0007).
4. **Liveness of everyone at once.** If every operator, every adjudicator and both agents vanish, funds stay held until someone triggers the expiry rule. Anyone can trigger it, so this needs one live party anywhere.
5. **Legal process.** Courts and regulators can compel real-world parties. The design limits what any one party can do technically. It does not place anyone beyond the law.
6. **Adjudicator plaintext access.** An adjudicator that decrypts the deliverable to judge it can copy or leak the work without any decision. Bonds and appeals do not reach this. Under ADR-0020 the exposure narrows: the primary reads every delivery only in `guaranteed_on_decision`; in optimistic mode no adjudicator reads anything unless the buyer disputes; the fallback and appeal adjudicators get the key only when they take over; a mutual settlement involves no adjudicator. Mitigations: both parties name the adjudicators, `policy.providerPrivacy` can require local judges, and confidential-compute judging is a later option (ADR-0012). Fixture `todo.adjudicator-leaks-plaintext` records the gap.
7. **Appeal finality.** The appeal adjudicator's decision is final within a commitment and moves the primary's bond. It is bounded by its own bond and a larger, more diverse panel, not by a further appeal.
8. **Self-reported model identity.** The judgment record names the models that judged, but no provider signs responses, so an adjudicator could run a cheaper model under a pinned name. Bounded by the bond, appeals and calibration; removed only by provider-signed responses or attested confidential compute (ADR-0006). This is a question for the demo's AI-lab audience.
9. **The public skeleton.** At every disclosure level, the skeleton is public: payout addresses, token, price and fee, deadlines, the three adjudicators, the mode, outcomes and money movements (ADR-0020). Anyone needs it to trigger timeouts and check coverage. At the `public` level, which is Phase 1's only level, the body is public too, and `GET /v1/commitments?party=` profiles an address's counterparties, prices and descriptions in one call (ADR-0017). The `private` and `judgment` levels and the pseudonymous identity mode (Phase 2) narrow this to the skeleton. Amounts stay visible on an EVM chain unless a club allows a confidential token (D4).
10. **Beacon unavailable for a whole window.** If no beacon round can be proven before a fallback or appeal deadline, that adjudicator cannot decide, and the case goes to the fallback or default outcome. Bounded by several independent relays and permanent rounds (ADR-0018). Fixture `todo.beacon-unavailable-whole-window`.
11. **Funding linkability.** A funding transfer links the funding account to the commitment. With a pseudonymous one-time key (ADR-0020), that transfer can still link the commitment to the principal's treasury unless it comes from a shielded pool or a fresh on-ramp account. This is outside the protocol.
12. **No principal recourse after the agent signs.** The mandate is the principal's standing approval (ADR-0017). Revocation blocks new commitments only (FR-3). Loss on a live commitment is bounded by the scope caps (T13). There is no reversal after finality; recourse for an agent's in-mandate action lies between the principal and its agent provider, as on every payment rail today (D22). Fixture `todo.principal-no-recourse`.

## Escape hatch requirements

- Every state-changing message an agent signs must be valid when submitted by anyone, including the agent itself, straight to the settlement layer.
- The SDK ships a direct-submit path and tests it in fixtures.
- Operator APIs are conveniences, not gatekeepers: they add indexing, gas sponsorship and machine-speed responses, and nothing else.

## How neutrality is tested

- `neutrality.*` scenario fixtures (see `docs/testing.md`): each one takes one actor offline or makes it refuse, and asserts that the commitment still reaches a terms-compliant end state with the expected balances.
- A formal model of the state machine (Phase 2) checks two properties:
  - **Liveness:** every funded commitment reaches Released, Refunded or Defaulted under fairness of "anyone may trigger timeouts", even when any single named actor halts.
  - **Safety:** no transition moves funds without a valid signature, decision or timeout.
- A contract review checklist: no owner, pause, blacklist, `selfdestruct` or upgrade proxy; every timeout function is callable by anyone.
