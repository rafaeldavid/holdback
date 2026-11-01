# Plan

Iterative. Demo first, then harden one layer per phase. Each phase ends with evidence, a plan update and ADRs closed or deferred. Task files exist for Phase 0 and Phase 1. The architect writes later phases' task files at the start of each phase.

**Releases:** v0.1 = Phases 0–3 · v0.2 = Phases 4–5 · v0.3 = Phase 6.

## Phase 0: Setup and research

Goal: a repo that agents can work in safely, and confirmation that no existing solution already meets the three litmus tests.

- [x] T-001 Monorepo scaffold, CI, schema validation, guardrails (infra)
- [x] T-002 Prior-art sweep: confirm the gap; evaluate the Commerce Payments Protocol for D3 (research)
- [x] T-003 Spike: agreements funded by the user's own compute or API access, routes R1–R4 (research)
- [x] T-011 `/verify` command, feature map, PR template (infra; finishes after T-005)

**Exit:**
- CI is green on an empty skeleton.
- `spec/examples` validate.
- `docs/research/prior-art.md` and `docs/research/compute-native.md` are written.
- D1, D2 and D6 are decided.

## Phase 1: Demo walking skeleton on SimChain

Goal: `pnpm demo` runs beats 1–7 of `docs/demo.md` with scripted judges (no keys). Every beat is a passing scenario fixture.

Scope after the Phase 0 adversarial review (`docs/reviews/2026-10-30-phase0-interrogate.md`): `guaranteed_on_decision` only, `maxSubmissions = 1`, no sealed checks, and commitments bind `registryHash`.

- [x] T-004 Core types, state machine, EIP-712 types, money, timing rules (core)
- [x] T-014 Envelope encryption and ciphertext store (core)
- [x] T-005 Testkit: `snap` runner, pragmas, prefixes, deterministic clock/RNG, recordings (test)
- [x] T-006 SimChain: escrow rules, permissionless triggers, two-sided key release, bonds, property tests (settlement)
- [x] T-007 Operator API and SDK with failover and direct submit; idempotency; receipts; event log (api)
- [x] T-008 Judgment pipeline v0: intake, declarative checks, screen heuristics, spotlighting prompt builder, verdict schema, aggregation (judgment)
- [x] T-009 Providers, pinned registry, commit-reveal panel, adjudicator service with fallback and appeal (judgment)
- [ ] T-010 Scenario fixtures for beats 1–7 plus `error.` and `neutrality.` sets; capture live recordings once (test)
- [x] T-012 Demo data and scripted buyer/seller agents (demo)
- [x] T-013 Narrated CLI, transcript renderer, static viewer, dry run (demo; human gate; dry run 2026-11-01)
- [x] T-015 OpenAPI document, staleness check and HTTP contract test (api; after T-007 and T-010; ADR-0017; PR 56)
- [x] T-016 Testkit runner: real judgment in snap, role-keyed recordings, authored guard, mutual_settle (test; trimmed by D25, rest is T-016b)
- [x] T-017 Demo: adjudicator profiles and buyer/seller agreement on adjudicators (demo)
- [x] T-018 Beats 6a and 7 on SimChain; appeal decides a screen-flagged case (judgment + demo; D25)
- [x] T-019 Demo honesty and clarity: scripted labels, one ID per job, judging time, one prompt and verdict, lean balances (demo; D25)
- [x] T-020 Developer surface, API first (D30): prepare-sign-submit endpoints, delivery envelope spec, terms templates, `pnpm sim`, curl quickstart, examples (api + demo)
- [x] T-021 Agent simulation: model agents call the HTTP API through generic HTTP and signing tools; multi-model runner (test; after T-020; PR 55)
- [x] T-022 Faster CI without losing coverage: sharded tests, lighter property runs on PRs, schema compile once, screen timing (infra)
- [x] T-023 Sim worlds stop publishing secrets; harness fixes from sim batch 1 (test + api; after T-021; PR 57)
- [x] T-024 Early accept never pays for an envelope the buyer cannot open (api + test; sim batch 1 F2; D32; PR 59)
- [x] T-025 API and docs friction from sim batch 1 (api; after T-015, T-020; PR 58)
- [x] T-026 Public demo API on Cloudflare: two operator Workers, one Durable Object world, faucet, test tokens (api + infra; PR 61; live)
- [x] T-027 The site at npc.here.now/escrow: tagline and agent docs, no repo needed (demo + docs; PR 60; live)
- [ ] T-028 One live two-family adjudicator (Anthropic + DeepSeek), local and in the public demo, with spending caps (judgment + demo + infra)

