# T-347: an unreadable delivery never stalls other deals

- **Lane:** judgment
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 5, settlement and judgment code (Change recipes): the packages' tests, one red team before it lands, a target of 250k tokens.
- **Depends on:** T-327 (reference files; its rule for a withheld reference is the model here)
- **Roadmap:** N80; package 7 of the pilot plan (crow-private `roadmap/plans/2026-11-11-pilot-refocus.md`, section 7.1)
- **Paths this task may touch:** `apps/adjudicator/src/service.ts` and its tests, one new `neutrality.*` scenario under `fixtures/scenarios/` with any terms or data files it needs, `packages/testkit/src/judgment.ts` (only if the snap runner needs the same handling), this file. Never: `contracts/`, `packages/core/`, `packages/settlement/`, `apps/operator/`, `spec/schemas/`, `examples/`, `site/`.
- **Human gate:** no. The fix reaches the live adjudicators only with a deploy, which waits for Rafa.
- **Status:** done (PR 346)
- **Agent/session:** the T-347 session, 2026-11-11, branch `t-347-unreadable-delivery`

## Intent

**Problem (inferred by T-327, never run; step 1 confirms or refutes it with a test).** A seller signs a Delivery whose `ciphertext.uri` names bytes no store holds: it never uploaded them, or the store lost or withholds them. The adjudicator's `#judge` reads the ciphertext through its settlement port, and the read throws. `runOnce` calls `decideTask` without a `try`, so the throw would end the whole pass: every deal after this one in the pass goes unjudged, on every pass, until the bad deal leaves the task list. The bad deal itself is never decided, and nothing names the missing ciphertext.

**Goal.** One unreadable delivery costs only its own deal.
1. The pass goes on for every other deal.
2. The unreadable deal follows the rule the default clauses already give for a ciphertext the adjudicator cannot use: it is not judged, no record is signed and nothing is decided, and the adjudicator retries on each pass. If the bytes never come, the fallback takes over at judgeBy and, failing it too, the default outcome applies at fallbackBy. This task invents no new rule.
3. The pass's report names the missing ciphertext (its URI and SHA-256), so a party can show why the deal reached its default outcome.
4. A ciphertext that arrives late, before the decision deadline, is judged normally.

**Inputs.** The seller-signed Delivery (`ciphertext.uri`, `ciphertext.sha256`) and what the adjudicator's content store returns for that URI.

**Outputs.**
1. A test that shows today's behaviour, committed before the fix.
2. The fix in `apps/adjudicator/src/service.ts`.
3. Tests: two deals in one pass, one unreadable, the other judged; a late ciphertext judged; the fallback and the default outcome when the bytes never come.
4. A `neutrality.*` scenario and its `.expect.md`: a store that withholds a delivery's ciphertext, and the deal still closes by expiry.

**Non-goals.**
- No change to the operator's delivery relay (`apps/operator/`), the contracts, core or the schemas.
- No new refusal of terms the parties can set (D31).
- No signed reject for a ciphertext no store returns: the store, not only the seller, may be at fault (T-327 red team H1).

## Context

- `apps/adjudicator/src/service.ts`: `runOnce`, `decideTask`, `#judge`, `mapIntakeError` (a stored ciphertext that does not match its delivery is refused and retried, with no record).
- `docs/tasks/T-327-adjudicator-reference-files.md`, Decisions 2 and the Handoff's "Findings that waited".
- `reports/scratch/t-327-triage.md` (main checkout): the two rows for an unstored delivery ciphertext.
- `fixtures/scenarios/neutrality.store-withholds-reference.scenario.yaml`: the same path for a withheld reference.
- `docs/judgment-and-defenses.md`, stage 0 (intake), and D27 in `docs/decisions-today.md`.

## Acceptance criteria

- [x] A test shows what happens today when no store returns a delivery's ciphertext: whether the pass aborts for other deals, where this deal ends, and what record is left (committed before the fix).
- [x] Two deals in one pass, one with a missing ciphertext: the other is judged (test).
- [x] The unreadable deal is not judged and nothing is signed for it; the fallback and then the default outcome follow if the bytes never come (test).
- [x] The adjudicator's report names the missing ciphertext's URI and SHA-256 (test).
- [x] A ciphertext that arrives before the decision deadline is judged normally (test).
- [x] A `neutrality.*` scenario with its `.expect.md` covers a store that withholds a delivery's ciphertext; the deal closes by expiry.
- [x] The tests of `apps/adjudicator` and `packages/judgment`, `pnpm typecheck`, `pnpm lint` and `pnpm snap` pass; no existing snapshot changes except by this fix, each change explained.
- [x] One red team on the diff; Critical and High findings fixed.

## Out of scope

- An operator that refuses to relay a Delivery whose ciphertext its store does not hold (`apps/operator/`).
- Seller compensation from the bonds on a default outcome (SimChain keeps bonds as the full reference; phase one pays no bond, Rafa, 2026-11-11).

## Evidence

All runs on 2026-11-11, on branch `t-347-unreadable-delivery`, from `origin/main` at `b58bb69`.

- **Step 1, today's behaviour (measured).** `apps/adjudicator/src/unreadable-delivery.test.ts` before the fix: 5 of 6 tests failed. `runOnce` threw `no blob <uri>` on every pass, for the primary and for the fallback. A probe ran two deals in one pass, the unreadable one first (kept as `reports/scratch/t-347-probe.test.ts.txt` in the main checkout). It answered the three questions:
  1. **The pass aborts for every other deal.** The healthy deal was never judged either. After four passes (two primary, two fallback) it sat in `FallbackJudging` with the bad one.
  2. **Where the deal ends.** Both deals reached the default outcome at fallbackBy and ended `Refunded`, `via: default_outcome`. So a seller's missing ciphertext also cost the other seller its payment for good work.
  3. **What record is left.** None: no judgment record and no decision. Only the exception text, which the live worlds log through `onError` and do not keep.
  The finding reproduced, and was worse than inferred, because the other deals were lost as well as delayed. The test file was committed alone, as `055c272`.
