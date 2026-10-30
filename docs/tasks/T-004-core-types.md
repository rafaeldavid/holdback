# T-004: Core types, state machine, EIP-712 types, money, timing rules

- **Lane:** core
- **Phase:** 1
- **Depends on:** T-001
- **Paths this task may touch:** `packages/core/`
- **Human gate:** no (yes if a schema must change)
- **Status:** done
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

- **`pnpm verify` (measured, commit `9a5a79a`, 2026-10-30T15:05Z; the only uncommitted change was this task file):**

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 199 ms |
  | lint | `pnpm lint` | pass | 1281 ms |
  | test | `pnpm test` | pass | 4242 ms |
  | spec | `pnpm validate:spec` | pass | 701 ms |
  | snap | `pnpm snap` | placeholder | 286 ms |
  | demo | `pnpm demo` | placeholder | 220 ms |

  `snap` and `demo` are T-005 and T-013 placeholders, not passes.
- **Test count (measured):** 560 across the repo; 547 in `packages/core` (8 files).
  - `state.test.ts` has 171: 15 offer refusals, 26 legal transitions (one per arrow in both diagrams), 103 illegal transitions, totality checks over all 11 states, and 7 property tests.
  - `eip712.binding.test.ts` has 140; `eip712.test.ts` 109; `parse.test.ts` 54.
- **Test first (measured):**
  - Before the first implementation, all 7 core test files failed.
  - Each review fix was preceded by failing tests, with the counts measured:
    - lint probes: 2 failed with the two rules deleted;
    - EIP-712 bindings: 127 failed;
    - parser hardening: 28 failed, including all 5 property tests, which found inputs that threw;
    - state fixes: 14 failed.
- **State-machine mutation sweep (measured):** ad-hoc Python script, not committed (method below; see the proposed check in Handoff).
  - Method: every `if (...)` condition in `state.ts` was replaced by `false`, and every ternary guard `before(...) ?` by `true ?`, one at a time, each against the full core suite.
  - Result: **108 mutants, 107 killed, 1 survivor.**
  - The survivor is `:149 rulebook === null`. It is an equivalent mutant: without it, `rulebookHash(null)` does not match `terms.rulebookHash`, so the result is the same `rulebook_unknown`.
  - Earlier sweeps on this branch left 7, then 4, then 3 survivors. Two of those "kills" came from unseeded property tests catching mutants by chance. Property runs now use a fixed seed, so the sweep is deterministic.
- **EIP-712 field-removal mutants (measured):** removing each of these from both its type and its encoder fails 3 to 11 tests:
  - `Decision.outcome`, `FundingAuthorization.value`, `Delivery.encryptedKeys`, `Appeal.bond`, `AdjudicatorAcceptance.seedCommitment`, `Mandate.scope`.
  - The encodeType strings and digests of all 12 message types and the terms are pinned.
  - Changing any of 97 message leaves changes that message's digest.
- **Second EIP-712 implementation (measured):** a hand-written encodeType, encodeData and hashStruct in `eip712.binding.test.ts` matches viem's `hashTypedData` for all 12 message types and the terms. It uses only keccak and ABI encoding. ethers is not in the lockfile, and no dependency was added.
- **Parsed input never throws (measured):** seeded fast-check properties, 300 to 500 runs each, mutate the examples and the messages the state tests build. Each property must accept more than 20 mutants.
  - `commitmentId`, `termsDigest`, `validateTiming`, `offer`, `typedDataOf` and `messageDigest` never threw on accepted input.
  - `step` never threw on accepted input in any of 10 reachable states.
- **Example round-trip (measured):** all 15 `spec/examples/*.json` files parse through the parser for their schema and parse again identically. One parser exists per schema except `common`.
- **Commitment ID vectors (measured):** ID `0xe8cf56d9…05d585` for the example terms. Seller key `keccak256("holdback/test/seller")` gives address `0xDdC55D01…8d3ce6` and a fixed terms signature. All three are pinned in `eip712.test.ts`.
  - Changing any of the 83 leaf values of the terms changes the ID (one test per leaf). Removing either optional sub-object also changes it.
  - id, signatures and adjudicatorAcceptance do not affect the ID.
- **EIP-712 cross-check (measured):** an `Offer` digest computed by hand recovers the signer of `signMessage`. The second implementation above covers all types.
- **Canonical JSON (measured):** matches the RFC 8785 §3.2.2 number and string-escaping vectors and the §3.2.3 sort vector, written from the RFC text. Hashes are pinned.
- **Money lint rule (measured):** `lint.test.ts` lints probe code through the real `eslint.config.js`.
  - It flags 9 float patterns inside `packages/core/src/money`, unary `+` and `new Number()` included.
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
  - `Scope` carries an explicit `bool hasCategories`, so an absent `categories` and `[]` sign differently (review item 10). This changes the Mandate typehash; no Mandate had been signed yet.
