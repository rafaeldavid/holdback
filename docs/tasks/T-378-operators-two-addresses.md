# T-378: The operators and the test agents follow the two addresses, one token and phase one (R6c-2)

- **Lane:** api
- **Phase:** 2 (the contract lane, `contracts-audit-ready`)
- **Depends on:** T-358 (R6c-1, the two addresses in the signed terms, holdback PR 387, `a37a48d`); T-374 part 1 (the lane takes main, holdback PR 398)
- **Paths this task may touch:** `packages/sdk/`, `apps/operator/`, `apps/demo-cloud/` except its fork tests, `apps/adjudicator/` except `drand-fork.test.ts`, `apps/test-agents/`, `spec/openapi.json` and its source `spec/openapi/paths.json`, this file. Named exceptions: the profile option in `packages/settlement/sim/` and `packages/core/` (item 4), and one line in ADR-0033 (item 5)
- **Human gate:** no. The operator deploy that carries this work is Rafa's, after the Sepolia redeploy
- **Status:** in progress
- **Agent/session:** Opus 5.5, high effort; change kind 4 (API and operator code); one reviewer per pull request

## Intent

ADR-0033 split each party's address in two: the buyer signs with one address and pays from another, and the seller signs with one and is paid at another. T-358 put both fields into the signed terms, the contract, core and both settlements, and left every field equal to its signing address in the operators. This task makes the operators and the local tools use them, and closes three gaps between the local world and the chain.

What it delivers, in the order of its pull requests:

