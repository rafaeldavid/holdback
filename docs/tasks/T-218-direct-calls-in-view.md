# T-218: Direct contract calls appear in the operators' view

- **Lane:** settlement (with demo, for the world)
- **Phase:** 2
- **Depends on:** T-213 (the Sepolia world)
- **Paths this task may touch:** `packages/settlement/evm/evm-settlement.ts`, `sync.ts` (new), `chain.ts`, `live.ts` (only the log read), `world.ts` (the anvil harness's log read), `index.ts` (the export), and their tests (`evm-settlement.test.ts`, `wall.test.ts`, a new `sync.test.ts`); `apps/demo-cloud/src/world.ts`, `storage.ts`, and their tests (`world.test.ts`, `live.test.ts`); `docs/decisions/ADR-0028-demo-settles-on-sepolia.md` (a dated note in §11); `docs/neutrality.md` (only if a residual changes); `docs/backlog.md` (its row); `docs/plan.md` (this row, and the named test's line under the scenario index); this file
- **Human gate:** no. The live deploy is T-220's.
- **Status:** done
- **Agent/session:** T-218 session, branch `t-218-direct-calls` (2026-11-04)

## Intent

Restated by the T-218 session (2026-11-04). The operators' view follows the chain, whoever sent the transaction. A new reader, `ChainSync` (`sync.ts`), reads HoldbackRules' logs from a stored cursor in chunks of at most 50,000 blocks. For each transaction this node has not applied, it decodes the calldata (top level, or inside Multicall3) and hands it to the settlement adapter. The adapter rebuilds the signed messages from the calldata and the book, steps the core mirror at the block's time, and appends SimChain's events with `submittedVia: 'direct'` and the transaction.

- Fields the calldata carries in the clear are copied exactly. Fields it carries only as a hash are resolved from what the world holds (the posted delivery, its envelopes) or from a fixed list (appeal grounds, beacon sources), and checked against the hash.
- A step the adapter cannot rebuild yet (a direct delivery it never saw, an undecodable wrapper) puts the deal behind: the view serves `dealOf`'s stage with a notice, and nothing is invented. A posted delivery that matches the chain's joins the book without a second relay.
- The adapter releases each adjudicator's envelope at its turn, as for a relayed call, so a direct takeover, appeal or escalation does not strand the next adjudicator.
- The cursor moves only after the books are written. An RPC error moves nothing; one transaction the adapter cannot decode moves the cursor on.
- The world runs the sync on each pass and keeps a pass at least once a minute while any deal is open.

Non-goals: the reorg rollback, the in-flight row per lane (T-219), CPP's own logs, and the SimChain world.

### Original intent

Any party with Sepolia ETH can call HoldbackRules directly, past the operators (ADR-0005, the escape hatch). The money then settles on chain, but the operators' view lags: the state read, `/events`, the adjudicators' tasks and the buyer's key read all miss the step. Since T-057 a world's books change only through what its own nodes relay (ADR-0028 §5, as amended), and nothing reads the contract's logs.

Restated: make the view follow the chain. The world reads HoldbackRules' logs from a stored cursor and applies every stage change no operator relayed, as an event marked `submittedVia: 'direct'`. The same sync repairs a relayed step whose receipt the node never saw, the gap seen live at the T-213 cutover.

The design is in the research pass, `docs/research/2026-11-03-sepolia-demo-settlement.md` §4 ("Reading state", "Catching up after a long absence") and ADR-0028 §11.

## Context

