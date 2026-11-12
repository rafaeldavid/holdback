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

## Decisions

1. **`pnpm demo` stays on the full protocol** (the coordinator, 2026-11-12, on this task's question). Phase one goes to `pnpm sim` and `PublicWorld` on SimChain. The Handoff lists any other local entry point that takes a party's own terms, with the profile it runs.
2. **The offer's request field names** for the two addresses are `buyer.paymentAddress` and a top-level `sellerPayoutAddress`, both optional. T-379 proposed them on 2026-11-12, and the clients and `examples/verify.ts` use the same names.
3. **`spec/openapi/paths.json`** is the source of `spec/openapi.json` (`pnpm openapi`). This task edits the source and regenerates the output (the coordinator, 2026-11-12).

## Handoff

**Open, for later work:**

- **No warning for the escrow's token store as a payout address** (PR 403 review, Low 1). The store's address comes from a chain call (`getTokenStore(rules)`), and opening a world may not make one. A later change can read it after the first pass and add it to `contracts`.
- **Concurrent faucet grants** (PR 403 review, Info 4). Two grants from two signing keys to one payment address may both mint on the live faucet. The per-client window and the day's mint cap bound it, as rotating addresses always could.
