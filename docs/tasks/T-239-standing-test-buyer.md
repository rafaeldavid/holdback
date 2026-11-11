# T-239: Crow's standing test buyer on the Sepolia test environment

- **Lane:** demo (the test agents, and the site for `llms.txt`)
- **Phase:** 2 (roadmap rank 2, stage 1, "Outsiders can use it"; unblocks scenario 3 of the outsider design tests, row N1b)
- **Depends on:** T-222 (the test seller and the `crow-test-agents` Worker), merged.
- **Paths this task may touch:** `apps/test-agents/`; `site/llms.txt` (the new seller section only), `site/check.mjs` (a matching check, if needed), `site/index.html` (only as the build regenerates it); `docs/operations.md` (a deploy command for the test buyer only); this file.
- **Human gate:** yes for the last criterion only: the deploy and the first seller-started deal on Sepolia wait for Rafa.
- **Status:** in progress
- **Agent/session:** t-239-standing-test-buyer
- **Change kind:** 4 (API and operator code): the package's tests, no review, a target of 150k tokens.

## Intent

An outside seller has nobody to sell to on the test environment: the test seller (D47) covers outside buyers only. This task adds a standing test buyer beside it in `apps/test-agents`. A seller reads the buyer's published rules, offers on Crow naming the buyer's address and encryption key, and posts the commitment ID to the buyer's intake. The buyer checks the terms on the operators against its rules, refuses with the broken rule, or agrees and funds with test tUSDC. Then it follows the deal to Released or Refunded, and sends the reclaim itself when the seller misses `deliverBy`. No person at Crow takes part.

Inputs: a commitment ID from a seller. Outputs: a signed agree-and-fund, a reclaim trigger when due, and a status the seller reads. Non-goals: opening or judging the work (the adjudicator decides), negotiating, and any protocol, schema or operator change.

## Context

- D47 (`docs/decisions-today.md`): the test seller, whose later slice is this buyer.
- `apps/test-agents/src/seller.ts` and `catalog.ts`: how the seller is built, published and tested.
- `site/llms.txt`: "Try it", "Two agents, two people", sections 5, 6 and "Beyond the happy path" (triggers).
- `examples/agent.ts` and `examples/verify.ts`: the agent the buyer runs, and the prepared-message checks.

## Acceptance criteria

- [ ] An outside seller's offer that names the test buyer and fits its published rules is agreed and funded with test tUSDC, with no manual step on Crow's side.
- [ ] A delivery that passes the offer's checks ends Released; one that fails ends Refunded; a seller that never delivers leaves the buyer to reclaim after `deliverBy`, and the test buyer sends that reclaim itself.
- [ ] The buyer publishes what it accepts (token, largest price, required deadlines and checks) at `<base>/agent.json` and on its page, as the seller publishes its catalog, and it answers a refusal with the rule the offer broke.
- [ ] It signs its own EIP-712 messages with its own key from the Worker's environment; the operators only relay; it still works when one operator is offline.
- [ ] Its limits (largest price, deals per seller per window) are its own published choices (D31). It refuses to start on a mainnet chain ID.
- [ ] It accepts only declarative checks and runs nothing from an offer.
- [ ] Every mutating call carries an `Idempotency-Key`; a restart never agrees or funds the same offer twice.
- [ ] Tests cover the three outcomes on the in-process chain; the package's tests, `pnpm typecheck` and `pnpm lint` pass.
- [ ] `site/llms.txt` gains "Sell to Crow's test buyer"; `node site/build.mjs` and `node site/check.mjs` pass.
- [ ] (Rafa) A seller-started deal ends Released on Sepolia after the deploy.

## Out of scope

- Rubric deals and LLM judges: the buyer takes checks-only deals.
- Private and judgment-level deals.
- Appeals: the buyer never appeals.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs: none (no scenario fixtures change).
- Metrics:

## Decisions

## Handoff
