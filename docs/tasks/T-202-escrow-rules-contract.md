# T-202: Escrow rules contract in Foundry

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-201 merged (its recommendation picks the base: D3-A, CPP `AuthCaptureEscrow` with this contract as operator; or the fallback, D3-B, an ERC-8183 extension, or C, custom). Do not start until T-201's PR is merged, because both write `contracts/`.
- **Paths this task may touch:** `contracts/src/`, `contracts/test/unit/`, `contracts/foundry.toml`, `contracts/remappings.txt`, `contracts/lib/` (via `forge install`, pinned commits), `contracts/.gas-snapshot`, `docs/decisions/ADR-0003-escrow-contract-base.md` (an "As built" section only), `docs/decisions/ADR-0023-operator-fee.md` (an "EVM mechanism" amendment, Proposed, only if needed), `docs/decisions-today.md` (record decisions made here), `docs/tasks/T-202-escrow-rules-contract.md`
- **Human gate:** none. Local chain only (anvil, chain id 31337). No `forge script --broadcast`, no `cast send`, no RPC to any public network. Sepolia is T-206's gate.
- **Status:** done (PR 68; beacon verification split out as T-209)
- **Agent/session:** implementer (Claude Opus 5.5), worktree branch `t-202-rules-contract`, 2026-11-01

## Intent

Build the Holdback rules contract: the on-chain version of SimChain's escrow rules, with no admin keys. It verifies the parties' EIP-712 signatures over the same typed data core already signs, holds the buyer's funds (through CPP if T-201 keeps option A, otherwise itself), and moves them only on a valid adjudicator decision, a buyer's early accept, a co-signed mutual settlement, or a timeout anyone can trigger. Its design depends on T-201's outcome: if CPP stays, this contract is CPP's operator and supplies idempotency, settle-once and every permissionless timeout (ADR-0003 conditions); if T-201 falls back, this contract also does custody.

**Restated (implementer, 2026-11-01).** T-201 kept option A, so this contract is CPP's operator and owns everything CPP lacks. It takes the settlement view (ADR-0024 §8) in calldata, rebuilds the same commitment ID `packages/core` computes, and keeps one storage word per deal. Offer, adjudicator acceptance and agreement stay off-chain signatures, checked when the buyer's funding lands (`agreeAndFund`). After that, held money moves only on one of these: the deciding adjudicator's EIP-712 decision (with its per-role seed), the buyer's early accept, a settlement both parties signed, or a permissionless timeout. The buyer's content key is emitted in the same transaction as the payment. The happy path is two transactions, and gas per path is measured. Bond custody covers only the primitives: deposit, encumber, release, withdraw, and appeal bonds.

**Non-goals:**
- Phase 4 economics: the coverage-ratio gate, backers, overturn payouts and default compensation.
- `settle_after_window` and `optimistic`.
- Fuzz and invariant campaigns (T-203), the TypeScript adapter (T-205), Sepolia (T-206), the schema edit (ADR-0025 follow-up), and edge-case hardening (Rafa: functional first).
- Beacon BLS verification, split out (Decisions).

## Context

