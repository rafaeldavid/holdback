# ADR-0024: Private deals and the end-to-end encrypted API

- **Status:** Accepted by Rafa, 2026-11-01 (D34), as amended after the research pass.
- **Date:** 2026-11-01 (amended the same day after the research pass)
- **Raised by:** Rafa, 2026-11-01: make "private escrow" true end to end; the operator should not be able to read the deal either (T-207). Rafa, 2026-11-01: identity, discovery and negotiation stay outside the protocol; per-deal keys by default (D35, rails not a record-keeper). Builds on ADR-0020 (D16), ADR-0012, ADR-0017 (D13), ADR-0023's version rule, D26 and D32.
- **Changes:** schema v0.8; `packages/core`, `packages/sdk`, `apps/operator`, `examples/`, `docs/api.md`, `docs/neutrality.md`; handoff to T-202/T-205 (settlement view, events) and T-207 (acceptance criteria).

## Context

- **Today only the work is private** (measured, `docs/api.md`): terms, judgment records and events are unauthenticated reads, and `POST /v1/prepare/offer` takes the deliverable, checks and rubric in plaintext.
- **Settlement already needs hashes, not text** (measured, `eip712.ts:100-117`): `CommitmentTerms` binds `deliverableHash`, `acceptanceHash` and `buyerEncryptionPublicKey`; `privateTerms` sits outside the struct.
- **Registered encryption keys are unsigned** (measured, `agent.schema.json`, `adjudicator.schema.json`): an operator can serve a false key; the only defence is reading two operators.
- **Ethereum L1 is public** (D4): transfers and calldata show addresses, token and amount.

## Decision

### 1. What an operator still sees

| Sees | Why |
| --- | --- |
| The settlement view (§8): per-deal buyer and seller, token, price, fee, deadlines, adjudicators, mode, hashes of the rest; plus the full struct a party relays | Settlement verifies signatures over them; anyone triggers timeouts from them |
| Signer address of each write, verified before a rate-limit budget is charged | Rate limiting |
| Ciphertext sizes, timing, client IP, who reads which deal | Inherent to relaying (residual) |

It never sees the bodies, the work, judgment reasons or any key. With per-deal keys (§7), the addresses name no long-term identity.

### 2. What becomes ciphertext, sealed to whom

| Object | Encrypted under (AES-256-GCM) | Sealed to |
| --- | --- | --- |
| `deliverable` (optional `salt`, `notes`, `sellerEncryptionPublicKey`) | Own key; AAD = commitment ID ‖ `"deliverable"` | Buyer and primary at offer; fallback and appeal per §5 |
| `acceptance` (checks, rubric, sealed checks; optional `salt`) | Own key; AAD = commitment ID ‖ `"acceptance"` | Same |
| Work | Content key (ADR-0012, unchanged) | Unchanged |
| Judgment record | Fresh key per record | Buyer and seller always (D26); appeal adjudicator on escalation |

Two keys, so `judgment` can publish the acceptance while the deliverable stays private. `privateTerms` becomes `{deliverable: {hash, ciphertext, envelopes[]}, acceptance: {hash, ciphertext, envelopes[]}}`. The salt stops anyone confirming a guessable body, such as a template rubric (inferred). The hash rule stays keccak256 of RFC 8785 JSON. Every recipient checks the body hashes before signing (D32): the buyer before `Agree`, the primary before `AdjudicatorAcceptance`.

### 3. Read authentication and levels

- `ReadToken {viewer, commitmentId, audience?, expiresAt, nonce}` (new EIP-712 type) in `Authorization: Holdback-ReadToken <base64url JSON>`. `audience` (an operator address) stops replay at another operator. `commitmentId = 0x00…` scopes list reads to the viewer's deals. The agent picks the expiry (D31).
- With a valid token from a party, or an adjudicator once involved: bodies, records, private events, envelopes. Otherwise **401 `unauthorized`**. Everyone else gets the **settlement projection**: the settlement view plus settlement events, no more.
- **`Publish` is unchanged.** Keys travel outside it in a `disclosure` body `{acceptanceKey?, deliverableKey?, recordKeys[]}`, posted with the co-signed `Publish` (raise only) or later by either party. The operator checks each key against its hash before serving plaintext.
- ReadToken guards metadata at honest operators; a dishonest one can leak only ciphertext and the projection (inferred).

### 4. Client-side deterministic prepare

The operator cannot prepare what it cannot read. `docs/api.md` publishes the recipe (field order, JCS hashing, salts, `createdAt` from two operators, random nonces) with test vectors; `examples/verify.ts` becomes the reference builder. At `private` and `judgment` the recipe also generates one signing key and one X25519 key per deal, and the `Delegation` (§7). `POST /v1/prepare/offer` gains a hash-only mode.

### 5. How adjudicators get plaintext

- **Primary:** body envelopes at offer; it verifies the bodies before accepting, or declines.
- **Fallback and appeal: union of envelopes.** The seller at offer and the buyer at agree may each add envelopes time-locked to the beacon round at `judgeBy` or `appealBy` (ADR-0020). Any one that opens suffices, so neither party gates judgment. `escalate` and appeals carry body and record envelopes for the appeal adjudicator.
- **Private inference (D35)** is `providerPrivacy: zdr` with a named provider, such as Venice's zero-retention tier (sourced). It ends provider retention, not plaintext exposure (residual 6), and weakens self-reported model identity (residual 8), so the record keeps the provider-returned model string. Registry rule: two providers, or one no-retention provider plus one `local` seat (inferred). An adjudicator may declare `retainsPlaintext: false` (keeps hashes and the sealed record only), backed by reputation.

### 6. Keys

- **Party keys are per deal and bound in the signed terms:** `buyerEncryptionPublicKey` (struct, unchanged) and `deliverable.sellerEncryptionPublicKey` (hashed body, which the buyer and primary both verify).
- **Adjudicator keys:** a self-signed `KeyRegistration` (new type) served by two operators, later anchored on chain. Candidate: the deployed ERC-6538 registry under a Holdback scheme ID (sourced; T-202 checks it has no owner and decides).
- `EncryptedKey.keyId` applies to adjudicator keys; rotation is a new registration, and old secrets are kept until open deals are final.

### 7. Pseudonymous keys by default

- At `private` and `judgment` each party uses one-time keys. A `Delegation {principal, agent, dealKey, dealEncryptionKey, clubId, scope, nonce, expiresAt}` (new type), signed by the long-term agent key, goes to the counterparty before `agree` and to the primary with the offer.
- **Settlement** verifies the per-deal signatures and the rulebook hash, as today. **Scope and membership** are checked by the counterparty and the adjudicator from the certificate (D32). Caps are per commitment; the principal's agent enforces its own budget. The rulebook's `identityModes` admits the mode.
- **Evidence (D26):** revealing one certificate ties one deal to its principal; both parties hold both. Random keys beat HD derivation, where one xpub links every deal.
- **Reputation** is selective linkage (backlog). Anonymous membership (Semaphore v4, BBS) waits until a club asks.
- **Funding linkage stays (residual 11).** A transfer from a known treasury links the per-deal address; per-deal keys hide links inside Holdback's records, not the funding graph. A shielded pool or fresh on-ramp account is the agent's choice.
- **Negotiation and the mailbox leave the protocol** (D35). The protocol carries only the deal's own objects. An operator may offer a mailbox as a free service (backlog, non-normative: sign-then-encrypt `Mail`, recipient-issued delivery tokens for gating, as in Signal's sealed sender).

### 8. What remains public on L1

The contract takes the **settlement view** in calldata: the fields it enforces in the clear, and 32-byte hashes for the rest (body, rulebook, registry and policy hashes, nonce, and keccak256 of `schemaVersion`, `clubId`, `policyId`, `remedy`, `disclosure`, `buyerEncryptionPublicKey`). It recomputes the commitment ID from the view, stores one word per commitment, has later calls re-supply the view, and emits ERC-8183-compatible events with IDs and amounts. Ciphertext never goes in calldata.

| Cost (inferred from EIP constants; T-202 measures) | Full struct | Settlement view |
| --- | --- | --- |
| Terms calldata | about 2 KB, 20k gas | about 0.9 KB, 9k gas |
| Happy path, 2 transactions | about 530–660k gas | about 510–640k gas |
| At 0.5–1 gwei, ETH near $2,400 (sourced, 2026) | | about $0.60–$2.20 |

The view is taken for hiding club, policy, level and buyer key, not cost; the cost lever is transaction count.

| Option | Hides | Status |
| --- | --- | --- |
| Public amounts | Nothing; with per-deal keys an amount carries no identity | **Adopted for Phase 2** (residual) |
| Per-deal keys (§7) | Cross-deal linkage in Holdback records | **Adopted** |
| Shielded funding (Privacy Pools, Railgun) | Funding source | Agent's choice; never a dependency (single ASP; DAO-controlled circuits) |
| Confidential tokens (Zama ERC-7984) | Amounts, but wrap and unwrap are public | **Not adopted:** instant upgrades, token-owner blocking and observers, pausers (sourced, L2BEAT); later only as a club's signed residual |
| Bucketed amounts | Exact amounts | Later option |
| Prividium fragment (T-208) | Content off every operator | Spike after T-206 |

## Versions

- **Schema v0.8** (additive): `ReadToken`, `Delegation`, `KeyRegistration`, problem `unauthorized`, two-part `privateTerms`, `private` and `judgment` admitted, `deliverable.salt|notes|sellerEncryptionPublicKey`, `acceptance.salt`, `EncryptedKey.keyId`, the `disclosure` keys body, policy `retainsPlaintext`, projection read schemas.
- **EIP-712 domain and `commitment.schemaVersion` stay "0.6"** (ADR-0023): no existing struct changes (inferred from `eip712.ts`). Dropped from the first draft: `Mail` and `Publish.recordKey`, which would have moved the domain.

## Alternatives considered

- **A. Access control only.** Every operator reads every deal. Rejected.
- **B. End-to-end encrypted API (this ADR).** No on-chain cost, no new actor.
- **C. Prividium fragment per escrow (T-208).** Private atomic settlement is architecture, not product (sourced, Matter Labs Q2 2026); a batch proof costs about 460k L1 gas (sourced, dated), roughly a second happy path; adds a sequencer whose stall must be harmless (D4). B leaves room for it.
- **D. Full chain privacy (Aztec, fhEVM).** Deferred: Aztec's March 2026 critical bug, not Solidity; fhEVM tokens carry admins (sourced).
- **Seller key as a struct field.** Rejected: moves the domain to 0.8 for no gain over the hashed body.

## Consequences

- Fixtures: `attack.third-party-reads-private-deal`, `attack.operator-reads-private-deal`, `attack.operator-serves-false-adjudicator-key`, `pseudonymous.certificate-checked-before-agree`, `publish.judgment-discloses-acceptance-only`, one per level, `error.read-token-expired`, `error.body-hash-mismatch-refused-by-primary`. `neutrality.operator-refuses-mailbox` is dropped.
- **Default level `private`** in the recipe and SDK; operators may publish their own default; `policy.disclosureMin` is the precedent lever. The demo viewer holds both parties' keys, so the audience still sees the whole deal.
- **Wording elsewhere:** the hard rule in `CLAUDE.md` ("address and scope") and the neutrality definition ("registered scope") each need one sentence: at the pseudonymous level, the certificate attests scope and membership, checked by counterparty and adjudicator, not settlement. `CLAUDE.md` is Rafa's to edit.
- Residual 9 narrows to the projection; residual 11 gains the funding-linkage sentence. Per-signer limits are Sybil-cheap with per-deal keys: the IP bucket stays the backstop; a funded-address threshold is operator policy.

## Litmus tests

- **Neutrality: passes.** Settlement verifies the same signatures from the view; triggers need only the projection; ciphertext is content-addressed and re-servable; prepare is client-side; either party or the beacon supplies fallback keys; certificates add no settlement step; settling needs no mailbox.
- **The hold: passes, unchanged.** No new path touches held funds.
- **Defended judgment: passes.** Every deciding adjudicator gets bodies, work and keys and verifies hashes first; private inference keeps two families and pinned IDs. Risk: a fallback that opens no envelope goes to default (inferred; mitigated by the union rule).

## Research pass (2026-11-01)

A read-only pass over the repo and the web answered the first draft's seven open questions and folded in Rafa's per-deal-key direction and D35. Key sources: EIP-7623 and ERC-6538; ScopeLift's ERC-6538 deployments; L2BEAT pages for Zama confidential tokens, Privacy Pools and Railgun; Matter Labs' Q2 2026 report; Nethermind on ZKsync batch costs; Signal's sealed sender; Semaphore v4 and its audit; IETF BBS draft-12; Venice docs; Cloudflare Durable Objects pricing; ethereum.org gas trends. Gas figures are unmeasured until T-202.
