# T-332: the buyer signer shows and checks every field the buyer signs

- **Lane:** examples (client code)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, example and client code (Change recipes): the examples' tests, one reviewer pass before merge (it changes what a buyer signs), a target of 150k tokens.
- **Depends on:** T-330 (PR 316, the shown-versus-signed check), T-325 (PR 314, the quorum setting).
- **Paths this task may touch:** `examples/buyer-signer.ts`, `examples/buyer-signer.test.ts`, `examples/buyer-signer-outcome.test.ts`, `examples/buy-with-signer.ts`, this file. Never: `site/llms.txt` (the doc lines go in Handoff for the later seller's-page package), `examples/seller-adapter.ts` and its files (T-331), `examples/audit-deal.ts`, `examples/agent.ts`, `examples/verify.ts`, `packages/`, `apps/`, `spec/schemas/`, `contracts/`.
- **Human gate:** no.
- **Status:** in progress
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

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs: none expected.
- Metrics:

## Decisions

## Handoff
