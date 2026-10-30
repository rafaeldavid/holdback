# API v0.1 (operator node)

Any operator node serves this API. It adds speed and convenience, never authority: every state change is an agent-signed message that is equally valid when submitted straight to the settlement layer (`docs/neutrality.md`).

## Conventions

- **Format:** JSON over HTTPS. Base path `/v1`.
- **Authentication:** none at the transport layer. Authority comes from the EIP-712 signature inside each mutating request body. Operators may rate-limit by signer address.
- **Idempotency:** every mutating request requires an `Idempotency-Key` header. The same key and body returns the stored response. The same key with a different body returns 409 `idempotency_conflict`.
- **Money:** `{"token": "<id>", "amount": "<base units as decimal string>"}`.
- **Errors:** RFC 9457 `application/problem+json`, with `type` set to one of:
  - signatures and terms: `invalid_signature`, `scope_exceeded`, `mandate_expired`, `nonce_reused`, `rulebook_unknown`, `invalid_terms`, `deadline_passed`;
  - funds and state: `insufficient_funds`, `invalid_state`, `submission_limit_reached`;
  - parties: `adjudicator_unavailable`, `coverage_exceeded`, `adjudicator_affiliated`;
  - deliveries: `mime_not_allowed`, `payload_too_large`;
  - requests: `idempotency_conflict`.
- **Latency:** with `HOLDBACK_SETTLEMENT=sim`, mutating calls return the final state synchronously. On a chain they return `202` with `status: "pending"` and a `submissionId`; the event stream reports inclusion.

## Endpoints

### Registry and test funding

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/v1/clubs` | Club with rulebook (`club.schema.json`), signed by the club operator | Club with `rulebookHash` |
| POST | `/v1/agents` | Agent registration plus mandate (`agent.schema.json`, `mandate.schema.json`) | Agent |
| POST | `/v1/agents/{address}/revoke` | Principal-signed revocation | Agent (`revoked`) |
| POST | `/v1/adjudicators` | Adjudicator registration plus bond deposit | Adjudicator |
| POST | `/v1/test/faucet` | `{address, amount}`; SimChain or testnet only | Balance |

### Commitments

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/v1/commitments` | Offer: terms plus seller signature | `Offered` |
| POST | `/v1/commitments/{id}/agree` | Buyer signature over the terms hash; optional `fund` authorization | `Agreed`, or `Held` if funded |
| POST | `/v1/holds` | One-shot: terms, seller and buyer signatures, funding authorization | `Held` (target p95 ≤ 300 ms on SimChain) |
| POST | `/v1/commitments/{id}/fund` | Funding authorization (ERC-3009 or Permit2 style, buyer-signed) | `Held` |
| POST | `/v1/commitments/{id}/deliveries` | Delivery (`delivery.schema.json`), seller-signed | `Delivered` |
| POST | `/v1/commitments/{id}/accept` | Buyer signature | `Accepted`, then `Released` per mode |
| POST | `/v1/commitments/{id}/appeals` | Appeal (`appeal.schema.json`) plus bond authorization | `Appealed` |
| POST | `/v1/commitments/{id}/triggers/{kind}` | `kind` ∈ `expire-offer`, `reclaim`, `fallback`, `default`, `appeal-expiry`, `settle`; no signature needed | New state |
| GET | `/v1/commitments/{id}` | — | Commitment, current state, balances (`commitment-state.schema.json`) |
| GET | `/v1/commitments/{id}/judgment` | — | Judgment record (`judgment.schema.json`) |
| GET | `/v1/commitments/{id}/receipts` | — | Operator-signed receipts |
| GET | `/v1/commitments/{id}/key` | Buyer-signed request | Content key encrypted to the buyer; available after acceptance only |

### Adjudication

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/v1/adjudicators/{address}` | — | Policy, bond, coverage, registry version, metrics |
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
  "receipt": { "operator": "0xOp…", "eventSeq": 42, "signature": "0x…" }
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
