# T-224: Appeal bonds by a relayed permit

- **Lane:** settlement (the EVM adapter), api (prepare and the route), core (the request type and parser), spec, demo (the wiring), docs
- **Phase:** 2
- **Depends on:** nothing in the contracts.
  - The schema bump rides T-221's 0.10 or follows it as 0.11; the merge order decides (D48).
  - A *decided* appeal on Sepolia also needs T-217's drand proofs, shipped through T-220. The filing works before that, and `appeal-expiry` returns the bond.
  - Round 1 (T-216) scenarios 6 and 7 use this task.
- **Paths this task may touch:**
  - the ADR: `docs/decisions/ADR-0031-appeal-bond-by-permit.md` (new);
  - spec: `spec/schemas/` (`messages.schema.json` or `common.schema.json`, a new `AppealRequest`), `spec/examples/`, `spec/openapi/paths.json`, `spec/openapi.json`;
  - core: `packages/core/src/types.ts`, `parse.ts` and their tests;
  - settlement: `packages/settlement/src/interface.ts`, `packages/settlement/sim/simchain.ts`, `packages/settlement/evm/evm-settlement.ts`, `errors.ts`, `encode.ts`, `abis.json` (no change expected: `permit` and `nonces` are already there), and their tests;
  - operator: `apps/operator/src/prepare.ts`, `server.ts` and their tests;
  - demo: `apps/demo-cloud/src/world.ts` and `world.test.ts`;
  - examples: `examples/verify.ts`, `sign.ts`, `agent.ts`, `deployments.ts` and their tests;
  - site: `site/llms.txt`, `site/check.mjs`;
  - docs: `docs/api.md`, `docs/neutrality.md`, `docs/decisions/ADR-0023-operator-fee.md` (one line), `docs/backlog.md`, `docs/plan.md`, `docs/tasks/T-216-*.md`, `docs/tasks/T-221-*.md`, this file.
  - **Not** `contracts/`.
- **Human gate:** no for the PR. The live deploy that carries it is T-220's, or a later one, on Rafa's go-ahead.
- **Status:** todo
- **Agent/session:** —

## Intent

Rafa, 2026-11-04: "Yes, plan it". He wanted a visitor's agent that holds test tUSDC but no Sepolia ETH to be able to appeal on the Sepolia demo.

Restated: make the appeal bond's allowance a signature that the operator relays. An agent then appeals through the API with no transaction of its own, the way it already funds a deal. The design is option (b) in `docs/research/2026-11-04-visitor-gas.md`; the decision is D48.

## Context

- D43: only the losing party appeals; an overturn pays from the decider's bond.
- D33 as amended: gas is part of the operator fee.
- ADR-0023's EVM amendment: the Multicall3 fee bundle and its front-run rule.
- ADR-0025: token-domain signatures carried in API bodies.
- ADR-0028 §3: relayer lanes relay and never author.
- T-212: 263 bytes of HoldbackRules headroom; the mainnet redeploy.
- T-216, scenarios 6 and 7.
- T-221: the adjudicator's own bond stays own-ETH until the redeploy.
- D49 (pending): T-220 keeps today's world.

## Acceptance criteria

- [ ] **ADR-0031, Proposed.** It covers the slot, the body member, the bundle, the allowance pre-check, the front-run rule, the nonce rule, the version bump, who pays, the litmus tests and the mainnet path (USDC `permit`, and the `bytes` overload for contract wallets).
- [ ] **Schema, additive.**
  - `AllowancePermit` and `AppealRequest`, which is an `Appeal` plus an optional `bondPermit`; `submitAppeal` takes `AppealRequest`; an example.
  - `pnpm validate:spec` passes, and every `$id` and the version header move.
  - The EIP-712 domain stays 0.7.
- [ ] **Prepare.** On a chain world, when the appellant's allowance is below the bond, `POST /v1/prepare/appeal` returns `bondPermit.signature`: `Permit` typed data under the token's domain, with owner the appellant, spender the deployment's `bonds`, value the bond, nonce read from the token, and deadline `appealBy`.
  - When the allowance covers the bond, or on SimChain, it returns one slot as today.
  - The check text names the spender, the value, the deadline and the domain. It stops promising an appeal fee on chain worlds, which collect none.
  - `defaults` carries the nonce and the deadline.
- [ ] **Relay.** The operator strips `bondPermit` before verifying the `Appeal` signature, and passes it to the settlement submission. The EVM adapter:
  - reads `allowance(appellant, bonds)`, and files the appeal alone when that covers the bond;
  - otherwise refuses, with `invalid_terms`, a permit whose spender, owner or token is wrong or whose value is below the bond;
  - otherwise relays `permit` and `fileAppeal` through Multicall3 on the deal's lane;
  - maps `InvalidPermit` to `invalid_signature` and `PermitExpired` to `deadline_passed`;
  - keeps `appeal.filed` carrying the transaction, as today.
  SimChain ignores `bondPermit`.
- [ ] **Anvil tests** in the adapter's harness, with no impersonated allowance for the appellant:
  - the bundle files the appeal and the bond moves once;
  - an appellant that approved the vault itself files without a permit;
  - a stranger relays the permit first and the node files the appeal alone (`attack.appeal-permit-front-run`);
  - a wrong spender, an expired permit and a replay are refused, with nothing sent;
  - the node refuses to relay and the appellant files directly with both calls (`neutrality.operator-refuses-appeal-relay`).
  Record the gas per transaction in Evidence.
- [ ] **Agent side.**
  - `examples/verify.ts` checks the new slot against its own intent (the pinned `bonds` address, the bond it computed, `appealBy`, itself as signer) and refuses anything else.
  - `examples/sign.ts` and `examples/agent.ts` can file an appeal.
  - `examples/deployments.ts` pins `bonds`, if it doesn't already.
- [ ] **Docs and site.**
  - `llms.txt`: the appeal section; the honest limits, which list what still needs your own ETH (an outside adjudicator's deposit and withdrawal until the redeploy, minting tUSDC yourself past the faucet's day budget, and direct calls); the pinned deployment gains `bonds`; the type list gains `Permit`. `site/check.mjs` passes.
  - Updated: `docs/api.md`, `docs/neutrality.md` (the operator row), ADR-0023 (one line), `docs/backlog.md` (narrow the "Gasless bonds" row to the deposit, and add a T-215 row for an appeal part of the quote), `docs/plan.md`, T-216 and T-221.
- [ ] **Review.** The `reviewer` and `red-teamer` roles, with project context, because this adds a token-level signature to a write route and a bundle the relayer sends. `pnpm verify` passes, and `pnpm snap` shows no snapshot diff.

## Out of scope

- Any contract change. The gasless adjudicator bond (`depositWithAuthorization` and a signed `withdraw`) belongs to T-212's redeploy (backlog).
- A gas drip from the faucet (backlog, Rafa's call).
- An operator fee or gas part for appeals (T-215, before mainnet).
- A minimum appeal bond in the signed terms (T-212, before mainnet, D43).
- `try.mjs --outcome appeal`: a later slice, once round 1 has run the path.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **The research pass** (2026-11-04, `docs/research/2026-11-04-visitor-gas.md`) measured:
  - the appeal bond's allowance is a visitor's only step that needs its own ETH;
  - tUSDC implements `permit` under the funding's domain;
  - anvil gas: 73,884 for the permit and 108,396 for `fileAppeal`;
  - HoldbackRules is 263 bytes under the contract size limit.

## Handoff

- **For T-220's `llms.txt` text, under "Appeal":** "On Sepolia, prepare returns a second slot, `bondPermit.signature`: an EIP-2612 `Permit` under the token's domain that lets HoldbackBonds take exactly your bond until `appealBy`. Check `spender` against your pinned `bonds` address and `value` against the bond you computed, then sign both slots. The operator relays the permit and the appeal in one transaction and pays the gas. You never need Sepolia ETH to appeal; you do to bond your own adjudicator, to mint tUSDC yourself when the faucet's day budget is spent, and to call the contracts directly."
- **Overlaps:** the round-1 workflow builds T-219, T-221 slice 2 and T-220's code prep in parallel. This task touches `evm-settlement.ts` (after T-218 and T-219), `world.ts` (after T-219 and T-221 slice 2) and the schema (after T-221). Start after those merge, or stack on them and merge `origin/main` in before landing.
