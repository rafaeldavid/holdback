# T-021: Agent simulation: model agents use the protocol through tools

- **Lane:** test + api
- **Phase:** 1 (exploration tooling)
- **Depends on:** T-020
- **Paths this task may touch:** `packages/mcp/` (new), `tools/sim/` (new), `docs/testing.md`, root `package.json` scripts
- **Human gate:** no (no keys; Claude-family models only until Rafa provides other families' keys)
- **Status:** todo
- **Agent/session:** —

## Intent

Let model-driven agents of different sizes (and later different families) play buyers and sellers against a local world, so we find usability gaps, odd negotiations and adversarial behaviour that scripted agents never produce. Findings become deterministic fixtures; the sim itself is exploration, not CI.

Restate this in your own words in this section before writing code.

## Context

- `docs/reviews/2026-10-31-outsider-usability.md`; T-020's SDK and `pnpm sim` world; Rafa, 2026-10-31: "you should be able to simulate protocol and API usage easily by spinning up agents who use different models".

## Acceptance criteria

- [ ] An MCP server over the T-020 SDK exposing the party actions as tools (`find_adjudicators`, `offer`, `agree_and_fund`, `deliver`, `status`, `open_deliverable`, `appeal`, `settle`), with tool descriptions good enough that a model can complete a deal from them alone.
- [ ] A runner: picks a job from a catalogue, assigns each party a model and a behaviour profile (honest, sloppy, impatient, adversarial), runs them against the local world, and checks invariants at the end: funds conserved, nothing moved outside the terms, both parties' records match (D26).
- [ ] Output per run: transcript, outcome, invariant results, friction notes. A summary across runs.
- [ ] Simulated parties never act as judges; judges stay pinned and tool-less.
- [ ] At least one finding promoted to a fixture.

## Out of scope

- Non-Claude model families (needs Rafa's keys); CI gating on sim runs.

## Evidence

## Decisions

## Handoff
