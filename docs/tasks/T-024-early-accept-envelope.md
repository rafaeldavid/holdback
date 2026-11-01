# T-024: Early accept never pays for an envelope the buyer cannot open

- **Lane:** api + settlement (tests) + test
- **Phase:** 1
- **Depends on:** T-020
- **Paths this task may touch:** `examples/verify.ts`, `examples/sign.ts`, `examples/agent.ts`, `examples/*.test.ts`, `apps/operator/src/prepare.ts` (check text only), `fixtures/scenarios/` (new `attack.` fixture and snapshot), `packages/testkit/` (only if the fixture needs a new step), `docs/api.md`, `docs/quickstart.md`, `docs/backlog.md` (rows)
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer subagent, branch `t-024-early-accept-envelope`

## Intent

Batch 1 (`docs/reviews/2026-11-01-sim-batch-1.md`, F2): a seller can seal the buyer's content-key envelope to a key the buyer does not hold while naming the right recipient. Nothing detects that at delivery. A decision re-seals the key to the buyer's terms key, so judged deals are safe, but an early accept releases the seller-supplied envelope with the payment. ADR-0012 makes a wrong key an appeal ground. Close the gap on both sides: prevention in the buyer's own verifier, and a fixture showing the recourse works.

**Restated (implementer).** An early accept pays the seller and releases whatever envelope the seller filed for the buyer, and no one (operator, settlement, adjudicator) checks that envelope opens with the buyer's key. A buyer must therefore never sign an early accept for work it has not opened itself. The buyer's held envelope is not readable before payment (`/key` is empty until release, by the fair-exchange design), so the buyer opens it from the signed delivery body the seller hands over, after checking that body's delivery hash equals the one settlement recorded; then decrypts the ciphertext and checks the signed hashes. The verifier (`examples/verify.ts`) enforces this for the early-accept intent; prepare's check text says it; the docs say it. A scenario fixture records what happens to a buyer that skips the check and then appeals on ADR-0012's wrong-key ground. Non-goals: any settlement, core or contract change (if the appeal path is broken, it is recorded as a gap, not fixed); detecting a misdirected envelope at delivery; a new operator endpoint for reading the buyer envelope before payment; the agree-and-fund intent beyond its check text (T-025).

## Context

- ADR-0012 and decision D-entry in `docs/decisions-today.md` ("early acceptance carries a seller-supplied key; a missing or wrong key is an appeal ground").
- `docs/api.md` (early accept row), `examples/verify.ts` (`early-accept` intent), `examples/open.ts`.
- The hold litmus test: the buyer must not be able to lose funds for work it cannot open, outside its own signed choice.

## Acceptance criteria

- [x] The buyer's verifier refuses to sign an early accept unless the buyer has fetched its own envelope and the ciphertext, opened them with its own key, and the plaintext hash equals the delivery's signed `plaintextHash`. The early-accept intent carries what this needs; refusal messages say what failed. Unit tests: right key passes; envelope sealed to another key, wrong ciphertext and wrong hash each refuse.
- [x] Prepare's early-accept check text tells the agent to open its envelope first. Prepare's agree-and-fund check text no longer asserts the work is "sealed to your encryption key"; it says which key and asks the agent to confirm it holds it (batch 1 F5).
- [x] An `attack.` scenario fixture: seller seals the buyer envelope to a wrong key, buyer early-accepts anyway (a buyer that skips the check), then appeals on the wrong-key ground. The snapshot shows what actually happens. If the appeal ground does not work end to end, keep the fixture as `todo.` and write the gap in Handoff instead of changing settlement in this task.
- [x] `docs/api.md` and `docs/quickstart.md` say: before an early accept, open your envelope; a wrong key is an appeal ground (ADR-0012).
- [x] `pnpm verify` green.

## Out of scope

- Settlement or contract changes (if the appeal ground is broken, that is a follow-up task with an ADR if needed).
- Detecting a misdirected envelope at delivery time (the operator cannot; the adjudicator finds out on decrypt).

## Evidence

