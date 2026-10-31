# Holdback starter kit

Holdback is the working name for a protocol for escrow between agents. Any two agents choose their own adjudicator, any capital holder can join the bonding behind adjudicators, and access is by API through any operator node. This kit builds a prototype of machine-speed escrow on that protocol. One agent puts money behind a commitment to another agent at another firm, and the commitment runs through three steps:

1. **Hold.** Money goes into escrow, and the seller's work is held encrypted. Neither side can take the other's value alone.
2. **Judge.** Deterministic checks run first. A panel of pinned models from at least two families judges the rest, chosen by commit-reveal and defended against injection, gaming, drift and correlated error.
3. **Settle.** Payment and the work's decryption key are released together, or the buyer is refunded. A bonded adjudicator pays when an appeal overturns its decision.

The litmus test is neutrality: no single party can stop a valid commitment from settling according to its terms, or move held funds outside them. That includes operators, adjudicators, clubs, card and Stripe on-ramps, model providers and Holdback's maintainers. Any blockchain stays behind the API and SDK. Cards and Stripe act only as on-ramps and off-ramps.

The first product priority is a demo that conveys the experience to an AI lab researching agentic commerce (`docs/demo.md`).

This folder is a starter kit for a Claude Code session and a team of agents. It holds the brief, specs, contracts, task files, agent roles and research. It holds the Phase 1 build: core, SimChain settlement, judgment, SDK, operator, adjudicator, testkit and the narrated demo (`pnpm demo`).

## Start

1. Read `docs/decisions-today.md` and decide D1, D2 and D6. The others can follow.
2. Copy this kit into an empty folder and open Claude Code there. Claude Code reads `CLAUDE.md` automatically.
3. Paste `prompts/kickoff.md`. It runs Phase 0:
   - scaffold;
   - prior-art sweep;
   - spike on agreements funded by the user's own compute;
   - verify command.

   It asks before creating `rafaeldavid/holdback`.
4. At the end of Phase 0, paste `prompts/phase-1-demo.md` to build the demo.

## Contents

| Path | What it is |
| --- | --- |
| `CLAUDE.md` / `AGENTS.md` | Standing instructions: objective, litmus tests, hard rules, verification commands, team workflow |
| `docs/decisions-today.md` | D1–D9: the decisions needed today, each with options and a recommendation |
| `docs/PRD.md` | Problem, users, goals, requirements, metrics, assumptions to pressure-test |
| `docs/neutrality.md` | Control-point analysis per actor, residual risks, escape hatch, how neutrality is tested |
| `docs/architecture.md` | Components, state machine, two-sided hold, postings, settlement interface, timing, layout, glossary |
| `docs/judgment-and-defenses.md` | Pipeline, panel policy, aggregation rule, threat table (a defense and a test per threat), registry, calibration, fee pricing |
| `docs/api.md` | Operator REST API, SDK with failover and direct submission, MCP mapping |
| `docs/demo.md` | Audience, cast, the nine demo beats, success criteria |
| `docs/testing.md` | Test layers; scenario expect fixtures with `error.`, `attack.`, `neutrality.` and `todo.` prefixes |
| `docs/team.md` | Roles, task lifecycle, lanes and ownership, the Rules and checks table, cadence |
| `docs/plan.md` | Phases 0–6, scenario index, releases |
| `docs/decisions/` | ADR-0001 to ADR-0022 |
| `docs/tasks/` | Task template and Phase 0–1 tasks (T-001 to T-019) |
| `docs/log/` | Daily catch-ups; decisions waiting on Rafa at the top |
| `brand/` | Brand and messaging drafts: the mule mascot ("carries the load"), pitch, pillars, voice |
| `.claude/` | Permission settings; role subagents (architect, implementer, fixture-author, red-teamer, reviewer, verifier); commands (`/task`, `/verify`, `/snap`, `/handoff`, `/decide`) |
| `spec/` | JSON Schemas (the contract) and validated examples |
| `fixtures/` | Fixture conventions and a format example |
| `prompts/` | Kickoff and Phase 1 prompts |
| `docs/research/` | Report, essay, escrow options, notes, interactive model, sources |

## Status

Kit v0.1, October 30, 2026.

- **Verified (measured):** the schemas compile under Ajv 8 (2020-12, strict), and all examples validate.
- **Not verified:**
  - the internals of the Commerce Payments Protocol (T-002 and T-201);
  - the claims attributed to the X posts (secondary sources only);
  - React Compiler fixture conventions (from documented convention; the page was not fetched).