- **After the fix (measured).** The same file passes 9 of 9. `pnpm exec vitest run apps/adjudicator packages/judgment packages/testkit apps/operator/src/sim-world examples/private.test.ts`: 38 files passed and 2 skipped; 887 tests passed and 6 skipped. The skips are `drand-fork.test.ts` and `runner.test.ts`, which predate this task. After the red-team fixes, `apps/adjudicator` passes 230 tests (3 skipped).
- **Snapshots (measured).** `pnpm snap`: 39 passed, 0 failed. No existing snapshot changed. The new one, `neutrality.store-withholds-delivery`, shows three refusals that name the ciphertext's URI and SHA-256: Bench A twice, then Bench B after the takeover. Nothing is judged or signed, and the default outcome ends the deal `Refunded` with Atlas's 2,050 tUSD returned.
- **Types and lint (measured).** `pnpm typecheck` and `pnpm lint` exit 0.
- **Red team (measured).** One `red-teamer` pass found no Critical or High findings: 1 Medium and 6 Low. Its proof test passed 4 of 4 on the branch, and it is kept as `reports/scratch/t-347-redteam.test.ts.txt` in the main checkout.
  - **Fixed:**
    - M1: the new catch on the offers loop reported a thrown acceptance as a decline, which demo-cloud publishes and keeps. It is now refused and retried.
    - L5: the refusal text named the store's raw error, which can carry a keyed RPC URL, and an unchecked hash. It now names only the error's class, the URI cut to 200 characters, and the hash only in its own form.
    - L4: the fallback test now uses the example's full rubric.
    Each fix has a test.
  - **Left, in `reports/scratch/t-347-triage.md`:**
    - L1: a store read that never settles still stalls the pass.
    - L2: a seller that withholds the bytes also escapes a `mime_mismatch` reject.
    - L3: the fallback triggers a takeover it then refuses.
    - L6: the snap runner models "unstored" by the fixture's path.
  - **What held:**
    - No store and no seller can get a signed reject of good work or a signed accept of bad work.
    - A failed read produces no record, decision or judge call, as primary or as fallback.
    - A retry after the panel ran asks no judge again.
    - No new refusal of terms.
- **Not run locally.** The full `pnpm verify` and gitleaks. CI runs both gates.
- **CI (measured).** PR 346: every job passed, including the anvil tests, `forge test`, TLC, gitleaks and CodeQL. The first run was queued during a GitHub Actions outage and never started, so an empty commit started a new one.

## Decisions

1. **A ciphertext no store returns follows the existing rule for a ciphertext that does not match its delivery** (`mapIntakeError`, `ciphertext_hash_mismatch`), the rule T-327 applied to references. It is not judged, nothing is published or signed, and it is retried. The fallback and then the default outcome follow if it never comes. The adjudicator cannot tell a seller that never uploaded from a store that withholds, so a signed reject would let a store's operator, or one fault, refund good work (T-327 red team H1). This is no new rule: the D27 defaults and `docs/judgment-and-defenses.md` give none for a missing ciphertext, and the default outcome is the terms' own path for an adjudicator that does not decide.
2. **Each offer, takeover and task is its own unit in `runOnce`.** A throw is reported in `refused` and retried, and it never ends the pass. `decideTask` keeps the judged record the moment the panel returns, so a retry never asks the judges again (test).
3. **The record is the pass's report.** A `Judgment` record needs a decision, so publishing one would mean signing a verdict. The refusal names the ciphertext's URI and SHA-256 instead; together with the store's own 404 for that hash, a party can show why the deal defaulted.
4. **The snap runner's delivery store is a fixtures directory**, as T-327's reference store is. `packages/testkit/src/judgment.ts` refuses a delivery of a file under `fixtures/data/unstored/` as the service refuses a missing ciphertext. So the scenario parser and the stub settlement stay unchanged, inside this task's paths.
5. **The fallback still triggers a takeover whose ciphertext it cannot read** (red team L3). Checking first needs the delivery in `takeoversDue`, which is a port change. Anyone may trigger anyway, and late bytes can still arrive before fallbackBy.

## Handoff

**Done.**
- An unreadable delivery no longer stops the adjudicator's pass for other deals.
- That deal is not judged, its refusal names the missing ciphertext, and late bytes are judged as usual.
- `neutrality.store-withholds-delivery` shows the deal closing by the default outcome.

**Not done.**
- The fix reaches the live adjudicators only with an operator deploy, which waits for Rafa. Done: Rafa deployed the operators on 2026-11-12 at 05:01 UTC from `2d03383` (`docs/operations.md`), so the fix is live.
- `docs/neutrality.md` does not list `neutrality.store-withholds-delivery`; that file is outside this task's paths.

**Findings that waited.** The rows are in `reports/scratch/t-347-triage.md` (main checkout):
- a store read that hangs (L1);
- a withheld ciphertext that hides a `mime_mismatch` (L2);
- the fallback's takeover (L3);
- demo-cloud does not surface `adjudicator_unavailable` refusals, and does not clear a reversed decline;
- SimChain's bond payout to a seller that never uploads;
- the operator relay that does not check the store.

**How to resume.** Run `pnpm build`, then `pnpm exec vitest run apps/adjudicator/src/unreadable-delivery.test.ts apps/adjudicator/src/reference.test.ts` and `pnpm snap neutrality.store-withholds-delivery neutrality.store-withholds-reference`.
