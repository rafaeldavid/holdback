# T-357: A mutual settlement can settle late work and release its key

- **Lane:** core
- **Phase:** 2 (contracts audit-ready lane, `contracts-audit-ready`)
- **Depends on:** T-340 (the state model's finding F-1), T-342 (ADR-0031, SC-5b)
- **Paths this task may touch:** `packages/core/src/state.ts` (the mutual-settlement lines and what they call) and its tests; the simulator's mutual-settlement path (`packages/settlement/sim/`); `packages/settlement/src/interface.ts` (the `mutual_settle` submission only); `packages/settlement/evm/` and `apps/operator/` where this path needs them; one new scenario fixture with its terms and data; one new contract test file under `contracts/test/unit/`; `docs/decisions/ADR-0019-mutual-settlement.md` (an amendment section only); `formal/` (the settlement action); `tests/cut-feature-alignment.known.json` if the change alters it; this file.
- **Human gate:** no
- **Status:** merged to contracts-audit-ready, waits for the freeze
- **Agent/session:** T-357 session, change kind 5 (settlement and judgment code)

## Intent

The rules contract already lets the buyer and the seller settle a deal in `Held` by a settlement that names a delivery nobody posted, and release that delivery's key to the buyer in the same transaction. That is the path for late work: after `deliverBy` no delivery lands, but the two can still agree to pay for it. Rafa decided on 2026-11-11 to keep the path (ADR-0031, SC-5b). Core, ADR-0019 and the formal model still refuse it, so nobody can use it through the API, and the off-chain mirror disagrees with the contract (finding F-1).

This task makes the off-chain side take exactly what the contract takes on this path, no more and no less. Inputs: the co-signed `MutualSettlement` and, when it releases a key in `Held`, the delivery it names. Outputs: a `Settled` deal with the key released from that delivery's buyer envelope, on SimChain and on the contract alike. Non-goals: no change to the contract, the signed types or `spec/schemas/`; no new HTTP body shape for `POST /settlements`; no change to the deadline order or the refusals T-356 adds.

## Context

- ADR-0031 §6b (SC-5b) and the scope table row; ADR-0019 (Rules, Consequences); `docs/audit/state-model.md` finding F-1.
- `contracts/src/HoldbackRules.sol` `mutualSettle`, `contracts/test/unit/LateCarriedDelivery.t.sol`.
- `packages/core/src/state.ts` `mutualSettle`; `packages/settlement/sim/simchain.ts` `mutualSettle`; `packages/settlement/evm/evm-settlement.ts` (`mutual_settle` submit and its rebuild); `apps/operator/src/prepare.ts` `settlement`.

## Acceptance criteria

- [x] The contract's conditions for `mutualSettle` are written down below with line numbers, and core checks the same ones on this path.
- [x] A scenario fixture with its `.expect.md` shows a late delivery settled by agreement with the key released in the same step, on SimChain and on the contract.
- [x] A settlement naming a delivery that does not match the key is refused on both, with a named error.
- [x] Every case core refused before and the contract also refuses is still refused, each with its test.
- [x] One new contract test file: the delivery named in the settlement is the one whose key is released; a settlement naming one delivery cannot release another's key.
- [x] Prepare can build such a settlement from the agent's own delivery, and the hash it returns is rebuilt from that delivery.
- [x] ADR-0019 has a short dated amendment with Rafa's words.
- [x] The formal model allows the path; the safety run passes; the liveness run ran once.
- [x] The neutrality fixtures pass; `pnpm typecheck`, `pnpm lint`, core's tests and both anvil jobs pass.

## Out of scope

- A body for `POST /v1/commitments/{id}/settlements` that carries the delivery (an API-contract change: `spec/openapi`, `packages/sdk`).
- `docs/api.md` and `site/` (the live site describes what is deployed until the freeze): the sentences that change are in the Handoff.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

All measured on this branch, 2026-11-12, on the maintainer's machine, unless marked.

- Commands run and results:
  - `pnpm typecheck`: passes. `pnpm lint`: passes, no findings. `pnpm validate:spec`: 35 of 35 examples valid; openapi 43 operations, fresh.
  - Core, SimChain and the operator (`vitest run packages/core/src packages/settlement/sim apps/operator/src/sim-world.test.ts`): 28 files, 1,092 tests pass. New: 13 in core's late-work block, 4 in SimChain's, 2 in the operator's.
  - `pnpm snap`: 39 of 39 fixtures pass on SimChain, the neutrality fixtures among them.
  - `pnpm snap --settlement local error.late-work-settlement-wrong-delivery`: passes on the contract on anvil; the transcript is identical to SimChain's; 2 transactions, 428,856 gas.
  - Anvil, the CI settlement suite (`vitest run packages/settlement/evm packages/testkit/src/runner.test.ts`): 216 of 217 passed on the first run; the one failure was this branch's own key deduplication, now reverted, and that test and the new ones pass (4 of 4). The two new tests: One settles late work through the `Settlement` interface with the delivery; the other sends it straight to the contract, and the node waits, then joins the posted delivery with no second transaction.
  - `forge test --match-contract "MutualSettleNamedDeliveryTest|LateCarriedDeliveryTest"`: 14 pass, 7 of them new in `MutualSettleNamedDelivery.t.sol`.
  - `formal/check.sh safety`: passes, 132,339 distinct states, depth 31, 9 s. `formal/check.sh broken/`: 12 of 12 variants still fail as expected. `formal/check.sh live-`, run once: 7 of 7 configs pass, 286,916 to 328,790 distinct states, depth 32, 71 to 215 s each.
  - The full `pnpm test` run locally failed in every anvil suite and in two timing tests while TLC's liveness run shared the machine; `packages/judgment/src/preflight.test.ts` passes alone (17 tests). CI's shards and anvil jobs are the gate.
- Snapshot diffs: one new snapshot, `error.late-work-settlement-wrong-delivery.expect.md`; no other snapshot changed.
- Metrics: tokens for this task, over the 200k target [inferred]: the API-route question, the EVM rebuild's wait path and one review round added work.

**Review** (one `reviewer` subagent, given CLAUDE.md, ADR-0001, ADR-0019, ADR-0031, `docs/neutrality.md` and `docs/audit/state-model.md`, and not this session's conclusions): ISSUES, with no Critical or High findings. It found no path by which one party, an operator or an adjudicator gets the key or moves funds alone, and no settlement core takes that the contract refuses. Fixed in one round:
- M1: the adapter's rebuild now waits for a direct late settlement and joins the delivery when posted.
- M2: the buyer holds its own envelope before it pays; ADR-0019's amendment and prepare say so, and say the exchange rests on the ciphertext.
- L1: the read model names no posted delivery after a settlement in Held.
- L2: the commitment id is compared in any letter case.
- L3: prepare asks for a buyer envelope only when the key is released.
- M3: this Evidence section.

Left: L4 (the testkit's atomic-key invariant covers decisions only; `simchain.test.ts` checks the settlement case) and L5 (no test that prepare refuses a `delivery` once one is posted, nor that SimChain ignores a carried delivery in Delivered).

## Decisions

**The contract's conditions, which core now mirrors** (`contracts/src/HoldbackRules.sol` at the lane's `4f6cea0`, `mutualSettle` :360-388, `_payOut` :390-420, `_requireKeyProof` :507-512) [measured, by reading]:

| # | Contract | Revert | Core (`state.ts` `mutualSettle`, `lateDelivery`) |
| --- | --- | --- | --- |
| C1 | Stage is Held, Delivered, FallbackJudging or Escalated (:366) | `WrongStage` | `step` sends `mutual_settle` only from those four; elsewhere `invalid_state` |
| C2 | `block.timestamp < expiresAt` (:369) | `MessageExpired` | `messageLive`: `deadline_passed` |
| C3 | No delivery named ⇒ no key, a zero hash, and Held (:370) | `InvalidMessage` | `deliveryHash: null` ⇒ `releaseKey` false ("releaseKey needs a delivery"); after a delivery a null hash is refused by C4 |
| C4 | Outside Held, the hash is the posted delivery's (:374) | `InvalidMessage` | "deliveryHash does not name the current delivery" (unchanged) |
| C5 | Both signatures over the struct (:376-378) | `BadSignature` | SimChain and the adapter run `verifyMutualSettlement` before `step` (unchanged) |
| C6 | With a key: the carried `dv` hashes, with this commitment's id, to the signed hash (:380) | `BadKeyProof` | carried delivery present, `commitmentId` is this deal's, `deliveryHash(d)` equals the signed hash |
| C7 | With a key: the key proof finds the buyer's envelope in `dv`'s key list (:381, :507-512) | `BadKeyProof` | the carried delivery has an envelope whose recipient is the buyer; SimChain and the adapter release the first one, as `keyProof` (`encode.ts:113`) proves it |
| C8 | Each payout above zero, the sum equals the price (:397, :408) | `InvalidMessage` | `mutualSettlementProblem` (unchanged) |
| C9 | Settle once: the stage becomes Settled (:384) | `WrongStage` on a second call | Settled takes no `mutual_settle` (unchanged) |

Not checked by the contract, and so not by core on this path: the seller's signature on the carried delivery, its attempt, its `submittedAt`, `deliverBy`, and the other recipients' envelopes. The seller's signature over the settlement, which names the delivery's hash, endorses it (ADR-0031 §6b). Core is stricter only where the operator applies the club rulebook (`allowed`, `payoutsTo`); the EVM adapter steps with `allowed: true, payoutsTo: any`, so on chain core matches the contract.

**Cases core refused before that the contract also refuses, still refused** [measured: each test passes]:

| Case | Contract | Test |
| --- | --- | --- |
| Releasing a key with no delivery named, in Held | C3 | `state.test.ts` "releasing a key that does not exist yet"; late-work block "releasing a key with no delivery named" |
| A stale delivery hash after a delivery | C4 | "a stale delivery hash" |
| A null hash after a delivery | C3 | "a null delivery hash after delivery" |
| Payouts above or below the price | C8 | "payouts above the price", "payouts below the price", late-work "payouts that do not sum to the price" |
| An expired settlement | C2 | "an expired settlement message", late-work "an expired settlement message" |
| A settlement for another commitment | C5 (the id is in the signed struct) | "a settlement for another commitment" |
| After a decision moved the funds, in Defaulted, before funding | C1 | "settling after a decision moved the funds", "settling in Defaulted", "settling before funding" |
| Settling twice; the race with a decision either way | C9, C1 | "settling twice", both race tests |
| One party signing for both | C5 | `simchain.test.ts` "refuses one party signing for both" (both blocks); `MutualSettleNamedDelivery.t.sol` `test_lateSettlement_needsBothSignatures` |
| After a reclaim | C1 | late-work "a reclaim that lands first ends the deal" |

**What core refused that the contract takes, now taken:** in Held, a named delivery with the key kept, and a named delivery with the key released from the carried delivery. New refusals that match the contract's: no delivery carried, a carried delivery that does not hash to the signed one, a delivery for another commitment, no envelope for the buyer (C6, C7).

**The delivery travels beside the settlement, not in it.** `EscrowEvent` `mutual_settle` and the `Settlement` interface's `mutual_settle` submission gain an optional `delivery`, read only in Held with `releaseKey`. The signed `MutualSettlement` type and `spec/schemas/` are unchanged. `packages/settlement/src/interface.ts` and `packages/testkit` (the scenario step's `carry` and `names`) are outside the listed paths; both are needed for the path to run on both settlement layers.

**An operator that did not relay the settlement waits.** The adapter's rebuild from chain steps a Held settlement with a key only from a copy of the delivery it holds (its relay note, a carried, posted or kept copy). Without one it confirms the transaction from its `MutuallySettled` log and both signatures, waits, and joins once either party posts that delivery to `POST /deliveries` (`sync.test.ts`, the late-settlement test). Until then it serves the buyer's key from the `KeyReleased` log (residual 13).

**The coordinator chose option A on 2026-11-12:** no change to `spec/openapi.json`, the SDK route body or the server's `POST /settlements` here; the route change rides with schema v0.11.

## Handoff

**Works after this change** [measured by the tests named in Evidence]: an agent prepares a late settlement with `POST /v1/prepare/settlement` and its own `delivery`, verifies the hash (rebuilt from that delivery) and signs it; SimChain and the EVM adapter settle it when it is handed to the `Settlement` interface with the delivery, and release the buyer's envelope in the paying step. **Does not work yet:** submitting it through `POST /v1/commitments/{id}/settlements`, which takes a `MutualSettlement` only. Rafa kept this path so that late settlements can be measured; the follow-up below makes it usable.

**The follow-up (an API-contract change, with schema v0.11):**
- New body of `POST /v1/commitments/{id}/settlements`: either a bare `MutualSettlement` (as today) or `{ "settlement": MutualSettlement, "delivery": Delivery }`. The `delivery` is the seller-signed delivery as `delivery.schema.json` defines it. The settlement layer needs from it: `commitmentId`, `attempt`, `ciphertext`, `plaintextSha256`, `plaintextMime`, `encryptedKeys` and `submittedAt`, because the contract hashes all of them into the delivery hash both parties signed (`H.deliveryHash`), and the buyer's envelope in `encryptedKeys` (recipient, scheme, ciphertext, unlock) for the key proof and the released key. Its `signature` is carried but not checked.
- Accept `delivery` only when the deal is in Held and `releaseKey` is true; otherwise refuse it (`invalid_terms`, field `delivery`), as prepare does.
- `POST /deliveries` keeps refusing a delivery from `deliverBy` on (`deadline_passed`); a late delivery reaches settlement only inside a settlement.
- Idempotency: the key covers the whole body, delivery included; the same key with another delivery is `idempotency_conflict` (409).
- Problem types: no delivery carried, a delivery that does not hash to the signed one, a delivery for another commitment, no buyer envelope: all `invalid_terms` (core's details, `state.ts` `lateDelivery`); on chain `BadKeyProof` maps to `invalid_terms` (`packages/settlement/evm/errors.ts`).
- Files: `spec/openapi.json` (and `spec/openapi/paths.json`, its source) for the new body; `spec/schemas/messages.schema.json` does not need to change; `packages/sdk/src/operations.ts` (`operationOf` for `settlements`, `submissionsOf` for `settle`) and its tests; `apps/operator/src/server.ts` (`checkShape`, `placeholderSigned`) and its tests; prepare's `check` line that says the route cannot carry a delivery yet (`apps/operator/src/prepare.ts`); `docs/api.md`; `site/llms.txt`.

**A pre-existing trait for triage, not changed here:** when a node behind the chain joins a delivery, the EVM adapter records the buyer's key again, although `custodyBehind` already served it from the same `KeyReleased` log. `keysFor` then lists one envelope twice, and the log carries two `key.released` events for it. The carried-decision join has the same trait, and `sync.test.ts` (red-team round 3, H2) pins it, so deduplicating it is a change of its own (`evm-settlement.ts`, the `key.released` branch of `record`).

**Sentences for `docs/api.md` and the site after the freeze** (not changed here):
- Settlement rules: "In Held, a settlement may name a delivery that was never posted, the late work, and release its key: send the settlement with that seller-signed delivery. The settlement layer checks that the delivery hashes to the `deliveryHash` both parties signed and holds an envelope for the buyer, and releases that envelope with the payment."
- `releaseKey`: replace "must be false when deliveryHash is null" with "needs a delivery: the posted one, or in Held the delivery the settlement carries".
- Prepare settlement input: "`delivery`: in Held, the seller-signed delivery you hold and want to settle; the operator rebuilds `deliveryHash` from it. Default `releaseKey`: true once a delivery exists or is given."
