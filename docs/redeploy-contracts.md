# Redeploying the phase-one contracts on Sepolia

This runbook moves Crow's live test service to a new deployment of the phase-one contracts, from a frozen commit to a pushed tag. It serves the next tag, `contracts-phase-one-2` (the version with the audit's fixes), and every later one: the audit loop redeploys after each round of fixes. It is drawn from the cutover of 2026-11-13, whose dated record is [`cutover-phase-one.md`](cutover-phase-one.md). The steps keep that record's numbers, so each can be read beside what happened there; the items inside a step are numbered for this page.

**Every value comes from its source on the day:** the record (`contracts/deployments/sepolia.json`), discovery (`/.well-known/holdback.json` and `/v1/status` on each node), the scripts' own output, and the chain. This page copies no address, hash, contract or schema version, or gas figure from a deployment. The few fixed values in its commands (a page size, a byte window, a fork balance, a tool version) each name their source beside them. A dated record of each run goes into [`operations.md`](operations.md) at step 11.4.

## What binds

**Sepolia only.** Every chain step runs on Ethereum Sepolia, chain ID 11155111. Before any step that names an RPC, run `cast chain-id --rpc-url <rpc-url>`; if it prints anything else, stop. No line of this page may be adapted to a mainnet chain ID: a mainnet deploy needs an audit, Rafa's written approval and its own checklist ([`operations.md`](operations.md), Gates). `contracts/script/deploy-sepolia.sh` and the operators' chain client refuse any other chain, except a local rehearsal that never writes the Sepolia record.

**Rafa's gates.** One go-ahead covers one step. These are his, always:

- the go-ahead for the run, and each deploy's go-ahead: the contracts (step 2), the operators (6), the test agents (8), the site (9) and the founder console (10);
- the deployer's keystore and its password file, which sit on his Mac: he runs step 2.3;
- the live rounds of step 7, which load `E2E_SEPOLIA_SEED` from his environment: he runs them in his terminal;
- the `.gitleaksignore` lines (step 3.7), a control file;
- the merge of step 11.1 and the tag push of step 11.3, the two parts of point of no return 2;
- the word to the people he has given the test service to (step 1.2).

**Secrets go by name.** Nobody reads, prints or copies `.env*`, the keystore, its password file, `SEPOLIA_RELAYER_KEY`, `TEST_AGENTS_SEED` or `E2E_SEPOLIA_SEED`. A keyed RPC URL is a secret too; a failing cast or forge call can print the URL it called, so prefer the public node for reads.

**The four decisions of 2026-11-12 still bind** ("Yes, all four"):

1. **No switch pauses new deals.** The quiet of steps 1 and 5 is a wait and two checks, with a race that remains.
2. **The tags:** `contracts-phase-one-1` named the frozen version; `contracts-phase-one-2` names the version with the audit's fixes. Rafa names any later tag and pushes each.
3. **One cutover branch,** cut from the frozen commit and merged to `main` at the end, with the coordinator holding every other merge to `main` and to the lane from step 0 to step 11. The branch of 2026-11-13, `cutover-phase-one`, is spent; name this run's after its tag, `cutover-<tag>` [inferred].
4. **No separate rehearsal copy of the operators** on Sepolia. Steps 6 to 8 run before the first point of no return, with a rollback.

**Both protected branches take only pull requests:** `main` and the contract lane, `contracts-audit-ready`. Each needs `check` and `gitleaks` to pass and allows no force push.

**Labels.** Write each result to `/Users/rafa/Documents/escrow/reports/<the cutover's folder>/` as you go, marked measured, documented, inferred or guessed.

## The day's terminal

```sh
export T=contracts-phase-one-2 W=/Users/rafa/Documents/escrow/.worktrees/cutover-contracts-phase-one-2
export R=https://ethereum-sepolia-rpc.publicnode.com D=https://sepolia.gateway.tenderly.co
export F=/Users/rafa/Documents/escrow/.worktrees/rehearse-contracts-phase-one-2
```

`T` is the tag. `W` is the cutover worktree. `R` is the public node, for reads. `D` is Tenderly's gateway, for the deploy: on 2026-11-13 the deploy failed on the public node and passed on the gateway (step 2.3). `F` is a scratch worktree for the rehearsal on a fork (step 1.2).

## The order

Steps 0 to 6, then 8, then 7, then 11.1, 9, 10 and the rest of 11. The site deploys from `main`, so the merge comes before it.