1. **The two addresses on the operator side.** The offer's prepare route takes a buyer payment address and a seller payout address as optional inputs. With none named, each defaults to its signing address, and `notices` says so in one line. The funding and the operator fee are signed by the payment address. The faucet sends test tokens to the payment address and the mandate to the signing address. The reference adjudicator and the test agents carry both fields. The advisory warnings of ADR-0033 section 7 (a zero address, one of the deployment's contracts, an adjudicator) go into `notices` and refuse nothing.
2. **One token.** Every route that takes terms refuses a token that is not the deployment's, before it prepares anything to sign. One function makes the check, every such route calls it, and its error names the accepted token's identifier, symbol and decimals. Discovery states the same token. It applies on SimChain too.
3. **The 37 s warning.** An escalation window below the smallest the chain can decide (37 s, ADR-0032) gets an advisory notice, never a refusal (D31).
4. **The partner-facing local tools run phase-one rules.** SimChain gains a profile option that it passes into core's offer and step. The operator reads `phaseOne` from that profile, not from the settlement's kind. The adjudicator's SimChain port reads the same option. The local worlds that partners rehearse on choose phase one: `pnpm sim`, which the seller adapter's `--sim` connects to, and demo-cloud's `PublicWorld` on SimChain, which the rehearsal tool opens. `pnpm demo`, `pnpm snap` and the SimChain-only fixtures stay on the full protocol. `pnpm demo` is a scripted show that takes no terms from anyone, and it keeps its appeal beat (the coordinator, 2026-11-12). Nothing under `examples/` or `apps/demo/` changes.
5. **The late-work settlement through the API.** `POST /v1/commitments/{id}/settlements` takes the late delivery with the settlement (SC-5b), so a settlement in `Held` that releases the key goes through an operator. `spec/openapi.json`, the SDK and one line in ADR-0033 change with it, inside schema v0.11.
6. **Three follow-ups from AL-1** (crow-private triage of 2026-11-12): item 63 (the adjudicator's stale bond reasons on phase one), item 67 (its ten failing mutants) and the prepare test of item 84 (prepare refuses a `delivery` once one is posted).

Inputs: the lane after holdback PR 398; ADR-0033; ADR-0031 and ADR-0032; T-358's and T-357's hand-overs. Outputs: four or five pull requests into `contracts-audit-ready`, each reviewed and merged after CI.

Non-goals: the client tools under `examples/` and `site/llms.txt` (T-379, R6c-3); any edit under `contracts/`, `formal/`, `site/` or `docs/` other than this file and the one ADR line; the Sepolia redeploy, the operator deploy and any live run (Rafa's); new refusals of negotiable values (D31).

## Context

- `docs/decisions/ADR-0033-payout-and-payment-addresses.md`: sections 3 (who signs what), 6 (what the parties check), 7 (defaults and warnings) and 10 (the operator package's proof).
- `docs/decisions/ADR-0031-phase-one-contract-scope.md` section 8; ADR-0032 (the 29 s margin; the smallest escalation window that can be decided is 37 s).
- `docs/tasks/T-358-two-addresses.md`, Handoff: what is in place for this package and what is not.
- `docs/tasks/T-357-core-late-work-settlement.md`, Handoff: the settlement route cannot yet carry a delivery.
- The plan, crow-private `roadmap/plans/2026-11-11-contract-refinement.md`, sections 2b, 2c, 7b and 7c.2.

## Acceptance criteria

- [ ] On the local world, one deal Released and one Refunded where a per-deal signing key holds no token at any step, and a standing payment address funds, pays the operator fee and is refunded.
- [ ] A deal whose payout address differs from the seller's signing address releases to the payout address; the signing address receives nothing.
- [ ] The offer's prepare route takes both addresses; with none, the terms carry the signing addresses and `notices` says so; each ADR-0033 §7 warning appears in `notices` and the route still answers.
- [ ] The agree-and-fund prepare route names the payment address as the signer of the funding and fee slots, and the buyer's signing address as the signer of `Agree`.
- [ ] The faucet sends tokens to the payment address and the mandate to the signing address.
- [ ] Terms in another token are refused at every route that takes terms, with the accepted token named; one test per route; terms in the deployment's token pass; discovery names the same token.
- [ ] An escalation window below 37 s gets a notice and is not refused.
- [ ] A non-zero appeal window is refused by each partner-facing local tool with the chain's own problem code (`invalid_terms`, `APPEAL_WINDOW_PROBLEM`); the snapshots do not change.
- [ ] A late-work settlement that releases the key goes through the HTTP API end to end on the local world, and the deal record marks it.
- [ ] Items 63, 67 and 84 (prepare test) of the triage file are closed.
- [ ] `pnpm typecheck`, `pnpm lint`, the touched packages' tests with anvil, `pnpm snap` and `pnpm snap --settlement=local` pass; CI passes on each pull request.

## Out of scope

- The buyer signer's outside signature, the seller adapter's payout field and lines, the audit deal's two-address case, the deal record's paid address, `examples/verify.ts`, `site/llms.txt` (T-379).
- The fork suites (`apps/demo-cloud/src/live-fork.test.ts`, `predeploy-fork.test.ts`, `apps/adjudicator/src/drand-fork.test.ts`): AL-1.
- `docs/api.md` and the other docs' words: AL-2.

## Evidence

Labels: measured, inferred, guessed. All runs are on this task's branches, 2026-11-12.

**Part 1, the two addresses (holdback PR 403):**

- `apps/operator/src/sim-world-two-addresses.test.ts`: on the local world (`startSimWorld`) over HTTP, with an operator fee of 1 bp and at least 0.01 tUSD, 2 of 2 tests pass [measured]:
  - one deal ends Released and one Refunded;
  - the per-deal buyer signing key holds 0 tUSD at every step;
  - the standing payment address funds, pays the 0.01 tUSD operator fee and receives the refund of the 25 tUSD price;
  - the payout address receives the price on the release;
  - the seller's signing address does not move.
- **The reference adjudicator accepts and pays the payout address:** the world's three test adjudicators accepted those offers and decided both deals; the release paid the payout address [measured by the test above]. No adjudicator file changed for it [measured].
- `apps/operator/src/prepare-two-addresses.test.ts`: 10 of 10 tests pass [measured]. They cover the default notices, both inputs, hash-only, malformed inputs, each warning, the slot signers, settlement payouts and the early-accept line.
- demo-cloud `world.test.ts`: the faucet sends tokens to the payment address and the mandate to the signing address [measured]. The test buyer refuses another payment address (`buyer.test.ts`) [measured].
- The reviewer (one `reviewer` subagent) gave ISSUES, all Low or Info:
  - 2 and 5 are fixed;
  - 1 and 4 are in the Handoff;
  - 3 is this section.

**Part 4, the late-work settlement through the API (holdback PR 408):**

- `apps/operator/src/sim-world.test.ts` [measured]: on the local world over HTTP, a settlement in `Held` reaches `Settled`; its body carries the unposted delivery that prepare put there. The dry run answers `Settled` with the signatures verified, and the state stays `Held`. The buyer's envelope from the carried delivery is released. The events tell the late work apart:
  - `commitment.settled {keyReleased: true}` comes before `key.released`;
  - there is no `delivery.submitted`;
  - `deliveryHash` is the carried delivery's.
- A second test covers the refusals: `releaseKey` false, another commitment, a non-object, a delivery that does not hash to the signed one. The same `Idempotency-Key` replays the stored answer, and with another delivery it gets 409. A body signed before the same delivery was posted still settles.
- `packages/sdk`: 39 of 39 tests pass, with a round trip that carries the delivery. `tests/contract`: 25 of 25 [measured].
- The reviewer (one `reviewer` subagent) gave ISSUES, all Low or Info:
  - Lows 1 and 2 and Info 5 are fixed;
  - Low 3 is in the Handoff;
  - Info 4 keeps the route's existing order (shape checks before idempotency);
  - Info 6 is this section;
  - Info 7 belongs to T-357's residual.

**Part 2, one token, the 37 s warning and three follow-ups (holdback PR 412):**

- `apps/operator/src/one-token.test.ts`: 11 of 11 tests pass [measured]. They cover one test per route that takes terms:
  - the offer prepare route, plain and hash-only, for a price and for a fee in another token;
  - `POST /v1/commitments` and its dry run, which relay nothing;
  - `POST /v1/holds`;
  - the settlement prepare route's payouts.
  Each refusal names `tUSD (identifier tUSD, 6 decimals)`, and discovery states the same token. Terms in tUSD pass.
- The 37 s notice (ADR-0032): below 37 s on a drand-quicknet club, the offer is prepared and carries the notice. At 37 s, and on the sim beacon, it does not [measured].
- Item 84: `prepare-posted-delivery.test.ts` shows prepare refusing a `delivery` once one is posted, naming the posted hash [measured].
- Item 63: on a chain settlement, the adjudicator's two consent rules give reasons that name no bond. The rules still apply, and `service.test.ts` checks both [measured].
- Item 67 [measured]:
  - 12 mutants no longer applied; each is retargeted to the current code.
  - The full sweep (`node apps/adjudicator/scripts/mutants.mjs`) killed 81 of 83.
  - Two survived: the publication catch, and the appeal panel's family minimum. Two new tests kill both, each rerun alone.
  - The review (PR 412, Low 1) found one retargeted mutant equal to its neighbour. It is retired: nothing releases an envelope to the primary while it decides, so a change there is equivalent.
  - So the list holds 82 mutants, and all apply and are killed (a dry count of the find strings, and each new kill rerun alone).
- The touched suites (operator, adjudicator, demo-cloud, test-agents, sdk, `tests/contract`, the alignment and spec tests): 918 passed, 11 skipped, on the lane's tip `bfe57ed` [measured].
- The reviewer gave ISSUES, all Low or Info:
  - Low 1 is fixed by retiring the mutant;
  - Low 2 is fixed in the notice's text and in the Handoff;
  - Info 3 (the refusal names the primary's registration as the fee's source) is fixed, with a test;
  - Info 4 is left: core refuses `TUSD` on SimChain later with its own message.

**Part 3, the partner-facing local tools run phase-one rules (holdback PR 416):**

- `apps/operator/src/sim-world-phase-one.test.ts`, on `pnpm sim`'s world: 5 of 5 tests pass [measured]:
  - a non-zero appeal window is refused with core's `APPEAL_WINDOW_PROBLEM`, at prepare and on SimChain itself;
  - a deal that holds nothing is refused with `ZERO_HOLD_PROBLEM` (AL-1's leftover route test);
  - a party appeal is refused;
  - the full protocol prepares all three.
- demo-cloud `world.test.ts`: `PublicWorld` on SimChain runs phase one by default and refuses the same appeal window, and a world created before the profile existed reopens on the full protocol [measured].
- Two gaps that phase one exposed in SimChain, fixed in `packages/settlement/sim/simchain.ts`:
  - SimChain reserved the price as a bond at acceptance;
  - a decided deal never became final, because core closes the appeal state at once on phase one.

  On phase one SimChain now reserves no bond, and a decision is final when it settles, as the EVM adapter reports it.
- The examples that open these worlds pass [measured]:
  - the rehearsal (`audit-deal`, 26, its seven cases included);
  - the seller adapter's three files (40, 10, 18);
  - buyer-signer, buy-with-signer (5), buyer-signer-outcome (9), deal-record (9), try (7);
  - the round's direct (8), silent (3), run (17) and adjudicator (6) files;
  - examples (9), early-accept (5), private (8), verify (19).

  The round's scripted and escalation files run SimChain-only scenarios, and pass with `examples/e2e-world.ts` on the full profile.
- `pnpm snap`: 43 passed. `pnpm snap --settlement=local`: 36 passed, 0 failed, 7 excluded. No snapshot changed [measured].

## Decisions

1. **`pnpm demo` stays on the full protocol** (the coordinator, 2026-11-12, on this task's question). Phase one goes to `pnpm sim` and `PublicWorld` on SimChain. The Handoff lists any other local entry point that takes a party's own terms, with the profile it runs.
2. **The offer's request field names** for the two addresses are `buyer.paymentAddress` and a top-level `sellerPayoutAddress`, both optional. T-379 proposed them on 2026-11-12, and the clients and `examples/verify.ts` use the same names.
3. **`spec/openapi/paths.json`** is the source of `spec/openapi.json` (`pnpm openapi`). This task edits the source and regenerates the output (the coordinator, 2026-11-12).
4. **The late delivery travels flat beside the settlement** as `delivery`, as `fund` does beside an `Agree`. It is not wrapped as `{settlement, delivery}`, so the route keeps one body form. The deal record gets no new marker in any event payload; the events already tell late work apart (the coordinator, 2026-11-12).
5. **The token check reads the operator's own configuration** (`OperatorOptions.token`), not the settlement interface. `packages/settlement/src/interface.ts` is outside this task's paths. An operator configured without a token checks nothing; both worlds this repository runs configure one.
6. **Which local worlds run phase one** (the coordinator, 2026-11-12):
   - **Phase one:**
     - `pnpm sim` (`sim-bin.ts`), which the seller adapter's `--sim` connects to;
     - demo-cloud's `PublicWorld` on SimChain, by default, fixed when a world is created; the rehearsal opens this one.
   - **Full protocol:**
     - `pnpm demo`, a scripted show with its appeal beat;
     - `pnpm snap` and the SimChain-only fixtures, where the cut features live;
     - `startSimWorld`'s default, used by `tools/sim` and the examples' own SimChain worlds;
     - the round's SimChain world (`examples/e2e-world.ts`, `simProfile: 'full'`), which runs the party-appeal and bond scenarios;
     - a stored `PublicWorld` created before the profile existed.

## Handoff

**Open, for later work:**

- **The 37 s notice assumes the 29 s beacon margin of ADR-0032,** which R8 (T-380) builds into the contract (PR 412 review, Low 2). Until that deployment, Sepolia's floor is 13 s, and the notice says it applies on a rules contract with that margin. A notice computed from the deployment's own margin can follow once the margin reaches the operator (T-380 adds `beaconMarginSec` to the settlement interface).

- **The fallback window's floor** (43 s on mainnet, 44 s on Sepolia; ADR-0032 gate line BR-5) gets no notice. The brief named the escalation's 37 s only.
- **The adjudicator's appeal-window limit on phase one** stays a refusal of its own choice (D29). Its reason now names no bond. Whether a phase-one adjudicator should keep the limit at all is open.

- **No anvil test of the late-work route over the EVM settlement** (PR 408 review, Low 3). The EVM adapter's own late-work test covers the settlement step. The HTTP route is measured on SimChain only.

- **No warning for the escrow's token store as a payout address** (PR 403 review, Low 1). The store's address comes from a chain call (`getTokenStore(rules)`), and opening a world may not make one. A later change can read it after the first pass and add it to `contracts`.
- **Concurrent faucet grants** (PR 403 review, Info 4). Two grants from two signing keys to one payment address may both mint on the live faucet. The per-client window and the day's mint cap bound it, as rotating addresses always could.
