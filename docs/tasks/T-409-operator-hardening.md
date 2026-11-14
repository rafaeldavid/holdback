# T-409: operator hardening before the partner's first deal

- **Lane:** first pilot
- **Roadmap row:** N80, N92
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 5, settlement and judgment code (Change recipes): the packages' tests with anvil, one review and one red team, a target of 250k tokens. The demo world's test is kind 4.
- **Depends on:** T-347 (PR 346) and T-372 (PR 389), both merged and live
- **Roadmap:** N80 ("A delivery with no stored ciphertext can't stall the adjudicator for other deals") and N92 ("The read-after-write attacks run against the phase-one adapter"), both marked "before design partner A's first deal"
- **Paths this task may touch:** `apps/demo-cloud/` and its tests; the operator's relay and read paths in `packages/settlement/evm/` (`live.ts`, `sync.ts`, `timeouts.ts`, `errors.ts`, `chain.ts`, the read model in `evm-settlement.ts`) and their tests; `tests/read-after-write*.test.ts`; the read-after-write rule in `eslint.config.js`; this file. Never: `contracts/src/`, `spec/schemas/`, `examples/seller-adapter*.ts`.
- **Human gate:** no for the code. The operators change only with a deploy, which waits for Rafa.
- **Status:** done (pull request 512, merged 2026-11-14; both operators deployed 10:43 UTC)
- **Agent/session:** the T-409 session, 2026-11-14, branch `t-409-operator-hardening`, worktree `.worktrees/holdback-T-409`

## Intent

**N80 is mostly built already.** The roadmap row's `starts` field still lists four open items, but T-372 (PR 389, merged 2026-11-12 at 07:21 UTC, live from the operator deploy of 07:22 UTC) built all four: a time limit on every store read the adjudicator's pass awaits, the demo world's refusal on the state read, the cleared decline, and the relay's check of its own store. Its tests pass on today's `main` [measured below]. What T-372 did not show is the hung deal itself reaching its outcome on the phase-one contract: its tests run on the in-memory settlement and stop at "the deal stays Delivered, retried". This task adds that proof on anvil: a store that never answers for one deal's ciphertext, the other deal judged, and the hung deal closed by the default outcome at fallbackBy, with the operators' own timeout pass sending it.

**N92 is the real work.** T-232's review round (four commits on the archived branch `archive/t-232-review-round-backup`, `3515172` to `f576398`) never reached `main`. Its red team found that the operator's chain relay can be made to read stale state or reuse a nonce: one wrong head from an RPC node raises the read floor past the chain, an answer to a mined relay is lost when a balance read fails, a lane's remembered nonce stays too high after a reorg, a node's "no such block" answer in some shapes is taken as a revert, a stale book reaches a stranger's direct takeover, and the lint rule that keeps chain reads pinned has bypasses. This task ports those tests to the phase-one adapter, adds the fixes they need, and says which no longer apply.

## Acceptance criteria

- [ ] T-372's tests for the four N80 items pass on `origin/main` (measured, named).
- [ ] An anvil test in the demo world: one deal's ciphertext read never returns; another deal in the same world is judged and Released; the hung deal ends by the default outcome (Refunded to the buyer's payment address) by fallbackBy plus the operators' timeout pass, and the world logs the refusal. It runs in CI's anvil job.
- [ ] The relay check (item 2) is described against the three litmus tests (Decisions).
- [ ] Each of the archived branch's red-team tests either runs in CI against the phase-one adapter and passes, or is listed below as not applying, with the reason.
- [ ] Each test that needs a fix fails on `main` before it (measured) and passes after.
- [ ] The packages' tests (`packages/settlement`, `apps/demo-cloud`, `tests/read-after-write*`) with anvil, `pnpm typecheck` and `pnpm lint` pass.
- [ ] One reviewer pass and one red-team pass that tries to make a deal settle wrongly or stall through the store and the relay; Critical and High findings fixed.

