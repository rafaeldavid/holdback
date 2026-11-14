# T-415: Decision record: where a mandate's limits are enforced, and revocation

- **Lane:** research
- **Phase:** 2
- **Depends on:** none. It reads ADR-0001, ADR-0002, ADR-0015, ADR-0017, ADR-0024, ADR-0031 and ADR-0033.
- **Paths this task may touch:** one new file under `docs/decisions/`, one entry in `docs/decisions-today.md`, this file
- **Human gate:** no. Nothing leaves the repository; Rafa may overrule the decision.
- **Status:** review (the decision record; nothing is built)
- **Agent/session:** the T-415 session, started 2026-11-14 by the coordinator of that day's wave
- **Kind:** 10, research and decisions (`docs/team.md`, Change recipes)

## Intent

A company signs a mandate for its agent: roles, a cap per deal, a daily cap, categories and an expiry. Enterprise buyers will ask what stops an agent that goes past it, and how to cut an agent off at once. This task answers both in a decision record, with no code:

- say for each of the five scope fields, with file and line, who enforces it today: the contracts, the operators, the counterparty, the adjudicator, or nobody;
- decide where each limit is enforced and what Crow tells a company about it;
- decide the `categories` field: checked, or removed;
- decide the daily cap across operators: one count, or one per operator and said so;
- decide revocation before expiry: where a signed revocation lives, who honours it, what happens to deals already agreed or funded, and how a neutrality fixture shows an operator that hides it;
- say what a richer mandate (roadmap row N116) needs this decision to leave room for.

Inputs: the code on `origin/main`, the ADRs above, and the standards other agent-payment systems use for the same ideas. Outputs: one ADR, marked Proposed, and one entry in `docs/decisions-today.md`, adopted and open to Rafa's overrule. Non-goals: any change to code, schemas, contracts, guides or fixtures; the design of N116.

## Context

- `CLAUDE.md`: the three litmus tests; user choice (ADR-0015); parametrize, don't restrict (D31); the law is the backstop (D26); parties carry responsibility (D32); rails, not a record-keeper (D35).
- Rafa, 2026-11-12: spending limits are a company's to set in its own wallet and tooling; "a funded wallet is a funded wallet".
- `packages/core/src/state.ts` (`scopeAllows`, `agree`, `fund`), `packages/core/src/private.ts` (`verifyDelegation`), `packages/settlement/evm/evm-settlement.ts` (`scopeFor`, `agree`, the join of a deal funded on chain), `contracts/src/HoldbackRules.sol` (`agreeAndFund`, `_requireSigned`).
- `spec/schemas/common.schema.json` (`Scope`), `spec/schemas/mandate.schema.json`, `spec/schemas/messages.schema.json` (`AgentRevocation`, `Delegation`).
- The contracts are frozen for the pilot at the tag `contracts-phase-one-1`.

## Acceptance criteria

- [ ] The ADR states, for each of the five scope fields, where it is enforced today, with file and line, each labelled measured or inferred.
- [ ] The ADR gives one recommendation for each of the five questions, with the options weighed against the three litmus tests.
- [ ] Each recommendation names the fixtures and the schema changes it needs, with the version bump named and not made.
- [ ] The ADR gives the build order and what must not be built before the pilot.
- [ ] The ADR compares the decision with current agent-payment and authorization standards, each with a version or date and a link.
- [ ] `docs/decisions-today.md` has one new entry, adopted and open to Rafa's overrule.
- [ ] One reviewer pass; findings fixed or answered.
- [ ] No file outside this task's paths changes.

## Out of scope

- Any code, schema, contract, guide or fixture change. Each is a follow-up named in the ADR.
- The full design of the richer mandate (N116).
- The `site/` guides: another lane owns them in this wave.

## Evidence

Filled in before review.

## Decisions

The decisions are the ADR's. Choices about this task itself are listed here before review.

## Handoff

Filled in before review.
