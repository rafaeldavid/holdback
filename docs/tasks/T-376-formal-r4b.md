# T-376: The formal model gains a phase-one profile that matches the contracts

- **Lane:** test (the contracts audit-ready lane, `contracts-audit-ready`)
- **Phase:** 2
- **Depends on:** T-337 (the escrow's expiry and bond coverage in the model), T-357 (the late-work settlement), T-358 (the payment and payout addresses, pull request 387)
- **Paths this task may touch:** `formal/`, this file
- **Human gate:** no
- **Status:** done (pull request 401 merged as `03fcc98` on 2026-11-12; the RF-4 second pass follows from branch `t-376-formal-rf4`)
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
- The contract's stored closing reason and decider (refactor RF-4) were not modelled in the first pull request,
  which left a marked place and the property to add. T-375 landed them, and the second pass models them
  (Evidence, "The second pass").
- The economics the full profile leaves out (a bond too small to cover, a zero appeal bond: known issues L-3 and
  L-5) stay out: phase one ships neither.

## Context

- The contract refinement plan, package R4b (kept privately, `docs/private-materials.md`).
- `docs/audit/state-model.md` section 9; ADR-0031 (the phase-one scope); ADR-0033 (the two addresses).
- `docs/tasks/T-337-formal-model-gaps.md` and `docs/tasks/T-357-core-late-work-settlement.md`, Handoff.

## Acceptance criteria

- [x] One specification, two profiles chosen by a constant; the README says why a constant and not a copy.
- [x] The payment address and the payout address hold the money; a property for each, checked.
- [x] Early accept in `Held` is modelled.
- [x] `broken/late-judge-by.cfg` is moved or retired, with the reason.
- [x] The README maps model actions to the lane's contract with file and line, for both profiles; "Not modelled"
      is plain; the run times of safety and liveness for each profile are measured, with the machine.
- [x] In the phase-one profile, each checked: no money moves without a signature, a decision or a passed deadline;
      each escrow pays once; every funded deal ends; a deal that ends Refunded never released its key; a default
      refunds the buyer.
- [x] A marked place for the closing reason and the decider (RF-4), with the property to add.
- [x] `formal/check.sh` passes for both profiles, safety and liveness; every broken configuration still fails as
      intended; a planted fault in the phase-one profile is caught; CI's formal job passes.

## Out of scope

- `.github/workflows/ci.yml`: the job's two commands, `formal/check.sh safety` and `formal/check.sh broken/`, keep
  working unchanged.
- `docs/audit/` and `CLAUDE.md`: the sentences that change are in the Handoff.

## Evidence

All measured on 2026-11-12 on the maintainer's machine (Apple M1 Pro, 8 cores, 16 GB, macOS 26.6; TLC 2.19 from
tla2tools v1.7.4, 8 workers), at commit `6a15d2a`, unless a line says otherwise.

- **`formal/check.sh` (the whole run): exit 0, "all 120 config(s) met expectations", 32 min 48 s** [measured,
  08:40:47 to 09:13:35 UTC]. 24 configs pass, 52 broken variants fail as intended, 44 reach witnesses are reached.

  | config | result | distinct states | depth | wall |
  | --- | --- | ---: | ---: | ---: |
  | `full/safety-equal`, `full/safety-apart` | pass | 169,621 each | 31 | 8 s, 9 s |
  | `full/safety-halting` (any one actor halts) | pass | 1,841,663 | 32 | 202 s |
  | `full/live-<actor>`, 8 configs | pass | 326,648 to 405,290 | 32 | 138 s to 240 s; 1,360 s together |
  | `phase-one/safety-equal`, `-apart`, `-buyer-apart`, `-seller-apart` | pass | 64,225 each | 27 | 3 s to 4 s |
  | `phase-one/safety-halting` (any one actor halts) | pass | 644,257 | 28 | 19 s |
  | `phase-one/live-<actor>`, 8 configs | pass | 105,985 to 149,185 | 28 | 13 s to 70 s; 241 s together |
  | `broken/full/*`, 25 configs | each fails with its expected line | | | 1 s to 5 s |
  | `broken/phase-one/*`, 27 configs | each fails with its expected line | | | 1 s to 5 s |
  | reach witnesses, 44 | each reached | | | 1 s to 5 s |

