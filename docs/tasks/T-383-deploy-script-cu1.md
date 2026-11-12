# T-383: the deploy script's remainder, the start-up check and the record's copies (package CU-1)

- **Lane:** settlement
- **Phase:** 2 (phase-one contracts, testnet-ready checklist item 8)
- **Depends on:** T-380 (R8: `BEACON_MARGIN`, merged in PR 418), T-363 (the cutover checklist), T-378 (R6c-2, the operator side)
- **Paths this task may touch:** `contracts/script/deploy-sepolia.sh`; `packages/settlement/evm/live.ts` with its tests, and one data file beside it (the accepted-token table); one new command under `scripts/` with its test; the two lines that name a world (`apps/demo-cloud/src/worker.ts`, `apps/test-agents/src/worker.ts`) and the one test line that pins the first (`apps/demo-cloud/src/worker.test.ts`); `examples/deployments.ts` only as the copies command's target; `docs/cutover-phase-one.md` where a step's command changes; this file. Nothing under `contracts/src` or `contracts/test`.
- **Human gate:** no. The task builds and tests on a local chain only. The deploy on Sepolia, and any explorer key, are Rafa's at the cutover.
- **Change kind:** 7 for the script, 5 for the start-up check; one reviewer per pull request.
- **Status:** part 1 done (PRs 422, 423, 429 and 430, into `contracts-audit-ready`); part 2 done on the merge of its pull request
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

## Part 2: the checklist's second pass and rehearsal (2026-11-12)

### Intent

The coordinator added this part on 2026-11-12, as part of checklist item 8. When Rafa says go, the redeploy and the switch-over must run as a routine with no surprise, and must repeat after the audit's fixes. So the cutover page is rehearsed end to end on a local chain, twice in a row from the lane's tip. Each step gets its exact command, its time, what it printed, and how a person could get it wrong. The page is fixed where it is unclear or out of order. Rafa gets a cutover-day sheet. Two decisions from the coordinator come with it:

- **The dated record's name carries the UTC time of its deployment,** `sepolia-<YYYY-MM-DD>T<HHMM>Z-domain-<version>.json`, made by one command, so two redeploys on one day do not collide. The existing dated files keep their names.
- **Sourcify is the pilot's verification.** The Etherscan mode stays as it is, marked "needs a key and a newer forge; not run". The pinned forge is not raised before the freeze.

Still no transaction on Sepolia, no key use, no Worker deploy.

### What changed

- **`node scripts/record-copies.mjs keep --rpc <url>`** (step 2.3). It copies `contracts/deployments/sepolia.json` to its dated name and prints the `--old` line for step 3.1. The time comes from the record's new `deployedAt`, or from the first block's time for a record without one. The domain version comes from the rules contract. It refuses another chain and a same-named file with other content; the same content again is a no-op.
- **The deploy script writes `deployedAt`:** the first creation's block time, in UTC, re-derived by `--check`.
- **`scripts/contract-stack.mjs`, its test and the copies command's history list** read both forms of dated name.
- **`docs/cutover-phase-one.md`:**
  - steps 2.1, 2.3, 3.1 to 3.4, 6 and 7, and step 0.6's gas figure;
  - the measured times;
  - the Etherscan marking;
  - scenario 12 at step 7;
  - the status line.

### Evidence

All measured on this Mac on 2026-11-12 unless marked. The harness, `reports/scratch/t383-rehearse.ts` in the rehearsal worktree, is scratch and in no pull request. It ran against one anvil (Prague, a block a second, wall-clock time), from the lane at `e4e930c`. The tip did not move between the runs.

