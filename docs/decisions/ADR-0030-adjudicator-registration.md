# ADR-0030: Adjudicators register themselves through the API

- **Status:** Proposed, 2026-11-04. Adopted under "autonomy inside the repo" after a Fable max-effort research pass (`docs/research/2026-11-04-adjudicator-registration.md`) and Rafa's answers on T-221 (D46); Rafa may overrule any line. Built in T-221: slice 1 (this ADR, the schema, core's types and EIP-712, the operator route and reads) on branch `t-221-registration-slice-1`; slice 2 (the demo's Durable Object store, the reference adjudicator's fallback trust rule, the anvil end to end) after T-217 and T-219 merge.
- **Date:** 2026-11-04
- **Raised by:** T-221, from T-216 (the first full EVM end-to-end round needs a wrong first decision and a silent adjudicator) and Rafa (2026-11-04): "API should facilitate overturned appeals", then "Yes, plan it".
- **Builds on:** ADR-0005 (operators relay, never author), ADR-0007 (bonded adjudicators), ADR-0014 (the bond pool and `poolTermsHash`), ADR-0020 (privacy), ADR-0023 (the version rule), ADR-0024 §6 (`KeyRegistration`), ADR-0028 (the demo settles on Sepolia), ADR-0029 (domain 0.7); D29, D31, D32, D43, D44, D46.
- **Changes:** `spec/schemas/` (v0.10: `messages.schema.json` `AdjudicatorRegistration`, `adjudicator.schema.json` the `registration` envelope, every `$id`), `spec/openapi/paths.json` and `spec/openapi.json`, `packages/core` (`eip712.ts`, `types.ts`), `apps/operator` (`registrations.ts`, `registry.ts`, `server.ts`, `prepare.ts`, `sim-world.ts`), `examples/verify.ts` (`TYPES`), `docs/api.md`, `docs/neutrality.md`. Slice 2: `apps/demo-cloud/src/world.ts` and `telemetry.ts`, `apps/adjudicator/src/service.ts`.
- **Amends:** ADR-0024 §6: `AdjudicatorRegistration` carries the encryption key, so `KeyRegistration` is deprecated and its planned `/keys` route is withdrawn. ADR-0007's planned route: the bond is deposited on chain by the adjudicator, not through the route.

Labels: **measured** (a test or tool run), **inferred** (from reading the code), **guessed** (a judgement not checked).

## Context

- **Only Crow's adjudicators can be named today.** `POST /v1/adjudicators` answers 501 (`spec/openapi/paths.json`, `x-holdback-planned`), and `prepare/offer` and `/recipients` need a registration for every role, which only the demo's three have (`apps/operator/src/prepare.ts`, `apps/demo-cloud/src/world.ts`) [measured by the research pass]. So the protocol's first property, that any two agents choose their own adjudicator, holds on paper only.
- **Everything after registration already works for any address the terms name:** the acceptance and decision routes, the envelope read and the timeout triggers (research §3) [inferred]. Fallback and appeal decisions on Sepolia wait for T-217's drand proofs.
- **Served registrations carry no signature.** A reader can recompute `policyHash`, but nothing proves the adjudicator, rather than the operator, wrote the policy, the registry hash, the fee or the key (ADR-0024 names the false-key risk) [inferred].
- **The bond lives on chain.** `HoldbackBonds.deposit` credits `msg.sender`; the primary's bond is encumbered at funding, the fallback's when it decides, the appeal adjudicator's never (L-5) [measured by the research pass].

## Decision

### 1. The message

A new EIP-712 primary type, signed by the adjudicator's own address under the Holdback domain of the chain it serves:

```
AdjudicatorRegistration(address adjudicator,string encryptionPublicKey,string keyId,bytes32 policyHash,bytes32 registryHash,TokenAmount fee,bytes32 poolTermsHash,bytes32 bodyHash,uint64 issuedAt,bytes32 nonce,uint64 expiresAt)TokenAmount(string token,uint256 amount)
```

