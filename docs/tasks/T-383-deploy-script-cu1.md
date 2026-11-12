# T-383: the deploy script's remainder, the start-up check and the record's copies (package CU-1)

- **Lane:** settlement
- **Phase:** 2 (phase-one contracts, testnet-ready checklist item 8)
- **Depends on:** T-380 (R8: `BEACON_MARGIN`, merged in PR 418), T-363 (the cutover checklist), T-378 (R6c-2, the operator side)
- **Paths this task may touch:** `contracts/script/deploy-sepolia.sh`; `packages/settlement/evm/live.ts` with its tests, and one data file beside it (the accepted-token table); one new command under `scripts/` with its test; the two lines that name a world (`apps/demo-cloud/src/worker.ts`, `apps/test-agents/src/worker.ts`) and the one test line that pins the first (`apps/demo-cloud/src/worker.test.ts`); `examples/deployments.ts` only as the copies command's target; `docs/cutover-phase-one.md` where a step's command changes; this file. Nothing under `contracts/src` or `contracts/test`.
- **Human gate:** no. The task builds and tests on a local chain only. The deploy on Sepolia, and any explorer key, are Rafa's at the cutover.
- **Change kind:** 7 for the script, 5 for the start-up check; one reviewer per pull request.
- **Status:** done on the merge of PR 430 (PRs 422, 423, 429 and 430, into `contracts-audit-ready`)
- **Agent/session:** the T-383 session (Opus 5.5), started 2026-11-12 by the coordinator

## Intent

The pilot runs as a loop on Sepolia: deploy the frozen commit, let the design partner audit it, fix, redeploy, review the fixes. So the redeploy has to be a routine that runs the same way every time, with no hand edits between runs. This task makes it one.

What goes in:

1. **The beacon margin in the deploy.** R8 added a sixth constructor argument, `BEACON_MARGIN` (29 s on Sepolia). The script's create line, its creation-code check, its wiring check and the record's arguments all take it from one variable.
2. **One token, checked three ways.** A table, per chain, names the token Crow's operators accept. The deploy's `--check` and the operators' start-up check each compare three values and fail if any two differ: the table, the deployment record, and `TOKEN()` read from the rules contract. Both also refuse a token address that holds no code. A local chain has no table entry and skips that one comparison. Sepolia's entry is one of the record's copies, so the copies command rewrites it.
3. **An old world refuses to start.** One test: a lane build pointed at the dated 0.7 record refuses at start, and the error names the domain. No new probe.
4. **Explorer verification.** A script mode that verifies each deployed contract from the record, with the constructor arguments the record holds. Sourcify first, with no key. Etherscan only when a key is in the environment, read by name.
5. **The record's copies, by one command.** It takes the dated old record and the new record, rewrites each old address and hash in a fixed list of files, rebuilds what is built from them, then fails if any old value remains in a tracked file outside a short list of history files.
6. **The world's name follows the record,** so a new record is a new world without a second edit.

What comes out: a script that runs on Sepolia and, for rehearsal, on a local anvil; a start-up check in `live.ts`; one new command; the cutover page naming each command exactly.

Not built, on purpose: a resume after a failed create (a failed Sepolia run is rerun whole); any change to the contracts (the token's code check lives in the script and at start-up, not in the constructor; Rafa, 2026-11-12).

## Context

- `docs/cutover-phase-one.md`, steps 2, 3 and 6, and its second-pass table.
- The refinement plan (private): section 7c.3 (Package CU-1), section 2c (the CU-1 row), section 7d (item 53).
- ADR-0031 §2 (one token per deployment, SC-1), ADR-0032 (the beacon margin), ADR-0029 §8 (the domain check at start).

## Acceptance criteria

- [x] On a local chain the script deploys the lane's contracts with the margin, writes a record, and its wiring and token checks pass.
- [x] Each check fails on a planted fault: a wrong token in the table, a token with no code, a wrong margin.
- [x] The operators' start-up refuses a record whose token differs from the chain's or from the table, and a token with no code.
- [x] A lane build pointed at the 0.7 record refuses to start and names the domain.
- [x] The verify mode builds the right `forge verify-contract` lines from a record, tested without a network.
- [x] The copies command, run on a copy of the repo's files with a made-up new record, leaves no old value behind, and fails when one pin is skipped. Today it fails on exactly two `site/llms.txt` lines the words package owes (Handoff).
- [x] The world's name changes with the record, with no second edit.
- [x] `docs/cutover-phase-one.md` names each new command exactly.
- [x] The whole routine runs twice on a local chain with no hand edit.
- [x] `forge test` and the touched packages' tests with anvil pass; CI passes on each pull request (read at each merge).

## Out of scope

- A resume after a failed `forge create`.
- Any file under `contracts/src` or `contracts/test`.
- A deploy, a transaction or a key on Sepolia; a live run.

## Evidence

All measured on 2026-11-12 on this Mac (forge, cast and anvil 1.0.0, bash 3.2.57, jq 1.7.1), unless marked.

- **The script on anvil** (`packages/settlement/evm/deploy-script.test.ts`, 14 tests, all pass): the deploy of five contracts takes about 13 s; the record has `beaconMarginSec` 29 and six rules arguments; `--check` passes. Planted faults, each refused with its own message: a record with margin 30; a table naming another token; the token's code removed; a table entry with no address; a record whose token is not `TOKEN()` (the creation-code check refuses first); every spelling of `contracts/deployments/sepolia.json` as a rehearsal record, relative and dotted included; a local chain ID behind a non-local URL.
- **The routine twice:** on a copy of the tracked files: dated copy, deploy, `record-copies`, `--check` with all three token values, twice, with no edit between. Three rules addresses, so three worlds.
- **Start-up** (`packages/settlement/evm/live.test.ts`, against a JSON-RPC stub): TOKEN() against the record; no code at the token; on Sepolia, a record and chain agreeing on a token the table does not name; Sepolia with no table entry; an entry with no address; all three agreeing in mixed case (starts); chain 1 still refused although the table has an entry. The 64be1f1 record on a chain signing under 0.7 is refused by its domain before any token read, and the error names both versions and the rules address.
- **`--verify`:** five Sourcify commands with the record's encoded arguments; ten with a key set, Sourcify all first; the key's value in no output; a stand-in forge that fails Etherscan with `?apikey=<key>` in its message has the key replaced and the script exits non-zero after all five Sourcify runs. One built command run with `--show-standard-json-input` and no network gives `viaIR: true`, 200 optimizer runs, `prague`, the record's settings. Flags checked against `forge verify-contract --help`.
- **The copies command** (`tests/record-copies.test.ts`): on a copy of all 1,247 tracked files with a made-up phase-one record, it replaces 10 pins in `site/llms.txt` and the Sepolia table entry, regenerates `examples/deployments.ts`, rebuilds `site/try.mjs`, and its sweep fails on exactly the two `site/llms.txt` lines that name the cut vault. A pin planted outside the list fails it in three other spellings (no `0x`, padded, embedded), and in `docs/quickstart.md`.
- **Mainnet USDC:** `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, from Circle's page and Etherscan's token page, both read on 2026-11-12; the checksum matches `cast to-check-sum-address`.
- **Other suites:** `pnpm typecheck`; eslint on every touched file; `apps/demo-cloud/src/worker.test.ts`, `examples/deployments.test.ts`, `apps/test-agents`, `tests/cut-feature-alignment.test.ts`, `apps/demo-cloud/src/live.test.ts`: pass. `forge test`: see the merge message of PR 425.
- **gitleaks:** it flagged the literal stand-in key in commit `e6b79fa` of PR 424 (`generic-api-key`; a made-up string, not a secret). On the coordinator's decision, PRs 424 and 425 were closed and restacked as 429 and 430 without that commit; the stand-in is built in the test from words. `git merge-base --is-ancestor e6b79fa… <head>` answers no for both. gitleaks is not installed on this Mac, so CI's job is the only scan.
- **Reviews:** one reviewer per pull request (PRs 424 and 425 below are the reviews' names; their changes are in 429 and 430). PR 422: H1 (a relative spelling of the Sepolia record passed the rehearsal guard) and L2 fixed. PR 423: M4 fixed; M3 fixed in PR 425's doc. PR 424: H1 (forge prints the key in a failed request's URL), M3, L4 to L6 fixed; M2 recorded below. PR 425: M1 (padded and unprefixed spellings) and L2 to L4 fixed; L5 is this section.
- **Not tested here:** anything on Sepolia; what Sourcify and Etherscan answer; the Workers on Cloudflare with the derived names.

## Decisions

- **The world's name is derived from the record's rules address,** in both Workers, not written into the record as a field. It cannot drift from the record, two deploys in one day still get two names, and `--check`'s re-derivation needs no new field.
- **The margin lives in the script** (`BEACON_MARGIN=29`), not the table: the table is the operators' token rule; the margin is a deploy parameter the record carries and `live.ts` checks against the chain.
- **A rehearsal uses Sepolia's values,** the margin of 29 s included, so the local run is the Sepolia routine.
- **The deploy prints a note, not a failure, when the table names the previous token:** on Sepolia that is true of every redeploy until the copies are written, so `--check` moves to step 3.2.
- **The sweep matches a value's hex body anywhere in a line;** substitution rewrites whole `0x` values only, and the rest is fixed by hand.
- **Three paths outside the brief's list,** each needed: `packages/settlement/tsconfig.json` (the table's JSON import), the type of `examples/deployments.ts` (a phase-one record has no second collector), and `WORLD_NAMES.sim` (`holdback-public-demo-sim-2026-11-12`, at T-378's request, so the line changes once).

## Handoff

**Done:** all six items, in PRs 422 (margin, rehearsal), 423 (token checks, old-world test), 429 (`--verify`) and 430 (copies command, world names, cutover doc).

**For Rafa:**

- **The Etherscan key.** Sourcify needs none. With the pinned forge 1.0.0, Etherscan verification will likely fail: the binary names only Etherscan's retired V1 endpoint [inferred by the PR 424 review; not run]. Etherscan needs a newer forge as well as `ETHERSCAN_API_KEY`.
- **Two dated records in one day collide:** `sepolia-<date>-domain-<version>.json` is the name `scripts/contract-stack.mjs` reads. A second redeploy on the same day needs a naming rule first.

**For other packages:**

- **The words package (AL-2):** `site/llms.txt` still names the cut vault on two lines; until they go, `record-copies` fails on exactly those lines.
- **CI:** the anvil job's settlement leg runs `packages/settlement/evm/deploy-script.test.ts`, which needs `jq` (preinstalled on GitHub's Ubuntu runners) and forge's compiled output.

**Not built, on purpose:** a resume after a failed create. A failed Sepolia run is rerun whole.

**For the mainnet deploy's own checklist** (T-380, 2026-11-12): ADR-0032 §3.4 describes a per-chain table of margins (29 s for chain IDs 1 and 11155111) that refuses any other chain, and gate line BR-7 asks for an L2's margin to be derived on its own. The script has one `BEACON_MARGIN=29`, which is enough today because it refuses every chain but Sepolia and a local rehearsal. A script that deploys elsewhere takes its margin from such a table.

**Checked against the lane's tip after R8** (`73bbafa`, PR 426 included): the script passes the six constructor arguments in the contract's order (escrow, collector, expiry margin, beacon, token, beacon margin), the record carries `beaconMarginSec`, and the script's, start-up and copies suites pass on that tree (45 tests) [measured]. `--verify` builds each contract's published source from forge's own source set, so a new imported file such as T-384's `IHoldbackRules.sol` is included with no change here [inferred from how `forge verify-contract` builds its standard JSON].

**Low findings left:** the three test-vector files are excluded whole rather than by value (PR 425 review, L2); the Worker reads the embedded record on each Sepolia request.
