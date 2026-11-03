# T-213: The public demo settles on Sepolia

- **Lane:** settlement, demo
- **Phase:** 2
- **Depends on:** T-205 (the EVM adapter), T-209 (the drand verifier), T-206 (the reviewed contracts deployed to Sepolia, `contracts/deployments/sepolia.json`), T-037 (`try.mjs`), T-031 (telemetry in the world)
- **Paths this task may touch:** `packages/settlement/evm/`, `packages/settlement/sim/actors.ts` (`mandateFor` under another domain), `packages/settlement/package.json` and `tsconfig.json` (the `./live` export), `packages/testkit/src/stub-settlement.ts` (the shared `rebindToken`), `apps/demo-cloud/`, `apps/operator/src/prepare.ts`, `registry.ts`, `server.ts` (the domain's verifying contract and ERC-3009 messages in prepare), `examples/` (`verify.ts`, `agent.ts`, `try.ts`, `deployments.ts`), `site/` (`llms.txt`, the bundle, `check.mjs`), `scripts/evm-abis.mjs`, `reports/differential-local.md`, `contracts/script/TestUSDC.sol` and `contracts/test/unit/TestUSDC.t.sol` (the test token, D42), `contracts/test/fuzz/NoAdmin.fuzz.t.sol` (tUSDC as a target), `docs/decisions/ADR-0028-demo-settles-on-sepolia.md`, `ADR-0023-operator-fee.md` (gas in the fee, the front-run mitigation), `ADR-0026-funding-paths.md` (a dated note), `docs/decisions-today.md` (D41, D42, the D33 amendment, a D38 note), `docs/tasks/T-214-usd-usdc-onramp.md` (D42's on-ramp, written here, not built), `docs/team.md` (the NoAdmin row), `docs/research/2026-11-03-sepolia-demo-settlement.md`, `docs/operations.md`, `docs/neutrality.md` (the relayer row), `docs/backlog.md`, `docs/plan.md`, this file
- **Human gate:** yes for the cutover (deploys to the public demo, a Sepolia-only relayer key as a Worker secret, Sepolia ETH from Rafa); Rafa approved the cutover and the Sepolia deploys on 2026-11-03. The PRs themselves are in-repo.
- **Status:** in progress
- **Agent/session:** Claude Code (Opus 5.5), worktree `demo-sepolia-settlement-81a855`, branch `claude/demo-sepolia-settlement-81a855`

## Intent

Rafa decided on 2026-11-03 that the public demo settles on Sepolia (D41). Restated: the two public operator nodes keep their API, their one-command test deal and their single approval, but the money in every deal moves through the reviewed HoldbackRules and Coinbase's AuthCaptureEscrow on Ethereum Sepolia instead of the in-process SimChain, so anyone can check the hold and the release on Etherscan, and anyone with Sepolia ETH can call the contracts without an operator. A flag per Worker picks SimChain or Sepolia, so the cutover and its rollback are one deploy each. Operators pay gas from Sepolia-only relayer keys and relay what the parties sign; they author nothing. Test tokens only, never mainnet.

Non-goals: independent operator nodes (one Durable Object still serves both names); drand proofs for fallback and appeal decisions, direct transactions in the operators' view, an in-flight row per relayer lane, and the schema v0.9 items (each staged in ADR-0028 §11); any change to the settlement contracts. The test token TestUSDC is new code, outside `contracts/src`, deployed by T-206 with the core set; the on-ramp (T-214) and other assets (the Assets module, Phase 6) are later work.

## Context

- D41, ADR-0028 (the design), the research pass (`docs/research/2026-11-03-sepolia-demo-settlement.md`).
- ADR-0005 (operators relay signed messages), ADR-0018 (beacon), ADR-0023 (operator fee), ADR-0025 (EVM funding and token identifiers), D4, D33.
- T-205 Decisions (pre-funding stages in the adapter; the contract is the authority from funding on), T-209 Handoff (the drand verifier on Sepolia).
- `docs/operations.md` (deploys, the World Durable Object, the November 2 quota outage).

## Acceptance criteria