- ADR-0005 (direct submission), ADR-0028 (§2: the contract is the authority from funding on; §5 and T-057's amendment: when passes run; §11), T-205 (adjudicator envelopes are not settlement-layer data on EVM).
- T-213 Evidence: the cutover deal whose decision landed on chain while the operators' log stopped at the delivery.
- The public-audit cross-check's `contracts/test/crosscheck/BundleAtomicity.t.sol` (the fund leg copied alone out of the mempool).
- `spec/schemas/event.schema.json` already has `submittedVia` and `tx`, so no schema change is expected.

## Acceptance criteria

- [ ] **The sync.** Each pass, and when the world opens, it reads HoldbackRules' logs from its cursor (block number and hash, stored) to the head. It reads in chunks no larger than the RPC's cap (50,000 blocks at publicnode, research §4), and advances the cursor only after the books are written. An RPC error fails closed: the cursor does not move and no event is written.
- [ ] **Direct steps become events.** A stage change no operator relayed becomes the core mirror's step at the block's time, with SimChain's payload, `submittedVia: 'direct'` and `tx`; the book then equals `dealOf`.
  - **From calldata as well as logs.** HoldbackRules' events do not carry the signed messages core's steps need: the Decision, the Appeal, the delivery, the terms (`contracts/src/HoldbackRules.sol`, events). So the sync decodes each matching transaction's calldata through the ABIs in `abis.json`, and uses the logs to find the transactions and confirm their effect.
  - **Covered on anvil** (a live-chain stand-in with `--block-time 1`), each sent from a party's or a stranger's own key: `agreeAndFund` with the acceptance the operators serve, `deliver`, `decide` sent by whoever holds the signed decision, `earlyAccept`, `fileAppeal`, `mutualSettle`, and each timeout: `expireOffer`, `reclaim`, `triggerFallback`, `triggerDefault` (default and apply-default in one transaction), `expireAppeal`.
  - A transaction this node relayed is applied once, not twice.
  - Both origins serve the same state and events, and the event hash chain stays append-only.
- [ ] **A call made inside another contract.** When HoldbackRules is called from inside another contract, the top-level calldata targets that contract, not the rules contract. Examples: a Multicall3 bundle (the operators' own funding bundle is one), a Safe, or an ERC-4337 smart account.
  - The sync decodes known wrappers (Multicall3).
  - For anything else, it serves that deal's stage from `dealOf` with a notice, and invents no step.
  - Either way the cursor still advances for every other deal: one transaction it cannot decode never stops the view. Only an RPC error holds the cursor back.
  - Both cases are tested on anvil.
- [ ] **The next adjudicator still gets its key.** Today the adapter hands an adjudicator its envelope only on its own send path (`custody` in `evm-settlement.ts`): the fallback at the takeover, the appeal adjudicator at an escalation or a filing. A direct `triggerFallback`, `fileAppeal` or escalating `decide` makes the same release, so the fallback or the appeal adjudicator can decide and the deal does not drift into the default (litmus test 1). Tested for each of the three.
- [ ] **A commitment the operators never saw.** Its terms were never posted to an operator, so the world holds no book for it. The sync does not invent one. Decide and record what happens: proposed, the sync counts and skips it, and the world joins the chain's state once a party posts the signed offer (`POST /v1/commitments`).
- [ ] **A direct delivery's envelopes.** The contract never holds the adjudicators' envelopes (T-205), so a direct `deliver` gives the world none. When the seller then posts the same signed delivery to an operator, the operator joins it to the book, with no second relay and no `invalid_state`. The adjudicators get their envelopes, and the primary decides. Without that post, the adjudicators cannot open the work; the sentence `llms.txt` needs for this goes in the Handoff, for T-220.
- [ ] **A missed receipt.** A relayed transaction whose receipt the node never saw (a restart between broadcast and receipt) is applied from the logs on the next pass. Its state, events and the buyer's key are served. It is labelled `direct` until T-219 tells this node's own relays apart.
- [ ] **The fund leg copied alone** (ADR-0028 §11). A watcher copies the bundle's funding out of the mempool and sends it alone: the deal funds without the operator fee, and the node's bundle reverts. The view shows the deal Held with the fee unpaid, and the node may still relay the buyer's signed fee transfer alone until `fundBy`. Tested on anvil.
- [ ] **The fallback's round.** `fallback.triggered`'s `beaconRound` is the contract's, read from its `FallbackTriggered` log, so it stays right for any beacon (T-217 moves Sepolia to drand).
- [ ] **Cadence and cost.** While any deal is open, a direct call shows in the view within one pass (target: 60 s or less) [measured on anvil]. While no deal is open, the sync adds no pass (T-057 unchanged). Rows read and written per pass are recorded with T-031's counters.
- [ ] **Neutrality.** A named test, `neutrality.operator-refuses-on-chain`: the operators refuse to relay after funding; the parties submit directly; the deal settles; the view shows every step. It is listed with the other named tests under the plan's scenario index.
- [ ] **Docs.** ADR-0028 §11 gets a dated "as built" note; the backlog row "Sepolia: direct transactions in the operators' view" is closed; the `llms.txt` text for T-220's deploy is in the Handoff.
- [ ] **Review.** `reviewer` and `red-teamer`, each with project context (operator and settlement code, litmus test 1). `pnpm verify` green, including `pnpm snap --settlement=local` with transcripts identical to SimChain's.

## Out of scope

- The reorg rollback (backlog row "Sepolia: reorg check"). The cursor keeps its block hash so that row can build on it.
- The in-flight row per relayer lane (T-219).
- CPP's own logs. A buyer's reclaim sent straight to CPP's escrow shows in the view once a HoldbackRules timeout closes the deal (M-1, PR 122).
- The SimChain world, which has no chain to read.

## Evidence

**`pnpm verify`** (measured, commit `cf2864d`, 2026-11-04, `reports/verify-t-218-direct-calls.md`): PASS.

| Step | Command | Status | Time |
| --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | pass | 272 ms |
| lint | `pnpm lint` | pass | 5001 ms |
| forge build | `forge build --root contracts` | pass | 3981 ms |
| forge | `forge test --root contracts` | pass | 25429 ms |
| test | `pnpm test` | pass | 149339 ms |
| spec | `pnpm validate:spec` | pass | 608 ms |
| snap | `pnpm snap` | pass | 9996 ms |
| snap:local | `pnpm snap --settlement=local` | pass | 16002 ms |
| demo | `pnpm demo` | pass | 4615 ms |

- Snapshot diffs against HEAD: none (measured). `snap:local` ran 28 fixtures on the contract, each with a transcript identical to SimChain's, and excluded 3 until Phase 4 (measured). `reports/differential-local.md` is unchanged.
- `pnpm test`: 108 files, 2,447 tests passed, 3 skipped (measured).
- The worktree's `contracts/lib/commerce-payments` was copied from a sibling worktree at the same commit (6b0a5ef). `forge build` warned that it could not clone the submodule, then compiled (measured). CI checks the submodule out itself.

**Each acceptance criterion, on anvil standing in for Sepolia** (a block every second; `packages/settlement/evm/sync.test.ts` and `wall.test.ts`, 41 tests, 41 passed in 150 s, measured). The first rows are the criteria; the regressions from the three review rounds follow the table.

| Criterion | Test | Result |
| --- | --- | --- |
| Chunks of at most 50,000 blocks; an RPC error applies nothing and moves no cursor | "reads the logs in chunks…", "fails closed…" | ranges 100–50,099, 50,100–100,099, 100,100–120,100; cursor unchanged on error |
| `agreeAndFund` by the buyer with the served acceptance | "agreeAndFund sent by the buyer…" | Held, `commitment.agreed` and `hold.funded` with `submittedVia: 'direct'` and the transaction; the book equals `dealOf` |
| `deliver`, `decide` by a stranger, `earlyAccept`, `fileAppeal`, `mutualSettle` | one test each | each applied in one pass; the buyer's key is served after a decision or an early accept |
| `expireOffer`, `reclaim`, `triggerFallback`, `triggerDefault`, `expireAppeal`, each by a stranger or a party | "timeouts…", "a takeover…" | each applied; `fallback.triggered` carries the contract's round; the appeal expiry is final at `appealBy` (D20) |
| Applied once, before and after a restart | "a transaction this node relayed…" | `applied: 0` over 3 transactions; the log is unchanged |
| Multicall3; a contract this node cannot read | "a call inside a Multicall3 bundle…", "a call forwarded…" | the bundle is applied; the forwarded deal is behind: `dealOf`'s stage, a notice, only the buyer's on-chain key, and the cursor and the deal beside it still move |
| The next adjudicator gets its key | "an escalation…", "an appeal filed…", "a takeover…" | the appeal adjudicator's envelope at a direct escalation and a direct appeal, then its decision; the fallback's at a direct takeover and at one forwarded by a contract |
| A commitment the operators never saw | "a commitment this node never saw…" | `unknown: 1`, no book; the posted offer joins: Held, with the direct steps' events |
| A direct delivery's envelopes | "a delivery sent by the seller…", "a delivery posted before any pass…" | behind with the notice; the post joins with no second transaction; the primary gets its envelope and decides |
| A missed receipt | "a relayed transaction whose receipt…" | applied on the next pass, labelled `direct`; Released, and the buyer's key is served |
| The copied fund leg | "the fund leg copied alone…", "…out of the mempool…" | Held with no `fee.operator`, then the fee relayed alone; in the race, the copy mined first and the node's bundle reverted in the same block, then the node followed the copy and relayed the fee |
| `neutrality.operator-refuses-on-chain` | the named test | the relays answer `relay_refused`; the deal settles by direct calls; the log shows every step, with only the funding through the operator |

**Regressions from the three review rounds** (each a test in `sync.test.ts` or `wall.test.ts`, all passing, measured):
- A reverted decoy beside the real call in a bundle: the view records the decision that ran, with its appeal window. A decoy settlement: the view records the payouts the chain made.
- A forwarded or opaque takeover, or one bundled twice: it follows from its logs, and the fallback decides. A forwarded copy of the seller's delivery waits, then joins.
- Planted calls beside a copied step (a takeover, an offer expiry, a junk call): the copied step applies, and no planted step applies. Sixteen filler timeouts do not hide the real call. A junk call beside a carried delivery does not cancel the join.
- An early accept hidden by a transforming contract with a planted takeover: the deal is behind, with no takeover and no fallback envelope, and the buyer's key is served.
- Another account's transfer with the deal's fee nonce is not recorded as the operator fee. A missed fee bundle's receipt records the fee once.
- An expiry of 2^64 − 1 s: the deal follows, and a direct delivery joins. A failed read after a relay mined leaves the book untouched, and the next pass applies the call.
- 120 KB of selector padding: a pass with that transaction stays under 3 s. Range halving runs on a provider cap only, never on a rate limit. Unaccepted offers keep no cadence; accepted ones go idle after an hour.

**Cadence and cost** (`apps/demo-cloud/src/live.test.ts`; 2 tests passed, 1 skipped, which needs `SEPOLIA_FORK_RPC`; measured):
- After try.ts reached Released, the reopened world scheduled its next pass within 60 s while the deal was open.
- A stranger's direct `expireAppeal` showed after one pass of 308 ms (298 ms in an earlier run): `appealState: 'expired'`, the event with `submittedVia: 'direct'`, 6 RPC requests. That pass read 0 rows and wrote 3: the book, the event page and the cursor row.
- The idle pass after it read 0 rows and wrote 0. With the deal final, `nextPass()` is null: no deal open, no pass (T-057 unchanged).
- On Sepolia a pass reads within one block of the call; the 60 s target holds while the RPC answers (inferred).

## Decisions

Made by the T-218 session on 2026-11-04; Rafa can overrule any of them.

1. **Rebuild rule.** A direct step is rebuilt from the calldata. Fields in the clear are copied. Fields carried only as a hash are read back from what the node holds (the delivery, its envelopes) or from a fixed list (the four appeal grounds, the three beacon sources), and checked against the hash.
   - An appeal whose grounds match no listed ground gets the stand-in text "unread: filed directly; the contract keeps only the grounds' hash 0x…".
   - A direct escalation whose envelope list does not hash to the delivery's envelope for the appeal adjudicator still hands over that envelope: it opens the same content.
2. **What the sync trusts** (revised after two rounds of review and red-team, 2026-11-04). The receipt's logs are what ran; calldata only says what a call carried. A step is rebuilt in one of four ways, tried in order:
   - **Timeouts, from the logs alone.** `FallbackTriggered`, `Defaulted`, `JobExpired` (with `Refunded` for a reclaim) and `AppealClosed` with the verdict Expired carry no signed message. A takeover, default, reclaim or expiry therefore follows whatever wrapper or bundle sent it. A timeout read from calldata is never taken: a planted one may never have run.
   - **A delivery alone, from its `JobSubmitted` log.** It applies with the delivery this node holds whose hash the log names, or waits for the seller to post it.
   - **A readable transaction:** a call to the rules contract, or a bundle to the deployment's Multicall3 in which every call must succeed and which calls only the rules contract and the token. A bundle with `allowFailure`, `requireSuccess = false`, a nested bundle or any other target is unreadable, since the calldata no longer says what ran.
   - **A call written in another contract's calldata** (a simple forwarder, a Safe's `execTransaction`, an ERC-4337 account): the scan looks for this deal's encoded terms after a step's selector, linear in the calldata, and decodes each hit from at most 16 KB. A candidate is accepted only when its rebuilt messages' plain-key signatures verify.
   - Every rebuilt call must also match the logs: `Decided` (role, outcome, record hash, seed), `JobCompleted`'s evaluator for an early accept, `AppealFiled`, and the mutual settlement's payouts as `PaymentReleased` and `Paid` show them. Candidates the logs or signatures reject do not count, so a planted call cannot stop a delivery from joining.
   - An operator fee in a bundle is recorded only when the buyer's own transfer moved it, as the token's `Transfer` log shows.
   - A contract expiry past what a timestamp holds (the contract takes any uint64) reads as 9999-12-31T23:59:59Z, never expiring. Any other rebuild failure puts the deal behind instead of stopping the pass.
3. **Behind the chain.** What remains puts the deal behind: a signed step another contract transforms, a contract signer's step (ERC-1271), two signed steps for one deal in one transaction, a divergence from core, or a forwarded signed step whose expiry lies past 9999 (`docs/neutrality.md` residual 13).
   - The state read serves `dealOf`'s stage and appeal state, with the notice from `EvmSettlement.lag`.
   - Relays for that deal answer `invalid_state` with the notice. The one exception is the posted delivery that joins.
   - Envelopes still follow the chain: a key the transaction released on chain is served, and the adjudicator whose turn `dealOf` shows gets its envelope.
   - The operators' own adjudicators read the book, not `dealOf`, so they do not act on a deal behind the chain; it ends by its timeouts. Anyone holding a copy of a pending signed step can cause this. Fixing it (the adjudicators reading `dealOf`, relays without the mirror) is a backlog row for Rafa to place before or after T-220.
4. **A commitment no node here saw** is counted (`unknown` in the pass report) and skipped. When a party posts its offer, the node reads `dealOf` (one read per offer; a failed read offers as before). If the deal is on chain, the node checks the offer as of the terms' `createdAt`, with an open seller scope, since the contract already checked the signatures and this node's mandate checks are its own policy. It then applies the commitment's transactions in order.
5. **The posted delivery joins.** It joins whether the pass has read the direct delivery or not: a relay refused with `WrongStage` reads that commitment's transactions first.
6. **The copied fund leg.** When the deal is already funded by the same signed funding, or the node's bundle is refused or reverts while `dealOf` shows Held, the node follows the copy. It then relays the buyer's signed fee transfer alone, unless its nonce is spent, and answers the agreement as funded.
7. **Open deals, the cadence and the cursor row.**
   - An accepted offer is open until the earlier of `offerExpiresAt` and `fundBy` (an offer nobody accepted cannot be funded); a funded deal until an hour after its last deadline ahead.
   - A funded deal whose book moved in the last day, or with a deadline within an hour of now, keeps a pass at least once a minute; an accepted offer does for an hour after it last moved. Any other open deal keeps one every 15 minutes, so far-off or chained deadlines (D31 allows any) do not keep a world polling every minute. This is a deliberate deviation from the criterion's "within one pass (60 s)" for quiet deals. A timeout sent after a deal's window, or a direct funding of an offer nobody accepted through this node, shows at the next pass anything else starts.
   - Each pass reads the last three blocks again, since a load-balanced RPC can answer from a node a block behind. A range the provider caps is halved, at most 16 times; a rate limit (429) or a server error fails the pass instead.
   - The cursor row is written when a pass read a rules-contract log past the old cursor, or when the stored row is 300 blocks (about an hour on Sepolia) behind.
8. **"When the world opens."** Opening stays free of chain calls: it runs inside `blockConcurrencyWhile` (30 s), and a reopened world with its RPC down must still open. The first pass after opening reads the chain. When any deal is open, that pass comes within the pass wait (2 s after opening).
9. **Applied once.** Each book keeps the hashes of the transactions applied to it (`chainTxs`). Books saved before T-218 are seeded from their events' `tx`. A pass applies a commitment's transaction inside that commitment's lane, so a relay in flight records its own transaction first.
10. **The export is in `live-entry.ts`, not `index.ts`.** The world imports `@holdback/settlement/live`, which is `live-entry.ts`, and `index.ts` re-exports it. This is one line outside the listed paths.
11. **Direct sends in the tests use a fixed gas limit.** anvil 1.0.0's `eth_estimateGas` fails with "gas floor exceeds the gas limit" for a cheap call whose calldata floor (EIP-7623, Prague) is above its execution gas, while `eth_call` passes (measured on `triggerFallback` and `expireAppeal`).

## Handoff

**State:** done, merged in [PR 185](https://github.com/rafaeldavid/holdback/pull/185). Three rounds of `reviewer` and `red-teamer` passes ran on 2026-11-04. All findings sat in the view and relay layer; no funds moved outside the terms.
- The reviewer's third check: PASS.
- The red-teamer's third pass: the round-two fixes hold; its three new items (filler calls, a planted junk call beside a carried delivery, chained offer deadlines) are fixed with tests.
- Every finding has a regression test in `sync.test.ts` or `wall.test.ts`, except what residual 13 and the two backlog rows below record.
- **For Rafa:** both reviewers say residual 13 need not block this merge. The red-teamer recommends fixing it before T-220's deploy: once live, any mempool watcher can leave a demo deal behind, so the operators' adjudicators do not act on it and it ends by its timeouts. The backlog row is where Rafa places it.

**For T-219 (the in-flight row per relayer lane).** It edits `live.ts` and `evm-settlement.ts` after this merge. It builds on these pieces:
- `EvmSettlement.observe` → `follow` → `step` → `record`. `record` is now the one place a mined call lands on its book, relayed or synced. `step` passes the via `'direct'`. T-219 looks its own lane's in-flight row up by transaction hash there and passes the operator's via, so a missed receipt stops being labelled `direct`.
- `applied(id, hash)` and `Book.chainTxs`. Before re-broadcasting an in-flight transaction after a restart, T-219 checks `applied`: a pass may already have applied it.
- `live.ts` is unchanged by T-218: the sync reads through `publicClient` in `sync.ts`. The demo world's `syncChain` runs before the adjudicators in `work()`.

**For T-220 (the deploy).**
- The live Sepolia world has no `cursor` row yet. Its first pass reads every rules-contract log from block 12061237 in one call (inferred: fewer than 50,000 blocks). It fetches only the transactions of deals it holds books for and has not applied, so it should apply nothing (inferred). The report shows in `world.lastSync()`.
- Keeping today's world (Rafa, 2026-11-04; how is pending D49): the sync brings the kept world's books up to the chain from the deployment block on. That covers a step that landed while the operators' log lagged, and a receipt the node missed. It builds no book for a commitment the world never saw; that deal joins when a party posts its offer. `WORLD_NAME` is unchanged by T-218.
- The sentence for `llms.txt`: "Submitting directly to the contract: these operators read the contract's logs and show your step within a minute, with `submittedVia: \"direct\"`. The contract keeps only a delivery's hash, so after a direct `deliver` also POST the same signed delivery to `/v1/commitments/{id}/deliveries`. The operator joins it without a second transaction and hands the adjudicators their keys; without that post they cannot open the work."

**For T-216 (round 1).** anvil's estimate failure above may also hit relayed timeouts on anvil: `LiveChain.simulate` is `eth_estimateGas`. Confirm on Sepolia that publicnode and Tenderly estimate a relayed `triggerFallback` and `expireAppeal` (inferred: geth adds the floor to its estimate).

**Left as is, in the backlog.**
- The operators' adjudicators act on a deal behind the chain (residual 13 in `docs/neutrality.md`).
- `drain` clears the changed books before the storage writes succeed. A failed write is then not retried, and a restart can lose a step whose events were written. The pattern predates T-218 (red-team 6).
- The per-commitment catch-up (a late offer, a delivery posted before a pass) reads from the deployment block. Its cost grows with the chain's age: one `eth_getLogs` per 50,000 blocks.
- A joined offer's `commitment.offered` carries the time it was posted, while the steps after it carry earlier block times (review, Info).
