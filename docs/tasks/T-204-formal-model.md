# T-204: Formal model of the commitment state machine

- **Lane:** test
- **Phase:** 2
- **Depends on:** Phase 1 done. Independent of T-201 and T-202: it models the protocol rules in `packages/core/src/state.ts`, so it can start now. T-206 checks that the contract matches it.
- **Paths this task may touch:** `formal/` (new: the model, its configs, `formal/check.sh`, `formal/README.md`), `docs/tasks/T-204-formal-model.md`. CI wiring is T-203's (`formal` job runs `formal/check.sh` when present).
- **Human gate:** none.
- **Status:** done (PR 66)
- **Agent/session:** implementer, branch `t-204-formal-model` (2026-11-01)

## Intent

Write a model of the commitment state machine (from Offered, through delivery, judgment, fallback, escalation and appeal, to a terminal state, using the state names in `state.ts`) and machine-check the two properties `docs/neutrality.md` promises: liveness, meaning every funded commitment reaches a terminal state when anyone may trigger timeouts, even if any single named actor halts; and safety, meaning no transition moves funds without a valid signature, decision or expired timeout, and funds move at most once. The model is a spec the contract and SimChain are checked against, not code.

**Restated (implementer, 2026-11-01).** Write a small, machine-checked model of the `state.ts` state machine in `guaranteed_on_decision` mode. It covers every escrow state, every appeal state and every event kind. Every actor and every account where money can sit is explicit, so a model checker can show three things:

1. **Safety.** Units are conserved. Each escrow pays out at most once. Every debit is backed by the right signer, the decision of the adjudicator whose turn it is, or a deadline that has really passed. The buyer's key moves in the same step as the payment.
2. **Liveness.** A funded commitment always reaches a paid-out end state, with its appeal window closed, even when any one named actor stops for good. The only assumptions are that someone eventually triggers the permissionless timeouts and that time passes.
3. **The checks bite.** For each property, a deliberately broken variant produces a counterexample, and `formal/check.sh` asserts that it does.

The model is a reference spec for T-202's contract and T-206's review. Where it disagrees with `state.ts` or the docs, I record a finding and change no code.

Non-goals:
- Phase 4 economics (coverage gate, backers, compensation size), `settle_after_window` and its `settle` timeout.
- Cryptography, scopes, mandates and rulebook guards.
- Any change to `packages/` or `contracts/`, and CI wiring (T-203).
- Proving the Solidity code.

## Context

- `docs/neutrality.md` ("How neutrality is tested", the control-point table, residuals); `docs/architecture.md` (states, transitions, postings); `packages/core/src/state.ts` (the reference transition function) and `packages/settlement/src/interface.ts` (`TimeoutKind`).
- ADR-0007 and D5 (default outcome), ADR-0016 and ADR-0018 (who may decide in which role), ADR-0019 (mutual settlement), D27 and D28 (appeal default clauses), D20 (finality per mode).
- `docs/testing.md` (Formal model row: model check on any PR touching the state machine).

## Acceptance criteria

- [x] Tool chosen (TLA+ with TLC or Apalache, or Quint) and the choice recorded in Decisions with its reason. Inferred: TLC checks liveness under fairness directly; Quint's simulator alone does not prove liveness, so a Quint model needs Apalache or a TLA+ export for that property.
- [x] Actors modelled: buyer, seller, primary, fallback and appeal adjudicators, an operator, the beacon, and an "anyone" trigger. Money modelled as abstract units in buyer, seller, escrow, adjudicator and bond accounts.
- [x] Safety invariants checked with no violation within a stated bound (at least two commitments, all deadlines, every message kind): conservation; settle-once; every fund movement follows a valid signature, decision or expired timeout; a decided commitment's money and key move in the same step in `guaranteed_on_decision` (ADR-0012).
- [x] Liveness checked once per configuration in which exactly one named actor halts (each adjudicator role, each party, the operator, the beacon), with weak fairness only on the "anyone" trigger: every funded commitment reaches a terminal state.
- [x] Each property bites: a deliberately broken variant (for example a timeout callable by the buyer only, or a second capture allowed) yields a counterexample. Configs for these live under `formal/broken/` and `formal/check.sh` asserts they fail.
- [x] `formal/check.sh` exits 0 locally and prints states explored and wall time per config (measured); `formal/README.md` maps each model action to the `state.ts` transition and the contract function it stands for (the latter filled once T-202 lands, or left as a Handoff item).
- [x] Any disagreement found between the model and `state.ts` is written in Handoff as a finding, not fixed here. PR opened.

## Out of scope

- Phase 4 economics (coverage gate, backers, default compensation amounts): model the transitions, abstract the amounts.
- Changing `packages/core` or the contracts; CI edits (T-203).
- Proving the Solidity code itself (no SMTChecker or Certora requirement here; may be suggested in Handoff for T-206).

## Evidence

