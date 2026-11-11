# The drand verifier, a second read by another model family

Date: 2026-11-11. Task: T-353, the second-family read that T-343 left owed (`docs/reviews/2026-11-11-drand-verifier-review.md`, §11). Reader: DeepSeek `deepseek-v4-pro@2026-11-01`. Checker: a Claude Opus 5.5 session. Subject: `contracts/src/DrandQuicknetBeacon.sol` at `5a90dc5` on `main`, and its call site in `HoldbackRules.decide`.

Each status below is one of: **confirmed** (checked against the source, by a script or by a test), **refuted** (the check contradicts the claim), or **unverified** (not checked, with the reason). Each piece of evidence is labelled measured, documented or inferred, as in the first review.

## 1. Summary

**The verifier needs no change. The first review's verdict stands:** no defect in the verifier, and one Medium finding beside it (X-1, the appeal round).

- **The second reader found no defect, and nothing new that is real.** Its claims fill 49 rows (§4): 39 confirmed, 8 refuted and 2 unverified. All 8 refuted claims are wrong numbers or wrong reasons, not missed defects. The worst are a square-root MODEXP of about 776,000 gas (measured: 8,064 gas) and a claim that no party can choose the appeal round after seeing its value (X-1 shows one can).
- **It missed X-1, and it left three questions unanswered.** Three of its four answers hit the 8,192-token output cap. Two of those ran into a loop of repeated text, so they never answered question 6 (what a testnet cannot show), the question on execution clients, or the round comparison in the off-chain twin.
- **It caught one error in the first review.** The first review prices the square-root MODEXP at 8,170 gas under EIP-2565. Forge's EVM charges 8,064 gas [measured: `test_secondRead_modexpPrices`]. The difference is which 32 bytes of the 48-byte exponent are counted (§5.3). It changes the first review's Fusaka estimate by 534 gas, and no finding or severity.
- **The model calls:** 4 calls, 68,989 input tokens and 29,957 output tokens. They cost about USD 0.10 at DeepSeek's off-peak list prices, and at most USD 0.21 at peak prices [inferred from the reported token counts and `config/model-prices.json`].

## 2. Method

1. **The packet** [measured: `reports/scratch/t-353/run.mjs build`]. Every prompt starts with the same packet, built from public-repo files at `5a90dc5`:
   - `DrandQuicknetBeacon.sol` and `HoldbackRules.sol` lines 250 to 300, with line numbers;
   - `fixtures/beacon/drand-quicknet.json`;
   - the five drand test files T-343 started from: `DrandBeacon.t.sol`, `DrandEncodings.t.sol`, `DrandAllRounds.t.sol`, `DrandDecide.t.sol` and `GasPerDeal.t.sol`;
   - the six questions, word for word;
   - links to the sources: drand quicknet `/info`, `crypto/schemes.go`, `common/time.go`, EIP-2537 and its `field_to_curve` document, RFC 9380, the ZCash serialization, and EIP-198, EIP-2565, EIP-7883 and EIP-7823.

   The packet left out the first review, its findings and the two test files T-343 wrote (`DrandVerifierReview.t.sol`, `DrandRedTeam.t.sol`), because they carry its conclusions. It held nothing from the private repository.
2. **Four questions, asked separately.** Each prompt asked for numbered claims, each tagged DEFECT, OK or UNSURE, with a citation for each:
   - p1: question 1, a derivation of every constant;
   - p2: questions 2 and 3, a line-by-line read, and one attempt to forge a proof and one to break a valid proof;
   - p3: questions 4, 5 and 6, and the execution clients' subgroup checks;
   - p4: the off-chain twin (T-225 item 7), `quicknetValue` against `beaconValue` and `beaconRoundFor` against `decide`.

   The prompts are 50,357 to 62,197 characters long. They are in `reports/scratch/t-353/prompts/`, and the raw answers are in `reports/scratch/t-353/answers/`.
