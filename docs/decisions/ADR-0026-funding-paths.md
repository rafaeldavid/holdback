# ADR-0026: Funding paths: any ERC-20, WETH or ETH; ramps, swaps and bridges as a deferred service

- **Note (2026-11-03):** first wave narrowed to USDC by D42; other assets later.
- **Status:** Accepted for parts 1 and 2, 2026-11-02 (Rafa's direction, D38). Part 3 (the funding service) is **deferred, stub only**: the `FundingService` interface in `apps/operator/src/registry.ts` and `/v1/funding/*` routes that answer 501 `not_implemented` (404 `not_found` until T-030, D39), listed as planned in `docs/api.md` and under `x-holdback-planned` in `spec/openapi.json`, the API's convention for unbuilt routes. The external provider facts in this ADR are from memory (no web pass) and must be checked before part 3 is built.
- **Date:** 2026-11-02
- **Raised by:** Rafa, 2026-11-02: "The API needs to be able to call a funding path to the L1 directly, so agents can work in either native crypto if they have funds there, or in fiat (assuming they have access to a credit card etc.). So the API probably needs to solve for that funding bridge, and to fund asset agreement." Then: "This would be a separate service we call via our unified API." Then: "for now we should simply accept any ERC20 or wETH", refined to "accept any ERC20 or wETH or ETH." Then: this is for later; stub only.
- **Changes (when accepted):** `spec/schemas/club.schema.json` (`allowedTokens` optional; a schema bump, additive, domain stays 0.6 by ADR-0023's rule); `docs/api.md` (stub endpoint), `docs/architecture.md` (Ramps paragraph) and `docs/backlog.md` (rows), which the coordinator edits; no contract change; no code in this pass.
- **Amends:** ADR-0002 (the consequence "the escrow accepts any ERC-20" becomes a decision; ramps become a separate service, not a protocol component); ADR-0025 (Permit2 as the general funding path, ERC-3009 as the one-signature fast path; WETH as an ordinary ERC-20); ADR-0005 (qualifies "funding is gasless": the one-time Permit2 approval and an ETH wrap are the buyer's own transactions).

## Context

Measured in this repository unless marked.

- **Custody is Commerce Payments' `AuthCaptureEscrow` v1.1.0, operated by `HoldbackRules`** (ADR-0003, `contracts/src/HoldbackRules.sol`). The hold is pulled from the buyer by a CPP collector: `agreeAndFund` takes `f.method` 0 for `ERC3009_COLLECTOR` and 1 for `PERMIT2_COLLECTOR` (lines 198, 211). `Terms.token` is an `address` (`HoldbackTypes.sol:40`), and nothing in the rules contract names a token.
- **CPP moves ERC-20s only.** `AuthCaptureEscrow` has no `payable` function and never reads `msg.value` (grep of the vendored source). Its `_collectTokens` reverts `TokenCollectionFailed` unless the TokenStore's balance rises by exactly `amount` (`AuthCaptureEscrow.sol:421-424`). Collectors are addresses passed to `authorize`; any contract extending `TokenCollector` can be one (`collectors/TokenCollector.sol`). The vendored collectors are ERC-3009, Permit2, PreApproval, SpendPermission and OperatorRefund.
- **The hold must fit `uint120`** (`_paymentInfo`, line 159): about 1.3 × 10^36 base units, so an 18-decimal token is not a practical limit.
- **Today the token is restricted in three places:** core refuses a token outside `rulebook.allowedTokens` with `invalid_terms` and requires price, fee and settlement in one token (`packages/core/src/state.ts:191-196`); `club.schema.json` requires `allowedTokens` with `minItems: 1` (lines 40, 164-170); the demo club lists `[tUSD]` (`fixtures/clubs/data-services-v1.yaml:19`) and SimChain has one token (`sim/actors.ts:37`, `TOKEN = 'tUSD'`; `balances()` returns one `TokenAmount` per address, `simchain.ts:428`). On `local` the testkit rewrites `tUSD` to the deployed token's address (T-205 decision 4).
- **Token identifiers on EVM are lowercase addresses** (ADR-0025, Proposed); `TokenId`'s pattern already fits them (`common.schema.json:260-264`).
- **Permit2 is not deployed on anvil**, so only ERC-3009 funding has run end to end (T-205 decision 10). The EVM adapter maps CPP's `AfterAuthorizationExpiry` but not `TokenCollectionFailed` (`packages/settlement/evm/errors.ts:28`).
- **Ramps are already placed outside the hold.** ADR-0002: on-ramps convert before the hold and off-ramps after release; chargeback risk sits with the ramp. ADR-0001 lists on-ramps as an actor that must not be able to block or take funds; `docs/neutrality.md` names the fixture `neutrality.onramp-refuses` (Phase 5; no fixture file exists yet). PRD assumption 7 (ramps accept agent-initiated chargeback risk) is untested.
- **Funding linkability** is residual 11 (ADR-0024 §7): a transfer from a known treasury links a per-deal address; a fresh on-ramp account or a shielded pool is the agent's choice.
- **WETH9** has `deposit`, `withdraw`, `approve` and `transferFrom`, no owner, no ERC-3009 and no EIP-2612 permit [from memory, unverified in this session]. **Permit2** is deployed at one CREATE2 address on Ethereum mainnet and Sepolia [from memory, unverified]. **EIP-7702** (Pectra, 2025) lets an EOA batch calls atomically [from memory, unverified].

## Decision (proposed)

### 1. The deal's token is any ERC-20 the parties name (D31)

- `price.token`, `adjudication.fee.token` and `settlement.token` are one ERC-20 address (ADR-0025); the parties choose it. The protocol refuses only what settlement cannot process: an address with no token code, or a token whose transfer does not land the exact amount, which CPP already refuses at funding (`TokenCollectionFailed`). Nothing else is a refusal.
- **`allowedTokens` becomes optional in the rulebook.** Absent means any token; present, it narrows (clubs may narrow, ADR-0015). Core's check applies only when the list is present. The demo club keeps `[tUSD]`, and SimChain stays single-token; multi-token fixtures run on `local`.
- **Advisory warnings, never refusals** (D31). An operator may add to a prepare's `check` text, as a service: fee-on-transfer (funding will revert at CPP's exact-amount check), rebasing (the TokenStore balance drifts between funding and capture: a positive rebase strands dust, a negative one can make a capture revert; inferred from CPP's accounting), pausable or blacklistable tokens (residual 1, now broader than one stablecoin), and tokens without ERC-3009 (a one-time Permit2 approval is needed, §2). The parties carry the choice (D32).
- Display symbols and decimals stay outside the hashed body (ADR-0025). The operator fee stays in the price token (ADR-0023).

### 2. Funding mechanics by token kind

| Token | Buyer signs | Buyer's own transactions | Relayed by anyone | Status |
| --- | --- | --- | --- | --- |
| ERC-3009 tokens (USDC, EURC, the local test token) | one `ReceiveWithAuthorization` under the token's domain (`cpp-erc3009`) | none | yes, gasless | runs on anvil (T-205) |
| Every other ERC-20, WETH included | one Permit2 `PermitTransferFrom` per deal (`cpp-permit2`) | one `approve(Permit2, max)` per token per address, once | yes, gasless after the approval | wired in the contract (`method = 1`); not yet run: Permit2 is not on anvil |
| Native ETH | as WETH, above | `WETH.deposit{value}`, then the one-time approval | the funding itself, yes | §3 |

The signed `FundingAuthorization` keeps ADR-0025's two scheme values; no new message type. The commitment ID, the terms encoding and the EIP-712 domain do not change.

### 3. Native ETH: wrap it; the deal is denominated in WETH (option a)

- **The token is the chain's canonical WETH.** ETH is a funding source and a payout preference, never a custody asset. The buyer wraps and funds as for any ERC-20; a seller who wants ETH unwraps its payout (`WETH.withdraw`). Both are the party's own calls (D32), or calls the deferred funding service prepares for the party to sign. `HoldbackRules` is unchanged.
- **Transaction shape.** `msg.value` cannot be relayed gaslessly (CPP's `authorize` is not payable, and the ETH must come from the buyer's account), so the buyer submits the wrap itself. A plain EOA: `deposit`, then the one-time `approve(Permit2)`, then the relayed Permit2 funding. With EIP-7702 or a smart account: one atomic batch. Multicall3 cannot stand in for the buyer here: calls it forwards have Multicall3 as `msg.sender`, so an approval inside it would not be the buyer's (inferred).

| Option for ETH | What it needs | Litmus | Verdict |
| --- | --- | --- | --- |
| **(a) Wrap to WETH; the deal is in WETH** | nothing in the contracts; one or two buyer transactions once | neutrality: passes (the buyer's own calls, no new actor); hold: passes, unchanged ERC-20 custody; judgment: unaffected | **Recommended** |
| (b) A custom CPP collector that takes ETH and wraps it | `authorize` is not payable, so the ETH must sit in the collector before the pull: a custody hop that needs its own refund path and audit; `agreeAndFund` would need `payable`, and the contract has 34 bytes of EIP-170 headroom (T-202) | hold: a second custody point; neutrality: the collector must have no admin | Rejected: the deal would still be denominated in WETH, for more code |
| (c) Native ETH custody in `HoldbackRules` | a parallel hold with capture, void, reclaim and expiry re-implemented outside CPP; no size headroom; contradicts ADR-0003 | hold: the largest new audit surface in the project | Rejected |

### 4. The funding service: deferred, stub only

Everything that converts into the settlement token at the buyer's address (fiat on-ramp, swap, bridge) is **one separate service, not a protocol component and not part of the operator node.** Any operator may run or integrate one; the unified Crow API exposes it; agents may ignore it and fund from their own address.

- **Boundary.** Its own deployable (proposed path `apps/funding/`, with any shared types in `packages/funding/`; not created now). The operator routes to it; the settlement layer never knows it exists.
- **May:** quote routes (direct, swap into the token, bridge from another chain, fiat through a named ramp) with amounts as base-unit decimal strings and rates as integers (ADR-0022); prepare the swap or bridge calls the buyer signs; open a ramp session that delivers the settlement token to the buyer's address **before** the hold; report the session's state.
- **May not:** hold or route escrowed funds; sign anything for the buyer; be named in the commitment or required by settlement; touch funds after the hold; charge in a way that conditions settlement. Its fees are its own, outside the hold, disclosed in the quote.
- **Unified API shape (stub).** `POST /v1/funding/quote` (buyer address, target `{token, amount}`, source: `direct` | `swap {token}` | `bridge {chainId, token}` | `fiat {ramp}`) returns routes with fees and an advisory `direct` route that is always present; `POST /v1/funding/sessions` opens one; `GET /v1/funding/sessions/{id}` reads it. Until built, the stub answers 404 `not_found` with a `Link` to this ADR, or 501 (the coordinator picks when adding it); the SDK's `fund()` tries the direct path first. New endpoints and problem types are a schema bump when they land.
- **Failure modes** (the neutrality fixture for this actor is `neutrality.onramp-refuses`, already in the plan, plus `neutrality.funding-service-refuses`): a ramp refuses KYC or a card is declined (the buyer funds from its own address or another ramp); a swap or bridge quote expires or slips (the buyer re-quotes; a hold is never opened short because CPP requires the exact amount); the service is offline (the direct path is the default and needs no service). A chargeback after the ramp delivered tokens is the ramp's loss, never the hold's (ADR-0002).
- **Candidates to evaluate when this is picked up** [all from memory, unverified in this session; the research pass for the real decision checks each]: fiat on-ramps with APIs and sandboxes that deliver USDC to a given address (Stripe's crypto onramp, Coinbase Onramp on CDP, MoonPay, Transak; Circle Mint for institutions). Each does KYC on a human or entity, so the principal opens the ramp account once and the agent uses it; an agent cannot pass KYC by itself (guessed). Card-side agent programs (Visa Intelligent Commerce, Mastercard Agent Pay) are card rails, so only ever an input to a ramp (ADR-0002). Swaps into the token (Permit2 with Uniswap's Universal Router, 0x, CoW, 1inch): the output must sit at the buyer's address when the collector pulls, so a swap-then-fund is two steps unless the buyer batches (7702) or a swapping collector exists (option b's problems plus slippage against CPP's exact amount). Cross-chain (Circle CCTP v2 fast transfer and hooks; Across and ERC-7683 intents): mint to the buyer's address, then fund; landing straight in the hold would need the hook target to be the payer, which no collector supports today (inferred). x402 is pay-then-serve with no hold (`docs/research/prior-art.md`) and is a payment, not a funding source.

## Alternatives considered

- **A. USDC only.** Simplest to test, but a server-side restriction of a value the parties can manage (D31), and ADR-0002 already says any ERC-20. Rejected.
- **B. Any ERC-20 and WETH, ETH by wrapping (chosen).** No contract change; one schema field relaxed.
- **C. ETH natively** (options b and c above). Rejected for custody surface and no size headroom.
- **D. Ramps inside the operator node.** Couples relaying with conversion, makes the node heavier and tempts a node to make its ramp a condition of relay. Rejected: a separate service any operator may run (Rafa).
- **E. A protocol-level funding message** (settlement accepts "funded by ramp X"). Makes a ramp a settlement dependency. Rejected under ADR-0001 and ADR-0002.
- **F. Deals priced in fiat, converted at funding.** Needs an oracle and a hold in a different asset from the price, which breaks the hold test. A stablecoin is the fiat denomination for now; a later option only as a party-chosen term. Rejected for now.
- **G. A settlement-token registry.** Needs an owner (ADR-0025 rejected it already).

## Consequences

- **Schema:** `club.allowedTokens` optional, `minItems: 1` when present; next additive bump (v0.9 with ADR-0025's schemes, or the following one). Domain and `commitment.schemaVersion` stay 0.6 (ADR-0023's rule; inferred: no signed struct changes).
- **Follow-ups, not tasks yet:** deploy Permit2 in `EvmWorld` and run a WETH deal through `method = 1` (fixture `fund.weth-via-permit2`); map `TokenCollectionFailed` to a problem type and show a fee-on-transfer token refused at funding (`fund.fee-on-transfer-refused`); advisory token warnings in prepare (backlog, D31); the `/v1/funding/*` stub (coordinator); `neutrality.onramp-refuses` when the service exists.
- **Residuals:** residual 1 (freezable or pausable tokens) now covers any token the parties pick; residual 11 (funding linkability) is unchanged; PRD assumption 7 stays untested until a ramp is wired.
- **Ramp identity (Rafa, 2026-11-02):** the agent's owner does the identity check, not the agent. The owner either picks a ramp from a listed set or opens an account with a ramp of its own choosing, under its own identity, separate from the agent; the agent then spends from that account. The protocol and the funding service never hold the owner's identity (D35).
- **Public demo (Rafa, 2026-11-02):** either Crow's own service or third-party ramps chosen by operators is acceptable; for the public demo a Stripe test-mode ramp (`sk_test_` only, Sepolia) is enough.
- **What this does not decide:** which ramps, swaps or bridges to integrate beyond that, or their fees. That is the deferred decision, with a research pass first.

## Litmus tests

- **Neutrality: passes.** The direct path (the buyer funds from its own address, relayed by anyone or submitted itself) is always available and needs no service; the funding service is an actor that can only refuse, with a fixture; the token is the parties' choice, and no registry or operator can veto it. The one-time Permit2 approval and an ETH wrap are the buyer's own transactions, so no relayer is a dependency for them.
- **The hold: passes.** Custody stays in CPP for every token; CPP's exact-amount check keeps the hold whole at funding; WETH is a plain ERC-20 with no admin (from memory); rebasing drift is an advisory the parties accept; no ETH is ever held outside an ERC-20 balance. Expiry, idempotency and settle-once are unchanged.
- **Defended judgment: unaffected.** No judge, check, panel or appeal path changes.

## Research note (2026-11-02)

This pass had no web access, so every claim about external products and standards is from memory to June 2026 and marked as such; nothing was fetched or cited by URL. Repository facts were measured by reading the files named above. Before the deferred decision is taken, a research pass should verify: the ramps' APIs, sandbox chains and address-delivery terms; Permit2's Sepolia address; CPP's behaviour with a rebasing token (a test, not a reading); and whether any collector or intent standard can make a bridge or swap land directly in the hold.
