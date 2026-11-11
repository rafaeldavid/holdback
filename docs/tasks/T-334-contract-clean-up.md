# T-334: Contract clean-up before the audit (package C2)

- **Lane:** settlement
- **Phase:** 11 (Security hardening: the contracts made audit-ready for the pilot's audit)
- **Depends on:** none. It is the first package on the integration branch `contracts-audit-ready`, cut from `origin/main` at `1430f77`.
- **Paths this task may touch:** `contracts/src/` (the listed items only); `contracts/test/` and `contracts/script/` only where the moved or removed code requires it; `contracts/README.md` and `docs/audit/known-issues.md` only for lines these items make untrue; this file.
- **Human gate:** no for this task. The merge into `main`, the redeploy and the freeze are package C9, Rafa's.
- **Status:** in progress
- **Agent/session:** the T-334 session (Opus 5.5)

## Intent

The contract source must be clean before an outside auditor reads it, and the later security fixes need bytes that `HoldbackRules` does not have (263 bytes under the EIP-170 limit). This task removes dead code and fixes stale text, and changes nothing a deal can observe: no settlement path, no revert a reachable call can hit, no event, no ABI entry. Five items:

1. Remove the dead fee-share branch in `_payOut`: the rate is a constant 0, so the branch never runs.
2. Remove the five smaller dead items: `Money.payout` (no caller), the identity call `Money.requirement(t.price, ALL_BPS)`, the unused flag value, the stored time nothing reads, and one unreachable error.
3. Fix stale comments: the "Phase 1, 2 and 4" references and the ADR-0025 status written into the code.
4. Move the test-only `SimBeacon.sol` out of `contracts/src/`, so `src/` holds only what deploys to a shared chain.
5. Pin the compiler pragma exactly in every contract file.

Each item is done, or held back with a reason when doing it would change behaviour, an event or the ABI. The output is a pull request into `contracts-audit-ready`, never into `main`, with the bytes freed in `HoldbackRules` measured. The branch deploys nothing; `main` stays equal to the Sepolia deployment.

Non-goals: the refine and secure items of the pilot plan (packages C3 to C7), the README's counts and the gas snapshot (clean item 6, with package C1d), `formal/`, `packages/`, `spec/`, and any deploy.

## Context

- The plan's contract findings, clean items 1 to 5 (private repository, `roadmap/plans/2026-11-11-pilot-refocus.md`, sections 3.3 and 7.2).
- `docs/reviews/2026-11-03-contract-review.md` I-2 and I-3; `docs/audit/known-issues.md`; `docs/tasks/T-212-contract-hardening.md` item 6.
- ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0022 (rounding), ADR-0025 (token identifiers).
- `contracts/README.md`, the build-input rule: every edit under `contracts/src` needs a redeploy, so the work stays on the integration branch.

## Acceptance criteria

- [ ] Each of clean items 1 to 5 is done, or reported as not safe to do with the reason.
- [ ] `forge test` passes with 248 tests or more (248 of 248 on 2026-11-11).
- [ ] The anvil suites and `formal/check.sh`'s safety run pass.
- [ ] The bytes freed in `HoldbackRules` are measured with `forge build --sizes` against the 263 bytes of headroom.
- [ ] One review and one red team on the diff; Critical and High findings fixed.
- [ ] The PR merges into `contracts-audit-ready`, not `main`.

## Out of scope

- Any change to a settlement path, an event or the ABI (`packages/settlement/evm/abis.json` is checked against the compiled ABI and is not on this lane's paths).
- Refactors beyond the listed items: they go to the triage note for Rafa's decision on how far to refine.
- `docs/audit/scope.md`, `.gas-snapshot` and the deployment record (package C9).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
