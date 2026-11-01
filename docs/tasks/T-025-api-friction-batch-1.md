# T-025: API and docs friction from sim batch 1

- **Lane:** api
- **Phase:** 1
- **Depends on:** T-015, T-020
- **Paths this task may touch:** `apps/operator/src/server.ts`, `apps/operator/src/prepare.ts` (except the agree-and-fund and early-accept check text, which T-024 owns), `apps/operator/src/*.test.ts`, `spec/openapi/paths.json` and the generated `spec/openapi.json`, `examples/sign.ts`, `examples/verify.ts` (agree-and-fund intent only; T-024 owns early-accept), `examples/*.test.ts`, `examples/package.json`, `docs/api.md`, `docs/quickstart.md`, `docs/backlog.md` (rows)
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer (Claude Opus 5.5), branch `t-025-api-friction`

## Intent

Batch 1's eight agents (`docs/reviews/2026-11-01-sim-batch-1.md`, F3 to F5) settled every deal, but each lost time or money to the same rough edges. Remove the ones that are API behaviour, and write down the ones that are knowledge an outsider cannot guess. Coordinate with T-024, which runs in parallel and owns the early-accept and agree-and-fund check text in `prepare.ts` and the early-accept intent in `verify.ts`.

**Restated (implementer).** Every batch 1 agent finished its deal, but each paid in time (and one in money) for things an outsider could not know or that the API made awkward. Two kinds of fix:

- **API behaviour an agent should not have to work around:** the dry run should take the exact body prepare hands out (`"signature": null`); prepare should not hand out early-accept, appeal or settlement messages the settlement layer will refuse in the current state; a buyer should be able to read the seller-signed terms from an operator instead of trusting only the mailed body; the buyer's verifier should be able to pin the negotiated price, not just a budget; and a missing offer `id` should explain itself.
- **Knowledge that must be written down:** escalation and why its decision is final, what D27a does to a flagged case, what a screen flag does (nothing) on a checks-only deal, how to write checks a minimal seller cannot game, when an appeal can win and what it costs, and the reading facts agents guessed at (commitment `id`, `/terms`, public signatures, `commitment.agreed`, missed `Delivered`, `Released` vs final, the judgment record, `expire-offer`, running the examples from elsewhere).

**Non-goals:** no new bound on any negotiable value (D31); no negotiable dispute clauses (D29) and no advisory sanity warnings; nothing T-024 owns (the agree-and-fund and early-accept `check` text in `prepare.ts`, the early-accept intent in `verify.ts`, the F2 envelope check and its docs); no `spec/schemas` change unless the terms read needs one (it does not: see Decisions); `mail.ts` and the sim key leak are T-023's.

## Acceptance criteria

API behaviour:
- [x] `?validateOnly=true` accepts the exact body prepare returned, including `"signature": null` (or prepare omits the field); the dry run documents which one. Contract test covers it.
- [x] Prepare for early-accept, appeal and settlement refuses (or warns in `check`) when the commitment's current state cannot take that submit, as agree-and-fund already does.
- [x] The commitment read (`GET /v1/commitments/{id}`) exposes the signed terms (or a documented link to them), so a buyer compares against the operator's copy, not only the mailed body. If that is a schema change, follow the contract rule (ADR plus version bump) or record why not in Decisions.
- [x] The agree-and-fund intent in `verify.ts`/`sign.ts` can carry the expected price (and optionally the full expected terms hash); a price raised within `maxTotal` is refused when given.
- [x] Missing `id` on `POST /v1/commitments` returns a problem detail that says how to compute it.

