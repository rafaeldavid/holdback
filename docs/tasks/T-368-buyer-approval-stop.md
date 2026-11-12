# T-368: The buyer's command stops for approval, and a buyer completes a deal on the local simulator

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-319, T-330, T-332, T-359
- **Paths this task may touch:** `examples/seller-adapter.test.ts` (two lines, see Handoff), `examples/buy-with-signer.ts` and its tests (`examples/buy-with-signer.test.ts`, the command's test in `examples/buyer-signer.test.ts`, the command's test in `examples/audit-deal.test.ts`), `examples/buyer-signer.ts` (one getter), `examples/audit-deal.ts` (the approval names its commitment ID), `apps/operator/src/sim-world.ts` and its test (the sim's faucet), the buyer step in `site/llms.txt`, the section "A seller's client can carry the buyer's side" in `site/sell.txt`, this file
- **Human gate:** no (the site deploy that publishes the doc lines is Rafa's)
- **Status:** review
- **Agent/session:** T-368 implementer session, change kind 4 (tooling)

## Intent

The buyer carries the burden of acceptance (D28), so it must see exactly what it signs before it pays. The library (`buyer-signer.ts`) can refuse an offer that differs from what the buyer approved, but the command a seller ships (`buy-with-signer.ts`) used to fund in the same run as it showed the offer: it approved whatever it had just read. This task puts a stop in the command, on by default: it shows the whole offer and every difference from the seller's defaults, then exits without signing or paying, and prints the one command that funds exactly that offer by its commitment ID. The approve run reads the offer again from every operator and funds only if it is the same; anything changed is refused, naming the field. An unattended agent approves in one run with a file of its own terms, which must state every term but the price; there is no flag that funds whatever comes back.

Second, on `pnpm sim` no shipped buyer could fund an offer, because the sim's faucet gave a fresh key tokens and no mandate. The smaller of T-359's two fixes closes it: the sim's faucet admits the address as the test service's faucet does. The live test service (`apps/demo-cloud`) does not change.

Non-goals: no protocol or API machinery for limits or mandates (Rafa, 2026-11-12: spending limits are client-side); no change to the seller adapter, to the rest of `site/sell.txt`, or to the one-command client.

## Context

- `CLAUDE.md`, "Agreed terms bind; the buyer carries the burden of acceptance"; hard rules on signed messages and secrets.
- T-332 (the signed fields the signer shows), T-330 (differences from the defaults), T-355 (the rehearsal), T-359 Handoff (the simulator gap and its two fixes).

## Acceptance criteria

- [x] The default run stops before funding, with exit status 3, and moves no money: no agreement, no funding, no faucet grant.
- [x] It prints the whole offer: every signed field, the price, both fees and the total, the deadlines as times and windows, the adjudicators, each difference by field; seller text goes through `printable`.
- [x] Its last stderr line is the exact approve command; run as printed, it funds that offer.
- [x] An approval for an ID no stop showed is refused; nothing is funded. An offer above the budget is shown whole and gets no approve line.
- [x] An offer changed between the stop and the approval is refused, naming the field (`fees.operator`).
- [x] An unattended run with `--expect-terms` funds a matching offer in one run, stops on a differing one naming each field, and refuses a file that leaves a term out.
- [x] `--stop-after-funding` on the approve run, then `resume`, still work; approving a funded deal again pays nothing twice.
- [x] On the sim world, a seller's own adapter configuration file and the buyer's command reach a delivered deal.
- [x] `pnpm audit-deal --case all` passes, with both approvals naming the commitment ID.
- [x] `pnpm typecheck`, `pnpm test`, `pnpm lint`, `node site/build.mjs && node site/check.mjs` pass.

## Out of scope

- The two stale lines in `site/sell.txt` "First hour" (step 5 says no shipped buyer funds an offer on `pnpm sim`; step 9's buyer command now stops for approval first). They belong to T-366's part of the page; see Handoff.

## Evidence

- Commands run and results (measured, 2026-11-12):
  - `npx vitest run examples/buy-with-signer.test.ts`: 4 tests passed, about 7 s.
  - `npx vitest run apps/operator/src/sim-world.test.ts examples/buyer-signer.test.ts examples/audit-deal.test.ts examples/buy-with-signer.test.ts`: 4 files, 90 tests passed.
  - `pnpm audit-deal --case all --out reports/scratch/t-368-audit`: "7 of 7 cases ended as expected", exit 0.
  - `node site/build.mjs && node site/check.mjs`: PASS.
  - `pnpm typecheck`, `pnpm lint`: pass. `pnpm test`: 156 files passed, 12 skipped; 3,188 tests passed, 171 skipped (before the review fixes; the three command test files pass again after them, 66 tests).
- Review (one reviewer pass, 2026-11-12): ISSUES, all fixed. (1, blocking) A run over budget saved the shown offer without printing it, so an approve naming an ID read from the key file funded an offer nobody saw: the over-budget run now prints the whole offer (`approval: "over-budget"`, no approve line) and exits 1. (2) The sim listed genesis mandates only, so a seller adapter waited about 60 s for the faucet's mandate: fixed (see Outside the listed paths). (3) A misspelt key in the terms file was dropped: unknown keys are refused. (4) `--expect-terms` with no file was ignored: refused. (5) A store path with a control character gave an unrunnable approve line: refused before any key is made. (6) The stop took budgets the approve run refused: one decimal rule for both. Each has a test.
- Snapshot diffs: none.
- Metrics: `buy-with-signer.ts` is 50 lines (was 19); its test's limit moves from 20 to 50 lines.

## Decisions

- **Exit status 3 means "stopped for approval".** 0 is done (or funded, with `--stop-after-funding`), 1 an error or a refusal, 3 the stop. The offer goes to stdout as one JSON object (`approval: "needed"`, the offer, `differences`, `approve`), so an agent reads the ID without parsing prose.
- **Approval by commitment ID, in a second run.** The ID hashes the terms, which hold the per-deal buyer key and `createdAt`, so no one can know it before the quote (inferred from `verify.ts`, `commitmentIdOf`). The approve run uses the library's `checkOffer` with the shown offer as the approval: every operator must serve the same terms under that ID, and the fees, differences and signed fields must equal what the stop showed.
- **An unattended agent approves with `--expect-terms <file>`,** not with a flag. The file has the defaults' format and must name all seven windows, the fee, the three adjudicators and `maxSubmissions`, so the seller cannot set an open term; `price` and `seller` are optional and compared when given; the budget bounds the total either way. Zero differences fund in one run; any difference stops with the same approve line.
- **The faucet call moves after the check.** The approve run reads the offer again before it asks the faucet, so a refused offer gets no test funds.
- **The sim's faucet signs a mandate with a world principal of its own** (`sim-faucet-principal`), wide scope, buyer and seller, a year, through `SimChain.admit`, which the public world already uses. A genesis account that calls the faucet gets a fresh mandate with the same scope.

## Handoff

**Done.** The approval stop, the approve step, `--expect-terms`, the sim's faucet, the tests, the rehearsal's explicit approvals, and the two doc sections.

**What a buyer runs.**

1. The stop (exit status 3; nothing is signed or paid):
   ```bash
   HOLDBACK_OPERATORS=<op1>,<op2> node examples/buy-with-signer.ts <quote URL> <key directory> '<scope as JSON>' <the most you pay, base units> <defaults URL>
   ```
2. The approval, as the stop's last stderr line prints it:
   ```bash
   HOLDBACK_OPERATORS=<op1>,<op2> node examples/buy-with-signer.ts approve <key directory> <commitment ID> <the most you pay, base units>
   ```
3. Unattended, in one run: add `--expect-terms <file>` to the first command.

On `pnpm sim`, `<op1>,<op2>` are the two operators it prints, and the quote and defaults URLs are the adapter's `/quote` and `/defaults` (started with `--sim`).

**For R6c-3 (`contracts-audit-ready`: the payment address and the funding signature by an outside wallet).** Keep the stop before either payment message is signed: the stop path must call no `testFunds`, `checkOffer` or `agreeAndFund`, and an outside wallet's signature must be asked for only inside `pay`, after `checkOffer` passed in the approve run (or the one-run `--expect-terms` path). Show the payment address in the stop's JSON with the other signed fields, so the approval covers it, and add it to `OFFER_FIELDS` in `buyer-signer.ts` so a change between the stop and the approval is refused by name. The approve line must carry whatever the outside wallet needs, never a key.

**For T-366's part of `site/sell.txt` ("First hour").** Two lines are now stale: step 5 says no shipped buyer funds an offer on `pnpm sim` (it does now, and the page's "A seller's client can carry the buyer's side" says how), and step 9's buyer command now stops for approval and prints the approve line. Not changed here: outside this task's paths.

**Outside the listed paths.** `examples/seller-adapter.test.ts` (T-366's lane) asserted the old sim faucet: "the SimChain faucet grants tokens only", so a fresh seller key could not start. Its two lines now check that the adapter refuses with `mandate.fromFaucet: false` and starts with the faucet's mandate. The sim's `GET /v1/agents/<address>` also lists the mandates the faucet admitted (`SimChain.agentMandates`), as the public world's does; before, it listed genesis mandates only, and the adapter would wait about 60 s for a mandate that never appeared there.

**Left as they are (review, minor).** The approve line prints `HOLDBACK_OPERATORS` as set: an operator URL with a credential in it would be printed. The comments at the top of `apps/demo-cloud/src/world.ts` contrast its faucet with `pnpm sim`'s, which now also grants a mandate (outside this task's paths). Older than this change: a run that dies after the funding is submitted and before it is saved makes the next approve run wait in `checkOffer` for `AcceptedByAdjudicator` and stop, never reaching `agreeAndFund`'s recovery branch; `resume` does not cover it either, since nothing was saved as paid.

**What waits for a site deploy.** The new lines in `site/llms.txt` section 6 and `site/sell.txt` reach crow.direct only with `pnpm site:deploy` (Rafa's).

**How to resume.** `npx vitest run examples/buy-with-signer.test.ts`; `pnpm audit-deal --case all`.
