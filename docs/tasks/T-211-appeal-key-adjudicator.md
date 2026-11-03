# T-211: The reference adjudicator never seals the key for a refunded buyer

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** —
- **Paths this task may touch:** `apps/adjudicator/src/service.ts`, `apps/adjudicator/src/service.test.ts`, `docs/tasks/T-211-appeal-key-adjudicator.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Review finding H-2 (`docs/reviews/2026-11-03-contract-review.md`): `apps/adjudicator/src/service.ts:392` wraps the content key for the buyer on every accept, including an appeal that overturns a rejection. The buyer was already refunded, so the signed decision hands it the work for free. The decision's calldata and the operators carry that key whether or not settlement releases it, so the settlement refusals (contract PR #125, SimChain in T-210) keep the record honest but cannot stop the leak. Only the adjudicator can.

Never attach `keyForBuyer` to an appeal whose first outcome was reject. Write it as `task.firstOutcome !== 'reject'`: after an escalation `firstOutcome` is undefined, and the escalation accept must keep its key, because settlement refuses an accept without one. First-instance accepts keep the key as today.

Prerequisite for appeals on the Sepolia demo (the contract refuses the key-carrying overturn, PR #125) and for Phase 4's overturn payout.

## Acceptance criteria

- [ ] A test: a party appeal over a rejection that the panel overturns signs an accept with no `keyForBuyer`; a party appeal over an accept (the missing-or-wrong-key ground) still carries it; first-instance and escalation accepts still carry it; a reject never carries it.
- [ ] `pnpm verify` green.

## Out of scope

- Settlement changes (T-210, PR #125).

## Evidence

## Decisions

## Handoff
