# T-219: An in-flight row per relayer lane, written before the broadcast

- **Lane:** settlement (with demo, for the store)
- **Phase:** 2
- **Depends on:** T-218 merged first. This task edits `packages/settlement/evm/live.ts` and `evm-settlement.ts` after T-218's changes, and a recovered transaction is applied through T-218's log sync.
- **Paths this task may touch:** `packages/settlement/evm/live.ts`, `chain.ts`, `evm-settlement.ts` (only telling this node's recovered relays from direct calls), and their tests (`live.test.ts`, `receipt.test.ts`, `evm-settlement.test.ts`); `apps/demo-cloud/src/lanes.ts` (new: the row store over the Durable Object's storage) and its test; `apps/demo-cloud/src/worker.ts` and `world.ts` (only to hand the store to `LiveChain`); `docs/decisions/ADR-0028-demo-settles-on-sepolia.md` (a dated note in §11); `docs/operations.md` (the "deploy while no deal is mid-step" warning); `docs/backlog.md` (its row); `docs/plan.md` (this row); this file
- **Human gate:** no. The live deploy is T-220's cutover.
- **Status:** todo
- **Agent/session:** —

## Intent

Each relayer lane sends one transaction at a time and waits for its receipt (ADR-0028 §3). It keeps what it sent only in memory. A Durable Object that restarts between the broadcast and the receipt, on a deploy or an eviction, forgets the transaction: it still lands on chain, but the operators' view misses it. Seen live at the cutover (T-213 Evidence): a decision landed with `KeyReleased` on chain while the operators' log stopped at the delivery, so the buyer's key was on chain but not served. `docs/operations.md` tells deployers to deploy holdback-op1 only while no deal is mid-step.

Restated: before each broadcast, the lane writes one row with what it is sending and why. After a restart, the world reads the rows and resolves each one: a mined transaction is applied as this node's own relay, and a pending one is rebroadcast as it was, never replaced by another message at its nonce. T-218's sync already applies a missed receipt from the logs, as a direct call. This task makes the recovery exact: the right label, the off-chain parts the adapter held (the delivery's envelopes), the nonce, and the client's retry.

The design is in the research pass, `docs/research/2026-11-03-sepolia-demo-settlement.md` §2 (the `lane:<n>` row) and ADR-0028 §11.

## Context

- ADR-0028 §3 (lanes, serial per lane, rebroadcast and fee bump), §11; `packages/settlement/evm/live.ts` (`sendNow`, `broadcast`, `nonces`).
- T-213 Evidence ("The homepage command, live") and Handoff (the deal it left behind, `0x804d3fb3…5af0`).
- The backlog row "Idempotency records (operator and faucet) live in memory" (T-026).

## Acceptance criteria

- [ ] **The row.** Before each broadcast on a deal lane, the lane writes one row:
  - the lane and the nonce;
  - every hash sent at that nonce (rebroadcasts and fee bumps);
  - the raw transaction;
  - the submission: the message, its `Idempotency-Key` and body hash, and what the adapter holds off chain for it (such as a delivery's envelopes).

  The row is removed only after its receipt has been applied.
- [ ] **Recovery.** When the world opens, and on its next pass, each row is resolved:
  - **mined:** applied once, as this node's relay, through T-218's path. Its events are labelled as a relay is, the adjudicators get their envelopes, and the buyer's key is served;
  - **pending:** the same raw transaction is rebroadcast; no other message is ever sent at that nonce;
  - **not found after the receipt timeout:** rebroadcast, then the existing give-up rule.
- [ ] **The nonce.** After a restart a lane's nonce is the row's nonce plus one once that row is mined. It is never read from `pending` while a row is open.
- [ ] **The client's retry.** A retry with the same `Idempotency-Key` and body as a recovered submission gets the mined result, not `invalid_state`. The same key with another body gets 409 (hard rule: idempotency).
- [ ] **The cutover case, tested.** On anvil with `--block-time 1`, the world stops between broadcast and receipt for a funding, a delivery and a decision, then reopens from the same storage. Its log then matches an uninterrupted run's, and the buyer reads its key.
- [ ] **Cost.** One row written and one deleted per transaction, and at most one row read per lane when the world opens [measured with T-031's counters].
- [ ] **Docs.**
  - `docs/operations.md`: the warning to deploy holdback-op1 only while no deal is mid-step is replaced by what the row now guarantees, or kept with the limit that remains.
  - ADR-0028 §11 gets a dated note, and the backlog row is closed.
- [ ] **Review.** `reviewer` and `red-teamer`, each with project context (relayer code: the relayer relays and never authors). `pnpm verify` green.

## Out of scope

- Several transactions in flight per lane (ADR-0028 §3 keeps one).
- The funding lane's sends. Its setup steps are idempotent against on-chain reads. A faucet grant whose answer is lost in a restart may mint again when the client retries: test tokens only (inferred).
- The operator's other idempotency records, which stay in memory (backlog).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
