# T-219: An in-flight row per relayer lane, written before the broadcast

- **Lane:** settlement (with demo, for the store)
- **Phase:** 2
- **Depends on:** T-218 merged first. This task edits `packages/settlement/evm/live.ts` and `evm-settlement.ts` after T-218's changes, and a recovered transaction is applied through T-218's log sync.
- **Paths this task may touch:** `packages/settlement/evm/live.ts`, `chain.ts`, `evm-settlement.ts` (only telling this node's recovered relays from direct calls), and their tests (`live.test.ts`, `receipt.test.ts`, `evm-settlement.test.ts`); `apps/demo-cloud/src/lanes.ts` (new: the row store over the Durable Object's storage) and its test; `apps/demo-cloud/src/worker.ts` and `world.ts` (only to hand the store to `LiveChain`); `docs/decisions/ADR-0028-demo-settles-on-sepolia.md` (a dated note in §11); `docs/operations.md` (the "deploy while no deal is mid-step" warning); `docs/backlog.md` (its row); `docs/plan.md` (this row); this file
- **Human gate:** no. The live deploy is T-220's.
- **Status:** done (merged in PR 195; live with T-220's deploy)
- **Agent/session:** T-219 workflow session, 2026-11-04 (branch `t-219-lane-in-flight-row`, worktree `.worktrees/t-219`)

## Intent

Each relayer lane sends one transaction at a time and waits for its receipt (ADR-0028 §3). It keeps what it sent only in memory. A Durable Object that restarts between the broadcast and the receipt, on a deploy or an eviction, forgets the transaction: it still lands on chain, but the operators' view misses it. Seen live at the cutover (T-213 Evidence): a decision landed with `KeyReleased` on chain while the operators' log stopped at the delivery, so the buyer's key was on chain but not served. `docs/operations.md` tells deployers to deploy holdback-op1 only while no deal is mid-step.

Restated: before each broadcast, the lane writes one row with what it is sending and why. After a restart, the world reads the rows and resolves each one: a mined transaction is applied as this node's own relay, and a pending one is rebroadcast as it was, never replaced by another message at its nonce. T-218's sync already applies a missed receipt from the logs, as a direct call. This task makes the recovery exact: the right label, the off-chain parts the adapter held (the delivery's envelopes), the nonce, and the client's retry.

The design is in the research pass, `docs/research/2026-11-03-sepolia-demo-settlement.md` §2 (the `lane:<n>` row) and ADR-0028 §11.

As the implementing session understood it (2026-11-04): a deploy must not cost a deal step. The node writes down what it is about to broadcast before it broadcasts, and after a restart it finishes that broadcast as if nothing had happened. The log, the envelopes, the buyer's key, the lane's nonce and the client's retry all come out the same as an uninterrupted run. Non-goals: more than one transaction in flight per lane; rows for the funding lane (faucet mints, top-ups, bond setup); persisting the operator's own idempotency records; any change to what a direct call (T-218) is labelled.

## Context

- ADR-0028 §3 (lanes, serial per lane, rebroadcast and fee bump), §11; `packages/settlement/evm/live.ts` (`sendNow`, `broadcast`, `nonces`).
- T-213 Evidence ("The homepage command, live") and Handoff (the deal it left behind, `0x804d3fb3…5af0`).
- The backlog row "Idempotency records (operator and faucet) live in memory" (T-026).

## Acceptance criteria

- [x] **The row.** Before each broadcast on a deal lane, the lane writes one row:
  - the lane and the nonce;
  - every hash sent at that nonce (rebroadcasts and fee bumps);
  - the raw transaction;
  - the submission: the message, its `Idempotency-Key` and body hash, and what the adapter holds off chain for it (such as a delivery's envelopes).

  The row is removed only after its receipt has been applied.
- [x] **Recovery.** When the world opens, and on its next pass, each row is resolved:
  - **mined:** applied once, as this node's relay, through T-218's path. Its events are labelled as a relay is, the adjudicators get their envelopes, and the buyer's key is served;
  - **pending:** the same raw transaction is rebroadcast; no other message is ever sent at that nonce;
  - **not found after the receipt timeout:** rebroadcast, then the existing give-up rule.
- [x] **The nonce.** After a restart a lane's nonce is the row's nonce plus one once that row is mined. It is never read from `pending` while a row is open.
- [x] **The client's retry.** A retry with the same `Idempotency-Key` and body as a recovered submission gets the mined result, not `invalid_state`. The same key with another body gets 409 (hard rule: idempotency).
- [x] **The cutover case, tested.** On anvil with `--block-time 1`, the world stops between broadcast and receipt for a funding, a delivery and a decision, then reopens from the same storage. Its log then matches an uninterrupted run's, and the buyer reads its key.
- [x] **Cost.** One row written and one deleted per transaction, and at most one row read per lane when the world opens [measured with T-031's counters].
- [x] **Docs.**
  - `docs/operations.md`: the warning to deploy holdback-op1 only while no deal is mid-step is replaced by what the row now guarantees, or kept with the limit that remains.
  - ADR-0028 §11 gets a dated note, and the backlog row is closed.
- [x] **Review.** `reviewer` and `red-teamer`, each with project context (relayer code: the relayer relays and never authors). `pnpm verify` green. Six findings, all fixed with a test each (Evidence, "Review and red-team").

## Out of scope

- Several transactions in flight per lane (ADR-0028 §3 keeps one).
- The funding lane's sends. Its setup steps are idempotent against on-chain reads. A faucet grant whose answer is lost in a restart may mint again when the client retries: test tokens only (inferred).
- The operator's other idempotency records, which stay in memory (backlog).

## Evidence

**`pnpm verify`** (measured, commit `113976a`, after merging origin/main with T-218 as merged in PR 185, 2026-11-04, `reports/verify-t-219-lane-in-flight-row.md`): PASS. typecheck, lint, forge build, forge test, `pnpm test` (118 files passed and 1 skipped; 2,665 tests passed, 4 skipped), spec, snap, snap:local and demo all pass. Snapshot diffs against HEAD: none, and `reports/differential-local.md` is unchanged. Before the merge, on T-218's branch, verify also passed (112 files, 2,480 tests); its first run had failed lint on two lines in the new tests (an unused import, a `let` that could be `const`), both fixed.

**Each acceptance criterion** (measured unless labelled; anvil stands in for Sepolia):

| Criterion | Test | Result |
| --- | --- | --- |
| The row, written before the broadcast | `live.test.ts`, "writes the row before the broadcast…" | When the row was written, anvil's pool held no transaction. The row names lane 1, its sender, the nonce, `hashes: [keccak256(raw)]` and the note. It stays after the receipt and goes on `release` |
| Every hash at the nonce | "a fee bump rewrites the row…" | The second write holds both hashes, and the pool still held only the first transaction when it was written. Same nonce, higher fee |
| A refused broadcast | "a broadcast the node refuses removes its row" | Write, then remove; `relay_refused` for a lane with no test ETH |
| Mined after a restart; the nonce | "after a restart, a mined row sets the lane nonce…" | The next send on the same lane took the row's nonce plus one; `getTransactionCount` was never called |
| Pending after a restart | "a pending row is rebroadcast as it was…" | After anvil dropped it, the pool held the row's own hash again. A queued send on the same lane waited, so for 1 s nothing else went out at that nonce; the queued send took the next nonce |
| Not found after the timeout | "a row not found after the receipt timeout…" | Rebroadcast once, given up after the 300 ms window, row removed; the next send read `pending` and reused the nonce |
| Recovery as this node's relay, and the retry | `evm-settlement.test.ts`, "a funding, a delivery and a decision each land as the relay after a restart…" (22 s) | After each restart the deal's events equal, field for field, the ones the uninterrupted relay wrote (`toEqual`). The labels are `op-1`, with `commitment.agreed` from the adapter and the fee line. The primary got its envelope; the buyer's key is served. Retries answered `replayed: true` (funding: Held, delivery: Delivered); another body under the funding's key answered `idempotency_conflict`. With the row lookup disabled, the same test fails at the retry |
| The cutover case | `lanes.test.ts`, "reopens from the same storage after each money step…" (32 s) | The world stopped after the broadcasts of `agreeAndFund`, `deliver` and `decide`. Each new world opened on a copy of the storage. try.ts ended Released, and "the buyer decrypted its copy, sha256 checked". The deal's log has the same shape (type, label, actor's role, source, key path, recipient's role) as an uninterrupted try.ts run. The retried funding and delivery requests got their mined results; the same funding request again answered 200, and another body under its key 409 `idempotency_conflict` |
| Cost | `lanes.test.ts`, "keeps one row per lane and nonce…" (T-031's counters) and the cutover case | Opening with no row: 1 row read. A row written: 1 row written. A row deleted: 1 row written. Opening with two rows: 2 rows read. In the uninterrupted world: 3 lane rows written and 3 deleted for the deal's three transactions. Each restarted world read 1 lane row when it opened |

- Run three times in a row, the cutover case passed each time (measured). The path that lands the row varies with timing: the new world's first pass, or a retried request for the same deal first. Each world landed its row once: the recoveries reported `applied: 1` or `seen: 1`, and none failed.
- `pnpm vitest run packages/settlement/evm`, before the merge: 8 files, 91 tests passed, including T-218's `sync.test.ts` and `wall.test.ts` unchanged (measured). After the merge, the three T-219 test files passed (41 tests), and so did the whole suite in `pnpm verify` (measured).
- On Sepolia, a restart mid-step behaves the same (inferred). T-216's scenario 11 checks it live after T-220's deploy.

### Review and red-team, 2026-11-04

The workflow's `reviewer` and `red-teamer` passes on PR 195 returned six findings: one Medium and five Low. Two of them (review Low 1 and red-team Medium 3) are the same defect. The fix session wrote each test first and saw it fail on the reviewed code, then fixed the code (measured unless labelled).

| # | Severity · finding | Fix | Test, failing before and passing after |
| --- | --- | --- | --- |
| 1, 3 | Medium · `send` and `landFee` released a row before `process` stored the Idempotency-Key answer. A persist from another request during the answer's balance reads deleted the row, so a restart then answered the retry `invalid_state` | `process` collects the hashes its submission landed (`Relay.landed`) and hands them to `relayed` only after `book.replays` is set, or on a refusal after a revert. `landFee` no longer releases; `land`'s fee branch releases after `answer`, as `follow` does | `evm-settlement.test.ts`, "a persist while the answer is being read keeps the row…": before, the restarted storage held 0 rows; after, 1 row, and the retry answered `replayed: true`, Delivered. The book then holds the answer and the row goes on the next persist |
| 2 | Low · `recover` resolved rows one at a time, so a pass could wait for every lane's receipt timeout in turn | `recover` groups the open rows by sender and resolves the lanes side by side, each in nonce order | "recovers the rows of different relayer lanes side by side…": before, only the slow lane's row had started while it waited; after, both started and both counted `dropped` |
| 4 | Low · after a restart, another body under an open row's key was accepted for another commitment, and the mined funding's retry then got `idempotency_conflict` | Before its key check, `process` refuses another body under a key any open row holds | "after a restart, another body under an open row's Idempotency-Key is a conflict…": before, the other deal's offer answered ok; after, `idempotency_conflict`, no book for that deal, the pass applied the funding, and its retry replayed Held |
| 5 | Low · any broadcast error dropped the row, even when the RPC had taken the transaction | Only the node's own refusals drop the row (`RelayRefused`, nonce too low, underpriced, intrinsic gas too low, invalid sender, a fee cap below the base fee). Any other error keeps it as an open row that the lane resolves before its next send | `live.test.ts`, "a broadcast that errors after the node took it keeps its row…": before, no row was left; after, the row stayed, the transaction mined, the lane's next send took the row's nonce plus 1 without reading `pending`, and `resume` returned the mined receipt |
| 6 | Low · the storage key `lane:<lane>:<nonce>` left out the sender, so a rotated relayer key's row overwrote the old one, and releasing the old row deleted the new one | The key is `lane:<lane>:<sender>:<nonce>`; one list by prefix still reads every row. T-219 is not deployed, so no stored row uses the old key | `lanes.test.ts`, "keeps a rotated relayer key's row apart…": before, one row was left of two; after, both, and removing the old one left the new one |

- The cutover case (`lanes.test.ts`, 33 s) still passed after the fixes: each restarted world landed its row (`applied: 1`, `applied: 1`, then `seen: 1`, `failed: 0`), and each read 1 lane row when it opened (measured).
- `pnpm vitest run packages/settlement/evm apps/demo-cloud`: 14 files, 145 tests passed and 1 skipped (measured).
- **`pnpm verify`** on the fixes (measured, 2026-11-04, on `f07b4b9` plus the fixes before they were committed, `reports/verify-t-219-lane-in-flight-row.md`): PASS. typecheck, lint, forge build, forge test, `pnpm test` (118 files passed and 1 skipped; 2,670 tests passed, 4 skipped, the 2,665 before plus the 5 new ones), spec, snap, snap:local and demo all pass. Snapshot diffs against HEAD: none.
- A submission that throws after its receipt for another reason than a refusal keeps its row until the next restart (Decision 10). No test covers that path (inferred from the code).

### Merge with T-226, 2026-11-05

- **`pnpm verify`** (measured, commit `2ecdd1e`, after merging origin/main at `cdb55a4` with T-226 as merged in PR 200, `reports/verify-t-219-lane-in-flight-row.md`): PASS. typecheck, lint, forge build, forge test, `pnpm test` (118 files passed and 1 skipped; 2,676 tests passed, 4 skipped), spec, snap, snap:local and demo all pass. Snapshot diffs against HEAD: none.
- The code merged with no conflict (measured): T-226's reads at the receipt's block sit in `send` before `record`, and this task's `done` stays after `record`. When those reads fail for all 10 s, `send` throws before `done`, so the row stays open and the next sync pass applies the call as this node's relay through `follow` and `noteOf` (inferred from the code; no test covers that path). The backlog row T-226 left for this task says so.

## Decisions

Made by the T-219 session on 2026-11-04; Rafa can overrule any of them.

1. **One row per transaction, keyed `lane:<lane>:<sender>:<nonce>`.** The research named one row per lane (`lane:<n>`). With one key, the next transaction on a lane overwrites the previous row before the world has written the books that receipt changed, so a restart in that moment would lose it. With the nonce in the key, a lane normally has one open row; it has two only in that moment. The sender joined the key after the red-team (finding 6 below): a rotated relayer key's lane can send at an open row's nonce. Opening still lists `lane:` once.
2. **The row goes after the books and the answer.** `EvmSettlement.drain` now also returns the relayed hashes whose receipts it applied (`relayed`). `PublicWorld.persist` deletes their rows last, after the books, events and mandates. A hash joins `relayed` only once the answer a retry replays is stored with its book: `process` holds its own hashes until then (findings 1 and 3 below). A first broadcast the node refused and a given-up transaction delete their rows at once. A failed delete is not retried: the next restart reads the row, finds it applied and deletes it.
3. **Where the recovery runs.** `EvmSettlement.recover` runs on the world's next pass, before the sync and the adjudicators, with the relayer lanes side by side (finding 2 below). Any submission for the same deal also lands that deal's open rows first, so a retry that arrives before the pass replays the mined result. This puts more into `evm-settlement.ts` than labelling: the relayed messages stand in for the rebuilt ones in `rebuild` (matched by signature), `answer` records the Idempotency-Key, and `land` handles the fee sent alone. The fee alone leaves no rules-contract log, so the row is its only record.
4. **Two small world changes beyond handing over the store.** `work()` calls `recoverLanes()` before `syncChain()`, and `persist()` releases the rows. Both sit in `apps/demo-cloud/src/world.ts`, a listed path. `worker.ts` is unchanged: the world attaches the store when it opens.
5. **The deferred `commitment.agreed` carries the funding block's time.** It used to carry the wall clock at the receipt. A recovered relay can only know the block's time, so both now write the same event. On anvil the two times were already equal, and the snapshots are unchanged.
6. **The recovery's timing.** A resumed row is rebroadcast at once when it is not mined. The give-up comes at the row's receipt timeout (180 s after its first broadcast), or one rebroadcast window (36 s) after the restart if that is later. The one fee bump waits two windows from the restart, so an old row is rebroadcast as it was, never replaced on the first look.
7. **An RPC error after the broadcast keeps the row, and so does an unclear broadcast error.** The transaction is out, or may be, so the lane waits for it: the next send on that lane resolves the row first. Only the node's own refusals (nonce too low, underpriced, intrinsic gas too low, invalid sender, a fee cap below the base fee, too little test ETH) delete the row at the first broadcast (finding 5 below). Before T-219 the lane read its nonce from `pending` at once.
8. **A row whose deal has no book** (its offer was never written) is deleted once its receipt is found. If the offer is posted later, T-218's join applies the transaction, labelled `direct`.
9. **An open row's Idempotency-Key is taken for every commitment.** Before its key check, `process` refuses another body under a key an open row holds, whatever its commitment, with `idempotency_conflict` (finding 4 below). The same key and body name the same commitment, whose rows `process` lands first.
10. **A submission that throws after its receipt keeps its row.** A refusal after a receipt (a revert on chain) has no answer to replay, so its row goes. Any other error after the receipt, such as a failed balance read for the answer, leaves the row in storage. The log sync skips that transaction, since it is applied (`sync.ts`). The next restart reads the row, lands it with its answer through `follow` and deletes it (inferred from the code; not tested). Until then a retry meets the moved state, as before T-219.

## Handoff

**State:** done, merged in [PR 195](https://github.com/rafaeldavid/holdback/pull/195); it goes live with T-220's deploy. It started on T-218's branch; T-218 merged as PR 185 meanwhile, and the branch has origin/main merged in (`113976a`, then `2ecdd1e` with T-226). In that merge, `evm-settlement.ts` keeps T-218's review rounds 2 and 3, and the row's note also reaches round 2's new path that reads a lone delivery from its `JobSubmitted` log. The workflow's `reviewer` and `red-teamer` passes returned six findings on 2026-11-04; all six are fixed on this branch, each with a test that failed first (Evidence, "Review and red-team"). The Land phase merges the PR.

**What changed:**
- `packages/settlement/evm/chain.ts`: `LaneRow`, `RelayNote`, and four optional `EvmChain` methods (`inFlight`, `rowOf`, `resume`, `release`). The anvil world (`world.ts`) implements none of them, so nothing changes there.
- `packages/settlement/evm/live.ts`: `LaneStore`, `LiveChain.attach`, the row writes in `sendNow` and `bump`, and `resume`. The receipt loop is now one method, `fly`, shared by sends and resumes.
- `packages/settlement/evm/evm-settlement.ts`: the note travels with each relayed call; `recover`, `land`, `answer`; the row lookup in `follow`; `drain().relayed`. After the review: `process` releases its rows after its answer (`Relay.landed`), checks a key against every open row, and `recover` runs the lanes side by side.
- `packages/settlement/evm/live.ts`, after the review: only the node's own refusals drop a row at the first broadcast.
- `apps/demo-cloud/src/lanes.ts` (new; the key names the sender since the review) and `world.ts`.

**For T-220 (the deploy).** Nothing to configure: the rows live in the world's own storage under `lane:`, and there is no new secret or variable. A world deployed before T-219 has no rows, so there is nothing to migrate. After the deploy, `world.lastRecovery()` reports what the first pass after a restart did with the rows; it is null when none were open.

**For T-216 (round 1, scenario 11, a restart mid-step).** Deploy holdback-op1 while a step is between its broadcast and its receipt (Sepolia's 12 s blocks leave a wide window). Expect the step in the operators' log labelled `demo-op-1` (or `direct` for the demo adjudicators' own decisions, as without a restart), the adjudicators' envelopes and the buyer's key served, and a client retry with the same Idempotency-Key answered 200 with the mined state. `apps/demo-cloud/src/lanes.test.ts` covers the same case offline.

**Left as is:**
- After a restart, a pass still waits for its slowest lane's open row: up to that row's receipt timeout, 180 s after its first broadcast, or 36 s after the restart if that is later (review finding 2, inferred from the code). The lanes no longer wait for each other. On Sepolia a rebroadcast normally mines within a block, about 12 s (inferred). A time budget for `recover` would bound it further if a pass ever stalls.
- The funding lane keeps no rows (backlog row "the funding lane keeps no in-flight row").
- The operator's own idempotency records stay in memory (backlog, T-026). A retry after a restart is answered by the settlement adapter's record, which is in the book.
- T-218's test "a relayed transaction whose receipt the node never saw" (`sync.test.ts`) still expects `direct`: its chain has no lane store. It is outside this task's paths and stays as it is.
