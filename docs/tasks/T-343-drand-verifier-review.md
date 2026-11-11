# T-343: the drand verifier, read against its specifications

- **Lane:** research (contracts, read only)
- **Phase:** 2
- **Depends on:** T-209 (the verifier), T-217 (the off-chain proof path), T-206 (the contract review, items I-12 and I-13). Rafa's scope decision SC-8 of 2026-11-11 keeps the on-chain beacon proof in phase one.
- **Paths this task may touch:** `docs/reviews/2026-11-11-drand-verifier-review.md` (new); new files under `contracts/test/` only where a case is not covered, and never a test another package owns; this file. It changes nothing under `contracts/src/`.
- **Human gate:** no. It deploys nothing and sends no transaction.
- **Status:** review
- **Agent/session:** Claude Code session on branch `t-343-drand-verifier-review` (2026-11-11)

## Intent

`contracts/src/DrandQuicknetBeacon.sol` verifies a drand quicknet round's BLS signature on chain. The rules contract uses the round's value as the seed of fallback and appeal panels. The file stays in the phase-one contracts and in the audit's scope (SC-8), and nobody on the contract lane has read its arithmetic line by line. This task is package R10b of the contract refinement plan.

Restated: read the 175 lines against two published specifications, the drand quicknet scheme and EIP-2537, and cite the section behind every check. Answer six questions with evidence:

1. Is every constant right, byte for byte?
2. Does the contract accept only a valid signature for exactly the stated round of exactly this chain?
3. Which checks does it leave to the precompiles, and do they perform them?
4. What can a caller who controls the inputs do?
5. What does verification cost in gas (items I-12 and I-13, re-measured)?
6. What can a testnet not show?

The output is a review document. This task fixes nothing. A defect goes to the contract lane with a severity and a reproducing test.

Non-goals: any edit to `contracts/src/`; the off-chain check (`apps/adjudicator/src/drand.ts`); the round selection in `HoldbackRules.decide` (T-225 item 1); a second read by a model of another family, which the plan asks for and this session cannot give.

## Context

- The plan: package R10b in section 7 of the contract refinement plan (kept privately, `docs/private-materials.md`).
- `contracts/src/DrandQuicknetBeacon.sol`, `contracts/src/IHoldbackBeacon.sol`, the call site in `HoldbackRules.decide`.
- Existing tests: `contracts/test/unit/DrandBeacon.t.sol`, `contracts/test/crosscheck/DrandEncodings.t.sol`, `contracts/test/crosscheck/DrandAllRounds.t.sol`, `contracts/test/unit/DrandDecide.t.sol`, `contracts/test/unit/GasPerDeal.t.sol`; the fixture `fixtures/beacon/drand-quicknet.json`.
- `docs/tasks/T-217-drand-proofs-sepolia.md`; ADR-0018 (`docs/decisions/ADR-0018-panel-seed-beacon.md`); items I-12 and I-13 in `docs/reviews/2026-11-03-contract-review.md` §2.3, indexed in `docs/audit/known-issues.md`.
- Specifications: drand's source (`crypto/schemes.go`, `common/time.go`) and the quicknet `/info` endpoint; EIP-2537 and its `field_to_curve` document; RFC 9380; the ZCash serialization of BLS12-381 points; EIP-2565, EIP-7883 and EIP-7823 for MODEXP.

## Acceptance criteria

- [ ] The review is at `docs/reviews/2026-11-11-drand-verifier-review.md`, written to `docs/writing.md`, with each claim labelled measured, documented, inferred or unverified.
- [ ] Every constant is compared with its published value, byte for byte: the public key, the domain separation tag, the field modulus and the exponents derived from it, the negated G2 generator, the genesis time and the period, the round-number encoding.
- [ ] Each of these cases has a test or worked reasoning: a wrong round; a signature on the curve and outside the prime-order subgroup; the identity point as the signature; a malformed length; a non-canonical field element; a valid signature from another drand chain.
- [ ] The review names each check the contract leaves to a precompile, cites where EIP-2537 requires it, and names any check that neither performs.
- [ ] The review states what a caller who controls the inputs can do: make a valid round revert, burn gas, or get a value for an invalid proof.
- [ ] Gas: items I-12 and I-13 are re-measured with `forge test --gas-report`, with units.
- [ ] The review lists what a testnet cannot show, as lines for the plan's mainnet gate.
- [ ] New tests, if any, are new files under `contracts/test/`, and `forge test --root contracts` passes.
- [ ] One `red-teamer` pass tries to forge an accepted proof or break a valid one, with the contract and the two specifications and without this review's conclusions.
- [ ] The review says what the second-family read still needs.

## Out of scope

- Fixing a defect. The contract lane (T-334 and the packages after it) owns `contracts/src/`.
- The hardening items of T-225 (the fallback round's timing, relay outages, answer size).
- A deploy, a transaction, or anything sent to another party.

## Evidence

Branch `t-343-drand-verifier-review`, 2026-11-11. Each claim is labelled measured, documented, inferred or unverified. The review, `docs/reviews/2026-11-11-drand-verifier-review.md`, carries the detail.

**Verdict.** No defect in `DrandQuicknetBeacon.sol` [inferred from the read; every case measured]. One Medium finding outside it, in the round `HoldbackRules.decide` picks for an appeal (X-1) [measured in forge; its use on a live chain is inferred].

**The six questions.**
1. **Constants: all right** [measured]. `test_review_constants_matchThePublishedValues` compares each with its published value, and a session script made 32 checks with `@noble/curves` 1.9.1; all pass.
2. **Only a valid signature of this round and chain: yes** [measured]. Wrong round, outside the subgroup, the identity, six wrong lengths, x not below p, and real signatures of three other drand chains are refused.
3. **Left to a precompile:** the subgroup check of the signature, which EIP-2537 makes a MUST for `PAIRING_CHECK` [documented; measured on forge's EVM and on two Sepolia nodes]. No check is missing [inferred].
4. **A caller with the inputs** can burn its own gas, up to the 250,000 gas cap of the pairing call plus the work before it. It cannot get a value for an invalid proof or stop a valid one for anyone else [measured].
5. **Gas** [measured, forge 1.0.0, Prague prices, `--gas-report`]: a valid proof 136,116 to 136,263 gas; a proof outside G1 282,797 gas; `hashToG1` 18,648 gas. On the Sepolia deployment `eth_estimateGas` gives 213,185 gas for a transaction that verifies round 1000 [measured, read-only], which is I-13's figure. I-12: two pairs cost 102,900 gas of the 250,000 gas cap, a margin of 2.43 times.
6. **What a testnet cannot show:** ten lines for the mainnet gate, G-1 to G-10, in the review's §8.

**Commands run** [measured]:
- `forge test --root contracts`: 39 suites, 282 tests pass, 0 fail, 0 skipped (forge 1.0.0, 2026-11-11).
- `FOUNDRY_GAS_REPORTS='["DrandQuicknetBeacon"]' forge test --root contracts --gas-report --match-contract "DrandBeaconTest|DrandEncodingsTest|DrandAllRoundsTest|DrandVerifierReviewTest|GasPerDealDrandTest|DrandDecideTest"`. The variable is needed because `foundry.toml` lists two other contracts for the report.
- Read-only calls to the Sepolia deployment `0xBe80ad8Ba4E49bc985ef43caD71740351EE4Cc10` with `cast call`, `cast estimate` and `cast codehash`, on `ethereum-sepolia-rpc.publicnode.com` (reth v2.11.0) and `sepolia.gateway.tenderly.co`. Both gave the same eight answers. The code hash is the one in `contracts/deployments/sepolia.json`.
- Two block headers each from Sepolia and mainnet, for their timestamps (finding X-1).

**Sources** were fetched by `web-fetch` subagents on 2026-11-11: the quicknet `/info` on two relays, drand's `crypto/schemes.go` and `common/time.go`, EIP-2537 and its `field_to_curve` document, RFC 9380, the ZCash serialization text, and EIP-2565, EIP-7883, EIP-7823, EIP-7600, EIP-7607 and EIP-7773. Three texts reached the session as summaries and are marked unverified in the review: the sign rule in the pairing-friendly-curves draft's Appendix C, RFC 9380's test vectors, and the last third of EIP-8037.

**Red team** (one `red-teamer` subagent, without the review's conclusions): no forge and no break of a valid proof in 22 tests; finding X-1; two Lows on what the contract relies on its chain for; three Infos.

**Tokens:** about 250,000 for the red team, about 390,000 for the four `web-fetch` passes [measured from the subagents' reports]; the session's own use was not measured. The 200,000-token target was passed, mostly by the red team.

## Decisions

1. **The tests are two new files under `contracts/test/crosscheck/`.** `DrandVerifierReview.t.sol` holds the review's 12 tests; `DrandRedTeam.t.sol` holds the red team's 22. No existing test changed.
2. **The constants are checked by a test, not only by a script,** so CI reruns the check. The test reads the internal constants through a small contract that inherits the beacon.
3. **X-1 is recorded, not fixed.** It is in `HoldbackRules`, which the contract lane owns. Its reproducing tests are the three `test_issue_wrongRound_…` tests.
4. **The red team's two Lows keep the severity it gave them,** and the review says what each is: the known item I-12, and a reliance on a MUST of EIP-2537.
5. **Read-only calls to public Sepolia endpoints were used** to measure gas and to compare two node implementations. No transaction was sent. One endpoint (`1rpc.io/sepolia`) spread calls over several backends, so its answers were discarded.
6. **Fusaka's gas is derived, not measured locally.** forge 1.0.0, which CI pins, knows Prague's prices only.

## Handoff

**State:** review. The PR carries the task file, the review and the two test files.

**For the coordinator:**
- **Finding X-1 (Medium) goes to the contract lane.** After an escalation or a party's appeal the panel's round is `roundAt(t) + 1`. drand publishes it 1 s after a mainnet block's timestamp and 3 s after a Sepolia block's. Whoever lands the step in a block built that late can know the seed first. The SC-7 cut removes the party-appeal half; the escalation keeps the rule. It is a stronger form of the plan's IS-7.
- **Gate lines G-1 to G-10** (the review's §8) go into the plan's mainnet gate.
- **The second-family read is still owed.** The review's §11 lists what to give the other model and what to ask of it.

**For the contract lane:**
- `DrandRedTeam.t.sol` extends `test/unit/Base.sol` and calls `fileAppeal`. When package R6 removes `fileAppeal`, delete `test_issue_wrongRound_appellantFilesOnlyWhenTheAppealSeedSuitsIt`, the `_appeal` helper and `SeedGatedFiler.fileIfSeedSuits`. If a refactor renames a `Base` helper, this file needs the same rename.
- `DrandVerifierReview.t.sol` depends only on `DrandQuicknetBeacon.sol`. Its constants test reads the internal constants by name (`PK_0` to `PK_7` through `_publicKey()`, `NG_0` to `NG_7` through `_negG2()`, `P_HI`, `P_LO`, `HALF_*`, `SQRT_EXP_*`, `DST_*`, the precompile addresses, `PAIRING_GAS`); a rename there needs the same rename here.
- Its gas test pins Prague prices: a valid proof below 175,000 gas. A move of `evm_version` to a fork with EIP-7883 needs that bound raised by about 58,500 gas.

**Open questions:** whether to mine the refusals on a testnet (G-4), which needs a transaction and so waits for Rafa.
