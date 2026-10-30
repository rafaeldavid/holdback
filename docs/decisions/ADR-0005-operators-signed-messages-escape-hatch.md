# ADR-0005: Permissionless operators, EIP-712 messages, escape hatch

- **Status:** Proposed.
- **Date:** 2026-10-30

## Context

Agents need direct API calls at machine speed. A single API provider would be a control point (ADR-0001).

## Decision

- Every state change is an EIP-712 message signed by the party entitled to make it. A message is valid no matter who submits it.
- Operator nodes serve the REST API, verify messages, relay them, sponsor gas, index events and sign receipts. Anyone can run one.
- The SDK fails over across operators, then submits directly to the settlement layer.
- Funding is gasless for agents. The buyer signs a token transfer authorization (ERC-3009 or Permit2), and any relayer can submit it.
- No API keys. Operators may rate-limit by signer address.

## Consequences

- Signatures are secp256k1 (EVM-native) rather than Ed25519 JWS. Contracts can verify them on-chain.
- Machine speed comes from operators responding before inclusion: `202` pending, then an event on inclusion. On SimChain, responses are synchronous.
