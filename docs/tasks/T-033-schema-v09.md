# T-033: Schema v0.9

- **Lane:** core
- **Phase:** 2
- **Depends on:** ADR-0025 (Proposed; accept it in this task), ADR-0026 / D38, D39
- **Paths this task may touch:** `spec/schemas/`, `spec/examples/`, `spec/openapi/paths.json`, `spec/openapi.json` (generated), `spec/README.md`, `packages/core/src/`, `packages/settlement/`, `apps/operator/src/`, `apps/adjudicator/src/`, `examples/`, `site/llms.txt`, `docs/api.md`, `docs/decisions/ADR-0025-evm-funding-and-token-ids.md`, `fixtures/`, `docs/tasks/T-033-schema-v09.md`, `docs/backlog.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Ship the protocol-level changes the recent decisions queued, as one additive version bump (schema 0.9; the EIP-712 domain moves only if an existing type changes, per ADR-0023's rule):

- ADR-0025: `FundingAuthorization.scheme` gains `cpp-erc3009` and `cpp-permit2`; token identifiers on EVM are lowercase 0x addresses; `core` helpers for the derived CPP `PaymentInfo` (move them from `packages/settlement/evm/encode.ts`).
- D38: `rulebook.allowedTokens` optional; absent means any ERC-20 (WETH for ETH).
- D39: `chainId` as a number in `operator-status`; the `not_implemented` problem type; the operator fee on receipts (review C3).
- D31 (review C8): the MIME allowlist and `deliverable.kind` enum move from the schema to adjudicator capability (an adjudicator declines what it cannot judge).

## Acceptance criteria

- [ ] Every change above in `spec/schemas/` with examples, `pnpm validate:spec` strict and fresh, `spec/README.md` notes the version.
- [ ] SimChain and the EVM adapter accept the new schemes and token rule; fixtures cover a non-USDC ERC-20 funded through Permit2 and a WETH deal on anvil.
- [ ] ADR-0025 marked Accepted with the date; `llms.txt` and `docs/api.md` current; the demo world name bumped for the redeploy (`docs/operations.md`).
- [ ] `pnpm verify`, `forge test` and CI pass.

## Evidence

## Decisions

## Handoff
