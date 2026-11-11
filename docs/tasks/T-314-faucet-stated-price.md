# T-314: The faucet funds a test deal at any stated price

- **Lane:** api and demo (the operators' faucet in `apps/demo-cloud`, its route in `apps/operator`)
- **Phase:** 2
- **Depends on:** T-223 (the faucet renews an address's mandate; merged in PR 191)
- **Paths this task may touch:** `apps/demo-cloud/src/world.ts`, `apps/demo-cloud/src/world.test.ts`, `apps/demo-cloud/src/live.test.ts` (one faucet assertion on anvil), `apps/operator/src/server.ts` (the faucet route and `DemoFacts`), `apps/operator/src/registry.ts` (`FaucetOutcome`), `spec/openapi/paths.json` and the generated `spec/openapi.json`, `docs/api.md` and `site/llms.txt` (the faucet sentences), this file.
- **Human gate:** yes for the deploy only: the live operators honour `amount` after Rafa deploys them. Everything else is in the repository.
- **Status:** review
- **Agent/session:** faucet and ciphertext-cap session, 2026-11-11 (Rafa asked for T-314 and T-315 that day)

## Intent

Today the demo faucet grants a fixed 1,000 tUSDC and ignores the request's `amount`. On Sepolia it also skips the mint when the address already holds 1,000 tUSDC. So a buyer cannot fund a test deal priced like a real job from the faucet: a 2,000 tUSDC deal costs 2,005.71 tUSDC with the adjudication fee (1.00 tUSDC) and the operator fee (4.71 tUSDC).

The goal: a fresh buyer key asks the faucet for the amount its deal needs, fees included, and funds the deal from that one grant. The faucet states its limits in discovery, and `site/llms.txt` and `docs/api.md` state the same.

- **Input:** `POST /v1/faucet {"address", "amount"?}`. `amount` is optional, in base units as a decimal string; the request schema already carries it.
- **Output:** the grant, as before. `granted` says what the faucet gave. Discovery's `demo.faucet` adds `maxGrant`, the largest amount one grant gives.
- **Unchanged:** one grant per address per hour, 10 grants per client per hour, 600 mints a day on a chain, a fresh 30-day mandate with every grant, and the default of 1,000 tUSDC when the request names no amount.

Non-goals: a new route, a faucet for any token but the demo's test token, real money in any form, and any change to how settlement checks a balance or a price. Deal prices stay unrestricted (D31); the cap is a limit on this operator's free service only.

## Context

- `apps/demo-cloud/src/world.ts`: `grantFrom` (the grant), `demo()` (discovery's facts), `notesFor` (the notes).
- `apps/operator/src/server.ts`: `faucet` (the route already parses `amount` and passes it on) and `DemoFacts`.
- `spec/openapi/paths.json`: `FaucetRequest`, and `Discovery.demo.faucet`, which is closed (`additionalProperties: false`). It is the hand-written paths file, not `spec/schemas/`.
- D31 (parametrize, don't restrict), D39 (one faucet, one discovery document), ADR-0028 §6 (the mint on a chain).

## Acceptance criteria

- [x] A fresh buyer key asks for 2,005.71 tUSDC, funds a 2,000 tUSDC deal with both fees, and the deal reaches `Held` with a balance of 0.
- [x] Discovery's `demo.faucet` states `grant` (the default), `maxGrant`, `perAddressEverySec` and `perClientPerWindow`.
- [x] An `amount` above `maxGrant` gets 400 `invalid_terms` with `field: "amount"` and a detail that names the cap; nothing is minted and no grant is counted.
- [x] The per-address and per-client limits still refuse a second grant in the window, whatever its amount.
- [x] `site/llms.txt` and `docs/api.md` state the default, the cap and the limits; a test compares the cap in both with the code's.
- [x] No float: amounts are `bigint` in code and decimal strings on the wire.

## Out of scope

- A top-up for an address that took the default grant less than an hour ago: it waits for the window or uses a fresh key (see Handoff).
- The standing test seller's price list and `site/try.mjs`: they keep the default grant.
- The deploy (Rafa's gate).

## Evidence

- Commands run and results:
  - Red first (measured): with only the tests added, `pnpm exec vitest run apps/demo-cloud/src/world.test.ts -t "T-314"` failed 2 of 2: the cap constant did not exist.
  - Green (measured): the same command passes 2 of 2. A fresh buyer asks for 2,005.71 tUSD, funds a 2,000 tUSD deal with a 1.00 tUSD adjudication fee and a 4.71 tUSD operator fee, the deal reaches `Held`, and the buyer's balance reads 0. An amount 1 base unit above the cap gets 400 `invalid_terms` with `field: "amount"`; a second ask in the window gets 429.
  - The chain world (measured): `pnpm exec vitest run apps/demo-cloud/src/live.test.ts -t "sets up its adjudicators"` on anvil passes in 33 s. A fresh address asks for 2,005.71 tUSDC and the faucet mints it in one transaction.
  - The kind's local checks (measured, 2026-11-11): `pnpm typecheck` passes. `pnpm exec vitest run apps/demo-cloud apps/operator tests/contract apps/test-agents` ran 35 files: 370 tests passed, 3 skipped, and 1 failed, the OpenAPI contract test's 300-character limit on an operation's description. After the description was shortened, `pnpm exec vitest run tests/contract` passes 23 of 23. `pnpm validate:spec` passes (34 of 34 examples; `spec/openapi.json` fresh). `pnpm exec eslint apps/demo-cloud/src apps/operator/src` reports nothing. `node site/build.mjs && node site/check.mjs` passes and changes no built file.
  - The full `pnpm verify` did not run: the change recipes keep it for a deploy. CI is the gate.
- Snapshot diffs: none.
- Metrics: none.

## Decisions

- **The request names its own amount, up to a published cap.** The request schema already carried an optional `amount`, and the operator's route already parsed it; the demo ignored it. Honouring it needs no new field in a request. The alternative, a top-up to a stated target, needs the faucet to read a balance on SimChain too and gives the same result for a fresh key.
- **The cap is 1,000,000 test tokens a grant (`"1000000000000"` base units).** It is 500 times the 2,000 tUSDC deal that prompted this task. The cap limits this operator's free service, so one script or typo cannot fill the demo with balances of 10^31 base units; it never limits a deal's price (D31). On Sepolia the test token is open-mint, so an agent that needs more mints it itself. The operator sets it with `faucetMaxAmount`.
- **The default stays 1,000 test tokens.** Existing clients, `site/try.mjs` and the standing test seller send no amount and see no change.
- **The limits count grants, not tokens.** One grant per address per hour and 10 per client per hour bound the mints these nodes pay gas for (600 a day), and an amount costs the same gas whatever its size (inferred: one ERC-20 mint).
- **Above the cap is `invalid_terms`, checked before any limit.** The refusal carries `field: "amount"` and names the cap in base units, and the address keeps its turn in the window.
- **On a chain the mint is skipped when the address already holds the amount asked,** as it was for the fixed grant. A grant mints the amount asked, not the difference, so `granted` is always the amount asked or 0.
- **`maxGrant` goes into `spec/openapi/paths.json`, not `spec/schemas/`.** Discovery's `demo` object lives only in the paths file, as `feedback` and `limits` do, so this is kind 4 with no ADR and no version bump: an optional field on a demo-only object. `spec/openapi.json` is regenerated with `pnpm openapi`.

## Handoff

- **Done in the repository:** the faucet honours `amount` up to `demo.faucet.maxGrant`; discovery, the discovery notes, the OpenAPI document, `docs/api.md` and `site/llms.txt` state the default, the cap and the limits; tests cover SimChain and anvil.
- **Not done: the deploy (Rafa's gate).** The live operators ignore `amount` and discovery shows no `maxGrant` until both operator Workers are deployed (`pnpm demo-cloud:deploy`). `site/llms.txt` on crow.direct describes `amount` only after a site deploy (`pnpm site:deploy`); deploy the operators first, so the guide never describes a field the nodes ignore. No new world is needed.
- **Open, for the backlog:**
  - An address that took the default grant and then needs more waits for its hour or uses a fresh key. A top-up inside the window would need a per-address token budget; nothing asked for it yet.
  - `site/try.mjs` and the test seller's card offer only the 25 tUSDC deal. A larger priced deal against the standing seller is a separate task.
- **To resume:** `pnpm exec vitest run apps/demo-cloud/src/world.test.ts -t "T-314"`.
