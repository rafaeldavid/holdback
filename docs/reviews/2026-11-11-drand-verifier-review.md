# The drand verifier, read against its specifications

Date: 2026-11-11. Task: T-343, package R10b of the contract refinement plan. Reviewer: a Claude Fable 5.2 session, with one `red-teamer` pass (§9). Subject: `contracts/src/DrandQuicknetBeacon.sol`, 175 lines, at `ed6ec36` on `main`.

Each claim carries a label: **measured** (a command or test produced it), **documented** (a published text says it, cited), **inferred** (reasoning from measured or documented facts) or **unverified** (not checked; the reason is given).

## 1. Summary

**Verdict on the verifier: no defect found.** The contract accepts exactly one 48-byte string for each round: the signature drand quicknet published for it. Neither this review nor its red team found a way to forge a value, get two values for one round, or block a valid proof for anyone but the caller.

**One Medium finding lies outside the verifier, in how `HoldbackRules.decide` picks the appeal round** (X-1, §10). The round is the first one after a block's timestamp, and drand publishes it 1 s after that timestamp on mainnet. Whoever lands the escalation or the appeal in a block built that late already knows the appeal panel's seed. The plan knows a weaker form of it (its item IS-7, a block proposer). It goes to the contract lane; this task fixes nothing.

The four things that matter:

1. **Every constant matches its published value, byte for byte** [measured]. That covers the public key, the domain separation tag, the field modulus and the two exponents derived from it, the negated generator, the genesis time, the period and the round encoding (§3).
2. **The contract leaves one check to a precompile: that the signature is in the prime-order subgroup.** EIP-2537 requires `BLS12_PAIRING_CHECK` to make it, and the tests show it does on the EVM that forge runs [measured]. The contract makes every other check itself (§5).
3. **The local tests run on one EVM implementation, and Sepolia no longer runs mainnet's rules.** On 2026-11-11 two Sepolia node implementations gave the same answers for one valid and six invalid proofs [measured]. Four mainnet clients are unchecked, and a Sepolia gas figure does not carry to mainnet (§8).
4. **The appeal round's timing (X-1) is worse on mainnet than on Sepolia:** 1 s against 3 s [measured on two block headers of each chain].

Findings (§10): in the verifier, 0 Critical, 0 High, 0 Medium, 2 Low and 7 Info; both Lows are things the contract relies on its chain for, and one is the known item I-12. Outside the verifier, 1 Medium. This task adds 34 tests in two new files: 12 by the review and 22 by the red team. The contract source is unchanged.

**Still owed:** the read by a model of another family (§11).

## 2. Scope

**Examined:**
- `contracts/src/DrandQuicknetBeacon.sol`, every line, and its call site in `HoldbackRules.decide` (`contracts/src/HoldbackRules.sol:258-297`).
- The existing tests: `contracts/test/unit/DrandBeacon.t.sol`, `contracts/test/crosscheck/DrandEncodings.t.sol`, `contracts/test/crosscheck/DrandAllRounds.t.sol`, `contracts/test/unit/DrandDecide.t.sol`.
- The Sepolia deployment `0xBe80ad8Ba4E49bc985ef43caD71740351EE4Cc10`, by read-only calls. Its code hash is `0x7ff87f83…d3cc`, the value in `contracts/deployments/sepolia.json` [measured]. The source file has not changed since the deployed commit `64be1f1` [measured: `git diff --stat 64be1f1 HEAD` on the file is empty].

