# T-218: Direct contract calls appear in the operators' view

- **Lane:** settlement (with demo, for the world)
- **Phase:** 2
- **Depends on:** T-213 (the Sepolia world)
- **Paths this task may touch:** `packages/settlement/evm/evm-settlement.ts`, `sync.ts` (new), `chain.ts`, `live.ts` (only the log read), `world.ts` (the anvil harness's log read), `index.ts` (the export), and their tests (`evm-settlement.test.ts`, `wall.test.ts`, a new `sync.test.ts`); `apps/demo-cloud/src/world.ts`, `storage.ts`, and their tests (`world.test.ts`, `live.test.ts`); `docs/decisions/ADR-0028-demo-settles-on-sepolia.md` (a dated note in §11); `docs/neutrality.md` (only if a residual changes); `docs/backlog.md` (its row); `docs/plan.md` (this row, and the named test's line under the scenario index); this file
- **Human gate:** no. The live deploy is T-220's.
- **Status:** todo
- **Agent/session:** —

## Intent

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

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
