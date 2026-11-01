# T-204: Formal model of the commitment state machine

- **Lane:** test
- **Phase:** 2
- **Depends on:** Phase 1 done. Independent of T-201 and T-202: it models the protocol rules in `packages/core/src/state.ts`, so it can start now. T-206 checks that the contract matches it.
- **Paths this task may touch:** `formal/` (new: the model, its configs, `formal/check.sh`, `formal/README.md`), `docs/tasks/T-204-formal-model.md`. CI wiring is T-203's (`formal` job runs `formal/check.sh` when present).
- **Human gate:** none.
- **Status:** todo
- **Agent/session:** —

## Intent

Write a model of the commitment state machine (from Offered, through delivery, judgment, fallback, escalation and appeal, to a terminal state, using the state names in `state.ts`) and machine-check the two properties `docs/neutrality.md` promises: liveness, meaning every funded commitment reaches a terminal state when anyone may trigger timeouts, even if any single named actor halts; and safety, meaning no transition moves funds without a valid signature, decision or expired timeout, and funds move at most once. The model is a spec the contract and SimChain are checked against, not code.

Restate this in your own words in this section before writing code.

## Context

- `docs/neutrality.md` ("How neutrality is tested", the control-point table, residuals); `docs/architecture.md` (states, transitions, postings); `packages/core/src/state.ts` (the reference transition function) and `packages/settlement/src/interface.ts` (`TimeoutKind`).
- ADR-0007 and D5 (default outcome), ADR-0016 and ADR-0018 (who may decide in which role), ADR-0019 (mutual settlement), D27 and D28 (appeal default clauses), D20 (finality per mode).
- `docs/testing.md` (Formal model row: model check on any PR touching the state machine).

## Acceptance criteria

- [ ] Tool chosen (TLA+ with TLC or Apalache, or Quint) and the choice recorded in Decisions with its reason. Inferred: TLC checks liveness under fairness directly; Quint's simulator alone does not prove liveness, so a Quint model needs Apalache or a TLA+ export for that property.
- [ ] Actors modelled: buyer, seller, primary, fallback and appeal adjudicators, an operator, the beacon, and an "anyone" trigger. Money modelled as abstract units in buyer, seller, escrow, adjudicator and bond accounts.
- [ ] Safety invariants checked with no violation within a stated bound (at least two commitments, all deadlines, every message kind): conservation; settle-once; every fund movement follows a valid signature, decision or expired timeout; a decided commitment's money and key move in the same step in `guaranteed_on_decision` (ADR-0012).
- [ ] Liveness checked once per configuration in which exactly one named actor halts (each adjudicator role, each party, the operator, the beacon), with weak fairness only on the "anyone" trigger: every funded commitment reaches a terminal state.
- [ ] Each property bites: a deliberately broken variant (for example a timeout callable by the buyer only, or a second capture allowed) yields a counterexample. Configs for these live under `formal/broken/` and `formal/check.sh` asserts they fail.
- [ ] `formal/check.sh` exits 0 locally and prints states explored and wall time per config (measured); `formal/README.md` maps each model action to the `state.ts` transition and the contract function it stands for (the latter filled once T-202 lands, or left as a Handoff item).
- [ ] Any disagreement found between the model and `state.ts` is written in Handoff as a finding, not fixed here. PR opened.

## Out of scope

- Phase 4 economics (coverage gate, backers, default compensation amounts): model the transitions, abstract the amounts.
- Changing `packages/core` or the contracts; CI edits (T-203).
- Proving the Solidity code itself (no SMTChecker or Certora requirement here; may be suggested in Handoff for T-206).

## Evidence

## Decisions

## Handoff