| Step | Command (local form) | Run 1 | Run 2 | What it printed |
| --- | --- | --- | --- | --- |
| setup | the starting deployment (#0), standing in for today's live one | 8.5 s | none | run 1 only: the copy's record, table entry and `examples/deployments.ts` set to #0 |
| 2.3 | `node scripts/record-copies.mjs keep --rpc <rpc>` | 0.2 s | 0.1 s | `kept … as …sepolia-2026-11-12T1723Z-domain-0.8.json` (run 1), `…T1725Z…` (run 2), and the `--old` line |
| 2.4 | `deploy-sepolia.sh <rpc> <keystore> <password-file>` | 7.8 s | 7.5 s | the token note naming the new token and the table's old one; `wrote …` |
| 2.6 | `cast call <rules> 'eip712Domain()(…)'` | 0.0 s | 0.0 s | `"Holdback"`, `"0.8"` |
| 3.1 | `node scripts/record-copies.mjs --old <dated> --new contracts/deployments/sepolia.json` | 0.5 s | 0.5 s | `pass: 12 value(s) replaced, 0 retired`; site rebuilt |
| 3.2 | `deploy-sepolia.sh --check <rpc>` | 2.8 s | 2.1 s | `… matches the chain and the build at e4e930c…` |
| 3.3 | `deploy-sepolia.sh --verify <rpc>`, as a dry run | 2.6 s | 2.5 s | five Sourcify commands; `dry run: nothing was sent to an explorer` |
| 3.4 | `node site/check.mjs` | fails | fails | by design on a local record: it needs a Sepolia pin. `tests/record-copies.test.ts` now runs it on a Sepolia-shaped record, and it passes |
| 3.5 | three of the step's guard files (`examples/deployments.test.ts`, `tests/contract-stack.test.ts`, `apps/demo-cloud/src/worker.test.ts`) | 5.7 s | 3.0 s | 23 tests pass |
| 4 | the fork suites | not run | not run | no fork RPC is configured by name here |
| 6 | the demo world (`PublicWorld`, the Workers' code) on the new record, two origins | 3.7 s | 0.6 s | start-up checks passed; a record naming the previous token refused, naming both; discovery's domain and token are the new ones; world `holdback-public-demo-sepolia-<new rules>` |
| 6, smoke deal | `node examples/try.ts` | 5.0 s | 4.2 s | `Released` |
| 7, two addresses | `node examples/e2e-round.ts run 12 --no-homepage` | 19.0 s | 19.9 s | `results: 12 pass`, 31 of 31 checks |
| after | the earlier record and world | | | run 2: the dated copy equals run 1's record byte for byte; a `LiveChain` on the earlier record still passes its start-up check (the rollback's world) |

- **Whole runs:** 58 s and 43 s.
- **Rerun on the lane's new tip.** At `690edfd` (main merged into the lane, PR 432, with the operators' deal guard), merged into this branch as `0d38499`, both runs passed again from a fresh start: every step as above, 48 s and 42 s. A third run on `e4e930c`, after the review's fixes, also passed.
- **No hand edit** between the runs: run 2 started from run 1's files as left.
- **The five creations used 8,674,078 gas** on anvil.
- **`forge test` on the tip `e4e930c`:** 470 passed in 63 suites, which matches T-380. The 464 of part 1 was measured on a tree without PR 426, whose `ConstructorChecks.t.sol` adds 6 tests in 1 suite.
- **Tests:** `tests/record-copies.test.ts` gains five tests (four for `keep`, one for the site's check); the anvil routine test now names its dated copies with `keep`, two minutes apart on one day.
- **Found by the rehearsal, for the words session:** `examples/try.ts` ends with "final at the end of the appeal window, when the 60 s appeal window closes". Phase one has no appeal window, and the bundled one command says the same.

### What a local chain could not show

- **The real 29 s margin against drand:** the margin is deployed and checked, but no fallback or escalation round ran against real drand rounds.
- **Explorer verification over the network,** Sourcify's answer included.
- **The Workers' deploy,** wrangler, the Durable Object's restart and the rollback, and the deal guard, which reads the live nodes.
- **The faucet and gas on Sepolia,** the escalation's real gas estimate (anvil's is replaced), and the 12 s blocks.
- **The fork suites** (step 4): no fork RPC is configured here.
- **The site's deploy and the stranger's one command** (step 9), and the founder console (step 10).

### The cutover-day sheet

