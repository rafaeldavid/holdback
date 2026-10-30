# Architecture v0.1

Reflects decisions D1–D9 (`docs/decisions-today.md`) and the Phase 0 reviews in `docs/reviews/`. Open gaps for Phase 1 are listed in `docs/reviews/2026-10-30-phase0-readiness.md`.

## Shape of the system

```mermaid
flowchart LR
  subgraph Agents
    BA[Buyer agent + SDK]
    SA[Seller agent + SDK]
  end
  subgraph Operators["Operator nodes (permissionless, interchangeable)"]
    API[REST API]
    IDX[Indexer + event log]
    REL[Relayer / gas sponsor]
  end
  subgraph Adjudicators["Adjudicators (permissionless, bonded)"]
    PIPE[Judgment pipeline]
    PANEL[Multi-model panel]
  end
  subgraph Settlement["Settlement layer (no admin keys)"]
    ESC[Escrow + rules]
    REG[Club, agent, adjudicator registries]
  end
  RAMP[On-ramps / off-ramps: Stripe test, cards, stablecoin]
  BA -- signed messages --> API
  SA -- signed messages --> API
  BA -. escape hatch: direct submit .-> ESC
  API --> REL --> ESC
  ESC --> IDX --> API
  PIPE --> PANEL
  PIPE -- signed decision --> ESC
  RAMP -- funds in/out --> ESC
```

**Settlement layer.** Escrow plus rules, with no owner. In Phase 1 it is **SimChain**: an in-process, deterministic implementation of the same rules. From Phase 2 it is an EVM contract on a local chain and then a testnet (ADR-0003, ADR-0004). One `Settlement` interface covers both, and the scenario fixtures run against each (differential testing).

**Operator node.** Exposes the REST API, verifies and relays signed messages, sponsors gas, indexes events and serves receipts. Anyone can run one. An operator adds speed and convenience, never authority.

**Rules contract.** From Phase 2, the contract that acts as the escrow's operator in the Commerce Payments Protocol sense: the only party that can capture or void the buyer's funds. It has no admin keys and acts only on an adjudicator decision, a buyer's early acceptance or a timeout anyone can trigger. It also holds bonds, releases keys and supplies idempotency (ADR-0003). In Phase 1, SimChain plays this role. Do not confuse it with an operator node, which has no authority.

**Adjudicator.** Runs the judgment pipeline, posts a bond in the registry and signs decisions. Each commitment names a primary, a fallback and an appeal adjudicator.

**Ramps.** Convert fiat to the settlement token and back. They act only before funds are held and after they are released.

## Domain objects

| Object | Key fields | Schema |
| --- | --- | --- |
| Club / rulebook | id, rulebook parameters, rulebookHash | `club.schema.json` |
| Agent | address, member, scope (caps, roles, expiry), mandate | `agent.schema.json`, `mandate.schema.json` |
| Commitment | terms (deliverable, acceptance, price, timing, adjudication, settlement), rulebookHash, nonce, EIP-712 signatures | `commitment.schema.json` |
| Hold | commitmentId, token, amount, state, railRef | inside `commitment-state.schema.json` |
| Delivery | ciphertext URI, plaintext SHA-256, ciphertext SHA-256, content key encrypted to the adjudicator, attempt | `delivery.schema.json` |
| Verdict | one judge's structured output | `judge-verdict.schema.json` |
| Judgment | pipeline record, panel, decision, adjudicator signature | `judgment.schema.json` |
| Appeal | appellant, grounds, bond | `appeal.schema.json` |
| Adjudicator | address, bond, policy, registry version, metrics | `adjudicator.schema.json` |
| Event | seq, type, payload, prevHash, hash | `event.schema.json` |

## Commitment state machine

```mermaid
stateDiagram-v2
  [*] --> Offered: seller signs
  Offered --> Agreed: buyer signs
  Offered --> Expired: offer expiry (anyone)
  Agreed --> Held: fund (buyer or relayer with buyer authorization)
  Agreed --> Expired: fund deadline (anyone)
  Held --> Delivered: seller delivers (attempt ≤ max)
  Held --> Refunded: deliverBy passed (anyone: reclaim)
  Delivered --> Accepted: buyer accepts early
  Delivered --> Judging: adjudicator opens
  Judging --> Accepted: decision accept
  Judging --> Rejected: decision reject
  Judging --> Escalated: decision escalate
  Judging --> FallbackJudging: judgeBy passed (anyone)
  FallbackJudging --> Accepted
  FallbackJudging --> Rejected
  FallbackJudging --> Escalated
  FallbackJudging --> Defaulted: fallbackBy passed (anyone)
  Escalated --> Appealed: automatic escalation to the appeal adjudicator (no appellant bond)
  Accepted --> Appealed: buyer appeals in window
  Rejected --> Appealed: seller appeals in window
  Appealed --> Released: appeal accept
  Appealed --> Refunded: appeal reject
  Appealed --> Final: appeal deadline passed after a party appeal (first decision stands)
  Appealed --> Defaulted: appeal deadline passed after escalation (anyone)
  Accepted --> Released: settle (mode rules)
  Rejected --> Refunded: settle (mode rules)
  Defaulted --> Refunded: default outcome (seller compensated from bonds)
```

Rules the types must enforce. Illegal states are unrepresentable (ADR-0009): a discriminated union per state, carrying only the fields valid in that state.

| Transition | Who may trigger | Guard |
| --- | --- | --- |
| Offer | Seller agent signature | Scope allows seller role and price; rulebook hash known; nonce unused |
| Agree | Buyer agent signature over the identical terms hash | Scope allows buyer role, price and daily cap; mandate valid |
| Fund | Anyone holding the buyer's funding authorization | Balance ≥ price + fee + gas buffer; before fundBy |
| Deliver | Seller signature | Before deliverBy; attempt ≤ maxSubmissions; ciphertext and hashes present |
| Reclaim | Anyone | After deliverBy with no delivery |
| Accept early | Buyer signature | State Delivered |
| Decide | Assigned adjudicator signature | Before its deadline; judgment record hash included |
| Fallback / default | Anyone | After judgeBy / fallbackBy; for an escalated case, after appealDecideBy |
| Appeal | Party signature + bond + appeal fee | Within appealWindow; decision exists. Grounds include a missing or wrong content key |
| Settle | Anyone | Mode rules satisfied |

Settlement modes (D6, ADR-0003, ADR-0007):
- **`guaranteed_on_decision`:** release or refund executes at the decision (capture or void in the same step). If an appeal later overturns it, the adjudicator's bond pays the wronged party the price, so each such commitment encumbers bond equal to its price until `appealDecideBy`. This is the only mode in Phase 1.
- **`settle_after_window`:** funds stay held until the appeal window closes, or the appeal is decided, then capture or void. Built in Phase 4, after its key-release design (see Two-sided hold).

Resubmission after a reject is not supported in Phase 1 (`maxSubmissions = 1`): in guaranteed mode the refund has already left escrow.

## Two-sided hold (D8)

1. The seller generates a content key `K`, encrypts the deliverable with AES-256-GCM, and uploads the ciphertext to any content-addressed store. In the prototype that is a local store or IPFS-compatible.
2. The delivery carries the ciphertext URI, the ciphertext SHA-256, the plaintext SHA-256, and `K` encrypted to the adjudicator's public key (and to the fallback and appeal adjudicators).
3. The adjudicator decrypts, verifies the plaintext hash and judges.
4. On accept in `guaranteed_on_decision`, the decision transaction carries `K` encrypted to the buyer's public key. Settlement and key release are one atomic step on the settlement layer.
5. On early acceptance, no adjudicator acts, so the delivery also carries `K` encrypted to the buyer, and the settlement layer releases it with the payment.
6. On reject, `K` is never released to the buyer.
7. The settlement layer cannot check that the released `K` decrypts the committed plaintext. A missing or wrong key is an appeal ground, and an appeal decision may carry `K` to the buyer.

In `settle_after_window`, capture happens after the appeal window, and a key published at the decision would be readable at once. That mode needs its own key-release design before Phase 4.

The buyer can verify the received plaintext against the committed plaintext hash.

Limit: the adjudicator sees the plaintext. That is acceptable because adjudicators are bonded and named by both parties. Confidential-compute judging is a later option.

## Hold and settlement postings (SimChain)

The prototype uses accounts per address and per escrow, in base units of the test token.

| Operation | Postings |
| --- | --- |
| Faucet (test only) | `external:faucet → buyer` |
| Fund | `buyer → escrow:{id}` (price + fee) |
| Release | `escrow:{id} → seller` (price); `escrow:{id} → adjudicator:{a}` (fee) |
| Refund | `escrow:{id} → buyer` (price); `escrow:{id} → adjudicator:{a}` (fee earned for judging) |
| Early acceptance | `escrow:{id} → seller` (price); `escrow:{id} → buyer` (fee; no adjudicator judged) |
| Reclaim (no delivery) | `escrow:{id} → buyer` (price + fee) |
| Appeal bond and fee | `appellant → appealbond:{id}` (bond); `appellant → adjudicator:{appeal}` (appeal fee, rulebook parameter) |
| Overturn, guaranteed mode, wrongful accept | `bond:{a} → buyer` (price); `appealbond:{id} → appellant` |
| Overturn, guaranteed mode, wrongful reject | `bond:{a} → seller` (price); `appealbond:{id} → appellant` |
| Appeal upheld | `appealbond:{id} → bond:{a}` |
| Default outcome | `escrow:{id} → buyer` (price + fee); `bond:{a} + bond:{fallback} → seller` (compensation per rulebook) |
| Default after escalation | `escrow:{id} → buyer` (price + fee); `bond:{appeal} → seller` (compensation per rulebook) |

`{a}` is the adjudicator whose decision settles the commitment: the primary, the fallback, or the appeal adjudicator for an escalated case. The fee goes to that adjudicator; an adjudicator that escalates earns no fee. On the Commerce Payments Protocol, the refund path is a fee-only capture followed by `void` (ADR-0003).

Invariants, property-tested:
- conservation (the token total is constant except faucet mints);
- no negative balances;
- each escrow is settled at most once;
- bond ≥ coverage ratio × open exposure before a new assignment, with a 100% ratio for `guaranteed_on_decision` commitments still open to appeal;
- encumbered bond is never counted twice (one commitment's overturn and another's default cannot draw on the same units).

## Settlement interface

```ts
interface Settlement {
  kind: 'sim' | 'local' | 'testnet';
  submit(msg: SignedMessage): Promise<SubmitResult>;          // any party may call; validates on the settlement layer
  fund(auth: SignedFundingAuthorization): Promise<SubmitResult>;
  trigger(commitmentId: Hex, timeout: TimeoutKind): Promise<SubmitResult>; // permissionless timeouts
  state(commitmentId: Hex): Promise<CommitmentState>;
  events(fromSeq: bigint): AsyncIterable<SettlementEvent>;
  balances(addresses: Address[]): Promise<Record<Address, TokenAmount>>;
}
```

The REST API and SDK call only this interface. Chain details stay in the `local` and `testnet` implementations.

## Identity and signing

- Agents, principals and adjudicators are EVM addresses: externally owned accounts, or smart accounts later.
- Signed messages are EIP-712 typed data, with domain `{name: "Holdback", version: "0.1", chainId, verifyingContract}`. SimChain uses a fixed placeholder contract address.
- Funding is gasless for agents. The buyer signs a token transfer authorization (ERC-3009 `transferWithAuthorization` or Permit2), and any relayer can submit it.
- A mandate is the principal's EIP-712 signature over the agent's scope: caps, roles, categories, expiry. It is checked at agree and fund.

## Events, receipts, audit

- Every settlement event is appended to a hash-chained log: `hash = keccak256(prevHash || canonicalEvent)`.
- Operators serve receipts signed by the operator key.
- Decisions carry the adjudicator's signature and the judgment record hash. The full record is published to content-addressed storage.
- `pnpm replay` rebuilds state from events and checks it against the settlement layer's state.

## Timing rules

- Fixed order: `offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy < appealBy < appealDecideBy`.
- Each window has a rulebook minimum, sized for forced-inclusion delay on the target chain.
- On the Commerce Payments Protocol, `authorizationExpiry` ≥ `appealDecideBy` plus a forced-inclusion margin, and `refundExpiry` equals it (ADR-0003).
- Demo defaults (SimChain, simulated clock): judge 120 s, fallback 120 s, appeal window 300 s, appeal decision 300 s.
- Agents never see card hold windows. Card and Stripe funding converts to tokens before the hold, so card authorization lifetimes do not bound the escrow.

## Repository layout (proposed for T-001)

```
apps/
  operator/        REST API (Fastify), relayer, indexer
  adjudicator/     adjudicator service: pipeline + signing
  demo/            narrated CLI, transcript renderer, static viewer
packages/
  core/            types from schemas, state machine, EIP-712 types, money
  settlement/      Settlement interface; sim/ (SimChain); evm/ (contract client, Phase 2)
  judgment/        intake, checks, screen, providers, panel, aggregation
  sdk/             agent SDK with operator failover + direct submit
  testkit/         snap runner, deterministic clock/RNG, recorded providers, fixture helpers
contracts/         Foundry project (Phase 2)
spec/              JSON Schemas (contract) + examples
fixtures/          scenarios/, calibration/, redteam/, data/
docs/              specs, ADRs, tasks, research
.claude/           agents, commands, settings
```

## Glossary

- **Club:** a set of members who agree once on a rulebook for their agents' commitments. It works like a group purchasing or framework agreement, with buyers and sellers both as members, closer to a card scheme.
- **Rulebook:** the club's parameters: dispute procedure, minimum windows, bond and coverage ratios, sealed-check limits, default-outcome compensation. Its hash binds each commitment.
- **Member:** a firm in a club. **Principal:** the member's signing key that issues mandates.
- **Agent:** an address that signs commitments within a scope. **Mandate:** the principal's signed scope for an agent.
- **Commitment:** signed terms between a buyer agent and a seller agent: Offered, then Agreed.
- **Hold:** escrowed price plus fee (money side), and the escrowed content key (work side).
- **Delivery:** ciphertext plus hashes plus the escrowed content key.
- **Acceptance:** the decision that delivery met the terms.
- **Deterministic check:** a declarative, machine-evaluated acceptance test.
- **Rubric criterion:** a scored criterion judged by the panel. **Sealed check:** a buyer check committed by hash at agreement and revealed at judging.
- **Screen:** the injection and anomaly detection step.
- **Panel / judge / verdict:** the set of pinned models; one model call; its structured output.
- **Judgment:** the full pipeline record and decision.
- **Escalation:** sending a case to the appeal adjudicator instead of auto-deciding.
- **Appeal:** a party's bonded challenge to a decision.
- **Adjudicator:** a bonded service that judges and signs decisions. **Fallback adjudicator:** decides if the primary misses its deadline.
- **Default outcome:** what anyone may trigger when no adjudicator decides in time.
- **Bond:** adjudicator capital that pays when an appeal overturns its decision, or when it misses its deadline.
- **Coverage ratio:** minimum bond as a share of open exposure.
- **Operator node:** a node offering the REST API, relaying and indexing, with no authority. **Escape hatch:** direct submission without any operator node.
- **Rules contract:** the escrow's operator in the Commerce Payments Protocol sense, the only party that can capture or void, constrained to decisions, early acceptance and timeouts.
- **SimChain:** the in-process simulation of the settlement rules.
- **Rail:** where custody happens. **On-ramp / off-ramp:** fiat conversion before the hold / after release.
- **Receipt:** an operator-signed record of an accepted message or a settlement event.