- **measured** `pnpm verify` green on this branch: typecheck, lint, test (76 files, 2044 tests), spec, snap (32 passed), demo (`reports/verify-t-024-early-accept-envelope.md`, local, not committed).
- **measured** `examples/early-accept.test.ts` (5 tests, against a sim world): the right key passes, the accept lands `Released` and `openDelivery` returns the work; an envelope sealed to another key is accepted by settlement (`Delivered`), `Agent.earlyAccept` refuses with "your envelope does not open with your encryption key", and the deal stays `Delivered`; wrong ciphertext bytes, a ciphertext that does not decrypt, a wrong signed plaintext hash, a delivery other than the one settlement holds, no or two buyer envelopes, a key that is not the terms key and another commitment each refuse with a `Refusal` naming the check; `verifyPrepared` refuses an early accept with no opened proof, a copied (forged) proof, or a proof for another commitment.
- **measured** before payment the buyer's envelope is not readable: `GET /v1/commitments/{id}/key?recipient=<buyer>` returns no items in `Delivered` (same test). So the envelope can only be opened from the seller-handed signed delivery.
- **measured** `deliveryHashOf` in `verify.ts` equals the `delivery.submitted` event's `deliveryHash` from SimChain (same test).
- **measured** fixture `todo.attack.early-accept-wrong-key-envelope`: the misdirected delivery is accepted, the early accept releases 2,000 tUSD to the seller and 50 tUSD fee back, the buyer's key check fails ("released key does not open the delivered plaintext"), and the `missing-or-wrong-key` appeal is refused with `invalid_state: nothing to appeal after early_accept`. Final state `Released`. The appeal ground does not work end to end, so the fixture stays `todo.`.
- **measured** prepare's agree-and-fund check no longer says "sealed to your encryption key"; it names the terms key and asks the buyer to confirm it holds the secret key (test asserts both). Early-accept check text tells the agent to open its envelope first (test asserts).
- **inferred** from `packages/core/src/state.ts` (`settled()`): any appeal after `via.kind === 'early_accept'` is refused regardless of grounds, so the gap is in the core state machine, not the operator or testkit.
- **inferred** the testkit's envelopes are stub hashes, not real boxes, so the fixture models "sealed to another key" as a different stub; the real crypto path is covered by the examples tests.
- **guessed** an agent that does not use `verify.ts` (or a port of it) still loses funds on a misdirected envelope until the backlog row on the appeal path is done.

## Decisions

- **The buyer opens its envelope from the seller-handed signed delivery, not from an operator read.** The held envelope is unreadable before payment by design (fair exchange, ADR-0012/ADR-0020), and the task forbids settlement changes. Binding the handed body to the settlement-recorded `deliveryHash` (read from at least two operators) makes the handed envelope the one settlement will release. Tradeoff: the seller who wants early payment shows the buyer the work before payment; a seller who does not want that waits for the adjudicator. Recorded in docs/api.md and a backlog row for a pre-payment read.
- **The early-accept intent carries an `Opened` proof that only `openOwnEnvelope` mints** (module-private WeakSet), so `verifyPrepared` cannot be satisfied by a hand-built object; `verifyPrepared` stays synchronous. The accept's `attempt` comes from the opened delivery.
- **More than one buyer envelope refuses**: SimChain releases the first match, so an ambiguous delivery is not the buyer's to resolve.
- **Fixture kept as `todo.`** (the task's rule): the wrong-key appeal is refused after an early accept. No settlement change; backlog row added.
- **Testkit gains a deliver option, not a new step** (`buyer_envelope: wrong_key`), the smallest change that lets the fixture express F2.

## Handoff

- **Gap for a follow-up task (likely with an ADR):** ADR-0012's missing-or-wrong-key appeal ground does not work after an early accept. `packages/core/src/state.ts` `settled()` returns `invalid_state: nothing to appeal after early_accept`. Design questions: an appeal window on early accepts, how the appeal adjudicator proves the key is wrong (it has its own envelope; it can compare the content key), who pays when no adjudicator judged (no first-instance bond is at stake). When fixed, rename the fixture to `attack.early-accept-wrong-key-envelope` with an `expect` showing recourse. Backlog row under "Settlement and fees".
- **Outside my paths:** `examples/seal.ts` should print the signed delivery body so a CLI seller can hand it to the buyer (`Agent.deliverAndShare` returns it; backlog row under "API"). `tools/sim/briefs/buyer.md` quotes the old agree-and-fund check text ("sealed to your encryption key") and should say to open the envelope before an early accept (T-023's lane). `vitest.config.ts` has no cost entry for `examples/early-accept.test.ts` (about 2 s locally; the default cost is 0.2 s).
- **T-025 overlap:** I edited only the early-accept and agree-and-fund check text in `prepare.ts`, the early-accept intent in `verify.ts` (plus new functions appended at the end), the early-accept line in `sign.ts`, one early-accept test in `verify.test.ts`, one new section in `docs/api.md` (after the "To open the work" paragraph) and the early-accept row, and one paragraph in `docs/quickstart.md`. `Agent.signAndSubmit` now delegates to a new `Agent.sign`.
