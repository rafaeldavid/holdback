# T-004: Core types, state machine, EIP-712 types, money, timing rules

- **Lane:** core
- **Phase:** 1
- **Depends on:** T-001
- **Paths this task may touch:** `packages/core/`
- **Human gate:** no (yes if a schema must change)
- **Status:** review
- **Agent/session:** implementer (Claude Opus 5.5), branch `t-004-core-types`

## Intent

Encode the domain so illegal states are unrepresentable and every agent message is a typed EIP-712 struct.

Restate this in your own words in this section before writing code.

**Restatement (implementer).** Give every later Phase 1 lane one package, `@holdback/core`, that encodes the v0.4 contract so wrong values fail at the edge or at compile time instead of deep inside settlement or judgment:

- schema types plus parsers that validate untrusted JSON against the real `spec/schemas` files (parse at the boundary, trust inside);
- money as a token plus a base-units decimal string, computed with bigint, with a lint rule that makes floats in money code an error;
- a pure state machine with separate escrow and appeal unions, where each state carries only its own fields, and `step` enforces every guard in the transition table and returns an api.md problem type when it refuses;
- EIP-712 typed data for every signed message, a commitment ID that hashes the terms only, and sign/verify helpers;
- the timing-order and rulebook-minimum validator, and keccak256 over RFC 8785 canonical JSON.

Phase 1 admits only `guaranteed_on_decision` and `maxSubmissions = 1`.

**Non-goals:** persistence, networking, the ledger and its postings (T-006), real signature checks inside `step` (callers verify first), the encryption and content store (T-014), `settle_after_window` and its `Decided` state (Phase 4), and any change to `spec/`.

## Context

- `spec/schemas/*`; `docs/architecture.md` §State machine, §Identity and signing, §Timing rules.

## Acceptance criteria

- [ ] Types generated or hand-written from `spec/schemas` with a test that round-trips every `spec/examples/*` file.
- [ ] Commitment state as a discriminated union; transition function `step(state, event) -> Result<state, Problem>` covering every row of the transition table; table-driven tests for legal and illegal transitions.
- [ ] `TokenAmount` branded string type with bigint arithmetic helpers; lint rule banning `number` in money code.
- [ ] EIP-712 domain (version 0.4) and types for every message in `messages.schema.json` plus Delivery, Appeal and Mandate; the commitment ID hashes terms only (no acceptance, no signatures); sign/verify helpers with viem; tests against fixed vectors.
- [ ] Timing-rule validator enforcing ordering and rulebook minimums.
- [ ] State machine per `docs/architecture.md` (ADR-0016): an escrow-state union and a separate appeal-state union; `AcceptedByAdjudicator` before `Agreed`; `Delivered → FallbackJudging` at `judgeBy`; escalation not appealable. Phase 1 types admit only `guaranteed_on_decision` and `maxSubmissions = 1`.
- [ ] Types for schema v0.4, including `adjudication.registryHash`, `adjudication.policyHash`, the adjudicator acceptance and the split verdict hashes; a keccak256 helper over RFC 8785 canonical JSON with fixed test vectors.

## Out of scope

- Persistence, networking.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **`pnpm verify` (measured, commit `d7f01f8`, 2026-10-30T13:40Z):**

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 179 ms |
  | lint | `pnpm lint` | pass | 793 ms |
  | test | `pnpm test` | pass | 1083 ms |
  | spec | `pnpm validate:spec` | pass | 229 ms |
  | snap | `pnpm snap` | placeholder | 98 ms |
  | demo | `pnpm demo` | placeholder | 103 ms |

  `snap` and `demo` are T-005 and T-013 placeholders, not passes.
- **Test count (measured):** 334 across the repo; 321 in `packages/core` (7 files). The state machine has 118: 11 offer guards, 26 legal transitions (one per arrow in both diagrams), 64 illegal transitions, and 13 totality checks over all 11 states.
- **Test first (measured):** before any implementation, all 7 core test files failed (`Test Files 7 failed`).
- **Tests catch real bugs (measured):** 7 hand mutations, each run against the core suite and then reverted. Every one was caught:
  - seed check removed: 1 test failed;
  - decision policy check removed: 1 failed;
  - appeals allowed after escalation: 3 failed;
  - agreement allowed before adjudicator acceptance: 1 failed;
  - `acceptanceHash` dropped from the terms type: 52 failed;
  - negative amounts allowed: 3 failed;
  - timing order `<` changed to `<=`: 2 failed.
- **Example round-trip (measured):** all 15 `spec/examples/*.json` files parse through the parser for their schema and parse again identically. One parser exists per schema except `common`.
- **Commitment ID vectors (measured):** ID `0xe8cf56d9…05d585` for the example terms. Seller key `keccak256("holdback/test/seller")` gives address `0xDdC55D01…8d3ce6` and a fixed terms signature. All three are pinned in `eip712.test.ts`.
  - Changing any of the 83 leaf values of the terms changes the ID (one test per leaf). Removing either optional sub-object also changes it.
  - id, signatures and adjudicatorAcceptance do not affect the ID.
- **EIP-712 cross-check (measured):** an `Offer` digest computed by hand from the EIP-712 spec, with ABI encoding and keccak and no typed-data helper, recovers the signer of `signMessage`.
- **Correctness of viem's EIP-712 code (inferred):** no second typed-data implementation was run. The hand digest covers one message type only.
- **Canonical JSON (measured):** matches the RFC 8785 §3.2.2 number and string-escaping vectors and the §3.2.3 sort vector, written from the RFC text. Hashes are pinned.
- **Money lint rule (measured):** `lint.test.ts` lints probe code through the real `eslint.config.js`.
  - It flags 7 float patterns inside `packages/core/src/money`.
  - It accepts bigint code there.
  - It does not apply outside that directory.