## Evidence

All runs on 2026-11-14, on branch `t-409-operator-hardening`, from `origin/main` at `b9e33a9`, on the Mac with anvil 1.0.0 and `forge build` output. The logs are in `reports/scratch/t-409/` and `reports/scratch-t409-*.log` in this worktree (git-ignored).

**N80, items 1 to 3: built by T-372 and still holding.**
- **T-372's tests pass on today's `main` (measured).** `pnpm exec vitest run apps/adjudicator/src/hung-read.test.ts apps/operator/src/relay-store.test.ts apps/demo-cloud/src/refusals.test.ts apps/adjudicator/src/unreadable-delivery.test.ts`: 4 of 4 files and 33 of 33 tests passed.
  - The hung read: `hung-read.test.ts`, which includes `neutrality.store-hangs`.
  - The relay check: `relay-store.test.ts`, which includes `neutrality.operator-lacks-ciphertext`.
  - The two state-read fixes, the adjudicator-unavailable refusal and the cleared decline: `refusals.test.ts`.
- **The new test on the phase-one contract (measured).** `neutrality.store-hangs on the contract` is in `apps/demo-cloud/src/timeouts.anvil.test.ts`. It passed in 183 s. In one world on anvil, the store never answers reads of one deal's ciphertext:
  - The relay's 2 s check gives up, and the delivery still lands.
  - The demo primary judges the other deal inside its window, and it is Released.
  - The hung deal's state read says "cannot judge this deal yet … It tries again on each pass."
  - No `judgment.decided` is logged for the hung deal.
  - The operators' timeout pass sends `default.triggered` at or after fallbackBy. The deal ends Refunded on the contract, and the buyer's payment address gets the held amount back.
  - Every world error names the hung deal; none names another deal.
- **The test catches the stall (measured, a mutation run).** With `DEFAULT_STORE_READ_TIMEOUT_MS` set to Infinity in `apps/adjudicator/src/service.ts` (local only, restored after), the same test failed at its 360 s limit: the pass never returned, and the other deal was never judged.
- **The test runs in CI (inferred from `.github/workflows/ci.yml`).** The anvil job's world leg names `timeouts.anvil.test.ts` and fails if a test skips. So the test needs no CI change.

