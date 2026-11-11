# T-340: The contract state model, the signed-field register and the threat model

- **Lane:** research
- **Phase:** 2
- **Depends on:** none. T-341 (the state oracle in the contract tests) builds on the state table this task writes.
- **Paths this task may touch:** `docs/audit/state-model.md`, `docs/audit/threat-model.md` (both new), this task file
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** t-340-contract-state-model (Fable 5.2), change kind 10 (research and decisions) with docs: no code change, no local checks, a target of 200k tokens

## Intent

The contracts hold money, and today nobody has written down every state a deal can be in. The rules contract stores one word per deal, the bond vault stores totals, and the Commerce Payments escrow stores its own copy of "is the money held". Correctness rests on facts that live in two places or in none.

This task writes that specification, from the source, without changing it:

1. `docs/audit/state-model.md`:
   - every legal combination of a deal's stored fields, the entry point that creates it and the entry points that leave it, each cited to a line of `contracts/src` at a named commit;
   - every combination the storage can represent and no entry point should reach, with the reason it is unreachable, or a finding when it is reachable;
   - what the bond vault and the escrow hold in each state, as amounts in the deal's signed terms;
   - every deadline as a named expression over the signed terms and block time;
   - the effective outcome of a deal as one function of its state;
   - a register of every field a party signs, with the line that enforces it or the statement that none does, and a verdict for each unenforced field: enforce, remove from the signed terms, or state as an assumption.
2. `docs/audit/threat-model.md`: the actors, what each can and cannot do, the assets, and the assumptions the contracts rest on.

The model covers the whole machine as deployed. It marks each part that a phase-one scope cut removes, so each answer to a cut is a marked branch. It decides no cut.

Non-goals: no change to `contracts/`, `formal/`, `docs/audit/scope.md` or `docs/audit/known-issues.md`; no fix for any finding; no new test.

## Context

- The contracts: `contracts/src/HoldbackRules.sol`, `HoldbackBonds.sol`, `HoldbackTypes.sol`, `IHoldbackBeacon.sol`, `DrandQuicknetBeacon.sol`, `SimBeacon.sol`.
- The escrow the rules contract operates: `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol` (third-party, pinned at `6b0a5ef`).
- The settlement ADRs: ADR-0003, ADR-0007, ADR-0012, ADR-0016, ADR-0018, ADR-0019, ADR-0025, ADR-0029.
- `docs/audit/scope.md`, `docs/audit/known-issues.md`, `docs/neutrality.md`.
- The formal model: `formal/Holdback.tla`, `formal/README.md`.
- The state machine the contract mirrors: `packages/core/src/state.ts`, `packages/core/src/timing.ts`.
- The contract refinement plan, which the maintainers keep privately (`docs/private-materials.md`). It names the scope cuts SC-1 to SC-8 and the implicit-state items IS-1 to IS-14 that the two documents refer to.

## Acceptance criteria

- [ ] Every row of the state table cites the line of `contracts/src` that writes it, at a named commit.
- [ ] Each combination the storage can represent but no entry point should reach is listed as illegal, with why it is unreachable, or that it is reachable (a finding).
- [ ] A reader can write the invariant "the deal's word is always one of these rows" from the table alone.
- [ ] The holdings table gives, for each row, what the vault and the escrow hold, in terms of the deal's fields.
- [ ] Every deadline is a named expression; every opposing pair of entry points is shown to agree on its boundary.
- [ ] The register covers every field of every signed type, and gives a verdict for each signed field the contract does not enforce.
- [ ] The threat model states the escrow's second copy of the hold, the block proposer's choice of beacon round, the vault's push payments and the lack of an address-distinctness check as explicit assumptions.
- [ ] The two documents agree with `formal/`, or list where they differ.
- [ ] One red-team subagent, given the contracts and not this task's reasoning, tried to find a reachable state the table calls illegal, or a legal one it omits.

## Out of scope

- Any change to the contracts, the formal model, the tests, `scope.md` or `known-issues.md`.
- Any decision on a scope cut.
- The state oracle in the tests (T-341) and the formal model's update (a later task).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

## Handoff

What is done, what is not, how to resume, and the open questions that remain.
