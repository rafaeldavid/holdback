# Plan

Iterative. Demo first, then harden one layer per phase. Each phase ends with evidence, a plan update and ADRs closed or deferred. Phases 0 to 2 have task files in `docs/tasks/` (T-016b and T-208 do not yet). The architect writes later phases' task files at the start of each phase.

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
- [x] T-010 Scenario fixtures for beats 1–7 plus `error.` and `neutrality.` sets (test; closed 2026-11-01; open rows and live recordings moved to T-016b)
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
- [x] T-027 The site, first at npc.here.now/escrow and now at escrow.stream: tagline and agent docs, no repo needed (demo + docs; PR 60; live)
- [x] T-028 One live two-family adjudicator (Anthropic + DeepSeek), local and in the public demo, with spending caps (judgment + demo + infra; PR 62; live)
- [x] T-029 Operator fee per D33 (confirmed 2026-11-01; PR 63; live): ADR-0023, schema v0.7, a buyer-signed fee transfer in agree-and-fund, 402 on unpaid relay, published at 0 then 1 bp / 0.01 tUSD minimum (api + settlement)

**Exit:**
- Demo success criteria met (`docs/demo.md`). *Met, with one criterion partly met and moved to T-016b (2026-11-01).*
- Scenarios pass in CI. *Met: the 31 scenarios plus `_example` pass on main.*
- Hold p95 ≤ 250 ms on SimChain (measured). *Met: 8.27 ms per hold over 1,000 holds (T-006).*
- Rafa has walked through the demo. *Met: Rafa walked through it on 2026-11-01 with a guided walkthrough (a local report, not in git). Phase 1 is done.*

## Phase 2: Settlement on EVM, no admin keys

Goal: the same scenario fixtures pass against an EVM contract on a local chain. Differential testing against SimChain.

- [x] T-201 (PR 64; option A kept) Hands-on spike, on local anvil: can a rules contract act as operator of `AuthCaptureEscrow` (D3-A)? If not, design an ERC-8183 extension (D3-B). Must confirm the ADR-0003 conditions: capture timing per mode, expiry margin, fee-only capture on the refund path with `maxFeeBps = 10000`, idempotency in the rules contract; compare deployed bytecode with the v1.1.0 tag; read the audits.
- [x] T-202 (PR 68) Escrow rules contract, Foundry: offer/agree hashes, funding via ERC-3009/Permit2, deliver, decide with adjudicator signature, permissionless triggers, key release events, bonds.
- [x] T-203 (PR 70) Invariant and fuzz tests: conservation, settle-once, no admin selectors.
- [x] T-204 (PR 66) Formal model of the commitment state machine (TLA+ or Quint): liveness under any single actor halting; safety of fund movement.
- [x] T-205 (PR 69) `Settlement` EVM implementation; `pnpm snap --settlement=local` green; differential report.
- [ ] T-206 Contract review: checklist plus a cross-family review; human gate.
- [ ] T-207 (in progress; stage 2a merged in PR 67) Private deals, to make "private escrow" true end to end (Rafa, 2026-11-01). Today only the work is private: it is encrypted, and only the adjudicators and the paid buyer can open it. Terms, amounts, addresses and events are public reads. Build: read authentication (`ReadToken`) so only the parties and their adjudicators read a deal; private judgment records; disclosure levels enforced, not just recorded; commitment metadata private on unauthenticated reads (residual 9); amount privacy weighed with the D4 chain choice (confidential tokens or a privacy chain). Sources: ADR-0020, D13, D16, backlog Privacy. Needs an ADR and a schema version bump. Done when a third party reading any operator learns nothing about a deal beyond what its disclosure level allows, shown by a fixture.
  - **End-to-end encrypted API (Rafa, 2026-11-01): the operator cannot read the deal either, as far as possible.** Agents encrypt the terms body (deliverable, checks, rubric, notes) to the parties and the named adjudicators, as deliveries are today; operators store and relay ciphertext and see only what settlement must check (signatures, hashes, and the money and deadline fields, themselves hidden where the chain allows). The terms already commit to `deliverableHash` and `acceptanceHash`, so settlement needs hashes, not text. Prepare becomes a published, deterministic client-side recipe (the operator cannot prepare what it cannot read). An encrypted agent-to-agent mailbox for negotiation, relayed by any operator, replaces off-protocol mail. Open questions for the ADR: what an operator must still see to relay and rate-limit, metadata leakage (who deals with whom, when, how much), key discovery and rotation, and how adjudicators get the plaintext they judge.
