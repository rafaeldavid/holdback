# T-211: The reference adjudicator never seals the key for a refunded buyer, and declines sham takeovers

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

Prerequisite for appeals on the Sepolia demo (the contract refuses the key-carrying overturn, PR #125) and for the overturn payout, which the contract makes since D43 (T-212 item 9).

**Second item, from T-206 M-3 (PR #135).** In the contract, a fallback reserves its bond by deciding, and a decider's bond stays reserved until its appeal window closes. The service triggers every takeover that is due and decides every task (`service.ts:155-170`), and `#preflight` never reads the deal's windows or fee. So a sham deal that names Crow's fallback, with an `appealWindowSec` a century long, would still lock Crow's bond once the service decided it.
- Decline fallback and appeal tasks whose `appealWindowSec`, `appealDecideSec` or fee fall outside the adjudicator's own published policy (D29: adjudicators may decline clauses they won't run).
- Check `freeOf` before signing.

## Acceptance criteria

- [ ] A test: a party appeal over a rejection that the panel overturns signs an accept with no `keyForBuyer`; a party appeal over an accept (the missing-or-wrong-key ground) still carries it; first-instance and escalation accepts still carry it; a reject never carries it.
- [ ] A test: a fallback or appeal task whose windows or fee fall outside the adjudicator's policy is declined, and so is one the adjudicator lacks free bond for. A task inside the policy is still decided.
- [ ] `pnpm verify` green.

## Out of scope

- Settlement changes (T-210, PR #125).

## Evidence

## Decisions

## Handoff
