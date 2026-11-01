# T-201: Spike: can a Holdback rules contract operate Commerce Payments' AuthCaptureEscrow? (D3)

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** Phase 1 done
- **Paths this task may touch:** `contracts/` (new Foundry project: `foundry.toml`, `src/`, `test/`, `lib/` via `forge install`), `docs/research/` (the spike report), `docs/decisions/ADR-0003-escrow-contract-base.md` (an "Outcome of T-201" section only), `docs/tasks/T-201-cpp-spike.md`, root `.gitignore` (Foundry `out/`, `cache/`)
- **Human gate:** none. Local chain only (anvil, chain id 31337). No `forge script` broadcasts, no `cast send`, no RPC to any public network.
- **Status:** todo
- **Agent/session:** —

## Intent

D3 chose option A: reuse the Commerce Payments Protocol `AuthCaptureEscrow` (Coinbase/Shopify, v1.1.0) for custody, with a Holdback rules contract as its operator, subject to this hands-on spike. Answer, with tests on a local chain, whether that works under Holdback's rules, or whether we fall back to option B (an ERC-8183 extension) or C (custom). D4 now targets Ethereum mainnet, built on Sepolia first, so also check where CPP is deployed.

Restate this in your own words in this section before writing code.

## Questions the spike must answer (from ADR-0003)

1. Can a contract with no admin keys act as CPP's operator (authorize, capture, void, refund) so that only Holdback's rules (a signed adjudicator decision, a signed early accept or settlement, a permissionless timeout) move funds?
2. Capture timing per settlement mode: can funds stay authorized (held) until a decision, and is the authorization expiry long enough for Holdback's deadlines (deliver, judge, fallback, appeal), with a safe margin?
3. The refund path: capture only the adjudication fee on a reject (`maxFeeBps = 10000` or equivalent), refund the price; and can the payer reclaim after expiry with no operator action?
4. Idempotency: does the rules contract need its own replay protection on top of CPP's?
5. Fees: how CPP's fee receiver and fee bps interact with the adjudication fee and the operator fee (D33, which stays outside the escrow).
6. Deployed bytecode: compare a deployment against the v1.1.0 tag (read-only, from a block explorer or source), and read the published audits. Is CPP deployed on Ethereum mainnet and Sepolia, or only on Base?
7. Funding: ERC-3009 `receiveWithAuthorization` or Permit2 with a mock USDC on anvil, matching Holdback's `FundingAuthorization`.

## Acceptance criteria

- [ ] `contracts/` Foundry project with CPP vendored at the v1.1.0 tag (`forge install`, pinned commit), a minimal `HoldbackRules` operator contract, and `forge test` cases on anvil: happy-path release, reject with fee-only capture and refund, payer reclaim after expiry with no operator, a no-admin-selectors check on `HoldbackRules`.
- [ ] A spike report in `docs/research/2026-11-T-201-cpp-spike.md` answering the seven questions, each labelled measured, inferred or guessed, with the gas per deal on the happy path and the refund path (measured on anvil).
- [ ] A recommendation: keep A, or fall back to B or C, with reasons; an "Outcome of T-201" section added to ADR-0003 (not marking anything Accepted that is not).
- [ ] `pnpm verify` still green (contracts are not yet in it unless trivial to add); `forge test` green. PR opened.

## Out of scope

- The full rules contract (T-202), invariant fuzzing (T-203), any public network, real tokens.

## Evidence

## Decisions

## Handoff
