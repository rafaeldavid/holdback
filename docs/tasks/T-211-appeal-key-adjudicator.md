# T-211: The reference adjudicator never seals the key for a refunded buyer, and declines sham takeovers

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** —
- **Paths this task may touch:** `apps/adjudicator/src/service.ts`, `apps/adjudicator/src/service.test.ts`, `docs/tasks/T-211-appeal-key-adjudicator.md`. Added at pickup, all in `apps/adjudicator/`: `src/settlement-port.ts`, `src/simchain-adapter.ts`, `src/simchain-adapter.test.ts`, `src/_sim.ts` (the free-bond read and the takeover's commitment) and `scripts/mutants.mjs` (its key mutant matched the changed line).
- **Human gate:** no
- **Status:** review
- **Agent/session:** Claude Opus 5.5, session started by the T-206 coordinating session (2026-11-04)

## Intent

Review finding H-2 (`docs/reviews/2026-11-03-contract-review.md`): `apps/adjudicator/src/service.ts:392` wraps the content key for the buyer on every accept, including an appeal that overturns a rejection. The buyer was already refunded, so the signed decision hands it the work for free. The decision's calldata and the operators carry that key whether or not settlement releases it, so the settlement refusals (contract PR #125, SimChain in T-210) keep the record honest but cannot stop the leak. Only the adjudicator can.

Never attach `keyForBuyer` to an appeal whose first outcome was reject. Write it as `task.firstOutcome !== 'reject'`: after an escalation `firstOutcome` is undefined, and the escalation accept must keep its key, because settlement refuses an accept without one. First-instance accepts keep the key as today.

Prerequisite for appeals on the Sepolia demo (the contract refuses the key-carrying overturn, PR #125) and for the overturn payout, which the contract makes since D43 (T-212 item 9).

**Second item, from T-206 M-3 (PR #135).** In the contract, a fallback reserves its bond by deciding, and a decider's bond stays reserved until its appeal window closes. The service triggers every takeover that is due and decides every task (`service.ts:155-170`), and `#preflight` never reads the deal's windows or fee. So a sham deal that names Crow's fallback, with an `appealWindowSec` a century long, would still lock Crow's bond once the service decided it.
- Decline fallback and appeal tasks whose `appealWindowSec`, `appealDecideSec` or fee fall outside the adjudicator's own published policy (D29: adjudicators may decline clauses they won't run).
- Check `freeOf` before signing.

**Third item, from the T-206 cross-family pass (review §8, L-1).** The adjudicator verifies the seller's signature on the exact delivery it judges. *Confirmed at pickup:* PR #161 (T-212 item 3, ADR-0029) already does this in `#preflight` for every role, before any judge is called, and names that delivery's hash in the decision and the record. T-211 adds a test that the fallback and appeal roles refuse a body the seller did not sign, and changes nothing else there.

### Restated at pickup (2026-11-04)

The adjudicator is the only party that can keep a key away from a refunded buyer, because a key it signs travels in the decision whether or not settlement accepts it. So the service never wraps the buyer's key into a decision unless that decision pays the seller from the hold: a first-instance accept, or the accept after an escalation. On a party appeal it wraps the key only when the first outcome was an accept (an upheld accept, or the missing-or-wrong-key ground). An overturned reject pays the seller from the first decider's bond and gives the buyer nothing.

A fallback or appeal adjudicator signed nothing when the deal was agreed, so its decision is its consent, and the reference service should consent only to deals it would have accepted as primary. Before it triggers a takeover, and again before every decision attempt (a retry included), it checks:
- that both appeal windows are within its limits, since its bond stays reserved that long after it decides;
- that the fee is at least its quote, in the same token;
- that its free bond, plus whatever the deal already holds reserved on it, covers the price.

It applies the same window and fee limits when it accepts an offer as primary, so a deal it accepts is one its fallback and appeal peers will decide, and a party sees the decline at offer time.

**Non-goals.** Settlement refusals (T-210, PR #125). Publishing the limits in the registration (a schema change, proposed for T-033 in Handoff). Bounding how long a primary's acceptance holds its bond before it decides (`fundBy` to `fallbackBy` set far out, D31): a separate follow-up. The appeal adjudicator's bond on chain (T-212 item 5).

## Acceptance criteria

- [x] A test: a party appeal over a rejection that the panel overturns signs an accept with no `keyForBuyer`; a party appeal over an accept (the missing-or-wrong-key ground) still carries it; first-instance and escalation accepts still carry it; a reject never carries it.
- [x] A test: a fallback or appeal task whose windows or fee fall outside the adjudicator's policy is declined, and so is one the adjudicator lacks free bond for. A task inside the policy is still decided.
- [x] `pnpm verify` green.

## Out of scope

- Settlement changes (T-210, PR #125).

## Evidence

**`pnpm verify`: PASS** (`reports/verify-t-211-appeal-key-adjudicator.md`, base `21f0642` plus this change, 2026-11-04) [measured]:

| Step | Command | Status | Time |
| --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | pass | 257 ms |
| lint | `pnpm lint` | pass | 4830 ms |
| forge build | `forge build --root contracts` | pass | 168022 ms |
| forge | `forge test --root contracts` | pass | 18208 ms |
| test | `pnpm test` | pass | 57832 ms |
| spec | `pnpm validate:spec` | pass | 606 ms |
| snap | `pnpm snap` | pass | 9685 ms |
| snap:local | `pnpm snap --settlement=local` | pass | 15109 ms |
| demo | `pnpm demo` | pass | 5238 ms |

- Counts [measured]: forge 241 passed; vitest 2,351 passed and 3 skipped in 105 files; snap 29 passed; snap:local 26 passed, 3 excluded until Phase 4 as before. No snapshot diffs against HEAD. The fixtures run on testkit's own judgment, and no demo beat appeals a reject or sets a window over a week [inferred from the zero diff and `apps/demo/agents/beats.ts`].
- **Test first** [measured]: with only `DEFAULT_APPEAL_LIMITS` exported and no behavior changed, 19 of the new and changed tests in `service.test.ts` failed and 52 passed. The failures were the two overturned-reject key cases, the updated missing-or-wrong-key test, every terms and bond decline, and the acceptance window checks. The key-carrying cases and the decisions at the limits passed on both versions. After the change: `apps/adjudicator` 110 passed in 6 files.
- **Mutation sweep** (`node apps/adjudicator/scripts/mutants.mjs`) [measured]: all 12 T-211 mutants killed. They cover the overturned-reject key, the escalation accept's key, the windows, the fee and fee token, the free bond, the fallback and appeal turn check, the trigger skip, the acceptance check, SimChain's takeover reservation, `freeOf`, and the contract path's primary and first-decider reservations. The full sweep before the contract-path fix: 45 mutants, 42 killed. The 3 others predate T-211 (Handoff 4).
- **Seller signature (third item)** [measured]: a fallback and an appeal task carrying a delivery signed by another key are refused `invalid_signature` before any judge call (new tests). The primary's case was already covered by PR #161's tests. The DeepSeek pass on PR #161 found both adjudicator checks sound (PR #166's review note). Its caveat, that each demo adjudicator's EIP-712 domain must name the deployed rules contract, is a redeploy check in T-212's Handoff.

## Decisions

Implementation choices inside the task's design; recorded here, not as D-entries. Rafa or the coordinating session may overrule any of them.

1. **The key rule is one condition at signing** (`#sign`): `outcome === 'accept' && task.firstOutcome !== 'reject'`, as the task says. The overturned reject is still judged by the panel and recorded, and the decision still pays the seller from the first decider's bond; only the key is left out. The missing-or-wrong-key ground after a reject gets no shortcut: the panel judges it, and an overturn carries no key either.
2. **The limits are service configuration, not the hashed policy.** `AdjudicatorConfig.appealLimits` defaults to `DEFAULT_APPEAL_LIMITS`, a week for `appealWindowSec` and a week for `appealDecideSec`. So a decision holds this service's bond at most two weeks. Every demo deal uses 60 to 300 s. Putting the limits in `AdjudicatorPolicy` would change `policyHash` for every deal; publishing them in the registration is a schema change (Handoff). D31 is unaffected: the protocol and API still take any window, and this adjudicator declines what it won't run (D29).
3. **The same window and fee check runs at acceptance as primary.** A primary's bond also stays reserved until its decision's appeal closes. Without the check, the service could accept a deal that its own fallback and appeal peers would then decline, and the party would see no reason. With it, the decline shows at offer time, in the `declined` reason the demo world shows (`world.ts:435`).
4. **Cover means free bond plus what the deal already holds on this adjudicator** (`bondCover`, in the adapter, because the reservation rules differ by chain).
   - SimChain: the pool's free bond plus the deal's own reservations on it, from acceptance, takeover and escalation. SimChain still reserves at takeover (T-210 item 3), and a plain free-bond read would count that reservation against the fallback.
   - The contract: `freeOf`, plus the price while the deal still holds this adjudicator's bond under ADR-0016 §1. That is as primary in `Delivered` and `FallbackJudging`, and as the first decider while its appeal is open. A fallback's decision releases the primary's reservation before it encumbers its own, so a lone service that is its own fallback would otherwise need twice the price.
5. **Cover is checked for the appeal role too.** On chain today an appeal decision encumbers nothing for the appeal adjudicator (L-5, T-212 item 5). The check is this service's own rule: it decides an appeal only when it could back it with the price, which is ready for T-212 item 5. On SimChain, an under-covered appeal adjudicator that declines is treated as silent, and the default compensation draws on its partial reservation.
6. **It does not trigger a takeover it would decline.** The check before `triggerFallback` uses the same terms and cover. Triggering stays permissionless: anyone can trigger, and the deal then defaults at `fallbackBy`. The skip is reported in `RunReport.refused`, not in `declined`, because the demo world reads `declined` as offers the primary declined.
7. **The fee rule is the same for every role:** `adjudication.fee` at least this service's quote, in the same token. On a party appeal the appeal adjudicator is paid from the appeal fee (SimChain), not `adjudication.fee`. The service still requires the deal's fee as its price for running the deal at all.
8. **Checked on every attempt, before signing.** The check sits at the top of `#preflight`, which runs on each `decideTask` call, so a retry after the panel ran checks the bond again and signs nothing until the bond is back. The judged record is kept, so there is no re-roll.

## Handoff

Branch `t-211-appeal-key-adjudicator`. Every change is in `apps/adjudicator/` and this file; nothing in `packages/` (T-210 owns `packages/core`, `packages/settlement/sim` and `packages/testkit`).

**Deploy (Rafa's gate).** The demo's three adjudicators run inside the demo Worker (`apps/demo-cloud/src/world.ts`), so the Sepolia demo picks this up only at its next Worker deploy. Until then the deployed adjudicator still wraps a key into an overturned reject, and the contract refuses that decision (PR #125), so the appeal expires and the first decision stands. Check before the deploy: no open demo deal has appeal windows over a week (every demo window is 60 to 300 s).

**Follow-ups, none blocking:**
1. **Publish the limits.** T-033 moves the MIME allowlist into an adjudicator capability block (review C8). `appealLimits` belongs beside it in `adjudicator.schema.json`, and in `site/llms.txt` ("the demo adjudicators decide deals whose appeal windows are each at most a week"). Until then a party learns the limit only from the decline reason at offer time.
2. **The primary's horizon before it decides.** The service accepts any `fundBy` to `fallbackBy` (D31), and its acceptance holds its bond until the deal moves on or times out. A deal that stalls with far-out deadlines therefore holds the bond that long. A horizon limit at acceptance would bound it. This is the primary's version of M-3, not the takeover path, so it is left for its own task.
3. **T-212 item 5 (bond the appeal adjudicator).** When the contract encumbers the appeal adjudicator, update the contract branch of `SettlementAdapter.bondCover` (which deal state holds whose bond) to match, with its test table.
4. **The mutation sweep's older gaps, untouched here.** `appeal panel uses the first-instance family minimum` survives. Two mutants no longer apply: the inconclusive-party-appeal rule moved to `@holdback/judgment`'s `signedOutcome`, and `primary given no released envelope`. T-211 changed neither the code nor the commitments those tests use, so the same panels are drawn [inferred].
