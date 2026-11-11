# T-327: the adjudicator loads reference files, so a reference check can pass

- **Lane:** judgment
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 5, settlement and judgment code (Change recipes): the package's tests, one review or one red team with blocking findings only, a target of 250k tokens.
- **Depends on:** T-008 (the check library), T-316 (the seller's check runner)
- **Roadmap:** N66 (Now, Rafa, 2026-11-11)
- **Paths this task may touch:** `apps/adjudicator/`, `packages/judgment/src/`, `examples/check-delivery.ts`, `examples/check-delivery.test.ts`, new files under `fixtures/` (scenarios, terms, data), `docs/api.md` (only the lines on the reference check), `packages/testkit/src/judgment.ts` (the snap runner's reference loading only; added by the coordinator on 2026-11-11), this file. Never: `spec/schemas/`, `contracts/`, `packages/settlement/`, `apps/operator/`, `examples/seller-adapter.ts`, `examples/buyer-signer.ts`, `examples/audit-deal.ts` and their tests.
- **Human gate:** no. The fix reaches the live adjudicators only with a deploy, which waits for Rafa.
- **Status:** in progress
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

**The rule for a reference the adjudicator cannot read.** The check library already defines it: a check that cannot be evaluated, including a missing reference, fails closed (`packages/judgment/src/checks/index.ts`, header). A required reference check that cannot read its reference therefore rejects, as it does today. This task changes no rule; it only stops the service from withholding a reference it can read.

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

- [ ] A deal with a required `reference_row_match_min` check ends `Released` for a matching delivery and `Refunded` for a non-matching one on the adjudicator service (test, failing first).
- [ ] A reference the store does not hold, or whose bytes do not match the committed hash, fails the check closed and the deal ends `Refunded`; never a pass (test).
- [ ] `preflightDelivery` and `examples/check-delivery.ts --reference <file>` give the adjudicator's outcomes for the same reference bytes (test pins parity).
- [ ] A scenario fixture with its `.expect.md` snapshot covers the matching and the non-matching deal.
- [ ] `pnpm typecheck`, `pnpm lint`, the tests of `packages/judgment` and `apps/adjudicator` pass.
- [ ] One review or red team on the diff; blocking findings fixed.

## Out of scope

- Private reference files (encrypted to the adjudicators).
- A rule that tells a missing reference from an unreachable store (Handoff).

## Evidence

To fill in before review.

## Decisions

To fill in.

## Handoff

To fill in.
