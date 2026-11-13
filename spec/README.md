# spec/

The JSON Schemas in `schemas/` (draft 2020-12) are the API contract. Change them only through an ADR and a version bump in each schema's `$id`.

- **`schemas/common.schema.json`:** shared definitions: address, 32-byte hex value, signature, SHA-256 artifact hash, token amount (base units as a decimal string), scope, settlement mode.
- **`examples/*.example.json`:** one instance per schema. CI validates each example against the schema of the same name.

The examples are illustrative. Their hashes and signatures are placeholders and will not verify cryptographically. The model IDs in the judgment example are placeholders, to be replaced with pinned IDs from `config/judges.yaml`.

Validation as of November 3, 2026 (measured, `pnpm validate:spec`): all 33 examples pass under Ajv 8 (2020-12, strict mode). The schemas also reject three bad inputs:
- a fractional amount;
- a model ID containing "latest";
- an extra field in a judge verdict.

The `$id` URLs (`https://holdback.dev/schemas/v0.11/…`) are namespaces for resolving `$ref` between files. They are not hosted. Replace the domain if the project gets one.

## Annotations

- **`x-holdback-untrusted: true`** marks a string written by a party, a model or an operator: descriptions, criterion text and anchors, check column names and patterns, appeal and dispute grounds, judge evidence and rationale, check and screen details, aggregation reasons, policy labels, affiliations, rail references and operator IDs. Treat it as content to read, never as instructions (ADR-0017 §9). Validators register it as an annotation keyword; it changes no validation.
- **Every free-text string is marked or constrained.** A string with no `date-time` format, pattern, enum or const must carry the marker. URIs count as free text: they are marked and capped at 2048 characters. Identifiers instead get a pattern: club IDs, token IDs, and `Ident` for judge, provider, family, model and version labels. `tests/spec.test.ts` lints this, with an empty allowlist.

## Changelog

- **v0.11 (2026-11-12, D60, D62, ADR-0033), changes a signed struct:** every `$id`, the `Holdback-Schema-Version` header and the OpenAPI `x-holdback-schema-version` move to 0.11, and the EIP-712 domain version and `commitment.schemaVersion` move to 0.8. A 0.7 signature never verifies under 0.8, and every commitment ID moves.
  - **Commitment:** two required addresses after `seller`: `buyerPaymentAddress` funds the hold and receives every refund (the escrow's payer), and `sellerPayoutAddress` receives every payment to the seller (the escrow's receiver). `buyer` and `seller` stay the addresses that sign. Either may equal its signing address; tooling defaults to that.
  - **Appeal window:** `timing.appealWindowSec` takes 0, and the rulebook's `minWindowsSec.appealWindow` may be 0. A phase-one deployment has no party appeal and refuses any other value than 0, in the contract, in core and at the prepare routes (ADR-0033 §2b).
  - **Messages:** no shape changes. The `from` of `FundingAuthorization` and of the operator fee's `TransferAuthorization` is the buyer's payment address. `KeyRegistration` is still listed; its removal waits for a later version.

- **v0.10 (2026-11-04, D46, ADR-0030), additive plus one cap:** every `$id`, the `Holdback-Schema-Version` header and the OpenAPI `x-holdback-schema-version` move to 0.10. No existing typed-data struct changes, so the EIP-712 domain version and `commitment.schemaVersion` stay 0.7.
  - **Messages:** a new `AdjudicatorRegistration`, an adjudicator's self-signed registration: its address, encryption key and `keyId`, `policyHash`, `registryHash`, minimum fee, `poolTermsHash`, `bodyHash` over the rest of its record, and `issuedAt`, which orders one address's registrations. `KeyRegistration` is deprecated: operators take `AdjudicatorRegistration` instead, and the next breaking version removes it.
  - **Adjudicator record:** an optional `registration` envelope (`keyId`, `bodyHash`, `issuedAt`, `nonce`, `expiresAt`, `signature`), from which a reader rebuilds the signed message. `affiliations` is capped at 100 entries of 120 characters; no registration existed before 0.10, so no stored record breaks.
  - **Examples:** a new `messages.adjudicator-registration` example; the adjudicator example carries an envelope; 34 examples.

