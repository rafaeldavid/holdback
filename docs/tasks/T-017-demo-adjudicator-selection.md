# T-017: Demo adjudicator profiles and selection before the offer

- **Lane:** demo
- **Phase:** 1
- **Depends on:** T-012 (agents), T-013 (CLI and viewer)
- **Paths this task may touch:** `apps/demo/`, `docs/backlog.md` (if a registration field is the right home for display-only data), this task file
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** implementer; branch `t-017-demo-adjudicator-selection`

## Intent

Restated in my own words:

- **Goal.** Beat 1 says "the two agents chose the adjudicators", but today the slate is hard-wired in `beatHold`. Make the choice real and visible: before Tide-7 offers, Ledger reads the published adjudicator registrations, filters them by the club rulebook, and proposes a primary, fallback and appeal adjudicator; Tide-7 checks that proposal against its own policy and agrees (or refuses); the offer then names exactly the agreed slate.
- **Inputs.** The registrations the benches publish (Clearfield, Northgate, Atrium from T-009's service, plus a new Swiftline Verdicts listing), the bond pools SimChain holds, the Data Services Club rulebook (`panelPolicyMin`, `windowCoverageRatioBps`, `allowedSettlementModes`), the terms file's price, and `config/judges.yaml` through the demo registry.
- **Rules applied, from what the rulebook and registrations actually express.** Ledger: the registration's declared panel meets `panelPolicyMin` (panel size, appeal panel size, model families), and free bond (`junior + senior - reserved`) covers the price (100% for `guaranteed_on_decision`, the club's only mode, else `windowCoverageRatioBps`), and the registration validates against `adjudicator.schema.json`. Tide-7: the registration validates, its registry hash is the registry Tide-7 trusts and every active model ID in it is pinned (dated, never an alias), its `policyHash` is the hash of its policy, and its free bond is at least the price (a policy knob, so a test can make it refuse).
- **Swiftline** (one judge, one family, 1.0% fee, 40,000 tUSD bond) is excluded because its declared policy fails the rulebook, never by name. Its bond is real (SimChain genesis) and covers the price, so the bond rule passes and only the panel rules exclude it.
- **Profiles.** Each bench gets a cast-level profile: tagline, judges (registry judge IDs resolved to pinned model IDs and families through the demo registry, with a declared per-judge effort setting), harness, terms (fee, panel size and threshold, judgeBy, appeal window, bond, read from the registration, SimChain and the terms file), and an invented history marked as role-play. Effort, harness, roles offered and history are display data the v0.6 registration cannot carry; no schema change.
- **Outputs.** Beat 1's transcript gains two narrated steps before the offer (proposal with the exclusion and its reason; agreement with the seller's checks), and the viewer shows a collapsed profile per bench, including Swiftline as declined. Bench and profile text goes through the existing untrusted-text helpers.
- **Non-goals.** No protocol message and nothing on chain for the negotiation (agent-to-agent, unsigned in this prototype). No schema or registration change. No counter-proposal search (refusal is the one non-agree path). Effort settings are declared, not applied: recorded mode uses fake judges. Nothing in `packages/testkit` (T-016).

## Context

- `docs/demo.md` §Cast and §Beats (beat 1: "chosen by the two agents").
- `CLAUDE.md` Objective property 1 (the parties choose their adjudicators), Design principle: user choice (ADR-0015).
- `docs/architecture.md` bond coverage invariant (`windowCoverageRatioBps`, 100% for `guaranteed_on_decision`).
- `spec/schemas/adjudicator.schema.json` (v0.6), `fixtures/clubs/data-services-v1.yaml`, `config/judges.yaml`.
- T-012 (`apps/demo/agents/`), T-013 (`apps/demo/src/`).

## Acceptance criteria

- [ ] Profiles for Clearfield, Northgate and Atrium in `apps/demo/agents/cast.ts` with judges resolved from the demo registry (no invented model IDs), effort, harness, terms from registration/terms/SimChain, history labelled role-play; Swiftline Verdicts profile and registration.
- [ ] Ledger proposes from the published registrations filtered by the rulebook; Swiftline excluded with a rule-based reason.
- [ ] Tide-7 checks the proposal against its policy and agrees; a policy that rejects a bench produces a refusal and no offer.
- [ ] The offer names exactly the agreed slate.
- [ ] Beat 1 transcript: proposal (with exclusion) and agreement as two narrated steps before the offer.
- [ ] Viewer: a collapsed profile per bench; all bench text escaped.
- [ ] `pnpm verify` green on a clean tree.

## Out of scope

- A registration schema field for effort, harness, roles or history (backlog item instead).
- Counter-proposals, multi-round negotiation, signed negotiation messages.
- Live judges.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff
