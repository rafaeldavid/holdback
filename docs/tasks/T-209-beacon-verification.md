# T-209: Beacon verification in the rules contract

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-202 (rules contract), T-203 (invariants, Foundry in CI), T-205 (EVM settlement adapter)
- **Paths this task may touch:** `contracts/src/`, `contracts/test/`, `contracts/script/`, `contracts/foundry.toml`, `contracts/.gas-snapshot`, `packages/settlement/evm/`, `packages/core/src/` (beacon helpers and the parse rule only), `fixtures/` (new beacon fixtures and vectors), `docs/decisions/ADR-0018-panel-seed-beacon.md` (an amendment section), `docs/tasks/T-209-beacon-verification.md`, `docs/backlog.md` (close the beacon row, add findings)
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Today the fallback and appeal adjudicators can choose the beacon value their panel seed comes from: `HoldbackRules.decide` checks the round number and the seed derivation, but not that the value really is drand's output for that round (`contracts/src/HoldbackRules.sol` near line 276). That breaks the "selected by commit-reveal / not chosen by the decider" leg of litmus test 3 for every decision after the primary's. This task makes the contract verify the drand quicknet BLS signature for the round, so a fallback or appeal panel seed is fixed by public randomness nobody controls.

Non-goals: mixing the beacon into the primary's seed (ADR-0018 alternatives, a later decision); the club `randomness` option beyond what settlement needs; any deployment.

## Context

- ADR-0018 §2 (round rules), §4 (drand quicknet: period 3 s, scheme `bls-unchained-g1-rfc9380`, signature in G1 (48 bytes), public key in G2; value = sha256(signature); verified with the EIP-2537 precompiles), §5 (no substitute source: no proof by the deadline means the fallback or default path applies).
- `contracts/src/HoldbackTypes.sol` `Decision`: carries `beaconSourceHash`, `beaconRound`, `beaconValue`, `beaconSignatureHash` (a hash only, so the signature bytes must arrive as calldata and match the hash the adjudicator signed).
- `docs/backlog.md` row "Beacon verification on chain": pin drand's round formula (`(t - genesis) / period + 1`) against the contract's `beaconRoundAt`, which today omits the `+ 1`.
- **Contract size:** HoldbackRules is 34 bytes under EIP-170 (measured, T-202/T-203). BLS verification will not fit inline.
- EIP-2537 is live on Ethereum mainnet and Sepolia with Pectra (inferred; confirm). Anvil needs the Prague hardfork (`evm_version = "prague"` in Foundry and anvil's matching hardfork).
- The local fixtures (`pnpm snap --settlement=local`) run the fallback and appeal paths with the sim beacon (`EvmSettlement.beacon`); they must keep passing.

## Acceptance criteria

- [ ] A separate, ownerless verifier contract checks a drand quicknet round: given `round` and the 48-byte signature, it hashes the round to G1 per RFC 9380 (DST `BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_`, message sha256 of the round as 8 big-endian bytes) and checks the pairing against the quicknet public key, which is a constructor constant. No owner, setter, proxy or `delegatecall`; `NoAdmin` checks cover it.
- [ ] `HoldbackRules.decide` for the fallback and appeal roles requires: the signature bytes hash to `beaconSignatureHash`, the verifier accepts them for `beaconRound`, and `beaconValue == sha256(signature)`. The verifier is an immutable set in the constructor; HoldbackRules stays under EIP-170, with the measured headroom stated.
- [ ] Local fixtures still run: a deployment-time choice of verifier (for example a sim verifier that accepts `keccak256(simSeed ‖ round)` for anvil, the drand verifier for Sepolia and mainnet), fixed at deploy, never changeable. Record the tradeoff in the ADR-0018 amendment.
- [ ] The round formula matches drand exactly (round 1 at genesis), with a test against real quicknet rounds, and SimChain or the EVM adapter agrees.
- [ ] Forge tests with at least three real quicknet rounds (public key, round, signature, randomness fetched from a public drand relay and committed as vectors with their source URL): valid accepted; wrong round, flipped bit, another round's signature, a G1 point not on the curve, and the wrong value all refused. Fuzz over corrupted signatures.
- [ ] Gas measured for a fallback decision with verification (ADR-0018 guessed about 140k for the check) and the per-deal gas table updated.
- [ ] `(cd contracts && forge test)`, `pnpm verify` and CI pass; T-203 invariants still pass.
- [ ] ADR-0018 gets an amendment section: verifier design, size and gas, round formula, sim verifier for local chains.

## Out of scope

- Live drand fetching in the adjudicator service (backlog row if it is needed).
- Primary-seed beacon mixing.
- Changing `spec/schemas/` (the Decision already carries the beacon); if a schema change turns out necessary, stop and write it in Handoff.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff
