# Backlog

Deferred until after the basic demo. The demo assumes honest parties (Rafa, October 30, 2026). Each item names its source and when it starts to matter. Agents add items here instead of building them early (`docs/team.md`).

## Settlement layer

| Item | Source | When it matters |
| --- | --- | --- |
| Club-chosen permissioned settlement chain (for example Matter Labs Prividium), with a signed residual "the club's chain operator can halt settlement" | ADR-0004 evaluation, 2026-10-31 | A regulated club asks to run its own chain (Phase 5 or later); needs its own ADR |
| Model `authorizationExpiry` in SimChain and differential-test it against the Phase 2 contract (`authorizationExpiry` ≥ `appealDecideBy` + forced-inclusion margin) | T-006 | T-202, when the contract exists to compare against |
| Agent registration, `AgentRevocation` and signed `MemberAdmission` at run time; SimChain reads mandates and members from genesis only | T-006 | T-007, when operators register agents live; with D22 revocation |
| Persistence: SimChain is in memory; the journal replays it, but nothing writes it to disk | T-006 | T-007, when an operator restarts |
| Release a reservation when `appealBy` passes with no appeal, without waiting for the appeal-expiry trigger (the coverage gate counts it as encumbered until someone triggers) | T-006 | When adjudicators run many concurrent commitments |
| `Dispute` must carry envelopes for all three adjudicators: no Phase 1 state accepts a `Dispute`, so SimChain has no guard yet | T-006; ADR-0020 | Phase 4, optimistic mode |
| `termsHash` and `recordHash` on every event: the schema requires them on offered, agreed and decided events and forbids extra fields on settled and bond payloads | T-006; ADR-0020 | Next schema bump |
| Idempotency records keep successful results only; a refused call with the same key can be retried | T-006 | T-007, if clients expect refusals replayed |

## Settlement and fees

| Item | Source | When it matters |
| --- | --- | --- |
| Fees follow the event: an overturn refunds the first-instance fee to the buyer and the appeal fee to a winning appellant, from the overturned adjudicator's pool, junior first; the coverage gate reserves `price + fee + appealFee` | D21; escrow-theory review F3 | Before T-202 puts bond logic in Solidity; before Phase 4 backers and `settle_after_window` |
| Kill fee for a sitting adjudicator on mutual settlement (`adjudicatorFeeShareAfterDeliveryBps` above 0) | ADR-0019; D21 | When adjudicators report lost panel cost on settlements |
| Fee refund on a wrongful-reject overturn where the appeal decision also releases the key | D21 | Phase 4, with finality work |
| Default compensation shortfall: bonds reserved only on takeover may not cover compensation; fixture `todo.default-bond-shortfall` | Escrow-theory review F5 | Phase 3 hardening |
| Default compensation split between primary and fallback as a rulebook term (SimChain splits it evenly: the fallback pays half rounded down, the primary the rest) | T-006 | When a club wants another split |
| Segregation statements: per-pool and per-commitment statements and invariants (segregation is by accounting, not by account) | Review F6 | Phase 4 backers; any audit |
| Surety claim list and penal sum stated explicitly | Review F9 | Phase 4 backers |
| Recipient validation for third-party payouts: the address can receive the token, checked by a dry transfer | D23 | Phase 2 contract tasks |
| Key hand-off when the parties exit to another mechanism: re-wrap the content key to a named arbiter, or a time-locked envelope | D23 | When a pilot exits to another arbiter; Phase 2 privacy work |
| Demo beat "the agents leave together": both sign the hold over to an outside arbiter | D23 | After T-013's success criteria pass |

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
| Wall-clock check budgets (red-team K1, K2) run only in an opt-in perf pass (`HOLDBACK_PERF=1`), run alone, not in parallel lanes. K2 measured 22 s projected at 10 MB alone and failed the 60 s budget only under load. A worker with a deadline would make the budget deterministic | T-012 verify, 2026-10-31 | Before judging untrusted multi-MB deliverables outside the demo |
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
| Run-time `POST /v1/clubs`, `/members`, `/agents`, `/adjudicators` and revocations; the operator serves genesis reads only | T-007 | With the T-006 registration item; D22 revocation |
| `GET /v1/commitments/{id}/key` takes `?recipient=` with no buyer-signed request; envelopes are encrypted to the recipient and already public in `key.released` events | T-007 | Phase 2 read authentication |
| `GET /v1/commitments/{id}/judgment`, `POST /v1/adjudicators/{address}/quote`, `POST /v1/webhooks`, `GET /v1/audit/verify`, `/publish`, `/disputes`: not served (404) | T-007 | T-009 (judgment record), Phase 2 (quotes, webhooks), Phase 4 (disputes) |
| Chain-mode `202 pending` with `submissionId`; the operator answers synchronously as on SimChain | T-007 | Phase 2 (T-202) |
| Operator state is in memory: idempotency records, receipts, rate-limit windows and the event index are lost on restart (SimChain replay rebuilds the index, not the records) | T-007 | When an operator restarts mid-demo; Phase 5 operators |
| Operator stores successful responses only; a refused call can be retried under its key, matching SimChain | T-007 | If clients expect refusals replayed |
| Rate limiting is a fixed window per signer address as named in the body; it does not verify the signature first, so a caller can spend another signer's budget | T-007 | Before any public operator (Phase 5) |
| `/v1/events` SSE polls the settlement log every 50 ms and ignores `Last-Event-ID`; no backpressure | T-007 | Phase 2, chain event subscription |
| An operator binary (CLI entry that reads `HOLDBACK_*` env and genesis); today operators start in process through `startOperator` | T-007 | T-013 if the demo runs operators as processes |
| `neutrality.operator-*` and `error.dry-run-has-no-effects` as `.scenario.yaml` fixtures; today they are vitest cases in `apps/operator/src/neutrality.test.ts` and `operator.test.ts` | T-007 | When testkit drives HTTP operators |
| SDK signer integration (`hb.offer(terms)` signs) as in the docs/api.md example; today the SDK takes signed messages | T-007 | T-012 agents, if they want it |
| SDK `verifyReceipts` mode: check each receipt's signature against `status().receiptSigner`, and its `eventHash` and `eventSeq` against the settlement layer's events; today the SDK returns receipts unverified | T-007 review | When agents rely on receipts as evidence (T-015; Phase 5 operators) |
| Idempotency keys share one global namespace across operators and the direct path; scope them by signer, or derive settlement keys from the key plus the submission hash, so one agent's key cannot collide with another's | T-007 review | Before any shared operator (Phase 5) |
| A response lost after relay, then retried under a new key: the SDK should read the commitment back and reconcile instead of resubmitting into a refusal | T-007 review | When agents generate keys per attempt |
| Rate limits trust the signer address named in the body; a caller dodges them by rotating addresses, or spends another signer's budget. Verify the signature before charging a budget | T-007 review | Before any public operator (Phase 5) |
| A non-JSON 200 response crashes `submit` (body read as state); treat it as an operator failure and fail over | T-007 review | Before untrusted third-party operators |
| `GET .../receipts` re-signs receipts per read, and the receipt cache is unbounded | T-007 review | With operator persistence |
| The `dropResponses` test hook is part of production `OperatorOptions`; move it behind a test-only wrapper | T-007 review | Before an operator binary ships |
| `/v1/events` streams every event unfiltered; revisit when private disclosure levels exist | T-007 review; ADR-0020 | Phase 2 privacy |

