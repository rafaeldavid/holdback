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

All local runs on 2026-11-12, on branch `t-355-audit-deal-rehearsal` cut from `origin/main` at `2f409e4` (PR 358).

### Test first

- **Before the change (measured).** The new tests failed to import: `CASES`, `rehearse` and the case types were not exported.

### The cases, each one deal on the in-process chain (`examples/audit-deal.test.ts`, measured)

| Case | End state, on both operators | What the test checks besides |
| --- | --- | --- |
| `released` | Released | The seller received 2,000.00 tUSD. The buyer was shown the seven signed fields and `maxSubmissions` (mode `guaranteed_on_decision`, level `public`, the club, three 32-byte hashes, the policy) and one difference from the defaults, `deadlines.deliverWithinSec 604800 -> 345600`. The record's row says Released and its check "postings follow the outcome" passes. The adapter started from the configuration file the run wrote. |
| `redelivered` | Released | The alert callback got two alerts, both with a valid HMAC-SHA256 signature: `delivery.refused` naming the `coverage` check, then `delivery.fixed`. The seller's ready signal answered 202. The record's `deliveredAt` is before `deliverBy`. |
| `rubric` | Released | The offer carries the template's 5-criterion rubric (the buyer's `panel` option), the differences name `rubric`, and the record's `panelDecision` is `accept`. |
| `refunded` | Refunded | The stand-in judges reject after delivery: `panelDecision` `reject`, not reclaimed; the buyer's key holds the price, 2,000.00 tUSD (the adjudication fee paid for the judgment); the seller received 0.00 tUSD. |
| `missed-deadline` | Refunded | The job never finished; the signer's watch reported `deliverBy-passed` and `refunded`, settlement refunded the hold on its reclaim (`reclaimed: true`), and no `delivery.submitted` event exists. The buyer's key holds the hold, 2,001.00 tUSD. |
| `shown-mismatch` | Not funded | An operator front raised the published fee by 100 basis points after the buyer was shown the offer; `checkOffer` refused with `fees.operator is {…}, not the shown {"amount":"200000","token":"tUSD"}`. No `hold.funded` event; the record's `fundedAt` is null. |
| `resume` | Released | The buyer stopped after funding, the adapter restarted from the same file and journal with `seller-shape-a.mapping.json` set, the clock moved 172,800 s (2 days), the restarted adapter converted the seller's own shape (5,106 bytes to 4,938 bytes) and delivered, and `openDeals` on the key store found the deal and opened the report. |

- **The kit's shape (measured).** `fixtures/terms/audit-export.json` (JSON, concrete values, five checks on a job export with `anyOf` branches and the `not: {items: {not: …}}` form) with `fixtures/data/audit-report/export.json`: `check-delivery.ts` says accept, 5 of 5 checks. In the rehearsal, `released` ends Released with the file's price 1,500.00 tUSD, its fee 50.00 tUSD and its 7-day window, and the buyer opens the exact bytes. `redelivered` ends Released after the run cut the report to its first half (1,072 of 2,145 bytes), which the check run refused.
- **The fee (measured, T-330 triage row 1).** With `audit-report-two-files.yaml`, the offer's adjudication fee is the file's 50.00 tUSD, not the adjudicator's minimum of 1.00 tUSD; the hold is 1,284.56 tUSD.
- **The command (measured).** `node examples/audit-deal.ts --case all --out <dir>` exits 0, prints `Case <name>: <end>, as expected. Deal record: <dir>/<name>/deal-record.json` for each of the 7 cases, the faucet ceiling (1,000,000.00 tUSD a deal) and `7 of 7 cases ended as expected.`, and leaves one directory per case. With no arguments it prints the two built-in outcomes, as before, and exits 0.
- **The private kit's terms (measured, by hand, output removed).** `--case released` with the kit's `terms.json` and the partner's mock stops at the quote: the operators refuse the offer with `invalid_terms: offerExpiresAt < fundBy violated`. The kit sets `offerExpiresInSec` and `fundWithinSec` both to 86,400 s; the offer route needs the funding deadline after the offer's expiry. The public fixture uses a funding window of 172,800 s.

### Checks

- `pnpm typecheck` exits 0; `eslint` on the two changed files prints nothing (measured).
- `pnpm exec vitest run examples/audit-deal.test.ts`: 25 tests passed in 48 s, 11 of them new (measured). A 12th new test then takes an unused key from an existing key store, as the live command's `--keys` does: Released, and a second case with the same key stops at "this key already serves … one key, one deal" (measured).

## Decisions

