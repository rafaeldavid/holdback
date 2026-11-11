# T-326: the local audit deal takes a custom report and terms

- **Lane:** demo (examples), test
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4 (API and example code), from the Change recipes in `docs/team.md`: the examples' tests, no review, a target of 150k tokens
- **Depends on:** T-321 (the audit deal end to end, PR 290), T-316 (the seller's check runner, PR 278)
- **Paths this task may touch:** `examples/audit-deal.ts`, `examples/audit-deal.test.ts`, new files under `fixtures/data/audit-report/` and `fixtures/terms/`, `vitest.config.ts` (a cost line for a new test file only), `site/llms.txt` (only the lines that describe the local audit deal), this file. Never: `packages/`, `apps/`, `spec/schemas/`, `contracts/`, `examples/seller-adapter.ts` and its stub, template and test (T-323, T-324), `examples/buyer-signer.ts` (T-325), `examples/check-delivery.ts` (T-327).
- **Human gate:** no. The run is local, on SimChain; it deploys nothing and uses no keys.
- **Status:** in progress
- **Agent/session:** the T-326 session, 2026-11-11, branch `t-326-audit-deal-custom-report`; roadmap row N64

## Intent

**Why.** `examples/audit-deal.ts` (T-321) runs one security-audit deal end to end, but only with the built-in sample report and the built-in terms. A seller can run its own report through the check runner (`examples/check-delivery.ts`), which says what the adjudicator's first stage will say. It cannot run that report through a whole deal: quote, hold, delivery and release. So a seller cannot see its own report settle under its own terms before it sells with them.

**Goal.** A seller names a report file and a terms file on the command line, and the local deal runs with them:

- the seller's API returns the named report's bytes unchanged as the job's result;
- the seller's adapter offers the named terms: their deliverable, checks, rubric, price and windows;
- the buyer approves against the same terms file, not against whatever the offer says;
- the deal ends `Released` when the report passes;
- when the seller's check run refuses the report, the adapter delivers nothing, the run stops with the commitment still `Held`, and it prints each check that failed.

**Inputs.** A report file (any bytes; the terms' format decides how the checks read it) and a terms file in the shape of `fixtures/terms/audit-report.yaml` (YAML or JSON, relative windows). Either one alone works: the other is the built-in one.

**Outputs.** `pnpm audit-deal --report <file> --terms <file>` and the same options on `runAuditDeal`; tests for a custom report that is released, a custom report that is refused, and a terms file that fails the commitment schema; one or two new fixture files.

**Non-goals.**
- No change to the adapter, the stub, the signer or the check runner: the deal calls them as they are, through their exported functions.
- No live Sepolia run, and `--report` and `--terms` run on the local world only.
- No limit on any amount or window the encoding represents (D31). Only malformed terms are refused.
- No new protocol value: the terms the offer route cannot make (another settlement mode, disclosure level or submission count) are refused with the reason, not run differently.

## Context

- `docs/tasks/T-321-audit-deal-end-to-end.md`: the deal, its two outcomes, and the gaps it ranked (item 6: terms are the seller's template).
- `examples/seller-adapter.ts`: `startSellerAdapter` takes a template file (`deliverable`, `checks`, `rubric`) and windows from its configuration; a quote's `deliverWithinSec` replaces the delivery window.
- `examples/seller-adapter-stub.ts`: the stub prices by scope and takes a `quoteOverride`; it serves only its built-in report.
- `packages/testkit/src/fixture-files.ts`: `loadTermsFile` checks a terms file as a full commitment against `spec/schemas/commitment.schema.json` and names the field it refuses.
- `apps/operator/src/terms.ts`: the offer route sets `maxSubmissions` 1, settlement `guaranteed_on_decision`, remedy `full_refund` and disclosure `public`, and takes the adjudication fee from the adjudicator's registration.
- `CLAUDE.md`, hard rules: deliverables are untrusted; no code execution from commitments or deliverables; money is base units as a decimal string.

## Acceptance criteria

- [ ] The local audit deal runs end to end with a report file and a terms file named on the command line.
- [ ] It ends `Released` when the report passes (test, with a report that is not the built-in one).
- [ ] It ends with no delivery and the commitment still `Held` on both operators when the seller's check run refuses the report, and it prints which check failed (test).
- [ ] A terms file that fails the commitment schema is refused before any deal opens, with a message that names the field (test).
- [ ] With no arguments it behaves as today: both built-in outcomes, exit 0.
- [ ] `pnpm typecheck`, `pnpm lint` and the examples' tests pass.

## Out of scope

- A live run with a custom report, and a custom scope on the command line.
- Changing what the offer route can offer (settlement mode, disclosure level, submission count, the adjudication fee).

## Evidence

All local runs on 2026-11-11, on branch `t-326-audit-deal-custom-report` cut from `origin/main` at `a310279` (PR 301).

### Test first

- **Before the change (measured).** `pnpm build` failed on the new tests: `parseArgs` not exported, `reportFile` and `termsFile` not options, `failedChecks` not a result field.

### The deal with a seller's own files

- **Released (measured).** `examples/audit-deal.test.ts`, the two-files report (`fixtures/data/audit-report/report.two-files.json`, 2 findings) under `fixtures/terms/audit-report-two-files.yaml`: the deal ends Released on both operators. The offer carries the file's deliverable and acceptance, a price of 1,234.56 tUSD, a delivery deadline 172,800 s (2 days) after creation, and the file's offer, funding and appeal windows. The seller receives 1,234.56 tUSD. The buyer opens the file's exact bytes, with the file's sha256, and its own run of the 5 checks says accept. No secret key and no finding title reaches the output.
- **Refused (measured).** The same terms with `report.two-files.missing-file.json`: the adapter's preflight fails `coverage (required): schema: /filesReviewed: fewer than 2 items` and delivers nothing. Both operators show the commitment Held; its events hold `hold.funded` and no `delivery.submitted`; the seller receives 0.00 tUSD. The run's last two steps are "The seller does not deliver" and "The deal stays Held", and it prints the failed check.
- **A report file alone (measured).** The built-in sample, named with `--report`, runs under the built-in terms and ends Released with 2,000.00 tUSD to the seller.
- **Terms refused before any deal opens (measured).** Eight terms files, each refused with a message naming the field and with no "The seller starts" line: a price of `"1234.56"` (`/price/amount`), no `deliverable.format`, an unknown key (`terms.colour`), `maxSubmissions: 2`, optimistic settlement (`/timing` needs `disputeBy`), a `judgment` disclosure level (needs `privateTerms`), a settlement token other than the price's, and a price in `tUSDX` on a layer that holds tUSD. A report file that does not exist is refused as unreadable.
- **The command (measured).** `node examples/audit-deal.ts --report … --terms …` exits 0 and prints `Result: Released.`; with the missing-file report it exits 1, prints the failed check and `Result: Held.`; `--terms` with no file exits 2 with the usage. By hand, the refused run takes 0.6 s from start to `Held`.
- **No arguments, as before (measured).** `pnpm audit-deal` runs the released outcome (Released in 0.6 s, 2,000.00 tUSD to the seller) and the refused one (Refunded in 0.9 s after the clock moved 345,601 s), and exits 0.

### Checks

- `pnpm typecheck` exits 0; `pnpm lint` prints nothing (measured).
- `pnpm exec vitest run examples/audit-deal.test.ts`: 11 tests passed, the 5 from T-321 and 6 new (measured).
- `pnpm exec vitest run examples/`: 20 files; 186 tests passed and 13 skipped, in 122 s (measured).
- `node site/build.mjs && node site/check.mjs`: "site check PASS"; the build changed no generated file (measured).
- Not run: the full `pnpm verify` and gitleaks; CI runs both gates.

## Decisions

1. **The seller's API is the stub plus a result route.** The stub serves only its built-in report, and its file belongs to another session. `audit-deal.ts` serves the report file's bytes at a result address of its own and asks the stub whether the job exists and is complete. The quote and the start still go to the stub.
2. **The terms file is the testkit's terms format.** `parseTermsYaml` already checks a terms file as a full commitment and names the field it refuses, so a seller writes the same file it would use elsewhere (`fixtures/terms/audit-report.yaml`). JSON works, being YAML.
3. **What the terms file sets, and what it does not.** The adapter offers its deliverable, checks, rubric and seven windows, and the quote carries its price and delivery window. The club, the adjudicators, the policy and the adjudication fee come from discovery, as in every deal the adapter makes; the run says so on its second line. The buyer caps the fees at the file's adjudication fee plus the operator fee the operators publish, so a world fee above the file's would stop the buyer before it signs.
4. **One refusal of our own.** Terms whose settlement token is not the price's token are refused: the offer route settles in the price's token and would offer other terms. The other kinds the route cannot make (another submission count, optimistic settlement, a private level) fail the commitment parser first, so no code here checks them again.
5. **A refused report stops at Held.** The built-in refused outcome still waits out the deadline and reclaims, as before. With the seller's own files the point is to learn whether the report settles: the run names the failed checks, from the check library run again on the bytes the seller's API returned, and stops with the hold funded.
6. **Exit codes follow `check-delivery.ts`.** With a seller's own files: 0 Released, 1 the report does not settle (Held, or Refunded after a judgment), 2 the run could not start or stopped on an error. Without them, any failure still exits 1, as before.
7. **Local only.** `--live` with `--report` or `--terms` is refused, as the brief keeps this task off Sepolia.

## Handoff
