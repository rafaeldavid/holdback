# ADR-0025: EVM funding signature and token identifiers

- **Status:** Proposed, 2026-11-01 (T-202). The schema change waits for a follow-up task after PR 67 (schema v0.8) merged; this ADR does not edit `spec/schemas/`.
- **Date:** 2026-11-01
- **Raised by:** T-201 finding 3 (the on-chain funding signature is CPP's, not `FundingAuthorization`); T-202, which needs the token in the signed terms to name the ERC-20 the contract moves.
- **Changes (when accepted):** schema v0.9 (`FundingAuthorization` description and examples, the `TokenAmount.token` rule for EVM settlement), `packages/core` (an EVM funding builder and the derived CPP `PaymentInfo`), T-205's `Settlement` adapter, `examples/verify.ts`.

## Context

- **The buyer's funding on chain is a CPP collector signature** (measured, T-201 and T-202 tests). `HoldbackRules.agreeAndFund` calls `AuthCaptureEscrow.authorize`, whose collector pulls the funds with one of:
  - **ERC-3009** `ReceiveWithAuthorization(from = buyer, to = ERC3009PaymentCollector, value = price + fee, validAfter = 0, validBefore = fundBy, nonce = CPP's payer-agnostic PaymentInfo hash)`, signed under the token's domain;
  - **Permit2** `PermitTransferFrom(permitted = {token, price + fee}, spender = Permit2PaymentCollector, nonce = uint256(the same hash), deadline = fundBy)`, signed under Permit2's domain, after a one-time ERC-20 approval to Permit2.
- **Today's `FundingAuthorization`** is a Holdback EIP-712 message (`scheme`, `commitmentId`, `from`, `value`, `token`, `validAfter`, `validBefore`, `nonce`, `expiresAt`). SimChain verifies it; no contract can, because the token moves only on the token's or Permit2's own signature.
- **The PaymentInfo is derived from the terms** (measured, `contracts/src/HoldbackRules.sol` `_paymentInfo`): `operator` = the rules contract, `payer` = buyer, `receiver` = seller, `token`, `maxAmount = price + fee`, `preApprovalExpiry = fundBy`, `authorizationExpiry = refundExpiry = fallbackBy + appealDecideSec + EXPIRY_MARGIN`, `minFeeBps = 0`, `maxFeeBps = 10000`, `feeReceiver = 0`, `salt = commitmentId`. The salt makes the buyer's one signature bind the operator contract and every term.
- **Token identifiers are strings** (`"tUSD"`) in `TokenAmount.token` and `settlement.token`, hashed into the commitment ID. The seller signs the string, the buyer funds an address. Unless the string names the address, a relayer could pair the seller's terms with another token contract (inferred).

## Decision (proposed)

1. **On EVM settlement, the funding signature is the collector signature above.** `FundingAuthorization` keeps its struct (so the EIP-712 domain and `commitment.schemaVersion` stay `"0.6"`, by ADR-0023's version rule) and gains two `scheme` values:
   - `"cpp-erc3009"`: `signature` is the ERC-3009 signature; `validAfter` is the Unix epoch (`1970-01-01T00:00:00Z`, encoded 0); `validBefore` is `fundBy`; `nonce` is the payer-agnostic PaymentInfo hash; `value` is price + fee.
   - `"cpp-permit2"`: `signature` is the Permit2 signature; the same `nonce`, `value` and `validBefore`.
   The settlement layer checks the token-level signature (the contract, through CPP) instead of a Holdback-domain one. SimChain keeps the current `"eip712"` behaviour.
2. **Token identifiers on EVM settlement are the ERC-20 address as a lowercase 0x-hex string** (42 characters), in `price.token`, `adjudication.fee.token` and `settlement.token`. The contract computes `keccak256(LibString.toHexString(token))` when it rebuilds the commitment ID (measured: the cross-language vectors in `contracts/test/unit/Vectors.t.sol` use `0x…beef` and match `packages/core`). Clubs list addresses in `allowedTokens`; display symbols stay outside the hashed body.
3. **`EXPIRY_MARGIN` is a deployment constant for now** (the local tests use one day). A per-deal margin would need a terms field, which moves the domain; it is a backlog row for the next encoding change.

## Alternatives considered

- **A. Verify a Holdback `FundingAuthorization` on chain and then pull with an allowance.** Two signatures for one act, plus a standing allowance to the rules contract. Rejected: more for the buyer to sign and an allowance surface.
- **B. Collector signature, struct unchanged, new `scheme` values (proposed).** One buyer signature, bound to the terms through the CPP salt; no domain move.
- **C. A new `EvmFunding` type.** Cleaner names, but a new message type for the same act; B is additive within the existing type.
- **Token identifiers: a registry from symbol to address.** Needs an owner or a governance path; rejected under ADR-0001. CAIP-19 strings (`eip155:1/erc20:0x…`) were weighed: longer, and the chain is already in the EIP-712 domain.

## Consequences

- **Follow-up task (after PR 67):** schema v0.9 with the two schemes, the token rule, a `messages.funding.cpp-erc3009.example.json`, and `core` helpers `cppPaymentInfo(terms, operator, margin)` and `cppFundingDigest(...)`. T-205 uses them in the `Settlement` adapter.
- **SimChain differences** are listed in T-202's Decisions for T-205's differential report.
- **The operator fee** (ADR-0023) moves by the token's own `transferWithAuthorization`, bundled with `agreeAndFund` (ADR-0023, EVM mechanism amendment).

## Litmus tests

- **Neutrality: passes.** Anyone relays the signed funding; no operator, collector owner or registry can change what the buyer signed. CPP's collectors and escrow have no admin (T-201, measured).
- **The hold: passes.** The buyer's signature binds the operator contract, the amount and the terms (salt); funds go straight into CPP's per-operator store; expiry and the buyer's reclaim backstop are fixed at funding.
- **Defended judgment: unaffected.**
