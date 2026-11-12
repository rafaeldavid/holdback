# T-358: the buyer's payment address, the seller's payout address and an appeal window of 0 (package R6c-1)

- **Lane:** settlement (contracts)
- **Phase:** 2
- **Depends on:** ADR-0033 (Proposed, with D60 and D62; on `main` at `387c934`), ADR-0031 (D57, D58), T-356 (package R5, merged to `contracts-audit-ready` at `02ddb24`), T-341 (the side-by-side harness), T-354 (the alignment test)
- **Paths this task may touch:** `contracts/src/HoldbackTypes.sol`, `contracts/src/HoldbackRules.sol` and `contracts/test/`; `spec/schemas/`, `spec/examples/`, `spec/openapi.json`, `spec/openapi/paths.json`, `spec/README.md`; `packages/core`; `packages/settlement/sim` and `packages/settlement/evm` (with `abis.json`); `packages/testkit` where the fields must be carried; `fixtures/` and their recordings; `apps/operator` only for the appeal-window refusal and to carry the two fields with their defaults; any other package only where the two required fields or the schema version break its build or tests; `tests/cut-feature-alignment.known.json`; this task file. Never `site/`, `docs/api.md`, `docs/audit/`, the vendored escrow, the separate-payment-address funding flow, the faucet, or the client tools (R6c-2 and R6c-3)
- **Human gate:** no for the branch. The freeze, the merge to `main` and the redeploy are Rafa's
- **Status:** review (rafaeldavid/holdback#387)
- **Agent/session:** implementer session, change kind 7 (smart contracts): `forge test`, one reviewer and one red team on Fable at max effort, a target of 300k tokens

## Intent

In my own words: today the address that signs for a party is the address that holds its money. A key that signs every day also collects the income, and a per-deal key has to hold the buyer's funds. This change separates the two roles in one change to the signed terms:

- **Two new fields in `CommitmentTerms`,** right after `seller`: `buyerPaymentAddress` and `sellerPayoutAddress`. The commitment ID hashes both, so nobody can change them after the seller signs.
- **The contract moves money only to and from those two.** The payment address is the escrow's payer: it signs the ERC-3009 funding and receives every refund (a reject, a reclaim, a default, the fee after an early accept and a settlement's remainder). The payout address is the escrow's receiver: it receives a release and the seller's share of a settlement. A settlement may name only those two. `buyer` and `seller` keep signing and receive nothing unless they equal the money address.
- **One new event,** `SettlementAddresses(id, buyerPaymentAddress, sellerPayoutAddress)`, once per deal at funding. No existing event changes.
- **An appeal window of 0.** Phase one has no party appeal, so the terms say so: schema v0.11 allows `appealWindowSec` 0, and the contract, core's `phase_one` profile and the operator's prepare routes refuse any other value with one reason.
- **The versions move once:** schema v0.11, EIP-712 domain and `commitment.schemaVersion` 0.8. Every commitment ID, hash vector, signature and recording moves.

Inputs: ADR-0033 (sections 1, 2, 2b, 3, 4 and 10), Rafa's decisions in D60 and D62. Outputs: the contract, schema, core, SimChain and adapter changes, their tests, the re-seated fixtures and recordings, and the harness comparing this change with its parent.

Non-goals: no refund to a third address (roadmap N81); no change to the vendored escrow; no tooling for a separate payment address (prepare inputs, faucet, buyer signer, seller adapter: R6c-2 and R6c-3); no edit to the live docs (`site/`, `docs/api.md`, `docs/audit/`); nothing deployed; nothing merged to `main`.

## Context

- ADR-0033 (on `main`): the fields, the four contract edits and the event (section 2), the appeal window (2b), who signs what (3), the mirrors (4), the tests (10).
- ADR-0031 section 8 point 3 (the appeal window, amended by ADR-0033 §2b).
- The contract refinement plan (kept privately, `docs/private-materials.md`): package R6c's table and the alignment table.
- `contracts/test/differential/` (T-341, T-356): each change is compared with its parent.

## Acceptance criteria

