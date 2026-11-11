# T-332: the buyer signer shows and checks every field the buyer signs

- **Lane:** examples (client code)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, example and client code (Change recipes): the examples' tests, one reviewer pass before merge (it changes what a buyer signs), a target of 150k tokens.
- **Depends on:** T-330 (PR 316, the shown-versus-signed check), T-325 (PR 314, the quorum setting).
- **Paths this task may touch:** `examples/buyer-signer.ts`, `examples/buyer-signer.test.ts`, `examples/buyer-signer-outcome.test.ts`, `examples/buy-with-signer.ts`, this file. Never: `site/llms.txt` (the doc lines go in Handoff for the later seller's-page package), `examples/seller-adapter.ts` and its files (T-331), `examples/audit-deal.ts`, `examples/agent.ts`, `examples/verify.ts`, `packages/`, `apps/`, `spec/schemas/`, `contracts/`.
- **Human gate:** no.
- **Status:** done (PR 320, merged 2026-11-11 at 21:23 UTC, merge commit `9466ee5`)
- **Agent/session:** the T-332 session, 2026-11-11, branch `t-332-buyer-signer-signed-fields`
- **Pilot plan:** package 1 (crow-private `roadmap/plans/2026-11-11-pilot-refocus.md`, section 5)

## Intent

T-330's reviewer found the gap (`docs/tasks/T-330-terms-per-quote.md`, Handoff, item 4).

**Problem.** `examples/buyer-signer.ts` shows the buyer's agent the price, the fees, the deliverable, the checks, the rubric, the deadlines and the adjudicators, and refuses to sign when any of them differs from what was shown or approved. Seven other fields of the signed `CommitmentTerms` reach the signature without being shown or checked: `settlement.mode`, `disclosure.level`, `clubId`, `rulebookHash`, and the adjudication's `policyId`, `policyHash` and `registryHash`. A seller can pick another club, another rulebook, another settlement mode or another judging policy, and the buyer signs it unseen. Under D28 the buyer carries the burden of acceptance, so it must see what it signs.

**Goal.** The signer shows each of the seven before the buyer's agent approves, checks each against an expectation, and refuses to sign on a mismatch, naming the field.

- `Offer` carries the seven: `settlement.mode`, `disclosure.level`, `clubId`, `rulebookHash`, `policyId`, `policyHash`, `registryHash`.
- `checkOffer` compares each, read again from every operator, with what `readOffer` showed and with what the buyer approved (when the approval names it).
- Each is also checked against an expectation that comes from the buyer's configuration or from what every operator publishes, never from the seller:
  - `settlement.mode`: the buyer's `expect.settlementMode`; without it, a mode every operator's discovery lists in `settlementModes`.
  - `disclosure.level`: the buyer's `expect.disclosureLevel`; without it, `public`, the one level whose terms this file can read.
  - `clubId`: the buyer's `expect.clubId`; without it, the demo club every operator's discovery names. With neither, the signer refuses and names the setting.
  - `rulebookHash`: the club's hash as every operator serves it (`GET /v1/clubs/<clubId>`, checked against the rulebook), and the buyer's `expect.rulebookHash` when set.
  - `policyId`, `policyHash`, `registryHash`: the primary adjudicator's registration as every operator serves it (`GET /v1/adjudicators/<primary>`, the policy hash checked against the policy), and the buyer's expectation for each when set.
- `buy-with-signer.ts` prints the seven at the approval.

**Inputs.** The terms every operator serves, the seller's signature, every operator's discovery, club and adjudicator reads, and the buyer's `Options.expect`.

**Outputs.** The seven fields on `Offer`; `Options.expect`; refusals that name the field; one test per field that fails before the change.

**Non-goals.**
- The signer judges no field's fairness (D28) and adds no limit of its own (D31): every expectation is the buyer's setting or a published fact.
- No change to `agent.ts`, `verify.ts`, a route, a schema or a contract.
- The other signed fields that are still not shown (`schemaVersion`, `settlement.token`, `remedy.onReject`, `nonce`, `createdAt`) are listed in Handoff, not added here.
- PR 314's quorum setting and T-330's shown-versus-signed check stay as they are.

## Context

- `examples/verify.ts`, `TYPES.CommitmentTerms` and `Adjudication`: the fields the buyer's agreement signs.
- `examples/agent.ts`, `Agent.trusted`, `Agent.club`, `Agent.registration`: reads every operator must answer the same.
- `apps/operator/src/server.ts`, `discovery()` and `status()`: `settlementModes` and `demo.clubId`.
- `spec/schemas/common.schema.json`: `SettlementMode` and `DisclosureLevel`; `spec/schemas/commitment.schema.json`: only `public` terms carry `deliverable` and `acceptance` in the clear.
- `docs/tasks/T-330-terms-per-quote.md` and `docs/tasks/T-325-buyer-signer-outcome.md`.

## Acceptance criteria

- [ ] `Offer` carries the seven fields, read from the terms every operator serves.
- [ ] Seven tests: an approval that changes one of the seven is refused, naming it.
- [ ] A test each for the expectations: a configured `settlementMode`, `disclosureLevel` and `clubId` that differ; a club `rulebookHash` and a registration `policyId`, `policyHash` and `registryHash` that every operator serves differently from the terms; a settlement mode no operator lists; no club expected.
- [ ] `buy-with-signer.ts` prints the seven at the approval; it stays at 20 lines or fewer.
- [ ] The existing signer tests and every test that imports the signer pass unchanged.
- [ ] One reviewer pass; its Critical and High findings fixed.

## Out of scope

- `site/llms.txt`: the doc lines are in Handoff.
- The Python signer (package 9).

## Additions from the plan's second revision

On 2026-11-11 the pilot plan's second revision (crow-private `f9b6513`, section 7.1, package 1) added three things to this task. The coordinator passed them on while PR 320 was open:
- **Stop and resume.** The buyer's command stops after funding and resumes days later from the key store, since an audit can take days. `buy-with-signer.ts --stop-after-funding` ends once the hold is funded, and `buy-with-signer.ts resume <store>` follows each funded deal in the store to its outcome. Without the flag the script still runs to the opened work, which `examples/audit-deal.test.ts` relies on.
- **The adjudicators and `maxSubmissions`.** `Offer.maxSubmissions` is shown on its own, and an approval that changes it is refused. Defaults may name `adjudicators` (by role) and `maxSubmissions`, and the difference list compares them.
- **Printed seller text is filtered.** `printable()` escapes control, bidirectional and invisible characters as `\uXXXX`, so the JSON still parses to the same value. The script prints through it, and so do refusal messages.

## Evidence

Each item is labelled measured or inferred.

- **Fail first (measured).** 22 new tests failed on the unchanged signer, and its 8 existing tests passed (`pnpm -C <worktree> exec vitest run examples/buyer-signer.test.ts`: 22 failed, 8 passed).
- **After the change (measured).** `examples/buyer-signer.test.ts`: 34 tests pass, all of them:
  - eight approval tests, one for each of the seven fields and one for `maxSubmissions`;
  - six expectation tests, for `settlementMode`, `clubId`, `rulebookHash`, `policyId`, `policyHash` and `registryHash`;
  - eight operator tests: the settlement mode, the demo club, no demo club, the rulebook hash, the policy ID, the policy hash, the registry hash, and the disclosure level of the served terms;
  - one test where a single operator diverges;
  - the difference list, `printable`, and the script's stop and resume as two processes.
- **Every examples test (measured).** The run on commit `a846f39` passed 23 files: 273 tests passed and 13 were skipped. The 13 skips come from tests that existed before this task.
- **Types and lint (measured).** `pnpm typecheck` passes, and so does ESLint on the three changed files.
- **Script length (measured).** `buy-with-signer.ts` has 19 lines by `wc -l` after the second round of review fixes; it had 20 before them.
- **Second review pass (measured).** The same reviewer read `a846f39..dd21767`, the plan's additions and the first fixes. It returned ISSUES with 0 Critical and 0 High findings, and 4 Medium and 3 Low (findings 9 to 15 in `reports/scratch/t-332-review.md`). It confirmed three things: `resume` signs and pays nothing, `printable` keeps the parsed value, and the one-process run is unchanged. Fixed:
  - Medium 9: `resume` follows every deal at once, reports each failure and exits 1 when any failed;
  - Medium 10: `expect` refuses an unknown key, a value that is not a string, or a value that is not an object, naming it;
  - Medium 11: `printable` tests Unicode properties (`Cc`, `Cf`, `Zl`, `Zp`, `Default_Ignorable_Code_Point`), so the variation selector supplement and the Hangul fillers are escaped too;
  - Medium 12: `resume <store> <commitment ID>` opens a deal's work again after its outcome is saved;
  - Low 14: `shown()` cuts before it escapes;
  - Low 15: this line.

  Low 13 (one bad watch file stops `openDeals` for the whole store) is in Handoff. 35 signer tests pass.
- **Review (measured).** One reviewer pass on `a846f39` returned ISSUES with 0 Critical and 0 High findings, and 3 Medium and 5 Low (`reports/scratch/t-332-review.md`). Fixed:
  - Medium 1: this section and Handoff;
  - Medium 2: the later commits went back to the same reviewer;
  - Medium 3: the level is checked first and `expect.disclosureLevel` is gone;
  - Low 4: `CROW_EXPECT`;
  - Low 5: the one-node test;
  - Low 8: `printable` in `shown()`.

  Lows 6 and 7 are in Handoff.
- **Snapshot diffs:** none.
- **After merging main (measured).** Every examples test passed on head `7d56dc5`: 24 files, 287 tests passed and 13 skipped. All 15 CI checks passed there, including `check`, gitleaks and CodeQL.

## Decisions

- **The approval may leave out the seven fields.** `Approved` takes them as optional, like `seller` and `differences`, so `examples/audit-deal.ts` (package 3, whose files this task may not touch) compiles unchanged. Whether or not the approval names them, each is checked against `Options.expect` and the operators, and against what `readOffer` showed.
- **The expectations come from the buyer or the operators, never the seller.**
  - Each setting in `Options.expect` is the buyer's, and wins over the default.
  - Without a setting, the signer compares with what every operator publishes. Each read goes through `Agent.trusted`, so all configured operators must answer the same: the settlement modes in discovery, the demo club, the club's rulebook and the primary adjudicator's registration.
  - Without a club setting and with no demo club, the signer refuses and names `expect.clubId`.
- **`disclosure.level` must be `public`.** Only public terms carry the deliverable and the checks in the clear for this file to show, so a setting could never pass. `#served` refuses another level by name before it recomputes the commitment ID.
- **The checks run in both `readOffer` and `checkOffer`.** `readOffer` refuses to show an offer it would never sign, and `checkOffer` reads everything again, so a change after the approval is caught.

## Handoff

**Done.** All three files are changed (`examples/buyer-signer.ts`, `examples/buyer-signer.test.ts`, `examples/buy-with-signer.ts`), with the tests above. PR 320 merged on 2026-11-11. The audit-deal rehearsal (package 3) can now import the signer; its approval may also name the new fields (`offer.settlement`, `offer.clubId` and the rest).

**Doc lines for `site/llms.txt`**, for the seller's-page package (package 5) to place in "A seller's client can carry the buyer's side":
- In step 3, "Approve once", after "the deadlines and the adjudicators": "and the fields the buyer also signs: `settlement.mode`, `disclosure.level`, `clubId`, `rulebookHash`, the primary adjudicator's `policyId`, `policyHash` and `registryHash`, and `maxSubmissions`. Before it shows them, the signer refuses each one, naming it, unless it equals what you expect (`makeKeys(<directory>, {expect: {settlementMode, clubId, rulebookHash, policyId, policyHash, registryHash}})`) or, where you set nothing, what every operator publishes: a settlement mode discovery lists, discovery's demo club, the club's rulebook hash and the adjudicator's registration. `disclosure.level` must be `public`."
- In step 3, after "every changed check, window and requirement": "and, when the defaults name them, the adjudicators by role and `maxSubmissions`."
- In step 4, "Check", after "from what the buyer approved": "(each of the fields above that the approval names)".
- A new line after step 8: "**Stop and resume.** `node examples/buy-with-signer.ts <quote URL> <directory> <scope> <budget> --stop-after-funding` funds the deal and stops; days later `node examples/buy-with-signer.ts resume <directory>` follows each funded deal in the directory to its outcome. `CROW_EXPECT` holds your `expect` as JSON. The script prints seller text with control and bidirectional characters escaped."

**For the seller adapter (T-331, package 2).** `GET /defaults` could publish `adjudicators` and `maxSubmissions`, which the signer now compares.

**Open, low priority** (also in `reports/scratch/t-332-triage.md`):
- Five signed fields are still not shown: `schemaVersion`, `settlement.token`, `remedy.onReject`, `nonce` and `createdAt`. Of these, `remedy.onReject` and `settlement.token` matter.
- The adjudicator's registration is taken on the operators' word: `Agent.registration` checks neither the `AdjudicatorRegistration` signature nor what `registryHash` stands for. Fixing that is a change to `agent.ts`, which moves `try.mjs` and its pinned hash (review Low 6).
- A key file whose shown offer predates T-332 has none of the new fields, so `checkOffer` refuses with "not the shown null". Running `readOffer` again fixes it (review Low 7).
- On the public demo both nodes belong to one operator. That operator alone sets every expectation the buyer leaves out, so a buyer that cares sets `expect` (review Low 4).
- `Options.expect` is not saved: give it again to `loadKeys` or `openDeals` before a `checkOffer` that follows a restart.
- `openDeals` throws on one watch file that belongs to another deal, so `resume` stops for the whole store; `resume <store> <id>` still reaches each deal (review Low 13). `resume` with no directory throws a raw TypeError.
- The reviewer recommends a second review by a model from another family. Its focus: whether operator agreement is enough of an expectation source when one operator runs both nodes, and the resume path.
