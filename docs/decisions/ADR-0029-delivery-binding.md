# ADR-0029: Decisions, early accepts and judgment records name the delivery they settle

- **Status:** Proposed, 2026-11-03. Option A is adopted under "autonomy inside the repo" (D44) after a Fable max-effort research pass; Rafa may overrule any line. Built in T-212 item 3 (branch `t-212-delivery-binding`); the Sepolia redeploy and the Worker switch wait for Rafa.
- **Date:** 2026-11-03
- **Raised by:** T-212 item 3, from T-206 L-1 (`docs/reviews/2026-11-03-contract-review.md` §2.3) and the cross-family pass (§8, "A decision is not bound to the delivery"). Rafa asked for the fix in the contracts (2026-11-03). Research: this note (Fable 5.1, maximum effort; code read, nothing run).
- **Builds on:** ADR-0012 (two-sided hold), ADR-0016 §3–4 (signed messages; settlement checks on every decision), ADR-0018 (panel seed hashes the attempt), ADR-0019 (a `MutualSettlement` already names `deliveryHash`), ADR-0024 §8 (the settlement view, one word per deal), ADR-0028 (the demo settles on Sepolia); D26, D28, D31, D32, D37.
- **Changes:** `spec/schemas/` (v0.9: `messages.schema.json` `EarlyAccept` and `Decision`, `judgment.schema.json`, `commitment-state.schema.json`, `commitment.schema.json`), the EIP-712 domain version (0.6 → 0.7), `packages/core` (`eip712.ts`, `state.ts`, `types.ts`), `packages/settlement/sim` (through core), `packages/settlement/evm` (`encode.ts`, `evm-settlement.ts`, `abis.json`), `contracts/src/HoldbackTypes.sol` and `HoldbackRules.sol` with tests and a new Sepolia deployment, `apps/adjudicator` (`service.ts`), `apps/operator` (`prepare.ts`), `examples/verify.ts`, `site/llms.txt`, `spec/examples/`, every scenario snapshot.
- **Amends:** ADR-0016 §4 (a fourth settlement check), ADR-0012 (which envelope a paying transaction releases), D37 point 3 (the contract now stores one delivery hash per deal). Ships as schema v0.9; T-033's additive items join the same version before the Sepolia redeploy.

Labels: **measured** (a test or tool run), **inferred** (from reading the code), **guessed** (a judgement not checked).

## Context

- **What a decision binds today.** `Decision(bytes32 commitmentId,uint8 attempt,address adjudicator,…)` and `EarlyAccept(bytes32 commitmentId,address buyer,uint8 attempt,bytes32 nonce,uint64 expiresAt)` name an attempt, never a delivery (`packages/core/src/eip712.ts`, `contracts/src/HoldbackTypes.sol`) [inferred]. The `Deal` word stores `attempt` and no delivery hash (`HoldbackRules.sol`; D37 point 3: "The contract stores no envelope or delivery hash") [inferred].
- **What the contract checks.** In `Held`, `decide` and `earlyAccept` accept any seller-signed attempt-1 delivery carried in the call (`_acceptDelivery`). In `Delivered`, `decide` ignores the carried delivery, and `earlyAccept` accepts any seller-signed delivery whose `attempt` equals the stored one. `mutualSettle` checks `m.deliveryHash` against the carried delivery only when it releases the key, never against the posted delivery [inferred]. Core refuses a mutual settlement whose hash is not the current delivery's (`state.ts`), so core and the contract disagree on that path [inferred].
- **Who can exploit it.** Only the seller: a carried delivery signed by anyone else reverts, and in `Delivered` the carried delivery is ignored (PR 155 reviewer, forge probes) [measured]. A seller who signs two attempt-1 deliveries can settle a decision or an early accept about one with the other; `JobSubmitted` and `KeyReleased` then name the delivery nobody judged or opened. Three such attacks pass on the pre-ADR contract (`DeliveryBinding.t.sol` at commit cc424bd: a carried decision, an early accept paired with another delivery, a mutual settlement naming another delivery) [measured].
- **The record has the same gap.** `judgment.schema.json` has no delivery hash, and the reference adjudicator's preflight never checks the seller's signature on `task.delivery` [inferred]. An adjudicator handed a body the seller never signed would judge it and sign a decision a relayer can settle against the seller's real delivery (review §8) [inferred].
- **Money is unaffected under D32.** The buyer who early-accepts opened the body it was handed before signing and holds its key; a judged accept releases the key the adjudicator wrapped from the body it opened. What is wrong is the record, the envelope the chain names, and the appeal path (an appeal adjudicator can be handed a different seller-signed body than the first instance judged) [inferred]. D26 wants a "clean, signed, attributable record"; the chain record does not say which body was paid for.
- **Who is left stuck without a fix.** A buyer that reads the chain alone (the escape hatch, ADR-0005) gets a key for the judged body while `JobSubmitted` names another ciphertext; it recovers only by finding the judged body elsewhere [inferred].
- **Precedent.** `MutualSettlement` names `hasDelivery` and `deliveryHash` since ADR-0019; `llms.txt` already teaches agents to compute the delivery hash and to check it against `delivery.submitted` at both operators [inferred].
- **Constraints.** `HoldbackRules` runtime was 24,244 bytes after T-212's overturn payout (PR #160), 332 under EIP-170 [measured]. A deal's three transactions take about 1.56 million gas on Sepolia; a fresh storage slot is 22,100 gas at Prague prices (20,000 + 2,100 cold access), and T-213 measured Sepolia pricing new state at about 3.5 times anvil's (ADR-0028 §3, T-215) [measured by T-213; the per-slot figure on Sepolia is inferred]. The schema is the API contract: a change needs an ADR and a version bump; the domain version and `commitment.schemaVersion` move only when an existing typed-data struct changes (`spec/README.md`, v0.7 rule). Contract changes ship as a new deployment that new deals opt into; the redeploy and the Worker switch wait for Rafa (ADR-0028, CLAUDE.md gates).

