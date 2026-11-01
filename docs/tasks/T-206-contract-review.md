# T-206: Contract review, then an optional Sepolia deployment (human gate)

- **Lane:** settlement (reviewer role; reviews, does not edit contract code)
- **Phase:** 2
- **Depends on:** T-202, T-203 and T-205 merged; T-204 merged, or its model-to-contract mapping listed as an open item.
- **Paths this task may touch:** `docs/reviews/2026-11-contract-review.md` (new), `docs/neutrality.md` ("How neutrality is tested", the contract review checklist only), `deployments/sepolia.json` (new, only after Rafa approves a deployment), `docs/tasks/T-206-contract-review.md`
- **Human gate:** **yes.** (1) Rafa reads the review before Phase 2 is called done. (2) Any Sepolia deployment needs Rafa's explicit approval written in this file first: test ETH and a test token only, a deployer key from an environment variable, never printed. No mainnet, at any point; a mainnet deployment is a separate gate after an external audit and legal advice (D4).
- **Status:** todo
- **Agent/session:** —

## Intent

Review the Phase 2 contracts against the neutrality checklist, the hold invariants and the ADRs they implement, with two independent reviewers from different model families, so one family's blind spots do not pass unseen. Findings become follow-up tasks for T-202's paths; this task changes no contract code. If Rafa approves, deploy the reviewed bytecode to Sepolia so Phase 5 and T-207's Prividium spike have a public test deployment.

Restate this in your own words in this section before writing code.

## Context

- `docs/neutrality.md` (control-point table, contract review checklist); ADR-0001, ADR-0002, ADR-0003 (and its T-201 outcome), ADR-0012, ADR-0018, ADR-0022, ADR-0023.
- T-202 Decisions, T-203 Evidence (invariants and mutants), T-204 model and its mapping, T-205 differential report and gas.
- `.claude/agents/` reviewer role; `docs/team.md` Rules and checks.

## Acceptance criteria

- [ ] The checklist in `docs/neutrality.md` is expanded into checkable items (no owner, pause, freeze, blacklist, upgrade proxy, `selfdestruct`, mutable `delegatecall`; every timeout callable by anyone; no function moves held funds without a signature, decision or expired timeout; settle-once; key release in the same transaction as capture; expiry margin per ADR-0003) and each item is answered with a file and line or a test name.
- [ ] Static analysis run (for example Slither and Aderyn; tool choice recorded) with every high and medium finding either fixed in a follow-up task or accepted with a reason (measured counts in Evidence).
- [ ] Two reviews from two model families, each run without seeing the other's output, recorded in `docs/reviews/2026-11-contract-review.md` with the model IDs used; disagreements listed.
- [ ] Each finding is labelled measured, inferred or guessed, with severity, and has a follow-up task ID or a written acceptance.
- [ ] The model-to-contract correspondence from T-204 checked: every model action maps to a contract function, or the gap is a finding.
- [ ] Rafa has read the review (recorded here with date). Only then, and only if he approves in writing in this file: a Sepolia deployment whose verified bytecode matches the reviewed commit, addresses in `deployments/sepolia.json`, and one happy-path deal run on Sepolia with its gas recorded (measured).

## Out of scope

- Fixing findings (T-202 follow-ups); an external paid audit; any mainnet action; paymasters (Phase 5).

## Evidence

## Decisions

## Handoff
