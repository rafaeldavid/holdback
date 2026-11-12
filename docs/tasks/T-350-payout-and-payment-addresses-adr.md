# T-350: The decision record for the seller's payout address and the buyer's payment address

- **Lane:** research
- **Phase:** 2
- **Depends on:** T-342 (ADR-0031, the phase-one contract scope, section 11)
- **Paths this task may touch:** `docs/decisions/` (one new ADR), `docs/decisions-today.md` (new lines only), this file
- **Human gate:** no
- **Status:** done
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

- **What was written** [measured: the files exist on the branch]: `docs/decisions/ADR-0033-payout-and-payment-addresses.md` (Proposed), the entry D60 in `docs/decisions-today.md`, and this file.
- **What was read** [measured]: `contracts/src/HoldbackRules.sol` and `HoldbackTypes.sol` at `5a90dc5`; the vendored `AuthCaptureEscrow.sol`, `ERC3009PaymentCollector.sol`, `TokenCollector.sol`, `ERC6492SignatureHandler.sol` and `TokenStore.sol` at `6b0a5ef`; Solady's `SignatureCheckerLib.sol` at `5ea5d9f`; `contracts/script/TestUSDC.sol` and `LocalUSDC.sol`; `packages/core/src/eip712.ts`, `state.ts` and `mutual.ts`; `packages/settlement/evm/encode.ts` and `evm-settlement.ts`; `examples/verify.ts`; `spec/schemas/commitment.schema.json`; ADR-0024, ADR-0029 and ADR-0031; `docs/audit/threat-model.md` and the register in `state-model.md`.
- **Nothing was run.** Kind 10 has no local checks (`docs/team.md`, Change recipes). Every claim in the ADR about behaviour is labelled measured (read at the line) or inferred.
- **The plan's claim about the test token holds** [measured by reading]: `TestUSDC.sol:92` checks every authorization with Solady's `isValidSignatureNow`, which asks a contract through ERC-1271 (`SignatureCheckerLib.sol:62-71`). No test covers it; the contract package adds one.
- **Red team** [measured: the report is `reports/scratch/t-350-redteam.md` in the main checkout, not committed]: one `red-teamer` pass, reading only. No Critical and no High. 2 Medium, 5 Low and 9 Info findings, each answered in ADR-0033 section 12. Before the answers were written, eight of its cited lines were read again and matched.
- **Numbers taken** [measured against `origin/main` and the open pull requests]: ADR-0033 and D60. ADR-0032 and D59 belong to T-348 (PR 345, merged before this one), ADR-0034 and D61 to T-351.
- **Tokens** [measured for the subagent, not for the session]: the red team used 326,091 tokens. The session's own use was not read. The task passed its 200k target.
- Snapshot diffs: none; no code changed.

## Decisions

All are in ADR-0033; Rafa may overrule any of them.

1. **The names:** `buyerPaymentAddress` and `sellerPayoutAddress`, after `seller`, both required.
2. **One new event,** `SettlementAddresses`; no existing event changes.
3. **A settlement's payouts name the two new addresses,** not the signing addresses.
4. **Versions:** schema v0.11, EIP-712 domain and `commitment.schemaVersion` 0.8.
5. **The appeal bond stays with the address that signs the appeal** on the full protocol (the red team's M-1).
6. **The refund sweep is dropped,** because a standing payment address makes it unnecessary.
7. **Later third-address work arrives as a signed message beside the terms,** so the terms do not change again.

## Handoff

**Done.** ADR-0033 and D60 are on `main`: PR 353 merged on 2026-11-11 as `387c934`, after `check`, `gitleaks`, `changes` and CodeQL passed [measured: `gh pr checks 353`]. The code jobs were skipped, as for every change that touches only `docs/`.

**Not done, by design.** No code, no schema, no audit page. The three building tasks read ADR-0033: section 2 and section 4 for the contract package, section 10 for each package's tests and proofs.

**For the task that owns `docs/audit/`:** ADR-0033 section 11 lists the seven edits the state model, the threat model and the events inventory need once the contract package lands.

**For the contract package's owner:** it starts after ADR-0031's cuts of Permit2, third-party payouts, and appeals and bonds have merged. ADR-0033 section 2 says what else changes if it starts earlier.

**After the merge: Rafa's answers (D62, 2026-11-11).** The field names are final and the `SettlementAddresses` event stays. The third point, an appeal window of 0 in v0.11, reached him the wrong way round and stays open; ADR-0033's section "Rafa's answers, and the points still open" has it with two options and a recommendation. The list below is the one the first PR carried.

**Open points that are Rafa's** (ADR-0033, as first written): the two names, the new event, whether ADR-0031's schema candidate rides in v0.11, the pilot's payment address, and the Sepolia redeploy. None blocks the contract package.

**A merge note.** PR 345 (T-348, D59) merged first. This branch merged `origin/main` and kept both entries: D59, then D60.
