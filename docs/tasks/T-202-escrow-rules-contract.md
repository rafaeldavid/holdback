# T-202: Escrow rules contract in Foundry

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-201 merged (its recommendation picks the base: D3-A, CPP `AuthCaptureEscrow` with this contract as operator; or the fallback, D3-B, an ERC-8183 extension, or C, custom). Do not start until T-201's PR is merged, because both write `contracts/`.
- **Paths this task may touch:** `contracts/src/`, `contracts/test/unit/`, `contracts/foundry.toml`, `contracts/remappings.txt`, `contracts/lib/` (via `forge install`, pinned commits), `contracts/.gas-snapshot`, `docs/decisions/ADR-0003-escrow-contract-base.md` (an "As built" section only), `docs/decisions/ADR-0023-operator-fee.md` (an "EVM mechanism" amendment, Proposed, only if needed), `docs/decisions-today.md` (record decisions made here), `docs/tasks/T-202-escrow-rules-contract.md`
- **Human gate:** none. Local chain only (anvil, chain id 31337). No `forge script --broadcast`, no `cast send`, no RPC to any public network. Sepolia is T-206's gate.
- **Status:** todo
- **Agent/session:** —

## Intent

Build the Holdback rules contract: the on-chain version of SimChain's escrow rules, with no admin keys. It verifies the parties' EIP-712 signatures over the same typed data core already signs, holds the buyer's funds (through CPP if T-201 keeps option A, otherwise itself), and moves them only on a valid adjudicator decision, a buyer's early accept, a co-signed mutual settlement, or a timeout anyone can trigger. Its design depends on T-201's outcome: if CPP stays, this contract is CPP's operator and supplies idempotency, settle-once and every permissionless timeout (ADR-0003 conditions); if T-201 falls back, this contract also does custody.

Restate this in your own words in this section before writing code.

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

- [ ] `contracts/src/` has the rules contract (and a bond escrow) covering: offer and agree verified against the commitment ID and terms hash; funding by ERC-3009 `receiveWithAuthorization` and by Permit2, matching `FundingAuthorization`; deliver; decide with the adjudicator's signature and the per-role seed rule (ADR-0018); early accept; mutual settlement; appeal; every `TimeoutKind` callable by any address; key release events in the same transaction as the money; ERC-8183-compatible events (ADR-0003). `forge build` succeeds with no compiler warnings.
- [ ] `forge test --match-path 'test/unit/*'` green on anvil, with at least one passing and one refusing test per external function (a missing, wrong-signer or replayed signature; a call before its deadline; a second settle).
- [ ] A unit test enumerates the deployed contracts' selectors and fails on any of `owner`, `transferOwnership`, `renounceOwnership`, `pause`, `unpause`, `upgradeTo`, `upgradeToAndCall`, or a blacklist or freeze function; and asserts the runtime bytecode contains no `SELFDESTRUCT` and no `DELEGATECALL` to a mutable address.
- [ ] Rounding follows ADR-0022: each rate multiplication uses `mulDiv` with the named direction; a unit test per postings-table row checks share plus remainder equals the pot.
- [ ] `forge snapshot` writes `contracts/.gas-snapshot`; the Evidence section lists gas for happy path, reject (fee-only capture plus refund), reclaim, early accept and mutual settlement, and the happy-path transaction count (measured on anvil).
- [ ] The four design questions answered in Decisions; any rule that differs from SimChain listed for T-205's differential report.
- [ ] `pnpm verify` still green. PR opened.

## Out of scope

- Invariant and fuzz campaigns (T-203), the formal model (T-204), the TypeScript `Settlement` adapter and `--settlement=local` (T-205), the review and any Sepolia deployment (T-206), private deals (T-207).
- Phase 4 economics: coverage gate, backers, overturn payouts, default compensation from bonds, `settle_after_window` key release.
- Mainnet in any form.

## Evidence

## Decisions

## Handoff
