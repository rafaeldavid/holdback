# Events

The contracts emit 24 events: 17 from `HoldbackRules` and 7 from `HoldbackBonds`. The beacons emit none. This page lists each event's fields, the functions that emit it, who reads it, what a reader lacks, and what it reveals in public. Events are never removed. Each gap below is a requirement for the settlement spec (T-245), not a change made here.

Labels: **measured** (read from the named file at `main` `1430f77`, or produced by the named command), **documented** (stated in the doc cited), **inferred** (concluded from reading), **unknown** (not in this repository). Line numbers are at `1430f77`, where `contracts/src` equals the deployed commit `64be1f1` [measured]. The event list comes from `grep -n "event \|emit "` over `contracts/src/` [measured, 2026-11-11].

## Who reads the events

| Consumer | What it reads | Where |
| --- | --- | --- |
| The operators' EVM adapter (`packages/settlement/evm`), which `apps/operator` and `apps/demo-cloud` run | The rules contract's logs only: one `eth_getLogs` over the rules address, optionally filtered by commitment ID in `topics[1]`. It maps each log, per call, to a settlement event type; logs from CPP, the vault and the token map to nothing | `sync.ts:246-251`; the mapping `LOG_TYPES` at `evm-settlement.ts:301-314`; the appeal-decision mapping at `:348-357` [measured] |
| The same adapter, checking its own relays | `Decided`'s fields against the decision it sent; `JobCompleted`'s evaluator for an early accept; `PaymentReleased` and `Paid` for a mutual settlement; `JobSubmitted`'s hash for a delivery; `KeyReleased` to serve the buyer's key for a deal the operators fell behind on | `evm-settlement.ts:1981-1989`, `:2084-2115`, `:2161`, `:2501`, `:1887-1896` [measured] |
| The same adapter, following timeouts | `FallbackTriggered`, `Defaulted`, `JobExpired`, `Refunded` and `AppealClosed(Expired)` from the logs alone, whatever sent them (T-218, T-231) | `evm-settlement.ts:329`, `:2053-2070` [measured] |
| Bond state for the API | Not events: the adapter reads `bondOf` and `freeOf` from the vault | `evm-settlement.ts:641-647` [measured] |
| The end-to-end driver (`examples/e2e-chain.ts`) | Every log of a scenario's transactions, decoded against all ABIs, compared by the `examples/e2e-scenarios*.ts` checks | `e2e-chain.ts:249`, `:301-302` [measured] |
| The signed record | The operators' hash-chained settlement log and signed receipts are built from the adapter's settlement events, so an event the adapter does not map is not in the record | `docs/architecture.md`, "Events, receipts, audit" [documented]; the consequence [inferred] |
| Crow Control | Not in this repository | [unknown] |
| Auditors and bond backers | Any log, from any node. Backers do not exist on chain yet (ADR-0014, Phase 4) | [inferred] |

No other code in `apps/`, `packages/`, `examples/` or `site/` reads chain logs: `grep -rln "getLogs\|eth_getLogs\|decodeEventLog\|parseEventLogs"` over those paths, tests and `dist` excluded, finds only `evm-settlement.ts`, `sync.ts` and `e2e-chain.ts` [measured, 2026-11-11].

## The rules contract's events

Indexed fields are marked *(i)*. The first indexed field of every rules event is the commitment ID, which is how the sync filters by deal.

The first eight are shaped after the draft ERC-8183 (job ID = commitment ID, client = buyer, provider = seller, evaluator = primary adjudicator). `PaymentReleased` and `Refunded` are not in that draft, and its `ProviderSet` and `BudgetSet` are never emitted (review I-10) [documented].