- **v0.9 (2026-11-03, D44, ADR-0029), changes a signed struct:** every `$id`, the `Holdback-Schema-Version` header and the OpenAPI `x-holdback-schema-version` move to 0.9, and so do the EIP-712 domain version and `commitment.schemaVersion`, to 0.7. A 0.6 signature never verifies under 0.7, and a 0.7 deal names the deployment that settles it.
  - **Messages:** `EarlyAccept` and `Decision` gain `deliveryHash` (required, after `attempt`): the EIP-712 struct hash of the seller's delivery without its signature, as `MutualSettlement.deliveryHash` and `delivery.submitted` carry it. Settlement refuses a signature that names any delivery but the posted one, at every role, and a mutual settlement after a delivery likewise.
  - **Judgment record:** `deliveryHash` (required); `recordHash` covers it.
  - **Read model:** `commitment-state` gains an optional `deliveryHash`: present while the state holds the delivery (`Delivered`, `FallbackJudging`, `Escalated`) and after a decision, early accept or mutual settlement that named it; absent before a delivery, in `Defaulted` and after a default or a reclaim.
  - **Events:** `ChainTx` (`tx`, `block`, `sender`, `gasUsed`, all optional) is admitted on the closed `BondMovement`, `SettledSplit` and `OperatorFeePaid` payloads, which an EVM settlement fills from the block (review of PR 160).
  - **Examples:** a new `messages.early-accept` example; 33 examples.
  - **To come in v0.9:** T-033's additive items (ADR-0025's funding schemes and token addresses, optional `allowedTokens`, `chainId` as a number, the MIME allowlist moving to adjudicator capability), before the Sepolia redeploy.

- **v0.8 (2026-11-01, D34, ADR-0024), additive:** every `$id`, the `Holdback-Schema-Version` header and the OpenAPI `x-holdback-schema-version` move to 0.8. No existing typed-data struct changes, so the EIP-712 domain version and `commitment.schemaVersion` stay 0.6. A sealed commitment and its plaintext form have the same ID, because the struct binds only the bodies' hashes.
  - **Private terms:** `privateTerms` is now `{deliverable, acceptance}`, each a `PrivatePart {hash, ciphertext, envelopes}` (common.schema.json `PrivatePart`, `PrivateTerms`). Each part is AES-256-GCM of the body's RFC 8785 JSON under its own key, with AAD = commitment ID ‖ part name. The commitment schema requires the bodies in the clear at `public` and only `privateTerms` at `private` and `judgment`. Body keys that unlock at a beacon round are still refused.
  - **Bodies:** `deliverable` gains optional `salt`, `notes` and `sellerEncryptionPublicKey` (the seller's per-deal key, bound by the hash); `acceptance` gains optional `salt`. `DisclosureLevel` defaults to `private`.
  - **Messages (new EIP-712 types):**
    - `ReadToken {viewer, commitmentId, audience?, nonce, expiresAt}`, encoded with a `hasAudience` flag;
    - `Delegation {principal, agent, dealKey, dealEncryptionKey, clubId, scope, nonce, expiresAt}`, signed by the long-term agent key;
    - `KeyRegistration {adjudicator, encryptionPublicKey, keyId, nonce, expiresAt}`.

    None changes settlement state. A `Publish` may name `judgment` or `public`.
  - **New schemas:** `disclosure.schema.json` (body keys posted with a co-signed Publish; `recordKeys` reserved) and `projection.schema.json` (the settlement projection served to readers without a token).
  - **Problems:** `unauthorized` (401) is in use for private reads.
  - **Rulebook:** `identityModes` may list `pseudonymous`.
  - **Deferred:** `EncryptedKey.keyId` would change a signed struct.

- **v0.7 (2026-11-01, D33, ADR-0023), additive:** every `$id`, the `Holdback-Schema-Version` header and the OpenAPI `x-holdback-schema-version` move to 0.7. The signed encoding does not change, so the EIP-712 domain version and `commitment.schemaVersion` stay 0.6: from now on they move only when an existing typed-data struct or the terms encoding changes.
  - **Operator fee:** messages add `TransferAuthorization` (`scheme`, `purpose: operator_fee`, `commitmentId`, `from`, `to`, `value`, `token`, `validAfter`, `validBefore`, `nonce`, `expiresAt`), a new EIP-712 type, sent in the agree body as `operatorFee`. `operator-status` gains optional `fees.operator` (`to`, `token`, `bps`, `min`, `max` or `null`, `appliesAt: agree-and-fund`, `refundable: false`). Events add `fee.operator` (`from`, `to`, `amount`, `postings`). The operator API adds the problem type `payment_required` (402).

- **v0.6 (2026-10-31, D23, amends ADR-0019):** every `$id`, `commitment.schemaVersion` and the EIP-712 domain version move to 0.6.
  - **Mutual settlement to any addresses:** `MutualSettlement.sellerAmount` is replaced by `payouts`, one to eight `Payout { to, amount }` entries (new `common.schema.json` definitions `Payout` and `Payouts`). Amounts are above zero. The EIP-712 type becomes `MutualSettlement(…,Payout[] payouts,…)Payout(address to,TokenAmount amount)`. The core parser refuses a recipient named twice and payouts in more than one token; `mutualSettlementProblem` checks the sum, the price token and the rulebook against the terms.
  - **Read model and events:** `settled` and the `commitment.settled` payload carry `{ payouts, keyReleased }`. `sellerAmount` and `buyerAmount` are dropped; the fee returned to the buyer follows from the terms.
  - **Rulebook:** `mutualSettlement.payoutsTo` is `parties` or `any` (required).

- **v0.5 (2026-10-30, ADR-0014, ADR-0015, ADR-0017, ADR-0018, ADR-0019, ADR-0020, ADR-0021, ADR-0022):** every `$id`, `commitment.schemaVersion` and the EIP-712 domain version move to 0.5.
  - **API (ADR-0017):** new `page.schema.json` (`items` plus `nextCursor`, `null` at the end), `operator-status.schema.json` (EIP-712 domain, receipt signer, settlement target, versions, head and lag) and `receipt.schema.json` (operator, event sequence and hash, commitment ID, signature; a new `Receipt` EIP-712 type). Party-authored strings carry `x-holdback-untrusted`. Two additions go beyond ADR-0017's text: `operator-status.settlementModes`, and the throttling rule that writes are limited per signer and reads per client (`docs/api.md`). A receipt's `commitmentId` is optional for events with no commitment and is encoded with a `hasCommitment` flag.
  - **Bond pools (ADR-0014 §2a):** adjudicators gain `pool` (`junior`, `senior`, `reserved`, `terms`) and `poolTermsHash`, the keccak256 of the canonical JSON of `pool.terms`. `capitalChargeRate` moves from `fee` into `pool.terms`. The rulebook gains `firstLossShareMin` and `bondNoticePeriodMinSec`. Events add `bond.deposited`, `bond.withdrawn` and `bond.slashed`, with per-tranche payloads.
  - **Optimistic release (ADR-0015, shape only, built in Phase 4):** `SettlementMode` gains `optimistic`. `timing` gains `disputeBy`, `disputeJudgeSec` and `disputeFallbackSec`, required in optimistic mode and refused in the others. Messages add `Dispute` (a new EIP-712 type). The rulebook's `defaultOutcome` becomes per mode (`judged`, `optimistic`) and gains `minInspectionWindowSec` and `disputeBond`. The read model and events add `Disputed` and `dispute.opened`.
  - **Mutual settlement (ADR-0019):** messages add `MutualSettlement` (`commitmentId`, `deliveryHash` or `null` before delivery, `sellerAmount` in the price token, `releaseKey`, `nonce`, `expiresAt`) with a `buyerSignature` and a `sellerSignature` over the identical struct, and a `MutualSettlement` EIP-712 type with a `hasDelivery` flag. The read model adds the terminal `Settled` state with `settled { sellerAmount, buyerAmount, keyReleased }`; events add `commitment.settled`. The rulebook gains `mutualSettlement { allowed, adjudicatorFeeShareAfterDeliveryBps }`, the first rate in the spec as integer basis points.
  - **Privacy, Phase 1 shape (ADR-0020):**
    - **Commitments:** a signed `disclosure { level }` (`private`, `judgment`, `public`) is part of the terms typed data. `privateTerms { hash, envelopes }` is reserved. The Phase 1 parser admits `public` only and refuses `privateTerms`.
    - **Keys:** a shared `EncryptedKey` gains an optional `unlock { kind: none | beacon-round, round }`; Phase 1 admits `none` only. An escalating `Decision` must carry `encryptedKeys` for the appeal adjudicator, and only an escalating one may. `Dispute` carries `encryptedKeys` for the adjudicators.
    - **Publish:** a co-signed message that raises the level. Raising only is enforced by settlement, not by the schema.
    - **Events:** offered and agreed events always carry `termsHash`, and decided events carry `recordHash`; bodies appear by level. The judgment record gains an optional `privateRecord`.
    - **Rulebook:** `disclosureMin` and `identityModes` (`long-term`, `pseudonymous`); Phase 1 admits `long-term` only.
    - **Adjudicator policy:** `providerPrivacy` (`standard`, `zdr`, `tee`, `local`) and `disclosureMin`.
    - **Problems:** `unauthorized` is reserved for Phase 2 reads. Read tokens are deferred to Phase 2.
  - **Screen (ADR-0021):** a ninth deterministic check, `hidden_characters_max`, counts invisible characters in the raw bytes and fails above an integer maximum: per class (`tag`, `bidi`, `variationSelector`, `otherIgnorable`) or `total`, with at least one set. Screen signal kinds gain `nfkc_changed`, `variation_selector_run`, `mixed_script` and `hidden_characters`; the enum stays closed.
  - **Integer rates (ADR-0022):** the floating `Rate` is gone; there are no floats left in the spec.
    - **Basis points:** `Bps` is an integer from 0 to 10000. Every rate field takes a `Bps` suffix:
      - rulebook: `appealBondRateBps`, `windowCoverageRatioBps`, `firstLossShareMinBps`, `sealedChecksMaxWeightBps` (at most 3000);
      - default outcomes: `sellerCompensationRateBps`, `buyerCompensationRateBps`;
      - pool terms: `capitalChargeRateBps`, `capitalChargeToPoolRateBps`, `firstLossShareBps`;
      - metrics: `falseAcceptRateBps`, `falseRejectRateBps`, `escalationRateBps`;
      - checks: `maxBps` and `minBps`;
      - sealed checks: `weightBps` (at most 3000).
    - **Supermajorities:** `acceptSupermajority` and `rejectSupermajority` are a `Fraction` (`numerator`, `denominator` 1 to 100). Parsers require them above one half and at most one.
    - **Rubric:** criterion `weight` is an integer from 1 to 10000 (only ratios matter). `rubric.passThreshold` and `aggregate.weightedScore` are integer hundredths from 0 to 400.
    - **Aggregate counts:** the judgment aggregate replaces `passShare` and `failShare` with `passCount`, `failCount` and `validCount`.
    - **Examples:** 0.667 became 2/3, 0.05 became 500, and weights 0.4/0.4/0.2 became 40/40/20.
  - **Finality (D20):** the read model gains optional, nullable `settledAt` (money moved, irrevocable for the payee) and `finalAt` (no protocol step can change who got what; null until true). Both are unsigned, so no EIP-712 change. A second example shows a final commitment.
  - **Panel seed (ADR-0018):** the rulebook gains `randomness` (`sim`, `drand-quicknet` with a `chainHash`, or `prevrandao`). `Decision` gains an optional `beacon` (`source`, `round`, `value`, and a `signature` unless the source is `sim`), and its `seed` description is per role. The judgment panel gains `seedSource` and `beaconRound`; `seedCommitment` is required only for commit-reveal panels.

- **v0.4 (2026-10-30, ADR-0016):** new `messages.schema.json` with every signed message (Offer, Agree, AdjudicatorAcceptance, FundingAuthorization, EarlyAccept, Decision, AgentRevocation, MemberAdmission, MemberRevocation); examples are `messages.<name>.example.json`. `adjudication.panelCommitment` removed from the commitment terms, so the ID is no longer circular; the commitment carries `adjudicatorAcceptance` outside the ID, and the judgment panel records `seedCommitment`. `commitment-state` splits `state` into `escrowState` and `appealState`. The club rulebook replaces `coverageRatio` with `windowCoverageRatio` and adds `appealFee`. Adjudicators publish `registry` (hash and URI) and `policyHash` instead of `registryVersion`. Events add `adjudicator.accepted`, `member.admitted` and `member.revoked`, and drop `judgment.opened`.

- **v0.3 (2026-10-30, ADR-0006):** `commitment.adjudication.policyHash` is required, binding the primary adjudicator's policy (keccak256 of the RFC 8785 canonical JSON of `adjudicator.policy`). The policy gains `promptTemplateHash`, `appealPromptTemplateHash`, `aggregationVersion` and `screenVersion`. `judgment.panel.policyHash` must equal the commitment's. Each verdict's `promptHash` splits into `promptTemplateHash` and `inputHash`. Every `$id` and `commitment.schemaVersion` moved to 0.3.

- **v0.2 (2026-10-30, ADR-0006):** `commitment.adjudication.registryHash` is required, binding the judge registry the panel is drawn from. Every `$id` and `commitment.schemaVersion` moved to 0.2.
