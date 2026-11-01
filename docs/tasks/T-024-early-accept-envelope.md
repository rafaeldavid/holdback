# T-024: Early accept never pays for an envelope the buyer cannot open

- **Lane:** api + settlement (tests) + test
- **Phase:** 1
- **Depends on:** T-020
- **Paths this task may touch:** `examples/verify.ts`, `examples/sign.ts`, `examples/agent.ts`, `examples/*.test.ts`, `apps/operator/src/prepare.ts` (check text only), `fixtures/scenarios/` (new `attack.` fixture and snapshot), `packages/testkit/` (only if the fixture needs a new step), `docs/api.md`, `docs/quickstart.md`, `docs/backlog.md` (rows)
- **Human gate:** no
- **Status:** done
- **Agent/session:** implementer subagent, branch `t-024-early-accept-envelope`

## Intent

Batch 1 (`docs/reviews/2026-11-01-sim-batch-1.md`, F2): a seller can seal the buyer's content-key envelope to a key the buyer does not hold while naming the right recipient. Nothing detects that at delivery. A decision re-seals the key to the buyer's terms key, so judged deals are safe, but an early accept releases the seller-supplied envelope with the payment. ADR-0012 makes a wrong key an appeal ground. Close the gap on both sides: prevention in the buyer's own verifier, and a fixture showing the recourse works.

**Restated (implementer).** An early accept pays the seller and releases whatever envelope the seller filed for the buyer, and no one (operator, settlement, adjudicator) checks that envelope opens with the buyer's key. A buyer must therefore never sign an early accept for work it has not opened itself. The buyer's held envelope is not readable before payment (`/key` is empty until release, by the fair-exchange design), so the buyer opens it from the signed delivery body the seller hands over, after checking that body's delivery hash equals the one settlement recorded; then decrypts the ciphertext and checks the signed hashes. The verifier (`examples/verify.ts`) enforces this for the early-accept intent; prepare's check text says it; the docs say it. A scenario fixture records what happens to a buyer that skips the check and then appeals on ADR-0012's wrong-key ground. **After D32 (2026-11-01):** the early accept is the buyer's own acceptance and no appeal follows it; the agent-side check is the whole fix, kept as plain checks (`sign.ts` and `Agent.earlyAccept` run `openOwnEnvelope` before signing), and the fixture records the refused appeal as intended behaviour. Non-goals: any settlement, core or contract change (if the appeal path is broken, it is recorded as a gap, not fixed); detecting a misdirected envelope at delivery; a new operator endpoint for reading the buyer envelope before payment; the agree-and-fund intent beyond its check text (T-025).

## Context

- ADR-0012 and decision D-entry in `docs/decisions-today.md` ("early acceptance carries a seller-supplied key; a missing or wrong key is an appeal ground").
- `docs/api.md` (early accept row), `examples/verify.ts` (`early-accept` intent), `examples/open.ts`.
- The hold litmus test: the buyer must not be able to lose funds for work it cannot open, outside its own signed choice.

## Acceptance criteria

- [x] The buyer's verifier refuses to sign an early accept unless the buyer has fetched its own envelope and the ciphertext, opened them with its own key, and the plaintext hash equals the delivery's signed `plaintextHash`. The early-accept intent carries what this needs; refusal messages say what failed. Unit tests: right key passes; envelope sealed to another key, wrong ciphertext and wrong hash each refuse.
- [x] Prepare's early-accept check text tells the agent to open its envelope first. Prepare's agree-and-fund check text no longer asserts the work is "sealed to your encryption key"; it says which key and asks the agent to confirm it holds it (batch 1 F5).
- [x] An `attack.` scenario fixture: seller seals the buyer envelope to a wrong key, buyer early-accepts anyway (a buyer that skips the check), then appeals on the wrong-key ground. The snapshot shows what actually happens. If the appeal ground does not work end to end, keep the fixture as `todo.` and write the gap in Handoff instead of changing settlement in this task. (After D32 the refusal is intended: the fixture is `error.early-accept-wrong-key-envelope`; see Decisions for why not `attack.`.)
- [x] `docs/api.md` and `docs/quickstart.md` say: before an early accept, open your envelope; a wrong key is an appeal ground (ADR-0012). (Superseded by D32: the docs say the buyer is responsible for opening its envelope and that no appeal follows an early accept.)
- [x] `pnpm verify` green.

## Out of scope

- Settlement or contract changes (if the appeal ground is broken, that is a follow-up task with an ADR if needed).
- Detecting a misdirected envelope at delivery time (the operator cannot; the adjudicator finds out on decrypt).

## Evidence