Docs (`docs/api.md`, `docs/quickstart.md`):
- [x] Escalation: what triggers it, that the appeal adjudicator's decision is final at once with no appeal window, and how D27a decides a flagged deal.
- [x] What a screen flag does on a checks-only deal (nothing changes the outcome unless the terms say so; dispute clauses come later, D29).
- [x] Writing checks that resist a seller doing the minimum: email pattern with a dot in the domain, distinct values, value ranges, per-column regex on the key column; with a worked example.
- [x] Appeals: when one can succeed (D28: show the work fails the terms), what it costs relative to the price, and that a checks-only appeal re-runs the same checks.
- [x] `Released` is not final until the appeal window passes; `Delivered` may never be visible to a poller; the commitment `id` and how to compute it; the `appellant` prepare input; what `commitment.agreed` contains and which signatures are public; the judgment record's shape (link the schema); who should call `expire-offer` and why it matters (reserved bond).
- [x] Running the examples from another directory (dependency resolution), or a one-line way to import them.
- [x] `pnpm verify` green; `pnpm openapi` regenerated if paths changed.

## Out of scope

- Negotiable dispute clauses (D29, after the demo); advisory sanity warnings (backlog).
- Anything T-024 owns.

## Evidence

- **Tests first (measured).** Commit `d31a61c` adds the tests alone; against it, `pnpm vitest run apps/operator/src/sim-world.test.ts examples/verify.test.ts` failed 5 tests (missing-id hint, `/terms` and its `Link`, prepare state gates, the dry run of the prepared body, the expected-price refusals) and `tsc` refused the new intent fields. After the implementation they pass.
- **Dry run of the prepared body (measured).** `sim-world.test.ts` posts the prepared offer and agree-and-fund bodies as returned (`signatures.seller: null`; `signature: null` and `fund.signature: null`) with `?validateOnly=true`: 200, `Holdback-Signature-Check: skipped`, agree previews `Held`. `tests/contract/openapi.contract.test.ts` flow 5 does the same for the offer and checks the response against the document.
- **Missing id (measured).** `POST /v1/commitments` without `id`, live and dry run: 400 `invalid_terms`, detail names the EIP-712 struct hash, `/v1/prepare/offer` and `commitmentIdOf` (`sim-world.test.ts`).
- **Terms read (measured).** `GET /v1/commitments/{id}/terms` deep-equals the seller-signed body prepare built (`sim-world.test.ts`) and the body `examples/sign.ts` printed (`examples/examples.test.ts`), which is what the quickstart's `diff` relies on; unknown id is 404. `GET /v1/commitments/{id}` carries `Link: </v1/commitments/{id}/terms>; rel="terms"`; the contract test checks the header as a required response header and exercises `getCommitmentTerms`.
- **State gates (measured).** On a `Held` deal, prepare early-accept and appeal answer 409 `invalid_state` naming the state; settlement 200. After `Released` (window open), settlement and early-accept 409, appeal 200. Existing flows that prepare these kinds in valid states (sim-world, verify.test, contract test) still pass. Escalated and window-closed appeal refusals are inferred from `finalAt` semantics in `simchain.ts`; not exercised by a test.
- **Expected price (measured).** `examples/verify.test.ts`: the honest agree-and-fund verifies with `expectedPrice` and `expectedCommitmentId`; a price of 25 tUSD against an expected 24 (within the 26 tUSD `maxTotal`), a different token, and another commitment ID are each refused.
- **Checks worked example (measured).** `sim-world.test.ts` parses the JSON block under "Writing checks that resist a seller doing the minimum" in `docs/api.md`, offers with it, and delivers batch 1's style of junk (instruction string as customer ID, `a@a` emails, identical dates): `Refunded`, with `id-format` and `email-format` failed; an honest three-row file: `Released`, no check failed. Identical dates alone are not caught by any check, which the doc says.
- **Examples from another directory (measured, by hand, not committed).** From a directory under the session scratchpad with Node 22.22.2: importing `examples/verify.ts` by absolute path works; a bare `import 'viem'` in the caller's own file fails with `ERR_MODULE_NOT_FOUND`; after `ln -s <repo>/examples/node_modules node_modules` it works; `node <repo>/examples/sign.ts` from there resolves its imports.
- **Doc facts (inferred from code, not run).** Event payloads (`commitment.agreed` has only `termsHash`; party signatures are not in any event) from `packages/settlement/sim/simchain.ts`; escalation triggers and D27a from `docs/judgment-and-defenses.md` and D27; appeal postings (upheld: bond to the first adjudicator's junior pool, fee to the appeal adjudicator; overturned: bond back, price from the first adjudicator's bond) from `simchain.ts`; the reference adjudicator service triggering only `fallback`, not `expire-offer`, from `apps/adjudicator/src/service.ts`. The 26.75 tUSD appeal cost on a 35 tUSD deal matches the batch 1 report (measured there).
- **`pnpm verify` (measured).** All six steps pass: typecheck, lint, test (75 files, 2043 tests), spec (24/24 examples, `spec/openapi.json` 39 operations, fresh), snap, demo. Report: `reports/verify-t-025-api-friction.md`.

