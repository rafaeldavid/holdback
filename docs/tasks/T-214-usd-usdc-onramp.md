# T-214: USD to USDC on-ramp, test mode

- **Lane:** api (funding service)
- **Phase:** 5
- **Depends on:** D42 (USDC only, a USD to USDC on-ramp), ADR-0026 (the funding service and its `/v1/funding/*` routes, stub today), T-213 (the demo on Sepolia)
- **Paths this task may touch:** a new `apps/funding/` (the service), `apps/operator/src/registry.ts` (`FundingService`), `apps/operator/src/server.ts` (the funding routes only), `spec/schemas/` and `spec/openapi/paths.json` (the funding quote and session, with an ADR and a version bump), `docs/api.md`, `site/llms.txt` (a funding section), `config/keys.template`, this file
- **Human gate:** yes for keys and accounts: Rafa creates the provider's test account and puts its test keys in the environment (a Stripe key must be `sk_test_…`; the operators' startup guards refuse anything else). No live keys, ever.
- **Status:** todo
- **Agent/session:** —

## Intent

The first wave of the service takes USDC only, funded from US dollars (D42; Rafa: "This prevents the complexity of asset conversion during onboarding"). An agent whose owner pays by card should end with the deal's USDC at its own address, ready for `agree-and-fund`, through the unified API. The service delivers the token to the buyer; it never holds escrowed funds and never signs for the buyer, and direct funding from the buyer's own address always remains (ADR-0026, `neutrality.onramp-refuses`).

Restate this in your own words in this section before writing code.

## Context

- ADR-0026 (the funding service: `/v1/funding/quote`, `/v1/funding/sessions`, planned), D38 and D42.
- Candidates, test mode only: Stripe's crypto on-ramp, or Coinbase Onramp in its sandbox. Check against each provider's current documentation before choosing (the ADR-0026 provider facts are from memory): which test networks and tokens each delivers to (Circle's Sepolia USDC, or a provider test token), whether the session can name the destination address, the identity check the agent's owner passes (D38: the owner passes it, the agent spends), and webhooks for completion.
- The Sepolia demo deals in tUSDC, our own test token (D42). A provider's test mode is likely to deliver Circle's Sepolia USDC instead. Decide which: the demo club lists both tokens, or the demo moves to Circle's Sepolia USDC for funded deals. Moving means a treasury for the faucet, and a token whose issuer can freeze an address (D42 records the tradeoff).

## Acceptance criteria

- [ ] A provider chosen with a short research note: test-mode coverage, the token and network it delivers, identity, fees, and limits.
- [ ] `POST /v1/funding/quote` and `/v1/funding/sessions` work end to end in test mode: a test card ends with the token at the buyer's address, and the agent then funds a deal with it.
- [ ] Keys from the environment only; a non-test Stripe key refuses to start (the existing guard), tested.
- [ ] `neutrality.onramp-refuses`: with the on-ramp refusing or offline, a buyer holding the token funds directly.
- [ ] `llms.txt` describes the path; the gas and operator fee are quoted in USDC, as D33 amended.

## Out of scope

- Off-ramp (USDC to USD) and other assets (the Assets module, Phase 6).
- Live keys and real money, at any point.

## Evidence

## Decisions

## Handoff