## Decision

### 1. Every paying or judging signature names the delivery by hash

Add `bytes32 deliveryHash` to `Decision` and `EarlyAccept`, right after `attempt`. The value is the EIP-712 struct hash of the seller's delivery without its signature, the same value `MutualSettlement.deliveryHash` and the `delivery.submitted` event carry (`core.deliveryHash`, `H.deliveryHash`). `attempt` stays: ADR-0018's `panelSeed` hashes it and the contract compares it before the seed check, so removing it would ripple into the seed design for no gain.

Type strings, core and contract identical:

```
EarlyAccept(bytes32 commitmentId,address buyer,uint8 attempt,bytes32 deliveryHash,bytes32 nonce,uint64 expiresAt)

Decision(bytes32 commitmentId,uint8 attempt,bytes32 deliveryHash,address adjudicator,string role,string outcome,bytes32 seed,bytes32 policyHash,bytes32 registryHash,bytes32 judgmentRecordHash,SealedKey keyForBuyer,string appealGround,Beacon beacon,EncryptedKey[] encryptedKeys,bytes32 nonce,uint64 expiresAt)
```

The referenced types (`Beacon`, `EncryptedKey`, `KeyUnlock`, `SealedKey`) and their sorted concatenation are unchanged. No `has…` flag: a decision or an early accept always has a delivery (there is no turn to decide before one lands), so the hash is never null, unlike `MutualSettlement`.

- **core** (`eip712.ts`): `messageTypes.EarlyAccept` and `messageTypes.Decision` gain `field('deliveryHash', 'bytes32')` after `attempt`; `encodeMessage` passes `deliveryHash: m.deliveryHash` for both; `HoldbackDomain.version` and `holdbackDomain` become `'0.7'`. `types.ts`: `EarlyAccept.deliveryHash: Hex32` and `Decision.deliveryHash: Hex32`, required.
- **contract** (`HoldbackTypes.sol`): `struct Decision` and `struct EarlyAccept` gain `bytes32 deliveryHash;` after `attempt`; `EARLY_ACCEPT_TYPEHASH` and `DECISION_TYPEHASH` take the strings above; `decisionHash` and `earlyAcceptHash` encode the field after `m.attempt`. `_domainNameAndVersion` returns `("Holdback", "0.7")`.

### 2. The contract stores the posted delivery's hash and refuses any signature that names another

**Storage.** One new mapping beside the deal word: `mapping(bytes32 commitmentId => bytes32) public deliveryHashOf;`. It is written once per deal, by whichever call lands the delivery (`_acceptDelivery`, which returns the hash it verified). A separate mapping, not a second word in `Deal`, so `Deal memory d = _deals[id]` and the `_deals[id] = d` writes stay one slot each, the timeouts never read it, and the public getter gives Etherscan readers and the EVM adapter's mirror the value without a hand-written view.