## Decisions

- **Signed terms via a linked read, not a schema change.** `commitment-state.schema.json` is closed (`additionalProperties: false`), so putting terms in the state read would need an ADR and a v0.7 bump, and would repeat a large, immutable body in every state poll and list page. Instead `GET /v1/commitments/{id}/terms` returns the existing `commitment.schema.json` shape (no new schema), and the state read links to it with an RFC 8288 `Link` header, documented in the OpenAPI document and `docs/api.md`. The criterion allows "a documented link"; `spec/schemas` is untouched, so no ADR or version bump is needed. The OpenAPI paths file is operator API, not `spec/schemas`.
- **Null signatures accepted, prepare unchanged.** The dry run treats a `null` signature slot as missing, so the body prepare returns previews as is. Prepare keeps returning `null` slots, because they name where each signature goes, and agents and docs already rely on that shape.
- **Refuse rather than warn for state gates.** A prepare in a state that cannot take the submit returns 409 `invalid_state` naming the current state and what is needed. The settlement layer stays the authority: the gate is an operator convenience, and a state can move between prepare and submit. Agree-and-fund is not gated: its check text already says the adjudicator must accept first, T-024 owns that text, and preparing it before acceptance is a legitimate way to get ready. The gate lives in the `prepare()` dispatcher, away from T-024's check text, to keep the merge clean.
- **Expected price is exact and opt-in.** `expectedPrice` compares token and amount exactly; `expectedCommitmentId` pins the whole terms. Both are optional, so existing intents keep working; the quickstart now passes `expectedPrice`. D31 holds: these are the agent's own policy, not a bound the API imposes.
- **No new check types.** A numeric range and a distinct-values check would need a schema change; the doc shows how to express ranges as patterns and says what checks cannot express. Backlog row added.

## Handoff

- **Scope widened by one file:** `tests/contract/openapi.contract.test.ts` (api lane, T-015, done). Adding `getCommitmentTerms` to the paths file makes the contract test require that every documented operation is exercised, so it now GETs `/terms` once, and flow 5 also previews the prepared offer body with its `null` signature. Three lines; no other change to T-015's files.
- **T-024 merge.** I did not touch the agree-and-fund or early-accept `check` text in `prepare.ts`, or the early-accept intent in `verify.ts`. Likely textual neighbours: the `Intent` union in `verify.ts` (my change is the agree-and-fund line, next to early-accept) and the `prepare()` dispatcher at the bottom of `prepare.ts`. `docs/api.md` mentions ADR-0012 (wrong key as an appeal ground) in one bullet under Appeals; T-024's F2 docs may want to link there rather than repeat it.
- **For the lead to record if wanted:** the `/terms` route and the state gates are small API additions within v0.2; `docs/decisions-today.md` was not edited (outside this task's paths).
- **Backlog rows added** (API): dataset check types for ranges and distinct values; lapsed offers expired by the adjudicator service; a party-scoped event stream or webhooks.
- **Not done here:** `mail.ts --out` (T-023's tools); a check-text warning when an offer's `buyerEncryptionPublicKey` looks wrong (the operator cannot know the buyer's key; `sign.ts` catches it).
