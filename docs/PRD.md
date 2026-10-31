# PRD: Holdback v0.1

Status: draft, October 30, 2026. Owner: Rafa (DRI). Decisions still open: `docs/decisions-today.md`.

## Problem

An agent that commissions work from an agent at another firm has no way to commit money conditionally at machine speed. Today it has three choices:

- pay first and trust the provider;
- let the provider deliver first and trust the buyer;
- wait for a person to approve.

The essay that motivates this project puts it this way: per-call spend clears, while commitments still go to a human approver.

Existing options each fail at least one requirement (`docs/research/escrow-options-2026-10.md`):

| Option | Fails on |
| --- | --- |
| Stripe manual-capture hold | Neutrality: the processor or the platform decides. Duration: card holds last about 4–7 days. Finality: the payer keeps chargeback rights. |
| Escrow.com API | Speed: built for human parties. Disputes go to human case managers. |
| Commerce Payments Protocol (Coinbase, Shopify) | Judgment: the operator decides capture, and there is no acceptance or dispute layer. USDC only. |
| ERC-8183 evaluator escrow | Disputes: a single evaluator, "no dispute resolution or arbitration". Still a draft standard. |
| Agent-escrow startups (Kustodia, x402B, x402r) | Unverified claims, no published usage, unclear custody and release control |

The missing piece is the acceptance desk. Someone has to decide whether work that no ledger can check met its terms, and that someone has to pay when wrong.

## Who has the problem

| User | Need |
| --- | --- |
| Buyer operator (procurement ops lead running a buyer agent) | Bounded spend; pay only on acceptance; an audit trail; no lock-in to one provider |
| Seller operator (running a provider agent) | Proof that funds exist before working; release not at the buyer's whim; keep the work if rejected |
| Club operator | A rulebook and admission of members and agents, without power over funds |
| Adjudicator operator | Run the judgment, post a bond, price the fee from its measured error rate |
| Agent developer | One API and SDK; no chain details; works through any operator |
| AI lab researching agentic commerce (first demo audience) | See the experience end to end: what agents can commit, how judgment is defended, where control sits |

**Job story:** when my agent commissions a $2,000 dataset-cleaning job from an agent at another firm, I want the money and the work held, and each released only on acceptance, so neither side can take the other's value and no single party can stop the deal.

## Objective

First and foremost, a protocol, not a service:

1. **Any two agents choose their own adjudicator.** The buyer and seller name the primary, fallback and appeal adjudicators in the commitment they both sign. No one assigns them.
2. **Any capital holder can join the bonding.** Anyone can post or back an adjudicator's bond and earn for the capital at risk (ADR-0007; backers proposed in ADR-0014).
3. **Access is by API.** Any operator node serves the REST API and SDK, and agents can also submit signed messages directly to the settlement layer. No single API provider is required (ADR-0005).

On that protocol: machine-speed agent-to-agent escrow via direct API calls, with defended multi-model judgment, on a settlement layer no single party controls.

## Where value accrues

Escrow custody is close to a commodity: an existing contract with no admin keys can hold the buyer's funds (`docs/research/prior-art.md`). The scarce part is the overseer role, meaning the rules contract plus the adjudicators who decide release. Neutrality (ADR-0001) forbids any single party from owning that role, so it is a permissionless market: adjudicators post bonds and compete on fees priced from their measured error. Holdback earns only as one adjudicator among many or through tooling, never through control of the judge registry or the rules contract (ADR-0007).

## Design principle

User choice: the parties choose, and the protocol enforces what they chose. Settlement modes, adjudicators, the judge registry and acceptance checks are options selected per commitment, each with stated tradeoffs and a fee quote. Clubs may narrow them in a rulebook. An option is offered only if it keeps the neutrality test (ADR-0001, ADR-0015).

Widen collaboration; the law stays the backstop. The product's job is to extend the set of deals agents can make with each other, at machine speed, between parties that do not trust each other. It is not a substitute for courts: agent owners and controllers will seek legal recourse when something goes wrong, and protocol finality is not legal finality (`docs/architecture.md`, residual 5). The protocol therefore bounds loss and leaves a signed, attributable record, identical for both parties, that either can disclose as evidence, rather than adding machinery for every dispute (D26).

## Goals

| ID | Goal |
| --- | --- |
| G0 | **Demo first.** A researcher can run the demo with scripted judges in under 5 minutes with no keys, and understand hold, judgment, settlement and neutrality from the transcript |
| G1 | **Machine-speed hold and settlement** through direct API calls |
| G2 | **Two-sided hold:** money in escrow, work encrypted, key released on settlement |
| G3 | **Defended multi-model judgment** |
| G4 | **Neutrality:** every actor-failure fixture completes according to terms |
| G5 | **Capital behind judgment:** bonded adjudicators, appeals, guaranteed settlement mode |
| G6 | **Rails abstraction:** SimChain, a local chain and a testnet run the same scenarios. Fiat enters only through ramps |
| G7 | **Audit:** signed receipts and a replayable event log |

## Non-goals for v0.1

- Real money, mainnet, licensing, KYC.
- Consumer checkout.
- Code-execution acceptance checks.
- Negotiation protocols. Agents negotiate out of band; Holdback records the signed terms.
- Milestone or partial deliveries (v0.2).
- Foreign exchange.
- A human review UI beyond a CLI stub.
- Production key management.

## Requirements

### Clubs, members, agents

- **FR-1** A club publishes a rulebook. The rulebook hash is bound into every commitment signed under it.
- **FR-2** Members register agents by address, with a scope: maximum per commitment, daily maximum, roles, categories, expiry. A mandate signed by the principal backs each scope.
- **FR-3** Revoking an agent blocks new commitments only. Commitments in flight continue.
- **FR-4** An open rulebook exists that needs no membership.

### Commitments

- **FR-5** The seller signs an offer as EIP-712 typed data. Its terms are: deliverable spec, acceptance spec, price, timing, adjudicator, fallback adjudicator, appeal adjudicator, settlement mode, rulebook hash, nonce and expiry.
- **FR-6** The buyer agrees by signing the same typed data. A one-shot call that agrees and holds in one step is supported.
- **FR-7** Signatures are verified against scope, nonce and expiry, and duplicates are rejected.

### The hold

- **FR-8** Funding moves the price plus the adjudication fee into escrow. Neither party can withdraw alone.
- **FR-9** Every operation is idempotent. No double spend under concurrency.
- **FR-10** Anyone can trigger every timeout: reclaim after a missed delivery, the fallback adjudicator, the default outcome, appeal expiry.
- **FR-11** The seller delivers ciphertext plus a plaintext hash. The content key is encrypted to the adjudicator and released to the buyer only on acceptance (D8).

### Acceptance and judgment

- **FR-12** Declarative deterministic checks run first. A required check that fails means reject. If all checks pass and there is no rubric, the work is accepted.
- **FR-13** Otherwise a panel judges, with pinned models from at least two families. The panel is selected by commit-reveal, with the seed and the judge registry hash committed at agreement.
- **FR-14** The defenses in `docs/judgment-and-defenses.md` are mandatory: untrusted-data handling, screen, schema-enforced verdicts, sealed checks, submission limits, family diversity.
- **FR-15** Aggregation produces accept, reject or escalate. An injection flag or a cross-family disagreement means escalate, never auto-accept, except at the appeal, where a flagged case is accepted only by a unanimous panel from all available families in which no judge suspects injection, and is otherwise rejected (D27).

### Appeals and adjudicators

- **FR-16** Either party may appeal within the appeal window by posting a bond. The appeal adjudicator decides with a larger panel of at least three families where available. A missing or wrong content key is an appeal ground. An escalated case undecided by the appeal deadline goes to the default outcome.
- **FR-17** Adjudicators post bonds. An overturned decision pays the wronged party from the bond. A bond below the coverage ratio blocks new assignments. In guaranteed mode the ratio is 100% per commitment still open to appeal.
- **FR-18** Settlement modes, chosen per commitment: `guaranteed_on_decision` (Phase 1), `settle_after_window` (Phase 4) and, if ADR-0015 is accepted, `optimistic` (release at `disputeBy` unless the buyer disputes).

### Interfaces

- **FR-19** A REST API on any operator node, per `docs/api.md`.
- **FR-20** A TypeScript SDK with failover to another operator and direct submission.
- **FR-21** An MCP server wrapping the SDK, in Phase 6.

### Audit

- **FR-22** A hash-chained event log; receipts signed by the adjudicator and the operator; a replay tool that rebuilds state from events.

### Demo

- **FR-23** `pnpm demo` runs the scripted scenarios with scripted judges (recorded model verdicts later) and writes a narrated transcript (Markdown and JSON) plus a static timeline viewer. `--live` uses real judges.

### Non-functional

| ID | Requirement |
| --- | --- |
| NFR-1 | Latency on SimChain, locally: hold p95 ≤ 250 ms, release/refund p95 ≤ 250 ms, one-shot agree+hold p95 ≤ 300 ms |
| NFR-2 | Testnet: hold confirmed p95 ≤ 5 s. The API returns `holding` at once and `held` on inclusion |
| NFR-3 | 100 concurrent holds against one buyer balance: zero overdrafts |
| NFR-4 | Deterministic CI: recorded or fake judges, seeded clock and randomness, no network |
| NFR-5 | Security: no admin keys; secrets only from the environment; no code execution from inputs |

## Success metrics for v0.1

| Metric | Target | Measured by |
| --- | --- | --- |
| Demo time-to-first-transcript, scripted judges, fresh clone | ≤ 5 min | Manual dry run (T-013) |
| Hold p95 (SimChain) | ≤ 250 ms | `pnpm load` |
| Overdrafts under 100 concurrent holds | 0 | Property and load tests |
| Neutrality fixtures passing | 100% | `pnpm snap` |
| False-accept rate, calibration set | ≤ 2% | `pnpm calibrate` |
| False-reject rate, calibration set | ≤ 5% | `pnpm calibrate` |
| Red-team deliverables auto-accepted | 0 | `pnpm calibrate --redteam` |
| Red-team deliverables flagged or escalated | ≥ 90% | `pnpm calibrate --redteam` |
| Escalation rate on clean calibration cases | ≤ 15% | `pnpm calibrate` |
| Cost per panel judgment | Report only | `pnpm calibrate` |

## Release criteria for v0.1

- Phases 0–3 complete (`docs/plan.md`).
- All scenario fixtures pass in CI.
- Demo dry run passes.
- Metrics reported.
- Open decisions closed or deferred by ADR.

## Risks

| Risk | Mitigation |
| --- | --- |
| Holding funds is regulated activity | Testnet and test mode only. Non-custodial contract design reduces exposure; counsel review before any production path |
| Judgment quality on real work types | Calibration per work type. Start with dataset cleaning, where deterministic checks carry most of the load |
| Model drift between versions | Pinned IDs; registry promotion gated on calibration |
| Neutrality claims overstated | Residual risks listed in `docs/neutrality.md`. The demo states them |
| Scope creep into negotiation or marketplaces | Out of scope; signed terms only |
| Agent team throughput outruns verification | Parallelize only after the verify loop is trusted (`docs/team.md`) |

## Assumptions to pressure-test

1. **Legal effect.** Signed agent messages bind under a club rulebook. That depends on jurisdiction: UETA §14 and the UNCITRAL Model Law on Automated Contracting, Art. 7(1).
2. **Acceptance criteria.** Real jobs can state acceptance criteria up front precisely enough for a panel.
3. **Accuracy targets.** The calibration targets are reachable for dataset cleaning. Transfer to other work types is untested.
4. **Bond sizing.** Adjudicators will post bonds equal to their open guaranteed volume, and 20% coverage suffices for `settle_after_window`. No loss data exists yet.
5. **Settlement mode demand.** Buyers and sellers prefer guaranteed settlement despite paying adjudicators for the risk.
6. **The escape hatch.** Direct submission is usable by agents in practice: gas, account abstraction and paymasters.
7. **On-ramp risk.** Fiat on-ramps will accept card chargeback risk for agent-initiated purchases. Untested.
8. **Prior art.** No current product meets all three litmus tests. The research spike (T-002) should confirm this before Phase 2.