- **Measured.** `formal/check.sh` exits 0 on this machine (Apple arm64, 8 workers, Temurin 21.0.13, TLC 2.19 / tla2tools v1.7.4). Full run: 10 min 39 s. Each config is bounded to two commitments (`C = {c1, c2}`) with shared parties, adjudicators and accounts. TLC searches every deadline ordering (each deadline crossing is its own step) and every message kind.

  | config | result | distinct states | depth | wall |
  | --- | --- | ---: | ---: | ---: |
  | safety (no halt; 6 invariants + 2 action properties) | pass | 195,839 | 31 | 7 s |
  | live-appeal | pass | 432,266 | 32 | 84 s |
  | live-beacon | pass | 430,376 | 32 | 73 s |
  | live-buyer | pass | 439,918 | 32 | 70 s |
  | live-fallback | pass | 487,076 | 32 | 79 s |
  | live-operator | pass | 488,966 | 32 | 147 s |
  | live-primary | pass | 480,776 | 32 | 80 s |
  | live-seller | pass | 442,438 | 32 | 89 s |
  | broken/buyer-only-timeout | counterexample (`Temporal properties were violated`) | 71,381 | – | 5 s |
  | broken/early-reclaim | counterexample (`Action property AuthorizedMoves is violated`) | 357 | 10 | 1 s |
  | broken/key-separate | counterexample (`Action property AtomicKey is violated`) | 44 | 8 | 1 s |
  | broken/mint | counterexample (`Invariant Conservation is violated`) | 618 | 11 | 0 s |
  | broken/operator-authors | counterexample (`Action property AuthorizedMoves is violated`) | 56 | 8 | 1 s |
  | broken/second-capture | counterexample (`Invariant SettleOnce is violated`) | 150 | 9 | 1 s |

  The distinct-state counts for the broken configs vary between runs, because the first violation found depends on worker scheduling. A rerun gave 23,099 / 449 / 64 / 1,714 / 108 / 102.
- **Measured.** The `buyer-only-timeout` counterexample: c1 reaches Delivered, the buyer crashes, judgeBy passes, and the run stutters forever in Delivered because only the buyer could call `trigger_fallback`.
- **Measured.** Before `Holdback.tla` existed, `formal/check.sh` failed all 14 configs (commit 88761cc, test first).
- **Measured.** `pnpm verify`: typecheck, lint, spec, snap and demo pass; test fails. The first run had one timeout in `packages/testkit/src/runner.test.ts` ("tamper", 5 s limit, while the machine was loaded). That file passes alone (52/52). The second run fails `tests/design-map.test.ts` ("marks exactly one phase as next or active"): this task's Status `review` makes Phase 2 active while T-010 (Phase 1) is still `in progress`, so two phases are active. See Handoff. This branch changes no code under `packages/`, `apps/`, `tests/` or `scripts/`. Report: `reports/verify-t-204-formal-model.md`.
- **Inferred.** Every named actor's actions carry no fairness, so each liveness config also covers that actor, or any other, stopping at any moment. The `Halted` constant adds the case where the actor is certain to stop (a fair `Crash` step at a nondeterministic point).
- **Inferred.** The model is not vacuous. Each broken variant reaches the flow it breaks: funding and Held (early-reclaim), an accept decision (key-separate), the default outcome (mint), a settled escrow (second-capture), Delivered (operator-authors), and Delivered after judgeBy (buyer-only-timeout).

## Decisions

