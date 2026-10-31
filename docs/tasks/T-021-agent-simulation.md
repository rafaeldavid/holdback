# T-021: Agent simulation: model agents use the HTTP API

- **Lane:** test + api
- **Phase:** 1 (exploration tooling)
- **Depends on:** T-020
- **Paths this task may touch:** `tools/sim/` (new), `docs/testing.md`, root `package.json` scripts, `fixtures/scenarios/` (one promoted finding)
- **Human gate:** no (no keys; Claude-family models only until Rafa provides other families' keys)
- **Status:** todo
- **Agent/session:** —
- **Re-scoped:** 2026-10-31 by D30 (API first: no MCP server) and because there are no model API keys in the repo. Model agents are Claude Code subagents of different sizes (Haiku, Sonnet, Opus, Fable) that the coordinator spawns; they call the local operator's HTTP API with curl and sign with `examples/verify.ts` and `examples/sign.ts`.

## Intent

Let model-driven agents of different sizes (and later different families) play buyers and sellers against a local world, so we find usability gaps, odd negotiations and adversarial behaviour that scripted agents never produce. Findings become deterministic fixtures; the sim itself is exploration, not CI.

Restate this in your own words in this section before writing code.

## Context

- `docs/reviews/2026-10-31-outsider-usability.md`; T-020's API, `pnpm sim` world, quickstart and examples; Rafa, 2026-10-31: "you should be able to simulate protocol and API usage easily by spinning up agents who use different models".

## Acceptance criteria

- [ ] `tools/sim/catalogue.json`: jobs (dataset, translation, code fix, research brief) with terms a party can propose, and behaviour profiles (honest, sloppy, impatient, adversarial) each with a short, concrete brief.
- [ ] `tools/sim/briefs/`: a brief template per role that tells a model agent only what an outsider would know (start from `docs/quickstart.md`, the sim's endpoints, its own account), its job and profile, and how to report: actions taken, outcome, friction.
- [ ] `pnpm sim:world <run-id>`: starts an isolated world on free ports for one run (so parallel runs never share state) and writes its endpoints and fresh accounts to `tools/sim/runs/<run-id>/world.json`.
- [ ] `pnpm sim:check <run-id>`: after a run, reads the world's settlement log and balances and checks invariants: funds conserved, nothing moved outside the signed terms, every commitment terminal or explainably open, both parties' records match (D26). Writes `check.json` and exits non-zero on a violation.
- [ ] `tools/sim/README.md`: how the coordinator runs a batch (spawn one subagent per party with a model and profile, then `sim:check`), and how to promote a finding to a fixture.
- [ ] Simulated parties never act as judges; judges stay the sim's pinned fake judges.
- [ ] Prove it with one small batch run by the implementer itself is not possible (subagents can't spawn subagents): instead, run `sim:world` and `sim:check` around a scripted pair of parties from `examples/` and around a deliberately bad run (a mutated ledger) to show `sim:check` catches it. The coordinator runs the first model batch.

## Out of scope

- Non-Claude model families (needs Rafa's keys); an MCP server (D30); CI gating on sim runs.

## Evidence

## Decisions

## Handoff
