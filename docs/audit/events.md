# Events

This page lists every event the phase-one rules contract emits; the beacon emits none. For each event it gives the fields, the functions that emit it, who reads it, what a reader lacks and what it reveals in public. Rafa's rule is that events are never removed, with one exception: a feature he cut takes its events with it (ADR-0031 §10). Each gap below is a requirement for the settlement spec (T-245), not a change made here.

Not in phase one (SimChain keeps the full protocol's event types): the vault's `BondDeposited`, `BondWithdrawn`, `BondEncumbered`, `BondReleased`, `AppealBondHeld`, `AppealBondPaid` and `BondSlashed`; the appeal events `AppealFiled` and `AppealClosed`; and `Paid`, the event for a third-party payout. One event is new: `SettlementAddresses` (ADR-0033). The contracts deployed on Sepolia today still emit the old set until the redeploy.

Labels: **measured** (read from the named file at the lane's tip, or produced by the named command), **documented** (stated in the doc cited), **inferred** (concluded from reading), **unknown** (not in this repository). Contract code is cited by function name in `HoldbackRules.sol` at the frozen commit (the tag `contracts-phase-one-1`; [`scope.md`](scope.md)). The event list comes from `grep -n "event \|emit "` over `contracts/src/` [measured on the lane, 2026-11-12; to measure again at the freeze].

## Who reads the events

| Consumer | What it reads | Where |
| --- | --- | --- |
| The operators' EVM adapter (`packages/settlement/evm`), which `apps/operator` and `apps/demo-cloud` run | The rules contract's logs only: one `eth_getLogs` over the rules address, optionally filtered by commitment ID in `topics[1]`. It maps each log, per call, to a settlement event type; logs from CPP and the token map to nothing | `sync.ts`; the mapping `LOG_TYPES` in `evm-settlement.ts` [measured] |
| The same adapter, checking its own relays | `Decided`'s fields against the decision it sent; `JobCompleted`'s evaluator for an early accept; `PaymentReleased` for a mutual settlement; `JobSubmitted`'s hash for a delivery; `KeyReleased` to serve the buyer's key for a deal the operators fell behind on | `evm-settlement.ts` [measured] |
| The same adapter, following timeouts | `FallbackTriggered`, `Defaulted`, `JobExpired` and `Refunded` from the logs alone, whatever sent them (T-218, T-231) | `evm-settlement.ts`, the set `TIMEOUTS` and the sync's timeout branch [measured] |
| Bond state for the API | None: phase one has no bond vault. The adapter reports each adjudicator's pool with no bond | `evm-settlement.ts` [measured] |
| The end-to-end driver (`examples/e2e-chain.ts`) | Every log of a scenario's transactions, decoded against all ABIs, compared by the `examples/e2e-scenarios*.ts` checks | `e2e-chain.ts` [measured] |
| The signed record | The operators' hash-chained settlement log and signed receipts are built from the adapter's settlement events, so an event the adapter does not map is not in the record | `docs/architecture.md`, "Events, receipts, audit" [documented]; the consequence [inferred] |
| Crow Control | Not in this repository | [unknown] |
| Auditors | Any log, from any node. Bond backers are not in phase one (ADR-0014) | [inferred] |

No other code in `apps/`, `packages/`, `examples/` or `site/` reads chain logs: `git grep -ln "getLogs\|eth_getLogs\|decodeEventLog\|parseEventLogs"` over those paths, tests and `dist` excluded, finds only `evm-settlement.ts`, `sync.ts` and `e2e-chain.ts` [measured on the lane, 2026-11-12].

## The rules contract's events

Indexed fields are marked *(i)*. The first indexed field of every rules event is the commitment ID, which is how the sync filters by deal.

The first eight are shaped after the draft ERC-8183 (job ID = commitment ID, client = buyer, provider = seller, evaluator = primary adjudicator). `PaymentReleased` and `Refunded` are not in that draft, and its `ProviderSet` and `BudgetSet` are never emitted (review I-10) [documented]. `client` and `provider` name the parties, which sign. The tokens move to and from the two money addresses that `SettlementAddresses` names. A reader takes the address that received tokens from that event or from the token's `Transfer` log, never from `PaymentReleased.provider` or `Refunded.client` (ADR-0033 §2).

| Event | Fields | Emitted by | Adapter maps it to | What it reveals in public |
| --- | --- | --- | --- | --- |
| `JobCreated` | `jobId` *(i)*, `client` *(i)*, `provider` *(i)*, `evaluator`, `expiredAt` (CPP's `authorizationExpiry`) | `agreeAndFund` | nothing | The buyer's, seller's and primary's signing addresses, and the hold's expiry. Indexed parties let anyone list an address's deals (residual 9) |
| `JobFunded` | `jobId` *(i)*, `client` *(i)*, `amount` (price + fee) | `agreeAndFund` | `hold.funded` | The held total |
| `SettlementAddresses` | `id` *(i)*, `buyerPaymentAddress` *(i)*, `sellerPayoutAddress` *(i)* | `agreeAndFund`, once per deal, after `JobFunded` | nothing (it is in the adapter's ABI only, `abis.json`) [measured] | The two money addresses. Indexed, they let anyone list the deals that pay or refund an address |
| `JobSubmitted` | `jobId` *(i)*, `provider` *(i)*, `deliverable` (the delivery's EIP-712 struct hash) | `_acceptDelivery`, from `deliver`, `decide` in `Held`, or `earlyAccept` in `Held` | `delivery.submitted` | That the seller delivered, and when; a hash, not the content |
| `JobCompleted` | `jobId` *(i)*, `evaluator` *(i)*, `reason` | `_settleDecision` on accept (evaluator = the decider, reason = the judgment record hash); `earlyAccept` (evaluator = the buyer, reason 0) | nothing | Who accepted |
| `JobRejected` | `jobId` *(i)*, `rejector` *(i)*, `reason` (the judgment record hash) | `_settleDecision` on reject | nothing | Who rejected |
| `JobExpired` | `jobId` *(i)* | `reclaim` | the sync reads it for `reclaim` | That the seller missed `deliverBy` |
| `PaymentReleased` | `jobId` *(i)*, `provider` *(i)*, `amount` | `_settleDecision` on accept (the price); `earlyAccept` (the price); `_payOut` (the seller's share, when above 0). The tokens go to the seller's payout address | `settlement.released` | The seller's payment |
| `Refunded` | `jobId` *(i)*, `client` *(i)*, `amount` | `_settleDecision` on reject (the price); `earlyAccept` (the fee, when above 0); `_payOut` (the buyer's share plus the fee, when above 0); `_refundAll` (price + fee). The tokens go to the buyer's payment address | `settlement.refunded` (from `decide`, `triggerDefault`); `settlement.reclaimed` (from `reclaim`) | The buyer's refund |
| `FeePaid` | `id` *(i)*, `adjudicator` *(i)*, `amount` | `_settleDecision` when the fee is above 0, on accept and on reject. `_payOut` emits none (I-2, fixed in T-334) | nothing | The decider's fee |
| `Decided` | `id` *(i)*, `adjudicator` *(i)*, `role`, `outcome`, `judgmentRecordHash`, `seed` | `decide`, every role and outcome, before the money moves | `judgment.decided` | The decider, its role, the outcome, the judgment record hash and the panel seed (for the primary, its revealed seed) |
| `KeyReleased` | `id` *(i)*, `recipient` *(i)*, `path` (`KEY_DECISION` 0, `KEY_EARLY_ACCEPT` 1, `KEY_MUTUAL` 2), `scheme`, `ciphertext` | `_releaseKey`, from `_settleDecision`, `earlyAccept` and `mutualSettle` | `key.released` | That the work was handed over, by which path, and the content key sealed to the buyer. Only the buyer's key opens it [inferred] |
| `FallbackTriggered` | `id` *(i)*, `beaconRound` (the round that seeds the fallback's panel: the first published after `judgeBy − 1 + BEACON_MARGIN`, `_fallbackRound`) | `triggerFallback` | `fallback.triggered` | That the primary missed `judgeBy`, and the round that fixes the fallback's seed |
| `Defaulted` | `id` *(i)*, `from` (the stage) | `triggerDefault`, before the refund | `default.triggered` | That the fallback or the appeal adjudicator missed its deadline |
| `MutuallySettled` | `id` *(i)*, `keyReleased` | `mutualSettle` | `commitment.settled` | That the parties settled, and whether the key went to the buyer. A late-work settlement shows as `keyReleased` true with a `KeyReleased` path 2, on a deal with no `JobSubmitted` |

An unfunded offer's expiry has no event. The operators record `offer.expired` by their own clock, with no transaction (ADR-0031 §7; `contracts/test/unit/NoOfferExpiry.t.sol`, `test_jobExpired_isStillEmittedByReclaim`).

CPP's `AuthCaptureEscrow` emits its own events in the same transactions (`PaymentAuthorized`, `PaymentCaptured`, `PaymentVoided`, `PaymentReclaimed`, `PaymentRefunded`, `PaymentCharged`, `TokenStoreCreated`), keyed by the `PaymentInfo` hash, not the commitment ID [measured: `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol:78-105` at `6b0a5ef`]. CPP is out of scope; the adapter maps none of them.

## Gaps, as requirements for the settlement spec (T-245)

Each is a reader's gap, not a fault in the contracts [inferred unless marked]. A fix adds a field or a new event; it never removes or renames one. The deployed model's gaps E-1, E-2 and E-8 described the vault's events; they are not in phase one.

| ID | Gap | Who is short | Requirement |
| --- | --- | --- | --- |
| E-3 | `Decided` omits the attempt, the delivery hash, the beacon round and the appeal ground hash. A reader takes them from calldata or `deliveryHashOf` | Auditors checking a decision against the delivery (ADR-0029) | The spec lists the decision fields the record must carry, and whether they come from the event or calldata |
| E-4 | No event carries the price and fee split, or the fallback and appeal adjudicators. The token is the deployment's `TOKEN()`. `JobFunded.amount` is price + fee; `JobCreated.evaluator` is the primary only | Indexers that read logs alone | The spec says which terms fields are read from calldata (the settlement view) and which must be in a log |
| E-5 | `Refunded.amount` means four things (the price, the fee, a share plus the fee, or price + fee), with no path field. After the payment address reclaimed on CPP, `_refundAll` returns before it emits `Refunded`; the money moved in CPP's `PaymentReclaimed`, to the payment address | The record, accounting | The spec defines each refund's meaning by call, and how the record shows a CPP reclaim |
| E-6 | Closed in phase one: only `reclaim` emits `JobExpired` | — | None |
| E-7 | No event carries the closing reason. A reader takes it from `dealOf` (`Deal.reason`, `Deal.decider`), or from the events of the call that closed the deal: `Decided`, `JobCompleted`, `MutuallySettled`, `Defaulted` or `JobExpired`. In phase one every closing event is final | Readers computing finality (`finalAt`, D20) | The spec maps each closing call to its reason |
| E-9 | An escalation emits only `Decided` with outcome 2. The `Escalated` stage and its start time are inferred from that | Readers deriving the appeal adjudicator's deadline | The spec maps outcome 2 to the escalation and its deadline to the block time |
| E-10 | Two ERC-8183-shaped names are not in the draft, and two draft events are never emitted (I-10) | ERC-8183 indexers | Settle the names against the final EIP text before an indexer relies on them |
| E-11 | `PaymentReleased.provider` and `Refunded.client` name the parties, not the addresses that received tokens | Indexers, accounting | The spec says a reader takes the receiving address from `SettlementAddresses` or the token's `Transfer` log (ADR-0033 §2) |
| E-12 | A late-work settlement has no event of its own. A reader recognises it as `MutuallySettled(keyReleased = true)` and `KeyReleased` path 2 on a deal with no `JobSubmitted` | Readers of the record | The spec defines the pattern; no event gains a field |

## What the events reveal together

The events publish the deal's skeleton: the parties' addresses and the two money addresses, the primary, the held total, the outcome, and each payout and fee. That is the public skeleton of residual 9, and anyone needs it to trigger timeouts [documented: `docs/neutrality.md`]. The deliverable, the terms' body and the judgment travel as hashes or ciphertext. `KeyReleased` puts the buyer's sealed key on chain; its safety rests on the buyer's key and the sealing scheme [inferred]. At the `private` and `judgment` levels the parties sign with per-deal keys, so the indexed signing addresses are per-deal, and funding can still link them (residual 11) [documented: ADR-0024; `docs/neutrality.md`].
