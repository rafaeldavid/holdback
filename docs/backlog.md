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
| Atomic close-and-reopen: one submission that settles the old commitment and funds the new hold (Phase 2: `void` plus `authorize` in one rules-contract call), so funds never leave escrow between the two | D24 | If pilots show the gap between `Settled` and the new `Held` exploited |
| Optional signed `supersedes` term linking a reopened commitment to the one it replaces, with `supersededBy` in the read model (schema bump) | D24 | When auditors or the demo transcript need the link |
| Settlement refunds do not credit the buyer's daily cap (`spentToday`), so a reopen near the cap fails `scope_exceeded` | D24 | When mandates with tight daily caps reopen commitments |
| An adjudicator accepting the reopened commitment before the old one settles needs free bond for both prices; the SDK should order the steps | D24 | SDK helper for amendments |
| Seller-signed `OfferWithdrawal`, so an unwanted offer stops encumbering the adjudicator's reservation before `offerExpiresAt` | D24 | When offers carry long expiry windows |

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
| Negotiable dispute clauses (D29), signed in the terms like settlement mode and disclosure: on a screen flag or injection suspicion at the appeal (unanimous accept / supermajority / always refund); on an unreadable or sampled delivery (refund / judge the sample / default outcome); on an inconclusive panel (first decision stands / refund / bond pays); who bears fees and the appeal fee; burden on a party appeal. Today's D27 rules become the default clause set, named and versioned with the aggregation (`agg-3`). Mandatory rules stay out of reach: hard rules, litmus tests, untrusted deliverables, pinned models. Clubs narrow the menu in the rulebook; adjudicators publish which clauses they run and price their bond exposure per clause; the T-017 negotiation step carries the clause choice. Schema change, ADR and version bump | Rafa, 2026-10-31 ("both parties agree, like how law works") | After the demo; before the first pilot |
| Seller first-instance call in optimistic mode, only after `deliveredAt + minInspectionWindowSec` | D19 | If pilots show buyers threatening informal rejection |
| `settle_after_window` and `optimistic` modes built | ADR-0012; ADR-0015 | Phase 4 |
| Adjudicator challenge after agreement; a facilitated-settlement stage | Review F10 | After Phase 1 |
| Waiver of discrepancies window (UCP Art. 16(b) analog) | Review F11 | After Phase 1 |

## Judgment defenses