- ADR-0003 (contract base and CPP conditions: capture timing per mode, `authorizationExpiry ≥ appealDecideBy + margin`, fee-only capture then `void` on reject, `feeReceiver = 0`, `maxFeeBps = 10000`); T-201 spike report and its "Outcome of T-201" section.
- ADR-0012 (key release: the buyer's encrypted key is emitted in the same transaction as the capture); ADR-0020 (public skeleton only on chain; envelopes per role; tlock for fallback and appeal keys).
- ADR-0018 (per-role panel seed: primary commit-reveal; fallback and appeal from drand quicknet, verified with EIP-2537).
- ADR-0022 (integer rates; rounding rules 1 to 3 with explicit `mulDiv` direction); ADR-0023 (operator fee: a buyer-signed transfer, never through the escrow, atomic with agree-and-fund).
- D4 update (Ethereum mainnet target: minimise on-chain steps, one funding and one settlement transaction on the happy path; record gas per deal). D31 (parametrize; refuse only malformed or contradictory values). D32 (no settlement machinery for checks a party can run itself).
- `packages/core/src/eip712.ts` (typed data to mirror), `packages/core/src/state.ts` and `packages/settlement/sim/simchain.ts` (the reference rules), `packages/settlement/src/interface.ts` (submissions and `TimeoutKind`), `docs/architecture.md` (postings table, invariants), `docs/neutrality.md` (contract review checklist).

## Design questions to settle here (record each in Decisions)

1. **Happy path transaction count.** Offer and adjudicator acceptance stay off-chain signatures checked at agree. Can the adjudicator's decision carry the seller-signed delivery, so the happy path is agree-and-fund plus decide (two transactions), while a seller can still post `deliver` itself to stop a reclaim?
2. **Operator fee on EVM.** ADR-0023 wants the fee atomic with agree-and-fund but never through the escrow. Either this contract executes the buyer's signed `transferWithAuthorization` (or Permit2 transfer) straight from buyer to operator, or a stateless periphery bundles it. Pick one; amend ADR-0023 (Proposed) if the mechanism text changes.
3. **Fallback and appeal envelopes.** Store a hash at `deliver` and accept the envelope from anyone at takeover, or rely on tlock alone (ADR-0020). Weigh calldata and storage gas.
4. **Bonds in Phase 2.** Bond custody primitives only (deposit, encumber per commitment, release, withdraw when unencumbered, appeal bond in and out). The coverage-ratio gate, backer tranches, overturn payouts and default compensation are Phase 4 (`docs/plan.md`). Say which Phase 1 fixtures therefore stay SimChain-only until Phase 4; T-205 needs that list.

## Acceptance criteria

- [x] (partial: beacon BLS verification split out; `FundingAuthorization` matching is ADR-0025, Proposed; ERC-8183 names unverified against the draft) `contracts/src/` has the rules contract (and a bond escrow) covering: offer and agree verified against the commitment ID and terms hash; funding by ERC-3009 `receiveWithAuthorization` and by Permit2, matching `FundingAuthorization`; deliver; decide with the adjudicator's signature and the per-role seed rule (ADR-0018); early accept; mutual settlement; appeal; every `TimeoutKind` callable by any address; key release events in the same transaction as the money; ERC-8183-compatible events (ADR-0003). `forge build` succeeds with no compiler warnings.
- [x] `forge test --match-path 'test/unit/*'` green on anvil, with at least one passing and one refusing test per external function (a missing, wrong-signer or replayed signature; a call before its deadline; a second settle).
- [x] A unit test enumerates the deployed contracts' selectors and fails on any of `owner`, `transferOwnership`, `renounceOwnership`, `pause`, `unpause`, `upgradeTo`, `upgradeToAndCall`, or a blacklist or freeze function; and asserts the runtime bytecode contains no `SELFDESTRUCT` and no `DELEGATECALL` to a mutable address.
- [x] Rounding follows ADR-0022: each rate multiplication uses `mulDiv` with the named direction; a unit test per postings-table row checks share plus remainder equals the pot.
- [x] `forge snapshot` writes `contracts/.gas-snapshot`; the Evidence section lists gas for happy path, reject (fee-only capture plus refund), reclaim, early accept and mutual settlement, and the happy-path transaction count (measured on anvil).
- [x] The four design questions answered in Decisions; any rule that differs from SimChain listed for T-205's differential report.
- [ ] `pnpm verify` still green. PR opened.

## Out of scope

- Invariant and fuzz campaigns (T-203), the formal model (T-204), the TypeScript `Settlement` adapter and `--settlement=local` (T-205), the review and any Sepolia deployment (T-206), private deals (T-207).
- Phase 4 economics: coverage gate, backers, overturn payouts, default compensation from bonds, `settle_after_window` key release.
- Mainnet in any form.

## Evidence

**Tests.**
- `forge test`: 96 tests pass in 13 suites (unit tests, cross-language vectors, gas). [measured]
- The same suite also passes against a local anvil node: `anvil --chain-id 31337` on 127.0.0.1, then `forge test --fork-url http://127.0.0.1:18545 --match-path "test/unit/*"`, 95 of 95 at the time of that run. The deposit-refusal test was added afterwards and passes in-process. [measured]
- `forge build --force` prints no compiler warnings. [measured]
- `pnpm verify` passes typecheck, lint, test, spec, snap and demo (`reports/verify-t-202-rules-contract.md`). This was run twice, before and after Status moved to `review`, and both runs were green. The design-map check that failed T-201 did not fail here. [measured]

**Every external function has at least one test that passes and one that is refused.**

| Function | Pass | Refuse |
| --- | --- | --- |
| `agreeAndFund` | ERC-3009; Permit2 | seller, acceptance or agree signature from the wrong key; missing signature; terms changed after signing; replay; after `offerExpiresAt`; `bondReserved` below price; no free bond; funding signed by the wrong key |
| `deliver` | moves to Delivered | wrong signer; after `deliverBy`; second delivery |
| `decide` | accept; reject; delivery carried; fallback with beacon seed; escalate, then the appeal adjudicator decides; party appeal upheld or overturned | wrong signer; seed not matching the commitment; chosen fallback seed; wrong round; primary after takeover; after `judgeBy`; accept without the buyer's key; expired message; second settle; appeal adjudicator escalating |
| `earlyAccept` | delivery carried; after an on-chain delivery | not the buyer; key not in the delivery; second settle |
| `mutualSettle` | any split with a key; before delivery | sum ≠ price; one signature only; second settle |
| `fileAppeal` | bond held | wrong signer; after `appealBy`; second appeal |
| `expireOffer`, `reclaim`, `triggerFallback`, `triggerDefault`, `expireAppeal` | called by an arbitrary address after the deadline | before the deadline; wrong stage or a second call |
| Bonds: `deposit`, `withdraw`, `encumber`, `tryEncumber`, `release`, `takeAppealBond`, `payAppealBond` | deposit; withdraw what is free; the rules-only calls through the flows above | deposit without tokens; withdraw encumbered funds; every rules-only call from another address |

[measured]

**Cross-language check.** `Vectors.t.sol` rebuilds values that `packages/core` (viem) computed from `spec/examples`, with the token set to `0x…beef`, and all of them match:
- the commitment ID and the terms digest;
- the delivery hash and the encrypted-key hashes;
- the Decision, AdjudicatorAcceptance, Agree, EarlyAccept, MutualSettlement and Appeal digests;
- `panelSeed`.

The generator script stays outside the repo, and its outputs are pinned in the test. [measured]

**No admin.**
- `NoAdmin.t.sol` checks both contracts' ABI names against an exact allowlist, with no fallback or receive.
- Calls to 16 admin selectors fail on both contracts.
- An opcode walk over the runtime bytecode (PUSH data and the metadata trailer skipped) finds no `SELFDESTRUCT` (0xff) and no `DELEGATECALL` (0xf4).
- The rules contract holds no tokens.

[measured]

**Rounding (ADR-0022).**
- `Money.requirement` (mulDivUp), `Money.payout` (mulDiv, rounding down) and `Money.split` (share rounded down, remainder named) are fuzzed at 256 runs.
- `PostingsTest` checks each postings-table row that moves held money: Release, Refund, Early acceptance, Reclaim, Default outcome and Mutual settlement. In each, the payouts sum to price + fee and the hold is left empty.
- The appeal and overturn rows move bond money only. Overturn payouts are Phase 4.

[measured]

**Size.** `HoldbackRules` runtime is 24,542 bytes, 34 under EIP-170, with `via_ir`. `HoldbackBonds` is 2,624 bytes. [measured]

**Gas per deal.** Measured with `forge test --match-contract GasPerDeal --isolate -vv`: Foundry's EVM with each call as its own transaction, steady state, the mock ERC-3009 token and ERC-3009 funding. These are not anvil receipts. [measured]

| Path | Tx 1 `agreeAndFund` | Tx 2 | Total |
| --- | --- | --- | --- |
| Happy path: `decide(accept)` carrying the delivery | 245,020 | 150,811 | **395,831** |
| Reject: fee-only capture + `void` | 245,020 | 151,162 | **396,182** |
| Early accept (delivery carried, key released) | 245,020 | 159,079 | **404,099** |
| Mutual settlement (half each, before delivery) | 245,020 | 154,708 | **399,728** |
| Reclaim (permissionless) | 245,020 | 103,507 | **348,527** |
| Optional `deliver`, then `decide` | | 61,302 + 137,892 | 444,214 |
| `triggerFallback`, then `triggerDefault` (one call for default and apply) | | 80,087 + 107,688 | |

- **Happy path: two transactions.** [measured]
- **Against T-201's spike (266,536):** about 129k more. Most of it is verifying three signatures and the settlement view at funding, encumbering the bond, the delivery's seller signature and the key event. [inferred]
- **Against ADR-0024's estimate (about 510k to 640k):** the measured cost is below it. [measured vs inferred]
- **In money:** about 396k gas at 1 gwei and $3,000 per ETH is about $1.19 per deal. [guessed prices]
- **Real USDC** adds roughly +10k to +25k gas. [guessed]

`forge snapshot` writes `contracts/.gas-snapshot`, 95 entries from the plain run, without `--isolate`. [measured]

## Decisions

Recorded as D37 in `docs/decisions-today.md`.

1. **Happy path transaction count: two.**
   - The seller's offer, the primary's acceptance and the buyer's Agree are signatures checked in `agreeAndFund`, which also funds through CPP.
   - `decide` may carry the seller-signed delivery when the deal is still `Held`. That makes the happy path agree-and-fund plus decide.
   - The seller can still post `deliver` before `deliverBy`, which moves the deal to `Delivered` and blocks `reclaim`.
   - A delivery that rides on a decision or an early accept is accepted only while nobody has reclaimed. So a seller who waits until after `deliverBy` without posting races the buyer's reclaim. That is the seller's choice, per D32. *Amended by T-206 M-2 (PR #127): a carried delivery must land before `deliverBy`, like a posted one, so the race is gone.*
2. **Operator fee on EVM: stateless bundling, no contract code.**
   - A batcher (Multicall3 or account batching) runs the token's `transferWithAuthorization` from the buyer to the operator, then `agreeAndFund`, in one transaction.
   - Its nonce is `keccak256(abi.encode(commitmentId, "operator_fee"))`.
   - ADR-0023 is amended (EVM mechanism, Proposed). The bundle itself is not tested here (inferred); T-205 tests it on anvil.
3. **Fallback and appeal envelopes: tlock and the off-chain union, nothing stored.**
   - The contract stores neither the delivery hash nor envelopes, which keeps one word per deal.
   - The only envelope the contract emits is the buyer's:
     - on accept, from the decision's `keyForBuyer`;
     - on early accept, and on a mutual settlement with `releaseKey`, with a membership proof against the seller-signed delivery's `encryptedKeys`.
   - Storing a hash at `deliver` would cost a second storage slot (about 22k gas) and buys nothing that the time-lock and the ADR-0024 §5 union of envelopes do not already give.
4. **Bonds in Phase 2: custody primitives only** (`HoldbackBonds`).
   - **Deposit** goes to the caller's own bond.
   - **Funding** encumbers 100% of the price on the primary, rounded up per ADR-0022 rule 1. An adjudicator without that much free bond cannot be funded.
   - **Fallback takeover and escalation** encumber the price if it is free, else nothing; partial cover is backlog F5. A flag in the deal word records it. *Amended by T-206 M-3 (PR #135): nothing is reserved at takeover or escalation. The fallback's own decision encumbers its bond, so an uncovered fallback cannot decide.*
   - **On a first-instance decision**, the decider's bond stays encumbered until the appeal closes, and the other reservations are released.
   - **Withdraw** takes only the free part.
   - **The appeal bond** is pulled with an ERC-20 allowance to `HoldbackBonds`. If upheld, it goes to the first adjudicator's bond; if overturned or expired, back to the appellant.
   - **Phase 4 (not built):** the coverage ratio, backers, overturn payouts from the bond, default compensation and the appeal fee.
   - **Phase 1 fixtures that stay SimChain-only until Phase 4,** found by grepping the `.expect.md` snapshots for bond payouts [inferred]:
     - `neutrality.adjudicator-and-fallback-offline` (default compensation);
     - `neutrality.appeal-adjudicator-offline-after-escalation` (default compensation);
     - `honest-seller-survives-judge-noise-on-appeal` (appeal fee and bond rate from the rulebook).
   - **Portable, but refused at a different step:** `attack.adjudicator-self-dealing` and `error.coverage-exceeded`. On chain, the refusal is `InsufficientFreeBond` at `agreeAndFund`, not `coverage_exceeded` at acceptance. The deal never funds either way.

**Other decisions.**
- **Default in one call.** Default and apply-default are one call, `triggerDefault` (T-204 finding 2). `formal/Holdback.tla` should merge `TriggerDefault` and `ApplyDefault`; that is outside this task's paths (Handoff).
- **Beacon BLS verification is split out** (backlog row, proposed T-209). A drand quicknet hash-to-curve plus a pairing check is about 140k gas, and the reference verifier is unaudited (ADR-0018). That fails "only if it stays reasonable" for this task. The contract does check:
  - the round: the fallback's is `judgeBy`; the appeal's is one round after the escalation or after the filing;
  - the seed: `panelSeed(id, role, attempt, value)`.
  Until BLS lands, a fallback or appeal adjudicator can still pick the beacon value.
- **Funding signature and token IDs.** On EVM the funding signature is CPP's collector signature, and token identifiers are lowercase addresses. This is ADR-0025 (Proposed); `spec/schemas/` is untouched.
- **Early accept has no deadline,** as in `state.ts` (T-204 finding 6).
- **Size.** `via_ir` is on, and `paymentInfoOf` and `commitmentIdOf` are not exposed, to fit EIP-170. The tests derive both.

**Rules that differ from SimChain (for T-205's differential report).**
1. **No on-chain `Offered`, `AcceptedByAdjudicator` or `Agreed` stage.** Offer, acceptance and agree are verified together at `agreeAndFund`, and the acceptance's `expiresAt` is checked then, not when the adjudicator accepted. There are no separate `agree` and `fund` calls.
2. **The coverage refusal comes at funding** (`InsufficientFreeBond`), not at acceptance (`coverage_exceeded`).
3. **Off-chain-only checks.** Mandates and scope, daily caps, club membership, rulebook checks (allowed tokens and modes, `validateTiming`, `maxSubmissions` beyond attempt 1) and the gas buffer are not on chain. Under ADR-0024 §7 and D32, the counterparty and the adjudicator check them.
4. **Funding uses CPP collector signatures** (ADR-0025), not a Holdback-domain `FundingAuthorization`.
5. **Deliveries.**
   - A decision or early accept may carry the delivery while `Held`, but only before `deliverBy` (amended by T-206 M-2, PR #127).
   - The contract does not check that the delivery holds envelopes for all three adjudicators and the buyer. It never holds envelopes, except the buyer key proven at release.
   - Escalate does not have to carry the appeal adjudicator's envelope.
6. **Early accept is allowed from `Held`** (delivery carried).
7. **Seeds and the beacon.** The fallback and appeal beacon value is not verified (BLS deferred). The round arithmetic is `(t - genesis) / period`, set at deployment; SimChain uses `floor(ms / 1000)`.
8. **Reservations at takeover are all or nothing** (SimChain reserves up to what is free). *Since T-206 M-3 (PR #135), the contract reserves nothing at takeover. The fallback's decision encumbers its bond, and an uncovered fallback cannot decide.*
9. **Default** is one call with no bond compensation. There are no overturn payouts. The appeal fee is not collected, and the appeal bond amount is not checked against the rulebook rate.
10. **Mutual settlement.**
    - The rulebook's `allowed` and `payoutsTo` are not checked, and the fee share is fixed at 0 bps (the Phase 1 default).
    - `deliveryHash` is not compared with a stored delivery, because none is stored; the co-signature binds it.
    - `hasDelivery` may be true while `Held`.
11. **Holdback-domain nonces are not spent;** the stage machine refuses replays.
12. **`expire_offer`** marks a never-funded commitment `Expired` once `offerExpiresAt` or `fundBy` passes (it fires at the earlier of the two).
13. **`settle` has no function** (Phase 4).
14. **Event names and shapes** differ (ERC-8183-shaped plus Holdback events); the adapter maps them.
15. **After `authorizationExpiry`, every capture reverts in CPP;** only `void` paths and the buyer's CPP `reclaim` work.
16. **Until T-210 lands,** the contract refuses three things that SimChain accepts: an appeal decision that names another attempt (T-206 H-1); a decision that carries the buyer's key unless it is an accept on a deal that is not Refunded (H-2); and a decision from an uncovered fallback (M-3).

## Handoff

**Done:**
- `contracts/src/HoldbackRules.sol`, `HoldbackBonds.sol` and `HoldbackTypes.sol` (with the `Money` library).
- `contracts/test/unit/*` (96 tests) and `contracts/.gas-snapshot`.
- `via_ir` in `contracts/foundry.toml`.
- ADR-0025 (Proposed), the ADR-0023 EVM amendment (Proposed), and the ADR-0003 "As built" section.
- D37 in `docs/decisions-today.md`, and backlog rows under Settlement layer.

The T-201 spike tests (`contracts/test/*.sol`) are deleted. Their coverage moved to `test/unit/`.

**Outside this task's paths, for others:**
- **`docs/decisions/ADR-0025-…` and `docs/backlog.md`** were written at the coordinator's request.
- **Schema v0.9 for ADR-0025** (the funding schemes and token IDs) is a follow-up task now that PR 67 has merged. `spec/schemas/` is untouched.
- **Proposed T-209:** beacon BLS verification (EIP-2537) on chain, plus pinning drand's round formula.
- **`formal/README.md`:** the contract-function column (T-204 asked for it):

  | Model action | Contract function |
  | --- | --- |
  | Offer, AdjAccept, Agree, Fund | `agreeAndFund` |
  | Deliver | `deliver`, or carried by `decide` or `earlyAccept` |
  | Decide | `decide` |
  | EarlyAccept | `earlyAccept` |
  | MutualSettle | `mutualSettle` |
  | FileAppeal | `fileAppeal` |
  | Expire | `expireOffer` |
  | Reclaim | `reclaim` |
  | TriggerFallback | `triggerFallback` |
  | TriggerDefault and ApplyDefault | `triggerDefault` (merged) |
  | ExpireAppeal | `expireAppeal` |

  The model could merge the two default actions to match.
- **`docs/team.md`:** the "No admin keys" check can point at `contracts/test/unit/NoAdmin.t.sol`.
- **CI:** `forge test` is still not wired into `pnpm verify` or CI (infra lane, as T-201 noted). With `via_ir`, a clean build takes about 45 s. [measured]

**For T-205:**
- Build the settlement view from `typedTermsOf` (string fields as keccak256; remedy and disclosure as struct hashes).
- Derive the CPP `PaymentInfo` as in `Base.sol` `_pi`.
- Map the events.
- Use the difference list above.

**For T-206:**
- The ERC-8183 event names are unverified.
- Real-USDC gas.
- Choose `EXPIRY_MARGIN`.
- The EIP-170 headroom is 34 bytes.
