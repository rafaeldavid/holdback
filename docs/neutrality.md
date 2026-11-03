# Neutrality

## The test

No single party can stop a valid commitment from settling according to its terms, or move held funds or held work outside those terms. (ADR-0001)

"Valid" means:
- both agents signed the commitment within their registered scope (in private and judgment-level deals, a per-deal key whose scope a `Delegation` certificate attests to the counterparty and the adjudicator; ADR-0024);
- the hold was funded;
- each later step either happens by its deadline or is replaced by the timeout rule the commitment names.

"Settling according to its terms" means one of five outcomes:
- release on acceptance;
- refund on rejection;
- a reclaim after the seller misses its delivery deadline;
- the default outcome when no adjudicator decides in time;
- a settlement both parties co-signed, at any split, to any addresses both parties sign (ADR-0019, D23).

## Control-point analysis

The Fixture column names scenario fixtures in `fixtures/scenarios/` and named tests that exist today (measured 2026-11-03; all pass `pnpm snap` or `pnpm test`). **Planned** marks a fixture that does not exist yet; the scenario index in `docs/plan.md` says which task owns it.

| Actor | Can | Cannot | How the transaction still completes if this actor refuses or disappears | Fixture |
| --- | --- | --- | --- | --- |
| Operator node (runs the HTTP API, relays signed messages, sponsors gas) | Relay, index, refuse service, rate-limit; ask for its published operator fee (ADR-0023) before relaying a funded agreement, answering 402 when unpaid | Author or alter agent messages; move funds (its fee moves only by the buyer's own signed transfer, never from the hold); change deadlines; make any other operator or the settlement layer require its fee | The agent fails over to another operator, or submits the signed message directly to the settlement layer (escape hatch), where no operator fee applies | `neutrality.operator-refuses`, `neutrality.operator-offline`; named tests `neutrality.operator-fee-direct-submission-free` (`apps/operator/src/fee.test.ts`), `neutrality.operator-rate-limits` (`apps/operator/src/neutrality.test.ts`) |
| Rules contract (the escrow's operator; Phase 2) | Capture or void the buyer's funds; release keys; move bonds | Act without a valid decision, early acceptance or expired timeout; be paused, upgraded or drained; change a commitment's terms | It has no admin keys and every timeout is callable by anyone. A new version is a new deployment that parties opt into | Differential tests against SimChain (`pnpm snap --settlement=local`, T-205); no-admin and invariant suites (T-203); the contract review checklist (T-206, `docs/reviews/2026-11-03-contract-review.md`) |
| Adjudicator (runs the panel, signs decisions, posts a bond) | Decide acceptance within its deadline; escalate | Decide outside its assigned commitments; move funds except through decision rules; avoid paying when an appeal overturns its decision; block the fallback or default after its deadline | The fallback adjudicator decides. If both miss their deadlines, anyone triggers the default outcome, and the defaulting adjudicators' bonds compensate the seller | `neutrality.adjudicator-offline`, `neutrality.adjudicator-silent-before-judging`, `neutrality.adjudicator-and-fallback-offline`, `neutrality.adjudicator-never-accepts`, `attack.adjudicator-self-dealing` |
| Appeal adjudicator | Decide an appeal within its deadline | Reopen a settled appeal | If the appeal is not decided by its deadline: after a party appeal, the first decision stands and the appellant's bond is returned; after an escalation, anyone triggers the default outcome and the appeal adjudicator's bond compensates the seller | `neutrality.appeal-adjudicator-offline-after-escalation`; planned: `neutrality.appeal-adjudicator-offline` (party appeal) |
| Club operator (publishes the rulebook, admits members) | Admit or refuse members; publish a new rulebook version | Freeze held funds; change the rulebook of an existing commitment, whose hash is bound into it; block commitments under an open rulebook | Commitments carry the rulebook hash they were signed under. Revoking a member stops new commitments, not those in flight | Planned: `neutrality.club-revokes-mid-flight` (SimChain reads members from genesis only) |
| On-ramp or off-ramp (Stripe test, cards, other fiat sources) | Refuse to convert money | Touch funds once they are held | Fund with another ramp or directly in stablecoin | Planned: `neutrality.onramp-refuses` (with the funding service, ADR-0026) |
| Randomness beacon (Phase 2; SimChain's own in Phase 1) | Stop publishing rounds | Bias a round (threshold signature); target a case; choose a panel; release a time-locked key early without a colluding threshold of nodes (ADR-0020) | Rounds are permanent and served by several relays. If the decider's round cannot be proven by its deadline, the fallback or default applies (ADR-0018) | Planned: `neutrality.beacon-relay-refuses`, `todo.beacon-unavailable-whole-window` |
| Model provider | Refuse or degrade judge calls | Decide alone: the panel needs at least two families, and a missing judge abstains | Abstentions below the panel's minimum valid count lead to escalation or the fallback adjudicator | `todo.provider-outage` (records the gap); planned: `neutrality.provider-outage` |
| Holdback maintainers | Ship new code; publish a judge registry | Pause, upgrade or drain deployed contracts. There are no admin keys and no proxy; a new version is a new deployment that parties opt into. Change the registry a signed commitment's panel is drawn from, because the commitment binds its `registryHash` | Existing commitments run on the code and registry they were signed under. Adjudicators may publish their own registries | No-admin checks (`contracts/test/fuzz/NoAdmin.fuzz.t.sol`, `invariant_noAdminPath`); the contract review checklist (T-206); planned: `neutrality.maintainers-change-registry` |
| Buyer agent | Refuse to accept early; appeal with a bond | Block judgment, release or a timeout | Judgment runs without the buyer. Timeouts can be triggered by anyone | `neutrality.buyer-silent` |
| Seller agent | Withhold delivery | Take held funds | Anyone can reclaim once the delivery deadline passes | `neutrality.seller-withholds-delivery` |

## Residual control points

Accepted for the prototype and tracked here:

1. **Stablecoin issuer freezes.** Fiat-backed stablecoin issuers can blacklist addresses. Mitigation: the escrow accepts any ERC-20, and the prototype uses a test token. A production rulebook can require a token with no freeze function.
2. **L2 sequencer censorship.** A sequencer can delay transactions. Mitigation: use forced inclusion through L1 where the chain supports it, and size deadlines to leave time for it.
3. **Collusion.** An adjudicator colluding with one party is bounded by commit-reveal panel selection, cross-family panels, appeals to a different adjudicator, and the bond. It is not eliminated. Affiliation is self-declared at registration, so the binding limit is the 100% coverage rule in guaranteed mode: an adjudicator's open guaranteed volume cannot exceed its bond (ADR-0007).
4. **Liveness of everyone at once.** If every operator, every adjudicator and both agents vanish, funds stay held until someone triggers the expiry rule. Anyone can trigger it, so this needs one live party anywhere.
5. **Legal process.** Courts and regulators can compel real-world parties. The design limits what any one party can do technically. It does not place anyone beyond the law.
6. **Adjudicator plaintext access.** An adjudicator that decrypts the deliverable to judge it can copy or leak the work without any decision. Bonds and appeals do not reach this. Under ADR-0020 the exposure narrows: the primary reads every delivery only in `guaranteed_on_decision`; in optimistic mode no adjudicator reads anything unless the buyer disputes; the fallback and appeal adjudicators get the key only when they take over; a mutual settlement involves no adjudicator. Mitigations: both parties name the adjudicators, `policy.providerPrivacy` can require local judges, and confidential-compute judging is a later option (ADR-0012).
7. **Appeal finality.** The appeal adjudicator's decision is final within a commitment and moves the primary's bond. It is bounded by its own bond and a larger, more diverse panel, not by a further appeal.
8. **Self-reported model identity.** The judgment record names the models that judged, but no provider signs responses, so an adjudicator could run a cheaper model under a pinned name. Bounded by the bond, appeals and calibration; removed only by provider-signed responses or attested confidential compute (ADR-0006). This is a question for the demo's AI-lab audience.
9. **The public skeleton.** At every disclosure level, the skeleton is public: payout addresses, token, price and fee, deadlines, the three adjudicators, the mode, outcomes and money movements (ADR-0020). Anyone needs it to trigger timeouts and check coverage. At the `public` level the body is public too, and `GET /v1/commitments?party=` profiles an address's counterparties, prices and descriptions in one call (ADR-0017). Since schema v0.8 (ADR-0024, T-207 stage 2a) `private` is the recipe's default. At `private` and `judgment` the bodies travel only as ciphertext, and an operator serves anyone without a party's ReadToken only the settlement projection: per-deal buyer and seller, price, fee, adjudicators, mode, deadlines and the body, rulebook, registry and policy hashes (measured by `examples/private.test.ts`, which scans every read route at both sim operators for canaries). With per-deal keys those addresses name no long-term identity, so `?party=` profiles one deal. Still visible: the work's ciphertext pointer and hashes, every settlement event, relay metadata (sizes, timing, client IP, who reads which deal), and on an EVM chain the amounts, unless a club later allows a confidential token (D4).
10. **Beacon unavailable for a whole window.** If no beacon round can be proven before a fallback or appeal deadline, that adjudicator cannot decide, and the case goes to the fallback or default outcome. Bounded by several independent relays and permanent rounds (ADR-0018). Planned fixture `todo.beacon-unavailable-whole-window`.
11. **Funding linkability.** A funding transfer links the funding account to the commitment. With a pseudonymous one-time key (ADR-0020), that transfer can still link the commitment to the principal's treasury unless it comes from a shielded pool or a fresh on-ramp account. Per-deal keys with a `Delegation` (ADR-0024 §7) hide links inside Holdback's records, not the funding graph: a per-deal address funded from a known treasury is linked on chain. How to fund it is the agent's choice and outside the protocol.
12. **No principal recourse after the agent signs.** The mandate is the principal's standing approval (ADR-0017). Revocation blocks new commitments only (FR-3). Loss on a live commitment is bounded by the scope caps (T13). There is no reversal after finality; recourse for an agent's in-mandate action lies between the principal and its agent provider, as on every payment rail today (D22).

## Escape hatch requirements

- Every state-changing message an agent signs must be valid when submitted by anyone, including the agent itself, straight to the settlement layer.
- The internal client the demo and tests use (`packages/sdk`, not a published SDK; D30) has a direct-submit path, and the `neutrality.operator-*` fixtures test it.
- Operator APIs are conveniences, not gatekeepers: they add indexing, gas sponsorship and machine-speed responses, and nothing else.

## How neutrality is tested

- `neutrality.*` scenario fixtures (see `docs/testing.md`): each one takes one actor offline or makes it refuse, and asserts that the commitment still reaches a terms-compliant end state with the expected balances. Nine exist; the control-point table marks the planned ones. Litmus test 1 in `CLAUDE.md` requires a fixture per actor, so each planned one is a gap that must be closed before any public-chain deployment.
- A formal model of the state machine (`formal/Holdback.tla`, T-204) checks two properties with TLC:
  - **Liveness:** every funded commitment reaches Released, Refunded or Defaulted under fairness of "anyone may trigger timeouts", even when any single named actor halts.
  - **Safety:** no transition moves funds without a valid signature, decision or timeout.
- A contract review checklist (T-206). `docs/reviews/2026-11-03-contract-review.md` §3 answers it item by item, each with a file and line or a named test:
  - no owner, role, pause, freeze, blacklist or upgrade proxy; every parameter, the beacon included, is immutable or a constant;
  - no `SELFDESTRUCT`, `CALLCODE` or Holdback `DELEGATECALL` in the bytecode, and no `receive` or `fallback`;
  - every timeout is callable by anyone, refused before its deadline and allowed from it;
  - no function moves held funds or bonds without a signature, a decision or an expired timeout;
  - no bond is encumbered without its adjudicator's own acceptance or decision;
  - settle-once: every money path leaves the funded stages before its first call to CPP or a token (the bond vault's `release` and `encumber`, which may come first, make no external call);
  - the buyer's key is released in the same transaction as the capture, and never on reject or reclaim;
  - `authorizationExpiry` falls after the last possible capture (ADR-0003), and every bond is still released after the buyer's own reclaim on CPP;
  - every agreed deadline binds every path that acts on it;
  - no field a decider controls changes a panel seed (ADR-0018);
  - every signed message binds the commitment, the signer's role and what it moves, under the deployment's EIP-712 domain.