Open one terminal for the whole day and start it with these two lines; every command below uses them, and the round of step 15 reads `.env` from the folder it runs in:

```sh
export W=/Users/rafa/Documents/escrow/.worktrees/cutover-phase-one R=https://ethereum-sepolia-rpc.publicnode.com
cd $W
```

`W` is the cutover worktree made at step 0. `R` is Sepolia's public RPC. A keyed URL may replace it, set from the environment; but when a cast or forge call fails, its error can print the URL it called [measured by the PR 434 review], so prefer the public node, and never share a failing step's output while a keyed URL is set.

**Values Rafa supplies, by name only:**

- The deployer's keystore file and its password file: two paths on his Mac.
- `E2E_SEPOLIA_SEED`, for step 7's round. Its master address needs test ETH.
- `TIMEOUT_SENDER_KEY`, only to close a deal left on the old contracts (CU-2). Its address needs test ETH.
- The Worker secrets stay as they are: `SEPOLIA_RELAYER_KEY` and `TEST_AGENTS_SEED`. Do not run `relayer.mjs` or `seed.mjs`.
- `ETHERSCAN_API_KEY`: leave it unset for the pilot. Etherscan needs a newer forge; not run.
- A keyed Sepolia RPC URL, if he prefers one to the public node: pass it from the environment, never on a line others see.

**The commands, in order:**

1. **Step 0, baseline.** Run `git -C /Users/rafa/Documents/escrow fetch origin` and make the worktree as the page says. Then:
   - `git -C $W merge-base --is-ancestor origin/main HEAD; echo $?` prints `0`.
   - `cast balance <deployer> --ether --rpc-url $R` shows at least 0.5 ETH.
   - `npx wrangler@4 deployments status --name <each Worker> --json`, for holdback-op1, holdback-op2, crow-test-agents and crow-site. Write the four versions down: they are the rollback targets.