**N92: T-232's review-round red team, ported to the phase-one adapter.**
- **Every test on the archived branch is ported; none was dropped (measured).**

  | Archive test | Where now | Before the fix | After |
  | --- | --- | --- | --- |
  | `neutrality.t232-rpc-bogus-head` | `packages/settlement/evm/t232-redteam.test.ts` | passed (PR 239's merge `e87672b` already raises the floor only after the contract answers) | passes |
  | `attack.t232-answer-read-fails-after-relay` | same file | failed: the first submit threw `BlockNotFoundError`, each retry with the same key was refused `invalid_state`, the lane row stayed open and the takeover past fallbackBy was deferred, so the deal stalled | passes |
  | `attack.t232-mined-nonce-after-rollback` | same file | failed: `transaction already imported` on every try, and the lane never freed | passes |
  | A node's missing-block answer in every shape (-32000, -32001, -32602, -32603 and others; 7 shapes on eth_call, eth_getBalance and eth_estimateGas, plus 3 revert cases, 24 tests) | `packages/settlement/evm/read-after-write.test.ts` | passed (`e87672b`) | passes |
  | A sync pass whose head trails this node's write says so | same file | failed: it returned null | passes |
  | `attack.t231-behind-stale-book-direct-takeover` | `packages/settlement/evm/timeouts.redteam.test.ts` | passed | passes |
  | 24 lint bypass and disable cases | `tests/read-after-write.lint-bypass.test.ts` | 17 failed | passes |

  The adaptations to phase one: no bond deposit or bond vault approvals (T-349's `429adfb` removed them), ERC-3009 funding through `EvmDeal`, and no `Expired` stage or appeal field.
- **Not applying: none.** Every attack in the archive works without bonds.
- **Before the fixes (measured).** On anvil, 3 of 46 tests in the three settlement files failed. In the lint test, 17 of 24 failed. The ported tests were committed alone as `5a6843d`.
- **After the fixes (measured).** `pnpm exec vitest run packages/settlement tests/read-after-write.lint.test.ts tests/read-after-write.lint-bypass.test.ts`, with anvil: 22 of 22 files and 346 of 346 tests passed, 0 skipped.
- **The ported tests run in CI (inferred from `ci.yml`).**
  - The three settlement files run in the anvil job's settlement leg, which runs `packages/settlement/evm` and fails on a skip.
  - The lint test runs in the test shards, since `vitest.config.ts` includes `tests/**/*.test.ts`.
- **Types and lint (measured).** `pnpm typecheck` and `pnpm lint` exit 0 on the branch, with the stricter rule, which covers `apps/*/src`.
- **The red team's findings as regression tests (measured).** `packages/settlement/evm/t409-redteam.test.ts`: 15 of 15 failed at `9901060`, before the fixes; 16 of 16 pass at the tip. After the fixes: `packages/settlement` and both lint tests, with anvil, pass 23 of 23 files and 362 of 362 tests, 0 skipped. `pnpm typecheck` and `pnpm lint` exit 0. The M1 fix changed two existing expectations (`ff4f9f0`): a direct reclaim now reaches the book at the timeout pass's `WrongStage`, so the next sync finds it already applied (`applied: 0`, not 1). Both tests still assert that nothing is sent and the deal ends Refunded.
- **CI's whole world leg at the tip, after the red-team fixes (measured).** The eight files the anvil job's world leg names, plus `refusals.test.ts`, `hung-read.test.ts` and `relay-store.test.ts`: 11 of 11 files and 71 of 71 tests passed.
- **The rest of CI's world leg, which the nonce and sync changes reach (measured by the reviewer, before the red-team fixes).** `live.test.ts`, `lanes.test.ts`, `one-world.anvil.test.ts` and `registration.anvil.test.ts` in `apps/demo-cloud/src`: 4 of 4 files and 12 of 12 tests passed. `timeouts.anvil.test.ts`: 2 of 2 tests passed in 292 s.

## Decisions

1. **N80's items 1 to 3 are not rebuilt.** T-372 built them, and they went live with the operator deploy of 2026-11-12 at 07:22 UTC. The roadmap row's `starts` field is out of date; the coordinator owns `roadmap/`. This task adds only what T-372 left unshown: the hung deal reaching its outcome on the phase-one contract.
2. **The relay refuses; it does not mark (T-372 Decision 7, kept).** An operator whose own store answers a definite "not held" for a delivery's ciphertext refuses to relay it, with `relay_refused` (403) and the next step. A store that fails, or does not answer within 2 s, lets the relay go on. Against the litmus tests:
   - **Neutrality.** The refusal is this operator's alone. Nothing reaches the settlement layer, and the same signed delivery still goes through another operator that holds the bytes, or straight to the contract (`neutrality.operator-lacks-ciphertext`). A hung store cannot stop the relay either: the check gives up after 2 s (the new test shows it). A mark would have to travel with the delivery to the chain or to other operators, and one operator's view of its own store would then shape every operator's book.
   - **The hold.** A refused delivery changes no state. The funds stay held under the same deadlines, and the seller can upload and send again before deliverBy. Past deliverBy the buyer reclaims, as for any undelivered deal.
   - **Judgment.** A delivery that does land without readable bytes is still never judged: the adjudicator refuses it, signs nothing, retries, and the default outcome applies at fallbackBy (T-347, T-372, and the new test). The relay check only moves the news to the seller earlier.
   - **D32.** The seller protects itself by uploading first, and the refusal tells it how. A mark would add settlement-side machinery for a step the seller controls.
3. **The archive's tests go to the files CI already runs.** The new demo-world test joins `timeouts.anvil.test.ts` rather than a new file, so no change to `.github/` (Rafa's) is needed.
4. **Three fixes and the lint hardening are ported; three parts of `f33e41f` are not.**
   - **Ported:**
     - `view(…, { bestEffort })` in `evm-settlement.ts`: the answer to a mined write is stored and replayed, and its lane row released, even when a balance read fails.
     - `nextNonce` in `live.ts`: the larger of the pending count and the mined count at the pinned block, read each time. It replaces the remembered `minedNonce`, which a reorg could leave too high.
     - The sync's throw in `sync.ts`: a pass whose head trails the floor now says so instead of returning null.
     - The lint rule from `7f15407`, with two call sites in `evm-settlement.ts` written so the rule sees them.
   - **Not ported, because no test needs them on today's code:**
     - `missingBlock` in the timeouts check. Measured: viem's `call` gives `CallExecutionError` with no "revert" in the message for -32603, -32000 and -32602.
     - The move of `missingBlock` into `errors.ts`.
     - The `pinned`/`newest` signature tidy-up.
   No event is removed.

## Review and red team

**CI on PR 512's first head (`57ca272`), two failures, both fixed.**
- **`test (4/4)`, the cut-feature alignment test, failed on progress.** `read-after-write.test.ts` no longer names a cut feature (the port dropped its `permit2Collector` field), so the known list had one file too many. The list was rewritten with the test's own `-u`; the diff is that one removal.
- **CodeQL `js/polynomial-redos` (alerts 26 and 27, `errors.ts`), a real finding.** `missingBlock`'s pattern `block at number .* could not be found` backtracks polynomially on a long message, and an RPC node controls that message. Measured with `node`: 20,000 repetitions of "block at number " took 9,704 ms with the old pattern and 0 ms with the new one. The pattern now matches only viem's quoted identifier, `block at (number|hash) "…" could not be found`, at most 80 characters. A test in `t409-redteam.test.ts` reads 200,000 repetitions in under 1 s, and still recognises viem's own messages.

**Reviewer (one pass, 2026-11-14): ISSUES, all Low or Info; nothing blocking.** Its runs are in the Evidence.
- **Fixed:**
  - Low 1: the lint test's comment pointed at `docs/team.md` for the rule's known limits, but that doc does not list them. The pointer is gone.
  - Low 4: the evidence for the other world-leg files is added.
- **Recorded, not fixed:**
  - Low 1: `docs/team.md:146` (Rules and checks, "A chain read after a transaction") still says a trailing sync "reads nothing". It also names neither the stricter lint rule nor best-effort answers. That doc is outside this task's paths (Handoff).
  - Low 2: the lint rule has more syntax bypasses. The red team found them too (L4 below).
  - Low 3: one nonce case lost its floor. The red team proved it (L3 below), and it is fixed.
  - Info: `docs/neutrality.md:27` names only the in-memory `neutrality.store-hangs` (Handoff).

**Red team (one pass, 2026-11-14): no Critical or High findings; 1 Medium and 4 Low.** Its probes are in `reports/scratch/t-409/redteam/`.
- **Fixed, each with a regression test in `packages/settlement/evm/t409-redteam.test.ts`:**
  - **M1, a sync gap (older than this branch).** One sync pass whose `eth_getLogs` came from a backend more than 3 blocks behind moved the cursor past a direct reclaim. The operator's book then said Held for good, while the chain said Refunded. Now a `WrongStage` answer to a due timeout reads that one deal's transactions from the chain again.
  - **L2, a missing block read as a revert (older than this branch).** A node's "no such block" answer that carries `data` was read as a contract revert by the timeout check and by the relay's simulation. Now both check for a missing block first. This reverses part of Decision 4.
  - **L3, a reused nonce on the funding lane (caused by this branch).** A receipt whose block read then failed dropped the funding lane's nonce cache, and the next send on a trailing node reused the mined nonce. Now the cache stays once a receipt is found.
- **Recorded, not fixed:**
  - **L1.** The relay check passes a delivery whose URI does not end in its signed hash, and the demo adjudicators read by that tail. Only the seller, who chose the URI, loses (D32). The deal defaults to a refund, and the buyer gets no key. Follow-up: the demo store's reader falls back to the signed hash, or the relay refuses a URI whose tail differs.
  - **L4.** The lint rule still has 18 syntactic bypasses (casts, `.call` and `.bind`, aliases made by assignment, template members, `null` or `void 0` blocks, `getCode` and `getProof`). The covered files use none of them today [measured by grep]. The rule is a guard against our own mistakes, not a runtime defence. Follow-up: a typed reader that hides `publicClient`.
- **What held:**
  - One wrong head does not raise the floor.
  - An answer to a mined write survives a failed balance read.
  - A trailing head throws, and nothing depends on the old null.
  - A hung store costs only its own deal on the contract.
  - Wrong bytes from a store are refused twice: by the store's hash check and at intake.
  - A relay refusal is not stored as an idempotent replay.

## Handoff

**Done.**
- N80: T-372 had built all four open items, and they hold on today's `main`. A new anvil test shows a hung store read costing only its own deal on the phase-one contract.
- N92: every T-232 review-round attack runs against the phase-one adapter in CI; none fails to apply. The three fixes those attacks need, and the lint hardening, are ported.
- The red team's M1, L2 and L3 are fixed, each with a regression test.

**What an operator deploy changes** (`pnpm demo-cloud:deploy`; both operators). No new variable, secret or contract.
- The relay answers a mined write even when the balance read after it fails. Before, a retry with the same key was refused `invalid_state`, and the deal's lane stayed blocked.
- A lane's nonce after a refusal, a give-up or a reorg is read from the chain at the pinned block, not remembered.
- A sync pass against an RPC that trails this node logs one `demo world:` line instead of skipping silently. Expect more such lines in the Worker log when Sepolia's RPC lags.
- A due timeout that the contract refuses with `WrongStage` makes the operator read that deal's transactions again. A book that missed a direct transaction then heals. Each such read costs one log scan from the deployment's first block (inferred: a few `eth_getLogs` calls).
- A node's "no such block" answer is retried and reported as an RPC failure, never as a contract refusal.

**How to check it live, after the deploy** (plain GETs):
1. The script's own smoke deal (`examples/try.ts`) ends Released within 180 s.
2. `GET https://api.crow.direct/.well-known/holdback.json` and the same on `api2`: `demo.build.commit` names the deployed commit.
3. `GET https://api.crow.direct/v1/status`, and the same on `api2`, answers 200.

**Follow-ups not built:**
- **L1:** the relay check and the demo adjudicators disagree on which hash a delivery's URI names.
- **L4:** the lint rule's remaining syntactic bypasses (a typed reader would close them).
- **M1, broader:** the sync cursor still trusts one `eth_getLogs` answer. M1 heals a deal only when a due timeout meets the gap. Reading the logs and the head from the same backend would close it at the source.
- **The resync's trigger:** it matches the adapter's wording (`FUNDED_ON_CHAIN`); a typed refusal code would remove that dependency.
- **`docs/team.md:146`:** describe the stricter lint rule, the throwing sync and best-effort answers.
- **`docs/neutrality.md:27`:** name the on-contract `neutrality.store-hangs`.
- **The roadmap:** N80's `starts` field still lists items T-372 built; the coordinator owns `roadmap/`.

**How to resume.** Run `pnpm build`, then `pnpm exec vitest run packages/settlement/evm/t409-redteam.test.ts packages/settlement/evm/t232-redteam.test.ts apps/demo-cloud/src/timeouts.anvil.test.ts` with anvil and `contracts/out`.
