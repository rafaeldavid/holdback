# T-410: A contract redeploy is routine

- **Lane:** settlement (kind 7, the deploy script; red team on the script)
- **Phase:** 2
- **Depends on:** T-383, T-398
- **Paths this task may touch:** `contracts/script/`, `scripts/deploy-*`, `scripts/sourcify*`, `docs/redeploy-contracts.md`, their tests (`packages/settlement/evm/deploy-script.test.ts`, `tests/sourcify-verify.test.ts`), this task file; `apps/demo-cloud/src/live-fork.test.ts` for its output only, on the coordinator's brief
- **Human gate:** no for this pull request; a CI job for `site/walkthrough.mjs` is a workflow file, a separate draft pull request for Rafa's word
- **Status:** in progress
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

- [ ] `--verify` sends each of the five contracts to Sourcify's API v2 (`POST /v2/verify/{chainId}/{address}`, documented in Sourcify's `/server/openapi.json`, read 2026-11-14), then reads `/v2/contract/{chainId}/{address}` and prints one line per contract saying whether the match is exact. Proven against a stand-in Sourcify server on a local chain.
- [ ] Before sending anything, the tool compiles the five contracts with the project's settings and compares each with its code on the chain, immutables zeroed: `exact`, `code only`, or `DIFFERS`. It sends nothing unless all five are `exact`.
- [ ] The deploy passes `--nonce` to each `forge create`, waits until the deployer's mined and pending nonces agree and equal the expected nonce, and after a failed send reads the chain: a mined transaction at that nonce is taken as the creation (when it created the expected address), a pending one is waited for, and only a nonce never used is sent again, at the same nonce. Proven on anvil with a stand-in forge that fails after sending and one that fails before sending: the deployer's nonce ends at 5, the record checks.
- [ ] The record is written only once the last creation's block is finalized, to a temporary file then moved into place; a stopped run prints the contracts it created as orphans and writes no record.
- [ ] `scripts/deploy-rehearsal.mjs` runs the redeploy's steps 2 and 3 against a local anvil, on a copy of the tracked files, and prints the Sepolia command for each step.
- [ ] `live-fork.test.ts` prints the output of `examples/try.ts` and `site/walkthrough.mjs`.
- [ ] `docs/redeploy-contracts.md` names the script's commands and the record's fields, with no copied address or hash.
- [ ] A red-team pass on the script: wrong chain, a mainnet chain ID, a half-finished run, a record written before the deployment is final.

## Out of scope

- Etherscan verification (it needs a key and Etherscan's API V2; see Decisions).
- Resuming a stopped deploy: a stopped run is rerun whole, as before.
- A rehearsal on a fork of Sepolia inside the rehearsal command (the runbook's step 1.2 keeps it by hand).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