**Exit:**
- Demo success criteria met (`docs/demo.md`).
- Scenarios pass in CI.
- Hold p95 ≤ 250 ms on SimChain (measured).
- Rafa has walked through the demo.

## Phase 2: Settlement on EVM, no admin keys

Goal: the same scenario fixtures pass against an EVM contract on a local chain. Differential testing against SimChain.

- T-201 Hands-on spike, on local anvil: can a rules contract act as operator of `AuthCaptureEscrow` (D3-A)? If not, design an ERC-8183 extension (D3-B). Must confirm the ADR-0003 conditions: capture timing per mode, expiry margin, fee-only capture on the refund path with `maxFeeBps = 10000`, idempotency in the rules contract; compare deployed bytecode with the v1.1.0 tag; read the audits.
- T-202 Escrow rules contract, Foundry: offer/agree hashes, funding via ERC-3009/Permit2, deliver, decide with adjudicator signature, permissionless triggers, key release events, bonds.
- T-203 Invariant and fuzz tests: conservation, settle-once, no admin selectors.
- T-204 Formal model of the commitment state machine (TLA+ or Quint): liveness under any single actor halting; safety of fund movement.
- T-205 `Settlement` EVM implementation; `pnpm snap --settlement=local` green; differential report.
- T-206 Contract review: checklist plus a cross-family review; human gate.
- T-207 Private deals, to make "private escrow" true end to end (Rafa, 2026-11-01). Today only the work is private: it is encrypted, and only the adjudicators and the paid buyer can open it. Terms, amounts, addresses and events are public reads. Build: read authentication (`ReadToken`) so only the parties and their adjudicators read a deal; private judgment records; disclosure levels enforced, not just recorded; commitment metadata private on unauthenticated reads (residual 9); amount privacy weighed with the D4 chain choice (confidential tokens or a privacy chain). Sources: ADR-0020, D13, D16, backlog Privacy. Needs an ADR and a schema version bump. Done when a third party reading any operator learns nothing about a deal beyond what its disclosure level allows, shown by a fixture.
  - **End-to-end encrypted API (Rafa, 2026-11-01): the operator cannot read the deal either, as far as possible.** Agents encrypt the terms body (deliverable, checks, rubric, notes) to the parties and the named adjudicators, as deliveries are today; operators store and relay ciphertext and see only what settlement must check (signatures, hashes, and the money and deadline fields, themselves hidden where the chain allows). The terms already commit to `deliverableHash` and `acceptanceHash`, so settlement needs hashes, not text. Prepare becomes a published, deterministic client-side recipe (the operator cannot prepare what it cannot read). An encrypted agent-to-agent mailbox for negotiation, relayed by any operator, replaces off-protocol mail. Open questions for the ADR: what an operator must still see to relay and rate-limit, metadata leakage (who deals with whom, when, how much), key discovery and rotation, and how adjudicators get the plaintext they judge.
- Decide D4 (testnet).

## Phase 3: Judgment hardening

Goal: judgment metrics measured against the PRD targets. Defenses complete.

- T-301 Calibration and red-team fixture generators (about 40 plus 20 cases) and the `pnpm calibrate` harness and report.
- T-302 Reader extraction with a typed feature schema.
- T-303 Classifier screen and the normalization pipeline (Unicode tags, zero-width characters, encodings).
- T-304 Sealed checks: commit at agreement, reveal at judging, weight cap.
- T-305 Registry promotion workflow and registry log; regression on model-ID change.
- T-306 Fee quotes from measured error rates; quote endpoint.
- T-307 Live demo mode (`pnpm demo --live`) with two or three model families.

## Phase 4: Adjudicator economics on the settlement layer