## Decisions

- **TokenAmount shape.** `TokenAmount` keeps the schema's `{ token, amount }` shape, with `amount: BaseUnits`, a branded decimal string capped at uint256. Every helper returns `Result`, because mixed tokens, negative results and overflow are all possible at runtime.
- **Terms encoding for EIP-712.**
  - `deliverable` and `acceptance` contain fractional weights and open-ended check variants, so the terms struct binds them as `keccak256(RFC 8785 JSON)` (`deliverableHash`, `acceptanceHash`).
  - Every other term is a typed field: timestamps as uint64 seconds, amounts as uint256.
  - The ID is `hashStruct(CommitmentTerms)` with no domain, as the task specifies, so it is the same on every chain. Signatures add the domain.
  - The Phase 2 contract must reproduce this encoding. **Needs Rafa's review.**
- **Optional fields in EIP-712.**
  - An absent `keyForBuyer` or `appealGround` encodes as empty strings. Every schema value for these fields is non-empty, so absent and present cannot collide.
  - An absent `Mandate.scope.categories` encodes the same as `[]`.
- **`commitment.signatures.*`** hold each party's signature over the `CommitmentTerms` typed data (the full terms). The nine message types, Offer and Agree included, have their own typed data for relayed messages.
- **SimChain verifying contract:** `0x00000000000000000000000000000000484f4c44` ("HOLD"). No SimChain chain ID is defined in the docs; tests use 31337.
- **Guards that need outside data** take it as facts on the event:
  - seller and buyer scope, today's spend, membership, nonce use, balance plus gas buffer, unencumbered bond, and the rulebook found for `rulebookHash`.
  - `step` stays pure. The settlement layer (T-006) supplies these facts.
- **Time.** An action is on time iff `at < deadline`. A timeout fires iff `at >= deadline`.
- **Appeal deadlines.**
  - `appealBy = decision + appealWindowSec` and `appealDecideBy = appealBy + appealDecideSec`, following "within appealWindow after a first-instance decision".
  - An escalation gets `escalatedAt + appealDecideSec`.
  - `validateTiming` returns the latest possible values (decision at `fallbackBy`) to complete the documented order. See Handoff.
- **Appeal state lives inside the escrow state.** It appears only inside `Released` or `Refunded` reached by a first-instance decision, so escalation is not appealable by construction.
- **`Defaulted → Refunded`** is an explicit `apply_default_outcome` event that anyone may send.
- **Problem types.**
  - A schema failure maps to `invalid_terms`, since api.md has no generic validation type.
  - A trigger sent too early maps to `invalid_state`.
- **Delivery** must carry a content key for all three adjudicators (`invalid_terms` otherwise), so the fallback and appeal adjudicators can always judge.
- **Schema loading.** Parsers read `spec/schemas` from the repo at runtime. Publishing the package outside the monorepo would require bundling the schemas.

## Handoff

Contract gaps found. None was changed; each is worked around in the narrowest way:

1. **The fallback cannot reveal the primary's seed.**
   - ADR-0016 §4 says every decision's seed must hash to the acceptance's `seedCommitment`. Only the primary commits to a seed, so a fallback deciding after a silent primary could never pass that check, and every such case would go to default. That breaks the neutrality goal of `neutrality.adjudicator-silent-before-judging`.
   - **Workaround:** `step` checks the seed only for primary decisions. Fallback and appeal decisions still check policy, registry, turn and deadline.
   - **Needs an ADR:** for example, a fallback seed commitment at takeover, or a seed derived from the commitment ID and a public beacon.
2. **The example hashes are placeholders (measured).** `commitment.id`, `club.rulebookHash`, `adjudicator.policyHash` and the acceptance `seedCommitment` do not equal their documented derivations. I tested keccak over RFC 8785 JSON of the terms, rulebook and policy, and keccak of the seed bytes and of the seed string.
   - The examples still validate against the schemas.
   - Tests derive self-consistent values from the example terms.
   - T-012 fixtures should derive these hashes with this package. The examples need a follow-up spec PR (human gate).
3. **`appealBy` and `appealDecideBy` are not terms.**
   - `architecture.md` lists them in the fixed deadline order, but the schema has only `appealWindowSec` and `appealDecideSec`.
   - Interpretation: relative to the decision, with the latest bounds derived (see Decisions).
   - An ADR or doc line should confirm it, since bond encumbrance ends at `appealDecideBy`.
4. **The terms encoding is unspecified.** The schema says "EIP-712 struct hash of the terms" without the type definition. Mine is in `packages/core/src/eip712.ts` and is a candidate for an ADR before Phase 2.
5. **`Delivery` and `Appeal` carry no nonce or expiry.** Replay protection relies on the commitment ID, the attempt and the state.

Outside my lane (not touched):

- `docs/architecture.md` §Identity and signing still says domain version `"0.1"`. ADR-0016 and this package use `"0.4"`.
- Every other workspace package is still named `@holdback/demo`. Each lane should rename its own.
- `docs/team.md` Rules and checks: the "No floats in money" row can point to `packages/core/src/money/lint.test.ts` as its proof.