- **The clear fields** are what a verifier needs without the body: the address every later acceptance and decision is checked against, the encryption key sellers seal to (`keyId` names it, for rotation), the hashes a commitment binds (`policyHash`, `registryHash`), the minimum fee, and `poolTermsHash`, which a backer's deposit will bind (ADR-0014).
- **`bodyHash`** is keccak256 of the RFC 8785 JSON of the registered record: every field of `adjudicator.schema.json` the adjudicator writes, with `pool` holding only `terms`, and without `registration`. It binds everything else the record says (`name`, `affiliations`, `policy`, `registry.uri`, `metrics`, `status`), and any field a later additive version adds. It is the same pattern as the terms' `deliverableHash` (ADR-0024 §2).
- **`issuedAt`** orders one address's registrations: an operator serves the latest and refuses an older one. `nonce` and `expiresAt` are as in every other message.
- **Time** is uint64 Unix seconds, like every stamp; the fee is base units.

The JSON form is the flat message in `messages.schema.json` (as `KeyRegistration` is). The served record carries the envelope `registration: {keyId, bodyHash, issuedAt, nonce, expiresAt, signature}` beside the record's own fields (`adjudicator.schema.json`), so a reader rebuilds the message from the record alone: `adjudicator` is `address`, `fee` is `fee.min`, `registryHash` is `registry.hash`. The envelope is optional in the schema, so an unsigned record (a SimChain genesis record, or a node that has not moved to registrations yet) still validates.

**The domain stays 0.7.** A new type changes no existing struct (ADR-0023's rule; ADR-0024 added three types at 0.6). The schema moves to 0.10, additively.

**`KeyRegistration` is deprecated** (Rafa's answer 1: one message carries the key). It stays in the 0.10 schema so nothing published breaks, no route takes it, and the next breaking version removes it. The planned `POST /v1/adjudicators/{address}/keys` is withdrawn: rotating a key is a new registration with a new `keyId`. The adjudicator keeps old secrets until its open deals are final (ADR-0024 §6, unchanged).

The TypeScript record type keeps its name `AdjudicatorRegistration` for now, because the reference adjudicator and the demo world use it and are being changed by other tasks; the message type is `AdjudicatorRegistrationMessage`. A rename is an implementation detail for a later change.

### 2. The route, and what an operator verifies

`POST /v1/adjudicators` with an `Idempotency-Key` takes the registered record with its envelope: the record as `GET /v1/adjudicators/{address}` serves it, without the pool balances (`pool` holds `terms` only). The operator:

1. validates the record against `adjudicator.schema.json` and the rebuilt message against `messages.schema.json` (its signed timestamps, nonce and signature shape);
2. checks that `encryptionPublicKey` decodes to a 32-byte x25519 key;
3. recomputes `policyHash` from `policy`, `poolTermsHash` from `pool.terms` and `bodyHash` from the record;
4. recovers the signature to `address` under its own domain (chain and rules contract);
5. checks `expiresAt` is later than settlement-layer time and `issuedAt` is earlier than `expiresAt`;
6. checks `issuedAt` is later than the registration it serves for that address, unless the post is that same registration again (same signature), which it answers with the served record unchanged;
7. stores it as the one registration for that address and answers the served record.

It refuses only what is malformed, unsigned, out of order or self-contradictory:

| Refusal | Answer |
| --- | --- |
| A body that fails a schema, a key that is not 32 bytes, a pool with balances, a hash that does not recompute, an `issuedAt` not before `expiresAt` | 400 `invalid_terms`, naming the field |
| A signature that does not recover to `address` under this node's domain | 401 `invalid_signature` |
| An expired registration | 409 `deadline_passed` |
| An `issuedAt` not later than the served one | 409 `invalid_state`, naming the served `issuedAt` |
| A body over 1 MiB; no `Idempotency-Key` | 413 `payload_too_large`; 400 `invalid_terms` |

**It never refuses** a fee level (a fee of `0` is fine), a policy value the schema admits, a registry hash it has never seen, a `registry.uri` it cannot fetch, an address with no bond, a `status` of `suspended`, or untrusted text it doubts (D31). The schema's minimums (`panelSize` at least 3, `minFamilies` at least 2, supermajorities above one half) are litmus test 3's mandatory rules, so they stay schema refusals.

The route is a write: it is counted against the client's write budget at entry, and a stored registration moves that count to the adjudicator's own bucket, as a relayed message does.

### 3. Where registrations live, and the reads

**Operators hold them** and serve them with the signature; nothing is on chain in this ADR. Each operator stores what is posted to it and verifies it for itself; an adjudicator posts to every operator it wants to be found at. The served signature means a reader never trusts the operator that served it (research §1). An on-chain anchor (an ERC-6538-style registry or Holdback's own, ownerless) stays in the backlog.

**One registration per address**, replaced by a later one. **A registration is never removed** (Rafa's answer 3: "don't remove but be transparent alongside other metrics"). An expired registration stays listed, marked expired. Storage then grows by one row per distinct address, bounded by the write throttle; the demo counts the rows in telemetry (slice 2), and a backlog row covers what to do when the count matters.

**`GET /v1/adjudicators`** lists every adjudicator this node knows, oldest registration first, then any bonded adjudicator that never registered. `GET /v1/adjudicators/{address}` serves one. Each served registration has:

- the record with its `registration` envelope (the adjudicator's, signed);
- `pool`'s `junior`, `senior` and `reserved`, and the same numbers as `bond`, read from the settlement layer at read time (on Sepolia, `HoldbackBonds.bondOf` and `freeOf`, cached per block);
- `observed`, what this node saw, unsigned: `registeredAt` (when it first stored a registration for the address), `lastUsedAt` (the last acceptance or decision it relayed or indexed from that adjudicator, or `null`), `expired`, `bond` (`"none"` when the pool holds nothing, else `"bonded"`), and `defaultFor` (the roles this node fills with this adjudicator when an offer names none).

`prepare/offer`, `/recipients` and the reference adjudicator's `registration()` port read the store. The demo's three adjudicators register through the same path when the world opens, so every served registration is signed (Rafa's answer 2).

### 4. Crow's adjudicators are the defaults; others are advanced use

Rafa: "crow's adjudicators are default and custom selection is advanced usage of protocol (outside of recommendation by crow etc.)".

- `prepare/offer` fills each role the agent leaves out with this node's default adjudicator for that role, and says so in `defaults` and `check`. Discovery names them as `defaultAdjudicators`, and each served registration says `defaultFor`.
- A node with no defaults (a plain SimChain test world) still needs all three named.
- `llms.txt` presents naming other adjudicators as advanced use of the protocol, which Crow neither recommends nor vouches for. The text is in T-221's Handoff for T-220.

### 5. Bonds, shown plainly, with a warning and one refusal

- **No bond is listed like any other registration**, with `pool` at zero and `observed.bond: "none"` (Rafa's answer 6).
- **A warning, advisory only.** `prepare/offer`, and an offer or hold this node relays, carry a notice for each named adjudicator whose free bond (`junior + senior - reserved` in the price token) is zero or less than the price. The parties may still choose it (D31).
- **One refusal at the operator.** In `guaranteed_on_decision`, an overturned decision pays the price from the decider's bond (D43). The fallback decides with a bond it reserves only then (M-3), so terms that name a fallback whose free bond is below the price cannot pay that clause. This node's `prepare/offer`, and its relay of an offer, a hold or an agreement, refuse such terms with 400 `invalid_terms`, saying why. The primary is already refused at acceptance and at funding; the appeal adjudicator's bond pays no clause today (L-5), so no rule reaches it.
- **The direct path stays open.** The settlement layer, other operators and direct submission take the same signed terms. So the refusal is a service rule of this node, never a neutrality break: an operator may refuse anything, provided a refusal cannot stop a valid commitment.
- **This is an exception to D31 and D32**, recorded as Rafa's rule: a bondless fallback is neither malformed nor unprocessable.
- **It is a read with no lock.** It cannot promise the fallback still has its bond at takeover; an unbonded fallback simply cannot decide on chain, and the deal goes to its default outcome.
- **The protocol-level half comes later,** in core and the contract in one change, with the next contract redeploy (T-212 item 5, the backlog row "The protocol refuses a selection the terms cannot pay"), after its own research pass. Core cannot go first: the EVM adapter throws when core refuses a step the contract accepted.

### 6. The fallback trust rule (slice 2)

Once outsiders can be primaries, a Crow adjudicator named as fallback would decide under an outsider's appeal adjudicator, encumbering its own bond, and that appeal adjudicator could slash it: a second path to D44's attack. The reference adjudicator takes a fallback task only when the deal's appeal adjudicator is in its trusted set, and otherwise declines with `invalid_terms` and a reason in `notices`. As appeal adjudicator it serves any deal. The named test is `attack.untrusted-appeal-adjudicator-via-fallback`. It lands in `apps/adjudicator/src/service.ts` after T-217 merges.

### 7. What a reader checks

Before naming an adjudicator, a party reads its registration from at least two operators and:

1. rebuilds the `AdjudicatorRegistration` message from the record and recovers the signature to `address` under its own pinned domain;
2. recomputes `policyHash`, `poolTermsHash` and `bodyHash`;
3. reads the bond from `HoldbackBonds` itself (`bondOf`, `freeOf`); `pool` in the answer is the operator's copy of the same reads.

What the API cannot check is how an outside adjudicator judges: the policy and registry are promises the terms bind by hash, the appeal adjudicator the parties chose checks the decision against the terms, and an overturn pays the price from the first decider's bond (research §5). An appeal adjudicator's decision is final and its bond is not yet at stake on chain (L-5).

## Litmus tests

1. **Neutrality.** Passes. The operator gains no authority: it stores and serves a document the adjudicator signed, which any reader verifies without trusting it, and it can neither author nor alter one (`docs/neutrality.md`, the operator row). A node that refuses to store a registration stops nothing: the seller builds its terms client-side, takes the key from the adjudicator, and submits to another operator or the settlement layer, whose write path checks no registration. The fallback bond refusal is a relay refusal with the direct path open, shown by a test (`apps/operator`, "the direct path stays open"). Property 1 becomes true on the demo: any address can be named.
2. **The hold.** Unchanged. The bond rules are the settlement layer's; no registration moves or locks funds.
3. **Defended judgment.** Unchanged on chain: deciders are still the addresses the terms name, under the bound policy and registry hashes. The schema's panel minimums are refused at registration. The fallback trust rule (§6) closes the new path to D44's attack before outside primaries reach the live demo.

## Consequences

- An agent can run its own adjudicator end to end through the public API; T-216 uses that for its overturned appeal and its silent adjudicator.
- Agents sign `AdjudicatorAcceptance` and `Decision` typed data themselves (no prepare helper); `examples/verify.ts` pins those types so `llms.txt` can publish them.
- Registrations accumulate; their count is visible in telemetry, and the backlog holds the policy for when it matters.
- Two operators of one world share a store when they are one operator (the sim and the demo); independent operators each hold their own.

## Alternatives considered

- **A labelled test adjudicator inside the demo** (research option b): a demo-only control surface that tests nothing an outside agent can do. Rejected by Rafa for round 1.
- **An on-chain registry now** (option c): a deploy and gas per registration for no round-1 gain. Later.
- **Reuse `KeyRegistration` and post the rest unsigned:** the operator would author the policy, registry and fee. Rejected.
- **Widen `KeyRegistration`:** nothing signs it yet, but it is published in schema 0.9 and its name would mislead. Rejected.
- **Drop registrations at expiry after a retention period** (the research's §6): Rafa chose never to remove them.