**Left out:**
- The off-chain check (`apps/adjudicator/src/drand.ts`) and which round `decide` picks (T-225 item 1, the fallback round that is public before the primary's deadline).
- The Solidity compiler. This review read the source, not the bytecode.
- The security of drand, BLS12-381 or the pairing itself. The review takes the scheme as given.

**Sources**, fetched 2026-11-11. Where a fetch returned a summary and not the page's own text, the claim that depends on it is marked unverified.

| Short name | Source |
| --- | --- |
| drand info | `https://api.drand.sh/52db9ba7…84e971/info`, and the same path on `drand.cloudflare.com`; both returned the same JSON |
| drand scheme | `drand/drand`, `crypto/schemes.go`: `NewPedersenBLSUnchainedG1`, `RandomnessFromSignature` |
| drand time | `drand/drand`, `common/time.go`: `TimeOfRound`, `NextRound`, `CurrentRound` |
| drand curve library | `drand/kyber-bls12381`, `kyber_g1.go`: `domainG1`, `Hash` |
| EIP-2537 | `https://eips.ethereum.org/EIPS/eip-2537` (Final), and its `field_to_curve` document |
| RFC 9380 | `https://www.rfc-editor.org/rfc/rfc9380.txt` |
| ZCash format | `zkcrypto/pairing`, `src/bls12_381/README.md`, "Serialization" |
| Curves draft | `draft-irtf-cfrg-pairing-friendly-curves-11`, §4.2.1 (an expired draft, used for the cofactor only) |
| MODEXP | EIP-2565, EIP-7883, EIP-7823 |
| Forks | EIP-7600 (Pectra), EIP-7607 (Fusaka), EIP-7773 (Glamsterdam) |

## 3. Is every constant right?

**Yes** [measured, twice]:
- The new test `test_review_constants_matchThePublishedValues` reads each constant out of the contract and compares it with the published value. CI reruns it.
- A session script made 32 checks with `@noble/curves` 1.9.1 and its own field arithmetic. All pass. The script is not in the repository; the table gives the values it used.

| Constant | Lines | Published value | Result |
| --- | --- | --- | --- |
| `GENESIS = 1692803367`, `PERIOD = 3` | 18-19 | drand info: `"genesis_time":1692803367`, `"period":3` | equal |
| Chain hash in the NatSpec | 8 | drand info: `"hash":"52db9ba7…0c84e971"` | equal |
| `DST_A ++ DST_B`, 32 + 11 bytes; `DST_LEN = 43` | 23-25 | drand scheme: `[]byte("BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_")`; the same string is `domainG1` in the curve library | equal, 43 bytes |
| `PK_0` to `PK_7`, the public key | 30-37 | drand info: `"public_key":"83cf0f28…f5ece45a"`, 96 bytes | equal (below) |
| `NG_0` to `NG_7`, the negated G2 generator | 40-47 | EIP-2537, "Curve parameters", H2 | x equal; y equal to p − y in both components |
| `P_HI`, `P_LO`, the field modulus p | 50, 70 | EIP-2537, "Curve parameters": `0x1a0111ea…ffffaaab`; RFC 9380 §8.8.1 gives the same p | equal |
| `HALF_HI`, `HALF_LO` | 54-55 | (p − 1) / 2, computed | equal |
| `SQRT_EXP_HI`, `SQRT_EXP_LO` | 56-57 | (p + 1) / 4, computed; p mod 4 = 3 | equal; it fits the 48 bytes the code packs |
| Precompile addresses `0x0b`, `0x0f`, `0x10` | 60-62 | EIP-2537, "Constants": `BLS12_G1ADD 0x0b`, `BLS12_PAIRING_CHECK 0x0f`, `BLS12_MAP_FP_TO_G1 0x10` | equal |
| `PAIRING_GAS = 250_000`; "two pairs cost 102,900" | 63-65 | EIP-2537, "Pairing check operation": `32600*k + 37700` | 102,900 gas for k = 2 |

**The public key.** drand publishes it compressed, in the ZCash format: x.c1, then x.c0, 48 bytes each, with three flag bits at the top of the first byte (ZCash format: "c1 followed by … c0"). EIP-2537 wants x.c0, x.c1, y.c0, y.c1, 64 bytes each ("Fine points and encoding of base elements": `encode(c0) || encode(c1)`). Four checks agree [measured]:
- `PK_0, PK_1` equal the key's second 48 bytes, and `PK_2, PK_3` equal its first 48 bytes with the flags masked off (the test and the script).
- The point (`PK_0..3`, `PK_4..7`) satisfies y² = x³ + 4(u + 1), computed with the script's own field arithmetic. Its y is the smaller root, which is what the key's sign bit (0) says.
- `PAIRING_CHECK` accepts the point as a G2 input, which it does only for a point on the curve and in the subgroup (the test).
- `@noble/curves` 1.9.1 decompresses the published key to the same four coordinates and finds the point in the order-r subgroup (the script).

**The negated generator.** `G2ADD` of EIP-2537's generator and `NG_0..7` returns the identity (the test).

**The round encoding.** drand signs `sha256` over `binary.Write(h, binary.BigEndian, b.GetRound())`, where the round is a `uint64`: 8 bytes, big-endian (drand scheme, `DigestFunc`). The contract hashes `abi.encodePacked(round)` with `round` a `uint64` (line 82), which is the same 8 bytes [inferred from Solidity's packed encoding; measured by the seven real rounds that verify, among them rounds 1 and 1000, which a little-endian or wider encoding would fail].

**The strongest evidence** is that real rounds verify. A wrong key, tag, generator or encoding would refuse all seven fixture rounds; they are accepted, on chain and off [measured: `test_everyFixtureRound_accepted`; the Sepolia deployment returns `0xfe290bec…30e54fdd` for round 1000].

## 4. Does it accept only a valid signature for exactly this round of exactly this chain?

**Yes** [inferred from the line-by-line read; each case below is measured by a test].

### 4.1 The read, line by line

| Lines | What the code does | Specification | Result |
| --- | --- | --- | --- |
| 74-76 | `roundAt(t)`: 0 before genesis, else (t − genesis) / period + 1 | drand time: `NextRound` is `floor((now − genesis) / period) + 1`, plus one; `CurrentRound` is one less | Equal from genesis on. Info R-1 and R-2 cover the two edges |
| 80 | Refuses any length but 48 | ZCash format: "48 bytes in compressed form" | Correct |
| 122-123 | Requires the compression bit set and the infinity bit clear | ZCash format: the first and second most significant bits | Correct. The identity never reaches a precompile |
| 124-125 | Masks the top three bits; reads x as two words | ZCash format: "The most-significant three bits … should be masked away"; "big-endian" | Correct |
| 126 | Refuses x ≥ p | EIP-2537, "Fine points": "must be less than field modulus" | Correct, and stricter than the ZCash text, which does not state it |
| 128-134 | x³ mod p by MODEXP; adds 4 with a carry; subtracts p once if needed | Curve y² = x³ + 4 (EIP-2537; RFC 9380 §8.8.1) | Correct. x³ ≤ p − 1, so the sum is below 2p and one subtraction is enough |
| 135-137 | y = (x³ + 4)^((p+1)/4); refuses unless y² = x³ + 4 | p mod 4 = 3, so this is the square root when one exists | Correct |
| 138-139 | Picks y or p − y by the sign bit: set means y > (p − 1) / 2 | ZCash format: the third bit marks "the lexicographically largest" y. The Curves draft's Appendix C defines it as y > (p − 1) / 2 [unverified: read through a summary]. All seven real rounds decompress to points that verify [measured] | Correct |
| 140 | Returns x, y as 64-byte big-endian words | EIP-2537, "Fine points": 64 bytes, big-endian, top 16 bytes zero; x then y | Correct. x and y are below p, so the top 16 bytes are zero |
| 82 | Message: `sha256` of the round as 8 big-endian bytes | drand scheme, `DigestFunc` | Correct |
| 100-111 | `expand_message_xmd` with SHA-256, 128 bytes out | RFC 9380 §5.3.1: `Z_pad` of 64 zero bytes, `l_i_b_str = I2OSP(128, 2)`, `I2OSP(0, 1)`, `DST_prime = DST ‖ I2OSP(43, 1)`, `b_i = H(strxor(b_0, b_(i−1)) ‖ I2OSP(i, 1) ‖ DST_prime)`, ell = 4 | Correct, step for step |
| 93-95, 114-116 | Two field elements: 64 bytes each, big-endian, reduced mod p | RFC 9380 §5.2: `e_j = OS2IP(tv) mod p`; §8.8.1: L = 64, m = 1; count = 2 | Correct. MODEXP with exponent 1 is the reduction |
| 94-96 | `MAP_FP_TO_G1` on each element, then `G1ADD` | RFC 9380 §3: `Q0 + Q1`, then `clear_cofactor`. EIP-2537 `field_to_curve`, "Full algorithm restated": the map ends with `clear_cofactor`, `h_eff: 0xd201000000010001`, the same `h_eff` as RFC 9380 §8.8.1 | Correct. Clearing is a scalar multiplication, so h·Q0 + h·Q1 = h·(Q0 + Q1) |
| 83-85 | `PAIRING_CHECK` on (sig, −g2), (H(m), pk); requires success, 32 bytes, value 1 | EIP-2537, "ABI for pairing check": slices of a G1 point then a G2 point; it checks `e(P1, Q1) * … == 1`; output is 32 bytes ending `0x01` for true | Correct. e(sig, −g2) · e(H(m), pk) = 1 holds exactly when sig = sk·H(m) |
| 86 | Returns `sha256(signature)` | drand scheme, `RandomnessFromSignature`: `sha256.Sum256(sig)` | Correct |
| 151-153 | MODEXP input: three 32-byte lengths, base, exponent, modulus | EIP-198 layout [unverified: the EIP was not fetched; the real rounds that verify measure it] | Correct |
| 155-159 | Every precompile call must succeed and return the expected length | EIP-2537 states nothing for a chain without the precompiles; an empty account returns no data | Correct: refused, never accepted [measured, §4.2 case 7] |

**Why one string per round.** The pairing is non-degenerate and G1 has prime order, so exactly one point of G1 satisfies the equation. `PAIRING_CHECK` fails for a point outside G1. A point has one accepted encoding: x must be below p, the two flag bits are fixed, and the sign bit must match y. So `sha256(signature)` has one possible value per round [inferred; measured for the eight flag values on all seven fixture rounds by `DrandAllRounds.t.sol`].

**Why this chain only.** An unchained drand round signs the round number and nothing else, so the message does not name the chain. The public key is what binds a proof to quicknet [documented: drand scheme, "Unchained means we're only hashing the round number"]. Another chain's signature of the same round is a different point, and the pairing answers false.

### 4.2 The cases

All tests are in `contracts/test/`; "new" means `crosscheck/DrandVerifierReview.t.sol`, added by this review. All pass [measured: `forge test --root contracts`, forge 1.0.0].

| # | Case | Result | Test |
| --- | --- | --- | --- |
| 1 | A wrong round: round 1000's signature for round 1001, and for round 1 | Refused by the pairing, which answers false | `unit/DrandBeacon.t.sol`: `test_refuses_wrongRound`, `test_refuses_anotherRoundsSignature` |
| 2 | On the curve, outside the subgroup: x = 4; the order-3 points (0, ±2); a real signature plus an order-3 point | Refused: `PAIRING_CHECK` fails and burns its 250,000 gas | `test_refuses_aCurvePointOutsideG1`; `crosscheck/DrandEncodings.t.sol` |
| 3 | The identity point: `0xc0` then 47 zero bytes; also with the sign bit, without the compression bit, and 48 zero bytes; for rounds 0, 1, 2, 20,000,000 and 2⁶⁴ − 1 | Refused before any precompile | new: `test_review_theIdentityPoint_refusedBeforeAnyPrecompile` |
| 4 | A malformed length: 0, 1, 47, 49, 96 (the real point uncompressed), 128 (the real point as EIP-2537 bytes) | Refused before any precompile | `test_refuses_malformedEncodings`; new: `test_review_otherLengthsOfTheRealPoint_refused` |
| 5 | A non-canonical field element: x = p, p + 1, 2³⁸¹ − 1; and 2·G written with x + p, which a decoder that reduces mod p reads as a point of G1 | Refused before any precompile. The canonical 2·G reaches the pairing and is refused there | `test_defense_xAboveP_refusedBeforeAnyPrecompile`; new: `test_review_xPlusP_ofAPointInG1_refusedBeforeAnyPrecompile` |
| 6 | A valid signature from another drand chain: round 1000 of `quicknet-t` (same scheme and tag, another key), which verifies under its own key off chain; round 1000 of `default` (96 bytes) and of `evmnet` (64 bytes, BN254) | `quicknet-t`: the pairing runs and answers false. The other two: refused by length | new: `test_review_aValidSignatureOfAnotherChain_sameScheme_refusedByThePairing`, `test_review_signaturesOfOtherSchemes_refused` |
| 7 | An EVM without EIP-2537 (Cancun rules) | A real round is refused; nothing is accepted | new: `test_review_withoutThePrecompiles_aRealRoundIsRefused` |
| 8 | The hashed point for any message | In the subgroup: `PAIRING_CHECK` accepts e(H, g2) · e(H, −g2) for 256 random messages | new: `testFuzz_review_hashToG1_isAPointOfG1` |

One case has no vector: drand's retired `fastnet` chain. Its `/info` answers 404 and `api.drand.sh/chains` no longer lists it [measured 2026-11-11]. It signed under another key, so the reasoning for `quicknet-t` applies [inferred].

## 5. Which checks does the contract leave to the precompiles?

| Check | The contract | The precompile | EIP-2537 text |
| --- | --- | --- | --- |
| The signature is 48 bytes, compressed, not the identity | Yes (80, 123) | Not applicable: precompiles take uncompressed points | |
| x is below p | Yes (126) | Also | "Fine points": "The corresponding integer **must** be less than field modulus" |
| The point is on the curve | Yes (137) | Also | "ABI for pairing check", error cases |
| **The signature is in the order-r subgroup** | **No** | **Yes, `PAIRING_CHECK`** | "Subgroup checks": "MSMs and pairings MUST perform a subgroup check." "On any input that fails the subgroup check, the precompile MUST return an error." |
| The two hash-to-field elements are valid field elements | Yes, by construction: MODEXP reduces them mod p | Also, `MAP_FP_TO_G1` | "ABI for mapping Fp element to G1 point", error cases |
| H(m) is in the subgroup | No | `MAP_FP_TO_G1` clears the cofactor; `PAIRING_CHECK` checks again | `field_to_curve`, "Full algorithm restated", step 3. "There is no subgroup check for the G1 addition precompile", which is harmless: the sum of two subgroup points is in the subgroup |
| The public key and −g2 are valid points of G2 | Constants (§3) | `PAIRING_CHECK`, on every call | "ABI for pairing check" |
| The pairing product equals 1 | Reads the result strictly: success, 32 bytes, value 1 (85) | Yes | "ABI for pairing check" |
| The precompiles exist | Yes: every result's length (85, 158) | | |

**The precompile performs the one check the contract leaves to it** [measured on forge's EVM by case 2; measured on two Sepolia node implementations, §8; documented as a MUST].

**Checks that neither performs**, and why none is needed [inferred]:
- **That the round is published, or is not round 0.** A signature for an unpublished round does not exist until a threshold of drand nodes signs it. `decide` fixes the round from settlement state; the beacon proves only the value.
- **That H(m) is not the identity.** If it were, only the identity would satisfy the equation, and line 123 refuses the identity. The chance is about 2⁻²⁵⁵ per round.
- **That y is not 0.** No curve point has y = 0: such a point would have order 2, and the group order h · r is odd [measured: both factors are odd; h from the Curves draft §4.2.1, r from EIP-2537]. So p − y is never p.
- **The chain hash.** The scheme does not sign it (§4.1).

## 6. What can a caller who controls the inputs do?

| Goal | Verdict | Why |
| --- | --- | --- |
| Get a value for an invalid proof | **No** | §4. Also no gas amount turns a refusal into a value: for every gas amount from 5,000 to 400,000, in steps of 2,500, an invalid proof reverts [measured: `test_review_anyGasAmount_aValidProofRevertsOrReturnsItsValue`] |
| Get a second value for a round | **No** | One accepted string per round (§4.1) |
| Make a valid round revert for someone else | **No** | The function is `view` and keeps no state. A caller who forwards too little gas makes their own call revert: a valid proof reverts below about 137,500 gas and returns its one value above it [measured, Prague prices]. In `decide` the revert undoes the whole transaction, and anyone can send it again |
| Burn gas | **Their own, up to the cap** | A curve point outside G1 makes `PAIRING_CHECK` fail, which burns the 250,000 gas it was given (EIP-2537, "Gas burning on error"). No other precompile call can fail on caller input: MODEXP has no error case at these fixed lengths (EIP-7823 bounds them at 1,024 bytes; these are 64, 48 and 1), and the inputs of `MAP_FP_TO_G1` and `G1ADD` come from MODEXP and from each other, never from the caller [inferred]. The uncapped calls therefore burn only what they cost |

The cost of each refusal is in §7. The adjudicator service checks a proof locally before it signs a decision (T-217, decision 6), so an honest relayer never sends a bad proof.

## 7. Gas: items I-12 and I-13, re-measured

**Local, Prague prices** [measured: `FOUNDRY_GAS_REPORTS='["DrandQuicknetBeacon"]' forge test --root contracts --gas-report`, forge 1.0.0, `evm_version = "prague"`; the per-case rows come from `test_review_gasOfOneVerification`, which measures around a call to a warm beacon].

| Call | Gas |
| --- | --- |
| `beaconValue`, a valid proof (rounds 1, 1000 and 20,000,000) | 136,116 to 136,263 gas |
| `beaconValue`, a point of G1 that is not the signature (the pairing answers false) | 136,736 gas |
| `beaconValue`, a curve point outside G1 (the pairing fails) | 282,797 gas in the report; 283,587 gas around the call |
| `beaconValue`, an x with no curve point | 13,238 gas |
| `beaconValue`, an x not below p | 1,545 gas |
| `beaconValue`, the cheapest refusal in the report (a wrong length, inferred) | 423 gas |
| `hashToG1` | 18,648 gas |
| `HoldbackRules.decide`, the most expensive of the 11 calls in `DrandDecideTest` and `GasPerDealDrandTest` | 366,541 gas |
| Deployment of the beacon | 760,364 gas, 3,346 bytes |

**I-13: verification costs more than ADR-0018 says. Confirmed.**
- **Measured on Sepolia, 2026-11-11:** `eth_estimateGas` for a transaction that calls `beaconValue(1000, …)` on the deployment returns **213,185 gas**, on a reth node and on Tenderly's node. That is the figure I-13 gave ("about 213k"). It includes the transaction's base cost and calldata.
- **Derived for Fusaka's rules:** EIP-7883 reprices MODEXP. One verification makes five MODEXP calls with a 64-byte base and modulus. Four have a one-byte exponent: 200 gas each under EIP-2565, 500 gas each under EIP-7883. The square root has a 48-byte exponent: 8,170 gas under EIP-2565, 65,408 gas under EIP-7883. The total rises from 8,970 gas to 67,408 gas, **58,438 gas more** [inferred from the two EIPs' formulas as written]. So a valid proof costs about 194,600 gas of execution under Fusaka's rules, and a proof outside G1 about 341,200 gas.
- **The two do not reconcile to the gas** [unverified]. Sepolia's transaction pricing has changed: `eth_estimateGas` for `roundAt` returns 17,466 gas, below the 21,000 gas base cost of a transaction before Glamsterdam [measured]. EIP-7773 lists a Sepolia activation for Glamsterdam on 2026-10-06 and leaves mainnet's row blank [documented]. This review did not read Glamsterdam's pricing EIPs closely enough to split the 213,185 gas into parts.
- **Forge 1.0.0 cannot measure Fusaka's prices.** It knows the Prague rules. Re-measuring under mainnet's rules needs a newer forge or a mainnet fork (§8, line G-2).

**I-12: `PAIRING_GAS` is fixed. Confirmed, with the margin.**
- Two pairs cost 102,900 gas, which is 41% of the 250,000 gas cap. The verifier keeps working until the price of two pairs passes 250,000 gas, 2.43 times today's.
- The cap bounds the burn of a failing pairing at 250,000 gas. With less than about 254,000 gas left at the call, the precompile gets all but one 64th of what is left; it needs 102,900 gas.
- No EIP that EIP-7773 lists as scheduled for Glamsterdam names MODEXP, BLS or a precompile in its title. The five with gas repricing in their titles (EIP-2780, EIP-7976, EIP-7981, EIP-8037, EIP-8038) state no new price for `0x02`, `0x05`, `0x0b`, `0x0f` or `0x10` [documented; unverified for the last third of EIP-8037, which reached this review as a summary].
- The disposition of I-12 stands: accepted; another chain or a repriced fork gets another beacon contract.

## 8. What a testnet cannot show: lines for the mainnet gate

**What was checked.** The forge suite runs every case on one EVM, the one inside forge 1.0.0 [measured; which pairing library it uses is unverified]. On 2026-11-11 the Sepolia deployment gave the same eight answers on a reth v2.11.0 node (`ethereum-sepolia-rpc.publicnode.com`) and on Tenderly's node (`sepolia.gateway.tenderly.co`) [measured, read-only `eth_call`]:
- round 1000's signature returns `0xfe290bec…30e54fdd`;
- a wrong round, x = 4 (outside G1), a real signature plus an order-3 point, `quicknet-t`'s signature, 2·G with x + p, and the identity each revert with `InvalidSignature` (`0x8baa579f`);
- `hashToG1` of round 1's message returns the fixture's point.

A third endpoint (`1rpc.io/sepolia`) spread the calls over several backends, so its answers prove nothing about one client.

**Lines for the gate.** Each is a check to pass before a mainnet deployment.

| # | Line | Why a testnet does not settle it |
| --- | --- | --- |
| G-1 | Run the beacon's vectors through the EVM of every execution client with mainnet stake: Geth, Nethermind, Besu, Erigon and Reth. The vectors are the seven real rounds, the refusals of §4.2, and the red team's nine points outside G1 (a real signature plus a point of order 11, 10177, 859267, 52437899 or mixed order, and four small-order points alone; `DrandRedTeam.t.sol`). Require the same result and the same gas from each | A client whose `PAIRING_CHECK` skipped the subgroup check would accept about 7.6 · 10³⁷ strings per round (finding R-2), and a disagreement between clients is a consensus fault. Geth, Nethermind, Besu and Erigon are unchecked by this review |
| G-2 | Re-measure `beaconValue` and a drand-proven `decide` under the fork rules mainnet runs on the deployment day, on a mainnet fork | Sepolia runs a later fork than mainnet today [measured: the 17,466 gas estimate; documented: EIP-7773]. A Sepolia figure is not a mainnet figure |
| G-3 | Confirm that no fork active or scheduled on mainnet prices two pairs of `PAIRING_CHECK` above 250,000 gas | The cap is a constant (I-12). A repricing past it stops every fallback and appeal decision on that deployment, and the contracts have no admin to change it |
| G-4 | Mine each refusal once on a public testnet and read the receipt: status 0, and the gas the local run predicts | No bad proof has been mined: the service refuses one before it sends a transaction (T-217). The refusal path, with its 250,000 gas burn, has run only in `eth_call` and in forge. This needs a transaction, so it waits for Rafa |
| G-5 | After the mainnet deploy, check the beacon's code hash against the audited build, and run the deploy script's three checks: round 1000's value, a refusal outside G1, a refusal of another round | Sepolia's deployment proves nothing about the bytes at another address |
| G-6 | Keep the service's local check before signing (T-217, decision 6) | On mainnet a refused proof burns 250,000 gas or more of real ETH |
| G-7 | Record the trust this contract places in drand, as residual risks: a threshold of the League of Entropy's nodes can predict rounds; quicknet can stop; the key is a constant | drand retired its `fastnet` chain [measured: 404, and absent from `/chains`]. If quicknet stops or changes its key, no fallback or appeal can be proven on this deployment, and each deal takes its default outcome (ADR-0018 §5, residual 10 in `docs/neutrality.md`). What drand commits to for quicknet's lifetime is unverified |
| G-8 | Deploy the beacon only on chains that have EIP-2537 at `0x0b`, `0x0f` and `0x10` at Ethereum's prices | Without the precompiles every proof is refused [measured, case 7]. With other prices the cap may not fit |
| G-9 | Settle finding X-1 before any path that uses `roundAt(t) + 1` runs on mainnet: after SC-7 that is the escalation | Mainnet block timestamps sit 1 s before a quicknet round; Sepolia's sit 3 s before one [measured: blocks 21,000,000 and latest on mainnet, 12,061,240 and latest on Sepolia; it holds for every 12 s slot, inferred]. Sepolia understates the exposure |
| G-10 | Deploy the beacon with a creation transaction, never by placing its runtime code | The modulus's low word is an immutable set in the constructor. Runtime code placed without it refuses every real round [measured: `test_boundary_break_runtimeCodeWithoutTheConstructor_refusesEveryRealRound`]. Sepolia's script uses `forge create` |

## 9. The red-team pass

One `red-teamer` subagent attacked the contract on 2026-11-11. It had the contract, its tests, the fixture, the project's context (CLAUDE.md, ADR-0018, the threat model) and a digest of the specifications with sources only. It did not have this review's conclusions, and it wrote its attack list before it opened the review's test file. Its tests are `contracts/test/crosscheck/DrandRedTeam.t.sol`: 22 tests, all pass [measured]. A test named `test_attack_…` is an attack that failed; `test_issue_…` is one that worked; `test_boundary_…` shows what the contract relies on.

| Goal | Result |
| --- | --- |
| Forge a value | **Failed.** Nine kinds of attack, among them: a real signature plus a point of small order (five orders); the small-order points alone; 28 points and 12 arithmetic edge values decompressed against `@noble/curves`; sums and doubles of real signatures; a round number misread; calldata that is not canonical ABI; 200 arbitrary compressed strings |
| Break a valid proof | **Failed.** The hash to G1 equals the library's for rounds 0, 2, 2³², 2⁶³ and 2⁶⁴ − 1. Too little gas reverts and changes nothing; the retry settles |
| Burn gas | **Bounded.** No refusal cost more than the cap plus the work before it: at most 283,750 gas over 200 strings, and 300,823 gas for a whole `decide` |
| A wrong round | **One issue, in `HoldbackRules`:** finding X-1 |
| A wrong chain or fork | **Nothing accepted.** An answer from `0x0f` in any other shape, or from `0x10` or `0x0b` in another length, is refused |

The red team could not attack another precompile implementation, a Fusaka EVM or a repriced precompile, and had no network. Its findings are in §10 with the severity it gave each.

## 10. Findings

**In the verifier: no defect.** The two Lows are things the contract relies on its chain for. **Outside it: one Medium.**

- **X-1 · Medium · Outside the verifier · Whoever lands the step that fixes the appeal round can already know that round** (`HoldbackRules.sol:262-269`; found by the red team).
  - **What is wrong.** After an escalation or a party's appeal, the appeal panel's round is `roundAt(t) + 1`, with t the block's timestamp. drand publishes that round 1, 2 or 3 s after t [measured: 300 consecutive seconds]. A block carries its slot's timestamp and is often put together later than that. A transaction in such a block can carry the round's real signature, and the contract accepts it [measured: `test_issue_wrongRound_appealRoundIsProvenAtTheTimestampThatFixesIt`].
  - **How a party uses it.** A 45-line contract asks the beacon for the next round's value, derives the appeal panel's seed, and files the appeal or lands the escalation only if the seed suits. Otherwise it reverts, nothing is filed, and the party tries the next block [measured: `test_issue_wrongRound_appellantFilesOnlyWhenTheAppealSeedSuitsIt`, `test_issue_wrongRound_relayerLandsTheEscalationOnlyWhenTheAppealSeedSuitsIt`].
  - **Impact.** A party, or whoever relays the primary's escalation, chooses the appeal panel among the panels of the rounds in its window. ADR-0018 counts 18 panels for a registry of 6 and a panel of 3. The appeal decision is final. The beacon stays sound: the attacker picks among real rounds.
  - **Where it is worst.** The margin is 1 s on mainnet and 3 s on Sepolia (gate line G-9). Whether a sender can get a transaction into a block 1 s after its timestamp was not tested here [inferred: block proposers can; a sender needs a block builder that still takes transactions then].
  - **What is known already.** The plan's item IS-7 says a block proposer can know the round, and accepts it for Sepolia only. T-225 leaves the same point out of scope. ADR-0018's "Known gap" says the appeal rounds "publish strictly after the step that fixes them", which holds for the timestamp and not for the moment the block is built. New here: the gate contract makes the choice atomic for any sender, and mainnet's margin is 1 s.
  - **What SC-7 changes.** The cut of party appeals from phase one removes `fileAppeal`. The escalation keeps the rule.
  - **Fix (not applied).** Take a later round, `roundAt(t) + k`, with 3 · k seconds longer than the longest gap between a block's timestamp and its building on the target chain. The contract and core's `beaconRoundFor` change together, with an ADR-0018 amendment and a redeploy, as T-225 item 1 does for the fallback round.
  - **Owner.** The contract lane, with the fixes of the plan's section 5 for IS-7. The coordinator decides whether it joins T-225 item 1.
- **R-1 · Low (the red team's rating) · The pairing cap is a constant; a dearer pairing refuses every real round for good** (`DrandQuicknetBeacon.sol:65, 84`).
  - This is the known item I-12, which `known-issues.md` holds as Info, accepted. §7 gives the margin: 2.43 times.
  - Impact: on a chain or fork that prices two pairs above 250,000 gas, no fallback or appeal decision settles on that deployment, and each fallback deal defaults to the buyer [measured with the failing call simulated: `test_boundary_fork_aPairingPricedAboveTheCap_everyFallbackDealDefaultsToTheBuyer`]. Whoever sets the chain's gas schedule stops those paths.
  - Fix: none in phase one. Gate lines G-3 and G-8. The audit-docs lane may add the neutrality sentence to I-12's row.
- **R-2 · Low (the red team's rating) · Only the precompile checks that a signature is in the subgroup** (`:118-120, 84`).
  - The cofactor of G1 is 3 · 11² · 10177² · 859267² · 52437899². Off chain, a real signature plus a point of any of those orders satisfies the equation when nothing checks the subgroup [measured by the red team's script]. With `0x0f` replaced by a mock that answers 1, the contract returns a value for a point of order 11 [measured: `test_boundary_fork_aPairingThatAlwaysAnswersTrue_acceptsAPointOutsideG1`].
  - Impact: none on a chain that follows EIP-2537, where the check is a MUST (§5). On one that did not, a decider could shop among about 7.6 · 10³⁷ strings per round.
  - Fix: none needed. A second check through another precompile would run the same client's library, so it would add no independence [inferred]. Gate line G-1 sends the nine vectors to every client.
- **R-3 · Info · `roundAt` wraps for a time no deal can hold** (`DrandQuicknetBeacon.sol:74-76`) [measured].
  - `roundAt` takes a `uint256` and casts the round to `uint64`. From t = genesis + 3 · (2⁶⁴ − 1) the round wraps to 0.
  - Impact: none through `HoldbackRules`. It passes `judgeBy`, a `uint64`, and `t1` and `t2`, each a `uint40`. For every 64-bit time the result is exact (`testFuzz_review_roundAt_exactForEvery64BitTime`).
  - Evidence: `test_review_roundAt_wrapsOnlyBeyond64BitTimes`.
  - Fix: none needed. The NatSpec pass (package R9) may state the domain.
- **R-4 · Info · Before genesis the contract says round 0 and drand says round 1** (`:75`) [documented: drand time, `CurrentRound`].
  - Impact: none. Genesis was 2023-08-23. A deadline before it names a round nobody signed, so no fallback could be proven and the deal takes its default outcome.
  - Fix: none.
- **R-5 · Info · A refused proof can cost its sender 282,797 gas under Prague's prices, about 341,200 gas under Fusaka's** (`:63-65, 84`) [measured; the Fusaka figure is inferred].
  - Impact: the sender's own gas. Known since T-217 ("burns up to 250,000 gas in the pairing check"). The figure is now measured.
  - Fix: none in the contract. Gate line G-6 keeps the local check.
- **R-6 · Info · I-13 stands: 213,185 gas for a transaction on Sepolia** (§7). ADR-0018's figure is out of date. The owner of ADR-0018 corrects it when the mainnet figure exists (G-2).
- **R-7 · Info · The local tests and CI cover one EVM implementation** (§8). Gate line G-1 closes it.
- **R-8 · Info · `decide` looks at the proof before the adjudicator's signature** (`HoldbackRules.sol:290-301`; found by the red team).
  - Anyone can write a Decision that reaches the pairing; no adjudicator has to sign it. With a point outside G1 as its proof, the reverted transaction costs its sender 300,823 gas under Prague's prices [measured: `test_attack_burn_unsignedDecisionWithAPointOutsideG1_costsItsRelayerTheCapAndLittleMore`].
  - Impact: the sender's own gas. An operator node that relays a decision without simulating it pays this for each bad decision it is handed.
  - Fix: none needed. The contract lane may check the signature first; operators simulate before they relay.
- **R-9 · Info · A valid proof relayed with too little gas reverts as `InvalidSignature`** (`DrandQuicknetBeacon.sol:84-85`; found by the red team).
  - The capped pairing call runs out of gas, and the contract reports the same error as for a bad signature. A valid fallback `decide` settles from a gas limit of 305,000 gas under Prague's prices; below it the revert names `InvalidSignature` at 19 of the limits tried [measured: `test_attack_break_validDecisionWithTooLittleGas_revertsAndSettlesOnRetry`].
  - Impact: no state changes and the retry settles. A relayer that reads `InvalidSignature` as final would drop a good decision.
  - Fix: none in the contract. Relayers estimate gas before they send, and treat this error as final only after a simulation with ample gas.

## 11. Recommendations and open questions

| # | Item | Owner |
| --- | --- | --- |
| 1 | Take finding X-1, the appeal round's timing, to the contract lane with its three tests | The coordinator; the contract lane fixes it |
| 2 | Add gate lines G-1 to G-10 to the plan's mainnet gate | The coordinator, in the contract refinement plan |
| 3 | **The second-family read is still owed** (the plan's R10b; T-225 item 7). This session has no model of another family and did not improvise one | The coordinator |
| 4 | Decide whether to mine the refusals on a testnet (G-4). It needs a live transaction | Rafa |
| 5 | Correct ADR-0018's gas figure once G-2 gives mainnet's, and its sentence that the appeal rounds hold | The session that runs G-2; the session that fixes X-1 |
| 6 | Record the drand trust assumptions (G-7) in `docs/audit/threat-model.md` | The audit-docs lane (T-338, T-342) |
| 7 | When the SC-7 cut removes `fileAppeal`, delete `test_issue_wrongRound_appellantFilesOnlyWhenTheAppealSeedSuitsIt` and its helpers from `DrandRedTeam.t.sol`; the escalation test stays | The contract lane (package R6) |

**What the second-family read needs.** Give the other model the inputs, not this review's conclusions:
- `contracts/src/DrandQuicknetBeacon.sol` at the commit the audit freezes, and lines 250 to 300 of `HoldbackRules.sol`.
- The sources of §2, as links, so that it fetches the constants itself: the quicknet `/info` JSON, `crypto/schemes.go`, EIP-2537 with its `field_to_curve` document, RFC 9380 §3, §5.2, §5.3.1 and §8.8.1, and the ZCash serialization text.
- `fixtures/beacon/drand-quicknet.json` and the five drand test files under `contracts/test/`.
- The six questions of this task, word for word (`docs/tasks/T-343-drand-verifier-review.md`, Intent).
- For T-225 item 7: `quicknetValue` in `apps/adjudicator/src/drand.ts` against `beaconValue`, and `beaconRoundFor` in `packages/core/src/state.ts` against the round selection in `decide`.

Ask it for four things: its own derivation of each constant; its own line-by-line read; one attempt to forge a proof and one to break a valid proof; and what it knows about how Geth, Nethermind, Besu, Erigon and Reth implement the subgroup check of `PAIRING_CHECK`. Then compare its report with this one.

**What this review did not verify:**
- The definition of the sign bit in the Curves draft's Appendix C, and RFC 9380's test vectors in Appendices J.9.1 and K.1: the fetch returned summaries. The contract's tag is a constant, so the RFC's vectors, which use another tag, cannot run against it. The real rounds measure the same code paths.
- EIP-198's input layout for MODEXP: not fetched.
- Which 32 bytes of a 48-byte exponent each client counts for MODEXP's price. EIP-7883's formula as written gives 58,438 gas more; a client that counts the leading 32 bytes gives 57,904 gas more.
- Whether Glamsterdam is active on Sepolia. EIP-7773 lists the date, and the 17,466 gas estimate fits it.
- Compiler bugs in solc 0.8.28 with the IR pipeline (the static-analysis package's ground).
