# T-213: The public demo settles on Sepolia

- **Lane:** settlement, demo
- **Phase:** 2
- **Depends on:** T-205 (the EVM adapter), T-209 (the drand verifier), T-206 (the reviewed contracts deployed to Sepolia, `contracts/deployments/sepolia.json`), T-037 (`try.mjs`), T-031 (telemetry in the world)
- **Paths this task may touch:** `packages/settlement/evm/`, `packages/settlement/sim/actors.ts` (`mandateFor` under another domain), `packages/settlement/package.json` and `tsconfig.json` (the `./live` export), `packages/testkit/src/stub-settlement.ts` (the shared `rebindToken`), `apps/demo-cloud/`, `apps/operator/src/prepare.ts`, `registry.ts`, `server.ts` (the domain's verifying contract and ERC-3009 messages in prepare), `examples/` (`verify.ts`, `agent.ts`, `try.ts`, `deployments.ts`), `site/` (`llms.txt`, the bundle, `check.mjs`), `scripts/evm-abis.mjs`, `reports/differential-local.md`, `docs/decisions/ADR-0028-demo-settles-on-sepolia.md`, `docs/decisions-today.md` (D41), `docs/research/2026-11-03-sepolia-demo-settlement.md`, `docs/operations.md`, `docs/neutrality.md` (the relayer row), `docs/backlog.md`, `docs/plan.md`, this file
- **Human gate:** yes for the cutover (deploys to the public demo, a Sepolia-only relayer key as a Worker secret, Sepolia ETH from Rafa); Rafa approved the cutover and the Sepolia deploys on 2026-11-03. The PRs themselves are in-repo.
- **Status:** in progress
- **Agent/session:** Claude Code (Opus 5.5), worktree `demo-sepolia-settlement-81a855`, branch `claude/demo-sepolia-settlement-81a855`

## Intent

Rafa decided on 2026-11-03 that the public demo settles on Sepolia (D41). Restated: the two public operator nodes keep their API, their one-command test deal and their single approval, but the money in every deal moves through the reviewed HoldbackRules and Coinbase's AuthCaptureEscrow on Ethereum Sepolia instead of the in-process SimChain, so anyone can check the hold and the release on Etherscan, and anyone with Sepolia ETH can call the contracts without an operator. A flag per Worker picks SimChain or Sepolia, so the cutover and its rollback are one deploy each. Operators pay gas from Sepolia-only relayer keys and relay what the parties sign; they author nothing. Test tokens only, never mainnet.

Non-goals: independent operator nodes (one Durable Object still serves both names); drand proofs for fallback and appeal decisions, direct transactions in the operators' view, an in-flight row per relayer lane, and the schema v0.9 items (each staged in ADR-0028 §11); any contract change.

## Context

- D41, ADR-0028 (the design), the research pass (`docs/research/2026-11-03-sepolia-demo-settlement.md`).
- ADR-0005 (operators relay signed messages), ADR-0018 (beacon), ADR-0023 (operator fee), ADR-0025 (EVM funding and token identifiers), D4, D33.
- T-205 Decisions (pre-funding stages in the adapter; the contract is the authority from funding on), T-209 Handoff (the drand verifier on Sepolia).
- `docs/operations.md` (deploys, the World Durable Object, the November 2 quota outage).

## Acceptance criteria

- [x] `EvmSettlement` runs on a live testnet (kind `testnet`) through a chain port, with anvil (kind `local`) unchanged: `pnpm snap --settlement=local` passes 29 of 29 with transcripts identical to SimChain's.
- [x] Events keep SimChain's payloads plus the transaction; the adjudicators get their envelopes from the adapter; the primary's acceptance is served in full.
- [x] Relayer lanes from one Sepolia-only secret, serial per lane, estimate-based gas, a fee cap, rebroadcast and fee bump, batched faucet mints.
- [x] The world opens as `sim` or `sepolia`, persists books and paged events with no replay, sets up its adjudicators' bonds on chain, and refuses to open as the other kind; the Worker's `SETTLEMENT` picks the world.
- [x] `prepare/agree-and-fund` hands out the token's ERC-3009 messages on a chain; `examples/verify.ts` rebuilds them, the CPP nonce included, from a pinned deployment.
- [x] On anvil standing in for Sepolia (a block a second, wall-clock time), `examples/try.ts` completes a deal over HTTP to Released with one transaction each for funding, delivery and decision, and the world reopens from storage with the same log.
- [ ] Against a Sepolia fork of the deployed contracts, the same deal completes.
- [ ] The cutover: op2 first, `try.mjs` end to end against it, then op1; `llms.txt`, `try.mjs` and discovery say Sepolia; a `try.mjs` deal prints Sepolia transaction links; a vanilla Claude Code trial of the homepage prompt needs about two approvals.
- [ ] Review by the reviewer and red-teamer roles, with whether a different-family review ran recorded; CI green.

## Out of scope

- The staged items in ADR-0028 §11.
- Mainnet, at any point.

## Evidence

Labels: measured, inferred, guessed.

- **Differential (measured, anvil).** `pnpm snap --settlement=local`: 29 passed, 0 failed, 3 excluded until Phase 4; all 29 transcripts identical to SimChain's (`reports/differential-local.md`). Before this task 6 were identical; the other 23 differed only in the adjudicators' `key.released` events, which the adapter now releases off chain as SimChain does.
- **Typed data (measured, anvil).** The funding and operator-fee typed data an operator prepares hash to the digests the token checks against its own `DOMAIN_SEPARATOR` (`packages/settlement/evm/evm-settlement.test.ts`).
- **End to end on a live-chain stand-in (measured, anvil `--block-time 1`).** `apps/demo-cloud/src/live.test.ts`: the world bonds its three adjudicators on chain, `examples/try.ts` runs in its own process against two origins and reaches Released; its `chain` lines name three transactions (funded, delivered, decided); `dealOf` reads Released and CPP holds nothing for the deal; the world reopens from the same storage with an identical event log and digest.
- **Bundle (measured).** `wrangler deploy --dry-run` for holdback-op1: 2,385 KiB, 455 KiB gzipped.

## Decisions

1. **The Durable Object takes its kind from the world it is asked to open,** recorded in `meta` at creation; the Worker forwards its `SETTLEMENT`, and an existing world ignores it. The research recommended reading the object's own name; forwarding is equivalent here (the Worker picks the name from the same variable) and needs no runtime feature.
2. **The fee authorization is valid from the epoch on a chain,** as the funding is. A simulation runs on a block that can predate the terms' `createdAt` by up to a block, and ERC-3009 requires `validAfter` strictly in the past; measured on anvil, where a deal funded within the second it was offered. The nonce already binds it to one commitment.
3. **The faucet's mint bypasses the adapter,** so the world drops the minted address's cached balance; the funding check reads the buyer's balance fresh (measured: a stale cache made the mirror refuse a funding the contract accepted).
4. **No chain call while opening a world:** opening runs inside `blockConcurrencyWhile` (30 s), so bonds are read on the first pass.

## Handoff

- **Done:** see the checked criteria; the relayer secret `SEPOLIA_RELAYER_KEY` is set on holdback-op1 (2026-11-03), funding lane `0x601137a8DE7E195E1426f57C053aFa49B20Ef555`; Rafa asked to fund it.
- **Next:** when `contracts/deployments/sepolia.json` lands on main (T-206), copy it into `examples/deployments.ts`, regenerate `abis.json` if the ABI moved, run the Sepolia-fork test, then the cutover PR (`llms.txt`, the pinned domain, `SETTLEMENT=sepolia`) and the deploys in `docs/operations.md`.
