# ADR-0004: Chain-agnostic EVM; target Ethereum mainnet, via a local chain and Sepolia

- **Status:** Accepted, 2026-11-01 (D4 update): target Ethereum mainnet; build and test on a local chain, then Sepolia. Deferred on 2026-10-30 (D4) until the start of Phase 2. The public demo settles on Sepolia since 2026-11-03 (D41, ADR-0028).
- **Date:** 2026-10-30; updated 2026-11-01

## Decision

- Contracts target the EVM with no chain-specific opcodes.
- Phase 1 runs on SimChain; Phase 2 on local anvil.
- The public testnet is chosen at the start of Phase 2, judged on five criteria:
  - account abstraction and paymaster support for gasless agents;
  - forced inclusion to resist sequencer censorship;
  - availability of a test stablecoin;
  - whether the Commerce Payments Protocol is deployed there;
  - permissionless access: anyone can read the public skeleton (ADR-0020) and submit a signed message without an admin granting a role.
- Candidates: Base Sepolia, ZKsync Sepolia.

### Update 2026-11-01 (D4): Ethereum mainnet

Rafa chose Ethereum mainnet as the target settlement chain, for neutrality and reliability: no single sequencer or operator can censor or delay a deal there. The contracts are built and tested on a local chain, then on Sepolia with test ETH and a test token; a mainnet deployment is a separate gate for Rafa after an audit and legal advice. The contracts stay chain-agnostic, so a rollup can be added later for small deals. Details and the gas constraint are in `docs/decisions-today.md` under D4.

### Evaluated and not adopted: Matter Labs Prividium (2026-10-31)

Prividium is a single-operator permissioned validium. A research pass (Fable, max effort; sources: docs.zksync.io Prividium pages, docs.prividium.zksync.io, L2BEAT's ZKsync Era page, github.com/matter-labs/local-prividium) found (measured unless noted):

- Every read and write passes the operator's proxy, and functions are forbidden until an admin grants a role. One permission change blocks every operator node and direct submission at once.
- The operator runs the sequencer and can stop it. Forced L1 transactions pass only for addresses the operator's filterer allowlists. Transaction data stays in the operator's database, so no outsider can settle (inferred).
- The admin role reads everything and bypasses permission checks. The operator multisig controls upgrades and the filterer.

It fails ADR-0001 (one party can stop settlement), the no-admin-keys rule, protocol property 3, and the second and fifth criteria above. It may return later only as a settlement chain a regulated club chooses for itself, with a signed, disclosed residual in `docs/neutrality.md` ("the club's chain operator can halt settlement"), the same pattern as freezable tokens. That would need its own ADR. See `docs/backlog.md`.

## Consequences

Chain details stay inside `packages/settlement/evm`. The agent-facing API and SDK do not change when the chain does.
