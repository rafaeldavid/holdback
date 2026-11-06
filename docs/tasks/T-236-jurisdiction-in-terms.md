# T-236: The parties choose the jurisdiction in the terms they sign

- **Lane:** core | api
- **Phase:** 6
- **Depends on:** Phase 2's exit (D53). A research pass, and an ADR with a schema version bump.
- **Paths this task may touch:** `docs/research/` (a new note), `docs/decisions/` (an ADR), `spec/schemas/` and `spec/examples/` (after the ADR), `packages/core`, `apps/operator`, `site/llms.txt`, fixtures, `docs/plan.md` (this row)
- **Human gate:** no for the repository work. Rafa decides the ADR, and the legal points get the company's legal advice.
- **Status:** todo (deferred until after stable EVM operations, D53)
- **Agent/session:** none yet

## Intent

Rafa, 2026-11-06, on the fact sheet's "in the jurisdiction the parties choose": "This is part of contract definition and the product must evolve to address it at some point".

A commitment should say which law governs it and which forum the parties submit to. The signed record of terms, delivery and decision then serves as evidence in that forum (D26: the law stays the backstop). The parties set it as a term, like the price or the deadlines (D31). The protocol records it and checks only that it's well formed. It never decides, enforces or interprets the law.

Non-goals: legal advice, enforcement, identity checks of the parties, and choosing a jurisdiction for anyone.

## Context

- **Today:** the parties name their primary, fallback and appeal adjudicators in the commitment (CLAUDE.md, Objective property 1). No term names a governing law or a forum.
- **The design principles that apply:**
  - D26: the law is the backstop;
  - D28: agreed terms bind;
  - D29: adjudicators may decline clauses they won't run;
  - D31: parametrize, don't restrict;
  - D35: rails, not a record-keeper. The term is information each party chooses to disclose, so it follows the deal's disclosure level (D40, Phase 8).
- **Club rulebooks** may narrow the choice (ADR-0015).

## Acceptance criteria

- [ ] **A research note.** It covers:
  - how governing law and forum are usually expressed in contracts and arbitration clauses: a standard identifier for the law, such as ISO 3166 codes, and the forum or seat;
  - what an adjudicator needs from the term;
  - how a court would read the signed record;
  - which jurisdictions handle electronic signatures by agents.

  It runs as a Fable research pass at max effort, with a recommendation. It also lists the questions for legal advice.
- [ ] **An ADR,** with Status Proposed until Rafa decides. It defines:
  - the term's fields;
  - the default when the term is absent;
  - how clubs narrow it;
  - how an adjudicator declines a jurisdiction it won't serve;
  - where it sits in the public skeleton or the private body.
- [ ] **A schema version bump.** Its examples validate. It refuses only malformed values (D31). Fixtures cover a deal with the term, a deal without it, and an adjudicator that declines it.
- [ ] **`site/llms.txt`** says how an agent sets the term.

## Out of scope

- Enforcing the law, or checking that a party is subject to it.
- KYC and identity.
- Per-jurisdiction rules inside settlement.

## Evidence

Not started.

## Decisions

None yet.

## Handoff

Filed on 2026-11-06 and deferred under D53. Start after Phase 2 exits, with the research note. The ADR and the schema change follow Rafa's decision.
