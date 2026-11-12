# T-363: the cutover checklist for the phase-one redeploy, first pass

- **Lane:** infra (docs)
- **Phase:** 2
- **Depends on:** T-346 and T-349 (party appeals and bonds cut, on and off chain), T-356 (the smaller cuts), T-357 (the late-work settlement), all merged into `contracts-audit-ready`. The second pass waits for T-358 (two addresses in the signed terms, schema v0.11, EIP-712 domain 0.8), the refactors (R7), the remaining fixes (R8) and the deploy-script package
- **Paths this task may touch:** `docs/cutover-phase-one.md` (new), `docs/tasks/T-363-cutover-checklist.md`
- **Human gate:** no for the document. Every step the checklist describes is Rafa's: deploys, live runs, the merge to `main`, the tag
- **Status:** done (the first pass, rafaeldavid/holdback#379 into `contracts-audit-ready`; the second pass and the rehearsal are later tasks)
- **Agent/session:** author session, 2026-11-12. The brief names change kind 1 (docs); the paths are `docs/`, which `docs/team.md` lists under kind 2. Neither kind asks for a review

## Intent

The phase-one contracts on `contracts-audit-ready` cannot settle with the operators that are live today, and the live operators cannot settle on the new contracts. At the freeze Rafa redeploys the contracts on Sepolia and moves every live component to them: two operators, the test seller and buyer, the site with its pinned client, and the founder console. A wrong order strands open deals or publishes a client that signs for contracts no operator serves.

This task writes the order down as one page a person can run from top to bottom: `docs/cutover-phase-one.md`. Each step gives five things:

- who acts;
- the exact command, where one exists on the lane today;
- what the step must show before the next one starts;
- the time it takes, where a past run measured it;
- the rollback.

The page also names each point of no return and each point where stopping is safe.

- **Inputs:** `docs/operations.md` (the cutover of 2026-11-04 is the model), the Handoff sections of T-346, T-349, T-356 and T-357, the privately kept contract refinement plan's nine steps, and the code each step touches, read at the lane's tip `02ddb24`.
- **Output:** the checklist, with every line that depends on work not yet landed marked "second pass", and this file's list of what reading could not verify and what no package owns.
- **Non-goals:** no code, no script, no other doc. No deploy, no live run, no Sepolia transaction. The deploy script and the start-up guards belong to a later package. The second pass and the rehearsal on a local chain are later tasks.

## Context

- `docs/operations.md`: "Deploy", "Settlement: SimChain or Sepolia", "Sepolia contracts (T-206)", "Gates".
- ADR-0031 (the phase-one scope), ADR-0032 (the beacon rounds and the 29 s margin), ADR-0033 (the two addresses), ADR-0029 section 8 (a build and its contracts share one EIP-712 domain).
- `docs/tasks/T-346-cut-appeals-and-bonds.md`, `T-349-cut-appeals-off-chain.md`, `T-356-smaller-scope-cuts.md`, `T-357-core-late-work-settlement.md`: Handoff.
- Code read, not changed: `contracts/script/deploy-sepolia.sh`, `contracts/src/HoldbackRules.sol` (constructor, domain), `contracts/deployments/`, `examples/deployments.ts`, `examples/verify.ts` (`knownPins`), `examples/e2e-round.ts`, `examples/e2e-settle.ts`, `tests/contract-stack.test.ts`, `tests/cut-feature-alignment.test.ts`, `scripts/contract-stack.mjs`, `scripts/deploy-lib.mjs`, `tools/contract-stack/plain.json`, `site/build.mjs`, `site/check.mjs`, `site/deploy.mjs`, `apps/demo-cloud/src/worker.ts`, `apps/demo-cloud/src/world.ts`, `apps/demo-cloud/scripts/deploy.mjs`, `embed.mjs`, `dev.mjs`, both wrangler files, `apps/test-agents/src/worker.ts`, `seller.ts`, `buyer.ts`, its wrangler file and deploy script, `packages/settlement/evm/live.ts`, `testing.ts`, `apps/operator/src/server.ts` (the deal list), `.gitleaksignore`.

## Acceptance criteria

- [x] `docs/cutover-phase-one.md` exists and reads top to bottom as one run.
- [x] It follows the plan's nine steps, says where its order differs, and why.
- [x] Each step names who acts, the command, what it must show, the time where measured, and the rollback.
- [x] Every command exists on the lane at `02ddb24`, or its line is marked "second pass" with what will change.
- [x] It names each point of no return and each point where stopping is safe.
- [x] It refuses a mainnet chain ID in words.
- [x] This file lists what reading could not verify, and the gaps no package owns.
- [x] Nothing ran against a live service.

## Out of scope

- The deploy script's changes and the start-up guards (a later package, after R8).
- The second pass of the checklist (after R8) and its rehearsal on a local chain (after R11).
- `docs/operations.md`, `docs/audit/`, `site/llms.txt`: other packages own them.

## Evidence

Each item is labelled measured, inferred or guessed.

- **The checklist was checked against the lane's tip `02ddb24`** [measured: `git -C <worktree> log -1` on a worktree cut from `origin/contracts-audit-ready`].
- **Commands in the checklist that exist on the lane** [measured, each file read or listed]: `contracts/script/deploy-sepolia.sh` in both modes, `pnpm demo-cloud:deploy`, `pnpm site:deploy`, `node apps/test-agents/scripts/deploy.mjs`, `node apps/test-agents/scripts/sell-to-test-buyer.mjs`, `node site/try.mjs --seller`, `node site/build.mjs`, `node site/check.mjs`, `node examples/e2e-round.ts run|settle`, the three fork suites, `tests/cut-feature-alignment.test.ts -u`, `GET /v1/commitments` with `limit`, `cursor` and `escrowState`.
- **Findings from reading the code, each of which changed a step** [measured unless marked]:
  1. The lane's deploy script already deploys the phase-one shape: five `forge create` calls, no vault, one collector, the token passed to the rules constructor (`deploy-sepolia.sh:164-176`, changed by T-346 and T-356). The plan's note that it deploys the old shape was true of `main`.
  2. The script overwrites `contracts/deployments/sepolia.json` (`:302`), so the old record is copied before the deploy.
  3. The test seller and buyer open no deal on their own. A deal starts when an outside party posts to them; their alarm only advances open deals (`apps/test-agents/src/worker.ts:98-110`). No pause or drain switch exists in the operators or the agents (a search of `apps`, `packages`, `examples`, `site`, `scripts`).
  4. Every deploy script refuses a checkout that lacks `origin/main`'s commits (`scripts/deploy-lib.mjs:100`). So `main` must not move during the cutover, and the lane must hold `main` before it starts.
  5. A world refuses to open against another rules address (`apps/demo-cloud/src/world.ts:507`), and a new world writes its rules address before the chain is checked (`:503`, `:915`). So the world's name and the record change in one commit.
  6. A new world draws a new secret (`world.ts:503`), so the three demo adjudicators and the demo club get new addresses and a new rulebook hash.
  7. Each deployment creates a new test token (`deploy-sepolia.sh:173`), so every balance starts at zero in the new world.
  8. The demo club's rulebook already limits settlement payouts to the two parties, on `main` and on the lane (`packages/settlement/sim/actors.ts:74`). Only two test rulebooks still allow any payee (`packages/settlement/evm/testing.ts:71`, `packages/testkit/src/stub-terms.ts:26`).
  9. gitleaks flagged the deployment record and its three copies at both earlier deployments (`.gitleaksignore:34-36`, `:49-55`). The ignore file is Rafa's.
  10. The local dev world runs on SimChain only (`apps/demo-cloud/scripts/dev.mjs:5-6`), and every anvil world replaces the gas estimate. So no tool on the lane measures an escalation's estimate on a real Sepolia RPC before the operators run on the new contracts.
  11. The lane's contracts still sign under domain "Holdback" 0.7 (`HoldbackRules.sol:537`), as the deployed ones do. Until T-358 moves the domain, the start-up check cannot tell the old contracts from the new.
  12. The repository has no git tag [measured: `git tag` printed nothing].
  13. The pilot's rehearsal cases (`pnpm audit-deal --case`) are on `main` (T-355) and not on the lane, whose tool takes `--live` only.
- **Local checks** [measured]: see "Checks run" below.
- **Snapshot diffs:** none. **Metrics:** none.

### Checks run

- `pnpm exec vitest run tests/cut-feature-alignment.test.ts` on the worktree, with both files staged: 1 file, 2 tests passed [measured]. The test scans `docs/cutover-phase-one.md`. The page names two fields of cut features, on a line marked "not in phase one", so the known list does not grow.
- No site file changed, so `node site/build.mjs && node site/check.mjs` did not run. CI is the gate for the rest.

### What reading could not verify

1. **No command in the checklist ran.** Each is read from a script's source or copied from `docs/operations.md`. The rehearsal after R11 is the first run.
2. **The list of deals that are not final** uses `finalAt == null` on `GET /v1/commitments`. Whether an expired, unfunded offer carries a `finalAt` on the deployed build is not checked [guessed that it does].
3. **The old world's Durable Object after the cutover.** The checklist says its alarm fails to open and the runtime gives up [inferred from `world.ts:507` and `worker.ts:117-130`]. No test shows it.
4. **Whether two worlds can collide on the relayer's nonces.** They share the relayer key. The checklist relies on finding 5 to keep one world silent [inferred].
5. **The deploy's duration and gas for the phase-one shape.** The only measurement is the old shape: 75,443,236 gas on 2026-11-03 (`docs/tasks/T-206-contract-review.md:126`).
6. **Whether a deploy rehearsal on an anvil fork still passes** with the lane's script. `docs/operations.md` documents it for the old script.
7. **Whether `predeploy-fork.test.ts` applies to a new world.** It was written for T-220's upgrade in place.
8. **Which fixtures that record the old addresses must follow the new record:** `tests/metrics/fixtures/discovery.json`, `tests/metrics/fixtures/deal-once.events.json`, `examples/e2e-run.test.ts`, `examples/e2e-adjudicator.test.ts`. They read as records of past runs [inferred].
9. **The founder console.** Its code and deploy commands are private. A search of the private repository found files that name the old rules address or start block; this task read none of them.
10. **Scheduled jobs outside the repository** that could open a deal on the live service (the console's builds, a metrics harness). None was found in the public repository.
11. **The explorer verification command.** No such command or API key variable exists in the repository; the one the checklist names is a guess.

## Decisions

1. **The checklist numbers its steps in the order they run, and maps the plan's nine steps onto them.** The plan's numbers stay visible beside each step.
2. **The fork suites run before the operators deploy,** not after as the plan orders them. They need only the new record and a read-only RPC, and they are the one proof that this build settles on the new contracts before a live component changes.
3. **The escalation's gas is measured right after the smoke deal,** before the test agents and the site move. The plan asks for it before anything deploys; finding 10 says no tool can do that today. The gap is listed for the coordinator.
4. **The quiet starts first and is checked again immediately before the operators deploy.** The contract deploy, the record and the fork suites do not touch the old world, so it keeps serving until then.
5. **The checklist runs from one cutover branch cut from the frozen lane tip, and merges to `main` at the end.** The cutover of 2026-11-04 did the same from `t-212-sepolia-redeploy`. `main` then never holds a build that cannot settle on the record it carries. The other order (merge first, deploy from `main`) is listed as Rafa's choice.

None of these changes architecture, a contract or a defense.

## Handoff

**Done:** the first pass of `docs/cutover-phase-one.md`, checked against the lane at `02ddb24`.

**Not done:** the second pass (after R8 and the deploy-script package), the rehearsal on a local chain (after R11), and every edit the checklist asks of other files.

**How to resume the second pass:** search the checklist for "Second pass". Its last table lists every such line with the work it waits for. Re-run the pin sweep in step 4 against the lane's tip, and re-read `deploy-sepolia.sh` against `HoldbackRules`' constructor.

**"Second pass" lines, by what they wait for:**

| Waits for | Lines |
| --- | --- |
| T-358 (schema v0.11, domain 0.8) | The domain and schema versions each read must show; the domain pins in `examples/verify.ts`, `site/llms.txt` and `packages/core`; the SimChain world's new name; the demo club's minimum appeal window against a required window of 0; the faucet's two addresses |
| R7 and R8 | The rules constructor's arguments (the 29 s beacon margin and any refactor's change), so the script's `create` line, its creation-code check, its wiring checks and the record's `args`; the fallback's wake-up time in the world |
| The deploy-script package | The script's final shape; a start-up check of `TOKEN()`; a start-up refusal of an old world; explorer verification |
| AL-1 (code alignment) | The Sepolia round's phase-one scenario list, so the escalation measurement's command; the three fork suites rewritten for the phase-one record; the pinned client without the cut features |
| AL-2 (words and the console) | `docs/audit/scope.md` naming the frozen commit; `site/llms.txt`'s phase-one text; the console's pins; `main` merged into the lane, which brings `pnpm audit-deal --case` |
| R11 and the rehearsal | Measured times for each step; the rehearsal's corrections |

**Gaps no package owns, for the coordinator:**

1. **No drain switch.** Neither the operators nor the test agents can refuse new deals while they finish open ones. Step 1 is a race against any stranger who runs the site's one command.
2. **No tool sends a timeout to an old deployment once the operators have left it.** Every timeout takes the full signed terms (`HoldbackRules.reclaim(Terms)`), and the lane's client is pinned to the new record. A deal left open needs a rollback or a hand-built call.
3. **No way to measure an escalation's gas estimate on a real Sepolia RPC before the operators run on the new contracts** (finding 10). The plan's step 2 cannot run as ordered.
4. **Explorer verification** has no command, no API key variable and no owner. The live deployment is not verified today.
5. **The `.gitleaksignore` entries for the record commit** are Rafa's to add, and they can only name the commit once it exists. The cutover's pull request fails gitleaks until then.
6. **No command derives the record's copies.** `examples/deployments.ts` and the literal pins in `site/llms.txt` are hand edits; tests catch a mismatch after the fact.
7. **The world names and the test agents' object name.** `WORLD_NAMES` (`apps/demo-cloud/src/worker.ts:61`, both the Sepolia and the SimChain name) and `OBJECT_NAME` (`apps/test-agents/src/worker.ts:40`) are not in any package's list.
8. **The two test rulebooks that still allow any payee** (finding 8). T-356 placed them with the cutover; they are test code and should land before the freeze.
9. **The tag:** its name, the commit it points at and who pushes it. The repository has none to copy.
10. **The operator's gas quote** (`OPERATOR_FEE_GAS`, 4.70 tUSDC) was measured on the old contracts. Nobody owns re-measuring it on the new ones.
11. **Rafa's choice of branch model and a rule that `main` takes no merge during the cutover** (decision 5, finding 4).
12. **The adjudicators' deposits in the old vault** (25,000 tUSDC each, test tokens). The world has no withdrawal path; the checklist records them and leaves them.
13. **No staging operators.** The first run of the lane's Workers on Cloudflare is the live deploy; its own smoke deal and rollback are the only net.
14. **`predeploy-fork.test.ts`'s place** in a cutover to a new world (item 7 of what reading could not verify).

**Open questions:** none blocks the first pass.
