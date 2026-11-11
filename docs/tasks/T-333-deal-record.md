# T-333: The deal record

- **Lane:** api
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `examples/deal-record.ts`, `examples/deal-record.test.ts` (both new), `vitest.config.ts` (one cost line for the new test file), this task file
- **Human gate:** no
- **Status:** done
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

- [x] A Released deal on SimChain gives a buyer's record whose every check passes, the plaintext hash included, and a seller's record that recomputes the delivery hash and recovers the seller's delivery signature from the delivery body.
- [x] A Refunded deal gives a record with the failed deterministic check, the panel's decision and the refund postings; the plaintext check is null with a reason.
- [x] A reclaimed deal gives a record with `reclaimed: true`, no judgment, and the price and fee back to the buyer.
- [x] An operator that serves another state or tampered terms is named in `disagreements`; its section is kept per operator.
- [x] The program sends no request other than GET, and only to configured operators; the record holds no secret key and no plaintext.
- [x] Every amount in the record is a base-unit decimal string.

## Out of scope

- Private and judgment-level deals (ReadToken reads).
- Reading the chain directly: transactions and balances are the operators' report, labelled so.
- The `llms.txt` lines (package 5 places them; see Handoff).

## Evidence

- Commands run and results:
  - `pnpm exec vitest run examples/deal-record.test.ts`: 9 of 9 tests pass in about 2.6 s [measured]. They cover a Released deal read by the buyer (every check passes, the plaintext included) and by the seller (delivery hash and delivery signature from the body), a Refunded deal, a reclaimed deal, a ciphertext URI rewritten by one operator, a state lie, tampered terms, an offline operator, and the command run with the key in the environment.
  - `pnpm exec vitest run examples/ tests/ci-gated.test.ts`: 25 of 25 files pass, 261 tests pass, 13 skipped (skips that were already there), 138.5 s [measured].
  - `pnpm typecheck` and `eslint` on the three changed files: clean [measured].
  - A record written by the command, read by eye: 17 checks pass and 2 are null with the reason (the delivery body was not passed). It holds no key and no plaintext [measured].
- Snapshot diffs: none (no scenario fixture changes).
- Metrics: none.

## Decisions

1. **One view per operator, compared by section.** The record builds each operator's view from that operator's answers alone, then writes a section once when every view agrees. When they differ it writes the section as `{ byOperator }` and lists it in `disagreements`. Checks follow the same rule: a check gives one entry when every view gives the same result, and one entry per operator otherwise. Steps compare type, time and actor only, because on a chain each operator numbers and links its own event index.
2. **Unverifiable means null with a reason, not absent.** The buyer's agree and funding signatures are not served by any route. The delivery hash needs the signed delivery body. The plaintext needs the buyer's key and a released envelope. Transactions and balances are the operators' report. Each of these is either a null check with its reason or a section labelled as a report.
3. **Request addresses come from configuration only.** The ciphertext is fetched from `/v1/ciphertext/<sha256>` on a configured operator, with the ID checked against `^sha256:[0-9a-f]{64}$`. Explorer links come from the pinned deployment in `verify.ts`.
4. **Exit code.** The command exits 0 when every check that ran passed and the operators agree, 1 when it wrote a record with a failed check or a disagreement, and 2 on a usage error or when no operator answered.

## Handoff

Done: `examples/deal-record.ts` and its 9 tests, the `vitest.config.ts` cost line (30, measured locally at about 2.6 s, not yet measured in CI).

Not done, and not run: a record of a live Sepolia deal. Its transaction links and the comparison of steps across two operators' chain indexes have run only in reasoning [inferred]. Rafa's live rehearsal (critical path item 7) is the first run on a chain. Lower-priority finds are in `reports/scratch/t-333-triage.md`.

Doc lines for package 5 to place in `site/llms.txt` (the record is for both sides, so the seller's page and the buyer's section both fit):

```
## Keep a record of each deal
After a deal ends, run `node examples/deal-record.ts <commitmentId> --as buyer|seller --out record.json` with HOLDBACK_OPERATORS set to two or more operators. It reads the deal from each one and writes one JSON record: the signed terms, each step, the delivery's hashes, the checks and the judgment, the settlement, and a flat `row` of IDs, price, fees, outcome and times. Each check says ok, failed, or why it could not run; operators that differ are named, not merged. It only reads.
Buyer: set HOLDBACK_ENCRYPTION_KEY to check the released work's hash; the key and the work never reach the record. Seller: pass `--delivery <file>`, your signed delivery body, to recompute the delivery hash and recover your signature.
Public deals only; transactions and balances are the operators' report.
```
