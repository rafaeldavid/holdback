# T-201: Spike: can a Holdback rules contract operate Commerce Payments' AuthCaptureEscrow? (D3)

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** Phase 1 done
- **Paths this task may touch:** `contracts/` (new Foundry project: `foundry.toml`, `src/`, `test/`, `lib/` via `forge install`), `docs/research/` (the spike report), `docs/decisions/ADR-0003-escrow-contract-base.md` (an "Outcome of T-201" section only), `docs/tasks/T-201-cpp-spike.md`, root `.gitignore` (Foundry `out/`, `cache/`)
- **Human gate:** none. Local chain only (anvil, chain id 31337). No `forge script` broadcasts, no `cast send`, no RPC to any public network.
- **Status:** review
- **Agent/session:** implementer (Claude Opus 5.5), branch `t-201-cpp-spike`, 2026-11-01

## Intent

D3 chose option A: reuse the Commerce Payments Protocol `AuthCaptureEscrow` (Coinbase/Shopify, v1.1.0) for custody, with a Holdback rules contract as its operator, subject to this hands-on spike. Answer, with tests on a local chain, whether that works under Holdback's rules, or whether we fall back to option B (an ERC-8183 extension) or C (custom). D4 now targets Ethereum mainnet, built on Sepolia first, so also check where CPP is deployed.

**Restated by the implementer (2026-11-01).** D3 chose to reuse CPP's audited `AuthCaptureEscrow` v1.1.0 for custody, on condition that a hands-on test confirms it. This spike checks, on a local EVM with mock USDC, whether a Holdback rules contract can be that escrow's operator without breaking Holdback's rules.

The rules contract must have no owner and no admin path. Funds may move only on:
- the named adjudicator's signed decision;
- the buyer's signed early accept;
- a timeout that anyone can trigger.

The buyer must also keep CPP's own reclaim after expiry as the last backstop.

The spike also answers what A costs in practice, now that D4 targets Ethereum mainnet:
- where CPP is deployed;
- whether the deployed bytecode is the tagged source;
- which audits cover it;
- how its fee fields and funding signatures fit Holdback's adjudication fee, the D33 operator fee and `FundingAuthorization`;
- the gas per deal.

The output is a recommendation to keep A or fall back to B or C, with tests behind each claim.

**Non-goals:**
- the full rules contract: appeal, fallback adjudicator, bonds, settlement modes, key release and mutual settlement (T-202);
- invariant fuzzing (T-203);
- any public network, real tokens, broadcasts or `cast send`;
- changing CPP;
- changing `spec/` or `packages/`. A schema change found here becomes a T-202 input with an ADR.

## Questions the spike must answer (from ADR-0003)

1. Can a contract with no admin keys act as CPP's operator (authorize, capture, void, refund) so that only Holdback's rules (a signed adjudicator decision, a signed early accept or settlement, a permissionless timeout) move funds?
2. Capture timing per settlement mode: can funds stay authorized (held) until a decision, and is the authorization expiry long enough for Holdback's deadlines (deliver, judge, fallback, appeal), with a safe margin?
3. The refund path: capture only the adjudication fee on a reject (`maxFeeBps = 10000` or equivalent), refund the price; and can the payer reclaim after expiry with no operator action?
4. Idempotency: does the rules contract need its own replay protection on top of CPP's?
5. Fees: how CPP's fee receiver and fee bps interact with the adjudication fee and the operator fee (D33, which stays outside the escrow).
6. Deployed bytecode: compare a deployment against the v1.1.0 tag (read-only, from a block explorer or source), and read the published audits. Is CPP deployed on Ethereum mainnet and Sepolia, or only on Base?
7. Funding: ERC-3009 `receiveWithAuthorization` or Permit2 with a mock USDC on anvil, matching Holdback's `FundingAuthorization`.

## Acceptance criteria

- [x] `contracts/` Foundry project with CPP vendored at the v1.1.0 tag (`forge install`, pinned commit), a minimal `HoldbackRules` operator contract, and `forge test` cases on anvil: happy-path release, reject with fee-only capture and refund, payer reclaim after expiry with no operator, a no-admin-selectors check on `HoldbackRules`. (The tests run in Foundry's in-process EVM at chain id 31337, the same revm that anvil uses; no anvil node was started.)
- [x] A spike report in `docs/research/2026-11-T-201-cpp-spike.md` answering the seven questions, each labelled measured, inferred or guessed, with the gas per deal on the happy path and the refund path (measured on anvil). (Gas was measured with `forge test --isolate`; see Decisions.)
- [x] A recommendation: keep A, or fall back to B or C, with reasons; an "Outcome of T-201" section added to ADR-0003 (not marking anything Accepted that is not).
- [ ] `pnpm verify` still green (contracts are not yet in it unless trivial to add); `forge test` green. PR opened.

## Out of scope

- The full rules contract (T-202), invariant fuzzing (T-203), any public network, real tokens.

## Evidence

Full report: `docs/research/2026-11-T-201-cpp-spike.md`.

- **measured: `forge test` in `contracts/`.** 36 tests pass in 3 suites:
  - `HoldbackRules.t.sol`: 26 tests;
  - `NoAdmin.t.sol`: 4 tests;
  - `GasPerDeal.t.sol`: 6 tests.
  
  They cover the four required cases: happy-path release, reject with a fee-only capture and refund, payer reclaim after expiry with no operator, and the no-admin selector allowlist. They also cover replay, conflicting decisions, wrong signers, signature binding, expiry, and the timeout.
- **measured: red before green.** Against the stub, 25 of 29 tests failed with `Unimplemented()` (the stub commit `ccec256`). The red run's log is in `reports/t201-forge-test-red.log`, which is gitignored and local only.
- **measured: CPP pin.** `contracts/lib/commerce-payments` is at `6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9` (tag v1.1.0), installed with `forge install`.
- **measured: gas per deal.** From `forge test --match-contract GasPerDeal --isolate -vv`, in two transactions:

  | Path | Gas |
  | --- | --- |
  | Happy path (accept) | 266,536 (fund 176,842 + decide 89,694) |
  | Early accept | 255,777 |
  | Refund path (reject) | 272,717 (fund 176,842 + decide 95,875) |
  | Timeout | 244,879 |
  | Reclaim | 228,727 |
  | First deal ever | 343,589 |

  These numbers come from Foundry's in-process EVM in isolated-transaction mode, not from anvil receipts.
- **measured: bytecode.** A `deploy`-profile build of `6b0a5ef3` has the same metadata IPFS hash (`…725808fe…eac99a04`) as the verified v1.1.0 contract data on Base Sepolia Blockscout. Basescan shows the Base mainnet contract as an exact match with solc 0.8.28, 100000 runs and cancun.
- **measured: networks.** Ethereum mainnet and Sepolia have no code at either CPP address (Etherscan says "Address (EOA)").
- **measured: audits.** The July 2026 Cantina review covers commit `6b0a5ef3`, `AuthCaptureEscrow.sol` only, with 3 informational findings fixed in documentation. The collectors and `TokenStore` changed in comments only between v1.0.0 and v1.1.0.
- **measured: `pnpm verify`.** `typecheck`, `lint`, `spec`, `snap` and `demo` pass. The result of the final run is under Handoff.
- **inferred:** the recommendation to keep A, and every T-202 condition listed in the report.
- **guessed:** the dollar cost per deal (about $0.80 at 1 gwei and $3,000 per ETH), the extra gas of real USDC over the mock (+10k to +25k), option C's saving (20 to 30%), and the deadline margin default (one day or more).

## Decisions

- **`salt = EIP-712 hash of Terms`.** The buyer's one ERC-3009 signature then binds the operator, the price and every Holdback term, with no extra signature. Considered: a separate Holdback-signed `FundingAuthorization` checked by the rules contract. It needs a second signature and verification per deal.
- **`feeReceiver = 0`, `maxFeeBps = 10000`, `minFeeBps = 0`**, as ADR-0003 planned. The fee-only capture on reject requires them, and so does paying whichever adjudicator decides. The buyer is protected by the rules contract's code, not by CPP's bounds.
- **A settle-once `Stage` guard in the rules contract.** A test showed CPP alone lets an operator take repeated all-fee captures to any address.
- **The spike's default outcome is a refund via `void` at `decideBy`.** It works before and after `holdExpiry`. A seller-favourable default (D5) is left to T-202.
- **`fund` refuses only `adjudicationFee > price` and `decideBy > holdExpiry`**, which settlement could not process (D31). There is no cap on durations.
- **Gas is measured with `forge test --isolate`, not with an anvil node.** The brief forbids `cast send` and broadcasts. Isolate mode counts intrinsic, calldata and cold-access costs per transaction.
- **ESLint ignores `contracts/lib/**`, `contracts/out/**` and `contracts/cache/**`.** The vendored submodules carry thousands of third-party JS files that failed `pnpm lint`. `eslint.config.js` is outside this task's path list; see Handoff.

## Handoff

**Done:**
- the Foundry project, with CPP pinned;
- the minimal `HoldbackRules` and its tests;
- the gas measurements;
- the spike report;
- the ADR-0003 "Outcome of T-201" section (Status unchanged);
- this task file.

**Outside the listed paths:** a one-line change to `eslint.config.js` adds `contracts/lib/**`, `contracts/out/**` and `contracts/cache/**` to the ignores. Without it, `pnpm lint` fails on the vendored dependencies that the task's own `forge install` brings in. The infra lane should confirm it.

**Not done:**
- `forge test` is not wired into `pnpm verify` or CI. That needs Foundry in CI, which is an infra task.
- The `docs/team.md` row "No admin keys" (Phase 2) can now point at `contracts/test/NoAdmin.t.sol`. That is outside this task's paths, so it is left to the infra lane.
- No anvil-receipt gas measurement was taken.
- The collectors' bytecode was not compared.
- Whether Coinbase's CREATE2 deployment can be reproduced on L1 was not checked.

**For T-202:**
1. The funding message: today's `FundingAuthorization` does not match CPP's ERC-3009 struct (`validAfter` must be 0, and the nonce is derived from `PaymentInfo`). This needs a schema ADR and a version bump.
2. The deadline margin before `holdExpiry`, and a seller-favourable default, which must capture before it.
3. A Sepolia deployment of CPP from `6b0a5ef3` with the `deploy` profile, checked by the metadata hash.
4. The gas evidence goes to the D4 revisit: about $0.80 per deal at 1 gwei (guessed price), against a D33 minimum fee of 0.01 tUSD.

**`pnpm verify`:**
- **measured:** `typecheck`, `lint`, `spec`, `snap` and `demo` pass.
- **measured:** `test` failed only on the known load flake `packages/testkit/src/judgment.test.ts` ("draws the same panel…", a 5-second timeout). T-024 records the same flake. The file passes alone (10 of 10). The final run's report is `reports/verify-t-201-cpp-spike.md`.
