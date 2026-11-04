# T-211: The reference adjudicator never seals the key for a refunded buyer, and declines sham takeovers

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** —
- **Paths this task may touch:** `apps/adjudicator/src/service.ts`, `apps/adjudicator/src/service.test.ts`, `docs/tasks/T-211-appeal-key-adjudicator.md`. Added at pickup, all in `apps/adjudicator/`: `src/settlement-port.ts`, `src/simchain-adapter.ts`, `src/simchain-adapter.test.ts` and `src/_sim.ts` (the free-bond read, the appeal expiry and the takeover's commitment), and `scripts/mutants.mjs` (its key mutant matched the changed line).
- **Human gate:** no
- **Status:** review
- **Agent/session:** Claude Opus 5.5, a session the T-206 coordinating session started on 2026-11-04 (PR #175)

## Intent

Review finding H-2 (`docs/reviews/2026-11-03-contract-review.md`): `apps/adjudicator/src/service.ts:392` wraps the content key for the buyer on every accept, including an appeal that overturns a rejection. The buyer was already refunded, so the signed decision hands it the work for free. The decision's calldata and the operators carry that key whether or not settlement releases it, so the settlement refusals (contract PR #125, SimChain in T-210) keep the record honest but cannot stop the leak. Only the adjudicator can.

Never attach `keyForBuyer` to an appeal whose first outcome was reject. Write it as `task.firstOutcome !== 'reject'`: after an escalation `firstOutcome` is undefined, and the escalation accept must keep its key, because settlement refuses an accept without one. First-instance accepts keep the key as today.

Prerequisite for appeals on the Sepolia demo (the contract refuses the key-carrying overturn, PR #125) and for the overturn payout, which the contract makes since D43 (T-212 item 9).

**Second item, from T-206 M-3 (PR #135).** In the contract, a fallback reserves its bond by deciding, and a decider's bond stays reserved until its appeal window closes. The service triggers every takeover that is due and decides every task (`service.ts:155-170`), and `#preflight` never reads the deal's windows or fee. So a sham deal that names Crow's fallback, with an `appealWindowSec` a century long, would still lock Crow's bond once the service decided it.
- Decline fallback and appeal tasks whose `appealWindowSec`, `appealDecideSec` or fee fall outside the adjudicator's own published policy (D29: adjudicators may decline clauses they won't run).
- Check `freeOf` before signing.

**Third item, from the T-206 cross-family pass (review §8, L-1).** The adjudicator verifies the seller's signature on the exact delivery it judges. *Confirmed at pickup:* PR #161 (T-212 item 3, ADR-0029) already does this in `#preflight` for every role, before any judge is called, and names that delivery's hash in the decision and the record. T-211 adds a test that the fallback and appeal roles refuse a body the seller did not sign, and changes nothing else there.

### Restated at pickup (2026-11-04), as revised after the review of PR #175

The adjudicator is the only party that can keep a key away from a refunded buyer, because a key it signs travels in the decision whether or not settlement accepts it. So the service wraps the buyer's key only into an accept, and never on a deal that stands Refunded:
- a first-instance accept, and the accept after an escalation, carry it, as settlement requires;
- a party appeal carries it only when the first outcome was an accept (an upheld accept, or the missing-or-wrong-key ground);
- an overturned reject pays the seller from the first decider's bond, and the buyer keeps its refund and gets no key.

A fallback or appeal adjudicator signed nothing when the parties agreed, so its decision is its consent. What its decision costs it differs by role, so its checks differ too.
- **Fallback.** Its decision holds its bond until the appeal closes. Before it triggers a takeover and before it judges, it checks three things. Both appeal windows must be within its limits. The fee must be at least its quote, in the same token. Its cover (free bond plus what the deal already holds on it) must reach the price. After the panel it reads its cover again before it signs, unless the panel escalated, since an escalation reserves no bond.
- **Appeal.** Its decision is final: no window follows it, and nothing on chain reserves its bond yet (L-5, uncovered appeal adjudicators). So it checks only the fee, and not even that for the missing-or-wrong-key ground after an accept, which runs no panel. The reviewer and the red team of PR #175 showed that a free-bond check here lets the party that won block the appeal.
- **Deals it already consented to.** It consented as primary by signing the acceptance, and at an appeal turn by making the decision that brought the case there. So a later quote or limit does not renege on those deals. Being merely named fallback is not consent.
- **The terms it reads must be the deal's own.** It refuses a task, a takeover or an offer whose terms do not hash to the commitment ID.

It applies the same window and fee limits when it accepts an offer as primary. It also expires the appeals of its own decisions once they are due, because nobody else closes a sham deal's appeal, and its bond stays reserved until someone does.

**Non-goals.** Settlement refusals (T-210, PR #125). Publishing the limits in the registration (a schema change, proposed for T-033 in Handoff). Bounding how long a primary's acceptance holds its bond before it decides (`fundBy` to `fallbackBy` set far out, D31). The appeal adjudicator's bond on chain (T-212 item 5).

## Acceptance criteria

- [x] A test: a party appeal over a rejection that the panel overturns signs an accept with no `keyForBuyer`; a party appeal over an accept (the missing-or-wrong-key ground) still carries it; first-instance and escalation accepts still carry it; a reject never carries it.
- [x] A test: a fallback or appeal task whose windows or fee fall outside the adjudicator's policy is declined, and so is one the adjudicator lacks free bond for. A task inside the policy is still decided. *Amended 2026-11-04 after the review of PR #175:* for the appeal role, only the fee declines a task. Tests show that an appeal turn with windows over the limits, or with no free bond, is decided (Decision 5).
- [x] `pnpm verify` green.

## Out of scope

- Settlement changes (T-210, PR #125).

## Evidence

**`pnpm verify`: PASS** on the final code, with `main` merged in (commit `1118b0d` plus this file; `reports/verify-t-211-appeal-key-adjudicator.md`, 2026-11-04 13:13 UTC) [measured]:

| Step | Command | Status | Time |
| --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | pass | 258 ms |
| lint | `pnpm lint` | pass | 4533 ms |
| forge build | `forge build --root contracts` | pass | 1644 ms |
| forge | `forge test --root contracts` | pass | 23603 ms |
| test | `pnpm test` | pass | 51913 ms |
| spec | `pnpm validate:spec` | pass | 594 ms |
| snap | `pnpm snap` | pass | 9942 ms |
| snap:local | `pnpm snap --settlement=local` | pass | 15949 ms |
| demo | `pnpm demo` | pass | 4485 ms |

- **Counts** [measured]: forge 241 passed; vitest 2,388 passed and 3 skipped; snap 31 passed; snap:local 28 passed, with 3 excluded until Phase 4 as before. The report shows no snapshot diffs against HEAD. The fixtures run on testkit's own judgment, and no demo beat appeals a reject or sets a window over a week [inferred from the zero diff and `apps/demo/agents/beats.ts`]. The three earlier runs also passed every step: before the review, after round 1 with `main` merged in (`38ac51e`), and after round 2 (`fd1b264`).
- **Test first** [measured]: with only `DEFAULT_APPEAL_LIMITS` exported and no behaviour changed, 19 of the new and changed tests in `service.test.ts` failed and 52 passed. The failures were the two overturned-reject key cases, the updated missing-or-wrong-key test, the terms and bond declines, and the acceptance window checks. After the change and all three review rounds, `apps/adjudicator` passes 137 of 137 tests in 6 files.
- **Red team K5 regression** [measured, `simchain-adapter.test.ts`]: a fallback whose bond an unfunded offer drained only at the takeover decides once the bond is free again, and the seller is paid the price.
- **Through the real SimChain adapter** [measured, `simchain-adapter.test.ts`]: a seller's appeal that overturns a reject signs an accept with no key. SimChain releases no key to the buyer and pays the seller the price from the primary's bond, plus the appeal bond back. An escalation's accept carries the key, and the buyer opens the delivered CSV with it.
- **Mutation sweep** (`node apps/adjudicator/scripts/mutants.mjs "T-211"`) [measured]: all 32 T-211 mutants are killed on the final code, with one for each fix from the three review rounds.
  - Three survived at first, and each now has a test that kills it. "appeal expiry before appealBy" survived because SimChain refuses an early trigger; a test now pins `appealExpiriesDue` directly. The offer's commitment-ID check had no test. One mutant's search text had gone stale.
  - The full sweep after round 1 killed 54 of 57 mutants. The 3 others predate T-211 (Handoff 9).
- **Seller signature, the third item** [measured]: fallback and appeal tasks that carry a delivery signed by another key are refused `invalid_signature` before any judge call (new tests). PR #161's tests already covered the primary. The DeepSeek pass on PR #161 found both adjudicator checks sound (PR #166's review note). Its caveat, that each demo adjudicator's EIP-712 domain must name the deployed rules contract, is a redeploy check in T-212's Handoff.

**Review of PR #175 at `c3026f3`** (2026-11-04):
- **The `reviewer` role:** ISSUES, with no blocker. Four should-fix findings: the appeal-role checks (fixed, Decision 5); SimChain cover after the takeover (fixed, Decision 4); no end-to-end key test through the real adapter (added); and the remaining lock not written down (Handoff). Five nits: wording, nit 6 in Decision 3, a `fallbackBy` cutoff, choosing the chain rules by `freeBond`, and the fee-token message with a rename. All were applied.
- **The `red-teamer` role:** ISSUES. The key rule held on every honest path.
  - Medium: F1 (draining the appeal adjudicator's bond blocks the appeal) and F2 (on SimChain a declined turn keeps a reservation, which the default compensation then draws on).
  - Low to medium: F3 (nobody frees the service's bond after its appeal window).
  - Low: F4 (SimChain cover), F5 (trust in the port) and F6 (reneging after a config change).
  - Info: F7 (cover read before the panel).
  - F1, F3, F4, F6 and F7 are fixed with tests, and F2 is fixed for the appeal role. F2's SimChain remainder and F5 are in Handoff 4 and 5.

**Second review, at `8570da0`** (2026-11-04):
- **The `reviewer` role: PASS.** Its four round-1 findings and five nits were resolved. It found the self-expiry neutral, the exemption sound and no-re-roll kept. It added four nits (an untested expiry boundary, one self-dealing case, the escalation re-read, and a throwing expiry), all fixed in `fd1b264`.
- **The `red-teamer` role: ISSUES, fewer and lower.** F1, F3, F4 and F6 held, and F2 held for the appeal role.
  - New, Medium on SimChain: K5, a buyer forcing the default by draining the fallback's bond at the takeover. The round-1 F4 rule made that decline permanent. Fixed by Decision 4's revision, with a regression test.
  - Low: J1, a restart re-running the panel (Handoff 7); J2, the exemption through a faulty port (fixed by Decision 11).
  - Info: J3, the wrong-key re-release behind the fee (fixed); K6, the EVM mirror and third-party expiries (Handoff 8).

**Third review, of the round-2 fixes `8570da0..fd1b264`** (2026-11-04), by the `reviewer` role: ISSUES.
- It agreed with the K5 tradeoff, and found the hash check sound for real offers on both chains, sealed deals included.
- One should-fix: the nit-2 fix exempted any service *named* as fallback, so a zero-fee sham got a free appeal panel. The reviewer reproduced it with a scratch test.
- Two nits: a retry of a judged escalation, and the hash check for the primary's task.
- All three are fixed with tests in `1118b0d` (Decisions 10, 11 and 12).

## Decisions

These are implementation choices inside the task's design. They are recorded here, not as D-entries, and Rafa or the coordinating session may overrule any of them.

1. **The key rule is one condition at signing** (`#sign`): `outcome === 'accept' && task.firstOutcome !== 'reject'`, as the task says. The panel still judges and records an overturned reject, and the decision still pays the seller from the first decider's bond; the service leaves out only the key. The missing-or-wrong-key ground after a reject gets no shortcut: the panel judges it, and an overturn carries no key either.
2. **The limits are service configuration, not the hashed policy.** `AdjudicatorConfig.appealLimits` defaults to `DEFAULT_APPEAL_LIMITS`, a week for `appealWindowSec` and a week for `appealDecideSec`. Every demo deal uses 60 to 300 s. Putting the limits in `AdjudicatorPolicy` would change `policyHash` for every deal, and publishing them in the registration is a schema change (Handoff 1). D31 still holds: the protocol and API take any window, and only this adjudicator declines what it won't run (D29).
3. **The same window and fee check runs at acceptance as primary.** A primary's decision also holds its bond until the appeal closes. When its fallback and appeal peers use the same limits and quote, as the demo's three adjudicators do (`apps/demo-cloud/src/world.ts`), a deal it accepts is one they will decide. A party sees the decline at offer time, in the `declined` reason the demo world shows.
4. **Cover is the bond that would back the fallback's decision** (`bondCover`, in the adapter, because the reservation rules differ by chain).
   - The contract, marked by the adapter's `freeBond` read: its free bond (`freeOf`), plus the price while the deal still holds this adjudicator's bond under ADR-0016 §1. That covers a primary in `Delivered` and `FallbackJudging`, and the first decider while its appeal is open. A fallback's decision releases the primary's reservation before it encumbers its own, so a lone service that is its own fallback needs the price once, not twice.
   - SimChain: its free bond plus the deal's own reservations on it, counted once. This is the contract's test at the decision, applied to SimChain's reservations.
   - *Revised in round 2.* The first rework counted only the deal's reservation after the takeover, because SimChain adds nothing when the fallback decides, so free bond that turns up later backs nothing (red team F4). The red team's second pass showed that rule is worse. A party could drain the fallback's bond only at the moment of the takeover, with one unfunded offer the fallback accepts as primary, and so force the default for good (red team K5, Medium on SimChain). A party steering the outcome is worse than a smaller overturn payout, so the service applies the contract's rule. SimChain's under-reservation at the decision goes to T-210 item 3 (Handoff 4).
5. **The appeal role is gated only by the fee.** On chain an appeal decision encumbers nothing for the appeal adjudicator (L-5, T-212 item 5), and no window follows it. Both the reviewer and the red team of PR #175 found that checking windows or free bond there protected nothing. They also found it let the party that won drain the appeal adjudicator's free bond with sham offers it accepts, and so block the appeal (red team F1, reviewer finding 1). When T-212 item 5 makes an appeal decision reserve bond, the cover check returns for that role, counting what settlement reserves.
6. **It does not trigger a takeover it would decline.** The check before `triggerFallback` uses the same terms and cover. Triggering stays permissionless: anyone can trigger, and the deal then defaults at `fallbackBy`. The service reports the skip in `RunReport.refused`, not in `declined`, because the demo world reads `declined` as offers the primary declined. No takeover is due once `fallbackBy` has passed, so a declined one is not reported again after that.
7. **The fee rule is the same for both roles:** `adjudication.fee` at least this service's quote, in the same token. On a party appeal SimChain pays the appeal adjudicator from the appeal fee, not from `adjudication.fee`, but the service still requires the deal's fee as its price for running the deal at all. There is one exception: the missing-or-wrong-key ground after an accept skips the fee gate. That appeal runs no panel and only re-releases the key the buyer paid for, so a raised quote must not drop it (red team J3).
8. **The fallback reads its cover before the panel and again after it.** The check sits at the top of `#preflight`, and again in `decideTask` before it publishes the record and signs. So a bond that moves while the panel runs, or between attempts, stops the signature (red team F7). There is one exception: an escalation skips the second read, because it reserves no bond on either chain (reviewer nit 3). The service keeps the judged record, so there is no re-roll.
9. **It expires the appeals of its own decisions** (`RunReport.expired`, the first step of each `runOnce`). Its decision holds its bond until the appeal closes, and on both chains that takes a permissionless trigger. The parties to a sham deal never send it, so without this the window limits would bound nothing (red team F3). The trigger is neutral: the terms fix when it is due and what follows. An expiry that throws is reported in `refused`, and the rest of the pass still runs (reviewer nit 4).
10. **A deal it already consented to keeps the terms it consented to.** The service has consented to a deal when it is the deal's primary (its acceptance signature) or, at an appeal turn, when it made the decision that brought the case there (the port's `firstDecider`: the first-instance decider, or the one that escalated). On such a turn it skips the window and fee check.
    - A restart with a higher quote therefore does not renege on its own deals (red team F6).
    - An adjudicator that is both fallback and appeal cannot dodge the appeal against its own decision (reviewer nit 2).
    - Being merely *named* fallback is not consent. The round-2 fix exempted any named fallback, so a zero-fee sham naming the service as fallback and appeal adjudicator got a free appeal panel (reviewer, round 3). Without `firstDecider` the turn is not exempt.
    - The fallback's cover check still runs, because the contract requires it.
11. **The terms it reads must hash to the commitment ID.** The service recomputes `commitmentId(termsOf(c))` at the top of `#preflight` for every role, before a takeover, and at acceptance. It refuses a mismatch with `invalid_terms`. Without this, a faulty or lying settlement port could hand over a shorter window, a different rubric, or itself named as primary to get Decision 10's exemption (red team H5 and J2, reviewer round 3 nit). The ID binds every term, so the check closes all three.
12. **A retry of a judged escalation needs no cover.** The pre-panel cover check reads the cached outcome for the turn and skips the cover when it is an escalation, as the post-panel read does (Decision 8; reviewer round 3 nit).

## Handoff

Branch `t-211-appeal-key-adjudicator`, PR #175. Every change is in `apps/adjudicator/` and this file; nothing touches `packages/`. The branch has `main` merged in, including T-210's core and SimChain fixes (PR #173).

**Deploy, Rafa's gate.** The demo's three adjudicators run inside the demo Worker (`apps/demo-cloud/src/world.ts`), so the Sepolia demo picks this up only at its next Worker deploy. Until then the deployed adjudicator still wraps a key into an overturned reject, the contract refuses that decision (PR #125), and the appeal expires with the first decision standing. Before that deploy, check that no open demo deal has an appeal window over a week; every demo window is 60 to 300 s.

**What remains of the sham-deal lock (T-206 M-3), bounded, not removed.** A sham deal inside the limits, priced at the fallback's whole free bond, still holds that bond once the fallback decides. The hold lasts until the appeal closes: at most `appealWindowSec` plus `appealDecideSec`, two weeks with the defaults, and the service now expires it itself. An attacker can repeat it, paying the fee and tying up its own capital each time [inferred]. One stronger option is a policy call for the coordinating session or Rafa: decide fallback turns only on deals whose primary this service trusts, as T-212's acceptance check already does for the fallback and appeal adjudicators.

**Follow-ups, none blocking:**
1. **Publish the limits.** T-033 moves the MIME allowlist into an adjudicator capability block (review C8). `appealLimits` belongs beside it in `adjudicator.schema.json`, and in `site/llms.txt`: "the demo adjudicators decide deals whose appeal windows are each at most a week". Until then a party learns the limit only from the decline reason at offer time.
2. **The primary's bond before it decides, and sham offers that drain it.** The service accepts any `fundBy` to `fallbackBy` (D31), and its acceptance holds its bond until the deal moves on or times out. Sham offers it accepts as primary therefore drain the free bond its fallback turns need, and a party can use that to force the default on a deal where this service is the fallback.
   - On the contract the sham must be funded, and the drain must last until `fallbackBy`, because the contract checks the fallback's cover when it decides. The attacker gets the capital back through `reclaim` or `mutualSettle`. This is the contract's own rule since M-3: an uncovered fallback cannot decide [inferred, red team K5].
   - On SimChain the sham needs no funding, because SimChain reserves the primary's bond at acceptance (red team R4). The drain then lasts as long as the attacker sets the sham's `offerExpiresAt`, at no cost, so it forces the default whichever cover rule the service uses (reviewer, round 3).

   Either a horizon limit at acceptance or a reserve kept free for fallback turns would bound it. This is the primary's version of M-3, so it needs its own task.
3. **T-212 item 5 (bond the appeal adjudicator).** When an appeal decision reserves bond on chain, give the appeal role a cover check that counts what settlement reserves. Update the contract branch of `SettlementAdapter.bondCover` and its test table to match.
4. **SimChain's reservations differ from the contract's** (T-210 item 3; backlog "Consent for default compensation"). The fix is the contract's model: reserve the primary's bond at funding, and the fallback's at its own decision.
   - SimChain reserves the primary's bond at acceptance, a fallback's at the takeover and an appeal adjudicator's at escalation.
   - When the service declines such a deal, SimChain keeps the reservation until the default deadline, and the default compensation draws on it: 10% of the price under `SIM_RULEBOOK` (red team F2, measured on SimChain).
   - SimChain adds nothing when the fallback decides. A fallback decision covered by free bond that turned up after the takeover is therefore under-reserved there, and an overturn pays the wronged party at most the reservation (red team F4, measured on SimChain).
   - The contract reserves nothing in any of these cases.
5. **The service trusts its settlement port for `firstOutcome`** (red team F5 and H1). The key rule reads the port's `firstOutcome`, so a faulty port that omits it on a party appeal over a reject would get the key sealed for the refunded buyer. To fail closed, have the port derive the appeal kind from the escrow state and refuse a party-appeal task without it. The terms half of F5 is fixed for every role: the service refuses terms that do not hash to the commitment ID (Decision 11). Decision 10 also reads the port's `firstDecider`, and fails closed when it is absent. Today the port is the service's own reader of SimChain or the chain.
6. **The cloud world's wake-ups.** `workAt` in `apps/demo-cloud/src/world.ts` drops a settled deal once `appealBy` passes, so the world may not wake the adjudicators when one of their own appeal expiries falls due. The expiry then runs on the next pass that happens for another reason. Add a wake at `appealBy` and `appealDecideBy` for deals whose first decider is one of the world's adjudicators.
7. **A restart while the fallback waits for cover runs its panel again** (red team J1, Low). The judged record is kept in memory, so a restart after the post-panel cover read refused loses it, and the next attempt calls the judges again. The first verdict was never published or signed, so this is a second run, not a re-roll chosen on a verdict. The same was already true before T-211 for a restart after a failed submission. The fix is to persist judged results privately, keyed by commitment, role and attempt, before any check that can refuse after the panel.
8. **The EVM mirror and third-party expiries** (red team K6, Info). The EVM adapter updates its mirror only through its own submissions. If a third party expires an appeal directly on chain, the service lists it as due and simulates the expiry on every pass; the simulation is refused, so it costs an RPC call, not gas. The fix belongs in `packages/settlement/evm`.
9. **The mutation sweep's older gaps, untouched here.** `appeal panel uses the first-instance family minimum` survives. Two mutants no longer apply: the inconclusive-party-appeal rule moved to `@holdback/judgment`'s `signedOutcome`, and `primary given no released envelope`. T-211 changed neither that code nor the commitments those tests use, so they draw the same panels [inferred].
10. **A cross-family review.** The reviewer recommended a pass by a model from another family (DeepSeek, as on PR #161) on the final commit. Its focus:
   - the key rule against the contract's `decide` and SimChain's decide path, path by path;
   - `bondCover` on each chain and in each state, with one adjudicator in several roles;
   - whether any decline lets a party force an outcome (item 2);
   - the appeal self-expiry, and Decision 10's exemption.
