# ADR-0016: Phase 1 contract fixes

- **Status:** Accepted, 2026-10-30 (D12). Applied in the follow-up PR that moves the schemas to v0.4.
- **Date:** 2026-10-30
- **Raised by:** the Phase 0 readiness review (`docs/reviews/2026-10-30-phase0-readiness.md`), next steps 1 to 3 and the ownership part of step 4. It blocks T-004, T-006, T-007, T-009, T-010 and T-012.

## Context

The readiness review found gaps that would stop Phase 1 tasks partway. They interlock, so this ADR settles them together.

- **Circular commitment ID.** The ID hashes every term, including `adjudication.panelCommitment`, which is `keccak256(seed ‖ commitmentId)`.
- **No adjudicator consent.** The commitment names adjudicators that sign nothing. A party could name an adjudicator that never agreed, or lock a victim adjudicator's bond with sham commitments.
- **Stall before judging.** Only `Judging` leads to `FallbackJudging`. An adjudicator that never opens judging stalls the case.
- **Ambiguous guaranteed-mode states.** Funds move at the decision, yet the diagram keeps a separate `settle` step and a `Final` state.
- **Missing message schemas.** The signed messages have no schemas, though `spec/schemas` is the API contract.
- **Clubs.** They have no membership or revocation, and the rulebook has no appeal fee. The example rulebook contradicts ADR-0007.
- **Registry.** Adjudicators publish an integer `registryVersion`, not the registry hash and location parties need.
- **Endpoints.** `docs/api.md` has no endpoints for acceptance, decisions, adjudicator discovery or club membership.
- **Unowned components.** No task owns the ciphertext store or the envelope encryption the delivery schema requires.

## Decision

### 1. The primary adjudicator accepts before funding

- After the offer, the primary adjudicator signs an **AdjudicatorAcceptance**. It carries:
  - `commitmentId`;
  - `seedCommitment = keccak256(seed)`;
  - the `policyHash` and `registryHash` the adjudicator will judge under;
  - the fee;
  - the bond it reserves.
- The commitment ID hashes the terms only. The panel commitment and the acceptance are outside the ID, which removes the cycle.
- The panel is still a seeded shuffle of `seed ‖ commitmentId`. The seed is revealed in the decision and checked against `seedCommitment`.
- **Funding requires a valid primary acceptance** with enough unencumbered bond. An adjudicator that refuses simply never accepts, and nothing is held. Sham commitments cannot lock a bond the adjudicator never reserved.
- The acceptance's `policyHash` and `registryHash` must equal the commitment's, or funding is refused.
- **The fallback and appeal adjudicators do not sign at agreement.** Their bond is reserved only when they take a case. If either lacks coverage then, the case goes to the default outcome.

### 2. State machine

The commitment's state becomes two parts: the escrow state and the appeal state.

- **Escrow state:**
  - `Offered → Accepted by adjudicator → Agreed → Held → Delivered`;
  - from `Delivered`: `Released`, `Refunded` or `Escalated` by decision;
  - `Delivered → FallbackJudging` once `judgeBy` passes (anyone), whether or not the primary started;
  - `FallbackJudging` decides, or goes to `Defaulted` at `fallbackBy`;
  - `Escalated` is decided by the appeal adjudicator, or goes to `Defaulted` at `appealDecideBy`;
  - `Held → Refunded` by reclaim after `deliverBy`; early acceptance goes from `Delivered` to `Released`.
  - In `guaranteed_on_decision` the decision moves the funds, so there is no separate settle step. `Judging`, `Accepted`, `Rejected` and `Final` are removed as states.
- **Appeal state:** `none → open → upheld | overturned | expired`, defined only after a first-instance decision.
  - An overturn moves bond money, not escrow money.
  - A decision reached through escalation is not appealable.
- `settle_after_window` (Phase 4) adds a `Decided` escrow state that settles when the appeal state closes. Phase 1 types leave it out.

### 3. Signed messages

One new schema file, `messages.schema.json`, defines each EIP-712 message as a variant keyed by `type`. The types:
- `Offer`;
- `Agree`;
- `AdjudicatorAcceptance`;
- `FundingAuthorization` (ERC-3009 shape);
- `EarlyAccept`;
- `Decision`, carrying the seed reveal, the judgment record hash and, on accept, the key for the buyer;
- `AgentRevocation`;
- `MemberAdmission`;
- `MemberRevocation`.

`Delivery` and `Appeal` keep their existing schemas. Triggers need no signature. Every message carries its EIP-712 domain fields, nonce and expiry.

### 4. Settlement-layer checks on every decision

The settlement layer refuses a decision unless:
- its seed is the valid panel seed for the decider's role: the primary reveals the preimage of `seedCommitment`; the fallback and appeal adjudicators use the beacon seed (amended by ADR-0018, D14);
- its `policyHash` and `registryHash` equal the commitment's;
- it is signed by the adjudicator whose turn it is, before that adjudicator's deadline;
- its `deliveryHash` is the posted delivery's (amended by ADR-0029, D44, 2026-11-03): every role judges the body the seller posted, and a party appeal the body the first decision judged. The same holds for an early accept and for a mutual settlement after a delivery.

Panel composition depends on the registry's contents, so the settlement layer does not check it. A wrong panel is an appeal ground, "policy or panel violation", alongside "missing or wrong key".

### 5. Clubs

