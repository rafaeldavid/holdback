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
| Commitment | terms (deliverable, acceptance, price, timing, adjudication with registryHash and policyHash, settlement), rulebookHash, nonce, EIP-712 signatures; the adjudicator acceptance sits outside the ID | `commitment.schema.json` |
| Signed messages | Offer, Agree, AdjudicatorAcceptance, FundingAuthorization, EarlyAccept, Decision, AgentRevocation, MemberAdmission, MemberRevocation | `messages.schema.json` |
| Hold | commitmentId, token, amount, state, railRef | inside `commitment-state.schema.json` |
| Delivery | ciphertext URI, plaintext SHA-256, ciphertext SHA-256, content key encrypted to the adjudicator, attempt | `delivery.schema.json` |
| Verdict | one judge's structured output | `judge-verdict.schema.json` |
| Judgment | pipeline record, panel, decision, adjudicator signature | `judgment.schema.json` |
| Appeal | appellant, grounds, bond | `appeal.schema.json` |
| Adjudicator | address, bond, policy, registry version, metrics | `adjudicator.schema.json` |
| Event | seq, type, payload, prevHash, hash | `event.schema.json` |

## Commitment state machine

The state has two parts (ADR-0016): the **escrow state** says where the money is, and the **appeal state** says whether a first-instance decision is under appeal.

**Escrow state**

```mermaid
stateDiagram-v2
  [*] --> Offered: seller signs
  Offered --> AcceptedByAdjudicator: primary adjudicator accepts (seed commitment, bond reserved)
  Offered --> Expired: offer expiry (anyone)
  AcceptedByAdjudicator --> Agreed: buyer signs
  AcceptedByAdjudicator --> Expired: offer expiry (anyone)
  Agreed --> Held: fund (acceptance and reserved bond required)
  Agreed --> Expired: fund deadline (anyone)
  Held --> Delivered: seller delivers (attempt ≤ max)
  Held --> Refunded: deliverBy passed (anyone: reclaim)
  Delivered --> Released: buyer accepts early
  Delivered --> Released: primary decides accept
  Delivered --> Refunded: primary decides reject
  Delivered --> Escalated: primary decides escalate
  Delivered --> FallbackJudging: judgeBy passed (anyone)
  FallbackJudging --> Released: fallback decides accept
  FallbackJudging --> Refunded: fallback decides reject
  FallbackJudging --> Escalated: fallback decides escalate
  FallbackJudging --> Defaulted: fallbackBy passed (anyone)
  Escalated --> Released: appeal adjudicator accepts
  Escalated --> Refunded: appeal adjudicator rejects
  Escalated --> Defaulted: appealDecideBy passed (anyone)
  Defaulted --> Refunded: default outcome (seller compensated from bonds)
  Held --> Settled: buyer and seller co-sign a settlement
  Delivered --> Settled: buyer and seller co-sign a settlement
  FallbackJudging --> Settled: buyer and seller co-sign a settlement
  Escalated --> Settled: buyer and seller co-sign a settlement
```

`Settled` is terminal and not appealable. A co-signed `MutualSettlement` pays any split of the price and chooses whether the buyer receives the content key; the fee returns to the buyer in Phase 1 (ADR-0019, D15). Settle-once holds: if a settlement and a decision race, the first one applied wins.

In `guaranteed_on_decision` a decision moves the money in the same step, so there is no separate settle step. `settle_after_window` (Phase 4) adds a `Decided` escrow state that settles when the appeal state closes.

**Appeal state** (only after a first-instance decision by the primary or fallback; a decision reached through escalation is not appealable)

```mermaid
stateDiagram-v2
  [*] --> none: first-instance decision
  none --> open: party appeals before appealBy (bond and appeal fee)
  none --> expired: appealBy passed
  open --> upheld: appeal adjudicator upholds (appellant bond to the adjudicator's bond)
  open --> overturned: appeal adjudicator overturns (adjudicator bond pays the wronged party)
  open --> expired: appealDecideBy passed (first decision stands, appellant bond returned)
```

An overturn moves bond money, not escrow money: the escrow is already `Released` or `Refunded`.

Rules the types must enforce. Illegal states are unrepresentable (ADR-0009): a discriminated union per state, carrying only the fields valid in that state.

| Transition | Who may trigger | Guard |
| --- | --- | --- |
| Offer | Seller agent signature | Scope allows seller role and price; rulebook hash known; nonce unused |
| Accept (adjudicator) | Primary adjudicator signature | Its policy and registry hashes equal the commitment's; unencumbered bond ≥ price in guaranteed mode; before offer expiry |
| Agree | Buyer agent signature over the identical terms hash | Scope allows buyer role, price and daily cap; mandate valid; member admitted under a club rulebook |
| Fund | Anyone holding the buyer's funding authorization | A valid adjudicator acceptance; balance ≥ price + fee + gas buffer; before fundBy |
| Deliver | Seller signature | Before deliverBy; attempt ≤ maxSubmissions; ciphertext and hashes present |
| Reclaim | Anyone | After deliverBy with no delivery |
| Accept early | Buyer signature | State Delivered |
| Decide | The adjudicator whose turn it is | Before its deadline; seed valid for the role (primary: preimage of the acceptance's `seedCommitment`; fallback and appeal: the beacon seed for the round fixed by `judgeBy`, the escalation or the appeal filing, ADR-0018); policy and registry hashes equal the commitment's; judgment record hash included |
| Fallback / default | Anyone | After judgeBy / fallbackBy; for an escalated case, after appealDecideBy |
| Appeal | Party signature + bond + appeal fee | Within appealWindow after a first-instance decision. Grounds: wrong outcome, missing or wrong key, policy or panel violation, mislabeled model |
| Settle | Anyone | `settle_after_window` only (Phase 4): appeal state closed |

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

## Panel randomness (ADR-0018)

The primary's panel seed comes from its own commit-reveal. The fallback and appeal adjudicators take theirs from a public beacon, at a round the decider does not control: `panelSeed = keccak256(commitmentId ‖ role ‖ attempt ‖ beaconValue(round))`.

| Decider | Beacon round |
| --- | --- |
| Primary | none (reveals the preimage of `seedCommitment`) |
| Fallback | the round at `judgeBy` |
| Appeal after escalation | the first round after the escalation was applied |
| Appeal after a party appeal | the first round after the appeal was applied |

SimChain runs a deterministic beacon, `keccak256(simSeed ‖ round)`, one round per simulated second. Phase 2 uses drand quicknet, verified on chain. If a round cannot be proven by the deadline, the decision is refused, and the fallback or default applies.

## Privacy and disclosure (ADR-0020)

Every commitment has a public skeleton and a private body.

| Part | Contents | Who sees it |
| --- | --- | --- |
| Skeleton | Commitment ID, terms hash, payout addresses, token, price and fee, deadlines, the three adjudicators, mode, `policyHash`, `registryHash`, `rulebookHash`, outcomes, money and bond movements | Everyone, at every level. Timeouts, the coverage gate and settle-once need only this |
| Body | Description, criteria, rubric, sealed checks, judgment reasons | Public at `public`; criteria and judgment record public at `judgment`; otherwise the parties and involved adjudicators, through a record key wrapped to each |
| Work | The deliverable | Never published by the protocol. Readable by whoever holds the content key |

Keys go only to those who need them. Whoever wants judgment carries the key; the seller is never the gate.

| Path | Content key and record key |
| --- | --- |
| Mutual settlement | The parties only |
| Early acceptance | The buyer, with the payment |
| Optimistic mode | The buyer at delivery. A `Dispute` carries keys for all three adjudicators |
| Guaranteed mode, primary | At delivery |
| Fallback | Released on takeover: SimChain holds the envelope in Phase 1; time-locked to the beacon round at `judgeBy` in Phase 2 |
| Appeal | Carried by the `escalate` decision or the appeal; time-locked to `appealBy` as a backstop in Phase 2 |

Disclosure levels are a signed term: `private`, `judgment` or `public`. A rulebook sets `disclosureMin`, an adjudicator policy may require a minimum, and a co-signed `Publish` can raise the level, never lower it. Phase 1 admits `public` only. Bond backers see aggregate signals recomputed from skeleton events, not cases.

## Hold and settlement postings (SimChain)

The prototype uses accounts per address and per escrow, in base units of the test token. Each adjudicator's bond is a pool with two tranches, `bond:{a}:junior` (its own stake, first loss) and `bond:{a}:senior` (backers, pro rata), plus one `reserved` counter (ADR-0014 §2a, D10). Below, `bond:{a}` means the pool: debits take junior first, then senior; the appeal-upheld credit goes to junior. Senior is empty in Phase 1.

| Operation | Postings |
| --- | --- |
| Faucet (test only) | `external:faucet → buyer` |
| Fund | `buyer → escrow:{id}` (price + fee) |
| Release | `escrow:{id} → seller` (price); `escrow:{id} → adjudicator:{a}` (fee) |
| Refund | `escrow:{id} → buyer` (price); `escrow:{id} → adjudicator:{a}` (fee earned for judging) |
| Early acceptance | `escrow:{id} → seller` (price); `escrow:{id} → buyer` (fee; no adjudicator judged) |
| Reclaim (no delivery) | `escrow:{id} → buyer` (price + fee) |
| Mutual settlement | `escrow:{id} → seller` (`sellerAmount`); `escrow:{id} → buyer` (price − `sellerAmount` + fee); every reservation on the commitment released; buyer key emitted only if `releaseKey` |
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
- `junior + senior - reserved` ≥ `ceil(price × windowCoverageRatioBps / 10000)` before a new assignment, with a 100% ratio for `guaranteed_on_decision` commitments still open to appeal;
- losses are taken from junior before senior;
- encumbered bond is never counted twice (one commitment's overturn and another's default cannot draw on the same units);
- every rate is applied with `mulBps` or `splitBps` (ADR-0022): requirements round up; a split rounds the rate side down and pays the remainder to a named party (fee share: remainder to the buyer; capital charge: remainder to the adjudicator; backers: dust to junior); payouts from a bond round down and the bond keeps the dust. No posting creates or destroys a unit.

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
- Signed messages are EIP-712 typed data, with domain `{name: "Holdback", version: "0.4", chainId, verifyingContract}`. SimChain uses a fixed placeholder contract address.
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
- **Mutual settlement:** a message buyer and seller both sign that ends a funded, undecided commitment at any split of the price, with or without releasing the content key to the buyer (ADR-0019).
- **Skeleton:** the public part of a commitment: IDs and hashes, payout addresses, token and amounts, deadlines, adjudicators, mode, outcomes and money movements. Anyone can act on it (ADR-0020).
- **Disclosure level:** a signed term, `private`, `judgment` or `public`, that sets which parts of the body are public. A rulebook sets the minimum; a co-signed `Publish` can raise it.
- **View key:** a key a party hands to an auditor or examiner so it can read a commitment's body without publishing it.
- **Pseudonymous identity:** a one-time signing key per commitment, linked to the agent's long-term identity only for the counterparty and involved adjudicators (ADR-0020, Phase 2).
- **Beacon:** a public source of randomness rounds that no adjudicator or party controls. It seeds fallback and appeal panels (ADR-0018). SimChain in Phase 1, drand quicknet in Phase 2.
- **Backer:** any address that deposits into an adjudicator's bond pool and earns its capital charge pro rata, behind the adjudicator's first-loss stake (ADR-0014).
