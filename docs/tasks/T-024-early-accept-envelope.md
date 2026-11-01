# T-024: Early accept never pays for an envelope the buyer cannot open

- **Lane:** api + settlement (tests) + test
- **Phase:** 1
- **Depends on:** T-020
- **Paths this task may touch:** `examples/verify.ts`, `examples/sign.ts`, `examples/agent.ts`, `examples/*.test.ts`, `apps/operator/src/prepare.ts` (check text only), `fixtures/scenarios/` (new `attack.` fixture and snapshot), `packages/testkit/` (only if the fixture needs a new step), `docs/api.md`, `docs/quickstart.md`, `docs/backlog.md` (rows)
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** implementer subagent, branch `t-024-early-accept-envelope`

## Intent

Batch 1 (`docs/reviews/2026-11-01-sim-batch-1.md`, F2): a seller can seal the buyer's content-key envelope to a key the buyer does not hold while naming the right recipient. Nothing detects that at delivery. A decision re-seals the key to the buyer's terms key, so judged deals are safe, but an early accept releases the seller-supplied envelope with the payment. ADR-0012 makes a wrong key an appeal ground. Close the gap on both sides: prevention in the buyer's own verifier, and a fixture showing the recourse works.

**Restated (implementer).** An early accept pays the seller and releases whatever envelope the seller filed for the buyer, and no one (operator, settlement, adjudicator) checks that envelope opens with the buyer's key. A buyer must therefore never sign an early accept for work it has not opened itself. The buyer's held envelope is not readable before payment (`/key` is empty until release, by the fair-exchange design), so the buyer opens it from the signed delivery body the seller hands over, after checking that body's delivery hash equals the one settlement recorded; then decrypts the ciphertext and checks the signed hashes. The verifier (`examples/verify.ts`) enforces this for the early-accept intent; prepare's check text says it; the docs say it. A scenario fixture records what happens to a buyer that skips the check and then appeals on ADR-0012's wrong-key ground. Non-goals: any settlement, core or contract change (if the appeal path is broken, it is recorded as a gap, not fixed); detecting a misdirected envelope at delivery; a new operator endpoint for reading the buyer envelope before payment; the agree-and-fund intent beyond its check text (T-025).

## Context

- ADR-0012 and decision D-entry in `docs/decisions-today.md` ("early acceptance carries a seller-supplied key; a missing or wrong key is an appeal ground").
- `docs/api.md` (early accept row), `examples/verify.ts` (`early-accept` intent), `examples/open.ts`.
- The hold litmus test: the buyer must not be able to lose funds for work it cannot open, outside its own signed choice.

## Acceptance criteria

- [ ] The buyer's verifier refuses to sign an early accept unless the buyer has fetched its own envelope and the ciphertext, opened them with its own key, and the plaintext hash equals the delivery's signed `plaintextHash`. The early-accept intent carries what this needs; refusal messages say what failed. Unit tests: right key passes; envelope sealed to another key, wrong ciphertext and wrong hash each refuse.
- [ ] Prepare's early-accept check text tells the agent to open its envelope first. Prepare's agree-and-fund check text no longer asserts the work is "sealed to your encryption key"; it says which key and asks the agent to confirm it holds it (batch 1 F5).
- [ ] An `attack.` scenario fixture: seller seals the buyer envelope to a wrong key, buyer early-accepts anyway (a buyer that skips the check), then appeals on the wrong-key ground. The snapshot shows what actually happens. If the appeal ground does not work end to end, keep the fixture as `todo.` and write the gap in Handoff instead of changing settlement in this task.
- [ ] `docs/api.md` and `docs/quickstart.md` say: before an early accept, open your envelope; a wrong key is an appeal ground (ADR-0012).
- [ ] `pnpm verify` green.

## Out of scope

- Settlement or contract changes (if the appeal ground is broken, that is a follow-up task with an ADR if needed).
- Detecting a misdirected envelope at delivery time (the operator cannot; the adjudicator finds out on decrypt).

## Evidence

## Decisions

## Handoff
