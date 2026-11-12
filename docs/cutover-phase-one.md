# The phase-one cutover: checklist

**Status: first pass, not rehearsed.** Written on 2026-11-12 against `contracts-audit-ready` at `02ddb24` (T-363). No command on this page has run. A second pass follows the remaining contract fixes (package R8), and a rehearsal on a local chain follows the whole-diff reviews (R11). Do not run this page before both.

This page moves the live test service from the contracts deployed on 2026-11-04 to the phase-one contracts. It covers the contracts, two operators, the test seller and buyer, the site with its pinned client, and the founder console. The cutover of 2026-11-04 in [`operations.md`](operations.md) is its model.

## Rules for the whole run

1. **Sepolia only.** Every chain step runs on Ethereum Sepolia, chain ID 11155111. Before any step that names an RPC, run `cast chain-id --rpc-url <rpc-url>`. If it prints anything else, stop. This page does not apply to another chain, and no line of it may be adapted to a mainnet chain ID. A mainnet deploy needs an audit, Rafa's written approval and its own checklist ([`operations.md`](operations.md), Gates). The deploy script refuses any other chain, except a rehearsal on a local anvil behind a `http://127.0.0.1` RPC that never writes the Sepolia record, and so does the operators' chain client (`packages/settlement/evm/live.ts`) [measured by reading].
2. **Rafa runs each step, or a session runs it on his word for that step.** One go-ahead covers one step. The contract deploy needs the deployer's keystore, which sits on Rafa's Mac.
3. **Secrets go by name.** Nobody reads, prints or copies `.env*`, the keystore, its password file, `SEPOLIA_RELAYER_KEY` or `TEST_AGENTS_SEED`. A keyed RPC URL is a secret too: pass it from the environment.
4. **One build, one set of contracts.** The lane's build cannot settle on the old contracts, and the live operators cannot settle on the new ones (T-346 and T-349, Handoff). The order below keeps each build on its own contracts at every moment.
5. **Write each result down as you go,** in `/Users/rafa/Documents/escrow/reports/cutover-phase-one/`. The freeze copies the record into [`operations.md`](operations.md).
6. **Labels.** Each claim is marked measured, documented, inferred or guessed. "Measured" here means measured by reading the code at `02ddb24`, unless a past run is named.
7. **"Second pass"** marks a line that depends on work not yet on the lane. The table at the end lists them all.

## The order at a glance

| # | Step | Plan's step | Who | Stopping here | Rollback |
| --- | --- | --- | --- | --- | --- |
| 0 | Freeze the inputs and take the baseline | added | Rafa, a session for the reads | Safe | Nothing to undo |
| 1 | Start the quiet on the old world | 1 | Rafa | Safe | Nothing to undo |
| 2 | Deploy the contracts, then `--check` | 3 | Rafa | Safe | Discard the record; the contracts stay unused |
| 3 | The record and every pin, in one commit | 4, 5 | A session, Rafa for the gitleaks entries | Safe | Close the pull request |
| 4 | The fork suites against the new record | 7 | A session | Safe | Nothing to undo |
| 5 | Check the quiet again | 1 | A session | Safe | Nothing to undo |
| 6 | The operators and the new world; one smoke deal | 5, 6 | Rafa | Safe only until an outside deal opens on the new world | `wrangler rollback`, both operators |
| 7 | One escalation's gas on Sepolia | 2 | Rafa | As step 6 | As step 6 |
| 8 | The test agents, one deal each way | 8 | Rafa | As step 6 | The agents with the operators |
| 9 | The site and its one command | 8 | Rafa | **Point of no return 1** | The site with the operators |
| 10 | The founder console | 8 | Rafa | Safe | Its own, kept privately |
| 11 | The freeze: merge, tag, audit scope, rehearsal cases | 9 | Rafa | **Point of no return 2** | A revert only |

**Where this order differs from the plan,** and why:

- **The fork suites (plan step 7) run before the operators (plan step 6).** They need only the new record and a read-only RPC. They are the one proof that this build settles on the new contracts before a live component changes.
- **The escalation's gas (plan step 2) is measured after the smoke deal.** The plan asks for it before anything deploys. No tool on the lane can do that: the local world runs on SimChain only (`apps/demo-cloud/scripts/dev.mjs:5-6`), and every anvil world replaces the estimate [measured]. Step 7 says what a pre-deploy measurement would need.
- **The quiet (plan step 1) is checked twice.** It starts first, because waiting for deadlines takes longest. The contract deploy, the record and the fork suites do not touch the old world, so it serves until step 5 [inferred].
- **The new world (plan step 5) has no step of its own.** Its name changes in step 3's commit, and the world is created by the first request after step 6.

## Step 0. Freeze the inputs and take the baseline

**Who:** Rafa decides; a session may run the reads.

