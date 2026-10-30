# Phase 0 readiness review

Date: October 30, 2026. Requested by Rafa: check that Phase 0 leaves clear next steps, that the protocol architecture is sound, and that the components the Phase 1 prototype needs are specified or available. One read-only reviewer swept the docs, schemas, tasks and repository tree. The coordinator reran the evidence for every finding marked measured.

## Verdict

The architecture holds against the three protocol properties, with one property (open bonding) still only proposed. Phase 1 cannot start cleanly yet: six gaps in the contract and the task files would stop T-004, T-006, T-007, T-009, T-010 or T-012 partway.

## Blocks Phase 1

| # | Finding | Evidence | Label |
| --- | --- | --- | --- |
| 1 | The commitment ID is circular: it hashes every term, including `adjudication.panelCommitment`, which is `keccak256(seed ‖ commitmentId)` | `commitment.schema.json` descriptions of `id` and `panelCommitment` | Measured |
| 2 | An adjudicator that never opens judging stalls the case: `Delivered → Judging` is the only adjudicator edge, and only `Judging` leads to `FallbackJudging` | `docs/architecture.md` state diagram | Measured |
| 3 | The signed messages have no schemas: offer, agree, funding authorization, decision, early acceptance, revocation, panel commitment and seed reveal | `ls spec/schemas` lists 12 files, none for these | Measured |
| 4 | Clubs have no membership or revocation in the schema, which demo beat 7 and `neutrality.club-revokes-mid-flight` need; the rulebook has no `appealFee` | `club.schema.json` | Measured |
| 5 | Adjudicators publish only an integer `registryVersion`, so parties cannot choose or verify the registry a commitment binds | `adjudicator.schema.json` | Measured |
| 6 | `docs/api.md` has no endpoints for decisions, panel commitments, opening judgment, adjudicator discovery or club membership | `docs/api.md` | Measured |
| 7 | T-012 must produce the club rulebook and terms but may not write `fixtures/clubs` or `fixtures/terms`; it also needs `policyHash`, `registryHash` and the SDK, so it cannot follow T-004 alone | Task files T-010, T-012 | Measured |
| 8 | No task owns the ciphertext store or the `x25519-xsalsa20poly1305` encryption the delivery schema requires; ADR-0011 names no library | `delivery.schema.json`, ADR-0011 | Measured |
| 9 | The club example still allows `settle_after_window`, a 20% coverage ratio and two submissions, against ADR-0007 | `spec/examples/club.example.json` | Measured |
| 10 | Guaranteed-mode state semantics are ambiguous: funds move at the decision, yet the diagram keeps `Accepted → Released: settle` and does not say what an overturn does to escrow state | `docs/architecture.md` | Inferred |

## Blocks a later phase

- Open bonding (property 2) exists only in ADR-0014 (D10 open). Today the bond is one number per adjudicator. Deciding D10 before T-006 avoids reworking the bond data model.
- Registry, policy and seed bindings are enforced only by the adjudicator itself. Either the settlement layer checks them in the decision, or "policy or panel violation" becomes an appeal ground.
- An adjudicator named in a commitment signs nothing at agreement, so a party could name a victim adjudicator and lock its bond with sham commitments (inferred).
- No operator discovery, and no stated way operators and relayers get paid (inferred).

## Fixed in this change

Phase 0 tasks marked done and ticked in `docs/plan.md`; the dry run attributed to T-013 instead of T-012 in three docs; the stale "decisions may change this document" line in `docs/architecture.md`; schema version in the daily log.

## Next steps

1. Write ADR-0016 for the Phase 1 contract gaps: a seed commitment outside the commitment ID, message schemas, club membership and revocation, an adjudicator registry hash and URI, `appealFee`; schema v0.4.
2. Fix the state machine: a timeout from `Delivered` to fallback judging, and explicit guaranteed-mode settlement and overturn states.
3. Add the missing endpoints to `docs/api.md`: decisions, panel commitments, opening judgment, adjudicator discovery, club membership.
4. Rework Phase 1 task files: T-012 after T-007 and T-009 with ownership of `fixtures/clubs` and `fixtures/terms`; an owner for the content store and encryption; `--record` in T-005; fix the club example.
5. Decide D10 (bond pool shape) before T-006 starts; D11 can wait.
6. Start Phase 1 with T-004 and T-005 alone, as `prompts/phase-1-demo.md` says.
