# Backlog

Deferred until after the basic demo. The demo assumes honest parties (Rafa, October 30, 2026). Each item names its source and when it starts to matter. Agents add items here instead of building them early (`docs/team.md`).

## Settlement layer

| Item | Source | When it matters |
| --- | --- | --- |
| Club-chosen permissioned settlement chain (for example Matter Labs Prividium), with a signed residual "the club's chain operator can halt settlement" | ADR-0004 evaluation, 2026-10-31 | A regulated club asks to run its own chain (Phase 5 or later); needs its own ADR |

## Settlement and fees

| Item | Source | When it matters |
| --- | --- | --- |
| Fees follow the event: an overturn refunds the first-instance fee to the buyer and the appeal fee to a winning appellant, from the overturned adjudicator's pool, junior first; the coverage gate reserves `price + fee + appealFee` | D21; escrow-theory review F3 | Before T-202 puts bond logic in Solidity; before Phase 4 backers and `settle_after_window` |
| Kill fee for a sitting adjudicator on mutual settlement (`adjudicatorFeeShareAfterDeliveryBps` above 0) | ADR-0019; D21 | When adjudicators report lost panel cost on settlements |
| Fee refund on a wrongful-reject overturn where the appeal decision also releases the key | D21 | Phase 4, with finality work |
| Default compensation shortfall: bonds reserved only on takeover may not cover compensation; fixture `todo.default-bond-shortfall` | Escrow-theory review F5 | Phase 3 hardening |
| Segregation statements: per-pool and per-commitment statements and invariants (segregation is by accounting, not by account) | Review F6 | Phase 4 backers; any audit |
| Surety claim list and penal sum stated explicitly | Review F9 | Phase 4 backers |

## Finality

| Item | Source | When it matters |
| --- | --- | --- |
| `contestableUntil` as a named field, a `commitment.final` event, `finalAt` in receipts | D20 | When third parties consume receipts or subscribe (T-015; Phase 5 operators) |
| Chain finality stages (`unsafe`, `safe`, `finalized`), reorg handling, appeal windows sized for chain finality | D20 | Phase 2 (T-202, T-205) |
| Formal property: every funded commitment reaches `finalAt` when any single actor halts | D20 | T-204 |
| Legal and economic finality statement (no chargeback after `finalAt`) | D20; D22 | With principal standing |

## Modes and calls

| Item | Source | When it matters |
| --- | --- | --- |
| Optional consent window for judged modes (`consentWindowSec`, default 0; either party may call early or settle) | D19 | After Phase 1, if the AI-lab audience finds automatic judgment opaque |
| Seller first-instance call in optimistic mode, only after `deliveredAt + minInspectionWindowSec` | D19 | If pilots show buyers threatening informal rejection |
| `settle_after_window` and `optimistic` modes built | ADR-0012; ADR-0015 | Phase 4 |
| Adjudicator challenge after agreement; a facilitated-settlement stage | Review F10 | After Phase 1 |
| Waiver of discrepancies window (UCP Art. 16(b) analog) | Review F11 | After Phase 1 |

## Judgment defenses

| Item | Source | When it matters |
| --- | --- | --- |
| Worker with a deadline for deterministic checks (the step budget bounds work today) | T-008 red team item 10 | T-009 or Phase 3 |
| Full UTS #39 confusables (today a Cyrillic and Greek subset) | T-008 red team item 6 | Phase 3 |
| Calibrate screen phrase families and false-positive rates | T-008 Handoff | Phase 3 |
| Dedicated screen signal kinds (new signals reuse `encoded_run` and `instruction_phrase`) | T-008 Handoff | Next schema bump |
| Per-check null-token list (built in today) | T-008 red team item 3 | When a club needs custom null tokens |
| `inputHash` recomputable by the buyer (needs the per-judge nonces) | T-008 Handoff | T-009 |
| Escalate on high-risk screen signals as a `screenPolicy` option | ADR-0021 | Phase 3, with a classifier |
| Confidential-compute checks for checks-only commitments; state the independence choice (judging the goods, not documents) in the PRD | Review F2 | PRD edit now or soon; compute in Phase 3+ |
| Response attestation for judges (residual 8) | ADR-0006 | When providers sign responses |

## Privacy

| Item | Source | When it matters |
| --- | --- | --- |
| Read authentication (`ReadToken`), private judgment records, time-locked key release, pseudonymous identity mode | ADR-0020 | Phase 2 |
| Amount privacy: confidential tokens as a rulebook token option; a privacy chain weighed under D4 | D16; ADR-0020 | Phase 2 chain choice |
| Retention and erasure rule (BSA five years vs GDPR Art. 17), a named reporting entity, an open-rulebook compliance posture | Review F4 | Before any real user data; Phase 5 |
| Local-store URI scheme; ciphertext and envelope byte layouts in `docs/api.md`; binding an envelope's address label to the published encryption key; AAD binding ciphertext to a commitment | T-014 Handoff | T-007 (layouts) and Phase 2 |
| Commitment metadata privacy for unauthenticated reads (residual 9) | D13; ADR-0017 | With read authentication |

## API

| Item | Source | When it matters |
| --- | --- | --- |
| IETF `RateLimit` headers; `Deprecation` and `Sunset` headers | ADR-0017 | When the draft stabilizes; at API v1.0 |
| SDK operator ranking by `/v1/status` | ADR-0017 | Phase 5, several operators |
| Standard Webhooks signing headers | ADR-0017 | When webhooks are built |
| x402 and AP2 interop; field selection | ADR-0017 | Phase 6 |
| More list filters (`club`, `appealState`, dates) | ADR-0017 | When the viewer or MCP needs them |

## Principal recourse

| Item | Source | When it matters |
| --- | --- | --- |
| Principal standing: the mandate signer may sign `Appeal`, `Dispute`, `MutualSettlement`, `EarlyAccept` for its agent | D22 (option A); review F8 | Before the Phase 2 rules contract fixes signers |
| Revocation also disables a revoked agent's consent messages on live commitments | D22 | When key compromise is live (Phase 5 testnet) |
| Scope hardening: enforce `scope.categories`; allowed counterparties or clubs; per-counterparty caps | D22 | Cheap, any phase; when a pilot asks |
| Fixture `attack.hijacked-agent-early-accepts` showing loss capped by scope | D22 | Phase 3 |
| Club guarantee fund with its own claim window | D22 (option C) | Consumer-facing clubs, Phase 5+ |
| Agent-operator bonds and signed intent mandates | D22 (option D) | Phase 6 interop |
| Card-funded holds keep Reg Z and network dispute rights against the ramp | D22 | Phase 5 ramps |

## Compliance and operations

| Item | Source | When it matters |
| --- | --- | --- |
| Signed periodic replay attestation; ramp reconciliation | Review F7 | Phase 5 |
| Recovery objective and operational-risk plan (PFMI P17) | Review F12 | Before testnet |
| Audit sampling as an opt-in rulebook feature; checkability pricing | ADR-0014 | Phase 3 (T-306) |
| Backer deposit, withdrawal-notice and withdraw messages | ADR-0014 | Phase 4 |

## Housekeeping

| Item | Source | When it matters |
| --- | --- | --- |
| `state.ts` comment pointing to `mulBps` for the appeal bond | Schema v0.5 second review | Next core change |
| README notes for additions beyond ADR text (`providerPrivacy: standard`, narrowed `termsHash`/`recordHash` events) | Schema v0.5 second review | Next spec change |
| Normalize an absent `unlock` to `none`; dispute windows under the uint32 check | Schema v0.5 second review | Before optimistic mode is admitted |
