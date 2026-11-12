# T-355: the audit deal rehearses the pilot's cases end to end

- **Lane:** demo (examples), test
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4 (API and example code), from the Change recipes in `docs/team.md`: the examples' tests, no review, a target of 150k tokens
- **Depends on:** T-326 (a seller's own report and terms, PR 308), T-329 (the refused-report redelivery, PR 317), T-330 (terms per quote, PR 316), T-331 (the adapter's one configuration file), T-332 (the buyer signer shows and checks every signed field, PR 320), T-333 (the deal record), T-323 (the report converter)
- **Paths this task may touch:** `examples/audit-deal.ts`, `examples/audit-deal.test.ts`, the `audit-deal` line in the root `package.json`, new files under `fixtures/`, `vitest.config.ts` (a cost line for a new test file only), this file. Never: `examples/seller-adapter.ts`, `examples/buyer-signer.ts`, `examples/deal-record.ts` and their tests, `site/llms.txt`, `packages/`, `apps/`, `spec/schemas/`, `contracts/`, anything under `reports/crow-private/`.
- **Human gate:** no for the local run. A live run on Sepolia is Rafa's: this task builds the option and gives the command, and does not run it.
- **Status:** in progress
- **Agent/session:** the T-355 session, 2026-11-12, branch `t-355-audit-deal-rehearsal`; pilot plan package 3 (crow-private `roadmap/plans/2026-11-11-pilot-refocus.md`, section 7.1)

## Intent

**Why.** In the pilot Crow buys an audit of its own contracts from design partner A and pays through its own escrow. Before the real deal, Crow wants to see each way the deal can go, with the seller's own report and terms, through the same code the pilot uses: the seller adapter started from one configuration file, and the buyer signer that shows every signed field. Today `examples/audit-deal.ts` runs one deal with a seller's files and stops at `Held` when the report is refused. It does not redeliver, reclaim with the signer, stop and resume the buyer, or leave a deal record.

**Goal.** One command runs every case of the pilot on the in-process chain, and prints for each case its end state and where its deal record is:

| Case | What happens | End state |
| --- | --- | --- |
| `released` | The report passes the checks; the seller is paid | Released |
| `redelivered` | The seller's check run refuses a first report; the seller is alerted; it fixes the report and says so; the fixed report is delivered before the deadline | Released |
| `rubric` | The buyer's terms carry a rubric; the report passes the checks and the panel | Released |
| `refunded` | The report passes the checks the seller can run, and the panel, which runs only after delivery, rejects it | Refunded |
| `missed-deadline` | The seller never delivers; the buyer's signer reclaims the hold after the deadline | Refunded |
| `shown-mismatch` | The offer read back before signing differs from the one shown; the signer refuses and signs nothing | not funded |
| `resume` | A days-long job: the buyer stops after funding, the seller's adapter restarts with a report mapping set, and the buyer resumes from its key store days later | Released |

In every case the buyer is shown every signed field and what differs from the seller's published defaults before it approves.

**Inputs.** Optional: the seller's report (`--report`), its terms (`--terms`, the shape of `fixtures/terms/audit-report.yaml`, as the private kit's terms are), the buyer's scope (`--scope`, JSON), a report mapping (`--mapping`), a refused first report for `redelivered` (`--refused-report`), a case (`--case <name>` or `all`), an output directory (`--out`). For a live run: `--live`, one case, and a buyer key store and address (`--keys`, `--buyer`).

**Outputs.** The cases in `runAuditDeal` and the command; a deal record (`examples/deal-record.ts`) for each case; a test for each case; the T-330 triage fix (the terms file's adjudication fee reaches the offer).

**Non-goals.**
- No change to the adapter, the signer, the deal record or their tests: this file calls their exports. What one of them lacks goes in the Handoff.
- No live run: the option is built and the command written down for Rafa.
- No two-address case: it waits for the contracts' payment-address fields (pilot plan, "The first job with two addresses").
- No limit on amounts or windows (D31). The tool states the local world's faucet ceiling, the most one deal can cost there.
- The report, the mapping and the terms stay data: nothing from them runs or chooses a request's host.
- With no arguments the command behaves as before: the built-in released and refused outcomes.

## Context

- Pilot plan section 4 (the pilot step by step, "The first job with two addresses") and section 7.1, package 3.
- `docs/tasks/T-326-audit-deal-custom-report.md`, T-329, T-330, T-331, T-332, T-333: their Handoff notes.
- `examples/seller-adapter.ts`: `loadConfig`, `startSellerAdapter`, `alerts`, `redelivery`, `reportMapping`, `GET /defaults`.
- `examples/buyer-signer.ts`: `readOffer` with `defaults`, `checkOffer` against what was shown, `agreeAndFund`, `openDeals` and `openDelivery` (the watch reclaims after `deliverBy`).
- `examples/deal-record.ts`: `dealRecord(id, {operators, party, encryptionSecretKey})`.
- `reports/scratch/t-330-triage.md`, row 1: `templateOf` drops the fee.

## Acceptance criteria

- [ ] `pnpm audit-deal --case all` runs every case on the in-process chain and prints, per case, the end state and the deal record's path.
- [ ] A test covers each case, with the end state on both operators and the deal record's row.
- [ ] The buyer is shown the seven signed fields and the differences from the defaults before it approves; a mismatch between shown and read back stops the signing (test).
- [ ] Stop after funding and resume from the key store works, or the Handoff says plainly what is missing.
- [ ] The terms file's adjudication fee reaches the offer (test).
- [ ] The tool takes the private kit's terms shape, tested with a public fixture of the same shape; the Handoff gives the exact command for the private terms and mock.
- [ ] With no arguments it behaves as before.
- [ ] `pnpm typecheck`, `pnpm lint` and the examples' tests pass.

## Out of scope

- A live run, the two-address case, alerts to Slack (Rafa, 2026-11-11: skipped for now).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