**Checks by stage.** One rule throughout: the hash a signature names must equal the posted delivery's.

| Stage at the call | Call | What lands and what is checked |
| --- | --- | --- |
| `Held` | `deliver(t, dv, sig)` | As before, plus `deliveryHashOf[id] = dh` |
| `Held` | `decide(t, m, dv, sig)` carrying the delivery | `_acceptDelivery` verifies the seller's signature over `dv` (before `deliverBy`, attempt 1), stores `dh`; then `m.deliveryHash == dh`, else `InvalidMessage`. The hash is stored even though the deal may settle in this call, because an escalation or a later party appeal must name the same delivery |
| `Held` | `earlyAccept(t, m, dv, sig, k)` carrying the delivery | `_acceptDelivery`, then `m.deliveryHash == dh`, then the key proof against `dv.encryptedKeysHash` |
| `Delivered` | `decide` (primary) | `m.deliveryHash == deliveryHashOf[id]`; the carried `dv` stays ignored |
| `Delivered` | `earlyAccept` | `H.deliveryHash(id, dv) == deliveryHashOf[id]` and `m.deliveryHash == deliveryHashOf[id]`. The seller-signature re-check is dropped: a hash equal to the stored one is the delivery already verified when it landed |
| `FallbackJudging` | `decide` (fallback) | `m.deliveryHash == deliveryHashOf[id]` |
| `Escalated` | `decide` (appeal) | `m.deliveryHash == deliveryHashOf[id]` |
| `Released` or `Refunded`, appeal `Open` | `decide` (appeal) | `m.deliveryHash == deliveryHashOf[id]`: the appeal adjudicator judges the same body the first instance did |
| any funded stage | `mutualSettle` | As before, plus: when the stage is not `Held` (so `m.hasDelivery` already holds), `m.deliveryHash == deliveryHashOf[id]`, else `InvalidMessage`. This is core's existing rule and closes the mirror divergence the adapter would otherwise hit |

In `decide`, the comparison joins the existing `m.role != role || m.attempt != d.attempt || …` chain as `|| m.deliveryHash != deliveryHashOf[id]`, read after the `Held` branch. Nothing else in the stage machine moves. Events are unchanged: `JobSubmitted` already emits the hash; the decision's and early accept's calldata now carry it. No event, getter or emit is removed.

With `maxSubmissions` above 1 (Phase 4) a later attempt overwrites the slot; the rule "a signature names the delivery it settles" is the same.

### 3. The judgment record names the delivery it judged, and the adjudicator checks what it is handed

- `judgment.schema.json` gains `deliveryHash` (Hex32, required), after `attempt`. `recordHashOf` covers it, so `Decision.judgmentRecordHash` binds it; a verifier holding the record checks `record.deliveryHash == decision.deliveryHash == deliveryHashOf[id]`.
- The reference adjudicator (`service.ts`): `#preflight` verifies the seller's signature on `task.delivery` against `commitment.seller` and refuses `invalid_signature` before any judge is called; `#sign` sets `deliveryHash: deliveryHash(task.delivery)`; `#record` adds `deliveryHash` to the body. This is the check T-206 handed to T-211 and T-213; it lands here with the field it needs.
- Settlement does not read records; the chain binds the hash through the signed decision, and the record makes it checkable off chain.

### 4. Versions

- **Schema v0.9.** Every `$id`, the `Holdback-Schema-Version` header and `x-holdback-schema-version` move to 0.9.
- **EIP-712 domain 0.7** and **`commitment.schemaVersion` "0.7"**, by the v0.7 rule in `spec/README.md`: an existing typed-data struct changes. `commitment.schema.json`'s `schemaVersion` const becomes `"0.7"`, so every commitment ID in the fixtures changes, and a 0.7 deal states which signed encoding, and so which deployment, settles it. T-033 was planned as additive ("the EIP-712 domain moves only if an existing type changes"); this item is the one that moves it. T-033's additive items join v0.9 before the Sepolia redeploy, so there is one version, one `llms.txt` rewrite and one redeploy.

### 5. What each layer changes