| Item | Source | When it matters |
| --- | --- | --- |
| Live judges overshoot the verdict schema's length limits by a few characters: Haiku 5.5's evidence ran to 301 and 309 of 300 (T-028, measured), so the filter abstained it and it was left out of the live registry. Options, a defense decision: Anthropic structured outputs (they do not enforce `maxLength`, so the filter still decides), a prompt line that states the limits in characters, or a policy to truncate evidence (never rationale) at the limit | T-028 | Before a cheap model is promoted to a live registry |
| Live registry calibration: `config/judges-live.yaml` was promoted without the calibration run the promotion rule requires; DeepSeek's names are aliases (its pricing page maps `deepseek-flash` to DeepSeek-V4.1-Flash-1017 and `deepseek-v4-pro` to DeepSeek-V4-Pro-0813 on 2026-11-01), so drift is invisible except by re-calibration. Record the served version per call where the provider reports it | T-028 | Before any non-demo use of live judges |
| Judgment records and transcripts do not say why a seat abstained (filter reason, timeout, provider error, empty text): `pnpm demo --live` showed abstentions on the 60k-token CSV whose cause was found only by a debug capture. Add the abstain reason to the panel member | T-028 | Before live panels are debugged by anyone without a capture script |
| Tell appeal judges the screen flagged the delivery: a new appeal template (a new `appealPromptTemplateHash`, so a policy and version change) that names the flag and its signals as data, without quoting the payload as instructions | D27g, red-team review of PR 52 | Before live appeal judges see flagged cases |
| Revisit the default outcome after an unflagged, inconclusive appeal: today the appeal bond pays the seller's compensation although no adjudicator failed to act (the panel sat and split, for example 3-2) | D27g, red-team review of PR 52 | Before Phase 4 bonding economics; needs its own decision |
| Separate adjudicator-absence compensation (an adjudicator that never decided) from a panel that ruled but could not decide; today both reach the same default outcome and the appeal bond pays | D27g, red-team re-check of PR 52 | With the default-outcome decision above |
| A sampler that handles long records (or a declared `max_record_chars` deterministic check in the terms), so an honest CSV with one very long record is not read by stride and, after an escalation, refunded under D27b | D27g, red-team re-check of PR 52 (path 5) | Before real long-text datasets |
| On unflagged appeals, a provider's `not_json` (a filter abstention, which escalates) and a timeout (an invalid seat, which only lowers the valid count) are treated differently; decide whether a provider fault should count the same way | D27g, red-team re-check of PR 52 | Before live judges at the appeal |
| Wall-clock check budgets (red-team K1, K2) run only in an opt-in perf pass (`HOLDBACK_PERF=1`), run alone, not in parallel lanes. K2 measured 22 s projected at 10 MB alone and failed the 60 s budget only under load. A worker with a deadline would make the budget deterministic | T-012 verify, 2026-10-31 | Before judging untrusted multi-MB deliverables outside the demo |
| Worker with a deadline for deterministic checks (the step budget bounds work today) | T-008 red team item 10 | T-009 or Phase 3 |
| Full UTS #39 confusables (today a Cyrillic and Greek subset) | T-008 red team item 6 | Phase 3 |
| Calibrate screen phrase families and false-positive rates | T-008 Handoff | Phase 3 |
| Dedicated screen signal kinds (new signals reuse `encoded_run` and `instruction_phrase`) | T-008 Handoff | Next schema bump |
| Per-check null-token list (built in today) | T-008 red team item 3 | When a club needs custom null tokens |
| Escalate on high-risk screen signals as a `screenPolicy` option | ADR-0021 | Phase 3, with a classifier |
| Confidential-compute checks for checks-only commitments; state the independence choice (judging the goods, not documents) in the PRD | Review F2 | PRD edit now or soon; compute in Phase 3+ |
| Response attestation for judges (residual 8) | ADR-0006 | When providers sign responses |
| Sampling for JSON, text and markdown deliverables (today they escalate over 100,000 characters); a reader stage for typed features | T-009 | When a demo or pilot delivers large non-CSV work |
| Residual of sampling: bad rows in a small fraction of a large file can miss every judge's sample; size the sample from a target detection rate and state it in the policy | T-009 | Phase 3, with calibration |
| Appeal supermajorities (`appealAcceptSupermajority`, 4/5 in the docs table) need policy schema fields; today appeals use the first-instance fractions | T-009 | Next schema bump |
| "No decision" message for an inconclusive appeal panel after an escalation (today the appeal adjudicator stays silent and the default applies, exposing its bond) | T-009 | Phase 3, with default compensation (F5) |
| Fetch another adjudicator's registry by URI (today a fallback or appeal adjudicator must hold the bound registry itself) | T-009 | When benches publish different registries |
| Record key (ADR-0020) unwrapping on takeover, alongside the content key | T-009 | Phase 2, with private records |
| Reference inputs for `reference_row_match_min` fetched by the adjudicator (`deliverable.inputs`) | T-009 | When a commitment uses that check |
| Adjudicator affiliation check at acceptance (`error.adjudicator-affiliated`) | T-009 | Before open clubs |
| Persist computed decisions across restarts (today the no-re-roll memo is in memory; seeds are derived, so a restart re-judges with the same panel but can get different live verdicts) | T-009 review | Before live judges in a long-running service |
| Primary seed ignores the attempt number: `seedFor(commitmentId)` is the same for every attempt, so a re-delivery judged by the primary draws the same seats and samples; fold `attempt` into the primary seed (and its acceptance commitment) | T-009 review | Before re-delivery (attempt > 0) reaches the primary |
| A colluding primary knows its seed from acceptance, before delivery, so it can tell the seller which judges and sample rows to expect; commit-reveal stops grinding, not leakage. Options: a beacon contribution mixed into the primary seed, or a seed committed only after delivery | T-009 review | Before open clubs (honest primary assumed for the demo) |
| One OpenAI-compatible base URL per service (`HOLDBACK_OPENAI_COMPATIBLE_BASE_URL`): a registry naming two OpenAI-compatible hosts cannot be served; key the base URL and API key by registry entry or provider host | T-009 review | When the registry seats two OpenAI-compatible providers |
| Live providers do not abort the fetch on timeout (`withTimeout` races it, the request keeps running) and read the whole response body with no size cap; pass an `AbortSignal` and cap the body before parsing | T-009 review | Before live judges in a long-running service |
| `unencumberedBond` in `OfferTask` is unused: the service accepts without checking it can cover `bondReserved`; refuse offers the bond cannot cover (core still enforces it at acceptance) | T-009 review | With T-006's adapter, before open bonding |
| Check details quote deliverable content into the published judgment record: `csv_columns_exact` writes the seller's CSV header names into `deterministic[].detail`, so a hostile header (Markdown image, HTML, terminal escape, newline) travels in a signed, public record to every reader. Report column counts or a hash, or name only expected columns, and cap and sanitize any quoted value. Consumers already escape it (T-013, `docs/team.md` "Deliverables untrusted, output surfaces") | PR 46 review (T-013) | Before records are published to third-party viewers |
| Appeal family minimum lowered to what the registry has: `max(minFamilies, min(minFamiliesAppeal, families in registry))`, so a two-family registry gives a two-family appeal panel; refuse (or require the registry to meet `minFamiliesAppeal`) instead | T-009 review | Before benches publish registries with fewer than three families |

## Privacy

| Item | Source | When it matters |
| --- | --- | --- |
| Read authentication (`ReadToken`), private judgment records, time-locked key release, pseudonymous identity mode | ADR-0020 | Phase 2 |
| Amount privacy: confidential tokens as a rulebook token option; a privacy chain weighed under D4 | D16; ADR-0020 | Phase 2 chain choice |
| Retention and erasure rule (BSA five years vs GDPR Art. 17), a named reporting entity, an open-rulebook compliance posture | Review F4 | Before any real user data; Phase 5 |
| Local-store URI scheme; ciphertext and envelope byte layouts in `docs/api.md`; binding an envelope's address label to the published encryption key; AAD binding ciphertext to a commitment | T-014 Handoff | T-007 (layouts) and Phase 2 |
| Commitment metadata privacy for unauthenticated reads (residual 9) | D13; ADR-0017 | With read authentication |
| Evaluate Prividium: a private, Ethereum-anchored chain where ’crow's operators run as a consortium that cannot see the transactions on their own chain. Check what operators can see, neutrality with a permissioned operator set (admission, forced inclusion, exit to Ethereum), USDC and finality. Variant to test (Rafa, 2026-11-01): **every escrow is its own single-use Prividium**, whose only participants are the two parties and their named adjudicators; it holds the deal privately, settles the outcome to Ethereum and is retired. Questions: spin-up time and cost per chain against deal size; moving USDC in and out (two L1 transactions per deal?); who sequences it (a party, the adjudicator, or a neutral prover) and whether either party can force exit to L1 if the sequencer stalls; data availability and what the record shows afterwards (D26 evidence) | Rafa, 2026-11-01; D4 update | With T-207 private deals |

## API

| Item | Source | When it matters |
| --- | --- | --- |
| Advisory sanity warnings (D31): an operator may flag values that look wrong, such as a deadline in the year 20270, a price far above the agent's history, or an appeal window shorter than the adjudicator's typical decision time, as warnings in the prepare response. Warnings never refuse, and the agent decides | Rafa, 2026-10-31 | After the demo; an operator service |
| Audit existing protocol and schema limits against D31: list every hard-coded bound (Phase 1 scope limits such as `maxSubmissions = 1` and `public` disclosure only, schema minimums and maximums, operator caps) and mark each as encoding-necessary, a temporary Phase 1 scope, or a candidate parameter | D31 | After the demo |
| A pre-payment read of the buyer's own envelope (or a delivery read that includes `encryptedKeys`), so an early-accepting buyer need not ask the seller for the signed delivery; weigh that it shows the buyer the work before payment, which today is the seller's choice. Also have `examples/seal.ts` print the signed delivery for handing to the buyer | T-024 | When agents use early accept outside the examples' Agent |
| Cap the size of a ciphertext fetched from a seller-chosen `ciphertext.uri` (and its fetch time) in `Agent.envelopeMaterial` and `Agent.openDelivery`; check `ciphertext.bytes` before reading | PR 59 review (T-024) | Before agents fetch from sellers they do not know |
| Per-call micropayments for operator API access (HTTP 402 schemes such as x402): pricing per call, free reads vs paid writes, how a paid call interacts with idempotency replays, and an operator refusing unpaid calls without breaking the escape hatch (direct submission stays free of operator fees) | D30 | After the demo; with the operator business model |
| The domain is the address (D30): an operator, adjudicator or club is reached at its own domain. `https://<domain>/.well-known/holdback.json` publishes the API base, EIP-712 domain, receipt-signing key, settlement target, prices and supported clauses (today's `/v1/status`); the same URLs serve HTML to a browser and JSON to an agent by content negotiation; an adjudicator or club proves its domain by signing its well-known file with its registered key. The domain is a discovery handle only: identity and money stay with keys, and losing a domain never stops settlement (direct submission) | Rafa, 2026-10-31 | `.well-known` alias with T-020 if cheap; the rest after the demo |
| IETF `RateLimit` headers; `Deprecation` and `Sunset` headers | ADR-0017 | When the draft stabilizes; at API v1.0 |
| Overturned wrongful reject: the buyer keeps its refund and also gets the work, while the seller is paid from the primary's bond. Document it; decide whether the key should be released to the buyer in that case | Outsider usability review | Before a pilot; with D29 clauses |
| Deterministic checks for text deliverables (length ratio to a committed source, clause or segment count, required glossary terms, language detection) | Outsider usability review | After the demo; before a translation or document pilot |
| Dataset check types a minimal seller cannot pass by repetition: numeric value range per column, minimum distinct values (or maximum share of the most common value) per column. Today a range is a regex and "varied" needs a rubric (docs/api.md, "Writing checks that resist a seller doing the minimum"). A schema change | Sim batch 1, F4 (T-025) | Before a dataset pilot with checks-only terms |
| Lapsed offers: the reference adjudicator service (or any operator, as a service) calls `expire-offer` once `offerExpiresAt` passes, so the primary's reserved bond is freed without a party remembering to | Sim batch 1, F5 (T-025) | When adjudicators run many concurrent offers |
| A party-scoped way to follow a deal: `/v1/events?commitmentId=` or `?party=`, or webhooks to the parties, so a buyer learns of delivery and a seller of funding without polling | Sim batch 1, F5 (T-025) | With webhooks (Phase 2), or earlier if agents keep polling |
| Distinct `beacon_pending` problem with `Retry-After` instead of `seed_mismatch … waiting`; appeal refusals for lack of funds state the bond and fee required | Outsider usability review | With T-020 if cheap, else after the demo |
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
| Party journal: the SDK keeps a local, append-only copy of every signed message, receipt, judgment record and posting for its own commitments, so an agent remembers the exchange even if every operator disappears | D26 | After the demo; feeds the evidence bundle |
| Fixture `neutrality.both-parties-same-record`: buyer's and seller's exported records are identical (apart from their own key material) | D26 | With the evidence bundle |
| Evidence bundle: a party exports one commitment's signed terms, messages, receipts, judgment record and audit-chain proof, verifiable offline, with the content key disclosed only if the party chooses | D26 | After the demo; before the first pilot with real principals |
| Rulebook names governing law and a dispute forum (court or arbitral seat) so a court knows which agreement governs; the protocol does not enforce it | D26; PRD Assumption 1 | Schema change before the first pilot |
| Attribution: each agent key traceable to its principal through the mandate and club membership, disclosable under legal process without making it public | D26; ADR-0020 | With the privacy work in Phase 5 |
| Domain as persistent identity: a principal or agent proves a domain it owns (a signed `/.well-known/holdback.json` listing its current keys and ERC-5564 meta-address, or a DNS TXT record), as Bluesky handles, Nostr NIP-05 and `did:web` do. Gives reputation that persists across commitments, key rotation (the domain lists current keys; old keys stay verifiable), a recognisable counterparty, and a route to the legal entity behind it (D26). A domain proves control, not legal identity: WHOIS/RDAP registrant data is mostly redacted or proxied and only lightly validated, though registrars disclose it under legal process. Legal identity comes from an attestation bound to the domain: club or operator KYC (strongest for us), a verifiable LEI (GLEIF vLEI), or an organisation-validated TLS certificate. Shape (Rafa, 2026-10-31): a long-term on-chain address is the identity root and the domain is a handle, bound both ways (the domain's well-known file lists the address; the address signs a claim to the domain), as ATProto pairs a persistent DID with a domain handle. Reputation follows the address, not the domain, so buying a domain does not buy a track record. A domain sale breaks the binding automatically (the new owner cannot sign as the old address, and the old address no longer appears on the domain); the old owner should still revoke its claim, and each commitment records which binding held when it was signed. Edge cases (caching, lag, disputed transfers) later. Privacy (ADR-0020): at the `private` level the domain-to-key link is revealed only to the counterparty and an involved adjudicator, so one-time keys stay unlinkable in public. Neutrality: the domain identifies, keys hold money; losing a domain never stops settlement. Other identity schemes (ENS, `did:key`) stay a choice | Rafa, 2026-10-31 | After the demo; with the evidence bundle and the D29 clause work |

## Risk and incentives (after the escrow works end to end)

Rafa, 2026-10-31: get the escrow working first, then sort out risk and incentive management. One candidate ADR covers the rows below, preceded by a Fable max-effort research pass.

**Research brief (queued, not started).** Compare clearing members at central counterparties (margin, default fund, client clearing), payment facilitators and merchant reserves (Stripe, acquirers), surety and performance bonds, security deposits, and optimistic-oracle and fraud-proof bonds (UMA, Reality.eth, rollup challenge bonds). Answer: what triggers a slash and who proves it; how big a bond must be to deter an attack worth the price P; the capital cost to honest agents and how backing or pooling lowers it; where slashed funds go; how an underwriting operator earns without gaining control; and what each choice does to the three litmus tests and D26.

| Item | Source | When it matters |
| --- | --- | --- |
| Party bonds: an optional per-agent (or per-mandate) bond covering all its commitments, sized by the rulebook or terms, so a seller has something to lose as the buyer already does (the hold). Today an injecting seller's worst case is a refund | Rafa, 2026-10-31; PR 52 red-team | Phase 4, with adjudicator economics |
| Slash triggers, strongest first: cryptographic equivocation (two contradictory signed messages); an injection the appeal panel confirmed (D27); never "intent" alone, which stays with courts (D26). Slashing stays inside signed terms and is appealable | Same | Same |
| Slashed funds go to the victim first, then refill adjudicator bonds, then a club fund or burn; never to the adjudicator that found the fault | Same | Same |
| Operators as underwriters (the clearing-member model): an operator vets agent owners, posts or backs their party bonds on chain, takes first loss and recovers from its client by contract; it may carry insurance. The backing lives on the settlement layer, so it holds whichever operator relays or if the agent submits directly; an operator can stop backing new commitments, never live ones; the counterparty sees who backs the bond | Rafa, 2026-10-31 | Phase 4–5; the operator business model |
| Clubs and third parties may back party bonds, as backers do for adjudicators (ADR-0014) | Same | Phase 4 |
| Operator injection protection as a bundled service, at the points the adjudicator does not cover: (1) screening counterparty offers, terms text and agent-to-agent messages before the agent reads them; (2) scanning a released deliverable before the buyer's agent consumes it, client-side in the SDK, or by the operator only if the buyer chooses to share the key (operators never see plaintext by default); (3) an adjudicator may name a third-party detector as a pinned, versioned check in its policy. An operator's classifier may refuse to relay but never alters a message; the escape hatch stands. Vendors to compare in the research pass: Lakera, Protect AI / LLM Guard, HiddenLayer, Prompt Security, Cisco AI Defense, Meta Prompt Guard, NVIDIA NeMo Guardrails, and the cloud guardrail services (Azure Prompt Shields, Google Model Armor, AWS Bedrock Guardrails); list from memory, unverified | Rafa, 2026-10-31 | With the operator business model; client-side scanning any time after the demo |
| Liability limits stated plainly: an operator can cap and absorb money losses in the protocol (bond, indemnity, insurance); it cannot shield an owner from legal liability to third parties | D26 | With the operator terms of service |

## Compliance and operations

| Item | Source | When it matters |
| --- | --- | --- |
| Signed periodic replay attestation; ramp reconciliation | Review F7 | Phase 5 |
| Recovery objective and operational-risk plan (PFMI P17) | Review F12 | Before testnet |
| Audit sampling as an opt-in rulebook feature; checkability pricing | ADR-0014 | Phase 3 (T-306) |
| Backer deposit, withdrawal-notice and withdraw messages | ADR-0014 | Phase 4 |
| Reliable production maintenance and self-healing for the hosted demo: monitoring, alerts, restarts, scheduled checks (the nightly CI run was turned off on 2026-11-01) | Rafa, 2026-11-01 | After the public demo is live |

## Public demo (T-026)

The hosted demo is the happy path only (Rafa, 2026-11-01); these edge cases are deferred.

| Item | Source | When it matters |
| --- | --- | --- |
| `POST /v1/faucet` and `GET /` are served by the demo Worker, not the operator router, so they are not in `spec/openapi.json`; describe them there (a demo-only tag) or in a separate demo document | T-026 | When agents generate tools from the OpenAPI document alone |
| Faucet abuse: per-client limits are in memory (reset when the Durable Object restarts) and keyed by IP; per-address limits persist. No proof of work or captcha; total supply is unbounded test tokens | T-026 | If the demo is spammed |
| Journal growth: every request that moves the clock adds an `advance` entry, and replay on wake re-verifies every signature; snapshot the chain (or compact clock entries) when the journal grows | T-026 | After a few thousand requests, or when wake time nears the CPU limit |
| A configuration change (`MIN_WINDOW_SEC`) applies only to a fresh world (the window is pinned in the world's stored meta); a reset is renaming `WORLD_NAME` in `worker.ts` and redeploying. No admin route resets or migrates a world | T-026 | When the demo club's rules need to change |
| Replay failure on wake (a journal entry the code no longer accepts after a code change) leaves the world unopenable; detect it, keep the old journal, and start a fresh world with a notice | T-026 | Before any SimChain rule change is deployed to the hosted demo |
| Ciphertext is capped at 1 MiB per object (Durable Object value limit) where the protocol allows 10 MiB; the operator answers a larger upload with a 500, not a 413 | T-026 | When a demo deal ships a larger deliverable |
| Idempotency records (operator and faucet) live in memory; a retry after a Durable Object restart re-runs the call (the chain's own idempotency still stops a double submit) | T-026 | When agents retry across restarts |
| Timeout triggers (offer expiry, fallback, default) are left to agents and the adjudicators' pass; the demo runs adjudicator passes only for 15 minutes after the last write | T-026 | When demo deals exercise timeouts |
| The two nodes share one Durable Object, so a demo cannot show one node refusing or going offline (the neutrality fixtures do, locally); independent nodes need testnet contracts | T-026; Phase 2 | Phase 2 |
| Live judges on the hosted demo run since T-028. Left: a CPU and wall-time check for a five-judge appeal pass inside the Durable Object alarm (measured 3 to 4 s per judge on small deliverables; not measured on a large one) | T-026, T-028 | Before demo deals ship deliverables of tens of thousands of tokens |
| The live budget counts calls, not money: a call on a large deliverable costs up to about 50 times one on a small diff. Cap by tokens or estimated cost per day, from the usage the providers report (already tallied in `GET /` `judges.tokensToday`) | T-028 | If the public demo sees large rubric deliverables |
| Budget granularity: an adjudicator pass runs live only when the day's remainder holds a whole panel, but a pass that decides several cases can still cross the cap mid-panel and seat live and scripted judges together (each verdict is labelled) | T-028 | If the demo sees concurrent rubric deals near the cap |
| Adding or removing the model secrets switches the registry the adjudicators publish (live or placeholder) when the Durable Object restarts; rubric deals offered under the other registry are refused at judgment (`registry_mismatch`) and fall to their default outcome. Keep both registries servable, or bind each commitment's registry for its life | T-028 | Before the secrets change while rubric deals are open |
| `GET /v1/commitments/{id}/judgment` serves the latest record only: after an escalation the appeal's record replaces the primary's (the deal script polls to catch both). Serve every record, by adjudicator and attempt | T-028 | When buyers audit escalated deals |

## Demo data and agents

| Item | Source | When it matters |
| --- | --- | --- |
| Injection deliverables: `injection-plain` and `injection-base64` (beat 6, first delivery) | T-012 | With T-009's panel and the beat 6 fixture |
| `panel-borderline` deliverable that passes every check but splits the panel | T-012 | With T-009 recordings |
| Change-log notes file delivered with the clean CSV (graded by the `notes` rubric criterion) | T-012 | When live or recorded judges grade the rubric (T-009) |
| `_example` delivers the generated clean file instead of stub bytes, with recordings re-captured | T-012 | T-010 lane; the club and terms files are loaded since T-012 |
| Recorded (not fake) judge verdicts for the demo beats, captured once live judges are allowed, so beat 3 shows real rationales | T-012 | With `pnpm demo --live` (T-013) |
| `pnpm demo --live` (T-028) runs, but its story does not: on 2026-11-01 live judges split beat 3's panel (escalation, not accept), the fallback in beat 7 rejected the "good" CSV on the `notes` criterion, and several seats abstained on the 60k-token CSV (one run ~$3). For a live demo that shows the intended beats: deliver the change-log notes the rubric asks for, a smaller deliverable or sample for the judges, and beats that narrate whatever the panel decided instead of assuming accept | T-028 | Before `pnpm demo --live` is shown to anyone |
| Live mode replaces every bench's provider (`useLiveJudges` in `apps/demo/agents/bench.ts`, module state); profiles list the live registry's judges instead of their declared ones. A per-world option through `players()` would be cleaner | T-028 | Next demo-agents change |
| `AdjudicatorConfig` takes an injectable random source for the envelope it seals to the buyer, so a seeded run's settlement log replays byte for byte (today only that ciphertext differs) | T-012 | T-009 lane; before T-013 diffs transcripts |
| Stale derived hashes in `spec/examples`: the commitment example's `rulebookHash`, `id` and signature, and the adjudicator example's `policyHash` and `poolTermsHash`. Core's EIP-712 vectors are pinned over the commitment example, so fix them together and extend the check in `tests/spec.test.ts` | T-012 | Next spec change |
| Agents for beat 6's injection half (escalation to Bench C), beat 7 (op-1 refuses, Bench A offline, club revokes the seller) and beat 8 (appeal paid by the bond) | T-012 | Next demo step: Northgate and Atrium already run as T-009 services in every world (Northgate takes over at judgeBy); beat 7's operator half works today through the SDK failover |
| Data for optional beat 9 (work for work) | T-012 | When that beat is built |
| SDK read for released keys (`GET /v1/commitments/{id}/key`); the agents call the operator with `fetch` and fall back to SimChain | T-012 | Next SDK change |
| Terms windows as a schema-level template (`deliverWithinSec` and friends) if other tools need terms files | T-012 | When a second consumer appears |
| Adversarial agents (a buyer that withholds agreement after acceptance, a seller that delivers to the wrong envelope set, a split the seller did not agree to) | T-012 | After the basic demo |
| Root `.gitignore` rule `data/` also matches `fixtures/data/`; anchor it as `/data/` | T-012 | Next scaffold change |
| Registration fields for what agents choose on but v0.6 cannot carry: roles offered (primary, fallback, appeal), a per-judge reasoning or effort setting bound into the policy hash, and a fee rate (bps of price) beside `fee.min`. The demo keeps them as cast-level profile data (`apps/demo/agents/cast.ts`) | T-017 | Next schema bump; before agents choose adjudicators from registrations they did not write |
| Signed adjudicator proposal and agreement messages (today plain agent-to-agent objects), and a counter-proposal path when the seller rejects one bench but another eligible one offers the role | T-017 | When negotiation happens between agents of different operators |

## Housekeeping

| Item | Source | When it matters |
| --- | --- | --- |
| `state.ts` comment pointing to `mulBps` for the appeal bond | Schema v0.5 second review | Next core change |
| README notes for additions beyond ADR text (`providerPrivacy: standard`, narrowed `termsHash`/`recordHash` events) | Schema v0.5 second review | Next spec change |
| Normalize an absent `unlock` to `none`; dispute windows under the uint32 check | Schema v0.5 second review | Before optimistic mode is admitted |

## T-006 review survivors

Findings from the T-006 (SimChain) review that the demo does not need. The three blocking findings (unsigned `recipient` on a `SealedKey`, `finalAt` moving on a late appeal-expiry trigger, the untested `releaseKey: false` guard) were fixed on the T-006 branch.

| Item | Source | When it matters |
| --- | --- | --- |
| Coverage-gate boundary test is masked by core, so it does not pin SimChain's own gate at the boundary | T-006 review | T-202, when the gate moves into the contract |
| F5 shortfall, measured: a fallback with no free bond pays 0 default compensation; an overturn of a fallback decision pays 500M of the 2,000M price | T-006 review; escrow-theory review F5 | Phase 3 hardening, with `todo.default-bond-shortfall` |
| Even split of default compensation between primary and fallback needs Rafa's call (Decision 4) | T-006 review | Before the split is written into a rulebook term or the contract |
| Fee share on a mutual settlement before delivery, when genesis clubs are not parsed against the rulebook schema | T-006 review | When a club sets `adjudicatorFeeShareAfterDeliveryBps` above 0 |
| `journal()` exposes held key envelopes before they are released | T-006 review | Before private disclosure levels are admitted (ADR-0020) |
| `bond.slashed` is emitted with zero amounts when the reservation or pool is empty | T-006 review | When indexers count slashes |
| Mixed timestamp formats: deadlines from core carry milliseconds (`…05.000Z`), SimChain times do not (`…05Z`); string comparison of the two fails | T-006 review | Next core change; before clients compare timestamps as strings |
| `missingSignature` reporting for `agree_and_fund` in validate (ADR-0017 §7) | T-006 review | T-007, when the SDK previews combined submissions |
| Core stores signed sub-objects as received (mutual-settlement `payouts`, the `Delivery` in state), so unsigned extra fields a relayer adds reach state and events; SimChain now copies key envelopes field by field, core should do the same | T-006 review fix | Next core change; before events are validated strictly |
| Adjudicator keys and policies from a source no operator controls: compare the operator-served registration with the adjudicator's self-published one (a well-known document), then with an on-chain registry (Phase 2). Today two agreeing operators are the trust anchor, and colluding operators can agree on a false key | T-020 security re-check (PR 53) | Before any deal whose plaintext an operator must not read rests on fewer than two independent operators |
| Advisory warnings on prepare: flag values that are representable but look off (a deadline centuries out, a zero judging window) without refusing them (D31) | T-020, D31 | When agents start negotiating windows themselves |
| Commitment view fields "final at T" and "buyer can decrypt"; today `deadlines.appealBy` and `GET /v1/commitments/{id}/key?recipient=` answer both | T-020 outsider re-tests | Next `commitment-state.schema.json` change (ADR and version bump) |