- [ ] A deal whose payout address differs from the seller's signing address releases to the payout address; the signing address receives nothing (unit test, invariant, one scenario on SimChain and on the contract).
- [ ] A mutual settlement pays the payout address. A changed payout address changes the commitment ID.
- [ ] A deal whose payment address differs from the buyer's signing address: the payment address funds it; a reject, a reclaim, a default and a settlement's remainder return there; the signing address holds nothing at any step. An authorization signed for another deal does not fund this one. After the escrow's expiry only the payment address can reclaim, and the deal still closes. A contract wallet (ERC-1271) works as the payment address.
- [ ] A deal whose two addresses equal the signing addresses settles as before.
- [ ] Terms with an `appealWindowSec` of 0 fund and settle; any other value is refused by the contract, by core and at prepare, with the same reason.
- [ ] The hash vectors match between the contract and core (`Vectors.t.sol`, `eip712.vectors.test.ts`).
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm validate:spec`, `pnpm snap`, `pnpm snap --settlement=local`, `forge test` and the anvil suites pass.
- [ ] Runtime size before and after; the alignment test's count before and after.

## Out of scope

- The operator's prepare inputs for a separate payment or payout address, its warnings, and the faucet (R6c-2). The late-work settlement's API route (R6c-2).
- The buyer signer, the seller adapter, the audit deal, `examples/verify.ts`'s payment record and `site/llms.txt` (R6c-3).
- The audit pages' edits that ADR-0033 section 11 lists.

## Evidence

Labels: measured, inferred, guessed. All runs on the branch in this worktree, 2026-11-12.

- **Runtime size** [measured, artifact runtime length of `HoldbackRules`]: 19,651 bytes at the lane tip `02ddb24` (as T-356 measured), 19,914 bytes with this change: **263 bytes added** (two hashed words, the payout comparison, the event, the appeal-window check). The limit is 24,576 bytes.
- **`forge test`** [measured]: 58 suites, 419 passed, 0 failed, 0 skipped, at `5657db2` after both reviews' fixes. New: `test/unit/TwoAddresses.t.sol` (28 tests, numbered by ADR-0033 section 10), three appeal-window tests in `StrictTerms.t.sol` (one old test that said the field was unchecked replaced), `invariant_signingAddressesMoveNoMoney` in `RulesInvariants.t.sol`. 419 − 31 = 388 at the tip, as T-356 counted [inferred].
- **The side-by-side harness** [measured]: `SideBySide.t.sol` 5 passed, `testFuzz_sideBySide` 257 runs; the planted mutant still fails it.
- **Hash vectors** [measured]: `Vectors.t.sol` and `packages/core/src/eip712.vectors.test.ts` pin the same 11 values, recomputed from `spec/examples/commitment.example.json`, whose payout address now differs from its seller. `eip712.binding.test.ts`'s second, hand-written EIP-712 implementation agrees with core under domain 0.8.
- **`pnpm validate:spec`** [measured]: 35/35 examples valid; `spec/openapi.json` fresh.
- **`pnpm lint`** [measured]: no finding.
- **`pnpm snap`** [measured]: 42 fixtures, all pass after `--update`. In the 39 existing snapshots only commitment IDs, hashes, the club's rulebook hash and panel seats changed (256 lines in, 256 out); no state, amount, balance or deadline line changed. Three new snapshots: `two-addresses-released`, `-refunded`, `-settled`.
- **`pnpm snap --settlement=local`** [measured]: 35 passed, 0 failed, 7 excluded (the SimChain-only list, unchanged); the three new scenarios give a transcript identical to SimChain's on the contract (gas 501,780, 484,371 and 522,913 over 3 transactions each).
- **Recordings** [measured]: `node scripts/reseat-recordings.mjs` moved seats in 17 recorded scenarios and changed no verdict. Two authored verdicts changed seat within their role: `neutrality.appeal-adjudicator-offline-after-escalation` (gpt-a takes qwen-a's abstain) and `todo.provider-outage` (gpt-b takes gpt-a's abstain).
- **The alignment test** [measured]: the known list goes from 115 to 117 files. Two SimChain tests now wait for the full protocol's `appeal.expired` that a window of 0 sends at once after a decision (`examples/deal-record.test.ts`, `tools/sim/world.test.ts`; decision 10), so they name a cut identifier. No other file changed in the list.
- **`pnpm typecheck`** [measured]: no error.
- **`pnpm test`** [measured]: 169 files, 3,326 passed, 6 skipped, 2 failed: the alignment list (fixed, above) and `examples/e2e-round.test.ts` scenario 3d (existing before this change, Handoff; not in CI's anvil suites).

## Review

- **Reviewer** (one `reviewer` subagent with CLAUDE.md, ADR-0031, ADR-0033 and the threat model): ISSUES, no Critical or High. M-1 (a direct funding named the signing buyer as its actor; no direct-route test with the addresses apart), M-2 (the site bundle is outside the paths), M-3 (no recorded evidence): all fixed in `6072211` and this file. L-2 (vectors could not tell `buyer` from `buyerPaymentAddress`) and L-3 (the allow-list did not check the new event's address topics): fixed in `6072211`. L-1 (agree-and-fund prepared from the signing key): fixed in `5657db2`. L-4 (ADR-0033 §10 tests not built): open, below.
- **Red team** (`red-teamer` on Fable at max effort, same inputs): the change holds; no Critical, High or Medium; 6 Low, 8 Info; 17 Solidity and 25 TypeScript scratch attacks, all deleted afterwards. Fixed in `5657db2`: L-1 (the payment address funds and pays the fee in the prepared agree-and-fund), L-2 (the adapter refuses a funding whose `from` is not the payment address), L-3 (one payout when the two money addresses are one), L-4's text (`payoutsTo: parties` names the money addresses), L-6 (a stale spec test). I-8 (no payout of 0 in that one-address case): fixed after `5657db2`.
- **Open Lows, for later packages:**
  - Six ADR-0033 §10 tests are not in the suite: 16 (an undeployed ERC-6492 wallet as the payment address), 17 (EIP-7702), 18 (a wallet that turns hostile after funding, addresses apart), 24 (a token that refuses the payout address), 34 (SimChain: appeal stakes and an overturn with the addresses apart), and 35's SimChain side (one address for both money roles). The red team wrote and passed each; the sources are in its report (kept privately in the session's scratch folder, not committed). Test 15 on `LocalUSDC` and a test of the fee slot's signer and of the adapter's new refusal are not committed either.
  - A rulebook cannot bound which addresses fund or receive a deal: membership and mandates bind the signing addresses only (red team L-4). A rulebook field ("money addresses equal the signers", for example) is a roadmap row for Rafa.
  - The prepare routes' check lines (`apps/operator/src/prepare.ts`, agree-and-fund, early accept, settlement) still describe money by the signing addresses (R6c-2).
- **Info for others:** the operator API takes 65-byte signatures only, so a multisig of two or more cannot be a payment address through an operator; the direct route works (residual 13, T-227). `tools/sim/check.ts` and `examples/deal-record.ts` derive postings from the signing addresses and would report a deal with the addresses apart as a mismatch (R6c-3; `tools/sim/check.ts` is in no package yet). A payout address equal to the deciding adjudicator funds, and nothing warns until R6c-2. The invariant campaign reverts on about 86% of its calls. The full protocol's default appeal window of 0 (decision 3) is for Rafa to confirm and for `docs/decisions-today.md`.

## Decisions

Choices made inside this task where ADR-0033 is silent or offers two ways.

1. **The contract's refusal is `InvalidMessage`,** as ADR-0033 §2b says ("with the same error" as `maxSubmissions`). A custom error cannot carry text, so the one reason is core's `APPEAL_WINDOW_PROBLEM`; the prepare route answers with it, and `StrictTerms.t.sol` cites it beside the revert.
2. **The rulebook's appeal-window minimum (ADR-0033 §2b's open point): both ways.** Core's `phase_one` profile replaces the rulebook's minimum with 0 for this field, so a phase-one deployment takes a club whose minimum is above 0. And `club.schema.json` lets the minimum be 0, so SimChain's full protocol can run a deal with a window of 0: the fixture club, the spec example club, the demo world's club and the test rulebooks set it to 0. A club that wants party appeals on SimChain raises it.
3. **The operator's default window is 0 everywhere,** not only on a phase-one deployment, because the client's `verify.ts` rebuilds the terms with the same default and cannot tell which settlement an operator runs. An agent on SimChain that wants a party appeal names its window; the SimChain appeal tests now do.
4. **The harness's parent is re-seated for the new signed type** (`Sides.sol`, `PinnedSource.t.sol`). `parent/` is `02ddb24` with only ADR-0033 §1's edits: the struct, the type string, the commitment ID and the domain version. So both sides take one ABI and the run isolates this change's behaviour, and its allow-list has three entries: the new event at funding, and the appeal-window refusal (funded on the old side, or refused there for a later reason). In trace mode the handler keeps each deal's addresses equal, where the parent pays the same addresses; the invariant campaign draws one deal in four with both money addresses apart. The next change re-vendors `parent/` from its own parent as before; from then on the ABIs match.
5. **No comparison of addresses,** as ADR-0033 §2 says: a zero payout address funds and an accept sends the price there; a zero payment address never funds (tests 19).
6. **The prepare route's settlement payouts and its phase-one payee check use the money addresses.** T-356's hand-over says the contract, core, the adapter and this route must change together; leaving the route on `buyer`/`seller` would have prepared settlements the contract refuses.
7. **The testkit names money parties** with `parties.buyer_payment` and `parties.seller_payout` in a scenario; each defaults to its party. The settled scenario does not try a payout to a signing key: the fixture club's `payoutsTo: any` takes it on SimChain and the phase-one contract refuses it, so the two worlds would differ. The contract and core tests cover that refusal.
8. **The client tools carry the fields with their defaults only.** `examples/verify.ts` pins domain 0.8 and the new type, derives the payment record's receiver from `sellerPayoutAddress`, and names the payment address as the signer of the funding and fee slots; the example clients and test agents state a window of 0. Choosing a separate address, and checking it, is R6c-3's.
9. **Generated files:** `site/try.mjs` and `site/index.html` are rebuilt by `node site/build.mjs` from `examples/try.ts`; no site text was edited. This is the one exception to the paths list (reviewer M-2): leaving the bundle stale fails `tests/` on every pull request.
10. **Tests the 0 s window exposed:** with no appeal window, an operator on SimChain closes the appeal at once after a decision. Two tests read the log between the decision and that close (`examples/deal-record.test.ts`, `tools/sim/world.test.ts`); they now wait for the deal to be final. Tests that file a party appeal on SimChain name a 300 s window.

## Handoff
**State:** see the pull request. Nothing is deployed; nothing is on `main`.

**For R6c-2 (operator side) and R6c-3 (client side):**

- **Fields:** `buyerPaymentAddress` and `sellerPayoutAddress`, each `address`, required, right after `seller` in `CommitmentTerms` and in the contract's `HoldbackTypes.Terms`. Schema v0.11 (`Holdback-Schema-Version: 0.11`); EIP-712 domain and `commitment.schemaVersion` "0.8".
- **Event:** `SettlementAddresses(bytes32 indexed id, address indexed buyerPaymentAddress, address indexed sellerPayoutAddress)`, no data, emitted once in `agreeAndFund` right after `JobFunded`. Every other event is unchanged and names the signing addresses.
- **The appeal window:** `APPEAL_WINDOW_PROBLEM` in `packages/core/src/state.ts`, exported from `@holdback/core`: "timing.appealWindowSec must be 0: phase one has no party appeal, so the first decision is final and the phase-one contracts refuse any other appeal window (ADR-0033 §2b)". Core's `phase_one` offer refuses with it (`invalid_terms`); the offer prepare route refuses with it at field `timing.appealWindowSec` when `phaseOne`; the contract reverts `InvalidMessage`. The operator's default window is 0 (`apps/operator/src/terms.ts`).
- **Already in place for R6c-2:** `completeTerms` sets both money addresses to the signing addresses; the settlement prepare route builds and checks payouts against the money addresses. Not built: prepare inputs for a separate address, the notices and warnings of ADR-0033 §7, the funding and operator-fee slots signed by a separate payment address, the faucet sending tokens to the payment address, the undeployed-wallet exception (ADR-0033 §10, L-4), and the late-work settlement's API route (T-357's hand-over).
- **Already in place for R6c-3:** `examples/verify.ts` hashes the new type under 0.8, derives the payment record's receiver from `sellerPayoutAddress`, and names `buyerPaymentAddress` as the funding and fee signer, taking both addresses from the terms. Not built: the check that the payment address is the client's own and the payout address the one it approved, the buyer signer's outside signature, the seller adapter's payout field and lines, the audit deal's two-address case, the deal record, `site/llms.txt`.

**ADR-0033 section 10 tests not built here** (each a Low gap, listed for the docs and later packages): 15 runs on the mock token and `TestUSDC`, not `LocalUSDC`; 16 (an undeployed ERC-6492 wallet as the payment address), 17 (EIP-7702 delegated code), 18 (a wallet whose answer changes after funding, with the addresses apart), 24 (a token that refuses transfers to the payout address), 33 (`neutrality.direct-funding-separate-addresses`, a direct funding and settlement on the local chain followed by the adapter's sync), 34 (SimChain: an appeal never moves a money address's balance; an overturn pays the wronged party's money address).

**Found, not changed:**

- `examples/e2e-round.test.ts` (anvil, not in CI's anvil suites) fails scenario 3d: it still expects `dealOf` to read `Expired` and `expireOffer` to emit `JobExpired`, which SC-6 removed. T-356's hand-over names the fix (check the operators' `Expired` and `dealOf` `None`). It fails the same way at `02ddb24` [inferred: the checks read state SC-6 removed].
- `spec/README.md` says the next breaking version removes `KeyRegistration`. v0.11 is breaking and keeps it, to stay inside this package; the changelog says so.
- `main`'s `contracts/test/unit/ZeroPrice.t.sol` (T-345) is not on the lane. When the lane takes it, its assertions move to the payment and payout addresses; `TwoAddresses.t.sol` tests 20 cover a zero price with the addresses apart meanwhile.
- `tests/metrics/fixtures/deal-once.events.json` and `discovery.json` are recordings of the deployed 0.7 world and were left as recorded.
- The live docs (`docs/api.md`, `site/llms.txt`) still describe the deployed contracts.

**For the lane's words package (AL-2): the seven `docs/audit/` edits of ADR-0033 §11,** not made here because this change is past its token budget (the coordinator, 2026-11-12, added them to this task's paths if they fit):

1. `state-model.md` §8.1, the signed-field register: the row for `buyer` and `seller` splits. `buyer` and `seller` are enforced as signers; `buyerPaymentAddress` and `sellerPayoutAddress` are enforced as the escrow's payer and receiver.
2. `threat-model.md` §2, the actors: the buyer's row splits into the signing key and the payment address, as in ADR-0033 §11's table; the primary's "cannot" cell names the payout and payment addresses.
3. Assumption TA-4 widens: nothing requires the parties' four addresses and the three adjudicators to differ from each other.
4. A new assumption: the payment address trusts the buyer's signing key with this deal's hold. Its signature on the funding is its consent; its loss is bounded by price + fee and the operator fee.
5. `threat-model.md` §3 (the token's behaviour): "the buyer" and "the seller" as recipients become the payment address and the payout address.
6. `threat-model.md` §6: a payout address that is one of the deployment's own contracts strands the seller's payment; both parties signed the terms that name it (`TwoAddresses.t.sol`, `test_25_tokenStoreAsPayout_doesNotDisturbAnotherDeal`).
7. `events.md`: the new `SettlementAddresses(bytes32 indexed id, address indexed buyerPaymentAddress, address indexed sellerPayoutAddress)`, emitted once in `agreeAndFund` after `JobFunded`; and the sentence that `provider` and `client` in the ERC-8183 events name the parties (the signing addresses), not the addresses that receive tokens.

**Before the freeze:** the Sepolia redeploy is Rafa's. No Worker deploys from a commit with this change before the new contracts are on Sepolia (ADR-0033 §1). The same holds for the site: `site/try.mjs` and `site/index.html` are rebuilt here from `examples/try.ts` (its test fails on a stale bundle), and the rebuilt try command signs under domain 0.8, so a site deploy before the redeploy would send deals the deployed 0.7 contracts revert with `BadSignature` [inferred]. The lane is not merged to `main` before the freeze, so neither deploys from it.