- **The phase-one properties, each with its config and result** [measured in the run above]:

  | The promise | Property | Config | Result | The planted fault that fails it |
  | --- | --- | --- | --- | --- |
  | No money moves without a signature, a decision or a passed deadline | `AuthorizedMoves`, `AuthorizedSteps`, `PaymentAddressFunds` | the five `phase-one/safety-*`; signatures in `safety-halting` and the eight `live-*` | pass | `operator-authors`, `early-reclaim`, `late-early-accept`, `settle-alone`, `fund-without-payer` (`AuthorizedMoves`); `early-fallback`, `late-delivery`, `wrong-decider` (`AuthorizedSteps`); `fund-from-signer` (`PaymentAddressFunds`) |
  | Each escrow pays once | `SettleOnce`, `FirstDecisionFinal` | `phase-one/safety-*` | pass | `double-refund`, `second-capture` |
  | Every funded deal ends | `FundedSettles` | `phase-one/live-*`, each of eight actors halted | pass | `buyer-only-timeout` |
  | A deal that ends Refunded never released its key | `RefundedNeverReleasedKey`, `AtomicKey` | `phase-one/safety-*` | pass | `reject-releases-key`, `key-separate` |
  | A default refunds the buyer | `DefaultRefundsBuyer`, `PaidAsClosed` | `phase-one/safety-*` | pass | `default-pays-fee`, `early-accept-keeps-fee` |
  | The payment address funds the hold and receives every refund | `PaymentAddressFunds`, `PaidAsClosed`, `EscrowLedger`, `NoCaptureAfterExpiry` | `phase-one/safety-*` | pass | `fund-from-signer`, `refund-to-signer`, `pay-signer-ledger`, `capture-after-expiry` |
  | The payout address receives every payment to the seller | `PaidAsClosed`, `EscrowLedger` | `phase-one/safety-*` | pass | `pay-signer`, `pay-signer-ledger` |
  | The signing addresses hold nothing when the addresses are apart | `SignersHoldNothing`, `SignersOnlyStake` | `phase-one/safety-apart`, `-buyer-apart`, `-seller-apart`, `-halting` | pass | `refund-to-signer`, `pay-signer` |
  | Phase one has no appeal, bond, recorded expiry or Defaulted state | `PhaseOneCuts` | `phase-one/safety-*`, `phase-one/live-*` | pass | `expire-recorded` |
  | A lapsed offer never funds | `LapsedOfferNeverFunds` | `phase-one/safety-*` | pass | `fund-after-expiry` |
  | The escrow's expiry comes after every deadline a capture could meet | `ExpiryAfterCaptures` | `phase-one/safety-*` | pass | `late-judge-by` |
  | No unit is created or destroyed; no account goes negative | `Conservation`, `NonNegative`, `EscrowMatchesState` | `phase-one/safety-*` | pass | `reject-refunds-fee`, `fund-from-signer-negative`, `double-refund-escrow` |

- **The planted fault the task names is caught** [measured]: `broken/phase-one/refund-to-signer.cfg` pays a
  reclaim's refund to the buyer's signing address; TLC reports "Invariant SignersHoldNothing is violated" after
  1,441 distinct states.
- **Every closing row of the state model's phase-one table is reached** [measured]: the 44 witnesses of
  `formal/reach.list`, rows P06 to P17 of `docs/audit/state-model.md` section 9.3 among them, each by the step
  that closes it.
- **The model found no divergence** between the contract and the state model [measured for the model's runs;
  inferred for the contract, from reading it against the model twice, by this session and by the reviewer]. No
  finding went to the coordinator.