| Event | Fields | Emitted by | Adapter maps it to | What it reveals in public |
| --- | --- | --- | --- | --- |
| `JobCreated` | `jobId` *(i)*, `client` *(i)*, `provider` *(i)*, `evaluator`, `expiredAt` (CPP's `authorizationExpiry`) | `agreeAndFund` (`HoldbackRules.sol:216`) | nothing | The buyer's, seller's and primary's addresses, and the hold's expiry. Indexed parties let anyone list an address's deals (residual 9) |
| `JobFunded` | `jobId` *(i)*, `client` *(i)*, `amount` (price + fee) | `agreeAndFund` (`:217`) | `hold.funded` | The held total |
| `JobSubmitted` | `jobId` *(i)*, `provider` *(i)*, `deliverable` (the delivery's EIP-712 struct hash) | `_acceptDelivery` (`:629`), from `deliver`, `decide` in `Held`, or `earlyAccept` in `Held` | `delivery.submitted` | That the seller delivered, and when; a hash, not the content |
| `JobCompleted` | `jobId` *(i)*, `evaluator` *(i)*, `reason` | `_settleDecision` on accept (`:352`; evaluator = the decider, reason = the judgment record hash); `earlyAccept` (`:414`; evaluator = the buyer, reason 0) | nothing | Who accepted |
| `JobRejected` | `jobId` *(i)*, `rejector` *(i)*, `reason` (the judgment record hash) | `_settleDecision` on reject (`:358`) | nothing | Who rejected |
| `JobExpired` | `jobId` *(i)* | `expireOffer` (`:529`); `reclaim` (`:539`) | `offer.expired` (from `expireOffer`); the sync reads it for `reclaim` too (`evm-settlement.ts:2062-2067`) | That an offer lapsed or the seller missed `deliverBy` |
| `PaymentReleased` | `jobId` *(i)*, `provider` *(i)*, `amount` | `_settleDecision` on accept (`:353`, the price); `earlyAccept` (`:415`, the price); `_payOut` (`:480`, the seller's share) | `settlement.released` | The seller's payout |
| `Refunded` | `jobId` *(i)*, `client` *(i)*, `amount` | `_settleDecision` on reject (`:359`, the price); `earlyAccept` (`:416`, the fee); `_payOut` (`:495`, the buyer's share plus the fee); `_refundAll` (`:610`, price + fee) | `settlement.refunded` (from `decide`, `triggerDefault`); `settlement.reclaimed` (from `reclaim`) | The buyer's refund |
| `FeePaid` | `id` *(i)*, `adjudicator` *(i)*, `amount` | `_settleDecision` when the fee is above 0, on accept and on reject (`:361`). A second emit in `_payOut` never runs (I-2) | nothing | The decider's fee |
| `Paid` | `id` *(i)*, `to` *(i)*, `amount` | `_payOut`, for each payout to an address that is neither party (`:474`) | nothing (the adapter checks it, `evm-settlement.ts:2115`) | A third-party payee of a mutual settlement |
| `Decided` | `id` *(i)*, `adjudicator` *(i)*, `role`, `outcome`, `judgmentRecordHash`, `seed` | `decide`, every role and outcome, before the money moves (`:302`) | `judgment.decided` | The decider, its role, the outcome, the judgment record hash and the panel seed (for the primary, its revealed seed) |
| `KeyReleased` | `id` *(i)*, `recipient` *(i)*, `path` (0 decision, 1 early accept, 2 mutual, 3 appeal), `scheme`, `ciphertext` | `_releaseKey` (`:648`), from `_settleDecision` (`:354`), `_appealDecision` (`:379`), `earlyAccept` (`:417`), `mutualSettle` (`:456`) | `key.released` | That the work was handed over, by which path, and the content key sealed to the buyer. Only the buyer's key opens it [inferred] |
| `FallbackTriggered` | `id` *(i)*, `beaconRound` (the round at `judgeBy`) | `triggerFallback` (`:550`) | `fallback.triggered` | That the primary missed `judgeBy`, and the round that fixes the fallback's seed |
| `Defaulted` | `id` *(i)*, `from` (the stage) | `triggerDefault` (`:567`), before the refund | `default.triggered` | That the fallback or the appeal adjudicator missed its deadline |
| `AppealFiled` | `id` *(i)*, `appellant` *(i)*, `bond` | `fileAppeal` (`:517`) | `appeal.filed` | Which party lost the first decision, and its appeal bond |
| `AppealClosed` | `id` *(i)*, `verdict` (`Upheld`, `Overturned` or `Expired`) | `_appealDecision` (`:377`); `expireAppeal` (`:591`) | `appeal.decided` (from `decide`); `appeal.expired` (from `expireAppeal`) | How the appeal ended |
| `MutuallySettled` | `id` *(i)*, `keyReleased` | `mutualSettle` (`:455`) | `commitment.settled` | That the parties settled, and whether the key went to the buyer |

## The bond vault's events

| Event | Fields | Emitted by | Adapter maps it to | What it reveals in public |
| --- | --- | --- | --- | --- |
| `BondDeposited` | `adjudicator` *(i)*, `token` *(i)*, `amount` | `deposit` (`HoldbackBonds.sol:57`) | nothing (not synced) | An adjudicator's bond size |
| `BondWithdrawn` | `adjudicator` *(i)*, `token` *(i)*, `amount` | `withdraw` (`:66`) | nothing (not synced) | Same |
| `BondEncumbered` | `adjudicator` *(i)*, `token` *(i)*, `amount` | `encumber` (`:78`), from `agreeAndFund` (`HoldbackRules.sol:215`) and a fallback's decision (`:327`) | nothing (not synced) | The adjudicator's open exposure, so its deal volume over time |
| `BondReleased` | `adjudicator` *(i)*, `token` *(i)*, `amount` | `release` (`:83`), from `_releaseBonds` (`HoldbackRules.sol:655-658`) on every close, escalation, upheld appeal and expiry | nothing (not synced) | Same |
| `AppealBondHeld` | `commitmentId` *(i)*, `appellant` *(i)*, `amount` | `takeAppealBond` (`:100`), from `fileAppeal` (`HoldbackRules.sol:516`) | nothing (not synced) | The appeal bond, again |
| `AppealBondPaid` | `commitmentId` *(i)*, `to` *(i)*, `toBond`, `amount` | `payAppealBond` (`:112` into the first decider's bond, `:114` back to the appellant), from `_appealDecision` (`HoldbackRules.sol:376`) and `expireAppeal` (`:590`). Not emitted when the bond is 0 (`:109`) | nothing (not synced) | Where the appeal bond went |
| `BondSlashed` | `commitmentId` *(i)*, `adjudicator` *(i)*, `to` *(i)*, `token`, `amount` | `slash` (`:91`), from `_appealDecision` on an overturn (`HoldbackRules.sol:378`) | `bond.slashed`, read from the `decide` receipt, not from the sync (`evm-settlement.ts:355`) | That an adjudicator was overturned, and whom its bond paid |

CPP's `AuthCaptureEscrow` emits its own events in the same transactions (`PaymentAuthorized`, `PaymentCaptured`, `PaymentVoided`, `PaymentReclaimed`, `PaymentRefunded`, `PaymentCharged`, `TokenStoreCreated`), keyed by the `PaymentInfo` hash, not the commitment ID [measured: `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol:78-105` in the main checkout's submodule]. CPP is out of scope; the adapter maps none of them.

## Gaps, as requirements for the settlement spec (T-245)

Each is a reader's gap, not a fault in the contracts [inferred unless marked]. A fix adds a field or a new event; it never removes or renames one.

| ID | Gap | Who is short | Requirement |
| --- | --- | --- | --- |
| E-1 | `BondEncumbered` and `BondReleased` carry no commitment ID, so a log reader cannot tie an encumbrance to a deal without the rules events of the same transaction | Bond backers, auditors | The spec names the deal for every bond movement |
| E-2 | The sync reads no vault event. Core defines `bond.deposited`, `bond.withdrawn` and `bond.paid` (`packages/core/src/types.ts:676-678`) [measured], but the chain adapter produces none of them, and `bond.slashed` only from a receipt the adapter itself holds. A direct `deposit` or a slash relayed by someone else reaches the record only through a view read | The signed record, the API's bond history | The spec says whether the record carries the vault's movements, and from which logs |
| E-3 | `Decided` omits the attempt, the delivery hash, the beacon round and the appeal ground hash. A reader takes them from calldata or `deliveryHashOf` | Auditors checking a decision against the delivery (ADR-0029) | The spec lists the decision fields the record must carry, and whether they come from the event or calldata |
| E-4 | No event carries the token, the price and fee split, or the fallback and appeal adjudicators. `JobFunded.amount` is price + fee; `JobCreated.evaluator` is the primary only | Indexers that read logs alone | The spec says which terms fields are read from calldata (the settlement view) and which must be in a log |
| E-5 | `Refunded.amount` means four things (the price, the fee, a share plus the fee, or price + fee), with no path field. After the buyer reclaimed on CPP, `_refundAll` returns before it emits `Refunded` (`HoldbackRules.sol:605-608`); the money moved in CPP's `PaymentReclaimed` | The record, accounting | The spec defines each refund's meaning by call, and how the record shows a CPP reclaim |
| E-6 | `JobExpired` marks both an expired offer and a reclaim. The adapter tells them apart by the stage and the `Refunded` before it | Readers other than the adapter | The spec defines the pair |
| E-7 | No event marks the appeal state `Closed` (escalation decision, early accept, mutual settlement, reclaim, default), nor the open appeal window after a first-instance decision | Readers computing finality (`finalAt`, D20) | The spec derives finality from the stage events and the terms, as the read model does |
| E-8 | A zero-bond appeal emits `AppealBondHeld(0)` and later no `AppealBondPaid` (`HoldbackBonds.sol:109`) | Readers pairing appeal-bond events | The spec says a zero bond has no payout event (L-3 may remove the case) |
| E-9 | An escalation emits only `Decided` with outcome 2, plus `BondReleased` from the vault. The `Escalated` stage and its start time are inferred from that | Readers deriving the appeal adjudicator's deadline | The spec maps outcome 2 to the escalation and its deadline to the block time |
| E-10 | Two ERC-8183-shaped names are not in the draft, and two draft events are never emitted (I-10) | ERC-8183 indexers | Settle the names against the final EIP text before an indexer relies on them |

## What the events reveal together

The events publish the deal's skeleton: the parties' addresses, the primary, the held total, the outcome, each payout and fee, the appeal and its result, and the adjudicators' bond sizes and exposure. That is the public skeleton of residual 9, and anyone needs it to trigger timeouts and check coverage [documented: `docs/neutrality.md`]. The deliverable, the terms' body and the judgment travel as hashes or ciphertext. `KeyReleased` puts the buyer's sealed key on chain; its safety rests on the buyer's key and the sealing scheme [inferred]. At the `private` and `judgment` levels the parties sign with per-deal keys, so the indexed addresses are per-deal, and funding can still link them (residual 11) [documented: ADR-0024; `docs/neutrality.md`].