- [x] `EvmSettlement` runs on a live testnet (kind `testnet`) through a chain port, with anvil (kind `local`) unchanged: `pnpm snap --settlement=local` passes 25 of 25 (3 excluded until Phase 4) with transcripts identical to SimChain's.
- [x] Events keep SimChain's payloads plus the transaction; the adjudicators get their envelopes from the adapter; the primary's acceptance is served in full.
- [x] Relayer lanes from one Sepolia-only secret, serial per lane, estimate-based gas, a fee cap, rebroadcast and fee bump, batched faucet mints.
- [x] The world opens as `sim` or `sepolia`, persists books and paged events with no replay, sets up its adjudicators' bonds on chain, and refuses to open as the other kind; the Worker's `SETTLEMENT` picks the world.
- [x] `prepare/agree-and-fund` hands out the token's ERC-3009 messages on a chain; `examples/verify.ts` rebuilds them, the CPP nonce included, from a pinned deployment.
- [x] On anvil standing in for Sepolia (a block a second, wall-clock time), `examples/try.ts` completes a deal over HTTP to Released with one transaction each for funding, delivery and decision, and the world reopens from storage with the same log.
- [x] Against a Sepolia fork of the deployed contracts, the same deal completes.
- [ ] The cutover: op2 first, `try.mjs` end to end against it, then op1; `llms.txt`, `try.mjs` and discovery say Sepolia; a `try.mjs` deal prints Sepolia transaction links; a vanilla Claude Code trial of the homepage prompt needs about two approvals.
- [ ] Review by the reviewer and red-teamer roles, with whether a different-family review ran recorded; CI green. (Both roles ran and their findings are fixed, see Evidence; the different-family review did not run, see Handoff; CI is checked on the PR.)

## Out of scope

- The staged items in ADR-0028 §11.
- Mainnet, at any point.

## Evidence

Labels: measured, inferred, guessed.

