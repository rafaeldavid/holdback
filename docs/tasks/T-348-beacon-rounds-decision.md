# T-348: the decision record for the beacon rounds (escalation and fallback)

- **Lane:** research (change kind 10, research and decisions)
- **Phase:** 2
- **Depends on:** T-343 (the drand verifier's review, finding X-1), T-342 (ADR-0031, the phase-one scope), T-340 (the state model, finding F-2)
- **Paths this task may touch:** one new ADR under `docs/decisions/`; new lines in `docs/decisions-today.md`; this file
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** a Claude Fable 5.2 session started by the coordinator, 2026-11-11

## Intent

The contract refinement plan (kept privately, `docs/private-materials.md`) fixes finding X-1 in its package R8 and asks for a decision record first. X-1 is the Medium finding of the drand verifier's review (`docs/reviews/2026-11-11-drand-verifier-review.md`, §10): the panel for an escalation takes its seed from the first drand round after the escalation's block time, and drand publishes that round 1 s after a mainnet block's timestamp. Whoever lands the escalation in a block built that late can know the panel's seed first.

This task writes that record. It decides three things together, because each moves the others:

1. which drand round seeds the panel for an escalation;
2. which round seeds the fallback adjudicator's panel (item 1 of the private hardening task T-225);
3. the smallest escalation window that can be decided, and how a shorter window is handled under D31 (the protocol does not restrict values the parties can set).

The output is one ADR with status Proposed and one D-number entry that points at it. The task changes no code, no schema and no audit doc. It does not choose the chain Crow settles on: where the rule depends on the chain, the ADR gives it per chain.

## Context

- `docs/reviews/2026-11-11-drand-verifier-review.md`: finding X-1 and the mainnet-gate lines G-1 to G-10.
- `contracts/src/HoldbackRules.sol:250-300` at `b58bb69`: the round selection in `decide`.
- `contracts/test/crosscheck/DrandRedTeam.t.sol:642-711`: the three tests named `test_issue_wrongRound_…`.
- ADR-0018 (the panel seed beacon), ADR-0006 (defended judgment), ADR-0031 (the phase-one scope).
- `docs/audit/state-model.md` (finding F-2, section 6.3) and `docs/audit/threat-model.md` (assumption TA-2).
- `docs/tasks/T-217-drand-proofs-sepolia.md`.

## Acceptance criteria

- [ ] The ADR names the rule the contract enforces in package R8, exactly enough that an implementer can write it, and says how each of the three `test_issue_wrongRound_…` tests changes so that it fails before the fix and passes after.
- [ ] It compares the chosen rule with at least two alternatives, and states for each what an attacker who controls transaction timing, or a block builder, can still do.
- [ ] It settles the fallback's round.
- [ ] It states the smallest decidable escalation window as a formula over the margin, the block time and the beacon's period, with the number for Sepolia and for Ethereum mainnet, and adds no refusal.
- [ ] Every number names its source: drand's published chain info, the consensus specifications, or measured block headers. A claim whose source could not be read is marked unverified.
- [ ] It says what stays possible for a block builder and why that is accepted or not, lists what a testnet cannot show, and gives the lines the mainnet gate needs.
- [ ] One `red-teamer` pass attacks the chosen rule without this task's reasoning; the ADR answers each finding.
- [ ] `docs/decisions-today.md` gains one entry with the next D-number.

## Out of scope

- Any change to `contracts/`, `formal/`, `docs/audit/`, `spec/` or `packages/`.
- The choice of chain.
- The other items of T-225 (relay outages, answer size, SimChain with a drand club).

## Evidence

## Decisions

## Handoff
