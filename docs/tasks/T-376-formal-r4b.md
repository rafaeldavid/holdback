# T-376: The formal model gains a phase-one profile that matches the contracts

- **Lane:** test (the contracts audit-ready lane, `contracts-audit-ready`)
- **Phase:** 2
- **Depends on:** T-337 (the escrow's expiry and bond coverage in the model), T-357 (the late-work settlement), T-358 (the payment and payout addresses, pull request 387)
- **Paths this task may touch:** `formal/`, this file
- **Human gate:** no
- **Status:** review
- **Agent/session:** the T-376 session, refinement package R4b, change kind 7 as the lane uses it for proofs

## Intent

The TLA+ model in `formal/` still describes the full protocol: party appeals, adjudicator bonds, a recorded offer
expiry. The contracts on this lane no longer do any of that, and they gained two addresses that hold the money.
So today the model proves properties of a machine the auditors will not read, and its README points at contract
functions the lane deleted.

This task makes the one specification describe both machines, chosen by a constant:

- **The full profile** stays what it is: the whole protocol, which SimChain runs.
- **The phase-one profile** is what `contracts/src/HoldbackRules.sol` runs. It has no party appeal, no bond and no
  step that records an unfunded offer's expiry. Its deadlines are strictly ordered, it takes one delivery, and the
  first decision is final. A default refunds in one call. An early accept, or the primary's decision, may carry the
  delivery while the deal is still `Held`.

In both profiles the model names the two addresses of ADR-0033 as the holders of the money. The buyer's payment
address funds the hold and receives every refund, the reclaim on the escrow after its expiry among them. The
seller's payout address receives every payment to the seller. The buyer and the seller sign, and hold nothing
unless an address equals theirs.

**Inputs:** the lane's contract, `packages/core/src/state.ts`, `docs/audit/state-model.md` (section 9, the phase-one
machine), ADR-0031 and ADR-0033, and the Handoffs of T-337 and T-357.

**Outputs:** `formal/Holdback.tla` with the two profiles; a configuration set per profile, with the broken variants
that show each property bites; `formal/check.sh` running all of it; a README that maps each model action to the
contract's function and line for phase one and to core and SimChain for the full profile, says plainly what is not
modelled, and gives measured run times.

**Non-goals:**

- No change outside `formal/` and this file. If the model shows the contract or core doing something the state
  model forbids, that is a finding for the coordinator, with the smallest configuration that reproduces it.
- The contract's stored closing reason and decider (refactor RF-4) are not modelled yet. T-375 lands them; this
  task leaves a marked place and the property to add, and a small second pull request follows.
- The economics the full profile leaves out (a bond too small to cover, a zero appeal bond: known issues L-3 and
  L-5) stay out: phase one ships neither.

## Context

- The contract refinement plan, package R4b (kept privately, `docs/private-materials.md`).
- `docs/audit/state-model.md` section 9; ADR-0031 (the phase-one scope); ADR-0033 (the two addresses).
- `docs/tasks/T-337-formal-model-gaps.md` and `docs/tasks/T-357-core-late-work-settlement.md`, Handoff.

## Acceptance criteria

- [ ] One specification, two profiles chosen by a constant; the README says why a constant and not a copy.
- [ ] The payment address and the payout address hold the money; a property for each, checked.
- [ ] Early accept in `Held` is modelled.
- [ ] `broken/late-judge-by.cfg` is moved or retired, with the reason.
- [ ] The README maps model actions to the lane's contract with file and line, for both profiles; "Not modelled"
      is plain; the run times of safety and liveness for each profile are measured, with the machine.
- [ ] In the phase-one profile, each checked: no money moves without a signature, a decision or a passed deadline;
      each escrow pays once; every funded deal ends; a deal that ends Refunded never released its key; a default
      refunds the buyer.
- [ ] A marked place for the closing reason and the decider (RF-4), with the property to add.
- [ ] `formal/check.sh` passes for both profiles, safety and liveness; every broken configuration still fails as
      intended; a planted fault in the phase-one profile is caught; CI's formal job passes.

## Out of scope

- `.github/workflows/ci.yml`: the job's two commands, `formal/check.sh safety` and `formal/check.sh broken/`, keep
  working unchanged.
- `docs/audit/` and `CLAUDE.md`: the sentences that change are in the Handoff.

## Evidence

To fill in before review.

## Decisions

To fill in before review.

## Handoff

To fill in before review.
