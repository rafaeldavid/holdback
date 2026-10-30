# ADR-0004: Chain-agnostic EVM; testnet choice deferred

- **Status:** Proposed (D4).
- **Date:** 2026-10-30

## Decision

- Contracts target the EVM with no chain-specific opcodes.
- Phase 1 runs on SimChain; Phase 2 on local anvil.
- The public testnet is chosen at the start of Phase 2, judged on four criteria:
  - account abstraction and paymaster support for gasless agents;
  - forced inclusion to resist sequencer censorship;
  - availability of a test stablecoin;
  - whether the Commerce Payments Protocol is deployed there.
- Candidates: Base Sepolia, ZKsync Sepolia.

## Consequences

Chain details stay inside `packages/settlement/evm`. The agent-facing API and SDK do not change when the chain does.
