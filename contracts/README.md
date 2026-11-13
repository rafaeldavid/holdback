# Contracts

Crow's settlement contracts (protocol name Holdback), their tests and the Sepolia deployment records. Local chain and Sepolia testnet only: `foundry.toml` pins chain ID 31337 and configures no RPC endpoint.

| Path | Holds |
| --- | --- |
| `src/` | The contract files an audit covers (see [`docs/audit/scope.md`](../docs/audit/scope.md)): `DrandQuicknetBeacon.sol`, `HoldbackRules.sol`, `HoldbackTypes.sol`, `IHoldbackBeacon.sol` and `IHoldbackRules.sol`. `IHoldbackRules.sol` declares the rules contract's types, events, errors and functions and is the place for their descriptions, with no logic; `HoldbackRules` implements it |
| `test/` | Foundry tests: `unit/`, `fuzz/`, `invariant/` with its handler in `handlers/`, `crosscheck/`, `differential/` and `attack/` |
| `script/` | `deploy-sepolia.sh`; `TestUSDC.sol`, the open-mint test token on Sepolia; `LocalUSDC.sol`, `LocalMulticall3.sol` and `SimBeacon.sol` (the local chain's beacon, refused on any chain but 31337), helpers for the anvil tests |
| `deployments/` | The Sepolia deployment records |
| `lib/commerce-payments` | A git submodule: Coinbase's Commerce Payments Protocol, with the nested libraries `remappings.txt` names. Its README lists two escrow addresses on Base: `0xf968…b19c` is version 1.1.0, and `0xBdEA…0cff` is version 1.0.0 with the older fee interface (ADR-0034 §3.4) |

## Prerequisites

- Foundry `v1.0.0`, the version CI installs (`.github/workflows/ci.yml`, job `contracts`).
- Node and pnpm, for the TypeScript tests only: the Node version in `.nvmrc`, and pnpm through corepack.
- The submodules. Run these three commands from the repository root, exactly as CI runs them:

```
git submodule update --init --depth 1 contracts/lib/commerce-payments
git -C contracts/lib/commerce-payments submodule update --init --depth 1 lib/forge-std lib/permit2 lib/solady lib/spend-permissions
git -C contracts/lib/commerce-payments/lib/spend-permissions submodule update --init --depth 1 lib/openzeppelin-contracts
```

`lib/permit2` builds the tests only. The phase-one contracts fund by ERC-3009 alone (ADR-0031 §3), but the test world (`test/unit/Base.sol`) and the side-by-side harness (`test/differential/Sides.sol`) still deploy Permit2 and its collector.

Do not use `--recursive`. It clones about 100 nested test dependencies of Commerce Payments and has hung CI for more than 40 minutes (documented: the comment in `ci.yml`).

## Build

```
cd contracts
forge build
```

Settings are in `foundry.toml`: solc 0.8.28, EVM version prague, the optimizer with 200 runs, and the IR pipeline. The drand verifier needs prague for the EIP-2537 precompiles. The IR pipeline keeps `HoldbackRules` under the EIP-170 size limit.

## Test

```
cd contracts
forge test
```

| Suite | Files | What it checks |
| --- | --- | --- |
| `test/unit/` | One test file per entry point or review fix, and `Base.sol` | Each entry point and each review fix. `Vectors.t.sol` pins the EIP-712 hashes against `packages/core`. `GasPerDeal.t.sol` holds gas budgets |
| `test/fuzz/` | `NoAdmin`, `Postings` | No admin path and postings that balance. `foundry.toml` sets no fuzz run count, so Foundry's default applies |
| `test/invariant/` | `RulesInvariants.t.sol`, `HandlerSmoke.t.sol` and `StateOracle.t.sol` (with `StateOracle.sol`), with `test/handlers/RulesHandler.sol` | The invariants listed in [`docs/audit/invariants.md`](../docs/audit/invariants.md). Their run count and depth are set inline in `RulesInvariants.t.sol`, not in `foundry.toml` |
| `test/crosscheck/` | One file per case | Cases from the public-audit cross-check (`docs/reviews/2026-11-03-public-audit-crosscheck.md`), and the drand verifier's reviews |
| `test/attack/` | `PhaseOneRedTeam.t.sol` | The red team's attacks on the phase-one contracts |
| `test/differential/` | `SideBySide.t.sol` and `PinnedSource.t.sol`, with the pinned old side in `old/` and a planted mutant in `planted/` | The side-by-side harness (T-341): the source of the 2026-11-04 deployment (`contracts/src/` at `64be1f1`, pinned in `old/`) and today's source run the same calls, and any difference not in `AllowList.sol` fails |

Notes:
- `NoAdmin.fuzz.t.sol` reads the compiled ABIs from `out/`, and the drand tests read `../fixtures/beacon`. `foundry.toml` grants read access to those two paths only.
- `forge test` prints today's count of tests and suites; CI prints it on every run.
- CI runs `forge test` in its `contracts` job. Its `anvil` job runs `forge build`, because `forge test` does not compile `script/`, which the anvil tests need.

## TypeScript tests that need anvil

These tests start anvil and load the build output in `contracts/out`. Run them from the repository root after `forge build`:

```
pnpm install --frozen-lockfile
pnpm build
pnpm vitest run packages/settlement/evm packages/testkit/src/runner.test.ts
```

That is the settlement leg of CI's `anvil` job. Its second leg, the world leg, runs the demo world on anvil, its relayer lanes, registration and timeouts, the drand verifier's differential test and the round's adjudicator; the job's matrix in `.github/workflows/ci.yml` lists the seven files.

Without Foundry or `contracts/out` they skip. CI fails a leg when any of its tests skips. The differential run against SimChain is `pnpm snap --settlement=local`.

## The ABI pipeline

`packages/settlement/evm/abis.json` is the copy of the ABIs that a live chain uses. After a contract change:

```
cd contracts && forge build && cd ..
node scripts/evm-abis.mjs
```

The script reads the ABIs its `SOURCES` names (`HoldbackRules`, `TestUSDC`, `AuthCaptureEscrow`, `LocalMulticall3` and `ERC3009PaymentCollector`) from `contracts/out` and writes them to `abis.json`. `packages/settlement/evm/abis.test.ts` fails when `abis.json` differs from `contracts/out`. It skips without build output.

## Deployments

| File | Commit | EIP-712 domain | Status |
| --- | --- | --- | --- |
| `deployments/sepolia.json` | The record's `commit` field; the annotated tag `contracts-phase-one-1` holds the same `contracts/src` | "Holdback", the version in `holdbackDomain` (`packages/core/src/eip712.ts`) | Live since the record's `deployedAt` (the phase-one contracts, ADR-0031). New deals settle here |
| `deployments/sepolia-2026-11-04T0830Z-domain-0.7.json` | `64be1f1` | "Holdback" 0.7 | Superseded on 2026-11-13. Deals opened on it finish on it |
| `deployments/sepolia-2026-11-03-domain-0.6.json` | `2342756` | "Holdback" 0.6 | Superseded on 2026-11-04. Deals opened on it finish on it |

Each record holds the addresses, creation transactions, blocks, constructor arguments, the commit and the compiler settings. The dated records keep their values as written. `docs/operations.md` ("Sepolia contracts") describes the deploy steps. Deploying is a gate: it waits for Rafa.

Check the live record against the chain. The command deploys nothing and only reads:

```
contracts/script/deploy-sepolia.sh --check <sepolia-rpc-url>
```

**The build-input rule.** `--check` fails unless `src`, `lib`, `foundry.toml`, `remappings.txt` and `script/TestUSDC.sol` equal the commit in the record, with no uncommitted change. So:
- run `--check` from a checkout whose build inputs equal the recorded commit;
- a change to any of those five paths ships as a new deployment with a new record. The old record moves to a dated file, as the 0.6 and 0.7 records did.

To check a dated record, check out the commit in its `commit` field and copy that file over `sepolia.json` first (documented: `docs/operations.md`).

## Events are part of the interface

The operators' view and the monitoring read the contracts' events. The EVM adapter in `packages/settlement/evm` follows timeouts and deliveries from their logs (documented: `docs/neutrality.md`, residual 13). Treat a removed, renamed or reshaped event as an interface change: it needs the same care as a changed function, a new `abis.json` and a new deployment. Phase one removed the events of the features it cut, which are not in phase one: the bond vault's events, `AppealFiled`, `AppealClosed` and `Paid` (ADR-0031 §10). It added `SettlementAddresses`, which names each deal's payment and payout addresses (ADR-0033).