- **`pnpm verify` (measured, 2026-11-03, after merging main with T-206's #125, #127 and #135, the review fixes on top): PASS** (`reports/verify-claude-demo-sepolia-settlement-81a855.md`). No snapshot diffs against HEAD. vitest 2,214 passed and 3 skipped: the Sepolia-fork test, which needs `SEPOLIA_FORK_RPC` and the deployment file, and two conditional skips that predate this task (inferred from the skip conditions). forge: 183 tests in 24 suites, TestUSDC's 5 and the NoAdmin suite with tUSDC included. `abis.json` regenerated for #135 (`HoldbackBonds.tryEncumber` removed).

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 350 ms |
  | lint | `pnpm lint` | pass | 3583 ms |
  | forge build | `forge build --root contracts` | pass | 1005 ms |
  | forge | `forge test --root contracts` | pass | 19645 ms |
  | test | `pnpm test` | pass | 50449 ms |
  | spec | `pnpm validate:spec` | pass | 590 ms |
  | snap | `pnpm snap` | pass | 8818 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 16324 ms |
  | demo | `pnpm demo` | pass | 4373 ms |

- **Differential (measured, anvil).** `pnpm snap --settlement=local`: 25 passed, 0 failed, 3 excluded until Phase 4 (PR 113 removed four fixtures); every transcript is identical to SimChain's (`reports/differential-local.md`). Before this task 6 of 29 were; the other 23 differed only in the adjudicators' `key.released` events, which the adapter now releases off chain as SimChain does. `error.submission-limit` (renamed from `todo.` by PR 113) now gets SimChain's `submission_limit_reached` on the contract too.
- **Fee front-run (measured, anvil).** On tUSDC a stranger relays the buyer's fee transfer alone; the agreement still funds with `agreeAndFund` alone, and the operator is paid once (`evm-settlement.test.ts`).
- **TestUSDC (measured, forge).** 5 tests: metadata and domain separator, one use per nonce, payee-only receive, refusals, no Permit2 allowance.
- **Gas in the fee (measured, anvil).** The live test runs with `OPERATOR_FEE_GAS` 4700000: `try.ts` pays a 4.71 tUSDC operator fee on a 25 tUSDC deal.
- **The deployment (measured, 2026-11-03, read-only on Sepolia).** `LiveChain.verify()` passes against T-206's `sepolia.json` (chain id, rules code, `EXPIRY_MARGIN` 86400); the token reads "Crow Test USDC", tUSDC, 6 decimals, with T-206's domain separator.
- **Sepolia fork (measured, 2026-11-03).** On an anvil fork of Sepolia (`--hardfork prague`, which the drand verifier needs), the world bonds its adjudicators and `try.ts` reaches Released with the three chain lines.
- **Real Sepolia gas (measured, 2026-11-03).** The fork's 19 transactions replayed through `eth_simulateV1` on Sepolia (nothing sent): funding with the fee 938,547 gas (317,107 on the fork), decision 521,658 (193,222), delivery 103,320 (61,217), a mint to a new holder 238,103 (68,063), a first bond deposit 244,975 (73,767), ETH to a new account 204,600 (21,000). New state costs about 3.5 times Prague's on Sepolia. Sepolia's base fee is near zero and its median tip 1 gwei. So the gas cap is 3 million (from 1.5), faucet batches hold six mints, and the gas quote is 4.70 tUSDC (from 1.50; D33 note). The fork test now replays its transactions this way and fails if any exceeds the cap after the 25 % pad.
- **Typed data (measured, anvil).** The funding and operator-fee typed data an operator prepares hash to the digests the token checks against its own `DOMAIN_SEPARATOR` (`packages/settlement/evm/evm-settlement.test.ts`).
- **End to end on a live-chain stand-in (measured, anvil `--block-time 1`).** `apps/demo-cloud/src/live.test.ts`: the world bonds its three adjudicators on chain, `examples/try.ts` runs in its own process against two origins and reaches Released; its `chain` lines name three transactions (funded, delivered, decided); `dealOf` reads Released and CPP holds nothing for the deal; the world reopens from the same storage with an identical event log and digest.
- **Bundle (measured).** `wrangler deploy --dry-run` for holdback-op1: 2,385 KiB, 455 KiB gzipped.
- **Review (measured, 2026-11-03).** The `reviewer` role returned ISSUES (12). All are fixed in the second commit set: replays kept with each book so a retry after a restart replays (hard rule: idempotency); `commitment.agreed` announced only once the funding is mined, and a failed funding takes back only its own agreement; `relay_refused` from the lanes; the gas cap checked on the padded estimate; the deployment's `EXPIRY_MARGIN` checked against the contract; the relayer's lane keys in the secret sweep; tUSDC in the NoAdmin suite; the doc counts and scope above.
- **Red team (measured, 2026-11-03).** The `red-teamer` role found two defects, each proved with a test it ran, and passed the relayer, signing, settlement-kind, read-cost and secret surfaces. (1) High: on a live chain, a funding that failed while another deal moved spliced that deal's events out of the shared log. Fixed by the deferred announcement above; `packages/settlement/evm/wall.test.ts` fails on the first commit and passes now. (2) Low to medium: two faucet requests for one address arriving together both granted, minting and paying gas twice on Sepolia. Fixed with in-memory reservations in the Durable Object; `world.test.ts` "grants once when two requests for one address arrive together".
- **Public-audit cross-check (2026-11-03).** A cancelled USDC authorization spends the fee nonce as a payment does, so the adapter now takes only the `AuthorizationUsed` log and the transfer as proof; without the log the node answers `payment_required` (tUSDC has no `cancelAuthorization`, so no local test can cancel; inferred from the code path, which the "spent paying someone else" test exercises). The fund leg copied alone is staged with direct transactions (ADR-0028 §11).
- **The page, followed literally (measured, 2026-11-03).** `site/walkthrough.mjs` builds every message from `site/llms.txt` alone (its pinned Sepolia domain and deployment, its ERC-3009 types, the two nonces from Encodings, the fee from discovery) and runs a deal to Released and final against the world on the Sepolia fork, inside the fork test. It compares every served value exactly, addresses included. It found the domain's `verifyingContract` served checksummed while the page pins it lowercase; the review found the same in the ERC-3009 typed data and in `fees.operator.to`. All are now served lowercase (the hashes are unchanged), and the walkthrough passes without folding case. `node site/build.mjs && node site/check.mjs`: PASS (measured), with its new checks of the pinned domain, deployment and ERC-3009 types against the examples' Sepolia pin. These and the gas figures were measured by this session.
- **Re-review (measured, 2026-11-03).** The `reviewer` role confirmed all 12 items and both red-team fixes, and found the fee proof accepting a `Transfer` log from any contract or any transfer in the same transaction. Fixed: the proof is now the token's own `Transfer` as the log right after `AuthorizationUsed`. A test batches the fee nonce paying someone else with another authorization paying this operator: `payment_required` (measured; the earlier check would have funded, inferred from the code). Also: every relayer send waits for the one-time chain check, and ADR-0023 states the proof rule.
- **New tests (measured, anvil and no-chain).** `relay_refused` changes nothing and the same agreement funds after; on tUSDC a fee relayed ahead of the bundle reads "paid by an earlier transaction", and a fee nonce the buyer spent paying someone else is refused `payment_required` with nothing held, while the funding alone still works; on LocalUSDC, which logs `AuthorizationUsed` for `receiveWithAuthorization` only, the earlier payment cannot be proved and the node answers `payment_required`; a retry after a restart replays and the same key with another body is `idempotency_conflict`.

## Decisions

1. **The Durable Object takes its kind from the world it is asked to open,** recorded in `meta` at creation; the Worker forwards its `SETTLEMENT`, and an existing world ignores it. The research recommended reading the object's own name; forwarding is equivalent here (the Worker picks the name from the same variable) and needs no runtime feature.
2. **The fee authorization is valid from the epoch on a chain,** as the funding is. A simulation runs on a block that can predate the terms' `createdAt` by up to a block, and ERC-3009 requires `validAfter` strictly in the past; measured on anvil, where a deal funded within the second it was offered. The nonce already binds it to one commitment.
3. **The faucet's mint bypasses the adapter,** so the world drops the minted address's cached balance; the funding check reads the buyer's balance fresh (measured: a stale cache made the mirror refuse a funding the contract accepted).
4. **No chain call while opening a world:** opening runs inside `blockConcurrencyWhile` (30 s), so bonds are read on the first pass.

## Handoff

- **Done:** see the checked criteria; the relayer secret `SEPOLIA_RELAYER_KEY` is set on holdback-op1 (2026-11-03), funding lane `0x601137a8DE7E195E1426f57C053aFa49B20Ef555`; Rafa asked to fund it.
- **T-206 deploys TestUSDC** with the core set only if `contracts/script/TestUSDC.sol` is on main when it runs the deploy; message it when this PR merges.
- **Next:** when `contracts/deployments/sepolia.json` lands on main (T-206), copy it into `examples/deployments.ts`, regenerate `abis.json` if the ABI moved, run the Sepolia-fork test (`SEPOLIA_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com pnpm vitest run apps/demo-cloud/src/live.test.ts`), then the cutover PR (`llms.txt`, the pinned domain, `SETTLEMENT=sepolia`) and the deploys in `docs/operations.md`.
- **Different-family review: not run.** Only Anthropic models are reachable from this environment (the live judges' DeepSeek key is a Worker secret and in `.env`, which agents never read), as T-206 also found. Brief for a reviewer from another family (for Rafa to run): read `CLAUDE.md`, ADR-0028, ADR-0005 and ADR-0025, then the diff of `packages/settlement/evm/` (`evm-settlement.ts`, `live.ts`, `chain.ts`), `apps/demo-cloud/src/world.ts` and `worker.ts`, `apps/operator/src/prepare.ts` and `examples/verify.ts`. Focus on: whether any relayed call could move funds or change an outcome without a party's or an adjudicator's signature; the CPP nonce and ERC-3009 typed data in `verify.ts` against `encode.ts` and `HoldbackRules._paymentInfo`; nonce handling and stuck transactions in `LiveChain.sendNow`; the mirror stepped at block time and the divergence checks in `EvmSettlement.send`; and what a restart between broadcast and receipt leaves behind.