- **Nothing outside `formal/` and this file changed** [measured: `git diff --name-only origin/contracts-audit-ready...HEAD`].
- **CI on pull request 401** [measured]: every check passed; `formal (TLC)`, which runs `check.sh safety` and
  `check.sh broken/`, took 6 min 30 s.

**Review** (one `reviewer` subagent, given CLAUDE.md, the contract, the escrow, the state model, ADR-0031,
ADR-0033 and the specification at `7a39258`, and not this session's conclusions; it planted seven faults of its
own). Verdict: ISSUES, one High, four Medium, seven Low, none in the contract. It found the model's guards and
deadlines match the contract, and every line the README cites correct. Fixed in one round (`6a15d2a`):

- **High, H-1:** no config checked that a named signer could act, because every safety config had no halted
  actor. A settlement that needed the buyer alone passed. Fixed: `Halted = "any"`, the two `safety-halting`
  configs, every action property in the `live-*` configs, and the variants `settle-alone` and
  `fund-without-payer`. The gap predated this task.
- **Medium, M-1:** no property constrained a step that moves no money. Fixed: `AuthorizedSteps`, with
  `early-fallback`, `late-delivery` and `wrong-decider`.
- **Medium, M-2:** in the full profile nothing fixed where an overturn's payout or a returned stake lands. Fixed:
  `BondMoneyLands`, with `broken/full/overturn-pays-signer.cfg`.
- **Medium, M-3:** five witnesses were reached only through the decision that carries the delivery. Fixed: each
  witness now names the step and the stage before it; the five behaviours the review listed have witnesses.
- **Medium, M-4:** this section, Decisions, Handoff and the README's run times were empty. Filled.
- **Low, fixed:** L-1 (five additions to "Not modelled"), L-2 (the README says which property follows from
  which; broken variants for `NonNegative`, `EscrowMatchesState`, `KeyOnlyWithPayment`, the full profile's
  address properties and its three other liveness properties), L-3 (`AuthorizedSteps` ties the recorded decider
  to the turn), L-5 (`check.sh phase-one/` runs the witnesses), L-6 (the README says the liveness verdict does
  not depend on the actor), L-7 (`PaidAsClosed` has no overlapping `CASE` arms).
- **Low, left:** L-4, the full profile's bond steps follow the deleted vault and not SimChain's bookkeeping. The
  README says so under "Not modelled"; it predates this task (T-337).

### The second pass (RF-4)

T-375 merged the closing reason and the decider into `HoldbackRules.sol` (pull request 406, `f4ff8d7`). The second
pass, from the lane's tip `74fa299`, models both. All measured on 2026-11-12 on the same machine, at commit
`ff1c371`, unless a line says otherwise.

- **What it adds:** the variables `reason` and `decider`, written in each step that closes a deal as the contract
  writes them (`HoldbackRules.sol:336`, `:344`, `:393`, `:433`, `:478`, `:508`, `:514`); the invariants
  `ReasonRules` and `ReasonMatchesMoney`; conjuncts in `AuthorizedSteps` that tie both fields to the closing step,
  and in `FirstDecisionFinal` that keep them fixed after it.
- **`formal/check.sh` (the whole run): exit 0, "all 124 config(s) met expectations", 30 min 4 s** [measured,
  10:08:48 to 10:38:52 UTC]. 24 configs pass, 56 broken variants fail as intended, 44 reach witnesses are reached.
  The state counts equal the first pass's: the two fields add no state, because the closing step fixes them.

  | Property | Kind | Config | Result | The planted fault that fails it |
  | --- | --- | --- | --- | --- |
  | `ReasonRules`: `open` exactly while the deal is open; a decider exactly when `decided`; the reason fixes the stage | invariant | the five `phase-one/safety-*`, the three `full/safety-*` | pass | `reason-not-written` |
  | `ReasonMatchesMoney`: the stored reason and decider match the money that moved | invariant | the same eight | pass | `default-recorded-decided`, `fee-to-other` |
  | `AuthorizedSteps`: the stored fields are the step that closed the deal | action property | the same eight, and the sixteen `live-*` | pass | `default-recorded-reclaimed` |
  | `FirstDecisionFinal`: neither field changes after the close | action property | the same | pass | none of its own for the two fields |

  | config | distinct states | wall |
  | --- | ---: | ---: |
  | `full/safety-equal`, `-apart` | 169,621 each | 6 s, 5 s |
  | `full/safety-halting` | 1,841,663 | 56 s |
  | `full/live-<actor>`, 8 configs | 326,648 to 405,290 | 138 s to 238 s; 1,417 s together |
  | `phase-one/safety-equal`, `-apart`, `-buyer-apart`, `-seller-apart` | 64,225 each | 3 s to 4 s |
  | `phase-one/safety-halting` | 644,257 | 37 s |
  | `phase-one/live-<actor>`, 8 configs | 105,985 to 149,185 | 11 s to 25 s; 139 s together |