1. **The lane is frozen.** Every gate of the refinement plan has passed, `main` is merged into `contracts-audit-ready`, and the lane's tip is the commit to audit. Call it the frozen commit. **Second pass:** the gates wait for R7 to R11.
2. **`main` takes no merge until step 11.** Every deploy script refuses, with exit code 2, a checkout that lacks `origin/main`'s commits after a fresh fetch (`scripts/deploy-lib.mjs:100`) [measured]. If `main` moves mid-run, merge it into the cutover branch and repeat step 3's checks before the next deploy.
3. **Make the cutover worktree** at the frozen commit:

   ```sh
   git -C /Users/rafa/Documents/escrow fetch origin
   git -C /Users/rafa/Documents/escrow worktree add /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one -b cutover-phase-one origin/contracts-audit-ready
   git -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one submodule update --init --recursive
   pnpm -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one install --frozen-lockfile
   ```

   Every command below runs against this worktree. The submodule line is needed for `forge` [inferred: a new worktree has empty submodule folders].
4. **It holds `main`.** `git -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one merge-base --is-ancestor origin/main HEAD; echo $?` prints 0.
5. **The tools answer:** `forge --version`, `cast --version`, `jq --version`, `node --version` (22), `npx wrangler@4 whoami` (Rafa's Cloudflare login).
6. **The deployer has test ETH.** The deployment of 2026-11-03 used 75,443,236 gas for the larger, old set of contracts [measured, `docs/tasks/T-206-contract-review.md:126`]. At 20 gwei that is 1.51 Sepolia ETH; phase one deploys fewer contracts, so it needs less [inferred]. Read the balance: `cast balance <deployer-address> --ether --rpc-url https://ethereum-sepolia-rpc.publicnode.com`. The deployer of the live record is `0x1A4435488eaF1A37d2327d44Fe67e97d83203B64`; reusing it is Rafa's call.
7. **The relayer's funding lane has test ETH:** `cast balance 0x601137a8DE7E195E1426f57C053aFa49B20Ef555 --ether --rpc-url https://ethereum-sepolia-rpc.publicnode.com`. The new world uses the same relayer key and the same four lanes, and tops each deal lane up by 0.03 ETH when it falls below 0.01 ETH (`apps/demo-cloud/src/world.ts:210-211`) [measured]. Do not run `apps/demo-cloud/scripts/relayer.mjs` or `apps/test-agents/scripts/seed.mjs`: both secrets stay as they are.
8. **Write down each Worker's live version,** the rollback target for the whole run:

   ```sh
   npx wrangler@4 deployments status --name holdback-op1 --json
   npx wrangler@4 deployments status --name holdback-op2 --json
   npx wrangler@4 deployments status --name crow-test-agents --json
   npx wrangler@4 deployments status --name crow-site --json
   ```

   The deploy scripts read these themselves, but each later deploy replaces them, and step 9's rollback needs the versions from before step 6.
9. **Save the baseline reads** of both nodes (`https://api.crow.direct` and `https://api2.crow.direct`): `/v1/status`, `/.well-known/holdback.json`, `/v1/clubs/demo-club`, `/v1/adjudicators`.
10. **The rehearsal passed** on a local chain, and its corrections are in this page. **Second pass.**

**It must show:** all ten lines true, and Rafa's go-ahead recorded with its date.
**Time:** not measured. **Rollback:** none. **Stopping here is safe.**

## Step 1. Start the quiet on the old world (plan step 1)

**Who:** Rafa, for the word to other people; a session for the reads.

**What the code says** [measured]:

- **The test seller and buyer open no deal on their own.** A deal starts when an outside party posts to one of them; their alarm only advances deals already open (`apps/test-agents/src/worker.ts:98-110`). So they need no pause, and they cannot be paused: neither they nor the operators have a pause or drain switch.
- **Deals come from outside:** anyone who runs the site's one command, an outside seller that offers to the test buyer, the pilot partner's rehearsals, and Crow's own sessions.
- **The old operators close deals themselves.** They send each due timeout one minute after its deadline, at most 4 a pass and 200 a UTC day [documented, [`operations.md`](operations.md), T-231].
- **On the old contracts a decided deal is final only when its appeal window has closed** and that window's timeout has run. That timeout is not in phase one; the old world still needs it.

**Do:**

1. **Stop Crow's own deals.** Tell every session to run no live deal until step 9 passes: no `examples/e2e-round.ts run`, no `pnpm audit-deal --live`, no `node site/try.mjs`, no `sell-to-test-buyer.mjs`.
2. **Tell the people Rafa has given the test service to,** the pilot partner first, when the service changes and that addresses, the token and the one command change with it. This is Rafa's message to send.
3. **List the deals that are not final,** on both nodes:

   ```sh
   curl -s "https://api.crow.direct/v1/commitments?limit=200" | jq -r '.nextCursor, (.items[] | select(.finalAt == null) | [.commitmentId, .escrowState, .appealState, (.deadlines | tostring)] | @tsv)'
   ```

   The first line printed is `nextCursor`. While it is not `null`, repeat with `&cursor=<nextCursor>` added; 200 is the largest page (`apps/operator/src/server.ts:66`). Repeat the whole read on `https://api2.crow.direct`. [Inferred from `apps/operator/src/server.ts:1271-1294` and the state view; not run.]
4. **For each deal listed, wait for its last deadline.** The operators then close it. Anyone may also send the timeout: `POST /v1/commitments/<id>/triggers/<kind>` with `{}`.
5. **A deal whose deadlines lie after the planned cutover** (any date is allowed, D31) has three ways out. Pick one for each and write it down:
   - wait for it;
   - its two parties close it by a settlement both sign. For a deal the Sepolia round's own keys opened: `node --env-file-if-exists=.env /Users/rafa/Documents/escrow/examples/e2e-round.ts settle <commitmentId>`, from the main checkout;
   - leave it on the old contracts and record its ID, state and deadlines. Its funds stay in the old escrow, and every timeout there stays permissionless. No Crow operator serves it after step 6, and no tool on the lane sends its timeouts (gap 2 of T-363). Only a rollback of both operators serves it again.
6. **Check for a deal left on the first deployment** (EIP-712 domain 0.6, `contracts/deployments/sepolia-2026-11-03-domain-0.6.json`). No operator has served it since 2026-11-04, so no API read lists it [inferred]. Record what Rafa knows of it.

**It must show:** the list of step 1.3 is empty on both nodes, or every deal on it has a line saying which way out it takes.
**Time:** bounded by the latest deadline among open deals. A default deal from the one command reaches `Released` in 43 to 48 s [measured, the smoke deals in [`operations.md`](operations.md)].
**Rollback:** none; nothing changed. **Stopping here is safe.**

## Step 2. Deploy the contracts, then check them (plan step 3)

**Who:** Rafa. The keystore and its password file are his.

**What the code says** [measured]:

- **The lane's script deploys the phase-one shape:** five `forge create` calls for the escrow, its one collector, the beacon, a new test token and the rules contract. It creates no vault. The rules constructor takes the escrow, the collector, the expiry margin of 86,400 s, the beacon, the token and the beacon margin of 29 s (ADR-0032). The script names the margin once, as `BEACON_MARGIN`, and the create line, the creation-code check, the wiring check and the record's `beaconMarginSec` and `args` all take it from there (T-383).
- **It writes over `contracts/deployments/sepolia.json`**, and records `HEAD` as the deployed commit.
- **It checks only the build inputs for changes** (`src`, `lib`, `foundry.toml`, `remappings.txt`, `script/TestUSDC.sol`). A new file under `contracts/deployments/` does not stop it.
- **It does not resume, on purpose.** If one `forge create` fails, it exits, writes nothing, and leaves the contracts already created on Sepolia, unused. Rerun the whole step; the next run creates a full new set [inferred].
- **Each deployment creates a new test token.** Every balance starts at zero in the new world, and the faucet mints the new token.
- **The token is checked three ways** (T-383): the accepted-token table (`packages/settlement/evm/accepted-tokens.json`), the record, and `TOKEN()` on chain, and the token must hold code. Right after the deploy the table still names the old token, so the deploy prints a note that says so instead of failing, and the full `--check` waits for step 3, after the record's copies are written.
- **A rehearsal on this Mac** runs the same script against a local anvil (chain 31337, a `http://127.0.0.1` RPC), with `DEPLOY_RECORD` naming a scratch record; it can never write `contracts/deployments/sepolia.json`. `packages/settlement/evm/deploy-script.test.ts` runs the whole routine twice that way [measured, T-383].

**Do:**

1. **Rehearse on a fork** [documented for the old script, [`operations.md`](operations.md); not re-checked for the lane's]: start `anvil --fork-url <sepolia-rpc-url> --fork-block-number <a recent block> --hardfork prague`, run the deploy line of step 2.4 against `http://127.0.0.1:8545` from a scratch worktree, and discard that worktree's record.
2. **Confirm the chain:** `cast chain-id --rpc-url <sepolia-rpc-url>` prints `11155111`. Anything else: stop (rule 1).
3. **Copy the old record** before the script writes over it. The name's date and domain are read by `scripts/contract-stack.mjs:106`:

   ```sh
   cp /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/contracts/deployments/sepolia.json /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/contracts/deployments/sepolia-2026-11-04-domain-0.7.json
   ```

   Do not commit yet: the deploy must record the frozen commit as `HEAD`.
4. **Deploy:**

   ```sh
   /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/contracts/script/deploy-sepolia.sh <sepolia-rpc-url> <keystore-file> <password-file>
   ```

5. **Read the deploy's token note.** Among its last lines the deploy prints `deploy-sepolia: this deployment created the token <new token>; the table names <old token> for chain 11155111 …`. Write both addresses down. The read-only `--check` runs at step 3.2, once the table names the new token.
6. **Read the domain the rules contract signs under:** `cast call <rules-address> 'eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])' --rpc-url https://ethereum-sepolia-rpc.publicnode.com`. It must read "Holdback" 0.8; the old contracts read 0.7.
7. **Explorer verification** moves to step 3.3: the `--verify` mode runs `--check` first, and that check waits for the table.

**It must show:** step 2.4 ends with `wrote …/contracts/deployments/sepolia.json`, with the token note of step 2.5 above it; the record's `commit` equals `git -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one rev-parse HEAD`.
**Time:** not measured. Five transactions and the checks; a few minutes [guessed].
**Rollback:** nothing on chain can be undone, and nothing needs to be: no live component reads the new contracts. To abandon, run `git -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one checkout -- contracts/deployments/sepolia.json` and delete the copy of step 2.3. The cost is the deployer's test ETH. **Stopping here is safe.**

## Step 3. The record and every pin, in one commit (plan steps 4 and 5)

**Who:** a session on Rafa's word; Rafa for the gitleaks entries and the merge decision.

**Why one commit:** a world refuses to open against another rules address (`apps/demo-cloud/src/world.ts:507`), and a new world stores its rules address before it checks the chain (`:503`, `:915`) [measured]. A build with the new name and the old record would create the new world on the old contracts, and that name could not be used again [inferred]. So the record, the world's name and every copy move together. Since T-383 the world's name is the record's rules address in both Workers, so the name cannot lag the record.

**The files.** The copies command of step 3.1 (`scripts/record-copies.mjs`, T-383) writes the first six rows; the rest stay by hand:

| File | What changes | Guarded by |
| --- | --- | --- |
| `contracts/deployments/sepolia.json` | Written by step 2 | `deploy-sepolia.sh --check` |
| `contracts/deployments/sepolia-2026-11-04-domain-0.7.json` | The old record, copied in step 2.3 | `tests/contract-stack.test.ts` ("every kept earlier deployment") |
| `examples/deployments.ts` | The command writes the new record as the `SEPOLIA` constant, whole, with its comment. The type no longer requires the second collector, which is not in phase one | `examples/deployments.test.ts` |
| `site/llms.txt`, `examples/verify.ts`, `tools/contract-stack/plain.json` | The command replaces each old address and hash with the new one, in the letter case it was written in | `node site/check.mjs` compares both blocks with `examples/verify.ts` |
| `packages/settlement/evm/accepted-tokens.json` | The command replaces Sepolia's token with the new one | `deploy-sepolia.sh --check`, and the operators' start-up |
| `site/try.mjs`, `site/index.html` | The command runs `node site/build.mjs`. The bundle's SHA-256 changes, so the one command changes | `examples/try.test.ts`, `site/check.mjs` |
| `apps/demo-cloud/src/worker.ts`, `apps/test-agents/src/worker.ts` | No edit: each Worker names its Sepolia world by the record's rules address. `WORLD_NAMES.sim` is R6c-2's, because schema v0.11 changes what a stored SimChain journal replays ([`operations.md`](operations.md), "A world changes in place") | `apps/demo-cloud/src/worker.test.ts` |
| `scripts/contract-stack.mjs:55-65`, `tests/contract-stack.test.ts:33`, `tools/contract-stack/plain.json` | The address lists and the plain-words file drop the vault and the second collector, which are not in phase one | `tests/contract-stack.test.ts` |
| `tests/cut-feature-alignment.known.json` | Shrinks by the files this commit fixed: `pnpm -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one exec vitest run tests/cut-feature-alignment.test.ts -u`, then read its diff: only removals | the test itself |
| `.gitleaksignore` | **Rafa's file.** gitleaks flagged the record and its copies at both earlier deployments (`:34-36`, `:49-55`). Each entry names the commit, so it can only be written after the commit exists | the `gitleaks` CI job |
| `contracts/README.md:84-85`, [`operations.md`](operations.md), `docs/audit/scope.md` | The words package and step 11 own these | none |

**Second pass:** the domain version in `examples/verify.ts:13,40`, `packages/core/src/eip712.ts:49,55` and the schema version arrive with T-358, on the lane, before the freeze. They are not part of this commit. The same holds for the two test rulebooks that still allow any payee (`packages/settlement/evm/testing.ts:71`, `packages/testkit/src/stub-terms.ts:26`); the demo club's own rulebook already pays the two parties only (`packages/settlement/sim/actors.ts:74`) [measured].

**Do:**

1. **Write the record's copies, by one command.** It substitutes, rebuilds the site, then sweeps: it fails, naming each `file:line`, if any old address or hash remains in a tracked file outside the dated records, `docs/`, the recorded fixtures under `tests/metrics/fixtures/` and three fixed test vectors (`examples/e2e-run.test.ts`, `examples/e2e-adjudicator.test.ts`, `examples/send-timeout.test.ts`). The list and the reason for each are at the top of the script.

   ```sh
   node /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/scripts/record-copies.mjs --old contracts/deployments/sepolia-2026-11-04-domain-0.7.json --new contracts/deployments/sepolia.json
   ```

   It must end with `record-copies: pass: …`. On the lane at the time of writing it fails on exactly two lines of `site/llms.txt` that name the cut vault [measured, `tests/record-copies.test.ts`]; the words package removes them before the freeze. Any other line it names is a pin to fix by hand, then rerun the command.
2. **Check the deployment, read-only,** now with all three token values:

   ```sh
   /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/contracts/script/deploy-sepolia.sh --check https://ethereum-sepolia-rpc.publicnode.com
   ```

   It must print `deploy-sepolia: …/contracts/deployments/sepolia.json matches the chain and the build at <the frozen commit>`.
3. **Verify the source on the explorers.** It runs the same check, then `forge verify-contract` for the five contracts with the record's constructor arguments: Sourcify, with no key; Etherscan too when `ETHERSCAN_API_KEY` is in the environment, which forge reads by that name. A contract already verified is skipped, so a rerun is safe. Whether to get an Etherscan key is Rafa's decision.

   ```sh
   /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/contracts/script/deploy-sepolia.sh --verify https://ethereum-sepolia-rpc.publicnode.com
   ```

   It must end with `the five contracts are verified on Sourcify` (and Etherscan, with a key). What Sourcify and Etherscan answer on Sepolia has not been tried [T-383 tested the commands it builds on a local chain only].
4. Check the site:

   ```sh
   node /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/site/check.mjs
   ```

5. Run the guards:

   ```sh
   pnpm -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one exec vitest run examples/deployments.test.ts examples/try.test.ts tests/contract-stack.test.ts tests/site-deploy.test.ts tests/cut-feature-alignment.test.ts apps/demo-cloud/src/worker.test.ts
   pnpm -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/apps/demo-cloud build
   ```

6. Commit once, push the branch, and open one pull request from `cutover-phase-one` into `main`. Do not merge it. A pull request into `main` runs every CI job, CodeQL included [inferred: pull requests into the lane run no CodeQL].
7. Rafa adds the gitleaks entries for the new commit to `.gitleaksignore`.
8. Run the full check once: `pnpm -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one verify`.

**It must show:** the copies command ends `pass`; the tracked tree is clean after the commit; `site/check.mjs` passes; every CI job on the pull request passes, gitleaks included; `--check` of step 3.2 still passes from this commit.
**Time:** CI takes minutes [documented, the team's batching rule]; not measured for this change.
**Rollback:** close the pull request. **Stopping here is safe:** the old world still serves, and nothing live has changed.

## Step 4. The fork suites against the new record (plan step 7)

**Who:** a session. The suites fork Sepolia into a local anvil and send nothing to the real chain [documented in each file's header].

```sh
SEPOLIA_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com pnpm -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one exec vitest run apps/demo-cloud/src/live-fork.test.ts --silent=false
SEPOLIA_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com pnpm -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one exec vitest run apps/adjudicator/src/drand-fork.test.ts --silent=false
SEPOLIA_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com pnpm -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one exec vitest run apps/demo-cloud/src/predeploy-fork.test.ts --silent=false
```

Run them one at a time. If publicnode makes anvil exit, use `https://sepolia.gateway.tenderly.co` [documented, [`operations.md`](operations.md)].

**Second pass:** the code-alignment package rewrites all three for the phase-one record. The drand suite still files a party appeal, which is not in phase one (T-349, Handoff). `predeploy-fork.test.ts` was written for an upgrade in place; whether it applies to a new world is open (gap 14 of T-363). These suites cannot pass before step 3: they read the record.

**It must show:** each suite runs, not skips, and passes. A skipped suite is a failure here.
**Time:** about 10 minutes for the pre-deploy suite [documented, [`operations.md`](operations.md)]; the others not measured.
**Rollback:** none. **Stopping here is safe.** A failure here means the build cannot settle on the new contracts: fix it on the branch and repeat from step 3.2. If the fix touches `contracts/src`, the deployment is void: go back to step 0 with a new frozen commit.

## Step 5. Check the quiet again (plan step 1)

**Who:** a session, immediately before step 6.

1. Repeat the list of step 1.3 on both nodes. It must be empty, or hold only deals recorded as left behind in step 1.5.
2. Read `head.eventSeq` from `https://api.crow.direct/v1/status` and `https://api2.crow.direct/v1/status` twice, 30 s apart. It must not move [documented, the check before T-220's deploy].
3. Read the agents: `curl -s https://crow.direct/agents/test-seller/health` and `curl -s https://crow.direct/agents/test-buyer/health`. Each must say `"open": 0`. The agents' storage is new with each record (T-383: its name is the record's rules address), so a deal one of them still holds stays in the old storage, which a rollback serves again.

**It must show:** all three lines true within the same minute.
**The race that remains:** a stranger can open a deal between this check and step 6, because nothing can refuse new deals (gap 1 of T-363). Step 6.5 looks for it.
**Rollback:** none. **Stopping here is safe.**

## Step 6. The operators and the new world; one smoke deal (plan steps 5 and 6)

**Who:** Rafa.

**What the code says** [measured]:

- **`pnpm demo-cloud:deploy` deploys both operators together** and checks itself: pre-flight, build, each Worker's live version, `holdback-op1` then `holdback-op2`, `/v1/status` 200 on both within 300 s, then one `examples/try.ts` deal that must end `Released` within 180 s. On a failure after an upload it rolls both back and exits 1 (`apps/demo-cloud/scripts/deploy.mjs`).
- **The first request creates the new world** under its new name. It draws a new secret, so the three demo adjudicators and the demo club get new addresses, and the club gets a new `rulebookHash` (`world.ts:503-532`).
- **The new world's setup checks the chain and tops up the deal lanes, and nothing else.** It registers no bond and deposits none (`world.ts:912-925`, `:543`).
- **The old world's storage stays.** Never delete it: a rollback of both Workers serves it again [documented, [`operations.md`](operations.md)].
- **The start-up check refuses the old contracts.** It compares the chain ID, the code, the domain, the expiry margin and the beacon margin, then the token three ways (the table, the record, `TOKEN()`) and the token's code (`LiveChain.verify` in `packages/settlement/evm/live.ts`). The old contracts sign under domain 0.7, so the domain check refuses them before any token read, and the error names both versions; `packages/settlement/evm/live.test.ts` shows it on the 64be1f1 record [measured, T-383].

**Do:**

1. Rafa's go-ahead for this step, recorded.
2. Deploy:

   ```sh
   pnpm -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one demo-cloud:deploy
   ```

   In a second terminal, watch the first requests: `npx wrangler@4 tail holdback-op1 --format json`.
3. Save the record line it prints.
4. Read both nodes and compare with the baseline of step 0.9:
   - `/v1/status`: `settlement.chainId` is `"11155111"`; `domain.verifyingContract` is the new rules address. **Second pass:** `schemaVersion` reads 0.11 and the domain's version 0.8.
   - `/.well-known/holdback.json`: the token is the new token's address; the adjudicators' addresses are new.
   - `/v1/clubs/demo-club`: a new `rulebookHash`; settlement payouts go to the two parties only. **Second pass:** the club's minimum appeal window against the window of 0 that phase one requires (T-358 settles it).
   - `/v1/adjudicators`: three demo adjudicators, each with `observed.bond` reading `none`.
5. **Look for a deal the race of step 5 let through:** the old world cannot be read through the API any more. Compare the old rules contract's latest events on the explorer with the list saved in step 5. Record any new deal as left behind (step 1.5).
6. **Expect one kind of error line** in the tail: the old world's last alarm tries to open under the new build and is refused with "this world settles on the rules contract …" (`world.ts:507`). The runtime retries a few times and stops [inferred]. Any other error: read it before going on.

**It must show:** the script exits 0; its line says `pass` and names a smoke deal `Released`; the four reads match.
**Time:** past runs of this script ended their smoke deal in 43 to 48 s; the world's Durable Object took up to 75 s to restart; one whole run took 114 s [measured, [`operations.md`](operations.md)].
**Rollback:** the script rolls back by itself on a failed check. By hand, both operators together, with the versions from step 0.8:

```sh
npx wrangler@4 rollback <holdback-op1 version from step 0.8> --name holdback-op1
npx wrangler@4 rollback <holdback-op2 version from step 0.8> --name holdback-op2
```

The old world then serves again, with its deals as they were.

**Stopping here is safe only while no outside party has opened a deal on the new world.** The API is public from the moment this step passes. After a rollback, a deal opened on the new world is served by no operator until the operators return to it; its funds stay in the new escrow and its timeouts stay permissionless. From here on, prefer a fix forward.

**The window that opens here:** until step 9, the site's published one command fails, because its bundle pins the old contracts. Until step 8, the live test agents refuse to sign, for the same reason [inferred from `apps/test-agents/src/worker.ts:56-58` and `examples/verify.ts:54-61`]. On 2026-11-03 the same window lasted a few minutes [documented]. Run steps 7 to 9 without a pause.

## Step 7. One escalation's gas on Sepolia (plan step 2)

**Who:** Rafa; this is a live run.

**Why:** in phase one an escalation's decision costs less to run than its calldata floor. anvil cannot estimate such a call, so every local world replaces the estimate (`examples/e2e-world.ts:89-98`). Only a relay on Sepolia tests the operators' real estimate (T-349, Handoff).

**Do:** run the Sepolia round's scenario in which the primary escalates and the appeal adjudicator decides:

```sh
node --env-file-if-exists=.env /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/examples/e2e-round.ts run 5b --t220 --no-homepage
```

It needs `E2E_SEPOLIA_SEED` in the environment and writes its evidence under `reports/e2e-round-1/`.

**Second pass:** the code-alignment package rewrites the round's scenarios for the phase-one world; the scenario's name and flags may change. A measurement before the deploy, as the plan orders it, needs a tool that does not exist: a local world that can settle on Sepolia, or a simulation of the whole deal on a Sepolia RPC (gap 3 of T-363).

**It must show:** the escalation's decision is mined, relayed by an operator; the record names its gas and its Etherscan link; the deal ends as the scenario expects.
**If the estimate fails:** an escalated deal cannot be decided through the operators and ends by its default, a refund to the buyer. That is a bounded loss, and it is a broken promise of the service. Fix forward before step 8, or roll back as in step 6.
**Also record** the gas of the smoke deal's three transactions. The operators' gas quote (`OPERATOR_FEE_GAS`, 4.70 tUSDC) was measured on the old contracts, and nobody owns re-measuring it (gap 10 of T-363).
**Time:** not measured for the phase-one scenario. **Stopping here:** as step 6.

## Step 8. The test agents, one deal each way (plan step 8)

**Who:** Rafa. The seller goes live before the site that names it [documented].

1. Deploy. The script waits up to 120 s for the seller's health to read `operational`, and rolls back otherwise:

   ```sh
   node /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/apps/test-agents/scripts/deploy.mjs
   ```

2. `curl -s https://crow.direct/agents/test-buyer/health` reads `"status": "operational"`.
3. **Buy from the test seller,** with the new bundle from the worktree, since the live site still serves the old one [the command form is documented in [`operations.md`](operations.md), the test seller's first deploy]:

   ```sh
   node /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/site/try.mjs --seller https://crow.direct/agents/test-seller
   node /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/site/try.mjs --seller https://crow.direct/agents/test-seller --outcome refund
   ```

4. **Sell to the test buyer:**

   ```sh
   node /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one/apps/test-agents/scripts/sell-to-test-buyer.mjs
   ```

**What to expect** [measured]: both agents keep their addresses, which derive from `TEST_AGENTS_SEED`. Neither has a mandate or a balance in the new world. Each takes both from the faucet on its first deal (`apps/test-agents/src/seller.ts:465-482`).

**It must show:** the script's line says `pass`; the first deal of step 8.3 ends `Released` and the second `Refunded`; step 8.4 ends `released`. Save each deal's ID and transactions.
**Time:** the health wait is at most 120 s [measured by reading]; the deals not measured on the new world.
**Rollback:** `npx wrangler@4 rollback <crow-test-agents version from step 0.8> --name crow-test-agents`, and only together with the operators [documented, the pairing rule of T-312]. **Stopping here:** as step 6.

## Step 9. The site and its one command (plan step 8)

**Who:** Rafa.

1. Deploy. The script builds into `reports/site-out`, runs `site/check.mjs`, uploads, and for up to 120 s checks the live page, `llms.txt` and the SHA-256 of `try.mjs`; it rolls back on a failed check:

   ```sh
   pnpm -C /Users/rafa/Documents/escrow/.worktrees/cutover-phase-one site:deploy
   ```

2. **Run the one command as a stranger would:** copy it from the section "Try it" of `https://crow.direct/llms.txt` into an empty folder and run it. It must end `Released`.
3. Read `https://crow.direct/llms.txt`: the pinned domain and deployment are the new ones.

**It must show:** the script's line says `pass`; the stranger's deal ends `Released` with its Etherscan links.
**Time:** the live check is at most 120 s [measured by reading].
**Rollback:** `npx wrangler@4 rollback <crow-site version from step 0.8> --name crow-site`, and only together with the operators and the test agents: the old command works only against the old world.

**Point of no return 1.** This step publishes the new one command and the new pins. From here strangers and the pilot partner open deals on the new world, and a rollback would leave each such deal without an operator. Anyone who kept the old command must fetch the new one. After this step, fix forward.

## Step 10. The founder console (plan step 8)

**Who:** Rafa. The console's code, pins and deploy commands are kept privately ([`private-materials.md`](private-materials.md)).

It must show the new rules address, the new token and the new world's start block, which is the record's `fromBlock`. The words package owns the console's pins. **Second pass:** this page has not read the console's files.

**Rollback:** the console's own. **Stopping here is safe:** the console only reads.

## Step 11. The freeze (plan step 9)

**Who:** Rafa.

1. **Merge the pull request of step 3 into `main`.** `main` then holds the build that is live and the record it settles on.
2. **Confirm once more, from `main`:** `contracts/script/deploy-sepolia.sh --check https://ethereum-sepolia-rpc.publicnode.com`.
3. **Tag the frozen commit,** the `commit` field of `contracts/deployments/sepolia.json`. The repository has no tag today [measured], so the name is Rafa's to choose (gap 9 of T-363). Pushing a tag reaches outside the repository.
4. **`docs/audit/scope.md` names the frozen commit,** the rules contract's size and the code-line count. The words package writes it. **Second pass.**
5. **The pilot's rehearsal cases on the new world,** one at a time: `pnpm -C <checkout> audit-deal --live --case <case>` for released, redelivered, rubric, refunded, missed-deadline, shown-mismatch and resume. **Second pass:** the tool with `--case` is on `main` (T-355) and reaches the lane when `main` is merged into it; its live cases are built and have not run.
6. **Write the record into [`operations.md`](operations.md),** in the coordinator's docs commit: the old world's name, rules address and record file; the new ones; every Worker's version and rollback target; each smoke and test deal; the deals left behind in step 1.5. Say that the new world bonds no one. Say that the old vault still holds the three demo adjudicators' deposits of 25,000 tUSDC each. They are test tokens, and the world has no withdrawal path for them (gap 12 of T-363).
7. **Update the daily log** in the private repository.

**It must show:** `--check` passes from `main`; the tag points at the record's commit; the seven cases have a deal record each.
**Rollback:** a revert on `main` only; `main` takes no force push. Moving a pushed tag is a history rewrite and a gate.

**Point of no return 2.** The merge and the tag fix the commit an auditor reads. A contract change after this step is a new deployment and a new run of this page.

## Points of no return, and where stopping is safe

- **Safe to stop, with the old world serving as before:** after steps 0, 1, 2, 3, 4 and 5. The new contracts on Sepolia are unused until step 6.
- **Reversible, with a cost that grows:** steps 6, 7 and 8. A rollback of both operators restores the old world. Every deal an outside party opened on the new world meanwhile loses its operators.
- **Point of no return 1, step 9:** the published one command and pins.
- **Point of no return 2, step 11:** the merge to `main` and the pushed tag.
- **Never reversible, and harmless:** every Sepolia transaction, the deploy and the old world's timeouts included.

## What the plan's nine steps miss

1. **The preconditions of step 0,** above all that `main` must not move, because every deploy's pre-flight checks it.
2. **The gitleaks entries** for the record commit, which only Rafa can add and only after the commit exists.
3. **The old record must be copied before the deploy,** because the script writes over it.
4. **The test agents open no deal on their own, and nothing can pause a deal's sources.** The quiet is a wait and two checks, with a race that remains.
5. **A new token, new adjudicator addresses and a new rulebook hash** come with the new world. Anyone who pinned the old ones must read them again.
6. **The SimChain world's name** must move with schema v0.11, or the rollback path to SimChain refuses its stored journal. **Second pass.**
7. **The one command fails between steps 6 and 9,** and the live test agents refuse to sign between steps 6 and 8.
8. **The old world's alarm** fails harmlessly after step 6, and its error line is expected.
9. **A deal left on the old contracts has no operator** after step 6 and no tool to send its timeouts.
10. **The deploy script does not resume** after a failed `forge create`.
11. **The operators' gas quote** was measured on the old contracts.
12. **The old vault keeps the demo adjudicators' deposits.**
13. **The start-up check tells old contracts from new** by the domain, 0.7 against 0.8, and checks the token three ways (T-383).
14. **No staging operators exist.** The first run of the lane's Workers on Cloudflare is step 6; its own smoke deal and rollback are the only net.

## Second pass: every line that waits

| Line | Waits for | What will change |
| --- | --- | --- |
| Step 0.1, 0.10 | R7 to R11, the rehearsal | The gates pass; measured times and corrections enter this page |
| Step 2, the constructor | R7 | Done for R8 by T-383: the margin of 29 s is in the script's create line, checks and record. A refactor that changes the constructor again changes the script with it |
| Step 2.6, step 6.4 | T-358 | The domain reads 0.8 and the schema 0.11 |
| Step 3.3 | Rafa, for an Etherscan key | Done by T-383: `deploy-sepolia.sh --verify`, Sourcify with no key; Etherscan when `ETHERSCAN_API_KEY` is set. Not tried against the real explorers |
| Step 3, the versions and the test rulebooks | T-358; an owner for the two test rulebooks | They land on the lane before the freeze, not in the cutover's commit |
| Step 3, `WORLD_NAMES.sim` | T-358 | The SimChain world's new name |
| Step 4 | The code-alignment package | Three fork suites rewritten for the phase-one record; the pre-deploy suite's place decided |
| Step 6, the start-up check | none | Done: T-358's domain 0.8, and T-383's token check and old-record test |
| Step 6.4, the club's minimum appeal window | T-358 | The rulebook and a required window of 0 agree |
| Step 6, the world's fallback wake-up | R8 (ADR-0032) | The wake-up moves to the round's publishing time; the smoke deal does not exercise it |
| Step 7 | The code-alignment package; a pre-deploy tool if one is built | The scenario's name and flags; perhaps the step's place |
| Step 8, the faucet | T-358's operator package | The faucet and the agents carry the payment and payout addresses |
| Step 10 | The words package | The console's pins and its command |
| Step 11.4, 11.5 | The words package; `main` merged into the lane | `scope.md` names the commit; `pnpm audit-deal --case` exists on the lane |

The gaps no package owns are in [`tasks/T-363-cutover-checklist.md`](tasks/T-363-cutover-checklist.md), Handoff, with what this page could not verify by reading.
