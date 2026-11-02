# T-209: Beacon verification in the rules contract

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-202 (rules contract), T-203 (invariants, Foundry in CI), T-205 (EVM settlement adapter)
- **Paths this task may touch:** `contracts/src/`, `contracts/test/`, `contracts/script/`, `contracts/foundry.toml`, `contracts/.gas-snapshot`, `packages/settlement/evm/`, `packages/core/src/` (beacon helpers and the parse rule only), `fixtures/` (new beacon fixtures and vectors), `docs/decisions/ADR-0018-panel-seed-beacon.md` (an amendment section), `docs/tasks/T-209-beacon-verification.md`, `docs/backlog.md` (close the beacon row, add findings)
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer (Claude Code), branch `t-209-beacon-verification`

## Intent

Today the fallback and appeal adjudicators can choose the beacon value their panel seed comes from: `HoldbackRules.decide` checks the round number and the seed derivation, but not that the value really is drand's output for that round (`contracts/src/HoldbackRules.sol` near line 276). That breaks the "selected by commit-reveal / not chosen by the decider" leg of litmus test 3 for every decision after the primary's. This task makes the contract verify the drand quicknet BLS signature for the round, so a fallback or appeal panel seed is fixed by public randomness nobody controls.

Non-goals: mixing the beacon into the primary's seed (ADR-0018 alternatives, a later decision); the club `randomness` option beyond what settlement needs; any deployment.

**Restated (implementer, 2026-11-02).** A fallback or appeal adjudicator must not be able to pick its panel by picking the beacon value. The rules contract already fixes the round from settlement state; it now also has to prove the value. A separate ownerless contract verifies a drand quicknet round: it hashes the round to G1 per RFC 9380 and checks the BLS pairing against the quicknet key with the EIP-2537 precompiles. `decide` for the fallback and appeal roles accepts a value only when that verifier accepts the signature the adjudicator signed, and the value is sha256(signature). The verifier is fixed when the rules contract is deployed. Local chains get a sim verifier with SimChain's values, so the recorded fixtures still run without a network. Round arithmetic becomes drand's (round 1 at genesis) everywhere, without moving any SimChain round. Not in scope: the primary's seed, the adjudicator service fetching drand rounds, the parse rule admitting `drand-quicknet`, deployment, schema changes.

## Context

- ADR-0018 §2 (round rules), §4 (drand quicknet: period 3 s, scheme `bls-unchained-g1-rfc9380`, signature in G1 (48 bytes), public key in G2; value = sha256(signature); verified with the EIP-2537 precompiles), §5 (no substitute source: no proof by the deadline means the fallback or default path applies).
- `contracts/src/HoldbackTypes.sol` `Decision`: carries `beaconSourceHash`, `beaconRound`, `beaconValue`, `beaconSignatureHash` (a hash only, so the signature bytes must arrive as calldata and match the hash the adjudicator signed).
- `docs/backlog.md` row "Beacon verification on chain": pin drand's round formula (`(t - genesis) / period + 1`) against the contract's `beaconRoundAt`, which today omits the `+ 1`.
- **Contract size:** HoldbackRules is 34 bytes under EIP-170 (measured, T-202/T-203). BLS verification will not fit inline.
- EIP-2537 is live on Ethereum mainnet and Sepolia with Pectra (inferred; confirm). Anvil needs the Prague hardfork (`evm_version = "prague"` in Foundry and anvil's matching hardfork).
- The local fixtures (`pnpm snap --settlement=local`) run the fallback and appeal paths with the sim beacon (`EvmSettlement.beacon`); they must keep passing.

## Acceptance criteria

- [x] A separate, ownerless verifier contract checks a drand quicknet round: given `round` and the 48-byte signature, it hashes the round to G1 per RFC 9380 (DST `BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_`, message sha256 of the round as 8 big-endian bytes) and checks the pairing against the quicknet public key, which is a constructor constant. No owner, setter, proxy or `delegatecall`; `NoAdmin` checks cover it.
- [x] `HoldbackRules.decide` for the fallback and appeal roles requires: the signature bytes hash to `beaconSignatureHash`, the verifier accepts them for `beaconRound`, and `beaconValue == sha256(signature)`. The verifier is an immutable set in the constructor; HoldbackRules stays under EIP-170, with the measured headroom stated.
- [x] Local fixtures still run: a deployment-time choice of verifier (for example a sim verifier that accepts `keccak256(simSeed ‖ round)` for anvil, the drand verifier for Sepolia and mainnet), fixed at deploy, never changeable. Record the tradeoff in the ADR-0018 amendment.
- [x] The round formula matches drand exactly (round 1 at genesis), with a test against real quicknet rounds, and SimChain or the EVM adapter agrees.
- [x] Forge tests with at least three real quicknet rounds (public key, round, signature, randomness fetched from a public drand relay and committed as vectors with their source URL): valid accepted; wrong round, flipped bit, another round's signature, a G1 point not on the curve, and the wrong value all refused. Fuzz over corrupted signatures.
- [x] Gas measured for a fallback decision with verification (ADR-0018 guessed about 140k for the check) and the per-deal gas table updated.
- [x] `(cd contracts && forge test)`, `pnpm verify` and CI pass; T-203 invariants still pass.
- [x] ADR-0018 gets an amendment section: verifier design, size and gas, round formula, sim verifier for local chains.

## Out of scope

- Live drand fetching in the adjudicator service (backlog row if it is needed).
- Primary-seed beacon mixing.
- Changing `spec/schemas/` (the Decision already carries the beacon); if a schema change turns out necessary, stop and write it in Handoff.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

**Commands.**
- `pnpm verify` is green on all nine steps: typecheck, lint, forge build, forge, test, spec, snap, snap:local and demo (`reports/verify-t-209-beacon-verification.md`). [measured]
- `(cd contracts && forge test)`: 168 tests in 21 suites pass, including T-203's handler invariants (`RulesInvariants`, 8 invariants) and both NoAdmin suites. [measured]
- vitest: 2200 tests in 91 files pass, including the anvil suites (`packages/settlement/evm`, `packages/testkit/src/runner.test.ts`: 78 tests, none skipped). [measured]
- `pnpm lint` is clean. [measured]

**Verifier against real drand.**
- `fixtures/beacon/drand-quicknet.json` holds seven quicknet rounds: 1, 2, 1000, 12345678, 20000000, 32398879 and 32456478. They were fetched from api.drand.sh and drand.cloudflare.com, which returned identical bytes, and verified off chain with @noble/curves 1.9.1. [measured]
- The verifier accepts all seven, and each returns drand's randomness = sha256(signature). The on-chain `hashToG1` equals noble's for round 1. [measured]
- It refuses (`test/unit/DrandBeacon.t.sol`) [measured]:
  - a wrong round, another round's signature, a flipped bit, and the negated signature;
  - a G1 x with no curve point, and a curve point outside G1;
  - uncompressed, infinity, x = p, empty and 49-byte encodings;
  - a fuzzed corruption: 256 runs, one bit flipped plus an optional second byte.
- Round formula: `public/latest` returned 33600306 at unix 1793604284, and `(t − genesis) / 3 + 1` gives 33600306. Forge and vitest both pin it. [measured]

**Rules contract with drand (`test/unit/DrandDecide.t.sol`).** [measured]
- A fallback accepts with round 32456478 (judgeBy 1790172800), and an appeal after an escalation decides with round 32398879.
- It refuses:
  - the sim value with no proof;
  - a wrong value with a valid proof;
  - a chosen seed with a valid proof;
  - another round's proof, whether claimed for the fixed round or under its own round;
  - a corrupted proof;
  - a proof the adjudicator did not sign (relayer-attached).

**Size (EIP-170 24,576).** [measured, `forge build --sizes`]
| Contract | Runtime bytes | Margin |
| --- | --- | --- |
| HoldbackRules | 24,051 (was 24,542) | **525** (was 34) |
| DrandQuicknetBeacon | 3,269 | 21,307 |
| SimBeacon | 492 | 24,084 |

**Gas.** [measured]

Fallback `decide(accept)` (`forge test --match-contract GasPerDeal --isolate -vv`):

| Beacon | Gas |
| --- | --- |
| Sim | 161,076 |
| drand verified | **297,591** |

- Verification costs about 136.5k. ADR-0018 guessed about 140k. [measured vs guessed]
- Per-deal table on anvil (`node packages/settlement/dist/evm/gas.js`, receipts, local fixtures on the sim beacon), against T-205's recorded table. Every `PaymentInfo` path is about 11k cheaper because `_paymentInfo` no longer recomputes the commitment ID. [measured]

| Path | Tx | Gas per transaction | Total (T-205 total) |
| --- | --- | --- | --- |
| Happy path (decision carries the delivery) | 2 | 234,141 + 140,915 | 375,056 (396,584) |
| Happy path with on-chain `deliver` | 3 | 234,165 + 61,326 + 130,785 | 426,276 (447,739) |
| Reject | 2 | 234,153 + 140,628 | 374,781 (396,271) |
| Reclaim | 2 | 234,165 + 92,591 | 326,756 (348,666) |
| Early accept | 2 | 234,129 + 149,693 | 383,822 (405,822) |
| Mutual settlement | 2 | 234,165 + 144,447 | 378,612 (400,633) |
| Party appeal (upheld) | 4 | 234,177 + 140,652 + 108,346 + 102,895 | 586,070 (602,600) |
| Escalation, then appeal decides | 3 | 234,153 + 124,434 + 159,245 | 517,832 (534,375) |
| Fallback accepts | 4 | 234,165 + 61,326 + 83,005 + 164,436 | 542,932 (557,025) |
| Default | 4 | 234,153 + 61,314 + 82,993 + 96,738 | 475,198 (494,236) |
| Operator fee bundled, then accept | 2 | 299,102 + 140,903 | 440,005 (461,533) |

- With drand on a shared chain, the fallback and appeal decisions each add about 136.5k: the fallback path is then about 679k. [inferred from the two measurements]
- `contracts/.gas-snapshot` is regenerated (`forge snapshot`). [measured]

**Snapshots.**
- No `.expect.md` changed. `pnpm snap`: 32 pass. `pnpm snap --settlement=local`: 29 pass, 3 excluded (Phase 4), with the same transcript-difference counts as before. [measured]
- `reports/differential-local.md` changes in its gas column only. [measured]

**Chain facts.**
- Foundry v1.0.0 (CI's pin) with `evm_version = "prague"` runs the EIP-2537 precompiles at their final addresses (0x0b G1ADD, 0x0f PAIRING_CHECK, 0x10 MAP_FP_TO_G1). The real rounds verify. [measured]
- anvil now starts with `--hardfork prague`. [measured: anvil suites pass]
- EIP-2537 is live on Ethereum mainnet and Sepolia with Pectra. [inferred, not checked against a public chain in this task]

## Decisions

1. **The signature bytes replace their hash in the Decision calldata.** `HoldbackTypes.Decision.beaconSignatureHash` became `bytes beaconSignature`, and `decisionHash` computes `keccak256(beaconSignature)` for the EIP-712 `Beacon` struct. "The bytes hash to the signed hash" then holds by construction: a relayer cannot attach a proof the adjudicator did not sign (tested). The EIP-712 type, `spec/schemas/` and every signature are unchanged. Only the contract ABI of `decide` changes, and `packages/settlement/evm/encode.ts` follows it.
2. **One beacon interface, `IHoldbackBeacon { roundAt(t); beaconValue(round, proof) }`.** The verifier returns the value and reverts on a bad proof. The drand verifier returns sha256(signature); the sim beacon returns keccak256(simSeed ‖ round) for an empty proof. The rules contract compares the returned value to the signed `beaconValue`, so "value == sha256(signature)" is enforced inside the drand verifier, not in the rules contract. That keeps a sim/drand branch out of HoldbackRules.
3. **The beacon owns the round arithmetic.** `BEACON_GENESIS`, `BEACON_PERIOD` and `beaconRoundAt` left HoldbackRules; `BEACON` (a constructor immutable) replaced them. One drand formula serves every beacon, and the sim beacon uses genesis 1 s and period 1 s, so round(t) = t, as SimChain had. Core gets `beaconRoundAt(clock, t)` with `DRAND_QUICKNET` and `SIM_BEACON` clocks. SimChain itself (`packages/settlement/sim`, outside this task's paths) is unchanged and agrees by construction.
4. **Freeing bytes: `_paymentInfo(id, t)` instead of recomputing `H.commitmentId(t)`.** Every caller already held the ID. That freed 957 bytes and about 11k gas per `PaymentInfo` path, with no ABI change. Two alternatives were measured and not adopted:
   - `optimizer_runs` 50 or 1: still over the limit (-225 and -277 bytes).
   - Making eight constant and immutable getters internal: still -27 bytes, and an ABI loss.
5. **The sim beacon refuses a round the clock has not reached, and refuses to deploy off chain 31337.** That mirrors SimChain's availability rule and drand's (a future signature does not exist). Unit tests that decided an appeal in the same second as the escalation now warp one second, and the handler smoke test's offer has a 16 s `appealDecideSec` (bit 148). With a 1 s window the appeal round is never available in time and the default applies, which became a backlog row.
6. **The local world redeploys `SimBeacon` and `HoldbackRules` per settlement** with the genesis `simSeed`. They come from a snapshot taken before both, so the deployer nonce, the addresses and `fromBlock` are identical every time, and `fresh` asserts it. The alternative was one sim beacon with a fixed seed, which would break every fixture's SimChain-equal panel; and a sim "proof" that carries the seed would let the decider choose it.
7. **Every verifier constant is a PUSH immediate.** The public key and −g2 are word constants, and P_LO is an immutable. The optimizer had moved `P_LO` into trailing code data, where the NoAdmin opcode walk read 0xff bytes as SELFDESTRUCT. With immediates the walk covers the whole runtime code instead of whitelisting a data region.
8. **The pairing call is capped at 250k gas** (two pairs cost 102,900 under EIP-2537). A failing precompile burns all the gas it is given, so the cap bounds what a bad proof costs its relayer. If a future fork reprices the pairing above the cap, proofs fail closed (fallback or default path), never open.
9. **The parse rule is unchanged** (`sim` only). Admitting `drand-quicknet` belongs with the adjudicator service's drand `RandomnessSource` and a drand-backed settlement (T-206). Today SimChain cannot verify a BLS proof, so admitting it there would accept unverified values.

## Handoff

- **State:** done, in review. PR open against `main`; not merged.
- **Out-of-list file:** `reports/differential-local.md` is a tracked artifact that `pnpm verify` regenerates. Its gas column changed and is committed with the adapter change.
- **Follow-ups (backlog rows added):**
  - an external review of `DrandQuicknetBeacon` before Sepolia;
  - the `appealDecideSec` shorter than one beacon period liveness note (advisory warning);
  - the parse rule and the adjudicator's drand `RandomnessSource` for T-206.
- **For T-206 (Sepolia):**
  - Deploy `DrandQuicknetBeacon`, then `HoldbackRules(escrow, erc3009, permit2, margin, beacon)`. `SimBeacon` refuses to deploy there.
  - Re-run `test/unit/DrandBeacon.t.sol`'s vectors against the deployed verifier with `cast call` (read-only).
  - Confirm EIP-2537 on the target chain.
- **Not touched:** `spec/schemas/`, `packages/settlement/sim`, `.github/workflows/ci.yml`. CI's Foundry v1.0.0 already supports Prague.