2. **Step 1, the quiet.** List the open deals on both nodes (the page's `curl`), and wait for each, or record it as left behind.
3. **Step 2.1, rehearse.** `pnpm -C $W exec vitest run packages/settlement/evm/deploy-script.test.ts` passes: 15 tests, 38 s on this Mac.
4. **Step 2.2.** `cast chain-id --rpc-url $R` prints `11155111`.
5. **Step 2.3.** `node $W/scripts/record-copies.mjs keep --rpc $R` prints `kept contracts/deployments/sepolia.json as contracts/deployments/sepolia-2026-11-04T0830Z-domain-0.7.json` [measured by the PR 434 review: a read-only run against the public Sepolia node, on a scratch copy of today's record], and the `--old` line with full paths. Run it before step 2.4.
6. **Step 2.4.** `$W/contracts/script/deploy-sepolia.sh $R <keystore-file> <password-file>` prints the token note, then `wrote …/contracts/deployments/sepolia.json`.
7. **Step 2.6.** `cast call <new rules> 'eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])' --rpc-url $R` reads `"Holdback"` and `"0.8"`.
8. **Step 3.1.** Run the `--old` line step 2.3 printed: `node $W/scripts/record-copies.mjs --root $W --old contracts/deployments/sepolia-2026-11-04T0830Z-domain-0.7.json --new contracts/deployments/sepolia.json`. It prints `record-copies: pass: …`. Until T-385 removes them, it fails on exactly two `site/llms.txt` lines that name the cut vault.
9. **Step 3.2.** `$W/contracts/script/deploy-sepolia.sh --check $R` prints `… matches the chain and the build at <frozen commit>`.
10. **Step 3.3.** `$W/contracts/script/deploy-sepolia.sh --verify $R`, with `ETHERSCAN_API_KEY` unset, prints `the five contracts are verified on Sourcify (Etherscan needs a key and a newer forge; not run)`.
11. **Step 3.4 to 3.8.** `node $W/site/check.mjs`; the page's guards; one commit; the pull request into `main`; Rafa's gitleaks lines; `pnpm -C $W verify`.
12. **Step 4.** The two fork suites, each with `SEPOLIA_FORK_RPC` set, run one at a time; a skip is a failure.
    - `apps/demo-cloud/src/live-fork.test.ts` shows one deal through the public world against the new contracts, on a fork.
    - `apps/adjudicator/src/drand-fork.test.ts` shows an escalation and its decision from live drand rounds, both accepted by the new rules contract. It is the one check of the beacon and the 29 s margin against real rounds before the operators deploy.
13. **Step 5.** The quiet again, within one minute of step 6.
14. **Step 6.** Run `pnpm -C $W demo-cloud:deploy`. Before any upload it prints the deal guard's line: `Deal guard: <n> open deals at the demo adjudicators checked against the new build's kept-policies.json; none would lose its judge.`
    - `<n>` must equal the deals recorded as left behind in step 1.5, normally 0. The guard checks policies, not worlds, so its pass is not the quiet's proof.
    - **A `Refused:` with exit code 2** means an open old-world deal binds a policy the new build dropped. Nothing was uploaded. Do not set `HOLDBACK_DEPLOY_WITHDRAWN`; go back to step 1 for that deal.
    - **A `WARNING:` that the deals could not be read** means the guard checked the policy files only. Read the deals by hand (step 1.3) before going on.
    - The deploy then waits for both nodes to serve the new commit (about five minutes on 2026-11-12) and ends `pass` with a smoke deal `Released`.
    - Read `/v1/status` and `/.well-known/holdback.json` on both nodes: the new rules address and the new token.
15. **Step 7.** `node --env-file-if-exists=.env $W/examples/e2e-round.ts run 5b --t220 --no-homepage`, then `… run 12 --no-homepage`. Each prints `results: … pass`.
16. **Step 8.** `node $W/apps/test-agents/scripts/deploy.mjs`; then the two `site/try.mjs --seller` deals and `sell-to-test-buyer.mjs`.
17. **Step 11.1, part of point of no return 2.** Merge the step-3 pull request into `main` (a revert only from here). The site deploys from `main`, because the lane's agent docs describe the phase-one deployment.
18. **Step 9, point of no return 1.** Run `git -C $W fetch origin && git -C $W switch --detach origin/main`. Then `pnpm -C $W site:deploy` ends `pass`. Then run the one command from `https://crow.direct/llms.txt` in an empty folder: it ends `Released`.
19. **Step 10.** The founder console.
20. **The rest of step 11.** `$W/contracts/script/deploy-sepolia.sh --check $R` from `main`, the tag (the rest of point of no return 2), `docs/audit/scope.md`, and the rehearsal cases.

**Rollback at each point:**

- **Steps 0 to 5:** nothing live has changed. To abandon after step 2, restore `sepolia.json` with `git checkout` and delete the dated copy; the cost is test ETH.
- **Steps 6 to 8:** run `npx wrangler@4 rollback <version from step 0> --name holdback-op1`, the same for `holdback-op2` and, after step 8, `crow-test-agents`. Always roll back both operators together. The old world then serves again.
- **After step 9:** fix forward. Strangers' deals on the new world would lose their operators.
- **After step 11:** a revert on `main` only; a pushed tag stays.

### Handoff for part 2

**Done:** two rehearsals, the `keep` command, the page's fixes and this sheet, in one pull request into the lane.

**Before the day, Rafa decides:**

- **When to run it.** R11's reviews come first, and the rehearsal is rerun at the frozen commit with step 2.1's command.
- **The deployer.** Reuse the deployer of the live record, `0x1A4435488eaF1A37d2327d44Fe67e97d83203B64`, or a new throwaway key. It needs at least 0.5 Sepolia ETH.

**For other sessions:**

- **T-385:** remove the two `site/llms.txt` lines that name the cut vault.
- **The words session:** `examples/try.ts`'s line about a 60 s appeal window.

**A follow-up worth having:** promote `reports/scratch/t383-rehearse.ts` to a committed rehearsal command, so each loop of the audit reruns the whole page with one line. It is a separate change and needs its own review.
