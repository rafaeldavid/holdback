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

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
