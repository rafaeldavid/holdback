# Plan

Iterative. Demo first, then harden one layer per phase. Each phase ends with evidence, a plan update and ADRs closed or deferred. Phases 0 to 2, 9 and 10 have task files in `docs/tasks/` (T-016b does not yet), and Phases 3 and 5 have one each (T-309, T-214). The architect writes later phases' task files at the start of each phase.

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
- Scenarios pass in CI. *Met: the 27 scenarios plus `_example` pass on main (2026-11-03).*
- Hold p95 ≤ 250 ms on SimChain (measured). *Met: 8.27 ms per hold over 1,000 holds (T-006).*
- Rafa has walked through the demo. *Met: Rafa walked through it on 2026-11-01 with a guided walkthrough (a local report, not in git). Phase 1 is done.*

## Phase 2: Settlement on EVM, no admin keys

Goal: the same scenario fixtures pass against an EVM contract on a local chain. Differential testing against SimChain.

- [x] T-201 (PR 64; option A kept) Hands-on spike, on local anvil: can a rules contract act as operator of `AuthCaptureEscrow` (D3-A)? If not, design an ERC-8183 extension (D3-B). Must confirm the ADR-0003 conditions: capture timing per mode, expiry margin, fee-only capture on the refund path with `maxFeeBps = 10000`, idempotency in the rules contract; compare deployed bytecode with the v1.1.0 tag; read the audits.
- [x] T-202 (PR 68) Escrow rules contract, Foundry: offer/agree hashes, funding via ERC-3009/Permit2, deliver, decide with adjudicator signature, permissionless triggers, key release events, bonds.
- [x] T-203 (PR 70) Invariant and fuzz tests: conservation, settle-once, no admin selectors.
- [x] T-204 (PR 66) Formal model of the commitment state machine (TLA+ or Quint): liveness under any single actor halting; safety of fund movement.
- [x] T-205 (PR 69) `Settlement` EVM implementation; `pnpm snap --settlement=local` green; differential report.
- [ ] T-206 (in review: `docs/reviews/2026-11-03-contract-review.md`, fixes in PRs 120, 122, 125, 127 and 135; the cross-family pass by DeepSeek is done (§8); deployed on Sepolia in PR 150; Rafa's read is open) Contract review: checklist plus a cross-family review; human gate.
- [ ] T-207 (in progress; stage 2a merged in PR 67; next, the adjudicator slice) Private deals, to make "private escrow" true end to end (Rafa, 2026-11-01). Today only the work is private: it is encrypted, and only the adjudicators and the paid buyer can open it. Terms, amounts, addresses and events are public reads. Build: read authentication (`ReadToken`) so only the parties and their adjudicators read a deal; private judgment records; disclosure levels enforced, not just recorded; commitment metadata private on unauthenticated reads (residual 9); amount privacy weighed with the D4 chain choice (confidential tokens or a privacy chain). Sources: ADR-0020, D13, D16, backlog Privacy. Needs an ADR and a schema version bump. Done when a third party reading any operator learns nothing about a deal beyond what its disclosure level allows, shown by a fixture. The later slices, including the end-to-end encrypted API, are in Phase 8.
- [ ] T-016b Testkit follow-ups from Phase 1: T-010's open rows (appeal, early accept, mutual settle, dispute and revoke steps; a second commitment per scenario; refusal overrides; offline operators), live recording against `config/judges-live.yaml` (`--judges live --record`, keys via `--env-file`), snapshot rendering items, and transcripts as snapshots (T-013 Handoff).
- [x] T-030 (PR 85) API agent-readiness batch (D39; `docs/reviews/2026-11-02-api-agent-review.md`): an agent with only HTTP, an EIP-712 signer and `llms.txt` completes a deal first try; simplify discovery, errors, nonces, timestamps, notices; planned routes answer 501; disclosure chosen explicitly; budget charged after the signature verifies.
- [x] T-031 Minimal telemetry for the MVP (D39): aggregate metrics and a 7-day request log, nothing beyond ADR-0024 §1; a quota alert. After T-030.
- [x] T-032 Feedback and issue reports, first slice (D39): `POST /v1/feedback`, `GET /v1/feedback/{id}`, a private store and a triage routine. After T-030.
- [ ] T-033 Schema v0.9 (ADR-0025, D38, D39): CPP funding schemes and token addresses, `allowedTokens` optional, `chainId` a number, `not_implemented`, the fee on receipts, the MIME allowlist moved to adjudicator capability.
- [ ] T-034 Faster CI and local verify (`docs/reviews/2026-11-02-dev-velocity.md`): cache the contracts build, job-level path filters with `check` and `gitleaks` still reporting, TLC only when the model changes, `pnpm verify --affected`, done derived from merges.
- [x] T-035 (PR 158) Fix the anvil gas-per-deal receipt stall at its root; sane test timeouts. The anvil world polls receipts with a deadline instead of viem's block-watching wait; the checkout slowdown is PR 159.
- [ ] T-036 Coordinator commands: `/merge-pr`, `/start-task`, `/deploy-demo`, `/deploy-site`, `/review-pr`, `/record-decision`, `/daily-log`, a session brief and two hooks.
- [x] T-037 (PR 114) One-approval test deal: the homepage prompt in a vanilla Claude Code asks for one approval, then a deal runs end to end. `examples/try.ts` plays both sides against the live demo with the HTTP-only agent; `site/build.mjs` bundles it to `https://escrow.stream/try.mjs`; one pinned, sha256-checked command heads `llms.txt` "Try it" and shows on the homepage.
- [x] T-038 Public docs cleanup: README leads with Crow, Apache-2.0 license, statuses and fixture indexes match the repo, no personal details (PR 110).
- [x] T-057 (PR 136) Demo adjudicator alarm only while a case awaits an adjudicator: no alarm for reads, cold starts or faucet grants; a slower cadence for a case no pass can finish; a fallback takeover armed at judgeBy (T-031's two backlog rows).
- [x] T-209 (PR 77) Beacon verification in `HoldbackRules` (BLS check of the drand value for fallback and appeal panel seeds, ADR-0018), split out of T-202. ADR-0025's schema follow-up (EVM funding signature and token identifiers) moved to T-033.
- [ ] T-210 Mirror T-206's appeal fixes in core and SimChain (H-1, H-2; M-3 recorded until Phase 4): bind every decision's attempt (H-1), and refuse an appeal key on a refunded deal (H-2).
- [ ] T-211 The reference adjudicator never seals the key for a refunded buyer (T-206 H-2), and declines fallback and appeal tasks outside its policy (T-206 M-3).
- [ ] T-212 Contract hardening from T-206's findings, before mainnet: bond vault deltas, the seed tag bound to the commitment, expiry from every deadline, the appeal adjudicator's coverage, the early-accept and decision delivery binding, the appeal slot (L-7) and a past `judgeBy` at funding (L-8). The overturn payout from the bond (I-8) moved in from Phase 4 and landed with L-7 (D43).
- [ ] T-213 (in progress) The public demo settles on Sepolia (D41, ADR-0028): the EVM adapter on a live testnet with relayer lanes, a `SETTLEMENT` flag per Worker, the world's storage without replay, the adjudicators' bonds on chain, ERC-3009 funding in prepare and `examples/verify.ts`; then the cutover after T-206 deploys.
- [ ] T-216 (in progress: the round's keys, `examples/e2e-keys.ts`, landed; the master holds 2.5 Sepolia ETH) Full EVM end-to-end test round 1 on Sepolia (Rafa's milestone, 2026-11-04; it brings back the benched PR 151 and T-206's read). Eleven scenarios on the fixed contracts, through the public API and by direct contract calls, each with Etherscan links: release, refund on reject, timeouts and the default outcome, fallback with a drand proof, escalation, appeals upheld and overturned through the API (the overturn paid from the first decider's bond, D43), the escape hatch, early accept, mutual settlement, and a restart mid-step. After T-217 to T-221 are live through T-220; two scope questions remain open in the task file (D46).
- [ ] T-217 drand quicknet proofs for fallback and appeal decisions on Sepolia (ADR-0028 §11): the adjudicator's `drand-quicknet` source with a local BLS check and no substitute, rounds per source in core, and the parse rule for chain settlement. After T-210 and T-211, which change two of its files.
- [ ] T-218 Direct contract calls in the operators' view (ADR-0028 §11): the world syncs HoldbackRules' logs from a stored cursor, so a step no operator relayed shows as `submittedVia: 'direct'`.
- [ ] T-219 An in-flight row per relayer lane, written before the broadcast, so a restart between broadcast and receipt applies the node's own transaction (seen at the T-213 cutover). After T-218.
- [ ] T-221 Adjudicator registration through the API (D46, ADR-0030 to come): a self-signed `AdjudicatorRegistration` at `POST /v1/adjudicators`, served with its signature and the bond read from chain, so any agent can bring its own adjudicator; the reference adjudicator's trust rule extends to the fallback role. Crow's three stay the defaults, and naming others is advanced use. Registrations are never removed and show when each was last used; an unbonded one is labelled and warned about, and a selection the terms cannot pay from a bond is refused (the contract half with the next redeploy). Round 1 uses it for overturned appeals and silent adjudicators. Schema 0.10, additive.
- [ ] T-220 Ship round 1's prerequisites to the live demo: one deploy of T-217 to T-219 and T-221, with a fresh Sepolia world whose rulebook names drand, on Rafa's go-ahead. The fixed contracts (PRs 160 and 161) are already live: the T-206 session redeployed them and cut the demo over on 2026-11-04, with Rafa's go-ahead.
- D4 decided: the target is Ethereum mainnet (2026-11-01), built and tested on a local chain, then on Sepolia, the public testnet the demo settles on since D41 (2026-11-03). Mainnet deployment is a separate gate for Rafa after an audit. Record gas per deal in the evidence.

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
- T-309 (later, with T-308; research; Rafa, 2026-11-03) Evaluate Airbender, an open-source RISC-V zkVM with a GPU prover, as the proving backend for ADR-0027. Can it prove judge-model inference at a cost that compares with FlashProve's? Does it fit the deterministic stages first: the checks, the screen's heuristics and aggregation? The task also covers on-chain verification on a local chain, pinning, the prover fixtures, and licence and maturity. Task file `docs/tasks/T-309-airbender-proving.md`.

## Phase 4: Adjudicator economics on the settlement layer

Goal: bonds, coverage, appeals, fallback and default outcomes run on the contract, with demo beat 8.

- Adjudicator registry with bonds and the coverage-ratio gate.
- `settle_after_window` with its own key-release design (ADR-0012) and resubmission.
- Appeal bonds (a minimum from the rulebook) and the appeal fee. Overturn payouts in guaranteed mode landed early, in T-212 (D43).
- Default outcome with seller compensation from bonds (D5).
- Adjudicator independence checks (affiliation declared at registration).

## Phase 5: Ramps, testnet, more operators

Goal: fiat enters and leaves through ramps; the demo runs on a public testnet with two independent operator nodes.

- Stablecoin direct funding (test token).
- [ ] **Next:** T-214 USD to USDC on-ramp in test mode (D42): the first wave's one funding path, a Stripe crypto on-ramp or Coinbase Onramp sandbox behind the funding service (ADR-0026), test keys from the environment only.
- Stripe test-mode on-ramp: a card payment mints test tokens to the buyer (D7). A simulated off-ramp.
- Testnet deployment (D4) and gas sponsorship or paymaster for agents.
- [ ] T-215 Gas share on small deals. *2026-11-04, on the 0.7 contracts (T-212's redeploy, measured from receipts):* a deal's three transactions take 1,636,242 gas (fund 938,593, deliver 173,119, decide 524,530), 4.9% more than below, for the delivery-hash slot; the 4.70 tUSDC quote was left as it is (it would round to 4.91 at the same fictional rate) for this task to replace. Measured on Sepolia (T-213, 2026-11-03, `eth_simulateV1` on the deployed contracts): a deal's three transactions take about 1.56 million gas (anvil had about 500k; Sepolia prices new state about 3.5 times higher), so the demo's minimum fee is 4.71 tUSDC (a 4.70 gas quote at the measured 1 gwei tip and a fictional 3,000 tUSDC/ETH, plus 0.01 relay), about 19% of a 25 tUSDC deal (D33, ADR-0023). Before mainnet: quote gas from live gas and token prices; credit or refund the unused part of the quote (an ADR-0023 amendment and a schema bump); set a published target share for small deals (proposed: under 1% at $25; Rafa decides); take the cheapest wins (the decision carrying the delivery by default, with the seller still free to post `deliver` (D37); relayer batching) and weigh Phase 7's "Minimise gas" and Phase 8's L2 or fragment options.
- Operator node packaging (container), so a second party can run op-2.
- Neutrality beat 7 on testnet.

## Phase 6: Interop and native compute

**Assets (parked, Rafa, 2026-11-03: "park it for later in a roadmap module about assets").** After the USDC-only first wave (D42):

- Other ERC-20 tokens, ETH and WETH, and dynamically extending which assets an escrow can hold (ADR-0026, D38).
- Token-issuer controls (for example a USDC freeze or blacklist of a party or fee receiver) and their effect on payouts and refunds; parked, because parties choose the token in their signed terms (D28, D32) (Rafa, 2026-11-03).

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

## Phase 8: Privacy end to end

Goal: a deal that chooses privacy keeps it from funding to payout, so operators, outsiders and chain readers learn no more than its parties choose to disclose (D35, D40; Rafa, 2026-11-03).

Appended after Phase 7 so no phase number or release moves. The number orders the list, not the start: each item starts once what it builds on exists (T-207's private deals in Phase 2 first), and the research items need a pass and an ADR before any build.

- Private deals after T-207's adjudicator slice (ADR-0024 §5–6; rows under Privacy in `docs/backlog.md`): fallback and appeal adjudicators get body envelopes time-locked to `judgeBy` and `appealBy` (with tlock, ADR-0018), and adjudicator keys are served by operators, anchored on chain and rotatable (`EncryptedKey.keyId`, which moves the EIP-712 domain).
- The end-to-end encrypted API, from T-207 (Rafa, 2026-11-01): the operator cannot read the deal either, as far as possible. Stage 2a (PR 67) already seals the terms bodies, so operators store and relay ciphertext and hashes, and adds a client-side prepare recipe. Left: shrinking the relay metadata an operator still sees (client IP and timing, who reads which deal, ciphertext sizes; `docs/reviews/2026-11-02-api-agent-review.md`).
- Private inference for judges (D35): an adjudicator may run its pinned judges through a provider that keeps no prompts or outputs (`providerPrivacy: zdr` with a named provider, such as Venice; ADR-0024), with two providers or one `local` seat per panel. The mandatory rules hold: pinned model IDs, at least two families, no tools, the verdict schema. Backlog row under "Judgment defenses".
- Unlinkable funding and private amounts (residual 11, `docs/neutrality.md`): a per-deal key funded from a known treasury is linked to it on chain, unless the funds come from a shielded pool or a fresh on-ramp account. That stays the agent's choice, never a protocol dependency (ADR-0024); the work is guidance for agents that want it and a check that such a deal settles unchanged. Amounts are public on chain in Phase 2 (D34); hiding them is one of D40's privacy-capable pieces (D16).
- Prividium fragment per escrow (T-208), parked (Rafa, 2026-11-03): a single-use Prividium fragment per escrow, with the assets kept in the L1 escrow. The research pass (PRs 79, 81, 82) found that the fragment's operator reads every deal and can halt it, and that one chain per escrow is not a supported shape, so it does not meet D4's 2026-10-31 bar. Findings, the optional probe and the questions for Matter Labs: `docs/research/prividium-fragment.md`. No task file.
- An agent-to-agent L2 fragment per escrow, verified with zero-knowledge proofs: independently checkable, almost no gas until the settlement proof is submitted. It keeps T-208's idea without the vendor, since any party may prove. Moved from Phase 7; needs a research pass and an ADR. Details in `docs/backlog.md` under "Far future".

## Phase 9: Infrastructure management

Goal: Rafa sees what building and running Crow costs across every provider, every account that can spend has a cap or an alert, and a runaway is caught within a day.

Appended after Phase 8, like it, so no phase number moves (Rafa, 2026-11-03). It needs nothing from Phases 3 to 8 or from the agent-ops phase: T-051 can start today. The inventory of cost sources and the monitoring design are in `docs/costs.md`. Billing figures stay out of the repository: reports, budgets and the account register live in a git-ignored cost directory, and billing credentials stay outside agent sessions, on a machine Rafa controls. Tasks are listed in dependency order; each is one PR.

- T-051 Cost guards on every account: Rafa's checklist of spend limits, budgets and alerts, in order and with links, and a private account register (infra; human gate).
- T-052 The read-only cost collector: one source module per billing or usage API, plus the local Claude Code transcripts, T-031's day lines (exported once, for T-042 too) and the Sepolia balances, writing a dated file in the cost directory (infra; human gate for the read-only credentials).
- T-053 The monthly cost report and unit costs: each provider against its budget, cost per demo deal, per merged PR and per task (infra).
- T-054 Anomaly rules and the CPU guard: a runaway agent, a spend spike, a cap or quota near, the relayer's funding lane running dry, paid usage that should be zero, a renewal or token expiry due; CPU limits per Worker from measured use (infra; human gate to deploy the limits).
- T-055 The daily routine, run from a dedicated clone on a machine Rafa controls with code he approved, and the channel that tells him when a rule fires or a run fails; its `cost-signals.json` holds rule names and no figure, for the agent-ops phase's telemetry lane (T-042) (infra; human gate).
- T-056 A budget for the planned costs: Stripe's live fees, the trademark, the external audit, mainnet gas and judges at volume (research; human gate for quotes).
- T-058 (later: after a working mainnet prototype; Rafa, 2026-11-03) Move `holdback` and the founders' private repository into a GitHub organization: Rafa creates a free organization with 2FA required and no default access; agents first replace the gitleaks action, which needs a license on organizations, then on his go-ahead transfer the repositories, check that protections, security settings and CI survived, set teams and roles (triage for outside contributors), and update links and remotes (infra; human gate). Not part of this phase's exit, though the design map shows Phase 9 open until it is done.

**Exit:**
- Every account in `docs/costs.md` that can spend has a cap or an alert, and every account has its renewal date, in the register (T-051, confirmed by Rafa).
- A month's report exists with each provider read by API or marked as entered by hand, and unit costs per demo deal and per merged PR (measured).
- Each anomaly rule fired on test data, and one test alert reached Rafa on his channel (measured).

## Phase 10: Agent operations

Goal: agent teams develop Crow continuously from tickets, agent feedback, the roadmap and usage telemetry, in an isolated environment with scoped credentials, under automated checks and cross-family review.

**Not active.** The design is in `agent-ops/` (PR 112), and `agent-ops/STATUS` reads `inactive`. No Phase 10 task starts until Rafa starts the phase. The pipeline runs only after T-050, which needs Rafa's go-ahead at each step. Appended after Phase 9, so no phase number moves. Tasks are listed in dependency order; each is one PR, except T-039's agent part, which is two.

- T-039 Isolated development environment: Rafa's checklist and the agents' scripts (infra; human gate). The checklist covers a VM or a Claude Code cloud environment, scoped tokens, spend caps and 2FA. The VM gets the agents' own GitHub Apps: a builder identity with no Workflows permission, and a separate reviewer identity. The scripts cover setup, one Unix user per role, key custody, a smoke test and prompt-free permissions.
- T-040 Agent-ops config loader and the model mix: `ops.yaml` validated, models pinned, rates in basis points, the GPT fallback chosen, the inert-pipeline test (infra).
- T-041 Intake, the quarantine and triage: tickets, agent feedback and CI signals become `TriageRecord`s through a triager with no tools, then tasks through the architect (infra; human gate for the first feedback export).
- T-042 The usage-telemetry lane: signal rules over T-052's day-line export, T-055's cost signals, and the website and onchain aggregates open records without a model (infra; human gate for Web Analytics and a social reader).
- T-043 Feedback requests at deal milestones for agents that opt in: an ADR, a schema version bump and two signal rules (api).
- T-044 Security gates: risk tiers with the gate-defining files in tier 3, guardrails (approval lines, ADR acceptance, Rafa's review on a raised PR), the shell guard, the proposed deny list, CODEOWNERS; none wired before activation (infra).
- T-045 The cross-family review check `xreview`: DeepSeek reviews tier 2 and 3 diffs blind, posted as a status that holds only under three stated preconditions (infra; human gate for live runs).
- T-046 Red-team and cross-family reviews at milestones: per-PR red team on tier 2, phase exits, ADRs, schema and judge-list changes, deploys; agreement and canary metrics (infra; human gate for live runs).
- T-047 The kill switch and observability: fail-closed switches, stop, alarms, the PR footer, per-tick metrics, the budget stop, daily pipeline figures (infra).
- T-048 Dispatch and lane ownership: task lint, briefs from task fields only, the stateless tick, branch claims, single writers (infra).
- T-049 CI cost and flake control for parallel lanes: the Known flakes list with expiry, one retry, lane pause; links T-034 to T-036 (infra).
- T-050 Activation, one reversible step at a time, each on Rafa's go-ahead (infra; human gate): review keys in an Environment, a required review by the reviewer's App, a tier 3 ruleset, tool limits, enforcement from a trusted checkout, triggers, a shadow week, one lane, then three.

**Exit:**
- `agent-ops/STATUS` reads `active` and the repository variable `AGENT_OPS` is `on`, both set by Rafa (T-050).
- One lane merged 10 PRs without a revert, then three lanes ran with the cross-family gates (measured in the daily log).
- No agent session can read a credential for Rafa's personal accounts (T-039 smoke test, measured).

## Scenario index

Status (2026-11-03, measured against `fixtures/scenarios/` and `pnpm snap`): **exists** is a fixture file that passes; **todo** is a `todo.` fixture that records a known gap and passes as a todo; **planned** has no file yet. The 27 fixtures on disk are 26 that exist plus 1 todo. Fixtures run on SimChain; Phase 2 also runs them on the contract (below).

| Fixture | Beat | Phase | Status |
| --- | --- | --- | --- |
| `happy-path` | 1–4 | 1 | exists |
| `bad-work-row-drop` | 5 | 1 | exists |
| `bad-work-panel-reject` | 5 | 1 | planned (needs real data) |
| `attack.injection-plain` | 6 | 1 | planned (needs real data) |
| `attack.injection-encoded-base64` | 6 | 1 | exists |
| `attack.injection-encoded-unicode-tags` | 6 | 1 | exists |
| `attack.injection-filter-abstain-appeal-default` | 6 | 1 | exists |
| `attack.injection-splits-appeal-to-default` | 6 | 1 | exists |
| `attack.injection-steers-appeal-supermajority` | 6 | 1 | exists |
| `attack.injection-steers-appeal-two-families` | 6 | 1 | exists |
| `attack.forced-stride-appeal-default` | — | 1 | exists |
| `attack.seller-equivocates-delivery` | — | 2 (ADR-0029, on SimChain and the contract) | exists |
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
| `error.submission-limit` | 5 | 1 | exists |
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
