# T-410: A contract redeploy is routine

- **Lane:** settlement (kind 7, the deploy script; red team on the script)
- **Phase:** 2
- **Depends on:** T-383, T-398
- **Paths this task may touch:** `contracts/script/`, `scripts/deploy-*`, `scripts/sourcify*`, `docs/redeploy-contracts.md`, their tests (`packages/settlement/evm/deploy-script.test.ts`, `tests/sourcify-verify.test.ts`), this task file; `apps/demo-cloud/src/live-fork.test.ts` for its output, on the coordinator's brief (and the two lines it needed to run on the public node: see Decisions)
- **Human gate:** no for this pull request; a CI job for `site/walkthrough.mjs` is a workflow file, a separate draft pull request for Rafa's word
- **Status:** done (pull request 514 merged 2026-11-14 as `0ed11a8`)
- **Agent/session:** T-410 session, 2026-11-14

## Intent

The pilot's audit loop redeploys the phase-one contracts on Sepolia after each round of fixes, so a redeploy must run from the script and the runbook alone. The switch-over of 2026-11-13 needed hand work in three places: source verification went through a scratch script, because forge 1.0.0 calls Sourcify's removed API v1; a deploy attempt failed with "replacement transaction underpriced", because the script does not wait for the deployer's nonce between creates; and nothing rehearsed the whole redeploy in one command. This task closes those gaps on a local chain, never on a live network:

- `deploy-sepolia.sh --verify` verifies all five contracts through Sourcify's API v2 and prints, per contract, whether Sourcify holds an exact match;
- the deploy sends each creation at an explicit nonce, waits for the nonce to advance, and settles a failed send by reading the chain, so a retry can never create a second copy of a contract;
- the record is written only once every creation is final on the chain;
- one committed verification tool, `scripts/sourcify-verify.mjs`, and one rehearsal command, `scripts/deploy-rehearsal.mjs`;
- `live-fork.test.ts` prints the output of both scripts it runs;
- `docs/redeploy-contracts.md` follows the script and names record fields, not copied values.

Non-goals: no deploy, no submission to Sourcify, no keystore read; `contracts/src/` does not change; a CI workflow is not merged here.

## Acceptance criteria

- [x] `--verify` sends each of the five contracts to Sourcify's API v2 (`POST /v2/verify/{chainId}/{address}`, documented in Sourcify's `/server/openapi.json`, read 2026-11-14), then reads `/v2/contract/{chainId}/{address}` and prints one line per contract saying whether the match is exact. Proven against a stand-in Sourcify server on a local chain.
- [x] Before sending anything, the tool compiles the five contracts with the project's settings and compares each with its code on the chain, immutables zeroed: `exact`, `code only`, or `DIFFERS`. It sends nothing unless all five are `exact`.
- [x] The deploy passes `--nonce` to each `forge create`, waits until the deployer's mined and pending nonces agree and equal the expected nonce, and after a failed send reads the chain: a mined transaction at that nonce is taken as the creation (when it created the expected address), a pending one is waited for, and only a nonce never used is sent again, at the same nonce. Proven on anvil with a stand-in forge that fails after sending and one that fails before sending: the deployer's nonce ends at 5, the record checks.
- [x] The record is written only once the last creation's block is finalized, to a temporary file then moved into place; a stopped run prints the contracts it created as orphans and writes no record.
- [x] `scripts/deploy-rehearsal.mjs` runs the redeploy's steps 2 and 3 against a local anvil, on a copy of the tracked files, and prints the Sepolia command for each step.
- [x] `live-fork.test.ts` prints the output of `examples/try.ts` and `site/walkthrough.mjs`.
- [x] `docs/redeploy-contracts.md` names the script's commands and the record's fields, with no copied address or hash.
- [x] A red-team pass on the script: wrong chain, a mainnet chain ID, a half-finished run, a record written before the deployment is final.

## Out of scope