- A club operator admits a member principal with a signed `MemberAdmission` and removes one with `MemberRevocation`.
- Registering an agent under a club rulebook needs a current admission. The open rulebook needs none.
- Revocation blocks new commitments only (FR-3).
- The rulebook gains `appealFee`, and loses the free `coverageRatio`. Coverage becomes 100% for guaranteed commitments by rule (ADR-0007), with a `windowCoverageRatio` kept for `settle_after_window`.
- The example rulebook allows only `guaranteed_on_decision`, with `maxSubmissions` 1.

### 6. Registry publication

- `adjudicator.schema.json` replaces `registryVersion` with `registry: { hash, uri }`.
- It adds `policyHash`, computed from its policy, so parties can choose and verify both before they sign.

### 7. Endpoints

`docs/api.md` adds these endpoints:
- `POST /v1/commitments/{id}/acceptance`: adjudicator acceptance;
- `POST /v1/commitments/{id}/decisions`: decision by the primary, fallback or appeal adjudicator;
- `GET /v1/adjudicators`: discovery, listing each registered adjudicator's policy hash, registry, bond, open exposure, fee and public quality signals;
- `POST /v1/clubs/{id}/members`;
- `POST /v1/clubs/{id}/members/{principal}/revoke`.

It also adds error types for policy, registry, seed and acceptance mismatches.

### 8. Encryption and storage owners

- **Envelope encryption.** NaCl box (`x25519-xsalsa20poly1305`) through `tweetnacl` for keys. AES-256-GCM through Node's Web Crypto for content. Added to ADR-0011's stack.
- **Ciphertext store.** A local content-addressed store in Phase 1 (files named by SHA-256), behind an interface that any store can implement.
- **Owner.** Both get a new task, T-014 (core lane), after T-004 and before T-006.

### 9. Task rework that follows

- T-012 moves after T-007 and T-009, and gains `fixtures/clubs/` and `fixtures/terms/`.
- T-005 gains `--record`.
- The dependency map in `docs/team.md` changes to match.

Schema version: v0.4.

## Alternatives considered

- **Exclude only `panelCommitment` from the ID and keep the rest as is.** This removes the cycle, but adjudicators still consent to nothing, and the bond-griefing gap stays.
- **Require all three adjudicators to accept at agreement.** Stronger consent, but it adds two signatures to every commitment and reserves bond for adjudicators who will usually never act.
- **Keep one flat state union.** Familiar, but it mixes where the money is with whether an appeal is open, which caused the ambiguity in the first place.
- **Verify panel composition on the settlement layer.** This would need the registry on-chain or a proof of membership. It is heavy for Phase 1, and the appeal ground covers the case.
- **One schema file per message.** More files with the same content. One file with typed variants keeps EIP-712 types and JSON Schemas aligned in one place.

## Consequences

- **The contract grows.** The changes are `messages.schema.json` plus edits to the commitment, club and adjudicator schemas, all at v0.4.
- **Phase 1 gains a step:** acceptance between offer and funding. The demo's beat 1 shows it, so the demo also shows protocol property 1, the parties choosing their adjudicator.
- **T-004's state machine is simpler.** It has fewer states and two explicit parts.
- **The bond model stays a per-adjudicator pool account (`bond:{a}`)** with reservations, which ADR-0014's backers can join without a rework. Deciding D10 before T-006 still sets the pool's internal shape.
- **New fixtures:**
  - `neutrality.adjudicator-never-accepts`: nothing is held;
  - `neutrality.adjudicator-silent-before-judging`: the fallback decides;
  - `error.acceptance-mismatch`;
  - `error.seed-mismatch`;
  - `error.member-not-admitted`;
  - `early-accept-releases-key`.

## Litmus tests

- **Neutrality.**
  - An adjudicator can refuse a case only before any funds are held.
  - Once funds are held, every adjudicator step has a deadline and a timeout anyone can trigger, now including the stall before judging.
  - Club revocation still cannot touch commitments already signed.
- **The hold.** Funding is gated on reserved bond, so guaranteed-mode coverage exists before money moves. Escrow and appeal state are explicit, which makes the settle-once rule checkable.
- **Defended judgment.**
  - The seed, policy and registry are checked on the settlement layer, not only by the adjudicator.
  - Panel composition is enforceable through a bonded appeal ground.
  - Adjudicators publish their registry and policy hashes before parties choose them.

## Amendment: the fallback reserves its bond by deciding (T-206 M-3, 2026-11-03)

§1's "their bond is reserved only when they take a case" now has a precise meaning in the rules contract. A case is taken when the adjudicator decides it, not when someone triggers the takeover. Anyone may trigger `triggerFallback`, and a primary's escalation is the primary's act, so neither reserves a bond the named adjudicator never consented to (PR #135).
- **The fallback.** Its own accept or reject encumbers its bond, held until the appeal closes. An uncovered fallback therefore cannot decide, and the case goes to the default outcome at `fallbackBy`, as §1 says. An escalation moves no money and needs no cover.
- **The appeal adjudicator.** After an escalation or on a party appeal, it reserves nothing. Its decision settles in the same transaction, and no on-chain path pays from its bond before Phase 4. Whether it needs free cover to decide is open (T-212 item 5).
- **Phase 4.** ADR-0007's compensation from a silent fallback's or appeal adjudicator's bond has no reservation to draw on, because a silent adjudicator never consented. Phase 4 needs a consent step for it (backlog).
- **Why.** Before the fix, a sham deal that named any bonded adjudicator, with windows set a century out (D31), could lock that adjudicator's free bond. Found by the T-206 public-audit cross-check.
