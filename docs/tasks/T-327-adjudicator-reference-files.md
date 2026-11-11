# T-327: the adjudicator loads reference files, so a reference check can pass

- **Lane:** judgment
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 5, settlement and judgment code (Change recipes): the package's tests, one review or one red team with blocking findings only, a target of 250k tokens.
- **Depends on:** T-008 (the check library), T-316 (the seller's check runner)
- **Roadmap:** N66 (Now, Rafa, 2026-11-11)
- **Paths this task may touch:** `apps/adjudicator/`, `packages/judgment/src/`, `examples/check-delivery.ts`, `examples/check-delivery.test.ts`, new files under `fixtures/` (scenarios, terms, data), `docs/api.md` (only the lines on the reference check), `packages/testkit/src/judgment.ts` (the snap runner's reference loading only; added by the coordinator on 2026-11-11), this file. Never: `spec/schemas/`, `contracts/`, `packages/settlement/`, `apps/operator/`, `examples/seller-adapter.ts`, `examples/buyer-signer.ts`, `examples/audit-deal.ts` and their tests.
- **Human gate:** no. The fix reaches the live adjudicators only with a deploy, which waits for Rafa.
- **Status:** done (PR 306)
- **Agent/session:** the T-327 session, 2026-11-11, branch `t-327-adjudicator-reference-files`

## Intent

**Problem (inferred from the roadmap row and T-316's Handoff, finding 1; to confirm with a failing test).** `docs/api.md` offers buyers the check `reference_row_match_min`: at least `minBps` of the rows of a reference file the terms name must appear in the delivery with the same values. The check library evaluates it when it is handed the reference's bytes. The adjudicator service hands it none (`apps/adjudicator/src/service.ts` calls `runPipeline` without `references`). So the check fails with "reference not available" for every delivery, and a deal that makes it required can only refund, whatever the seller delivers.

**Goal.** A deal whose terms name a reference file and make the check required ends `Released` when the delivery matches the reference and `Refunded` when it does not, on the adjudicator service. The seller's check runner gives the same answer for the same reference file.

**How the adjudicator gets the bytes.** It reads a delivery's ciphertext through its settlement port, `ciphertext(uri)`. Every content store behind that port is content-addressed: it takes the `sha256:<hex>` id at the end of the URI and reads its own store; it fetches nothing. A party uploads a reference file the same way a seller uploads ciphertext (`POST /v1/ciphertext`, which stores any bytes under their SHA-256) and names that URI and hash in the terms. The adjudicator loads the reference through the same port, only when the URI ends in the hash the terms commit to, and the check library checks the bytes against that hash again.

**Inputs.** The agreed terms (`acceptance.deterministicChecks[].reference.{uri, sha256}`) and the bytes the adjudicator's content store holds under that hash.

**Outputs.**
1. The adjudicator service loads each reference before stage 1 and passes it to the pipeline.
2. `examples/check-delivery.ts` takes `--reference <file>` and passes the same bytes to `preflightDelivery`.
3. Tests: a matching and a non-matching deal on the service; a reference the store does not hold, and one whose bytes do not match the committed hash; parity between the service and the preflight.
4. A scenario fixture with its `.expect.md` snapshot for the matching and the non-matching deal.

**The rule for a reference the adjudicator cannot read.** The first draft kept the check library's fail-closed rule: a missing reference failed the check, and a required check rejected. The red team showed that this let the store's operator, or one transient fault, decide a deal (Decisions 2). The delivery's own ciphertext already has the rule that fits: a stored ciphertext that does not match its delivery is the store's fault and is retried, never judged (`mapIntakeError`). A reference now follows it: the adjudicator does not judge a turn whose reference its store withholds or corrupts, publishes nothing, and retries; the fallback and then the default outcome follow if the bytes never come. Terms that name a reference by a hash no URI ends in still fail the check closed, because that is the same on every adjudicator and visible before signing.

**Non-goals.**
- No fetch of an arbitrary URL. A reference URI that does not end in its committed hash is not looked up.
- No schema change. The terms already carry `reference.uri` and `reference.sha256`.
- No change to the check's semantics, to aggregation or to the panel. Stage 1 only; no panel is re-rolled.
- No encryption of reference files. A reference is stored in the clear, like the terms that name it (Handoff).

## Context

- `packages/judgment/src/checks/index.ts`: `reference_row_match_min` and its fail-closed rule.
- `packages/judgment/src/pipeline.ts` (`stageOne`, `runPipeline`) and `packages/judgment/src/preflight.ts` (T-316).
- `apps/adjudicator/src/service.ts` (`#judge`) and `apps/adjudicator/src/settlement-port.ts` (`ciphertext`).
- `apps/operator/src/server.ts`, `POST /v1/ciphertext` and `GET /v1/ciphertext/{id}`: the content-addressed store, unchanged here.
- `docs/tasks/T-316-seller-check-runner.md`, Decisions 5 and Handoff finding 1.
- `docs/api.md`, the deterministic check table.

## Acceptance criteria

- [x] A deal with a required `reference_row_match_min` check ends `Released` for a matching delivery and `Refunded` for a non-matching one on the adjudicator service (test, failing first).
- [x] A reference the store does not return, or returns with bytes that do not match the committed hash, is never a pass: the adjudicator does not judge, publishes no record and retries, and the deal settles by its terms once the store returns the committed bytes (test). Terms whose URI does not end in the committed hash fail the check closed and refund (test). Changed after the red team (Decisions 2).
- [x] `preflightDelivery` and `examples/check-delivery.ts --reference <file>` give the adjudicator's outcomes for the same reference bytes (test pins parity). Without the file the command says the result is not known and exits 2.
- [x] A scenario fixture with its `.expect.md` snapshot covers the matching and the non-matching deal.
- [x] `pnpm typecheck`, `pnpm lint`, the tests of `packages/judgment` and `apps/adjudicator` pass.
- [x] One red team on the diff; its blocking finding fixed.

## Out of scope

- Private reference files (encrypted to the adjudicators).
- A rule that tells a missing reference from an unreachable store (Handoff).

## Evidence

All runs on 2026-11-11, on branch `t-327-adjudicator-reference-files`, merged with `origin/main` at the end.

- **Test first (measured).** `pnpm exec vitest run apps/adjudicator/src/reference.test.ts` before the fix: 6 of 9 tests failed. A delivery that matches the reference got `reference not available`, and the preflight given the same bytes disagreed with the service. Committed alone as `70de745`.
- **After the fix (measured).** The same file: 9 of 9 passed. `packages/judgment/src/references.test.ts`: 4 of 4. `examples/check-delivery.test.ts`: 21 of 21.
- **Packages (measured).** `pnpm exec vitest run packages/judgment apps/adjudicator examples/check-delivery.test.ts packages/testkit`: 36 files passed and 2 skipped; 860 tests passed and 6 skipped.
- **Snapshots (measured).** `pnpm snap`: 37 passed, 0 failed. No existing snapshot changed. Two are new:
  - `reference-check-accepted`: `known_customers` passes, `Released`.
  - `reference-check-rejected`: `known_customers` fails at 38/40, below 10,000 bps, `Refunded`. The buyer gets the 2,000 tUSD price back and Bench A earns the 50 tUSD fee.
- **Types and lint (measured).** `pnpm typecheck` (again after the merge with `origin/main`) and `pnpm lint` exit 0.
- **Red team (measured).** One `red-teamer` pass on the whole diff found 1 High, 2 Medium and 4 Low. Its proof test (`reports/scratch/t327-redteam.test.ts` in the worktree) passed 7 of 7 before the fix. After the fix, its H1 cases and M1 fail, so those findings no longer hold, and its Low proofs still pass. What held: no fetch of an arbitrary URL, the reference never reaches a model or runs, a party cannot force a pass, and hostile bytes fail the check without crashing the service.
- **Not run.** The full `pnpm verify`, and gitleaks (not installed here). CI runs both gates.

### Review fixes (PR 312, roadmap N77)

An independent review of PR 306 found 1 High, 3 Medium and 2 Low. Rafa decided on 2026-11-11 to fix them. Branch `t-327-review-fixes`, from `origin/main` at `d774a1e`.

- **Reproduced first (measured).** Commit `2482478` holds the failing tests alone.
  - `apps/adjudicator/src/reference.test.ts`: 4 of 13 failed.
    - Finding 1: the primary accepted an offer whose reference its store did not return, and accepted one whose store returned other bytes. `declines()` returned null for both roles.
    - Finding 2: at judgeBy the fallback triggered a takeover it could not run.
  - `packages/judgment/src/references.test.ts`: 3 of 8 failed (finding 3).
    - The loader read a second reference after the first was missing.
    - It accepted a reference above the store ceiling.
    - The check parsed a 10 MiB reference, in 833 ms, instead of failing on its size.
  - Findings 4 and 5 are text and need no test. The reviewer's reading holds for both (measured by reading).
- **After the fix (measured).**
  - `reference.test.ts`: 13 of 13. `references.test.ts`: 8 of 8.
  - `pnpm exec vitest run packages/judgment apps/adjudicator examples/check-delivery.test.ts packages/testkit`: 868 passed, 6 skipped.
  - `pnpm snap`: 38 of 38. No existing snapshot changed. One is new: `neutrality.store-withholds-reference`. Both adjudicators are refused with "the store did not return it", nothing is judged or published, and the default outcome ends the deal Refunded.
  - `pnpm typecheck` and `pnpm lint` exit 0.
- **What changed.**
  1. `#referenceProblem` loads the references through the shared loader. The adjudicator declines an offer as primary (`#accept`, `declines('primary')`) and a fallback or appeal turn (`#runnable`) when its store does not return a reference, returns other bytes, or returns more than the cap.
  2. A service test and `neutrality.store-withholds-reference` cover a reference lost after acceptance: no decision, the fallback declines, and the default outcome applies at fallbackBy.
  3. `loadReferences` stops at the first unusable reference and caps a reference at `REFERENCE_MAX_BYTES`. The cap is core's `MAX_CIPHERTEXT_BYTES`, 10,485,760 bytes, the ceiling `POST /v1/ciphertext` enforces. A test pins the number. The check library fails a larger reference closed with the same number, before it hashes or parses it, so the preflight agrees.
  4. `docs/api.md` gains a "Reference files" paragraph:
     - upload before the offer, to the store the adjudicators read;
     - adjudicators decline a deal whose reference their store lacks;
     - the cap;
     - a reference is the one plaintext file in a ciphertext store, by the party's choice (D35), and is readable without authentication, so no personal data belongs in it;
     - a pass proves the rows are present, not who produced them.
  5. The comments in `preflight.ts` and `reference.test.ts` describe the current rule.
- **The cap is the store ceiling.** The brief named both "above `MAX_PLAINTEXT_BYTES`" and "refuses nothing the store would have taken". The first draft used judgment's `MAX_CIPHERTEXT_BYTES` (10,485,788 bytes), which is 28 bytes above the store's real ceiling. The reviewer caught it (Low), and the cap now reads core's constant.
- **A regression CI caught (measured).** On the first push, `examples/private.test.ts` failed with "did not reach AcceptedByAdjudicator". A sealed commitment carries no `acceptance`, so the accept-time check threw, and the whole `runOnce` pass aborted. This service cannot open sealed terms yet (T-207), so it sees no reference by design. The check now skips sealed terms, and the file passes 8 of 8. All the examples' tests: 230 passed, 13 skipped. When T-207 opens sealed terms, this skip must become a real check.
- **Reviewer (measured).** One `reviewer` pass returned ISSUES: no Critical, 1 High, 1 Medium, 5 Low.
  - **Fixed:**
    - the High, the sealed-terms throw above;
    - the cap's number;
    - the size line in `docs/api.md`, which now says an adjudicator declines the deal;
    - the decline message, which now says the deal is reconsidered on each pass;
    - the stale Handoff.
  - **Left:**
    - the Medium: a declined offer is re-read on every pass until it expires;
    - the reviewer's Lows 6 and 7: the fallback and appeal stores are not checked at agreement, and the snap runner does not model the accept-time decline.

  All three are listed in Handoff.
- **Found, not fixed (inferred, not run).** An unstored delivery ciphertext has the same exposure as finding 1, and the seller alone can use it. Operators do not check that a delivery's ciphertext is stored before relaying it. An adjudicator that cannot read it never decides, so the deal reaches its default outcome, which on SimChain pays the seller from the bonds. `runOnce` also aborts its whole pass on such a task. Both rows are in `reports/scratch/t-327-triage.md`.

## Decisions

1. **One loader, three callers.** `loadReferences` in `packages/judgment/src/references.ts` is called by the adjudicator service, the snap runner (`packages/testkit/src/judgment.ts`) and, through `referenceLookups`, the seller's command. The preflight takes bytes, because a seller has files, not a store.
2. **A reference the store withholds or corrupts is not judged (red team H1, High).** The first draft failed the check, so one failed read signed a reject. A store's operator, or a fault, could refund a matching delivery, or overturn an accept on a party appeal (measured by the red team). The delivery's ciphertext already follows the rule this uses (`mapIntakeError`, `ciphertext_hash_mismatch`), so this is the existing default rule applied to a second input, not a new one. The cost: a buyer who never uploads its reference leaves the deal to the fallback and then its default outcome. A seller sees that before signing, since the check runner needs the file.
3. **Look up only a URI that ends in the committed hash.** Every content store answers by the hash at the end of the URI (`apps/operator/src/sim-world.ts`, `apps/demo-cloud/src/world.ts`), so the adjudicator never sends a buyer's URL anywhere. A hash no URI ends in is never looked up, and its check fails closed the same way on every adjudicator.
4. **The snap runner's store is `fixtures/data/reference/`.** It keeps each file there under its SHA-256, as `POST /v1/ciphertext` does, so the scenarios need no new key and the scenario parser is unchanged.
5. **The command says "not known" without the reference.** An adjudicator does not judge without it, so a predicted reject would be wrong. It exits 2, and when the file is given it notes that the adjudicators' stores must hold it (red team M1).
6. **`docs/api.md` says how to upload a reference, that the store keeps it in the clear, and that the check proves the rows are present, not who produced them** (red team M2).

## Handoff

**Done.**
- The adjudicator loads reference files and passes them to stage 1.
- The seller's command takes `--reference`.
- The snap runner loads references through the same loader, and two scenarios cover the matching and the non-matching deal.
- The red team's blocking finding is fixed.

**Not done.**
- The fix reaches the live adjudicators only with a deploy, which waits for Rafa.
- `site/llms.txt` mentions neither `--reference` nor the rule to upload the reference before the offer. The coordinator queues it; it is outside this task's paths.
- `docs/neutrality.md` does not list `neutrality.store-withholds-reference` in the adjudicator row. That file is outside this task's paths.

**Findings that waited.** Rows in `reports/scratch/t-327-triage.md` (main checkout):
- JSON numbers beyond 2^53 match the wrong values (red team L1);
- each check parses its reference again (red team L3);
- a restart can re-read a changed store (red team L4);
- references are stored in the clear (red team M2; `docs/api.md` now warns against personal data);
- the terms do not say which store each adjudicator reads; the primary checks only its own store at agreement, so a fallback or appeal adjudicator on another store can still fail to decide (N78, a schema question; reviewer Low 6);
- **High, inferred:** an unstored delivery ciphertext lets the seller alone send a deal to its default outcome, paid from the bonds, and its read aborts `runOnce` for every other deal;
- a declined offer's references are re-read on every pass until `offerExpiresAt` (reviewer Medium). Fix: cache the verified hashes, since stores are content-addressed;
- the snap runner does not model the accept-time decline, so only `reference.test.ts` catches a regression of finding 1 (reviewer Low 7).

**How to resume.** Run `pnpm build`, then `pnpm exec vitest run apps/adjudicator/src/reference.test.ts packages/judgment/src/references.test.ts examples/check-delivery.test.ts examples/private.test.ts` and `pnpm snap reference-check-accepted reference-check-rejected neutrality.store-withholds-reference`.
