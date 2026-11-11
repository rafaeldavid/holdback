# T-333: The deal record

- **Lane:** api
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `examples/deal-record.ts`, `examples/deal-record.test.ts` (both new), `vitest.config.ts` (one cost line for the new test file), this task file
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** t-333-deal-record (Opus 5.5), change kind 4 (API and example code): the examples' tests, no review, a target of 100k tokens

## Intent

After a deal ends, neither party holds one file that shows what was agreed, what was delivered, how it was decided and how it settled. This task adds one program, `examples/deal-record.ts`, that a buyer or a seller runs on its own machine with a commitment ID. It reads the deal from every configured operator and writes one JSON record:

- the signed terms, with the commitment ID recomputed and the seller's signature recovered;
- each step with its time and the actor the operators name, and each signature it can check with the signer it recovers (the seller's terms signature, the adjudicator's judgment record, each operator's receipts, and the seller's delivery when the party passes the signed delivery body);
- the delivery's hashes: the ciphertext's SHA-256 recomputed from the bytes, and for the buyer the plaintext's SHA-256 after it opens its own released envelope;
- the checks' results and the judgment, with the record hash recomputed;
- the settlement's postings, checked against the terms and the hold, and the transaction links on a chain;
- the balances as the operators report them, labelled as their report;
- one flat row for the pilot's measures: IDs, price, both fees, outcome, the time of each step, transaction links, the panel's decision.

Each check carries ok `true`, `false`, or `null` with the reason it could not run. The record builds one view per operator and compares them section by section; a section where operators differ is kept per operator and named in `disagreements`, never merged.

Non-goals: no state-changing request, no route or storage on any operator, no key except the buyer's own encryption key (read from `HOLDBACK_ENCRYPTION_KEY`, never written). Private and judgment-level deals, whose terms need a ReadToken, are out of scope: the record marks their terms unreadable.

"Every field verifies" in the done test means: every check the running party can run passes, and every check it cannot run names why. The tests pin both lists for each deal.

## Context

- Pilot plan (crow-private `roadmap/plans/2026-11-11-pilot-refocus.md`), section 5, package 4.
- D26 (CLAUDE.md): a clean, signed, attributable record that can serve as evidence. D35: rails, not a record-keeper.
- `examples/verify.ts` (commitmentIdOf, deliveryHashOf, typedOf, knownPins), `examples/buyer-signer.ts` (reads from every operator).
- `spec/openapi.json`: GET `/v1/commitments/{id}`, `/terms`, `/events`, `/receipts`, `/judgment`, `/key`, `/v1/balances/{address}`, `/v1/ciphertext/{id}`, `/.well-known/holdback.json`.
- Event hash: keccak256 of the RFC 8785 JSON of the event without `hash` (`packages/settlement/sim/simchain.ts`). Receipt: EIP-712 `Receipt` under the deal's domain (`packages/core/src/eip712.ts`). Judgment record hash: keccak256 of RFC 8785 JSON without `recordHash`, `signature`, `recordUri`, signed as an EIP-191 message over the 32 bytes (`apps/adjudicator/src/service.ts`).

## Acceptance criteria

- [ ] A Released deal on SimChain gives a buyer's record whose every check passes, the plaintext hash included, and a seller's record that recomputes the delivery hash and recovers the seller's delivery signature from the delivery body.
- [ ] A Refunded deal gives a record with the failed deterministic check, the panel's decision and the refund postings; the plaintext check is null with a reason.
- [ ] A reclaimed deal gives a record with `reclaimed: true`, no judgment, and the price and fee back to the buyer.
- [ ] An operator that serves another state or tampered terms is named in `disagreements`; its section is kept per operator.
- [ ] The program sends no request other than GET, and only to configured operators; the record holds no secret key and no plaintext.
- [ ] Every amount in the record is a base-unit decimal string.

## Out of scope

- Private and judgment-level deals (ReadToken reads).
- Reading the chain directly: transactions and balances are the operators' report, labelled so.
- The `llms.txt` lines (package 5 places them; see Handoff).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs: none (no scenario fixture changes).
- Metrics:

## Decisions

## Handoff
