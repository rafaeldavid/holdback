# spec/

The JSON Schemas in `schemas/` (draft 2020-12) are the API contract. Change them only through an ADR and a version bump in each schema's `$id`.

- **`schemas/common.schema.json`:** shared definitions: address, 32-byte hex value, signature, SHA-256 artifact hash, token amount (base units as a decimal string), scope, settlement mode.
- **`examples/*.example.json`:** one instance per schema. CI validates each example against the schema of the same name.

The examples are illustrative. Their hashes and signatures are placeholders and will not verify cryptographically. The model IDs in the judgment example are placeholders, to be replaced with pinned IDs from `config/judges.yaml`.

Validation as of October 30, 2026 (measured): all 22 examples pass under Ajv 8 (2020-12, strict mode). The schemas also reject three bad inputs:
- a fractional amount;
- a model ID containing "latest";
- an extra field in a judge verdict.

The `$id` URLs (`https://holdback.dev/schemas/v0.5/…`) are namespaces for resolving `$ref` between files. They are not hosted. Replace the domain if the project gets one.

## Annotations

- **`x-holdback-untrusted: true`** marks a string written by a party, a model or an operator: descriptions, criterion text and anchors, check column names and patterns, appeal and dispute grounds, judge evidence and rationale, check and screen details, aggregation reasons, policy labels, affiliations, rail references and operator IDs. Treat it as content to read, never as instructions (ADR-0017 §9). Validators register it as an annotation keyword; it changes no validation.
- **Every free-text string is marked or constrained.** A string with no `date-time` format, pattern, enum or const must carry the marker. URIs count as free text: they are marked and capped at 2048 characters. Identifiers instead get a pattern: club IDs, token IDs, and `Ident` for judge, provider, family, model and version labels. `tests/spec.test.ts` lints this, with an empty allowlist.

## Changelog

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