- **measured** `pnpm verify` green on this branch after the D32 and review changes (counts in the PR; report `reports/verify-t-024-early-accept-envelope.md`, local, not committed).
- **measured** `examples/early-accept.test.ts` (5 tests, against a sim world): the right key passes, the accept lands `Released` and `openDelivery` returns the work; an envelope sealed to another key is accepted by settlement (`Delivered`), `Agent.earlyAccept` refuses with "your envelope does not open with your encryption key", and the deal stays `Delivered`; wrong ciphertext bytes, a ciphertext that does not decrypt, a wrong signed plaintext hash, a delivery other than the one settlement holds, no or two buyer envelopes, a key that is not the terms key and another commitment each refuse with a `Refusal` naming the check; a delivery handed for another deal refuses in `Agent.earlyAccept`; prepare's early-accept check says to open the envelope first and that no appeal follows.
- **measured** `examples/examples.test.ts`: `sign.ts` run as a child process refuses an early-accept intent without `delivery` (exit 3, "needs \"delivery\"") and signs one with it; the submitted body lands `Released`.
- **measured** before payment the buyer's envelope is not readable: `GET /v1/commitments/{id}/key?recipient=<buyer>` returns no items in `Delivered`. So the envelope can only be opened from the seller-handed signed delivery.
- **measured** `deliveryHashOf` in `verify.ts` equals the `delivery.submitted` event's `deliveryHash` from SimChain.
- **measured** fixture `error.early-accept-wrong-key-envelope`: the misdirected delivery is accepted, the early accept releases 2,000 tUSD to the seller and the 50 tUSD fee back, the `missing-or-wrong-key` appeal is refused at step 6 with `invalid_state: nothing to appeal after early_accept` (the pinned `expect.problem`), and the buyer's key check fails at step 7. Final state `Released`.
- **measured** renaming it `attack.` fails the testkit's attack rule ("an attack fixture must end escalated, rejected or refused ... ended in Released").
- **measured** prepare's agree-and-fund check no longer says "sealed to your encryption key"; it names the terms key and asks the buyer to confirm it holds the secret key.
- **inferred** the testkit's envelopes are stub hashes, not real boxes, so the fixture models "sealed to another key" as a different stub; the real crypto path is covered by the examples tests.
- **measured** one unrelated flake during a local run: `packages/testkit/src/judgment.test.ts` "draws the same panel from the same seed" failed once under load (5.4 s) and passed when rerun alone.

## Decisions

- **D32 applies (Rafa, 2026-11-01):** no settlement change; an early accept is the buyer's own acceptance; appeals after it stay refused; ADR-0012's wrong-key ground covers judged outcomes only.
- **The buyer opens its envelope from the seller-handed signed delivery, not from an operator read.** The held envelope is unreadable before payment by design (ADR-0012, ADR-0020). `openOwnEnvelope` checks that the handed body's delivery hash equals the settlement-recorded one, which must be read from at least two distinct operators (`Agent.envelopeMaterial` does; stated in `verify.ts` and docs/api.md). Tradeoff, the seller's choice (D32): handing it over gives the buyer the content key before payment, so on a later refund the buyer keeps the work.
- **Plain checks, no anti-bypass mechanism (D32).** The early-accept intent is unchanged (`terms`, `nonce`); `sign.ts` and `Agent.earlyAccept` run `openOwnEnvelope` before signing and refuse on failure. An earlier version had the verifier require a same-process proof; it was removed.
- **More than one buyer envelope refuses**: SimChain releases the first match, so an ambiguous delivery is not the buyer's to resolve.
- **Fixture prefix `error.`, not `attack.`.** The testkit's `attack.` rule requires that nothing be paid out (an attack must end escalated, rejected or refused), and here the release is the buyer's own signed choice, intended under D32. `error.` pins the intended refusal (the appeal, `invalid_state` at step 6). Loosening the attack rule would weaken a defense check for every attack fixture, so I did not. The coordinator can overrule this.
- **Testkit gains a deliver option, not a new step** (`buyer_envelope: wrong_key`), the smallest change that lets the fixture express F2.

## Handoff

- **Outside my paths:** `examples/seal.ts` should print the signed delivery body so a CLI seller can hand it to the buyer (`Agent.deliverAndShare` returns it; backlog row under "API"). `tools/sim/briefs/buyer.md` quotes the old agree-and-fund check text ("sealed to your encryption key") and should say to open the envelope before an early accept (T-023's lane).
- **Backlog rows added:** a pre-payment read of the buyer's envelope (with the seal.ts note); a size cap on ciphertext fetched from a seller-chosen URI (also `openDelivery`). The earlier row proposing a settlement fix was removed per D32.
- **T-025 overlap:** I edited only the early-accept and agree-and-fund check text in `prepare.ts`, the early-accept comment in `verify.ts` (plus new functions appended at the end), the early-accept parts of `sign.ts`, one early-accept test in `verify.test.ts`, one new section in `docs/api.md` and the early-accept row, and one paragraph in `docs/quickstart.md`. `Agent.signAndSubmit` now delegates to a new `Agent.sign`. I also added a shard cost entry in `vitest.config.ts`, at the coordinator's request.
