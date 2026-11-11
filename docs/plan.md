# Plan

Iterative. Demo first, then harden one layer per phase. Each phase ends with evidence, a plan update and ADRs closed or deferred. This public plan covers the current build and its record: Phases 0 to 2, whose tasks have files in `docs/tasks/`. Later phases are planned privately (Future work, below).

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

Focus (Rafa, 2026-11-06; D53, narrowed the same day by D54 after his walkthrough of Phase 2): finish stable EVM operations, which are round 1 (T-216), the join-on-chain-delivery fix, operator-sent timeouts, the read-after-write audit (T-232) and T-206's sign-off, done the same day (PR 227). Under D53, six open rows moved to later phases: T-207 to Phase 8, T-034 to Phase 9, T-036 to Phase 10, T-224 to Phase 5, T-016b to Phase 3 and T-033 to Phase 6. Under D54, three more moved: T-212 to Phase 11, T-221 to Phase 4 and the scenario 11 redesign to Phase 3 (T-310). Later on 2026-11-06 Rafa added two rows for the operators' deploys, T-233 and T-234 ("Yes, do both"): the Worker's start-up time, and a deploy check that rolls back on its own. Neither is among D54's seven exit criteria below.

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
- [x] T-216 (done 2026-11-07, under D55: Rafa accepted the passes across three operator builds, "Accept passes as is". 15 of 16 scenarios passed live on Sepolia, the last scenario 8 at 15:35 UTC with the join fix, 25 of 25 checks; 11 counts by its coverage (D54). The finality re-read at 21:05 UTC found all 153 recorded deal transactions of the 8 runs in their recorded blocks. The report, `docs/reviews/2026-11-04-evm-e2e-round-1.md`, shows every run, PR 241) Full EVM end-to-end test round 1 on Sepolia (Rafa's milestone, 2026-11-04; it brings back the benched PR 151 and T-206's read). Eleven scenarios on the fixed contracts, through the public API and by direct contract calls, each with Etherscan links: release, refund on reject, timeouts and the default outcome, fallback with a drand proof, escalation, appeals upheld and overturned through the API (the overturn paid from the first decider's bond, D43), the escape hatch, early accept, mutual settlement, and a restart mid-step. Scenarios 1, 2, 3a, 3d and the first half of 10 need no prerequisite; the rest wait for T-217 to T-221, live through T-220. Rafa answered all six scope questions (D46).
- [x] T-217 drand quicknet proofs for fallback and appeal decisions on Sepolia (ADR-0028 §11): the adjudicator's `drand-quicknet` source with a local BLS check and no substitute, rounds per source in core, and the parse rule for chain settlement. Done in PR 186; live with T-220; its security findings are T-225 (Phase 11).
- [x] T-218 Direct contract calls in the operators' view (ADR-0028 §11): the world syncs HoldbackRules' logs from a stored cursor, so a step no operator relayed shows as `submittedVia: 'direct'`.
- [x] T-219 (merged in PR 195; live with T-220's deploy) An in-flight row per relayer lane, written before the broadcast, so a restart between broadcast and receipt applies the node's own transaction (seen at the T-213 cutover). After T-218.
- [x] T-226 (merged in PR 200; live with T-220's deploy) A relayed call's checks read at its receipt's block: an RPC node a block behind can no longer drop the call's events, the fix for round 1's lost delivery (T-216, Medium)
- [x] T-220 (done: PR 204 merged and deployed on 2026-11-05 at 11:04 UTC, holdback-op1 `1d8a029c`, holdback-op2 `a042aae3`, crow-site `704bd295`) Ship round 1's prerequisites to the live demo: one deploy of T-217 to T-219 and T-221, in which the Sepolia world's rulebook changes in place to name drand (D49: one long-lived world), on Rafa's go-ahead. The fixed contracts (PRs 160 and 161) are already live: the T-206 session redeployed them and cut the demo over on 2026-11-04, with Rafa's go-ahead.
- [x] T-229 (done: PR 209 merged and deployed on 2026-11-05 at 15:58 UTC, crow-site `4f049eb5`) One approval from the homepage prompt, the first step of One-Click Escrow (D51): the copy button copies a prompt that carries the one command, and `llms.txt` "Try it" stops inviting a fetch of `try.mjs` first. Measured before: 4 approvals per deal, Released in about 93 s. Measured after: 1 approval per deal in both permission modes, Released in 79 s and 106 s. The seller-first path, a standing test buyer (T-222's second slice), is the next gap.
- [x] T-231 (done: merged in PR 230, 2026-11-06; Rafa approved it: "Spin it up"; deployed 2026-11-06 on Rafa's go-ahead, "Yes, deploy T-231": holdback-op1 `066f1b18` and holdback-op2 `21cbbc0b` from 19:01 UTC, crow-site `f9806d3c` from 19:08 UTC; deploy record PR 234) The operators send due timeouts on their own, so every deal on the Sepolia demo reaches its end with no one coming back: the reclaim, the default (with the takeover it needs once a silent fallback's `fallbackBy` passes), the appeal expiry and an accepted offer's expiry, at the relayer's gas, through the trigger route's relay path, a deal behind the chain included. The contract checks each at a pinned block first; a cap per pass, a daily budget and a back-off per deal guard the gas; a party's trigger after the operators' answers the state it left. T-228's leftover. Task file `docs/tasks/T-231-operator-timeouts.md`.
- [x] T-230 (done: merged in PR 232, 2026-11-06; Rafa approved it: "Spin it up"; deployed 2026-11-06 on Rafa's go-ahead: holdback-op1 `8bcda43c`, holdback-op2 `7e4d3fa5`, crow-site `16038434`) The join-on-chain-delivery fix: the operators join a delivery that is already on chain. Round 1's scenario 8 on Sepolia: the seller delivered directly and posted the same signed delivery before the operators' pass had read it; the operator's RPC node trailed the chain, its relay reverted, and the copy was dropped, so the deal sat `Delivered` with no envelopes for the adjudicators. The fix reads `deliveryHashOf` before relaying and again at a reverted relay's block, joins a match with no relay, and keeps a signed match it cannot join yet for the next pass. No contract or schema change. Scenario 8 passed on its rerun on 2026-11-06 at 15:35 UTC, 25 of 25 checks (run `2026-11-06T152621Z`).
- [x] T-232 (done: merged in PR 239, 2026-11-07, after one red-team pass and one review; its fixes go live with the next operator deploy; Rafa, 2026-11-06: "Yes, queue it"; D54) Read-after-write audit: find every chain read right after a write that a lagging publicnode server could answer, across the operators, the adjudicator, the faucet, the test seller, `try.mjs` and the examples, and pin or retry each one, with a lint or test check if one is feasible. The stale read has come back five times: T-226's lost delivery, round 1's 3d and 10a, 3b's bond deposit, T-228's stale receipt read and scenario 8's race. Task file `docs/tasks/T-232-read-after-write-audit.md`.
- [x] T-233 (done: merged in PR 240, 2026-11-07; the validators are precompiled, so a Worker's start-up code fell from 293 ms to 21 ms in a local profile [measured]; it goes live with the next operator deploy; Rafa, 2026-11-06: "Yes, do both") Cut the operators' Worker start-up time before the next operator deploy. Cloudflare refused T-231's first upload of holdback-op1 at about 18:55 UTC with "Script startup exceeded CPU time limit" (code 10021), and a retry of the same build passed. Start-up went from 394 ms and 397 ms at T-230's deploy to 575 ms (holdback-op1) and 780 ms (holdback-op2) at T-231's (`docs/operations.md`, T-231), against a 1 s limit (the coordinating session's figure; no record in the repository states it). The same refusal happened on 2026-11-03 (the backlog, the start-up CPU row). The likely cost is schema compilation at start-up [inferred]; T-231's Handoff suggests Ajv's standalone code, then a measurement. No task file on main yet.
- [x] T-234 (done: merged in PR 243, 2026-11-07; `pnpm demo-cloud:deploy` deploys both operators, runs one test deal and rolls back on failure; its first real run is the next operator deploy; Rafa, 2026-11-06: "Yes, do both") A scripted deploy check that rolls back on its own. Today each operator deploy session runs its checks by hand and reads the switch to the new build from `wrangler tail`, since `/v1/status` carries no build marker (`docs/operations.md`, the T-228, T-230 and T-231 records). No task file on main yet.
- D4 decided: the target is Ethereum mainnet (2026-11-01), built and tested on a local chain, then on Sepolia, the public testnet the demo settles on since D41 (2026-11-03). Mainnet deployment is a separate gate for Rafa after an audit. Record gas per deal in the evidence.

Out of Phase 2 by D54 (Rafa's walkthrough, 2026-11-06): T-212, for the contract redeploy before mainnet; the scenario 11 redesign, as T-310; and T-221, paused until the centralized adjudicator is stable. All three moved to later phases (Future work, below). Phase 2 closes on Sepolia without a contract redeploy, because a new rules contract needs a new demo world (D49).

**Exit:**
- Round 1: every scenario passes live on Sepolia, with finality clean on every run. Scenario 11 counts by its coverage (D54, item 1). *Met as worded, 2026-11-06: 15 of 16 passed live, the last scenario 8 at 15:35 UTC, and 11 counts by coverage. The finality re-read at 21:05 UTC found all 153 recorded deal transactions of the 8 runs in their recorded blocks (T-216 Evidence). Met under D55: Rafa accepted the passes across three operator builds on 2026-11-06 ("Accept passes as is"), so T-216's one-build rule needs no rerun, and T-216 is done.*
- The join-on-chain-delivery fix is deployed, and scenario 8 passes on rerun. *Met: T-230 is live since 2026-11-06, 12:19 UTC (holdback-op1 `8bcda43c`, holdback-op2 `7e4d3fa5`), and scenario 8 passed on its rerun at 15:35 UTC, 25 of 25 checks (run `2026-11-06T152621Z`).*
- Operator-sent timeouts are deployed. *Met: T-231 is live since 2026-11-06, 19:01 UTC (holdback-op1 `066f1b18`, holdback-op2 `21cbbc0b`; PR 234).*
- The read-after-write audit (T-232) is done, with its fixes merged. *Met: PR 239 merged on 2026-11-07 at 06:06 UTC.*
- T-206 is closed: Rafa's read of the brief and his three confirmations are recorded. *Met: Rafa confirmed all three in chat on 2026-11-06, and PR 227 (`edc8311`) recorded them and set T-206 to done.*
- Gas per deal is recorded, as D4 requires. *Met: the cost notes (T-066; kept privately, `docs/private-materials.md`) record the median Released deal on Sepolia at 1,261,428 gas, over 15 and 16 deals, and prices it against the 4.71 tUSDC operator fee. At 2026-11-05's prices a new visitor's deal costs Crow about USD 18.68 in gas on Ethereum mainnet and USD 0.04 on Base, so the fee covers it on Base only. T-216 Evidence records each round-1 scenario's gas on Sepolia, and T-205's the gas per path on anvil. Left for T-216's report: the gas per path beside `reports/differential-local.md` and T-215's quote.*
- No High or Critical finding is open in Phase 2's code. *Met, 2026-11-07: PR 242 merged at 06:07 UTC, and code scanning then listed 0 open High or Critical alerts and 1 Medium (measured). Before, on 2026-11-06: no High or Critical is open in the reviews, the Phase 2 task files, the backlog or the neutrality residuals. GitHub's code scanning lists 10 open CodeQL alerts rated High, raised on 2026-11-03 and triaged in no doc. One is in Phase 2's `apps/demo-cloud/src/world.ts`, line 692. On a read, none can run long on input an outsider controls [inferred]: 3 trim operator or client settings, 1 runs on judge output the schema caps at 600 characters, and 6 sit in tests or build scripts. Each closes once triaged and dismissed with its reason, or fixed. PR 242 (2026-11-07) fixes all 10 in code, with none left, so each closes when it merges.*

## Future work

Planned in the founders' private repository (`docs/private-materials.md` lists what it holds); a task's file joins `docs/tasks/` here when its work starts.

Started work from the later phases keeps its file here: T-052, T-059, T-060, T-066, T-207, T-212, T-221, T-222 and T-223.


## Scenario index

Status (2026-11-06, measured against `fixtures/scenarios/` and `pnpm snap`): **exists** is a fixture file that passes; **todo** is a `todo.` fixture that records a known gap and passes as a todo; **planned** has no file yet. The 30 fixtures on disk, besides `_example`, are 29 that exist plus 1 todo. Fixtures run on SimChain; Phase 2 also runs them on the contract (below).

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
| `error.appeal-decision-other-attempt` | — | 2 (T-210, PR 173: the appeal seed bound to the delivered attempt, T-206 H-1; on SimChain and the contract) | exists |
| `error.reject-carries-buyer-key` | — | 2 (T-210, PR 173: no key for a refunded buyer, T-206 H-2; on SimChain and the contract) | exists |
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