3. **The client and the model.** The run used the repo's own live client, `liveProvider('openai-compatible', …)` in `apps/adjudicator/src/providers/live.ts`. The client reads `HOLDBACK_OPENAI_COMPATIBLE_API_KEY` from the environment. Rafa ran the one command with his environment loaded, on 2026-11-11 from 20:51 to 20:54 UTC.
   - The model is `deepseek-v4-pro@2026-11-01` from `config/judges-live.yaml`. DeepSeek publishes no dated snapshots, so the ID is a provider alias that was checked on 2026-11-01 (the registry's recorded limit).
   - The client turns DeepSeek's thinking off and caps output at 8,192 tokens. The run kept both, so it used the client unchanged.
   - The model had no network access, so it recalled the specifications from memory instead of fetching them.
4. **The checks.** I checked every claim before I opened the first review's conclusions:
   - against the source;
   - with a script that recomputes every constant (`reports/scratch/t-353/check_constants.py`, 21 checks, all pass);
   - with 4 new Foundry tests (`contracts/test/crosscheck/DrandSecondRead.t.sol`, all pass);
   - with the existing tests: forge's drand suites and the off-chain agreement suite (`drand-contract.redteam.test.ts` and `drand.test.ts`, 44 tests, pass).
5. **The comparison** with the first review came last (§5).

| Call | Input tokens | Output tokens | Time | Ended |
| --- | --- | --- | --- | --- |
| p1, constants | 16,315 | 8,192 | 45.7 s | at the cap, mid-derivation |
| p2, soundness | 16,397 | 5,381 | 33.0 s | complete |
| p3, caller, gas, testnet | 16,466 | 8,192 | 49.5 s | at the cap, in a loop of repeated text |
| p4, off-chain twin | 19,811 | 8,192 | 38.2 s | at the cap, in a loop of repeated text |
| **Total** | **68,989** | **29,957** | 166.4 s | |

The cost is about USD 0.10 at DeepSeek's off-peak list prices (USD 0.66 per million input tokens and USD 1.98 per million output tokens); the run fell outside the peak hours in `config/model-prices.json`. At peak prices it is at most USD 0.21 [inferred]. The provider's cache-hit counts were not recorded, so the real figure may be lower.

## 3. The questions

1. Is every constant right, byte for byte?
2. Does the contract accept only a valid signature for exactly the stated round of exactly this chain?
3. Which checks does it leave to the precompiles, and do they perform them?
4. What can a caller who controls the inputs do?
5. What does verification cost in gas (items I-12 and I-13, re-measured)?
6. What can a testnet not show?

p3 also asked how Geth, Nethermind, Besu, Erigon and Reth implement the subgroup check of `PAIRING_CHECK`. p4 asked whether the off-chain check and the round selection agree with the contract.

## 4. Each claim and its status

The claim IDs are the model's own, per answer (p1 C3 is claim C3 of answer p1). Repeated claims are merged. In p4, claims C15 to C68 are one sentence that grows by a clause each time ("Disagreement on signature with x < p, on curve, …"), so they are counted as one non-claim, not 54 claims.

### 4.1 Constants (question 1)

| # | Claim | Status | Evidence |
| --- | --- | --- | --- |
| p1 C1 | p is `0x1a0111ea…ffffaaab`; P_HI and P_LO split it | **Confirmed** | The script derives p from the BLS parameter x = −0xd201000000010000 and matches it, and P_HI · 2²⁵⁶ + P_LO = p [measured] |
| p1 C2 | HALF = (p − 1)/2 | **Confirmed** | Script [measured] |
| p1 C3 | SQRT_EXP = (p + 1)/4, valid because p ≡ 3 mod 4 | **Confirmed** | Script: both equalities [measured] |
| p1 C4 | The DST is the scheme's 43 bytes, split 32 + 11 | **Confirmed** | Script, and `drand.ts:27` [measured] |
| p1 C5 | `abi.encodePacked(uint64)` gives the 8 big-endian bytes drand signs | **Confirmed** | Seven fixture rounds verify (`test_everyFixtureRound_accepted`), and the red team's hash-to-G1 matches the library's for rounds up to 2⁶⁴ − 1 [measured] |
| p1 C6 | GENESIS = 1692803367 and PERIOD = 3 match the fixture's `/info` | **Confirmed** | Fixture and `test_roundAt_matchesDrand` [measured] |
| p1 C7 | The chain hash is not a constant in code; the key makes the chain | **Confirmed** | Read: it appears only in the NatSpec (line 8) [measured] |
| p1 C8 | The fixture's key is 144 bytes, "not a standard format" (later revised to 96) | **Refuted** | The key is 96 bytes [measured: script]. The model's hex counting changed three times, and it hit the cap before it reached y |
| p1 C8 | x.c1 is the first 48 bytes with the flags cleared (PK_2‖PK_3), and x.c0 the last 48 (PK_0‖PK_1) | **Confirmed** | Script, byte for byte [measured]. The model never checked y. The script finds (x, y) on the G2 curve y² = x³ + 4(1 + u), with y the smaller root as the sign bit 0 requires [measured] |
| p2, lines 40–47 | The NG words are −G2 ("from memory") | **Confirmed** | NG's x is the published generator's x, and NG's y is p − y, coordinate by coordinate. The generator is on the curve [measured: script] |
| p2, lines 59–65 | The precompile addresses are EIP-2537's; 250,000 gas covers two pairs at 102,900 gas | **Confirmed** | `test_secondRead_eip2537Prices`: two pairs fail at 102,899 gas and pass at 102,900 [measured] |
| p2, lines 74–76 | `roundAt` matches drand, including round 0 before genesis | **Refuted, without impact** | Before genesis, drand's `CurrentRound` returns 1, not 0 [documented in the first review's fetch of `common/time.go`; I recall the same but could not fetch it]. No deal can name a time before 2023-08-23. The first review rates it Info (R-4) |

