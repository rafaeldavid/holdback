# Research pass: the public demo settling on Ethereum Sepolia (D41)

- **Date:** 2026-11-03
- **For:** D41 (Rafa, 2026-11-03: "the public demo to settle on Sepolia")
- **Scope:** design for running api.escrow.stream and api2.escrow.stream (`apps/demo-cloud`, two Cloudflare Workers in front of one Durable Object) on the T-206 Sepolia deployment (tUSD, CPP `AuthCaptureEscrow` and collectors, `HoldbackRules` with `HoldbackBonds`, `DrandQuicknetBeacon`). One recommendation per question, options and tradeoffs under each.
- **Method:** read the repository (file:line citations), probed public Sepolia RPCs and drand relays read-only (`reports/scratch/sepolia-rpc-probe.mjs`, `sepolia-tags-probe.mjs`, `drand-probe.mjs`; their JSON output sits beside them), read Cloudflare's documentation. No transaction was sent, nothing was signed, no account was created.
- **Labels:** every claim is **measured** (I ran it or read it in a primary source), **inferred** (follows from measured facts) or **guessed** (no evidence beyond experience).

## The recommendations in one page

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Who pays gas | One relayer key pool held by the World (op1's secrets), shared by both nodes. It only submits what parties signed; the contract checks every signature and has no `msg.sender` privilege, so relaying is not authoring. Serve the acceptance message so an agent with Sepolia ETH can call `HoldbackRules` itself; the operators learn of direct transactions from the rules contract's logs each tick. |
| 2 | Nonce and concurrency | Three relayer keys as independent lanes (deal → lane by commitment ID). Each lane is strictly serial and waits for its receipt, so nonces never gap; three deals proceed in parallel, more queue. Gas limit from `eth_estimateGas` + 25% (cap 1.5M); tip = median of the last 20 blocks, clamped to 0.1 to 2 gwei; fee cap 20 gwei; replace at +15% after 3 blocks; every send is written to storage before it leaves. |
| 3 | Confirmations and reorgs | Report a state at inclusion (one confirmation) with a `chain` object (tx hash, block, confirmations, `included`/`safe`/`final`). Do not wait for finality (17 minutes today). On a reorg, roll the book back to the chain's stage and append a `chain.reorg` event. |
| 4 | Reading state | From funding on, the chain is the source of truth (`dealOf`, logs, `balanceOf`); before funding, the operator's books. Keep SimChain's payload shapes and add `tx`. Store books per commitment and a log cursor; restart reads a handful of rows, never the whole history. |
| 5 | Faucet | The relayer mints synchronously (the request returns after the receipt, 12 to 24 s), batching grants that arrive together through Multicall3; keep the per-address and per-client limits, add a daily mint budget and skip the mint when the address already holds the grant. |
| 6 | Demo adjudicators | A one-time setup pass run by the World, idempotent against on-chain reads: send each adjudicator 0.01 Sepolia ETH, mint, approve, deposit 25,000 tUSD each (same as the sim), top up when free bond runs low. |
| 7 | drand | A `drand-quicknet` `RandomnessSource` in the adjudicator service: GET `/{chainhash}/public/{round}` from four relays in order, verify the BLS signature locally with @noble/curves before signing, chain re-verifies in `decide`. No proof by the deadline means no decision (ADR-0018 §5). Admit `drand-quicknet` in the parse rule only for chain settlement. |
| 8 | RPC | viem `fallback([publicnode, tenderly])` with JSON-RPC batching and short timeouts; one optional keyed URL (Infura/MetaMask or Alchemy free tier, Rafa signs up) prepended through a secret. Cache chain reads per block; serve polled reads from the mirror. |
| 9 | Durable Objects quota | Redesign storage (books per commitment, append-only events, cursors), slow the alarm (2 s when work is pending, 12 s otherwise), and move to Workers Paid ($5/month) so a busy day fails soft instead of hard. |
| 10 | Latency | Keep the on-chain `deliver` (3 transactions): each API state then maps to a chain event. Writes answer after inclusion (12 to 24 s each); a try.ts deal takes about 60 to 100 s. Docs say so plainly. |
| 11 | Rollback flag | `SETTLEMENT=sim|sepolia` per Worker, folded into the world name; the Durable Object learns its kind from its name, never from env. Rehearse on a separate staging pair; flip both production Workers in one deploy; rollback is the same deploy with the flag back. |
| 12 | Cost | About 0.0006 Sepolia ETH per try.ts deal at today's 1 gwei tip (0.00006 at 0.1 gwei). Ask Rafa for 1.2 Sepolia ETH (relayer lanes 1.0, setup 0.1, buffer). Below 0.02 ETH on a lane: status warns, the faucet pauses first, then writes answer 503 and direct submission remains. |
| 13 | Honest limits | Say what is still held by the operators (relayer keys, adjudicator keys and bonds, pre-funding stages, envelopes in transit, the faucet), what is public and checkable on Etherscan (contracts without owner functions, every funded deal's transactions and the sealed key), and what is not (unaudited contracts and verifier, one process behind two names, open-mint test token). |

Two decisions Rafa should make outside the repository: upgrade the Cloudflare account to Workers Paid (§9) and fund the relayer (§12). Two he may want to: sign up for a keyed RPC (§8) and an Etherscan API key for source verification (§13).

## The premises, verified

The brief listed facts to check. Each is confirmed unless noted.

| Fact | Verdict | Evidence |
| --- | --- | --- |
| The Durable Object class lives in holdback-op1; op2 binds it by script name, so the DO always runs op1's code, environment and secrets | **Measured, true** | `apps/demo-cloud/wrangler.op1.jsonc:16-17` (`durable_objects.bindings`, `new_sqlite_classes: ["World"]`), `wrangler.op2.jsonc:13` (`"script_name": "holdback-op1"`); `worker.ts:39` names one world `holdback-public-demo-2026-11-02` |
| The account is on the Workers Free plan | **Inferred** (I cannot see the account): the Nov 2 outage was a free-tier quota (`docs/tasks/T-031-telemetry-mvp.md:13`), and neither wrangler file sets `limits` | The quotas that bite are in §9, with their paid-plan values |
| `EvmSettlement` is anvil-specific | **Measured, true** | `evm_setNextBlockTimestamp` at `packages/settlement/evm/evm-settlement.ts:227,736,752`; impersonation `:226`; default sender `ANVIL_DEPLOYER_KEY` `:732`; `TX_GAS = 3_000_000n` `:118`; one queue with the receipt awaited inside it `:182,391-395,755`; books, nonces, log, idempotency in memory `:172-180`; `replayCheck` walks every block `:796-819`; `assertLocalRpc` refuses any non-local RPC `guard.ts:15-23` |
| Offer, acceptance and agree are not on chain; `agreeAndFund` verifies all three | **Measured, true** | `contracts/src/HoldbackRules.sol:190-216` (`_requireSigned` three times); the adapter keeps them in `Book` `evm-settlement.ts:91-104` |
| The buyer's funding is an ERC-3009 `ReceiveWithAuthorization` in the token's domain with the payer-agnostic PaymentInfo hash as nonce; the operator still prepares a Holdback-domain `FundingAuthorization`; `verify.ts` pins SimChain's domain and rebuilds the message | **Measured, true, and worse by one detail** | Adapter `evm-settlement.ts:356-368,644-646`; prepare `apps/operator/src/prepare.ts:335-345` sets `validAfter: c.createdAt`, while EVM needs `validAfter` 0 (`:366`), so even the field values differ, not only the domain; `examples/verify.ts:12,173`; the fee bundle `evm-settlement.ts:659-676` |
| EVM event payloads differ from SimChain's; `keysFor` returns only on-chain releases | **Measured, true, and the operator's own index breaks too** | EVM `commitment.offered` payload `{source, termsHash, sellerSignature}` `:491` vs SimChain `{termsHash, terms, sellerSignature}` `sim/simchain.ts:708`; EVM `delivery.submitted` `{tx, from, gasUsed, event, args}` `:773` vs `{attempt, deliveryHash, plaintextSha256, ciphertext}` `simchain.ts:744-749`. Readers of `payload.terms`: the operator index `apps/operator/src/server.ts:445-447,870-873` and the adjudicator adapter `apps/adjudicator/src/simchain-adapter.ts:81-85`; readers of `payload.ciphertext`: the adapter `:84`, `examples/try.ts:151`, `examples/agent.ts:187-189,212-216`. `keysFor` reads `book.released` `:345-347`, filled only from `KeyReleased` logs `:767-771` |
| `HoldbackBonds.deposit` bonds `msg.sender`; appeal bonds are pulled with `transferFrom` | **Measured, true** | `contracts/src/HoldbackBonds.sol:53-57,95-101` |

Two more facts the design leans on:

- **`HoldbackRules` never reads `msg.sender`** (measured: no occurrence in the file). Every entry point is permissionless; authority comes from signatures, deadlines and the stage word. That is what makes relaying safe (§1).
- **SimChain journals every clock tick.** `advanceTo` calls `advance`, which appends `{op: 'advance'}` (`packages/settlement/sim/simchain.ts:290-301`); the World ticks on every request and every alarm (`apps/demo-cloud/src/world.ts:314-316,333,357`), persists new entries (`:319-329`), re-arms the alarm every second for 15 minutes after a write (`worker.ts:88`, `world.ts:76`), and on open lists and replays every `j:` row (`world.ts:167-168`). Cloudflare bills each key-value `put` as a row written and each `setAlarm` as a row written, and each listed key as a row read (Durable Objects pricing, footnotes 2 and 3). So an active day writes on the order of 170,000 rows (one journal row and one alarm row per second) against a free limit of 100,000, and every eviction reads the whole journal. **Inferred:** this is the mechanism behind the Nov 2 outage that T-031 records; it also means the Sepolia design must not inherit the journal-replay pattern (§4, §9).

## Measurements

### Sepolia today (2026-11-03, read-only)

| Fact | Value | Source |
| --- | --- | --- |
| Chain ID | 11155111 (`0xaa36a7`) | `eth_chainId`, three providers agree |
| Head | about 12,054,600 | `eth_blockNumber` |
| Block time | 12.0 s over the last 50 blocks | timestamps of head and head−50 |
| Block gas limit | 200,000,000 | `eth_getBlockByNumber` |
| Blocks full | 27 % to 40 % (`gasUsedRatio`), 133 to 138 transactions per block | `eth_feeHistory`, latest blocks |
| Base fee | 16 to 19 wei (about 0.00000002 gwei) | `eth_feeHistory`, `baseFeePerGas` |
| `eth_gasPrice` | 19 wei | publicnode, tenderly |
| `eth_maxPriorityFeePerGas` | 2 wei | publicnode, tenderly |
| Tips actually paid, last 20 blocks | p25 0.001 gwei, p50 about 1 gwei, p75 about 1 gwei | `eth_feeHistory` rewards at [25, 50, 75] |
| `safe` head lag | 53 blocks (publicnode), 2 blocks (tenderly): providers disagree | `eth_getBlockByNumber('safe')` |
| `finalized` head lag | 85 to 86 blocks, about 17 minutes | `eth_getBlockByNumber('finalized')` |
| EIP-2537 precompiles | live: `eth_call` to `0x0b` (G1ADD) with the generator plus infinity returned the generator | three providers agree |
| Multicall3 `0xcA11…CA11` | 3,808 bytes of code | `eth_getCode` |
| Permit2 `0x0000…BA3` | 9,152 bytes of code | `eth_getCode` |

The tip numbers matter: the base fee is nothing, and most senders pay a 1 gwei tip (the default minimum of a stock geth block builder, **guessed**), while a quarter of transactions get in for 0.001 gwei. Either choice is cheap (§12); 1 gwei buys next-block inclusion with high confidence (**inferred** from blocks 27 to 40 % full).

### Sepolia's lifetime

- The Ethereum Foundation's post of 2025-03-18 listed Sepolia for "Application and tooling devs (Expected end of life 30th September, 2026)" and a "Planned Sepolia replacement: Expected launch date of March 2026" (**measured**, blog.ethereum.org).
- Today the chain is live and busy (above), ethereum.org still calls Sepolia "the recommended default testnet for application development" with no end date, and the eth-clients/sepolia README schedules the Glamsterdam fork on Sepolia for 6 October 2026, after the stated end of life (**measured**). Secondary sources claim an LTS extension into 2027 and a successor running alongside; I found no primary statement either way (**not verified**).
- **Consequence:** treat the chain as a configuration value. Keep every address in `contracts/deployments/<chain>.json`, the chain ID in the Worker variables, and the domain in discovery, so a move to a successor testnet is a redeploy plus a config change, not a code change. Check the EF's testnet page before the cutover.

### Public Sepolia RPC endpoints (keyless)

| Endpoint | Result today |
| --- | --- |
| `https://ethereum-sepolia-rpc.publicnode.com` | 36 to 171 ms; batches accepted; `eth_getLogs` up to 50,000 blocks ("exceed maximum block range: 50000" above that); archive data advertised; no published rate limit or terms on the landing page (**measured**) |
| `https://sepolia.gateway.tenderly.co` | 39 to 153 ms; batches accepted; `eth_getLogs` over 100,000 blocks accepted; `safe` tag lags only 2 blocks (do not trust provider `safe` tags) |
| `https://1rpc.io/sepolia` | 170 to 274 ms; `eth_getLogs` capped at 50 blocks; returned "Rate limit exceeded on Nodies public endpoints" after about 20 calls in a minute |
| `https://sepolia.drpc.org` | refuses keyless Sepolia: "chain is not available on free plan" (error 35) |
| `https://rpc.sepolia.org` | timed out (15 s) three times |
| `https://eth-sepolia.public.blastapi.io` | discontinued ("Blast API is no longer available") |
| `https://endpoints.omniatech.io/v1/eth/sepolia/public` | HTTP 521 |

Keyed providers (an account is a step for Rafa, not for an agent): Infura/MetaMask Developer's free tier lists 3 million credits a day on its table and 6 million in its FAQ, 500 or 2,000 credits a second, one API key (**measured**, the page contradicts itself); Alchemy's free tier is quoted as 30 million or 300 million compute units a month and 500 compute units a second (**measured**, sources conflict). Either is far beyond the demo's volume (§8).

### drand quicknet relays

| Relay | `/info` | `/public/latest` | past round | future round | v2 API |
| --- | --- | --- | --- | --- | --- |
| api.drand.sh | 909 ms (first call), then about 180 ms | round within 1 of the formula | 177 ms, `Cache-Control: public, max-age=604800, immutable` | HTTP 425 "Requested future beacon" | yes |
| api2.drand.sh | 112 ms | 67 ms | 18 ms | 425 | yes |
| api3.drand.sh | 728 ms, then about 180 ms | 531 ms | 175 ms | 425 | yes |
| drand.cloudflare.com | 65 ms | 86 ms (edge cache hit) | 47 ms (cache hit) | HTTP 404 | no (404) |

All four serve chain hash `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`, scheme `bls-unchained-g1-rfc9380`, period 3 s, genesis 1692803367, public key `83cf0f28…`, identical to the constants compiled into `contracts/src/DrandQuicknetBeacon.sol:7-37` (**measured**). A round is `{"round", "randomness" (64 hex), "signature" (96 hex = 48 bytes)}`; `randomness` is sha256 of the signature, which is what the verifier returns (`DrandQuicknetBeacon.sol:78-79`). The official relay list adds `api.drand.secureweb3.com:6875` (drand.love/developer). Latest rounds are cached for 2 s; past rounds are immutable for a week, so a retry never fetches a different value.

### Cloudflare limits that bite (from the documentation)

| Limit | Workers Free | Workers Paid ($5/month minimum) |
| --- | --- | --- |
| External subrequests per invocation (a request to the Worker, a request or alarm to the DO) | 50 | 10,000 default, configurable to 10 million |
| CPU per Worker invocation | 10 ms | 30 s default, up to 5 min |
| CPU per Durable Object request or alarm | The DO limits table lists 30 s default with no plan split, while the Workers table gives Free 10 ms per invocation; which applies to a DO on the Free plan is not stated. Today's demo already runs CSV checks, signing and NaCl inside the DO on this account without hitting a CPU error (**inferred**: 30 s applies). CPU is active time, not I/O waits | 30 s default, up to 5 min |
| Durable Object requests (HTTP plus alarm invocations) | 100,000 per day | 1 million per month included, then $0.15 per million |
| DO duration | 13,000 GB-s per day | 400,000 GB-s per month, then $12.50 per million GB-s |
| SQLite rows read | 5 million per day | 25 billion per month included |
| SQLite rows written (`put`, `delete` and every `setAlarm`) | 100,000 per day | 50 million per month included |
| Storage | 5 GB total | 5 GB-month included, $0.20 per GB-month |
| Over a free limit | "further operations of that type will fail with an error"; limits reset at 00:00 UTC | billed |
| `blockConcurrencyWhile` | 30 s, then the object is reset | same |
| Alarm handler wall time | 15 minutes | same |
| Request wall time to a DO | unlimited while the client stays connected | same |
| Idle eviction | 70 to 140 s without events; pending outbound I/O keeps the object alive up to 15 min per operation | same |

Cloudflare's own example of a DO called 1.5 million times a month and active 1,000,000 s comes to $5.15 (**measured**, pricing page example 1). At the demo's volume the paid plan is the $5 minimum.

## 1. Who pays gas

**Recommendation.** The World holds a small pool of relayer keys (Worker secrets on holdback-op1, the DO's environment) and pays gas for every message either node relays. One pool for both nodes: they are one process today, and a key per node would only split ETH and halve throughput without making the nodes more independent. Record which node relayed in `submittedVia`, as today. Move to a key per node when the nodes become separate deployments.

**Why this is relaying, not authoring (hard rule; ADR-0005).**

- Every state change the relayer submits is a message a party signed: the seller's terms, the primary's acceptance, the buyer's Agree and ERC-3009 funding, the seller's delivery, the adjudicator's decision, the buyer's early accept, both parties' settlement, a party's appeal. `HoldbackRules` recomputes the commitment ID from the calldata and checks each signature (`_requireSigned`, `HoldbackRules.sol:203-205,288,384,423-424,492,597`). A relayer that changes one field gets `BadSignature`.
- The relayer has no standing of its own: the contract never reads `msg.sender` (**measured**). CPP's operator is the rules contract, not the relayer (`_paymentInfo`, `:170-183`), so the relayer cannot capture, void or redirect a hold.
- Outcomes are fixed by the signed decision and the stage machine; deadlines by `block.timestamp` against the signed terms. The relayer can choose *when* within a window and *whether* to relay at all. That is the operator's listed power in `docs/neutrality.md` (relay, index, refuse service, rate-limit), nothing more.
- The one real power is the operator fee (ADR-0023): the buyer's own `transferWithAuthorization`, bundled with `agreeAndFund` through Multicall3 (`evm-settlement.ts:659-676`); the buyer signed it, the nonce binds it to one commitment, and another relayer or the agent itself can fund without it.

**What the relayer may and may not do** (write this into `docs/neutrality.md` as the Sepolia row's evidence):

| May | May not (and why) |
| --- | --- |
| Submit any signed message it received, pay gas, choose timing within deadlines, batch its own calls, refuse or rate-limit | Change any field (signatures), move funds (no CPP operator role, no `msg.sender` path), decide or appeal (adjudicator and party signatures), trigger a timeout early (`TooEarly`), stop a valid deal from settling (anyone can relay the same bytes, and the agent can send them itself) |

**The escape hatch on Sepolia.** An agent with Sepolia ETH calls `HoldbackRules` directly. Three things must be true for that to work from the public API alone:

1. **The settlement view must be reconstructible.** `H.Terms` is the public terms with strings and nested bodies replaced by their EIP-712 encodings (`contracts/src/HoldbackTypes.sol:28-56`). For a public deal the agent can build it from `GET /v1/commitments/{id}/terms`; document the mapping in `llms.txt` ("Encodings"), or serve the struct ready to ABI-encode at `GET /v1/commitments/{id}/settlement-view` (recommended: cheap, and it is what the relayer itself encodes).
2. **The acceptance must be served.** `agreeAndFund` needs the primary's `Acceptance` (seedCommitment, bondReserved, nonce, expiresAt, signature); today the `adjudicator.accepted` event carries only `seedCommitment` and the reserved amount (`simchain.ts:722`). Add the full message to `/terms` (as `signatures.adjudicator` plus its fields) or to the settlement-view route. Without it, direct funding is impossible, which breaks the neutrality test for the operator row.
3. **The operators must notice.** Every state change emits a `HoldbackRules` event keyed by commitment ID. The World syncs logs each tick (`eth_getLogs`, `address = rules`, from its stored cursor; §4) and reconciles: a stage change it did not cause becomes an event with `submittedVia: 'direct'`, `actor` from the log (seller on `JobSubmitted`, adjudicator on `Decided`, `tx.from` for triggers). A commitment the operators never saw (offered through someone else) is recorded as a skeleton-only entry: stage, amounts and tx hashes, no terms.

**Options considered.**

| Option | Tradeoff |
| --- | --- |
| **A. World-held relayer pool (recommended)** | Keys in Worker secrets, signing in process with viem; nothing new to run; the key custody is the same as today's adjudicator keys |
| B. A hosted relayer service (OpenZeppelin Relayer, Gelato) | Handles nonces and gas for us, but adds an account, a bill and a third party in the write path |
| C. Agents pay their own gas | Honest and simplest, but kills "funding is gasless for agents" (ADR-0005) and try.ts's one-command experience; keep it as the escape hatch only |
| D. ERC-4337 paymaster | Phase 5 (`docs/plan.md`); nothing in the contracts needs it |

## 2. Nonce and concurrency

**Recommendation.** Three relayer EOAs as independent **lanes**; a deal picks its lane by `commitmentId mod 3` (its funding, delivery, decision and triggers stay in order on one lane). Within a lane: simulate (`eth_call` on `pending`), estimate gas, send, persist, wait for the receipt, then take the next item. Lanes run concurrently, so three deals advance at full speed and a fourth queues behind the shortest lane. The faucet and the setup pass use a fourth lane so a burst of grants never delays a decision.

Why lanes rather than one key with many transactions in flight: a lane's next nonce is always "last mined + 1", which survives a Durable Object eviction and a load-balanced RPC that reports an inconsistent `pending` count (public endpoints serve from several nodes; **inferred**). One stuck transaction blocks one lane, not every deal. viem's `createNonceManager` would allow several transactions in flight from one key, but its own documentation warns that a failed send does not prove the nonce is free and that the pending nonce must be checked before reuse (**measured**, viem docs); that is exactly the state an evicted DO cannot keep. Add lanes before adding in-flight depth.

**Details.**

- **Gas limit.** `eth_estimateGas` on the pending block plus 25 %, capped at 1,500,000. The largest calls measured are the fee bundle (299,102) and a fallback `decide` with drand verification (297,591) (`docs/tasks/T-209-beacon-verification.md`); a fixed 3,000,000 limit reserves `limit × maxFeePerGas` of balance per transaction for nothing. A failing estimate is a refusal (the simulation already reverted) and is not sent.
- **Fees.** `maxPriorityFeePerGas` = median of the last 20 blocks' p50 rewards, clamped to [0.1, 2] gwei (today: 1 gwei); `maxFeePerGas` = 2 × base fee + tip, capped at 20 gwei. If the cap would be exceeded, hold the send and retry next tick: every protocol window on the demo is at least 60 s, and a fee spike on Sepolia is spam, not demand.
- **Stuck or dropped.** If no receipt after 3 blocks (36 s), rebroadcast the same raw transaction (drops are usually propagation); after 6 blocks, replace at the same nonce with fees +15 %, up to three times; then mark the lane `stuck` in `/v1/status`, keep retrying once a minute, and route new deals to the other lanes. If the payload is no longer valid (the simulation now reverts, for example a deadline passed), replace with a zero-value self-transfer to free the nonce.
- **Eviction mid-flight.** Before `eth_sendRawTransaction`, write `lane:<n>` = `{nonce, txHash, rawTx, commitmentId, call, sentAt}` to storage (one row). On open, read the three lane rows; in the first alarm, `eth_getTransactionReceipt(txHash)`: mined means record it (its logs come through the normal sync), not mined means rebroadcast `rawTx`. Do not do this inside `blockConcurrencyWhile` (30 s limit): load rows there, reconcile in the alarm.
- **Deploys.** `wrangler deploy` restarts the DO at any moment; the lane rows make that safe. Deploy op1 first as today (`apps/demo-cloud/scripts/deploy.mjs`).
- **Pre-funding checks stay in memory and on disk.** The adapter's scope, membership, daily-spend and nonce checks (`evm-settlement.ts:450-469,609-635`) move with the books into storage (§4); the signatures they collect are what `agreeAndFund` later needs, so losing them to an eviction must be impossible.

| Option | Throughput | Failure isolation | Eviction safety | Complexity |
| --- | --- | --- | --- | --- |
| Today: one queue, receipt inside it | 1 tx per block (5/min) for the whole demo | one stuck tx blocks everything | none (memory only) | lowest |
| **Lanes (recommended)** | N tx per block | per lane | last mined + 1 | low: today's queue, N times, plus one row per send |
| One key, viem nonce manager, many in flight | up to the pool's acceptance limit | a gap blocks all later nonces | needs a persisted in-flight set and pending-count checks | medium |
| Hosted relayer | high | theirs | theirs | an external account in the write path |

## 3. Confirmations and reorgs

**Recommendation.** Report a state as soon as the transaction is included in a `latest` block (one confirmation), and attach a `chain` object to the state read and to every on-chain event: `{txHash, blockNumber, blockHash, confirmations, finality: 'included' | 'safe' | 'final'}`. Do not gate the API on `safe` or `finalized`: finalized lagged 85 blocks (about 17 minutes) today and `safe` is reported inconsistently across providers (53 vs 2 blocks). Compute `safe` yourself as head − 32 (one epoch) and `final` from the `finalized` tag once per tick.

**What the API says meanwhile.** A write answers after inclusion (§10), so the response already carries `chain.confirmations: 1`. Between the send and the receipt nothing is reported except in `/v1/status` lane telemetry. Reads show `settledAt` as the block's timestamp (payee finality in the protocol sense, D20) and `finalAt` from the appeal window as today; `chain.finality` is a separate axis the docs explain: "money moved at `settledAt`; the block that moved it is final about 15 minutes later".

**Reorgs.** Post-Merge Ethereum uses 12 s slots and 32-slot epochs with checkpoint finality (**measured**, ethereum.org); short reorgs are rare and almost always one block deep (**inferred**: proposer boost; ethereum.org lists them as mitigated). Each tick, for every deal whose last transaction is within 64 blocks, compare the stored `blockHash` with `eth_getBlockByNumber(blockNumber).hash` (one batched call); on a mismatch, read `dealOf(id)` and `paymentState`, roll the book back to what the chain says, re-sync logs from the fork point, and append a `chain.reorg` event (operator-level, never deleting earlier events: the hash chain stays append-only). The relayer's lanes recover on their own: a dropped transaction is rebroadcast by the stuck rule.

| Option | Deal latency | Risk shown to users | Verdict |
| --- | --- | --- | --- |
| **Inclusion plus a `finality` field (recommended)** | +0 | a 1-block reorg could flip a state for seconds; reported honestly | demo-appropriate |
| Wait for `safe` | +6 to 11 minutes per step | none visible | a try.ts deal of 30+ minutes |
| Wait for `finalized` | +15 to 17 minutes per step | none | unusable for the demo |

## 4. Reading state

**Source of truth per field.**

| Field | Before funding | From funding on |
| --- | --- | --- |
| `escrowState` | the operator's book (Offered, AcceptedByAdjudicator, Agreed are not on chain by design, T-202 rule 1) | `dealOf(id).stage` and `.appeal` (`HoldbackRules.sol:148-150`), mirrored after each receipt and reconciled from logs each tick |
| `hold`, `attempt`, `appealState` | book | chain (`dealOf`, CPP `paymentState`) |
| `balances` | token `balanceOf`, cached per block | same |
| `deadlines` | the signed terms (identical everywhere) | same |
| `settledAt` | — | block timestamp of the settling transaction |
| `finalAt` | — | derived from terms and the clock (D20), as today |
| events | operator-side, `source: 'relay'` | the contract's logs, decoded as today (`eventTypesFor`, `evm-settlement.ts:152-166`), plus `tx` |
| receipts | signed by each node's key, as today | same; a receipt for an on-chain event names the tx hash |
| `chain` (new) | absent | `{txHash, blockNumber, blockHash, confirmations, finality}` |

**Event payloads: keep SimChain's shape and add `tx`.** Yes. Today four consumers read SimChain's fields (`payload.terms` in the operator index and the adjudicator adapter; `payload.ciphertext.uri` and `payload.plaintextSha256` in the adapter, try.ts and agent.ts; see the premises table), and all four would break on the current EVM payloads. The rule: an on-chain event's payload is SimChain's payload for that event (built from the relayed message the World holds, or from the log when it holds nothing) plus `tx: {hash, blockNumber, logIndex, from, gasUsed}` and `source: 'chain'`. Pre-funding events carry `source: 'relay'`. `spec/schemas/event.schema.json` gains the optional `tx` and `source` members in schema v0.9 (additive; the domain stays 0.6 by ADR-0023's rule).

**Both nodes agree** because they are one Durable Object: one book, one log, one cache. Agents cross-check two origins (`Agent.trusted`, `examples/agent.ts:63-67`), which today catches a lying Worker in front, not a lying World. Keep that honest in the docs (§13). For the day the nodes split, balances and `chain.confirmations` must carry `asOfBlock`, and the docs tell agents to compare states and amounts, tolerating `asOfBlock` within two blocks.

**Rebuild after eviction without the Nov 2 pattern.** Replace the append-only journal with a layout a restart can open in a handful of rows:

| Key | Holds | Written | Read |
| --- | --- | --- | --- |
| `meta` | secret, start, chain, deployment addresses, schema | once | at open |
| `cursor` | last synced block number and hash | each tick that advances | at open |
| `lane:<n>` | the in-flight send (§2) | per send | at open |
| `open` | the set of commitment IDs not yet final | on change | at open |
| `c:<id>` | the book: terms, signatures collected, state, delivery, envelopes received, released keys, `lastEventSeq` | per state change | lazily, on first access |
| `e:<id>:<seq>` | one event | per event | by prefix for `/events` of that deal |
| `tail` | global `{seq, hash}` of the last event (the hash chain) | per event | at open |
| `fa:<address>`, `ct:<sha256>`, `jr:<id>`, `budget:*` | as today | as today | on access |

Opening the world then reads `meta`, `cursor`, `tail`, three `lane` rows and `open` (plus the open deals' books when the adjudicator pass needs them). Rows read per restart: about 10 plus the number of open deals, instead of the whole history. The journal's purpose, deterministic replay, is served by the chain itself from funding on and by the books before it. SimChain's world keeps its journal, separately (§11).

**Catching up after a long absence.** `eth_getLogs(address = rules, fromBlock = cursor + 1, toBlock = head)` in chunks of 50,000 blocks (publicnode's cap; tenderly took 100,000). A day away is 7,200 blocks: one call.

## 5. Faucet minting tUSD on chain

**Recommendation.** The faucet lane mints synchronously: `POST /v1/faucet` returns after the receipt with the tx hash and the mandate, 12 to 24 s. Grants that arrive within the same tick are batched into one Multicall3 `aggregate3` of `tUSD.mint(to, amount)` calls (open mint; the token must not restrict the minter's `msg.sender`, which the T-206 deployer should confirm). Keep the mandate as it is (a World-signed object the adapter checks; the chain has no mandates).

**Abuse and budget.** The grant costs the relayer gas, not tokens (anyone can mint tUSD themselves). Keep today's limits (one grant per address per hour, 10 addresses per client per hour; `world.ts:182-184,383-392`) and add: a global `FAUCET_MINTS_PER_DAY` (600 is 0.036 ETH a day at 1 gwei, **inferred** from 60k gas per mint, **guessed**), answered with 429 `rate_limited` and `retryAfterSec` when spent; skip the mint when the address already holds at least the grant amount (`balanceOf`, cached per block) and still issue the mandate; pause the faucet first when the relayer runs low (§12). Mention in discovery that the token is open-mint, so an agent that already holds tUSD can skip the faucet entirely.

**Not recommended:** answering before the receipt. The buyer's `agreeAndFund` would revert if it raced the mint, and try.ts funds within seconds of the grant.

**Should the faucet give Sepolia ETH?** Appeals (`takeAppealBond` pulls with the appellant's allowance, `HoldbackBonds.sol:95-101`) and the escape hatch need the agent's own ETH. An opt-in `{"gas": true}` that sends 0.002 ETH, capped at 50 a day (0.1 ETH a day), would make both demonstrable. Cost is the only argument against; I recommend it as an option Rafa switches on when there is ETH to spare, and an honest limit until then (§13).

## 6. Funding and bonding the demo adjudicators

**Recommendation.** A `setup` pass the World runs on first open of a chain world and again on every open until it is complete, idempotent because every step is decided by an on-chain read:

1. For each adjudicator (keys derived from the world secret, as today, `world.ts:148,154`): if ETH balance < 0.005 ETH, the funding lane sends 0.01 ETH. One-time; a decision costs the adjudicator nothing because the relayer submits it.
2. If `bondOf(adj, tUSD) < target`: mint `target − bondOf` to the adjudicator (anyone can mint), then from the adjudicator's own key `approve(bonds, amount)` and `deposit(tUSD, amount)` (`HoldbackBonds.deposit` bonds `msg.sender`). Target 25,000 tUSD, the sim's figure (`world.ts:155`): at 100 % coverage of 25 tUSD deals until `appealDecideBy` (about 3 minutes with 60 s windows) that is a thousand concurrent deals.
3. Top up when `freeOf < 1,000 tUSD`, checked once a minute in the adjudicator pass.
4. Publish the result in discovery (`demo.adjudicators[].bond`, `.bondTx`) so an agent can check it on Etherscan.

Gas: approve about 46k, first deposit about 70 to 90k, mint about 60k (**guessed**), three adjudicators in parallel lanes: four blocks, well under 0.001 ETH in all. Record each step's tx hash in `setup:<adj>` rows so a half-finished pass is visible in status. The three adjudicator keys act from their own addresses for approve and deposit only; everything else they do is a signed message the relayer carries, as today.

## 7. drand proofs for fallback and appeal decisions

**Recommendation.** Add a `drand-quicknet` `RandomnessSource` to the adjudicator service (`apps/adjudicator/src/randomness.ts` defines the interface; `service.ts:281-286` already builds `beacon: {source, round, value}` from it):

- **Endpoint.** `GET {relay}/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/{round}` with relays tried in order `api2.drand.sh`, `drand.cloudflare.com`, `api.drand.sh`, `api3.drand.sh` (fastest first today; the order is a variable), 2 s timeout each. The round is computed, never asked for as `latest`: the fallback's round is `roundAt(judgeBy)` and the appeal's is the first round after the escalation or appeal was applied (`HoldbackRules.sol:258-266`, `packages/core/src/beacon.ts`). A future round answers 425 on the drand relays and 404 on Cloudflare's; treat both as "not yet".
- **Verify locally before signing.** Decompress the 48-byte signature, hash `sha256(round as 8 big-endian bytes)` to G1 (RFC 9380, DST `BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_`) and check the pairing against the quicknet public key with @noble/curves, as T-209 did for its vectors (`fixtures/beacon/drand-quicknet.json`). The chain verifies again in `decide`. Local verification matters for the relayer: a bad proof makes the pairing precompile burn up to 250,000 gas (`DrandQuicknetBeacon.sol:63-65`) and the adjudicator should never sign one. Cost: tens of milliseconds of CPU (**guessed**), within the DO's 30 s.
- **The Decision carries** `beacon: {source: 'drand-quicknet', round, value: '0x' + randomness, signature: '0x' + 96 hex}`; the schema already has these members (ADR-0018 consequences), and `encode.ts` already passes the signature bytes to `decide` (T-209 decision 1). `value` must equal `sha256(signature)`, which the service recomputes rather than trusting the relay's `randomness`.
- **Unreachable drand.** No relay answers, or none verifies: do not decide; log it; try again at the next pass until the deadline. The default path then applies (ADR-0018 §5; `docs/neutrality.md` residual 10). Nothing substitutes: not `prevrandao`, not a cached value for another round, not an operator-supplied value.
- **The parse rule** (`packages/core/src/parse.ts:160,172`) admits `drand-quicknet` when the settlement kind is `chain` (the rules contract verifies it); SimChain keeps `sim` only, as T-209 decision 9 reasons. The demo club's rulebook for the Sepolia world sets `randomness: {source: 'drand-quicknet', chainHash: '0x52db…'}`; the rulebook hash changes, which is fine for a new world.
- **From a Worker:** each relay call is one external subrequest; a decision needs one. The adjudicator pass runs in the DO, so the 50-per-invocation free limit holds only if the pass batches its RPC calls (§8).

**Timing.** A fallback can decide as soon as `judgeBy` passes (its round is already published, 3 s period); an appeal adjudicator waits at most 3 s for the first round after the escalation (ADR-0018 amendment, liveness note). The relays answered within 20 to 180 ms once warm.

## 8. RPC choice and rate limits from Workers

**Recommendation.** `fallback([http(publicnode), http(tenderly)], { rank: false, retryCount: 2, retryDelay: 150 })`, each `http(url, { batch: { wait: 10 }, timeout: 8_000 })`, in that order; `1rpc` excluded (50-block `getLogs` cap, rate-limited within a minute in testing), drpc excluded (paid only). A secret `SEPOLIA_RPC_URLS` (comma-separated) is prepended when set, so Rafa can add Infura/MetaMask Developer or Alchemy (free tiers, an account each) without a code change. Launching keyless is acceptable: the measured call volume is small once reads are cached.

**Batching.** viem's `http` transport coalesces calls made in the same tick into one JSON-RPC batch, which both publicnode and tenderly accept (**measured**). That is what keeps an alarm tick within the free plan's 50 external subrequests: a busy tick with ten deals is a few HTTP requests, not fifty.

**RPC calls per deal** (3 transactions, synchronous writes, reads cached per block; **inferred** from the adapter's code paths):

| Step | Calls |
| --- | --- |
| faucet, two grants in one batch | estimate 1, send 1, receipt polls 3, balances 2 |
| offer, acceptance, buyer checks | `freeOf` 1 (cached); everything else is off chain |
| agree-and-fund (bundle) | `DOMAIN_SEPARATOR` once per world, simulate 1, estimate 1, send 1, receipt 3, `dealOf` 1, balances 2 |
| deliver | simulate 1, estimate 1, send 1, receipt 3, `dealOf` 1 |
| decide | same as deliver plus balances 2 |
| ticks during the deal (about 8 at 12 s) | `eth_blockNumber` 8, `eth_getLogs` 8, `finalized` 8 |
| polled state reads | 0 against the chain (served from the mirror and the per-block cache); the cache refreshes 2 `balanceOf` per party per new block |
| **Total** | about 60 to 70 JSON-RPC calls, in about 25 HTTP requests with batching |

**Caching rules.** Balances and `dealOf` are cached by `(address, blockNumber)` and invalidated when the tick sees a new head; a write updates the mirror from its receipt and clears the deal's cache. Polled reads never touch the chain: try.ts polls both operators every 400 ms (`try.ts:56-64`), which is 5 reads a second per deal, and the free plan's 50 subrequests apply per request, so per-request chain reads would also be slow (36 to 170 ms each).

## 9. The Durable Objects quota

**Per try.ts deal on Sepolia** (3 transactions, synchronous writes; **inferred** from `try.ts` and the alarm code):

| Dimension | Per deal | Where it comes from |
| --- | --- | --- |
| DO requests from the client | about 100 to 210 | 2 operators × polls every 400 ms while waiting for acceptance (1 to 6 s) and for the outcome (12 to 30 s), plus about 30 other calls |
| DO requests from alarms | about 60 to 100 at a 1 s cadence over the deal, but up to 900 per deal at today's "1 s for 15 minutes after a write" | `worker.ts:88`, `world.ts:76` |
| Rows written | about 20 (books, events, lane rows, faucet keys) plus one per `setAlarm` | §4 layout |
| Rows read | about 10 at open, 0 to 3 per request | §4 layout |

Today's alarm policy is the dominant cost: one invocation and one `setAlarm` row every second for 15 minutes after any write is 900 requests and 900 rows written per idle quarter hour, 86,400 a day if the demo stays active, against free limits of 100,000 requests and 100,000 rows written a day. **Recommendation:** 2 s while any deal has adjudicator work pending or a lane has a transaction in flight; 12 s (one block) otherwise while active; nothing after 15 minutes idle. With ten try.ts deals an hour that is a few thousand alarm invocations a day. With the §4 storage layout, rows read fall from "the whole journal per eviction" to tens per day.

**Workers Paid.** Even so, the free plan fails hard: at the first exhausted dimension every further operation of that type errors until 00:00 UTC, which is what the demo showed on Nov 2. At the demo's volume the paid plan is the $5 minimum (Cloudflare's example 1: $5.15 for 1.5 million DO requests a month), lifts the subrequest cap to 10,000, the Worker CPU cap to 30 s and the DO requests to 1 million a month. I recommend it before the cutover; it is an account change for Rafa. The storage redesign is needed either way.

## 10. Latency

**Per step, try.ts flow** (12 s blocks; the first number assumes the next block, the second a one-block miss; **inferred**):

| Step | Today (SimChain) | Sepolia, on-chain deliver (3 tx) | Sepolia, delivery carried by the decision (2 tx) |
| --- | --- | --- | --- |
| faucet (two grants, one batched tx) | < 1 s | 12 to 24 s | same |
| offer | < 1 s | < 1 s (off chain) | same |
| accepted (next adjudicator pass) | 1 s | 1 to 2 s at a 2 s cadence | same |
| buyer checks | < 1 s | < 1 s | same |
| agree-and-fund (bundle) | < 1 s | 12 to 24 s | same |
| deliver | < 1 s | 12 to 24 s | < 1 s (held by the relayer) |
| decide (checks-only, next pass) | 1 to 2 s | 2 to 26 s | 2 to 26 s |
| open, balances, final | 1 s | 1 s | 1 s |
| **Whole deal** | about 4 s (measured 2026-11-03) | **about 60 to 100 s** | about 50 to 80 s |

**Recommendation: keep the on-chain `deliver` for the public demo.** Three reasons. Every API state then maps to a chain event (`JobFunded`, `JobSubmitted`, `Decided` + `PaymentReleased` + `KeyReleased`), which is the thing the demo is for: an observer can follow the whole deal on Etherscan. The seller's position is cleaner: an on-chain delivery stops a reclaim; a carried one leaves the deal at `Held` on chain until the decision lands, so a silent primary plus a passed `deliverBy` ends in a reclaim unless the relayer posts the delivery itself in time (one more rule to get right). The cost of the extra transaction is nothing on Sepolia (61,326 gas, about 0.00006 ETH). D4's two-transaction path stays available (`EvmSettlement.carryDelivery`) for the day gas matters, and the `Settlement` interface change it needs is in the backlog.

**Synchronous writes.** A write answers after inclusion, with `chain` attached. This keeps today's clients working unchanged: try.ts asserts `Held` on the agree response (`try.ts:128`), and the Durable Object has no wall-time limit while the client stays connected. ADR-0005's "202 pending, then an event on inclusion" becomes an opt-in header (`Prefer: respond-async`) for agents that want it, later.

**What the API and docs must say.** Discovery: `settlement: {kind: 'chain', chainId: 11155111, blockTimeSec: 12, contracts: {rules, bonds, escrow, token, erc3009Collector, multicall3, beacon}, explorer: 'https://sepolia.etherscan.io'}`; `llms.txt` "Try it": "every money step waits for a Sepolia block, so a deal takes a minute or two"; the write routes: "answers when the transaction is included; `chain.txHash` is yours to check". try.ts's `until` timeouts (60 s for acceptance and Held, 120 s for the outcome) already fit; its faucet step will simply take 12 to 24 s.

## 11. A rollback flag

**Recommendation.**

- A variable `SETTLEMENT` (`sim` | `sepolia`) in each wrangler file, plus `WORLD_TAG` (today's date suffix). The Worker computes the world name as `holdback-public-demo-${SETTLEMENT}-${WORLD_TAG}` and forwards to that Durable Object. The two worlds coexist in the same namespace; neither is deleted by a flip.
- The Durable Object decides what it is from its own name (`ctx.id.name`), not from `env`: the DO's env is always op1's (premises table), so a per-Worker variable cannot reach it any other way. The chain world's secrets (`SEPOLIA_RPC_URLS`, `RELAYER_KEYS`, and the deployment JSON or its path) live in op1's Worker secrets and must be set before any Worker flips.
- **Switching back in one deploy:** set `SETTLEMENT=sim` on both files, `pnpm demo-cloud:deploy`. The sim world's storage was never touched; it resumes where it stopped (its journal and clock are its own). The sepolia world's state is on chain and in its own storage; a later re-flip re-syncs from `cursor`.
- **op2 first.** Possible: op2's variable says `sepolia`, op1's says `sim`, and both Workers forward to different worlds through the same DO class. But a split pair is not usable by agents: try.ts and agent.ts require both origins to agree on discovery (the EIP-712 domain differs: chain ID 31337 vs 11155111, verifying contract placeholder vs `HoldbackRules`), so every stranger's run would refuse at `keys`. Use the split only for a smoke test with a single-origin script. **Rehearse instead on a staging pair:** `holdback-op1-sepolia` and `holdback-op2-sepolia` on workers.dev (free, no custom domain), run try.ts against them with `HOLDBACK_OPERATORS` and the Sepolia domain, then flip the production pair together.
- **What flips with it.** The site: `site/llms.txt`'s "Configure" domain block, the pinned domain in `examples/verify.ts` (`SIMCHAIN_DOMAIN`), the bundled `try.mjs` and its sha256 on the homepage, and `PRICE.token` (`'tUSD'` becomes the token address, ADR-0025). Build and deploy the site in the same change; a rollback deploys the previous site build.

## 12. Cost and the funding ask

**Gas per try.ts deal** (anvil receipts from T-209's table, which the adapter reproduces within 0.2 % of Foundry; **measured** there, **inferred** here for Sepolia):

| Path | Gas | At a 1 gwei tip (base fee 16 wei) | At a 0.1 gwei tip |
| --- | --- | --- | --- |
| Fee bundle + deliver + decide (recommended) | 299,102 + 61,326 + 130,785 = 491,213 | 0.00049 ETH | 0.000049 ETH |
| plus two faucet mints (**guessed** 60k each) | about 611,000 | **0.00061 ETH** | 0.000061 ETH |
| Fee bundle + decide carrying the delivery | 440,005 (+120k mints) | 0.00056 ETH | 0.000056 ETH |
| Fallback decided with drand | +136,500 | +0.00014 ETH | +0.000014 ETH |
| Setup: three adjudicators (ETH transfer, mint, approve, deposit) | about 600,000 once | 0.0006 ETH | — |

The first deal per relayer and per adjudicator pays one-time storage (CPP's TokenStore clone, first-touch slots): add about 100k (**guessed**).

**The ask.** 1.2 Sepolia ETH to one funding address the setup pass splits: 1.0 across the relayer lanes (about 1,600 deals at a 1 gwei tip, 16,000 at 0.1 gwei), 0.05 to the adjudicators, 0.1 for the optional ETH dust in the faucet, the rest buffer. Faucets listed on ethereum.org give in the order of 0.05 to 0.1 ETH a day each (Google Cloud Web3 needs a Google account; Alchemy 0.1 ETH per 24 h with an eligibility check; QuickNode about 0.05 per 12 h with a small mainnet balance; the pk910 PoW faucet pays for hashing; all **measured** as secondary sources' statements). Accumulating 1.2 ETH that way takes one to three weeks; 0.25 ETH (about 400 deals) is enough to launch.

**Low-balance behaviour.** `/v1/status` publishes each lane's address and balance (checkable on Etherscan) and `settlement.relayer.low: true` under 0.02 ETH. In order: the optional ETH dust stops at 0.1 ETH total; the faucet pauses at 0.05 ETH (429 `rate_limited`, `retryAfterSec`, detail "relayer low on Sepolia ETH"); writes answer 503 with a new problem type `relayer_unavailable` (schema v0.9) at 0.005 ETH, and the detail says direct submission to `HoldbackRules` still works. Decisions and triggers get the last ETH: they settle deals already funded.

## 13. Honest limits to state after the cutover

Replace the "One simulated settlement layer" bullet of `site/llms.txt` "Honest limits" with these, and keep the rest:

- **Settlement is real but the money is not.** Deals settle on Ethereum Sepolia in tUSD, a test token anyone can mint. Nothing here has value, and no real money can enter.
- **Two names, one process.** Both operator nodes are one program behind two addresses, with one set of relayer keys. Reading from both catches a lying front end, not a lying settlement index. Independent operators are a separate deployment, not yet run.
- **What the operators still hold:** the relayer keys that pay gas; the three test adjudicators' keys and their 25,000 tUSD bonds; the faucet; every offer, acceptance and agreement until funding (they are not on chain until `agreeAndFund`); the delivery's sealed keys for the adjudicators (the contract never holds envelopes); the judgment records (the chain holds their hash in `Decided`).
- **What you can check on Etherscan:** the contract addresses in discovery; that `HoldbackRules` and `HoldbackBonds` have no owner, pause or upgrade functions (verified source); every funded deal's transactions: `JobFunded`, `JobSubmitted`, `Decided`, `PaymentReleased` or `Refunded`, and `KeyReleased` with the buyer's sealed key, all keyed by the commitment ID; token balances and bonds; the relayer lanes' balances.
- **What you cannot:** the terms (only their hashes are on chain), pre-funding states, the judgment record's content.
- **Unaudited.** The contracts had an internal review by two model families (T-206, to be completed before the deployment); the drand verifier has had no external review; there is no third-party audit. `EXPIRY_MARGIN` is a deployment constant.
- **Your own gas for the escape hatch.** Filing an appeal or calling `HoldbackRules` yourself needs Sepolia ETH in your own key; the faucet gives test tUSD and a mandate, and ETH only when `{"gas": true}` is on.
- **Confirmations.** States are reported at inclusion; the block that moved the money is final about 15 minutes later (`chain.finality`). State may reset; keep your copy of the terms.
- **Sepolia's lifetime** is set by the Ethereum Foundation, not by this demo; the deployment addresses and chain are published in discovery and will change when the testnet does.

## Addendum: the Sepolia token after D42 (USDC only)

Rafa decided later the same day that the first wave is USDC only (D42). Two candidates for the demo, compared by the implementing session with read-only calls to publicnode Sepolia (`reports/scratch/usdc-probe.mjs`):

| Fact | Circle's Sepolia USDC | Our own test USDC (tUSDC) |
| --- | --- | --- |
| Address | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (measured: 1,798 bytes of proxy code) | Deployed with the core set (`contracts/script/TestUSDC.sol`) |
| EIP-712 domain | name "USDC", version "2", 6 decimals (measured) | name "Crow Test USDC", version "1", symbol tUSDC, 6 decimals |
| ERC-3009 | `transferWithAuthorization` and `receiveWithAuthorization` with a bytes signature both present (measured: each reverts on its own signature check, not "no such function") | The same two, one nonce space, `authorizationState` (forge tests) |
| Admin | An owner, a master minter, a pauser and a blacklister (measured: each returns an address) | None: no owner, pause, freeze, blacklist or upgrade |
| Minting for the faucet | Only through Circle's faucet: a person, a CAPTCHA and a rate limit (guessed limits; Rafa's to drive), so the demo needs a treasury refilled by hand | Open mint: the relayer mints each grant |

**Recommendation: tUSDC on the demo.** Every try.ts run needs about 27 test dollars per buyer, and a hand-filled treasury would run dry; an issuer that can blacklist an address could freeze a demo hold, the one thing the demo exists to show cannot happen. tUSDC keeps USDC's interface, so the switch to Circle's USDC (when the on-ramp lands, T-214, or on mainnet) is the token address and its domain in the deployment file. It must be named as a test token everywhere (tUSDC, "Crow Test USDC"), never as plain USDC.

## Cutover plan and the work by lane

Order matters because each step is testable on its own.

1. **Settlement (`packages/settlement/evm`): `kind: 'testnet'`.** Remove the anvil-only paths behind a `local` flag; a public RPC client with fallback and batching; lanes with persisted in-flight rows; estimate-based gas and the fee policy; books in a `WorldStorage`-shaped store instead of memory; the log cursor and tick-time sync; `keysFor` that returns the adjudicators' envelopes from the relayed delivery and the buyer's from `KeyReleased`; SimChain-shaped payloads plus `tx`; a reorg check. Tests: anvil with a 1 s block time and no `evm_setNextBlockTimestamp`, plus a fake RPC for drops, replacements and eviction.
2. **Schema v0.9 (T-033, ADR-0025 and ADR-0023's EVM amendment).** `cpp-erc3009` funding (`validAfter` 0, the derived nonce), token identifiers as addresses, `allowedTokens` optional, `event.tx` and `source`, `settlement.contracts` in discovery, `chain` on the state read, `relayer_unavailable`, the acceptance served for direct funding. `prepare/agree-and-fund` returns the token-domain typed data for `fund.signature` and `operatorFee.signature` and the Holdback-domain Agree; `examples/verify.ts` pins the token domain by the address discovery serves and recomputes the CPP nonce from `settlement.contracts`.
3. **Adjudicator:** the drand `RandomnessSource` with local verification; the parse rule for chain settlement; the envelope source for EVM; the demo rulebook's `randomness`.
4. **demo-cloud:** `SETTLEMENT` and `WORLD_TAG`, the world name, the storage layout, the alarm cadence, the setup pass, the faucet mint with batching and budgets, status telemetry for lanes and balances (T-031 covers the metrics side).
5. **Contracts and deployment (T-206):** `contracts/deployments/sepolia.json` with addresses, block numbers and bytecode hashes; `rules.BEACON().codehash` equals the `DrandQuicknetBeacon` runtime (backlog row from PR 77); the T-209 vectors replayed with `cast call`; the token's `mint` callable through Multicall3; Etherscan source verification (an API key is an account step for Rafa; Sourcify needs none).
6. **Examples and site (T-037):** domain, token address and timeouts in `try.ts`; the "Try it", "Configure", "How a deal works" and "Honest limits" text; the bundle and its sha256.
7. **Rehearsal** on the staging pair with the full try.ts flow, the escape hatch from an agent key that holds ETH, a fallback decision with a real drand round, an eviction (`wrangler deploy` mid-deal) and a 24-hour soak against the DO dashboard's request and row counters.
8. **Flip** both production Workers and the site in one change; watch `/v1/status` and the lanes; rollback is the same deploy with `SETTLEMENT=sim`.

Neutrality fixtures the cutover owes (`docs/neutrality.md`, litmus test 1): `neutrality.operator-refuses` and `neutrality.operator-offline` on `testnet` with the escape hatch from the agent's own key (as T-205 did on `local`), `neutrality.beacon-relay-refuses` (one relay down, another answers), and `todo.beacon-unavailable-whole-window` (no relay answers; the default applies).

## Asks for Rafa (outside the repository)

1. **Sepolia ETH:** 1.2 ETH to a funding address the setup pass controls (0.25 ETH is enough to launch).
2. **Cloudflare Workers Paid** ($5/month) before the cutover.
3. Optional: a keyed RPC account (Infura/MetaMask Developer or Alchemy, free tiers) for `SEPOLIA_RPC_URLS`; an Etherscan API key for source verification.
4. A yes or no on the faucet's optional ETH dust (0.1 ETH a day at the cap).

## Sources

Repository (paths relative to the worktree root): `CLAUDE.md`; `docs/neutrality.md`; `docs/architecture.md`; `docs/operations.md`; `docs/decisions/ADR-0003`, `-0005`, `-0007`, `-0018` (with the T-209 amendment), `-0023`, `-0025`, `-0026`; `docs/decisions-today.md` D4, D33, D37, D39; `docs/tasks/T-205-evm-settlement.md`, `T-206-contract-review.md`, `T-209-beacon-verification.md`, `T-037-one-approval-try.md`, `T-031-telemetry-mvp.md`; `docs/backlog.md` (Settlement layer); `packages/settlement/evm/evm-settlement.ts`, `world.ts`, `guard.ts`, `gas.ts`; `packages/settlement/src/interface.ts`; `packages/settlement/sim/simchain.ts`; `packages/core/src/parse.ts`, `eip712.ts`; `apps/demo-cloud/src/world.ts`, `worker.ts`, `storage.ts`, `wrangler.op1.jsonc`, `wrangler.op2.jsonc`, `scripts/deploy.mjs`; `apps/operator/src/prepare.ts`, `server.ts`, `guards.ts`, `terms.ts`; `apps/adjudicator/src/randomness.ts`, `simchain-adapter.ts`, `service.ts`; `contracts/src/HoldbackRules.sol`, `HoldbackBonds.sol`, `HoldbackTypes.sol`, `DrandQuicknetBeacon.sol`; `contracts/script/LocalUSDC.sol`; `examples/try.ts`, `agent.ts`, `verify.ts`; `site/llms.txt`. Open PRs on 2026-11-03: #120 (T-206 H-1, in flight); the branch `claude/t-206-contract-review-d83e9c` has no diff against main yet, so no `contracts/deployments/sepolia.json` exists.

Measurements: `reports/scratch/sepolia-rpc-probe.mjs` and `.json`, `sepolia-tags-probe.mjs`, `drand-probe.mjs` and `.json` (2026-11-03, read-only).

External:
- Cloudflare docs: Workers limits (https://developers.cloudflare.com/workers/platform/limits/), subrequests changelog 2026-02-11 (https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/), Workers pricing (https://developers.cloudflare.com/workers/platform/pricing/), Durable Objects pricing (https://developers.cloudflare.com/durable-objects/platform/pricing/), Durable Objects limits (https://developers.cloudflare.com/durable-objects/platform/limits/), lifecycle (https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), `blockConcurrencyWhile` (https://developers.cloudflare.com/durable-objects/api/state/).
- viem: fallback transport (https://viem.sh/docs/clients/transports/fallback), nonce manager (https://viem.sh/docs/accounts/local/createNonceManager).
- drand: developer page with the relay list (https://drand.love/developer), quicknet announcement (https://drand.love/blog/2023/10/16/quicknet-is-live), HTTP API v2 reference (https://docs.drand.love/dev-guide/API%20Documentation%20v2/drand-http-api).
- Ethereum: proof-of-stake and finality (https://ethereum.org/en/developers/docs/consensus-mechanisms/pos/), networks and faucets (https://ethereum.org/en/developers/docs/networks/), Holesky and Hoodi testnet updates with Sepolia's expected end of life (https://blog.ethereum.org/2025/03/18/hoodi-holesky), eth-clients/sepolia README with the fork schedule (https://github.com/eth-clients/sepolia).
- RPC providers: publicnode landing page (https://ethereum.publicnode.com/?sepolia), Infura pricing (https://www.infura.io/pricing), Alchemy free tier (https://www.alchemy.com/support/free-tier-details, https://docs.alchemy.com/reference/pricing-plans).
- Faucets (secondary): Alchemy Sepolia faucet (https://www.alchemy.com/faucets/ethereum-sepolia), ethpandaops Sepolia page listing the PoW faucet (https://sepolia.ethpandaops.io/), DEXTools and Datawallet guides for the Google Cloud and QuickNode amounts.
