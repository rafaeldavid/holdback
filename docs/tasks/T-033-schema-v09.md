# T-033: Schema v0.9

- **Lane:** core
- **Phase:** 6, under Assets (moved from Phase 2 on 2026-11-06, D53: not needed for stable EVM operations on Sepolia)
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

*2026-11-03 (D44, ADR-0029):* v0.9 has shipped with T-212 item 3 (the delivery binding: EIP-712 domain 0.7, `commitment.schemaVersion` "0.7", and `ChainTx` on the closed event payloads). The additive items above join v0.9 (no further `$id` move) and land before the Sepolia redeploy, so there is still one redeploy and one `llms.txt` rewrite.

## Acceptance criteria

- [ ] Every change above in `spec/schemas/` with examples, `pnpm validate:spec` strict and fresh, `spec/README.md` notes the version.
- [ ] SimChain and the EVM adapter accept the new schemes and token rule; fixtures cover a non-USDC ERC-20 funded through Permit2 and a WETH deal on anvil.
- [ ] ADR-0025 marked Accepted with the date; `llms.txt` and `docs/api.md` current; the demo world name bumped for the redeploy (`docs/operations.md`).
- [ ] `pnpm verify`, `forge test` and CI pass.

## Evidence

## Decisions

## Handoff