- [ ] T-016b Testkit follow-ups from Phase 1: T-010's open rows (appeal, early accept, mutual settle, dispute and revoke steps; a second commitment per scenario; refusal overrides; offline operators), live recording against `config/judges-live.yaml` (`--judges live --record`, keys via `--env-file`), snapshot rendering items, and transcripts as snapshots (T-013 Handoff).
- [x] T-030 (PR 85) API agent-readiness batch (D39; `docs/reviews/2026-11-02-api-agent-review.md`): an agent with only HTTP, an EIP-712 signer and `llms.txt` completes a deal first try; simplify discovery, errors, nonces, timestamps, notices; planned routes answer 501; disclosure chosen explicitly; budget charged after the signature verifies.
- [ ] T-031 Minimal telemetry for the MVP (D39): aggregate metrics and a 7-day request log, nothing beyond ADR-0024 §1; a quota alert. After T-030.
- [ ] T-032 Feedback and issue reports, first slice (D39): `POST /v1/feedback`, `GET /v1/feedback/{id}`, a private store and a triage routine. After T-030.
- [ ] T-033 Schema v0.9 (ADR-0025, D38, D39): CPP funding schemes and token addresses, `allowedTokens` optional, `chainId` a number, `not_implemented`, the fee on receipts, the MIME allowlist moved to adjudicator capability.
- [ ] T-034 Faster CI and local verify (`docs/reviews/2026-11-02-dev-velocity.md`): cache the contracts build, job-level path filters with `check` and `gitleaks` still reporting, TLC only when the model changes, `pnpm verify --affected`, done derived from merges.
- [ ] T-035 Fix the anvil gas-per-deal receipt stall at its root; sane test timeouts.
- [ ] T-036 Coordinator commands: `/merge-pr`, `/start-task`, `/deploy-demo`, `/deploy-site`, `/review-pr`, `/record-decision`, `/daily-log`, a session brief and two hooks.
- [x] T-038 Public docs cleanup: README leads with ’crow, Apache-2.0 license, statuses and fixture indexes match the repo, no personal details (PR 110).
- [x] T-209 (PR 77) Beacon verification in `HoldbackRules` (BLS check of the drand value for fallback and appeal panel seeds, ADR-0018), split out of T-202. ADR-0025's schema follow-up (EVM funding signature and token identifiers) moved to T-033.
- [ ] T-208 Exploration: a single-use Prividium fragment per escrow, assets kept in the L1 escrow; must answer D4's 2026-10-31 objections (no fragment operator can block settlement or read the deal). Research pass done (PRs 79, 81, 82; `docs/research/prividium-fragment.md`, which also holds the original proposal): recommends parking it, pending Rafa. No task file yet.
- D4 decided (2026-11-01): target Ethereum mainnet; build and test on a local chain, then Sepolia. Mainnet deployment is a separate gate for Rafa after an audit. Record gas per deal in the evidence.

## Phase 3: Judgment hardening

Goal: judgment metrics measured against the PRD targets. Defenses complete.

