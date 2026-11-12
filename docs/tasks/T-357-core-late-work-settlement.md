# T-357: A mutual settlement can settle late work and release its key

- **Lane:** core
- **Phase:** 2 (contracts audit-ready lane, `contracts-audit-ready`)
- **Depends on:** T-340 (the state model's finding F-1), T-342 (ADR-0031, SC-5b)
- **Paths this task may touch:** `packages/core/src/state.ts` (the mutual-settlement lines and what they call) and its tests; the simulator's mutual-settlement path (`packages/settlement/sim/`); `packages/settlement/src/interface.ts` (the `mutual_settle` submission only); `packages/settlement/evm/` and `apps/operator/` where this path needs them; one new scenario fixture with its terms and data; one new contract test file under `contracts/test/unit/`; `docs/decisions/ADR-0019-mutual-settlement.md` (an amendment section only); `formal/` (the settlement action); `tests/cut-feature-alignment.known.json` if the change alters it; this file.
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** T-357 session, change kind 5 (settlement and judgment code)

## Intent

The rules contract already lets the buyer and the seller settle a deal in `Held` by a settlement that names a delivery nobody posted, and release that delivery's key to the buyer in the same transaction. That is the path for late work: after `deliverBy` no delivery lands, but the two can still agree to pay for it. Rafa decided on 2026-11-11 to keep the path (ADR-0031, SC-5b). Core, ADR-0019 and the formal model still refuse it, so nobody can use it through the API, and the off-chain mirror disagrees with the contract (finding F-1).

This task makes the off-chain side take exactly what the contract takes on this path, no more and no less. Inputs: the co-signed `MutualSettlement` and, when it releases a key in `Held`, the delivery it names. Outputs: a `Settled` deal with the key released from that delivery's buyer envelope, on SimChain and on the contract alike. Non-goals: no change to the contract, the signed types or `spec/schemas/`; no new HTTP body shape for `POST /settlements`; no change to the deadline order or the refusals T-356 adds.

## Context

- ADR-0031 §6b (SC-5b) and the scope table row; ADR-0019 (Rules, Consequences); `docs/audit/state-model.md` finding F-1.
- `contracts/src/HoldbackRules.sol` `mutualSettle`, `contracts/test/unit/LateCarriedDelivery.t.sol`.
- `packages/core/src/state.ts` `mutualSettle`; `packages/settlement/sim/simchain.ts` `mutualSettle`; `packages/settlement/evm/evm-settlement.ts` (`mutual_settle` submit and its rebuild); `apps/operator/src/prepare.ts` `settlement`.

## Acceptance criteria

- [ ] The contract's conditions for `mutualSettle` are written down below with line numbers, and core checks the same ones on this path.
- [ ] A scenario fixture with its `.expect.md` shows a late delivery settled by agreement with the key released in the same step, on SimChain and on the contract.
- [ ] A settlement naming a delivery that does not match the key is refused on both, with a named error.
- [ ] Every case core refused before and the contract also refuses is still refused, each with its test.
- [ ] One new contract test file: the delivery named in the settlement is the one whose key is released; a settlement naming one delivery cannot release another's key.
- [ ] Prepare can build such a settlement from the agent's own delivery, and the hash it returns is rebuilt from that delivery.
- [ ] ADR-0019 has a short dated amendment with Rafa's words.
- [ ] The formal model allows the path; the safety run passes; the liveness run ran once.
- [ ] The neutrality fixtures pass; `pnpm typecheck`, `pnpm lint`, core's tests and both anvil jobs pass.

## Out of scope

- A body for `POST /v1/commitments/{id}/settlements` that carries the delivery (an API-contract change: `spec/openapi`, `packages/sdk`).
- `docs/api.md` and `site/` (the live site describes what is deployed until the freeze): the sentences that change are in the Handoff.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff
