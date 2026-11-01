# ADR-0024: Private deals and the end-to-end encrypted API

- **Status:** Proposed (D34). Rafa accepts or overrules.
- **Date:** 2026-11-01
- **Raised by:** Rafa, 2026-11-01: make "private escrow" true end to end; the operator should not be able to read the deal either (T-207, `docs/plan.md`). Builds on ADR-0020 (D16), ADR-0012, ADR-0017 (D13), ADR-0023's version rule, D26 and D32.
- **Changes:** schema v0.8; `packages/core`, `packages/sdk`, `apps/operator`, `examples/`, `docs/api.md`, `docs/neutrality.md` (residual 9); handoff to T-202/T-205 for what the contract emits.

## Context

- **Today only the work is private** (measured, `docs/api.md` Conventions): terms, judgment records and events are unauthenticated reads, and `POST /v1/prepare/offer` takes the deliverable, checks and rubric in plaintext, so every operator a seller prepares through reads them.
- **Settlement already needs hashes, not text** (measured, `packages/core/src/eip712.ts:100-117`): `CommitmentTerms` binds `deliverableHash` and `acceptanceHash`; `privateTerms` is reserved outside the struct (`commitment.schema.json`).
- **Not every key is bound in the terms** (measured): `buyerEncryptionPublicKey` is in the struct; seller and adjudicator keys live in off-chain registrations (`agent.schema.json`, `adjudicator.schema.json`).
- **Ethereum L1 is public** (D4): funding and payout transfers show addresses, token and amount; calldata is public too.

## Decision

### 1. What an operator still sees

| Sees | Why |
| --- | --- |
| The `CommitmentTerms` struct fields: addresses, token, price, fee, deadlines, adjudicators, mode, hashes, disclosure level, `buyerEncryptionPublicKey`, nonce | Settlement verifies signatures over them; anyone triggers timeouts from them |
| Signer address of each write, verified before a rate-limit budget is charged | Rate limiting (closes the backlog row "does not verify the signature first") |
| Ciphertext sizes, timing, client IP, which viewer reads which deal, mailbox `to`/`from` | Inherent to relaying (residual, §7) |

It never sees the body, the work, judgment reasons, message contents or any key.

### 2. What becomes ciphertext, sealed to whom

| Object | Encrypted under | Sealed to |
| --- | --- | --- |
| Terms body: `deliverable`, `acceptance` (checks, rubric, sealed checks), notes | Per-commitment record key; AES-256-GCM, AAD = commitment ID | Buyer and primary at offer (seller seals); fallback and appeal per §5 |
| Work | Content key (ADR-0012, unchanged) | Unchanged |
| Judgment record | Fresh key per record, by the deciding adjudicator | Buyer and seller always (D26: both remember equally); appeal adjudicator on escalation |
| Mailbox messages | Per-message key | The recipient |

`privateTerms` becomes `{hash, ciphertext {uri, sha256, bytes}, envelopes[]}`. `deliverable` and `acceptance` gain an optional 32-byte `salt`, so their public hashes cannot be confirmed by guessing a low-entropy body (inferred risk: a template rubric is guessable). The hash rule stays keccak256 of RFC 8785 JSON, so an unsalted body hashes as today.

At `judgment`, `acceptance` and the judgment record are plaintext; at `public`, today's model. Every recipient checks `keccak256(JCS(body)) == deliverableHash/acceptanceHash` before signing (D32): the buyer before `Agree`, the primary before `AdjudicatorAcceptance`.

### 3. Read authentication and enforced levels

- `ReadToken {viewer, commitmentId, expiresAt, nonce}` (EIP-712, new type), sent as `Authorization: Holdback-ReadToken <base64url JSON>`. `commitmentId = 0x00…` scopes list reads to deals where `viewer` is a party. Reads are idempotent, so the nonce is not spent; the agent picks the expiry (D31).
- Served with a valid token from a party, or an adjudicator once involved (primary from acceptance; fallback and appeal on takeover): bodies, judgment records, private events, envelopes. Otherwise **401 `unauthorized`**.
- Unauthenticated reads and `/v1/events` return the **settlement projection**: exactly what the settlement layer itself publishes, no more. T-202 decides that set on L1; SimChain mirrors it.
- `Publish` (co-signed, raise only) carries the record key in plaintext; the operator decrypts, checks the hash and serves the body publicly. Publication is key disclosure, not a re-upload.
- ReadToken guards metadata at honest operators. Content does not rest on it: a dishonest operator can leak only ciphertext and the skeleton (inferred from §2).

### 4. Client-side deterministic prepare

The operator cannot prepare what it cannot read. `docs/api.md` publishes the recipe: inputs → `CommitmentTerms` typed data (field order, JCS hashing, salts, defaults: `createdAt` = `settlementTime` read from two operators, random 32-byte nonces), with test vectors. The SDK and `examples/` build it with no operator call; `examples/verify.ts` already rebuilds typed data from intent and becomes the reference builder. `POST /v1/prepare/offer` gains a hash mode (`deliverableHash`, `acceptanceHash` instead of bodies) for agents that want operator defaults without disclosure.

### 5. How adjudicators get plaintext

- **Primary:** record-key envelope at offer; it opens and verifies the body before accepting, or declines.
- **Fallback and appeal: union of envelopes.** The seller may add envelopes at offer, and the buyer at agree (it has read the body); each is time-locked to the beacon round at `judgeBy` or `appealBy` (ADR-0020; SimChain holds them and releases them on takeover, as in Phase 1). Any envelope that opens suffices, so neither party gates judgment. An `escalate` decision and an appeal carry the record-key and judgment-record envelopes for the appeal adjudicator, as ADR-0020 already requires for the content key.
- Model providers see plaintext per `policy.providerPrivacy` (unchanged; residual 8).

### 6. Key discovery and rotation

- Buyer: `buyerEncryptionPublicKey` in the signed terms (unchanged). Seller and adjudicators: their registrations, read from at least two operators at distinct origins (today's rule), then from a key registry on the settlement layer (handoff to T-202).
- `EncryptedKey` gains `keyId` (keccak256 of the public key), so a recipient knows which secret opens it after rotation. Rotation is a new signed registration and applies to envelopes sealed after it; a recipient keeps old secrets until its open deals are final. A per-commitment buyer key (ADR-0020 §7) avoids linking a buyer's deals through a stable key.

### 7. Encrypted mailbox

- `POST /v1/mailbox`: outer `{to, toKeyId, from, expiresAt, ciphertext, signature}`; the outer signature authenticates `from` for spam gating. Inner: an EIP-712 `Mail {from, to, threadId, bodyHash, sentAt}` signed by the sender, then encrypted (sign-then-encrypt), so the recipient holds an attributable record (D26).
- `GET /v1/mailbox/{address}?since=` with a ReadToken whose viewer is the address. A sender may post to several operators; recipients dedupe by message hash.
- **Gating:** default, per-sender rate limits on the verified `from`. An operator may add a club voucher, a funding threshold or a per-message payment as its own relay policy. Refusing is allowed because another operator relays (`neutrality.operator-refuses-mailbox`). Sealed sender is backlog.
- **Retention:** the sender sets `expiresAt` (D31); an operator publishes its own maximum in `/v1/status` as a service limit.

### 8. Metadata and what remains public on L1

Accepted for Phase 2 as residuals: operators see who deals with whom, when, and message sizes; L1 shows funding and payout transfers (addresses, token, amount) and whatever skeleton the contract takes in calldata (inferred). Options, none adopted by this ADR:

| Option | Hides | Cost or risk |
| --- | --- | --- |
| Public amounts (ADR-0020 §8, default) | Nothing on L1 | None new |
| Pseudonymous one-time keys (ADR-0020 §7) | Cross-deal linkage | Funding links the address unless it comes from a shielded pool |
| Shielded pool for funding (Privacy Pools style) | Funding source | Outside the protocol; the agent's choice |
| Confidential tokens (ERC-7984) as rulebook `allowedTokens` | Amounts | Threshold KMS and token admins (ADR-0020 §8) |
| Prividium fragment per escrow (T-208) | Content and negotiation off every operator | Unproven; transfers stay public without the confidential-token or shielded-pool rows; must pass D4's 2026-10-31 objections |

## Versions

- **Schema v0.8** (additive): `ReadToken`, `Mail`, problem `unauthorized` (401), `privateTerms` with ciphertext admitted, `private` and `judgment` levels admitted, optional `salt` in `deliverable` and `acceptance`, `EncryptedKey.keyId`, `Publish.recordKey`, mailbox and projection read schemas.
- **The EIP-712 domain version stays "0.6", and so does `commitment.schemaVersion`** (ADR-0023 rule). No existing struct changes: `privateTerms` is outside `CommitmentTerms`, new levels are new values of an existing string, salts change body content, not the hash rule, and `ReadToken` and `Mail` are new types (inferred from `eip712.ts`). This holds only if the seller's encryption key or a whole-body hash is **not** added to `CommitmentTerms`; doing so (open question 1) moves both to "0.8".

## Alternatives considered

- **A. Access control only:** ReadToken over plaintext stored at operators. Simple and quick, but every operator reads every deal, which fails Rafa's requirement. Rejected.
- **B. End-to-end encrypted API (this ADR).** Operators hold ciphertext and hashes; L1 leakage stays a stated residual.
- **C. Prividium fragment per escrow (T-208).** The strongest content and negotiation privacy, but unproven: per-fragment cost, sequencing and stall exit are unknown (guessed weeks of spike). It is compatible with B, which T-208 can sit on top of.
- **D. Full chain privacy (Aztec, fhEVM).** Deferred, as in ADR-0020 alternative C: alpha software or token admins.

## Consequences

- Fixtures: `attack.third-party-reads-private-deal`, `attack.operator-reads-private-deal` (canary scans), `neutrality.operator-refuses-mailbox`, one per disclosure level, `error.read-token-expired`, `error.body-hash-mismatch-refused-by-primary`.
- Residual 9 narrows to the settlement projection; new residuals: operator-visible metadata and L1 transfers.
- Phase 2's offer prepare stops accepting bodies at `private` except in hash mode; v0.7 agents at `public` are unaffected.
- Mailbox storage is a new operator cost; free under ADR-0023 unless a later fee ADR prices it.

## Litmus tests

- **Neutrality: passes.** Settlement verifies the same struct and triggers need only the projection. Ciphertext is content-addressed, so any operator or party can re-serve it. Client-side prepare removes the operator from authoring. Fallback and appeal keys come from either party or the beacon, so no single party gates them. A mailbox refusal is routed around.
- **The hold: passes, unchanged.** Funds move only on the same signatures; no new path touches held funds.
- **Defended judgment: passes.** Every deciding adjudicator still gets body, work and keys, and verifies the body before accepting. Defenses and pinned panels are unchanged. Risk: a fallback that cannot open any envelope goes to default (inferred; mitigated by the union rule and tlock).
