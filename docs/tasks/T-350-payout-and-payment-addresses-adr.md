# T-350: The decision record for the seller's payout address and the buyer's payment address

- **Lane:** research
- **Phase:** 2
- **Depends on:** T-342 (ADR-0031, the phase-one contract scope, section 11)
- **Paths this task may touch:** `docs/decisions/` (one new ADR), `docs/decisions-today.md` (new lines only), this file
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** t-350 session, branch `t-350-payout-and-payment-addresses-adr`
- **Change kind:** 10, research and decisions (`docs/team.md`, Change recipes): docs only, a target of 200k tokens

## Intent

Rafa decided on 2026-11-11 that each party's money moves through an address apart from the address that signs. The seller gets a payout address, where it is paid. The buyer gets a payment address, which funds the hold and receives every refund. ADR-0031 section 11 records the decision and designs nothing.

This task writes the design as one ADR, exact enough that the contract package builds from it alone and an auditor can check the build against it. It settles the two fields in the signed terms, what the contract does with them in every outcome, who signs what, how per-deal keys use them, the tooling's defaults and warnings, what stays out of phase one and how it returns, and the design's standing against the three litmus tests and the threat model.

Inputs: Rafa's words of 2026-11-11, ADR-0031, the contracts on `origin/main`, the vendored escrow, the test token, the schema, core's typed data, ADR-0024 and ADR-0029, and the audit pages.

Outputs: one ADR with status Proposed, one new entry in `docs/decisions-today.md`, and this file.

Non-goals: no code, no schema edit, no change to the audit pages, and no redesign of what Rafa decided.

## Context

- ADR-0031, section 11, and D58 item 5 with its amendment: the decision in principle.
- `contracts/src/HoldbackRules.sol` and `HoldbackTypes.sol`; Commerce Payments' `AuthCaptureEscrow.sol` and its ERC-3009 collector at `6b0a5ef` (v1.1.0); `contracts/script/TestUSDC.sol`.
- `spec/schemas/commitment.schema.json`, `packages/core/src/eip712.ts`, `examples/verify.ts`.
- ADR-0024 (per-deal keys and the `Delegation`), ADR-0029 (the last change to a signed type, and how the recordings were re-seated), ADR-0023 (the operator fee).
- `docs/audit/state-model.md` and `docs/audit/threat-model.md`.

## Acceptance criteria

- [ ] The ADR settles the seven points of the brief, each with a reason: the fields, what the contract does with them, who signs what, per-deal keys, defaults and warnings, what stays out and the way back in, and the litmus tests with the threat model.
- [ ] Every claim about the code cites a file and a line at a named commit.
- [ ] The ADR lists the tests the contract package must add and the proof each of the two tooling packages must carry.
- [ ] The ADR lists the open points that are Rafa's.
- [ ] `docs/decisions-today.md` gains one entry with the next D number, which points at the ADR and quotes Rafa's words for each decision.
- [ ] One `red-teamer` pass attacks the design without the author's reasoning, and the ADR answers each finding.
- [ ] No private roadmap ID and no partner's name appear in the public repository.

## Out of scope

- Any file under `contracts/`, `spec/`, `packages/`, `apps/`, `examples/`, `docs/audit/` or `site/`.
- The build itself: the contract package and the two tooling packages are separate tasks.
- A refund to an address other than the payer, payouts to a third address, and changing the receivable address after signing. The ADR says how each returns; it designs none.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

## Handoff

What is done, what is not, how to resume, and the open questions that remain.