- Etherscan verification (it needs a key and Etherscan's API V2; see Decisions).
- Resuming a stopped deploy: a stopped run is rerun whole, as before.
- A rehearsal on a fork of Sepolia inside the rehearsal command (the runbook's step 1.2 keeps it by hand).

## Evidence

Every chain run below is on a local anvil or an anvil fork of Sepolia; nothing was deployed and nothing was sent to Sourcify.

- **The five-contract input** [measured, 2026-11-14]: `forge build` of the five contracts alone (`--force --build-info`, into a scratch folder) takes about 5 s, against 5 min 30 s for the full build, and gives creation code byte-identical to the full build's and to `contracts/out`, metadata included, for all five.
- **The check against the live deployment** [measured]: `node scripts/sourcify-verify.mjs --record contracts/deployments/sepolia.json --rpc <public node>` from this worktree (recursive submodules) prints `exact` for all five contracts of the record and sends nothing. A read-only `GET /v2/contract/11155111/<address>` for the same five returns `exact_match` for runtime and creation, which is what the check predicts.
- **Sourcify's API** [documented]: `https://sourcify.dev/server/openapi.json`, APIv2 2.1.0, read 2026-11-14: `POST /v2/verify/{chainId}/{address}` (202, 409 `already_verified`, 429), `GET /v2/verify/{verificationId}`, `GET /v2/contract/{chainId}/{address}`. The fair-use section asks for back-off on 429 and 5xx, which the tool does.
- **The rehearsal** [measured]: `node scripts/deploy-rehearsal.mjs` passes 8 steps in 66 s; the suite runs it with `--runs 2` (15 steps).
- **The anvil suite** [measured]: `pnpm exec vitest run packages/settlement/evm/deploy-script.test.ts`: 32 tests, all passing (31 in one run of 856 s on this Mac, and the second-RPC case, fixed after it, in a run of its own); it was 15 tests in about 250 s before. New cases: the nonces of the five creations are 0 to 4; a send that reached the chain and then failed, one that never did, and one left pending (mining off for 4 s) each end with the deployer five nonces on and the record checking; another transaction from the deployer stops the run with no record and three orphans named; a run whose last block is not finalized within 2 s writes no record and names five orphans; a run beside a miner waits for finality, then writes; `--verify` against a stand-in Sourcify server (order, body fields, User-Agent, one line per contract; a 409 with a partial match and a partial job each print `NOT an exact match`; a refusal stops the run); an anvil with Sepolia's chain ID is a fork and never writes the Sepolia record; a node posing as Sepolia takes none of the five rehearsal settings; chain IDs 1, 8453 and 17000 are refused by the script and by the tool.
- **Unit tests** [measured]: `tests/sourcify-verify.test.ts`, 11 tests (the comparison, Sourcify's answers, arguments); with `tests/record-copies.test.ts`, 27 pass.
- **The fork suite** [measured]: `SEPOLIA_FORK_RPC=<public node> pnpm exec vitest run apps/demo-cloud/src/live-fork.test.ts --silent=false`: 2 of 2 pass; it prints `examples/try.ts (exit 0):` with the deal to `done commitment … Released`, `site/walkthrough.mjs (exit 0):` with its eight `ok` lines and `walkthrough PASS`, and the Sepolia gas line. Before the fork-block pin, the public node failed three runs in a row with anvil's "block not found" for the newest block; Tenderly's gateway forked but answered the gas replay with "rate limit exceeded".
- **Checks** [measured]: `pnpm typecheck` and `pnpm lint` pass.
- **Bash** [measured by the reviewer]: the suite ran under `/bin/bash` 3.2.57.

## Decisions

- **Etherscan is dropped from `--verify`.** It needed a key and a newer forge than the pinned 1.0.0, which names only Etherscan's retired V1 endpoint; it had never run, and its key handling was the script's only secret in output. Sourcify needs neither. Etherscan through its API V2 is a follow-up if Rafa wants it. This removes a mode T-383 built, so it needs a line in `docs/decisions-today.md` (not this lane's file; see Handoff).
- **The verify input is the five contracts compiled alone,** not the full build's job: seconds instead of minutes, the same bytes (measured), and a smaller body (28 sources instead of 140).
- **The record waits for `finalized`,** about 13 minutes on Sepolia, up to 60 minutes. A reorg before finality could otherwise leave a record naming transactions the chain dropped.
- **A development node on chain 11155111 is a fork,** known by its client name (anvil, Hardhat, Ganache): it follows the local chain's record rules, so a fork rehearsal can never write the Sepolia record. A node that misreports its name only moves a run into the stricter rehearsal rules.
- **The fork test forks five blocks behind the head** and names the RPC's answer when `eth_simulateV1` gives none: without it, step 4 of the runbook failed on its own default RPC [measured]. Two lines beyond the brief's "prints its output", in `apps/demo-cloud/` (T-409's lane; T-409's branch does not touch this file).
- **The walkthrough CI job** is a workflow change: a separate draft pull request, with one line more for the anvil jobs' change filter, waiting for Rafa's word.

## Review and red team

**Review** (the `reviewer` agent; ISSUES, no blocking finding). Fixed: `settle_send` ran with `set -e` off as an `if` condition (Medium): it now runs as a plain command and sets `SETTLED`. A send still in flight when a run stops is now named as a possible orphan. The forge error file is removed on every exit. The verify tool never prints an RPC error's text, which could quote the URL. The pending branch has a test. Left: the stale `docs/operations.md:215` and the CI change filter (Handoff).

**Red team** (the `red-teamer` agent; ISSUES, 1 High, 3 Medium, 6 Low; every proof on a local anvil). Each finding, and what was done:
- **H1, forge signs for the chain ID the RPC answers,** not for `FOUNDRY_CHAIN_ID` [measured by the red team: five creations signed for chain 1 behind a proxy]. Fixed: `forge create --chain "$CHAIN"` on every creation; a test holds the flag on all five.
- **M1, a creation at the right nonce taken whatever its code.** Fixed: `creation_matches` runs on each creation, sent or taken from the chain, before the next one is sent; a test puts the beacon's code at the escrow's nonce and the run stops there, with one transaction on chain. The "nothing was created" message now says a send may still be mined.
- **M2, a node posing as Sepolia** (another client name on chain 11155111) **could get the record written.** Fixed: a deploy on Sepolia requires `DEPLOY_CROSSCHECK_RPC`, a second RPC (not a development node, not the same URL), which must hold every creation in the same block; tests: a second node without the creations stops the run with no record, and a deploy on Sepolia without one, or with an anvil as one, is refused.
- **M3, one node's `finalized` trusted.** Fixed by the same second RPC: both must call the last block finalized, and the lower of the two bounds the checks.
- **L1, an RPC URL in cast's and forge's errors.** Fixed: both output streams pass through a filter that replaces both URLs.
- **L2, one dropped read during the finality wait discards a deployment.** Fixed: the wait's and the cross-check's reads are tried five times, 2 s apart.
- **L3, any `VERIFY_DRY_RUN` but `1` sends to Sourcify.** Fixed: only `1` or unset is taken; a test holds `yes` refused.
- **L4, `cast receipt` waits forever for a dropped transaction.** Fixed: every receipt read takes `--async`.
- **L5, `FOUNDRY_*` settings reach a Sepolia build.** Fixed: on Sepolia any `FOUNDRY_*` or `DAPP_*` variable but the chain ID is refused; tested with `FOUNDRY_OPTIMIZER_RUNS`.
- **L6, around the record file.** Fixed: the temporary record is removed on a stop. Left: the orphan lines go to the terminal only [inferred: a closed terminal loses them].
- **Held** [measured by the red team]: mainnet and other chain IDs at the start, Ctrl-C during a send and during the wait (correct orphans), the EXIT trap under bash 3.2, the keystore password never printed, the Sourcify payload (28 sources, relative paths, no user name), the tool's limits on `--sourcify` and forks, a dirty nested submodule, one nonce per creation.

## Handoff

Done, pending the merge: the script, the two tools, the tests and the runbook, as the criteria above say. Nothing was deployed and nothing was sent to Sourcify.

For others:
1. **Rafa, a draft pull request:** the CI job that runs `site/walkthrough.mjs` on a Sepolia fork (`.github/workflows/walkthrough.yml`), and one line more for `ci.yml`'s change filter so the anvil jobs run when `scripts/sourcify-verify.mjs`, `scripts/deploy-rehearsal.mjs` or `scripts/record-copies.mjs` change (the review's point). Tier 3: his word, not merged here.
2. **A decision line** for `docs/decisions-today.md` (the coordinator's file): Etherscan verification leaves `--verify` (Decisions above); Sourcify API v2 is the one verification.
3. **`docs/operations.md:215`** (the docs batch): it still says `--verify` runs `forge verify-contract`, with Etherscan when `ETHERSCAN_API_KEY` is set. It should point to `docs/redeploy-contracts.md` step 3.3.
4. **The next real deploy** (Rafa's keystore) runs `DEPLOY_CROSSCHECK_RPC=$R … deploy-sepolia.sh $D …`: the second RPC is new and required. Not run on Sepolia [inferred from the anvil tests]: the finality wait's 13 minutes, Sourcify's real answers to a submission, and the cross-check against two public providers.
5. **Follow-ups not built:** resuming a stopped deploy; a fork mode in the rehearsal command (the runbook's step 1.2 stays by hand); Etherscan through its API V2, if wanted; the orphan list written to a file as well as the terminal.
6. **CI time:** the anvil suite's settlement shard grows by about 10 minutes on this Mac [measured: 15 tests in about 250 s before, 32 in about 860 s now]; the job's limit is 30 minutes. If it runs close, `--runs 2` in the rehearsal test can drop to 1.