### 4.2 Soundness and the checks left to precompiles (questions 2 and 3)

| # | Claim | Status | Evidence |
| --- | --- | --- | --- |
| p2 C1 | A wrong round is refused | **Confirmed** | `test_refuses_wrongRound`, `test_refuses_anotherRoundsSignature` [measured] |
| p2 C2, C11 | Only `PAIRING_CHECK` checks the subgroup, and EIP-2537 makes it a MUST | **Confirmed** | `test_refuses_aCurvePointOutsideG1`, `test_defense_order3Points_refusedByThePairing` [measured]; EIP-2537, "Subgroup checks" [documented, quoted in the first review §5] |
| p2 C3 | The identity is refused by the flags | **Confirmed** | Line 123 refuses bit 6. The one compressed non-infinity point with x = 0 is (0, ±2), of order 3, which the pairing refuses (`test_defense_order3Points_refusedByThePairing`) [measured] |
| p2 C4 | A length other than 48 is refused | **Confirmed** | Line 80; `test_refuses_malformedEncodings` [measured] |
| p2 C5 | x ≥ p is refused before any precompile | **Confirmed** | `test_defense_xAboveP_refusedBeforeAnyPrecompile`, under 100,000 gas [measured] |
| p2 C6 | Wrong flag bits are refused; only the published sign verifies | **Confirmed** | `test_defense_onlyThePublishedFlagsVerify`, and `DrandAllRounds`: exactly 1 of 8 flag values verifies, for each of 7 rounds [measured] |
| p2 C7 | Another drand chain's signature fails "because the public key doesn't match" | **Confirmed, with a corrected reason** | drand's default chain signs on G2, so its signature is 96 bytes and the length check refuses it before any key is used [measured: `test_secondRead_aG2SignatureIsRefusedByLength`]. A G1 chain such as `quicknet-t` does fail the pairing [measured in the off-chain agreement corpus] |
| p2 C9 | The value is sha256(signature) | **Confirmed** | `test_realRounds_accepted_valueIsSha256OfSignature` [measured] |
| p2 C12 | `MAP_FP_TO_G1` clears the cofactor, so H(m) is in G1 | **Confirmed** | `test_hashToG1_matchesTheReferenceImplementation` [measured]; `field_to_curve`, step 3 [documented] |
| p2 C13 | The key and −G2 are in G2 | **Confirmed** | Both are on the curve [measured: script]. Membership of the subgroup is inferred: `PAIRING_CHECK` must check every input, and real rounds verify |
| p2 C15 | `_reduce` gives canonical field elements | **Confirmed** | MODEXP returns a value mod p, and the reference hash matches [measured] |
| p2 C16 | Neither the contract nor a precompile checks the round's range, by design | **Confirmed** | Read: `decide` fixes the round, and the beacon only proves its value [inferred] |
| p2 C17 | Forging with a torsion point fails | **Confirmed** | `test_defense_validSignaturePlusAnOrder3Point_refusedByThePairing` [measured] |
| p2 C20 | The negated signature fails | **Confirmed** | `test_refuses_theNegatedSignature` [measured] |
| p2 C18 | The gas cap cannot make a valid proof fail | **Confirmed, incomplete** | True of the 250,000 gas cap. It misses that a relayer that forwards too little gas makes a valid proof revert as `InvalidSignature` (the first review's R-9) |
| p2 C19 | Each MODEXP is "approximately 200 gas", and the verification costs 328,630 gas | **Refuted** | The 1-byte exponents cost 200 gas, but the square root costs 8,064 [measured: `test_secondRead_modexpPrices`]. 328,630 gas is a whole fallback `decide` (`GasPerDeal.t.sol:174`); one verification costs 141,449 gas [measured: `test_secondRead_oneVerificationGas`] |

### 4.3 The caller, gas and the testnet (questions 4 to 6)

| # | Claim | Status | Evidence |
| --- | --- | --- | --- |
| p3 C1 | One accepted string per round | **Confirmed** | `DrandAllRounds`, 8 flag values × 7 rounds [measured] |
| p3 C3 | A bad proof costs its sender at most about 350,000 gas; decompression at x near p costs under 100,000 | **Confirmed, as a bound** | `DrandEncodings` asserts under 100,000 [measured]. The first review measured 283,587 gas for a point outside G1 |
| p3 C4 | A valid proof costs about 330,000 gas | **Refuted** | 141,449 gas, with the call included [measured]. The first review measured 136,116 to 136,263 gas around a warm beacon; my call is cold (2,500 gas more) and adds the ABI round trip [inferred] |
| p3 C5 | A relayer cannot block a settlement by changing the proof, since the adjudicator signs it | **Confirmed** | `test_proofIsBoundToTheAdjudicatorsSignature` [measured] |
| p3 C6 | The round is fixed by state, not by the message | **Confirmed** | `HoldbackRules.sol:261, 265, 269, 291` [measured: read] |
| p3 C7 | A party can pick when to escalate or appeal, but "cannot choose a favorable round after seeing its value" | **Refuted** | The round `roundAt(t) + 1` is published 1 to 3 s after the block's timestamp t, and a block is often built later than that. A contract can read the value, derive the seed, and file only when the seed suits [measured: the three `test_issue_wrongRound_*` tests in `DrandRedTeam.t.sol` pass on this branch]. This is X-1 |
| p3 C8 | The fallback adjudicator sees the panel seed before it decides | **Confirmed, known** | The round at `judgeBy` is published by `judgeBy`, before `fallbackBy` [inferred from lines 258–261 and 286]. This is T-225 item 1; the seed is fixed, so seeing it gives no choice |
| p3 C9, C10, C13 | `roundAt` and `hashToG1` are harmless public helpers; `beaconValue` keeps no state | **Confirmed** | Read: `pure` and `view` [measured] |
| p3 C11 | A signature for round 0 or 2⁶⁴ − 1 would verify if one existed | **Confirmed** | Read, and the red team's hash for those rounds [measured] |
| p3 C12 | The mask clears bits 381 to 383 | **Confirmed** | `0xe0 << 120` is bits 125 to 127 of the top 16 bytes [measured: read] |
| p3 C14 | The path is 3 MODEXP calls, 5 SHA-256 calls, 2 `MAP_FP_TO_G1` calls, 1 `G1ADD` and the pairing | **Refuted** | There are 5 MODEXP calls (2 in `_reduce`, lines 94–95 and 115) and 7 SHA-256 calls (the message, b0 to b4, and the value) [measured: read] |
| p3 C15 | Under EIP-2565 the multiplication complexity of 64 bytes is 4,096, the iteration count is bit length plus popcount, and the square root costs about 776,000 gas | **Refuted** | Complexity is 8 words squared, 64; iterations are 8 · 16 + 250 = 378; the price is 64 · 378 / 3 = 8,064 gas [measured: the call fails at 8,063 gas and passes at 8,064] |
| p3, (b) | `MAP_FP_TO_G1` costs 25,000 gas and `G1ADD` 600 ("from memory") | **Refuted** | 5,500 and 375 gas [measured: `test_secondRead_eip2537Prices`, each fails one gas below its price] |
| p3, (b) | SHA-256 costs 60 + 12 gas per word | **Confirmed** | Yellow Paper, appendix E [documented; I recall it, not fetched]. Small next to the rest: 660 gas in all [inferred: script] |
| p3, (c) and (d) | Question 6 and the five execution clients | **Unverified: no answer** | The answer looped over the MODEXP formula until the output cap. The first review's G-1 still owes the client check |

### 4.4 The off-chain twin (T-225 item 7)

| # | Claim | Status | Evidence |
| --- | --- | --- | --- |
| p4 C1–C3 | Same value, same round encoding, same DST | **Confirmed** | `drand.ts:27, 57, 62` against `DrandQuicknetBeacon.sol:23–25, 82, 86` [measured: read] |
| p4 C4 | Same key | **Confirmed** | `QUICKNET_PUBLIC_KEY` is the compressed form of PK_0 to PK_7 [measured: script] |
| p4 C5–C7, C10 | Same length, flags, x < p and infinity checks | **Confirmed** | `drand.ts:46–50, 56` [measured: read] |
| p4 C8, C9, C11, C12 | noble's `assertValidity` checks the curve and the subgroup, the verification is the same, and both accept only the canonical sign | **Confirmed** | `drand-contract.redteam.test.ts` runs one corpus through both, with flag flips, x + p, points outside G1, infinity, other rounds and another chain: they agree on every string [measured: 44 tests pass] |
| p4 C13, C14 | Off chain round 0 is refused; on chain it is tried. No real input differs | **Confirmed, Info** | `drand.ts:46` [measured: read]. Off chain also refuses rounds above 2⁵³ − 1, which quicknet reaches in about 850 million years [inferred] |
| p4, (b) | `beaconRoundFor` against `decide` | **Unverified: no answer** | The answer looped (C15 to C68) and never reached part (b). By my read, `state.ts:310–312` and `HoldbackRules.sol:258–269` pick the same round for each role: `judgeBy`, the escalation's time (`t1`), and the appeal's time (`t2`, "appeal openedAt" at line 53, set at line 515) [inferred]. A full comparison is T-225's |

**Tally:** 49 rows: 39 confirmed (3 of them with a corrected reason or a missing case: p2 C7, p2 C18 and p3 C3), 8 refuted, and 2 unverified because the model gave no answer. A row merges claims the model repeated. No answer tagged anything DEFECT.

## 5. Against the first review

### 5.1 What the second reader found that the first did not

Nothing about the contract. Its one new fact came out of checking its wrong gas figure: the first review's EIP-2565 price for the square root is off (§5.3).

### 5.2 What it missed

- **X-1** (Medium). The model reasoned that the appeal round "is fixed by state before the decision is submitted", and so cannot be known in time. It did not consider a block built after its timestamp. The first review's red team measured the attack, and the three tests pass on this branch.
- **R-9**: a valid proof sent with too little gas reverts as `InvalidSignature`. The model checked only that the cap is high enough.
- **R-8**: `decide` checks the proof before the adjudicator's signature, so an unsigned decision can burn its sender's gas in the pairing.
- **Gate lines G-1 to G-10.** The model gave no answer to question 6 or on the execution clients.
- **The y coordinates.** The model never derived the public key's y or the generator's. The first review and this read's script both check them.

### 5.3 Where the two disagree, and who is right

| Point | First review | Second reader | Who is right |
| --- | --- | --- | --- |
| Can a party know the appeal round in time? | Yes, X-1 | No | **The first review** [measured: the `test_issue_wrongRound_*` tests] |
| The square-root MODEXP under EIP-2565 | 8,170 gas | about 776,000 gas | **Neither: 8,064 gas** on forge's EVM [measured] |
| The EIP-2537 prices | 102,900 gas for two pairs | `MAP_FP_TO_G1` 25,000 and `G1ADD` 600 | **The first review**: 5,500, 375 and 102,900 [measured] |
| `roundAt` before genesis | drand says 1 (R-4, Info) | drand says 0 | **The first review**, from its fetch of `common/time.go` [documented] |

**The 8,064 against 8,170 gas.** The exponent (p + 1)/4 takes 48 bytes. EIP-198 counts the bit length of its first 32 bytes, whose top bit is bit 250, so 8 · 16 + 250 = 378 iterations and 8,064 gas. The first review's 8,170 gas is 383 iterations. That count is what you get from the low 32 bytes, whose top bit is bit 255 (8 · 16 + 255 = 383) [inferred]. Forge's EVM counts the leading bytes [measured].
- The same reading changes the Fusaka estimate. The first review gives two figures: 58,438 gas more, from EIP-7883 as written, and 57,904 gas more for a client that counts the leading 32 bytes (§7, §11). This read's script gives 57,904 gas more, and forge's EVM uses that reading under EIP-2565.
- What each mainnet client counts under EIP-7883 is still unverified: this task could fetch no EIP text and run no other client. So R-5's "about 341,200 gas under Fusaka" is about 534 gas too high for a client that behaves like forge's [inferred].
- This is an Info correction to §7 and R-5. It changes no verdict, no severity and no gate line.

### 5.4 Does the first review's verdict stand?

**Yes.** On the questions it answered, the second family agrees that the verifier has no defect: 39 confirmed claims and no DEFECT tag. Each of its 8 refuted claims is a wrong number or a wrong reason; none points to a flaw the first review missed. X-1 stands, and is measured again here. The first review's gas tables need the 534 gas correction above, and nothing else.

## 6. What this read could not do

- **It could not fetch the sources.** The model had no network access, and this task's one outside call was the DeepSeek API. Spec values come from the model's or my memory, or from the first review's fetches, and each is labelled.
- **It could not run another EVM.** The 8,064 gas figure is forge's EVM under Prague. Gate lines G-1 and G-2 still owe the five clients and mainnet's fork rules.
- **The model was given no reasoning budget.** The repo's client turns DeepSeek's thinking off, and the answers show it: wrong recalled formulas, and loops of repeated text at the output cap. A second read worth more would split the questions further, raise the output cap, or let the model reason. That would mean changing the client, which this task did not do. Even so, the read meets section 11's ask: a model of another family read the inputs and the questions without the first review's conclusions.

## 7. Files

- `contracts/test/crosscheck/DrandSecondRead.t.sol`: 4 new tests (the EIP-2537 prices, the MODEXP prices, one verification's gas, a 96-byte signature). It changes no contract and no existing test.
- `reports/scratch/t-353/`, kept locally and not committed (`reports/` is ignored): `run.mjs`, `check_constants.py`, `prompts/`, `answers/` (with `run-log.json`).
