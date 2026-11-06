# Plan

Iterative. Demo first, then harden one layer per phase. Each phase ends with evidence, a plan update and ADRs closed or deferred. Phases 0 to 2, 9, 10 and 11 have task files in `docs/tasks/`, and so do T-309 in Phase 3, T-221 in Phase 4, T-067, T-214, T-215, T-222, T-223 and T-224 in Phase 5, T-033 in Phase 6 and T-207 in Phase 8. T-016b and T-310, in Phase 3, have none yet. The architect writes later phases' task files at the start of each phase.

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

Focus (Rafa, 2026-11-06; D53, narrowed the same day by D54 after his walkthrough of Phase 2): finish stable EVM operations, which are round 1 (T-216), the join-on-chain-delivery fix, operator-sent timeouts, the read-after-write audit (T-232) and T-206's sign-off, done the same day (PR 227). Under D53, six open rows moved to later phases: T-207 to Phase 8, T-034 to Phase 9, T-036 to Phase 10, T-224 to Phase 5, T-016b to Phase 3 and T-033 to Phase 6. Under D54, three more moved: T-212 to Phase 11, T-221 to Phase 4 and the scenario 11 redesign to Phase 3 (T-310).

- [x] T-201 (PR 64; option A kept) Hands-on spike, on local anvil: can a rules contract act as operator of `AuthCaptureEscrow` (D3-A)? If not, design an ERC-8183 extension (D3-B). Must confirm the ADR-0003 conditions: capture timing per mode, expiry margin, fee-only capture on the refund path with `maxFeeBps = 10000`, idempotency in the rules contract; compare deployed bytecode with the v1.1.0 tag; read the audits.
- [x] T-202 (PR 68) Escrow rules contract, Foundry: offer/agree hashes, funding via ERC-3009/Permit2, deliver, decide with adjudicator signature, permissionless triggers, key release events, bonds.
- [x] T-203 (PR 70) Invariant and fuzz tests: conservation, settle-once, no admin selectors.
- [x] T-204 (PR 66) Formal model of the commitment state machine (TLA+ or Quint): liveness under any single actor halting; safety of fund movement.
- [x] T-205 (PR 69) `Settlement` EVM implementation; `pnpm snap --settlement=local` green; differential report.
- [x] T-206 (done 2026-11-06: `docs/reviews/2026-11-03-contract-review.md`, fixes in PRs 120, 122, 125, 127 and 135; the cross-family pass by DeepSeek is done (§8); deployed on Sepolia in PR 150; Rafa read it through the brief and confirmed its three items, PR 227) Contract review: checklist plus a cross-family review; human gate.
- [x] T-030 (PR 85) API agent-readiness batch (D39; `docs/reviews/2026-11-02-api-agent-review.md`): an agent with only HTTP, an EIP-712 signer and `llms.txt` completes a deal first try; simplify discovery, errors, nonces, timestamps, notices; planned routes answer 501; disclosure chosen explicitly; budget charged after the signature verifies.
- [x] T-031 Minimal telemetry for the MVP (D39): aggregate metrics and a 7-day request log, nothing beyond ADR-0024 §1; a quota alert. After T-030.
- [x] T-032 Feedback and issue reports, first slice (D39): `POST /v1/feedback`, `GET /v1/feedback/{id}`, a private store and a triage routine. After T-030.
- [x] T-035 (PR 158) Fix the anvil gas-per-deal receipt stall at its root; sane test timeouts. The anvil world polls receipts with a deadline instead of viem's block-watching wait; the checkout slowdown is PR 159.
- [x] T-037 (PR 114) One-approval test deal: the homepage prompt in a vanilla Claude Code asks for one approval, then a deal runs end to end. `examples/try.ts` plays both sides against the live demo with the HTTP-only agent; `site/build.mjs` bundles it to `https://escrow.stream/try.mjs`; one pinned, sha256-checked command heads `llms.txt` "Try it" and shows on the homepage.
- [x] T-038 Public docs cleanup: README leads with Crow, Apache-2.0 license, statuses and fixture indexes match the repo, no personal details (PR 110).
- [x] T-057 (PR 136) Demo adjudicator alarm only while a case awaits an adjudicator: no alarm for reads, cold starts or faucet grants; a slower cadence for a case no pass can finish; a fallback takeover armed at judgeBy (T-031's two backlog rows).
- [x] T-209 (PR 77) Beacon verification in `HoldbackRules` (BLS check of the drand value for fallback and appeal panel seeds, ADR-0018), split out of T-202. ADR-0025's schema follow-up (EVM funding signature and token identifiers) moved to T-033.
- [x] T-210 (PR 173) Mirror T-206's appeal fixes in core and SimChain (H-1, H-2; M-3 recorded until Phase 4): bind every decision's attempt (H-1), and refuse an appeal key on a refunded deal (H-2).
- [x] T-211 (PR 175) The reference adjudicator never seals the key for a refunded buyer (T-206 H-2), and declines fallback and appeal tasks outside its policy (T-206 M-3).
- [x] T-213 (done: the demo settles on Sepolia since 2026-11-03, about 16:32 UTC) The public demo settles on Sepolia (D41, ADR-0028): the EVM adapter on a live testnet with relayer lanes, a `SETTLEMENT` flag per Worker, the world's storage without replay, the adjudicators' bonds on chain, ERC-3009 funding in prepare and `examples/verify.ts`; then the cutover after T-206 deploys.
- [ ] T-216 (review: the two live runs of 2026-11-05 evening passed 1, 2, 3a, 3c, 3d, 4 and 5a; PR 223 fixes the three driver defects they found (3b's bond deposit simulated before a node saw its approval, money checks that counted another deal of the same buyer or seller, and the gate after 5a reading a refunded deal as Escalated) and lets one run of the round's keys go at a time; next is Rafa's live run of 3b, 4, 5a, 5b, 6, 7, 8, 9, 10a, 10b and 11; the report is `docs/reviews/2026-11-04-evm-e2e-round-1.md`) Full EVM end-to-end test round 1 on Sepolia (Rafa's milestone, 2026-11-04; it brings back the benched PR 151 and T-206's read). Eleven scenarios on the fixed contracts, through the public API and by direct contract calls, each with Etherscan links: release, refund on reject, timeouts and the default outcome, fallback with a drand proof, escalation, appeals upheld and overturned through the API (the overturn paid from the first decider's bond, D43), the escape hatch, early accept, mutual settlement, and a restart mid-step. Scenarios 1, 2, 3a, 3d and the first half of 10 need no prerequisite; the rest wait for T-217 to T-221, live through T-220. Rafa answered all six scope questions (D46).
- [x] T-217 drand quicknet proofs for fallback and appeal decisions on Sepolia (ADR-0028 §11): the adjudicator's `drand-quicknet` source with a local BLS check and no substitute, rounds per source in core, and the parse rule for chain settlement. Done in PR 186; live with T-220; its security findings are T-225 (Phase 11).
- [x] T-218 Direct contract calls in the operators' view (ADR-0028 §11): the world syncs HoldbackRules' logs from a stored cursor, so a step no operator relayed shows as `submittedVia: 'direct'`.
- [x] T-219 (merged in PR 195; live with T-220's deploy) An in-flight row per relayer lane, written before the broadcast, so a restart between broadcast and receipt applies the node's own transaction (seen at the T-213 cutover). After T-218.
- [x] T-226 (merged in PR 200; live with T-220's deploy) A relayed call's checks read at its receipt's block: an RPC node a block behind can no longer drop the call's events, the fix for round 1's lost delivery (T-216, Medium)
- [x] T-220 (done: PR 204 merged and deployed on 2026-11-05 at 11:04 UTC, holdback-op1 `1d8a029c`, holdback-op2 `a042aae3`, crow-site `704bd295`) Ship round 1's prerequisites to the live demo: one deploy of T-217 to T-219 and T-221, in which the Sepolia world's rulebook changes in place to name drand (D49: one long-lived world), on Rafa's go-ahead. The fixed contracts (PRs 160 and 161) are already live: the T-206 session redeployed them and cut the demo over on 2026-11-04, with Rafa's go-ahead.
- [x] T-229 (done: PR 209 merged and deployed on 2026-11-05 at 15:58 UTC, crow-site `4f049eb5`) One approval from the homepage prompt, the first step of One-Click Escrow (D51): the copy button copies a prompt that carries the one command, and `llms.txt` "Try it" stops inviting a fetch of `try.mjs` first. Measured before: 4 approvals per deal, Released in about 93 s. Measured after: 1 approval per deal in both permission modes, Released in 79 s and 106 s. The seller-first path, a standing test buyer (T-222's second slice), is the next gap.
- [x] T-231 (done: merged in PR 230, 2026-11-06; Rafa approved it: "Spin it up"; not deployed yet: its own operator deploy follows T-230's, on Rafa's go-ahead) The operators send due timeouts on their own, so every deal on the Sepolia demo reaches its end with no one coming back: the reclaim, the default (with the takeover it needs once a silent fallback's `fallbackBy` passes), the appeal expiry and an accepted offer's expiry, at the relayer's gas, through the trigger route's relay path, a deal behind the chain included. The contract checks each at a pinned block first; a cap per pass, a daily budget and a back-off per deal guard the gas; a party's trigger after the operators' answers the state it left. T-228's leftover. Task file `docs/tasks/T-231-operator-timeouts.md`.
- [x] T-230 (done: merged in PR 232, 2026-11-06; Rafa approved it: "Spin it up"; deployed 2026-11-06 on Rafa's go-ahead: holdback-op1 `8bcda43c`, holdback-op2 `7e4d3fa5`, crow-site `16038434`) The join-on-chain-delivery fix: the operators join a delivery that is already on chain. Round 1's scenario 8 on Sepolia: the seller delivered directly and posted the same signed delivery before the operators' pass had read it; the operator's RPC node trailed the chain, its relay reverted, and the copy was dropped, so the deal sat `Delivered` with no envelopes for the adjudicators. The fix reads `deliveryHashOf` before relaying and again at a reverted relay's block, joins a match with no relay, and keeps a signed match it cannot join yet for the next pass. No contract or schema change. Scenario 8 reruns next (an exit criterion below).
- [ ] T-232 (todo: starts once the join-on-chain-delivery and operator-timeouts PRs merge, which edit the same relay code; Rafa, 2026-11-06: "Yes, queue it"; D54) Read-after-write audit: find every chain read right after a write that a lagging publicnode server could answer, across the operators, the adjudicator, the faucet, the test seller, `try.mjs` and the examples, and pin or retry each one, with a lint or test check if one is feasible. The stale read has come back five times: T-226's lost delivery, round 1's 3d and 10a, 3b's bond deposit, T-228's stale receipt read and scenario 8's race. Task file `docs/tasks/T-232-read-after-write-audit.md`.
- D4 decided: the target is Ethereum mainnet (2026-11-01), built and tested on a local chain, then on Sepolia, the public testnet the demo settles on since D41 (2026-11-03). Mainnet deployment is a separate gate for Rafa after an audit. Record gas per deal in the evidence.

Out of Phase 2 by D54 (Rafa's walkthrough, 2026-11-06): T-212 moved to Phase 11, for the contract redeploy before mainnet; the scenario 11 redesign moved to Phase 3, as T-310; and T-221 moved to Phase 4, paused until the centralized adjudicator is stable. Phase 2 closes on Sepolia without a contract redeploy, because a new rules contract needs a new demo world (D49).

**Exit:**
- Round 1: every scenario passes live on Sepolia, with finality clean on every run. Scenario 11 counts by its coverage (D54, item 1). *2026-11-06: 14 of 16 passed live (1, 2, 3a, 3b, 3c, 3d, 4, 5a, 5b, 6, 7, 9, 10a and 10b), 11 counts by coverage, and 8 waits for the join fix.*
- The join-on-chain-delivery fix is deployed, and scenario 8 passes on rerun.
- Operator-sent timeouts are deployed.
- The read-after-write audit (T-232) is done, with its fixes merged.
- T-206 is closed: Rafa's read of the brief and his three confirmations are recorded. *Met: Rafa confirmed all three in chat on 2026-11-06, and PR 227 (`edc8311`) recorded them and set T-206 to done.*
- Gas per deal is recorded, as D4 requires. *T-066's metrics measure about 1.26 million gas for a deal's own transactions.*
- No High or Critical finding is open in Phase 2's code.

## Phase 3: Judgment hardening

Goal: judgment metrics measured against the PRD targets. Defenses complete.

- T-301 Calibration and red-team fixture generators (about 40 plus 20 cases) and the `pnpm calibrate` harness and report.
- T-016b Testkit follow-ups from Phase 1: T-010's open rows (appeal, early accept, mutual settle, dispute and revoke steps; a second commitment per scenario; refusal overrides; offline operators), live recording against `config/judges-live.yaml` (`--judges live --record`, keys via `--env-file`), snapshot rendering items, and transcripts as snapshots (T-013 Handoff). Todo; moved from Phase 2 on 2026-11-06 by D53: its testkit steps and live judge recordings serve this phase's calibration, and round 1 (T-216) already tests appeals, early accept and mutual settlement live on Sepolia.
- T-302 Reader extraction with a typed feature schema.
- T-303 Classifier screen and the normalization pipeline (Unicode tags, zero-width characters, encodings).
- T-304 Sealed checks: commit at agreement, reveal at judging, weight cap.
- T-305 Registry promotion workflow and registry log; regression on model-ID change.
- T-306 Fee quotes from measured error rates; quote endpoint.
- [x] T-307 Live demo mode (`pnpm demo --live`) with two or three model families. Done by T-028 (PR 62): two families, Anthropic and DeepSeek.
- T-308 (later; research pass and ADR-0027, Proposed, 2026-11-03; Rafa, 2026-11-03) The adjudicator reports its whole judgment end to end (each check, each judge's full reasoning, the aggregation) with provable inference (zkSNARK proofs bound to a commitment to each judge's weights, as in Anthropic's FlashProve) that the pinned models produced it, and auto-tunes its judgment parameters from measured outcomes in a continuous loop, shipping each change only as a new registry version or policy bound in new commitments. Detail and limits in `docs/backlog.md` under "Judgment defenses".
- T-309 (later, with T-308; research; Rafa, 2026-11-03) Evaluate Airbender, an open-source RISC-V zkVM with a GPU prover, as the proving backend for ADR-0027. Can it prove judge-model inference at a cost that compares with FlashProve's? Does it fit the deterministic stages first: the checks, the screen's heuristics and aggregation? The task also covers on-chain verification on a local chain, pinning, the prover fixtures, and licence and maturity. Task file `docs/tasks/T-309-airbender-proving.md`.
- T-310 (todo; moved from Phase 2 on 2026-11-06 by D54, Rafa: "Accept, move redesign") Redesign round 1's scenario 11, a restart between broadcast and receipt, so a live redeploy fits inside the gap. Round 1 counts scenario 11 as covered by T-219's offline tests, T-220's Sepolia fork rehearsal, T-228's live deploy and the live run of 2026-11-06, which passed 12 of 13 checks. The failed check needs holdback-op1's redeploy to land within about 12 s, one Sepolia block, and the redeploy by hand took 67 s. The redesign gives the restart minutes, for example by holding the relayed transaction out of a block until the redeploy lands. It tests the operators' restart recovery, not judgment: it sits here, the next phase in release v0.1, so that Phase 2 can close without it. No task file yet.

## Phase 4: Adjudicator economics on the settlement layer

Goal: bonds, coverage, appeals, fallback and default outcomes run on the contract, with demo beat 8.

- Adjudicator registry with bonds and the coverage-ratio gate.
- [ ] T-221 (paused: deferred until the centralized adjudicator is stable; moved from Phase 2 on 2026-11-06 by D54. Rafa: "Defer, external adjudicators is a future service that we can build but only once current and centralized adjudicator is stable". It sits in this phase because outside adjudicators bring their own bonds, and this phase puts the adjudicator registry, bonds, coverage and appeals on the contract. Slices 1 and 2 stay live as they are: PR 184 and PR 202, deployed with T-220. Left: a red-team pass on the review's fixes, the DeepSeek cross-family review, and the CI line for `apps/demo-cloud/src/registration.anvil.test.ts`, a `.github/` change for Rafa) Adjudicator registration through the API (D46, ADR-0030): a self-signed `AdjudicatorRegistration` at `POST /v1/adjudicators`, served with its signature and the bond read from chain, so any agent can bring its own adjudicator; the reference adjudicator's trust rule extends to the fallback role. Crow's three stay the defaults, and naming others is advanced use. Registrations are never removed and show when each was last used; an unbonded one is labelled and warned about, and a selection the terms cannot pay from a bond is refused (the contract half goes with T-212's redeploy in Phase 11). Round 1 used it for overturned appeals and silent adjudicators. Schema 0.10, additive.
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
- [ ] T-224 (parked by Rafa, 2026-11-05; moved from Phase 2 on 2026-11-06 by D53: round 1's appeals run without it, with the appellant's own Sepolia ETH, and an appeal by an agent with no ETH of its own is a case of this phase's gas sponsorship for agents) Appeal bonds by a relayed permit (D48): `prepare/appeal` returns an EIP-2612 `Permit` slot under the token's domain, and the operator relays `permit` and `fileAppeal` in one Multicall3 call. A visitor's agent then appeals with no Sepolia ETH of its own. No contract change; the same path on USDC.
- [x] T-222 (deployed 2026-11-04) Crow's standing test seller on the Sepolia test environment (D47): its own Worker at `escrow.stream/agents/test-seller`, a party that uses the public API like any agent, sells `try.mjs`'s dataset from one standing address, and refunds on request; `node try.mjs --seller <url>` plays only the buyer. The test buyer follows (backlog).
- [x] T-223 (merged in PR 191; deployed with T-220 on 2026-11-05) The demo faucet renews an address's mandate: every grant signs a fresh 30-day mandate in place of the old one, so the standing test seller keeps offering past its first 30 days (D47).
- Operator node packaging (container), so a second party can run op-2.
- Neutrality beat 7 on testnet.
- [ ] T-067 (todo; deferred until after stable EVM operations, Rafa, 2026-11-06: "We can do that later but you should add a ticket for it." It sits in this phase because both surfaces it updates still show the demo before it ran on a public testnet, which is this phase's goal, and D53 keeps work outside stable EVM operations out of Phase 2) The homepage's background animation of API calls shows the live API, and the recorded demo runs again on Sepolia (Rafa, 2026-11-06). The animation's two code streams come from the SimChain case study: this task gives them the live paths, fields, states, amounts and order of a deal with Crow's test seller, with a check in `site/check.mjs` that fails when they drift. The recorded demo replays a SimChain deal of 2026-11-02 at `/visualdemo`. Per Rafa ("assuming stranger uses the testnet version with their own contract terms"), a stranger's agent sets its own terms through the public API and settles on Sepolia, with no One-Click flow. A recording script joins the repository, and a new recording follows Rafa's go-ahead. No API change. Task file `docs/tasks/T-067-homepage-animation-and-demo.md`.

## Phase 6: Interop and native compute

**Assets (parked, Rafa, 2026-11-03: "park it for later in a roadmap module about assets").** After the USDC-only first wave (D42):

- Other ERC-20 tokens, ETH and WETH, and dynamically extending which assets an escrow can hold (ADR-0026, D38).
- [ ] T-033 (todo; moved from Phase 2 on 2026-11-06 by D53: not done on main, and the demo has funded through ERC-3009 on Sepolia since 2026-11-03 without it; its fixtures, a non-USDC ERC-20 through Permit2 and a WETH deal, belong with the assets above. Schemas 0.9 and 0.10 shipped without these items, so they need their own version bump; the `not_implemented` problem already ships) Schema v0.9's additive items (ADR-0025, D38, D39): CPP funding schemes and token addresses, `allowedTokens` optional, `chainId` a number, `not_implemented`, the fee on receipts, the MIME allowlist moved to adjudicator capability.
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

Appended after Phase 7 so no phase number or release moves. The number orders the list, not the start: each item starts once what it builds on exists (T-207's private deals first), and the research items need a pass and an ADR before any build.

- [ ] T-207 (paused; stage 2a merged in PR 67; the adjudicator slice is next, not started; moved from Phase 2 on 2026-11-06 by D53: private deals are not needed for a stable demo on Sepolia) Private deals, to make "private escrow" true end to end (Rafa, 2026-11-01). Today only the work is private: it is encrypted, and only the adjudicators and the paid buyer can open it. Terms, amounts, addresses and events are public reads. Build: read authentication (`ReadToken`) so only the parties and their adjudicators read a deal; private judgment records; disclosure levels enforced, not just recorded; commitment metadata private on unauthenticated reads (residual 9); amount privacy weighed with the D4 chain choice (confidential tokens or a privacy chain). Sources: ADR-0020, D13, D16, backlog Privacy. Needs an ADR and a schema version bump. Done when a third party reading any operator learns nothing about a deal beyond what its disclosure level allows, shown by a fixture. The later slices, including the end-to-end encrypted API, are the rows below.
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
- T-034 (todo; moved from Phase 2 on 2026-11-06 by D53: CI speed is infrastructure, not stable EVM operations) Faster CI and local verify (`docs/reviews/2026-11-02-dev-velocity.md`): cache the contracts build, job-level path filters with `check` and `gitleaks` still reporting, TLC only when the model changes, `pnpm verify --affected`, done derived from merges.
- T-058 (later: after a working mainnet prototype; Rafa, 2026-11-03) Move `holdback` and the founders' private repository into a GitHub organization: Rafa creates a free organization with 2FA required and no default access; agents first replace the gitleaks action, which needs a license on organizations, then on his go-ahead transfer the repositories, check that protections, security settings and CI survived, set teams and roles (triage for outside contributors), and update links and remotes (infra; human gate). Not part of this phase's exit, though the design map shows Phase 9 open until it is done.
- T-060 (done: deployed 2026-11-04 as crow-console `c8fe44c5`) Crow Control shows the status of Crow's service dependencies (Rafa, 2026-11-04): Cloudflare, GitHub, Anthropic, DeepSeek, npm, the Sepolia RPC providers and drand. The hourly build fetches each provider's published status, and the Status box shows it mapped to the Crow components it affects. An alert names a dependency's incident as the likely cause, as when GitHub Actions skipped two hourly refreshes on 2026-11-04.
- T-066 (paused: partly done; the rest deferred until after stable EVM operations, Rafa, 2026-11-06. Live: the metrics scripts, PR 215, and the console's headline metrics, crow-private PRs 2 and 3, deployed as crow-console `91ae8a90`. Deferred: the One-Click harness, PR 217, and the discovery fields, PR 216, both draft; where the harness runs; the Cloudflare read token) Crow Control from primary sources, with five headline metrics (Rafa, 2026-11-05): every console section read by script from the system that owns the fact (GitHub, git, the operators' public event log, Sepolia, the live config), with model-written text kept only as labelled notes; and approvals per honest deal (One-Click Escrow, target 1), cost per deal in USD at Opus 5.5 list prices and medium effort, Crow's processing time, throughput limits, and Crow's own operating cost per deal beside the operator fee (infra, api; human gate for where the harness runs, any new secret or schedule, and the deploys).
- T-068 (todo; deferred until after stable EVM operations, Rafa, 2026-11-06: "Move daily one-click measurements to infrastructure management phase") A daily cloud run measures One-Click Escrow, so the measurement never needs Rafa's Mac: approvals per honest deal from the homepage prompt in a fresh Claude Code, USD per deal at Opus 5.5 list prices and medium effort, and time to Released. A holdback GitHub Actions workflow runs before Crow Control's 07:07 Berlin build and skips the day when nothing but docs changed since the last measured commit. Its measure job runs T-066's harness (PR 217) with a capped Anthropic key from a main-only environment, and uploads the run file as an artifact, which the console's build fetches with its read token. About USD 2 to 4 a month (guessed). It needs PR 217 merged with its review findings fixed (infra; human gate for the key and the environment, the `.github/` merge and the first forced run; a red team on key isolation, fork pull requests and artifact poisoning). Task file `docs/tasks/T-068-daily-one-click-measurement.md`.

**Exit:**
- Every account in `docs/costs.md` that can spend has a cap or an alert, and every account has its renewal date, in the register (T-051, confirmed by Rafa).
- A month's report exists with each provider read by API or marked as entered by hand, and unit costs per demo deal and per merged PR (measured).
- Each anomaly rule fired on test data, and one test alert reached Rafa on his channel (measured).

## Phase 10: Agent operations

Goal: agent teams develop Crow continuously from tickets, agent feedback, the roadmap and usage telemetry, in an isolated environment with scoped credentials, under automated checks and cross-family review.

**Not active.** The design is in `agent-ops/` (PR 112), and `agent-ops/STATUS` reads `inactive`. No Phase 10 task starts until Rafa starts the phase. The pipeline runs only after T-050, which needs Rafa's go-ahead at each step. Appended after Phase 9, so no phase number moves. Tasks are listed in dependency order; each is one PR, except T-039's agent part, which is two. Rafa's two amendments of 2026-11-05 added T-061 to T-064 (`docs/research/2026-11-05-simulation-and-watch.md`), and their Activation steps (5b to 9b in `agent-ops/README.md`) join T-050's run.

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
- T-036 (todo; moved from Phase 2 on 2026-11-06 by D53: coordinator tooling is agent operations, not stable EVM operations, so it waits, like this phase, for Rafa to start it) Coordinator commands: `/merge-pr`, `/start-task`, `/deploy-demo`, `/deploy-site`, `/review-pr`, `/record-decision`, `/daily-log`, a session brief and two hooks. It uses T-034's CI shape in Phase 9.
- T-049 CI cost and flake control for parallel lanes: the Known flakes list with expiry, one retry, lane pause; links T-034 to T-036 (infra).
- T-061 Usage simulation, the scripted tier (Rafa, 2026-11-05): catalogue v2 with jobs, variants, thirteen profiles, four frameworks and pairings with expectations; per-PR worlds on SimChain, anvil and workerd; the `simulate` check as the fourth required status, inert until T-050 (test, with infra).
- T-063 Production bug crawlers (Rafa, 2026-11-05): a visitor-like process on the VM probes the live demo every 30 minutes and plays a deal every 8 hours with the one command from `llms.txt`, then files deduplicated TriageRecords with a likely cause; its `--once` mode is the post-deploy smoke test (demo, with api and infra; human gate for the timer, the synthetic header and the weekly probes).
- T-064 Security watch and targeted audits from market security events (Rafa, 2026-11-05): an allowlisted watchlist, deterministic matching to the lockfile and contract libraries, a threat map, red-team audits that add `attack.*` fixtures or a private fix, every security record to Rafa's channel, weekly integrity checks (infra, with test; human gate for Dependabot, the channel and live runs).
- T-062 Usage simulation, the model tier and the market-feedback loop (Rafa, 2026-11-05): the stager on the VM with model-driven customers from three families, a nightly baseline, the reviewer's PASS precondition for tier 2, the `catalogue` route and weights from aggregates, and the shared Sepolia staging world before each deploy (test and infra; human gate for the staging world, other-family keys and nightly staging).
- T-050 Activation, one reversible step at a time, each on Rafa's go-ahead (infra; human gate): review keys in an Environment, a required review by the reviewer's App, a tier 3 ruleset, tool limits, enforcement from a trusted checkout, triggers, a shadow week, one lane, then three.

**Exit:**
- `agent-ops/STATUS` reads `active` and the repository variable `AGENT_OPS` is `on`, both set by Rafa (T-050).
- One lane merged 10 PRs without a revert, then three lanes ran with the cross-family gates (measured in the daily log).
- No agent session can read a credential for Rafa's personal accounts (T-039 smoke test, measured).

## Phase 11: Security hardening

Goal: the systems that run Crow, beyond the protocol, hold up against an attacker: the founders' console, the accounts and keys behind the demo, and the paths by which code reaches them.

Appended after Phase 10, so no phase number moves (Rafa, 2026-11-04: "let's move this to security hardening phase"). Contract hardening moved here from Phase 2 on 2026-11-06 (T-212, D54), judgment hardening stays in Phase 3, and the agent-ops security gates in Phase 10 (T-044). Tasks are listed in dependency order.

- T-059 (in progress: live since 2026-11-04; the passcode retired on 2026-11-05; Michael's confirmation, 24 hours of hourly runs and a red-team pass remain) The founder console on its own host behind Access (D45): finish the move from the passcode console at `escrow.stream/control` to `control.escrow.stream` behind Cloudflare Access, with the hourly and daily pushes. The code, its tests and two red-team rounds are done; Rafa's setup steps and the deploys remain (infra; human gate).
- [ ] T-225 Harden the drand quicknet path: the security findings of T-217's review and red team (PR 186), moved here so T-217 ships the functional path first (Rafa, 2026-11-04). The fallback's round published before the primary's deadline (core and contract together, with a redeploy; human gate), the cost of a relay outage to a pass, a relay answer's size, SimChain with a drand club, and smaller checks. The tests that prove them wait in the session notes.
- [ ] T-227 The operators' adjudicators act on a deal behind the chain: residual 13 of `docs/neutrality.md`, from T-218's review and red team (PR 185), placed here so T-220 deploys first (Rafa, 2026-11-05, D50). Anyone who resends a copied signed step through a contract that transforms its calldata leaves the operators' view behind `dealOf`, so their adjudicators skip the deal and it ends by its timeouts; it costs only gas. The fix: the adjudicators read `dealOf`'s stage, and a relay path records the receipt without the core mirror. It also closes two gaps for real use: a contract signer's step (ERC-1271) and two signed steps in one transaction. Before mainnet; red team required.
- [x] T-228 (done: merged in PR 207; deployed 2026-11-05 at 15:29 UTC, holdback-op1 `ba7a2ad9`, holdback-op2 `7826e3ce`; record PR 211) The operators close a deal behind the chain by its timeout: split out of T-227 (Rafa, 2026-11-05). Today the operators refuse every relay for such a deal, timeouts included, so a visitor with no Sepolia ETH cannot close it. The fix relays a timeout for a deal behind: the contract checks it against `dealOf` and the deadlines, a timeout that is not due is not sent, and the state read shows the contract's stage.
- [ ] T-212 (paused; moved from Phase 2 on 2026-11-06 by D54, Rafa: "Move it to Phase 11"; items 3, 7 and 9 merged) Contract hardening from T-206's findings, before mainnet: bond vault deltas, the seed tag bound to the commitment, expiry from every deadline, the appeal adjudicator's coverage, the early-accept and decision delivery binding, the appeal slot (L-7) and a past `judgeBy` at funding (L-8). The overturn payout from the bond (I-8) moved in from Phase 4 and landed with L-7 (D43). Its open items 1, 2, 4, 5, 6 and 8 are the contract redeploy before mainnet, bundled with the other contract changes that wait for one: T-225's drand hardening, T-227's contract part and T-221's contract-side bond refusal. A new rules contract needs a new demo world (D49), so Phase 2 closes on Sepolia without it.

**Exit:**
- Both founders open the console at `control.escrow.stream` through Access and see Costs and Keys, and the shared passcode is retired (T-059, confirmed by Rafa).
- A red-team pass against the deployed console finds no High or Critical finding (measured).

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
| `attack.untrusted-appeal-adjudicator-via-fallback` | — | 2 | exists as a named test, not a fixture (T-221, ADR-0030 §6): `apps/adjudicator/src/service.test.ts`. An outside primary names Crow's fallback under an appeal adjudicator it controls; the fallback neither triggers nor decides, the deal defaults at fallbackBy, and no bond moves |
| `attack.outside-primary-rotates-policy` | — | 2 | exists as a named test, not a fixture (T-221 review of PR 202, ADR-0030 §6): `apps/adjudicator/src/service.test.ts`, and on anvil in `apps/demo-cloud/src/registration.anvil.test.ts`. An outside primary registers another policy after agreement; Crow's appeal adjudicator and fallback still judge by the policy the terms bound, read by its hash, so the wrong decision is overturned from the primary's bond |
| `appeal-bad-key-release` | 8 | 1 | planned (T-016b) |
| `neutrality.club-revokes-mid-flight` | 7 | 1 | planned (needs run-time revocation; SimChain reads members from genesis) |
| `neutrality.buyer-silent` | 7 | 1 | exists |
| `neutrality.seller-withholds-delivery` | 2 | 1 | exists (the planned `reclaim-no-delivery`) |
| `todo.provider-outage` | 7 | 1 | todo (becomes `neutrality.provider-outage`) |
| `neutrality.beacon-relay-refuses` | — | 2 | exists as a named test, not a fixture (T-217): `apps/adjudicator/src/drand.test.ts` and `service.test.ts`. When one relay refuses or lies, the source asks the next; when all refuse, the service signs nothing and tries again at a later pass |
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

Some neutrality and error cases are named tests rather than scenario files: `neutrality.operator-fee-direct-submission-free` (`apps/operator/src/fee.test.ts`), `neutrality.operator-rate-limits` (`apps/operator/src/neutrality.test.ts`), `neutrality.operator-lies-in-prepare` (`examples/verify.test.ts`) and `neutrality.operator-refuses-on-chain` (`packages/settlement/evm/sync.test.ts`: the operator refuses to relay after funding, the parties submit to the contract directly, and the view shows every step, T-218).

Phase on contract (T-205): every existing fixture without an "on contract" note also runs on the contract from Phase 2 (`pnpm snap --settlement=local`). The three marked 4 are the printed exclusion list in `packages/testkit/src/runner.ts` (`LOCAL_EXCLUSIONS`). The per-fixture differences are in `reports/differential-local.md` (tracked, though `reports/` is otherwise git-ignored).