| # | Step | Stopping here | Rollback |
| --- | --- | --- | --- |
| 0 | Freeze and baseline | Safe | Nothing to undo |
| 1 | Rehearse; start the quiet | Safe | Nothing to undo |
| 2 | Deploy the contracts | Safe | Discard the record; the contracts stay unused |
| 3 | The record and every pin; Sourcify | Safe | Close the pull request |
| 4 | The fork suites | Safe | Nothing to undo |
| 5 | The quiet again | Safe | Nothing to undo |
| 6 | The operators; one smoke deal | Safe until an outside deal opens on the new world | Both operators, together |
| 8 | The test agents | As step 6 | With the operators |
| 7 | The live rounds | As step 6 | As step 6 |
| 11.1 | Merge into `main` | **Point of no return 2, first part** | A revert only |
| 9 | The site | **Point of no return 1** | Fix forward |
| 10 | The founder console | Safe | Its own |
| 11 | Check, lane, tag, records | **Point of no return 2** | A revert only |

## Step 0. Freeze and baseline

1. **The frozen commit** is the lane's tip once the audit's fixes and their review have merged into it. Nothing merges to the lane after it until step 11.2. Name two commits and write both down:
   - the frozen commit itself;
   - the last commit that changed `contracts/src`: `git -C /Users/rafa/Documents/escrow log -1 --format='%H %s' <frozen commit> -- contracts/src`. The audit's scope names it.

   `git -C /Users/rafa/Documents/escrow diff --stat contracts-phase-one-1 <frozen commit> -- contracts/src` must list only the files the fix review names.
2. **The coordinator holds merges** to `main` and to the lane from here to step 11 (decision 3). Every deploy script refuses a checkout that lacks `origin/main`'s commits after a fresh fetch (`scripts/deploy-lib.mjs`). If `main` moves mid-run, merge it into the cutover branch and repeat step 3's checks before the next deploy.
3. **Make the worktree:**

   ```sh
   git -C /Users/rafa/Documents/escrow fetch origin
   git -C /Users/rafa/Documents/escrow worktree add $W -b cutover-$T <frozen commit>
   git -C $W submodule update --init --recursive
   pnpm -C $W install --frozen-lockfile
   pnpm -C $W build
   ```

   `pnpm build` is needed, or step 1's test cannot resolve `@holdback/core` [measured on 2026-11-13]. `--recursive` is needed too: Sourcify's exact match in step 3.3 needs a recursive checkout's remappings [measured by T-383].
4. **The runtime hashes at the frozen commit,** each artifact's `deployedBytecode` without its CBOR metadata tail (T-384's method). Write both lines down; step 3.2 compares the chain with them, and the fix review or the audit's scope should name the same figures:

   ```bash
   cd $W && for id in src/HoldbackRules.sol:HoldbackRules src/DrandQuicknetBeacon.sol:DrandQuicknetBeacon; do code=$(forge inspect --root contracts $id deployedBytecode); body=${code#0x}; n=$((16#${body: -4})); stripped=${body:0:$(( ${#body} - (n+2)*2 ))}; echo "$id $(( ${#stripped} / 2 )) bytes $(printf '%s' "$stripped" | xxd -r -p | shasum -a 256 | cut -d' ' -f1)"; done
   ```

5. **It holds `main`:** `git -C $W merge-base --is-ancestor origin/main HEAD; echo $?` prints `0`. A `1` means `main` has commits the lane lacks: bring `main` into the lane by a pull request first. That moves the lane's tip, so then repeat step 0 from 0.1.
6. **The tools answer:** `forge --version`, `cast --version`, `jq --version`, `node --version`, `npx wrangler@4 whoami` (Rafa's Cloudflare login).
7. **The deployer has test ETH.** Reusing the live record's deployer (`jq -r .deployer $W/contracts/deployments/sepolia.json`) or a new throwaway key is Rafa's call. Size the budget from the live deployment's own creations, then the gas price:

   ```sh
   for tx in $(jq -r '.contracts[].tx, .token.tx' $W/contracts/deployments/sepolia.json); do cast receipt $tx gasUsed --rpc-url $R; done
   cast gas-price --rpc-url $R
   cast balance <deployer address> --ether --rpc-url $R
   ```

   Keep at least twice the sum at today's gas price, with room for the price to move: a stopped run is rerun whole, because the script does not resume (its header says so). A fix that grows the contracts costs more.
8. **The relayer's funding lane has test ETH:** `cast balance $(curl -s https://api.crow.direct/.well-known/holdback.json | jq -r .demo.relayer.fundingLane) --ether --rpc-url $R`. The new world keeps the relayer key and its lanes. Do not run `apps/demo-cloud/scripts/relayer.mjs` or `apps/test-agents/scripts/seed.mjs`: both secrets stay as they are.
9. **The rollback targets,** each Worker's live version. Write each version ID down; later deploys replace them:

   ```sh
   npx wrangler@4 deployments status --name holdback-op1 --json
   npx wrangler@4 deployments status --name holdback-op2 --json
   npx wrangler@4 deployments status --name crow-test-agents --json
   npx wrangler@4 deployments status --name crow-site --json
   ```

10. **The baseline reads** of both nodes, `https://api.crow.direct` and `https://api2.crow.direct`: save `/v1/status`, `/.well-known/holdback.json`, `/v1/clubs/demo-club` and `/v1/adjudicators` to the results folder.

**It must show:** every line true, and Rafa's go-ahead recorded with its date and words.

## Step 1. Rehearse, then start the quiet

**Rehearse, before the day.**

1. **On anvil,** no RPC and no key of anyone's: `node $W/scripts/deploy-rehearsal.mjs` runs steps 2.1 to 3.3 against its own local chain, on a copy of the checkout's tracked files, with a throwaway key it makes and removes. It prints one line per step, `pass` or `FAIL`, each with the Sepolia command it stands for, then what a local chain cannot show. It must end `deploy-rehearsal: pass: …` [measured on 2026-11-14: 8 steps in about 66 s]. `pnpm -C $W exec vitest run packages/settlement/evm/deploy-script.test.ts` runs it twice, and the script's refusals beside it; it must pass too.
2. **On a fork of Sepolia, with the full checks.** On 2026-11-13 the anvil rehearsal missed three breaks that CI found at the record's commit: the record's type in `examples/deployments.ts`, `tests/record-copies.test.ts`, and a test that named a cut contract. `pnpm typecheck` and `pnpm test` on a rehearsal's record catch that kind [measured: they failed on CI]. A fork keeps chain ID 11155111, but the script knows a development node by its client name (anvil, Hardhat, Ganache) and treats it as a rehearsal: it writes only the file `DEPLOY_RECORD` names, never a record in `contracts/deployments/`, and the source tool sends nothing from it. anvil mines a block only for a transaction, so the rehearsal takes the latest block in place of the finalized one (`DEPLOY_FINALITY=latest`). In a scratch worktree `F` at the frozen commit, made as in step 0.3, with anvil running in its own terminal (`anvil --fork-url $R --hardfork prague`):

   ```sh
   cast wallet new $F/reports/scratch --unsafe-password rehearsal
   cast rpc anvil_setBalance <the new address> 0x8AC7230489E80000 --rpc-url http://127.0.0.1:8545
   node $F/scripts/record-copies.mjs keep --rpc http://127.0.0.1:8545 --root $F
   DEPLOY_RECORD=$F/reports/scratch/fork-record.json DEPLOY_FINALITY=latest $F/contracts/script/deploy-sepolia.sh http://127.0.0.1:8545 <the new keystore file> <a file holding "rehearsal">
   cp $F/reports/scratch/fork-record.json $F/contracts/deployments/sepolia.json
   <the --old line that keep printed, run as printed>
   (cd $F/contracts && forge build)
   pnpm -C $F typecheck
   pnpm -C $F test
   node $F/site/check.mjs
   ```

   The key is a throwaway for the fork only, and `anvil_setBalance` funds it there with `0x8AC7230489E80000` wei, 10 ETH on the fork. Each line must pass. A failure is a fix for the lane before the freeze, not a cutover step. Then remove `F` with its key [inferred: the script's fork rules are tested on an anvil with Sepolia's chain ID (`deploy-script.test.ts`), and nobody has run this sequence whole].

**Start the quiet.**

1. **Stop Crow's own deals.** Tell every session to run no live deal until step 9 passes: no `examples/e2e-round.ts run`, no `pnpm audit-deal --live`, no `site/try.mjs`, no `sell-to-test-buyer.mjs`.
2. **Rafa tells the people he has given the test service to** when it changes, and that the addresses, the token and the one command change with it.
3. **List the deals that are not final,** on both nodes:

   ```sh
   curl -s "https://api.crow.direct/v1/commitments?limit=200" | jq -r '.nextCursor, (.items[] | select(.finalAt == null) | [.commitmentId, .escrowState, .appealState, (.deadlines | tostring)] | @tsv)'
   ```

   The first line is `nextCursor`; while it is not `null`, repeat with `&cursor=<nextCursor>`. The page size is the largest the operator serves (`MAX_LIMIT` in `apps/operator/src/server.ts`). Repeat on `https://api2.crow.direct`. A deal the node marks behind the chain may be final on chain already: read its state on the rules contract before you count it as open.
4. **For each open deal, wait for its last deadline;** the operators close it. A deal whose deadlines lie after the cutover has three ways out, chosen and written down for each: wait; a settlement both parties sign; or leave it on the old contracts with its ID, state and deadlines. A deal left behind keeps its funds in the old escrow and its permissionless timeouts, but no Crow operator serves it after step 6.

**It must show:** the list is empty on both nodes, or each deal on it has its way out written down. Both test agents read `"open": 0` (`curl -s https://crow.direct/agents/test-seller/health`, and the same for `test-buyer`).

## Step 2. Deploy the contracts

**Who:** Rafa, with his keystore.

1. **Confirm the chain on both RPCs:** `cast chain-id --rpc-url $D` and `cast chain-id --rpc-url $R` each print `11155111`.
2. **Keep the live record under its dated name, before the deploy:**

   ```sh
   node $W/scripts/record-copies.mjs keep --rpc $R
   ```

   It prints the dated name and the `--old` line for step 3.1, with full paths: save both. Run it before step 2.3, never after: run after the deploy, it keeps the new record, and step 3.1 then fails.
3. **Deploy through the gateway:**

   ```sh
   DEPLOY_CROSSCHECK_RPC=$R $W/contracts/script/deploy-sepolia.sh $D <keystore-file> <password-file>
   ```

   The deploy goes through `D`; `R`, from another provider, is the second RPC the script requires on Sepolia. Before the record is written, `R` must hold every creation in the same block and call it finalized too, so one node's word on the chain, its name or its finality is never enough [measured on anvil: a second node without the creations stops the run with no record]. Each creation is signed for chain 11155111 by `forge create --chain`, whatever chain ID the RPC answers. It prints one `created <contract> at <address> (nonce …, transaction …, block …)` line per creation, five in all. It then waits until the last creation's block is finalized, about 13 minutes on Sepolia, and prints `waiting until block … is finalized` while it does. It ends with the token note (`this deployment created the token …; the table names …`) and `wrote …/contracts/deployments/sepolia.json`. Write the note down.

   **How the script sends** (its header has the whole of it): each creation goes at an explicit nonce, once the deployer's mined and pending nonces agree, so its address is known before it is sent. A failed send ("replacement transaction underpriced" on 2026-11-13) is settled from the chain: a creation mined at that nonce is taken as sent once its input is this build's code and arguments, a pending one is waited for, and only a nonce still unused goes again, at the same nonce, at most three times. A retry cannot create a second copy of a contract [measured on anvil with a stand-in forge that fails after sending, and one that fails before: the deployer ends five nonces on and the record checks].

   **If the run stops** (another transaction from the deployer, a creation that reverts, finality not reached within 60 minutes), it writes no record and prints `the run stopped before the record was written`, then one line per contract it created, and a line `possibly, once mined: …` for a send that had not settled. Before a rerun:
   - write those lines down, as orphans, for step 11.4;
   - then rerun step 2.3 whole. Each rerun creates all five anew.
4. **Read the domain** the new rules contract signs under: `cast call $(jq -r .rules $W/contracts/deployments/sepolia.json) 'eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])' --rpc-url $R`. It reads "Holdback" and the version in `packages/core/src/eip712.ts` at the frozen commit. A change of domain or schema version lands on the lane before the freeze, never in the record's commit.

**It must show:** the record's `commit` equals `git -C $W rev-parse HEAD`; it has `beaconMarginSec` and `deployedAt`.
**Rollback:** `git -C $W checkout -- contracts/deployments/sepolia.json` and delete the dated copy. The cost is test ETH.

## Step 3. The record and every pin, in one commit; Sourcify

The record, the world's name and every copy move together: each Worker names its Sepolia world by the record's rules address, and a world refuses to open against another rules contract.

1. **Write the copies:** run the `--old` line step 2.2 printed. It substitutes the new values, rebuilds the site, then sweeps every tracked file outside the history list at the top of `scripts/record-copies.mjs`. It must end `record-copies: pass: …`. It prints the paths it did not read, with the reason: look at any path that is not history, the submodule or a binary image. Any line it names is a pin to fix by hand; then rerun it.
2. **Check the deployment, read-only:**

   ```sh
   $W/contracts/script/deploy-sepolia.sh --check $R
   ```

   It prints `… matches the chain and the build at <the frozen commit>`. Then compare the deployed runtime code with step 0.4's lines. The deployed code holds the immutables' values where the artifact has zeros, so zero them first; never compare with `extcodehash` ([`audit/test-quality.md`](audit/test-quality.md), "Runtime code"):

   ```bash
   cd $W && onchain_hash() { local art="$1" addr="$2" code body n s l; code=$(cast code "$addr" --rpc-url $R); body=${code#0x}; while read -r s l; do [ -n "$s" ] || continue; body="${body:0:$((s*2))}$(printf '%0*d' $((l*2)) 0)${body:$(((s+l)*2))}"; done < <(jq -r '.deployedBytecode.immutableReferences // {} | .[][] | "\(.start) \(.length)"' "$art"); n=$((16#${body: -4})); body=${body:0:$((${#body}-(n+2)*2))}; echo "$addr $((${#body}/2)) bytes $(printf '%s' "$body" | xxd -r -p | shasum -a 256 | cut -d' ' -f1)"; }
   onchain_hash contracts/out/HoldbackRules.sol/HoldbackRules.json "$(jq -r .rules contracts/deployments/sepolia.json)"
   onchain_hash contracts/out/DrandQuicknetBeacon.sol/DrandQuicknetBeacon.json "$(jq -r .beacon contracts/deployments/sepolia.json)"
   ```

   Each size and hash equals step 0.4's.
3. **Verify the source on Sourcify,** through its API v2, by the script. It needs no key and no account. Sending publishes the source, so it is part of the run's go-ahead.
   1. **Check first; this sends nothing:**

      ```sh
      VERIFY_DRY_RUN=1 $W/contracts/script/deploy-sepolia.sh --verify $R
      ```

      It runs step 3.2's check, then `scripts/sourcify-verify.mjs`: it compiles the five contracts alone, with the project's settings, into a scratch folder (seconds; `contracts/out` is untouched), and compares each with its code and its creation transaction on the chain, the immutables zeroed. It prints one line per contract, `exact`, `code only` or `DIFFERS`, and must print `exact` five times. `code only` is the same code with another metadata hash, a partial match on Sourcify: most often a checkout without `--recursive` submodules, which the script refuses on Sepolia, or another commit. Fix the checkout before sending anything.
   2. **Send:**

      ```sh
      $W/contracts/script/deploy-sepolia.sh --verify $R
      ```

      It checks again, then sends the beacon first and the other four after it, one at a time, each with its creation transaction, from which Sourcify reads the constructor arguments. The first refusal stops it. Then it asks Sourcify what it holds for each address and prints one line per contract, `<contract> <address>: exact match on Sourcify (runtime exact_match, creation exact_match)` or `NOT an exact match …`. A contract verified before answers `already verified` and is still looked up, so a rerun is safe. Its User-Agent names the tool and no project. The routes and their answers are Sourcify's own documentation, `https://sourcify.dev/server/openapi.json`, as the tool's header cites them [documented, read 2026-11-14].
   3. **It must show** `deploy-sepolia: the five contracts are an exact match on Sourcify`. Etherscan is not part of the run: forge 1.0.0 names only Etherscan's retired API, and the script no longer calls it.
4. **Build fully, then the local checks.** After the deploy, `contracts/out` holds only the deploy's contracts, and every anvil suite fails with "no artifact … run forge build" [measured on 2026-11-13]. The full build leaves the deployed contracts' artifacts unchanged:

   ```sh
   (cd $W/contracts && forge build)
   node $W/site/check.mjs
   pnpm -C $W typecheck
   pnpm -C $W test
   ```

   `pnpm test` runs for many minutes: run it in the background.
5. **The cut-feature list:** `pnpm -C $W exec vitest run tests/cut-feature-alignment.test.ts -u`, then read its diff: only removals.
6. **One commit, one pull request** from `cutover-$T` into `main`. Do not merge it before step 11.1. Expect CodeQL to report alerts in test and check files that came from the lane, because pull requests into the lane run no CodeQL: fix what is real, and list the rest for Rafa's dismissal.
7. **gitleaks.** The record holds public values that gitleaks flags: on 2026-11-13 it flagged the escrow's `tokenStoreImplementation` address in four files [measured]. The gitleaks action scans only a few commits of a pull request with many, so a pass on a large pull request proves little [measured on PR 475]. Scan the whole range locally, then Rafa adds the lines for the record's commit to `.gitleaksignore`:

   ```sh
   gitleaks git $W --log-opts="origin/main..HEAD"
   ```

   [Inferred: the command form for gitleaks 8; Rafa installed it with `brew install gitleaks` on 2026-11-13.]
8. **The full check,** then restore the report it rewrites, or the next deploy's pre-flight refuses the dirty tree:

   ```sh
   pnpm -C $W verify
   git -C $W checkout -- reports/differential-local.md
   ```

**It must show:** the copies command ends `pass`; `--check` passes; both runtime hashes equal step 0.4's; `--verify` ends `the five contracts are an exact match on Sourcify`; every required check on the pull request passes; the tree is clean.
**Rollback:** close the pull request. Nothing live has changed.

## Step 4. The fork suites

The suites fork Sepolia into a local anvil and send nothing to the real chain. Run them one at a time; a skipped suite is a failure:

```sh
SEPOLIA_FORK_RPC=$R pnpm -C $W exec vitest run apps/demo-cloud/src/live-fork.test.ts --silent=false
SEPOLIA_FORK_RPC=$R pnpm -C $W exec vitest run apps/adjudicator/src/drand-fork.test.ts --silent=false
```

If anvil exits on the public node, use `SEPOLIA_FORK_RPC=$D`.

- **`live-fork.test.ts`** (`apps/demo-cloud/src/live-fork.test.ts`) runs one deal through the public world's code against the new record, then `site/walkthrough.mjs`. It prints the whole output of both, each under a heading: `examples/try.ts (exit 0):`, which ends `done commitment … Released`, and `site/walkthrough.mjs (exit 0):`, which ends `walkthrough PASS`. Then it prints the Sepolia gas of each transaction the fork mined. No CI job runs the walkthrough, so this is where a stale one shows [measured on 2026-11-13].
- **`drand-fork.test.ts`** escalates and decides from live drand rounds against the new rules contract and its beacon.

A failure here means the build cannot settle on the new contracts: fix it on the branch and repeat from step 3.2. A fix that touches `contracts/src` voids the deployment: go back to step 0 with a new frozen commit.

## Step 5. The quiet again

Within one minute of step 6:

1. Repeat step 1's list on both nodes: empty, or only deals written down as left behind.
2. `head.eventSeq` from `/v1/status` on both nodes, twice, 30 s apart: it does not move.
3. Both test agents read `"open": 0`.

A stranger can still open a deal between this check and step 6; step 6.4 looks for it.

## Step 6. The operators; one smoke deal

**Who:** Rafa, or a session on his word for this step.

1. **Deploy:** `pnpm -C $W demo-cloud:deploy`. In a second terminal, `npx wrangler@4 tail holdback-op1 --format json`. The script runs its pre-flight, the deal guard, both uploads, waits until both nodes' discovery names the deployed commit, then runs one smoke deal; on a failure after an upload it rolls both operators back by itself.
   - **The deal guard's count** must equal the deals left behind in step 1, normally 0. Its pass is not the quiet's proof: it checks policies, not worlds. A refusal means an open deal binds a policy the new build dropped: go back to step 1 for that deal; never set `HOLDBACK_DEPLOY_WITHDRAWN` for a world change.
   - Save the record line it prints.
2. **Compare discovery with the record,** on both nodes:

   ```sh
   jq -c '{rules, token: .token.address}' $W/contracts/deployments/sepolia.json
   curl -s https://api.crow.direct/.well-known/holdback.json | jq -c '{chain: .settlement.chainId, rules: .domain.verifyingContract, version: .domain.version, schema: .schemaVersion, token: .token.id, build: .demo.build.commit, fees}'
   curl -s https://api2.crow.direct/.well-known/holdback.json | jq -c '{chain: .settlement.chainId, rules: .domain.verifyingContract, version: .domain.version, schema: .schemaVersion, token: .token.id, build: .demo.build.commit, fees}'
   ```

   The chain is `"11155111"`; the rules address and the token equal the record's, letter case aside; the version is `packages/core/src/eip712.ts`'s; the build is `git -C $W rev-parse HEAD`. Then `/v1/clubs/demo-club` shows a new `rulebookHash` and payouts to the two parties only, and `/v1/adjudicators` shows new demo adjudicators, each with `observed.bond` `none`.
3. **The smoke deal's gas,** from its receipts: for each transaction link the smoke deal printed, `cast receipt <tx> gasUsed --rpc-url $R`. Record the three; they price the operators' gas quote if a fee is switched on again. Write them into the new dated entry of `docs/operations.md`'s Deploy record as one line, `Gas on Sepolia: fund <n>, deliver <n>, decide <n>, total <n>`, in gas with thousands commas: the contract stack page reads the first such line there (`sepoliaGas()` in `scripts/contract-stack.mjs`).
4. **A deal the race let through:** compare the old rules contract's latest events on the explorer with step 5's list. Record any new deal as left behind.
5. **Expect one error line** in the tail: the old world's last alarm is refused with "this world settles on the rules contract …". Read any other error before going on.

**Rollback,** both operators together, with step 0.9's versions:

```sh
npx wrangler@4 rollback <holdback-op1 version from step 0.9> --name holdback-op1
npx wrangler@4 rollback <holdback-op2 version from step 0.9> --name holdback-op2
```

The old world's storage stays: never delete it, because a rollback serves it again. **Stopping here is safe only while no outside party has opened a deal on the new world.** From this step until step 9 the site's one command fails, because its bundle pins the old contracts; until step 8 the live test agents refuse to sign. Run steps 8, 7 and 9 without a pause.

## Step 8. The test agents

**Who:** Rafa, or a session on his word.

1. **Deploy:** `node $W/apps/test-agents/scripts/deploy.mjs`. It waits for the seller's health to read `operational`, and rolls back otherwise. Then `curl -s https://crow.direct/agents/test-buyer/health` reads `"status": "operational"`.
2. **Buy from the test seller with the new bundle, from an empty folder.** The live site still serves the old bundle, and `node $W/site/try.mjs` fails with "Cannot find package 'tweetnacl'": the bundle needs its two pinned packages beside it [measured on 2026-11-13]. The pins are the install line of the try command that `site/build.mjs` wrote into `site/index.html`:

   ```sh
   P=$(mktemp -d) && cd $P && npm init -y >/dev/null
   npm install --silent --ignore-scripts $(grep -o 'viem@[0-9.]* tweetnacl@[0-9.]*' $W/site/index.html | head -1)
   cp $W/site/try.mjs . && node try.mjs --seller https://crow.direct/agents/test-seller
   node try.mjs --seller https://crow.direct/agents/test-seller --outcome refund
   ```

   [Inferred: the published command's install, with the worktree's file in place of the download; on 2026-11-13 the coordinator linked `examples/node_modules` beside a copy instead.]
3. **Sell to the test buyer:** `node $W/apps/test-agents/scripts/sell-to-test-buyer.mjs`.

**It must show:** the deploy says `pass`; the two buys end `Released` and `Refunded`; the sale ends `released`. Save each deal's ID and transactions.
**Rollback:** `npx wrangler@4 rollback <crow-test-agents version from step 0.9> --name crow-test-agents`, only together with the operators.

## Step 7. The live rounds

**Who:** Rafa, in his terminal: the rounds load his `E2E_SEPOLIA_SEED`, and a session must not. List the scenarios first with `node $W/examples/e2e-round.ts list`. On 2026-11-13 two ran: the escalation, `run 5b --t220 --no-homepage`, and the two money addresses, `run 12 --no-homepage`, each from the folder that holds his env file:

```sh
node --env-file-if-exists=.env $W/examples/e2e-round.ts run 5b --t220 --no-homepage
node --env-file-if-exists=.env $W/examples/e2e-round.ts run 12 --no-homepage
```

Each prints `results: … pass`. The escalation proves the operators' gas estimate for an escalation's decision on Sepolia, which no local world can show. If it fails, an escalated deal ends by its default, a refund: fix forward before the merge, or roll back as in step 6. Record each deal's gas from its receipts, as in step 6.3.

## Step 11.1. Merge into `main`

**Who:** Rafa's word; point of no return 2, first part. Merge step 3's pull request once every required check passes and step 7 has passed. `main` then holds the live build and its record. From here a change takes a revert, and `main` takes no force push.

## Step 9. The site, from `main`

**Who:** Rafa, or a session on his word. Point of no return 1.

1. **Check out `main`:** `git -C $W fetch origin` then `git -C $W switch --detach origin/main`.
2. **Deploy:** `pnpm -C $W site:deploy`. It builds into `reports/site-out`, runs `site/check.mjs`, uploads, checks the live page, `llms.txt` and the SHA-256 of `try.mjs`, and rolls back on a failed check.
3. **Run the one command as a stranger would:** copy it from "Try it" in `https://crow.direct/llms.txt` into an empty folder and run it. It ends `Released`.
4. **Five checks of the live site,** from `$W`, each computing its expected value from the deployed commit:

   ```bash
   cd $W
   for f in try.mjs buy.mjs; do want=$(shasum -a 256 site/$f | cut -d' ' -f1); got=$(curl -fsS https://crow.direct/$f | shasum -a 256 | cut -d' ' -f1); echo "$f $([ "$want" = "$got" ] && echo same || echo DIFFERS)"; done
   curl -fsS https://crow.direct/ | grep -c "$(shasum -a 256 site/try.mjs | cut -d' ' -f1)"
   curl -fsS https://crow.direct/buy.txt | grep -c "$(shasum -a 256 site/buy.mjs | cut -d' ' -f1)"
   curl -fsSL https://crow.direct/demo | grep -oE 'href="(https?://|/)[^"#]*' | cut -d'"' -f2 | sort -u | while read -r u; do case "$u" in /*) u="https://crow.direct$u" ;; esac; echo "$(curl -s -o /dev/null -L -w '%{http_code}' "$u") $u"; done
   curl -s -o /dev/null -w '%{http_code}\n' "https://crow.direct/no-such-page-$(date +%s)"
   curl -fsS https://crow.direct/ | wc -c
   curl -fs https://crow.direct/ | head -c 600 | grep -c '/llms.txt'
   for f in llms.txt buy.txt sell.txt; do curl -fsS https://crow.direct/$f | cmp -s - reports/site-out/$f && echo "$f same" || echo "$f DIFFERS"; done
   ```

   Both scripts print `same`, and each hash count is at least `1`; every demo link starts with `200`; the missing page prints `404`; the home page's size is within `HOME_MAX_BYTES` in `site/check.mjs`, and its head, the first `POINTER_WITHIN` bytes there (the `head -c` value above), names `/llms.txt`; the three guides print `same`.

**Rollback:** the script rolls the site back by itself on a failed live check. By hand, only together with the operators and the test agents, because the old command works only against the old world: `npx wrangler@4 rollback <crow-site version from step 0.9> --name crow-site`. Once the step passes, strangers open deals on the new world, and a rollback would leave each without an operator: fix forward.

## Step 10. The founder console

**Who:** Rafa. Its code and pins are kept privately ([`private-materials.md`](private-materials.md)). It shows the new rules address, the new token and the record's `fromBlock`. It only reads, so stopping here is safe.

## Step 11. Check, lane, tag, records

1. **From `main`:** `$W/contracts/script/deploy-sepolia.sh --check $R` passes.
2. **The lane takes the record** by a pull request from `cutover-$T` into `contracts-audit-ready`. GitHub deletes a merged branch, so push it again first: `git -C $W push origin cutover-$T`. Merge it once `check` and `gitleaks` pass; the same `.gitleaksignore` lines serve it.
3. **The tag,** on step 11.1's merge commit, pushed by Rafa. The coordinator holds every other merge, so `origin/main` is that commit; its subject names step 3's pull request:

   ```sh
   git -C $W fetch origin main
   git -C $W log -1 --format='%H %s' origin/main
   git -C $W tag -a $T origin/main -m "Holdback phase-one contracts with the audit's fixes, deployed on Sepolia"
   git -C $W push origin $T
   ```

   **An auditor checks the tag:** `git diff --quiet $T "$(git show $T:contracts/deployments/sepolia.json | jq -r .commit)" -- contracts/src; echo $?` prints `0`, and `git log -1 --format=%H $T -- contracts/src` names the commit of step 0.1. The runtime hashes at the tag equal step 0.4's. The coordinator then lifts the hold on merges. A pushed tag is never moved: moving it rewrites history on the remote, a gate. A wrong tag stays, and the fix is the next tag.
4. **The records:** the dated entry in [`operations.md`](operations.md) (the old and new worlds, every Worker's version and rollback target, each deal, any orphan contract, any deal left behind); `docs/audit/scope.md` names the new tag; the daily log in the private repository. Remove the worktree `W` once the lane's pull request has merged.
5. **The pilot's rehearsal cases** (`pnpm audit-deal --live --case <case>`) are out of this runbook's scope. On 2026-11-13 they became their own session after the cutover. Run them that way on the new world, on Rafa's word for live deals.

**Point of no return 2.** The merge and the tag fix the commit an auditor reads. A contract change after this is a new run of this page.

## Points of no return

- **Safe to stop,** with the old world serving: after steps 0 to 5. The new contracts on Sepolia stay unused.
- **Reversible, at a growing cost:** steps 6, 8 and 7. A rollback of both operators restores the old world; a deal an outside party opened on the new world meanwhile loses its operators.
- **Point of no return 1:** step 9, the published one command and pins.
- **Point of no return 2:** the merge of step 11.1 and the tag of step 11.3.
- **Never reversible, and harmless:** every Sepolia transaction, an orphan contract included.

## What the tools do not cover

The two gaps of 2026-11-13 are closed in the script (T-410): `--verify` goes through Sourcify's API v2 (step 3.3), and the deploy sends each creation at an explicit nonce and settles a failed send from the chain (step 2.3). What remains by hand:

- **The rehearsal on a fork** (step 1.2): `scripts/deploy-rehearsal.mjs` runs on a local chain only, so it does not run the type checks and tests on a Sepolia-shaped record.
- **Etherscan:** not verified. The script's Sourcify route needs no key; Etherscan's needs a key and its API V2.
- **A CI job for `site/walkthrough.mjs`:** a workflow change, waiting for Rafa's word; until then step 4 is where the walkthrough runs.
- **A stopped deploy** is rerun whole: the script does not resume, and step 2.3 lists the orphans it prints.