## Principal recourse

| Item | Source | When it matters |
| --- | --- | --- |
| Principal standing: the mandate signer may sign `Appeal`, `Dispute`, `MutualSettlement`, `EarlyAccept` for its agent | D22 (option A); review F8 | Before the Phase 2 rules contract fixes signers |
| Scope gate for third-party payouts: each mandate carries `payouts: parties \| any`, or the principal co-signs a settlement that pays a non-party | D23 | Before the Phase 2 rules contract fixes signers; with `attack.hijacked-agent-*` in Phase 3 |
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

## Demo data and agents

| Item | Source | When it matters |
| --- | --- | --- |
| Injection deliverables: `injection-plain` and `injection-base64` (beat 6, first delivery) | T-012 | With T-009's panel and the beat 6 fixture |
| `panel-borderline` deliverable that passes every check but splits the panel | T-012 | With T-009 recordings |
| Change-log notes file delivered with the clean CSV (graded by the `notes` rubric criterion) | T-012 | When live or recorded judges grade the rubric (T-009) |
| Club rulebook, $2,000 terms and Bench A/B/C registration files (drafted in the T-012 Handoff) | T-012 | When T-006 loads club and terms files |
| `_example` delivers the generated clean file instead of stub bytes, with recordings re-captured | T-012 | After the files above land (T-010 lane) |
| Scripted buyer and seller agents in `apps/demo/agents/` | T-012 | After T-007 (SDK) and T-009 |
| Data for optional beats 9 (work for work) and 10 (a gap both agents settle 70/30) | T-012 | When those beats are built |
| Root `.gitignore` rule `data/` also matches `fixtures/data/`; anchor it as `/data/` | T-012 | Next scaffold change |

## Housekeeping

| Item | Source | When it matters |
| --- | --- | --- |
| `state.ts` comment pointing to `mulBps` for the appeal bond | Schema v0.5 second review | Next core change |
| README notes for additions beyond ADR text (`providerPrivacy: standard`, narrowed `termsHash`/`recordHash` events) | Schema v0.5 second review | Next spec change |
| Normalize an absent `unlock` to `none`; dispute windows under the uint32 check | Schema v0.5 second review | Before optimistic mode is admitted |