- **core.** §1 types and encoding; `state.ts`: `firstInstance` and `escalationDecision` refuse `m.deliveryHash !== deliveryHash(s.delivery)` (`invalid_terms`); `AppealContext` gains `deliveryHash` taken from `s.via.decision.deliveryHash`, and `stepAppeal`'s `decide` refuses a mismatch, so the appeal names what the first instance named; the `early_accept` branch refuses `m.deliveryHash !== deliveryHash(s.delivery)`. `mutualSettle` was already right.
- **SimChain.** No logic beyond core's `step`.
- **EVM adapter.** `earlyAcceptView` and `decisionView` pass `deliveryHash`; `abis.json` regenerates from the forge artifacts (`abis.test.ts` pins it); the mirror check after a call that lands a delivery compares `deliveryHashOf(id)` with `deliveryHash(delivery)`; `carryDelivery` is unchanged.
- **Reference adjudicator.** §3.
- **Operator.** `prepare.ts` fills `deliveryHash` beside `attempt` for `early-accept` from the posted delivery; `commitment-state.schema.json` gains an optional `deliveryHash`, so a buyer can cross-check two operators as it does for `attempt`.
- **Schemas and examples.** §1, §3, §4; `spec/examples` for `EarlyAccept`, `Decision` and the judgment record carry the field; `pnpm validate:spec` strict.
- **`site/llms.txt`.** The EIP-712 types list (`EarlyAccept`, `Decision`), domain version 0.7, the "`attempt`" paragraph becomes "`attempt` and `deliveryHash`", and the early-accept paragraph says: put the hash of the delivery you opened in `deliveryHash`; the contract refuses an early accept relayed with any other delivery. `examples/verify.ts` (its `EarlyAccept` type and intent) and `try.mjs` follow. `try.mjs` keeps accepting SimChain's domain as well as the pinned Sepolia one (ADR-0028 §9), both now at 0.7; the 0.6 deployment cannot settle 0.7 messages, so the pinned Sepolia addresses change with the redeploy.
- **Formal model.** Unchanged: `Holdback.tla` has one delivery per commitment (`Deliver(c)`), so delivery identity is outside it. The check is a data-integrity rule with no model counterpart.
- **Docs.** ADR-0016 §4 adds "its `deliveryHash` is the posted delivery's"; ADR-0012 says the envelope released is the one in the delivery the paying signature names; D37 point 3 is amended; `docs/neutrality.md` gains a line on seller equivocation (both signatures are the seller's: evidence, D26).

### 6. Tests that must fail before the change

Contract (`contracts/test/unit/DeliveryBinding.t.sol`): three attacks committed first, passing on the pre-ADR contract (cc424bd), then turned into refusals; the role, carry, stored-hash and mutual-parity cases beside them. `Vectors.t.sol` re-pins against core's vectors, now generated in the repository (`packages/core/src/eip712.vectors.test.ts`). `RulesHandler`: the decide and early-accept actions name the posted delivery, rarely another, and a success naming another counts as an unauthorised success. `GasPerDeal.t.sol` records the new figures.

Core and apps: `state.test.ts` refuses a wrong `deliveryHash` in `Delivered`, `FallbackJudging`, `Escalated` and an open appeal, and on `early_accept`; `eip712.binding.test.ts` pins the type strings and domain 0.7; the scenario fixture `attack.seller-equivocates-delivery`; `service.test.ts`: the decision's `deliveryHash` equals `deliveryHash(task.delivery)`, the record carries it, and a task with an unsigned or wrongly signed delivery is refused before any judge call; `evm-settlement.test.ts` on anvil keeps every running fixture's transcript identical to SimChain's. `pnpm validate:spec` fails an `EarlyAccept`, `Decision` or record without the field (`tests/spec.test.ts`).

### 7. Cost

- **EIP-170.** Guessed before the build at 150 to 250 bytes. Measured: `HoldbackRules` runtime 24,313 bytes, 263 under the limit (+69 bytes), so no cut was needed (`forge build --sizes`) [measured]. Had it not fit, the plan was to drop T-212 item 6's dead `MUTUAL_FEE_SHARE_BPS` branch first; no getter, event or emit is removed in any case (Rafa, 2026-11-03).
- **Gas** [measured, forge unit tests, same-transaction accounting; Sepolia figures stay to be measured on the new deployment]: `deliver` 18,541 → 40,799; a decision carrying the delivery 78,513 → 98,907; an early accept carrying it 74,812 → 95,225; a decision after `deliver` 70,796 → 71,115 (forge runs a test in one transaction, so the slot read is warm here; a separate transaction pays 2,100 more for the cold read [inferred from EIP-2929]). The three-transaction path (fund, deliver, decide) goes from 298,215 to 320,792, +7.6 %. On Sepolia, where T-213 measured new state at about 3.5 times anvil's price, the new slot may cost about 77,000 [inferred]; re-measure with `eth_estimateGas` on the new deployment and let T-215 carry it.

### 8. Migration for the live demo

- A new `HoldbackRules` (which deploys its own `HoldbackBonds`) with the same CPP escrow, collectors, `EXPIRY_MARGIN`, drand beacon and tUSDC; `contracts/deployments/sepolia.json` keeps the old entry and adds the new. The three demo adjudicators deposit bonds in the new vault through ADR-0028 §7's idempotent setup pass; their old bonds stay withdrawable as their old deals close.
- A new Sepolia world name for the new deployment (T-033's criterion); the Workers switch `SETTLEMENT` and the world name together. Deals open on the old deployment finish there: the old contract keeps running, every timeout is permissionless, and the old world stays readable until its last deal closes. Rollback is the old name and flag, as in ADR-0028.
- Signed 0.6 messages cannot reach the 0.7 contract: the domain names the deployment and the version, and the terms' `schemaVersion` differs, so a replay fails `BadSignature` at `agreeAndFund` [inferred].
- `/v1/status` reports schema 0.9, domain 0.7 and the new addresses; `llms.txt` and `try.mjs` pin them. The deploy and the Worker switch wait for Rafa; the Workers must not be deployed from a commit with this change before the new contracts are on Sepolia, because the old deployment cannot settle 0.7 messages.

## Alternatives considered

| Option | What it binds | Why not |
| --- | --- | --- |
| **A. Message field, stored hash, record field (chosen)** | The signature, the chain, the key and the record all name one delivery; the appeal judges the same body | Domain bump; one slot per deal; a redeploy |
| **B. Message field, no storage: check the named hash against the delivery carried in the same call** | The decision becomes self-consistent, and the equivocation becomes visible as two `JobSubmitted` hashes for one attempt. It never ties the judged delivery to the posted one | Same domain bump as A; every later `decide` must carry and re-verify the delivery (about 4,000 to 6,000 gas more each) to save 22,100 once; the posted-versus-judged mismatch stays. No sound storage-free tie exists: the deal word has no spare bits; a truncated hash in `seedTag` is a seller-controlled birthday search, 2^36 at 72 bits; contracts cannot read logs; a seller bond that slashes equivocation is Phase 4 at the earliest |
| **C. Record only: the adjudicator checks the seller's signature, the record names the hash, the contract is unchanged** | The record, after the fact. Additive schema change, no domain bump, no redeploy | Defensible under D26 and D32. Left unprotected: the early-accept record, the chain-only buyer, the appeal path, and settlement's own record. It also leaves the mutual-settlement divergence between core and the contract. Rafa asked for the contract fix |
| **D1. A second word in `Deal` instead of a mapping** | Same binding | Every `decide` pays a second cold read and same-value writes, the timeouts load two words, and the struct copy code grows (guessed 100 bytes more than the mapping) |
| **D2. Fold the hash into `seedTag`** | Same binding at 144 bits, no new slot | 2^72 collision work for the seller (L-4's class), more code than the slot, and `triggerFallback` would need the acceptance's `seedCommitment` in calldata: a tax on the permissionless timeout |
| **D3. Bind through `judgmentRecordHash` only** | The record names the delivery; the chain does not | The contract cannot open the record, and an early accept has none. Part of A (§3), not a substitute |
| **D4. Drop `attempt` now that the hash implies it** | Cleaner struct | `panelSeed` hashes `attempt` (ADR-0018); removing it ripples into the seed design. Revisit if ADR-0018 changes |
| **D5. Refund the slot at terminal states** | 4,800 gas back | Loses the on-chain read of what was paid for, costs bytes; `JobSubmitted` keeps the hash in logs anyway |

## Consequences

- One rule everywhere: a signature that pays or judges names the delivery it is about, and settlement refuses any other. A seller who equivocates gets no decision settled (the primary's window lapses, the fallback's decision is refused too, the deal defaults and the buyer is refunded), and the two signed deliveries are its own evidence (D26).
- An operator that hands an adjudicator a body the seller never signed now fails loudly (the adjudicator refuses in preflight; a decision about it could not settle) instead of settling silently against the real delivery. The honest seller's recourse against such an operator is the one it has today: post `deliver` itself and use another node (ADR-0005).
- Every fixture re-snaps (signatures and commitment IDs change).
- Agents re-pin: domain 0.7, two type strings, new addresses. The one-command trial keeps one approval.

### As built: where the build departs from the draft

- **The early accept's checks are one condition.** `m.attempt != dv.attempt || m.deliveryHash != dh || dh != deliveryHashOf[id]`, where `dh` is `_acceptDelivery`'s return in `Held` and `H.deliveryHash(id, dv)` after. The separate attempt check against the stored attempt is gone: the hash binds the attempt. The buyer's signature is now checked before the delivery lands (it was checked after the attempt comparisons); every refusal keeps its error.
- **The mutual-settlement check reads `s != Stage.Held && m.deliveryHash != deliveryHashOf[id]`.** The line above it already refuses `!m.hasDelivery` outside `Held`, so this is the draft's condition with one test fewer.
- **The read model's `deliveryHash`** comes from core's `postedDeliveryHash(state)`: the delivery while the state holds it, then the signature that settled the deal. It is absent after a reclaim, a default and a mutual settlement before delivery, because core keeps no delivery in those states.
- **The adapter's mirror check** reads `deliveryHashOf` only after a call that landed a delivery, not after every call: one RPC read per deal on a live chain.
- **The seller-equivocation fixture** runs on both settlements: the buyer names a second delivery of another file, which the seller signed and handed it, and the early accept is refused `invalid_terms` (`early_accept: { opened: <file> }` in the testkit).
- **Event payloads (v0.9, from PR #160's review).** `event.schema.json` gains `ChainTx` (`tx`, `block`, `sender`, `gasUsed`, optional), admitted on the closed `BondMovement`, `SettledSplit` and `OperatorFeePaid` payloads, so the EVM adapter's chain events validate.
- **The reference adjudicator also declines untrusted fallback and appeal adjudicators** (`AdjudicatorConfig.trustedAdjudicators`, D44): the overturn payout makes an appeal adjudicator a party controls a way to take the price from the primary's bond.

## Litmus tests

1. **Neutrality (ADR-0001): passes.** No new actor, key or veto. Every timeout still needs only the terms. The only new refusal is of a signature that names a delivery other than the one on chain, which is the signer's own choice. The escape hatch improves: a chain-only buyer now gets a key for the body the chain names. The adjudicator's trusted set is that adjudicator's own choice of which deals to accept (D29); the parties choose another adjudicator if it declines.
2. **The hold (ADR-0002, ADR-0012): tightened.** The buyer's early accept binds the body it opened; the envelope released in the paying transaction is from the delivery the paying signature names; `mutualSettle` matches core. Settle-once, expiry and idempotency are untouched; no money path changes.
3. **Defended judgment (ADR-0006): tightened.** The decision names what the panel judged, the record names it, and the appeal adjudicator judges the same body. Pinned models, commit-reveal and no re-roll are untouched; `attempt` keeps its place in the seed.

## Open questions, answered (2026-11-03)

1. **Ship with T-033 as one v0.9 and domain 0.7, or as its own bump?** Ship now as v0.9 and domain 0.7; T-033's additive items join v0.9 before the Sepolia redeploy, so there is still one redeploy.
2. **Order inside T-212.** The overturn payout and the appeal slot (PR #160) first; this item stacks on it. The headroom was measured and no cut was needed.
3. **The adjudicator's signature check on the delivery (§3).** Ships in the same change, with the field it needs.

## What would change this decision

- ADR-0018 revised so the seed no longer hashes `attempt`: drop `attempt` from both structs in the same bump (D4).
- A seller bond with an equivocation slash (Phase 4 or later): C's argument strengthens, but A's chain record would still be the cleaner evidence.
- Headroom that did not fit (it did, 263 bytes left): fall back to D2 for one deployment, with the 144-bit limit stated.