1. **A new function beside the old one.** `rehearse()` runs one case; `runAuditDeal()` keeps the built-in outcomes and the T-326 options, so the command with no arguments, or with `--report` and `--terms` alone, behaves as before. The two share discovery, the file reading, the report route and the formatting.
2. **The adapter starts from a configuration file.** Each case writes `seller-adapter.config.json` (environment variable names only: the seller's key, the alert secret and the ready credential stay in memory) and starts the adapter through `loadConfig`, as a seller does. `resume` restarts it from the same file and journal.
3. **The seller is alerted and says when the fix is ready.** The configuration sets an alert callback (a small server in the run that checks each alert's HMAC) and `redelivery.readyAuth`, with no scheduled refetch: the fixed report goes out on the seller's `POST /deals/<id>/ready`, the T-329 path.
4. **Refunded after delivery needs judgment the seller cannot run first.** On a checks-only deal the adapter runs the adjudicator's own first stage before it delivers, so a report that fails a check is never delivered (the deal stays Held, then the buyer reclaims). The `refunded` case therefore uses a rubric, and the local world's judges are a stand-in this process sets to reject. `rubric` is the same deal with the judges passing. A terms file with no rubric gets the shipped template's optional rubric in these two cases, and the run says so.
5. **The mismatch comes from the operators.** The commitment ID fixes the signed terms, so what can change between showing and signing is what the operators publish. A second pair of origins of the same local world (`two-origins.ts`'s `rewrite`) raises the operator fee in discovery after the buyer was shown the offer. It sends no request, so nothing from a request chooses a host.
6. **The redelivered case's first report.** `--refused-report` names one; without it the run cuts the seller's report to its first half, and refuses to start if the check run would accept that.
7. **Prices without terms.** Without a terms file the buyer approves the price it was shown (the stub prices by `scope.lines`, so `--scope` changes it), within the fee cap of 60.00 tUSD as before. With a terms file it approves the file's price, fee cap and delivery window.
8. **No time limit live.** On the live service every wait is real time and no step has a limit of its own (D31); only the adjudicator's take of a new offer is bounded, at 5 minutes, as before. `refunded` and `shown-mismatch` are refused with `--live`: they need the local world's judges and front. `--live` runs one case.
9. **The local world's ceiling.** Every case prints the faucet's largest grant from discovery (`demo.faucet.maxGrant`, 1,000,000.00 tUSD locally): a deal above it cannot be funded there. The tool adds no limit.

## Handoff

**Done.** `pnpm audit-deal --case <case|all>` with `--report`, `--terms`, `--scope`, `--mapping`, `--refused-report` and `--out`; `--live --case <one>` with `--keys` and `--buyer`; `rehearse()` and the extended `startLocalWorld()` (stand-in judges, operator front); a deal record per case; the terms file's fee in the offer; two public fixtures; 12 new tests.

**Stop and resume works today (measured).** The signer saves the funded deal in its key store, and `openDeals(store)` reopens it in a new process with nothing in memory; `buy-with-signer.ts --stop-after-funding` and `resume <store>` do the same from the command line (T-332). The `resume` case drives that path through the exports.

**For the private kit (package 8): the terms cannot be offered yet.** `offerExpiresInSec` and `fundWithinSec` are both 86,400 s, and the operators refuse an offer whose funding deadline is not after its expiry (`offerExpiresAt < fundBy`). Set `fundWithinSec` above `offerExpiresInSec`, for example 172,800 s, and rebuild `terms.json`.

**The command for the private terms and the partner's mock**, once the kit's funding window is fixed. First the kit's own step, which fills the placeholders with the mock's target, commit and files from a scratch `params.json` (kit README, "How to rerun"):

```bash
node /Users/rafa/Documents/escrow/reports/crow-private/design-partners/partner-a/kit/build-terms.mjs --checkout /Users/rafa/Documents/escrow --terms /Users/rafa/Documents/escrow/reports/crow-private/design-partners/partner-a/kit/terms.yaml --params /Users/rafa/Documents/escrow/reports/scratch/t-344/params.json --out /Users/rafa/Documents/escrow/reports/scratch/t-344/terms.mock.json
```

```bash
pnpm -C /Users/rafa/Documents/escrow audit-deal --case all --report /Users/rafa/Documents/escrow/reports/crow-private/design-partners/partner-a/rafa.json --terms /Users/rafa/Documents/escrow/reports/scratch/t-344/terms.mock.json --out /Users/rafa/Documents/escrow/reports/scratch/t-355-kit
```

The scope only prices the stub's quote here; the kit's checks read the report against the terms. `rubric` and `refunded` add the template's optional rubric to the kit's checks-only terms; with a 149,496-byte mock the panel reads 100,000 characters (package 6). Delete `reports/scratch/t-355-kit` afterwards: its `seller-template.json` copies the kit's checks.

**The live run (Rafa's).** One case on the public test service, with the rehearsal signing key, in a terminal at the repository root:

```bash
pnpm -C /Users/rafa/Documents/escrow audit-deal --live --case released --keys /Users/rafa/Documents/escrow/reports/scratch/rehearsal-keys/signer --buyer 0x15c01fd0877f748f72a572aac5f2d5579af76044 --out /Users/rafa/Documents/escrow/reports/scratch/t-355-live
```

- It binds the rehearsal signing key to that one deal (one key, one deal): a second live case needs another key, or no `--keys` for fresh ones.
- With the kit's terms it also needs the Sepolia token in `price` and `settlement` (the kit keeps `tUSD`) and the funding-window fix above.
- `missed-deadline` live waits the terms' whole delivery window in real time.
- The payment key is not used: the two-address case waits for the contracts' payment-address fields (pilot plan, "The first job with two addresses").

**Doc lines for package 5 (`site/llms.txt`, seller section, after the `--report`/`--terms` line).**

> Rehearse the pilot's cases before you sell: `pnpm audit-deal --case all --report <file> --terms <file>` runs released, redelivered, rubric, refunded, missed-deadline, shown-mismatch and resume on a local chain, through the seller adapter started from one configuration file and the buyer signer, and prints each case's end state and the path of its deal record. `--mapping <file>` sets a report mapping; `--refused-report <file>` names the first report the redelivered case refuses.

**Not changed here, for their owners.** `BuyerSigner` has no way to hand its x25519 key to `dealRecord`, so this file reads it from the key file; `Delivery` does not carry `reclaimed`. Both are in `reports/scratch/t-355-triage.md`, with four more rows.