Goal: bonds, coverage, appeals, fallback and default outcomes run on the contract, with demo beat 8.

- Adjudicator registry with bonds and the coverage-ratio gate.
- `settle_after_window` with its own key-release design (ADR-0012) and resubmission.
- Overturn payouts in guaranteed mode; appeal bonds.
- Default outcome with seller compensation from bonds (D5).
- Adjudicator independence checks (affiliation declared at registration).

## Phase 5: Ramps, testnet, more operators

Goal: fiat enters and leaves through ramps; the demo runs on a public testnet with two independent operator nodes.

- Stablecoin direct funding (test token).
- Stripe test-mode on-ramp: a card payment mints test tokens to the buyer (D7). A simulated off-ramp.
- Testnet deployment (D4) and gas sponsorship or paymaster for agents.
- Operator node packaging (container), so a second party can run op-2.
- Neutrality beat 7 on testnet.

## Phase 6: Interop and native compute

- MCP server wrapping the SDK.
- A2A extension carrying the commitment object and receipts.
- Live demo agents on the Claude Agent SDK.
- Metered sessions for divisible work.
- Compute-native route R1 (work-for-work) if T-003 recommends it.
- Club rulebook templates (procurement framework style).

## Scenario index

| Fixture | Beat | Phase |
| --- | --- | --- |
| `happy-path` | 1–4 | 1 |
| `bad-work-row-drop` | 5 | 1 |
| `bad-work-panel-reject` | — | 1 |
| `attack.injection-plain` | — | 1 |
| `attack.injection-encoded-base64` | 6 | 1 |
| `attack.injection-encoded-unicode-tags` | — | 1 |
| `attack.format-correct-content-wrong` | — | 3 |
| `attack.reader-poison` | — | 3 |
| `attack.exfil-attempt` | — | 3 |
| `neutrality.operator-refuses` | 7 | 1 |
| `neutrality.operator-offline` | — | 1 |
| `neutrality.adjudicator-offline` | 7 | 1 |
| `neutrality.adjudicator-and-fallback-offline` | — | 1 |
| `neutrality.appeal-adjudicator-offline` | — | 1 |
| `neutrality.appeal-adjudicator-offline-after-escalation` | 6 | 1 |
| `neutrality.maintainers-change-registry` | — | 1 |
| `attack.adjudicator-self-dealing` | — | 1 |
| `appeal-bad-key-release` | — | 1 |
| `todo.adjudicator-leaks-plaintext` | — | records residual 6 |
| `neutrality.club-revokes-mid-flight` | 7 | 1 |
| `neutrality.buyer-silent` | — | 1 |
| `neutrality.provider-outage` | — | 1 |
| `neutrality.onramp-refuses` | — | 5 |
| `reclaim-no-delivery` | — | 1 |
| `panel-disagreement-escalates` | — | 1 |
| `appeal-overturn-bond-pays-seller` | 8 | 1 on SimChain; 4 on contract |
| `appeal-overturn-bond-pays-buyer` | — | 1 on SimChain; 4 on contract |
| `error.scope-exceeded` | — | 1 |
| `error.replay` | — | 1 |
| `error.revoked-agent` | — | 1 |
| `error.invalid-signature` | — | 1 |
| `error.idempotency-conflict` | — | 1 |
| `error.concurrent-overdraft` | — | 1 |
| `error.submission-limit` | — | 1 |
| `error.coverage-exceeded` | — | 1 |
| `error.unpinned-model-refused` | — | 1 |
| `error.adjudicator-affiliated` | — | 1 |
| `error.mime-not-allowed` | — | 1 |
| `error.policy-hash-mismatch` | — | 1 |
| `neutrality.adjudicator-never-accepts` | 1 | 1 |
| `neutrality.adjudicator-silent-before-judging` | 7 | 1 |
| `error.acceptance-mismatch` | — | 1 |
| `error.seed-mismatch` | — | 1 |
| `error.member-not-admitted` | — | 1 |
| `early-accept-releases-key` | — | 1 |
| `todo.milestone-delivery` | — | records gap |
| `work-for-work` | 9 | 6, if T-003 is positive |
