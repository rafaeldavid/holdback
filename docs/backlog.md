# Backlog

Work deferred until its trigger arrives. Each row is one line: what it is, where it came from, and when it starts to matter. Agents add rows here instead of building early (`docs/team.md`). A row that becomes work moves to `docs/plan.md` as a task.

The themes follow the plan's phases. Detail behind a row lives in its source: the task file, review, ADR or research note it names.

Refactored on 2026-11-07 from 255 rows to the rows below; the PR that did it lists every removed and merged row with its reason.

## Benched

Rafa holds these back. Each row names what brings it back.

| Item | Source | When |
| --- | --- | --- |
| Contribution rails for collaborators and their agents: `CONTRIBUTING.md`, issue templates and `CODEOWNERS` (PR 151, labelled `benched`) | Rafa, 2026-11-04 | Rafa decides; round 1 is done and Phase 2 closed, so D53 no longer holds it |
| Faucet test ETH (`{"gas": true}`, capped per day) so appeals and the escape hatch work without the agent's own Sepolia ETH | Research §5 (ADR-0028) | When Rafa has Sepolia ETH to spare |

## Phase 3: Judgment

| Item | Source | When |
| --- | --- | --- |
| Party-chosen panels: the terms name models, families, seat count and threshold, and the adjudicator runs or declines them (D29); OpenRouter as an `openai-compatible` provider, with base URL and key per registry entry, not one per service | D36; T-009 review | With the registry and policy work after T-207 |
| Live judges overshoot the verdict schema's length limits by a few characters (Haiku 5.5's evidence ran to 301 and 309 of 300); choose structured outputs, a prompt line or truncating evidence | T-028 | Before a cheap model joins a live registry |
| Record the served model version per call: DeepSeek's names are aliases, so drift shows only by re-calibration; the live registry skipped its calibration run | T-028 | With T-301's calibration |
| Tell appeal judges the screen flagged the delivery, through a new appeal template and policy version | D27g; PR 52 red team | Before live appeal judges see flagged cases |
| Default outcome after an inconclusive panel: today the appeal bond pays although no adjudicator failed; separate absence from a split, and add a "no decision" message | D27g; T-009 | Before Phase 4 bonding economics; needs its own decision |
| A provider's `not_json` escalates while a timeout only lowers the valid count; decide whether a provider fault counts the same either way | D27g; PR 52 re-check | Before live judges sit at the appeal |
| Sampling: a long-record CSV is read by stride, JSON, text and markdown over 100,000 characters escalate, and a small fraction of bad rows can miss every sample; size the sample from a target detection rate | D27g; T-009 | Before real long-text datasets, with calibration |
| A worker with a deadline for deterministic checks, so wall-clock budgets hold under load (K2 failed its 60 s budget only in parallel lanes) | T-008 red team; T-012 verify | Before judging untrusted multi-MB deliverables |
| Screen hardening with T-303: full UTS #39 confusables, calibrated phrase families and false-positive rates, dedicated signal kinds, per-check null tokens, escalation on high-risk signals | T-008; ADR-0021 | Phase 3, with the classifier screen |
| Confidential compute for checks-only commitments, and a PRD line on judging the goods, not documents | Review F2 | PRD line any time; compute later |
| Free text in verdicts and check details can quote the work to a refunded buyer or a public reader (CSV headers, JSON keys); move it under the work's key and report counts or hashes | T-308 research; PR 115 red team; PR 46 review | With ADR-0027's acceptance, or before records reach third-party viewers |
| Appeal supermajorities need policy schema fields; today appeals use the first-instance fractions | T-009 | Next schema bump |
| Fetch another adjudicator's registry by URI; today a fallback or appeal adjudicator must hold the bound registry | T-009 | When benches publish different registries |
| Reference inputs for `reference_row_match_min` fetched by the adjudicator | T-009 | When a commitment uses that check |
| Persist computed decisions across restarts; the no-re-roll memo is in memory | T-009 review | Before live judges run in a long-lived service outside the demo |
| Fold the attempt number into the primary seed, so a re-delivery draws new seats and samples | T-009 review | Before re-delivery (attempt > 0) reaches the primary |
| A colluding primary knows its seed from acceptance; mix in a beacon contribution or commit the seed after delivery | T-009 review | Before open clubs |
| The appeal family minimum drops to what the registry has; refuse instead, or require the registry to meet it | T-009 review | Before benches publish registries with fewer than three families |
| Deterministic checks for text deliverables: length ratio, segment count, glossary terms, language | Outsider usability review | Before a translation or document pilot |

## Phase 4: Adjudicator economics, bonds and modes

| Item | Source | When |
| --- | --- | --- |
| Fees follow the event: an overturn refunds the first-instance fee and a winning appellant's appeal fee from the overturned adjudicator's pool; the gate reserves `price + fee + appealFee` | D21; escrow-theory review F3 | Before Phase 4 backers and `settle_after_window` |
| Kill fee for a sitting adjudicator on mutual settlement, and the fee share when genesis clubs skip the rulebook schema | ADR-0019; D21; T-006 review | When adjudicators report lost panel cost, or a club sets the share above 0 |
| Default compensation: a fallback with no free bond pays 0, a silent fallback or appeal adjudicator holds no reservation on chain, so compensation needs a consent step (fixture `todo.default-bond-shortfall`) | Review F5; T-006 review; T-206 M-3 | Before default compensation is built |
| The split of default compensation between primary and fallback as a rulebook term; SimChain splits it evenly, and the split needs Rafa's call | T-006; T-006 review | Before the split goes into a rulebook or the contract |
| Bond concurrency: on chain the primary's bond is encumbered at funding, so two acceptances against one bond both pass and the second funding is refused; `OfferTask.unencumberedBond` is unused | T-202; T-205; T-009 review | When adjudicators accept many deals at once |
| Free an adjudicator's reservation when `appealBy` passes with no appeal, without waiting for the trigger (SimChain) | T-006 | When adjudicators run many concurrent commitments |
| Backer disclosures: per-pool and per-commitment segregation statements, the surety claim list and penal sum | Review F6, F9 | Phase 4 backers; any audit |
| Backer deposit, withdrawal-notice and withdraw messages | ADR-0014 | Phase 4 |
| The adjudication fee as a cost-plus quote with a capital charge on the bond for large deals | D33; ADR-0014 | Before deals large enough for 1 tUSD to under-price the bond |
| Audit sampling as an opt-in rulebook feature, and checkability pricing | ADR-0014 | With T-306 |
| `Dispute` must carry envelopes for all three adjudicators; SimChain has no guard yet | T-006; ADR-0020 | With optimistic mode |
| Optional consent window for judged modes (`consentWindowSec`, default 0) | D19 | If the AI-lab audience finds automatic judgment opaque |
| A seller first-instance call in optimistic mode, only after the minimum inspection window | D19 | If pilots show buyers threatening informal rejection |
| Negotiable dispute clauses (D29): the parties sign what happens on a screen flag, an unreadable delivery, an inconclusive panel and who bears fees; today's D27 rules become the named default set | Rafa, 2026-10-31 | Before the first pilot; schema change, ADR and version bump |
| Overturned wrongful reject: the buyer keeps its refund and gets the work while the bond pays the seller; document it and decide on the key | Outsider usability review | Before a pilot, with the D29 clauses |
| An adjudicator challenge after agreement, a facilitated-settlement stage, and a waiver-of-discrepancies window (UCP Art. 16(b)) | Review F10, F11 | After a pilot asks |
| Rulebook terms the contract cannot see (appeal bond rate and fee, mutual-settlement rules, fee share, `allowedTokens`) | T-202 | When a club relies on them on chain |

## Phase 5: Operators, ramps, gas and the public demo

| Item | Source | When |
| --- | --- | --- |
| Funding service behind `/v1/funding/*`: swaps, wrapping, bridges and card or bank ramps, delivering the deal token before the hold; T-214 is its first path | ADR-0026; D38; D42 | With T-214, then the assets module |
| Operator fee gaps: no cap, seller-side fee or per-call payment; the separate `fund` call and `POST /v1/holds` relay without the fee; the fee is not counted against mandate caps | D33; ADR-0023; T-029 | When an operator's revenue depends on the fee |
| Operator fee across independent operators: read the relay's schedule and confirm it from a second source | T-029; ADR-0023 | With independent operators |
| Minimise gas: the decision carries the delivery (3 transactions today, 2 in D4), batching, calldata compression, less state per deal | T-205; T-209; Rafa, 2026-11-02 | With T-215 and T-235 |
| Gas measured with real USDC (FiatToken proxy), not the mock ERC-3009 token | T-201; T-202 | With T-235's measured deals |
| `EvmSettlement` keeps pre-funding signatures in memory, so a restart loses them; any party holding them can still fund directly | T-205 | Before an operator outside the demo runs on a real chain |
| `EvmSettlement.validate` returns the current state, not the projected one, and skips simulation for unsigned party messages | T-205 | When agents rely on dry runs against EVM |
| A settlement simulate error that is not a revert throws out of a whole adjudicator pass; on anvil 1.0.0 the EIP-7623 calldata floor triggers it, also for `appeal-expiry` | T-217; T-216 | When the anvil harness needs appeal expiry |
| Chain finality stages (`unsafe`, `safe`, `finalized`) and a reorg check that rolls a book back to `dealOf` on a block-hash mismatch | D20; research §3 | If Sepolia shows reorgs deeper than a block, or before mainnet |
| Round 1's `finality` re-read counts a missing receipt as a reorg; read the block by number instead | T-216 | Before the next re-read of a run older than about 30 hours |
| `drain` clears books and moves its mark before the storage writes succeed; drain only after they do | T-218 red team | If a storage write fails in Workers Logs |
| The funding lane keeps no in-flight row, so a restart mid-mint can lose the answer and a retry may mint again (test tokens) | T-219 | If double grants show in the faucet's daily count |
| A lane check runs only on an adjudicator pass, so a burst of writes with no adjudicator step can drain a lane below its floor | T-057 review | If a day line shows `relay_refused` on a lane |
| Adjudicator alarm passes on a case no pass can finish still cost about 20 passes per 15 minutes; not yet measured on Cloudflare | T-031; T-057 | If a day line shows passes well above two per deal |
| Faucet abuse: per-client limits are in memory and keyed by IP; no proof of work; test-token supply is unbounded | T-026 | If the demo is spammed |
| The operator's rate-limit windows and the faucet's per-client map are never pruned | T-031 review | With the next throttle change |
| Ciphertext is capped at 1 MiB per Durable Object value where the protocol allows 10 MiB, and a larger upload answers 500, not 413 | T-026 | When a demo deal ships a larger deliverable |
| A configuration change such as `MIN_WINDOW_SEC` applies only to a fresh world; no admin route migrates one | T-026 | When the demo club's rules must change |
| Live judge budget counts calls, not tokens, and one pass can cross the cap mid-panel; cap by tokens from `judges.tokensToday` | T-028 | If the demo sees large or concurrent rubric deals |
| CPU and wall time for a five-judge appeal pass inside the Durable Object alarm (3 to 4 s per judge measured on small deliverables) | T-026; T-028 | Before deliverables of tens of thousands of tokens |
| `pnpm demo --live` spends from the judges' own key and workspace; give local runs their own | T-051 review | When Rafa caps the judges' workspace |
| Changing the model secrets switches the published registry, and open rubric deals fall to `registry_mismatch`; keep both registries servable | T-028 | Before the secrets change while rubric deals are open |
| `GET /v1/commitments/{id}/judgment` serves only the latest record; after an escalation the primary's is hidden | T-028 | When buyers audit escalated deals |
| A "never delivers" mode for the test seller to show a reclaim (at least 40 minutes) | D47 | When a visitor asks to see a reclaim |
| SDK operator ranking by `/v1/status` | ADR-0017 | With several independent operators |
| Signed periodic replay attestation and ramp reconciliation | Review F7 | With the ramps |
| Card-funded holds keep Reg Z and network dispute rights against the ramp | D22 | With card ramps |
| Monitoring and self-healing for the hosted demo beyond operator timeouts and the deploy check (the nightly CI run is off since 2026-11-01) | Rafa, 2026-11-01 | With T-063's crawlers |

## Phase 6: API, interop and identity

| Item | Source | When |
| --- | --- | --- |
| Policy for the count of adjudicator registrations, which are never removed (about 3 KB each): a fee, a minimum bond, or pages that skip expired rows | T-221; ADR-0030 | When the count or the storage bill grows past a demo's needs |
| The policy body travels with the appeal, checked against the bound hash, for appeals across operators that share no store | T-221; PR 202 review | When appeals run across operators |
| Read a listing page's bonds in one Multicall3 call or from `HoldbackBonds` events | T-221; PR 202 review | When listings often show `observed.bond: "unknown"` |
| Prepare helpers for adjudicator messages: registration, acceptance and decision | T-221 research §3 | When outside agents run adjudicators and ask |
| Serve the seller-signed `Delivery` and the adjudicator envelopes to a deal's own adjudicators, so an outside adjudicator can check what it judges (Rafa punted it, 2026-11-04) | T-221 research §3; T-205 | When an outside adjudicator judges for real over the API |
| List items return each party's whole balance and omit the seller; return the deal's own amounts and name the seller | Rehearsal 4, 2026-11-02 | Next API batch |
| `POST /v1/prepare/offer` accepts an offer that outlasts the funding window; refuse it at prepare with `field: "timing.fundWithinSec"` | Rehearsal, 2026-11-02 | Next API batch |
| `demo.operators` in discovery differs by node | Rehearsal, 2026-11-02 | Next demo-cloud change |
| Webhooks and a party-scoped event stream, so a seller learns of funding and a buyer of delivery without polling; Standard Webhooks signing | Rehearsal 4; T-025 F5; ADR-0017 | With webhooks |
| `/v1/events` SSE polls every 50 ms, ignores `Last-Event-ID` and has no backpressure | T-007 | With chain event subscription |
| Advisory sanity warnings in prepare (D31): a deadline centuries out, a zero judging window, an `appealDecideSec` shorter than a beacon round, a `judgeBy` off a quicknet round boundary | D31; T-020; T-209; T-217 | When agents negotiate windows themselves; an operator service |
| A pre-payment read of the buyer's own envelope, so an early-accepting buyer need not ask the seller | T-024 | When agents early-accept outside the examples |
| Cap the size and fetch time of a ciphertext from a seller-chosen URI | PR 59 review | Before agents fetch from sellers they do not know |
| Per-call micropayments (x402) and AP2 interop, with the escape hatch kept free | D30; ADR-0017 | With the operator business model |
| The domain is the address: `/.well-known/holdback.json` publishes an operator's, adjudicator's or club's API, domain and keys | D30 | After the demo |
| IETF `RateLimit`, `Deprecation` and `Sunset` headers | ADR-0017 | At API v1.0 |
| A `beacon_pending` problem with `Retry-After`, and appeal refusals that state the bond and fee required | Outsider usability review | Next API batch |
| More list filters (`club`, `appealState`, dates) | ADR-0017 | When a viewer needs them |
| Run-time registration of clubs, members and agents, `AgentRevocation`, signed `MemberAdmission`; SimChain and the operator read genesis only | T-006; T-007; D22 | With D22 revocation |
| Chain-mode `202 pending` with a `submissionId` | T-007 | Next API batch |
| Idempotency records keep successes only and live in memory, so a refused call can be retried and a retry after a restart re-runs (the chain still stops a double submit) | T-006; T-007; T-026 | If clients expect refusals replayed |
| Idempotency keys share one namespace across operators and the direct path; scope them by signer | T-007 review | Before any shared operator |
| Rate limits per signer can be dodged by rotating addresses | T-007 review | Before any public operator outside the demo |
| Receipts are re-signed per read and the cache is unbounded | T-007 review | With operator persistence |
| The `dropResponses` test hook sits in production `OperatorOptions` | T-007 review | Before an operator binary ships |
| `neutrality.operator-rate-limits` and `error.dry-run-has-no-effects` as scenario files, not vitest cases | T-007 | When testkit drives HTTP operators |
| SDK features, built only on demand (D39): signing in `hb.offer`, `verifyReceipts`, reconcile after a lost response, fail over on a non-JSON 200, a key read, step ordering for reopens | T-007 review; T-012; D24 | If an SDK is built |
| Reopening a deal: an atomic close-and-reopen, a signed `supersedes` term, and refunds that credit the buyer's daily cap | D24 | If pilots reopen commitments |
| A seller-signed `OfferWithdrawal`, so an unwanted offer stops encumbering the reservation | D24 | When offers carry long expiry windows |
| Recipient validation for third-party payouts by a dry transfer | D23 | With third-party payouts |
| Key hand-off to an outside arbiter when the parties exit, and the demo beat "the agents leave together" | D23 | When a pilot exits to another arbiter |
| Principal standing: the mandate signer may sign appeals, disputes, settlements and early accepts for its agent | D22; review F8 | Before the rules contract fixes signers for mainnet |
| A scope gate for third-party payouts (`payouts: parties \| any`), and revocation that also disables a revoked agent's consent messages | D22; D23 | Before the rules contract fixes signers for mainnet |
| Scope hardening: enforce `scope.categories`, allowed counterparties and per-counterparty caps; fixture `attack.hijacked-agent-early-accepts` | D22 | When a pilot asks |
| Attribution: each agent key traceable to its principal under legal process, without making it public | D26; ADR-0020 | With the privacy work |
| Domain as persistent identity: a long-term address is the root and a domain its handle, bound both ways; reputation follows the address | Rafa, 2026-10-31 | With the evidence bundle and the D29 clauses |
| Agents without a domain get a random three-word name under a Crow-run domain; check with users first | Rafa, 2026-11-01 | User research first |
| Adjudicator keys and policies from a source no operator controls: compare the served registration with a self-published one | PR 53 security re-check | Before plaintext rests on fewer than two independent operators |
| Signed adjudicator proposal and agreement messages, and a counter-proposal path | T-017 | When agents of different operators negotiate |
| Registration fields agents choose on but the record cannot carry: roles offered, a per-judge reasoning setting, a fee rate | T-017 | Next schema bump |
| Commitment view fields "final at T" and "buyer can decrypt" | T-020 | Next `commitment-state.schema.json` change |
| `contestableUntil`, a `commitment.final` event and `finalAt` in receipts | D20 | When third parties consume receipts |
| Terms windows as a schema-level template | T-012 | When a second consumer appears |

## Phase 7: Far future

Explorations for after the protocol works on L1. Each starts with a research pass and an ADR, and the litmus tests apply.

| Item | Source | When |
| --- | --- | --- |
| Tax liability for agents' owners: which deals are taxable, for whom and where, and what the record must carry so an owner can file | Rafa, 2026-11-02 | Before mainnet with real money |
| Single-block wallet generation and atomic onboarding: a fresh address funded by the ramp straight into the hold | Rafa, 2026-11-02; ADR-0026 | After the funding service exists |
| An agent-to-agent L2 fragment per escrow, settled on L1 by one validity proof, with a permissionless L1 timeout | Rafa, 2026-11-02; T-208 | Far future (plan Phase 8) |
| Club-chosen permissioned settlement chain, such as Prividium, with the signed residual "the chain operator can halt settlement" | ADR-0004 evaluation | When a regulated club asks; needs its own ADR |
| Club guarantee fund with its own claim window, and agent-operator bonds with signed intent mandates | D22 (options C, D) | Consumer-facing clubs; interop |

## Phase 8: Privacy

| Item | Source | When |
| --- | --- | --- |
| Settlement records `Publish` (raise only), so every operator learns the disclosure level from the chain | ADR-0024 §3 | With the next contract redeploy |
| The on-chain settlement view in calldata: hashes for club, policy, level and buyer key, one stored word per deal, never ciphertext | ADR-0024 §8 | With the next contract redeploy |
| Record key unwrapping on takeover, alongside the content key | T-009 | With private records |
| `journal()` exposes held key envelopes before release | T-006 review | Before private disclosure levels are admitted |
| Local-store URI scheme, ciphertext and envelope byte layouts in `docs/api.md`, and AAD binding ciphertext to a commitment | T-014 | With T-207's later slices |

## Phase 11: Contract redeploy and security

These wait for the next rules contract, bundled with T-212, T-225 and T-227.

| Item | Source | When |
| --- | --- | --- |
| Refuse a selection whose fallback has no bond for the price, in core and the contract together, with a `neutrality.*` fixture; operators refuse such terms until then | D46; T-221 | With the next contract redeploy |
| Gasless bonds: deposits and appeal bonds by ERC-3009 authorization, relayed by an operator | D46; T-221 research §4 | With the next contract redeploy |
| `HoldbackRules` is 590 bytes under EIP-170; a dedicated `SubmissionLimitReached` revert and checked ERC-8183 event types need room first | T-202; T-209; T-206; PR 139 | With the next contract change |
| An early accept or mutual settlement after `authorizationExpiry` reverts in CPP; a per-deal `EXPIRY_MARGIN` needs a terms field | T-202; ADR-0025 | With the next terms-encoding change |
| Holdback-domain nonces are not spent on chain; the stage machine refuses replays instead | T-202 | If a message type ever applies in more than one stage |
| The drand verifier needs client equivalence on geth, reth and revm, mainnet gas and precompile checks, and an external audit (the cross-family pass is done) | T-209; T-206 §8 | Before mainnet |
| Recovery objective and operational-risk plan (PFMI P17) | Review F12 | Before mainnet |

## Risk and incentives

One research pass and ADR cover these rows (T-254).

| Item | Source | When |
| --- | --- | --- |
| Party bonds: an optional per-agent bond so a seller has something to lose, as the buyer already does | Rafa, 2026-10-31; PR 52 red team | Phase 4 |
| Slash triggers, strongest first: equivocation, then an injection the appeal panel confirmed; never intent alone | Rafa, 2026-10-31 | Phase 4 |
| Slashed funds go to the victim, then adjudicator bonds, then a club fund or burn; never to the finder | Rafa, 2026-10-31 | Phase 4 |
| Operators as underwriters: an operator backs its clients' party bonds on chain and takes first loss | Rafa, 2026-10-31 | Phases 4 and 5 |
| Clubs and third parties back party bonds, as backers do for adjudicators | Rafa, 2026-10-31 | Phase 4 |
| Operator injection protection as a service: screen offers and messages, scan a released deliverable client-side, name a detector as a pinned check | Rafa, 2026-10-31 | With the operator business model |
| Liability limits stated plainly: an operator can cap money losses, not an owner's legal liability | D26 | With the operator terms of service |

## Compliance and legal

| Item | Source | When |
| --- | --- | --- |
| Counsel on escrow and money-transmitter rules for a fee-charging operator that never holds funds | D33 | Before any real money |
| Retention and erasure (BSA five years against GDPR Art. 17), a named reporting entity, an open-rulebook compliance posture | Review F4 | Before any real user data |
| A legal and economic finality statement: no chargeback after `finalAt` | D20; D22 | With principal standing |
| Trends beyond seven days in Workers Analytics Engine, and publishing weekly telemetry aggregates (Rafa's gate, D39) | T-031; Rafa, 2026-11-03 | After real usage |

## Demo data and agents

| Item | Source | When |
| --- | --- | --- |
| Injection deliverables `injection-plain` and `injection-base64`, and a `panel-borderline` deliverable that splits the panel | T-012 | With the beat 6 fixtures |
| `_example` delivers the generated clean file, with recordings re-captured | T-012 | T-016b |
| Live demo mode replaces every bench's provider through module state; a per-world option is cleaner | T-028 | Next demo-agents change |
| `AdjudicatorConfig` takes an injectable random source, so a seeded run replays byte for byte | T-012 | Before transcripts are diffed |
| Stale derived hashes in `spec/examples`, fixed with core's EIP-712 vectors and a stronger `tests/spec.test.ts` | T-012 | Next spec change |
| Agents for beat 6's injection half, beat 7 and beat 8 | T-012 | Next demo step |
| Data for optional beat 9 (work for work) | T-012 | When that beat is built |
| Adversarial demo agents: a buyer that withholds agreement, a seller that seals to the wrong envelopes | T-012 | After the basic demo |

## Housekeeping

| Item | Source | When |
| --- | --- | --- |
| A `state.ts` comment pointing to `mulBps` for the appeal bond | Schema v0.5 review | Next core change |
| README notes for additions beyond ADR text (`providerPrivacy: standard`, narrowed events) | Schema v0.5 review | Next spec change |
| Normalize an absent `unlock` to `none`; dispute windows under the uint32 check | Schema v0.5 review | Before optimistic mode |
| `termsHash` and `recordHash` on every event | T-006; ADR-0020 | Next schema bump |
| Mixed timestamp formats inside core and SimChain (`.000Z` against `Z`) | T-006 review | Next core change |
| Core stores signed sub-objects as received, so a relayer's extra fields reach state; copy them field by field | T-006 review | Before events are validated strictly |
| `missingSignature` reporting for `agree_and_fund` in validate | T-006 review | When a client previews combined submissions |
| `bond.slashed` is emitted with zero amounts on an empty reservation | T-006 review | When indexers count slashes |
| The coverage-gate boundary test is masked by core | T-006 review | With the next coverage-gate change |
| The root `.gitignore` rule `data/` also matches `fixtures/data/`; anchor it as `/data/` | T-012 | Next scaffold change |