- **Tool: TLA+ with TLC (tla2tools v1.7.4, the latest non-prerelease).** TLC checks liveness under weak fairness exhaustively and checks action properties (`[][A]_v`) directly. Quint's simulator does not prove liveness, and Apalache's liveness support is bounded and heavier to set up. TLC needs a JVM and none was installed. `check.sh` uses `java` from `JAVA_HOME` or `PATH` when one works, and otherwise downloads a pinned Eclipse Temurin 21.0.13+9 JRE from the official `adoptium/temurin21-binaries` GitHub release into `formal/.tools/` (gitignored). The jar comes from the official `tlaplus/tlaplus` release. Both downloads are sha256-pinned. No system setting is changed. On CI (T-203), `ubuntu-latest` already has Java, so only the jar is fetched.
- **Fairness: on the "anyone" triggers, plus the clock and `Crash`.** The clock needs fairness, because a model in which time stops proves nothing. `Crash` needs it so that "the actor halts" actually happens. Neither is an actor that could choose to stop. No party, adjudicator, operator or beacon has fairness.
- **Time abstraction.** `timing.ts` requires offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy, so a per-commitment counter is exact. Relative deadlines (appealBy and appealDecideBy, the escalation's appealDecideBy) start at the step that sets them. Per-commitment ticks cover every interleaving of deadline crossings across commitments. The clock stops at the last deadline the current state can use, which removes no behaviour.
- **Halting semantics.** The halted actor may act until a weakly fair `Crash` step at a nondeterministic point, and never acts after it. This avoids a vacuous `live-seller`, which would happen if the seller were halted from the start, since nothing would ever be offered.
- **Liveness target.** The model checks `Held ~>` Released, Refunded or Settled (`FundedSettles`), the same with the appeal state closed (`FundedFinal`), and `Offered ~>` an end (`OfferEnds`). This is stronger than "reaches Released, Refunded or Defaulted" in `docs/neutrality.md`, because Defaulted is not terminal in `state.ts` (finding 1).
- **Signatures in the model.** A signature is the named actor taking the step. `AuthorizedMoves` judges each debit against the pre-state and the step's recorded signers, independently of the action guards, so a wrong guard shows up as a violation rather than being trusted.
- **Amounts.** Price 2, fee 1, appeal bond 1, appeal fee 1, compensation 1 per liable bond. Each adjudicator's bond starts at 2 × price (the worst case over both commitments), standing in for the coverage gate (Phase 4).
- Not recorded in `docs/decisions-today.md`: that file is outside this task's paths. The tool choice is local to `formal/`.

## Handoff

**Done.**
- `formal/Holdback.tla` (the model), `formal/safety.cfg`, seven `formal/live-*.cfg` (one per named actor), six `formal/broken/*.cfg`, `formal/check.sh` and `formal/README.md` (actions mapped to `state.ts` transitions).
- Every acceptance criterion is met except the contract-function column of the README map, which stays TBD until T-202 lands.
- No counterexample was found against the model of `state.ts`.

**For T-203 (CI).** The `formal` job can run `formal/check.sh` as is: it fetches tla2tools.jar, and a JRE only when no `java` is present. Expect about 11 minutes on 8 cores, almost all of it the seven liveness configs. If that is too slow, `formal/check.sh safety` plus `broken/` takes under 20 seconds and could run on every PR, with the liveness configs running nightly or only when `packages/core/src/state.ts` or `formal/` changes. A possible speedup is to drop the `act` history variable from the liveness configs, since only `AuthorizedMoves` reads it.

**Blocker outside this lane: `tests/design-map.test.ts`.** The test asserts that exactly one phase is "next or active". With T-010 (Phase 1) still `in progress`, any Phase 2 task set to `in progress` or `review` makes two phases active, and `pnpm test` fails. This PR hits it, and T-201 to T-207 will too. Fix one of these in the design-map lane, not here: allow more than one active phase, or close or re-phase T-010. Proposed Rules-and-checks row for `docs/team.md`: "the design-map test must pass when tasks of two consecutive phases are active".

**For T-202 and T-206.**
- Fill in the contract-function column of `formal/README.md`.
- T-206 can check the contract against `AuthorizedMoves`, `AtomicKey` and `SettleOnce` as written, and could add SMTChecker or Certora rules mirroring them. That is optional and out of scope here.
- `OperatorEarlyAccept` and `ReleaseKeyLate` exist only in the broken variants. The contract must have no equivalent.

**Findings (model vs `state.ts` and the docs; nothing fixed here).**
1. **`docs/neutrality.md` names the wrong terminal states.** It says liveness means reaching "Released, Refunded or Defaulted". In `state.ts`, Defaulted is not terminal: `apply_default_outcome` (anyone) still has to move the money to Refunded. Settled (mutual settlement) and Expired are also end states. Suggest rewording it to "Released, Refunded or Settled, with the appeal state closed", which is what the model checks.
2. **Defaulting takes two permissionless steps** (`trigger_default`, then `apply_default_outcome`). Liveness holds because both are anyone-triggered, but T-202 could merge them into one call to save a transaction (D4 gas). The model would then merge `TriggerDefault` and `ApplyDefault`.
3. **A beacon outage moves liability onto adjudicators who did nothing wrong.** With the beacon down, the fallback and appeal adjudicators cannot decide (ADR-0018: no fact, no decision). The commitment still ends, but by default (`live-beacon` passes), and the default outcome charges the primary and fallback bonds (or the appeal adjudicator's bond after an escalation) for a deadline the fallback or appeal adjudicator could not meet. This is an economic fairness question, not a safety or liveness bug. Suggest a backlog item: exempt a bond from default compensation when no beacon fact for its round exists.
4. **Bond coverage for the fallback and appeal adjudicators is assumed in the model, not enforced in Phase 1.** `state.ts` checks only the primary's unencumbered bond, at acceptance. SimChain reserves the fallback's bond only at takeover, up to what is free (`reserveUpTo`, backlog F5), and caps payouts at the reservation. The model gives every bond enough to cover the worst case, so `NonNegative` holds by sizing; in SimChain, a shortfall pays less instead. That is known (F5), and it becomes the Phase 4 coverage gate.
5. **`TimeoutKind` includes `settle`, but `state.ts` has no matching event.** That is expected: `settle_after_window` is Phase 4. The model leaves it out, and a Phase 4 model needs a `Decided` state.
6. **Early acceptance has no deadline in `state.ts`.** It works in Delivered until someone triggers the fallback, even after judgeBy. The model follows `state.ts`, and liveness and safety hold either way. This note is only so T-202 does not add a judgeBy guard without deciding to.
