# ADR-0018: Panel seed for fallback and appeal decisions

- **Status:** Accepted, 2026-10-30 (D14)
- **Date:** 2026-10-30
- **Raised by:** T-004 Handoff item 1, and an independent research pass (Fable, max effort). It changes T-006, T-009 and T-010, and amends ADR-0016 §4.

## Context

- **The rules disagree with the code.** ADR-0016 §4 and the Decide row in `docs/architecture.md` say every decision's seed must hash to `seedCommitment`. Only the primary signs an `AdjudicatorAcceptance` with a `seedCommitment`. So `packages/core/src/state.ts:282` checks the seed for the primary only. Fallback, escalation and appeal decisions pass with any 32-byte seed (measured).
- **Enforcing the primary's commitment on every role breaks liveness.** The fallback never learns the primary's seed, so a case with a silent primary could only ever default.
- **Leaving the gap open breaks the defense.** The delivery carries the content key for all three adjudicators (measured, `state.ts:248-251`), so a fallback or appeal adjudicator can read the work before it decides. It can then grind seeds:
  - With a registry of 6 entries (3 per family), a panel of 3 has 18 eligible panels, and a panel of 5 has 6 (inferred).
  - Enumerating every panel takes about 60 hashes. 50 random seeds reach any chosen panel with probability 94% (inferred).
  - The real cost is learning each judge's vote: call all 6 judges once, then pick the seed whose panel gives the wanted outcome.
  - This gives full control whenever the judges split, which is exactly the contested case. It is undetectable, because every seed is valid.
- **The appeal role is the sharp edge.** Escalation and party-appeal decisions are final (ADR-0016 §2, residual 7), so a shopped appeal panel has no remedy. A shopped fallback decision can still be appealed.
- Commit-reveal's usual weakness is the last revealer. Here the non-primary roles never commit at all.

## Decision

The fallback and appeal panels take their seed from a public randomness beacon, at a round fixed by events the decider does not control. The primary keeps the commit-reveal accepted in ADR-0016.

1. **Seed derivation.** `panelSeed(role) = keccak256(commitmentId ‖ role ‖ attempt ‖ beaconValue(round))`. The panel is still a seeded shuffle of `panelSeed ‖ commitmentId` over the bound registry, with the family constraints.
2. **Round rules.** Each round is fixed by settlement-layer state. A caller never chooses it.

| Decider | Round |
| --- | --- |
| Primary | none: reveals the preimage of `seedCommitment` (ADR-0016) |
| Fallback | the round at `judgeBy`, a signed term |
| Appeal adjudicator after an escalation | the first round strictly after the settlement layer applied the escalation |
| Appeal adjudicator after a party appeal | the first round strictly after the settlement layer applied `file_appeal` |

   Trigger times and message timestamps never set the round. A caller could otherwise grind over rounds already published.
3. **Phase 1: SimChain beacon.** `value(round) = keccak256(simSeed ‖ round)`, with a period of one simulated second. A round is available only once the sim clock reaches it. It is deterministic from the scenario's `@seed` pragma, so the recorded demo needs no network and no keys.
4. **Phase 2: drand quicknet.**
   - Period 3 s, scheme `bls-unchained-g1-rfc9380`, served by several independent relays (measured).
   - A Decision carries the round and its 48-byte BLS signature. The rules contract verifies it with the BLS12-381 precompiles (EIP-2537).
   - The reference verifier measured about 140k gas but is unaudited (measured), so it needs review before use. EIP-2537 support on the chosen L2 is inferred, not confirmed, and the D4 chain choice must check it.
5. **No substitute source.** If the round cannot be proven by the decider's deadline, the decision is refused and the existing fallback or default path applies. "The beacon is down" never lets anyone choose a seed.
6. **User choice.** The club rulebook gains `randomness: { source: 'sim' | 'drand-quicknet' | 'prevrandao', chainHash? }`. Phase 1 admits `sim` only. `prevrandao` is a club option on L1 only, because a single-sequencer L2 controls every block.
7. **Purity.** Core's `step` stays pure. The `decide` event carries `beacon: { round, value }` as a fact, and `step` recomputes the expected round and seed for the role.

### Not adopted

**Mixing the beacon into the primary's seed** (`keccak(revealedSeed ‖ beacon at delivery)`). It would stop the primary from choosing a favourable panel up front, before the case exists. That residual is bounded by calibration and appeal. The change touches the protocol's "selected by commit-reveal" wording, FR-13 and demo beat 3, so it is a later decision.

## Alternatives considered

- **(a) Primary-only, with the gap recorded.** No work, but fallback panel shopping is undetectable and the final appeal role is unmitigated.
- **(b) Commit a seed at takeover.** Near-zero defense, because the decider already holds the key and the plaintext. It grinds first and commits second. Only a time-locked key would fix that, and that is Phase 3+ scope.
- **(c) All three adjudicators commit before funding.** Strong against late choice, but funding waits on two more signatures, adding two liveness points before money is held. ADR-0016 rejected three acceptances for cost.
- **(e) VRF keyed to each adjudicator** (RFC 9381). It stops grinding over seeds, but the prover can predict its own output, so a colluding seller can vary the commitment until it suits. On-chain verification costs 150k to 1.6M gas, with experimental libraries (measured).

## Consequences

- **ADR-0016 §4** now reads "its seed is the valid panel seed for the decider's role" (this ADR).
- **Schema v0.5:**
  - The `Decision.seed` description is per role, and an optional `beacon { source, round, value, signature }` is added, required when the source is not `sim`.
  - The judgment record's `panel` gains `seedSource` and `beaconRound`, and `seedCommitment` becomes optional.
  - The club rulebook gains `randomness`.
- **`packages/core/src/state.ts`:**
  - The `decide` event gains `beacon: { round, value } | null`, and the helpers `beaconRoundFor(state, role)` and `panelSeed(id, role, attempt, value)` are added.
  - Line 282 checks per role, and so do the escalation and appeal decision paths.
  - `AppealState.open` gains `openedAt`, the time the settlement layer applied it.
  - Tests add fallback and appeal `seed_mismatch` rows, plus a property that the derived seed ignores every field the decider controls.
- **T-006:** the SimChain beacon, and the per-role seed check on decisions.
- **T-009:** the panel shuffle takes the role's seed. The adjudicator service gets a `RandomnessSource` interface (`sim` now, `drand` later).
- **New fixtures:**
  - `error.seed-mismatch`: a wrong primary preimage, a fallback-chosen seed, an appeal-chosen seed;
  - `attack.fallback-panel-shopping` and `attack.appeal-panel-shopping-after-escalation`;
  - `attack.timing-grind`: the decider picks the send time, and the panel is unchanged;
  - `neutrality.adjudicator-silent-before-judging`: the snapshot shows "seed source: beacon round N";
  - Phase 2: `neutrality.beacon-relay-refuses` and `todo.beacon-unavailable-whole-window`.

## Litmus tests

- **Neutrality.**
  - The beacon network becomes an actor in the control-point table. It can stop publishing, but it cannot bias a round (threshold signature) or target a case.
  - Published rounds are permanent and served by several relays. An unprovable round leads to the existing fallback or default, never to a chosen seed.
  - A silent primary still leads to a fallback decision.
  - Residual 10 records whole-window unavailability. Passes.
- **The hold.** Unchanged. Passes.
- **Defended judgment.**
  - It closes threat T21: late panel selection by the fallback or appeal adjudicator.
  - No adjudicator or party knows a non-primary panel before its round.
  - Passes, and strengthens it.
