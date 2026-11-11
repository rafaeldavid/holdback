# T-347: an unreadable delivery never stalls other deals

- **Lane:** judgment
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 5, settlement and judgment code (Change recipes): the packages' tests, one red team before it lands, a target of 250k tokens.
- **Depends on:** T-327 (reference files; its rule for a withheld reference is the model here)
- **Roadmap:** N80; package 7 of the pilot plan (crow-private `roadmap/plans/2026-11-11-pilot-refocus.md`, section 7.1)
- **Paths this task may touch:** `apps/adjudicator/src/service.ts` and its tests, one new `neutrality.*` scenario under `fixtures/scenarios/` with any terms or data files it needs, `packages/testkit/src/judgment.ts` (only if the snap runner needs the same handling), this file. Never: `contracts/`, `packages/core/`, `packages/settlement/`, `apps/operator/`, `spec/schemas/`, `examples/`, `site/`.
- **Human gate:** no. The fix reaches the live adjudicators only with a deploy, which waits for Rafa.
- **Status:** in progress
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

- [ ] A test shows what happens today when no store returns a delivery's ciphertext: whether the pass aborts for other deals, where this deal ends, and what record is left (committed before the fix).
- [ ] Two deals in one pass, one with a missing ciphertext: the other is judged (test).
- [ ] The unreadable deal is not judged and nothing is signed for it; the fallback and then the default outcome follow if the bytes never come (test).
- [ ] The adjudicator's report names the missing ciphertext's URI and SHA-256 (test).
- [ ] A ciphertext that arrives before the decision deadline is judged normally (test).
- [ ] A `neutrality.*` scenario with its `.expect.md` covers a store that withholds a delivery's ciphertext; the deal closes by expiry.
- [ ] The tests of `apps/adjudicator` and `packages/judgment`, `pnpm typecheck`, `pnpm lint` and `pnpm snap` pass; no existing snapshot changes except by this fix, each change explained.
- [ ] One red team on the diff; Critical and High findings fixed.

## Out of scope

- An operator that refuses to relay a Delivery whose ciphertext its store does not hold (`apps/operator/`).
- Seller compensation from the bonds on a default outcome (SimChain keeps bonds as the full reference; phase one pays no bond, Rafa, 2026-11-11).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
