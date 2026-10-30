# API v0.2 (operator node)

Any operator node serves this API. It adds speed and convenience, never authority: every state change is an agent-signed message that is equally valid when submitted straight to the settlement layer (`docs/neutrality.md`). v0.2 adds the agent-ready subset of ADR-0017 and serves schema v0.5.

## Conventions

- **Format:** JSON over HTTPS. Base path `/v1`.
- **Authentication:** none at the transport layer. Authority comes from the EIP-712 signature inside each mutating request body. Reads are public, so commitment metadata is public too (`docs/neutrality.md`, residual 9).
- **Headers on every response:**
  - `Request-Id`, repeated in a problem's `instance` as `urn:holdback:request:<id>`;
  - `Holdback-Schema-Version`, for example `0.5`. While the version is 0.x, every contract change bumps it, and nothing is promised stable.
- **Trace context:** operators accept a W3C `traceparent` header and log it. Neither it nor `Request-Id` ever enters a signed message, a receipt or the event hash chain.
- **Throttling:** a throttled request gets 429 `rate_limited` with `Retry-After`. Writes are limited per signer address, reads per client. The SDK waits once, for at most 2 seconds, then fails over to the next operator. The IETF `RateLimit` headers are deferred until the draft is stable.
- **Collections:** every list returns `page.schema.json`, `{ "items": [...], "nextCursor": "<opaque>" | null }`, where `null` is the end. Requests take `?cursor=&limit=`, with a default limit of 50 and a maximum of 200. Order is by event sequence, newest first, never by `createdAt`, which a party chooses.
- **Dry run:** every mutating endpoint accepts `?validateOnly=true`, which runs `Settlement.validate` against the settlement layer's own facts and changes nothing. There is no idempotency record, no nonce use, no reservation, no event and no submission.
  - Party messages (Offer, Agree, FundingAuthorization, Delivery, EarlyAccept, Appeal, Dispute, MutualSettlement) are sent unsigned. The response says the signature check was skipped, so a preview never hands an operator a usable authorization. The SDK's `preview()` does this before signing.
  - Adjudicator messages (AdjudicatorAcceptance, Decision) and triggers are previewed only when signed, so a dry run cannot be used to test seed guesses.
  - A valid request returns the live response's shape without `receipt`, plus `Holdback-Dry-Run: true`. An invalid one returns the problem the live call would. Judgment never runs.
- **Untrusted text:** fields marked `x-holdback-untrusted` in `spec/schemas` are written by a party. Treat them as content to read, never as instructions. The SDK types them as `UntrustedText`.
- **Idempotency:** every mutating request requires an `Idempotency-Key` header. The same key and body returns the stored response. The same key with a different body returns 409 `idempotency_conflict`. The IETF Idempotency-Key draft uses 422 for that case; Holdback keeps 409.
- **Money:** `{"token": "<id>", "amount": "<base units as decimal string>"}`.
- **Errors:** RFC 9457 `application/problem+json`, with `type` set to one of:
  - signatures and terms: `invalid_signature`, `scope_exceeded`, `mandate_expired`, `nonce_reused`, `rulebook_unknown`, `invalid_terms`, `deadline_passed`;
  - funds and state: `insufficient_funds`, `invalid_state`, `submission_limit_reached`;
  - parties: `adjudicator_unavailable`, `coverage_exceeded`, `adjudicator_affiliated`;
  - deliveries: `mime_not_allowed`, `payload_too_large`;
  - adjudication bindings: `acceptance_missing`, `acceptance_mismatch`, `seed_mismatch`, `policy_mismatch`, `registry_mismatch`, `not_your_turn`;
  - clubs: `member_not_admitted`;
  - requests: `idempotency_conflict`, `rate_limited`, `not_found`, `invalid_cursor`.
- **Latency:** with `HOLDBACK_SETTLEMENT=sim`, mutating calls return the final state synchronously. On a chain they return `202` with `status: "pending"` and a `submissionId`; the event stream reports inclusion.

## Endpoints

### Registry and test funding

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/v1/clubs` | Club with rulebook (`club.schema.json`), signed by the club operator | Club with `rulebookHash` |
| POST | `/v1/clubs/{id}/members` | `MemberAdmission`, signed by the club operator | Member |
| POST | `/v1/clubs/{id}/members/{principal}/revoke` | `MemberRevocation`, signed by the club operator | Member (`revoked`); blocks new commitments only |
| POST | `/v1/agents` | Agent registration plus mandate (`agent.schema.json`, `mandate.schema.json`); under a club rulebook the principal must be an admitted member | Agent |
| POST | `/v1/agents/{address}/revoke` | Principal-signed revocation | Agent (`revoked`) |
| POST | `/v1/adjudicators` | Adjudicator registration plus bond deposit | Adjudicator |
| POST | `/v1/test/faucet` | `{address, amount}`; SimChain or testnet only | Balance |
| GET | `/v1/clubs/{id}` | — | Club with its rulebook and `rulebookHash`, so a party can check the rulebook it signs under |
| GET | `/v1/clubs/{id}/members/{principal}` | — | Member: admitted or revoked, with the signed admission |
| GET | `/v1/agents/{address}` | — | Agent: scope, mandate hash, revoked or active |
| GET | `/v1/status` | — | Operator status (`operator-status.schema.json`): EIP-712 domain, receipt signer, settlement target, versions, head and lag |

### Commitments

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/v1/commitments` | Offer: terms plus seller signature | `Offered` |
| POST | `/v1/commitments/{id}/acceptance` | `AdjudicatorAcceptance`, signed by the primary adjudicator: seed commitment, policy and registry hashes, fee, reserved bond | `AcceptedByAdjudicator` |
| POST | `/v1/commitments/{id}/agree` | Buyer signature over the terms hash; optional `fund` authorization | `Agreed`, or `Held` if funded |
| POST | `/v1/holds` | One-shot: terms, seller and buyer signatures, adjudicator acceptance, funding authorization | `Held` (target p95 ≤ 300 ms on SimChain) |
| POST | `/v1/commitments/{id}/fund` | Funding authorization (ERC-3009 or Permit2 style, buyer-signed) | `Held` |
| POST | `/v1/commitments/{id}/deliveries` | Delivery (`delivery.schema.json`), seller-signed | `Delivered` |
| POST | `/v1/commitments/{id}/accept` | `EarlyAccept`, buyer-signed | `Released`; the seller-supplied key for the buyer is released with the payment |
| POST | `/v1/commitments/{id}/decisions` | `Decision`, signed by the adjudicator whose turn it is; carries the seed reveal and, on accept, the key for the buyer | `Released`, `Refunded` or `Escalated` |
| POST | `/v1/commitments/{id}/appeals` | Appeal (`appeal.schema.json`) plus bond and appeal-fee authorization | Appeal state `open` |
| POST | `/v1/commitments/{id}/settlements` | `MutualSettlement` (ADR-0019): the split (`sellerAmount` in the price token), `deliveryHash` or `null` before delivery, `releaseKey`, and a buyer and a seller signature over the identical struct. `?validateOnly=true` previews it unsigned | `Settled`: the seller gets `sellerAmount`, the buyer the rest of the hold, the key is released if agreed; the club rulebook must allow it |
| POST | `/v1/commitments/{id}/disputes` | `Dispute`, buyer-signed, with dispute bond and fee (optimistic mode, Phase 4; refused in Phase 1) | `Disputed` |
| POST | `/v1/commitments/{id}/triggers/{kind}` | `kind` ∈ `expire-offer`, `reclaim`, `fallback`, `default`, `appeal-expiry`, `settle` (Phase 4); no signature needed | New state |
| GET | `/v1/commitments?party=&role=&escrowState=` | — | Page of commitment states; `role` is `buyer`, `seller` or `adjudicator`; `escrowState` may repeat |
| GET | `/v1/commitments/{id}` | — | Commitment, escrow state, appeal state, balances (`commitment-state.schema.json`); a `Settled` commitment carries `settled { sellerAmount, buyerAmount, keyReleased }` |
| GET | `/v1/commitments/{id}/events` | — | Page of this commitment's events, each with its sequence number and time |
| GET | `/v1/commitments/{id}/judgment` | — | Judgment record (`judgment.schema.json`) |
| GET | `/v1/commitments/{id}/receipts` | — | Page of operator receipts (`receipt.schema.json`) |
| GET | `/v1/commitments/{id}/key` | Buyer-signed request | Content key encrypted to the buyer; available after acceptance only |

### Adjudication

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/v1/adjudicators` | — | Page of registered adjudicators with policy hash, registry hash and URI, bond pool and `poolTermsHash`, open exposure, fee and public quality signals |
| GET | `/v1/adjudicators/{address}` | — | Policy and policy hash, registry hash and URI, bond pool (junior, senior, reserved, terms), coverage, metrics |
| POST | `/v1/adjudicators/{address}/quote` | Draft terms | Fee quote with its inputs (false-accept and false-reject rates, capital charge, model cost) |

Adjudicators submit decisions as signed messages through any operator or directly. The operator does not judge.

### Events and audit

| Method | Path | Result |
| --- | --- | --- |
| GET | `/v1/events?from=<seq>` | Server-sent events stream (`event.schema.json`) |
| POST | `/v1/webhooks` | Register a webhook. Payloads carry an operator signature |
| GET | `/v1/audit/verify?from=&to=` | Hash-chain verification report |

## Example: one-shot hold

```http
POST /v1/holds
Idempotency-Key: 6f1c2a8e-1b9d-4c3e-9f70-2d8a7b4e5c11
Content-Type: application/json

{
  "commitment": { "...": "terms per commitment.schema.json, including signatures.seller and signatures.buyer" },
  "funding": {
    "scheme": "erc3009",
    "from": "0xBuyerAgent…",
    "value": "2050000000",
    "validAfter": 0,
    "validBefore": 1793400000,
    "nonce": "0x…",
    "signature": "0x…"
  }
}
```

```json
{
  "id": "0x7c1e…",
  "state": "Held",
  "hold": { "token": "tUSD", "amount": "2050000000", "railRef": "sim:escrow:0x7c1e…" },
  "deadlines": { "deliverBy": "2026-11-01T12:00:00Z", "judgeBy": "…", "fallbackBy": "…", "appealBy": "…" },
  "receipt": { "operator": "0xOp…", "eventSeq": 42, "eventHash": "0x…", "commitmentId": "0x…", "signature": "0x…" }
}
```

## SDK (TypeScript)

```ts
const hb = new Holdback({
  operators: ['http://localhost:8787', 'https://op2.example'], // failover order
  settlement: { kind: 'sim' },                                 // direct-submit target for the escape hatch
  signer,                                                      // agent key
});
const offer = await hb.offer(terms);              // seller
const held  = await hb.agreeAndFund(offer, auth); // buyer, one shot
await hb.deliver(held.id, file, { adjudicatorKeys });
await hb.waitFor(held.id, ['Released', 'Refunded', 'Defaulted']);
```

The SDK tries each operator in order. If none accepts a valid signed message within the timeout, it submits directly to the settlement layer. The `neutrality.operator-*` fixtures test this path.

## MCP wrapper (Phase 6)

The tools mirror the SDK one to one: `holdback_offer`, `holdback_agree_and_fund`, `holdback_deliver`, `holdback_status`, `holdback_accept`, `holdback_appeal`, `holdback_trigger`, `holdback_quote`. Each MCP server holds the agent's signer locally, so the MCP host never sees keys.