- T-301 Calibration and red-team fixture generators (about 40 plus 20 cases) and the `pnpm calibrate` harness and report.
- T-302 Reader extraction with a typed feature schema.
- T-303 Classifier screen and the normalization pipeline (Unicode tags, zero-width characters, encodings).
- T-304 Sealed checks: commit at agreement, reveal at judging, weight cap.
- T-305 Registry promotion workflow and registry log; regression on model-ID change.
- T-306 Fee quotes from measured error rates; quote endpoint.
- [x] T-307 Live demo mode (`pnpm demo --live`) with two or three model families. Done by T-028 (PR 62): two families, Anthropic and DeepSeek.
- T-308 (later; research pass and ADR-0027, Proposed, 2026-11-03; Rafa, 2026-11-03) The adjudicator reports its whole judgment end to end (each check, each judge's full reasoning, the aggregation) with provable inference (zkSNARK proofs bound to a commitment to each judge's weights, as in Anthropic's FlashProve) that the pinned models produced it, and auto-tunes its judgment parameters from measured outcomes in a continuous loop, shipping each change only as a new registry version or policy bound in new commitments. Detail and limits in `docs/backlog.md` under "Judgment defenses".

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

- Later, on demand only (Rafa, 2026-11-02; D39): an SDK or an MCP server. Agents integrate from the HTTP API and `llms.txt`.
- A2A extension carrying the commitment object and receipts.
- Live demo agents on the Claude Agent SDK.
- Metered sessions for divisible work.
- Compute-native route R1 (work-for-work) if T-003 recommends it.
- Club rulebook templates (procurement framework style).

## Phase 7: Far-future exploration

Goal: not scheduled (Rafa, 2026-11-02); each item needs a research pass and an ADR before any build. Details in `docs/backlog.md` under "Far future".

- Tax liability for agents and their owners: what a deal creates (income, sales tax, withholding, reporting), who bears it, and what the signed record and receipts must carry to help owners file. The protocol stays rails (D35): it supplies evidence, not tax decisions.
- Minimise gas per deal, toward near-zero until settlement.
- Single-block wallet generation and atomic onboarding: funds are either with the agent in fiat or, almost at once, in the credibly neutral holding contract, with no in-between custody.
- An agent-to-agent L2 fragment per escrow, verified with zero-knowledge proofs: independently checkable, almost no gas until the settlement proof is submitted (extends the Prividium fragment exploration and T-208).

## Scenario index

Status (2026-11-03, measured against `fixtures/scenarios/` and `pnpm snap`): **exists** is a fixture file that passes; **todo** is a `todo.` fixture that records a known gap and passes as a todo; **planned** has no file yet. The 31 fixtures on disk are 25 that exist plus 6 todo. Fixtures run on SimChain; Phase 2 also runs them on the contract (below).

| Fixture | Beat | Phase | Status |
| --- | --- | --- | --- |
| `happy-path` | 1–4 | 1 | exists |
| `bad-work-row-drop` | 5 | 1 | exists |
| `todo.bad-work-panel-reject` | 5 | 1 | todo (needs real data; becomes `bad-work-panel-reject`) |
| `todo.attack.injection-plain` | 6 | 1 | todo (needs real data; becomes `attack.injection-plain`) |
| `attack.injection-encoded-base64` | 6 | 1 | exists |
| `attack.injection-encoded-unicode-tags` | 6 | 1 | exists |
| `attack.injection-filter-abstain-appeal-default` | 6 | 1 | exists |
| `attack.injection-splits-appeal-to-default` | 6 | 1 | exists |
| `attack.injection-steers-appeal-supermajority` | 6 | 1 | exists |
| `attack.injection-steers-appeal-two-families` | 6 | 1 | exists |
| `attack.forced-stride-appeal-default` | — | 1 | exists |
| `attack.format-correct-content-wrong` | — | 3 | planned |
| `attack.reader-poison` | — | 3 | planned |
| `attack.exfil-attempt` | — | 3 | planned |
| `neutrality.operator-refuses` | 7 | 1 | exists |
| `neutrality.operator-offline` | 7 | 1 | exists |
| `neutrality.adjudicator-offline` | 7 | 1 | exists |
| `neutrality.adjudicator-and-fallback-offline` | 7 | 1 on SimChain; 4 on contract (default compensation from bonds) | exists |
| `neutrality.appeal-adjudicator-offline` | 7 | 1 | planned (T-016b: party-appeal step) |
| `neutrality.appeal-adjudicator-offline-after-escalation` | 6 | 1 on SimChain; 4 on contract (default compensation from bonds) | exists |
| `honest-seller-survives-judge-noise-on-appeal` | — | 1 on SimChain; 4 on contract (appeal fee and bond rate) | exists |
| `neutrality.maintainers-change-registry` | 3 | 1 | planned (T-016b: real registry and policy hashes) |
| `attack.adjudicator-self-dealing` | 8 | 1 | exists |
| `appeal-bad-key-release` | 8 | 1 | planned (T-016b) |
| `todo.adjudicator-leaks-plaintext` | — | records residual 6 | todo |
| `todo.principal-no-recourse` | — | records residual 12 | todo |
| `neutrality.club-revokes-mid-flight` | 7 | 1 | planned (needs run-time revocation; SimChain reads members from genesis) |
| `neutrality.buyer-silent` | 7 | 1 | exists |
| `neutrality.seller-withholds-delivery` | 2 | 1 | exists (the planned `reclaim-no-delivery`) |
| `todo.provider-outage` | 7 | 1 | todo (becomes `neutrality.provider-outage`) |
| `neutrality.beacon-relay-refuses` | — | 2 | planned (ADR-0018) |
| `todo.beacon-unavailable-whole-window` | — | records residual 10 | planned |
| `neutrality.onramp-refuses` | — | 5 | planned (with the funding service, ADR-0026) |
| `panel-disagreement-escalates` | 3 | 1 | exists |
| `appeal-overturn-bond-pays-seller` | 8 | 1 on SimChain; 4 on contract | planned (T-016b) |
| `appeal-overturn-bond-pays-buyer` | 8 | 1 on SimChain; 4 on contract | planned (T-016b) |
| `error.scope-exceeded` | 1 | 1 | planned (T-016b) |
| `error.replay` | 1 | 1 | planned (T-016b) |
| `error.revoked-agent` | 7 | 1 | planned (T-016b) |
| `error.invalid-signature` | 1 | 1 | exists |
| `error.idempotency-conflict` | 1 | 1 | planned (T-016b; covered today by `apps/operator` idempotency tests) |
| `error.concurrent-overdraft` | 1 | 1 | exists |
| `todo.submission-limit` | 5 | 1 | todo (becomes `error.submission-limit`) |
| `error.coverage-exceeded` | 7 | 1 | exists |
| `error.early-accept-wrong-key-envelope` | — | 1 | exists |
| `error.unpinned-model-refused` | 3 | 1 | planned (T-016b; covered today by registry loader tests) |
| `error.adjudicator-affiliated` | 3 | 1 | planned (T-016b) |
| `error.mime-not-allowed` | 2 | 1 | planned (T-016b) |
| `error.policy-hash-mismatch` | 3 | 1 | planned (T-016b) |
| `neutrality.adjudicator-never-accepts` | 1 | 1 | exists |
| `neutrality.adjudicator-silent-before-judging` | 7 | 1 | exists |
| `error.acceptance-mismatch` | 1 | 1 | planned (T-016b) |
| `error.seed-mismatch` | — | 1 | planned (T-016b) |
| `error.member-not-admitted` | 1 | 1 | planned (T-016b) |
| `early-accept-releases-key` | — | 1 | planned (T-016b) |
| `todo.milestone-delivery` | — | records gap | planned |
| `work-for-work` | 9 | 6, if T-003 is positive | planned |

Some neutrality and error cases are named tests rather than scenario files: `neutrality.operator-fee-direct-submission-free` (`apps/operator/src/fee.test.ts`), `neutrality.operator-rate-limits` (`apps/operator/src/neutrality.test.ts`) and `neutrality.operator-lies-in-prepare` (`examples/verify.test.ts`).

Phase on contract (T-205): every existing fixture without an "on contract" note also runs on the contract from Phase 2 (`pnpm snap --settlement=local`). The three marked 4 are the printed exclusion list in `packages/testkit/src/runner.ts` (`LOCAL_EXCLUSIONS`). The per-fixture differences are in `reports/differential-local.md` (tracked, though `reports/` is otherwise git-ignored).