- **The README's contract lines are at `74fa299`** [measured: this session printed each cited line, and the
  reviewer checked about 90 `R:` citations and the 22 `S:` citations of the full-profile table].
- **RF-2 and RF-3 do not touch the model** [inferred from T-375's report that they change no stored field]. They
  can move the lines the README cites; whoever lands them re-reads the `R:` citations, or tells this task.
- **Review** (one `reviewer` subagent, given the contract, the state model and the commit, and not this
  session's conclusions; reading only): ISSUES with no Critical or High finding. It found that the model writes
  the two fields exactly where the contract does and that `ReasonRules` is section 9.2. Fixed: the record (its
  Medium, this section), a wrong `state.ts` line, the reclaim-on-the-escrow sentence of `ReasonMatchesMoney`, a
  stale variable name, and a note on the stored word's other fields. Left for triage: its Low finding that the
  finality and no-early-write conjuncts have no planted fault of their own (Handoff).

## Decisions

1. **A constant gates the profiles; the file is not copied.** `Profile` takes core's two names. Each shared
   action is written once, a search for `P1` lists every difference, and `PhaseOneCuts` states what phase one
   never reaches. A copy would let a fix land in one machine and not the other with nothing to show it. A
   different `Next` per config was set aside because it cannot express a difference inside an action, such as
   funding without a bond.
2. **The phase-one profile follows the contract, not core's `phase_one` profile.** Where they differ in shape the
   model takes the contract's: a default in one call, funding until `offerExpiresAt` (ADR-0031 section 6), and a
   delivery carried by an early accept or by the primary's decision in `Held`. Core keeps two steps for each and
   the EVM adapter maps one onto the other.
3. **The two addresses are accounts, chosen by the constant `Apart`.** Each money address is either the party's
   own signing address or an account apart from every other. The configs check all four choices in phase one.
   The payment address is an actor, because it signs the funding and its own reclaim on the escrow; the payout
   address signs nothing.
4. **The ledger `out` is an observer.** In each step that debits an escrow it adds what that step credited to
   the payment address, the payout address and each fee account, read from the step's own wallet changes. So
   `PaidAsClosed` and `EscrowLedger` check where the money landed, not what an action says it meant to do.
5. **Early accept in `Held` needs both actors at that step.** The model's rule is that a signature is the actor
   taking the step, so a step that carries the seller's signed delivery needs the seller able to act. The
   primary's decision in `Held` is modelled the same way, because the contract takes it by the same lines. A
   message signed earlier and relayed after its signer stopped is listed under "Not modelled".
6. **`broken/late-judge-by.cfg` moved and changed meaning; it is not retired.** It was the record of an open
   issue (L-6) in the deployed contract. The lane's contract refuses those terms at funding
   (`HoldbackRules.sol:198-204`), and core refuses them for SimChain, so no code the model describes reaches the
   trace. It stays as a planted fault, one config per profile (`broken/full/`, `broken/phase-one/`): it removes
   the refusal and shows that `ExpiryAfterCaptures` would catch its loss. Retiring it would leave that property
   with no config that shows it bites.
7. **`PaidAsClosed` was stated in the first pass, over `via`.** The model already recorded how a deal closed. The
   property the task reserved for RF-4, "the reason matches the money that moved", is the same table over the
   contract's stored fields. The second pass added it as `ReasonMatchesMoney` once the contract had the fields.
8. **Reach witnesses run with `check.sh safety`.** CI's two commands are unchanged, and a safety config that
   passes for want of behaviour now fails the same job. One TLC run cannot check several witnesses: with
   `-continue` it prints a trace for every violating state (25.7 million lines for five witnesses) [measured].
9. **The configs moved into `full/`, `phase-one/` and `broken/<profile>/`.** The filter argument then selects a
   profile. `formal/reach.list` is one line per witness in place of one file each.
10. **The model writes `reason` and `decider` in both profiles.** Only the contract stores them; SimChain keeps the
    same fact as `via`. Writing them under `P1` alone would add a gate and check nothing more, and in both
    profiles they add no state. In the full profile "closed" means the escrow is paid out: a first-instance
    decision there can still be appealed, and the decider stays what it was after an overturn. The README says so.
11. **`ReasonMatchesMoney` reads the ledger, not `via`.** A default and a reclaim move the same money, so the ledger
    cannot tell them apart; `AuthorizedSteps` does, by the step that closed the deal.

## Handoff

**Done:** everything in the acceptance list. `formal/check.sh` passes for both profiles, safety and liveness.

**The RF-4 second pass is done** (Evidence, "The second pass"). Nothing of this task waits on another.

**If a later refactor moves lines** (RF-2, RF-3, RF-5, RF-6 or the NatSpec package): re-read the README's `R:`
citations; they are at `74fa299`. None of those changes a stored field, so none should touch the model.

**For the owners of other files** (outside this task's paths):

- `CLAUDE.md` on the lane now says liveness takes tens of minutes; the measured figure is in `formal/README.md`,
  "Run times". Nothing to change there.
- `docs/audit/invariants.md:69-87` names `safety.cfg`, `live-*.cfg` and `broken/<name>.cfg`. The configs are now
  `phase-one/safety-*.cfg`, `phase-one/live-*.cfg` and `broken/phase-one/<name>.cfg` (and the same under `full/`).
  Its table can gain `AuthorizedSteps`, `PaidAsClosed`, `PhaseOneCuts` and the address properties, and its last
  paragraph's "still lists this column as TBD" is no longer true.
- `docs/audit/known-issues.md`, row G-3: the README maps both profiles; a `deliverBy` after the expiry is refused
  at funding and named under "Not modelled"; L-3 and L-5 stay unmodelled and are not in phase one. Row L-6: the
  lane's contract refuses the terms.
- `docs/audit/state-model.md`, sections 9.1 and 9.5, still say phase one refuses a zero price; ADR-0031 section 6
  allows it [the review's reading]. Section 10's table of differences from the formal model describes the model
  before T-337.
- `docs/testing.md:19,130` say "the safety config"; there are several per profile, and the reach witnesses run
  with them.
- `.github/workflows/ci.yml` needs no change. If the formal job proves slow on pull requests, the two
  `safety-halting` configs are the cost.

**Not done, for triage:**

- No planted fault shows that the conjuncts which keep `reason` and `decider` fixed after the close, or unwritten
  before it, would fail alone (the second review's Low finding). Two variants would: one that rewrites `reclaimed`
  to `defaulted` after the close, and one that stores the decider `primary` for a fallback decision whose fee is
  paid correctly.
- `docs/audit/state-model.md`, section 9, still says no contract has the closing reason yet and cites the deployed
  contract's lines in 9.3 [the second review's reading]; it is outside this task's paths.
- The full profile's bond steps follow the deleted vault, not SimChain's bookkeeping (review L-4). It matters
  when bonds return (ADR-0031).
- The model does not record what a settlement's parties signed, so a payout that differs from the signed split
  cannot be expressed (review L-1, item 3).
- A second review by another model family, which the reviewer recommends for the clock abstraction (`Horizon`,
  `TickExpiry`); `docs/team.md` leaves that call to the maintainer.