- **`commitment.signatures.*`** hold each party's signature over the `CommitmentTerms` typed data (the full terms). The nine message types, Offer and Agree included, have their own typed data for relayed messages.
- **SimChain verifying contract:** `0x00000000000000000000000000000000484f4c44` ("HOLD"). No SimChain chain ID is defined in the docs; tests use 31337.
- **Guards that need outside data** take it as facts on the event:
  - seller and buyer scope, today's spend, membership, nonce use, balance plus gas buffer, unencumbered bond, and the rulebook found for `rulebookHash`;
  - for `file_appeal`: the required bond (price × rulebook `appealBondRate`, computed by the caller so that no float touches money code), the rulebook appeal fee, and the fee actually authorized. A short bond or fee returns `insufficient_funds`.
  - `step` stays pure. The settlement layer (T-006) supplies these facts.
- **Time.**
  - An action is on time iff `at < deadline`. A timeout fires iff `at >= deadline`.
  - Both comparisons are false for an unparseable time, so a bad clock refuses instead of firing.
  - `step` and `offer` also refuse an unparseable `at` outright, with `invalid_terms`.
- **Appeal deadlines.**
  - `appealBy = decision + appealWindowSec` and `appealDecideBy = appealBy + appealDecideSec`, following "within appealWindow after a first-instance decision".
  - An escalation gets `escalatedAt + appealDecideSec`.
  - `validateTiming` returns the latest possible values (decision at `fallbackBy`) to complete the documented order. See Handoff.
- **Appeal state lives inside the escrow state.** It appears only inside `Released` or `Refunded` reached by a first-instance decision, so escalation is not appealable by construction.
- **`Defaulted → Refunded`** is an explicit `apply_default_outcome` event that anyone may send.
- **Problem types.**
  - A schema failure maps to `invalid_terms`, since api.md has no generic validation type.
  - A trigger sent too early maps to `invalid_state`.
- **Delivery** must carry a content key for all three adjudicators and for the buyer (`invalid_terms` otherwise).
  - The adjudicator keys mean the fallback and appeal adjudicators can always judge.
  - The buyer key is checked at delivery, not at early acceptance. architecture.md (Two-sided hold, step 5) says the delivery carries it. Checking at delivery means early acceptance can never release payment while stranding the buyer without the key, and the seller cannot block an early acceptance by omitting the key later.
- **Mandate at funding.** Funding re-checks the buyer's scope (role, per-commitment cap, expiry), per architecture.md "checked at agree and fund". The daily cap is checked once, at agreement.
- **`appealGround`** is refused on first-instance decisions. It is allowed on decisions with role `appeal`, which includes escalations.
- **Schema loading.** Parsers read `spec/schemas` from the repo at runtime. Publishing the package outside the monorepo would require bundling the schemas.
- **The parser boundary is narrower than the schema** where a value could not be signed or settled. This is a narrowing; it widens nothing.
  - **Signed schemas** (commitment, messages, delivery, appeal, mandate, agent) require:
    - timestamps that are exact RFC 3339 instants in whole seconds, at or after 1970;
    - valid EIP-55 checksums on mixed-case addresses;
    - `appealWindowSec` and `appealDecideSec` within uint32 seconds;
    - `attempt` within uint8;
    - a canonical uint256 decimal for the funding `value`;
    - `createdAt` before `offerExpiresAt`.
  - **Every parser:**
    - routes each `{token, amount}` through `tokenAmount()` (uint256);
    - refuses inexact integers;
    - validates and returns a `structuredClone`;
    - runs Ajv without `allErrors`.
  - Equal instants written differently (for example `Z` and `+00:00`) encode the same signed value. That is intended.

## Handoff

Contract gaps found. None was changed; each is worked around in the narrowest way:

1. **Known gap, a defense change awaiting Rafa and an ADR: the seed check on non-primary decisions.**
   - `step` checks the seed only on primary decisions. That **contradicts ADR-0016 §4** ("refuses a decision unless its seed hashes to `seedCommitment`") and the **Decide row of `docs/architecture.md`**, which apply the check to every decision.
   - Why: only the primary commits to a seed. A fallback deciding after a silent primary cannot know the preimage, so applying the check as written would send every such case to default and defeat `neutrality.adjudicator-silent-before-judging`.
   - Fallback and appeal decisions still check policy, registry, turn and deadline.
   - Left unchanged on review (item 3) until an ADR decides. Options include a fallback seed commitment at takeover, or a seed derived from the commitment ID and a public beacon.
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

Touched outside `packages/core/`:

- `eslint.config.js`: only the money-rule block. T-001 left it as a stub for this task, and the coordinator's brief allowed it.
- `pnpm-lock.yaml`: updated by `pnpm add` for core's new dependencies (viem, ajv, ajv-formats, fast-check). There is no other way to add a dependency in a pnpm workspace.

Outside my lane (not touched):

- `docs/architecture.md` §Identity and signing still says domain version `"0.1"`. ADR-0016 and this package use `"0.4"`.
- Every other workspace package is still named `@holdback/demo`. Each lane should rename its own.
- `docs/team.md` Rules and checks: the "No floats in money" row can point to `packages/core/src/money/lint.test.ts` as its proof.
- **Proposed check (for `docs/team.md`, outside my lane).** The repeated failure mode was guards with no test that reaches them. Proposed: a row "State-machine guards are tested", enforced by a mutation sweep over `packages/core/src/state.ts`. The sweep replaces each guard condition and must find zero non-equivalent survivors. It runs on PRs that touch the state machine. The sweep script can move to `scripts/` when that row is accepted.
