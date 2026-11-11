# T-343: the drand verifier, read against its specifications

- **Lane:** research (contracts, read only)
- **Phase:** 2
- **Depends on:** T-209 (the verifier), T-217 (the off-chain proof path), T-206 (the contract review, items I-12 and I-13). Rafa's scope decision SC-8 of 2026-11-11 keeps the on-chain beacon proof in phase one.
- **Paths this task may touch:** `docs/reviews/2026-11-11-drand-verifier-review.md` (new); new files under `contracts/test/` only where a case is not covered, and never a test another package owns; this file. It changes nothing under `contracts/src/`.
- **Human gate:** no. It deploys nothing and sends no transaction.
- **Status:** in progress
- **Agent/session:** Claude Code session on branch `t-343-drand-verifier-review` (2026-11-11)

## Intent

`contracts/src/DrandQuicknetBeacon.sol` verifies a drand quicknet round's BLS signature on chain. The rules contract uses the round's value as the seed of fallback and appeal panels. The file stays in the phase-one contracts and in the audit's scope (SC-8), and nobody on the contract lane has read its arithmetic line by line. This task is package R10b of the contract refinement plan.

Restated: read the 175 lines against two published specifications, the drand quicknet scheme and EIP-2537, and cite the section behind every check. Answer six questions with evidence:

1. Is every constant right, byte for byte?
2. Does the contract accept only a valid signature for exactly the stated round of exactly this chain?
3. Which checks does it leave to the precompiles, and do they perform them?
4. What can a caller who controls the inputs do?
5. What does verification cost in gas (items I-12 and I-13, re-measured)?
6. What can a testnet not show?

The output is a review document. This task fixes nothing. A defect goes to the contract lane with a severity and a reproducing test.

Non-goals: any edit to `contracts/src/`; the off-chain check (`apps/adjudicator/src/drand.ts`); the round selection in `HoldbackRules.decide` (T-225 item 1); a second read by a model of another family, which the plan asks for and this session cannot give.

## Context

- The plan: package R10b in section 7 of the contract refinement plan (kept privately, `docs/private-materials.md`).
- `contracts/src/DrandQuicknetBeacon.sol`, `contracts/src/IHoldbackBeacon.sol`, the call site in `HoldbackRules.decide`.
- Existing tests: `contracts/test/unit/DrandBeacon.t.sol`, `contracts/test/crosscheck/DrandEncodings.t.sol`, `contracts/test/crosscheck/DrandAllRounds.t.sol`, `contracts/test/unit/DrandDecide.t.sol`, `contracts/test/unit/GasPerDeal.t.sol`; the fixture `fixtures/beacon/drand-quicknet.json`.
- `docs/tasks/T-217-drand-proofs-sepolia.md`; ADR-0018 (`docs/decisions/ADR-0018-panel-seed-beacon.md`); items I-12 and I-13 in `docs/reviews/2026-11-03-contract-review.md` §2.3, indexed in `docs/audit/known-issues.md`.
- Specifications: drand's source (`crypto/schemes.go`, `common/time.go`) and the quicknet `/info` endpoint; EIP-2537 and its `field_to_curve` document; RFC 9380; the ZCash serialization of BLS12-381 points; EIP-2565, EIP-7883 and EIP-7823 for MODEXP.

## Acceptance criteria

- [ ] The review is at `docs/reviews/2026-11-11-drand-verifier-review.md`, written to `docs/writing.md`, with each claim labelled measured, documented, inferred or unverified.
- [ ] Every constant is compared with its published value, byte for byte: the public key, the domain separation tag, the field modulus and the exponents derived from it, the negated G2 generator, the genesis time and the period, the round-number encoding.
- [ ] Each of these cases has a test or worked reasoning: a wrong round; a signature on the curve and outside the prime-order subgroup; the identity point as the signature; a malformed length; a non-canonical field element; a valid signature from another drand chain.
- [ ] The review names each check the contract leaves to a precompile, cites where EIP-2537 requires it, and names any check that neither performs.
- [ ] The review states what a caller who controls the inputs can do: make a valid round revert, burn gas, or get a value for an invalid proof.
- [ ] Gas: items I-12 and I-13 are re-measured with `forge test --gas-report`, with units.
- [ ] The review lists what a testnet cannot show, as lines for the plan's mainnet gate.
- [ ] New tests, if any, are new files under `contracts/test/`, and `forge test --root contracts` passes.
- [ ] One `red-teamer` pass tries to forge an accepted proof or break a valid one, with the contract and the two specifications and without this review's conclusions.
- [ ] The review says what the second-family read still needs.

## Out of scope

- Fixing a defect. The contract lane (T-334 and the packages after it) owns `contracts/src/`.
- The hardening items of T-225 (the fallback round's timing, relay outages, answer size).
- A deploy, a transaction, or anything sent to another party.

## Evidence

## Decisions

## Handoff
